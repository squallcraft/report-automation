"""
Motor de cálculo de feriado legal y feriado progresivo (Art. 67 y 68 CT).

Resumen legal:
  - Art. 67 CT: 15 días hábiles de feriado anual remunerado por cada año de servicio.
  - Art. 68 CT (feriado progresivo): después de 10 años trabajados (en uno o más
    empleadores, con tope de 10 años acreditables de empleadores anteriores),
    se gana 1 día hábil adicional por cada 3 años nuevos trabajados con el
    empleador actual.
  - Días hábiles: lunes a viernes. El sábado no se considera día hábil para
    estos efectos (Art. 69 CT).
  - El feriado se devenga proporcionalmente: 1.25 días hábiles por mes trabajado
    (15 días / 12 meses).
  - El feriado progresivo es negociable individual o colectivamente, pero no
    renunciable.

Las funciones devuelven dicts JSON-serializables para consumo directo por la API.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Iterable

DIAS_BASE_ANUALES = 15  # Art. 67 CT
DIAS_POR_MES = 15 / 12  # 1.25 días hábiles por mes trabajado
TOPE_ANIOS_PREVIOS_ACREDITABLES = 10  # Art. 68 CT
ANIOS_PARA_INICIAR_PROGRESIVO = 10
ANIOS_POR_DIA_EXTRA = 3


def antiguedad_meses(fecha_ingreso: date | None, hasta: date | None = None) -> int:
    """Meses completos trabajados desde fecha_ingreso hasta `hasta` (default hoy)."""
    if not fecha_ingreso:
        return 0
    hasta = hasta or date.today()
    if hasta < fecha_ingreso:
        return 0
    delta = (hasta.year - fecha_ingreso.year) * 12 + (hasta.month - fecha_ingreso.month)
    if hasta.day < fecha_ingreso.day:
        delta -= 1
    return max(delta, 0)


def calcular_dias_progresivos(
    anios_servicio_actual: int,
    anios_servicio_previos: int = 0,
) -> int:
    """
    Devuelve los días hábiles ADICIONALES por feriado progresivo.

    Lógica (interpretación práctica del Art. 68 CT, alineada con la doctrina
    administrativa del DT):
      1) Para acceder al beneficio se requiere haber trabajado ≥10 años en total
         (sumando previos acreditados con tope 10 + actuales con este empleador).
      2) Una vez alcanzados esos 10 años, los años "nuevos" son los que se
         cuenten desde ese momento. La regla práctica más usada es:
         días_extra = floor(años_actuales_completos_post_umbral / 3)
         donde el umbral es el momento en que se alcanzan los 10 años totales.
      3) Algunos autores cuentan los años nuevos directamente sobre la antigüedad
         con el empleador actual una vez cumplido el requisito; aquí adoptamos
         la versión conservadora: solo cuentan años POSTERIORES al hito de 10.
    """
    previos = max(0, min(int(anios_servicio_previos or 0), TOPE_ANIOS_PREVIOS_ACREDITABLES))
    actual = max(0, int(anios_servicio_actual or 0))
    anios_totales = previos + actual
    if anios_totales < ANIOS_PARA_INICIAR_PROGRESIVO:
        return 0
    # Cuántos años actuales caen DESPUÉS del umbral de 10 años totales
    actual_post_umbral = max(0, anios_totales - ANIOS_PARA_INICIAR_PROGRESIVO)
    actual_post_umbral = min(actual_post_umbral, actual)
    return actual_post_umbral // ANIOS_POR_DIA_EXTRA


def dias_habiles_entre(inicio: date, fin: date) -> int:
    """
    Cuenta días hábiles (lunes a viernes) inclusivo en ambos extremos.
    Para el feriado, la ley considera al sábado inhábil (Art. 69 CT).
    Nota: feriados legales (festivos) NO se descuentan automáticamente acá; si se
    pide más adelante, se puede agregar una tabla de feriados oficiales.
    """
    if fin < inicio:
        return 0
    n = 0
    d = inicio
    while d <= fin:
        if d.weekday() < 5:  # 0=lun..4=vie
            n += 1
        d += timedelta(days=1)
    return n


def calcular_saldo(
    fecha_ingreso: date | None,
    anios_servicio_previos: int = 0,
    dias_tomados_aprobados: float = 0,
    dias_solicitados_pendientes: float = 0,
    hasta: date | None = None,
) -> dict:
    """
    Calcula el saldo completo de feriado para un trabajador.

    Args:
      fecha_ingreso: fecha en que entró al empleador actual.
      anios_servicio_previos: años acreditados con empleadores anteriores (tope 10).
      dias_tomados_aprobados: suma de dias_habiles de vacaciones APROBADAS o
        REGISTRO_HISTORICO (ya consumidas).
      dias_solicitados_pendientes: suma de dias_habiles SOLICITADAS aún sin aprobar
        (se "reservan" para informar saldo proyectado).
      hasta: fecha de corte (default hoy).

    Returns:
      dict con: meses_trabajados, anios_actuales, anios_previos_acreditados,
      anios_totales, dias_progresivo, dias_devengados (15 + progresivo proporcional
      al avance del año), dias_acumulados (devengados desde ingreso),
      dias_tomados, dias_solicitados_pendientes, dias_disponibles,
      proximo_dia_extra (cuándo gana el siguiente día progresivo, si aplica).
    """
    hasta = hasta or date.today()
    meses = antiguedad_meses(fecha_ingreso, hasta)
    anios_actual = meses // 12
    previos = max(0, min(int(anios_servicio_previos or 0), TOPE_ANIOS_PREVIOS_ACREDITABLES))
    anios_totales = previos + anios_actual
    dias_progresivo = calcular_dias_progresivos(anios_actual, previos)
    # Días por año = 15 base + progresivo
    dias_por_anio = DIAS_BASE_ANUALES + dias_progresivo
    # Devengado prorrateado: (días_por_año / 12) por mes trabajado.
    # Solo el progresivo se aplica a partir del año en que se gana.
    # Para simplicidad: se prorratea el total anual sobre los meses ya trabajados.
    dias_acumulados = round(meses * (dias_por_anio / 12), 2)
    disponibles = round(dias_acumulados - dias_tomados_aprobados - dias_solicitados_pendientes, 2)

    # Próximo día extra por progresivo (si aplica)
    proximo_dia_extra: dict | None = None
    if previos + anios_actual >= ANIOS_PARA_INICIAR_PROGRESIVO and fecha_ingreso:
        actual_post_umbral = max(0, (previos + anios_actual) - ANIOS_PARA_INICIAR_PROGRESIVO)
        # Cuántos años faltan al próximo múltiplo de 3 post-umbral
        proximos_anios_post = ((actual_post_umbral // ANIOS_POR_DIA_EXTRA) + 1) * ANIOS_POR_DIA_EXTRA
        anios_actual_objetivo = proximos_anios_post + (ANIOS_PARA_INICIAR_PROGRESIVO - previos)
        if anios_actual_objetivo > anios_actual:
            try:
                fecha_objetivo = fecha_ingreso.replace(year=fecha_ingreso.year + anios_actual_objetivo)
            except ValueError:
                fecha_objetivo = fecha_ingreso + timedelta(days=int(anios_actual_objetivo * 365.25))
            proximo_dia_extra = {
                "fecha_aproximada": fecha_objetivo.isoformat(),
                "dias_que_gana": 1,
            }

    return {
        "meses_trabajados": meses,
        "anios_actuales": anios_actual,
        "anios_previos_acreditados": previos,
        "anios_totales": anios_totales,
        "dias_base_anuales": DIAS_BASE_ANUALES,
        "dias_progresivo": dias_progresivo,
        "dias_por_anio": dias_por_anio,
        "dias_acumulados": dias_acumulados,
        "dias_tomados": round(dias_tomados_aprobados, 2),
        "dias_solicitados_pendientes": round(dias_solicitados_pendientes, 2),
        "dias_disponibles": disponibles,
        "proximo_dia_extra": proximo_dia_extra,
    }
