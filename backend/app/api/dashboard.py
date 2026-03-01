from typing import Optional
from collections import defaultdict

from datetime import datetime, date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc, distinct

from app.database import get_db
from app.auth import require_admin_or_administracion
from app.models import (
    Seller, Driver, Envio, Retiro, ConsultaPortal, EstadoConsultaEnum,
)
from app.schemas import DashboardStats

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("/stats", response_model=DashboardStats)
def obtener_stats(
    semana: Optional[int] = None,
    mes: Optional[int] = None,
    anio: Optional[int] = None,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    hoy = date.today()
    mes = mes or hoy.month
    anio = anio or hoy.year

    base_filter = [Envio.mes == mes, Envio.anio == anio]
    if semana is not None:
        base_filter.append(Envio.semana == semana)

    total_sellers = db.query(sqlfunc.count(distinct(Envio.seller_id))).filter(
        *base_filter, Envio.seller_id.isnot(None)
    ).scalar() or 0

    total_drivers = db.query(sqlfunc.count(distinct(Envio.driver_id))).filter(
        *base_filter, Envio.driver_id.isnot(None)
    ).scalar() or 0

    total_envios_mes = db.query(Envio).filter(*base_filter).count()

    total_cobrado = db.query(sqlfunc.coalesce(sqlfunc.sum(
        Envio.cobro_seller + Envio.extra_producto_seller + Envio.extra_comuna_seller
    ), 0)).filter(*base_filter).scalar()

    total_pagado = db.query(sqlfunc.coalesce(sqlfunc.sum(
        Envio.costo_driver + Envio.extra_producto_driver + Envio.extra_comuna_driver
    ), 0)).filter(*base_filter).scalar()

    envios_sin_homologar = db.query(Envio).filter(Envio.homologado == False).count()

    consultas_pendientes = db.query(ConsultaPortal).filter(
        ConsultaPortal.estado == EstadoConsultaEnum.PENDIENTE
    ).count()

    return DashboardStats(
        total_sellers=total_sellers,
        total_drivers=total_drivers,
        total_envios_mes=total_envios_mes,
        total_cobrado_mes=int(total_cobrado),
        total_pagado_mes=int(total_pagado),
        margen_mes=int(total_cobrado) - int(total_pagado),
        envios_sin_homologar=envios_sin_homologar,
        consultas_pendientes=consultas_pendientes,
    )


def _empty_row():
    return {
        "ingreso_paquete": 0,
        "paquetes_totales": 0,
        "ingreso_bulto_extra": 0,
        "ingreso_peso_extra": 0,
        "ingreso_retiro": 0,
        "costo_paquete_driver": 0,
        "costo_comuna": 0,
        "costo_bulto_extra_driver": 0,
        "costo_retiro_driver": 0,
    }


@router.get("/resumen-financiero")
def resumen_financiero(
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    envio_rows = db.query(
        Envio.semana,
        sqlfunc.sum(Envio.cobro_seller).label("ingreso_paquete"),
        sqlfunc.count(Envio.id).label("paquetes_totales"),
        sqlfunc.sum(Envio.extra_producto_seller).label("ingreso_bulto_extra"),
        sqlfunc.sum(Envio.extra_comuna_seller).label("ingreso_peso_extra"),
        sqlfunc.sum(Envio.costo_driver).label("costo_paquete_driver"),
        sqlfunc.sum(Envio.extra_comuna_driver).label("costo_comuna"),
        sqlfunc.sum(Envio.extra_producto_driver).label("costo_bulto_extra_driver"),
    ).filter(
        Envio.mes == mes, Envio.anio == anio,
    ).group_by(Envio.semana).all()

    retiro_rows = db.query(
        Retiro.semana,
        sqlfunc.sum(Retiro.tarifa_seller).label("ingreso_retiro"),
        sqlfunc.sum(Retiro.tarifa_driver).label("costo_retiro_driver"),
    ).filter(
        Retiro.mes == mes, Retiro.anio == anio,
    ).group_by(Retiro.semana).all()

    semanas = {}
    for r in envio_rows:
        s = _empty_row()
        s["ingreso_paquete"] = int(r.ingreso_paquete or 0)
        s["paquetes_totales"] = int(r.paquetes_totales or 0)
        s["ingreso_bulto_extra"] = int(r.ingreso_bulto_extra or 0)
        s["ingreso_peso_extra"] = int(r.ingreso_peso_extra or 0)
        s["costo_paquete_driver"] = int(r.costo_paquete_driver or 0)
        s["costo_comuna"] = int(r.costo_comuna or 0)
        s["costo_bulto_extra_driver"] = int(r.costo_bulto_extra_driver or 0)
        semanas[r.semana] = s

    for r in retiro_rows:
        if r.semana not in semanas:
            semanas[r.semana] = _empty_row()
        semanas[r.semana]["ingreso_retiro"] = int(r.ingreso_retiro or 0)
        semanas[r.semana]["costo_retiro_driver"] = int(r.costo_retiro_driver or 0)

    for w in range(1, 6):
        if w not in semanas:
            semanas[w] = _empty_row()

    subtotal = _empty_row()
    for s in semanas.values():
        for k in subtotal:
            subtotal[k] += s[k]

    return {"semanas": semanas, "subtotal": subtotal}
