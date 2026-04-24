"""
API administrativa para inspeccionar y operar sobre asignaciones de ruta
(denominador de efectividad). Solo ADMIN.

Notas:
- Las "pendientes" son asignaciones sin envio_id o en estado 'sin_entrega'.
- 'cancelado' se computa por status_externo y NO afecta la tasa de efectividad.
"""
from __future__ import annotations

import threading
import uuid
from datetime import date, datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.database import SessionLocal, get_db
from app.models import AsignacionRuta, Driver, Envio
from app.services import rutas_entregas
from app.services.audit import registrar as audit
from app.services.task_progress import cleanup_old_tasks, create_task, get_task

router = APIRouter(prefix="/asignaciones-ruta", tags=["Asignaciones Ruta"])


# ── Schemas ──────────────────────────────────────────────────────────────────
class AsignacionOut(BaseModel):
    id: int
    tracking_id: str
    external_id: Optional[str] = None
    withdrawal_date: date
    withdrawal_at: Optional[datetime] = None
    route_id: Optional[int] = None
    route_name: Optional[str] = None
    driver_externo_id: Optional[int] = None
    driver_name: Optional[str] = None
    driver_id: Optional[int] = None
    driver_local_nombre: Optional[str] = None
    seller_code: Optional[str] = None
    envio_id: Optional[int] = None
    envio_fecha_entrega: Optional[date] = None
    status_externo: Optional[str] = None
    estado_calculado: str
    intentos_reconciliacion: int
    ultima_reconciliacion_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ResumenOut(BaseModel):
    total: int
    entregados: int
    cancelados: int
    sin_entrega: int
    sin_envio_local: int


# ── Helpers ──────────────────────────────────────────────────────────────────
def _to_out(asig: AsignacionRuta) -> dict:
    return {
        "id": asig.id,
        "tracking_id": asig.tracking_id,
        "external_id": asig.external_id,
        "withdrawal_date": asig.withdrawal_date,
        "withdrawal_at": asig.withdrawal_at,
        "route_id": asig.route_id,
        "route_name": asig.route_name,
        "driver_externo_id": asig.driver_externo_id,
        "driver_name": asig.driver_name,
        "driver_id": asig.driver_id,
        "driver_local_nombre": asig.driver.nombre if asig.driver else None,
        "seller_code": asig.seller_code,
        "envio_id": asig.envio_id,
        "envio_fecha_entrega": asig.envio.fecha_entrega if asig.envio else None,
        "status_externo": asig.status_externo,
        "estado_calculado": asig.estado_calculado,
        "intentos_reconciliacion": asig.intentos_reconciliacion or 0,
        "ultima_reconciliacion_at": asig.ultima_reconciliacion_at,
        "created_at": asig.created_at,
        "updated_at": asig.updated_at,
    }


