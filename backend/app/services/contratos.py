"""
Servicio de gestión contractual de trabajadores.

Provee:
- Resolución de la versión contractual vigente para un trabajador en una fecha.
- Cálculo del valor hora ordinaria.
- Validador IMM proporcional según jornada (Art. 40 bis Código del Trabajo).
"""
from __future__ import annotations

from datetime import date
from typing import Optional, List

from sqlalchemy.orm import Session
from sqlalchemy import desc

from app.models import (
    Trabajador,
    ContratoTrabajadorVersion,
    ConfiguracionLegal,
    TipoJornadaEnum,
    MotivoVersionContratoEnum,
)


# ── Constantes legales ────────────────────────────────────────────────────────
JORNADA_LEGAL_DEFAULT = 44       # Jornada legal vigente (hasta abril 2026)
JORNADA_PARCIAL_LIMITE = 30      # Art. 40 bis: jornada parcial es ≤ 30 hrs/sem


# ── Configuración legal del sistema ──────────────────────────────────────────
def obtener_config_legal(db: Session) -> ConfiguracionLegal:
    """Obtiene (o crea) la fila singleton de configuración legal."""
    cfg = db.query(ConfiguracionLegal).filter(ConfiguracionLegal.id == 1).first()
    if not cfg:
        cfg = ConfiguracionLegal(
            id=1,
            jornada_legal_vigente=JORNADA_LEGAL_DEFAULT,
            rep_legal_nombre="Adriana Colina Aguilar",
            rep_legal_rut="25.936.753-0",
            empresa_razon_social="E-Courier",
        )
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


def jornada_legal_vigente(db: Session, en_fecha: Optional[date] = None) -> int:
    """
    Retorna la jornada legal vigente. Si hay una próxima programada y la fecha
    consultada es posterior a su entrada en vigor, retorna la próxima.
    """
    cfg = obtener_config_legal(db)
    if (
        en_fecha
        and cfg.jornada_legal_proxima
        and cfg.jornada_legal_proxima_desde
        and en_fecha >= cfg.jornada_legal_proxima_desde
    ):
        return cfg.jornada_legal_proxima
    return cfg.jornada_legal_vigente


# ── Versión contractual vigente ──────────────────────────────────────────────
def obtener_version_vigente(
    db: Session,
    trabajador_id: int,
    en_fecha: Optional[date] = None,
) -> Optional[ContratoTrabajadorVersion]:
    """
    Versión contractual vigente para `trabajador_id` en `en_fecha`.
    Si no se pasa fecha, usa hoy. Retorna None si no hay ninguna.
    """
    if en_fecha is None:
        en_fecha = date.today()

    return (
        db.query(ContratoTrabajadorVersion)
        .filter(
            ContratoTrabajadorVersion.trabajador_id == trabajador_id,
            ContratoTrabajadorVersion.vigente_desde <= en_fecha,
        )
        .filter(
            (ContratoTrabajadorVersion.vigente_hasta == None)  # noqa: E711
            | (ContratoTrabajadorVersion.vigente_hasta >= en_fecha)
        )
        .order_by(desc(ContratoTrabajadorVersion.vigente_desde))
        .first()
    )


def obtener_version_para_mes(
    db: Session,
    trabajador_id: int,
    mes: int,
    anio: int,
) -> Optional[ContratoTrabajadorVersion]:
    """
    Versión vigente al ÚLTIMO día del mes/año (criterio para liquidación mensual).
    """
    if mes == 12:
        ultimo_dia = date(anio, 12, 31)
    else:
        from datetime import timedelta
        ultimo_dia = date(anio, mes + 1, 1) - timedelta(days=1)
    return obtener_version_vigente(db, trabajador_id, en_fecha=ultimo_dia)


def crear_version(
    db: Session,
    trabajador_id: int,
    *,
    vigente_desde: date,
    sueldo_liquido: int,
    sueldo_base: int = 0,
    gratificacion: int = 0,
    movilizacion: int = 0,
    colacion: int = 0,
    viaticos: int = 0,
    jornada_semanal_horas: int = 44,
    tipo_jornada: str = TipoJornadaEnum.COMPLETA.value,
    distribucion_jornada: Optional[str] = None,
    cargo: Optional[str] = None,
    tipo_contrato: Optional[str] = None,
    motivo: str = MotivoVersionContratoEnum.CONTRATACION.value,
    notas: Optional[str] = None,
    creado_por: Optional[str] = None,
) -> ContratoTrabajadorVersion:
    """
    Crea una nueva versión contractual y cierra la anterior (vigente_hasta = vigente_desde - 1 día).
    No genera anexo: eso lo hace el motor anexos_engine al recibir esta versión.
    """
    from datetime import timedelta

    anterior = obtener_version_vigente(db, trabajador_id, en_fecha=vigente_desde)
    if anterior and anterior.vigente_hasta is None and anterior.vigente_desde < vigente_desde:
        anterior.vigente_hasta = vigente_desde - timedelta(days=1)

    # Auto-clasificar jornada según horas si no se pasa explícita
    tipo = tipo_jornada
    if jornada_semanal_horas <= JORNADA_PARCIAL_LIMITE:
        tipo = TipoJornadaEnum.PARCIAL.value

    nueva = ContratoTrabajadorVersion(
        trabajador_id=trabajador_id,
        vigente_desde=vigente_desde,
        vigente_hasta=None,
        sueldo_liquido=sueldo_liquido,
        sueldo_base=sueldo_base,
        gratificacion=gratificacion,
        movilizacion=movilizacion,
        colacion=colacion,
        viaticos=viaticos,
        jornada_semanal_horas=jornada_semanal_horas,
        tipo_jornada=tipo,
        distribucion_jornada=distribucion_jornada,
        cargo=cargo,
        tipo_contrato=tipo_contrato,
        motivo=motivo,
        notas=notas,
        creado_por=creado_por,
    )
    db.add(nueva)
    db.flush()
    return nueva


