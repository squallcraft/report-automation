"""
Servicio centralizado de auditoría.
Registra todas las acciones relevantes del sistema en audit_logs.
"""
import logging
import traceback
from typing import Optional

from fastapi import Request
from sqlalchemy.orm import Session
from sqlalchemy import text

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
    Usa INSERT directo por SQL para no interferir con la sesión del endpoint.
    """
    try:
        ip = None
        if request:
            forwarded = request.headers.get("x-forwarded-for")
            ip = forwarded.split(",")[0].strip() if forwarded else (
                request.client.host if request.client else None
            )

        usuario_id = usuario.get("id") if usuario else None
        usuario_nombre = usuario.get("nombre") if usuario else None
        usuario_rol = str(usuario.get("rol", "")) if usuario else None

        import json
        cambios_json = json.dumps(cambios) if cambios else None
        metadata_json = json.dumps(metadata) if metadata else None

        conn = db.get_bind().connect()
        try:
            conn.execute(
                text("""
                    INSERT INTO audit_logs
                        (usuario_id, usuario_nombre, usuario_rol, ip_address,
                         accion, entidad, entidad_id, cambios, metadata)
                    VALUES
                        (:uid, :uname, :urol, :ip,
                         :accion, :entidad, :eid, :cambios::jsonb, :meta::jsonb)
                """),
                {
                    "uid": usuario_id, "uname": usuario_nombre, "urol": usuario_rol,
                    "ip": ip, "accion": accion, "entidad": entidad, "eid": entidad_id,
                    "cambios": cambios_json, "meta": metadata_json,
                },
            )
            conn.commit()
        except Exception as inner:
            conn.rollback()
            print(f"[AUDIT ERROR commit] [{accion}]: {inner}", flush=True)
        finally:
            conn.close()

    except Exception as exc:
        print(f"[AUDIT ERROR] [{accion}]: {exc}", flush=True)
        traceback.print_exc()


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
