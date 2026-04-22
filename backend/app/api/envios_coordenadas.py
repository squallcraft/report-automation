"""
API administrativa para mantenimiento de coordenadas geográficas (lat/lon)
de envíos. Solo ADMIN.

Caso de uso principal:
- Backfill one-shot: subir Excel/CSV con (Tracking ID, Lat, Lon) para
  enriquecer envíos históricos.

La ingesta diaria de envíos (CSV recurrente) detecta automáticamente
columnas lat/lon a través de `coordenadas.extraer_coords_de_fila`.
"""
from __future__ import annotations

import threading
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile

from app.auth import require_admin
from app.database import SessionLocal
from app.services import coordenadas
from app.services.audit import registrar as audit
from app.services.task_progress import cleanup_old_tasks, create_task, get_task

router = APIRouter(prefix="/envios/coordenadas", tags=["Envíos · Coordenadas"])


def _run_backfill_background(
    task_id: str,
    filas: list[dict],
    sobreescribir: bool,
    usuario_dict: dict,
    archivo_nombre: str,
):
    db = SessionLocal()
    try:
        resultado = coordenadas.backfill_coordenadas(
            db, filas, sobreescribir=sobreescribir, task_id=task_id
        )
        try:
            audit(
                db,
                accion="envios_backfill_coordenadas",
                usuario=usuario_dict,
                entidad="envios",
                metadata={
                    "archivo": archivo_nombre,
                    "task_id": task_id,
                    "sobreescribir": sobreescribir,
                    "resultado": resultado,
                },
            )
        except Exception:
            pass
    except Exception as e:  # noqa: BLE001
        import traceback
        traceback.print_exc()
        from app.services.task_progress import update_task as _ut
        _ut(task_id, status="error", message=f"Error fatal: {e}")
    finally:
        db.close()


@router.post("/backfill", response_model=dict)
async def backfill(
    request: Request,
    archivo: UploadFile = File(..., description="Excel o CSV con columnas tracking_id, lat, lon"),
    sobreescribir: bool = Query(False, description="Si true, pisa coords previas"),
    usuario: dict = Depends(require_admin),
):
    """Sube un archivo con coordenadas y lanza un UPDATE masivo en background.

    Devuelve `{ task_id }` para hacer polling en
    `GET /envios/coordenadas/backfill/progress/{task_id}`.
    """
    contenido = await archivo.read()
    if not contenido:
        raise HTTPException(400, "Archivo vacío")

    filas, error = coordenadas.parse_archivo_coordenadas(contenido, archivo.filename or "")
    if error:
        raise HTTPException(400, error)
    if not filas:
        raise HTTPException(400, "El archivo no contiene filas válidas")

    cleanup_old_tasks()
    task_id = uuid.uuid4().hex
    create_task(task_id, total=len(filas), archivo=archivo.filename or "coordenadas")

    usuario_dict = {
        "id": usuario.get("id"),
        "nombre": usuario.get("nombre"),
        "rol": str(usuario.get("rol", "")),
    }
    threading.Thread(
        target=_run_backfill_background,
        args=(task_id, filas, sobreescribir, usuario_dict, archivo.filename or ""),
        daemon=True,
    ).start()

    return {
        "task_id": task_id,
        "filas_archivo": len(filas),
        "sobreescribir": sobreescribir,
        "archivo": archivo.filename,
    }


@router.get("/backfill/progress/{task_id}", response_model=dict)
def backfill_progress(
    task_id: str,
    _: dict = Depends(require_admin),
):
    task = get_task(task_id)
    if not task:
        raise HTTPException(404, "Tarea no encontrada o expirada")
    return task


@router.get("/cobertura", response_model=dict)
def cobertura(_: dict = Depends(require_admin)):
    """Reporta cuántos envíos tienen coordenadas vs no, global y por mes reciente."""
    from sqlalchemy import func as sqlfunc
    from app.database import SessionLocal as SL
    from app.models import Envio

    db = SL()
    try:
        total = db.query(sqlfunc.count(Envio.id)).scalar() or 0
        con_coord = db.query(sqlfunc.count(Envio.id)).filter(
            Envio.lat.isnot(None), Envio.lon.isnot(None)
        ).scalar() or 0

        # Por mes (últimos 6 meses con datos)
        por_mes = db.query(
            Envio.anio, Envio.mes,
            sqlfunc.count(Envio.id).label("total"),
            sqlfunc.sum(
                sqlfunc.case((Envio.lat.isnot(None), 1), else_=0)
            ).label("con_coord"),
        ).group_by(Envio.anio, Envio.mes).order_by(Envio.anio.desc(), Envio.mes.desc()).limit(6).all()

        return {
            "global": {
                "total": total,
                "con_coordenadas": con_coord,
                "sin_coordenadas": total - con_coord,
                "cobertura_pct": round(con_coord / total * 100, 1) if total else 0,
            },
            "por_mes": [
                {
                    "anio": r.anio, "mes": r.mes,
                    "total": int(r.total or 0),
                    "con_coordenadas": int(r.con_coord or 0),
                    "cobertura_pct": round((r.con_coord or 0) / r.total * 100, 1) if r.total else 0,
                }
                for r in por_mes
            ],
        }
    finally:
        db.close()
