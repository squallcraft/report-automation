"""
API administrativa para gestionar los cron jobs internos del sistema.
Solo accesible por usuarios ADMIN.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, validator
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.database import get_db
from app.models import CronEjecucion, CronJob
from app.services.audit import registrar as audit
from app.services.scheduler import reload_jobs, run_job_now

router = APIRouter(prefix="/cron-jobs", tags=["Cron Jobs"])


# ── Schemas ──────────────────────────────────────────────────────────────────
class CronJobOut(BaseModel):
    id: int
    nombre: str
    descripcion: Optional[str] = None
    job_key: str
    activo: bool
    hora_ejecucion: str
    config: Optional[dict[str, Any]] = None
    ultima_ejecucion_at: Optional[datetime] = None
    ultima_ejecucion_estado: Optional[str] = None
    ultima_ejecucion_mensaje: Optional[str] = None
    ultima_ejecucion_resultado: Optional[Any] = None
    ultima_ejecucion_duracion_s: Optional[float] = None
    proxima_ejecucion_at: Optional[datetime] = None
    actualizado_por: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CronJobUpdate(BaseModel):
    activo: Optional[bool] = None
    hora_ejecucion: Optional[str] = Field(None, description="Formato HH:MM (24h)")
    descripcion: Optional[str] = None
    config: Optional[dict[str, Any]] = None

    @validator("hora_ejecucion")
    def _valida_hora(cls, v):
        if v is None:
            return v
        try:
            hh, mm = v.split(":")
            h, m = int(hh), int(mm)
        except Exception as exc:
            raise ValueError("hora_ejecucion debe tener formato HH:MM") from exc
        if not (0 <= h <= 23 and 0 <= m <= 59):
            raise ValueError("hora_ejecucion fuera de rango")
        return f"{h:02d}:{m:02d}"


class CronEjecucionOut(BaseModel):
    id: int
    cron_job_id: int
    job_key: str
    iniciado_at: datetime
    finalizado_at: Optional[datetime] = None
    duracion_s: Optional[float] = None
    estado: str
    mensaje: Optional[str] = None
    resultado: Optional[Any] = None
    disparado_por: str
    disparado_por_usuario: Optional[str] = None

    class Config:
        from_attributes = True


# ── Endpoints ────────────────────────────────────────────────────────────────
@router.get("", response_model=list[CronJobOut])
def listar_cron_jobs(
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    return db.query(CronJob).order_by(CronJob.nombre.asc()).all()


@router.get("/{job_id}", response_model=CronJobOut)
def obtener_cron_job(
    job_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    cj = db.query(CronJob).filter(CronJob.id == job_id).first()
    if not cj:
        raise HTTPException(404, "Cron job no encontrado")
    return cj


@router.patch("/{job_id}", response_model=CronJobOut)
def actualizar_cron_job(
    job_id: int,
    payload: CronJobUpdate,
    request: Request,
    db: Session = Depends(get_db),
    usuario: dict = Depends(require_admin),
):
    cj = db.query(CronJob).filter(CronJob.id == job_id).first()
    if not cj:
        raise HTTPException(404, "Cron job no encontrado")

    cambios: dict[str, Any] = {}
    if payload.activo is not None and payload.activo != cj.activo:
        cambios["activo"] = {"de": cj.activo, "a": payload.activo}
        cj.activo = payload.activo
    if payload.hora_ejecucion is not None and payload.hora_ejecucion != cj.hora_ejecucion:
        cambios["hora_ejecucion"] = {"de": cj.hora_ejecucion, "a": payload.hora_ejecucion}
        cj.hora_ejecucion = payload.hora_ejecucion
    if payload.descripcion is not None and payload.descripcion != cj.descripcion:
        cambios["descripcion"] = {"de": cj.descripcion, "a": payload.descripcion}
        cj.descripcion = payload.descripcion
    if payload.config is not None and payload.config != (cj.config or {}):
        cambios["config"] = {"de": cj.config, "a": payload.config}
        cj.config = payload.config

    cj.actualizado_por = usuario.get("nombre")
    db.commit()
    db.refresh(cj)

    if cambios:
        try:
            reload_jobs()
        except Exception:
            pass
        try:
            audit(
                db,
                accion="cron_job_actualizado",
                usuario=usuario,
                request=request,
                entidad="cron_job",
                entidad_id=cj.id,
                cambios=cambios,
                metadata={"job_key": cj.job_key},
            )
        except Exception:
            pass

    return cj


@router.post("/{job_id}/run-now", response_model=CronJobOut)
def ejecutar_ahora(
    job_id: int,
    request: Request,
    db: Session = Depends(get_db),
    usuario: dict = Depends(require_admin),
):
    cj = db.query(CronJob).filter(CronJob.id == job_id).first()
    if not cj:
        raise HTTPException(404, "Cron job no encontrado")

    run_job_now(cj.job_key, usuario=usuario)

    try:
        audit(
            db,
            accion="cron_job_ejecucion_manual",
            usuario=usuario,
            request=request,
            entidad="cron_job",
            entidad_id=cj.id,
            metadata={"job_key": cj.job_key},
        )
    except Exception:
        pass

    return cj


@router.post("/reload")
def recargar_scheduler(
    request: Request,
    db: Session = Depends(get_db),
    usuario: dict = Depends(require_admin),
):
    """Re-sincroniza el scheduler con los cron_jobs en BD (debug/admin)."""
    info = reload_jobs()
    try:
        audit(
            db,
            accion="cron_scheduler_reload",
            usuario=usuario,
            request=request,
            metadata=info,
        )
    except Exception:
        pass
    return info


@router.get("/{job_id}/historial", response_model=list[CronEjecucionOut])
def historial_ejecuciones(
    job_id: int,
    limite: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    cj = db.query(CronJob).filter(CronJob.id == job_id).first()
    if not cj:
        raise HTTPException(404, "Cron job no encontrado")
    return (
        db.query(CronEjecucion)
        .filter(CronEjecucion.cron_job_id == job_id)
        .order_by(CronEjecucion.iniciado_at.desc())
        .limit(limite)
        .all()
    )
