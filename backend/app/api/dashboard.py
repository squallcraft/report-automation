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
    GestionComercialEntry, AjusteLiquidacion, TipoEntidadEnum,
    AsignacionRuta,
)
from app.schemas import DashboardStats
from app.services.seller_groups import group_seller, get_group_seller_ids, is_in_group

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
# Efectividad de entregas — ciclo fecha_retiro → fecha_entrega
#
# A partir de la integración con TrackingTech (asignacion_ruta), el ciclo de
# entrega se mide desde que el courier retira el paquete (Envio.fecha_retiro)
# hasta que se entrega (Envio.fecha_entrega), no desde la subida del seller.
#
# Cancelados externamente (AsignacionRuta.estado_calculado='cancelado') se
# reportan aparte y NO entran al denominador del ciclo.
# ─────────────────────────────────────────────────────────────────────────────

def _ciclo_expr():
    """
    Business days (Mon-Fri) between fecha_retiro and fecha_entrega.
    Friday → Monday = 1 business day (weekend skipped).

    Formula: wd_cumulative(entrega) - wd_cumulative(retiro)
    where wd_cumulative(d) = (days_since_ref_monday / 7) * 5 + LEAST(ISODOW, 5)
    Reference 2024-01-01 is a Monday (ISODOW=1).
    """
    from sqlalchemy import cast, Integer as SAInteger, text

    def _wd(col):
        days = cast(col - text("'2024-01-01'::date"), SAInteger)
        isodow = cast(sqlfunc.extract('isodow', col), SAInteger)
        return (days / 7) * 5 + sqlfunc.least(isodow, 5)

    return _wd(Envio.fecha_entrega) - _wd(Envio.fecha_retiro)


def _cancelado_externo_subq():
    """Sub-query EXISTS: el envío tiene una AsignacionRuta cancelada externamente."""
    from sqlalchemy import exists
    return exists().where(
        (AsignacionRuta.envio_id == Envio.id)
        & (AsignacionRuta.estado_calculado == "cancelado")
    )


def _efectividad_row(dias_ciclo):
    """Compute distribution and averages from a list of ciclo_dias ints."""
    if not dias_ciclo:
        return {"ciclo_promedio": None, "pct_0d": 0, "pct_1d": 0, "pct_2d": 0,
                "pct_3d": 0, "pct_4plus": 0, "pct_rapida": 0,
                "n_0d": 0, "n_1d": 0, "n_2d": 0, "n_3d": 0, "n_4plus": 0}
    n = len(dias_ciclo)
    c0 = sum(1 for d in dias_ciclo if d == 0)
    c1 = sum(1 for d in dias_ciclo if d == 1)
    c2 = sum(1 for d in dias_ciclo if d == 2)
    c3 = sum(1 for d in dias_ciclo if d == 3)
    c4 = sum(1 for d in dias_ciclo if d >= 4)
    avg = round(sum(dias_ciclo) / n, 1)
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
    """Ciclo de entrega: fecha_retiro → fecha_entrega por seller y driver.

    - Denominador del ciclo: envíos con fecha_retiro Y fecha_entrega presentes.
    - Cancelados externos (TrackingTech) se reportan aparte y NO entran al
      cómputo del ciclo ni al cómputo de la tasa.
    """
    base = [Envio.mes == mes, Envio.anio == anio]
    if semana:
        base.append(Envio.semana == semana)

    cancelado_subq = _cancelado_externo_subq()

    # ── Global ──
    rows_global = db.query(_ciclo_expr().label("d")).filter(
        *base,
        Envio.fecha_retiro.isnot(None),
        ~cancelado_subq,
    ).all()
    dias_global = [r.d for r in rows_global if r.d is not None and r.d >= 0]

    total_global = db.query(sqlfunc.count(Envio.id)).filter(*base).scalar() or 0
    cancelados_global = db.query(sqlfunc.count(Envio.id)).filter(*base, cancelado_subq).scalar() or 0
    con_fecha_retiro = db.query(sqlfunc.count(Envio.id)).filter(
        *base, Envio.fecha_retiro.isnot(None), ~cancelado_subq
    ).scalar() or 0

    global_stats = {
        "total": total_global,
        "cancelados": cancelados_global,
        "con_fecha_retiro": con_fecha_retiro,
        "sin_fecha_retiro": max(0, total_global - cancelados_global - con_fecha_retiro),
        # Backwards-compat con frontend antiguo (mismo nombre, semántica equivalente):
        "con_fecha_carga": con_fecha_retiro,
        "sin_fecha_carga": max(0, total_global - cancelados_global - con_fecha_retiro),
        **_efectividad_row(dias_global),
    }

    # ── Por Seller ──
    # Total por seller (incluye cancelados, para mostrar el universo completo)
    seller_total = db.query(
        Envio.seller_id,
        sqlfunc.count(Envio.id).label("total"),
    ).filter(*base, Envio.seller_id.isnot(None)).group_by(Envio.seller_id).all()
    total_por_seller = {r.seller_id: int(r.total or 0) for r in seller_total}

    # Cancelados por seller (excluidos del denominador)
    seller_cancelados = db.query(
        Envio.seller_id,
        sqlfunc.count(Envio.id).label("cancelados"),
    ).filter(*base, Envio.seller_id.isnot(None), cancelado_subq).group_by(Envio.seller_id).all()
    cancelados_por_seller = {r.seller_id: int(r.cancelados or 0) for r in seller_cancelados}

    # Métricas de ciclo (excluyen cancelados y exigen fecha_retiro)
    seller_data = db.query(
        Envio.seller_id,
        sqlfunc.count(Envio.id).label("con_retiro"),
        sqlfunc.avg(_ciclo_expr()).label("avg_ciclo"),
        sqlfunc.sum(case((_ciclo_expr() == 0, 1), else_=0)).label("n_0d"),
        sqlfunc.sum(case((_ciclo_expr() == 1, 1), else_=0)).label("n_1d"),
        sqlfunc.sum(case((_ciclo_expr() >= 4, 1), else_=0)).label("n_4plus"),
    ).filter(
        *base,
        Envio.fecha_retiro.isnot(None),
        Envio.seller_id.isnot(None),
        ~cancelado_subq,
    ).group_by(Envio.seller_id).all()

    seller_nombres = {s.id: s.nombre for s in db.query(Seller.id, Seller.nombre).all()}

    por_seller_raw = []
    seller_ids_vistos = set()
    for r in seller_data:
        seller_ids_vistos.add(r.seller_id)
        cc = r.con_retiro or 0
        por_seller_raw.append({
            "seller_id": r.seller_id,
            "nombre": seller_nombres.get(r.seller_id, "Sin nombre"),
            "total": total_por_seller.get(r.seller_id, 0),
            "cancelados": cancelados_por_seller.get(r.seller_id, 0),
            "con_fecha_retiro": cc,
            "_n_0d": r.n_0d or 0,
            "_n_1d": r.n_1d or 0,
            "_n_4plus": r.n_4plus or 0,
            "_ciclo_sum": float(r.avg_ciclo or 0) * cc,
        })

    # Sellers que solo tienen totales/cancelados (sin fecha_retiro válida)
    for sid, tot in total_por_seller.items():
        if sid in seller_ids_vistos:
            continue
        por_seller_raw.append({
            "seller_id": sid,
            "nombre": seller_nombres.get(sid, "Sin nombre"),
            "total": tot,
            "cancelados": cancelados_por_seller.get(sid, 0),
            "con_fecha_retiro": 0,
            "_n_0d": 0, "_n_1d": 0, "_n_4plus": 0, "_ciclo_sum": 0.0,
        })

    # ── Aplicar agrupaciones analytics ──────────────────────────────────────
    _ef_groups: dict = {}
    for row in por_seller_raw:
        gname = group_seller(row["nombre"])
        if gname not in _ef_groups:
            _ef_groups[gname] = {
                "seller_id": None if gname != row["nombre"] else row["seller_id"],
                "nombre": gname,
                "es_grupo": gname != row["nombre"],
                "grupo_nombre": gname if gname != row["nombre"] else None,
                "total": 0, "cancelados": 0, "con_fecha_retiro": 0,
                "_n_0d": 0, "_n_1d": 0, "_n_4plus": 0, "_ciclo_sum": 0.0,
            }
        g = _ef_groups[gname]
        g["total"] += row["total"]
        g["cancelados"] += row["cancelados"]
        g["con_fecha_retiro"] += row["con_fecha_retiro"]
        g["_n_0d"] += row["_n_0d"]
        g["_n_1d"] += row["_n_1d"]
        g["_n_4plus"] += row["_n_4plus"]
        g["_ciclo_sum"] += row["_ciclo_sum"]

    por_seller = []
    for g in sorted(_ef_groups.values(), key=lambda x: -x["total"]):
        cc = g["con_fecha_retiro"]
        por_seller.append({
            "seller_id": g["seller_id"],
            "nombre": g["nombre"],
            "es_grupo": g["es_grupo"],
            "grupo_nombre": g["grupo_nombre"],
            "total": g["total"],
            "cancelados": g["cancelados"],
            "con_fecha_retiro": cc,
            "con_fecha_carga": cc,  # alias para compat
            "ciclo_promedio": round(g["_ciclo_sum"] / cc, 1) if cc else None,
            "pct_0d": round(g["_n_0d"] / cc * 100, 1) if cc else 0,
            "pct_rapida": round((g["_n_0d"] + g["_n_1d"]) / cc * 100, 1) if cc else 0,
            "pct_4plus": round(g["_n_4plus"] / cc * 100, 1) if cc else 0,
        })

    # ── Por Driver ──
    driver_total = db.query(
        Envio.driver_id,
        sqlfunc.count(Envio.id).label("total"),
    ).filter(*base, Envio.driver_id.isnot(None)).group_by(Envio.driver_id).all()
    total_por_driver = {r.driver_id: int(r.total or 0) for r in driver_total}

    driver_cancel = db.query(
        Envio.driver_id,
        sqlfunc.count(Envio.id).label("cancelados"),
    ).filter(*base, Envio.driver_id.isnot(None), cancelado_subq).group_by(Envio.driver_id).all()
    cancelados_por_driver = {r.driver_id: int(r.cancelados or 0) for r in driver_cancel}

    driver_data = db.query(
        Envio.driver_id,
        sqlfunc.count(Envio.id).label("con_retiro"),
        sqlfunc.avg(_ciclo_expr()).label("avg_ciclo"),
        sqlfunc.sum(case((_ciclo_expr() == 0, 1), else_=0)).label("n_0d"),
        sqlfunc.sum(case((_ciclo_expr() == 1, 1), else_=0)).label("n_1d"),
        sqlfunc.sum(case((_ciclo_expr() >= 4, 1), else_=0)).label("n_4plus"),
    ).filter(
        *base,
        Envio.fecha_retiro.isnot(None),
        Envio.driver_id.isnot(None),
        ~cancelado_subq,
    ).group_by(Envio.driver_id).all()

    driver_nombres = {d.id: d.nombre for d in db.query(Driver.id, Driver.nombre).all()}

    por_driver = []
    driver_ids_vistos = set()
    for r in sorted(driver_data, key=lambda x: -(x.con_retiro or 0)):
        driver_ids_vistos.add(r.driver_id)
        cc = r.con_retiro or 0
        ciclo = round(float(r.avg_ciclo), 1) if r.avg_ciclo is not None else None
        pct_rapida = round(((r.n_0d or 0) + (r.n_1d or 0)) / cc * 100, 1) if cc else 0
        por_driver.append({
            "driver_id": r.driver_id,
            "nombre": driver_nombres.get(r.driver_id, "Sin nombre"),
            "total": total_por_driver.get(r.driver_id, 0),
            "cancelados": cancelados_por_driver.get(r.driver_id, 0),
            "con_fecha_retiro": cc,
            "con_fecha_carga": cc,  # alias para compat
            "ciclo_promedio": ciclo,
            "pct_0d": round((r.n_0d or 0) / cc * 100, 1) if cc else 0,
            "pct_rapida": pct_rapida,
            "pct_4plus": round((r.n_4plus or 0) / cc * 100, 1) if cc else 0,
            "alerta": ciclo is not None and ciclo > 2.5,
        })

    for did, tot in total_por_driver.items():
        if did in driver_ids_vistos:
            continue
        por_driver.append({
            "driver_id": did,
            "nombre": driver_nombres.get(did, "Sin nombre"),
            "total": tot,
            "cancelados": cancelados_por_driver.get(did, 0),
            "con_fecha_retiro": 0,
            "con_fecha_carga": 0,
            "ciclo_promedio": None,
            "pct_0d": 0, "pct_rapida": 0, "pct_4plus": 0,
            "alerta": False,
        })

    # Tendencia semanal por driver (últimas 4 semanas del mes)
    sem_data = db.query(
        Envio.driver_id,
        Envio.semana,
        sqlfunc.avg(_ciclo_expr()).label("avg_ciclo"),
        sqlfunc.sum(case((_ciclo_expr() <= 1, 1), else_=0)).label("rapidas"),
        sqlfunc.count(Envio.id).label("total"),
    ).filter(
        Envio.mes == mes, Envio.anio == anio,
        Envio.fecha_retiro.isnot(None),
        Envio.driver_id.isnot(None),
        ~cancelado_subq,
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
        "prev_global": _efectividad_prev(mes, anio, db),
    }


