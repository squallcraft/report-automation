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
from app.models import TareaPendiente, Seller, GestionComercialEntry, Envio, SellerSnapshot

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


@router.get("/resumen-semanal")
def resumen_semanal(
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """
    Resumen de la semana actual (lunes-hoy) para la vista de inteligencia comercial.
    Incluye: tareas resueltas, nuevas alertas, sellers en movimiento, oportunidades.
    """
    hoy = date.today()
    lunes = hoy - timedelta(days=hoy.weekday())
    lunes_pasado = lunes - timedelta(weeks=1)
    domingo_pasado = lunes - timedelta(days=1)

    # ── Tareas esta semana ─────────────────────────────────────────────────────
    resueltas_semana = db.query(sqlfunc.count(TareaPendiente.id)).filter(
        TareaPendiente.estado == "resuelta",
        TareaPendiente.fecha_resolucion >= lunes,
    ).scalar() or 0

    nuevas_semana = db.query(sqlfunc.count(TareaPendiente.id)).filter(
        TareaPendiente.fecha_creacion >= lunes,
    ).scalar() or 0

    criticas_pendientes = db.query(sqlfunc.count(TareaPendiente.id)).filter(
        TareaPendiente.estado == "pendiente",
        TareaPendiente.severidad == "critico",
    ).scalar() or 0

    # ── Sellers en movimiento (últimos 7 días via snapshots) ──────────────────
    mejoraron = []
    empeoraron = []

    snaps_hoy = {
        s.seller_id: s for s in
        db.query(SellerSnapshot).filter(SellerSnapshot.fecha == hoy).all()
    }
    snaps_semana = {
        s.seller_id: s for s in
        db.query(SellerSnapshot).filter(SellerSnapshot.fecha == lunes).all()
    }

    ESTADO_SCORE = {
        "activo": 10, "recuperado": 9, "nuevo": 8, "seguimiento": 7,
        "en_gestion": 6, "en_pausa_lifecycle": 4, "en_pausa": 4,
        "en_riesgo": 3, "inactivo": 2, "pendiente_validacion": 1,
        "perdido": 0, "cerrado": -1,
    }
    sellers_map = {s.id: s.nombre for s in db.query(Seller.id, Seller.nombre).all()}

    for sid, snap_hoy in snaps_hoy.items():
        snap_ant = snaps_semana.get(sid)
        if not snap_ant:
            continue
        score_hoy = ESTADO_SCORE.get(snap_hoy.estado_efectivo or "", 5)
        score_ant = ESTADO_SCORE.get(snap_ant.estado_efectivo or "", 5)
        delta = score_hoy - score_ant
        if delta >= 2:
            mejoraron.append({
                "seller_id": sid,
                "nombre": sellers_map.get(sid, f"Seller {sid}"),
                "estado_anterior": snap_ant.estado_efectivo,
                "estado_actual": snap_hoy.estado_efectivo,
                "tier": snap_hoy.tier,
            })
        elif delta <= -2:
            empeoraron.append({
                "seller_id": sid,
                "nombre": sellers_map.get(sid, f"Seller {sid}"),
                "estado_anterior": snap_ant.estado_efectivo,
                "estado_actual": snap_hoy.estado_efectivo,
                "tier": snap_hoy.tier,
                "vol_mes": snap_hoy.vol_mes,
            })

    # Ordenar empeoraron por tier (más importantes primero)
    TIER_SCORE = {"EPICO": 0, "CLAVE": 1, "DESTACADO": 2, "BUENO": 3, "NORMAL": 4}
    empeoraron.sort(key=lambda x: TIER_SCORE.get(x["tier"] or "NORMAL", 4))
    mejoraron.sort(key=lambda x: TIER_SCORE.get(x["tier"] or "NORMAL", 4))

    # ── Top oportunidades: sellers creciendo este mes vs mes anterior ─────────
    mes_actual = hoy.month
    mes_anterior = mes_actual - 1 if mes_actual > 1 else 12
    anio_actual = hoy.year
    anio_anterior = anio_actual if mes_actual > 1 else anio_actual - 1

    vol_mes_actual = {
        r.seller_id: r.paquetes for r in
        db.query(Envio.seller_id, sqlfunc.count(Envio.id).label("paquetes"))
        .filter(Envio.anio == anio_actual, Envio.mes == mes_actual, Envio.seller_id.isnot(None))
        .group_by(Envio.seller_id).all()
    }
    vol_mes_anterior = {
        r.seller_id: r.paquetes for r in
        db.query(Envio.seller_id, sqlfunc.count(Envio.id).label("paquetes"))
        .filter(Envio.anio == anio_anterior, Envio.mes == mes_anterior, Envio.seller_id.isnot(None))
        .group_by(Envio.seller_id).all()
    }

    oportunidades = []
    sellers_activos = {s.id: s for s in db.query(Seller).filter(Seller.activo == True).all()}
    for sid, vol_act in vol_mes_actual.items():
        vol_ant = vol_mes_anterior.get(sid, 0)
        if vol_ant > 0 and vol_act > vol_ant:
            delta_pct = round((vol_act - vol_ant) / vol_ant * 100)
            if delta_pct >= 20:
                seller = sellers_activos.get(sid)
                if seller and not seller.tipo_cierre:
                    oportunidades.append({
                        "seller_id": sid,
                        "nombre": sellers_map.get(sid, f"Seller {sid}"),
                        "vol_actual": vol_act,
                        "vol_anterior": vol_ant,
                        "delta_pct": delta_pct,
                        "tier": snaps_hoy.get(sid, {}).tier if hasattr(snaps_hoy.get(sid, {}), "tier") else None,
                    })

    oportunidades.sort(key=lambda x: -x["delta_pct"])

    # ── Seguimientos pendientes de CRM vencidos esta semana ───────────────────
    recordatorios_vencidos = db.query(TareaPendiente).filter(
        TareaPendiente.tipo == "seguimiento_crm",
        TareaPendiente.estado == "pendiente",
    ).count()

    return {
        "periodo": {"desde": lunes.isoformat(), "hasta": hoy.isoformat()},
        "tareas": {
            "resueltas_semana": resueltas_semana,
            "nuevas_semana": nuevas_semana,
            "criticas_pendientes": criticas_pendientes,
            "seguimientos_vencidos": recordatorios_vencidos,
        },
        "movimiento": {
            "mejoraron": mejoraron[:5],
            "empeoraron": empeoraron[:5],
        },
        "oportunidades": oportunidades[:5],
    }
