from typing import Optional
from collections import defaultdict
import time as _time

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

# ── In-memory analytics cache ────────────────────────────────────────────────
# Caches expensive read-only analytics responses.
# TTL: 10 minutes. Invalidated explicitly after each cron ingestion run.
_ANALYTICS_CACHE: dict[str, tuple] = {}  # key -> (data, monotonic_timestamp)
_ANALYTICS_TTL = 600  # seconds


def _cache_get(key: str):
    entry = _ANALYTICS_CACHE.get(key)
    if entry and (_time.monotonic() - entry[1]) < _ANALYTICS_TTL:
        return entry[0]
    return None


def _cache_set(key: str, data):
    _ANALYTICS_CACHE[key] = (data, _time.monotonic())


def analytics_cache_clear():
    """Invalidate the entire analytics cache. Call after a data ingestion run."""
    _ANALYTICS_CACHE.clear()
# ─────────────────────────────────────────────────────────────────────────────


@router.post("/cache/invalidate", status_code=200)
def invalidate_analytics_cache(_=Depends(require_admin_or_administracion)):
    """Invalida la caché analítica en memoria. Llamar tras una ingesta manual."""
    analytics_cache_clear()
    return {"ok": True, "mensaje": "Caché analítica vaciada"}


@router.post("/kpi/recompute", status_code=200)
def recompute_kpis_endpoint(
    fecha_inicio: str = Query(..., description="YYYY-MM-DD"),
    fecha_fin: str = Query(..., description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Fuerza recompute de las tablas materializadas kpi_dia/kpi_no_entregado.

    Útil cuando se hizo una corrección manual sobre asignacion_ruta o envios y
    se quiere refrescar inmediatamente sin esperar al cron de las 04:30.
    """
    from app.services import materializar_kpis
    inicio = datetime.strptime(fecha_inicio, "%Y-%m-%d").date()
    fin = datetime.strptime(fecha_fin, "%Y-%m-%d").date()
    info = materializar_kpis.recomputar_rango(db, inicio, fin)
    analytics_cache_clear()
    return {"ok": True, **info}


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


@router.get("/same-day", deprecated=True)
def same_day_stats(
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """
    DEPRECATED — usar `/efectividad-v2`.

    Implementación legacy: definía Same-Day como `Envio.fecha_entrega ==
    Envio.fecha_carga` (fecha de subida del seller, no de retiro del courier).
    No se ajusta a la definición canónica vigente. El endpoint sigue
    respondiendo para retrocompatibilidad con scripts externos pero ningún
    pantalla del producto lo consume.
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


@router.get("/efectividad", deprecated=True)
def efectividad_entregas(
    mes: int = Query(...),
    anio: int = Query(...),
    semana: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """DEPRECATED — usar `/efectividad-v2`.

    Implementación legacy: medía ciclo retiro→entrega en buckets de días.
    No es la métrica de efectividad operacional acordada con producto.
    Las pantallas del producto consumen `/efectividad-v2` que sirve la
    definición canónica (route_date == fecha_entrega).
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


@router.get("/efectividad/driver/{driver_id}", deprecated=True)
def efectividad_driver_detalle(
    driver_id: int,
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """DEPRECATED — usar `/efectividad-v2/driver/{driver_id}`."""
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

    # Daily breakdown per week for expandable rows
    _DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]
    dias_rows = db.query(
        Envio.semana, Envio.fecha_entrega,
        sqlfunc.count(Envio.id).label("total"),
        sqlfunc.sum(_ingreso_expr()).label("ingreso"),
        sqlfunc.sum(_costo_expr()).label("costo"),
    ).filter(*f_cur).group_by(Envio.semana, Envio.fecha_entrega).order_by(
        Envio.semana, Envio.fecha_entrega
    ).all()
    dias_by_semana: dict = defaultdict(list)
    for r in dias_rows:
        dias_by_semana[r.semana].append({
            "fecha": r.fecha_entrega.isoformat(),
            "dia": _DIAS[r.fecha_entrega.weekday()],
            "total": r.total or 0,
            "ingreso": int(r.ingreso or 0),
            "margen": int((r.ingreso or 0) - (r.costo or 0)),
        })

    semanas_detalle = [
        {
            "semana": r.semana, "total": r.total or 0,
            "ingreso": int(r.ingreso or 0), "costo": int(r.costo or 0),
            "margen": int((r.ingreso or 0) - (r.costo or 0)),
            "prom_diario": round((r.total or 0) / max(len(dias_by_semana[r.semana]), 1), 1),
            "dias": dias_by_semana[r.semana],
        }
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
    mes: Optional[int] = Query(None, description="Mes para semanas_detalle (1-12). Por defecto: último mes con actividad."),
    anio: Optional[int] = Query(None, description="Año para semanas_detalle. Por defecto: año del último mes con actividad."),
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

    # ── Fecha de primera entrega (seniority) ──────────────────────────────
    primer_entrega_row = db.query(sqlfunc.min(Envio.fecha_entrega)).filter(
        Envio.driver_id == driver_id
    ).scalar()
    primer_entrega = primer_entrega_row.isoformat() if primer_entrega_row else None

    # ── Desglose semanal del mes solicitado ────────────────────────────────
    # Usa el mes/año proporcionado, o el último mes con actividad si no se especifica.
    sel_mes = mes
    sel_anio = anio
    if (sel_mes is None or sel_anio is None) and meses:
        ultimo = meses[-1]
        sel_mes = sel_mes or ultimo["mes"]
        sel_anio = sel_anio or ultimo["anio"]

    semanas_detalle = []
    if sel_mes and sel_anio:
        _DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]

        # Weekly totals (Envio only — retiros don't have semana granularity per driver easily)
        sem_rows = db.query(
            Envio.semana,
            sqlfunc.count(Envio.id).label("entregas"),
            sqlfunc.sum(Envio.costo_driver + Envio.pago_extra_manual).label("base"),
            sqlfunc.sum(Envio.extra_producto_driver).label("prod"),
            sqlfunc.sum(Envio.extra_comuna_driver).label("com"),
        ).filter(
            Envio.driver_id == driver_id,
            Envio.mes == sel_mes, Envio.anio == sel_anio,
        ).group_by(Envio.semana).order_by(Envio.semana).all()

        dia_rows = db.query(
            Envio.semana, Envio.fecha_entrega,
            sqlfunc.count(Envio.id).label("entregas"),
            sqlfunc.sum(Envio.costo_driver + Envio.pago_extra_manual).label("base"),
            sqlfunc.sum(Envio.extra_producto_driver).label("prod"),
            sqlfunc.sum(Envio.extra_comuna_driver).label("com"),
        ).filter(
            Envio.driver_id == driver_id,
            Envio.mes == sel_mes, Envio.anio == sel_anio,
        ).group_by(Envio.semana, Envio.fecha_entrega).order_by(
            Envio.semana, Envio.fecha_entrega
        ).all()

        dias_by_sem: dict = defaultdict(list)
        for r in dia_rows:
            g = int((r.base or 0) + (r.prod or 0) + (r.com or 0))
            dias_by_sem[r.semana].append({
                "fecha": r.fecha_entrega.isoformat(),
                "dia": _DIAS[r.fecha_entrega.weekday()],
                "entregas": r.entregas,
                "ganancia": g,
            })

        for r in sem_rows:
            g = int((r.base or 0) + (r.prod or 0) + (r.com or 0))
            ds = dias_by_sem[r.semana]
            semanas_detalle.append({
                "semana": r.semana,
                "entregas": r.entregas,
                "ganancia": g,
                "prom_diario": round(r.entregas / max(len(ds), 1), 1),
                "dias": ds,
            })

    return {
        "driver": {"id": driver.id, "nombre": driver.nombre, "zona": driver.zona, "contratado": driver.contratado},
        "meses": meses,
        "stats": stats,
        "primer_entrega": primer_entrega,
        "semanas_detalle": semanas_detalle,
        "periodo_semanas": {"mes": sel_mes, "anio": sel_anio},
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
#   3. % Same-Day                 entregas con 0 días hábiles entre RETIRO y ENTREGA
#   4. Delivery Success Rate      entregados / a_ruta  (efectividad)
#   5. First-Attempt Delivery Rate entregados con intento_nro=1 / a_ruta
#   6. Cancelados (informativo)   COUNT trackings cancelados externamente
#
# ─── Conceptos clave (NO confundir) ──────────────────────────────────────────
#   withdrawal_date  → fecha en que el courier RETIRÓ el paquete del seller.
#                      Se usa SOLO para Same-Day (retiro vs entrega).
#                      También se usa como filtro base del periodo (universo).
#
#   route_date       → fecha en que el paquete SALIÓ a ruta de despacho/entrega.
#                      Se usa SOLO para Efectividad (a_ruta vs entregados).
#                      Puede ser el mismo día del retiro o varios días después.
#
#   route_id /       → identifican la ruta de despacho/entrega del paquete
#   route_name         (no la ruta de retiro). Útiles para agrupar intentos.
#
# Definición canónica de Same-Day:
#   business_days(withdrawal_date, fecha_entrega) == 0
#   (viernes→lunes NO es same-day porque tiene 1 día hábil de diferencia.)
#
# Bucketing temporal (calendarios / series):
#   - Calendario de efectividad → agrupa por route_date (cuándo salió a ruta)
#   - KPI Same-Day              → independiente del bucket, calculado sobre el
#                                 conjunto de entregados del día
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
# La fuente de verdad ahora vive en `app.services.metricas_efectividad`.
# Las re-exportamos acá para no romper imports legacy y consultas SQL directas
# que las usan abajo en este archivo.
from app.services.metricas_efectividad import (
    EFECTIVIDAD_DRIVERS_EXCLUIDOS,
    EFECTIVIDAD_SELLERS_EXCLUIDOS,
)


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


@router.get("/efectividad-v2")
def efectividad_v2_global(
    mes: Optional[int] = Query(None),
    anio: Optional[int] = Query(None),
    fecha_inicio: Optional[str] = Query(None, description="YYYY-MM-DD"),
    fecha_fin: Optional[str] = Query(None, description="YYYY-MM-DD"),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Dashboard global de efectividad operacional + Same-Day.

    Devuelve KPIs principales, serie temporal por día, sellers y drivers para
    el rango pedido. Calcula con la capa canónica `metricas_efectividad`:
      - Efectividad: trackings con route_date = D y fecha_entrega = D
      - Same-Day:    trackings con business_days(withdrawal, entrega) = 0
    """
    from app.services import metricas_efectividad as _me

    inicio, fin = _rango_default(mes, anio, fecha_inicio, fecha_fin)

    _ck = f"ev2_global_v3:{inicio}:{fin}"
    _cached = _cache_get(_ck)
    if _cached is not None:
        return _cached

    kpis_global = _me.kpis_globales(db, inicio, fin)
    serie_temporal = _me.kpis_por_dia(db, inicio, fin)
    por_seller = _me.kpis_por_seller(db, inicio, fin)
    por_driver_raw = _me.kpis_por_driver(db, inicio, fin)

    # Mini-sparkline de % same-day (últimos 7 días del rango) por driver.
    # Se calcula leyendo los días directamente desde la serie por-driver.
    por_driver = []
    for d_kpi in por_driver_raw:
        spark = []
        if d_kpi.get("driver_id") is not None:
            serie_d = _me.kpis_por_dia(db, inicio, fin, driver_id=d_kpi["driver_id"])
            spark = [row["pct_same_day"] for row in serie_d[-7:]]
        por_driver.append({**d_kpi, "spark": spark})

    result = {
        "rango": {"inicio": inicio.isoformat(), "fin": fin.isoformat()},
        "version": "v3-canonica",
        "global": kpis_global,
        "serie_temporal": serie_temporal,
        "por_seller": por_seller,
        "por_driver": por_driver,
        "benchmark_promesa": 98.0,
    }
    _cache_set(_ck, result)
    return result


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
    """Drill-down por conductor con heatmap calendario y detalle de no-entregados.

    Calcula con la capa canónica. Mantiene shape exacto del response previo
    para no romper el frontend.
    """
    from app.services import metricas_efectividad as _me

    inicio, fin = _rango_default(mes, anio, fecha_inicio, fecha_fin)
    aplicar_excl = driver_id not in EFECTIVIDAD_DRIVERS_EXCLUIDOS

    driver = db.query(Driver).filter(Driver.id == driver_id).first()
    nombre = driver.nombre if driver else f"Driver {driver_id}"

    # KPIs agregados del driver (combina universos route_date + withdrawal_date)
    kpis = _me.kpis_globales(
        db, inicio, fin, driver_id=driver_id, aplicar_exclusiones=aplicar_excl
    )

    # Heatmap calendario: una celda por día con (a_ruta / entregados / same_day)
    serie = _me.kpis_por_dia(
        db, inicio, fin, driver_id=driver_id, aplicar_exclusiones=aplicar_excl
    )
    heatmap = [
        {
            "fecha": row["fecha"],
            "weekday": row["weekday"],
            "a_ruta": row["a_ruta"],
            "entregados": row["entregados"],
            "same_day": row["same_day"],
            "cancelados": row["cancelados"],
            "pct_same_day": row["pct_same_day"],
            "label": row["label"],
        }
        for row in serie
    ]

    # Por ruta (route_name) — siempre on-demand, no se materializa
    por_ruta = _me.kpis_por_ruta(
        db, inicio, fin, driver_id=driver_id, aplicar_exclusiones=aplicar_excl
    )

    # ── Rendimiento del conductor ─────────────────────────────────────────
    # Mide si el driver entregó el mismo día que el paquete salió a ruta.
    # Ya es la métrica principal (no un sub-bloque): coincide con `kpis`.
    rend_a_ruta = sum(row["a_ruta"] for row in serie)
    rend_entregados = sum(row["entregados"] for row in serie)
    rend_pct = round(100 * rend_entregados / rend_a_ruta, 1) if rend_a_ruta else 0
    rend_heatmap = [
        {
            "fecha": row["fecha"],
            "weekday": row["weekday"],
            "a_ruta": row["a_ruta"],
            "entregados": row["entregados"],
            "pct_entrega": row["pct_delivery_success"],
            "label": row["label"],
        }
        for row in serie
    ]

    # ── No entregados detallados ──────────────────────────────────────────
    no_entregados_raw = _me.detalle_no_entregados(
        db, inicio, fin, driver_id=driver_id, aplicar_exclusiones=aplicar_excl
    )
    seller_nombres = {s.id: s.nombre for s in db.query(Seller.id, Seller.nombre).all()}
    no_entregados = [
        {
            "tracking_id": ne["tracking_id"],
            "fecha_retiro": ne["withdrawal_date"],
            "intento_nro": ne["intento_nro"],
            "ruta_nombre": ne["route_name"],
            "seller_code": ne["seller_code"],
            "envio_id": None,  # ya no se necesita (legacy)
            "seller": seller_nombres.get(ne["seller_id"]) if ne["seller_id"] else None,
            "comuna": None,  # ya no se devuelve (campo eliminado del payload)
            "motivo": ne["motivo"],  # nuevo: 'sin_entrega' | 'cancelado' | 'fuera_de_dia'
        }
        for ne in no_entregados_raw
    ]
    no_entregados.sort(key=lambda x: x["fecha_retiro"] or "", reverse=True)

    return {
        "driver_id": driver_id,
        "nombre": nombre,
        "rango": {"inicio": inicio.isoformat(), "fin": fin.isoformat()},
        "version": "v3-canonica",
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

    _ck = f"ev2_comp:{driver_id}:{inicio}:{fin}"
    _cached = _cache_get(_ck)
    if _cached is not None:
        return _cached

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
        """Calcula efectividad + pct_pm_ideal para un conjunto de driver_ids.

        Efectividad usa la capa canónica (route_date == fecha_entrega).
        """
        if not driver_ids:
            return {"efectividad": None, "pct_pm_ideal": None, "entregas_por_hora": None}

        # ── Efectividad (capa canónica, agrega múltiples drivers manualmente) ─
        from app.services import metricas_efectividad as _me_local
        total_a_ruta = 0
        total_entregados = 0
        for did in driver_ids:
            k = _me_local.kpis_globales(db, inicio, fin, driver_id=did,
                                        aplicar_exclusiones=False)
            total_a_ruta += k["paquetes_a_ruta"]
            total_entregados += k["paquetes_entregados"]
        efectividad = round(100 * total_entregados / total_a_ruta, 1) if total_a_ruta else 0.0

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
            and r.hora_entrega.hour * 60 + r.hora_entrega.minute >= 16 * 60
            and r.hora_entrega.hour * 60 + r.hora_entrega.minute < 21 * 60
        )
        pct_pm_ideal = round(100 * pm_ideal_n / total_f, 1) if total_f else None

        # ── Entregas por hora ──────────────────────────────────────────────
        # Para cada conductor × día: tasa = entregas / (rango_horas ese día)
        # Luego promediamos las tasas → promedio por conductor (comparable entre
        # conductor individual, zona y global sin inflar por número de drivers)
        from collections import defaultdict as _dd
        dia_rows = (
            db.query(Envio.driver_id, Envio.fecha_entrega, Envio.hora_entrega)
            .filter(
                Envio.driver_id.in_(driver_ids),
                Envio.fecha_entrega >= inicio,
                Envio.fecha_entrega <= fin,
                Envio.hora_entrega.isnot(None),
                ~Envio.seller_id.in_(EFECTIVIDAD_SELLERS_EXCLUIDOS),
            )
            .all()
        )
        # Group by (driver_id, fecha_entrega) so each entry = one driver one day
        dia_horas: dict = _dd(list)
        for r in dia_rows:
            mins = r.hora_entrega.hour * 60 + r.hora_entrega.minute
            dia_horas[(r.driver_id, r.fecha_entrega)].append(mins)

        tasas = []
        for _, horas_mins in dia_horas.items():
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

    result = {
        "driver_id": driver_id,
        "nombre": driver.nombre if driver else f"Driver {driver_id}",
        "zona": zona,
        "seniority_desde": seniority,
        "rango": {"inicio": inicio.isoformat(), "fin": fin.isoformat()},
        "driver": kpis_driver,
        "zona_kpis": kpis_zona,
        "global": kpis_global,
    }
    _cache_set(_ck, result)
    return result


@router.get("/efectividad-v2/seller/{seller_id}")
def efectividad_v2_seller(
    seller_id: int,
    mes: Optional[int] = Query(None),
    anio: Optional[int] = Query(None),
    fecha_inicio: Optional[str] = Query(None),
    fecha_fin: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Drill-down por seller. Calcula con la capa canónica."""
    from app.services import metricas_efectividad as _me

    inicio, fin = _rango_default(mes, anio, fecha_inicio, fecha_fin)

    seller = db.query(Seller).filter(Seller.id == seller_id).first()
    if not seller:
        return {"error": "seller_no_encontrado"}

    aplicar_excl = seller_id not in EFECTIVIDAD_SELLERS_EXCLUIDOS

    # Lookup de seller_codes asociados (informativo, ya no se usa para filtrar:
    # la capa canónica ya hace el match seller_id↔seller_code internamente).
    seller_codes = {
        r.seller_code for r in
        db.query(Envio.seller_code).filter(
            Envio.seller_id == seller_id,
            Envio.seller_code.isnot(None),
        ).distinct().all()
        if r.seller_code
    }

    kpis = _me.kpis_globales(
        db, inicio, fin, seller_id=seller_id, aplicar_exclusiones=aplicar_excl
    )
    serie = _me.kpis_por_dia(
        db, inicio, fin, seller_id=seller_id, aplicar_exclusiones=aplicar_excl
    )

    # serie_temporal: shape compacto que usa el frontend para mini-gráficos
    serie_temporal = [
        {
            "fecha": row["fecha"],
            "a_ruta": row["a_ruta"],
            "entregados": row["entregados"],
            "same_day": row["same_day"],
            "pct_same_day": row["pct_same_day"],
        }
        for row in serie
    ]

    # por_dia: shape extendido para tabla día-a-día
    from datetime import date as _date
    def _weekday_str(iso: str) -> str:
        try:
            return _date.fromisoformat(iso).strftime("%a")
        except Exception:
            return ""

    por_dia = [
        {
            "fecha": row["fecha"],
            "weekday": _weekday_str(row["fecha"]),
            "a_ruta": row["a_ruta"],
            "entregados": row["entregados"],
            "same_day": row["same_day"],
            "cancelados": row["cancelados"],
            "pct_same_day": row["pct_same_day"],
            "pct_delivery_success": row["pct_delivery_success"],
        }
        for row in serie
    ]

    # Por driver que le entrega a este seller: filtrar drivers globales con
    # paquetes de este seller. Reutilizamos por-driver de la capa canónica
    # filtrado por seller (lo hacemos con kpis_por_driver iterando agregados).
    # Versión simple: usar la grilla materializada (kpi_dia con seller_id=X)
    # cuando esté disponible; mientras tanto recalculamos.
    por_driver: list[dict] = []
    for d_kpi in _me.kpis_por_driver(db, inicio, fin, aplicar_exclusiones=aplicar_excl):
        did = d_kpi.get("driver_id")
        if did is None:
            continue
        # Filtrar al subconjunto de este seller usando kpis_globales con doble filtro
        sub = _me.kpis_globales(
            db, inicio, fin,
            driver_id=did, seller_id=seller_id,
            aplicar_exclusiones=aplicar_excl,
        )
        if sub["paquetes_a_ruta"] == 0 and sub["retirados"] == 0:
            continue
        por_driver.append({
            "driver_id": did,
            "nombre": d_kpi["nombre"],
            **sub,
        })
    por_driver.sort(key=lambda x: -x["paquetes_a_ruta"])

    return {
        "seller_id": seller_id,
        "nombre": seller.nombre,
        "codigos": sorted(seller_codes),
        "rango": {"inicio": inicio.isoformat(), "fin": fin.isoformat()},
        "version": "v3-canonica",
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

    # Importamos la clasificación canónica para que el mapa use la misma
    # definición de "same-day" que las tarjetas de KPI.
    from app.services.metricas_efectividad import (
        business_days_between as _bd,
        clasificar as _clasificar,
    )

    puntos: list[dict] = []
    contador = {"same_day": 0, "entregado_no_sd": 0, "pendiente": 0, "cancelado": 0}

    for asig, envio in rows:
        cls = _clasificar(asig, envio)
        if cls.cancelado:
            estado_cod = 3
            contador["cancelado"] += 1
        elif cls.entregado_mismo_dia_withdrawal:
            estado_cod = 1
            contador["same_day"] += 1
        elif cls.entregado:
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
    ("am_mañana",  "Mañana (08–12 h)",        "08:00:00", "11:59:59"),
    ("am_tarde",   "Mediodía (12–15 h)",       "12:00:00", "14:59:59"),
    ("pm_inicio",  "Primera tarde (15–16 h)",  "15:00:00", "15:59:59"),
    ("pm_ideal",   "Tarde ideal (16–21 h)",    "16:00:00", "20:59:59"),
    ("pm_limite",  "Límite (21–22 h)",         "21:00:00", "21:59:59"),
    ("pm_tarde",   "Tarde (22+ h)",            "22:00:00", "23:59:59"),
    ("madrugada",  "Madrugada (0–8 h)",        "00:00:00", "07:59:59"),
]

# Hour ranges [lo, hi) for each franja key (used by agrupacion=hora drill-down)
_FRANJA_HOUR_RANGES: dict = {
    "am_mañana": (8,  12),
    "am_tarde":  (12, 15),
    "pm_inicio": (15, 16),
    "pm_ideal":  (16, 21),
    "pm_limite": (21, 22),
    "pm_tarde":  (22, 24),
    "madrugada": (0,  8),
}


def _franja_case():
    """CASE WHEN para asignar franja a cada envío según hora_entrega."""
    from sqlalchemy import case
    from app.models import Envio as _Envio
    whens = [
        ((_Envio.hora_entrega >= "08:00:00") & (_Envio.hora_entrega < "12:00:00"), "am_mañana"),
        ((_Envio.hora_entrega >= "12:00:00") & (_Envio.hora_entrega < "15:00:00"), "am_tarde"),
        ((_Envio.hora_entrega >= "15:00:00") & (_Envio.hora_entrega < "16:00:00"), "pm_inicio"),
        ((_Envio.hora_entrega >= "16:00:00") & (_Envio.hora_entrega < "21:00:00"), "pm_ideal"),
        ((_Envio.hora_entrega >= "21:00:00") & (_Envio.hora_entrega < "22:00:00"), "pm_limite"),
        ((_Envio.hora_entrega >= "22:00:00"), "pm_tarde"),
        (_Envio.hora_entrega.isnot(None), "madrugada"),
    ]
    return case(*[(cond, val) for cond, val in whens], else_="sin_hora")


def _build_franja_stats(rows) -> dict:
    """Agrega una lista de (franja, count) en el dict estándar de franjas."""
    total = sum(n for _, n in rows)
    d = {k: {"n": 0, "pct": 0.0} for k, *_ in _FRANJAS}
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
    agrupacion: str = Query("global", description="global | dia | semana | mes | driver | seller | ruta | comuna | hora"),
    franja: Optional[str] = Query(None, description="Filtrar a una franja específica (solo relevante cuando agrupacion=hora)"),
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
    - hora    → una fila por hora del día (0–23); si `franja` se especifica,
                filtra solo las horas dentro de esa ventana horaria
    """
    inicio, fin = _rango_default(mes, anio, fecha_inicio, fecha_fin)

    _ck = f"franjas:{inicio}:{fin}:{driver_id}:{seller_id}:{agrupacion}:{franja}"
    _cached = _cache_get(_ck)
    if _cached is not None:
        return _cached

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
        if hm < 8 * 60:   return "madrugada"
        if hm < 12 * 60:  return "am_mañana"
        if hm < 15 * 60:  return "am_tarde"
        if hm < 16 * 60:  return "pm_inicio"
        if hm < 21 * 60:  return "pm_ideal"
        if hm < 22 * 60:  return "pm_limite"
        return "pm_tarde"

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
        if agrupacion == "hora":
            if row.hora_entrega is None:
                return None
            return str(row.hora_entrega.hour)
        return "global"

    # Pre-filter rows when drilling down into a specific franja by hour
    if agrupacion == "hora" and franja and franja in _FRANJA_HOUR_RANGES:
        lo, hi = _FRANJA_HOUR_RANGES[franja]
        rows = [r for r in rows if r.hora_entrega is not None and lo <= r.hora_entrega.hour < hi]

    from collections import defaultdict
    buckets: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    meta: dict[str, dict] = {}

    for row in rows:
        key = _agg_key(row)
        if key is None:
            continue
        franja_slot = _franja_sql(row.hora_entrega)
        buckets[key][franja_slot] += 1
        # guardar etiqueta legible
        if key not in meta:
            label = key
            if agrupacion == "driver" and row.driver_id:
                label = drivers_map.get(row.driver_id, key)
            elif agrupacion == "seller" and row.seller_id:
                label = sellers_map.get(row.seller_id, key)
            elif agrupacion == "hora":
                label = f"{key}:00 h"
            meta[key] = {"key": key, "label": label}

    franja_keys = ["am_mañana", "am_tarde", "pm_inicio", "pm_ideal", "pm_limite", "pm_tarde", "madrugada", "sin_hora"]
    franja_labels = {
        "am_mañana":  "Mañana (08–12 h)",
        "am_tarde":   "Mediodía (12–15 h)",
        "pm_inicio":  "Primera tarde (15–16 h)",
        "pm_ideal":   "Tarde ideal (16–21 h) ★",
        "pm_limite":  "Límite (21–22 h)",
        "pm_tarde":   "Tarde (22+ h)",
        "madrugada":  "Madrugada (0–8 h)",
        "sin_hora":   "Sin hora registrada",
    }
    franja_colors = {
        "am_mañana":  "#93c5fd",  # sky-300
        "am_tarde":   "#3b82f6",  # blue-500
        "pm_inicio":  "#6366f1",  # indigo-500
        "pm_ideal":   "#10b981",  # emerald-500 (benchmark)
        "pm_limite":  "#f97316",  # orange-500
        "pm_tarde":   "#ef4444",  # red-500
        "madrugada":  "#8b5cf6",  # purple-500
        "sin_hora":   "#94a3b8",  # slate-400
    }

    # Sort numerically for hora agrupacion, alphabetically otherwise
    def _sort_key(item):
        k = item[0]
        if agrupacion == "hora":
            try:
                return (0, int(k))
            except ValueError:
                return (1, k)
        return (0, k)

    result_rows = []
    for key, counts in sorted(buckets.items(), key=_sort_key):
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
        global_summary[fk] = {
            "n": n,
            "pct": round(100 * n / grand_total, 1) if grand_total else 0.0,
        }

    result = {
        "rango": {"inicio": inicio.isoformat(), "fin": fin.isoformat()},
        "agrupacion": agrupacion,
        "franjas": [
            {"key": fk, "label": franja_labels[fk], "color": franja_colors[fk]}
            for fk in franja_keys
        ],
        "global": global_summary,
        "rows": result_rows,
    }
    _cache_set(_ck, result)
    return result

