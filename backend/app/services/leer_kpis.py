"""
Capa de lectura de KPIs materializados (kpi_dia).

Lee directamente con SQL sobre `kpi_dia` en lugar de recalcular desde
`asignacion_ruta` + `Envio`. Esto hace los endpoints instantáneos:
la tabla ya tiene los conteos agregados por (fecha, dimension, driver, seller).

Estrategia de fallback:
  Si no hay filas en `kpi_dia` para el rango pedido (p.ej. primer arrange de
  un rango nuevo antes del cron), el caller puede caer al cálculo canónico
  via `metricas_efectividad.py`. Los endpoints de dashboard lo hacen
  automáticamente.

Output shape: IDÉNTICO al de metricas_efectividad.py para ser intercambiable.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Optional

from sqlalchemy import func, Integer
from sqlalchemy.orm import Session

from app.models import Driver, KpiDia, KpiNoEntregado, Seller
from app.services.metricas_efectividad import (
    DIMENSION_ROUTE_DATE,
    DIMENSION_WITHDRAWAL_DATE,
    KpiCounts,
    _ratio,
    kpi_counts_to_kpis,
)


# ═════════════════════════════════════════════════════════════════════════════
# Helpers internos
# ═════════════════════════════════════════════════════════════════════════════

def _agg_rd(db: Session, inicio: date, fin: date, *, driver_id=None, seller_id=None) -> KpiCounts:
    """Suma route_date dimension para la grilla (driver_id, seller_id) en [inicio, fin]."""
    q = db.query(
        func.coalesce(func.sum(KpiDia.a_ruta), 0).label("a_ruta"),
        func.coalesce(func.sum(KpiDia.entregados_mismo_dia), 0).label("entregados_mismo_dia"),
        func.coalesce(func.sum(KpiDia.cancelados), 0).label("cancelados"),
        func.coalesce(func.sum(KpiDia.primer_intento_ok), 0).label("primer_intento_ok"),
        func.coalesce(func.sum(KpiDia.entregados_intento_1), 0).label("entregados_intento_1"),
        func.coalesce(func.sum(KpiDia.entregados_intento_2), 0).label("entregados_intento_2"),
        func.coalesce(func.sum(KpiDia.entregados_intento_3plus), 0).label("entregados_intento_3plus"),
        func.coalesce(func.sum(KpiDia.n_0d), 0).label("n_0d"),
        func.coalesce(func.sum(KpiDia.n_1d), 0).label("n_1d"),
        func.coalesce(func.sum(KpiDia.n_2d), 0).label("n_2d"),
        func.coalesce(func.sum(KpiDia.n_3d), 0).label("n_3d"),
        func.coalesce(func.sum(KpiDia.n_4plus), 0).label("n_4plus"),
    ).filter(
        KpiDia.dimension == DIMENSION_ROUTE_DATE,
        KpiDia.fecha >= inicio,
        KpiDia.fecha <= fin,
        _grilla_filter(driver_id, seller_id),
    ).first()

    if q is None:
        return KpiCounts()
    return KpiCounts(
        a_ruta=int(q.a_ruta or 0),
        entregados_mismo_dia=int(q.entregados_mismo_dia or 0),
        cancelados=int(q.cancelados or 0),
        primer_intento_ok=int(q.primer_intento_ok or 0),
        entregados_intento_1=int(q.entregados_intento_1 or 0),
        entregados_intento_2=int(q.entregados_intento_2 or 0),
        entregados_intento_3plus=int(q.entregados_intento_3plus or 0),
        n_0d=int(q.n_0d or 0), n_1d=int(q.n_1d or 0),
        n_2d=int(q.n_2d or 0), n_3d=int(q.n_3d or 0), n_4plus=int(q.n_4plus or 0),
    )


def _agg_wd(db: Session, inicio: date, fin: date, *, driver_id=None, seller_id=None) -> KpiCounts:
    """Suma withdrawal_date dimension para la grilla (driver_id, seller_id) en [inicio, fin]."""
    q = db.query(
        func.coalesce(func.sum(KpiDia.retirados), 0).label("retirados"),
        func.coalesce(func.sum(KpiDia.same_day), 0).label("same_day"),
    ).filter(
        KpiDia.dimension == DIMENSION_WITHDRAWAL_DATE,
        KpiDia.fecha >= inicio,
        KpiDia.fecha <= fin,
        _grilla_filter(driver_id, seller_id),
    ).first()

    if q is None:
        return KpiCounts()
    return KpiCounts(
        retirados=int(q.retirados or 0),
        same_day=int(q.same_day or 0),
    )


def _combinar(c_rd: KpiCounts, c_wd: KpiCounts) -> KpiCounts:
    return KpiCounts(
        a_ruta=c_rd.a_ruta,
        retirados=c_wd.retirados,
        entregados_mismo_dia=c_rd.entregados_mismo_dia,
        same_day=c_wd.same_day,
        cancelados=c_rd.cancelados,
        primer_intento_ok=c_rd.primer_intento_ok,
        entregados_intento_1=c_rd.entregados_intento_1,
        entregados_intento_2=c_rd.entregados_intento_2,
        entregados_intento_3plus=c_rd.entregados_intento_3plus,
        n_0d=c_rd.n_0d, n_1d=c_rd.n_1d, n_2d=c_rd.n_2d,
        n_3d=c_rd.n_3d, n_4plus=c_rd.n_4plus,
    )


def _grilla_filter(driver_id, seller_id):
    """Filtro exacto de grilla: NULL means 'aggregate all'."""
    from sqlalchemy import and_
    conditions = []
    if driver_id is None:
        conditions.append(KpiDia.driver_id.is_(None))
    else:
        conditions.append(KpiDia.driver_id == driver_id)
    if seller_id is None:
        conditions.append(KpiDia.seller_id.is_(None))
    else:
        conditions.append(KpiDia.seller_id == seller_id)
    return and_(*conditions) if conditions else True


def _tiene_datos(db: Session, inicio: date, fin: date,
                 driver_id=None, seller_id=None) -> bool:
    """True si kpi_dia tiene al menos 1 fila para el rango/grilla pedido."""
    return db.query(KpiDia.id).filter(
        KpiDia.dimension == DIMENSION_ROUTE_DATE,
        KpiDia.fecha >= inicio,
        KpiDia.fecha <= fin,
        _grilla_filter(driver_id, seller_id),
    ).limit(1).first() is not None


# ═════════════════════════════════════════════════════════════════════════════
# API pública — misma firma que metricas_efectividad.py
# ═════════════════════════════════════════════════════════════════════════════

def kpis_globales(
    db: Session,
    inicio: date,
    fin: date,
    *,
    driver_id: Optional[int] = None,
    seller_id: Optional[int] = None,
    seller_code: Optional[str] = None,
) -> dict:
    """KPIs globales del rango leídos directamente de kpi_dia.

    Para seller_code (campo crudo del courier) se hace un lookup → seller_id.
    """
    if seller_code and seller_id is None:
        from app.models import Envio
        r = db.query(Envio.seller_id).filter(
            Envio.seller_code == seller_code,
            Envio.seller_id.isnot(None),
        ).first()
        if r:
            seller_id = r.seller_id

    c_rd = _agg_rd(db, inicio, fin, driver_id=driver_id, seller_id=seller_id)
    c_wd = _agg_wd(db, inicio, fin, driver_id=driver_id, seller_id=seller_id)
    return kpi_counts_to_kpis(_combinar(c_rd, c_wd))


def kpis_por_dia(
    db: Session,
    inicio: date,
    fin: date,
    *,
    driver_id: Optional[int] = None,
    seller_id: Optional[int] = None,
) -> list[dict]:
    """Serie temporal: una entrada por día, ambas métricas (efectividad + same-day)."""
    from sqlalchemy import case

    # Una sola query que trae (fecha, dimension, sumas...) — las agrupamos en Python
    rows = db.query(
        KpiDia.fecha,
        KpiDia.dimension,
        func.coalesce(func.sum(KpiDia.a_ruta), 0).label("a_ruta"),
        func.coalesce(func.sum(KpiDia.entregados_mismo_dia), 0).label("entregados"),
        func.coalesce(func.sum(KpiDia.same_day), 0).label("same_day"),
        func.coalesce(func.sum(KpiDia.retirados), 0).label("retirados"),
        func.coalesce(func.sum(KpiDia.cancelados), 0).label("cancelados"),
        func.coalesce(func.sum(KpiDia.entregados_intento_1), 0).label("entregados_intento_1"),
        func.coalesce(func.sum(KpiDia.entregados_intento_2), 0).label("entregados_intento_2"),
        func.coalesce(func.sum(KpiDia.entregados_intento_3plus), 0).label("entregados_intento_3plus"),
    ).filter(
        KpiDia.fecha >= inicio,
        KpiDia.fecha <= fin,
        _grilla_filter(driver_id, seller_id),
    ).group_by(KpiDia.fecha, KpiDia.dimension).all()

    # Pivot por (fecha, dimension) → dict
    rd: dict[date, object] = {}
    wd: dict[date, object] = {}
    for r in rows:
        if r.dimension == DIMENSION_ROUTE_DATE:
            rd[r.fecha] = r
        else:
            wd[r.fecha] = r

    fechas = sorted(set(rd.keys()) | set(wd.keys()))
    out = []
    for d in fechas:
        r = rd.get(d)
        w = wd.get(d)
        a_ruta = int(r.a_ruta) if r else 0
        entregados = int(r.entregados) if r else 0
        cancelados = int(r.cancelados) if r else 0
        same_day = int(w.same_day) if w else 0
        retirados = int(w.retirados) if w else 0
        ei1 = int(r.entregados_intento_1) if r else 0
        ei2 = int(r.entregados_intento_2) if r else 0
        ei3 = int(r.entregados_intento_3plus) if r else 0

        out.append({
            "fecha": d.isoformat(),
            "weekday": d.weekday(),
            "a_ruta": a_ruta,
            "entregados": entregados,
            "same_day": same_day,
            "retirados": retirados,
            "cancelados": cancelados,
            "label": f"{entregados}/{a_ruta}",
            "pct_delivery_success": _ratio(entregados, a_ruta),
            "pct_same_day": _ratio(same_day, retirados),
            "pct_otif": _ratio(same_day, retirados),
            "pct_intento_1": _ratio(ei1, a_ruta),
            "pct_intento_2": _ratio(ei2, a_ruta),
            "pct_intento_3plus": _ratio(ei3, a_ruta),
            "entregados_intento_1": ei1,
            "entregados_intento_2": ei2,
            "entregados_intento_3plus": ei3,
        })
    return out


def kpis_por_driver(
    db: Session,
    inicio: date,
    fin: date,
) -> list[dict]:
    """Una fila por driver, combinando route_date y withdrawal_date."""
    # Route_date: una fila por driver (seller_id IS NULL, driver_id IS NOT NULL)
    rows_rd = db.query(
        KpiDia.driver_id,
        func.coalesce(func.sum(KpiDia.a_ruta), 0).label("a_ruta"),
        func.coalesce(func.sum(KpiDia.entregados_mismo_dia), 0).label("entregados"),
        func.coalesce(func.sum(KpiDia.cancelados), 0).label("cancelados"),
        func.coalesce(func.sum(KpiDia.primer_intento_ok), 0).label("primer_intento_ok"),
        func.coalesce(func.sum(KpiDia.entregados_intento_1), 0).label("ei1"),
        func.coalesce(func.sum(KpiDia.entregados_intento_2), 0).label("ei2"),
        func.coalesce(func.sum(KpiDia.entregados_intento_3plus), 0).label("ei3"),
        func.coalesce(func.sum(KpiDia.n_0d), 0).label("n_0d"),
        func.coalesce(func.sum(KpiDia.n_1d), 0).label("n_1d"),
        func.coalesce(func.sum(KpiDia.n_2d), 0).label("n_2d"),
        func.coalesce(func.sum(KpiDia.n_3d), 0).label("n_3d"),
        func.coalesce(func.sum(KpiDia.n_4plus), 0).label("n_4plus"),
    ).filter(
        KpiDia.dimension == DIMENSION_ROUTE_DATE,
        KpiDia.driver_id.isnot(None),
        KpiDia.seller_id.is_(None),
        KpiDia.fecha >= inicio,
        KpiDia.fecha <= fin,
    ).group_by(KpiDia.driver_id).all()

    rows_wd = db.query(
        KpiDia.driver_id,
        func.coalesce(func.sum(KpiDia.retirados), 0).label("retirados"),
        func.coalesce(func.sum(KpiDia.same_day), 0).label("same_day"),
    ).filter(
        KpiDia.dimension == DIMENSION_WITHDRAWAL_DATE,
        KpiDia.driver_id.isnot(None),
        KpiDia.seller_id.is_(None),
        KpiDia.fecha >= inicio,
        KpiDia.fecha <= fin,
    ).group_by(KpiDia.driver_id).all()

    wd_map = {r.driver_id: r for r in rows_wd}
    nombres = {d.id: d.nombre for d in db.query(Driver.id, Driver.nombre).all()}

    # Spark: % same-day últimos 7 días por driver — una sola query
    spark_inicio = fin - timedelta(days=7)
    spark_rows = db.query(
        KpiDia.driver_id,
        KpiDia.fecha,
        KpiDia.same_day,
        KpiDia.retirados,
    ).filter(
        KpiDia.dimension == DIMENSION_WITHDRAWAL_DATE,
        KpiDia.driver_id.isnot(None),
        KpiDia.seller_id.is_(None),
        KpiDia.fecha >= spark_inicio,
        KpiDia.fecha <= fin,
    ).all()
    spark_map: dict[int, dict[date, tuple]] = defaultdict(dict)
    for sr in spark_rows:
        spark_map[sr.driver_id][sr.fecha] = (int(sr.same_day or 0), int(sr.retirados or 0))

    out = []
    for r in rows_rd:
        did = r.driver_id
        wd = wd_map.get(did)
        retirados = int(wd.retirados or 0) if wd else 0
        same_day = int(wd.same_day or 0) if wd else 0
        a_ruta = int(r.a_ruta or 0)
        entregados = int(r.entregados or 0)
        cancelados = int(r.cancelados or 0)
        primer_intento_ok = int(r.primer_intento_ok or 0)
        ei1 = int(r.ei1 or 0)
        ei2 = int(r.ei2 or 0)
        ei3 = int(r.ei3 or 0)

        spark_by_day = spark_map.get(did, {})
        spark_dates = sorted(spark_by_day.keys())[-7:]
        spark = [_ratio(spark_by_day[d][0], spark_by_day[d][1]) for d in spark_dates]

        out.append({
            "driver_id": did,
            "nombre": nombres.get(did, f"Driver {did}"),
            "spark": spark,
            "paquetes_a_ruta": a_ruta,
            "retirados": retirados,
            "paquetes_entregados": entregados,
            "same_day": same_day,
            "cancelados": cancelados,
            "primer_intento_ok": primer_intento_ok,
            "entregados_intento_1": ei1,
            "entregados_intento_2": ei2,
            "entregados_intento_3plus": ei3,
            "pct_delivery_success": _ratio(entregados, a_ruta),
            "pct_same_day": _ratio(same_day, retirados),
            "pct_first_attempt": _ratio(primer_intento_ok, a_ruta),
            "pct_otif": _ratio(same_day, retirados),
            "pct_intento_1": _ratio(ei1, a_ruta),
            "pct_intento_2": _ratio(ei2, a_ruta),
            "pct_intento_3plus": _ratio(ei3, a_ruta),
            "distribucion": {
                "n_0d": int(r.n_0d or 0), "n_1d": int(r.n_1d or 0),
                "n_2d": int(r.n_2d or 0), "n_3d": int(r.n_3d or 0),
                "n_4plus": int(r.n_4plus or 0),
                "n_sin_entregar": max(0, a_ruta - int(r.n_0d or 0) - int(r.n_1d or 0) - int(r.n_2d or 0) - int(r.n_3d or 0) - int(r.n_4plus or 0)),
                "pct_0d": _ratio(int(r.n_0d or 0), a_ruta),
                "pct_1d": _ratio(int(r.n_1d or 0), a_ruta),
                "pct_2d": _ratio(int(r.n_2d or 0), a_ruta),
                "pct_3d": _ratio(int(r.n_3d or 0), a_ruta),
                "pct_4plus": _ratio(int(r.n_4plus or 0), a_ruta),
                "pct_sin_entregar": _ratio(
                    max(0, a_ruta - int(r.n_0d or 0) - int(r.n_1d or 0) - int(r.n_2d or 0) - int(r.n_3d or 0) - int(r.n_4plus or 0)),
                    a_ruta,
                ),
            },
        })

    out.sort(key=lambda x: -x["paquetes_a_ruta"])
    return out


def kpis_por_seller(
    db: Session,
    inicio: date,
    fin: date,
) -> list[dict]:
    """Una fila por seller, combinando route_date y withdrawal_date."""
    rows_rd = db.query(
        KpiDia.seller_id,
        func.coalesce(func.sum(KpiDia.a_ruta), 0).label("a_ruta"),
        func.coalesce(func.sum(KpiDia.entregados_mismo_dia), 0).label("entregados"),
        func.coalesce(func.sum(KpiDia.cancelados), 0).label("cancelados"),
        func.coalesce(func.sum(KpiDia.primer_intento_ok), 0).label("primer_intento_ok"),
        func.coalesce(func.sum(KpiDia.entregados_intento_1), 0).label("ei1"),
        func.coalesce(func.sum(KpiDia.entregados_intento_2), 0).label("ei2"),
        func.coalesce(func.sum(KpiDia.entregados_intento_3plus), 0).label("ei3"),
    ).filter(
        KpiDia.dimension == DIMENSION_ROUTE_DATE,
        KpiDia.driver_id.is_(None),
        KpiDia.seller_id.isnot(None),
        KpiDia.fecha >= inicio,
        KpiDia.fecha <= fin,
    ).group_by(KpiDia.seller_id).all()

    rows_wd = db.query(
        KpiDia.seller_id,
        func.coalesce(func.sum(KpiDia.retirados), 0).label("retirados"),
        func.coalesce(func.sum(KpiDia.same_day), 0).label("same_day"),
    ).filter(
        KpiDia.dimension == DIMENSION_WITHDRAWAL_DATE,
        KpiDia.driver_id.is_(None),
        KpiDia.seller_id.isnot(None),
        KpiDia.fecha >= inicio,
        KpiDia.fecha <= fin,
    ).group_by(KpiDia.seller_id).all()

    wd_map = {r.seller_id: r for r in rows_wd}
    nombres: dict[int, str] = {}
    sids = [r.seller_id for r in rows_rd if r.seller_id is not None]
    if sids:
        nombres = {
            s.id: s.nombre
            for s in db.query(Seller.id, Seller.nombre).filter(Seller.id.in_(sids)).all()
        }

    out = []
    for r in rows_rd:
        sid = r.seller_id
        wd = wd_map.get(sid)
        retirados = int(wd.retirados or 0) if wd else 0
        same_day = int(wd.same_day or 0) if wd else 0
        a_ruta = int(r.a_ruta or 0)
        entregados = int(r.entregados or 0)
        cancelados = int(r.cancelados or 0)
        ei1 = int(r.ei1 or 0)
        ei2 = int(r.ei2 or 0)
        ei3 = int(r.ei3 or 0)

        out.append({
            "seller_id": sid,
            "nombre": nombres.get(sid, f"Seller {sid}") if sid else "Sin envío reconciliado",
            "paquetes_a_ruta": a_ruta,
            "retirados": retirados,
            "paquetes_entregados": entregados,
            "same_day": same_day,
            "cancelados": cancelados,
            "primer_intento_ok": int(r.primer_intento_ok or 0),
            "entregados_intento_1": ei1,
            "entregados_intento_2": ei2,
            "entregados_intento_3plus": ei3,
            "pct_delivery_success": _ratio(entregados, a_ruta),
            "pct_same_day": _ratio(same_day, retirados),
            "pct_first_attempt": _ratio(int(r.primer_intento_ok or 0), a_ruta),
            "pct_otif": _ratio(same_day, retirados),
            "pct_intento_1": _ratio(ei1, a_ruta),
            "pct_intento_2": _ratio(ei2, a_ruta),
            "pct_intento_3plus": _ratio(ei3, a_ruta),
            "distribucion": {},  # sellers no necesitan distribución de ciclo
        })

    out.sort(key=lambda x: -x["paquetes_a_ruta"])
    return out


def kpis_driver_detalle(
    db: Session,
    driver_id: int,
    inicio: date,
    fin: date,
) -> dict:
    """KPIs globales + serie temporal + no-entregados para un driver.

    Reemplaza el recálculo completo en el endpoint /efectividad-v2/driver/{id}.
    Los no-entregados vienen de `kpi_no_entregado` (ya materializada).
    Por ruta NO se lee de kpi_dia (no tiene route_id); se calcula on-demand.
    """
    kpis = kpis_globales(db, inicio, fin, driver_id=driver_id)
    serie = kpis_por_dia(db, inicio, fin, driver_id=driver_id)

    # Heatmap = mismo shape que serie (ya tiene weekday, label, pct_*)
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

    # Rendimiento del conductor (identico al heatmap pero con pct_entrega)
    rend_a_ruta = sum(r["a_ruta"] for r in serie)
    rend_entregados = sum(r["entregados"] for r in serie)
    rend_pct = _ratio(rend_entregados, rend_a_ruta)
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

    # No-entregados desde kpi_no_entregado
    seller_nombres = {s.id: s.nombre for s in db.query(Seller.id, Seller.nombre).all()}
    ne_rows = db.query(KpiNoEntregado).filter(
        KpiNoEntregado.driver_id == driver_id,
        KpiNoEntregado.route_date >= inicio,
        KpiNoEntregado.route_date <= fin,
    ).order_by(KpiNoEntregado.route_date.desc()).limit(200).all()

    no_entregados = [
        {
            "tracking_id": ne.tracking_id,
            "fecha_retiro": ne.withdrawal_date.isoformat() if ne.withdrawal_date else None,
            "intento_nro": ne.intento_nro,
            "ruta_nombre": ne.route_name,
            "seller_code": ne.seller_code,
            "envio_id": None,
            "seller": seller_nombres.get(ne.seller_id) if ne.seller_id else None,
            "comuna": None,
            "motivo": ne.motivo,
        }
        for ne in ne_rows
    ]

    ne_total = db.query(func.count(KpiNoEntregado.id)).filter(
        KpiNoEntregado.driver_id == driver_id,
        KpiNoEntregado.route_date >= inicio,
        KpiNoEntregado.route_date <= fin,
    ).scalar() or 0

    return {
        "kpis": kpis,
        "serie": serie,
        "heatmap": heatmap,
        "rendimiento": {
            "paquetes_a_ruta": rend_a_ruta,
            "paquetes_entregados": rend_entregados,
            "paquetes_sin_entregar": rend_a_ruta - rend_entregados,
            "pct_entrega_mismo_dia": rend_pct,
            "heatmap": rend_heatmap,
        },
        "no_entregados": no_entregados,
        "no_entregados_total": ne_total,
    }


def kpis_seller_detalle(
    db: Session,
    seller_id: int,
    inicio: date,
    fin: date,
) -> dict:
    """KPIs globales + serie temporal para un seller."""
    kpis = kpis_globales(db, inicio, fin, seller_id=seller_id)
    serie = kpis_por_dia(db, inicio, fin, seller_id=seller_id)

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

    # Por driver que entregó a este seller: leer kpi_dia con seller_id=X, driver_id group
    rows_rd = db.query(
        KpiDia.driver_id,
        func.coalesce(func.sum(KpiDia.a_ruta), 0).label("a_ruta"),
        func.coalesce(func.sum(KpiDia.entregados_mismo_dia), 0).label("entregados"),
        func.coalesce(func.sum(KpiDia.cancelados), 0).label("cancelados"),
    ).filter(
        KpiDia.dimension == DIMENSION_ROUTE_DATE,
        KpiDia.seller_id == seller_id,
        KpiDia.driver_id.isnot(None),
        KpiDia.fecha >= inicio,
        KpiDia.fecha <= fin,
    ).group_by(KpiDia.driver_id).all()

    rows_wd_d = db.query(
        KpiDia.driver_id,
        func.coalesce(func.sum(KpiDia.same_day), 0).label("same_day"),
        func.coalesce(func.sum(KpiDia.retirados), 0).label("retirados"),
    ).filter(
        KpiDia.dimension == DIMENSION_WITHDRAWAL_DATE,
        KpiDia.seller_id == seller_id,
        KpiDia.driver_id.isnot(None),
        KpiDia.fecha >= inicio,
        KpiDia.fecha <= fin,
    ).group_by(KpiDia.driver_id).all()

    wd_d_map = {r.driver_id: r for r in rows_wd_d}
    driver_nombres = {d.id: d.nombre for d in db.query(Driver.id, Driver.nombre).all()}

    por_driver = []
    for r in rows_rd:
        did = r.driver_id
        wd = wd_d_map.get(did)
        a_ruta = int(r.a_ruta or 0)
        entregados = int(r.entregados or 0)
        same_day = int(wd.same_day or 0) if wd else 0
        retirados = int(wd.retirados or 0) if wd else 0
        por_driver.append({
            "driver_id": did,
            "nombre": driver_nombres.get(did, f"Driver {did}"),
            "paquetes_a_ruta": a_ruta,
            "paquetes_entregados": entregados,
            "same_day": same_day,
            "cancelados": int(r.cancelados or 0),
            "pct_delivery_success": _ratio(entregados, a_ruta),
            "pct_same_day": _ratio(same_day, retirados),
        })
    por_driver.sort(key=lambda x: -x["paquetes_a_ruta"])

    return {
        "kpis": kpis,
        "serie_temporal": serie_temporal,
        "por_dia": por_dia,
        "por_driver": por_driver,
    }


def _weekday_str(iso: str) -> str:
    try:
        from datetime import date as _date
        return _date.fromisoformat(iso).strftime("%a")
    except Exception:
        return ""
