"""
Motor que toma marcas crudas (`MarcaAsistencia`) y construye/actualiza
`JornadaTrabajador` por trabajador y día.

Reglas:
  * Una jornada se compone de las marcas de un trabajador en un mismo día,
    ordenadas por timestamp.
  * Primera marca → `primera_entrada` (independiente de su `tipo`).
    Última marca → `ultima_salida`.
  * Si hay marcas explícitas SALIDA_COLACION/ENTRADA_COLACION, se usan para
    descontar el tiempo de colación. Si no, se asume `trabajador.minutos_colacion`
    cuando la jornada > 6h continuas (Art. 34 CT).
  * Atraso: minutos entre `primera_entrada` y `hora_entrada_esperada`, descontando
    `tolerancia_atraso_min`.
  * Salida anticipada: minutos entre `hora_salida_esperada` y `ultima_salida`,
    descontando `tolerancia_salida_anticipada_min`.
  * Horas extras estimadas: minutos trabajados por sobre la jornada diaria
    esperada, sólo si superan `minutos_minimos_he`. Quedan en estado pendiente
    de aprobación si `requiere_aprobacion_he=True`.
  * Marcas inconsistentes (cantidad impar > 1, o sólo una marca) → estado REVISAR.

El cálculo es 100% determinístico y reproducible: jornadas pueden recalcularse
en cualquier momento sin perder información (las marcas son inmutables).

Consolidación a HoraExtraTrabajador:
  El servicio expone `consolidar_he_mes(trabajador_id, mes, anio)` que suma las
  HE aprobadas de un mes y las upsertea en la tabla `horas_extras_trabajadores`,
  para que la liquidación las recoja como ya hace hoy.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Iterable, Optional

from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.models import (
    ConfiguracionAsistencia,
    EstadoJornadaEnum,
    HoraExtraTrabajador,
    JornadaTrabajador,
    MarcaAsistencia,
    TipoMarcaEnum,
    Trabajador,
    VacacionTrabajador,
)

logger = logging.getLogger(__name__)


# Defaults para cuando el trabajador no tiene horario explícito
DEFAULT_HORA_ENTRADA = "09:00"
DEFAULT_HORA_SALIDA = "18:00"
DEFAULT_JORNADA_MIN_DIARIA = 480  # 8h


def _parse_hhmm(s: Optional[str]) -> Optional[time]:
    if not s:
        return None
    try:
        h, m = s.split(":")
        return time(int(h), int(m))
    except Exception:
        return None


def _diferencia_minutos(a: datetime, b: datetime) -> int:
    return int((a - b).total_seconds() // 60)


@dataclass
class _CalculoConfig:
    tolerancia_atraso_min: int
    tolerancia_salida_anticipada_min: int
    minutos_minimos_he: int


def _config_calculo(cfg: Optional[ConfiguracionAsistencia]) -> _CalculoConfig:
    if cfg is None:
        return _CalculoConfig(5, 5, 15)
    return _CalculoConfig(
        cfg.tolerancia_atraso_min or 0,
        cfg.tolerancia_salida_anticipada_min or 0,
        cfg.minutos_minimos_he or 0,
    )


def calcular_jornada(
    trabajador: Trabajador,
    fecha: date,
    marcas: list[MarcaAsistencia],
    cfg: Optional[ConfiguracionAsistencia] = None,
    es_dia_no_laborable: bool = False,
) -> dict:
    """
    Devuelve un dict con todos los campos calculados para una `JornadaTrabajador`.
    No persiste; eso lo hace `_upsert_jornada`.
    """
    cc = _config_calculo(cfg)
    marcas = sorted([m for m in marcas if not m.descartada], key=lambda m: m.timestamp)
    cantidad = len(marcas)

    base = {
        "trabajador_id": trabajador.id,
        "fecha": fecha,
        "primera_entrada": None,
        "salida_colacion": None,
        "entrada_colacion": None,
        "ultima_salida": None,
        "cantidad_marcas": cantidad,
        "minutos_trabajados": 0,
        "minutos_colacion": 0,
        "minutos_atraso": 0,
        "minutos_salida_anticipada": 0,
        "minutos_he_estimadas": 0,
        "hora_entrada_esperada": trabajador.hora_entrada_esperada or DEFAULT_HORA_ENTRADA,
        "hora_salida_esperada": trabajador.hora_salida_esperada or DEFAULT_HORA_SALIDA,
        "jornada_diaria_min_esperada": _jornada_diaria_min(trabajador),
        "estado": EstadoJornadaEnum.NORMAL.value,
        "observaciones": None,
    }

    if cantidad == 0:
        base["estado"] = (
            EstadoJornadaEnum.FERIADO_LEGAL.value if es_dia_no_laborable
            else EstadoJornadaEnum.AUSENTE.value
        )
        return base

    if cantidad == 1:
        base["primera_entrada"] = marcas[0].timestamp
        base["estado"] = EstadoJornadaEnum.INCOMPLETA.value
        base["observaciones"] = "Solo se registró una marca."
        return base

    primera = marcas[0]
    ultima = marcas[-1]
    base["primera_entrada"] = primera.timestamp
    base["ultima_salida"] = ultima.timestamp

    # Tiempo bruto entre primera y última
    minutos_bruto = max(0, _diferencia_minutos(ultima.timestamp, primera.timestamp))

    # Colación: prioriza marcas explícitas. Si hay más de una pareja se usa la primera.
    salida_col = next((m for m in marcas if m.tipo == TipoMarcaEnum.SALIDA_COLACION.value), None)
    entrada_col = next(
        (m for m in marcas if m.tipo == TipoMarcaEnum.ENTRADA_COLACION.value
         and (salida_col is None or m.timestamp > salida_col.timestamp)),
        None,
    )
    minutos_colacion = 0
    if salida_col and entrada_col:
        base["salida_colacion"] = salida_col.timestamp
        base["entrada_colacion"] = entrada_col.timestamp
        minutos_colacion = max(0, _diferencia_minutos(entrada_col.timestamp, salida_col.timestamp))
    elif minutos_bruto > 6 * 60:
        # Si trabajó más de 6h sin marcar colación, se asume la pactada (Art. 34 CT)
        minutos_colacion = trabajador.minutos_colacion or 60

    base["minutos_colacion"] = minutos_colacion
    base["minutos_trabajados"] = max(0, minutos_bruto - minutos_colacion)

    # Atrasos / salidas anticipadas (si hay horario esperado)
    h_entrada = _parse_hhmm(base["hora_entrada_esperada"])
    h_salida = _parse_hhmm(base["hora_salida_esperada"])
    observ: list[str] = []

    if h_entrada:
        esperada_entrada = datetime.combine(fecha, h_entrada)
        diff = _diferencia_minutos(primera.timestamp, esperada_entrada)
        atraso = max(0, diff - cc.tolerancia_atraso_min)
        if atraso > 0:
            base["minutos_atraso"] = atraso
            base["estado"] = EstadoJornadaEnum.ATRASO.value
            observ.append(f"Atraso de {atraso} min (entrada {primera.timestamp.strftime('%H:%M')}).")

    if h_salida:
        esperada_salida = datetime.combine(fecha, h_salida)
        diff = _diferencia_minutos(esperada_salida, ultima.timestamp)
        anticipada = max(0, diff - cc.tolerancia_salida_anticipada_min)
        if anticipada > 0:
            base["minutos_salida_anticipada"] = anticipada
            if base["estado"] == EstadoJornadaEnum.NORMAL.value:
                base["estado"] = EstadoJornadaEnum.SALIDA_ANTICIPADA.value
            observ.append(f"Salida anticipada {anticipada} min ({ultima.timestamp.strftime('%H:%M')}).")

    # Horas extras estimadas: cualquier minuto trabajado por sobre la jornada diaria esperada
    exceso = base["minutos_trabajados"] - base["jornada_diaria_min_esperada"]
    if exceso >= cc.minutos_minimos_he:
        base["minutos_he_estimadas"] = exceso
        base["estado"] = EstadoJornadaEnum.HORAS_EXTRAS.value
        observ.append(f"HE estimadas: {exceso} min (pendiente de aprobación).")

    # Si hay marcas raras (impares con colación esperada), marcar para revisar
    pares_esperados = 2 if (salida_col is None and entrada_col is None) else 4
    if cantidad not in (2, 4) and cantidad > 1:
        observ.append(f"Cantidad de marcas inusual ({cantidad}).")
        if base["estado"] == EstadoJornadaEnum.NORMAL.value:
            base["estado"] = EstadoJornadaEnum.REVISAR.value

    base["observaciones"] = " ".join(observ) or None
    return base


def _jornada_diaria_min(trabajador: Trabajador) -> int:
    """
    Estima los minutos diarios esperados a partir del contrato vigente.
    Usa una distribución 5x2 estándar (semana laboral / 5 días).
    """
    versiones = sorted(
        getattr(trabajador, "versiones_contrato", []) or [],
        key=lambda v: v.vigente_desde,
        reverse=True,
    )
    jornada_semanal = 44
    for v in versiones:
        if v.vigente_hasta is None or v.vigente_hasta >= date.today():
            jornada_semanal = v.jornada_semanal_horas or 44
            break
    # 5 días laborables / semana
    return int(round(jornada_semanal / 5 * 60))


def _upsert_jornada(db: Session, datos: dict) -> JornadaTrabajador:
    j = (
        db.query(JornadaTrabajador)
        .filter(
            JornadaTrabajador.trabajador_id == datos["trabajador_id"],
            JornadaTrabajador.fecha == datos["fecha"],
        )
        .first()
    )
    if j is None:
        j = JornadaTrabajador(**datos)
        db.add(j)
    else:
        # Preservamos lo que el admin ya aprobó manualmente
        for k, v in datos.items():
            if k in ("he_aprobadas_min", "he_aprobadas_por", "he_aprobadas_at", "he_consolidada_id"):
                continue
            setattr(j, k, v)
    return j


def _es_dia_no_laborable(fecha: date) -> bool:
    """Por ahora consideramos no laborables solo sábados y domingos.
    Cuando exista la tabla de feriados oficiales, se enriquecerá."""
    return fecha.weekday() >= 5  # 5=sáb, 6=dom


def recalcular_jornadas_trabajador(
    db: Session,
    trabajador: Trabajador,
    desde: date,
    hasta: date,
    cfg: Optional[ConfiguracionAsistencia] = None,
) -> int:
    """
    Reconstruye todas las jornadas en el rango [desde, hasta] para `trabajador`.
    Devuelve cuántas jornadas fueron creadas o actualizadas.
    """
    marcas = (
        db.query(MarcaAsistencia)
        .filter(
            MarcaAsistencia.trabajador_id == trabajador.id,
            MarcaAsistencia.fecha >= desde,
            MarcaAsistencia.fecha <= hasta,
        )
        .order_by(MarcaAsistencia.timestamp.asc())
        .all()
    )
    por_dia: dict[date, list[MarcaAsistencia]] = defaultdict(list)
    for m in marcas:
        por_dia[m.fecha].append(m)

    # Vacaciones / licencias del rango (para etiquetar días sin marcas)
    vacaciones = (
        db.query(VacacionTrabajador)
        .filter(
            VacacionTrabajador.trabajador_id == trabajador.id,
            VacacionTrabajador.estado.in_(["APROBADA", "TOMADA", "REGISTRO_HISTORICO"]),
            VacacionTrabajador.fecha_fin >= desde,
            VacacionTrabajador.fecha_inicio <= hasta,
        )
        .all()
    )
    dias_vacaciones: set[date] = set()
    for v in vacaciones:
        d = v.fecha_inicio
        while d <= v.fecha_fin:
            dias_vacaciones.add(d)
            d += timedelta(days=1)

    actualizadas = 0
    d = desde
    while d <= hasta:
        marcas_dia = por_dia.get(d, [])
        es_no_laborable = _es_dia_no_laborable(d)
        datos = calcular_jornada(trabajador, d, marcas_dia, cfg=cfg, es_dia_no_laborable=es_no_laborable)
        if d in dias_vacaciones and not marcas_dia:
            datos["estado"] = EstadoJornadaEnum.VACACIONES.value
            datos["observaciones"] = "Día de feriado legal."
        _upsert_jornada(db, datos)
        actualizadas += 1
        d += timedelta(days=1)

    return actualizadas


def aprobar_he_jornada(
    db: Session,
    jornada: JornadaTrabajador,
    minutos: int,
    aprobador: str,
) -> JornadaTrabajador:
    """Aprueba (o ajusta) los minutos de HE de una jornada."""
    if minutos < 0:
        raise ValueError("Los minutos deben ser ≥ 0")
    jornada.he_aprobadas_min = int(minutos)
    jornada.he_aprobadas_por = aprobador
    jornada.he_aprobadas_at = datetime.utcnow()
    return jornada


def consolidar_he_mes(
    db: Session,
    trabajador: Trabajador,
    mes: int,
    anio: int,
    cfg: Optional[ConfiguracionAsistencia] = None,
) -> Optional[HoraExtraTrabajador]:
    """
    Suma las HE aprobadas del mes y las upsertea en `horas_extras_trabajadores`
    para que las recoja la liquidación. Aplica el tope diario de recargo 50%
    según `ConfiguracionAsistencia.he_dia_recargo_50_max_diario` (Art. 31 CT,
    máximo 2h al día con recargo del 50%).

    Devuelve la fila resultante (o None si no había nada que consolidar).
    """
    inicio = date(anio, mes, 1)
    if mes == 12:
        fin = date(anio + 1, 1, 1)
    else:
        fin = date(anio, mes + 1, 1)
    fin = fin - timedelta(days=1)

    jornadas = (
        db.query(JornadaTrabajador)
        .filter(
            JornadaTrabajador.trabajador_id == trabajador.id,
            JornadaTrabajador.fecha >= inicio,
            JornadaTrabajador.fecha <= fin,
        )
        .all()
    )
    if not jornadas:
        return None

    cap_50_min_dia = (cfg.he_dia_recargo_50_max_diario if cfg else 2) * 60
    minutos_50 = 0
    minutos_100 = 0  # festivos/dom
    for j in jornadas:
        if not j.he_aprobadas_min:
            continue
        if _es_dia_no_laborable(j.fecha):
            minutos_100 += j.he_aprobadas_min
        else:
            con_50 = min(j.he_aprobadas_min, cap_50_min_dia)
            exceso = max(0, j.he_aprobadas_min - cap_50_min_dia)
            minutos_50 += con_50
            # Excedente al 100% (criterio conservador; se podría mover a "no remunerar"
            # cuando hay tope semanal Art. 31, pero lo dejamos como 100% que es seguro)
            minutos_100 += exceso

    cantidad_50 = round(minutos_50 / 60, 2)
    cantidad_100 = round(minutos_100 / 60, 2)
    if cantidad_50 == 0 and cantidad_100 == 0:
        return None

    fila = (
        db.query(HoraExtraTrabajador)
        .filter(
            HoraExtraTrabajador.trabajador_id == trabajador.id,
            HoraExtraTrabajador.mes == mes,
            HoraExtraTrabajador.anio == anio,
        )
        .first()
    )
    if fila is None:
        fila = HoraExtraTrabajador(
            trabajador_id=trabajador.id,
            mes=mes,
            anio=anio,
            cantidad_50=cantidad_50,
            cantidad_100=cantidad_100,
            nota="Consolidación automática desde control horario",
            creado_por="asistencia_engine",
        )
        db.add(fila)
    else:
        fila.cantidad_50 = cantidad_50
        fila.cantidad_100 = cantidad_100
        if not (fila.nota and "control horario" in fila.nota.lower()):
            fila.nota = ((fila.nota or "") + "\n[Auto] Consolidación desde control horario").strip()

    # Vincular jornadas a la fila consolidada (auditoría)
    for j in jornadas:
        if j.he_aprobadas_min:
            j.he_consolidada_id = fila.id

    return fila
