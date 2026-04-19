"""
Email Campaigns — envío masivo de correos corporativos vía Amazon SES.

Arquitectura espejo del módulo WhatsApp (templates → envíos → mensajes).

Endpoints:
  Plantillas   GET/POST/PATCH/DELETE  /email-campaigns/templates
  Campañas     GET/POST               /email-campaigns/envios
  Detalle      GET                    /email-campaigns/envios/{id}/mensajes
  Segmento     GET                    /email-campaigns/preview-segmento
  Tracking     GET                    /email-campaigns/track/open/{mensaje_id}  (pixel)
  Webhook SNS  POST                   /email-campaigns/webhook/sns
"""
import json
import logging
import time
from datetime import date
from typing import Optional, List, Dict

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc

from app.database import get_db
from app.auth import require_admin_or_administracion
from app.models import (
    EmailPlantilla, EmailEnvio, EmailMensaje,
    Seller, SellerSnapshot,
)
from app.services.ses import send_campaign_email, substitute_variables

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/email-campaigns", tags=["Email Campaigns"])

# Pixel GIF 1x1 transparente
_PIXEL_GIF = (
    b"\x47\x49\x46\x38\x39\x61\x01\x00\x01\x00\x80\x00\x00"
    b"\xff\xff\xff\x00\x00\x00\x21\xf9\x04\x00\x00\x00\x00"
    b"\x00\x2c\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02"
    b"\x44\x01\x00\x3b"
)

# ── Schemas ───────────────────────────────────────────────────────────────────

class PlantillaCreate(BaseModel):
    nombre: str
    asunto: str
    cuerpo_html: str
    cuerpo_texto: Optional[str] = None
    variables: List[str] = []


class EnvioCreate(BaseModel):
    plantilla_id: int
    segmento: str
    seller_ids: List[int] = []
    emails_extra: List[str] = []  # destinatarios sueltos (no necesariamente sellers)
    variables_valores: Dict[str, str] = {}
    nombre_campana: Optional[str] = None


def _normalizar_emails_extra(raw: List[str]) -> List[str]:
    """Limpia, valida y deduplica una lista de correos."""
    import re
    out: List[str] = []
    seen = set()
    pat = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
    for e in raw or []:
        e = (e or "").strip().lower()
        if not e or e in seen or not pat.match(e):
            continue
        seen.add(e)
        out.append(e)
    return out


# ── Segmentación ──────────────────────────────────────────────────────────────

def _resolver_segmento_email(
    segmento: str,
    seller_ids_manual: List[int],
    db: Session,
) -> List[Seller]:
    """Devuelve sellers con email, según el segmento elegido."""
    hoy = date.today()

    q = db.query(Seller).filter(
        Seller.activo == True,
        Seller.tipo_cierre.is_(None),
        Seller.email.isnot(None),
        Seller.email != "",
    )

    if segmento == "solo_extras":
        # No se incluyen sellers; sólo correos extra (manejados aparte).
        return []

    if segmento == "manual":
        return db.query(Seller).filter(
            Seller.id.in_(seller_ids_manual),
            Seller.activo == True,
            Seller.email.isnot(None),
            Seller.email != "",
        ).all()

    if segmento == "sin_whatsapp":
        return q.filter(
            (Seller.telefono_whatsapp.is_(None)) | (Seller.telefono_whatsapp == "")
        ).all()

    if segmento == "todos":
        return q.all()

    snaps = {
        s.seller_id: s for s in
        db.query(SellerSnapshot).filter(SellerSnapshot.fecha == hoy).all()
    }

    TIER_MAP = {
        "tier_epico": lambda s: s.tier == "EPICO",
        "tier_clave":  lambda s: s.tier == "CLAVE",
        "tier_bueno":  lambda s: s.tier == "BUENO",
        "en_riesgo":   lambda s: s.estado_efectivo in ("en_riesgo", "pendiente_validacion"),
        "en_gestion":  lambda s: s.estado_efectivo in ("en_gestion", "seguimiento"),
    }
    filtro = TIER_MAP.get(segmento)
    if not filtro:
        return []
    ids_ok = {sid for sid, snap in snaps.items() if filtro(snap)}
    return q.filter(Seller.id.in_(ids_ok)).all()


