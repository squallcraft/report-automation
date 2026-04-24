"""
Servicio para la gestión del ciclo de vida de contratos de plazo fijo:
  - Programar los 4 eventos (T-30, T-15, T-7, T0) al crear/renovar una versión.
  - Ejecutar el job diario (invocado desde POST /admin/jobs/cron-diario).
  - Crear documento de término (solo PLAZO_FIJO) con fecha_efectiva.
  - Renovar manualmente un plazo fijo (click humano explícito).
  - Conversión automática a indefinido en T0 (3ª renovación o sin acción).
"""
from __future__ import annotations

import logging
from datetime import date, timedelta, datetime
from dateutil.relativedelta import relativedelta
from typing import Optional

from sqlalchemy.orm import Session
from sqlalchemy import and_

from app.models import (
    Trabajador,
    ContratoTrabajadorVersion,
    AnexoContrato,
    EventoContratoProgramado,
    TipoAnexoEnum,
    EstadoAnexoEnum,
    MotivoVersionContratoEnum,
    TipoEventoContratoEnum,
    EstadoEventoContratoEnum,
)
from app.services.contratos import obtener_version_vigente
from app.services.notificaciones import notificar_rrhh, notificar_trabajador
from app.services.pase_indefinido import preview_ajuste_cesantia, confirmar_pase_indefinido

logger = logging.getLogger(__name__)

MAX_RENOVACIONES_PLAZO_FIJO = 2   # a la 3ª → indefinido por ley


# ─────────────────────────────────────────────────────────────────────────────
#  Programación de eventos
# ─────────────────────────────────────────────────────────────────────────────

def programar_eventos_version(
    db: Session,
    version: ContratoTrabajadorVersion,
) -> list[EventoContratoProgramado]:
    """
    Crea (o actualiza) los 4 eventos de alerta/acción para una versión de plazo fijo.
    Solo aplica si version.tipo_contrato == 'PLAZO_FIJO' y tiene fecha_termino_periodo.
    Idempotente: usa UPSERT vía uq_evento_version_tipo.
    """
    if version.tipo_contrato != "PLAZO_FIJO" or not version.fecha_termino_periodo:
        return []

    fecha_t0 = version.fecha_termino_periodo
    eventos_def = [
        (TipoEventoContratoEnum.ALERTA_VENCIMIENTO_30D.value, fecha_t0 - timedelta(days=30)),
        (TipoEventoContratoEnum.ALERTA_VENCIMIENTO_15D.value, fecha_t0 - timedelta(days=15)),
        (TipoEventoContratoEnum.ALERTA_VENCIMIENTO_7D.value,  fecha_t0 - timedelta(days=7)),
        (TipoEventoContratoEnum.EJECUTAR_VENCIMIENTO.value,   fecha_t0),
    ]

    creados = []
    for tipo, ejecutar_en in eventos_def:
        # Idempotente: si ya existe, actualiza fecha (por si cambió el término)
        existing = db.query(EventoContratoProgramado).filter_by(
            version_id=version.id, tipo=tipo
        ).first()
        if existing:
            if existing.estado == EstadoEventoContratoEnum.PENDIENTE.value:
                existing.ejecutar_en = ejecutar_en
                existing.updated_at = datetime.utcnow()
            creados.append(existing)
        else:
            ev = EventoContratoProgramado(
                trabajador_id=version.trabajador_id,
                version_id=version.id,
                tipo=tipo,
                ejecutar_en=ejecutar_en,
                estado=EstadoEventoContratoEnum.PENDIENTE.value,
            )
            db.add(ev)
            creados.append(ev)

    db.flush()
    return creados


def cancelar_eventos_version(db: Session, version_id: int) -> int:
    """Marca CANCELADO todos los eventos PENDIENTE de una versión (al renovar/terminar manualmente)."""
    eventos = db.query(EventoContratoProgramado).filter(
        EventoContratoProgramado.version_id == version_id,
        EventoContratoProgramado.estado == EstadoEventoContratoEnum.PENDIENTE.value,
    ).all()
    for ev in eventos:
        ev.estado = EstadoEventoContratoEnum.CANCELADO.value
    db.flush()
    return len(eventos)


# ─────────────────────────────────────────────────────────────────────────────
#  Documento de término (solo PLAZO_FIJO)
# ─────────────────────────────────────────────────────────────────────────────