def _efectividad_prev(mes: int, anio: int, db):
    """Global efectividad for the previous month (for comparison delta)."""
    prev_mes = mes - 1 if mes > 1 else 12
    prev_anio = anio if mes > 1 else anio - 1
    base_prev = [Envio.mes == prev_mes, Envio.anio == prev_anio]
    cancel_subq = _cancelado_externo_subq()
    rows_prev = db.query(_ciclo_expr().label("d")).filter(
        *base_prev, Envio.fecha_retiro.isnot(None), ~cancel_subq
    ).all()
    dias_prev = [r.d for r in rows_prev if r.d is not None and r.d >= 0]
    total_prev = db.query(sqlfunc.count(Envio.id)).filter(*base_prev).scalar() or 0
    cancel_prev = db.query(sqlfunc.count(Envio.id)).filter(*base_prev, cancel_subq).scalar() or 0
    return {
        "mes": prev_mes, "anio": prev_anio,
        "total": total_prev,
        "cancelados": cancel_prev,
        "con_fecha_retiro": len(dias_prev),
        "con_fecha_carga": len(dias_prev),  # alias compat
        **_efectividad_row(dias_prev),
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
    cancel_subq = _cancelado_externo_subq()
    base = [Envio.mes == mes, Envio.anio == anio,
            Envio.driver_id == driver_id,
            Envio.fecha_retiro.isnot(None),
            ~cancel_subq]

    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    nombre = driver.nombre if driver else f"Driver {driver_id}"

    # Cancelados del driver en el periodo (para mostrar aparte)
    cancelados_driver = db.query(sqlfunc.count(Envio.id)).filter(
        Envio.mes == mes, Envio.anio == anio,
        Envio.driver_id == driver_id, cancel_subq,
    ).scalar() or 0

    # Resumen
    rows = db.query(_ciclo_expr().label("d")).filter(*base).all()
    dias = [r.d for r in rows if r.d is not None and r.d >= 0]

    resumen = {
        "nombre": nombre,
        "total": len(dias),
        "cancelados": cancelados_driver,
        **_efectividad_row(dias),
    }

    # Tendencia diaria (agrupada por fecha_retiro)
    daily = db.query(
        Envio.fecha_retiro.label("fecha"),
        sqlfunc.count(Envio.id).label("total"),
        sqlfunc.avg(_ciclo_expr()).label("ciclo_avg"),
        sqlfunc.sum(case((_ciclo_expr() == 0, 1), else_=0)).label("n_0d"),
        sqlfunc.sum(case((_ciclo_expr() <= 1, 1), else_=0)).label("n_rapidos"),
    ).filter(*base).group_by(Envio.fecha_retiro).order_by(Envio.fecha_retiro).all()

    por_dia = [{
        "fecha": str(r.fecha),
        "total": r.total,
        "ciclo_avg": round(float(r.ciclo_avg), 1) if r.ciclo_avg else 0,
        "pct_0d": round(r.n_0d / r.total * 100, 1) if r.total else 0,
        "pct_rapida": round(r.n_rapidos / r.total * 100, 1) if r.total else 0,
    } for r in daily]

    # Tendencia semanal
    weekly = db.query(
        Envio.semana.label("semana"),
        sqlfunc.count(Envio.id).label("total"),
        sqlfunc.avg(_ciclo_expr()).label("ciclo_avg"),
        sqlfunc.sum(case((_ciclo_expr() <= 1, 1), else_=0)).label("n_rapidos"),
        sqlfunc.sum(case((_ciclo_expr() == 0, 1), else_=0)).label("n_0d"),
    ).filter(*base).group_by(Envio.semana).order_by(Envio.semana).all()

    por_semana = [{
        "semana": r.semana,
        "total": r.total,
        "ciclo_avg": round(float(r.ciclo_avg), 1) if r.ciclo_avg else 0,
        "pct_rapida": round(r.n_rapidos / r.total * 100, 1) if r.total else 0,
        "pct_0d": round(r.n_0d / r.total * 100, 1) if r.total else 0,
    } for r in weekly]

    # Por ruta
    rutas = db.query(
        sqlfunc.coalesce(Envio.ruta_nombre, "Sin ruta").label("ruta"),
        sqlfunc.count(Envio.id).label("total"),
        sqlfunc.avg(_ciclo_expr()).label("ciclo_avg"),
        sqlfunc.sum(case((_ciclo_expr() <= 1, 1), else_=0)).label("n_rapidos"),
        sqlfunc.sum(case((_ciclo_expr() == 0, 1), else_=0)).label("n_0d"),
    ).filter(*base).group_by(sqlfunc.coalesce(Envio.ruta_nombre, "Sin ruta")).order_by(sqlfunc.count(Envio.id).desc()).all()

    por_ruta = [{
        "ruta": r.ruta,
        "total": r.total,
        "ciclo_avg": round(float(r.ciclo_avg), 1) if r.ciclo_avg else 0,
        "pct_rapida": round(r.n_rapidos / r.total * 100, 1) if r.total else 0,
        "pct_0d": round(r.n_0d / r.total * 100, 1) if r.total else 0,
    } for r in rutas]

    # Envíos lentos (+3 días)
    seller_nombres = {s.id: s.nombre for s in db.query(Seller.id, Seller.nombre).all()}
    lentos_rows = db.query(
        Envio.tracking_id, Envio.seller_id, Envio.fecha_retiro,
        Envio.fecha_entrega, Envio.comuna,
        _ciclo_expr().label("ciclo_dias"),
    ).filter(*base, _ciclo_expr() >= 3
    ).order_by(_ciclo_expr().desc()).limit(20).all()

    lentos = [{
        "tracking_id": r.tracking_id or "—",
        "seller": seller_nombres.get(r.seller_id, "—"),
        "fecha_retiro": str(r.fecha_retiro) if r.fecha_retiro else None,
        "fecha_carga": str(r.fecha_retiro) if r.fecha_retiro else None,  # alias compat
        "fecha_entrega": str(r.fecha_entrega) if r.fecha_entrega else None,
        "ciclo_dias": r.ciclo_dias,
        "comuna": r.comuna or "—",
    } for r in lentos_rows]

    return {"resumen": resumen, "por_dia": por_dia, "por_semana": por_semana, "por_ruta": por_ruta, "lentos": lentos}


@router.get("/retencion")
def analisis_retencion(
    anio: int = Query(...),
    mes_ref: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Análisis de retención y salud comercial de sellers."""
    from collections import Counter

    # Aggregate monthly shipments + income per seller for the year
    monthly = db.query(
        Envio.seller_id,
        Envio.mes,
        sqlfunc.count(Envio.id).label("paquetes"),
        sqlfunc.sum(
            sqlfunc.coalesce(Envio.cobro_seller, 0)
            + sqlfunc.coalesce(Envio.extra_producto_seller, 0)
            + sqlfunc.coalesce(Envio.extra_comuna_seller, 0)
            + sqlfunc.coalesce(Envio.cobro_extra_manual, 0)
        ).label("ingreso"),
    ).filter(
        Envio.anio == anio,
        Envio.seller_id.isnot(None),
    ).group_by(Envio.seller_id, Envio.mes).all()

    if not monthly:
        return {
            "anio": anio, "mes_ref": mes_ref,
            "resumen": {"activo": 0, "nuevo": 0, "recuperado": 0, "en_riesgo": 0, "inactivo": 0, "perdido": 0, "total_sellers": 0},
            "sellers": [], "top_riesgo": [], "max_vol": 1,
        }

    seller_nombres = {s.id: s.nombre for s in db.query(Seller.id, Seller.nombre).all()}

    # Build per-seller monthly structure
    by_seller: dict = defaultdict(lambda: {"meses": defaultdict(int), "ingresos": defaultdict(int)})
    for r in monthly:
        by_seller[r.seller_id]["meses"][r.mes] += r.paquetes
        by_seller[r.seller_id]["ingresos"][r.mes] += int(r.ingreso or 0)

    def classify(meses_dict: dict, ref: int) -> str:
        vol_ref = meses_dict.get(ref, 0)
        vol_prev = meses_dict.get(ref - 1, 0) if ref > 1 else 0
        active = sorted(m for m, v in meses_dict.items() if v > 0)
        if not active:
            return "perdido"
        # Nuevo: first activity is in the last 1-2 months
        if active[0] >= ref - 1 and not any(meses_dict.get(m, 0) > 0 for m in range(1, ref - 1)):
            return "nuevo"
        if vol_ref > 0:
            if vol_prev == 0 and any(meses_dict.get(m, 0) > 0 for m in range(1, ref - 1)):
                return "recuperado"
            return "activo"
        else:
            if vol_prev > 0:
                return "en_riesgo"
            elif any(meses_dict.get(m, 0) > 0 for m in range(max(1, ref - 4), ref)):
                return "inactivo"
            else:
                return "perdido"

    sellers_out = []
    for seller_id, d in by_seller.items():
        meses_dict = dict(d["meses"])
        ingresos_dict = dict(d["ingresos"])

        active_months = sorted(m for m, v in meses_dict.items() if v > 0)
        meses_activo = len(active_months)
        ultimo_mes_activo = max(active_months) if active_months else None

        promedio_mensual = int(sum(meses_dict.get(m, 0) for m in active_months) / meses_activo) if meses_activo else 0
        ingreso_mensual_avg = int(sum(ingresos_dict.get(m, 0) for m in active_months) / meses_activo) if meses_activo else 0

        estado = classify(meses_dict, mes_ref)

        meses_sin = (mes_ref - ultimo_mes_activo) if (ultimo_mes_activo and meses_dict.get(mes_ref, 0) == 0) else 0
        semanas_sin = meses_sin * 4

        meses_restantes = max(0, 12 - mes_ref + 1)
        impacto_anual = ingreso_mensual_avg * meses_restantes if estado in ("en_riesgo", "inactivo", "perdido") else 0

        vol_anual = [meses_dict.get(m, 0) for m in range(1, 13)]

        sellers_out.append({
            "seller_id": seller_id,
            "nombre": seller_nombres.get(seller_id, f"Seller {seller_id}"),
            "estado": estado,
            "ultimo_mes_activo": ultimo_mes_activo,
            "meses_activo": meses_activo,
            "promedio_mensual": promedio_mensual,
            "ingreso_mensual_avg": ingreso_mensual_avg,
            "impacto_anual": impacto_anual,
            "semanas_sin_actividad": semanas_sin,
            "vol_anual": vol_anual,
            "vol_ref": meses_dict.get(mes_ref, 0),
        })

    # ── Aplicar agrupaciones analytics ─────────────────────────────────────
    _ret_groups: dict = {}
    for row in sellers_out:
        gname = group_seller(row["nombre"])
        if gname not in _ret_groups:
            _ret_groups[gname] = {
                **row,
                "nombre": gname,
                "es_grupo": gname != row["nombre"],
                "grupo_nombre": gname if gname != row["nombre"] else None,
                "seller_id": None if gname != row["nombre"] else row["seller_id"],
            }
        else:
            g = _ret_groups[gname]
            # Merge vol_anual element-wise
            g["vol_anual"] = [g["vol_anual"][i] + row["vol_anual"][i] for i in range(12)]
            g["vol_ref"] += row["vol_ref"]
            g["ingreso_mensual_avg"] += row["ingreso_mensual_avg"]
            g["promedio_mensual"] += row["promedio_mensual"]
            g["impacto_anual"] += row["impacto_anual"]
            g["meses_activo"] = max(g["meses_activo"], row["meses_activo"])
            g["semanas_sin_actividad"] = min(g["semanas_sin_actividad"], row["semanas_sin_actividad"])
            if row["ultimo_mes_activo"] and (not g["ultimo_mes_activo"] or row["ultimo_mes_activo"] > g["ultimo_mes_activo"]):
                g["ultimo_mes_activo"] = row["ultimo_mes_activo"]
            # Re-classify based on merged monthly volumes
            merged_meses = {m + 1: g["vol_anual"][m] for m in range(12)}
            g["estado"] = classify(merged_meses, mes_ref)

    sellers_out = list(_ret_groups.values())

    estado_order = {"perdido": 0, "en_riesgo": 1, "inactivo": 2, "recuperado": 3, "nuevo": 4, "activo": 5}
    sellers_out.sort(key=lambda x: (estado_order.get(x["estado"], 9), -x["ingreso_mensual_avg"]))

    # ── Cruzar con última gestión comercial por seller ──────────────────────
    from sqlalchemy import func as sqlfunc2
    # Get latest gestion entry per seller_id
    latest_gestion_sub = (
        db.query(
            GestionComercialEntry.seller_id,
            sqlfunc.max(GestionComercialEntry.id).label("max_id"),
        )
        .group_by(GestionComercialEntry.seller_id)
        .subquery()
    )
    latest_entries = (
        db.query(GestionComercialEntry)
        .join(latest_gestion_sub, GestionComercialEntry.id == latest_gestion_sub.c.max_id)
        .all()
    )
    gestion_by_seller: dict = {e.seller_id: e for e in latest_entries}

    # Map individual seller IDs that belong to each group row
    # Build reverse map: seller_id -> group_nombre
    seller_to_group = {row["seller_id"]: row["nombre"] for row in sellers_out if row["seller_id"] and not row.get("es_grupo")}
    # For groups, gather all member seller_ids
    grupo_member_ids: dict = defaultdict(list)
    for orig in list(by_seller.keys()):
        gname = group_seller(seller_nombres.get(orig, ""))
        grupo_member_ids[gname].append(orig)

    def _latest_gestion_for_ids(ids):
        entries = [gestion_by_seller[sid] for sid in ids if sid in gestion_by_seller]
        if not entries:
            return None
        e = max(entries, key=lambda x: x.id)
        return {
            "fecha": e.fecha.isoformat() if e.fecha else None,
            "tipo": e.tipo,
            "estado": e.estado,
            "nota": (e.nota[:80] + "…") if e.nota and len(e.nota) > 80 else e.nota,
        }

    for row in sellers_out:
        if row.get("es_grupo"):
            ids = grupo_member_ids.get(row["nombre"], [])
        else:
            ids = [row["seller_id"]] if row["seller_id"] else []
        row["ultima_gestion"] = _latest_gestion_for_ids(ids)

    # ── Obtener lifecycle + estacional por seller_id ────────────────────────
    seller_lifecycle: dict = {
        s.id: {"tipo_cierre": s.tipo_cierre, "estacional": s.estacional}
        for s in db.query(Seller.id, Seller.tipo_cierre, Seller.estacional).all()
    }

    def _lifecycle_for_ids(ids):
        """Devuelve el lifecycle más restrictivo entre los miembros del grupo."""
        for sid in ids:
            lc = seller_lifecycle.get(sid, {})
            if lc.get("tipo_cierre") in ("cerrado", "desactivado"):
                return lc
        for sid in ids:
            lc = seller_lifecycle.get(sid, {})
            if lc.get("tipo_cierre") == "pausa":
                return lc
        estacional = any(seller_lifecycle.get(sid, {}).get("estacional") for sid in ids)
        return {"tipo_cierre": None, "estacional": estacional}

    def _compute_estado_efectivo(row, lc):
        from datetime import date as _date, timedelta
        tipo_cierre = lc.get("tipo_cierre")
        estacional = lc.get("estacional", False)

        # P1 — Lifecycle (verdad administrativa, nunca expira)
        if tipo_cierre in ("cerrado", "desactivado"):
            return "cerrado"
        if tipo_cierre == "pausa":
            return "en_pausa_lifecycle"

        # P2 — CRM (expira a los 60 días sin nueva gestión)
        ug = row.get("ultima_gestion")
        if ug and ug.get("estado") and ug.get("fecha"):
            try:
                dias = (_date.today() - _date.fromisoformat(ug["fecha"])).days
                if dias <= 60:
                    return ug["estado"]
            except Exception:
                pass

        # P3 — Auto-perdido propuesto (90 días sin envíos, no estacional)
        semanas = row.get("semanas_sin_actividad", 0)
        if not estacional and semanas >= 12:
            return "pendiente_validacion"

        # P4 — Operativo calculado
        return row["estado"]

    for row in sellers_out:
        if row.get("es_grupo"):
            ids = grupo_member_ids.get(row["nombre"], [])
        else:
            ids = [row["seller_id"]] if row["seller_id"] else []
        lc = _lifecycle_for_ids(ids)
        row["estado_efectivo"] = _compute_estado_efectivo(row, lc)
        row["estacional"] = lc.get("estacional", False)

    # ── Reordenar usando estado_efectivo ────────────────────────────────────
    estado_efectivo_order = {
        "cerrado": -1, "pendiente_validacion": 0, "perdido": 1,
        "en_riesgo": 2, "inactivo": 3, "en_pausa_lifecycle": 4,
        "en_gestion": 5, "seguimiento": 6, "recuperado": 7, "nuevo": 8, "activo": 9,
    }
    sellers_out.sort(key=lambda x: (
        estado_efectivo_order.get(x["estado_efectivo"], 10),
        -x["ingreso_mensual_avg"]
    ))

    counts = Counter(s["estado_efectivo"] for s in sellers_out)
    prev_counts = Counter(classify(dict(by_seller[sid]["meses"]), mes_ref - 1) for sid in by_seller) if mes_ref > 1 else Counter()

    resumen = {
        "activo": counts["activo"] + counts["nuevo"] + counts["recuperado"],
        "nuevo": counts["nuevo"],
        "recuperado": counts["recuperado"],
        "en_riesgo": counts["en_riesgo"],
        "inactivo": counts["inactivo"],
        "perdido": counts["perdido"],
        "en_gestion": counts["en_gestion"] + counts["seguimiento"],
        "pendiente_validacion": counts["pendiente_validacion"],
        "cerrado": counts["cerrado"],
        "total_sellers": len(sellers_out),
        "prev_en_riesgo": prev_counts.get("en_riesgo", 0),
        "prev_perdido": prev_counts.get("perdido", 0),
        "prev_activo": prev_counts.get("activo", 0) + prev_counts.get("recuperado", 0),
    }

    # Top riesgo excluye los que ya están siendo gestionados o son conocidos
    top_riesgo = sorted(
        [s for s in sellers_out if s["estado_efectivo"] in ("en_riesgo", "inactivo")],
        key=lambda x: -x["ingreso_mensual_avg"]
    )[:10]

    max_vol = max((max(s["vol_anual"]) for s in sellers_out if any(s["vol_anual"])), default=1)

    return {
        "anio": anio,
        "mes_ref": mes_ref,
        "resumen": resumen,
        "sellers": sellers_out,
        "top_riesgo": top_riesgo,
        "max_vol": max_vol,
    }


# ---------------------------------------------------------------------------
# Helpers compartidos para tiers + perfil
# ---------------------------------------------------------------------------
def _asignar_tier(avg_diario: float) -> str:
    if avg_diario >= 500:
        return "EPICO"
    elif avg_diario >= 100:
        return "CLAVE"
    elif avg_diario >= 50:
        return "DESTACADO"
    elif avg_diario >= 20:
        return "BUENO"
    return "NORMAL"


TIER_ORDER = {"EPICO": 0, "CLAVE": 1, "DESTACADO": 2, "BUENO": 3, "NORMAL": 4}
TIER_META = {
    "EPICO":     {"label": "Épico",     "min": 500,  "color": "#7c3aed"},
    "CLAVE":     {"label": "Clave",     "min": 100,  "color": "#2563eb"},
    "DESTACADO": {"label": "Destacado", "min": 50,   "color": "#0d9488"},
    "BUENO":     {"label": "Bueno",     "min": 20,   "color": "#16a34a"},
    "NORMAL":    {"label": "Normal",    "min": 0,    "color": "#6b7280"},
}


def _ingreso_expr():
    return (
        sqlfunc.coalesce(Envio.cobro_seller, 0)
        + sqlfunc.coalesce(Envio.cobro_extra_manual, 0)
        + sqlfunc.coalesce(Envio.extra_producto_seller, 0)
        + sqlfunc.coalesce(Envio.extra_comuna_seller, 0)
    )


def _costo_expr():
    return (
        sqlfunc.coalesce(Envio.costo_driver, 0)
        + sqlfunc.coalesce(Envio.pago_extra_manual, 0)
        + sqlfunc.coalesce(Envio.extra_producto_driver, 0)
        + sqlfunc.coalesce(Envio.extra_comuna_driver, 0)
    )


def _health_score(avg_diario_mes: float, meses_activo_6: int, delta_pct: float, tier: str) -> int:
    """
    Score 0-100.
    Recencia/consistencia (35%): meses_activo_6 / 6
    Tendencia (30%): -1..+1 normalizado de delta_pct clamped a [-50, +50]
    Tier/valor (35%): EPICO=100, CLAVE=80, DESTACADO=68, BUENO=55, NORMAL=30
    """
    consistencia = min(meses_activo_6 / 6, 1.0)
    tendencia_norm = max(-1.0, min(1.0, delta_pct / 50.0))
    tendencia_score = (tendencia_norm + 1) / 2  # 0..1
    tier_scores = {"EPICO": 1.0, "CLAVE": 0.8, "DESTACADO": 0.68, "BUENO": 0.55, "NORMAL": 0.3}
    tier_score = tier_scores.get(tier, 0.3)

    raw = (consistencia * 35) + (tendencia_score * 30) + (tier_score * 35)
    return max(0, min(100, round(raw)))


# ---------------------------------------------------------------------------
# Endpoint: tiers de sellers
# ---------------------------------------------------------------------------
@router.get("/tiers")
def sellers_tiers(
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Clasifica todos los sellers activos en tiers según volumen diario promedio."""
    hoy = date.today()

    # Mes actual y mes anterior para calcular tendencia
    mes_prev = mes - 1 if mes > 1 else 12
    anio_prev = anio if mes > 1 else anio - 1

    # Agregado mes actual
    cur = db.query(
        Envio.seller_id,
        sqlfunc.count(Envio.id).label("total"),
        sqlfunc.count(sqlfunc.distinct(Envio.fecha_entrega)).label("dias"),
        sqlfunc.sum(_ingreso_expr()).label("ingreso"),
        sqlfunc.sum(_costo_expr()).label("costo"),
        sqlfunc.max(Envio.fecha_entrega).label("ultimo_envio"),
    ).filter(
        Envio.mes == mes, Envio.anio == anio,
        Envio.seller_id.isnot(None),
    ).group_by(Envio.seller_id).all()

    # Agregado mes anterior
    prev = db.query(
        Envio.seller_id,
        sqlfunc.count(Envio.id).label("total"),
    ).filter(
        Envio.mes == mes_prev, Envio.anio == anio_prev,
        Envio.seller_id.isnot(None),
    ).group_by(Envio.seller_id).all()
    prev_map = {r.seller_id: r.total for r in prev}

    # Conteo diario por seller para calcular el mejor día (peak histórico del mes).
    # Sirve para análisis de capacidad: cuántos envíos llegó a hacer en su mejor jornada.
    daily_counts = db.query(
        Envio.seller_id,
        Envio.fecha_entrega,
        sqlfunc.count(Envio.id).label("n"),
    ).filter(
        Envio.mes == mes, Envio.anio == anio,
        Envio.seller_id.isnot(None),
    ).group_by(Envio.seller_id, Envio.fecha_entrega).all()

    seller_daily: dict = {}
    for r in daily_counts:
        seller_daily.setdefault(r.seller_id, []).append((r.fecha_entrega, r.n))
    mejor_dia_seller = {
        sid: max(lst, key=lambda t: t[1]) if lst else (None, 0)
        for sid, lst in seller_daily.items()
    }

    sellers_db = {s.id: s for s in db.query(Seller).filter(Seller.activo == True).all()}

    result = []
    for r in cur:
        seller = sellers_db.get(r.seller_id)
        if not seller:
            continue
        total = r.total or 0
        dias = max(r.dias or 1, 1)
        avg_diario = total / dias
        tier = _asignar_tier(avg_diario)

        ingreso = int(r.ingreso or 0)
        costo = int(r.costo or 0)
        margen = ingreso - costo
        margen_pct = round(margen / ingreso * 100, 1) if ingreso > 0 else 0
        margen_pp = round(margen / total) if total > 0 else 0

        prev_total = prev_map.get(r.seller_id, 0)
        delta_pct = round((total - prev_total) / prev_total * 100, 1) if prev_total > 0 else 0
        if prev_total == 0 and total > 0:
            delta_pct = 100.0
        tendencia = "CRECIENDO" if delta_pct > 5 else ("BAJANDO" if delta_pct < -5 else "ESTABLE")

        mejor_fecha, mejor_n = mejor_dia_seller.get(r.seller_id, (None, 0))
        result.append({
            "seller_id": r.seller_id,
            "nombre": seller.nombre,
            "empresa": seller.empresa or "ECOURIER",
            "tier": tier,
            "avg_diario": round(avg_diario, 1),
            "mejor_dia": mejor_n,
            "mejor_dia_fecha": mejor_fecha.isoformat() if mejor_fecha else None,
            "total_mes": total,
            "dias_activos": dias,
            "ingreso_mes": ingreso,
            "costo_mes": costo,
            "margen_mes": margen,
            "margen_pct": margen_pct,
            "margen_pp": margen_pp,
            "prev_total": prev_total,
            "delta_pct": delta_pct,
            "tendencia": tendencia,
            "ultimo_envio": r.ultimo_envio.isoformat() if r.ultimo_envio else None,
        })

    # ── Aplicar agrupaciones analytics ──────────────────────────────────────
    # Para grupos, el "mejor día" es la fecha donde la suma de envíos de TODOS los
    # sellers del grupo es máxima (no el max individual de cualquier miembro).
    group_daily: dict = {}
    for sid, lst in seller_daily.items():
        seller_obj = sellers_db.get(sid)
        if not seller_obj:
            continue
        gname = group_seller(seller_obj.nombre)
        bucket = group_daily.setdefault(gname, {})
        for fecha, n in lst:
            bucket[fecha] = bucket.get(fecha, 0) + n

    _tier_groups: dict = {}
    for row in result:
        gname = group_seller(row["nombre"])
        if gname not in _tier_groups:
            _tier_groups[gname] = {
                **row,
                "nombre": gname,
                "es_grupo": gname != row["nombre"],
                "grupo_nombre": gname if gname != row["nombre"] else None,
                "seller_id": None if gname != row["nombre"] else row["seller_id"],
            }
        else:
            g = _tier_groups[gname]
            g["total_mes"] += row["total_mes"]
            g["dias_activos"] = max(g["dias_activos"], row["dias_activos"])
            g["ingreso_mes"] += row["ingreso_mes"]
            g["costo_mes"] += row["costo_mes"]
            g["prev_total"] += row["prev_total"]
            if row["ultimo_envio"] and (not g["ultimo_envio"] or row["ultimo_envio"] > g["ultimo_envio"]):
                g["ultimo_envio"] = row["ultimo_envio"]
            # Recalculate derived fields
            g["margen_mes"] = g["ingreso_mes"] - g["costo_mes"]
            g["margen_pct"] = round(g["margen_mes"] / g["ingreso_mes"] * 100, 1) if g["ingreso_mes"] else 0
            g["avg_diario"] = round(g["total_mes"] / max(g["dias_activos"], 1), 1)
            g["tier"] = _asignar_tier(g["avg_diario"])
            g["margen_pp"] = round(g["margen_mes"] / g["total_mes"]) if g["total_mes"] else 0
            g["delta_pct"] = round((g["total_mes"] - g["prev_total"]) / g["prev_total"] * 100, 1) if g["prev_total"] else (100.0 if g["total_mes"] else 0)
            g["tendencia"] = "CRECIENDO" if g["delta_pct"] > 5 else ("BAJANDO" if g["delta_pct"] < -5 else "ESTABLE")

    for g in _tier_groups.values():
        bucket = group_daily.get(g["nombre"]) or {}
        if bucket:
            mejor_fecha, mejor_n = max(bucket.items(), key=lambda kv: kv[1])
            g["mejor_dia"] = mejor_n
            g["mejor_dia_fecha"] = mejor_fecha.isoformat()
        else:
            g["mejor_dia"] = 0
            g["mejor_dia_fecha"] = None

    result = list(_tier_groups.values())
    result.sort(key=lambda x: (TIER_ORDER.get(x["tier"], 9), -x["avg_diario"]))

    # Resumen por tier
    resumen_tiers = {}
    for tier_key, meta in TIER_META.items():
        members = [s for s in result if s["tier"] == tier_key]
        resumen_tiers[tier_key] = {
            **meta,
            "count": len(members),
            "total_paquetes": sum(s["total_mes"] for s in members),
            "total_ingreso": sum(s["ingreso_mes"] for s in members),
            "total_margen": sum(s["margen_mes"] for s in members),
            "avg_diario_tier": round(sum(s["avg_diario"] for s in members) / len(members), 1) if members else 0,
        }

    return {
        "mes": mes, "anio": anio,
        "sellers": result,
        "resumen_tiers": resumen_tiers,
        "total_sellers": len(result),
    }


# ---------------------------------------------------------------------------
# Shared helper: computes perfil data for a list of seller IDs
# ---------------------------------------------------------------------------
def _perfil_data(seller_ids: list, seller_info: dict, mes: int, anio: int, db):
    """Returns full perfil dict for a set of seller IDs (individual or group)."""
    from fastapi import HTTPException
    mes_prev = mes - 1 if mes > 1 else 12
    anio_prev = anio if mes > 1 else anio - 1
    f_cur = [Envio.seller_id.in_(seller_ids), Envio.mes == mes, Envio.anio == anio]
    f_prev = [Envio.seller_id.in_(seller_ids), Envio.mes == mes_prev, Envio.anio == anio_prev]

    cur = db.query(
        sqlfunc.count(Envio.id).label("total"),
        sqlfunc.count(sqlfunc.distinct(Envio.fecha_entrega)).label("dias"),
        sqlfunc.sum(_ingreso_expr()).label("ingreso"),
        sqlfunc.sum(_costo_expr()).label("costo"),
        sqlfunc.max(Envio.fecha_entrega).label("ultimo_envio"),
    ).filter(*f_cur).first()

    prev_cur = db.query(
        sqlfunc.count(Envio.id).label("total"),
        sqlfunc.sum(_ingreso_expr()).label("ingreso"),
    ).filter(*f_prev).first()

    total = cur.total or 0
    dias = max(cur.dias or 1, 1)
    avg_diario = total / dias
    ingreso = int(cur.ingreso or 0)
    costo = int(cur.costo or 0)
    margen = ingreso - costo
    margen_pct = round(margen / ingreso * 100, 1) if ingreso > 0 else 0
    margen_pp = round(margen / total) if total > 0 else 0

    prev_total = prev_cur.total or 0
    prev_ingreso = int(prev_cur.ingreso or 0)
    delta_pct = round((total - prev_total) / prev_total * 100, 1) if prev_total > 0 else 0
    if prev_total == 0 and total > 0:
        delta_pct = 100.0

    tier = _asignar_tier(avg_diario)

    anio_desde = max(anio - 2, 2024)
    trend_rows = db.query(
        Envio.mes, Envio.anio,
        sqlfunc.count(Envio.id).label("total"),
        sqlfunc.sum(_ingreso_expr()).label("ingreso"),
        sqlfunc.sum(_costo_expr()).label("costo"),
    ).filter(
        Envio.seller_id.in_(seller_ids),
        (Envio.anio > anio_desde) | ((Envio.anio == anio_desde) & (Envio.mes >= mes)),
        (Envio.anio < anio) | ((Envio.anio == anio) & (Envio.mes <= mes)),
    ).group_by(Envio.mes, Envio.anio).order_by(Envio.anio, Envio.mes).all()

    tendencia_mensual = [
        {
            "mes": r.mes, "anio": r.anio, "label": f"{r.mes}/{r.anio}",
            "total": r.total or 0, "ingreso": int(r.ingreso or 0),
            "costo": int(r.costo or 0),
            "margen": int((r.ingreso or 0) - (r.costo or 0)),
        }
        for r in trend_rows
    ]

    meses_activo_6 = sum(1 for r in tendencia_mensual[-6:] if r["total"] > 0)
    health = _health_score(avg_diario, meses_activo_6, delta_pct, tier)

    comunas_rows = db.query(
        Envio.comuna, sqlfunc.count(Envio.id).label("total"),
    ).filter(*f_cur, Envio.comuna.isnot(None),
    ).group_by(Envio.comuna).order_by(sqlfunc.count(Envio.id).desc()).limit(10).all()
    top_comunas = [{"comuna": r.comuna.title() if r.comuna else "—", "total": r.total} for r in comunas_rows]

    rutas_rows = db.query(
        Envio.ruta_nombre, sqlfunc.count(Envio.id).label("total"),
    ).filter(*f_cur, Envio.ruta_nombre.isnot(None),
    ).group_by(Envio.ruta_nombre).order_by(sqlfunc.count(Envio.id).desc()).limit(10).all()
    top_rutas = [{"ruta": r.ruta_nombre or "—", "total": r.total} for r in rutas_rows]

    semanas_rows = db.query(
        Envio.semana, sqlfunc.count(Envio.id).label("total"),
        sqlfunc.sum(_ingreso_expr()).label("ingreso"),
        sqlfunc.sum(_costo_expr()).label("costo"),
    ).filter(*f_cur).group_by(Envio.semana).order_by(Envio.semana).all()
    semanas_detalle = [
        {"semana": r.semana, "total": r.total or 0, "ingreso": int(r.ingreso or 0),
         "costo": int(r.costo or 0), "margen": int((r.ingreso or 0) - (r.costo or 0))}
        for r in semanas_rows
    ]

    mejor = max(tendencia_mensual, key=lambda x: x["total"], default=None)

    return {
        "seller": seller_info,
        "mes": mes, "anio": anio,
        "tier": tier, "tier_meta": TIER_META.get(tier, {}),
        "health_score": health,
        "kpis": {
            "total_mes": total, "avg_diario": round(avg_diario, 1),
            "dias_activos": dias, "ingreso_mes": ingreso, "costo_mes": costo,
            "margen_mes": margen, "margen_pct": margen_pct, "margen_pp": margen_pp,
            "prev_total": prev_total, "prev_ingreso": prev_ingreso,
            "delta_pct": delta_pct,
            "tendencia": "CRECIENDO" if delta_pct > 5 else ("BAJANDO" if delta_pct < -5 else "ESTABLE"),
        },
        "tendencia_mensual": tendencia_mensual,
        "top_comunas": top_comunas,
        "top_rutas": top_rutas,
        "semanas_detalle": semanas_detalle,
        "mejor_mes": mejor,
        "meses_activo_6": meses_activo_6,
        "ultimo_envio": cur.ultimo_envio.isoformat() if cur.ultimo_envio else None,
    }


# ---------------------------------------------------------------------------
# Endpoint: perfil completo de un seller
# ---------------------------------------------------------------------------
@router.get("/seller/{seller_id}/perfil")
def seller_perfil(
    seller_id: int,
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """One-page profile: KPIs, tendencia 24 meses, comunas, rutas, semanas.
    If the seller belongs to an analytics group, returns aggregated group data."""
    from fastapi import HTTPException
    seller = db.get(Seller, seller_id)
    if not seller:
        raise HTTPException(404, "Seller no encontrado")

    grupo = group_seller(seller.nombre or "")
    if grupo != seller.nombre:
        # Delegate to group profile
        seller_ids = get_group_seller_ids(grupo, db)
        seller_info = {
            "id": None, "nombre": grupo, "empresa": seller.empresa or "ECOURIER",
            "rut": None, "zona": seller.zona, "activo": True, "es_grupo": True,
        }
    else:
        seller_ids = [seller_id]
        seller_info = {
            "id": seller.id, "nombre": seller.nombre,
            "empresa": seller.empresa or "ECOURIER",
            "rut": seller.rut, "zona": seller.zona, "activo": seller.activo, "es_grupo": False,
            "tipo_cierre": seller.tipo_cierre,
            "fecha_cierre": seller.fecha_cierre.isoformat() if seller.fecha_cierre else None,
            "fecha_pausa_fin": seller.fecha_pausa_fin.isoformat() if seller.fecha_pausa_fin else None,
            "razones_cierre": seller.razones_cierre or [],
            "potencial_recuperacion": seller.potencial_recuperacion,
        }

    return _perfil_data(seller_ids, seller_info, mes, anio, db)


# ---------------------------------------------------------------------------
# Endpoint: perfil de grupo analítico
# ---------------------------------------------------------------------------
@router.get("/grupo/{grupo_nombre}/perfil")
def grupo_perfil(
    grupo_nombre: str,
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Perfil agregado para un grupo analítico (ej. 'Nuevo Genesis', 'Alca', 'Ragnar Chile')."""
    from fastapi import HTTPException
    from urllib.parse import unquote
    grupo_nombre = unquote(grupo_nombre)
    seller_ids = get_group_seller_ids(grupo_nombre, db)
    if not seller_ids:
        raise HTTPException(404, f"Grupo '{grupo_nombre}' no encontrado o sin sellers")

    seller_info = {
        "id": None, "nombre": grupo_nombre, "empresa": "—",
        "rut": None, "zona": None, "activo": True, "es_grupo": True,
    }
    return _perfil_data(seller_ids, seller_info, mes, anio, db)


# ---------------------------------------------------------------------------
# Motor 4 — Gestión Comercial (CRM liviano) por seller
# ---------------------------------------------------------------------------
from pydantic import BaseModel as PydanticBase
from typing import Optional as Opt


class GestionEntradaCreate(PydanticBase):
    fecha: str                       # ISO date string
    tipo: str                        # llamada | email | reunion | whatsapp | visita | interno | otro
    estado: Opt[str] = None          # en_gestion | activo | recuperado | perdido | en_pausa | seguimiento
    razon: Opt[str] = None
    nota: Opt[str] = None
    recordatorio: Opt[str] = None    # ISO date string or null
    usuario: Opt[str] = None


@router.get("/seller/{seller_id}/gestion")
def get_gestion(
    seller_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    entries = (
        db.query(GestionComercialEntry)
        .filter(GestionComercialEntry.seller_id == seller_id)
        .order_by(GestionComercialEntry.fecha.desc(), GestionComercialEntry.created_at.desc())
        .all()
    )
    return [
        {
            "id": e.id,
            "fecha": e.fecha.isoformat() if e.fecha else None,
            "usuario": e.usuario,
            "tipo": e.tipo,
            "estado": e.estado,
            "razon": e.razon,
            "nota": e.nota,
            "recordatorio": e.recordatorio.isoformat() if e.recordatorio else None,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in entries
    ]


@router.post("/seller/{seller_id}/gestion", status_code=201)
def add_gestion(
    seller_id: int,
    body: GestionEntradaCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin_or_administracion),
):
    from fastapi import HTTPException
    from datetime import date as _date
    seller = db.get(Seller, seller_id)
    if not seller:
        raise HTTPException(404, "Seller no encontrado")

    entry = GestionComercialEntry(
        seller_id=seller_id,
        fecha=_date.fromisoformat(body.fecha) if body.fecha else _date.today(),
        tipo=body.tipo,
        estado=body.estado,
        razon=body.razon,
        nota=body.nota,
        recordatorio=_date.fromisoformat(body.recordatorio) if body.recordatorio else None,
        usuario=body.usuario or getattr(current_user, "nombre", None) or getattr(current_user, "email", None),
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return {"id": entry.id, "ok": True}


@router.delete("/seller/{seller_id}/gestion/{entry_id}", status_code=200)
def delete_gestion(
    seller_id: int,
    entry_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    from fastapi import HTTPException
    entry = db.query(GestionComercialEntry).filter(
        GestionComercialEntry.id == entry_id,
        GestionComercialEntry.seller_id == seller_id,
    ).first()
    if not entry:
        raise HTTPException(404, "Entrada no encontrada")
    db.delete(entry)
    db.commit()
    return {"ok": True}


# ── Ingresos Drivers ─────────────────────────────────────────────────

def _semanas_liquidadas(db: Session, mes: int, anio: int) -> list[int]:
    """Semanas que tienen al menos 1 envío con is_liquidado=True."""
    rows = db.query(distinct(Envio.semana)).filter(
        Envio.mes == mes, Envio.anio == anio, Envio.is_liquidado == True,
    ).all()
    return sorted(r[0] for r in rows)


def _semanas_con_datos(db: Session, mes: int, anio: int) -> list[int]:
    """Semanas que tienen al menos 1 envío (para meses históricos sin flag)."""
    rows = db.query(distinct(Envio.semana)).filter(
        Envio.mes == mes, Envio.anio == anio, Envio.driver_id.isnot(None),
    ).all()
    return sorted(r[0] for r in rows)


def _ingresos_por_semanas(db: Session, driver_ids: list[int], mes: int, anio: int, semanas: list[int] = None):
    """
    Calcula ingresos para un período (mes/año) truncado a las semanas indicadas.
    Si semanas=None, toma todas.
    Retorna dict { driver_id: { ganancia, entregas, promedio } }
    """
    sem_filter = [Envio.semana.in_(semanas)] if semanas else []

    envio_rows = db.query(
        Envio.driver_id,
        sqlfunc.sum(Envio.costo_driver + Envio.pago_extra_manual).label("t_base"),
        sqlfunc.sum(Envio.extra_producto_driver).label("t_prod"),
        sqlfunc.sum(Envio.extra_comuna_driver).label("t_com"),
        sqlfunc.count(Envio.id).label("cant"),
    ).filter(
        Envio.driver_id.in_(driver_ids),
        Envio.mes == mes, Envio.anio == anio,
        *sem_filter,
    ).group_by(Envio.driver_id).all()

    data = {}
    for r in envio_rows:
        data[r.driver_id] = {
            "base": r.t_base or 0,
            "extras": (r.t_prod or 0) + (r.t_com or 0),
            "entregas": r.cant,
        }

    retiro_rows = db.query(
        Retiro.driver_id,
        sqlfunc.sum(Retiro.tarifa_driver).label("t_ret"),
    ).filter(
        Retiro.driver_id.in_(driver_ids),
        Retiro.mes == mes, Retiro.anio == anio,
        *([Retiro.semana.in_(semanas)] if semanas else []),
    ).group_by(Retiro.driver_id).all()

    for r in retiro_rows:
        if r.driver_id in data:
            data[r.driver_id]["retiros"] = r.t_ret or 0
        else:
            data[r.driver_id] = {"base": 0, "extras": 0, "entregas": 0, "retiros": r.t_ret or 0}

    ajuste_rows = db.query(
        AjusteLiquidacion.entidad_id,
        sqlfunc.sum(AjusteLiquidacion.monto).label("t_aj"),
    ).filter(
        AjusteLiquidacion.tipo == TipoEntidadEnum.DRIVER,
        AjusteLiquidacion.entidad_id.in_(driver_ids),
        AjusteLiquidacion.mes == mes, AjusteLiquidacion.anio == anio,
        *([AjusteLiquidacion.semana.in_(semanas)] if semanas else []),
    ).group_by(AjusteLiquidacion.entidad_id).all()

    for r in ajuste_rows:
        if r.entidad_id in data:
            data[r.entidad_id]["ajustes"] = r.t_aj or 0
        else:
            data[r.entidad_id] = {"base": 0, "extras": 0, "entregas": 0, "ajustes": r.t_aj or 0}

    result = {}
    for did, vals in data.items():
        g = vals["base"] + vals["extras"] + vals.get("retiros", 0) + vals.get("ajustes", 0)
        result[did] = {
            "ganancia": g,
            "entregas": vals["entregas"],
            "promedio": round(g / vals["entregas"]) if vals["entregas"] else 0,
        }
    return result


def _ingresos_mensuales_bulk(db: Session, driver_ids: list[int] = None):
    """
    Retorna ingresos mensuales (completos) agrupados por driver_id.
    Se usa para la tabla histórica y sparklines, sin truncamiento.
    """
    filters = []
    if driver_ids:
        filters.append(Envio.driver_id.in_(driver_ids))

    envio_rows = db.query(
        Envio.driver_id, Envio.mes, Envio.anio,
        sqlfunc.sum(Envio.costo_driver + Envio.pago_extra_manual).label("t_base"),
        sqlfunc.sum(Envio.extra_producto_driver).label("t_prod"),
        sqlfunc.sum(Envio.extra_comuna_driver).label("t_com"),
        sqlfunc.count(Envio.id).label("cant"),
    ).filter(
        Envio.driver_id.isnot(None), *filters
    ).group_by(Envio.driver_id, Envio.mes, Envio.anio).all()

    data: dict = {}
    for r in envio_rows:
        key = (r.driver_id, r.mes, r.anio)
        data[key] = {
            "base": r.t_base or 0,
            "extras": (r.t_prod or 0) + (r.t_com or 0),
            "entregas": r.cant,
        }

    retiro_rows = db.query(
        Retiro.driver_id, Retiro.mes, Retiro.anio,
        sqlfunc.sum(Retiro.tarifa_driver).label("t_ret"),
    ).filter(
        Retiro.driver_id.isnot(None),
        *([Retiro.driver_id.in_(driver_ids)] if driver_ids else []),
    ).group_by(Retiro.driver_id, Retiro.mes, Retiro.anio).all()

    for r in retiro_rows:
        key = (r.driver_id, r.mes, r.anio)
        if key in data:
            data[key]["retiros"] = r.t_ret or 0
        else:
            data[key] = {"base": 0, "extras": 0, "entregas": 0, "retiros": r.t_ret or 0}

    ajuste_rows = db.query(
        AjusteLiquidacion.entidad_id,
        AjusteLiquidacion.mes, AjusteLiquidacion.anio,
        sqlfunc.sum(AjusteLiquidacion.monto).label("t_aj"),
    ).filter(
        AjusteLiquidacion.tipo == TipoEntidadEnum.DRIVER,
        *([AjusteLiquidacion.entidad_id.in_(driver_ids)] if driver_ids else []),
    ).group_by(AjusteLiquidacion.entidad_id, AjusteLiquidacion.mes, AjusteLiquidacion.anio).all()

    for r in ajuste_rows:
        key = (r.entidad_id, r.mes, r.anio)
        if key in data:
            data[key]["ajustes"] = r.t_aj or 0
        else:
            data[key] = {"base": 0, "extras": 0, "entregas": 0, "ajustes": r.t_aj or 0}

    result: dict[int, list] = {}
    for (did, mes, anio), vals in sorted(data.items(), key=lambda x: (x[0][2], x[0][1])):
        ganancia = vals["base"] + vals["extras"] + vals.get("retiros", 0) + vals.get("ajustes", 0)
        entry = {
            "mes": mes, "anio": anio,
            "entregas": vals["entregas"],
            "ganancia": ganancia,
            "promedio": round(ganancia / vals["entregas"]) if vals["entregas"] else 0,
        }
        result.setdefault(did, []).append(entry)

    return result


def _prev_month(mes: int, anio: int):
    return (mes - 1, anio) if mes > 1 else (12, anio - 1)


def _calc_var(current_val: int, compare_val: int):
    if not compare_val:
        return None
    return round((current_val - compare_val) / compare_val * 100, 1)


@router.get("/ingresos/driver/{driver_id}")
def ingresos_driver(
    driver_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Historial de ingresos mensuales de un driver con variaciones MoM y YoY comparables."""
    driver = db.get(Driver, driver_id)
    if not driver:
        from fastapi import HTTPException
        raise HTTPException(404, "Driver no encontrado")

    all_data = _ingresos_mensuales_bulk(db, driver_ids=[driver_id])
    meses = sorted(all_data.get(driver_id, []), key=lambda x: (x["anio"], x["mes"]))

    sem_liq_cache: dict = {}

    def get_semanas_liq(m: int, a: int) -> list[int]:
        if (m, a) not in sem_liq_cache:
            sem_liq_cache[(m, a)] = _semanas_liquidadas(db, m, a)
        return sem_liq_cache[(m, a)]

    for m in meses:
        semanas_guia = get_semanas_liq(m["mes"], m["anio"])
        es_parcial = len(semanas_guia) > 0 and len(semanas_guia) < len(_semanas_con_datos(db, m["mes"], m["anio"]))

        if es_parcial and semanas_guia:
            current_trunc = _ingresos_por_semanas(db, [driver_id], m["mes"], m["anio"], semanas_guia)
            cur_g = current_trunc.get(driver_id, {}).get("ganancia", m["ganancia"])

            pm, pa = _prev_month(m["mes"], m["anio"])
            prev_trunc = _ingresos_por_semanas(db, [driver_id], pm, pa, semanas_guia)
            prev_g = prev_trunc.get(driver_id, {}).get("ganancia", 0)
            m["var_mom"] = _calc_var(cur_g, prev_g)

            yoy_trunc = _ingresos_por_semanas(db, [driver_id], m["mes"], m["anio"] - 1, semanas_guia)
            yoy_g = yoy_trunc.get(driver_id, {}).get("ganancia", 0)
            m["var_yoy"] = _calc_var(cur_g, yoy_g)

            m["parcial"] = True
            m["semanas_comparadas"] = len(semanas_guia)
        else:
            lookup = {(x["anio"], x["mes"]): x for x in meses}
            pm, pa = _prev_month(m["mes"], m["anio"])
            prev = lookup.get((pa, pm))
            m["var_mom"] = _calc_var(m["ganancia"], prev["ganancia"]) if prev else None

            yoy = lookup.get((m["anio"] - 1, m["mes"]))
            m["var_yoy"] = _calc_var(m["ganancia"], yoy["ganancia"]) if yoy else None

            m["parcial"] = False

    total_ganancia = sum(m["ganancia"] for m in meses)
    total_entregas = sum(m["entregas"] for m in meses)

    stats = {
        "total_meses": len(meses),
        "ganancia_total": total_ganancia,
        "entregas_total": total_entregas,
        "promedio_mensual": round(total_ganancia / len(meses)) if meses else 0,
        "promedio_por_entrega": round(total_ganancia / total_entregas) if total_entregas else 0,
        "mejor_mes": max(meses, key=lambda x: x["ganancia"]) if meses else None,
        "peor_mes": min(meses, key=lambda x: x["ganancia"]) if meses else None,
    }

    return {
        "driver": {"id": driver.id, "nombre": driver.nombre, "zona": driver.zona, "contratado": driver.contratado},
        "meses": meses,
        "stats": stats,
    }


@router.get("/ingresos/drivers")
def ingresos_drivers_ranking(
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """
    Ranking de ingresos con comparaciones MoM/YoY por períodos equivalentes.
    Usa semanas liquidadas del mes actual como guía.
    """
    drivers = db.query(Driver).filter(Driver.activo == True).all()
    driver_ids = [d.id for d in drivers]
    driver_map = {d.id: d for d in drivers}

    semanas_guia = _semanas_liquidadas(db, mes, anio)
    todas_semanas = _semanas_con_datos(db, mes, anio)
    es_parcial = len(semanas_guia) > 0 and len(semanas_guia) < len(todas_semanas)

    if es_parcial and semanas_guia:
        current_data = _ingresos_por_semanas(db, driver_ids, mes, anio, semanas_guia)
        pm, pa = _prev_month(mes, anio)
        prev_data = _ingresos_por_semanas(db, driver_ids, pm, pa, semanas_guia)
        yoy_data = _ingresos_por_semanas(db, driver_ids, mes, anio - 1, semanas_guia)
    else:
        current_data = _ingresos_por_semanas(db, driver_ids, mes, anio)
        pm, pa = _prev_month(mes, anio)
        prev_data = _ingresos_por_semanas(db, driver_ids, pm, pa)
        yoy_data = _ingresos_por_semanas(db, driver_ids, mes, anio - 1)

    all_data = _ingresos_mensuales_bulk(db, driver_ids=driver_ids)

    ranking = []
    for did in driver_ids:
        cur = current_data.get(did)
        if not cur:
            continue

        prev = prev_data.get(did)
        yoy = yoy_data.get(did)
        var_mom = _calc_var(cur["ganancia"], prev["ganancia"]) if prev else None
        var_yoy = _calc_var(cur["ganancia"], yoy["ganancia"]) if yoy else None

        meses_data = sorted(all_data.get(did, []), key=lambda x: (x["anio"], x["mes"]))
        lookup = {(m["anio"], m["mes"]): m for m in meses_data}
        spark_months = []
        for i in range(5, -1, -1):
            sm, sa = mes - i, anio
            while sm <= 0:
                sm += 12
                sa -= 1
            sp = lookup.get((sa, sm))
            spark_months.append(sp["ganancia"] if sp else 0)

        d = driver_map[did]
        ranking.append({
            "driver_id": did,
            "nombre": d.nombre,
            "zona": d.zona or "",
            "contratado": d.contratado,
            "entregas": cur["entregas"],
            "ganancia": cur["ganancia"],
            "promedio": cur["promedio"],
            "var_mom": var_mom,
            "var_yoy": var_yoy,
            "spark": spark_months,
        })

    ranking.sort(key=lambda x: x["ganancia"], reverse=True)

    totals = {
        "total_drivers": len(ranking),
        "ganancia_total": sum(r["ganancia"] for r in ranking),
        "entregas_total": sum(r["entregas"] for r in ranking),
        "promedio_ganancia": round(sum(r["ganancia"] for r in ranking) / len(ranking)) if ranking else 0,
        "promedio_entregas": round(sum(r["entregas"] for r in ranking) / len(ranking)) if ranking else 0,
        "creciendo": sum(1 for r in ranking if r["var_mom"] and r["var_mom"] > 2),
        "cayendo": sum(1 for r in ranking if r["var_mom"] and r["var_mom"] < -2),
        "estable": sum(1 for r in ranking if r["var_mom"] is not None and -2 <= r["var_mom"] <= 2),
    }

    alertas = []
    for r in ranking:
        if r["var_mom"] is not None and r["var_mom"] < -15:
            alertas.append({"driver": r["nombre"], "tipo": "caida_fuerte", "valor": r["var_mom"]})

    return {
        "ranking": ranking,
        "totals": totals,
        "alertas": alertas,
        "comparacion": {
            "parcial": es_parcial,
            "semanas_comparadas": len(semanas_guia) if es_parcial else len(todas_semanas),
            "semanas_totales": len(todas_semanas),
        },
    }


# ═════════════════════════════════════════════════════════════════════════════
# Efectividad V2 — BI dashboard de "Same-Day Deliveries"
# ═════════════════════════════════════════════════════════════════════════════
#
# A diferencia de /efectividad (V1) que parte del universo Envio y mide ciclo
# de entrega, este conjunto de endpoints parte del universo AsignacionRuta
# (datos del courier sobre paquetes que efectivamente SALIERON a ruta) y
# habilita las 6 KPIs canónicas del dashboard nuevo:
#
#   1. Paquetes a ruta            COUNT(DISTINCT tracking_id) cancelados excluidos
#   2. Paquetes entregados        DISTINCT trackings con fecha_entrega presente
#   3. % Same-Day                 entregas con fecha_entrega == withdrawal_date
#                                 (0 días hábiles entre retiro y entrega)
#   4. Delivery Success Rate      entregados / a_ruta
#   5. First-Attempt Delivery Rate entregados con intento_nro=1 / a_ruta
#   6. Cancelados (informativo)   COUNT trackings cancelados externamente
#
# Definición canónica de "Same-Day":
#   business_days(fecha_retiro, fecha_entrega) == 0
#   (i.e. fecha_entrega == withdrawal_date para días Lun-Vie; viernes→lunes
#   NO es same-day porque tiene 1 día hábil de diferencia.)
# ═════════════════════════════════════════════════════════════════════════════


def _rango_default(mes: Optional[int], anio: Optional[int],
                   fecha_inicio: Optional[str], fecha_fin: Optional[str]) -> tuple[date, date]:
    """Resuelve el rango [inicio, fin] a partir de los parámetros del request."""
    if fecha_inicio and fecha_fin:
        try:
            return (datetime.strptime(fecha_inicio, "%Y-%m-%d").date(),
                    datetime.strptime(fecha_fin, "%Y-%m-%d").date())
        except ValueError:
            pass
    hoy = date.today()
    m = mes or hoy.month
    a = anio or hoy.year
    inicio = date(a, m, 1)
    if m == 12:
        fin = date(a + 1, 1, 1)
    else:
        fin = date(a, m + 1, 1)
    from datetime import timedelta
    return inicio, fin - timedelta(days=1)


def _ratio(num: int, den: int) -> float:
    return round(num / den * 100, 1) if den else 0.0


# ── Exclusiones de efectividad ───────────────────────────────────────────────
# Sellers / drivers que NO deben contar en NINGUNA métrica de efectividad
# (dashboards globales, drill-downs, mapa, KPIs).
# Ej.: "Global Courier" es un seller administrativo, "Benitez César" hace
# repartos especiales que distorsionan el promedio.
EFECTIVIDAD_SELLERS_EXCLUIDOS: set[int] = {114}              # Global Courier
EFECTIVIDAD_DRIVERS_EXCLUIDOS: set[int] = {96, 66, 154, 108}  # Benitez César, Wilmer (Sequea), Millenium, Move


def _aplicar_exclusiones(q):
    """Excluye sellers y drivers que no deben participar en métricas v2.

    El driver_id se excluye en la propia AsignacionRuta. El seller se excluye
    via Envio.seller_id (homologado por la ingesta), que cubre ~99% de las
    asignaciones reconciliadas.
    """
    if EFECTIVIDAD_DRIVERS_EXCLUIDOS:
        q = q.filter(
            (AsignacionRuta.driver_id.is_(None))
            | (~AsignacionRuta.driver_id.in_(EFECTIVIDAD_DRIVERS_EXCLUIDOS))
        )
    if EFECTIVIDAD_SELLERS_EXCLUIDOS:
        q = q.filter(
            (Envio.seller_id.is_(None))
            | (~Envio.seller_id.in_(EFECTIVIDAD_SELLERS_EXCLUIDOS))
        )
    return q


def _kpis_v2_base_query(db: Session, fecha_inicio: date, fecha_fin: date,
                        driver_id: Optional[int] = None,
                        seller_code: Optional[str] = None,
                        aplicar_exclusiones: bool = True):
    """Query base sobre AsignacionRuta + Envio (LEFT JOIN) en el rango pedido.

    Por defecto aplica las exclusiones globales de efectividad. Pásale
    `aplicar_exclusiones=False` cuando el caller necesita ver al excluido
    explícitamente (p.ej. en su propio drill-down).
    """
    q = db.query(AsignacionRuta, Envio).outerjoin(
        Envio, AsignacionRuta.envio_id == Envio.id
    ).filter(
        AsignacionRuta.withdrawal_date >= fecha_inicio,
        AsignacionRuta.withdrawal_date <= fecha_fin,
    )
    if driver_id is not None:
        q = q.filter(AsignacionRuta.driver_id == driver_id)
    if seller_code:
        q = q.filter(AsignacionRuta.seller_code == seller_code)
    if aplicar_exclusiones:
        q = _aplicar_exclusiones(q)
    return q


def _calcular_kpis_v2(asignaciones: list, *, incluir_buckets: bool = False) -> dict:
    """Compute the 6 canonical KPIs from a list of (AsignacionRuta, Envio) tuples.

    `incluir_buckets`: if True, also returns counts of cycle-day buckets
    (0d / 1d / 2d / 3d / 4+d) for distribution charts.
    """
    by_tracking: dict[str, dict] = {}
    cancelados_trackings: set[str] = set()
    intentos_totales = 0

    for asig, envio in asignaciones:
        tid = asig.tracking_id
        intentos_totales += 1

        if asig.estado_calculado == "cancelado":
            cancelados_trackings.add(tid)
            continue

        entry = by_tracking.setdefault(tid, {
            "intento_min": asig.intento_nro,
            "entregado": False,
            "entregado_intento_nro": None,
            "same_day": False,
            "ciclo_dias": None,
        })
        entry["intento_min"] = min(entry["intento_min"], asig.intento_nro)

        if envio is not None and envio.fecha_entrega is not None:
            entry["entregado"] = True
            if entry["entregado_intento_nro"] is None:
                entry["entregado_intento_nro"] = asig.intento_nro
            else:
                entry["entregado_intento_nro"] = min(entry["entregado_intento_nro"], asig.intento_nro)

            if envio.fecha_retiro is not None:
                ciclo = _business_days_between(envio.fecha_retiro, envio.fecha_entrega)
                if entry["ciclo_dias"] is None or (ciclo is not None and ciclo < entry["ciclo_dias"]):
                    entry["ciclo_dias"] = ciclo
                if ciclo == 0:
                    entry["same_day"] = True

    paquetes_a_ruta = len(by_tracking)
    cancelados = len(cancelados_trackings - set(by_tracking.keys()))
    entregados = sum(1 for v in by_tracking.values() if v["entregado"])
    same_day = sum(1 for v in by_tracking.values() if v["same_day"])
    primer_intento_ok = sum(
        1 for v in by_tracking.values()
        if v["entregado"] and v["entregado_intento_nro"] == 1
    )

    # Para % same-day usamos el universo de "a ruta" (excluye cancelados).
    out = {
        "paquetes_a_ruta": paquetes_a_ruta,
        "intentos_totales": intentos_totales,
        "paquetes_entregados": entregados,
        "same_day": same_day,
        "cancelados": cancelados,
        "primer_intento_ok": primer_intento_ok,
        "pct_same_day": _ratio(same_day, paquetes_a_ruta),
        "pct_delivery_success": _ratio(entregados, paquetes_a_ruta),
        "pct_first_attempt": _ratio(primer_intento_ok, paquetes_a_ruta),
        "pct_otif": _ratio(same_day, paquetes_a_ruta),  # alias same-day por ahora
    }

    if incluir_buckets:
        c0 = c1 = c2 = c3 = c4 = 0
        for v in by_tracking.values():
            if not v["entregado"] or v["ciclo_dias"] is None:
                continue
            c = v["ciclo_dias"]
            if c <= 0: c0 += 1
            elif c == 1: c1 += 1
            elif c == 2: c2 += 1
            elif c == 3: c3 += 1
            else: c4 += 1
        # Para que el bucket "Mismo día" cuadre con el KPI Same-Day del header
        # usamos `paquetes_a_ruta` como denominador y agregamos un bucket
        # explícito de "sin entregar". Así los buckets suman 100% y son
        # comparables 1:1 con la métrica principal.
        sin_entregar = max(0, paquetes_a_ruta - (c0 + c1 + c2 + c3 + c4))
        denom = paquetes_a_ruta
        out["distribucion"] = {
            "n_0d": c0, "n_1d": c1, "n_2d": c2, "n_3d": c3, "n_4plus": c4,
            "n_sin_entregar": sin_entregar,
            "pct_0d": _ratio(c0, denom),
            "pct_1d": _ratio(c1, denom),
            "pct_2d": _ratio(c2, denom),
            "pct_3d": _ratio(c3, denom),
            "pct_4plus": _ratio(c4, denom),
            "pct_sin_entregar": _ratio(sin_entregar, denom),
        }
    return out


def _business_days_between(d1: date, d2: date) -> Optional[int]:
    """Días hábiles (Lun-Vie) entre dos fechas. Sigue la fórmula de _ciclo_expr.
    None si alguno es None o el resultado sería negativo."""
    if d1 is None or d2 is None:
        return None
    if d2 < d1:
        return None
    # Iterar es eficiente aquí porque los rangos son pequeños (días, no años).
    from datetime import timedelta
    total = 0
    cur = d1
    while cur < d2:
        cur = cur + timedelta(days=1)
        if cur.weekday() < 5:  # 0=Mon..4=Fri
            total += 1
    return total


@router.get("/efectividad-v2")
def efectividad_v2_global(
    mes: Optional[int] = Query(None),
    anio: Optional[int] = Query(None),
    fecha_inicio: Optional[str] = Query(None, description="YYYY-MM-DD"),
    fecha_fin: Optional[str] = Query(None, description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Dashboard global de Same-Day Deliveries.

    Devuelve KPIs principales, serie temporal por día, top sellers y top drivers
    para el rango pedido. Universo: AsignacionRuta (paquetes que salieron a ruta).
    """
    inicio, fin = _rango_default(mes, anio, fecha_inicio, fecha_fin)

    rows = _kpis_v2_base_query(db, inicio, fin).all()
    kpis_global = _calcular_kpis_v2(rows, incluir_buckets=True)

    # ── Serie temporal por día (withdrawal_date) ────────────────────────────
    por_dia_buckets: dict[date, list] = defaultdict(list)
    for asig, envio in rows:
        por_dia_buckets[asig.withdrawal_date].append((asig, envio))

    serie_temporal = []
    for d in sorted(por_dia_buckets.keys()):
        k = _calcular_kpis_v2(por_dia_buckets[d])
        serie_temporal.append({
            "fecha": d.isoformat(),
            "a_ruta": k["paquetes_a_ruta"],
            "entregados": k["paquetes_entregados"],
            "same_day": k["same_day"],
            "cancelados": k["cancelados"],
            "pct_same_day": k["pct_same_day"],
            "pct_delivery_success": k["pct_delivery_success"],
        })

    # ── Por seller (agrupado por envio.seller_id, no por seller_code crudo) ──
    # `Sellers` no tiene un campo `codigo` que matchee con el `seller_code` del
    # courier. La fuente de verdad real es la homologación que hizo `ingesta`
    # cuando creó el Envio (Envio.seller_id). Cubre ~99% de las asignaciones
    # (las que están reconciliadas con un envío).
    #
    # Construimos un lookup seller_code→seller_id desde Envio para poder
    # atribuir paquetes NO entregados (sin Envio) a su seller correcto.
    _sc_to_sid: dict[str, int] = {}
    for _r in db.query(Envio.seller_code, Envio.seller_id).filter(
        Envio.seller_code.isnot(None), Envio.seller_id.isnot(None)
    ).distinct().all():
        if _r.seller_code and _r.seller_id:
            _sc_to_sid[_r.seller_code] = _r.seller_id

    por_seller_buckets: dict[Optional[int], list] = defaultdict(list)
    for asig, envio in rows:
        if envio is not None and envio.seller_id is not None:
            sid = envio.seller_id
        elif asig.seller_code:
            sid = _sc_to_sid.get(asig.seller_code)
        else:
            sid = None
        por_seller_buckets[sid].append((asig, envio))

    # Trae los sellers necesarios en una sola query.
    seller_ids = [sid for sid in por_seller_buckets.keys() if sid is not None]
    seller_nombres: dict[int, str] = {}
    if seller_ids:
        seller_nombres = {
            s.id: s.nombre
            for s in db.query(Seller.id, Seller.nombre).filter(Seller.id.in_(seller_ids)).all()
        }

    por_seller = []
    for sid, asigs in por_seller_buckets.items():
        if sid is None:
            nombre = "Sin envío reconciliado"
        else:
            nombre = seller_nombres.get(sid, f"Seller {sid}")
        k = _calcular_kpis_v2(asigs)
        por_seller.append({
            "seller_id": sid,
            "nombre": nombre,
            **k,
        })
    por_seller.sort(key=lambda x: -x["paquetes_a_ruta"])

    # ── Por driver ──────────────────────────────────────────────────────────
    por_driver_buckets: dict[int, list] = defaultdict(list)
    sin_driver: list = []
    for asig, envio in rows:
        if asig.driver_id is not None:
            por_driver_buckets[asig.driver_id].append((asig, envio))
        else:
            sin_driver.append((asig, envio))

    driver_nombres = {d.id: d.nombre for d in db.query(Driver.id, Driver.nombre).all()}

    por_driver = []
    for did, asigs in por_driver_buckets.items():
        k = _calcular_kpis_v2(asigs)
        # Mini-spark: % same-day por día (últimos 7 días del rango con datos)
        spark_by_day: dict[date, tuple[int, int]] = defaultdict(lambda: (0, 0))
        for asig, envio in asigs:
            a_ruta, sd = spark_by_day[asig.withdrawal_date]
            new_sd = sd + (1 if envio is not None and envio.fecha_entrega is not None
                           and envio.fecha_retiro is not None
                           and _business_days_between(envio.fecha_retiro, envio.fecha_entrega) == 0
                           else 0)
            spark_by_day[asig.withdrawal_date] = (a_ruta + 1, new_sd)
        spark_dates = sorted(spark_by_day.keys())[-7:]
        spark = [_ratio(spark_by_day[d][1], spark_by_day[d][0]) for d in spark_dates]
        por_driver.append({
            "driver_id": did,
            "nombre": driver_nombres.get(did, f"Driver {did}"),
            "spark": spark,
            **k,
        })
    if sin_driver:
        k = _calcular_kpis_v2(sin_driver)
        por_driver.append({
            "driver_id": None,
            "nombre": "Sin driver asignado",
            "spark": [],
            **k,
        })
    por_driver.sort(key=lambda x: -x["paquetes_a_ruta"])

    return {
        "rango": {"inicio": inicio.isoformat(), "fin": fin.isoformat()},
        "global": kpis_global,
        "serie_temporal": serie_temporal,
        "por_seller": por_seller,
        "por_driver": por_driver,
        "benchmark_promesa": 98.0,  # 98% promise (configurable a futuro)
    }


@router.get("/efectividad-v2/driver/{driver_id}")
def efectividad_v2_driver(
    driver_id: int,
    mes: Optional[int] = Query(None),
    anio: Optional[int] = Query(None),
    fecha_inicio: Optional[str] = Query(None),
    fecha_fin: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Drill-down por conductor con heatmap calendario y detalle de no-entregados."""
    inicio, fin = _rango_default(mes, anio, fecha_inicio, fecha_fin)
    # Si el drill-down es del propio driver excluido, NO aplicamos su propia
    # exclusión (queremos ver sus métricas individuales). Las exclusiones de
    # SELLERS sí se mantienen para mostrar números limpios.
    aplicar_excl = driver_id not in EFECTIVIDAD_DRIVERS_EXCLUIDOS
    rows = _kpis_v2_base_query(db, inicio, fin, driver_id=driver_id,
                               aplicar_exclusiones=aplicar_excl).all()

    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    nombre = driver.nombre if driver else f"Driver {driver_id}"

    kpis = _calcular_kpis_v2(rows, incluir_buckets=True)

    # ── Heatmap calendario: una celda por día con (a_ruta / entregados) ─────
    por_dia_buckets: dict[date, list] = defaultdict(list)
    for asig, envio in rows:
        por_dia_buckets[asig.withdrawal_date].append((asig, envio))

    heatmap = []
    for d in sorted(por_dia_buckets.keys()):
        k = _calcular_kpis_v2(por_dia_buckets[d])
        heatmap.append({
            "fecha": d.isoformat(),
            "weekday": d.weekday(),  # 0=Mon..6=Sun
            "a_ruta": k["paquetes_a_ruta"],
            "entregados": k["paquetes_entregados"],
            "same_day": k["same_day"],
            "cancelados": k["cancelados"],
            "pct_same_day": k["pct_same_day"],
            "label": f"{k['paquetes_entregados']}/{k['paquetes_a_ruta']}",
        })

    # ── Por ruta (route_name) ───────────────────────────────────────────────
    por_ruta_buckets: dict[str, list] = defaultdict(list)
    for asig, envio in rows:
        nombre_ruta = asig.route_name or "(sin nombre)"
        por_ruta_buckets[nombre_ruta].append((asig, envio))

    por_ruta = []
    for ruta, asigs in por_ruta_buckets.items():
        k = _calcular_kpis_v2(asigs)
        por_ruta.append({"ruta": ruta, **k})
    por_ruta.sort(key=lambda x: -x["paquetes_a_ruta"])

    # ── Rendimiento del conductor (route_date) ─────────────────────────────
    # Distinto de Same-Day: mide si el driver entregó el mismo día que sacó
    # el paquete a ruta. No penaliza al conductor por retrasos de bodega.
    rend_rows = (
        db.query(AsignacionRuta, Envio)
        .outerjoin(Envio, AsignacionRuta.envio_id == Envio.id)
        .filter(
            AsignacionRuta.driver_id == driver_id,
            AsignacionRuta.route_date >= inicio,
            AsignacionRuta.route_date <= fin,
            AsignacionRuta.route_date.isnot(None),
        )
        .all()
    )

    por_fecha_ruta: dict[date, list] = defaultdict(list)
    for asig, envio in rend_rows:
        por_fecha_ruta[asig.route_date].append((asig, envio))

    rend_heatmap = []
    rend_a_ruta = 0
    rend_entregados = 0
    for d in sorted(por_fecha_ruta.keys()):
        asigs = por_fecha_ruta[d]
        a = sum(1 for asig, _ in asigs if asig.estado_calculado != "cancelado")
        e = sum(1 for asig, envio in asigs if envio is not None and envio.fecha_entrega == d)
        pct = round(100 * e / a, 1) if a else 0
        rend_a_ruta += a
        rend_entregados += e
        rend_heatmap.append({
            "fecha": d.isoformat(),
            "weekday": d.weekday(),
            "a_ruta": a,
            "entregados": e,
            "pct_entrega": pct,
            "label": f"{e}/{a}",
        })

    rend_pct = round(100 * rend_entregados / rend_a_ruta, 1) if rend_a_ruta else 0

    # ── No entregados (sin_entrega) detallados ──────────────────────────────    seller_nombres = {s.id: s.nombre for s in db.query(Seller.id, Seller.nombre).all()}
    seller_id_by_envio: dict[int, int] = {}

    no_entregados = []
    for asig, envio in rows:
        if asig.estado_calculado == "entregado" or asig.estado_calculado == "cancelado":
            continue
        no_entregados.append({
            "tracking_id": asig.tracking_id,
            "fecha_retiro": asig.withdrawal_date.isoformat() if asig.withdrawal_date else None,
            "intento_nro": asig.intento_nro,
            "ruta_nombre": asig.route_name,
            "seller_code": asig.seller_code,
            "envio_id": envio.id if envio else None,
            "seller": seller_nombres.get(envio.seller_id) if envio and envio.seller_id else None,
            "comuna": envio.comuna if envio else None,
        })
    no_entregados.sort(key=lambda x: x["fecha_retiro"] or "", reverse=True)

    return {
        "driver_id": driver_id,
        "nombre": nombre,
        "rango": {"inicio": inicio.isoformat(), "fin": fin.isoformat()},
        "kpis": kpis,
        "heatmap": heatmap,
        "por_ruta": por_ruta,
        "rendimiento": {
            "paquetes_a_ruta": rend_a_ruta,
            "paquetes_entregados": rend_entregados,
            "paquetes_sin_entregar": rend_a_ruta - rend_entregados,
            "pct_entrega_mismo_dia": rend_pct,
            "heatmap": rend_heatmap,
        },
        "no_entregados": no_entregados[:200],
        "no_entregados_total": len(no_entregados),
    }


@router.get("/efectividad-v2/driver/{driver_id}/comparacion")
def efectividad_v2_driver_comparacion(
    driver_id: int,
    mes: Optional[int] = Query(None),
    anio: Optional[int] = Query(None),
    fecha_inicio: Optional[str] = Query(None),
    fecha_fin: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Métricas comparativas: driver vs su zona vs operación global.

    Calcula pct_efectividad, pct_pm_ideal y entregas_por_hora para los
    tres niveles. También devuelve la fecha de antigüedad (seniority).
    """
    inicio, fin = _rango_default(mes, anio, fecha_inicio, fecha_fin)

    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    zona = driver.zona if driver else None

    # IDs de todos los drivers en la misma zona (excluyendo los globalmente excluidos)
    zona_driver_ids: list[int] = []
    if zona:
        zona_driver_ids = [
            d.id for d in db.query(Driver.id).filter(
                Driver.zona == zona,
                ~Driver.id.in_(EFECTIVIDAD_DRIVERS_EXCLUIDOS),
            ).all()
        ]

    def _kpis_para_driver_ids(driver_ids: list[int]) -> dict:
        """Calcula efectividad + pct_pm_ideal para un conjunto de driver_ids."""
        if not driver_ids:
            return {"efectividad": None, "pct_pm_ideal": None, "entregas_por_hora": None}

        # ── Efectividad (asignacion_ruta + envio) ─────────────────────────
        ruta_rows = (
            db.query(AsignacionRuta, Envio)
            .outerjoin(Envio, AsignacionRuta.envio_id == Envio.id)
            .filter(
                AsignacionRuta.driver_id.in_(driver_ids),
                AsignacionRuta.withdrawal_date >= inicio,
                AsignacionRuta.withdrawal_date <= fin,
            )
            .all()
        )
        kpis = _calcular_kpis_v2(ruta_rows)
        efectividad = kpis["pct_delivery_success"]

        # ── Franja PM ideal ────────────────────────────────────────────────
        franja_rows = (
            db.query(Envio.hora_entrega)
            .filter(
                Envio.driver_id.in_(driver_ids),
                Envio.fecha_entrega >= inicio,
                Envio.fecha_entrega <= fin,
                ~Envio.seller_id.in_(EFECTIVIDAD_SELLERS_EXCLUIDOS),
            )
            .all()
        )
        total_f = len(franja_rows)
        pm_ideal_n = sum(
            1 for r in franja_rows
            if r.hora_entrega is not None
            and r.hora_entrega.hour * 60 + r.hora_entrega.minute > 15 * 60
            and r.hora_entrega.hour * 60 + r.hora_entrega.minute <= 21 * 60
        )
        pct_pm_ideal = round(100 * pm_ideal_n / total_f, 1) if total_f else None

        # ── Entregas por hora ──────────────────────────────────────────────
        # Para cada día de ruta: rango = MAX(hora_entrega) - MIN(hora_entrega)
        # Tasa del día = entregas_ese_dia / horas_rango
        # Promedio de tasas válidas (rango >= 30 min)
        from collections import defaultdict as _dd
        por_dia: dict = _dd(list)
        for r in franja_rows:
            if r.hora_entrega is not None:
                # fecha_entrega como proxy del día de entrega
                pass
        # Re-query con fecha_entrega incluida
        dia_rows = (
            db.query(Envio.fecha_entrega, Envio.hora_entrega)
            .filter(
                Envio.driver_id.in_(driver_ids),
                Envio.fecha_entrega >= inicio,
                Envio.fecha_entrega <= fin,
                Envio.hora_entrega.isnot(None),
                ~Envio.seller_id.in_(EFECTIVIDAD_SELLERS_EXCLUIDOS),
            )
            .all()
        )
        dia_horas: dict = _dd(list)
        for r in dia_rows:
            mins = r.hora_entrega.hour * 60 + r.hora_entrega.minute
            dia_horas[r.fecha_entrega].append(mins)

        tasas = []
        for d, horas_mins in dia_horas.items():
            if len(horas_mins) < 2:
                continue
            rango_min = max(horas_mins) - min(horas_mins)
            if rango_min < 30:
                continue
            rango_h = rango_min / 60
            tasas.append(len(horas_mins) / rango_h)

        entregas_por_hora = round(sum(tasas) / len(tasas), 1) if tasas else None

        return {
            "efectividad": efectividad,
            "pct_pm_ideal": pct_pm_ideal,
            "entregas_por_hora": entregas_por_hora,
        }

    # ── Antigüedad del conductor ───────────────────────────────────────────
    primera = (
        db.query(AsignacionRuta.withdrawal_date)
        .filter(
            AsignacionRuta.driver_id == driver_id,
            AsignacionRuta.withdrawal_date.isnot(None),
        )
        .order_by(AsignacionRuta.withdrawal_date.asc())
        .first()
    )
    seniority = primera.withdrawal_date.isoformat() if primera else None

    # ── Calcular los 3 niveles ─────────────────────────────────────────────
    # Excluir drivers globalmente excluidos del cálculo de zona/global
    all_driver_ids_q = [
        d.id for d in db.query(Driver.id).filter(
            ~Driver.id.in_(EFECTIVIDAD_DRIVERS_EXCLUIDOS)
        ).all()
    ]

    kpis_driver = _kpis_para_driver_ids([driver_id])
    kpis_zona = _kpis_para_driver_ids(zona_driver_ids) if zona_driver_ids else kpis_driver
    kpis_global = _kpis_para_driver_ids(all_driver_ids_q)

    return {
        "driver_id": driver_id,
        "nombre": driver.nombre if driver else f"Driver {driver_id}",
        "zona": zona,
        "seniority_desde": seniority,
        "rango": {"inicio": inicio.isoformat(), "fin": fin.isoformat()},
        "driver": kpis_driver,
        "zona_kpis": kpis_zona,
        "global": kpis_global,
    }


@router.get("/efectividad-v2/seller/{seller_id}")
def efectividad_v2_seller(    seller_id: int,
    mes: Optional[int] = Query(None),
    anio: Optional[int] = Query(None),
    fecha_inicio: Optional[str] = Query(None),
    fecha_fin: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Drill-down por seller. Resuelve el seller_code(s) asociados y filtra."""
    inicio, fin = _rango_default(mes, anio, fecha_inicio, fecha_fin)

    seller = db.query(Seller).filter(Seller.id == seller_id).first()
    if not seller:
        return {"error": "seller_no_encontrado"}

    # Filtramos por `seller_code` (campo en AsignacionRuta que proviene del
    # courier) usando como lookup los seller_codes que ya vemos en Envio para
    # este seller. Así incluimos paquetes NO entregados todavía.
    seller_codes = {
        r.seller_code for r in
        db.query(Envio.seller_code).filter(
            Envio.seller_id == seller_id,
            Envio.seller_code.isnot(None),
        ).distinct().all()
        if r.seller_code
    }

    aplicar_excl = seller_id not in EFECTIVIDAD_SELLERS_EXCLUIDOS
    if seller_codes:
        q = db.query(AsignacionRuta, Envio).outerjoin(
            Envio, AsignacionRuta.envio_id == Envio.id
        ).filter(
            AsignacionRuta.seller_code.in_(seller_codes),
            AsignacionRuta.withdrawal_date >= inicio,
            AsignacionRuta.withdrawal_date <= fin,
        )
        if aplicar_excl:
            q = _aplicar_exclusiones(q)
    else:
        # Fallback si no hay seller_codes conocidos: inner join por seller_id
        q = _kpis_v2_base_query(db, inicio, fin, aplicar_exclusiones=aplicar_excl)
        q = q.join(Envio, AsignacionRuta.envio_id == Envio.id, isouter=False)\
             .filter(Envio.seller_id == seller_id)
    rows = q.all()

    kpis = _calcular_kpis_v2(rows, incluir_buckets=True)

    # ── Serie temporal + por_dia (tabla día a día) ─────────────────────────
    por_dia_buckets: dict[date, list] = defaultdict(list)
    for asig, envio in rows:
        por_dia_buckets[asig.withdrawal_date].append((asig, envio))

    serie_temporal = []
    por_dia = []
    for d in sorted(por_dia_buckets.keys()):
        k = _calcular_kpis_v2(por_dia_buckets[d])
        serie_temporal.append({
            "fecha": d.isoformat(),
            "a_ruta": k["paquetes_a_ruta"],
            "entregados": k["paquetes_entregados"],
            "same_day": k["same_day"],
            "pct_same_day": k["pct_same_day"],
        })
        por_dia.append({
            "fecha": d.isoformat(),
            "weekday": d.strftime("%a"),
            "a_ruta": k["paquetes_a_ruta"],
            "entregados": k["paquetes_entregados"],
            "same_day": k["same_day"],
            "cancelados": k["cancelados"],
            "pct_same_day": k["pct_same_day"],
            "pct_delivery_success": k["pct_delivery_success"],
        })

    # ── Por driver que le entregó al seller ─────────────────────────────────
    por_driver_buckets: dict[int, list] = defaultdict(list)
    sin_driver: list = []
    for asig, envio in rows:
        if asig.driver_id is not None:
            por_driver_buckets[asig.driver_id].append((asig, envio))
        else:
            sin_driver.append((asig, envio))

    driver_nombres = {d.id: d.nombre for d in db.query(Driver.id, Driver.nombre).all()}
    por_driver = []
    for did, asigs in por_driver_buckets.items():
        k = _calcular_kpis_v2(asigs)
        por_driver.append({
            "driver_id": did,
            "nombre": driver_nombres.get(did, f"Driver {did}"),
            **k,
        })
    if sin_driver:
        k = _calcular_kpis_v2(sin_driver)
        por_driver.append({"driver_id": None, "nombre": "Sin driver", **k})
    por_driver.sort(key=lambda x: -x["paquetes_a_ruta"])

    return {
        "seller_id": seller_id,
        "nombre": seller.nombre,
        "codigos": sorted(seller_codes),
        "rango": {"inicio": inicio.isoformat(), "fin": fin.isoformat()},
        "kpis": kpis,
        "serie_temporal": serie_temporal,
        "por_dia": por_dia,
        "por_driver": por_driver,
    }


# ── Mapa: puntos geográficos de envíos con KPI de same-day ──────────────────
@router.get("/efectividad-v2/mapa")
def efectividad_v2_mapa(
    mes: Optional[int] = Query(None),
    anio: Optional[int] = Query(None),
    fecha_inicio: Optional[str] = Query(None),
    fecha_fin: Optional[str] = Query(None),
    driver_id: Optional[int] = Query(None),
    seller_id: Optional[int] = Query(None),
    estado: Optional[str] = Query(None, description="entregado | sin_entrega | cancelado"),
    limite: int = Query(8000, ge=100, le=20000),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Devuelve puntos geográficos para el mapa BI.

    Solo incluye envíos con lat/lon válidos. El payload se mantiene compacto
    (campos cortos: `t`, `la`, `lo`, `s`, `d`, `r`) para no saturar el frontend
    al renderizar miles de marcadores.

    Estados (`s`):
      - 0: pendiente / sin entregar
      - 1: same-day (entregado el mismo día hábil)
      - 2: entregado pero NO same-day
      - 3: cancelado
    """
    inicio, fin = _rango_default(mes, anio, fecha_inicio, fecha_fin)

    q = db.query(AsignacionRuta, Envio).join(
        Envio, AsignacionRuta.envio_id == Envio.id
    ).filter(
        AsignacionRuta.withdrawal_date >= inicio,
        AsignacionRuta.withdrawal_date <= fin,
        Envio.lat.isnot(None),
        Envio.lon.isnot(None),
    )
    if driver_id is not None:
        q = q.filter(AsignacionRuta.driver_id == driver_id)
    if seller_id is not None:
        q = q.filter(Envio.seller_id == seller_id)

    # Aplica exclusiones globales salvo que el filtro sea EXACTAMENTE para el
    # excluido (en cuyo caso el operador quiere ver sus puntos individualmente).
    excluir_drivers = bool(EFECTIVIDAD_DRIVERS_EXCLUIDOS) and driver_id not in EFECTIVIDAD_DRIVERS_EXCLUIDOS
    excluir_sellers = bool(EFECTIVIDAD_SELLERS_EXCLUIDOS) and seller_id not in EFECTIVIDAD_SELLERS_EXCLUIDOS
    if excluir_drivers:
        q = q.filter(
            (AsignacionRuta.driver_id.is_(None))
            | (~AsignacionRuta.driver_id.in_(EFECTIVIDAD_DRIVERS_EXCLUIDOS))
        )
    if excluir_sellers:
        q = q.filter(
            (Envio.seller_id.is_(None))
            | (~Envio.seller_id.in_(EFECTIVIDAD_SELLERS_EXCLUIDOS))
        )

    rows = q.limit(limite + 1).all()
    truncado = len(rows) > limite
    if truncado:
        rows = rows[:limite]

    puntos: list[dict] = []
    contador = {"same_day": 0, "entregado_no_sd": 0, "pendiente": 0, "cancelado": 0}

    for asig, envio in rows:
        if asig.estado_calculado == "cancelado":
            estado_cod = 3
            contador["cancelado"] += 1
        elif envio.fecha_entrega and asig.withdrawal_date:
            dias_habiles = _business_days_between(asig.withdrawal_date, envio.fecha_entrega)
            if dias_habiles == 0:
                estado_cod = 1
                contador["same_day"] += 1
            else:
                estado_cod = 2
                contador["entregado_no_sd"] += 1
        else:
            estado_cod = 0
            contador["pendiente"] += 1

        if estado and (
            (estado == "entregado" and estado_cod not in (1, 2))
            or (estado == "sin_entrega" and estado_cod != 0)
            or (estado == "cancelado" and estado_cod != 3)
        ):
            continue

        puntos.append({
            "t": asig.tracking_id,
            "la": float(envio.lat),
            "lo": float(envio.lon),
            "s": estado_cod,
            "d": asig.driver_id,
            "r": asig.route_name,
            "fr": asig.withdrawal_date.isoformat() if asig.withdrawal_date else None,
            "fe": envio.fecha_entrega.isoformat() if envio.fecha_entrega else None,
            "co": envio.comuna,
        })

    total_periodo = db.query(sqlfunc.count(AsignacionRuta.id)).filter(
        AsignacionRuta.withdrawal_date >= inicio,
        AsignacionRuta.withdrawal_date <= fin,
    ).scalar() or 0
    con_geo = len(puntos) + (0 if not truncado else 0)

    return {
        "rango": {"inicio": inicio.isoformat(), "fin": fin.isoformat()},
        "total_asignaciones_periodo": int(total_periodo),
        "puntos": puntos,
        "puntos_count": len(puntos),
        "truncado": truncado,
        "limite": limite,
        "resumen": contador,
        "leyenda": {
            "1": "Same-Day (mismo día hábil)",
            "2": "Entregado (>0 días hábiles)",
            "0": "Sin entrega aún",
            "3": "Cancelado",
        },
    }


# ── Franjas Horarias ──────────────────────────────────────────────────────────
#
# Franjas definidas por el negocio:
#   AM        : 08:00 – 15:00  (probablemente 2dos intentos)
#   PM_IDEAL  : 15:01 – 21:00  (franja óptima)
#   PM_LIMITE : 21:01 – 22:00  (límite aceptable)
#   PM_TARDE  : 22:01 – 23:59  (rango a mejorar)
#   MADRUGADA : 00:00 – 07:59  (muy tarde/fuera de horario)
#   SIN_HORA  : envíos sin hora registrada

_FRANJAS = [
    ("am",        "AM (08–15)",       "08:00:00", "15:00:00"),
    ("pm_ideal",  "PM ideal (15–21)", "15:00:01", "21:00:00"),
    ("pm_limite", "PM límite (21–22)","21:00:01", "22:00:00"),
    ("pm_tarde",  "PM tarde (22+)",   "22:00:01", "23:59:59"),
    ("madrugada", "Madrugada (0–8)",  "00:00:00", "07:59:59"),
]

def _franja_case():
    """CASE WHEN para asignar franja a cada envío según hora_entrega."""
    from sqlalchemy import case
    from app.models import Envio as _Envio
    from sqlalchemy import cast
    from sqlalchemy.dialects.postgresql import TIME
    whens = [
        ((_Envio.hora_entrega >= "08:00:00") & (_Envio.hora_entrega <= "15:00:00"), "am"),
        ((_Envio.hora_entrega > "15:00:00") & (_Envio.hora_entrega <= "21:00:00"), "pm_ideal"),
        ((_Envio.hora_entrega > "21:00:00") & (_Envio.hora_entrega <= "22:00:00"), "pm_limite"),
        ((_Envio.hora_entrega > "22:00:00"), "pm_tarde"),
        (_Envio.hora_entrega.isnot(None), "madrugada"),
    ]
    return case(*[(cond, val) for cond, val in whens], else_="sin_hora")


def _build_franja_stats(rows) -> dict:
    """Agrega una lista de (franja, count) en el dict estándar de franjas."""
    total = sum(n for _, n in rows)
    d = {k: {"n": 0, "pct": 0.0} for k, *_ in _FRANJAS}
    d["madrugada"] = {"n": 0, "pct": 0.0}
    d["sin_hora"] = {"n": 0, "pct": 0.0}
    for franja, n in rows:
        if franja in d:
            d[franja]["n"] = n
            d[franja]["pct"] = round(100 * n / total, 1) if total else 0.0
    d["_total"] = total
    return d


@router.get("/franjas-horarias")
def franjas_horarias_global(
    mes: Optional[int] = Query(None),
    anio: Optional[int] = Query(None),
    fecha_inicio: Optional[str] = Query(None),
    fecha_fin: Optional[str] = Query(None),
    driver_id: Optional[int] = Query(None),
    seller_id: Optional[int] = Query(None),
    agrupacion: str = Query("global", description="global | dia | semana | mes | driver | seller | ruta | comuna"),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """
    Devuelve la distribución de entregas por franja horaria.

    `agrupacion` controla el eje de análisis:
    - global  → un solo bloque con totales del período
    - dia     → una fila por fecha
    - semana  → una fila por número de semana
    - mes     → una fila por mes
    - driver  → una fila por conductor
    - seller  → una fila por seller
    - ruta    → una fila por ruta (ruta_nombre)
    - comuna  → una fila por comuna de entrega
    """
    inicio, fin = _rango_default(mes, anio, fecha_inicio, fecha_fin)

    q = db.query(Envio).filter(
        Envio.fecha_entrega >= inicio,
        Envio.fecha_entrega <= fin,
    )
    if driver_id is not None:
        q = q.filter(Envio.driver_id == driver_id)
    if seller_id is not None:
        q = q.filter(Envio.seller_id == seller_id)

    # Aplicar exclusiones globales (igual que en efectividad)
    if EFECTIVIDAD_SELLERS_EXCLUIDOS:
        q = q.filter(~Envio.seller_id.in_(EFECTIVIDAD_SELLERS_EXCLUIDOS))
    if EFECTIVIDAD_DRIVERS_EXCLUIDOS:
        q = q.filter(~Envio.driver_id.in_(EFECTIVIDAD_DRIVERS_EXCLUIDOS))

    def _franja_sql(h):
        """Devuelve clave de franja para una hora Python time."""
        if h is None:
            return "sin_hora"
        hm = h.hour * 60 + h.minute
        if 8 * 60 <= hm <= 15 * 60:
            return "am"
        if 15 * 60 < hm <= 21 * 60:
            return "pm_ideal"
        if 21 * 60 < hm <= 22 * 60:
            return "pm_limite"
        if hm > 22 * 60:
            return "pm_tarde"
        return "madrugada"

    # ── Construcción de filas ───────────────────────────────────────────────
    # Cargamos sólo los campos necesarios, sin traer el objeto completo
    cols_needed = [
        Envio.id,
        Envio.fecha_entrega,
        Envio.mes,
        Envio.semana,
        Envio.driver_id,
        Envio.seller_id,
        Envio.ruta_nombre,
        Envio.hora_entrega,
        Envio.comuna,
    ]
    rows = q.with_entities(*cols_needed).all()

    # Índices para nombres
    drivers_map = {d.id: d.nombre for d in db.query(Driver).all()}
    sellers_map = {s.id: s.nombre for s in db.query(Seller).all()}

    def _agg_key(row):
        if agrupacion == "dia":
            return str(row.fecha_entrega)
        if agrupacion == "semana":
            return f"Semana {row.semana}"
        if agrupacion == "mes":
            return f"{row.mes}/{row.anio if hasattr(row, 'anio') else ''}"
        if agrupacion == "driver":
            return str(row.driver_id) if row.driver_id else "sin_driver"
        if agrupacion == "seller":
            return str(row.seller_id) if row.seller_id else "sin_seller"
        if agrupacion == "ruta":
            return row.ruta_nombre or "Sin ruta"
        if agrupacion == "comuna":
            return row.comuna or "Sin comuna"
        return "global"

    from collections import defaultdict
    buckets: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    meta: dict[str, dict] = {}

    for row in rows:
        key = _agg_key(row)
        franja = _franja_sql(row.hora_entrega)
        buckets[key][franja] += 1
        # guardar etiqueta legible
        if key not in meta:
            label = key
            if agrupacion == "driver" and row.driver_id:
                label = drivers_map.get(row.driver_id, key)
            elif agrupacion == "seller" and row.seller_id:
                label = sellers_map.get(row.seller_id, key)
            meta[key] = {"key": key, "label": label}

    franja_keys = ["am", "pm_ideal", "pm_limite", "pm_tarde", "madrugada", "sin_hora"]
    franja_labels = {
        "am":        "AM (08–15 h)",
        "pm_ideal":  "PM ideal (15–21 h)",
        "pm_limite": "PM límite (21–22 h)",
        "pm_tarde":  "PM tarde (22+ h)",
        "madrugada": "Madrugada (0–8 h)",
        "sin_hora":  "Sin hora registrada",
    }
    franja_colors = {
        "am":        "#f59e0b",
        "pm_ideal":  "#10b981",
        "pm_limite": "#f97316",
        "pm_tarde":  "#ef4444",
        "madrugada": "#8b5cf6",
        "sin_hora":  "#94a3b8",
    }

    result_rows = []
    for key, counts in sorted(buckets.items()):
        total = sum(counts.values())
        entry = {
            "key": key,
            "label": meta.get(key, {}).get("label", key),
            "total": total,
        }
        for fk in franja_keys:
            n = counts.get(fk, 0)
            entry[fk] = n
            entry[f"pct_{fk}"] = round(100 * n / total, 1) if total else 0.0
        result_rows.append(entry)

    # Resumen global
    global_counts: dict[str, int] = defaultdict(int)
    for counts in buckets.values():
        for fk, n in counts.items():
            global_counts[fk] += n
    grand_total = sum(global_counts.values())
    global_summary = {"total": grand_total}
    for fk in franja_keys:
        n = global_counts.get(fk, 0)
        global_summary[fk] = n
        global_summary[f"pct_{fk}"] = round(100 * n / grand_total, 1) if grand_total else 0.0

    return {
        "rango": {"inicio": inicio.isoformat(), "fin": fin.isoformat()},
        "agrupacion": agrupacion,
        "franjas": [
            {"key": fk, "label": franja_labels[fk], "color": franja_colors[fk]}
            for fk in franja_keys
        ],
        "global": global_summary,
        "rows": result_rows,
    }