# ── Endpoints ────────────────────────────────────────────────────────────────
@router.get("/resumen", response_model=ResumenOut)
def resumen(
    fecha_desde: Optional[date] = None,
    fecha_hasta: Optional[date] = None,
    driver_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    q = db.query(AsignacionRuta)
    if fecha_desde:
        q = q.filter(AsignacionRuta.withdrawal_date >= fecha_desde)
    if fecha_hasta:
        q = q.filter(AsignacionRuta.withdrawal_date <= fecha_hasta)
    if driver_id:
        q = q.filter(AsignacionRuta.driver_id == driver_id)

    total = q.count()
    entregados = q.filter(AsignacionRuta.estado_calculado == rutas_entregas.ESTADO_ENTREGADO).count()
    cancelados = q.filter(AsignacionRuta.estado_calculado == rutas_entregas.ESTADO_CANCELADO).count()
    sin_entrega = q.filter(AsignacionRuta.estado_calculado == rutas_entregas.ESTADO_SIN_ENTREGA).count()
    sin_envio = q.filter(AsignacionRuta.envio_id.is_(None)).count()
    return ResumenOut(
        total=total,
        entregados=entregados,
        cancelados=cancelados,
        sin_entrega=sin_entrega,
        sin_envio_local=sin_envio,
    )


@router.get("", response_model=dict)
def listar(
    fecha_desde: Optional[date] = None,
    fecha_hasta: Optional[date] = None,
    driver_id: Optional[int] = None,
    estado: Optional[str] = Query(None, description="entregado | cancelado | sin_entrega"),
    sin_envio: Optional[bool] = Query(None, description="solo asignaciones sin envío local"),
    q: Optional[str] = Query(None, description="busca por tracking, ruta o conductor"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    query = db.query(AsignacionRuta)
    if fecha_desde:
        query = query.filter(AsignacionRuta.withdrawal_date >= fecha_desde)
    if fecha_hasta:
        query = query.filter(AsignacionRuta.withdrawal_date <= fecha_hasta)
    if driver_id:
        query = query.filter(AsignacionRuta.driver_id == driver_id)
    if estado:
        query = query.filter(AsignacionRuta.estado_calculado == estado)
    if sin_envio is True:
        query = query.filter(AsignacionRuta.envio_id.is_(None))
    elif sin_envio is False:
        query = query.filter(AsignacionRuta.envio_id.isnot(None))
    if q:
        like = f"%{q.lower()}%"
        query = query.filter(or_(
            func.lower(AsignacionRuta.tracking_id).like(like),
            func.lower(AsignacionRuta.route_name).like(like),
            func.lower(AsignacionRuta.driver_name).like(like),
        ))

    total = query.count()
    items = (
        query.order_by(AsignacionRuta.withdrawal_date.desc(), AsignacionRuta.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [_to_out(a) for a in items],
    }


@router.post("/{asig_id}/reconciliar", response_model=AsignacionOut)
def reconciliar_uno(
    asig_id: int,
    request: Request,
    db: Session = Depends(get_db),
    usuario: dict = Depends(require_admin),
):
    asig = db.query(AsignacionRuta).filter(AsignacionRuta.id == asig_id).first()
    if not asig:
        raise HTTPException(404, "Asignación no encontrada")
    rutas_entregas.reconciliar_asignacion(db, asig)
    db.commit()
    db.refresh(asig)
    try:
        audit(
            db,
            accion="asignacion_ruta_reconciliada",
            usuario=usuario,
            request=request,
            entidad="asignacion_ruta",
            entidad_id=asig.id,
            metadata={"tracking_id": asig.tracking_id, "estado": asig.estado_calculado},
        )
    except Exception:
        pass
    return _to_out(asig)


@router.post("/reresolver-drivers", response_model=dict)
def reresolver_drivers(
    request: Request,
    fecha_desde: Optional[date] = None,
    forzar_todas: bool = True,
    db: Session = Depends(get_db),
    usuario: dict = Depends(require_admin),
):
    """Re-aplica el matching de driver local a las asignaciones con driver_name.

    Con `forzar_todas=True` (default) corrige también filas que ya tienen un
    driver_id incorrecto (bug histórico donde se guardó el id externo del courier).
    Con `forzar_todas=False` solo procesa filas con driver_id IS NULL.
    """
    info = rutas_entregas.reresolver_drivers(db, fecha_desde=fecha_desde, forzar_todas=forzar_todas)
    try:
        audit(
            db,
            accion="asignaciones_reresolver_drivers",
            usuario=usuario,
            request=request,
            metadata=info,
        )
    except Exception:
        pass
    return info


@router.post("/reconciliar-pendientes", response_model=dict)
def reconciliar_pendientes(
    request: Request,
    fecha_desde: Optional[date] = None,
    limite: int = Query(2000, ge=1, le=10000),
    db: Session = Depends(get_db),
    usuario: dict = Depends(require_admin),
):
    """Lanza una reconciliación masiva (sincrónica) sobre las pendientes."""
    info = rutas_entregas.reconciliar_pendientes(db, fecha_desde=fecha_desde, limite=limite)
    try:
        audit(
            db,
            accion="asignaciones_reconciliar_pendientes",
            usuario=usuario,
            request=request,
            metadata=info,
        )
    except Exception:
        pass
    return info


def _run_ingesta_background(task_id: str, fecha_inicio: str, fecha_fin: str, usuario_dict: dict):
    """Ejecuta la ingesta de rutas en un thread con su propia sesión de BD."""
    db = SessionLocal()
    try:
        resultado = rutas_entregas.ingestar_rutas(
            db,
            fecha_inicio=fecha_inicio,
            fecha_fin=fecha_fin,
            task_id=task_id,
        )
        try:
            audit(
                db,
                accion="asignaciones_ingesta_adhoc",
                usuario=usuario_dict,
                entidad="asignacion_ruta",
                metadata={
                    "fecha_inicio": fecha_inicio,
                    "fecha_fin": fecha_fin,
                    "task_id": task_id,
                    "resultado": resultado,
                },
            )
        except Exception:
            pass
    except Exception as e:  # noqa: BLE001
        import traceback
        traceback.print_exc()
        from app.services.task_progress import update_task as _ut
        _ut(task_id, status="error", message=f"Error fatal: {str(e)}")
    finally:
        db.close()


@router.post("/ingestar", response_model=dict)
def ingestar_rango(
    request: Request,
    fecha_inicio: date = Query(..., description="YYYY-MM-DD"),
    fecha_fin: date = Query(..., description="YYYY-MM-DD"),
    usuario: dict = Depends(require_admin),
):
    """Lanza una ingesta ad-hoc del courier para el rango dado, en background.

    Devuelve `{ task_id }` para hacer polling en
    `GET /asignaciones-ruta/ingestar/progress/{task_id}`.
    """
    cleanup_old_tasks()
    task_id = uuid.uuid4().hex
    create_task(task_id, total=0, archivo=f"TrackingTech rutas {fecha_inicio} → {fecha_fin}")

    usuario_dict = {
        "id": usuario.get("id"),
        "nombre": usuario.get("nombre"),
        "rol": str(usuario.get("rol", "")),
    }

    threading.Thread(
        target=_run_ingesta_background,
        args=(task_id, fecha_inicio.isoformat(), fecha_fin.isoformat(), usuario_dict),
        daemon=True,
    ).start()

    return {"task_id": task_id}


@router.get("/ingestar/progress/{task_id}", response_model=dict)
def ingestar_progress(
    task_id: str,
    _: dict = Depends(require_admin),
):
    task = get_task(task_id)
    if not task:
        raise HTTPException(404, "Tarea no encontrada o expirada")
    return task


@router.post("/{asig_id}/vincular-envio", response_model=AsignacionOut)
def vincular_envio(
    asig_id: int,
    envio_id: int,
    request: Request,
    db: Session = Depends(get_db),
    usuario: dict = Depends(require_admin),
):
    """Permite enlazar manualmente una asignación con un envío específico
    (cuando el tracking_id no coincide pero el operador identificó el match)."""
    asig = db.query(AsignacionRuta).filter(AsignacionRuta.id == asig_id).first()
    if not asig:
        raise HTTPException(404, "Asignación no encontrada")
    envio = db.query(Envio).filter(Envio.id == envio_id).first()
    if not envio:
        raise HTTPException(404, "Envío no encontrado")
    asig.envio_id = envio.id
    rutas_entregas.reconciliar_asignacion(db, asig)
    db.commit()
    db.refresh(asig)
    try:
        audit(
            db,
            accion="asignacion_ruta_vinculada_manual",
            usuario=usuario,
            request=request,
            entidad="asignacion_ruta",
            entidad_id=asig.id,
            metadata={"tracking_id": asig.tracking_id, "envio_id": envio.id},
        )
    except Exception:
        pass
    return _to_out(asig)
