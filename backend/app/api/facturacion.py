"""
API de Facturación: control semanal de cobros a sellers y factura mensual.
"""
from typing import Optional, List
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import require_admin_or_administracion
from app.models import (
    Seller, Envio, Retiro, AjusteLiquidacion,
    PagoSemanaSeller, FacturaMensualSeller,
    CalendarioSemanas, TipoEntidadEnum,
    EstadoPagoEnum, EstadoFacturaEnum,
)
from app.services.liquidacion import calcular_liquidacion_sellers

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

    seller = db.get(Seller, seller_id)
    total_envios = sum(e.cobro_seller + e.cobro_extra_manual for e in envios)
    total_extras_producto = sum(e.extra_producto_seller for e in envios)
    total_extras_comuna = sum(e.extra_comuna_seller for e in envios)

    total_retiros = 0
    if seller and seller.tiene_retiro and not seller.usa_pickup:
        if not (seller.min_paquetes_retiro_gratis > 0 and len(envios) >= seller.min_paquetes_retiro_gratis):
            retiros = db.query(Retiro).filter(
                Retiro.seller_id == seller_id,
                Retiro.semana == semana, Retiro.mes == mes, Retiro.anio == anio,
            ).all()
            total_retiros = sum(r.tarifa_seller for r in retiros)

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

        # Solo incluir sellers que tengan al menos un monto > 0
        if subtotal > 0 or (factura and factura.estado != EstadoFacturaEnum.PENDIENTE.value):
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
    Genera registros de factura mensual para los sellers seleccionados.
    Consolida las semanas del mes. No emite vía Haulmer aún (solo prepara).
    """
    semanas = _semanas_del_mes(db, mes, anio)
    creadas = 0
    errores = []
    usuario = current_user.get("nombre", current_user.get("username", "admin"))

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
        else:
            factura = FacturaMensualSeller(
                seller_id=sid, mes=mes, anio=anio,
                subtotal_neto=subtotal, iva=iva, total=subtotal + iva,
                emitida_por=usuario,
            )
            db.add(factura)
        creadas += 1

    db.commit()
    return {"creadas": creadas, "errores": errores}
