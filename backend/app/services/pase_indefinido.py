"""
Servicio para el flujo "Pase a Indefinido":
1. Calcula el preview del ajuste de cesantía (manteniendo líquido constante).
2. Crea atómicamente dos versiones + dos anexos:
   - Versión 1 / Anexo PASE_INDEFINIDO: cambia tipo_contrato a INDEFINIDO.
   - Versión 2 / Anexo AJUSTE_SEGURO_CESANTIA: sube el sueldo base para
     absorber el 0,6% de cotización cesantía del trabajador que antes
     pagaba íntegramente el empleador (plazo fijo: empleador paga 100%).

Cotizaciones cesantía (Ley 19.728):
  - Plazo fijo / Obra-faena: empleador paga 3,0% (trabajador 0%).
  - Indefinido: empleador paga 2,4%, trabajador paga 0,6%.
  ⇒ Al pasar a indefinido el trabajador asume 0,6% sobre su imponible,
    lo que reduce su líquido. Para mantenerlo constante se sube el bruto.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models import (
    Trabajador,
    ContratoTrabajadorVersion,
    AnexoContrato,
    TipoAnexoEnum,
    EstadoAnexoEnum,
    MotivoVersionContratoEnum,
)
from app.services.contratos import obtener_version_vigente
from app.services.remuneraciones import calcular_desde_liquido, bruto_a_liquido

# Tasa cesantía trabajador en contrato indefinido (Ley 19.728)
TASA_CESANTIA_TRABAJADOR_INDEFINIDO = 0.006  # 0,6 %


@dataclass
class PreviewPaseIndefindo:
    """Resultado del preview antes de confirmar el pase."""
    liquido_objetivo: int
    sueldo_base_actual: int
    sueldo_base_sugerido: int
    diferencia_base: int
    nueva_version_id: Optional[int] = None   # se llena al confirmar
    anexo_pase_id: Optional[int] = None
    anexo_cesantia_id: Optional[int] = None


def preview_ajuste_cesantia(
    db: Session,
    trabajador: Trabajador,
    fecha_desde: date,
) -> PreviewPaseIndefindo:
    """
    Calcula el nuevo sueldo base necesario para mantener el mismo líquido
    al cambiar de plazo fijo (cesantía 0% trabajador) a indefinido (0,6%).
    No persiste nada.
    """
    version = obtener_version_vigente(db, trabajador.id, fecha_desde)
    if not version:
        raise ValueError("El trabajador no tiene versión contractual vigente")

    liquido_objetivo = version.sueldo_liquido
    base_actual = version.sueldo_base

    # Calcular nuevo sueldo base para mantener el mismo líquido con tipo INDEFINIDO
    resultado = calcular_desde_liquido(
        sueldo_liquido=liquido_objetivo,
        afp=trabajador.afp,
        sistema_salud=trabajador.sistema_salud,
        monto_cotizacion_salud=trabajador.monto_cotizacion_salud,
        tipo_contrato="INDEFINIDO",
        movilizacion=version.movilizacion,
        colacion=version.colacion,
        viaticos=version.viaticos,
    )

    sueldo_base_sugerido = resultado.sueldo_base

    return PreviewPaseIndefindo(
        liquido_objetivo=liquido_objetivo,
        sueldo_base_actual=base_actual,
        sueldo_base_sugerido=sueldo_base_sugerido,
        diferencia_base=sueldo_base_sugerido - base_actual,
    )


def confirmar_pase_indefinido(
    db: Session,
    trabajador: Trabajador,
    fecha_desde: date,
    sueldo_base_nuevo: int,
    creado_por: str,
    notas: Optional[str] = None,
) -> tuple[AnexoContrato, AnexoContrato]:
    """
    Ejecuta el pase a indefinido de forma atómica:
    - Cierra la versión vigente
    - Crea versión 1 (INDEFINIDO, mismo sueldo base) + Anexo PASE_INDEFINIDO
    - Crea versión 2 (sueldo_base_nuevo) + Anexo AJUSTE_SEGURO_CESANTIA
    Devuelve la tupla (anexo_pase, anexo_cesantia).
    Si algo falla, SQLAlchemy hace rollback automáticamente (sesión debe estar en autocommit=False).
    """
    version_actual = obtener_version_vigente(db, trabajador.id, fecha_desde)
    if not version_actual:
        raise ValueError("El trabajador no tiene versión contractual vigente")

    # ── Cerrar versión actual ────────────────────────────────────────────────
    from datetime import timedelta as _td
    version_actual.vigente_hasta = fecha_desde - _td(days=1)

    # ── Versión 1: tipo INDEFINIDO (mismas condiciones económicas) ───────────
    v1 = ContratoTrabajadorVersion(
        trabajador_id=trabajador.id,
        vigente_desde=fecha_desde,
        vigente_hasta=None,
        sueldo_liquido=version_actual.sueldo_liquido,
        sueldo_base=version_actual.sueldo_base,
        gratificacion=version_actual.gratificacion,
        movilizacion=version_actual.movilizacion,
        colacion=version_actual.colacion,
        viaticos=version_actual.viaticos,
        jornada_semanal_horas=version_actual.jornada_semanal_horas,
        tipo_jornada=version_actual.tipo_jornada,
        distribucion_jornada=version_actual.distribucion_jornada,
        cargo=version_actual.cargo,
        tipo_contrato="INDEFINIDO",
        motivo=MotivoVersionContratoEnum.PASE_INDEFINIDO.value,
        notas=notas,
        creado_por=creado_por,
        origen="MANUAL",
        numero_renovacion=0,
    )
    db.add(v1)
    db.flush()  # obtenemos v1.id

    anexo_pase = AnexoContrato(
        trabajador_id=trabajador.id,
        version_id=v1.id,
        tipo=TipoAnexoEnum.PASE_INDEFINIDO.value,
        titulo=f"Pase a Contrato Indefinido — {fecha_desde.strftime('%d/%m/%Y')}",
        requiere_firma_trabajador=True,
        estado=EstadoAnexoEnum.EMITIDO.value,
        creado_por=creado_por,
    )
    db.add(anexo_pase)
    db.flush()

    # ── Versión 2: ajuste de sueldo base por cesantía ────────────────────────
    # Recalcular el nuevo líquido con el sueldo_base_nuevo para registrarlo
    resultado_nuevo = bruto_a_liquido(
        remuneracion_imponible=sueldo_base_nuevo + (v1.gratificacion or 0),
        afp=trabajador.afp,
        sistema_salud=trabajador.sistema_salud,
        monto_cotizacion_salud=trabajador.monto_cotizacion_salud,
        tipo_contrato="INDEFINIDO",
        movilizacion=v1.movilizacion,
        colacion=v1.colacion,
        viaticos=v1.viaticos,
    )

    v2 = ContratoTrabajadorVersion(
        trabajador_id=trabajador.id,
        vigente_desde=fecha_desde,
        vigente_hasta=None,
        sueldo_liquido=resultado_nuevo.sueldo_liquido,
        sueldo_base=sueldo_base_nuevo,
        gratificacion=v1.gratificacion,
        movilizacion=v1.movilizacion,
        colacion=v1.colacion,
        viaticos=v1.viaticos,
        jornada_semanal_horas=v1.jornada_semanal_horas,
        tipo_jornada=v1.tipo_jornada,
        distribucion_jornada=v1.distribucion_jornada,
        cargo=v1.cargo,
        tipo_contrato="INDEFINIDO",
        motivo=MotivoVersionContratoEnum.AJUSTE_CESANTIA.value,
        notas=f"Ajuste sueldo base de ${version_actual.sueldo_base:,} → ${sueldo_base_nuevo:,} para mantener líquido tras incorporar cotización cesantía 0,6%",
        creado_por=creado_por,
        origen="MANUAL",
        numero_renovacion=0,
        version_padre_id=v1.id,
    )
    # Cerrar v1 en el mismo día (la v2 es la definitiva)
    v1.vigente_hasta = fecha_desde

    db.add(v2)
    db.flush()

    anexo_cesantia = AnexoContrato(
        trabajador_id=trabajador.id,
        version_id=v2.id,
        tipo=TipoAnexoEnum.AJUSTE_SEGURO_CESANTIA.value,
        titulo=f"Ajuste Sueldo Base por Seguro Cesantía — {fecha_desde.strftime('%d/%m/%Y')}",
        requiere_firma_trabajador=True,
        estado=EstadoAnexoEnum.EMITIDO.value,
        creado_por=creado_por,
    )
    db.add(anexo_cesantia)

    # Actualizar tipo_contrato en Trabajador
    trabajador.tipo_contrato = "INDEFINIDO"

    db.commit()
    db.refresh(anexo_pase)
    db.refresh(anexo_cesantia)

    return anexo_pase, anexo_cesantia
