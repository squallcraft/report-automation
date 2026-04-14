"""
Agente IA para gestión de leads por WhatsApp.
Usa Grok (xAI) con function calling via API OpenAI-compatible.
"""
import asyncio
import json
import logging
import random
import time
from datetime import datetime, timedelta
from typing import Optional

import httpx
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import (
    Lead, MensajeLead, ConocimientoAgente, NotificacionComercial,
    Seller, EtapaLeadEnum, TemperaturaLeadEnum,
)

logger = logging.getLogger(__name__)

GROK_API_URL = "https://api.x.ai/v1/chat/completions"
GROK_MODEL = "grok-3-mini-fast"

MAX_IA_ROUNDS = 8
MAX_TOOL_ROUNDS = 3
DELAY_MIN_S = 4
DELAY_MAX_S = 10
FALLBACK_MSG = "Recibí tu mensaje, te respondo en un momento."

FRUSTRATION_SIGNALS = [
    "no entiendo", "ya te dije", "quiero hablar con alguien", "necesito hablar con una persona",
    "esto es un bot", "eres un bot", "hablar con humano", "operador", "ejecutivo",
    "persona real", "no me sirve", "me estás repitiendo",
]

# ── Knowledge Base cache ──────────────────────────────────────────────────────

_kb_cache: list = []
_kb_cache_ts: float = 0
KB_CACHE_TTL = 300  # 5 minutes


def _load_kb(db: Session) -> list:
    global _kb_cache, _kb_cache_ts
    now = time.time()
    if _kb_cache and (now - _kb_cache_ts) < KB_CACHE_TTL:
        return _kb_cache
    entries = db.query(ConocimientoAgente).filter(
        ConocimientoAgente.activo == True
    ).order_by(ConocimientoAgente.orden, ConocimientoAgente.categoria).all()
    _kb_cache = [
        {"id": e.id, "categoria": e.categoria, "titulo": e.titulo,
         "contenido": e.contenido, "keywords": e.keywords or []}
        for e in entries
    ]
    _kb_cache_ts = now
    return _kb_cache


def _search_kb(db: Session, tema: str) -> str:
    entries = _load_kb(db)
    tema_lower = tema.lower()
    matches = []
    for e in entries:
        score = 0
        kw_match = any(k.lower() in tema_lower for k in e["keywords"])
        if kw_match:
            score += 3
        if tema_lower in e["titulo"].lower():
            score += 2
        if tema_lower in e["contenido"].lower():
            score += 1
        if any(word in e["contenido"].lower() for word in tema_lower.split()):
            score += 1
        if score > 0:
            matches.append((score, e))
    matches.sort(key=lambda x: -x[0])
    if not matches:
        return "No encontré información sobre ese tema en mi base de conocimiento."
    result_entries = matches[:3]
    parts = []
    for _, e in result_entries:
        parts.append(f"[{e['categoria'].upper()}] {e['titulo']}:\n{e['contenido']}")
    return "\n\n".join(parts)


# ── System prompt ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """Eres la asistente comercial de Ecourier, empresa de logística y courier en Chile.
Hablas como una ejecutiva comercial chilena: amable, profesional, directa y natural. No pareces bot.

REGLAS (nunca las rompas):
1. Solo responde con información que obtengas de consultar_conocimiento. NUNCA inventes datos, precios, plazos ni cobertura.
2. Si no tienes la respuesta, di algo como "Esa consulta la maneja mejor nuestro equipo, te conecto con un ejecutivo" y usa escalar_a_humano.
3. Califica al lead de forma natural en la conversación (qué vende, por dónde, cuánto volumen, desde dónde despacha). No hagas un interrogatorio.
4. Máximo 3-4 líneas por mensaje. Escribe como en WhatsApp: frases cortas, naturales, sin bullets ni listas numeradas.
5. Usa máximo 1 emoji por mensaje, y solo si queda natural.
6. Si te preguntan si eres IA: "Soy la asistente digital de Ecourier, pero te puedo conectar ahora mismo con un ejecutivo si prefieres."
7. Siempre ofrece la opción de hablar con un ejecutivo cuando sea apropiado.
8. Nunca des precios exactos salvo que estén explícitamente en la base de conocimiento.

