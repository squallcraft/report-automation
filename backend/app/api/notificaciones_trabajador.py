"""
Router de notificaciones del trabajador (portal interno).

Endpoints:
  GET    /notificaciones-trabajador           — lista del trabajador autenticado
  GET    /notificaciones-trabajador/no-leidas — count para badge
  POST   /notificaciones-trabajador/{id}/leer — marca como leída
  POST   /notificaciones-trabajador/leer-todas
  GET    /admin/notificaciones-trabajador/{trabajador_id} — admin: ver historial
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import (
    get_current_user,
    require_admin_or_administracion,
    require_trabajador_portal,
)
from app.models import NotificacionTrabajador

router = APIRouter(prefix="/notificaciones-trabajador", tags=["Notificaciones Trabajador"])


def _to_dict(n: NotificacionTrabajador) -> dict:
    return {
        "id": n.id,
        "trabajador_id": n.trabajador_id,
        "tipo": n.tipo,
        "titulo": n.titulo,
        "mensaje": n.mensaje,
        "url_accion": n.url_accion,
        "leida": bool(n.leida),
        "leida_at": n.leida_at.isoformat() if n.leida_at else None,
        "enviada_whatsapp": bool(n.enviada_whatsapp),
        "whatsapp_status": n.whatsapp_status,
        "metadata": n.metadata_json,
        "created_at": n.created_at.isoformat() if n.created_at else None,
    }


@router.get("")
def listar_propias(
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_trabajador_portal),
):
    rows = (
        db.query(NotificacionTrabajador)
        .filter(NotificacionTrabajador.trabajador_id == current_user["id"])
        .order_by(NotificacionTrabajador.created_at.desc())
        .limit(max(1, min(200, limit)))
        .all()
    )
    return [_to_dict(n) for n in rows]


@router.get("/no-leidas")
def contar_no_leidas(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_trabajador_portal),
):
    n = (
        db.query(NotificacionTrabajador)
        .filter(
            NotificacionTrabajador.trabajador_id == current_user["id"],
            NotificacionTrabajador.leida == False,  # noqa: E712
        )
        .count()
    )
    return {"count": n}


@router.post("/{notif_id}/leer")
def marcar_leida(
    notif_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_trabajador_portal),
):
    n = db.get(NotificacionTrabajador, notif_id)
    if not n or n.trabajador_id != current_user["id"]:
        raise HTTPException(status_code=404, detail="Notificación no encontrada")
    if not n.leida:
        n.leida = True
        n.leida_at = datetime.utcnow()
        db.commit()
        db.refresh(n)
    return _to_dict(n)


@router.post("/leer-todas")
def marcar_todas_leidas(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_trabajador_portal),
):
    pendientes = (
        db.query(NotificacionTrabajador)
        .filter(
            NotificacionTrabajador.trabajador_id == current_user["id"],
            NotificacionTrabajador.leida == False,  # noqa: E712
        )
        .all()
    )
    ahora = datetime.utcnow()
    for n in pendientes:
        n.leida = True
        n.leida_at = ahora
    db.commit()
    return {"actualizadas": len(pendientes)}


@router.get("/admin/{trabajador_id}")
def listar_admin(
    trabajador_id: int,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    rows = (
        db.query(NotificacionTrabajador)
        .filter(NotificacionTrabajador.trabajador_id == trabajador_id)
        .order_by(NotificacionTrabajador.created_at.desc())
        .limit(max(1, min(500, limit)))
        .all()
    )
    return [_to_dict(n) for n in rows]