# ── Envío en background ───────────────────────────────────────────────────────

def _ejecutar_envio(envio_id: int):
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        envio = db.query(EmailEnvio).filter(EmailEnvio.id == envio_id).first()
        if not envio:
            return

        plantilla = db.query(EmailPlantilla).filter(EmailPlantilla.id == envio.plantilla_id).first()
        if not plantilla:
            envio.estado = "error"
            db.commit()
            return

        envio.estado = "enviando"
        envio.fecha_inicio = __import__("datetime").datetime.utcnow()
        db.commit()

        sellers = _resolver_segmento_email(envio.segmento, envio.seller_ids or [], db)
        emails_seller = {(s.email or "").strip().lower() for s in sellers}
        extras = [e for e in (envio.emails_extra or []) if e and e.strip().lower() not in emails_seller]

        envio.total = len(sellers) + len(extras)
        db.commit()

        enviados = errores = 0
        variables_base = envio.variables_valores or {}

        # Envío a sellers (con personalización nombre/empresa).
        for seller in sellers:
            variables = {**variables_base, "nombre": seller.nombre or "", "empresa": seller.empresa or ""}
            asunto = substitute_variables(plantilla.asunto, variables)
            html = substitute_variables(plantilla.cuerpo_html, variables)
            texto = substitute_variables(plantilla.cuerpo_texto or "", variables) or None

            msg = EmailMensaje(
                envio_id=envio.id,
                seller_id=seller.id,
                email=seller.email,
                estado="pendiente",
            )
            db.add(msg)
            db.flush()

            ses_id = send_campaign_email(seller.email, asunto, html, texto, msg.id)
            if ses_id:
                msg.ses_message_id = ses_id
                msg.estado = "enviado"
                enviados += 1
            else:
                msg.estado = "error"
                msg.error = "SES no disponible o error de envío"
                errores += 1

            envio.enviados = enviados
            envio.errores = errores
            db.commit()
            time.sleep(0.05)

        # Envío a correos extra (sin seller asociado, sólo variables base).
        for email_addr in extras:
            variables = {**variables_base, "nombre": variables_base.get("nombre", ""), "empresa": variables_base.get("empresa", "")}
            asunto = substitute_variables(plantilla.asunto, variables)
            html = substitute_variables(plantilla.cuerpo_html, variables)
            texto = substitute_variables(plantilla.cuerpo_texto or "", variables) or None

            msg = EmailMensaje(
                envio_id=envio.id,
                seller_id=None,
                email=email_addr,
                estado="pendiente",
            )
            db.add(msg)
            db.flush()

            ses_id = send_campaign_email(email_addr, asunto, html, texto, msg.id)
            if ses_id:
                msg.ses_message_id = ses_id
                msg.estado = "enviado"
                enviados += 1
            else:
                msg.estado = "error"
                msg.error = "SES no disponible o error de envío"
                errores += 1

            envio.enviados = enviados
            envio.errores = errores
            db.commit()
            time.sleep(0.05)

        envio.estado = "completado"
        envio.fecha_fin = __import__("datetime").datetime.utcnow()
        db.commit()

    except Exception as exc:
        logger.error("Error en _ejecutar_envio %s: %s", envio_id, exc)
        try:
            envio = db.query(EmailEnvio).filter(EmailEnvio.id == envio_id).first()
            if envio:
                envio.estado = "error"
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


# ── Endpoints: Plantillas ─────────────────────────────────────────────────────

