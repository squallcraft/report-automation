"""
Servicio centralizado de auditoría.
Registra todas las acciones relevantes del sistema en audit_logs.
"""
import json
import logging
from typing import Optional

from fastapi import Request
from sqlalchemy.orm import Session

from app.models import AuditLog

logger = logging.getLogger(__name__)


def registrar(
    db: Session,
    accion: str,
    *,
    usuario: Optional[dict] = None,
    request: Optional[Request] = None,
    entidad: Optional[str] = None,
    entidad_id: Optional[int] = None,
    cambios: Optional[dict] = None,
    metadata: Optional[dict] = None,
) -> None:
    """
    Registra una entrada de auditoría.

    Args:
        db: Sesión de base de datos.
        accion: Identificador de la acción (ej: "ingesta_batch", "pago_manual").
        usuario: Dict con id, nombre, rol del usuario autenticado.
        request: FastAPI Request para extraer IP.
        entidad: Tipo de entidad afectada (ej: "envio", "driver").
        entidad_id: ID de la entidad afectada (nullable para acciones batch).
        cambios: Dict con {campo: {antes, despues}} o datos relevantes.
        metadata: Dict con info adicional (archivo, cantidades, etc).
    """
    try:
        ip = None
        if request:
            forwarded = request.headers.get("x-forwarded-for")
            ip = forwarded.split(",")[0].strip() if forwarded else request.client.host if request.client else None

        entry = AuditLog(
            usuario_id=usuario.get("id") if usuario else None,
            usuario_nombre=usuario.get("nombre") if usuario else None,
            usuario_rol=str(usuario.get("rol", "")) if usuario else None,
            ip_address=ip,
            accion=accion,
            entidad=entidad,
            entidad_id=entidad_id,
            cambios=cambios,
            metadata_=metadata,
        )

        in_transaction = db.is_active and db.in_transaction()
        if in_transaction:
            nested = db.begin_nested()
            try:
                db.add(entry)
                nested.commit()
            except Exception as inner:
                nested.rollback()
                logger.error("Error registrando auditoría (savepoint) [%s]: %s", accion, inner)
        else:
            try:
                db.add(entry)
                db.commit()
            except Exception as inner:
                db.rollback()
                logger.error("Error registrando auditoría (commit) [%s]: %s", accion, inner)
    except Exception as exc:
        logger.error("Error preparando auditoría [%s]: %s", accion, exc)


def diff_campos(antes: dict, despues: dict, campos: list[str]) -> dict:
    """
    Calcula diferencias entre dos dicts para los campos especificados.
    Solo incluye campos que efectivamente cambiaron.
    """
    cambios = {}
    for campo in campos:
        val_antes = antes.get(campo)
        val_despues = despues.get(campo)
        if val_antes != val_despues:
            cambios[campo] = {"antes": val_antes, "despues": val_despues}
    return cambios
