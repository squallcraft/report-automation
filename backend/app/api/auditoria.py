"""
API de Auditoría: consulta de logs y cargas de cartola.
"""
from typing import Optional, List

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc, String

from app.database import get_db
from app.auth import require_admin
from app.models import AuditLog, CartolaCarga

router = APIRouter(prefix="/auditoria", tags=["Auditoría"])


@router.get("/logs")
def listar_logs(
    accion: Optional[str] = None,
    entidad: Optional[str] = None,
    entidad_id: Optional[int] = None,
    usuario_nombre: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = Query(100, le=500),
    offset: int = 0,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    query = db.query(AuditLog).filter(AuditLog.accion.isnot(None))
    if accion:
        query = query.filter(AuditLog.accion == accion)
    if entidad:
        query = query.filter(AuditLog.entidad == entidad)
    if entidad_id is not None:
        query = query.filter(AuditLog.entidad_id == entidad_id)
    if usuario_nombre:
        query = query.filter(AuditLog.usuario_nombre.ilike(f"%{usuario_nombre}%"))
    if search:
        query = query.filter(
            AuditLog.metadata_.cast(String).ilike(f"%{search}%")
        )

    total = query.count()
    rows = query.order_by(desc(AuditLog.timestamp)).offset(offset).limit(limit).all()

    return {
        "total": total,
        "items": [
            {
                "id": r.id,
                "timestamp": r.timestamp.isoformat() if r.timestamp else None,
                "usuario_nombre": r.usuario_nombre,
                "usuario_rol": r.usuario_rol,
                "ip_address": r.ip_address,
                "accion": r.accion,
                "entidad": r.entidad,
                "entidad_id": r.entidad_id,
                "cambios": r.cambios,
                "metadata": r.metadata_,
            }
            for r in rows
        ],
    }


@router.get("/acciones")
def listar_acciones_disponibles(
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """Lista las acciones únicas registradas para usar como filtro."""
    rows = db.query(AuditLog.accion).filter(AuditLog.accion.isnot(None)).distinct().all()
    return sorted([r[0] for r in rows if r[0]])


@router.get("/cargas")
def listar_cargas(
    tipo: Optional[str] = None,
    mes: Optional[int] = None,
    anio: Optional[int] = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    query = db.query(CartolaCarga)
    if tipo:
        query = query.filter(CartolaCarga.tipo == tipo)
    if mes:
        query = query.filter(CartolaCarga.mes == mes)
    if anio:
        query = query.filter(CartolaCarga.anio == anio)

    total = query.count()
    rows = query.order_by(desc(CartolaCarga.fecha_carga)).offset(offset).limit(limit).all()

    return {
        "total": total,
        "items": [
            {
                "id": r.id,
                "tipo": r.tipo,
                "archivo_nombre": r.archivo_nombre,
                "usuario_nombre": r.usuario_nombre,
                "fecha_carga": r.fecha_carga.isoformat() if r.fecha_carga else None,
                "mes": r.mes,
                "anio": r.anio,
                "total_transacciones": r.total_transacciones,
                "matcheadas": r.matcheadas,
                "no_matcheadas": r.no_matcheadas,
                "monto_total": r.monto_total,
            }
            for r in rows
        ],
    }
