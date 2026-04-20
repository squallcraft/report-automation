"""
WhatsApp Business Cloud API — Módulo C del sistema de inteligencia comercial.

Flujo:
  1. Administrador crea plantillas (almacenadas localmente).
  2. Administrador compone envío masivo: elige plantilla + segmento de sellers.
  3. Backend llama a la API de Meta para cada número y registra el estado.
  4. Webhooks de Meta actualizan el estado (enviado → entregado → leído → respondido).

Referencias:
  - https://developers.facebook.com/docs/whatsapp/cloud-api/
  - Endpoint base: https://graph.facebook.com/v19.0/{phone_number_id}/messages
"""
import hashlib
import json
import logging
from datetime import datetime, date, timedelta
from typing import Optional, List, Dict, Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, BackgroundTasks
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc

from app.database import get_db
from app.auth import require_admin_or_administracion
from app.models import (
    WhatsAppTemplate, WhatsAppEnvio, WhatsAppMensaje,
    Seller, SellerSnapshot,
    Lead, MensajeLead, EtapaLeadEnum, NotificacionComercial,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/whatsapp", tags=["WhatsApp"])

# ── Config (cargada desde variables de entorno en producción) ─────────────────
import os
WA_PHONE_NUMBER_ID = os.getenv("WA_PHONE_NUMBER_ID", "")
WA_ACCESS_TOKEN    = os.getenv("WA_ACCESS_TOKEN", "")
WA_VERIFY_TOKEN    = os.getenv("WA_VERIFY_TOKEN", "ecourier_webhook_verify")
WA_API_BASE        = "https://graph.facebook.com/v19.0"


# ── Schemas ──────────────────────────────────────────────────────────────────

class TemplateCreate(BaseModel):
    nombre: str
    categoria: str            # marketing | utility | authentication
    idioma: str = "es_CL"
    cuerpo: str               # texto con variables {{1}}, {{2}}, etc.
    variables: List[str] = [] # nombres descriptivos de las variables
    wa_template_name: Optional[str] = None  # nombre aprobado en Meta (cuando aplica)


class EnvioCreate(BaseModel):
    template_id: int
    segmento: str             # todos | tier_epico | tier_clave | tier_destacado | tier_bueno | en_riesgo | manual | numeros_directos | por_tags
    seller_ids: List[int] = [] # solo para segmento=manual
    numeros_directos: List[str] = []  # solo para segmento=numeros_directos
    tags_filtro: List[str] = []      # solo para segmento=por_tags
    tags_modo: str = "cualquiera"    # cualquiera (OR) | todos (AND)
    variables_valores: Dict[str, str] = {}
    nombre_campaña: Optional[str] = None


# ── Helpers API Meta ──────────────────────────────────────────────────────────

def _wa_headers():
    return {
        "Authorization": f"Bearer {WA_ACCESS_TOKEN}",
        "Content-Type": "application/json",
    }


def _build_template_payload(wa_name: str, idioma: str, variables: Dict[str, str]) -> dict:
    """Construye el payload para enviar un mensaje de plantilla aprobada."""
    components = []
    if variables:
        params = [{"type": "text", "text": str(v)} for v in variables.values()]
        components.append({"type": "body", "parameters": params})
    return {
        "type": "template",
        "template": {
            "name": wa_name,
            "language": {"code": idioma},
            "components": components,
        },
    }


def _build_text_payload(texto: str, variables: Dict[str, str]) -> dict:
    """Construye payload de texto libre (dentro de ventana 24h)."""
    cuerpo = texto
    for i, val in enumerate(variables.values(), 1):
        cuerpo = cuerpo.replace(f"{{{{{i}}}}}", str(val))
    return {"type": "text", "text": {"body": cuerpo}}


async def _send_wa_message(to: str, payload: dict) -> dict:
    """Llama a la API de Meta. Retorna la respuesta JSON."""
    url = f"{WA_API_BASE}/{WA_PHONE_NUMBER_ID}/messages"
    body = {"messaging_product": "whatsapp", "to": to, **payload}
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(url, headers=_wa_headers(), json=body)
        return resp.json()


# ── Envío en background ───────────────────────────────────────────────────────

def _resolver_segmento(
    segmento: str,
    seller_ids_manual: List[int],
    db: Session,
    tags_filtro: List[str] = None,
    tags_modo: str = "cualquiera",
) -> List[Seller]:
    """Devuelve la lista de sellers del segmento elegido."""
    hoy = date.today()

    if segmento == "manual":
        return db.query(Seller).filter(
            Seller.id.in_(seller_ids_manual),
            Seller.activo == True,
            Seller.telefono_whatsapp.isnot(None),
        ).all()

    if segmento == "numeros_directos":
        return []

    q = db.query(Seller).filter(
        Seller.activo == True,
        Seller.tipo_cierre.is_(None),
        Seller.telefono_whatsapp.isnot(None),
    )

    if segmento == "todos":
        return q.all()

    if segmento == "por_tags":
        tags = [t.strip().lower() for t in (tags_filtro or []) if t.strip()]
        if not tags:
            return []
        todos_sellers = q.all()
        if tags_modo == "todos":
            return [s for s in todos_sellers if all(t in (s.tags or []) for t in tags)]
        return [s for s in todos_sellers if any(t in (s.tags or []) for t in tags)]

    # Filtrar por snapshot del día
    snaps = {
        s.seller_id: s for s in
        db.query(SellerSnapshot).filter(SellerSnapshot.fecha == hoy).all()
    }

    TIER_MAP = {
        "tier_epico":     lambda s: s.tier == "EPICO",
        "tier_clave":     lambda s: s.tier == "CLAVE",
        "tier_destacado": lambda s: s.tier == "DESTACADO",
        "tier_bueno":     lambda s: s.tier == "BUENO",
        "en_riesgo":      lambda s: s.estado_efectivo in ("en_riesgo", "pendiente_validacion"),
        "en_gestion":     lambda s: s.estado_efectivo in ("en_gestion", "seguimiento"),
    }

    filtro = TIER_MAP.get(segmento)
    if not filtro:
        return []

    ids_ok = {sid for sid, snap in snaps.items() if filtro(snap)}
    return q.filter(Seller.id.in_(ids_ok)).all()


async def _ejecutar_envio(envio_id: int, db: Session):
    """Tarea en background: envía los mensajes y actualiza estados."""
    from app.database import SessionLocal
    db2 = SessionLocal()
    try:
        envio = db2.query(WhatsAppEnvio).filter(WhatsAppEnvio.id == envio_id).first()
        if not envio:
            return

        template = db2.query(WhatsAppTemplate).filter(
            WhatsAppTemplate.id == envio.template_id
        ).first()
        if not template:
            envio.estado = "error"
            db2.commit()
            return

        sellers = _resolver_segmento(
            envio.segmento,
            envio.seller_ids or [],
            db2,
            tags_filtro=(envio.variables_valores or {}).get("_tags_filtro", "").split(",") if (envio.variables_valores or {}).get("_tags_filtro") else [],
            tags_modo=(envio.variables_valores or {}).get("_tags_modo", "cualquiera"),
        )

        # Para números directos, construir lista sintética
        numeros_directos = []
        if envio.segmento == "numeros_directos":
            raw = envio.seller_ids or []  # reutilizamos seller_ids para guardar índices
            # Los números directos se guardan en el campo datos del envio
            datos = envio.seller_ids  # en realidad se guarda en variables_valores["_numeros"]
            nd_str = (envio.variables_valores or {}).get("_numeros", "")
            numeros_directos = [n.strip() for n in nd_str.split(",") if n.strip()]

        total = len(sellers) + len(numeros_directos)
        envio.estado = "enviando"
        envio.total = total
        db2.commit()

        enviados = errores = 0
        for seller in sellers:
            numero = seller.telefono_whatsapp.strip().replace(" ", "").replace("-", "")
            if not numero.startswith("+"):
                numero = "+56" + numero.lstrip("0")

            # Decidir payload según si tiene nombre aprobado en Meta
            variables = {k: v for k, v in (envio.variables_valores or {}).items() if not k.startswith("_")}
            if template.wa_template_name:
                payload = _build_template_payload(
                    template.wa_template_name, template.idioma, variables
                )
            else:
                payload = _build_text_payload(template.cuerpo, variables)

            try:
                resp = await _send_wa_message(numero, payload)
                wa_msg_id = resp.get("messages", [{}])[0].get("id")
                estado_msg = "enviado" if wa_msg_id else "error"
                error_msg = json.dumps(resp.get("error")) if resp.get("error") else None
                if wa_msg_id:
                    enviados += 1
                else:
                    errores += 1
            except Exception as e:
                wa_msg_id = None
                estado_msg = "error"
                error_msg = str(e)
                errores += 1

            db2.add(WhatsAppMensaje(
                envio_id=envio_id,
                seller_id=seller.id,
                numero=numero,
                wa_message_id=wa_msg_id,
                estado=estado_msg,
                error=error_msg,
            ))
            db2.commit()

        # Números directos (sin seller asociado)
        for numero in numeros_directos:
            if not numero.startswith("+"):
                numero = "+56" + numero.lstrip("0")
            variables = {k: v for k, v in (envio.variables_valores or {}).items() if not k.startswith("_")}
            if template.wa_template_name:
                payload = _build_template_payload(template.wa_template_name, template.idioma, variables)
            else:
                payload = _build_text_payload(template.cuerpo, variables)
            try:
                resp = await _send_wa_message(numero, payload)
                wa_msg_id = resp.get("messages", [{}])[0].get("id")
                estado_msg = "enviado" if wa_msg_id else "error"
                error_msg = json.dumps(resp.get("error")) if resp.get("error") else None
                if wa_msg_id:
                    enviados += 1
                else:
                    errores += 1
            except Exception as e:
                wa_msg_id = None
                estado_msg = "error"
                error_msg = str(e)
                errores += 1
            db2.add(WhatsAppMensaje(
                envio_id=envio_id,
                seller_id=None,
                numero=numero,
                wa_message_id=wa_msg_id,
                estado=estado_msg,
                error=error_msg,
            ))
            db2.commit()

        envio.estado = "completado"
        envio.enviados = enviados
        envio.errores = errores
        envio.fecha_fin = datetime.utcnow()
        db2.commit()

    except Exception as e:
        logger.exception(f"Error ejecutando envio {envio_id}: {e}")
        envio = db2.query(WhatsAppEnvio).filter(WhatsAppEnvio.id == envio_id).first()
        if envio:
            envio.estado = "error"
            db2.commit()
    finally:
        db2.close()


# ── Endpoints: Plantillas ─────────────────────────────────────────────────────

@router.get("/templates")
def listar_templates(
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    return [
        {
            "id": t.id,
            "nombre": t.nombre,
            "categoria": t.categoria,
            "idioma": t.idioma,
            "cuerpo": t.cuerpo,
            "variables": t.variables,
            "wa_template_name": t.wa_template_name,
            "aprobada": bool(t.wa_template_name),
            "created_at": t.created_at.isoformat() if t.created_at else None,
        }
        for t in db.query(WhatsAppTemplate).filter(WhatsAppTemplate.activo == True).all()
    ]


@router.post("/templates")
def crear_template(
    body: TemplateCreate,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    t = WhatsAppTemplate(**body.model_dump())
    db.add(t)
    db.commit()
    db.refresh(t)
    return {"id": t.id, "ok": True}


@router.patch("/templates/{tid}")
def actualizar_template(
    tid: int,
    body: TemplateCreate,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    t = db.query(WhatsAppTemplate).filter(WhatsAppTemplate.id == tid).first()
    if not t:
        raise HTTPException(404)
    for k, v in body.model_dump().items():
        setattr(t, k, v)
    db.commit()
    return {"ok": True}


@router.delete("/templates/{tid}")
def eliminar_template(
    tid: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    t = db.query(WhatsAppTemplate).filter(WhatsAppTemplate.id == tid).first()
    if not t:
        raise HTTPException(404)
    t.activo = False
    db.commit()
    return {"ok": True}


# ── Endpoints: Envíos masivos ─────────────────────────────────────────────────

@router.get("/envios")
def listar_envios(
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    envios = db.query(WhatsAppEnvio).order_by(WhatsAppEnvio.id.desc()).limit(50).all()
    templates = {t.id: t.nombre for t in db.query(WhatsAppTemplate).all()}
    return [
        {
            "id": e.id,
            "nombre_campaña": e.nombre_campaña,
            "template_id": e.template_id,
            "template_nombre": templates.get(e.template_id),
            "segmento": e.segmento,
            "estado": e.estado,
            "total": e.total,
            "enviados": e.enviados,
            "errores": e.errores,
            "leidos": e.leidos,
            "respondidos": e.respondidos,
            "fecha_inicio": e.fecha_inicio.isoformat() if e.fecha_inicio else None,
            "fecha_fin": e.fecha_fin.isoformat() if e.fecha_fin else None,
        }
        for e in envios
    ]


@router.post("/envios")
async def crear_envio(
    body: EnvioCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    template = db.query(WhatsAppTemplate).filter(WhatsAppTemplate.id == body.template_id).first()
    if not template:
        raise HTTPException(404, "Plantilla no encontrada")

    # Para números directos, no se valida por sellers
    if body.segmento == "numeros_directos":
        if not body.numeros_directos:
            raise HTTPException(400, "Debes ingresar al menos un número de teléfono")
        # Guardamos los números en variables_valores con clave reservada _numeros
        variables_con_numeros = dict(body.variables_valores or {})
        variables_con_numeros["_numeros"] = ",".join(body.numeros_directos)
        envio = WhatsAppEnvio(
            template_id=body.template_id,
            segmento=body.segmento,
            seller_ids=[],
            variables_valores=variables_con_numeros,
            nombre_campaña=body.nombre_campaña or f"Test {template.nombre}",
            estado="pendiente",
            total=len(body.numeros_directos),
            enviados=0, errores=0, leidos=0, respondidos=0,
            fecha_inicio=datetime.utcnow(),
        )
        db.add(envio)
        db.commit()
        db.refresh(envio)
        background_tasks.add_task(_ejecutar_envio, envio.id, db)
        return {"envio_id": envio.id, "total": len(body.numeros_directos)}

    # Preview del segmento (sin enviar)
    sellers = _resolver_segmento(body.segmento, body.seller_ids, db,
                                  tags_filtro=body.tags_filtro, tags_modo=body.tags_modo)
    if not sellers:
        raise HTTPException(400, "No hay sellers en el segmento seleccionado con número de WhatsApp registrado")

    variables_con_meta = dict(body.variables_valores or {})
    if body.segmento == "por_tags" and body.tags_filtro:
        variables_con_meta["_tags_filtro"] = ",".join(body.tags_filtro)
        variables_con_meta["_tags_modo"] = body.tags_modo

    envio = WhatsAppEnvio(
        template_id=body.template_id,
        segmento=body.segmento,
        seller_ids=body.seller_ids,
        variables_valores=variables_con_meta,
        nombre_campaña=body.nombre_campaña or f"Campaña {template.nombre}",
        estado="pendiente",
        total=len(sellers),
        enviados=0,
        errores=0,
        leidos=0,
        respondidos=0,
        fecha_inicio=datetime.utcnow(),
    )
    db.add(envio)
    db.commit()
    db.refresh(envio)

    background_tasks.add_task(_ejecutar_envio, envio.id, db)
    return {"id": envio.id, "total": len(sellers), "estado": "pendiente"}


@router.get("/envios/{envio_id}/mensajes")
def mensajes_envio(
    envio_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    mensajes = db.query(WhatsAppMensaje).filter(
        WhatsAppMensaje.envio_id == envio_id
    ).all()
    sellers = {s.id: s.nombre for s in db.query(Seller.id, Seller.nombre).all()}
    return [
        {
            "id": m.id,
            "seller_id": m.seller_id,
            "seller_nombre": sellers.get(m.seller_id),
            "numero": m.numero,
            "estado": m.estado,
            "wa_message_id": m.wa_message_id,
            "leido": m.leido,
            "respondido": m.respondido,
            "respuesta": m.respuesta,
            "error": m.error,
            "enviado_at": m.enviado_at.isoformat() if m.enviado_at else None,
        }
        for m in mensajes
    ]


# ── Preview de segmento (antes de enviar) ────────────────────────────────────

@router.post("/segmento/preview")
def preview_segmento(
    body: EnvioCreate,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    sellers = _resolver_segmento(body.segmento, body.seller_ids, db,
                                  tags_filtro=body.tags_filtro, tags_modo=body.tags_modo)
    return {
        "total": len(sellers),
        "sellers": [
            {
                "id": s.id,
                "nombre": s.nombre,
                "telefono": s.telefono_whatsapp,
                "tiene_numero": bool(s.telefono_whatsapp),
            }
            for s in sellers[:20]
        ],
        "sin_numero": sum(1 for s in sellers if not s.telefono_whatsapp),
    }


# ── Webhook Meta (recepción de estados) ──────────────────────────────────────

@router.get("/webhook")
def webhook_verify(
    hub_mode: str = Query(None, alias="hub.mode"),
    hub_challenge: str = Query(None, alias="hub.challenge"),
    hub_verify_token: str = Query(None, alias="hub.verify_token"),
):
    """Verificación del webhook por parte de Meta."""
    if hub_mode == "subscribe" and hub_verify_token == WA_VERIFY_TOKEN:
        return PlainTextResponse(hub_challenge or "")
    raise HTTPException(403, "Token de verificación inválido")


@router.post("/webhook")
async def webhook_eventos(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Recepción de actualizaciones de estado + mensajes inbound (sellers y leads)."""
    try:
        payload = await request.json()
        for entry in payload.get("entry", []):
            for change in entry.get("changes", []):
                value = change.get("value", {})

                # ── Status updates (enviado → entregado → leído) ──────────
                for status in value.get("statuses", []):
                    wa_msg_id = status.get("id")
                    estado = status.get("status")
                    if not wa_msg_id:
                        continue

                    # Check in campaign messages
                    msg = db.query(WhatsAppMensaje).filter(
                        WhatsAppMensaje.wa_message_id == wa_msg_id
                    ).first()
                    if msg:
                        if estado == "delivered":
                            msg.estado = "entregado"
                        elif estado == "read":
                            msg.estado = "leido"
                            msg.leido = True
                        elif estado == "failed":
                            msg.estado = "error"
                            msg.error = json.dumps(status.get("errors", []))
                        db.commit()
                        if estado == "read":
                            envio = db.query(WhatsAppEnvio).filter(
                                WhatsAppEnvio.id == msg.envio_id
                            ).first()
                            if envio:
                                envio.leidos = db.query(sqlfunc.count(WhatsAppMensaje.id)).filter(
                                    WhatsAppMensaje.envio_id == envio.id,
                                    WhatsAppMensaje.leido == True,
                                ).scalar()
                                db.commit()
                        continue

                    # Check in lead messages
                    lead_msg = db.query(MensajeLead).filter(
                        MensajeLead.wa_message_id == wa_msg_id
                    ).first()
                    if lead_msg:
                        if estado in ("delivered", "read"):
                            lead_msg.estado_wa = "leido" if estado == "read" else "entregado"
                        elif estado == "failed":
                            lead_msg.estado_wa = "error"
                        db.commit()

                # ── Inbound messages ──────────────────────────────────────
                for message in value.get("messages", []):
                    from_num = message.get("from", "")
                    msg_id_inbound = message.get("id", "")
                    msg_type = message.get("type", "text")
                    texto = ""
                    tipo_contenido = "texto"

                    if msg_type == "text":
                        texto = message.get("text", {}).get("body", "")
                    elif msg_type in ("image", "audio", "video", "document", "sticker"):
                        tipo_contenido = msg_type
                        texto = message.get(msg_type, {}).get("caption", "") or f"[{msg_type}]"
                    else:
                        tipo_contenido = msg_type
                        texto = f"[{msg_type}]"

                    if not from_num:
                        continue

                    # Idempotency: skip if already processed
                    if msg_id_inbound:
                        existing = db.query(MensajeLead).filter(
                            MensajeLead.wa_message_id == msg_id_inbound
                        ).first()
                        if existing:
                            continue

                    # ── Is this a reply to a campaign message? ────────────
                    context_msg_id = message.get("context", {}).get("id")
                    if context_msg_id:
                        campaign_msg = db.query(WhatsAppMensaje).filter(
                            WhatsAppMensaje.wa_message_id == context_msg_id
                        ).first()
                        if campaign_msg:
                            campaign_msg.respondido = True
                            campaign_msg.respuesta = texto[:500]
                            campaign_msg.estado = "respondido"
                            db.commit()
                            envio = db.query(WhatsAppEnvio).filter(
                                WhatsAppEnvio.id == campaign_msg.envio_id
                            ).first()
                            if envio:
                                envio.respondidos = db.query(sqlfunc.count(WhatsAppMensaje.id)).filter(
                                    WhatsAppMensaje.envio_id == envio.id,
                                    WhatsAppMensaje.respondido == True,
                                ).scalar()
                                db.commit()
                            continue

                    # ── Is this number a known seller? Skip lead flow ─────
                    is_seller = db.query(Seller).filter(
                        Seller.telefono_whatsapp == from_num,
                        Seller.activo == True,
                    ).first()
                    if is_seller:
                        continue

                    # ── Lead flow ─────────────────────────────────────────
                    lead = db.query(Lead).filter(Lead.phone == from_num).first()
                    is_new = False

                    if not lead:
                        is_new = True
                        contact_name = ""
                        contacts = value.get("contacts", [])
                        if contacts:
                            profile = contacts[0].get("profile", {})
                            contact_name = profile.get("name", "")
                        lead = Lead(
                            phone=from_num,
                            nombre=contact_name or None,
                            etapa=EtapaLeadEnum.NUEVO.value,
                            ventana_24h_expira=datetime.utcnow() + timedelta(hours=24),
                            ultimo_mensaje_lead=datetime.utcnow(),
                        )
                        db.add(lead)
                        db.flush()

                    elif lead.etapa == EtapaLeadEnum.PERDIDO.value:
                        lead.etapa = EtapaLeadEnum.IA_GESTIONANDO.value
                        lead.interacciones_ia = 0
                        lead.estado_conversacion = "saludo"
                        lead.gestionado_por = "ia"
                        from app.services.agente_leads import _crear_notificacion
                        _crear_notificacion(db, lead, "lead_reactivado",
                                            f"Lead reactivado: {lead.nombre or lead.phone}",
                                            f"Lead que estaba perdido volvió a escribir: {texto[:200]}",
                                            prioridad="alta")

                    lead.ventana_24h_expira = datetime.utcnow() + timedelta(hours=24)
                    lead.ultimo_mensaje_lead = datetime.utcnow()

                    db.add(MensajeLead(
                        lead_id=lead.id,
                        direccion="inbound",
                        autor="lead",
                        contenido=texto,
                        tipo_contenido=tipo_contenido,
                        wa_message_id=msg_id_inbound or None,
                    ))
                    db.commit()

                    if is_new:
                        from app.services.agente_leads import _crear_notificacion
                        _crear_notificacion(db, lead, "lead_nuevo",
                                            f"Nuevo lead: {lead.nombre or lead.phone}",
                                            f"Primer mensaje: {texto[:200]}",
                                            prioridad="alta")
                        db.commit()

                    # Non-text content: acknowledge and escalate
                    if tipo_contenido != "texto":
                        lead.etapa = EtapaLeadEnum.REQUIERE_HUMANO.value
                        media_msg = "Recibí tu mensaje pero no puedo procesar ese tipo de archivo. ¿Me lo puedes escribir? O si prefieres te conecto con un ejecutivo."
                        try:
                            wa_resp = await _send_wa_message(from_num, {"type": "text", "text": {"body": media_msg}})
                            wa_out_id = wa_resp.get("messages", [{}])[0].get("id")
                        except Exception:
                            wa_out_id = None
                        db.add(MensajeLead(
                            lead_id=lead.id, direccion="outbound", autor="ia",
                            contenido=media_msg, wa_message_id=wa_out_id, tipo_contenido="texto",
                        ))
                        from app.services.agente_leads import _crear_notificacion
                        _crear_notificacion(db, lead, "requiere_humano",
                                            f"Lead envió {tipo_contenido}: {lead.nombre or lead.phone}",
                                            f"No se puede procesar {tipo_contenido}. Requiere atención humana.",
                                            prioridad="alta")
                        db.commit()
                        continue

                    # ── Trigger AI agent (in background to not block webhook) ──
                    if lead.etapa in (EtapaLeadEnum.NUEVO.value, EtapaLeadEnum.IA_GESTIONANDO.value,
                                      EtapaLeadEnum.CALIFICADO.value):
                        background_tasks.add_task(
                            _process_lead_with_agent, lead.id, texto
                        )

    except Exception as e:
        logger.exception(f"Error procesando webhook WhatsApp: {e}")

    return {"status": "ok"}


async def _send_wa_text(phone: str, text: str) -> Optional[str]:
    """Envía un texto libre por WA y retorna el wa_message_id."""
    try:
        resp = await _send_wa_message(phone, {"type": "text", "text": {"body": text}})
        return resp.get("messages", [{}])[0].get("id")
    except Exception as e:
        logger.exception("Error enviando WA a %s: %s", phone, e)
        return None


async def _process_lead_with_agent(lead_id: int, texto: str):
    """Background task: procesa mensaje del lead con el agente IA."""
    from app.database import SessionLocal
    from app.services.agente_leads import procesar_mensaje_lead
    db = SessionLocal()
    try:
        lead = db.query(Lead).filter(Lead.id == lead_id).first()
        if not lead:
            return
        await procesar_mensaje_lead(lead, texto, db, _send_wa_text)
    except Exception as e:
        logger.exception("Error en agente IA para lead %d: %s", lead_id, e)
    finally:
        db.close()
