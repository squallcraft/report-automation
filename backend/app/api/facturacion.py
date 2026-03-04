"""
API de Facturación: control semanal de cobros a sellers y factura mensual.
"""
import json
from typing import Optional, List
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Body
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.database import get_db
from app.config import get_settings
from app.auth import require_admin_or_administracion
from app.models import (
    Seller, Envio, AjusteLiquidacion,
    PagoSemanaSeller, FacturaMensualSeller,
    CalendarioSemanas, TipoEntidadEnum,
    EstadoPagoEnum, EstadoFacturaEnum,
)
from app.services.liquidacion import calcular_liquidacion_sellers
from app.services.haulmer import emitir_factura, _formatear_rut as _fmt_rut

router = APIRouter(prefix="/facturacion", tags=["Facturación"])

GIRO_DEFAULT = "Servicios de transporte y logística"


class PagoSemanaUpdate(BaseModel):
    estado: Optional[str] = None
    monto_override: Optional[int] = None
    nota: Optional[str] = None


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

    total_envios = sum(e.cobro_seller + e.cobro_extra_manual for e in envios)
    total_extras_producto = sum(e.extra_producto_seller for e in envios)
    total_extras_comuna = sum(e.extra_comuna_seller for e in envios)

    ajustes = db.query(AjusteLiquidacion).filter(
        AjusteLiquidacion.tipo == TipoEntidadEnum.SELLER,
        AjusteLiquidacion.entidad_id == seller_id,
        AjusteLiquidacion.semana == semana,
        AjusteLiquidacion.mes == mes,
        AjusteLiquidacion.anio == anio,
    ).all()
    total_ajustes = sum(a.monto for a in ajustes)

    return total_envios + total_extras_producto + total_extras_comuna + total_ajustes


@router.get("/tabla")
def tabla_facturacion(
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """
    Retorna la tabla mensual de facturación:
    una fila por seller con su monto neto por semana, subtotal y total+IVA.
    """
    semanas = _semanas_del_mes(db, mes, anio)
    sellers = db.query(Seller).filter(Seller.activo == True).order_by(Seller.nombre).all()

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
            pago = db.query(PagoSemanaSeller).filter(
                PagoSemanaSeller.seller_id == seller.id,
                PagoSemanaSeller.semana == sem,
                PagoSemanaSeller.mes == mes,
                PagoSemanaSeller.anio == anio,
            ).first()

            if pago and pago.monto_override is not None:
                monto = pago.monto_override
            else:
                monto = _get_monto_semanal_seller(db, seller.id, sem, mes, anio)

            estado = pago.estado if pago else EstadoPagoEnum.PENDIENTE.value
            editable = pago.monto_override is not None if pago else False

            # Feb 2026 semanas 1-3 → editable
            is_feb_override = (mes == 2 and anio == 2026 and sem <= 3)

            row["semanas"][str(sem)] = {
                "monto_neto": monto,
                "estado": estado,
                "editable": editable or is_feb_override,
                "nota": pago.nota if pago else None,
            }
            subtotal += monto

        row["subtotal_neto"] = subtotal
        row["iva"] = int(subtotal * 0.19)
        row["total_con_iva"] = subtotal + row["iva"]

        # Factura mensual si existe
        factura = db.query(FacturaMensualSeller).filter(
            FacturaMensualSeller.seller_id == seller.id,
            FacturaMensualSeller.mes == mes,
            FacturaMensualSeller.anio == anio,
        ).first()
        row["factura_estado"] = factura.estado if factura else None
        row["factura_folio"] = factura.folio_haulmer if factura else None

        # Incluir si: tiene monto, tiene factura emitida, o tiene al menos un envío en el mes (para no ocultar clientes con data)
        tiene_envios_mes = db.query(Envio).filter(
            Envio.seller_id == seller.id,
            Envio.mes == mes,
            Envio.anio == anio,
        ).first() is not None
        if subtotal > 0 or (factura and factura.estado != EstadoFacturaEnum.PENDIENTE.value) or tiene_envios_mes:
            result.append(row)

    return {"semanas_disponibles": semanas, "sellers": result}


@router.put("/pago-semana/{seller_id}")
def actualizar_pago_semana(
    seller_id: int,
    semana: int = Query(...),
    mes: int = Query(...),
    anio: int = Query(...),
    body: PagoSemanaUpdate = ...,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Actualiza estado y/o monto override de una semana para un seller."""
    seller = db.get(Seller, seller_id)
    if not seller:
        raise HTTPException(status_code=404, detail="Seller no encontrado")

    pago = db.query(PagoSemanaSeller).filter(
        PagoSemanaSeller.seller_id == seller_id,
        PagoSemanaSeller.semana == semana,
        PagoSemanaSeller.mes == mes,
        PagoSemanaSeller.anio == anio,
    ).first()

    monto_sistema = _get_monto_semanal_seller(db, seller_id, semana, mes, anio)

    if not pago:
        pago = PagoSemanaSeller(
            seller_id=seller_id,
            semana=semana, mes=mes, anio=anio,
            monto_neto=monto_sistema,
        )
        db.add(pago)

    if body.estado is not None:
        pago.estado = body.estado
    if body.monto_override is not None:
        pago.monto_override = body.monto_override
    if body.nota is not None:
        pago.nota = body.nota
    pago.monto_neto = monto_sistema

    db.commit()
    return {"ok": True, "monto_neto": pago.monto_override if pago.monto_override is not None else monto_sistema}


@router.put("/pago-semana-batch")
def actualizar_pagos_batch(
    mes: int = Query(...),
    anio: int = Query(...),
    body: List[dict] = ...,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Actualiza múltiples pagos semanales. Body: [{seller_id, semana, monto_override?, estado?}, ...]"""
    updated = 0
    for item in body:
        seller_id = item.get("seller_id")
        semana = item.get("semana")
        if not seller_id or not semana:
            continue

        pago = db.query(PagoSemanaSeller).filter(
            PagoSemanaSeller.seller_id == seller_id,
            PagoSemanaSeller.semana == semana,
            PagoSemanaSeller.mes == mes,
            PagoSemanaSeller.anio == anio,
        ).first()

        monto_sistema = _get_monto_semanal_seller(db, seller_id, semana, mes, anio)

        if not pago:
            pago = PagoSemanaSeller(
                seller_id=seller_id,
                semana=semana, mes=mes, anio=anio,
                monto_neto=monto_sistema,
            )
            db.add(pago)

        if "monto_override" in item:
            pago.monto_override = item["monto_override"]
        if "estado" in item:
            pago.estado = item["estado"]
        if "nota" in item:
            pago.nota = item["nota"]
        pago.monto_neto = monto_sistema
        updated += 1

    db.commit()
    return {"ok": True, "updated": updated}


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
    result = []
    for f in facturas:
        seller = db.get(Seller, f.seller_id)
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
    result = []
    for f in rows:
        seller = db.get(Seller, f.seller_id)
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
