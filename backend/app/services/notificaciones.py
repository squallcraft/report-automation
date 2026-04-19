"""
Servicio centralizado de notificaciones a trabajadores y al staff RRHH.

Funciones:
  - `notificar_trabajador(...)`: crea NotificacionTrabajador + (opcional) WhatsApp.
  - `notificar_rrhh(...)`: notifica a todos los AdminUsers que tienen un permiso
    granular dado (ej. `rrhh-licencias:editar`). Crea registro y, si tienen
    `whatsapp` configurado en su ficha, envía mensaje.

El envío vía WhatsApp es best-effort: si falla, queda registrado en
`whatsapp_status` pero no rompe la transacción.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Optional, Sequence

from sqlalchemy.orm import Session

from app.auth import resolver_permisos
from app.models import (
    AdminUser,
    NotificacionTrabajador,
    Trabajador,
    TipoNotificacionEnum,
)
from app.services.whatsapp_trabajadores import enviar_wa_a_trabajador

logger = logging.getLogger(__name__)


def _ejecutar_async(coro):
    """Ejecuta una corutina aunque estemos dentro o fuera de un event loop."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    # Estamos dentro de un loop (ej. handler async): schedula y espera con run_coroutine_threadsafe
    # No es nuestro caso típico; en handlers FastAPI sync llamamos desde sincronía.
    fut = asyncio.ensure_future(coro)
    return loop.run_until_complete(fut) if not loop.is_running() else None


def notificar_trabajador(
    db: Session,
    trabajador: Trabajador,
    titulo: str,
    mensaje: str,
    tipo: str = TipoNotificacionEnum.GENERICA.value,
    url_accion: Optional[str] = None,
    enviar_whatsapp: bool = True,
    metadata: Optional[dict] = None,
    commit: bool = True,
) -> NotificacionTrabajador:
    """
    Crea una notificación dirigida a un trabajador y, opcionalmente, intenta
    enviarla por WhatsApp si tiene número configurado.
    Devuelve el registro creado.
    """
    notif = NotificacionTrabajador(
        trabajador_id=trabajador.id,
        tipo=tipo,
        titulo=titulo[:200],
        mensaje=mensaje,
        url_accion=url_accion,
        metadata_json=metadata or None,
    )
    db.add(notif)
    db.flush()

    if enviar_whatsapp and getattr(trabajador, "whatsapp", None):
        cuerpo = f"*{titulo}*\n{mensaje}"
        if url_accion:
            cuerpo += f"\n\nVer detalle: {url_accion}"
        try:
            resultado = _ejecutar_async(enviar_wa_a_trabajador(trabajador, cuerpo))
        except Exception as exc:  # pragma: no cover - defensivo
            logger.warning("notificar_trabajador WA fallo: %s", exc)
            resultado = {"ok": False, "motivo": f"exception:{type(exc).__name__}"}
        if resultado:
            notif.enviada_whatsapp = bool(resultado.get("ok"))
            notif.whatsapp_status = "ok" if resultado.get("ok") else f"failed:{resultado.get('motivo')}"

    if commit:
        db.commit()
        db.refresh(notif)
    return notif


def notificar_rrhh(
    db: Session,
    permiso_slug: str,
    titulo: str,
    mensaje: str,
    url_accion: Optional[str] = None,
) -> int:
    """
    Notifica a todos los AdminUsers que poseen `permiso_slug`.
    Por ahora, los admin no tienen tabla de notificaciones propia: se loguea y,
    si tienen WhatsApp en su ficha, se les envía el mensaje.

    Retorna la cantidad de destinatarios notificados.
    """
    admins = db.query(AdminUser).filter(AdminUser.activo == True).all()  # noqa: E712
    destinatarios: list[AdminUser] = []
    for u in admins:
        permisos = resolver_permisos(u)
        if permiso_slug in permisos:
            destinatarios.append(u)

    enviados = 0
    cuerpo = f"*{titulo}*\n{mensaje}"
    if url_accion:
        cuerpo += f"\n\nVer: {url_accion}"

    for admin in destinatarios:
        wa_num = getattr(admin, "whatsapp", None) or getattr(admin, "telefono", None)
        if not wa_num:
            continue
        try:
            stub = Trabajador(id=admin.id, nombre=admin.nombre or admin.username, whatsapp=wa_num)
            resultado = _ejecutar_async(enviar_wa_a_trabajador(stub, cuerpo))
            if resultado and resultado.get("ok"):
                enviados += 1
        except Exception as exc:  # pragma: no cover - defensivo
            logger.warning("notificar_rrhh WA fallo admin=%s: %s", admin.id, exc)

    logger.info(
        "notificar_rrhh slug=%s destinatarios=%d enviados_wa=%d",
        permiso_slug, len(destinatarios), enviados,
    )
    return len(destinatarios)
