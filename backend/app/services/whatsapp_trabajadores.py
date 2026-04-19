"""
Capa fina de envío de WhatsApp a trabajadores reusando la integración con
Meta WhatsApp Business Cloud API (la misma que usamos para sellers).

Diseño:
  - El servicio nunca abre conexiones HTTP por sí mismo: delega en
    `app.api.whatsapp._send_wa_message`.
  - Acepta un texto libre (ventana 24h) o el nombre de una plantilla aprobada
    en Meta + parámetros.
  - Normaliza el número del trabajador (`Trabajador.whatsapp`) al formato E.164
    sin '+'. Acepta entradas como "+56912345678", "56912345678" o "912345678".

Uso típico:
    from app.services.whatsapp_trabajadores import enviar_wa_a_trabajador
    await enviar_wa_a_trabajador(trabajador, "Hola {nombre}, ...")

Nota: si el trabajador no tiene `whatsapp` cargado o la API no está configurada
(env vars), retorna `{"ok": False, "skipped": True, "motivo": "..."}` sin
levantar excepción para no bloquear flujos críticos (ej. emisión de un anexo).
"""
from __future__ import annotations

import logging
import os
import re
from typing import Optional

from app.api.whatsapp import _send_wa_message, _build_text_payload, _build_template_payload
from app.models import Trabajador

logger = logging.getLogger(__name__)


_RE_DIGITS = re.compile(r"\D+")


def normalizar_numero_chile(raw: Optional[str]) -> Optional[str]:
    """
    Devuelve el número en formato E.164 sin '+' (ej. '56912345678').
    Asume Chile (+56) si vienen 8 o 9 dígitos sin código de país.
    Retorna None si no se puede inferir un número válido.
    """
    if not raw:
        return None
    digits = _RE_DIGITS.sub("", raw)
    if not digits:
        return None
    # ya viene con 56 al inicio
    if digits.startswith("56") and len(digits) >= 11:
        return digits
    # móvil chileno: 9 dígitos empezando con 9
    if len(digits) == 9 and digits.startswith("9"):
        return f"56{digits}"
    # 8 dígitos (sin el 9 inicial) — caso raro, asumir móvil
    if len(digits) == 8:
        return f"569{digits}"
    return digits  # último recurso, dejar lo que venga limpio


def _wa_disponible() -> bool:
    return bool(os.getenv("WA_PHONE_NUMBER_ID") and os.getenv("WA_ACCESS_TOKEN"))


async def enviar_wa_a_trabajador(
    trabajador: Trabajador,
    texto: str,
    *,
    template_name: Optional[str] = None,
    template_idioma: str = "es_CL",
    template_variables: Optional[list[str]] = None,
) -> dict:
    """
    Envía un mensaje de WhatsApp al trabajador.

    Si `template_name` viene dado, intenta enviar como plantilla aprobada en
    Meta (recomendado fuera de la ventana de 24h). De lo contrario envía
    texto libre.

    Retorna `{ok, skipped?, response?, motivo?}`. No levanta excepciones: ante
    cualquier fallo retorna `ok: False, motivo: ...` para no bloquear flujos.
    """
    if not _wa_disponible():
        return {"ok": False, "skipped": True, "motivo": "wa_no_configurada"}

    numero = normalizar_numero_chile(getattr(trabajador, "whatsapp", None))
    if not numero:
        return {"ok": False, "skipped": True, "motivo": "trabajador_sin_whatsapp"}

    try:
        if template_name:
            valores = {f"{i+1}": v for i, v in enumerate(template_variables or [])}
            payload = _build_template_payload(template_name, template_idioma, valores)
        else:
            payload = _build_text_payload(texto, {})
        resp = await _send_wa_message(numero, payload)
        ok = bool(resp and resp.get("messages"))
        return {"ok": ok, "response": resp, "motivo": None if ok else "respuesta_sin_messages"}
    except Exception as exc:
        logger.warning("Falla envío WA a trabajador %s: %s", trabajador.id, exc)
        return {"ok": False, "motivo": f"exception:{type(exc).__name__}"}
