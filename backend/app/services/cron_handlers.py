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

# Lazy import to avoid circular dependency — called only at runtime
def _clear_analytics_cache():
    try:
        from app.api.dashboard import analytics_cache_clear
        analytics_cache_clear()
    except Exception:
        pass

logger = logging.getLogger(__name__)


# ── Job keys (constantes) ─────────────────────────────────────────────────────
JOB_INGESTA_RUTAS       = "ingesta_rutas_courier"      # 03:00 — ventana amplia
JOB_INGESTA_RUTAS_19H   = "ingesta_rutas_19h"          # 19:00 — snapshot en ruta
JOB_INGESTA_RUTAS_00H   = "ingesta_rutas_00h"          # 00:00 — cierre del día
JOB_RECONCILIAR_PENDIENTES = "reconciliar_asignaciones_pendientes"
JOB_CICLO_CONTRATOS = "ciclo_contratos_laborales"


# ── Handler: ingesta diaria de rutas/asignaciones ─────────────────────────────
def handler_ingesta_rutas(db: Session, config: dict, ejecucion_id: int) -> dict:
    """Llama al endpoint del courier y persiste asignaciones.

    Config esperada:
      - dias_atras (int, default 1): cuántos días hacia atrás retroceder desde hoy
        para calcular fecha_fin del rango de withdrawal_date.
      - rango_dias (int, default 1): tamaño de la ventana en días.
        Por ejemplo dias_atras=1, rango_dias=15 → los últimos 15 días hasta ayer.
      - lookback_extra (int, default 0): días adicionales hacia atrás para
        reintentar reconciliación (útil cuando la ingesta de envíos llega tarde).
      - solo_route_date_hoy (bool, default False): si es True, de todos los
        registros descargados solo se procesan los que tengan route_date = hoy.
        Usar para los crons de 19:00 y 23:50: se descarga ventana amplia para
        capturar paquetes con withdrawal_date antiguo que van en la ruta del día,
        pero solo se actualiza la data del día operativo activo.
    """
    dias_atras = int(config.get("dias_atras", 1))
    rango_dias = max(1, int(config.get("rango_dias", 1)))
    lookback_extra = max(0, int(config.get("lookback_extra", 0)))
    solo_route_date_hoy = bool(config.get("solo_route_date_hoy", False))

    fecha_fin = date.today() - timedelta(days=dias_atras)
    fecha_inicio = fecha_fin - timedelta(days=rango_dias - 1)
    fmt = lambda d: d.strftime("%Y-%m-%d")

    route_date_filter = date.today() if solo_route_date_hoy else None

    resultado = rutas_entregas.ingestar_rutas(
        db, fmt(fecha_inicio), fmt(fecha_fin),
        route_date_filter=route_date_filter,
    )

    if lookback_extra > 0:
        try:
            extra = rutas_entregas.reconciliar_pendientes(
                db, fecha_desde=fecha_inicio - timedelta(days=lookback_extra)
            )
            resultado["reconciliacion_extra"] = extra
        except Exception:
            logger.exception("Error en reconciliacion_extra del cron de rutas")

    _clear_analytics_cache()
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


# ── Handler: ciclo de vida de contratos laborales ─────────────────────────────
def handler_ciclo_contratos(db: Session, config: dict, ejecucion_id: int) -> dict:
    """
    Ejecuta el job diario de contratos laborales:
      - Envía alertas T-30 / T-15 / T-7 a RRHH sobre contratos próximos a vencer.
      - En T0 (día del vencimiento): según la situación del contrato,
        emite término, renueva automáticamente o convierte a indefinido por ley.

    Solo aplica a contratos PLAZO_FIJO con fecha_termino_periodo registrada.
    Idempotente: cada evento queda marcado EJECUTADO y no se reprocesa.
    """
    from app.services.ciclo_contratos import ejecutar_job_contratos
    resumen = ejecutar_job_contratos(db)
    logger.info("[ciclo_contratos] resultado: %s", resumen)
    return resumen


# ── Registro central ──────────────────────────────────────────────────────────
def register_all_handlers() -> None:
    # Los tres jobs de ingesta de rutas usan el mismo handler; la config en BD
    # define qué ventana de fechas consulta cada uno.
    register_handler(JOB_INGESTA_RUTAS,     handler_ingesta_rutas)
    register_handler(JOB_INGESTA_RUTAS_19H, handler_ingesta_rutas)
    register_handler(JOB_INGESTA_RUTAS_00H, handler_ingesta_rutas)
    register_handler(JOB_RECONCILIAR_PENDIENTES, handler_reconciliar_pendientes)
    register_handler(JOB_CICLO_CONTRATOS, handler_ciclo_contratos)


