"""
Motor de cálculo de costo de despido (indemnización) según legislación chilena.

Referencias legales:
  - Art. 163 CT: 1 mes de remuneración por año de servicio (fracción > 6 meses = 1 año).
    Tope: 330 UF (Ley 19.010, vigente).
  - Art. 162 CT: Aviso previo de 30 días, o pago de 1 mes ("indemnización sustitutiva del aviso").
  - Art. 73 CT: Feriado proporcional = días hábiles trabajados en el año en curso × (15 / 365),
    pagado al valor del día según última remuneración.
  - Solo procede para Art. 161 (necesidades de la empresa) o 160 Nº 4 si se pacta.
  - Contratos PLAZO_FIJO y OBRA_FAENA: no generan indemnización por años (solo feriado proporcional).
  
Cálculo:
  1. última_remuneracion_base = sueldo_base + gratificacion (si es proporcional mensual) + asignaciones fijas imponibles.
     NO incluye: horas extras, viaticos no imponibles, colación/movilización (no imponibles), bonos esporádicos.
  2. anios_servicio = floor(meses / 12) + (1 si meses % 12 > 6)
  3. indemnizacion = min(anios_servicio × ultima_remuneracion_base, 330 × uf_valor)
  4. aviso_previo = ultima_remuneracion_base (si aplica)
  5. feriado_proporcional:
     - dias_ganados_en_periodo = dias_habiles_trabajados_este_anio × (15 / dias_habiles_en_anio)
     - valor = dias_ganados × (ultima_remuneracion_base / 30)
  6. total = indemnizacion + aviso_previo + feriado_proporcional
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.models import (
    Trabajador,
    ContratoTrabajadorVersion,
    CostoDespidoSnapshot,
    VacacionTrabajador,
)

# UF de referencia por defecto (se actualiza externamente o se pasa como parámetro)
UF_DEFAULT = 38_200   # ~apr 2026; actualizar mensualmente o integrarse con API CMF


# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class ResultadoIndemnizacion:
    trabajador_id: int
    nombre: str
    fecha_ingreso: Optional[date]
    meses_trabajados: int
    anios_servicio_indemnizacion: int
    tipo_contrato: Optional[str]
    ultima_remuneracion_base: int
    indemnizacion_anos_servicio: int
    aplica_indemnizacion: bool          # False para PLAZO_FIJO/OBRA_FAENA
    aviso_previo: int                   # 1 mes si aplica
    feriado_proporcional: int
    total_estimado: int
    tope_330uf: int
    fue_topado: bool
    uf_referencia: int
    notas: list[str] = field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────────
def _meses_entre(desde: date, hasta: date) -> int:
    """Meses completos trabajados entre dos fechas."""
    return (hasta.year - desde.year) * 12 + (hasta.month - desde.month)


def _anios_para_indemnizacion(meses: int) -> int:
    """
    Convierte meses a años para cálculo de indemnización.
    Fracción > 6 meses cuenta como 1 año completo (Art. 163 CT).
    """
    anios = meses // 12
    fraccion = meses % 12
    if fraccion > 6:
        anios += 1
    return anios


def _dias_habiles_en_anio(anio: int) -> int:
    """Aproximación: 250 días hábiles/año (52 sem × 5 días, descontando ~10 festivos)."""
    return 250


def _remuneracion_base_imponible(version: ContratoTrabajadorVersion) -> int:
    """
    Remuneración imponible mensual para efectos del cálculo de indemnización.
    Incluye sueldo_base + gratificacion mensual proporcional.
    NO incluye: viaticos (no imponibles), colación, movilización (no imponibles),
    horas extras ni bonos esporádicos.
    
    Nota: colación y movilización en Chile son NO imponibles por ley (Art. 41 CT),
    por lo que no forman parte de la base de indemnización.
    """
    base = version.sueldo_base or 0
    grat = version.gratificacion or 0
    return base + grat


def _dias_vacaciones_tomados_este_anio(
    db: Session, trabajador_id: int, anio: int
) -> int:
    """Suma de días de vacaciones tomados (estado APROBADA/TOMADA) en el año dado."""
    try:
        inicio_anio = date(anio, 1, 1)
        fin_anio = date(anio, 12, 31)
        vacaciones = db.query(VacacionTrabajador).filter(
            VacacionTrabajador.trabajador_id == trabajador_id,
            VacacionTrabajador.fecha_inicio >= inicio_anio,
            VacacionTrabajador.fecha_inicio <= fin_anio,
        ).all()
        total = sum(v.dias_habiles or 0 for v in vacaciones)
        return total
    except Exception:
        return 0


def calcular_indemnizacion(
    db: Session,
    trabajador: Trabajador,
    version_vigente: Optional[ContratoTrabajadorVersion],
    hoy: Optional[date] = None,
    uf_valor: int = UF_DEFAULT,
    incluir_aviso_previo: bool = True,
) -> ResultadoIndemnizacion:
    """
    Calcula el costo de despido estimado para un trabajador.
    
    Args:
        db: sesión de base de datos
        trabajador: objeto Trabajador
        version_vigente: versión contractual vigente (puede ser None)
        hoy: fecha de cálculo (default: hoy)
        uf_valor: valor de la UF en pesos (default: UF_DEFAULT)
        incluir_aviso_previo: si True, suma el mes de aviso previo al total
    """
    hoy = hoy or date.today()
    notas = []

    fecha_ingreso = trabajador.fecha_ingreso
    if not fecha_ingreso:
        return ResultadoIndemnizacion(
            trabajador_id=trabajador.id,
            nombre=trabajador.nombre,
            fecha_ingreso=None,
            meses_trabajados=0,
            anios_servicio_indemnizacion=0,
            tipo_contrato=None,
            ultima_remuneracion_base=0,
            indemnizacion_anos_servicio=0,
            aplica_indemnizacion=False,
            aviso_previo=0,
            feriado_proporcional=0,
            total_estimado=0,
            tope_330uf=330 * uf_valor,
            fue_topado=False,
            uf_referencia=uf_valor,
            notas=["Sin fecha de ingreso registrada"],
        )

    # ── 1. Antigüedad ─────────────────────────────────────────────────────────
    meses = _meses_entre(fecha_ingreso, hoy)
    if meses < 0:
        meses = 0
    anios_ind = _anios_para_indemnizacion(meses)

    # ── 2. Tipo de contrato y última remuneración ─────────────────────────────
    tipo_contrato = None
    remuneracion_base = 0
    if version_vigente:
        tipo_contrato = version_vigente.tipo_contrato
        remuneracion_base = _remuneracion_base_imponible(version_vigente)
    elif trabajador.tipo_contrato:
        tipo_contrato = trabajador.tipo_contrato
        remuneracion_base = (trabajador.sueldo_base or 0) + (trabajador.gratificacion or 0)

    # ── 3. ¿Aplica indemnización por años? ───────────────────────────────────
    # Solo INDEFINIDO genera indemnización por años de servicio (Art. 163 CT)
    aplica = tipo_contrato in (None, "INDEFINIDO")
    if tipo_contrato in ("PLAZO_FIJO", "OBRA_FAENA"):
        aplica = False
        notas.append(f"Contrato {tipo_contrato}: no genera indemnización por años (Art. 159 Nº 4/5 CT)")

    # ── 4. Indemnización por años de servicio ────────────────────────────────
    tope_330uf = 330 * uf_valor
    ind_bruta = anios_ind * remuneracion_base if aplica else 0
    fue_topado = ind_bruta > tope_330uf and aplica
    ind_final = min(ind_bruta, tope_330uf) if aplica else 0
    if fue_topado:
        notas.append(f"Indemnización topada a 330 UF (${tope_330uf:,})")

    # ── 5. Aviso previo (1 mes remuneración, Art. 162 CT) ────────────────────
    aviso = remuneracion_base if incluir_aviso_previo else 0

    # ── 6. Feriado proporcional (Art. 73 CT) ─────────────────────────────────
    # Días proporcionales ganados en el año en curso, pendientes de tomar
    dias_habiles_anio = _dias_habiles_en_anio(hoy.year)
    inicio_anio = date(hoy.year, 1, 1)
    if fecha_ingreso > inicio_anio:
        inicio_anio = fecha_ingreso  # si ingresó este año
    dias_trabajados_este_anio = max(0, _meses_entre(inicio_anio, hoy) * 21)  # aprox
    dias_ganados = round(dias_trabajados_este_anio * (15 / dias_habiles_anio), 2)
    dias_tomados = _dias_vacaciones_tomados_este_anio(db, trabajador.id, hoy.year)
    dias_feriado_pend = max(0.0, dias_ganados - dias_tomados)
    valor_dia = remuneracion_base / 30 if remuneracion_base else 0
    feriado = int(dias_feriado_pend * valor_dia)

    total = ind_final + aviso + feriado

    return ResultadoIndemnizacion(
        trabajador_id=trabajador.id,
        nombre=trabajador.nombre,
        fecha_ingreso=fecha_ingreso,
        meses_trabajados=meses,
        anios_servicio_indemnizacion=anios_ind,
        tipo_contrato=tipo_contrato,
        ultima_remuneracion_base=remuneracion_base,
        indemnizacion_anos_servicio=ind_final,
        aplica_indemnizacion=aplica,
        aviso_previo=aviso,
        feriado_proporcional=feriado,
        total_estimado=total,
        tope_330uf=tope_330uf,
        fue_topado=fue_topado,
        uf_referencia=uf_valor,
        notas=notas,
    )


def guardar_snapshot(
    db: Session,
    resultado: ResultadoIndemnizacion,
    mes: int,
    anio: int,
) -> CostoDespidoSnapshot:
    """Persiste o actualiza el snapshot mensual del costo de despido."""
    snap = db.query(CostoDespidoSnapshot).filter_by(
        trabajador_id=resultado.trabajador_id, mes=mes, anio=anio
    ).first()
    if not snap:
        snap = CostoDespidoSnapshot(
            trabajador_id=resultado.trabajador_id, mes=mes, anio=anio
        )
        db.add(snap)

    snap.fecha_ingreso = resultado.fecha_ingreso
    snap.meses_trabajados = resultado.meses_trabajados
    snap.anios_servicio_indemnizacion = resultado.anios_servicio_indemnizacion
    snap.ultima_remuneracion_base = resultado.ultima_remuneracion_base
    snap.tipo_contrato = resultado.tipo_contrato
    snap.indemnizacion_anos_servicio = resultado.indemnizacion_anos_servicio
    snap.aviso_previo = resultado.aviso_previo
    snap.feriado_proporcional = resultado.feriado_proporcional
    snap.total_estimado = resultado.total_estimado
    snap.uf_referencia = resultado.uf_referencia
    snap.notas = "; ".join(resultado.notas) if resultado.notas else None
    snap.calculado_at = datetime.utcnow()

    db.commit()
    db.refresh(snap)
    return snap
