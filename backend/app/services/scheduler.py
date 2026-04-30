"""
Scheduler interno basado en APScheduler.

Diseño:
- Un único `BackgroundScheduler` por proceso (worker uvicorn).
- En arranque, lee `cron_jobs` (activos) y registra triggers diarios en la hora indicada.
- Cada job, cuando dispara, intenta tomar un *advisory lock* de Postgres
  con la clave (job_key). Solo el worker que obtiene el lock ejecuta el handler.
  Los demás salen silenciosamente. Esto evita duplicar la ingesta cuando hay
  varios workers de uvicorn.
- Cada ejecución se registra en `cron_ejecuciones` y resume en `cron_jobs`.
- Los handlers están desacoplados via `JOB_HANDLERS`: un handler es una
  función `(db, job_config, ejecucion_id) -> dict` que devuelve el resultado.

API pública:
- `start_scheduler()`        : llamar en startup de FastAPI
- `shutdown_scheduler()`     : llamar en shutdown
- `reload_jobs()`            : re-sincroniza los jobs desde BD (luego de editar)
- `register_handler(key, fn)`: registra un handler para un job_key
- `run_job_now(job_key, usuario)` : encola la ejecución inmediata (background)
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime
from typing import Callable, Optional

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import SessionLocal, engine
from app.models import CronEjecucion, CronJob

logger = logging.getLogger(__name__)


# ── Registro de handlers por job_key ──────────────────────────────────────────
# Cada handler recibe (db, job_config_dict, ejecucion_id) y devuelve un dict
# con el resultado (que se serializa a JSON en cron_ejecuciones.resultado).
JobHandler = Callable[[Session, dict, int], dict]
JOB_HANDLERS: dict[str, JobHandler] = {}


def register_handler(job_key: str, handler: JobHandler) -> None:
    JOB_HANDLERS[job_key] = handler
    logger.info("[scheduler] handler registrado: %s", job_key)


# ── Singleton del scheduler ───────────────────────────────────────────────────
_scheduler: Optional[BackgroundScheduler] = None
_scheduler_lock = threading.Lock()


def _get_scheduler() -> BackgroundScheduler:
    global _scheduler
    if _scheduler is None:
        with _scheduler_lock:
            if _scheduler is None:
                _scheduler = BackgroundScheduler(
                    timezone="America/Santiago",
                    job_defaults={
                        "coalesce": True,         # si se acumulan ejecuciones, ejecutar solo una
                        "max_instances": 1,       # no ejecutar el mismo job en paralelo en el mismo worker
                        "misfire_grace_time": 60 * 30,  # 30 min
                    },
                )
    return _scheduler


# ── Advisory lock helper (Postgres) ───────────────────────────────────────────
def _lock_key(job_key: str) -> int:
    """Convierte el job_key en un BIGINT estable para pg_advisory_lock.

    Usa hash python (variable entre procesos) NO sirve. Usamos un hash determinista.
    """
    # FNV-1a 64-bit determinista
    h = 0xcbf29ce484222325
    for ch in job_key.encode("utf-8"):
        h ^= ch
        h = (h * 0x100000001b3) & 0xFFFFFFFFFFFFFFFF
    # Postgres bigint con signo
    if h >= 2 ** 63:
        h -= 2 ** 64
    return h


def _try_advisory_lock(job_key: str) -> Optional[object]:
    """Intenta tomar un lock no bloqueante. Devuelve la conexión (que retiene
    el lock) si lo obtuvo, o None si otro worker ya lo tiene.

    Importante: la conexión se debe cerrar al finalizar la ejecución (con eso
    se libera el lock automáticamente).
    """
    if not engine.url.get_backend_name().startswith("postgres"):
        return object()  # en sqlite/dev no hay multi-worker real
    conn = engine.raw_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT pg_try_advisory_lock(%s)", (_lock_key(job_key),))
        ok = cur.fetchone()[0]
        cur.close()
        if not ok:
            conn.close()
            return None
        return conn
    except Exception:
        try:
            conn.close()
        except Exception:
            pass
        raise


def _release_advisory_lock(conn_obj) -> None:
    if conn_obj is None:
        return
    try:
        if not engine.url.get_backend_name().startswith("postgres"):
            return
        # Explicitly release the advisory lock before returning connection to pool.
        # conn.close() only returns the connection to the pool (session stays alive),
        # so the advisory lock would persist indefinitely in the pooled connection.
        cur = conn_obj.cursor()
        cur.execute("SELECT pg_advisory_unlock_all()")
        cur.close()
        conn_obj.close()
    except Exception:
        pass


# ── Ejecución de un job ───────────────────────────────────────────────────────
def _run_job(job_key: str, *, disparado_por: str = "scheduler", usuario: Optional[dict] = None) -> None:
    """Ejecuta un job (con lock) y persiste la ejecución."""
    handler = JOB_HANDLERS.get(job_key)
    if not handler:
        logger.warning("[scheduler] sin handler para job_key=%s", job_key)
        return

    lock = _try_advisory_lock(job_key)
    if lock is None:
        logger.info("[scheduler] job %s saltado: otro worker tiene el lock", job_key)
        return

    db: Session = SessionLocal()
    ejecucion: Optional[CronEjecucion] = None
    cron_job: Optional[CronJob] = None
    iniciado = time.monotonic()
    try:
        cron_job = db.query(CronJob).filter(CronJob.job_key == job_key).first()
        if not cron_job:
            logger.warning("[scheduler] job %s no existe en BD", job_key)
            return

        ejecucion = CronEjecucion(
            cron_job_id=cron_job.id,
            job_key=job_key,
            estado="running",
            disparado_por=disparado_por,
            disparado_por_usuario=(usuario or {}).get("nombre") if usuario else None,
        )
        db.add(ejecucion)
        db.commit()
        db.refresh(ejecucion)

        config = cron_job.config or {}
        resultado = handler(db, config, ejecucion.id) or {}

        duracion = round(time.monotonic() - iniciado, 2)
        ejecucion.finalizado_at = datetime.utcnow()
        ejecucion.duracion_s = duracion
        ejecucion.estado = "ok"
        ejecucion.resultado = resultado
        ejecucion.mensaje = resultado.get("mensaje") if isinstance(resultado, dict) else None

        cron_job.ultima_ejecucion_at = ejecucion.iniciado_at
        cron_job.ultima_ejecucion_estado = "ok"
        cron_job.ultima_ejecucion_resultado = resultado
        cron_job.ultima_ejecucion_mensaje = ejecucion.mensaje
        cron_job.ultima_ejecucion_duracion_s = duracion
        db.commit()
        logger.info("[scheduler] job %s OK (%.2fs)", job_key, duracion)

    except Exception as exc:  # noqa: BLE001
        logger.exception("[scheduler] job %s FAILED", job_key)
        try:
            db.rollback()
            duracion = round(time.monotonic() - iniciado, 2)
            if ejecucion is not None:
                ejecucion.finalizado_at = datetime.utcnow()
                ejecucion.duracion_s = duracion
                ejecucion.estado = "error"
                ejecucion.mensaje = str(exc)[:1000]
                db.commit()
            if cron_job is not None:
                cron_job.ultima_ejecucion_at = datetime.utcnow()
                cron_job.ultima_ejecucion_estado = "error"
                cron_job.ultima_ejecucion_mensaje = str(exc)[:1000]
                cron_job.ultima_ejecucion_duracion_s = duracion
                db.commit()
        except Exception:
            db.rollback()
    finally:
        try:
            db.close()
        finally:
            _release_advisory_lock(lock)


# ── Sincronización de jobs ────────────────────────────────────────────────────
def _parse_hhmm(hhmm: str) -> tuple[int, int]:
    try:
        h, m = (hhmm or "03:00").split(":")
        return max(0, min(23, int(h))), max(0, min(59, int(m)))
    except Exception:
        return 3, 0


def _job_id(job_key: str) -> str:
    return f"cronjob::{job_key}"


def reload_jobs() -> dict:
    """Re-lee la tabla cron_jobs y resyncroniza los triggers.

    - Job activo en BD pero no en scheduler → agregar
    - Job activo con hora distinta → reprogramar
    - Job en scheduler pero no activo en BD → quitar
    - Persiste proxima_ejecucion_at en cron_jobs
    """
    sched = _get_scheduler()
    if not sched.running:
        return {"jobs_registrados": 0, "running": False}

    db: Session = SessionLocal()
    registrados = 0
    try:
        jobs = db.query(CronJob).all()
        existentes = {j.id for j in sched.get_jobs()}
        deseados: set[str] = set()

        for cj in jobs:
            jid = _job_id(cj.job_key)
            if cj.activo:
                deseados.add(jid)
                hh, mm = _parse_hhmm(cj.hora_ejecucion)
                trigger = CronTrigger(hour=hh, minute=mm, timezone="America/Santiago")
                sched.add_job(
                    _run_job,
                    trigger=trigger,
                    id=jid,
                    name=cj.nombre,
                    replace_existing=True,
                    kwargs={"job_key": cj.job_key, "disparado_por": "scheduler"},
                )
                registrados += 1
                # actualizar proxima ejecucion
                sj = sched.get_job(jid)
                cj.proxima_ejecucion_at = sj.next_run_time.replace(tzinfo=None) if sj and sj.next_run_time else None
            else:
                if jid in existentes:
                    sched.remove_job(jid)
                cj.proxima_ejecucion_at = None
        db.commit()
    finally:
        db.close()
    return {"jobs_registrados": registrados}


def run_job_now(job_key: str, usuario: Optional[dict] = None) -> None:
    """Encola una ejecución inmediata del job (en hilo de fondo)."""
    th = threading.Thread(
        target=_run_job,
        kwargs={"job_key": job_key, "disparado_por": "manual", "usuario": usuario},
        daemon=True,
    )
    th.start()


# ── Lifecycle ─────────────────────────────────────────────────────────────────
def start_scheduler() -> None:
    sched = _get_scheduler()
    if not sched.running:
        try:
            sched.start()
            logger.info("[scheduler] APScheduler iniciado")
        except Exception:
            logger.exception("[scheduler] no se pudo iniciar APScheduler")
            return
    try:
        reload_jobs()
    except Exception:
        logger.exception("[scheduler] no se pudieron cargar los jobs desde BD")


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        try:
            _scheduler.shutdown(wait=False)
        except Exception:
            pass
    _scheduler = None