# ── Seed de cron jobs por defecto ─────────────────────────────────────────────
DEFAULT_JOBS = [
    # ── Ingesta rutas 03:00 — ventana amplia (15 días) ──────────────────────
    # Corre de madrugada. Consulta los últimos 15 días de created_at para capturar
    # paquetes creados hace tiempo pero retirados recientemente. Es el cron
    # "recuperador" que garantiza cobertura completa.
    {
        "job_key": JOB_INGESTA_RUTAS,
        "nombre": "Ingesta rutas — ventana amplia (03:00)",
        "descripcion": (
            "Ventana de 15 días (created_at). Captura paquetes con withdrawal_date "
            "tardío y re-reconcilia pendientes. Garantiza cobertura completa."
        ),
        "activo": True,
        "hora_ejecucion": "03:00",
        "config": {"dias_atras": 1, "rango_dias": 15, "lookback_extra": 5},
    },
    # ── Ingesta rutas 19:00 — snapshot en ruta ───────────────────────────────
    # Ventana de 15 días pero SOLO procesa paquetes con route_date = hoy.
    # Garantiza que paquetes con withdrawal_date antiguo (retirados de bodega
    # días atrás) que van en la ruta de HOY queden correctamente asociados al
    # conductor del día. Sin este filtro, el denominador del conductor sería
    # incompleto al hacer el cron con ventana corta.
    {
        "job_key": JOB_INGESTA_RUTAS_19H,
        "nombre": "Ingesta rutas — snapshot en ruta (19:00)",
        "descripcion": (
            "Ventana amplia (15 días) filtrando solo route_date=hoy. "
            "Captura paquetes con withdrawal_date antiguo que van en la ruta del día. "
            "Registra denominador exacto del conductor mientras está activo."
        ),
        "activo": True,
        "hora_ejecucion": "19:00",
        "config": {"dias_atras": 0, "rango_dias": 15, "solo_route_date_hoy": True},
    },
    # ── Ingesta rutas 23:50 — cierre del día ────────────────────────────────
    # Igual que el de 19:00 pero captura el estado final antes de medianoche:
    # entregados, fallidos, cancelados con route_date = hoy.
    # Se usa 23:50 (no 00:00) para que date.today() siga siendo el día operativo.
    {
        "job_key": JOB_INGESTA_RUTAS_00H,
        "nombre": "Ingesta rutas — cierre del día (23:50)",
        "descripcion": (
            "Ventana amplia (15 días) filtrando solo route_date=hoy. "
            "Captura el estado final (entregado/fallido/cancelado) antes de medianoche."
        ),
        "activo": True,
        "hora_ejecucion": "23:50",
        "config": {"dias_atras": 0, "rango_dias": 15, "solo_route_date_hoy": True},
    },
    # ── Reconciliación de pendientes (04:00) ─────────────────────────────────
    {
        "job_key": JOB_RECONCILIAR_PENDIENTES,
        "nombre": "Reconciliar asignaciones pendientes",
        "descripcion": (
            "Vuelve a vincular asignaciones sin envío local (espera a que llegue la ingesta "
            "diaria de envíos) y recalcula su estado."
        ),
        "activo": True,
        "hora_ejecucion": "04:00",
        "config": {"dias_atras": 7, "limite": 5000},
    },
    # ── Ciclo contratos (06:00) ───────────────────────────────────────────────
    {
        "job_key": JOB_CICLO_CONTRATOS,
        "nombre": "Ciclo de vida contratos laborales",
        "descripcion": (
            "Envía alertas a RRHH cuando un contrato a plazo fijo está próximo a vencer "
            "(T-30, T-15, T-7) y ejecuta las acciones del día T0 (término, renovación o "
            "conversión automática a indefinido según la ley)."
        ),
        "activo": True,
        "hora_ejecucion": "06:00",
        "config": {},
    },
]


def seed_default_cron_jobs(db: Session) -> None:
    """Crea o actualiza las filas de cron_jobs según DEFAULT_JOBS. Idempotente."""
    from app.models import CronJob
    for spec in DEFAULT_JOBS:
        existe = db.query(CronJob).filter(CronJob.job_key == spec["job_key"]).first()
        if existe:
            # Actualizar config y hora si cambiaron (no toca activo para no pisar
            # cambios manuales hechos desde la UI, salvo que nunca haya sido activado).
            existe.nombre = spec["nombre"]
            existe.descripcion = spec["descripcion"]
            existe.hora_ejecucion = spec["hora_ejecucion"]
            existe.config = spec["config"]
            # Activar si el spec lo requiere y el job nunca se activó manualmente
            if spec.get("activo") and not existe.activo:
                existe.activo = True
        else:
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