@router.get("/templates")
def listar_plantillas(
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    return [
        {
            "id": t.id,
            "nombre": t.nombre,
            "asunto": t.asunto,
            "cuerpo_html": t.cuerpo_html,
            "cuerpo_texto": t.cuerpo_texto,
            "variables": t.variables,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        }
        for t in db.query(EmailPlantilla).filter(EmailPlantilla.activo == True).all()
    ]


@router.post("/templates")
def crear_plantilla(
    body: PlantillaCreate,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    t = EmailPlantilla(**body.model_dump())
    db.add(t)
    db.commit()
    db.refresh(t)
    return {"id": t.id, "ok": True}


@router.patch("/templates/{tid}")
def actualizar_plantilla(
    tid: int,
    body: PlantillaCreate,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    t = db.query(EmailPlantilla).filter(EmailPlantilla.id == tid).first()
    if not t:
        raise HTTPException(404, "Plantilla no encontrada")
    for k, v in body.model_dump().items():
        setattr(t, k, v)
    db.commit()
    return {"ok": True}


@router.delete("/templates/{tid}")
def eliminar_plantilla(
    tid: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    t = db.query(EmailPlantilla).filter(EmailPlantilla.id == tid).first()
    if not t:
        raise HTTPException(404, "Plantilla no encontrada")
    t.activo = False
    db.commit()
    return {"ok": True}


# ── Endpoints: Campañas ───────────────────────────────────────────────────────

@router.get("/envios")
def listar_envios(
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    envios = db.query(EmailEnvio).order_by(EmailEnvio.id.desc()).limit(50).all()
    plantillas = {t.id: t.nombre for t in db.query(EmailPlantilla).all()}
    return [
        {
            "id": e.id,
            "nombre_campana": e.nombre_campana,
            "plantilla_id": e.plantilla_id,
            "plantilla_nombre": plantillas.get(e.plantilla_id),
            "segmento": e.segmento,
            "estado": e.estado,
            "total": e.total,
            "enviados": e.enviados,
            "errores": e.errores,
            "abiertos": e.abiertos,
            "rebotados": e.rebotados,
            "fecha_inicio": e.fecha_inicio.isoformat() if e.fecha_inicio else None,
            "fecha_fin": e.fecha_fin.isoformat() if e.fecha_fin else None,
        }
        for e in envios
    ]


@router.post("/envios")
def crear_envio(
    body: EnvioCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    plantilla = db.query(EmailPlantilla).filter(
        EmailPlantilla.id == body.plantilla_id,
        EmailPlantilla.activo == True,
    ).first()
    if not plantilla:
        raise HTTPException(404, "Plantilla no encontrada")

    sellers_preview = _resolver_segmento_email(body.segmento, body.seller_ids, db)
    extras_norm = _normalizar_emails_extra(body.emails_extra)

    if not sellers_preview and not extras_norm:
        raise HTTPException(400, "Debes elegir un segmento con destinatarios o agregar al menos un correo extra válido")

    emails_seller = {(s.email or "").strip().lower() for s in sellers_preview}
    extras_unicos = [e for e in extras_norm if e not in emails_seller]
    total_estimado = len(sellers_preview) + len(extras_unicos)

    envio = EmailEnvio(
        nombre_campana=body.nombre_campana,
        plantilla_id=body.plantilla_id,
        segmento=body.segmento,
        seller_ids=body.seller_ids,
        emails_extra=extras_norm,
        variables_valores=body.variables_valores,
        total=total_estimado,
    )
    db.add(envio)
    db.commit()
    db.refresh(envio)

    background_tasks.add_task(_ejecutar_envio, envio.id)
    return {"id": envio.id, "total_estimado": total_estimado, "ok": True}


@router.get("/envios/{envio_id}/mensajes")
def listar_mensajes(
    envio_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    envio = db.query(EmailEnvio).filter(EmailEnvio.id == envio_id).first()
    if not envio:
        raise HTTPException(404)
    mensajes = db.query(EmailMensaje).filter(EmailMensaje.envio_id == envio_id).all()
    sellers = {s.id: s.nombre for s in db.query(Seller).filter(
        Seller.id.in_([m.seller_id for m in mensajes if m.seller_id])
    ).all()}
    return [
        {
            "id": m.id,
            "seller_id": m.seller_id,
            "seller_nombre": sellers.get(m.seller_id),
            "email": m.email,
            "estado": m.estado,
            "abierto": m.abierto,
            "rebotado": m.rebotado,
            "error": m.error,
            "enviado_at": m.enviado_at.isoformat() if m.enviado_at else None,
        }
        for m in mensajes
    ]


# ── Endpoint: preview segmento ────────────────────────────────────────────────

@router.get("/preview-segmento")
def preview_segmento(
    segmento: str = Query(...),
    seller_ids: str = Query(""),
    emails_extra: str = Query(""),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    ids = [int(x) for x in seller_ids.split(",") if x.strip().isdigit()]
    sellers = _resolver_segmento_email(segmento, ids, db)
    extras = _normalizar_emails_extra([e for e in emails_extra.split(",") if e.strip()])
    emails_seller = {(s.email or "").strip().lower() for s in sellers}
    extras_unicos = [e for e in extras if e not in emails_seller]
    total = len(sellers) + len(extras_unicos)
    muestra = [s.email for s in sellers[:3]] + extras_unicos[:3]
    return {
        "total": total,
        "sellers": len(sellers),
        "extras": len(extras_unicos),
        "emails": muestra[:5],
    }


# ── Tracking pixel de aperturas ───────────────────────────────────────────────

@router.get("/track/open/{mensaje_id}")
def track_open(mensaje_id: int, db: Session = Depends(get_db)):
    msg = db.query(EmailMensaje).filter(EmailMensaje.id == mensaje_id).first()
    if msg and not msg.abierto:
        msg.abierto = True
        msg.estado = "abierto"
        envio = db.query(EmailEnvio).filter(EmailEnvio.id == msg.envio_id).first()
        if envio:
            envio.abiertos = db.query(sqlfunc.count(EmailMensaje.id)).filter(
                EmailMensaje.envio_id == envio.id,
                EmailMensaje.abierto == True,
            ).scalar()
        db.commit()
    return Response(content=_PIXEL_GIF, media_type="image/gif")


# ── Webhook SNS (rebotes y quejas desde SES) ──────────────────────────────────

@router.post("/webhook/sns")
async def webhook_sns(request: Request, db: Session = Depends(get_db)):
    """
    SES → SNS → este endpoint.
    Tipos de notificación manejados: Bounce, Complaint.
    Para confirmar la suscripción SNS también se maneja SubscriptionConfirmation.
    """
    import httpx as _httpx
    body_bytes = await request.body()
    try:
        payload = json.loads(body_bytes)
    except Exception:
        return {"ok": False}

    msg_type = payload.get("Type", "")

    if msg_type == "SubscriptionConfirmation":
        url = payload.get("SubscribeURL")
        if url:
            async with _httpx.AsyncClient() as client:
                await client.get(url)
        return {"ok": True}

    if msg_type == "Notification":
        try:
            message = json.loads(payload.get("Message", "{}"))
            notif_type = message.get("notificationType", "")

            if notif_type == "Bounce":
                for recipient in message.get("bounce", {}).get("bouncedRecipients", []):
                    email_addr = recipient.get("emailAddress", "")
                    msg = db.query(EmailMensaje).filter(
                        EmailMensaje.email == email_addr,
                        EmailMensaje.rebotado == False,
                    ).order_by(EmailMensaje.id.desc()).first()
                    if msg:
                        msg.rebotado = True
                        msg.estado = "rebotado"
                        envio = db.query(EmailEnvio).filter(EmailEnvio.id == msg.envio_id).first()
                        if envio:
                            envio.rebotados = db.query(sqlfunc.count(EmailMensaje.id)).filter(
                                EmailMensaje.envio_id == envio.id,
                                EmailMensaje.rebotado == True,
                            ).scalar()
                db.commit()

            elif notif_type == "Complaint":
                for recipient in message.get("complaint", {}).get("complainedRecipients", []):
                    email_addr = recipient.get("emailAddress", "")
                    msg = db.query(EmailMensaje).filter(
                        EmailMensaje.email == email_addr,
                    ).order_by(EmailMensaje.id.desc()).first()
                    if msg:
                        msg.estado = "queja"
                db.commit()

        except Exception as exc:
            logger.error("Error procesando webhook SNS: %s", exc)

    return {"ok": True}