def crear_termino_contrato(
    db: Session,
    trabajador: Trabajador,
    version: ContratoTrabajadorVersion,
    fecha_efectiva: date,
    creado_por: str,
    notas: Optional[str] = None,
) -> AnexoContrato:
    """
    Crea el anexo TERMINO_CONTRATO para un contrato PLAZO_FIJO.
    Queda con estado EMITIDO y fecha_efectiva = fecha del vencimiento.
    El job T0 detectará este anexo y no generará renovación automática.
    """
    if version.tipo_contrato == "OBRA_FAENA":
        raise ValueError("Los contratos de obra/faena no usan este flujo de término")

    # Verificar que no exista ya uno
    existing = db.query(AnexoContrato).filter(
        AnexoContrato.trabajador_id == trabajador.id,
        AnexoContrato.version_id == version.id,
        AnexoContrato.tipo == TipoAnexoEnum.TERMINO_CONTRATO.value,
        AnexoContrato.estado.in_([EstadoAnexoEnum.EMITIDO.value, EstadoAnexoEnum.FIRMADO.value]),
    ).first()
    if existing:
        raise ValueError(f"Ya existe un documento de término para esta versión (id={existing.id})")

    anexo = AnexoContrato(
        trabajador_id=trabajador.id,
        version_id=version.id,
        tipo=TipoAnexoEnum.TERMINO_CONTRATO.value,
        titulo=f"Término de Contrato — {fecha_efectiva.strftime('%d/%m/%Y')}",
        requiere_firma_trabajador=False,
        estado=EstadoAnexoEnum.EMITIDO.value,
        fecha_efectiva=fecha_efectiva,
        creado_por=creado_por,
    )
    db.add(anexo)

    # Cancelar eventos T0 futuros si el término es antes del vencimiento
    cancelar_eventos_version(db, version.id)

    db.commit()
    db.refresh(anexo)
    return anexo


# ─────────────────────────────────────────────────────────────────────────────
#  Renovación manual (click explícito RRHH)
# ─────────────────────────────────────────────────────────────────────────────

def renovar_plazo_fijo(
    db: Session,
    trabajador: Trabajador,
    version_actual: ContratoTrabajadorVersion,
    creado_por: str,
    duracion_meses: Optional[int] = None,
    notas: Optional[str] = None,
) -> tuple[ContratoTrabajadorVersion, AnexoContrato]:
    """
    Renueva manualmente un plazo fijo.
    - Si numero_renovacion >= MAX_RENOVACIONES_PLAZO_FIJO → lanza ValueError (debe usarse pase_indefinido).
    - Crea nueva versión con mismo periodo y genera AnexoContrato RENOVACION_PLAZO_FIJO.
    """
    if version_actual.tipo_contrato != "PLAZO_FIJO":
        raise ValueError("Solo se pueden renovar contratos de plazo fijo")

    if version_actual.numero_renovacion >= MAX_RENOVACIONES_PLAZO_FIJO:
        raise ValueError(
            f"Este contrato ya fue renovado {version_actual.numero_renovacion} veces. "
            "La siguiente renovación debe ser conversión a indefinido (Ley)."
        )

    meses = duracion_meses or version_actual.duracion_meses or 3
    nuevo_inicio = (version_actual.fecha_termino_periodo or date.today()) + timedelta(days=1)
    nuevo_termino = nuevo_inicio + relativedelta(months=meses) - timedelta(days=1)

    # Cerrar versión actual
    version_actual.vigente_hasta = version_actual.fecha_termino_periodo or nuevo_inicio - timedelta(days=1)
    cancelar_eventos_version(db, version_actual.id)

    nueva_version = ContratoTrabajadorVersion(
        trabajador_id=trabajador.id,
        vigente_desde=nuevo_inicio,
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
        tipo_contrato="PLAZO_FIJO",
        motivo=MotivoVersionContratoEnum.RENOVACION.value,
        notas=notas,
        creado_por=creado_por,
        origen="MANUAL",
        numero_renovacion=version_actual.numero_renovacion + 1,
        version_padre_id=version_actual.id,
        fecha_inicio_periodo=nuevo_inicio,
        fecha_termino_periodo=nuevo_termino,
        duracion_meses=meses,
    )
    db.add(nueva_version)
    db.flush()

    # Programar nuevos eventos
    programar_eventos_version(db, nueva_version)

    anexo = AnexoContrato(
        trabajador_id=trabajador.id,
        version_id=nueva_version.id,
        tipo=TipoAnexoEnum.RENOVACION_PLAZO_FIJO.value,
        titulo=f"Renovación Plazo Fijo N°{nueva_version.numero_renovacion} — hasta {nuevo_termino.strftime('%d/%m/%Y')}",
        requiere_firma_trabajador=True,
        estado=EstadoAnexoEnum.EMITIDO.value,
        creado_por=creado_por,
    )
    db.add(anexo)

    db.commit()
    db.refresh(nueva_version)
    db.refresh(anexo)
    return nueva_version, anexo


