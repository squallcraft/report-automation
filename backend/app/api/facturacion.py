"""
API de Facturación: control semanal de cobros a sellers y factura mensual.
"""
import json
from typing import Optional, List
from datetime import date as _date_type, datetime, timezone


def _parse_fecha(valor: str) -> _date_type:
    valor = valor.strip()
    if "/" in valor:
        parts = valor.split("/")
        if len(parts) == 3 and len(parts[0]) <= 2:
            return _date_type(int(parts[2]), int(parts[1]), int(parts[0]))
    return _date_type.fromisoformat(valor)

from fastapi import APIRouter, Depends, HTTPException, Query, Body, UploadFile, File, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import or_, func

from app.database import get_db
from app.config import get_settings
from app.auth import require_admin_or_administracion
from app.models import (
    Seller, Envio, AjusteLiquidacion,
    PagoSemanaSeller, FacturaMensualSeller,
    CalendarioSemanas, TipoEntidadEnum,
    EstadoPagoEnum, EstadoFacturaEnum,
    CartolaCarga, PagoCartolaSeller,
)
from app.services.liquidacion import calcular_liquidacion_sellers
from app.services.audit import registrar as audit
from app.services.haulmer import emitir_factura, _formatear_rut as _fmt_rut
from app.services.contabilidad import asiento_cobro_seller

router = APIRouter(prefix="/facturacion", tags=["Facturación"])

GIRO_DEFAULT = "Servicios de transporte y logística"


class PagoSemanaUpdate(BaseModel):
    estado: Optional[str] = None
    monto_override: Optional[int] = None
    nota: Optional[str] = None
    fecha_pago: Optional[str] = None


class FacturaMensualOut(BaseModel):
    id: int
    seller_id: int
    seller_nombre: str
    rut: Optional[str] = None
    giro: Optional[str] = None
    mes: int
    anio: int
    subtotal_neto: int
    iva: int
    total: int
    folio_haulmer: Optional[str] = None
    estado: str
    emitida_por: Optional[str] = None
    emitida_en: Optional[datetime] = None

    model_config = {"from_attributes": True}


def _semanas_del_mes(db: Session, mes: int, anio: int) -> List[int]:
    rows = db.query(CalendarioSemanas.semana).filter(
        CalendarioSemanas.mes == mes,
        CalendarioSemanas.anio == anio,
    ).order_by(CalendarioSemanas.semana).all()
    if rows:
        return [r[0] for r in rows]
    return [1, 2, 3, 4, 5]


def _get_monto_semanal_seller(db: Session, seller_id: int, semana: int, mes: int, anio: int) -> int:
    """Obtiene el subtotal neto de un seller para una semana desde liquidación."""
    envios = db.query(Envio).filter(
        Envio.seller_id == seller_id,
        Envio.semana == semana,
        Envio.mes == mes,
        Envio.anio == anio,
    ).all()
    if not envios:
        return 0

    seller = db.get(Seller, seller_id)
    total_envios = sum(e.cobro_seller + e.cobro_extra_manual for e in envios)
    total_extras_producto = sum(e.extra_producto_seller for e in envios)
    total_extras_comuna = sum(e.extra_comuna_seller for e in envios)

    total_retiros = 0
    if seller and seller.tiene_retiro and not seller.usa_pickup and seller.tarifa_retiro:
        if not (seller.min_paquetes_retiro_gratis > 0 and len(envios) >= seller.min_paquetes_retiro_gratis):
            dias_con_envios = len({e.fecha_entrega for e in envios if e.fecha_entrega})
            total_retiros = seller.tarifa_retiro * dias_con_envios

    ajustes = db.query(AjusteLiquidacion).filter(
        AjusteLiquidacion.tipo == TipoEntidadEnum.SELLER,
        AjusteLiquidacion.entidad_id == seller_id,
        AjusteLiquidacion.semana == semana,
        AjusteLiquidacion.mes == mes,
        AjusteLiquidacion.anio == anio,
    ).all()
    total_ajustes = sum(a.monto for a in ajustes)

    return total_envios + total_extras_producto + total_extras_comuna + total_retiros + total_ajustes


