"""
Servicio de calendario de semanas.
Regla de negocio: si cualquier día Lun-Vie de una semana ISO cae en el mes siguiente,
toda la semana (Lun-Dom) pertenece a la semana 1 de ese mes siguiente.
"""
from datetime import date, timedelta
from collections import defaultdict
from typing import List, Dict

from sqlalchemy.orm import Session

from app.models import CalendarioSemanas


def _calcular_semanas_anio(anio: int) -> List[Dict]:
    """
    Calcula todos los bloques Mon-Sun del año y los asigna a (semana, mes, anio)
    según la regla de negocio.
    """
    records = []
    semana_counter: Dict = defaultdict(int)

    # Punto de partida: el lunes de la semana ISO que contiene el 28-dic del año anterior
    # (suficiente para capturar semanas que empiezan en dic y van a ene del año objetivo)
    start = date(anio - 1, 12, 28)
    while start.weekday() != 0:
        start -= timedelta(days=1)

    d = start
    while True:
        week_monday = d
        week_friday = d + timedelta(days=4)
        week_sunday = d + timedelta(days=6)

        # Mon-Fri para determinar a qué mes pertenece la semana
        mon_fri = [d + timedelta(days=i) for i in range(5)]
        monday_my = (mon_fri[0].month, mon_fri[0].year)
        friday_my = (mon_fri[4].month, mon_fri[4].year)

        # Si el viernes (o cualquier día posterior al lunes) está en un mes posterior,
        # la semana pasa a ese mes posterior
        if (friday_my[1], friday_my[0]) > (monday_my[1], monday_my[0]):
            target_month = friday_my[0]
            target_year = friday_my[1]
        else:
            target_month = monday_my[0]
            target_year = monday_my[1]

        # Ignorar semanas que pertenecen al año anterior
        if target_year < anio:
            d += timedelta(days=7)
            continue

        # Detener al llegar al año siguiente
        if target_year > anio:
            break

        semana_counter[(target_year, target_month)] += 1
        semana_num = semana_counter[(target_year, target_month)]

        records.append({
            "semana": semana_num,
            "mes": target_month,
            "anio": target_year,
            "fecha_inicio": week_monday,
            "fecha_fin": week_sunday,
        })

        d += timedelta(days=7)

    return records


def generar_calendario_anio(anio: int, db: Session, sobrescribir_futuro: bool = True) -> int:
    """
    Genera (o regenera) el calendario para el año indicado.
    Solo sobreescribe semanas futuras si sobrescribir_futuro=True.
    Retorna la cantidad de semanas creadas o actualizadas.
    """
    hoy = date.today()
    registros = _calcular_semanas_anio(anio)
    creados = 0

    for r in registros:
        es_futuro = r["fecha_inicio"] > hoy

        existente = db.query(CalendarioSemanas).filter(
            CalendarioSemanas.semana == r["semana"],
            CalendarioSemanas.mes == r["mes"],
            CalendarioSemanas.anio == r["anio"],
        ).first()

        if existente:
            if es_futuro and sobrescribir_futuro:
                existente.fecha_inicio = r["fecha_inicio"]
                existente.fecha_fin = r["fecha_fin"]
                existente.generado_auto = True
                creados += 1
        else:
            db.add(CalendarioSemanas(
                semana=r["semana"],
                mes=r["mes"],
                anio=r["anio"],
                fecha_inicio=r["fecha_inicio"],
                fecha_fin=r["fecha_fin"],
                generado_auto=True,
            ))
            creados += 1

    db.commit()
    return creados


def build_fecha_semana_lookup(db: Session) -> Dict[date, tuple]:
    """
    Construye un dict {fecha → (semana, mes, anio)} para lookup rápido en ingesta.
    Cubre todos los calendarios cargados en la base de datos.
    """
    weeks = db.query(CalendarioSemanas).all()
    lookup: Dict[date, tuple] = {}
    for w in weeks:
        d = w.fecha_inicio
        while d <= w.fecha_fin:
            lookup[d] = (w.semana, w.mes, w.anio)
            d += timedelta(days=1)
    return lookup


def get_dates_for_week(db: Session, semana: int, mes: int, anio: int) -> List[date]:
    """
    Retorna todos los días (Lun-Dom) de la semana/mes/año dado.
    Usa la tabla calendario si existe, con fallback a fórmula simple.
    """
    week = db.query(CalendarioSemanas).filter(
        CalendarioSemanas.semana == semana,
        CalendarioSemanas.mes == mes,
        CalendarioSemanas.anio == anio,
    ).first()

    if week:
        dates = []
        d = week.fecha_inicio
        while d <= week.fecha_fin:
            dates.append(d)
            d += timedelta(days=1)
        return dates

    # Fallback: fórmula simple (días del mes)
    import calendar as cal_mod
    _, days_in_month = cal_mod.monthrange(anio, mes)
    start_day = (semana - 1) * 7 + 1
    end_day = min(semana * 7, days_in_month)
    return [date(anio, mes, d) for d in range(start_day, end_day + 1)]
