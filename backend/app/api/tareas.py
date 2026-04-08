"""
Bandeja de tareas pendientes — Módulo B del sistema de inteligencia comercial.

Tipos de tareas:
  validar_perdido   → seller 90+ días sin envíos, requiere validación humana
  contactar_riesgo  → seller 30-89 días sin envíos, señal temprana
  seguimiento_crm   → recordatorio de gestión comercial vencido
  factura_vencida   → factura sin pagar >30 días (futuro, cuando billing esté conectado)
  tier_cambio       → seller cambió de tier (sube o baja)
  manual            → tarea creada manualmente por el operador
"""
from datetime import datetime, date, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc

from app.database import get_db
from app.auth import require_admin_or_administracion
from app.models import TareaPendiente, Seller, GestionComercialEntry, Envio

router = APIRouter(prefix="/tareas", tags=["Tareas"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class TareaOut(BaseModel):
    id: int
    tipo: str
    severidad: str
    seller_id: Optional[int] = None
    seller_nombre: Optional[str] = None
    titulo: str
    descripcion: Optional[str] = None
    estado: str
    resuelta_por: Optional[str] = None
    fecha_creacion: datetime
    fecha_resolucion: Optional[datetime] = None
    datos: dict = {}

    model_config = {"from_attributes": True}


class TareaCreateBody(BaseModel):
    tipo: str = "manual"
    severidad: str = "alerta"
    seller_id: Optional[int] = None
    titulo: str
    descripcion: Optional[str] = None
    datos: dict = {}


class TareaResolverBody(BaseModel):
    resuelta_por: Optional[str] = None
    accion: Optional[str] = None  # nota libre de qué se hizo


# ── Helpers ───────────────────────────────────────────────────────────────────

def _seller_nombre(db: Session, seller_id: Optional[int]) -> Optional[str]:
    if not seller_id:
        return None
    s = db.query(Seller.nombre).filter(Seller.id == seller_id).first()
    return s.nombre if s else None


def _tarea_to_dict(t: TareaPendiente, db: Session) -> dict:
    return {
        "id": t.id,
        "tipo": t.tipo,
        "severidad": t.severidad,
        "seller_id": t.seller_id,
        "seller_nombre": _seller_nombre(db, t.seller_id),
        "titulo": t.titulo,
        "descripcion": t.descripcion,
        "estado": t.estado,
        "resuelta_por": t.resuelta_por,
        "fecha_creacion": t.fecha_creacion,
        "fecha_resolucion": t.fecha_resolucion,
        "datos": t.datos or {},
    }


# ── Auto-generación de tareas ─────────────────────────────────────────────────

def generar_tareas_auto(db: Session):
    """
    Ejecutar periódicamente (al cargar el sistema o programado).
    Genera tareas para señales detectadas que aún no tienen tarea abierta.
    """
    hoy = date.today()

    # ── Sellers sin actividad reciente ────────────────────────────────────────
    # Calcular último mes con envíos por seller
    ultimos = (
        db.query(Envio.seller_id, sqlfunc.max(Envio.fecha_ingreso).label("ultima"))
        .filter(Envio.seller_id.isnot(None))
        .group_by(Envio.seller_id)
        .all()
    )
    sellers_activos = {s.id: s for s in db.query(Seller).filter(Seller.activo == True).all()}

    for row in ultimos:
        sid = row.seller_id
        if sid not in sellers_activos:
            continue
        seller = sellers_activos[sid]
        if seller.tipo_cierre in ("cerrado", "desactivado", "pausa"):
            continue

        ultima = row.ultima
        if not ultima:
            continue
        dias_sin = (hoy - ultima).days

        # 90+ días sin envíos → validar_perdido
        if dias_sin >= 90 and not seller.estacional:
            existe = db.query(TareaPendiente).filter(
                TareaPendiente.seller_id == sid,
                TareaPendiente.tipo == "validar_perdido",
                TareaPendiente.estado == "pendiente",
            ).first()
            if not existe:
                db.add(TareaPendiente(
                    tipo="validar_perdido",
                    severidad="critico",
                    seller_id=sid,
                    titulo=f"{seller.nombre}: {dias_sin} días sin envíos",
                    descripcion=f"El sistema propone marcar como perdido. Validar si es baja definitiva, pausa o estacional.",
                    datos={"dias_sin_actividad": dias_sin, "ultimo_envio": ultima.isoformat()},
                ))

        # 30-89 días sin envíos → contactar_riesgo
        elif 30 <= dias_sin < 90:
            existe = db.query(TareaPendiente).filter(
                TareaPendiente.seller_id == sid,
                TareaPendiente.tipo == "contactar_riesgo",
                TareaPendiente.estado == "pendiente",
            ).first()
            if not existe:
                db.add(TareaPendiente(
                    tipo="contactar_riesgo",
                    severidad="alerta",
                    seller_id=sid,
                    titulo=f"{seller.nombre}: {dias_sin} días sin envíos",
                    descripcion=f"Señal temprana de riesgo. Contactar para entender situación.",
                    datos={"dias_sin_actividad": dias_sin, "ultimo_envio": ultima.isoformat()},
                ))

    # ── Recordatorios de gestión comercial vencidos ───────────────────────────
    recordatorios = (
        db.query(GestionComercialEntry)
        .filter(
            GestionComercialEntry.recordatorio.isnot(None),
            GestionComercialEntry.recordatorio <= hoy,
        )
        .all()
    )
    for entry in recordatorios:
        existe = db.query(TareaPendiente).filter(
            TareaPendiente.seller_id == entry.seller_id,
            TareaPendiente.tipo == "seguimiento_crm",
            TareaPendiente.estado == "pendiente",
            TareaPendiente.datos["gestion_id"].as_integer() == entry.id,
        ).first()
        if not existe:
            seller = sellers_activos.get(entry.seller_id)
            nombre = seller.nombre if seller else f"Seller {entry.seller_id}"
            db.add(TareaPendiente(
                tipo="seguimiento_crm",
                severidad="alerta",
                seller_id=entry.seller_id,
                titulo=f"Seguimiento programado: {nombre}",
                descripcion=entry.nota[:120] if entry.nota else None,
                datos={"gestion_id": entry.id, "recordatorio": entry.recordatorio.isoformat()},
            ))

    db.commit()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/generar-auto", status_code=200)
def trigger_generar_tareas(
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Genera tareas automáticas basadas en señales del sistema."""
    generar_tareas_auto(db)
    return {"ok": True}


@router.get("/count")
def count_tareas(
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Conteo rápido para el badge de notificaciones."""
    total = db.query(sqlfunc.count(TareaPendiente.id)).filter(
        TareaPendiente.estado == "pendiente"
    ).scalar()
    criticas = db.query(sqlfunc.count(TareaPendiente.id)).filter(
        TareaPendiente.estado == "pendiente",
        TareaPendiente.severidad == "critico",
    ).scalar()
    return {"total": total, "criticas": criticas}


@router.get("")
def listar_tareas(
    estado: Optional[str] = Query(None),
    severidad: Optional[str] = Query(None),
    tipo: Optional[str] = Query(None),
    seller_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    q = db.query(TareaPendiente)
    if estado:
        q = q.filter(TareaPendiente.estado == estado)
    else:
        q = q.filter(TareaPendiente.estado == "pendiente")
    if severidad:
        q = q.filter(TareaPendiente.severidad == severidad)
    if tipo:
        q = q.filter(TareaPendiente.tipo == tipo)
    if seller_id:
        q = q.filter(TareaPendiente.seller_id == seller_id)

    SEV_ORDER = {"critico": 0, "alerta": 1, "info": 2}
    tareas = q.order_by(TareaPendiente.fecha_creacion.desc()).all()
    tareas.sort(key=lambda t: SEV_ORDER.get(t.severidad, 9))

    return [_tarea_to_dict(t, db) for t in tareas]


@router.post("")
def crear_tarea(
    body: TareaCreateBody,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    t = TareaPendiente(**body.model_dump())
    db.add(t)
    db.commit()
    db.refresh(t)
    return _tarea_to_dict(t, db)


@router.patch("/{tarea_id}/resolver")
def resolver_tarea(
    tarea_id: int,
    body: TareaResolverBody,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    t = db.query(TareaPendiente).filter(TareaPendiente.id == tarea_id).first()
    if not t:
        raise HTTPException(404, "Tarea no encontrada")
    t.estado = "resuelta"
    t.resuelta_por = body.resuelta_por
    t.fecha_resolucion = datetime.utcnow()
    if body.accion:
        t.datos = {**(t.datos or {}), "accion": body.accion}
    db.commit()
    return _tarea_to_dict(t, db)


@router.patch("/{tarea_id}/descartar")
def descartar_tarea(
    tarea_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    t = db.query(TareaPendiente).filter(TareaPendiente.id == tarea_id).first()
    if not t:
        raise HTTPException(404, "Tarea no encontrada")
    t.estado = "descartada"
    t.fecha_resolucion = datetime.utcnow()
    db.commit()
    return {"ok": True}


@router.delete("/{tarea_id}")
def eliminar_tarea(
    tarea_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    t = db.query(TareaPendiente).filter(TareaPendiente.id == tarea_id).first()
    if not t:
        raise HTTPException(404, "Tarea no encontrada")
    db.delete(t)
    db.commit()
    return {"ok": True}