FLUJO DE CONVERSACIÓN (sigue el estado actual del lead):
- saludo: Saluda, confirma que recibiste el mensaje, pregunta en qué puedes ayudar.
- intencion: Identifica qué necesita el lead (cotización, info de servicio, cobertura, etc.)
- calificacion: Haz preguntas naturales para calificar (negocio, canal, volumen, ubicación).
- resolucion: Responde sus preguntas consultando la base de conocimiento.
- cierre: Si está calificado, ofrece conectar con ejecutivo para cerrar.

ESTADO ACTUAL DEL LEAD:
{lead_context}

Responde SOLO el siguiente mensaje del lead. No generes múltiples mensajes."""


# ── Tool definitions (OpenAI-compatible for xAI) ─────────────────────────────

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "consultar_conocimiento",
            "description": "Busca información oficial en la base de conocimiento de Ecourier. SIEMPRE usa esta herramienta antes de responder preguntas del lead.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tema": {
                        "type": "string",
                        "description": "Tema o pregunta a buscar (ej: 'tarifas', 'cobertura santiago', 'mercado libre')"
                    }
                },
                "required": ["tema"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "calificar_lead",
            "description": "Guarda datos de calificación del lead cuando los menciona en la conversación.",
            "parameters": {
                "type": "object",
                "properties": {
                    "negocio": {"type": "string", "description": "Qué vende o a qué se dedica"},
                    "canal_venta": {"type": "string", "description": "Mercado Libre, Falabella, tienda propia, etc."},
                    "volumen_estimado": {"type": "string", "description": "Pedidos mensuales estimados"},
                    "ubicacion": {"type": "string", "description": "Desde dónde despacha"},
                    "nombre": {"type": "string", "description": "Nombre del lead si lo menciona"},
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "escalar_a_humano",
            "description": "Escala la conversación al equipo comercial humano. Usar cuando: el lead pide hablar con una persona, la pregunta no está en el KB, el lead está calificado y listo para propuesta, o detectas frustración.",
            "parameters": {
                "type": "object",
                "properties": {
                    "razon": {
                        "type": "string",
                        "description": "Motivo de la escalada"
                    }
                },
                "required": ["razon"]
            }
        }
    }
]


# ── Tool execution ────────────────────────────────────────────────────────────

def _execute_tool(tool_name: str, args: dict, lead: Lead, db: Session) -> str:
    if tool_name == "consultar_conocimiento":
        return _search_kb(db, args.get("tema", ""))

    elif tool_name == "calificar_lead":
        updated = []
        if args.get("negocio") and not lead.negocio:
            lead.negocio = args["negocio"]
            updated.append("negocio")
        if args.get("canal_venta") and not lead.canal_venta:
            lead.canal_venta = args["canal_venta"]
            updated.append("canal_venta")
        if args.get("volumen_estimado") and not lead.volumen_estimado:
            lead.volumen_estimado = args["volumen_estimado"]
            updated.append("volumen_estimado")
        if args.get("ubicacion") and not lead.ubicacion:
            lead.ubicacion = args["ubicacion"]
            updated.append("ubicacion")
        if args.get("nombre") and not lead.nombre:
            lead.nombre = args["nombre"]
            updated.append("nombre")
        _update_temperatura(lead)
        if lead.negocio and lead.canal_venta and lead.volumen_estimado and lead.ubicacion:
            lead.etapa = EtapaLeadEnum.CALIFICADO.value
        db.commit()
        return f"Datos actualizados: {', '.join(updated)}" if updated else "Sin cambios."

    elif tool_name == "escalar_a_humano":
        razon = args.get("razon", "Escalada solicitada")
        lead.etapa = EtapaLeadEnum.REQUIERE_HUMANO.value
        lead.gestionado_por = "mixto"
        _crear_notificacion(db, lead, "requiere_humano",
                            f"Lead requiere atención humana: {lead.nombre or lead.phone}",
                            f"Razón: {razon}\n\nResumen IA: {lead.resumen_ia or 'Sin resumen'}",
                            prioridad="urgente")
        db.commit()
        return f"Conversación escalada. Razón: {razon}"

    return "Herramienta no reconocida."


def _update_temperatura(lead: Lead):
    fields_filled = sum(1 for f in [lead.negocio, lead.canal_venta, lead.volumen_estimado, lead.ubicacion] if f)
    if fields_filled >= 3:
        lead.temperatura = TemperaturaLeadEnum.CALIENTE.value
    elif fields_filled >= 1:
        lead.temperatura = TemperaturaLeadEnum.TIBIO.value
    else:
        lead.temperatura = TemperaturaLeadEnum.FRIO.value


# ── Notifications ─────────────────────────────────────────────────────────────

def _crear_notificacion(db: Session, lead: Lead, tipo: str, titulo: str,
                        detalle: str, prioridad: str = "normal"):
    wa_link = f"https://wa.me/{lead.phone.lstrip('+')}"
    db.add(NotificacionComercial(
        lead_id=lead.id, tipo=tipo, titulo=titulo,
        detalle=detalle, prioridad=prioridad, accion_url=wa_link,
    ))


# ── Anti-loop detection ──────────────────────────────────────────────────────

def _is_loop(new_response: str, recent_messages: list) -> bool:
    ia_msgs = [m for m in recent_messages if m.autor == "ia"][-2:]
    if not ia_msgs:
        return False
    new_lower = new_response.lower().strip()
    for msg in ia_msgs:
        old_lower = msg.contenido.lower().strip()
        if len(new_lower) < 10:
            continue
        common = set(new_lower.split()) & set(old_lower.split())
        similarity = len(common) / max(len(set(new_lower.split())), 1)
        if similarity > 0.7:
            return True
    return False


# ── Frustration detection ────────────────────────────────────────────────────

def _detect_frustration(text: str) -> bool:
    text_lower = text.lower()
    if any(signal in text_lower for signal in FRUSTRATION_SIGNALS):
        return True
    if len(text_lower) <= 3 and text_lower in ("?", "??", "???", "hola?", "hey"):
        return True
    return False


# ── Build conversation context ───────────────────────────────────────────────

def _build_lead_context(lead: Lead) -> str:
    parts = [f"Estado conversación: {lead.estado_conversacion}"]
    parts.append(f"Etapa pipeline: {lead.etapa}")
    parts.append(f"Temperatura: {lead.temperatura}")
    parts.append(f"Interacciones IA: {lead.interacciones_ia}")
    if lead.nombre:
        parts.append(f"Nombre: {lead.nombre}")
    if lead.negocio:
        parts.append(f"Negocio: {lead.negocio}")
    if lead.canal_venta:
        parts.append(f"Canal: {lead.canal_venta}")
    if lead.volumen_estimado:
        parts.append(f"Volumen: {lead.volumen_estimado}")
    if lead.ubicacion:
        parts.append(f"Ubicación: {lead.ubicacion}")
    if lead.resumen_ia:
        parts.append(f"Resumen previo: {lead.resumen_ia}")
    return "\n".join(parts)


def _build_messages(lead: Lead, recent: list) -> list:
    lead_context = _build_lead_context(lead)
    messages = [{"role": "system", "content": SYSTEM_PROMPT.format(lead_context=lead_context)}]
    for m in recent[-6:]:
        role = "assistant" if m.autor in ("ia", "humano") else "user"
        messages.append({"role": role, "content": m.contenido})
    return messages


# ── Grok API call ─────────────────────────────────────────────────────────────

async def _call_grok(messages: list, use_tools: bool = True) -> Optional[dict]:
    settings = get_settings()
    if not settings.GROK_API_KEY:
        logger.error("GROK_API_KEY no configurada")
        return None

    headers = {
        "Authorization": f"Bearer {settings.GROK_API_KEY}",
        "Content-Type": "application/json",
    }
    body = {
        "model": GROK_MODEL,
        "messages": messages,
        "temperature": 0.7,
        "max_tokens": 300,
    }
    if use_tools:
        body["tools"] = TOOLS
        body["tool_choice"] = "auto"

    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.post(GROK_API_URL, headers=headers, json=body)
                if resp.status_code == 429:
                    wait = 2 ** (attempt + 1)
                    logger.warning("Grok rate limit, retry %d in %ds", attempt + 1, wait)
                    await asyncio.sleep(wait)
                    continue
                resp.raise_for_status()
                return resp.json()
        except Exception as e:
            logger.exception("Error calling Grok (attempt %d): %s", attempt + 1, e)
            if attempt < 2:
                await asyncio.sleep(2)
    return None


# ── Main agent flow ──────────────────────────────────────────────────────────

async def procesar_mensaje_lead(
    lead: Lead,
    texto_inbound: str,
    db: Session,
    send_wa_fn,
) -> Optional[str]:
    """
    Procesa un mensaje inbound de un lead y genera respuesta IA.
    Returns the outbound message text, or None if escalated/failed.
    send_wa_fn: async callable(phone, text) -> wa_message_id
    """
    if lead.etapa in (EtapaLeadEnum.REQUIERE_HUMANO.value,
                      EtapaLeadEnum.CONTACTADO.value,
                      EtapaLeadEnum.PROPUESTA.value,
                      EtapaLeadEnum.GANADO.value,
                      EtapaLeadEnum.PERDIDO.value):
        return None

    if _detect_frustration(texto_inbound):
        lead.etapa = EtapaLeadEnum.REQUIERE_HUMANO.value
        lead.gestionado_por = "mixto"
        _crear_notificacion(db, lead, "requiere_humano",
                            f"Lead frustrado: {lead.nombre or lead.phone}",
                            f"Mensaje: {texto_inbound}\nResumen: {lead.resumen_ia or 'N/A'}",
                            prioridad="urgente")
        escalation_msg = "Entiendo, te conecto con un ejecutivo de nuestro equipo. Te va a contactar en breve por este mismo chat."
        wa_id = await send_wa_fn(lead.phone, escalation_msg)
        db.add(MensajeLead(
            lead_id=lead.id, direccion="outbound", autor="ia",
            contenido=escalation_msg, wa_message_id=wa_id, tipo_contenido="texto",
        ))
        db.commit()
        return escalation_msg

    if lead.interacciones_ia >= MAX_IA_ROUNDS:
        lead.etapa = EtapaLeadEnum.REQUIERE_HUMANO.value
        _crear_notificacion(db, lead, "requiere_humano",
                            f"Lead con {MAX_IA_ROUNDS} interacciones: {lead.nombre or lead.phone}",
                            f"Resumen: {lead.resumen_ia or 'N/A'}",
                            prioridad="alta")
        max_msg = "Creo que lo mejor es que hables directo con nuestro ejecutivo, así te puede dar toda la info detallada. Te contacta en breve por aquí mismo."
        wa_id = await send_wa_fn(lead.phone, max_msg)
        db.add(MensajeLead(
            lead_id=lead.id, direccion="outbound", autor="ia",
            contenido=max_msg, wa_message_id=wa_id, tipo_contenido="texto",
        ))
        db.commit()
        return max_msg

    recent = db.query(MensajeLead).filter(
        MensajeLead.lead_id == lead.id
    ).order_by(MensajeLead.timestamp.desc()).limit(10).all()
    recent.reverse()

    messages = _build_messages(lead, recent)
    escalated = False

    for _ in range(MAX_TOOL_ROUNDS):
        result = await _call_grok(messages)
        if not result:
            fallback_id = await send_wa_fn(lead.phone, FALLBACK_MSG)
            db.add(MensajeLead(
                lead_id=lead.id, direccion="outbound", autor="ia",
                contenido=FALLBACK_MSG, wa_message_id=fallback_id, tipo_contenido="texto",
                meta_datos={"error": "grok_api_failed"},
            ))
            _crear_notificacion(db, lead, "agente_error",
                                "Agente IA no pudo responder",
                                f"Lead: {lead.nombre or lead.phone}. Grok API falló.",
                                prioridad="urgente")
            db.commit()
            return FALLBACK_MSG

        choice = result["choices"][0]
        msg = choice["message"]

        if msg.get("tool_calls"):
            for tc in msg["tool_calls"]:
                fn_name = tc["function"]["name"]
                fn_args = json.loads(tc["function"]["arguments"])
                tool_result = _execute_tool(fn_name, fn_args, lead, db)
                if fn_name == "escalar_a_humano":
                    escalated = True
                messages.append(msg)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": tool_result,
                })
            if escalated:
                result2 = await _call_grok(messages, use_tools=False)
                if result2:
                    final_text = result2["choices"][0]["message"].get("content", "")
                    if final_text:
                        await asyncio.sleep(random.uniform(DELAY_MIN_S, DELAY_MAX_S))
                        wa_id = await send_wa_fn(lead.phone, final_text)
                        db.add(MensajeLead(
                            lead_id=lead.id, direccion="outbound", autor="ia",
                            contenido=final_text, wa_message_id=wa_id, tipo_contenido="texto",
                            meta_datos={"escalada": True},
                        ))
                        lead.interacciones_ia += 1
                        db.commit()
                        return final_text
                db.commit()
                return None
            continue

        response_text = msg.get("content", "").strip()
        if not response_text:
            break

        if _is_loop(response_text, recent):
            lead.etapa = EtapaLeadEnum.REQUIERE_HUMANO.value
            _crear_notificacion(db, lead, "requiere_humano",
                                f"Conversación estancada: {lead.nombre or lead.phone}",
                                f"IA en loop. Último mensaje lead: {texto_inbound}",
                                prioridad="alta")
            loop_msg = "Mejor te conecto con un ejecutivo para que te ayude directo. Te contacta en un momento."
            wa_id = await send_wa_fn(lead.phone, loop_msg)
            db.add(MensajeLead(
                lead_id=lead.id, direccion="outbound", autor="ia",
                contenido=loop_msg, wa_message_id=wa_id, tipo_contenido="texto",
            ))
            db.commit()
            return loop_msg

        await asyncio.sleep(random.uniform(DELAY_MIN_S, DELAY_MAX_S))
        wa_id = await send_wa_fn(lead.phone, response_text)
        db.add(MensajeLead(
            lead_id=lead.id, direccion="outbound", autor="ia",
            contenido=response_text, wa_message_id=wa_id, tipo_contenido="texto",
        ))
        lead.interacciones_ia += 1
        _advance_conversation_state(lead)
        _update_resumen(lead, texto_inbound, response_text)
        db.commit()
        return response_text

    db.commit()
    return None


def _advance_conversation_state(lead: Lead):
    if lead.estado_conversacion == "saludo" and lead.interacciones_ia >= 1:
        lead.estado_conversacion = "intencion"
    elif lead.estado_conversacion == "intencion" and lead.intencion:
        lead.estado_conversacion = "calificacion"
    elif lead.estado_conversacion == "calificacion":
        if lead.negocio and lead.canal_venta and lead.volumen_estimado and lead.ubicacion:
            lead.estado_conversacion = "resolucion"
    elif lead.estado_conversacion == "resolucion" and lead.interacciones_ia >= 5:
        lead.estado_conversacion = "cierre"
    if lead.etapa == EtapaLeadEnum.NUEVO.value and lead.interacciones_ia >= 1:
        lead.etapa = EtapaLeadEnum.IA_GESTIONANDO.value


def _update_resumen(lead: Lead, msg_lead: str, msg_ia: str):
    parts = []
    if lead.resumen_ia:
        parts.append(lead.resumen_ia)
    parts.append(f"Lead: {msg_lead[:80]}")
    parts.append(f"IA: {msg_ia[:80]}")
    full = "\n".join(parts)
    if len(full) > 800:
        full = full[-800:]
    lead.resumen_ia = full