# ── Cálculo de valor hora ────────────────────────────────────────────────────
def calcular_valor_hora(sueldo_base: int, jornada_semanal: int) -> int:
    """
    Valor hora ordinaria según Art. 28 Código del Trabajo:

        valor_hora = (sueldo_base × 7) / (30 × jornada_semanal_horas)

    Retorna pesos enteros redondeados.
    """
    if jornada_semanal <= 0 or sueldo_base <= 0:
        return 0
    return round((sueldo_base * 7) / (30 * jornada_semanal))


def calcular_monto_he(
    sueldo_base: int,
    jornada_semanal: int,
    cantidad_50: float,
    cantidad_100: float,
) -> dict:
    """
    Calcula los montos a pagar por horas extras al 50% y 100%.

    HE 50% (Art. 32) — Recargo del 50%
    HE 100% (Art. 38) — Recargo del 100% (festivos / domingos)
    """
    valor_hora = calcular_valor_hora(sueldo_base, jornada_semanal)
    monto_50 = round(valor_hora * float(cantidad_50) * 1.5)
    monto_100 = round(valor_hora * float(cantidad_100) * 2.0)
    return {
        "valor_hora": valor_hora,
        "monto_50": monto_50,
        "monto_100": monto_100,
        "monto_total": monto_50 + monto_100,
    }


# ── Validador IMM ────────────────────────────────────────────────────────────
def imm_aplicable(imm_legal: int, jornada_pactada: int, jornada_legal: int) -> int:
    """
    IMM aplicable según el tipo de jornada:
    - Jornada parcial (≤ 30 hrs/sem, Art. 40 bis): IMM proporcional.
    - Jornada completa (> 30 hrs/sem): IMM completo.
    """
    if jornada_pactada <= JORNADA_PARCIAL_LIMITE:
        return round(imm_legal * (jornada_pactada / max(1, jornada_legal)))
    return imm_legal


def validar_imm_para_mes(db: Session, mes: int, anio: int, imm_legal: int) -> List[dict]:
    """
    Recorre todos los trabajadores activos y detecta los que tienen
    sueldo_base bajo el IMM aplicable según su jornada.

    Retorna lista de dicts con: trabajador_id, nombre, sueldo_base,
    jornada, imm_aplicable, monto_reajuste_sugerido.
    """
    from datetime import timedelta

    if mes == 12:
        ultimo_dia = date(anio, 12, 31)
    else:
        ultimo_dia = date(anio, mes + 1, 1) - timedelta(days=1)

    j_legal = jornada_legal_vigente(db, ultimo_dia)
    trabajadores = db.query(Trabajador).filter(Trabajador.activo == True).all()
    alertas: List[dict] = []

    for t in trabajadores:
        version = obtener_version_para_mes(db, t.id, mes, anio)
        if not version:
            # Sin versión migrada → marcar para que el admin la cargue
            alertas.append({
                "trabajador_id": t.id,
                "nombre": t.nombre,
                "razon": "SIN_CONTRATO_MIGRADO",
                "sueldo_base_actual": t.sueldo_base or 0,
                "mensaje": "Trabajador sin contrato migrado. Carga su contrato vigente en su ficha.",
            })
            continue

        imm_ap = imm_aplicable(imm_legal, version.jornada_semanal_horas, j_legal)
        if version.sueldo_base < imm_ap:
            alertas.append({
                "trabajador_id": t.id,
                "nombre": t.nombre,
                "razon": "BAJO_IMM",
                "sueldo_base_actual": version.sueldo_base,
                "jornada_pactada": version.jornada_semanal_horas,
                "jornada_legal": j_legal,
                "imm_legal": imm_legal,
                "imm_aplicable": imm_ap,
                "monto_reajuste_sugerido": imm_ap - version.sueldo_base,
                "mensaje": (
                    f"Sueldo base ${version.sueldo_base:,} está bajo el IMM aplicable "
                    f"${imm_ap:,} (jornada {version.jornada_semanal_horas} hrs)"
                ),
            })

    return alertas
