"""
Handlers concretos para los cron jobs.

Cada handler:
- Recibe (db: Session, config: dict, ejecucion_id: int)
- Devuelve un dict con el resultado (se persiste en cron_ejecuciones.resultado)

Para registrar un nuevo job:
  1) Crear un handler aquí
  2) Llamarlo desde `register_all_handlers()` con `register_handler(...)`
  3) Asegurarse que existe una fila en cron_jobs con el job_key correspondiente
     (se siembra desde `seed_default_cron_jobs`)
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.services import rutas_entregas
from app.services.scheduler import register_handler

logger = logging.getLogger(__name__)


# ── Job keys (constantes) ─────────────────────────────────────────────────────
JOB_INGESTA_RUTAS = "ingesta_rutas_courier"
JOB_RECONCILIAR_PENDIENTES = "reconciliar_asignaciones_pendientes"


# ── Handler: ingesta diaria de rutas/asignaciones ─────────────────────────────
def handler_ingesta_rutas(db: Session, config: dict, ejecucion_id: int) -> dict:
    """Llama al endpoint del courier y persiste asignaciones.

    Config esperada:
      - dias_atras (int, default 1): cuántos días hacia atrás procesar
        (la corrida de hoy 03:00 procesa los datos del día anterior).
      - rango_dias (int, default 1): tamaño de la ventana en días.
        Por ejemplo dias_atras=1, rango_dias=1 → solo el día de ayer.
      - lookback_extra (int, default 0): días adicionales hacia atrás para
        reintentar reconciliación (útil cuando la ingesta de envíos llega tarde).
    """
    dias_atras = int(config.get("dias_atras", 1))
    rango_dias = max(1, int(config.get("rango_dias", 1)))
    lookback_extra = max(0, int(config.get("lookback_extra", 0)))

    fecha_fin = date.today() - timedelta(days=dias_atras)
    fecha_inicio = fecha_fin - timedelta(days=rango_dias - 1)
    fmt = lambda d: d.strftime("%Y-%m-%d")

    resultado = rutas_entregas.ingestar_rutas(db, fmt(fecha_inicio), fmt(fecha_fin))

    if lookback_extra > 0:
        try:
            extra = rutas_entregas.reconciliar_pendientes(
                db, fecha_desde=fecha_inicio - timedelta(days=lookback_extra)
            )
            resultado["reconciliacion_extra"] = extra
        except Exception:
            logger.exception("Error en reconciliacion_extra del cron de rutas")

    return resultado


# ── Handler: reconciliación de pendientes (cron de mantenimiento) ─────────────
def handler_reconciliar_pendientes(db: Session, config: dict, ejecucion_id: int) -> dict:
    """Recorre asignaciones sin envio_id o en estado sin_entrega e intenta enlazarlas.

    Config esperada:
      - dias_atras (int, default 7): cuántos días hacia atrás revisar
      - limite (int, default 5000): tope de filas por corrida
    """
    dias = int(config.get("dias_atras", 7))
    limite = int(config.get("limite", 5000))
    fecha_desde = date.today() - timedelta(days=dias)
    return rutas_entregas.reconciliar_pendientes(db, fecha_desde=fecha_desde, limite=limite)


# ── Registro central ──────────────────────────────────────────────────────────
def register_all_handlers() -> None:
    register_handler(JOB_INGESTA_RUTAS, handler_ingesta_rutas)
    register_handler(JOB_RECONCILIAR_PENDIENTES, handler_reconciliar_pendientes)


# ── Seed de cron jobs por defecto ─────────────────────────────────────────────
DEFAULT_JOBS = [
    {
        "job_key": JOB_INGESTA_RUTAS,
        "nombre": "Ingesta de rutas (courier)",
        "descripcion": (
            "Descarga del endpoint del courier las asignaciones de ruta del día anterior "
            "(denominador para efectividad de entregas)."
        ),
        "activo": False,  # se activa cuando el endpoint del dev esté disponible
        "hora_ejecucion": "03:00",
        "config": {"dias_atras": 1, "rango_dias": 1, "lookback_extra": 0},
    },
    {
        "job_key": JOB_RECONCILIAR_PENDIENTES,
        "nombre": "Reconciliar asignaciones pendientes",
        "descripcion": (
            "Vuelve a vincular asignaciones sin envío local (espera a que llegue la ingesta "
            "diaria de envíos) y recalcula su estado."
        ),
        "activo": False,
        "hora_ejecucion": "04:00",
        "config": {"dias_atras": 7, "limite": 5000},
    },
]


def seed_default_cron_jobs(db: Session) -> None:
    """Crea las filas de cron_jobs si no existen. Idempotente."""
    from app.models import CronJob
    for spec in DEFAULT_JOBS:
        existe = db.query(CronJob).filter(CronJob.job_key == spec["job_key"]).first()
        if existe:
            continue
        cj = CronJob(
            job_key=spec["job_key"],
            nombre=spec["nombre"],
            descripcion=spec["descripcion"],
            activo=spec["activo"],
            hora_ejecucion=spec["hora_ejecucion"],
            config=spec["config"],
        )
        db.add(cj)
    db.commit()
