"""
API administrativa para backfill de hora_entrega y fecha_ruta en envíos históricos.
Solo ADMIN.
"""
from __future__ import annotations

import os
import shutil
import threading
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.auth import require_admin
from app.database import SessionLocal
from app.services.backfill_hora import backfill_hora_entrega
from app.services.backfill_fecha_ruta import backfill_fecha_ruta
from app.services.task_progress import cleanup_old_tasks, create_task, get_task
from app.config import get_settings

router = APIRouter(prefix="/envios/hora", tags=["Envíos · Hora Entrega"])


def _run_backfill_background(task_id: str, filepath: str):
    db = SessionLocal()
    try:
        stats = backfill_hora_entrega(db, filepath, task_id=task_id)
        from app.services.task_progress import update_task
        update_task(task_id, estado="ok", resultado=stats,
                    mensaje=f"Completado: {stats['actualizados']} actualizados de {stats['pares_validos']} válidos")
    except Exception as e:
        from app.services.task_progress import update_task
        update_task(task_id, estado="error", mensaje=str(e))
    finally:
        db.close()
        try:
            os.remove(filepath)
        except Exception:
            pass


@router.post("/backfill")
async def backfill_hora(
    archivo: UploadFile = File(..., description="Excel o CSV con columnas 'Tracking ID' y 'Hora Entrega'"),
    _=Depends(require_admin),
):
    """Sube un archivo y actualiza hora_entrega en todos los envíos que hagan match por tracking_id."""
    if not archivo.filename or not archivo.filename.endswith((".xlsx", ".xls", ".csv")):
        raise HTTPException(status_code=400, detail="Solo se aceptan archivos .xlsx, .xls o .csv")

    settings = get_settings()
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    safe_name = f"hora_backfill_{uuid.uuid4().hex[:8]}_{os.path.basename(archivo.filename)}"
    filepath = os.path.join(settings.UPLOAD_DIR, safe_name)
    with open(filepath, "wb") as f:
        shutil.copyfileobj(archivo.file, f)

    task_id = str(uuid.uuid4())[:12]
    create_task(task_id, total=0, archivo=safe_name)
    cleanup_old_tasks()

    thread = threading.Thread(
        target=_run_backfill_background,
        args=(task_id, filepath),
        daemon=True,
    )
    thread.start()

    return {"task_id": task_id, "message": "Backfill de hora iniciado"}


@router.get("/backfill/progress/{task_id}")
def progreso_backfill(task_id: str, _=Depends(require_admin)):
    task = get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Tarea no encontrada")
    return task


@router.get("/cobertura")
def cobertura_hora(_=Depends(require_admin)):
    """Cuántos envíos tienen hora_entrega y cuántos no."""
    from app.database import SessionLocal
    from sqlalchemy import text
    db = SessionLocal()
    try:
        r = db.execute(text("""
            SELECT
                COUNT(*) total,
                COUNT(hora_entrega) con_hora,
                ROUND(100.0 * COUNT(hora_entrega) / NULLIF(COUNT(*), 0), 1) pct
            FROM envios
        """)).fetchone()
        return {"total": r.total, "con_hora": r.con_hora, "pct_cobertura": float(r.pct or 0)}
    finally:
        db.close()


# ── Backfill fecha_ruta ───────────────────────────────────────────────────────

def _run_fecha_ruta_background(task_id: str, filepath: str):
    db = SessionLocal()
    try:
        stats = backfill_fecha_ruta(db, filepath, task_id=task_id)
        from app.services.task_progress import update_task
        update_task(task_id, estado="ok", resultado=stats,
                    mensaje=f"Completado: {stats['actualizados']} actualizados de {stats['pares_validos']} válidos")
    except Exception as e:
        from app.services.task_progress import update_task
        update_task(task_id, estado="error", mensaje=str(e))
    finally:
        db.close()
        try:
            os.remove(filepath)
        except Exception:
            pass


@router.post("/fecha-ruta/backfill")
async def backfill_ruta(
    archivo: UploadFile = File(..., description="Excel o CSV con columnas 'Tracking ID' y 'Ruta Fecha'"),
    _=Depends(require_admin),
):
    """Sube un archivo y actualiza fecha_ruta (y opcionalmente ruta_id) en todos los envíos que hagan match."""
    if not archivo.filename or not archivo.filename.endswith((".xlsx", ".xls", ".csv")):
        raise HTTPException(status_code=400, detail="Solo se aceptan archivos .xlsx, .xls o .csv")

    settings = get_settings()
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    safe_name = f"ruta_backfill_{uuid.uuid4().hex[:8]}_{os.path.basename(archivo.filename)}"
    filepath = os.path.join(settings.UPLOAD_DIR, safe_name)
    with open(filepath, "wb") as f:
        shutil.copyfileobj(archivo.file, f)

    task_id = str(uuid.uuid4())[:12]
    create_task(task_id, total=0, archivo=safe_name)
    cleanup_old_tasks()

    thread = threading.Thread(
        target=_run_fecha_ruta_background,
        args=(task_id, filepath),
        daemon=True,
    )
    thread.start()

    return {"task_id": task_id, "message": "Backfill de fecha_ruta iniciado"}


@router.get("/fecha-ruta/backfill/progress/{task_id}")
def progreso_backfill_ruta(task_id: str, _=Depends(require_admin)):
    task = get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Tarea no encontrada")
    return task


@router.get("/fecha-ruta/cobertura")
def cobertura_fecha_ruta(_=Depends(require_admin)):
    """Cuántos envíos tienen fecha_ruta y cuántos no."""
    from app.database import SessionLocal
    from sqlalchemy import text
    db = SessionLocal()
    try:
        r = db.execute(text("""
            SELECT
                COUNT(*) total,
                COUNT(fecha_ruta) con_fecha_ruta,
                ROUND(100.0 * COUNT(fecha_ruta) / NULLIF(COUNT(*), 0), 1) pct
            FROM envios
        """)).fetchone()
        return {"total": r.total, "con_fecha_ruta": r.con_fecha_ruta, "pct_cobertura": float(r.pct or 0)}
    finally:
        db.close()