# ─────────────────────────────────────────────────────────────────────────────
#  Job diario
# ─────────────────────────────────────────────────────────────────────────────

def ejecutar_job_contratos(db: Session, hoy: Optional[date] = None) -> dict:
    """
    Job idempotente que procesa EventoContratoProgramado con ejecutar_en <= hoy.
    Retorna resumen de acciones.
    """
    hoy = hoy or date.today()
    resumen = {"alertas_30d": 0, "alertas_15d": 0, "alertas_7d": 0, "t0_renovados": 0, "t0_indefinidos": 0, "t0_terminados": 0, "errores": []}

    eventos = db.query(EventoContratoProgramado).filter(
        EventoContratoProgramado.ejecutar_en <= hoy,
        EventoContratoProgramado.estado == EstadoEventoContratoEnum.PENDIENTE.value,
    ).order_by(EventoContratoProgramado.ejecutar_en).all()

    for ev in eventos:
        try:
            _procesar_evento(db, ev, hoy, resumen)
        except Exception as exc:
            logger.error("Error procesando evento %d: %s", ev.id, exc)
            resumen["errores"].append(f"evento_id={ev.id}: {exc}")
            db.rollback()

    return resumen


def _procesar_evento(db: Session, ev: EventoContratoProgramado, hoy: date, resumen: dict):
    version = db.get(ContratoTrabajadorVersion, ev.version_id)
    trabajador = db.get(Trabajador, ev.trabajador_id)
    if not version or not trabajador:
        ev.estado = EstadoEventoContratoEnum.CANCELADO.value
        ev.notas = "Versión o trabajador no encontrado"
        db.commit()
        return

    tipo = ev.tipo

    # ── Alertas informativas ─────────────────────────────────────────────────
    if tipo in (
        TipoEventoContratoEnum.ALERTA_VENCIMIENTO_30D.value,
        TipoEventoContratoEnum.ALERTA_VENCIMIENTO_15D.value,
        TipoEventoContratoEnum.ALERTA_VENCIMIENTO_7D.value,
    ):
        dias_map = {
            TipoEventoContratoEnum.ALERTA_VENCIMIENTO_30D.value: 30,
            TipoEventoContratoEnum.ALERTA_VENCIMIENTO_15D.value: 15,
            TipoEventoContratoEnum.ALERTA_VENCIMIENTO_7D.value: 7,
        }
        dias = dias_map[tipo]
        fecha_t = version.fecha_termino_periodo
        titulo = f"⚠️ Contrato de {trabajador.nombre} vence en {dias} días"
        mensaje = (
            f"El contrato a plazo fijo de {trabajador.nombre} vence el "
            f"{fecha_t.strftime('%d/%m/%Y')}. "
            f"Debes renovarlo, emitir término o convertir a indefinido antes de esa fecha."
        )
        notificar_rrhh(db, "contratos:ver_alertas_vencimiento", titulo, mensaje,
                       url_accion=f"/admin/rrhh/contratos/{trabajador.id}")
        key = f"alertas_{dias}d"
        resumen[key] = resumen.get(key, 0) + 1

        ev.estado = EstadoEventoContratoEnum.EJECUTADO.value
        ev.updated_at = datetime.utcnow()
        db.commit()
        return

    # ── T0: el día del vencimiento ────────────────────────────────────────────
    if tipo == TipoEventoContratoEnum.EJECUTAR_VENCIMIENTO.value:
        _ejecutar_t0(db, ev, version, trabajador, hoy, resumen)


