#!/usr/bin/env python3
"""
Proceso dedicado para cron jobs (APScheduler).

Un solo proceso evita:
- Múltiples schedulers compitiendo por pg_try_advisory_lock
- Hilos daemon de run_job_now que no alcanzan a persistir en docker exec
- Disparos duplicados / corridas “perdidas” entre workers de uvicorn

En producción: desactivar el scheduler embebido en uvicorn (DISABLE_EMBEDDED_SCHEDULER=1)
y levantar este script como servicio aparte (p. ej. contenedor ecourier-scheduler).
"""
from __future__ import annotations

import logging
import os
import signal
import threading

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("run_scheduler")


def main() -> None:
    os.environ.setdefault("DISABLE_EMBEDDED_SCHEDULER", "1")

    from app.database import SessionLocal
    from app.services.cron_handlers import register_all_handlers, seed_default_cron_jobs
    from app.services.scheduler import shutdown_scheduler, start_scheduler

    register_all_handlers()
    db = SessionLocal()
    try:
        seed_default_cron_jobs(db)
    finally:
        db.close()

    start_scheduler()
    logger.info("[run_scheduler] APScheduler activo; esperando señal de apagado…")

    stop = threading.Event()

    def handle_signal(signum: int, _frame) -> None:
        logger.info("[run_scheduler] señal %s recibida, deteniendo scheduler…", signum)
        stop.set()

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    stop.wait()
    shutdown_scheduler()
    logger.info("[run_scheduler] terminado")


if __name__ == "__main__":
    main()