@router.get("/tabla")
def tabla_facturacion(
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """
    Tabla mensual de facturación. Optimizado con queries bulk.
    """
    semanas = _semanas_del_mes(db, mes, anio)
    sellers = db.query(Seller).filter(Seller.activo == True).order_by(Seller.nombre).all()

    # --- Bulk queries ---
    envio_rows = db.query(
        Envio.seller_id, Envio.semana,
        func.sum(Envio.cobro_seller + Envio.cobro_extra_manual).label("t_envios"),
        func.sum(Envio.extra_producto_seller).label("t_extras_prod"),
        func.sum(Envio.extra_comuna_seller).label("t_extras_com"),
        func.count(Envio.id).label("cant"),
        func.count(func.distinct(Envio.fecha_entrega)).label("dias"),
    ).filter(Envio.mes == mes, Envio.anio == anio).group_by(Envio.seller_id, Envio.semana).all()

    envio_agg = {}
    for r in envio_rows:
        envio_agg[(r.seller_id, r.semana)] = (r.t_envios or 0, r.t_extras_prod or 0, r.t_extras_com or 0, r.cant, r.dias)

    seller_ids_con_envios = {r.seller_id for r in envio_rows}

    ajuste_rows = db.query(
        AjusteLiquidacion.entidad_id, AjusteLiquidacion.semana,
        func.sum(AjusteLiquidacion.monto).label("total"),
    ).filter(
        AjusteLiquidacion.tipo == TipoEntidadEnum.SELLER,
        AjusteLiquidacion.mes == mes, AjusteLiquidacion.anio == anio,
    ).group_by(AjusteLiquidacion.entidad_id, AjusteLiquidacion.semana).all()

    ajuste_agg = {(r.entidad_id, r.semana): (r.total or 0) for r in ajuste_rows}

    all_pagos = db.query(PagoSemanaSeller).filter(
        PagoSemanaSeller.mes == mes, PagoSemanaSeller.anio == anio,
    ).all()
    pagos_map = {(p.seller_id, p.semana): p for p in all_pagos}

    facturas_map = {f.seller_id: f for f in db.query(FacturaMensualSeller).filter(
        FacturaMensualSeller.mes == mes, FacturaMensualSeller.anio == anio,
    ).all()}

    # --- Helper con lookup en memoria ---
    def _monto_semanal(seller, semana):
        key = (seller.id, semana)
        if key not in envio_agg:
            return 0
        t_env, t_ep, t_ec, cant, dias = envio_agg[key]
        total_retiros = 0
        if seller.tiene_retiro and not seller.usa_pickup and seller.tarifa_retiro:
            if not (seller.min_paquetes_retiro_gratis > 0 and cant >= seller.min_paquetes_retiro_gratis):
                total_retiros = seller.tarifa_retiro * dias
        t_aj = ajuste_agg.get(key, 0)
        return t_env + t_ep + t_ec + total_retiros + t_aj

    result = []
    for seller in sellers:
        row = {
            "seller_id": seller.id,
            "seller_nombre": seller.nombre,
            "rut": seller.rut,
            "giro": seller.giro,
            "semanas": {},
        }

        subtotal = 0
        for sem in semanas:
            pago = pagos_map.get((seller.id, sem))
            if pago and pago.monto_override is not None:
                monto = pago.monto_override
            else:
                monto = _monto_semanal(seller, sem)

            estado = pago.estado if pago else EstadoPagoEnum.PENDIENTE.value
            editable = pago.monto_override is not None if pago else False
            is_feb_override = (mes == 2 and anio == 2026 and sem <= 3)

            row["semanas"][str(sem)] = {
                "monto_neto": monto,
                "estado": estado,
                "editable": editable or is_feb_override,
                "nota": pago.nota if pago else None,
                "fecha_pago": pago.fecha_pago.isoformat() if pago and pago.fecha_pago else None,
                "pago_id": pago.id if pago else None,
            }
            subtotal += monto

        row["subtotal_neto"] = subtotal
        row["iva"] = int(subtotal * 0.19)
        row["total_con_iva"] = subtotal + row["iva"]

        factura = facturas_map.get(seller.id)
        row["factura_estado"] = factura.estado if factura else None
        row["factura_folio"] = factura.folio_haulmer if factura else None

        tiene_envios = seller.id in seller_ids_con_envios
        if subtotal > 0 or (factura and factura.estado != EstadoFacturaEnum.PENDIENTE.value) or tiene_envios:
            result.append(row)

    return {"semanas_disponibles": semanas, "sellers": result}


@router.put("/pago-semana/{seller_id}")
def actualizar_pago_semana(
    seller_id: int,
    semana: int = Query(...),
    mes: int = Query(...),
    anio: int = Query(...),
    body: PagoSemanaUpdate = ...,
    request: Request = None,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin_or_administracion),
):
    """Actualiza estado y/o monto override de una semana para un seller."""
    seller = db.get(Seller, seller_id)
    if not seller:
        raise HTTPException(status_code=404, detail="Seller no encontrado")

    pago = _upsert_pago_semana_seller(
        db, seller_id, semana, mes, anio,
        estado=body.estado,
        monto_override=body.monto_override,
        nota=body.nota,
        fecha_pago=body.fecha_pago,
    )
    audit(db, "pago_manual_seller", usuario=current_user, request=request, entidad="pago_semana_seller", entidad_id=seller_id, metadata={"nombre": seller.nombre, "semana": semana, "mes": mes, "anio": anio, "estado": body.estado, "monto": body.monto_override})
    db.commit()
    return {"ok": True, "monto_neto": pago.monto_override if pago.monto_override is not None else pago.monto_neto}


@router.put("/pago-semana-batch")
def actualizar_pagos_batch(
    mes: int = Query(...),
    anio: int = Query(...),
    body: List[dict] = ...,
    request: Request = None,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin_or_administracion),
):
    """Actualiza múltiples pagos semanales. Body: [{seller_id, semana, monto_override?, estado?}, ...]"""
    updated = 0
    for item in body:
        seller_id = item.get("seller_id")
        semana = item.get("semana")
        if not seller_id or not semana:
            continue

        _upsert_pago_semana_seller(
            db, seller_id, semana, mes, anio,
            estado=item.get("estado"),
            monto_override=item.get("monto_override"),
            nota=item.get("nota"),
            fecha_pago=item.get("fecha_pago"),
        )
        updated += 1

    audit(db, "pago_batch_seller", usuario=current_user, request=request, entidad="pago_semana_seller", metadata={"mes": mes, "anio": anio, "cambios": len(body)})
    db.commit()
    return {"ok": True, "updated": updated}


