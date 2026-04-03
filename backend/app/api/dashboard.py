from typing import Optional
from collections import defaultdict

from datetime import datetime, date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc, distinct, case

from app.database import get_db
from app.auth import require_admin_or_administracion
from app.models import (
    Seller, Driver, Envio, Retiro, ConsultaPortal, EstadoConsultaEnum,
    PagoSemanaDriver, PagoCartola, EstadoPagoEnum, RecepcionPaquete,
    MovimientoFinanciero, CategoriaFinanciera, Trabajador,
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
        Envio.cobro_seller + Envio.extra_producto_seller + Envio.extra_comuna_seller + Envio.cobro_extra_manual
    ), 0)).filter(*base_filter).scalar()

    # Total pagado = suma real de pagos a drivers registrados (cartola + manual)
    total_pagado = db.query(sqlfunc.coalesce(sqlfunc.sum(PagoCartola.monto), 0)).filter(
        PagoCartola.mes == mes,
        PagoCartola.anio == anio,
    ).scalar()

    # Costo calculado (liquidado) — usado para el margen
    costo_calculado = db.query(sqlfunc.coalesce(sqlfunc.sum(
        Envio.costo_driver + Envio.extra_producto_driver + Envio.extra_comuna_driver + Envio.pago_extra_manual
    ), 0)).filter(*base_filter).scalar()

    envios_sin_homologar = db.query(Envio).filter(Envio.homologado == False).count()

    consultas_pendientes = db.query(ConsultaPortal).filter(
        ConsultaPortal.estado == EstadoConsultaEnum.PENDIENTE
    ).count()

    total_gastos_op = db.query(sqlfunc.coalesce(sqlfunc.sum(MovimientoFinanciero.monto), 0)).join(
        CategoriaFinanciera
    ).filter(
        MovimientoFinanciero.mes == mes,
        MovimientoFinanciero.anio == anio,
        CategoriaFinanciera.tipo == "EGRESO",
    ).scalar()

    margen_bruto = int(total_cobrado) - int(costo_calculado)

    # ── Sueldos: suma de sueldo_bruto de trabajadores activos (proyección mensual) ──
    total_sueldos = db.query(sqlfunc.coalesce(sqlfunc.sum(Trabajador.sueldo_bruto), 0)).filter(
        Trabajador.activo == True
    ).scalar()

    # ── Imposiciones: suma costo_afp + costo_salud de trabajadores activos ──
    total_imposiciones_row = db.query(
        sqlfunc.coalesce(sqlfunc.sum(Trabajador.costo_afp), 0),
        sqlfunc.coalesce(sqlfunc.sum(Trabajador.costo_salud), 0),
    ).filter(Trabajador.activo == True).first()
    total_imposiciones = int(total_imposiciones_row[0]) + int(total_imposiciones_row[1])

    # ── Impuestos: MovimientoFinanciero donde categoría = "Impuestos" ──
    total_impuestos = db.query(sqlfunc.coalesce(sqlfunc.sum(MovimientoFinanciero.monto), 0)).join(
        CategoriaFinanciera
    ).filter(
        MovimientoFinanciero.mes == mes,
        MovimientoFinanciero.anio == anio,
        CategoriaFinanciera.nombre == "Impuestos",
        CategoriaFinanciera.tipo == "EGRESO",
    ).scalar()

    return DashboardStats(
        total_sellers=total_sellers,
        total_drivers=total_drivers,
        total_envios_mes=total_envios_mes,
        total_cobrado_mes=int(total_cobrado),
        total_pagado_mes=int(total_pagado),
        margen_mes=margen_bruto,
        envios_sin_homologar=envios_sin_homologar,
        consultas_pendientes=consultas_pendientes,
        total_gastos_operacionales=int(total_gastos_op),
        margen_neto=margen_bruto - int(total_gastos_op),
        total_sueldos_mes=int(total_sueldos),
        total_imposiciones_mes=int(total_imposiciones),
        total_impuestos_mes=int(total_impuestos),
    )


