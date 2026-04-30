"""
Capa canónica de métricas de efectividad y same-day.

Es el ÚNICO lugar del sistema autorizado para calcular estos KPIs. Cualquier
endpoint, cron, export o reporte debe pasar por acá. Si dos números no cuadran
en distintas pantallas, el bug está acá (y solo acá).

═══════════════════════════════════════════════════════════════════════════════
DEFINICIONES CANÓNICAS (alineadas con la operación real, abril 2026):
═══════════════════════════════════════════════════════════════════════════════

Para un día D:

  • Same-Day
      Numerador  : trackings con business_days(withdrawal_date, fecha_entrega)==0
      Denominador: trackings con withdrawal_date = D, no cancelados
      Universo   : withdrawal_date = D

  • Efectividad operacional
      Numerador  : trackings con route_date = D Y fecha_entrega = D
      Denominador: trackings con route_date = D, no cancelados
      Universo   : route_date = D

  • Efectividad por conductor / seller / ruta
      Misma fórmula, agrupada.

  • % Entrega intento N
      Numerador  : entregados ese día con intento_nro = N en la asignación de ese día
      Denominador: trackings a ruta ese día

REGLAS FIRMES:
  • "Entregado" = SOLO INGESTA (Envio.fecha_entrega is not null).
    NUNCA el status='delivered' del courier.
  • Cruce siempre por tracking_id (case-insensitive).
  • Same-day usa Asignacion.withdrawal_date (NO Envio.fecha_retiro, que la
    INGESTA puede sobrescribir).
  • Cancelados se reportan aparte y NO entran al denominador.
  • Las exclusiones de sellers/drivers se aplican acá, no en cada endpoint.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field, asdict
from datetime import date, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.models import AsignacionRuta, Driver, Envio, Seller


# ── Exclusiones globales ─────────────────────────────────────────────────────
# Sellers/drivers que NO deben contar en NINGUNA métrica de efectividad.
# Movido acá desde dashboard.py para que la regla viva con el cálculo.
EFECTIVIDAD_SELLERS_EXCLUIDOS: set[int] = {114}              # Global Courier
EFECTIVIDAD_DRIVERS_EXCLUIDOS: set[int] = {96, 66, 154, 108}  # Benitez César, Wilmer (Sequea), Millenium, Move


# ── Dimensiones de bucketing ─────────────────────────────────────────────────
DIMENSION_ROUTE_DATE = "route_date"           # efectividad operacional
DIMENSION_WITHDRAWAL_DATE = "withdrawal_date"  # same-day


# ── Estados externos que cuentan como cancelado ──────────────────────────────
# Se replica acá la lógica de rutas_entregas.STATUS_CANCELADOS para no depender
# de ese módulo (evita dependencias circulares con el cron).
_STATUS_CANCELADOS = {
    "cancelado", "cancelled", "canceled", "anulado", "annulled",
    "rechazado", "devuelto",
}


# ═════════════════════════════════════════════════════════════════════════════
# Helpers internos
# ═════════════════════════════════════════════════════════════════════════════

def business_days_between(d1: Optional[date], d2: Optional[date]) -> Optional[int]:
    """Días hábiles (Lun-Vie) entre d1 y d2. None si falta alguno o d2<d1.

    viernes→lunes = 1 (no es same-day).
    """
    if d1 is None or d2 is None:
        return None
    if d2 < d1:
        return None
    total = 0
    cur = d1
    while cur < d2:
        cur = cur + timedelta(days=1)
        if cur.weekday() < 5:  # 0=Mon..4=Fri
            total += 1
    return total


def _ratio(num: int, den: int) -> float:
    return round(num / den * 100, 1) if den else 0.0


def _es_cancelado(asig: AsignacionRuta) -> bool:
    """True si la asignación está cancelada según el endpoint del courier.

    Privilegia estado_calculado (calculado tras reconciliación), pero también
    chequea status_externo crudo por si el cálculo está pendiente.
    """
    if asig.estado_calculado == "cancelado":
        return True
    s = (asig.status_externo or "").strip().lower()
    return s in _STATUS_CANCELADOS


# ═════════════════════════════════════════════════════════════════════════════
# Estructura de conteo (resultado bruto, sin porcentajes)
# ═════════════════════════════════════════════════════════════════════════════

@dataclass
class KpiCounts:
    """Conteos enteros para una grilla (fecha, dimension, driver_id, seller_id).

    Es la unidad de materialización: una fila de `kpi_dia` se construye con
    estos campos exactos.
    """
    a_ruta: int = 0                    # denominador efectividad
    retirados: int = 0                 # denominador same-day
    entregados_mismo_dia: int = 0      # numerador efectividad (route_date == fecha_entrega)
    same_day: int = 0                  # numerador same-day
    cancelados: int = 0                # informativo (excluido del denominador)

    primer_intento_ok: int = 0
    entregados_intento_1: int = 0
    entregados_intento_2: int = 0
    entregados_intento_3plus: int = 0

    n_0d: int = 0  # ciclo retiro→entrega = 0 días hábiles
    n_1d: int = 0
    n_2d: int = 0
    n_3d: int = 0
    n_4plus: int = 0

    def add(self, other: "KpiCounts") -> None:
        for f in self.__dataclass_fields__:
            setattr(self, f, getattr(self, f) + getattr(other, f))


def kpi_counts_to_kpis(c: KpiCounts) -> dict:
    """Convierte conteos crudos a un dict con porcentajes calculados.

    El shape devuelto está alineado con lo que esperan los endpoints actuales
    (`pct_delivery_success`, `pct_same_day`, etc.) para no romper el frontend.
    """
    return {
        # ── Conteos absolutos
        "paquetes_a_ruta": c.a_ruta,
        "retirados": c.retirados,
        "paquetes_entregados": c.entregados_mismo_dia,  # ¡OJO: ahora es "entregados ese día"!
        "same_day": c.same_day,
        "cancelados": c.cancelados,
        "primer_intento_ok": c.primer_intento_ok,
        "entregados_intento_1": c.entregados_intento_1,
        "entregados_intento_2": c.entregados_intento_2,
        "entregados_intento_3plus": c.entregados_intento_3plus,

        # ── Porcentajes
        # Efectividad: entregados el mismo día / a_ruta
        "pct_delivery_success": _ratio(c.entregados_mismo_dia, c.a_ruta),
        # Same-day: entregados same-day / retirados
        "pct_same_day": _ratio(c.same_day, c.retirados),
        # First-attempt: entregados con intento 1 / a_ruta
        "pct_first_attempt": _ratio(c.primer_intento_ok, c.a_ruta),
        # OTIF: alias de same-day (TODO: definir SLA propio en próxima iteración)
        "pct_otif": _ratio(c.same_day, c.retirados),
        # % entrega por intento (denominador = a_ruta del día)
        "pct_intento_1": _ratio(c.entregados_intento_1, c.a_ruta),
        "pct_intento_2": _ratio(c.entregados_intento_2, c.a_ruta),
        "pct_intento_3plus": _ratio(c.entregados_intento_3plus, c.a_ruta),

        # ── Distribución de ciclo (retiro → entrega)
        "distribucion": {
            "n_0d": c.n_0d, "n_1d": c.n_1d, "n_2d": c.n_2d, "n_3d": c.n_3d, "n_4plus": c.n_4plus,
            "pct_0d": _ratio(c.n_0d, c.a_ruta),
            "pct_1d": _ratio(c.n_1d, c.a_ruta),
            "pct_2d": _ratio(c.n_2d, c.a_ruta),
            "pct_3d": _ratio(c.n_3d, c.a_ruta),
            "pct_4plus": _ratio(c.n_4plus, c.a_ruta),
            "n_sin_entregar": max(0, c.a_ruta - (c.n_0d + c.n_1d + c.n_2d + c.n_3d + c.n_4plus)),
            "pct_sin_entregar": _ratio(
                max(0, c.a_ruta - (c.n_0d + c.n_1d + c.n_2d + c.n_3d + c.n_4plus)),
                c.a_ruta,
            ),
        },
    }


# ═════════════════════════════════════════════════════════════════════════════
# Cargador base + clasificador
# ═════════════════════════════════════════════════════════════════════════════

def _query_asignaciones(
    db: Session,
    inicio: date,
    fin: date,
    dimension: str,
    *,
    driver_id: Optional[int] = None,
    seller_id: Optional[int] = None,
    seller_code: Optional[str] = None,
    aplicar_exclusiones: bool = True,
) -> list[tuple[AsignacionRuta, Optional[Envio]]]:
    """Devuelve la lista de (AsignacionRuta, Envio) en el rango.

    El filtro por fecha se aplica sobre la columna correspondiente a `dimension`:
      - DIMENSION_ROUTE_DATE        → AsignacionRuta.route_date
      - DIMENSION_WITHDRAWAL_DATE   → AsignacionRuta.withdrawal_date

    Esto es CRÍTICO: para efectividad operacional el universo es route_date,
    para same-day es withdrawal_date. La query base actual de dashboard.py
    siempre filtra por withdrawal_date, lo que pierde paquetes con retiro fuera
    del rango pero ruta dentro.
    """
    if dimension == DIMENSION_ROUTE_DATE:
        col = AsignacionRuta.route_date
    elif dimension == DIMENSION_WITHDRAWAL_DATE:
        col = AsignacionRuta.withdrawal_date
    else:
        raise ValueError(f"dimension inválida: {dimension!r}")

    q = (
        db.query(AsignacionRuta, Envio)
        .outerjoin(Envio, AsignacionRuta.envio_id == Envio.id)
        .filter(col >= inicio, col <= fin, col.isnot(None))
    )

    if driver_id is not None:
        q = q.filter(AsignacionRuta.driver_id == driver_id)
    if seller_code is not None:
        q = q.filter(AsignacionRuta.seller_code == seller_code)
    if seller_id is not None:
        q = q.filter(Envio.seller_id == seller_id)

    if aplicar_exclusiones:
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

    return q.all()


@dataclass
class _Clasificacion:
    """Resultado de clasificar UNA fila (AsignacionRuta, Envio)."""
    cancelado: bool = False
    a_ruta: bool = False                # cuenta para denominador de efectividad
    retirado: bool = False              # cuenta para denominador de same-day
    entregado: bool = False             # tiene fecha_entrega en INGESTA (cualquier fecha)
    entregado_mismo_dia_route: bool = False  # fecha_entrega == route_date
    entregado_mismo_dia_withdrawal: bool = False  # business_days(withdrawal, entrega)==0
    intento_nro: int = 0
    ciclo_dias: Optional[int] = None    # business_days retiro→entrega


def clasificar(asig: AsignacionRuta, envio: Optional[Envio]) -> _Clasificacion:
    """Aplica la regla canónica a una fila. Pública para inspección/debug."""
    c = _Clasificacion(intento_nro=asig.intento_nro or 1)

    if _es_cancelado(asig):
        c.cancelado = True
        return c

    c.a_ruta = asig.route_date is not None
    c.retirado = asig.withdrawal_date is not None

    if envio is None or envio.fecha_entrega is None:
        return c

    c.entregado = True

    # Mismo día como salió a ruta
    if asig.route_date is not None and envio.fecha_entrega == asig.route_date:
        c.entregado_mismo_dia_route = True

    # Same-day estricto: business_days(withdrawal_date, fecha_entrega) == 0
    # OJO: usamos asig.withdrawal_date directo (NO envio.fecha_retiro, que la
    # INGESTA puede haber sobrescrito con un valor distinto al del courier).
    if asig.withdrawal_date is not None:
        bd = business_days_between(asig.withdrawal_date, envio.fecha_entrega)
        c.ciclo_dias = bd
        if bd == 0:
            c.entregado_mismo_dia_withdrawal = True

    return c


# ═════════════════════════════════════════════════════════════════════════════
# Agregación a KpiCounts
# ═════════════════════════════════════════════════════════════════════════════

def _agregar(rows: list[tuple[AsignacionRuta, Optional[Envio]]], dimension: str) -> KpiCounts:
    """Reduce una lista de filas a un KpiCounts según la dimensión.

    Cada dimensión calcula SOLO los campos que tienen sentido en su universo;
    el resto queda en 0. El caller (kpis_globales/etc.) combina ambos cuando
    necesita ambos universos en un único resultado.

      • dimension=route_date  → llena a_ruta, entregados_mismo_dia, intentos,
                                primer_intento_ok, n_buckets, cancelados.
      • dimension=withdrawal_date → llena retirados, same_day, cancelados.
    """
    c = KpiCounts()

    for asig, envio in rows:
        cls = clasificar(asig, envio)

        if cls.cancelado:
            c.cancelados += 1
            continue

        if dimension == DIMENSION_ROUTE_DATE:
            if asig.route_date is None:
                continue  # solo aporta si pertenece al bucket
            c.a_ruta += 1

            if not cls.entregado_mismo_dia_route:
                continue

            c.entregados_mismo_dia += 1
            if cls.intento_nro == 1:
                c.entregados_intento_1 += 1
                c.primer_intento_ok += 1
            elif cls.intento_nro == 2:
                c.entregados_intento_2 += 1
            else:
                c.entregados_intento_3plus += 1

            # Distribución de ciclo retiro→entrega (solo para entregados)
            if cls.ciclo_dias is not None:
                d = cls.ciclo_dias
                if d <= 0:    c.n_0d += 1
                elif d == 1:  c.n_1d += 1
                elif d == 2:  c.n_2d += 1
                elif d == 3:  c.n_3d += 1
                else:         c.n_4plus += 1

        elif dimension == DIMENSION_WITHDRAWAL_DATE:
            if asig.withdrawal_date is None:
                continue
            c.retirados += 1

            if cls.entregado_mismo_dia_withdrawal:
                c.same_day += 1

    return c


# ═════════════════════════════════════════════════════════════════════════════
# API pública: KPIs agregados
# ═════════════════════════════════════════════════════════════════════════════

def kpis_globales(
    db: Session,
    inicio: date,
    fin: date,
    *,
    driver_id: Optional[int] = None,
    seller_id: Optional[int] = None,
    seller_code: Optional[str] = None,
    aplicar_exclusiones: bool = True,
) -> dict:
    """KPIs agregados para el rango [inicio, fin].

    IMPORTANTE: Devuelve UN solo dict que combina:
      - Métricas de efectividad operacional (universo: route_date)
      - Métricas de same-day (universo: withdrawal_date)

    Esto es necesario porque las dos métricas tienen universos distintos. El
    dashboard global muestra ambas en la misma tarjeta.
    """
    # Universo route_date para efectividad
    rows_rd = _query_asignaciones(
        db, inicio, fin, DIMENSION_ROUTE_DATE,
        driver_id=driver_id, seller_id=seller_id, seller_code=seller_code,
        aplicar_exclusiones=aplicar_exclusiones,
    )
    counts_rd = _agregar(rows_rd, DIMENSION_ROUTE_DATE)

    # Universo withdrawal_date para same-day
    rows_wd = _query_asignaciones(
        db, inicio, fin, DIMENSION_WITHDRAWAL_DATE,
        driver_id=driver_id, seller_id=seller_id, seller_code=seller_code,
        aplicar_exclusiones=aplicar_exclusiones,
    )
    counts_wd = _agregar(rows_wd, DIMENSION_WITHDRAWAL_DATE)

    # Combinar: usamos counts_rd para efectividad y counts_wd para same-day
    combinado = KpiCounts(
        a_ruta=counts_rd.a_ruta,
        retirados=counts_wd.retirados,
        entregados_mismo_dia=counts_rd.entregados_mismo_dia,
        same_day=counts_wd.same_day,
        cancelados=counts_rd.cancelados,
        primer_intento_ok=counts_rd.primer_intento_ok,
        entregados_intento_1=counts_rd.entregados_intento_1,
        entregados_intento_2=counts_rd.entregados_intento_2,
        entregados_intento_3plus=counts_rd.entregados_intento_3plus,
        n_0d=counts_rd.n_0d, n_1d=counts_rd.n_1d, n_2d=counts_rd.n_2d,
        n_3d=counts_rd.n_3d, n_4plus=counts_rd.n_4plus,
    )

    return kpi_counts_to_kpis(combinado)


def kpis_por_dia(
    db: Session,
    inicio: date,
    fin: date,
    *,
    driver_id: Optional[int] = None,
    seller_id: Optional[int] = None,
    seller_code: Optional[str] = None,
    aplicar_exclusiones: bool = True,
) -> list[dict]:
    """Serie temporal: una entrada por día.

    Cada celda combina:
      - Métricas de efectividad (universo route_date = D)
      - Métricas de same-day    (universo withdrawal_date = D)

    El frontend muestra ambas en la misma celda del calendario.
    """
    # Universo route_date
    rows_rd = _query_asignaciones(
        db, inicio, fin, DIMENSION_ROUTE_DATE,
        driver_id=driver_id, seller_id=seller_id, seller_code=seller_code,
        aplicar_exclusiones=aplicar_exclusiones,
    )
    bucket_rd: dict[date, list] = defaultdict(list)
    for asig, envio in rows_rd:
        if asig.route_date is None:
            continue
        bucket_rd[asig.route_date].append((asig, envio))

    # Universo withdrawal_date
    rows_wd = _query_asignaciones(
        db, inicio, fin, DIMENSION_WITHDRAWAL_DATE,
        driver_id=driver_id, seller_id=seller_id, seller_code=seller_code,
        aplicar_exclusiones=aplicar_exclusiones,
    )
    bucket_wd: dict[date, list] = defaultdict(list)
    for asig, envio in rows_wd:
        if asig.withdrawal_date is None:
            continue
        bucket_wd[asig.withdrawal_date].append((asig, envio))

    fechas = sorted(set(bucket_rd.keys()) | set(bucket_wd.keys()))
    out = []
    for d in fechas:
        c_rd = _agregar(bucket_rd.get(d, []), DIMENSION_ROUTE_DATE)
        c_wd = _agregar(bucket_wd.get(d, []), DIMENSION_WITHDRAWAL_DATE)
        combinado = KpiCounts(
            a_ruta=c_rd.a_ruta,
            retirados=c_wd.retirados,
            entregados_mismo_dia=c_rd.entregados_mismo_dia,
            same_day=c_wd.same_day,
            cancelados=c_rd.cancelados,  # cancelados desde universo route_date
            primer_intento_ok=c_rd.primer_intento_ok,
            entregados_intento_1=c_rd.entregados_intento_1,
            entregados_intento_2=c_rd.entregados_intento_2,
            entregados_intento_3plus=c_rd.entregados_intento_3plus,
            n_0d=c_rd.n_0d, n_1d=c_rd.n_1d, n_2d=c_rd.n_2d,
            n_3d=c_rd.n_3d, n_4plus=c_rd.n_4plus,
        )
        kpis = kpi_counts_to_kpis(combinado)
        out.append({
            "fecha": d.isoformat(),
            "weekday": d.weekday(),
            "a_ruta": combinado.a_ruta,
            "entregados": combinado.entregados_mismo_dia,
            "same_day": combinado.same_day,
            "retirados": combinado.retirados,
            "cancelados": combinado.cancelados,
            "label": f"{combinado.entregados_mismo_dia}/{combinado.a_ruta}",
            **{k: v for k, v in kpis.items() if k.startswith("pct_") or k.startswith("entregados_intento")},
        })
    return out


def kpis_por_driver(
    db: Session,
    inicio: date,
    fin: date,
    *,
    aplicar_exclusiones: bool = True,
) -> list[dict]:
    """Una fila por driver con sus KPIs en el rango.

    Universo: route_date (efectividad operacional). Para el % same-day del driver
    se usa el universo withdrawal_date del mismo driver.
    """
    # Universo route_date
    rows_rd = _query_asignaciones(
        db, inicio, fin, DIMENSION_ROUTE_DATE,
        aplicar_exclusiones=aplicar_exclusiones,
    )
    by_driver_rd: dict[Optional[int], list] = defaultdict(list)
    for asig, envio in rows_rd:
        by_driver_rd[asig.driver_id].append((asig, envio))

    # Universo withdrawal_date para complementar same-day
    rows_wd = _query_asignaciones(
        db, inicio, fin, DIMENSION_WITHDRAWAL_DATE,
        aplicar_exclusiones=aplicar_exclusiones,
    )
    by_driver_wd: dict[Optional[int], list] = defaultdict(list)
    for asig, envio in rows_wd:
        by_driver_wd[asig.driver_id].append((asig, envio))

    driver_ids = set(by_driver_rd.keys()) | set(by_driver_wd.keys())
    nombres = {d.id: d.nombre for d in db.query(Driver.id, Driver.nombre).all()}

    out = []
    for did in driver_ids:
        c_rd = _agregar(by_driver_rd.get(did, []), DIMENSION_ROUTE_DATE)
        c_wd = _agregar(by_driver_wd.get(did, []), DIMENSION_WITHDRAWAL_DATE)
        combinado = KpiCounts(
            a_ruta=c_rd.a_ruta, retirados=c_wd.retirados,
            entregados_mismo_dia=c_rd.entregados_mismo_dia,
            same_day=c_wd.same_day, cancelados=c_rd.cancelados,
            primer_intento_ok=c_rd.primer_intento_ok,
            entregados_intento_1=c_rd.entregados_intento_1,
            entregados_intento_2=c_rd.entregados_intento_2,
            entregados_intento_3plus=c_rd.entregados_intento_3plus,
            n_0d=c_rd.n_0d, n_1d=c_rd.n_1d, n_2d=c_rd.n_2d,
            n_3d=c_rd.n_3d, n_4plus=c_rd.n_4plus,
        )
        out.append({
            "driver_id": did,
            "nombre": nombres.get(did, "Sin driver asignado") if did else "Sin driver asignado",
            **kpi_counts_to_kpis(combinado),
        })
    out.sort(key=lambda x: -x["paquetes_a_ruta"])
    return out


def kpis_por_seller(
    db: Session,
    inicio: date,
    fin: date,
    *,
    aplicar_exclusiones: bool = True,
) -> list[dict]:
    """Una fila por seller con sus KPIs."""
    rows_rd = _query_asignaciones(
        db, inicio, fin, DIMENSION_ROUTE_DATE,
        aplicar_exclusiones=aplicar_exclusiones,
    )
    rows_wd = _query_asignaciones(
        db, inicio, fin, DIMENSION_WITHDRAWAL_DATE,
        aplicar_exclusiones=aplicar_exclusiones,
    )

    # Lookup seller_code -> seller_id (mismos sellers que la ingesta homologó)
    sc_to_sid: dict[str, int] = {}
    for r in db.query(Envio.seller_code, Envio.seller_id).filter(
        Envio.seller_code.isnot(None), Envio.seller_id.isnot(None)
    ).distinct().all():
        if r.seller_code and r.seller_id:
            sc_to_sid[r.seller_code] = r.seller_id

    def _seller_id(asig: AsignacionRuta, envio: Optional[Envio]) -> Optional[int]:
        if envio is not None and envio.seller_id is not None:
            return envio.seller_id
        if asig.seller_code:
            return sc_to_sid.get(asig.seller_code)
        return None

    by_seller_rd: dict[Optional[int], list] = defaultdict(list)
    for asig, envio in rows_rd:
        by_seller_rd[_seller_id(asig, envio)].append((asig, envio))
    by_seller_wd: dict[Optional[int], list] = defaultdict(list)
    for asig, envio in rows_wd:
        by_seller_wd[_seller_id(asig, envio)].append((asig, envio))

    seller_ids = set(by_seller_rd.keys()) | set(by_seller_wd.keys())
    nombres: dict[int, str] = {}
    ids_no_null = [sid for sid in seller_ids if sid is not None]
    if ids_no_null:
        nombres = {
            s.id: s.nombre
            for s in db.query(Seller.id, Seller.nombre).filter(Seller.id.in_(ids_no_null)).all()
        }

    out = []
    for sid in seller_ids:
        c_rd = _agregar(by_seller_rd.get(sid, []), DIMENSION_ROUTE_DATE)
        c_wd = _agregar(by_seller_wd.get(sid, []), DIMENSION_WITHDRAWAL_DATE)
        combinado = KpiCounts(
            a_ruta=c_rd.a_ruta, retirados=c_wd.retirados,
            entregados_mismo_dia=c_rd.entregados_mismo_dia,
            same_day=c_wd.same_day, cancelados=c_rd.cancelados,
            primer_intento_ok=c_rd.primer_intento_ok,
            entregados_intento_1=c_rd.entregados_intento_1,
            entregados_intento_2=c_rd.entregados_intento_2,
            entregados_intento_3plus=c_rd.entregados_intento_3plus,
            n_0d=c_rd.n_0d, n_1d=c_rd.n_1d, n_2d=c_rd.n_2d,
            n_3d=c_rd.n_3d, n_4plus=c_rd.n_4plus,
        )
        out.append({
            "seller_id": sid,
            "nombre": nombres.get(sid, "Sin envío reconciliado") if sid else "Sin envío reconciliado",
            **kpi_counts_to_kpis(combinado),
        })
    out.sort(key=lambda x: -x["paquetes_a_ruta"])
    return out


def kpis_por_ruta(
    db: Session,
    inicio: date,
    fin: date,
    *,
    driver_id: Optional[int] = None,
    aplicar_exclusiones: bool = True,
) -> list[dict]:
    """Una fila por route_name (drill-down de driver normalmente).

    No se materializa esta granularidad — se calcula on-demand porque son pocas
    rutas por driver/rango.
    """
    rows = _query_asignaciones(
        db, inicio, fin, DIMENSION_ROUTE_DATE,
        driver_id=driver_id,
        aplicar_exclusiones=aplicar_exclusiones,
    )
    bucket: dict[str, list] = defaultdict(list)
    for asig, envio in rows:
        nombre = asig.route_name or "(sin nombre)"
        bucket[nombre].append((asig, envio))

    out = []
    for nombre, rs in bucket.items():
        counts = _agregar(rs, DIMENSION_ROUTE_DATE)
        dates = [a.route_date for a, _ in rs if a.route_date]
        out.append({
            "ruta": nombre,
            "route_date": min(dates).isoformat() if dates else None,
            **kpi_counts_to_kpis(counts),
        })
    out.sort(key=lambda x: x.get("route_date") or "", reverse=True)
    return out


def detalle_no_entregados(
    db: Session,
    inicio: date,
    fin: date,
    *,
    driver_id: Optional[int] = None,
    seller_id: Optional[int] = None,
    aplicar_exclusiones: bool = True,
) -> list[dict]:
    """Lista de asignaciones que NO se entregaron el día que salieron a ruta.

    Útil para drill-downs operativos: "¿cuáles paquetes salieron en la ruta
    de Edgardo el 20/12 y no se entregaron?".
    """
    rows = _query_asignaciones(
        db, inicio, fin, DIMENSION_ROUTE_DATE,
        driver_id=driver_id, seller_id=seller_id,
        aplicar_exclusiones=aplicar_exclusiones,
    )
    out = []
    for asig, envio in rows:
        cls = clasificar(asig, envio)
        if cls.cancelado:
            motivo = "cancelado"
        elif not cls.entregado:
            motivo = "sin_entrega"
        elif not cls.entregado_mismo_dia_route:
            motivo = "fuera_de_dia"  # entregado, pero no el mismo día que route_date
        else:
            continue  # entregado mismo día → no es no-entregado

        out.append({
            "tracking_id": asig.tracking_id,
            "route_date": asig.route_date.isoformat() if asig.route_date else None,
            "withdrawal_date": asig.withdrawal_date.isoformat() if asig.withdrawal_date else None,
            "fecha_entrega": envio.fecha_entrega.isoformat() if envio and envio.fecha_entrega else None,
            "driver_id": asig.driver_id,
            "driver_name": asig.driver_name,
            "route_name": asig.route_name,
            "seller_code": asig.seller_code,
            "seller_id": envio.seller_id if envio else None,
            "status_externo": asig.status_externo,
            "motivo": motivo,
            "intento_nro": asig.intento_nro,
            "address_full": asig.address_full,
            "address_lat": asig.address_lat,
            "address_lon": asig.address_lon,
        })
    return out


# ═════════════════════════════════════════════════════════════════════════════
# Cómputo por grilla (para materialización)
# ═════════════════════════════════════════════════════════════════════════════

def calcular_grilla_dia(
    db: Session,
    fecha: date,
    dimension: str,
    *,
    aplicar_exclusiones: bool = True,
) -> dict[tuple[Optional[int], Optional[int]], KpiCounts]:
    """Devuelve la grilla cruda (driver_id, seller_id) -> KpiCounts para `fecha`.

    Es la unidad atómica de materialización: cada entry se vuelca a una fila
    de `kpi_dia`. Incluye también la fila agregada (None, None) para "total".

    Usado por `recomputar_kpis(fecha)` en el módulo de materialización.
    """
    rows = _query_asignaciones(
        db, fecha, fecha, dimension,
        aplicar_exclusiones=aplicar_exclusiones,
    )

    # Lookup seller_code -> seller_id
    sc_to_sid: dict[str, int] = {}
    for r in db.query(Envio.seller_code, Envio.seller_id).filter(
        Envio.seller_code.isnot(None), Envio.seller_id.isnot(None)
    ).distinct().all():
        if r.seller_code and r.seller_id:
            sc_to_sid[r.seller_code] = r.seller_id

    def _seller_id(asig: AsignacionRuta, envio: Optional[Envio]) -> Optional[int]:
        if envio is not None and envio.seller_id is not None:
            return envio.seller_id
        if asig.seller_code:
            return sc_to_sid.get(asig.seller_code)
        return None

    grilla: dict[tuple[Optional[int], Optional[int]], list] = defaultdict(list)
    for asig, envio in rows:
        sid = _seller_id(asig, envio)
        did = asig.driver_id
        # Cuatro entradas por fila: (driver, seller), (driver, None), (None, seller), (None, None)
        # Esto permite consultar agregados al vuelo desde la tabla materializada
        # con un WHERE driver_id IS NULL AND seller_id IS NULL para el total,
        # WHERE driver_id = X AND seller_id IS NULL para "todo del driver", etc.
        grilla[(did, sid)].append((asig, envio))
        grilla[(did, None)].append((asig, envio))
        grilla[(None, sid)].append((asig, envio))
        grilla[(None, None)].append((asig, envio))

    return {k: _agregar(v, dimension) for k, v in grilla.items()}