@router.patch("/pago-semana-seller/{pago_id}/fecha-pago")
def actualizar_fecha_pago_seller(
    pago_id: int,
    body: dict,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Actualiza la fecha_pago de un PagoSemanaSeller existente."""
    pago = db.get(PagoSemanaSeller, pago_id)
    if not pago:
        raise HTTPException(status_code=404, detail="Pago no encontrado")
    nueva_fecha = body.get("fecha_pago")
    if not nueva_fecha:
        raise HTTPException(status_code=400, detail="fecha_pago requerida")
    pago.fecha_pago = _parse_fecha(nueva_fecha)
    cartola_manual = db.query(PagoCartolaSeller).filter(
        PagoCartolaSeller.seller_id == pago.seller_id,
        PagoCartolaSeller.semana == pago.semana,
        PagoCartolaSeller.mes == pago.mes,
        PagoCartolaSeller.anio == pago.anio,
        PagoCartolaSeller.fuente == "manual",
    ).first()
    if cartola_manual:
        cartola_manual.fecha_pago = nueva_fecha
    db.commit()
    return {"ok": True, "fecha_pago": pago.fecha_pago.isoformat()}


# ── Factura mensual ──

@router.get("/facturas")
def listar_facturas(
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    facturas = db.query(FacturaMensualSeller).filter(
        FacturaMensualSeller.mes == mes,
        FacturaMensualSeller.anio == anio,
    ).all()
    sids = {f.seller_id for f in facturas}
    sellers_map = {s.id: s for s in db.query(Seller).filter(Seller.id.in_(sids)).all()} if sids else {}
    result = []
    for f in facturas:
        seller = sellers_map.get(f.seller_id)
        result.append({
            "id": f.id,
            "seller_id": f.seller_id,
            "seller_nombre": seller.nombre if seller else "—",
            "rut": seller.rut if seller else None,
            "giro": seller.giro if seller else None,
            "mes": f.mes,
            "anio": f.anio,
            "subtotal_neto": f.subtotal_neto,
            "iva": f.iva,
            "total": f.total,
            "folio_haulmer": f.folio_haulmer,
            "estado": f.estado,
            "emitida_por": f.emitida_por,
            "emitida_en": f.emitida_en.isoformat() if f.emitida_en else None,
        })
    return result


@router.post("/generar-facturas")
def generar_facturas(
    mes: int = Query(...),
    anio: int = Query(...),
    seller_ids: List[int] = ...,
    request: Request = None,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin_or_administracion),
):
    """
    Genera registros de factura mensual y emite vía Haulmer (OpenFactura) si está configurado.
    """
    semanas = _semanas_del_mes(db, mes, anio)
    creadas = 0
    errores = []
    usuario = current_user.get("nombre", current_user.get("username", "admin"))
    settings = get_settings()
    emitir_haulmer = bool(settings.HAULMER_API_KEY and settings.HAULMER_EMISOR_RUT)

    for sid in seller_ids:
        seller = db.get(Seller, sid)
        if not seller:
            errores.append(f"Seller ID {sid} no encontrado")
            continue

        existing = db.query(FacturaMensualSeller).filter(
            FacturaMensualSeller.seller_id == sid,
            FacturaMensualSeller.mes == mes,
            FacturaMensualSeller.anio == anio,
        ).first()
        if existing and existing.estado == EstadoFacturaEnum.EMITIDA.value:
            errores.append(f"{seller.nombre}: ya tiene factura emitida")
            continue

        subtotal = 0
        for sem in semanas:
            pago = db.query(PagoSemanaSeller).filter(
                PagoSemanaSeller.seller_id == sid,
                PagoSemanaSeller.semana == sem,
                PagoSemanaSeller.mes == mes,
                PagoSemanaSeller.anio == anio,
            ).first()

            if pago and pago.monto_override is not None:
                subtotal += pago.monto_override
            else:
                subtotal += _get_monto_semanal_seller(db, sid, sem, mes, anio)

        iva = int(subtotal * 0.19)

        if existing:
            existing.subtotal_neto = subtotal
            existing.iva = iva
            existing.total = subtotal + iva
            existing.estado = EstadoFacturaEnum.PENDIENTE.value
            factura_obj = existing
        else:
            factura_obj = FacturaMensualSeller(
                seller_id=sid, mes=mes, anio=anio,
                subtotal_neto=subtotal, iva=iva, total=subtotal + iva,
                emitida_por=usuario,
            )
            db.add(factura_obj)
            db.flush()

        creadas += 1

        # Emitir en Haulmer si está configurado y hay monto
        if emitir_haulmer and factura_obj.total > 0:
            rut_formateado = _fmt_rut(seller.rut)
            if not rut_formateado:
                errores.append(f"{seller.nombre}: RUT inválido o vacío ({seller.rut!r}), no se puede emitir factura electrónica")
            else:
                glosa = f"Servicios de transporte y logística - Mes {mes} {anio}"
                folio, resp, err = emitir_factura(
                    api_key=settings.HAULMER_API_KEY,
                    api_url=settings.HAULMER_API_URL,
                    emisor_rut=settings.HAULMER_EMISOR_RUT,
                    emisor_razon=settings.HAULMER_EMISOR_RAZON or "Emisor",
                    emisor_giro=settings.HAULMER_EMISOR_GIRO or GIRO_DEFAULT,
                    emisor_dir=settings.HAULMER_EMISOR_DIR or "Sin dirección",
                    emisor_cmna=settings.HAULMER_EMISOR_CMNA or "Sin comuna",
                    emisor_acteco=settings.HAULMER_EMISOR_ACTECO,
                    receptor_rut=seller.rut,
                    receptor_razon=seller.nombre,
                    receptor_giro=(seller.giro or "").strip() or settings.HAULMER_EMISOR_GIRO or GIRO_DEFAULT,
                    mnt_neto=factura_obj.subtotal_neto,
                    iva=factura_obj.iva,
                    mnt_total=factura_obj.total,
                    glosa_detalle=glosa,
                    idempotency_key=f"ecourier-{sid}-{mes}-{anio}",
                )
                if err:
                    errores.append(f"{seller.nombre}: {err}")
                else:
                    factura_obj.folio_haulmer = folio or (str(resp.get("FOLIO") or resp.get("folio") or "") if isinstance(resp, dict) else "")
                    factura_obj.estado = EstadoFacturaEnum.EMITIDA.value
                    factura_obj.emitida_en = datetime.now(timezone.utc)
                    if isinstance(resp, dict):
                        factura_obj.respuesta_api = {k: v for k, v in resp.items() if k in ("FOLIO", "folio", "RESOLUCION")}

    # Fase 4: marcar envíos de sellers facturados como is_facturado
    for sid in seller_ids:
        envios_seller = db.query(Envio).filter(
            Envio.seller_id == sid,
            Envio.mes == mes, Envio.anio == anio,
            Envio.is_facturado == False,
        ).all()
        for e in envios_seller:
            e.is_facturado = True
            e.sync_estado_financiero()

    audit(db, "generar_facturas", usuario=current_user, request=request, entidad="factura", metadata={"mes": mes, "anio": anio, "seller_ids": seller_ids})
    db.commit()
    return {"creadas": creadas, "errores": errores}


def _procesar_un_seller_factura(
    db: Session,
    sid: int,
    mes: int,
    anio: int,
    semanas: List[int],
    usuario: str,
    settings,
    emitir_haulmer: bool,
    forzar: bool = False,
) -> tuple[Optional[object], Optional[str], Optional[str], Optional[str], int]:
    """
    Procesa un seller: crea/actualiza factura y opcionalmente emite en Haulmer.
    Retorna (factura_obj, seller_nombre, error, advertencia, creadas_delta).
    - forzar=True permite re-facturar aunque ya esté EMITIDA (genera advertencia).
    """
    seller = db.get(Seller, sid)
    if not seller:
        return None, None, f"Seller ID {sid} no encontrado", None, 0

    existing = db.query(FacturaMensualSeller).filter(
        FacturaMensualSeller.seller_id == sid,
        FacturaMensualSeller.mes == mes,
        FacturaMensualSeller.anio == anio,
    ).first()

    advertencia = None
    if existing and existing.estado == EstadoFacturaEnum.EMITIDA.value:
        if not forzar:
            return None, seller.nombre, None, f"{seller.nombre}: ya tiene factura emitida (folio {existing.folio_haulmer or '—'})", 0
        advertencia = f"{seller.nombre}: ya tenía factura emitida (folio {existing.folio_haulmer or '—'}), se re-emite"

    subtotal = 0
    for sem in semanas:
        pago = db.query(PagoSemanaSeller).filter(
            PagoSemanaSeller.seller_id == sid,
            PagoSemanaSeller.semana == sem,
            PagoSemanaSeller.mes == mes,
            PagoSemanaSeller.anio == anio,
        ).first()
        if pago and pago.monto_override is not None:
            subtotal += pago.monto_override
        else:
            subtotal += _get_monto_semanal_seller(db, sid, sem, mes, anio)
    iva = int(subtotal * 0.19)

    if existing:
        existing.subtotal_neto = subtotal
        existing.iva = iva
        existing.total = subtotal + iva
        existing.estado = EstadoFacturaEnum.PENDIENTE.value
        factura_obj = existing
    else:
        factura_obj = FacturaMensualSeller(
            seller_id=sid, mes=mes, anio=anio,
            subtotal_neto=subtotal, iva=iva, total=subtotal + iva,
            emitida_por=usuario,
        )
        db.add(factura_obj)
        db.flush()

    creadas_delta = 1
    err_msg = None
    if emitir_haulmer and factura_obj.total > 0:
        rut_formateado = _fmt_rut(seller.rut)
        if not rut_formateado:
            err_msg = f"{seller.nombre}: RUT inválido o vacío ({seller.rut!r}), no se puede emitir factura electrónica"
        else:
            glosa = f"Servicios de transporte y logística - Mes {mes} {anio}"
            folio, resp, err = emitir_factura(
                api_key=settings.HAULMER_API_KEY,
                api_url=settings.HAULMER_API_URL,
                emisor_rut=settings.HAULMER_EMISOR_RUT,
                emisor_razon=settings.HAULMER_EMISOR_RAZON or "Emisor",
                emisor_giro=settings.HAULMER_EMISOR_GIRO or GIRO_DEFAULT,
                emisor_dir=settings.HAULMER_EMISOR_DIR or "Sin dirección",
                emisor_cmna=settings.HAULMER_EMISOR_CMNA or "Sin comuna",
                emisor_acteco=settings.HAULMER_EMISOR_ACTECO,
                receptor_rut=seller.rut,
                receptor_razon=seller.nombre,
                receptor_giro=(seller.giro or "").strip() or settings.HAULMER_EMISOR_GIRO or GIRO_DEFAULT,
                mnt_neto=factura_obj.subtotal_neto,
                iva=factura_obj.iva,
                mnt_total=factura_obj.total,
                glosa_detalle=glosa,
                idempotency_key=f"ecourier-{sid}-{mes}-{anio}",
            )
            if err:
                err_msg = f"{seller.nombre}: {err}"
            else:
                factura_obj.folio_haulmer = folio or (str(resp.get("FOLIO") or resp.get("folio") or "") if isinstance(resp, dict) else "")
                factura_obj.estado = EstadoFacturaEnum.EMITIDA.value
                factura_obj.emitida_en = datetime.now(timezone.utc)
                if isinstance(resp, dict):
                    factura_obj.respuesta_api = {k: v for k, v in resp.items() if k in ("FOLIO", "folio", "RESOLUCION")}
    return factura_obj, seller.nombre, err_msg, advertencia, creadas_delta


@router.post("/generar-facturas-stream")
def generar_facturas_stream(
    mes: int = Query(...),
    anio: int = Query(...),
    semana: Optional[int] = Query(None),
    forzar: bool = Query(False),
    seller_ids: List[int] = Body(..., embed=False),
    db: Session = Depends(get_db),
    current_user=Depends(require_admin_or_administracion),
):
    """
    Genera facturas y emite en Haulmer; retorna stream SSE con progreso.
    - semana: si se especifica, calcula solo esa semana (en lugar del mes completo).
    - forzar: si True, permite re-facturar sellers que ya tienen factura emitida.
    """
    def event_stream():
        try:
            if not seller_ids:
                yield f"event: done\ndata: {json.dumps({'creadas': 0, 'errores': [], 'advertencias': []})}\n\n"
                return
            todas_semanas = _semanas_del_mes(db, mes, anio)
            semanas = [semana] if semana and semana in todas_semanas else todas_semanas
            usuario = current_user.get("nombre", current_user.get("username", "admin"))
            settings = get_settings()
            emitir_haulmer = bool(settings.HAULMER_API_KEY and settings.HAULMER_EMISOR_RUT)
            total = len(seller_ids)
            creadas = 0
            errores = []
            advertencias = []
            for i, sid in enumerate(seller_ids):
                _, seller_nombre, err_msg, adv_msg, delta = _procesar_un_seller_factura(
                    db, sid, mes, anio, semanas, usuario, settings, emitir_haulmer, forzar=forzar,
                )
                creadas += delta
                if err_msg:
                    errores.append(err_msg)
                if adv_msg:
                    advertencias.append(adv_msg)
                yield f"event: progress\ndata: {json.dumps({'current': i + 1, 'total': total, 'seller_nombre': seller_nombre or '—'})}\n\n"
            # Fase 4: marcar envíos de sellers facturados
            for sid in seller_ids:
                for e in db.query(Envio).filter(
                    Envio.seller_id == sid, Envio.mes == mes, Envio.anio == anio, Envio.is_facturado == False,
                ).all():
                    e.is_facturado = True
                    e.sync_estado_financiero()
            db.commit()
            yield f"event: done\ndata: {json.dumps({'creadas': creadas, 'errores': errores, 'advertencias': advertencias})}\n\n"
        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'detail': str(e)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@router.get("/verificar-emitidas")
def verificar_emitidas(
    mes: int = Query(...),
    anio: int = Query(...),
    seller_ids: str = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """
    Verifica qué sellers de la lista ya tienen factura EMITIDA para el mes/año dado.
    seller_ids: lista separada por comas.
    Retorna lista de {seller_id, seller_nombre, folio_haulmer}.
    """
    ids = [int(x) for x in seller_ids.split(",") if x.strip().isdigit()]
    ya_emitidas = []
    for sid in ids:
        factura = db.query(FacturaMensualSeller).filter(
            FacturaMensualSeller.seller_id == sid,
            FacturaMensualSeller.mes == mes,
            FacturaMensualSeller.anio == anio,
            FacturaMensualSeller.estado == EstadoFacturaEnum.EMITIDA.value,
        ).first()
        if factura:
            seller = db.get(Seller, sid)
            ya_emitidas.append({
                "seller_id": sid,
                "seller_nombre": seller.nombre if seller else f"ID {sid}",
                "folio_haulmer": factura.folio_haulmer,
            })
    return ya_emitidas


@router.get("/historial")
def historial_facturas(
    desde_mes: Optional[int] = Query(None),
    desde_anio: Optional[int] = Query(None),
    hasta_mes: Optional[int] = Query(None),
    hasta_anio: Optional[int] = Query(None),
    seller_id: Optional[int] = Query(None),
    limite: int = Query(200, ge=1, le=500),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Lista facturas emitidas (historial). Sin filtros: últimos 12 meses."""
    q = db.query(FacturaMensualSeller).filter(FacturaMensualSeller.estado == EstadoFacturaEnum.EMITIDA.value)
    if seller_id is not None:
        q = q.filter(FacturaMensualSeller.seller_id == seller_id)
    if desde_anio is not None:
        q = q.filter(
            or_(
                FacturaMensualSeller.anio > desde_anio,
                (FacturaMensualSeller.anio == desde_anio) & (FacturaMensualSeller.mes >= (desde_mes or 1)),
            )
        )
    if hasta_anio is not None:
        q = q.filter(
            or_(
                FacturaMensualSeller.anio < hasta_anio,
                (FacturaMensualSeller.anio == hasta_anio) & (FacturaMensualSeller.mes <= (hasta_mes or 12)),
            )
        )
    if desde_anio is None and hasta_anio is None:
        from datetime import date
        hoy = date.today()
        d_anio = hoy.year - 1
        d_mes = hoy.month
        q = q.filter(
            or_(
                FacturaMensualSeller.anio > d_anio,
                (FacturaMensualSeller.anio == d_anio) & (FacturaMensualSeller.mes >= d_mes),
            )
        )
    rows = q.order_by(FacturaMensualSeller.anio.desc(), FacturaMensualSeller.mes.desc()).limit(limite).all()
    sids = {f.seller_id for f in rows}
    sellers_map = {s.id: s for s in db.query(Seller).filter(Seller.id.in_(sids)).all()} if sids else {}
    result = []
    for f in rows:
        seller = sellers_map.get(f.seller_id)
        result.append({
            "id": f.id,
            "seller_id": f.seller_id,
            "seller_nombre": seller.nombre if seller else "—",
            "mes": f.mes,
            "anio": f.anio,
            "total": f.total,
            "folio_haulmer": f.folio_haulmer,
            "emitida_en": f.emitida_en.isoformat() if f.emitida_en else None,
        })
    return result


# ---------------------------------------------------------------------------
# Helper: upsert PagoSemanaSeller con registro automático en PagoCartolaSeller
# ---------------------------------------------------------------------------

def _upsert_pago_semana_seller(
    db: Session,
    seller_id: int,
    semana: int,
    mes: int,
    anio: int,
    estado: str = None,
    nota: str = None,
    monto_override: int = None,
    fecha_pago: str = None,
):
    """Crea o actualiza PagoSemanaSeller.
    Si estado cambia a PAGADO → crea registro manual en PagoCartolaSeller.
    Si vuelve a PENDIENTE/INCOMPLETO → elimina el registro manual automático.
    """
    from datetime import date

    pago = db.query(PagoSemanaSeller).filter(
        PagoSemanaSeller.seller_id == seller_id,
        PagoSemanaSeller.semana == semana,
        PagoSemanaSeller.mes == mes,
        PagoSemanaSeller.anio == anio,
    ).first()
    estado_anterior = pago.estado if pago else None

    monto_sistema = _get_monto_semanal_seller(db, seller_id, semana, mes, anio)

    if not pago:
        pago = PagoSemanaSeller(
            seller_id=seller_id,
            semana=semana, mes=mes, anio=anio,
            monto_neto=monto_sistema,
        )
        db.add(pago)

    if estado is not None:
        pago.estado = estado
    if monto_override is not None:
        pago.monto_override = monto_override
    if nota is not None:
        pago.nota = nota
    if fecha_pago is not None:
        pago.fecha_pago = _parse_fecha(fecha_pago) if isinstance(fecha_pago, str) else fecha_pago
    elif estado == EstadoPagoEnum.PAGADO.value and not pago.fecha_pago:
        pago.fecha_pago = date.today()
    if estado in (EstadoPagoEnum.PENDIENTE.value, EstadoPagoEnum.INCOMPLETO.value):
        pago.fecha_pago = None
    pago.monto_neto = monto_sistema

    fecha_pago_str = (pago.fecha_pago.isoformat() if pago.fecha_pago else date.today().isoformat())

    # Gestión automática de PagoCartolaSeller
    if estado is not None and estado != estado_anterior:
        if estado == EstadoPagoEnum.PAGADO.value:
            existe_manual = db.query(PagoCartolaSeller).filter(
                PagoCartolaSeller.seller_id == seller_id,
                PagoCartolaSeller.semana == semana,
                PagoCartolaSeller.mes == mes,
                PagoCartolaSeller.anio == anio,
                PagoCartolaSeller.fuente == "manual",
            ).first()
            if not existe_manual:
                db.add(PagoCartolaSeller(
                    seller_id=seller_id,
                    semana=semana, mes=mes, anio=anio,
                    monto=monto_sistema,
                    fecha_pago=fecha_pago_str,
                    descripcion="Pago recibido manual por administrador",
                    fuente="manual",
                ))
        elif estado in (EstadoPagoEnum.PENDIENTE.value, EstadoPagoEnum.INCOMPLETO.value):
            db.query(PagoCartolaSeller).filter(
                PagoCartolaSeller.seller_id == seller_id,
                PagoCartolaSeller.semana == semana,
                PagoCartolaSeller.mes == mes,
                PagoCartolaSeller.anio == anio,
                PagoCartolaSeller.fuente == "manual",
                PagoCartolaSeller.descripcion == "Pago recibido manual por administrador",
            ).delete()

    return pago


# ---------------------------------------------------------------------------
# Endpoints: pagos acumulados por seller/semana (desde PagoCartolaSeller)
# ---------------------------------------------------------------------------

@router.get("/pagos-acumulados")
def pagos_acumulados_sellers(
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Suma de PagoCartolaSeller por seller y semana para el mes."""
    from sqlalchemy import func

    rows = db.query(
        PagoCartolaSeller.seller_id,
        PagoCartolaSeller.semana,
        func.sum(PagoCartolaSeller.monto).label("total"),
    ).filter(
        PagoCartolaSeller.mes == mes,
        PagoCartolaSeller.anio == anio,
    ).group_by(PagoCartolaSeller.seller_id, PagoCartolaSeller.semana).all()

    resultado = {}
    for r in rows:
        sid = str(r.seller_id)
        if sid not in resultado:
            resultado[sid] = {}
        resultado[sid][str(r.semana)] = r.total

    return resultado


# ---------------------------------------------------------------------------
# Endpoints: cartola seller (preview + confirmar)
# ---------------------------------------------------------------------------

def _parsear_cartola_seller(archivo_bytes: bytes) -> list:
    """
    Lee cartola Banco de Chile y retorna abonos recibidos ('Traspaso De:').
    """
    import io
    import pandas as pd

    try:
        df = pd.read_excel(io.BytesIO(archivo_bytes), header=None)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"No se pudo leer el archivo: {exc}")

    header_row = None
    for i, row in df.iterrows():
        vals = [str(v).strip().lower() for v in row.values]
        if any("fecha" in v for v in vals) and any("abono" in v for v in vals):
            header_row = i
            break
    # Fallback: buscar también con "cargos" (misma fila tiene ambas columnas)
    if header_row is None:
        for i, row in df.iterrows():
            vals = [str(v).strip().lower() for v in row.values]
            if any("fecha" in v for v in vals) and any("cargos" in v for v in vals):
                header_row = i
                break

    if header_row is None:
        raise HTTPException(status_code=400, detail="No se encontró encabezado de movimientos en la cartola.")

    header_vals = [str(df.iloc[header_row, c]).strip().lower() for c in range(df.shape[1])]
    idx_fecha  = next((i for i, v in enumerate(header_vals) if "fecha" in v), None)
    idx_desc   = next((i for i, v in enumerate(header_vals) if "descripci" in v), None)
    idx_abonos = next((i for i, v in enumerate(header_vals) if "abono" in v), None)

    if idx_abonos is None:
        raise HTTPException(status_code=400, detail="No se encontró columna de Abonos en la cartola.")

    movimientos = []
    for i in range(header_row + 1, len(df)):
        row = df.iloc[i]
        monto_raw = row.iloc[idx_abonos] if idx_abonos < len(row) else None
        try:
            monto = int(float(str(monto_raw).replace(".", "").replace(",", ".")))
        except Exception:
            continue
        if monto <= 0:
            continue

        desc = str(row.iloc[idx_desc]).strip() if idx_desc is not None else ""
        if not desc or desc.lower() in ("nan", ""):
            continue

        desc_lower = desc.lower()
        if not any(desc_lower.startswith(p) for p in [
            "traspaso de:", "app-traspaso de:", "transferencia de:", "app-transferencia de:"
        ]):
            continue

        fecha = str(row.iloc[idx_fecha]).strip() if idx_fecha is not None else ""
        nombre = desc
        for prefijo in ["traspaso de:", "app-traspaso de:", "transferencia de:", "app-transferencia de:"]:
            if desc_lower.startswith(prefijo):
                nombre = desc[len(prefijo):].strip()
                break

        movimientos.append({
            "fecha": fecha,
            "descripcion": desc,
            "nombre_extraido": nombre,
            "monto": monto,
        })

    return movimientos


def _similaridad_seller(a: str, b: str) -> float:
    from difflib import SequenceMatcher
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


@router.post("/cartola/preview")
async def cartola_seller_preview(
    semana: int = Query(...),
    mes: int = Query(...),
    anio: int = Query(...),
    archivo: UploadFile = File(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Parsea cartola bancaria y retorna preview de abonos recibidos de sellers."""
    contenido = await archivo.read()
    movimientos = _parsear_cartola_seller(contenido)

    sellers = db.query(Seller).filter(Seller.activo == True).all()

    cobrados_existentes: dict[int, int] = {}
    for p in db.query(PagoCartolaSeller).filter(
        PagoCartolaSeller.semana == semana,
        PagoCartolaSeller.mes == mes,
        PagoCartolaSeller.anio == anio,
    ).all():
        cobrados_existentes[p.seller_id] = cobrados_existentes.get(p.seller_id, 0) + p.monto

    resultado = []
    for mov in movimientos:
        nombre_norm = mov["nombre_extraido"].lower()
        mejor_seller = None
        mejor_score = 0.0

        for s in sellers:
            score = _similaridad_seller(nombre_norm, s.nombre.lower())
            for alias in (s.aliases or []):
                sc = _similaridad_seller(nombre_norm, alias.lower())
                if sc > score:
                    score = sc
            if score > mejor_score:
                mejor_score = score
                mejor_seller = s

        match_confiable = mejor_score >= 0.55
        ya_cobrado = cobrados_existentes.get(mejor_seller.id, 0) if mejor_seller else 0
        liquidado = _get_monto_semanal_seller(db, mejor_seller.id, semana, mes, anio) if mejor_seller else 0

        resultado.append({
            "descripcion": mov["descripcion"],
            "nombre_extraido": mov["nombre_extraido"],
            "fecha": mov["fecha"],
            "monto": mov["monto"],
            "seller_id": mejor_seller.id if mejor_seller else None,
            "seller_nombre": mejor_seller.nombre if mejor_seller else None,
            "score": round(mejor_score, 2),
            "match_confiable": match_confiable,
            "ya_cobrado": ya_cobrado,
            "liquidado": liquidado,
        })

    todos_sellers = [{"id": s.id, "nombre": s.nombre} for s in sorted(sellers, key=lambda x: x.nombre)]
    return {"semana": semana, "mes": mes, "anio": anio, "items": resultado, "sellers": todos_sellers}


class ItemConfirmarCartolaSeller(BaseModel):
    seller_id: int
    monto: int
    semana: int
    fecha: Optional[str] = None
    descripcion: Optional[str] = None
    nombre_extraido: Optional[str] = None


class ConfirmarCartolaSellerRequest(BaseModel):
    semana: int
    mes: int
    anio: int
    items: List[ItemConfirmarCartolaSeller]


@router.post("/cartola/confirmar")
def cartola_seller_confirmar(
    body: ConfirmarCartolaSellerRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin_or_administracion),
):
    """Graba pagos recibidos de sellers desde cartola. Cada item puede tener su propia semana."""

    carga = CartolaCarga(
        tipo="seller", archivo_nombre="cartola_bancaria",
        usuario_id=current_user.get("id"), usuario_nombre=current_user.get("nombre"),
        mes=body.mes, anio=body.anio,
        total_transacciones=len(body.items),
        matcheadas=len(body.items), no_matcheadas=0,
        monto_total=sum(it.monto for it in body.items),
    )
    db.add(carga)
    db.flush()

    grabados = 0
    alias_guardados = set()
    for item in body.items:
        if item.seller_id <= 0 or item.monto <= 0:
            continue
        db.add(PagoCartolaSeller(
            seller_id=item.seller_id,
            semana=item.semana,
            mes=body.mes,
            anio=body.anio,
            monto=item.monto,
            fecha_pago=item.fecha,
            descripcion=item.descripcion,
            fuente="cartola",
            carga_id=carga.id,
        ))
        grabados += 1

        # Propagar estado PAGADO y fecha_pago al PagoSemanaSeller
        from app.models import PagoSemanaSeller
        pago_sem = db.query(PagoSemanaSeller).filter(
            PagoSemanaSeller.seller_id == item.seller_id,
            PagoSemanaSeller.semana == item.semana,
            PagoSemanaSeller.mes == body.mes,
            PagoSemanaSeller.anio == body.anio,
        ).first()
        if not pago_sem:
            monto_sistema = _get_monto_semanal_seller(db, item.seller_id, item.semana, body.mes, body.anio)
            pago_sem = PagoSemanaSeller(
                seller_id=item.seller_id, semana=item.semana,
                mes=body.mes, anio=body.anio, monto_neto=monto_sistema,
            )
            db.add(pago_sem)
        pago_sem.estado = EstadoPagoEnum.PAGADO.value
        if item.fecha:
            pago_sem.fecha_pago = _parse_fecha(item.fecha) if isinstance(item.fecha, str) else item.fecha
        elif not pago_sem.fecha_pago:
            pago_sem.fecha_pago = _date_type.today()

        if item.nombre_extraido and item.seller_id not in alias_guardados:
            seller = db.get(Seller, item.seller_id)
            if seller:
                alias_nuevo = item.nombre_extraido.strip()
                aliases_actuales = [a.lower() for a in (seller.aliases or [])]
                if alias_nuevo.lower() != seller.nombre.lower() and alias_nuevo.lower() not in aliases_actuales:
                    seller.aliases = list(seller.aliases or []) + [alias_nuevo]
                    alias_guardados.add(item.seller_id)

    db.flush()
    for pago_s in db.query(PagoCartolaSeller).filter(PagoCartolaSeller.carga_id == carga.id).all():
        asiento_cobro_seller(db, pago_s)

    audit(db, "carga_cartola_seller", usuario=current_user, request=request, entidad="cartola_carga", entidad_id=carga.id, metadata={"mes": body.mes, "anio": body.anio, "transacciones": len(body.items), "monto_total": sum(it.monto for it in body.items)})
    db.commit()
    return {"ok": True, "grabados": grabados}
