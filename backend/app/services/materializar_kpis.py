"""
Materialización de KPIs de efectividad en BD.

Persiste el resultado de `metricas_efectividad.calcular_grilla_dia` en la tabla
`kpi_dia` para que los endpoints de dashboard puedan servir instantáneamente
sin recalcular en cada request.

Estrategia:
  - Recompute INCREMENTAL POR DÍA: cada día se borra y reinserta entero.
  - Idempotente: correrlo N veces da el mismo resultado.
  - Disparado por: hook post-ingesta de rutas, hook post-ingesta CSV, cron de
    seguridad nocturno (04:30, últimos 7 días), y endpoint admin manual.
  - Backfill inicial: `backfill_kpis(inicio, fin)` itera día por día.

Coexiste sin pelearse con la lógica vieja (en V3 los endpoints leen desde acá,
en V2 los endpoints recalculan en vivo). Mientras el switch no esté hecho,
estas tablas son solo "shadow data".
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from app.models import AsignacionRuta, Envio, KpiDia, KpiNoEntregado, Seller
from app.services.metricas_efectividad import (
    DIMENSION_ROUTE_DATE,
    DIMENSION_WITHDRAWAL_DATE,
    calcular_grilla_dia,
    detalle_no_entregados,
)

logger = logging.getLogger(__name__)


def recomputar_kpis(db: Session, fecha: date) -> dict:
    """Recompute completo de `kpi_dia` y `kpi_no_entregado` para `fecha`.

    Idempotente: borra todas las filas de esa fecha (en ambas dimensiones) y
    reinserta el resultado actual. Si no hay datos en `asignacion_ruta` para esa
    fecha, las tablas quedan vacías para esa fecha.

    Devuelve un resumen con los conteos creados.
    """
    # ── Borrar filas previas de la fecha (ambas dimensiones) ────────────────
    db.query(KpiDia).filter(KpiDia.fecha == fecha).delete(synchronize_session=False)
    db.query(KpiNoEntregado).filter(KpiNoEntregado.route_date == fecha).delete(
        synchronize_session=False
    )

    # ── Calcular grilla en cada dimensión ───────────────────────────────────
    grilla_rd = calcular_grilla_dia(db, fecha, DIMENSION_ROUTE_DATE)
    grilla_wd = calcular_grilla_dia(db, fecha, DIMENSION_WITHDRAWAL_DATE)

    insertadas = 0
    for (driver_id, seller_id), counts in grilla_rd.items():
        if _es_fila_vacia(counts):
            continue
        db.add(KpiDia(
            fecha=fecha,
            dimension=DIMENSION_ROUTE_DATE,
            driver_id=driver_id,
            seller_id=seller_id,
            a_ruta=counts.a_ruta,
            retirados=counts.retirados,  # 0 en este modo
            entregados_mismo_dia=counts.entregados_mismo_dia,
            same_day=counts.same_day,    # 0 en este modo
            cancelados=counts.cancelados,
            primer_intento_ok=counts.primer_intento_ok,
            entregados_intento_1=counts.entregados_intento_1,
            entregados_intento_2=counts.entregados_intento_2,
            entregados_intento_3plus=counts.entregados_intento_3plus,
            n_0d=counts.n_0d, n_1d=counts.n_1d, n_2d=counts.n_2d,
            n_3d=counts.n_3d, n_4plus=counts.n_4plus,
        ))
        insertadas += 1

    for (driver_id, seller_id), counts in grilla_wd.items():
        if _es_fila_vacia(counts):
            continue
        db.add(KpiDia(
            fecha=fecha,
            dimension=DIMENSION_WITHDRAWAL_DATE,
            driver_id=driver_id,
            seller_id=seller_id,
            a_ruta=counts.a_ruta,                        # 0 en este modo
            retirados=counts.retirados,
            entregados_mismo_dia=counts.entregados_mismo_dia,  # 0
            same_day=counts.same_day,
            cancelados=counts.cancelados,
            primer_intento_ok=counts.primer_intento_ok,  # 0
            entregados_intento_1=counts.entregados_intento_1,
            entregados_intento_2=counts.entregados_intento_2,
            entregados_intento_3plus=counts.entregados_intento_3plus,
            n_0d=counts.n_0d, n_1d=counts.n_1d, n_2d=counts.n_2d,
            n_3d=counts.n_3d, n_4plus=counts.n_4plus,
        ))
        insertadas += 1

    # ── No-entregados detallados (solo por route_date) ──────────────────────
    no_entregados = detalle_no_entregados(db, fecha, fecha, aplicar_exclusiones=True)
    for ne in no_entregados:
        db.add(KpiNoEntregado(
            tracking_id=ne["tracking_id"],
            route_date=fecha,
            withdrawal_date=_parse_iso(ne["withdrawal_date"]),
            fecha_entrega=_parse_iso(ne["fecha_entrega"]),
            driver_id=ne["driver_id"],
            driver_name=ne["driver_name"],
            route_name=ne["route_name"],
            seller_id=ne["seller_id"],
            seller_code=ne["seller_code"],
            status_externo=ne["status_externo"],
            motivo=ne["motivo"],
            intento_nro=ne["intento_nro"] or 1,
            address_full=ne["address_full"],
            address_lat=ne["address_lat"],
            address_lon=ne["address_lon"],
        ))

    db.commit()

    return {
        "fecha": fecha.isoformat(),
        "filas_kpi_dia": insertadas,
        "filas_no_entregado": len(no_entregados),
    }


def recomputar_rango(db: Session, inicio: date, fin: date) -> dict:
    """Recompute día por día en el rango [inicio, fin]. Útil para backfill."""
    total_dias = 0
    total_filas = 0
    total_ne = 0
    cur = inicio
    while cur <= fin:
        try:
            r = recomputar_kpis(db, cur)
            total_dias += 1
            total_filas += r["filas_kpi_dia"]
            total_ne += r["filas_no_entregado"]
            if total_dias % 10 == 0:
                logger.info("[materializar_kpis] %d días procesados, %d filas, %d no-entregados",
                            total_dias, total_filas, total_ne)
        except Exception:
            logger.exception("Error recomputando KPIs para %s", cur)
            db.rollback()
        cur = cur + timedelta(days=1)
    return {
        "inicio": inicio.isoformat(),
        "fin": fin.isoformat(),
        "dias_procesados": total_dias,
        "filas_kpi_dia": total_filas,
        "filas_no_entregado": total_ne,
    }


def fechas_afectadas_por_asignaciones(
    asignaciones: Iterable[dict],
) -> set[date]:
    """Devuelve el conjunto de fechas (route_date + withdrawal_date) afectadas
    por un batch de asignaciones recién ingestadas. Usado por los hooks para
    decidir qué días recomputar tras un cron/CSV."""
    out: set[date] = set()
    for raw in asignaciones:
        for k in ("withdrawal_date", "route_date"):
            v = raw.get(k) if isinstance(raw, dict) else None
            if isinstance(v, date):
                out.add(v)
    return out


def fechas_afectadas_post_ingesta_rutas(db: Session, inicio: date, fin: date) -> set[date]:
    """Devuelve fechas afectadas tras una corrida del cron de rutas.

    Como el cron no nos pasa la lista de filas modificadas, consultamos directo:
    todos los route_date y withdrawal_date que estén dentro del rango ingestado.
    """
    fechas: set[date] = set()
    for r in db.query(AsignacionRuta.route_date).filter(
        AsignacionRuta.route_date >= inicio,
        AsignacionRuta.route_date <= fin,
    ).distinct().all():
        if r.route_date:
            fechas.add(r.route_date)
    for r in db.query(AsignacionRuta.withdrawal_date).filter(
        AsignacionRuta.withdrawal_date >= inicio,
        AsignacionRuta.withdrawal_date <= fin,
    ).distinct().all():
        if r.withdrawal_date:
            fechas.add(r.withdrawal_date)
    return fechas


def fechas_afectadas_post_ingesta_csv(db: Session, fechas_entrega: Iterable[date]) -> set[date]:
    """Tras una ingesta CSV, las fechas afectadas son las route_date Y
    withdrawal_date de los trackings cuyo Envio tiene fecha_entrega en el batch.

    Esto es porque la INGESTA cambia el numerador de efectividad (entregado
    mismo día que route_date) y el numerador de same-day.
    """
    fechas_entrega_set = {f for f in fechas_entrega if f is not None}
    if not fechas_entrega_set:
        return set()

    fechas: set[date] = set()
    rows = (
        db.query(AsignacionRuta.route_date, AsignacionRuta.withdrawal_date)
        .join(Envio, AsignacionRuta.envio_id == Envio.id)
        .filter(Envio.fecha_entrega.in_(fechas_entrega_set))
        .all()
    )
    for r in rows:
        if r.route_date:
            fechas.add(r.route_date)
        if r.withdrawal_date:
            fechas.add(r.withdrawal_date)
    # También las propias fechas de entrega (por simetría: si fecha_entrega = D
    # debería refrescarse el día D aunque no haya asignaciones nuevas).
    fechas.update(fechas_entrega_set)
    return fechas


# ── Helpers ──────────────────────────────────────────────────────────────────

def _es_fila_vacia(counts) -> bool:
    """True si todos los conteos son 0 (no vale la pena persistir)."""
    return (
        counts.a_ruta == 0
        and counts.retirados == 0
        and counts.entregados_mismo_dia == 0
        and counts.same_day == 0
        and counts.cancelados == 0
    )


def _parse_iso(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        return date.fromisoformat(s)
    except Exception:
        return None
