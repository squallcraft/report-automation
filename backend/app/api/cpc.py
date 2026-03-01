"""
API CPC (Control de Pagos a Conductores): control semanal de egresos a drivers.
"""
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import require_admin_or_administracion
from app.models import (
    Driver, Envio, Retiro, AjusteLiquidacion,
    PagoSemanaDriver, CalendarioSemanas,
    TipoEntidadEnum, EstadoPagoEnum,
)

router = APIRouter(prefix="/cpc", tags=["CPC"])


class PagoDriverUpdate(BaseModel):
    estado: Optional[str] = None
    monto_override: Optional[int] = None
    nota: Optional[str] = None


def _semanas_del_mes(db: Session, mes: int, anio: int) -> List[int]:
    rows = db.query(CalendarioSemanas.semana).filter(
        CalendarioSemanas.mes == mes,
        CalendarioSemanas.anio == anio,
    ).order_by(CalendarioSemanas.semana).all()
    if rows:
        return [r[0] for r in rows]
    return [1, 2, 3, 4, 5]


def _get_monto_semanal_driver(db: Session, driver_id: int, semana: int, mes: int, anio: int) -> int:
    """Subtotal neto semanal para un driver (coincide con liquidación)."""
    envios = db.query(Envio).filter(
        Envio.driver_id == driver_id,
        Envio.semana == semana,
        Envio.mes == mes,
        Envio.anio == anio,
    ).all()
    if not envios:
        return 0

    total_envios = sum(e.costo_driver + e.pago_extra_manual for e in envios)
    total_extras_producto = sum(e.extra_producto_driver for e in envios)
    total_extras_comuna = sum(e.extra_comuna_driver for e in envios)

    retiros = db.query(Retiro).filter(
        Retiro.driver_id == driver_id,
        Retiro.semana == semana, Retiro.mes == mes, Retiro.anio == anio,
    ).all()
    total_retiros = sum(r.tarifa_driver for r in retiros)

    ajustes = db.query(AjusteLiquidacion).filter(
        AjusteLiquidacion.tipo == TipoEntidadEnum.DRIVER,
        AjusteLiquidacion.entidad_id == driver_id,
        AjusteLiquidacion.semana == semana,
        AjusteLiquidacion.mes == mes,
        AjusteLiquidacion.anio == anio,
    ).all()
    total_ajustes = sum(a.monto for a in ajustes)

    return total_envios + total_extras_producto + total_extras_comuna + total_retiros + total_ajustes


@router.get("/tabla")
def tabla_cpc(
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Tabla mensual CPC: una fila por driver con monto neto por semana."""
    semanas = _semanas_del_mes(db, mes, anio)
    drivers = db.query(Driver).filter(Driver.activo == True).order_by(Driver.nombre).all()

    result = []
    for driver in drivers:
        row = {
            "driver_id": driver.id,
            "driver_nombre": driver.nombre,
            "rut": driver.rut,
            "banco": driver.banco,
            "tipo_cuenta": driver.tipo_cuenta,
            "numero_cuenta": driver.numero_cuenta,
            "semanas": {},
        }

        subtotal = 0
        for sem in semanas:
            pago = db.query(PagoSemanaDriver).filter(
                PagoSemanaDriver.driver_id == driver.id,
                PagoSemanaDriver.semana == sem,
                PagoSemanaDriver.mes == mes,
                PagoSemanaDriver.anio == anio,
            ).first()

            if pago and pago.monto_override is not None:
                monto = pago.monto_override
            else:
                monto = _get_monto_semanal_driver(db, driver.id, sem, mes, anio)

            estado = pago.estado if pago else EstadoPagoEnum.PENDIENTE.value

            row["semanas"][str(sem)] = {
                "monto_neto": monto,
                "estado": estado,
                "nota": pago.nota if pago else None,
            }
            subtotal += monto

        row["subtotal_neto"] = subtotal

        if subtotal > 0:
            result.append(row)

    return {"semanas_disponibles": semanas, "drivers": result}


@router.put("/pago-semana/{driver_id}")
def actualizar_pago_semana_driver(
    driver_id: int,
    semana: int = Query(...),
    mes: int = Query(...),
    anio: int = Query(...),
    body: PagoDriverUpdate = ...,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    driver = db.get(Driver, driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver no encontrado")

    pago = db.query(PagoSemanaDriver).filter(
        PagoSemanaDriver.driver_id == driver_id,
        PagoSemanaDriver.semana == semana,
        PagoSemanaDriver.mes == mes,
        PagoSemanaDriver.anio == anio,
    ).first()

    monto_sistema = _get_monto_semanal_driver(db, driver_id, semana, mes, anio)

    if not pago:
        pago = PagoSemanaDriver(
            driver_id=driver_id,
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
    return {"ok": True}


@router.put("/pago-semana-batch")
def actualizar_pagos_batch_driver(
    mes: int = Query(...),
    anio: int = Query(...),
    body: List[dict] = ...,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Batch update: [{driver_id, semana, estado?, monto_override?, nota?}, ...]"""
    updated = 0
    for item in body:
        driver_id = item.get("driver_id")
        semana = item.get("semana")
        if not driver_id or not semana:
            continue

        pago = db.query(PagoSemanaDriver).filter(
            PagoSemanaDriver.driver_id == driver_id,
            PagoSemanaDriver.semana == semana,
            PagoSemanaDriver.mes == mes,
            PagoSemanaDriver.anio == anio,
        ).first()

        monto_sistema = _get_monto_semanal_driver(db, driver_id, semana, mes, anio)

        if not pago:
            pago = PagoSemanaDriver(
                driver_id=driver_id,
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