def _empty_row():
    return {
        "ingreso_paquete": 0,
        "paquetes_totales": 0,
        "ingreso_bulto_extra": 0,
        "ingreso_peso_extra": 0,
        "ingreso_extra_manual": 0,
        "ingreso_retiro": 0,
        "costo_paquete_driver": 0,
        "costo_comuna": 0,
        "costo_bulto_extra_driver": 0,
        "costo_extra_manual_driver": 0,
        "costo_retiro_driver": 0,
        "costo_comision_pickup": 0,
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
        sqlfunc.sum(Envio.cobro_extra_manual).label("ingreso_extra_manual"),
        sqlfunc.sum(Envio.costo_driver).label("costo_paquete_driver"),
        sqlfunc.sum(Envio.extra_comuna_driver).label("costo_comuna"),
        sqlfunc.sum(Envio.extra_producto_driver).label("costo_bulto_extra_driver"),
        sqlfunc.sum(Envio.pago_extra_manual).label("costo_extra_manual_driver"),
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
        s["ingreso_extra_manual"] = int(r.ingreso_extra_manual or 0)
        s["costo_paquete_driver"] = int(r.costo_paquete_driver or 0)
        s["costo_comuna"] = int(r.costo_comuna or 0)
        s["costo_bulto_extra_driver"] = int(r.costo_bulto_extra_driver or 0)
        s["costo_extra_manual_driver"] = int(r.costo_extra_manual_driver or 0)
        semanas[r.semana] = s

    for r in retiro_rows:
        if r.semana not in semanas:
            semanas[r.semana] = _empty_row()
        semanas[r.semana]["ingreso_retiro"] = int(r.ingreso_retiro or 0)
        semanas[r.semana]["costo_retiro_driver"] = int(r.costo_retiro_driver or 0)

    pickup_rows = db.query(
        RecepcionPaquete.semana,
        sqlfunc.sum(RecepcionPaquete.comision).label("costo_comision_pickup"),
    ).filter(
        RecepcionPaquete.mes == mes, RecepcionPaquete.anio == anio,
        RecepcionPaquete.pickup_id.isnot(None),
    ).group_by(RecepcionPaquete.semana).all()

    for r in pickup_rows:
        if r.semana not in semanas:
            semanas[r.semana] = _empty_row()
        semanas[r.semana]["costo_comision_pickup"] = int(r.costo_comision_pickup or 0)

    for w in range(1, 6):
        if w not in semanas:
            semanas[w] = _empty_row()

    subtotal = _empty_row()
    for s in semanas.values():
        for k in subtotal:
            subtotal[k] += s[k]

    return {"semanas": semanas, "subtotal": subtotal}


@router.get("/resumen-anual")
def resumen_anual(
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Resumen financiero anual: mismas métricas que resumen-financiero pero agrupadas por mes."""
    envio_rows = db.query(
        Envio.mes,
        sqlfunc.sum(Envio.cobro_seller).label("ingreso_paquete"),
        sqlfunc.count(Envio.id).label("paquetes_totales"),
        sqlfunc.sum(Envio.extra_producto_seller).label("ingreso_bulto_extra"),
        sqlfunc.sum(Envio.extra_comuna_seller).label("ingreso_peso_extra"),
        sqlfunc.sum(Envio.cobro_extra_manual).label("ingreso_extra_manual"),
        sqlfunc.sum(Envio.costo_driver).label("costo_paquete_driver"),
        sqlfunc.sum(Envio.extra_comuna_driver).label("costo_comuna"),
        sqlfunc.sum(Envio.extra_producto_driver).label("costo_bulto_extra_driver"),
        sqlfunc.sum(Envio.pago_extra_manual).label("costo_extra_manual_driver"),
    ).filter(
        Envio.anio == anio,
    ).group_by(Envio.mes).all()

    retiro_rows = db.query(
        Retiro.mes,
        sqlfunc.sum(Retiro.tarifa_seller).label("ingreso_retiro"),
        sqlfunc.sum(Retiro.tarifa_driver).label("costo_retiro_driver"),
    ).filter(
        Retiro.anio == anio,
    ).group_by(Retiro.mes).all()

    pickup_rows = db.query(
        RecepcionPaquete.mes,
        sqlfunc.sum(RecepcionPaquete.comision).label("costo_comision_pickup"),
    ).filter(
        RecepcionPaquete.anio == anio,
        RecepcionPaquete.pickup_id.isnot(None),
    ).group_by(RecepcionPaquete.mes).all()

    meses = {}
    for r in envio_rows:
        s = _empty_row()
        s["ingreso_paquete"] = int(r.ingreso_paquete or 0)
        s["paquetes_totales"] = int(r.paquetes_totales or 0)
        s["ingreso_bulto_extra"] = int(r.ingreso_bulto_extra or 0)
        s["ingreso_peso_extra"] = int(r.ingreso_peso_extra or 0)
        s["ingreso_extra_manual"] = int(r.ingreso_extra_manual or 0)
        s["costo_paquete_driver"] = int(r.costo_paquete_driver or 0)
        s["costo_comuna"] = int(r.costo_comuna or 0)
        s["costo_bulto_extra_driver"] = int(r.costo_bulto_extra_driver or 0)
        s["costo_extra_manual_driver"] = int(r.costo_extra_manual_driver or 0)
        meses[r.mes] = s

    for r in retiro_rows:
        if r.mes not in meses:
            meses[r.mes] = _empty_row()
        meses[r.mes]["ingreso_retiro"] = int(r.ingreso_retiro or 0)
        meses[r.mes]["costo_retiro_driver"] = int(r.costo_retiro_driver or 0)

    for r in pickup_rows:
        if r.mes not in meses:
            meses[r.mes] = _empty_row()
        meses[r.mes]["costo_comision_pickup"] = int(r.costo_comision_pickup or 0)

    for m in range(1, 13):
        if m not in meses:
            meses[m] = _empty_row()

    total = _empty_row()
    for s in meses.values():
        for k in total:
            total[k] += s[k]

    return {"meses": meses, "total": total}


@router.get("/same-day")
def same_day_stats(
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """
    Calcula la efectividad de entregas same-day:
    envíos donde fecha_entrega == fecha_carga, solo cuando ambas están presentes.
    Devuelve métrica global + desglose por seller + tendencia diaria.
    """
    base_filter = [
        Envio.mes == mes,
        Envio.anio == anio,
        Envio.fecha_carga.isnot(None),
    ]

    # ── Global ──
    rows_global = db.query(
        sqlfunc.count(Envio.id).label("total"),
        sqlfunc.sum(
            case((Envio.fecha_entrega == Envio.fecha_carga, 1), else_=0)
        ).label("same_day"),
    ).filter(*base_filter).first()

    total_global = int(rows_global.total or 0)
    same_day_global = int(rows_global.same_day or 0)
    tasa_global = round(same_day_global / total_global * 100, 1) if total_global else 0.0

    # ── Por seller ──
    rows_seller = db.query(
        Envio.seller_id,
        sqlfunc.coalesce(Envio.seller_nombre_raw, "Sin nombre").label("nombre"),
        sqlfunc.count(Envio.id).label("total"),
        sqlfunc.sum(
            case((Envio.fecha_entrega == Envio.fecha_carga, 1), else_=0)
        ).label("same_day"),
    ).filter(*base_filter, Envio.seller_id.isnot(None)).group_by(
        Envio.seller_id, Envio.seller_nombre_raw
    ).order_by(sqlfunc.count(Envio.id).desc()).limit(20).all()

    # Usar nombre real del seller si está disponible
    seller_ids = [r.seller_id for r in rows_seller if r.seller_id]
    seller_nombres = {
        s.id: s.nombre
        for s in db.query(Seller.id, Seller.nombre).filter(Seller.id.in_(seller_ids)).all()
    } if seller_ids else {}

    por_seller = []
    for r in rows_seller:
        t = int(r.total or 0)
        sd = int(r.same_day or 0)
        por_seller.append({
            "seller_id": r.seller_id,
            "nombre": seller_nombres.get(r.seller_id) or r.nombre or "Sin nombre",
            "total": t,
            "same_day": sd,
            "tasa": round(sd / t * 100, 1) if t else 0.0,
        })

    # ── Tendencia diaria ──
    rows_dia = db.query(
        Envio.fecha_entrega,
        sqlfunc.count(Envio.id).label("total"),
        sqlfunc.sum(
            case((Envio.fecha_entrega == Envio.fecha_carga, 1), else_=0)
        ).label("same_day"),
    ).filter(*base_filter).group_by(Envio.fecha_entrega).order_by(Envio.fecha_entrega).all()

    por_dia = []
    for r in rows_dia:
        t = int(r.total or 0)
        sd = int(r.same_day or 0)
        por_dia.append({
            "fecha": str(r.fecha_entrega) if r.fecha_entrega else None,
            "total": t,
            "same_day": sd,
            "tasa": round(sd / t * 100, 1) if t else 0.0,
        })

    return {
        "mes": mes,
        "anio": anio,
        "total": total_global,
        "same_day": same_day_global,
        "tasa": tasa_global,
        "por_seller": por_seller,
        "por_dia": por_dia,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Efectividad de entregas — ciclo fecha_carga → fecha_entrega
# ─────────────────────────────────────────────────────────────────────────────

def _ciclo_expr():
    """Days between fecha_carga and fecha_entrega (PostgreSQL date subtraction)."""
    from sqlalchemy import cast, Integer as SAInteger
    return cast(Envio.fecha_entrega - Envio.fecha_carga, SAInteger)


def _efectividad_row(rows_with_carga):
    """Compute distribution and averages from a list of ciclo_dias ints."""
    if not rows_with_carga:
        return {"ciclo_promedio": None, "pct_0d": 0, "pct_1d": 0, "pct_2d": 0,
                "pct_3d": 0, "pct_4plus": 0, "pct_rapida": 0}
    n = len(rows_with_carga)
    c0 = sum(1 for d in rows_with_carga if d == 0)
    c1 = sum(1 for d in rows_with_carga if d == 1)
    c2 = sum(1 for d in rows_with_carga if d == 2)
    c3 = sum(1 for d in rows_with_carga if d == 3)
    c4 = sum(1 for d in rows_with_carga if d >= 4)
    avg = round(sum(rows_with_carga) / n, 1)
    pct = lambda x: round(x / n * 100, 1)
    return {
        "ciclo_promedio": avg,
        "pct_0d": pct(c0), "n_0d": c0,
        "pct_1d": pct(c1), "n_1d": c1,
        "pct_2d": pct(c2), "n_2d": c2,
        "pct_3d": pct(c3), "n_3d": c3,
        "pct_4plus": pct(c4), "n_4plus": c4,
        "pct_rapida": pct(c0 + c1),
    }


@router.get("/efectividad")
def efectividad_entregas(
    mes: int = Query(...),
    anio: int = Query(...),
    semana: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Ciclo de entrega: fecha_carga → fecha_entrega por seller y driver."""
    from sqlalchemy import cast, Integer as SAInteger

    base = [Envio.mes == mes, Envio.anio == anio]
    if semana:
        base.append(Envio.semana == semana)

    # ── Global ──
    rows_global = db.query(_ciclo_expr().label("d")).filter(
        *base, Envio.fecha_carga.isnot(None)
    ).all()
    dias_global = [r.d for r in rows_global if r.d is not None and r.d >= 0]

    total_global = db.query(sqlfunc.count(Envio.id)).filter(*base).scalar() or 0
    con_fecha_carga = len(dias_global)

    global_stats = {
        "total": total_global,
        "con_fecha_carga": con_fecha_carga,
        "sin_fecha_carga": total_global - con_fecha_carga,
        **_efectividad_row(dias_global),
    }

    # ── Por Seller ──
    seller_data = db.query(
        Envio.seller_id,
        sqlfunc.count(Envio.id).label("total"),
        sqlfunc.count(Envio.fecha_carga).label("con_carga"),
        sqlfunc.avg(cast(Envio.fecha_entrega - Envio.fecha_carga, SAInteger)).label("avg_ciclo"),
        sqlfunc.sum(case((cast(Envio.fecha_entrega - Envio.fecha_carga, SAInteger) == 0, 1), else_=0)).label("n_0d"),
        sqlfunc.sum(case((cast(Envio.fecha_entrega - Envio.fecha_carga, SAInteger) == 1, 1), else_=0)).label("n_1d"),
        sqlfunc.sum(case((cast(Envio.fecha_entrega - Envio.fecha_carga, SAInteger) >= 4, 1), else_=0)).label("n_4plus"),
    ).filter(*base, Envio.fecha_carga.isnot(None), Envio.seller_id.isnot(None)
    ).group_by(Envio.seller_id).all()

    seller_nombres = {s.id: s.nombre for s in db.query(Seller.id, Seller.nombre).all()}

    por_seller = []
    for r in sorted(seller_data, key=lambda x: -(x.total or 0)):
        cc = r.con_carga or 0
        por_seller.append({
            "seller_id": r.seller_id,
            "nombre": seller_nombres.get(r.seller_id, "Sin nombre"),
            "total": r.total,
            "con_fecha_carga": cc,
            "ciclo_promedio": round(float(r.avg_ciclo), 1) if r.avg_ciclo is not None else None,
            "pct_0d": round(r.n_0d / cc * 100, 1) if cc else 0,
            "pct_rapida": round((r.n_0d + r.n_1d) / cc * 100, 1) if cc else 0,
            "pct_4plus": round(r.n_4plus / cc * 100, 1) if cc else 0,
        })

    # ── Por Driver ──
    driver_data = db.query(
        Envio.driver_id,
        sqlfunc.count(Envio.id).label("total"),
        sqlfunc.count(Envio.fecha_carga).label("con_carga"),
        sqlfunc.avg(cast(Envio.fecha_entrega - Envio.fecha_carga, SAInteger)).label("avg_ciclo"),
        sqlfunc.sum(case((cast(Envio.fecha_entrega - Envio.fecha_carga, SAInteger) == 0, 1), else_=0)).label("n_0d"),
        sqlfunc.sum(case((cast(Envio.fecha_entrega - Envio.fecha_carga, SAInteger) == 1, 1), else_=0)).label("n_1d"),
        sqlfunc.sum(case((cast(Envio.fecha_entrega - Envio.fecha_carga, SAInteger) >= 4, 1), else_=0)).label("n_4plus"),
    ).filter(*base, Envio.fecha_carga.isnot(None), Envio.driver_id.isnot(None)
    ).group_by(Envio.driver_id).all()

    driver_nombres = {d.id: d.nombre for d in db.query(Driver.id, Driver.nombre).all()}

    por_driver = []
    for r in sorted(driver_data, key=lambda x: -(x.con_carga or 0)):
        cc = r.con_carga or 0
        ciclo = round(float(r.avg_ciclo), 1) if r.avg_ciclo is not None else None
        pct_rapida = round((r.n_0d + r.n_1d) / cc * 100, 1) if cc else 0
        por_driver.append({
            "driver_id": r.driver_id,
            "nombre": driver_nombres.get(r.driver_id, "Sin nombre"),
            "total": r.total,
            "con_fecha_carga": cc,
            "ciclo_promedio": ciclo,
            "pct_0d": round(r.n_0d / cc * 100, 1) if cc else 0,
            "pct_rapida": pct_rapida,
            "pct_4plus": round(r.n_4plus / cc * 100, 1) if cc else 0,
            "alerta": ciclo is not None and ciclo > 2.5,
        })

    # Tendencia semanal por driver (últimas 4 semanas del mes)
    sem_data = db.query(
        Envio.driver_id,
        Envio.semana,
        sqlfunc.avg(cast(Envio.fecha_entrega - Envio.fecha_carga, SAInteger)).label("avg_ciclo"),
        sqlfunc.sum(case((cast(Envio.fecha_entrega - Envio.fecha_carga, SAInteger) <= 1, 1), else_=0)).label("rapidas"),
        sqlfunc.count(Envio.id).label("total"),
    ).filter(Envio.mes == mes, Envio.anio == anio, Envio.fecha_carga.isnot(None),
             Envio.driver_id.isnot(None)
    ).group_by(Envio.driver_id, Envio.semana).all()

    spark_by_driver: dict = defaultdict(dict)
    for r in sem_data:
        t = r.total or 0
        spark_by_driver[r.driver_id][r.semana] = round(r.rapidas / t * 100, 1) if t else 0

    semanas_mes = sorted({r.semana for r in sem_data})
    for d in por_driver:
        d["spark"] = [spark_by_driver[d["driver_id"]].get(s, 0) for s in semanas_mes]

    return {
        "mes": mes, "anio": anio, "semana": semana,
        "global": global_stats,
        "por_seller": por_seller,
        "por_driver": por_driver,
        "semanas": semanas_mes,
    }


@router.get("/efectividad/driver/{driver_id}")
def efectividad_driver_detalle(
    driver_id: int,
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Detalle de ciclo de entrega para un driver específico."""
    from sqlalchemy import cast, Integer as SAInteger

    base = [Envio.mes == mes, Envio.anio == anio,
            Envio.driver_id == driver_id, Envio.fecha_carga.isnot(None)]

    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    nombre = driver.nombre if driver else f"Driver {driver_id}"

    # Resumen
    rows = db.query(_ciclo_expr().label("d")).filter(*base).all()
    dias = [r.d for r in rows if r.d is not None and r.d >= 0]

    resumen = {"nombre": nombre, "total": len(dias), **_efectividad_row(dias)}

    # Tendencia diaria
    daily = db.query(
        Envio.fecha_carga.label("fecha"),
        sqlfunc.count(Envio.id).label("total"),
        sqlfunc.avg(cast(Envio.fecha_entrega - Envio.fecha_carga, SAInteger)).label("ciclo_avg"),
        sqlfunc.sum(case((cast(Envio.fecha_entrega - Envio.fecha_carga, SAInteger) == 0, 1), else_=0)).label("n_0d"),
        sqlfunc.sum(case((cast(Envio.fecha_entrega - Envio.fecha_carga, SAInteger) <= 1, 1), else_=0)).label("n_rapidos"),
    ).filter(*base).group_by(Envio.fecha_carga).order_by(Envio.fecha_carga).all()

    por_dia = [{
        "fecha": str(r.fecha),
        "total": r.total,
        "ciclo_avg": round(float(r.ciclo_avg), 1) if r.ciclo_avg else 0,
        "pct_0d": round(r.n_0d / r.total * 100, 1) if r.total else 0,
        "pct_rapida": round(r.n_rapidos / r.total * 100, 1) if r.total else 0,
    } for r in daily]

    # Envíos lentos (+3 días)
    seller_nombres = {s.id: s.nombre for s in db.query(Seller.id, Seller.nombre).all()}
    lentos_rows = db.query(
        Envio.tracking_id, Envio.seller_id, Envio.fecha_carga,
        Envio.fecha_entrega, Envio.comuna,
        _ciclo_expr().label("ciclo_dias"),
    ).filter(*base, _ciclo_expr() >= 3
    ).order_by(_ciclo_expr().desc()).limit(20).all()

    lentos = [{
        "tracking_id": r.tracking_id or "—",
        "seller": seller_nombres.get(r.seller_id, "—"),
        "fecha_carga": str(r.fecha_carga),
        "fecha_entrega": str(r.fecha_entrega),
        "ciclo_dias": r.ciclo_dias,
        "comuna": r.comuna or "—",
    } for r in lentos_rows]

    return {"resumen": resumen, "por_dia": por_dia, "lentos": lentos}