def _ejecutar_t0(
    db: Session,
    ev: EventoContratoProgramado,
    version: ContratoTrabajadorVersion,
    trabajador: Trabajador,
    hoy: date,
    resumen: dict,
):
    """
    Lógica del día T0. Orden de prioridad:
    (a) Hay anexo TERMINO_CONTRATO emitido → terminar.
    (b) Hay anexo RENOVACION_PLAZO_FIJO aprobado por admin → ya está hecho (cancelar evento).
    (c) numero_renovacion >= MAX → convertir a indefinido automáticamente.
    (d) numero_renovacion < MAX → renovar automáticamente por mismo período.
    """
    # (a) ¿Hay documento de término?
    termino = db.query(AnexoContrato).filter(
        AnexoContrato.trabajador_id == trabajador.id,
        AnexoContrato.version_id == version.id,
        AnexoContrato.tipo == TipoAnexoEnum.TERMINO_CONTRATO.value,
        AnexoContrato.estado.in_([EstadoAnexoEnum.EMITIDO.value, EstadoAnexoEnum.FIRMADO.value]),
    ).first()
    if termino:
        ev.estado = EstadoEventoContratoEnum.EJECUTADO.value
        ev.notas = f"Término de contrato ya emitido (anexo_id={termino.id})"
        ev.resultado_anexo_id = termino.id
        ev.updated_at = datetime.utcnow()
        db.commit()
        resumen["t0_terminados"] += 1
        return

    # (b) ¿Ya se renovó manualmente (existe versión hija con fecha_inicio posterior)?
    version_renovada = db.query(ContratoTrabajadorVersion).filter(
        ContratoTrabajadorVersion.version_padre_id == version.id,
    ).first()
    if version_renovada:
        ev.estado = EstadoEventoContratoEnum.EJECUTADO.value
        ev.notas = f"Ya fue renovado manualmente (nueva versión id={version_renovada.id})"
        ev.updated_at = datetime.utcnow()
        db.commit()
        return

    # (c) o (d)
    if version.numero_renovacion >= MAX_RENOVACIONES_PLAZO_FIJO:
        # Conversión automática a indefinido
        try:
            preview = preview_ajuste_cesantia(db, trabajador, hoy)
            anexo_pase, anexo_ces = confirmar_pase_indefinido(
                db, trabajador, hoy,
                sueldo_base_nuevo=preview.sueldo_base_sugerido,
                creado_por="SISTEMA",
                notas=f"Conversión automática a indefinido por ley (3ª renovación superada). Art. 159 Nº 4 CT.",
            )
            ev.estado = EstadoEventoContratoEnum.EJECUTADO.value
            ev.notas = f"Conversión automática indefinido: pase={anexo_pase.id}, cesantia={anexo_ces.id}"
            ev.resultado_anexo_id = anexo_pase.id
            ev.updated_at = datetime.utcnow()
            db.commit()
            resumen["t0_indefinidos"] += 1
            notificar_rrhh(
                db, "contratos:ver_alertas_vencimiento",
                f"Contrato de {trabajador.nombre} convertido a indefinido automáticamente",
                f"Se superaron las 2 renovaciones permitidas. Se generaron los anexos de pase a indefinido "
                f"y ajuste de cesantía. Verificar y notificar al trabajador.",
                url_accion=f"/admin/rrhh/contratos/{trabajador.id}",
            )
        except Exception as exc:
            logger.error("Error en conversión automática indefinido trabajador %d: %s", trabajador.id, exc)
            resumen["errores"].append(f"conversion_indefinido trab={trabajador.id}: {exc}")
    else:
        # Renovación automática
        try:
            nueva_version, anexo_ren = renovar_plazo_fijo(
                db, trabajador, version, creado_por="SISTEMA",
                notas="Renovación automática por vencimiento sin acción admin.",
            )
            ev.estado = EstadoEventoContratoEnum.EJECUTADO.value
            ev.notas = f"Renovación automática: nueva_version={nueva_version.id}, anexo={anexo_ren.id}"
            ev.resultado_anexo_id = anexo_ren.id
            ev.updated_at = datetime.utcnow()
            db.commit()
            resumen["t0_renovados"] += 1
            notificar_rrhh(
                db, "contratos:ver_alertas_vencimiento",
                f"Contrato de {trabajador.nombre} renovado automáticamente",
                f"Renovación N°{nueva_version.numero_renovacion} generada automáticamente. "
                f"Revisar y hacer firmar el anexo al trabajador.",
                url_accion=f"/admin/rrhh/contratos/{trabajador.id}",
            )
        except Exception as exc:
            logger.error("Error en renovación automática trabajador %d: %s", trabajador.id, exc)
            resumen["errores"].append(f"renovacion_auto trab={trabajador.id}: {exc}")
