"""
API de gestión de Leads WhatsApp: CRUD, inbox, KB, notificaciones.
"""
from typing import Optional, List
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc, desc

from app.database import get_db
from app.auth import require_admin_or_administracion
from app.models import (
    Lead, MensajeLead, ConocimientoAgente, NotificacionComercial,
    EtapaLeadEnum, TemperaturaLeadEnum,
)

router = APIRouter(prefix="/leads", tags=["Leads"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class LeadOut(BaseModel):
    id: int
    phone: str
    nombre: Optional[str] = None
    email: Optional[str] = None
    origen: Optional[str] = None
    negocio: Optional[str] = None
    canal_venta: Optional[str] = None
    volumen_estimado: Optional[str] = None
    ubicacion: Optional[str] = None
    intencion: Optional[str] = None
    etapa: str
    temperatura: str
    resumen_ia: Optional[str] = None
    asignado_a: Optional[str] = None
    notas_humano: Optional[str] = None
    tags: list = []
    gestionado_por: Optional[str] = None
    interacciones_ia: int = 0
    ultimo_mensaje_lead: Optional[str] = None
    ventana_24h_expira: Optional[str] = None
    created_at: Optional[str] = None

    class Config:
        from_attributes = True


class LeadUpdate(BaseModel):
    nombre: Optional[str] = None
    email: Optional[str] = None
    origen: Optional[str] = None
    etapa: Optional[str] = None
    temperatura: Optional[str] = None
    asignado_a: Optional[str] = None
    notas_humano: Optional[str] = None
    tags: Optional[list] = None
    negocio: Optional[str] = None
    canal_venta: Optional[str] = None
    volumen_estimado: Optional[str] = None
    ubicacion: Optional[str] = None


class MensajeOut(BaseModel):
    id: int
    direccion: str
    autor: str
    contenido: str
    tipo_contenido: str
    estado_wa: Optional[str] = None
    timestamp: Optional[str] = None

    class Config:
        from_attributes = True


class KBEntryCreate(BaseModel):
    categoria: str
    titulo: str
    contenido: str
    keywords: list = []
    orden: int = 0


class KBEntryUpdate(BaseModel):
    categoria: Optional[str] = None
    titulo: Optional[str] = None
    contenido: Optional[str] = None
    keywords: Optional[list] = None
    activo: Optional[bool] = None
    orden: Optional[int] = None


class EnviarMensajeRequest(BaseModel):
    contenido: str


# ── Leads CRUD ────────────────────────────────────────────────────────────────

def _lead_to_dict(lead: Lead) -> dict:
    return {
        "id": lead.id,
        "phone": lead.phone,
        "nombre": lead.nombre,
        "email": lead.email,
        "origen": lead.origen,
        "negocio": lead.negocio,
        "canal_venta": lead.canal_venta,
        "volumen_estimado": lead.volumen_estimado,
        "ubicacion": lead.ubicacion,
        "intencion": lead.intencion,
        "etapa": lead.etapa,
        "temperatura": lead.temperatura,
        "resumen_ia": lead.resumen_ia,
        "asignado_a": lead.asignado_a,
        "notas_humano": lead.notas_humano,
        "tags": lead.tags or [],
        "gestionado_por": lead.gestionado_por,
        "interacciones_ia": lead.interacciones_ia or 0,
        "ultimo_mensaje_lead": str(lead.ultimo_mensaje_lead) if lead.ultimo_mensaje_lead else None,
        "ventana_24h_expira": str(lead.ventana_24h_expira) if lead.ventana_24h_expira else None,
        "created_at": str(lead.created_at) if lead.created_at else None,
        "ultimo_mensaje_preview": None,
        "mensajes_no_leidos": 0,
    }


@router.get("")
def listar_leads(
    etapa: Optional[str] = None,
    temperatura: Optional[str] = None,
    search: Optional[str] = None,
    sort_by: str = "ultimo_mensaje_lead",
    sort_dir: str = "desc",
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    query = db.query(Lead)
    if etapa:
        query = query.filter(Lead.etapa == etapa)
    if temperatura:
        query = query.filter(Lead.temperatura == temperatura)
    if search:
        s = f"%{search}%"
        query = query.filter(
            (Lead.nombre.ilike(s)) | (Lead.phone.ilike(s)) |
            (Lead.negocio.ilike(s)) | (Lead.email.ilike(s))
        )

    total = query.count()
    allowed = {"ultimo_mensaje_lead", "created_at", "temperatura", "etapa", "nombre"}
    col = getattr(Lead, sort_by if sort_by in allowed else "ultimo_mensaje_lead")
    if sort_dir == "asc":
        query = query.order_by(col.asc().nullslast())
    else:
        query = query.order_by(col.desc().nullsfirst())

    leads = query.offset(offset).limit(limit).all()
    result = []
    for lead in leads:
        d = _lead_to_dict(lead)
        last_msg = db.query(MensajeLead).filter(
            MensajeLead.lead_id == lead.id
        ).order_by(MensajeLead.timestamp.desc()).first()
        if last_msg:
            d["ultimo_mensaje_preview"] = last_msg.contenido[:80] if last_msg.contenido else None
        result.append(d)

    return {"total": total, "leads": result}


@router.get("/pipeline")
def pipeline(
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Leads agrupados por etapa para vista kanban."""
    etapas = [e.value for e in EtapaLeadEnum]
    result = {}
    for etapa in etapas:
        leads = db.query(Lead).filter(Lead.etapa == etapa).order_by(
            Lead.ultimo_mensaje_lead.desc().nullslast()
        ).limit(50).all()
        result[etapa] = [_lead_to_dict(l) for l in leads]
    return result


@router.get("/stats")
def lead_stats(
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    total = db.query(Lead).count()
    by_etapa = db.query(Lead.etapa, sqlfunc.count(Lead.id)).group_by(Lead.etapa).all()
    by_temp = db.query(Lead.temperatura, sqlfunc.count(Lead.id)).group_by(Lead.temperatura).all()
    return {
        "total": total,
        "por_etapa": {e: c for e, c in by_etapa},
        "por_temperatura": {t: c for t, c in by_temp},
    }


@router.get("/{lead_id}")
def obtener_lead(
    lead_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    lead = db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(404, "Lead no encontrado")
    d = _lead_to_dict(lead)
    d["wa_link"] = f"https://wa.me/{lead.phone.lstrip('+')}"
    return d


@router.patch("/{lead_id}")
def actualizar_lead(
    lead_id: int,
    body: LeadUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    lead = db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(404, "Lead no encontrado")
    for field, val in body.model_dump(exclude_unset=True).items():
        setattr(lead, field, val)
    db.commit()
    return _lead_to_dict(lead)


# ── Mensajes / Inbox ─────────────────────────────────────────────────────────

@router.get("/{lead_id}/mensajes")
def listar_mensajes(
    lead_id: int,
    limit: int = 100,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    lead = db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(404, "Lead no encontrado")
    msgs = db.query(MensajeLead).filter(
        MensajeLead.lead_id == lead_id
    ).order_by(MensajeLead.timestamp.asc()).limit(limit).all()
    return [
        {
            "id": m.id, "direccion": m.direccion, "autor": m.autor,
            "contenido": m.contenido, "tipo_contenido": m.tipo_contenido,
            "estado_wa": m.estado_wa, "meta_datos": m.meta_datos,
            "timestamp": str(m.timestamp) if m.timestamp else None,
        }
        for m in msgs
    ]


@router.post("/{lead_id}/mensajes")
async def enviar_mensaje_humano(
    lead_id: int,
    body: EnviarMensajeRequest,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Envía un mensaje como humano al lead vía WhatsApp."""
    lead = db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(404, "Lead no encontrado")

    from app.api.whatsapp import _send_wa_text
    wa_id = await _send_wa_text(lead.phone, body.contenido)

    db.add(MensajeLead(
        lead_id=lead.id, direccion="outbound", autor="humano",
        contenido=body.contenido, wa_message_id=wa_id, tipo_contenido="texto",
    ))
    if lead.gestionado_por == "ia":
        lead.gestionado_por = "mixto"
    db.commit()
    return {"ok": True, "wa_message_id": wa_id}


# ── Knowledge Base ───────────────────────────────────────────────────────────

@router.get("/kb/entries")
def listar_kb(
    categoria: Optional[str] = None,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    query = db.query(ConocimientoAgente)
    if categoria:
        query = query.filter(ConocimientoAgente.categoria == categoria)
    entries = query.order_by(ConocimientoAgente.orden, ConocimientoAgente.categoria).all()
    return [
        {
            "id": e.id, "categoria": e.categoria, "titulo": e.titulo,
            "contenido": e.contenido, "keywords": e.keywords or [],
            "activo": e.activo, "orden": e.orden,
        }
        for e in entries
    ]


@router.post("/kb/entries")
def crear_kb_entry(
    body: KBEntryCreate,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    entry = ConocimientoAgente(
        categoria=body.categoria, titulo=body.titulo,
        contenido=body.contenido, keywords=body.keywords, orden=body.orden,
    )
    db.add(entry)
    db.commit()
    from app.services.agente_leads import _kb_cache_ts
    import app.services.agente_leads as agente_mod
    agente_mod._kb_cache_ts = 0
    return {"id": entry.id, "ok": True}


@router.patch("/kb/entries/{entry_id}")
def actualizar_kb_entry(
    entry_id: int,
    body: KBEntryUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    entry = db.get(ConocimientoAgente, entry_id)
    if not entry:
        raise HTTPException(404, "Entrada no encontrada")
    for field, val in body.model_dump(exclude_unset=True).items():
        setattr(entry, field, val)
    entry.updated_at = datetime.utcnow()
    db.commit()
    import app.services.agente_leads as agente_mod
    agente_mod._kb_cache_ts = 0
    return {"ok": True}


@router.delete("/kb/entries/{entry_id}")
def eliminar_kb_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    entry = db.get(ConocimientoAgente, entry_id)
    if not entry:
        raise HTTPException(404, "Entrada no encontrada")
    db.delete(entry)
    db.commit()
    import app.services.agente_leads as agente_mod
    agente_mod._kb_cache_ts = 0
    return {"ok": True}


# ── Notificaciones ───────────────────────────────────────────────────────────

@router.get("/notificaciones/all")
def listar_notificaciones(
    solo_no_leidas: bool = False,
    limit: int = 50,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    query = db.query(NotificacionComercial)
    if solo_no_leidas:
        query = query.filter(NotificacionComercial.leida == False)
    notifs = query.order_by(NotificacionComercial.created_at.desc()).limit(limit).all()
    return [
        {
            "id": n.id, "lead_id": n.lead_id, "tipo": n.tipo,
            "titulo": n.titulo, "detalle": n.detalle,
            "prioridad": n.prioridad, "leida": n.leida,
            "accion_url": n.accion_url,
            "created_at": str(n.created_at) if n.created_at else None,
        }
        for n in notifs
    ]


@router.get("/notificaciones/count")
def contar_notificaciones(
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    no_leidas = db.query(NotificacionComercial).filter(
        NotificacionComercial.leida == False
    ).count()
    return {"no_leidas": no_leidas}


@router.patch("/notificaciones/{notif_id}/leer")
def marcar_leida(
    notif_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    n = db.get(NotificacionComercial, notif_id)
    if not n:
        raise HTTPException(404, "Notificación no encontrada")
    n.leida = True
    db.commit()
    return {"ok": True}


@router.post("/notificaciones/leer-todas")
def marcar_todas_leidas(
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    db.query(NotificacionComercial).filter(
        NotificacionComercial.leida == False
    ).update({"leida": True})
    db.commit()
    return {"ok": True}
