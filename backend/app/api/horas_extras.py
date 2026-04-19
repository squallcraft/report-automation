"""
Router para gestión de horas extras de trabajadores (50% y 100%).

Endpoints:
  GET  /horas-extras/?mes=&anio=                        — lista todas del mes
  GET  /horas-extras/trabajador/{id}                     — historial de un trabajador
  POST /horas-extras/                                    — crea/actualiza HE de un mes
  DELETE /horas-extras/{id}
"""
from __future__ import annotations

from datetime import date
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import require_admin_or_administracion
from app.models import HoraExtraTrabajador, Trabajador
from app.services.contratos import (
    obtener_version_para_mes,
    calcular_monto_he,
    calcular_valor_hora,
)

router = APIRouter(prefix="/horas-extras", tags=["Horas Extras"])


class HoraExtraIn(BaseModel):
    trabajador_id: int
    mes: int = Field(..., ge=1, le=12)
    anio: int = Field(..., ge=2020, le=2100)
    cantidad_50: float = Field(default=0, ge=0)
    cantidad_100: float = Field(default=0, ge=0)
    nota: Optional[str] = None


def _to_dict(h: HoraExtraTrabajador, t: Optional[Trabajador] = None) -> dict:
    return {
        "id": h.id,
        "trabajador_id": h.trabajador_id,
        "trabajador_nombre": t.nombre if t else None,
        "mes": h.mes,
        "anio": h.anio,
        "cantidad_50": float(h.cantidad_50 or 0),
        "cantidad_100": float(h.cantidad_100 or 0),
        "valor_hora_calculado": h.valor_hora_calculado,
        "monto_50": h.monto_50,
        "monto_100": h.monto_100,
        "monto_total": h.monto_total,
        "sueldo_base_snapshot": h.sueldo_base_snapshot,
        "jornada_snapshot": h.jornada_snapshot,
        "nota": h.nota,
        "creado_por": h.creado_por,
        "created_at": h.created_at.isoformat() if h.created_at else None,
        "updated_at": h.updated_at.isoformat() if h.updated_at else None,
    }


@router.get("/")
def listar(
    mes: int = Query(..., ge=1, le=12),
    anio: int = Query(..., ge=2020),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    rows = (
        db.query(HoraExtraTrabajador)
        .filter_by(mes=mes, anio=anio)
        .order_by(HoraExtraTrabajador.trabajador_id)
        .all()
    )
    trab_ids = [r.trabajador_id for r in rows]
    tmap = {t.id: t for t in db.query(Trabajador).filter(Trabajador.id.in_(trab_ids)).all()}
    return [_to_dict(r, tmap.get(r.trabajador_id)) for r in rows]


@router.get("/trabajador/{trabajador_id}")
def historial_trabajador(
    trabajador_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    rows = (
        db.query(HoraExtraTrabajador)
        .filter_by(trabajador_id=trabajador_id)
        .order_by(HoraExtraTrabajador.anio.desc(), HoraExtraTrabajador.mes.desc())
        .all()
    )
    return [_to_dict(r) for r in rows]


@router.post("/")
def upsert_horas_extras(
    payload: HoraExtraIn,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    t = db.get(Trabajador, payload.trabajador_id)
    if not t:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")

    if payload.cantidad_50 == 0 and payload.cantidad_100 == 0:
        # Eliminar el registro si existe (sin HE)
        existing = (
            db.query(HoraExtraTrabajador)
            .filter_by(trabajador_id=payload.trabajador_id, mes=payload.mes, anio=payload.anio)
            .first()
        )
        if existing:
            db.delete(existing)
            db.commit()
        return {"deleted": True}

    # Calcular monto con la versión vigente
    version = obtener_version_para_mes(db, t.id, payload.mes, payload.anio)
    sueldo_base = (version.sueldo_base if version else None) or (t.sueldo_base or 0)
    jornada = (version.jornada_semanal_horas if version else None) or 44

    he_calc = calcular_monto_he(sueldo_base, jornada, payload.cantidad_50, payload.cantidad_100)

    existing = (
        db.query(HoraExtraTrabajador)
        .filter_by(trabajador_id=payload.trabajador_id, mes=payload.mes, anio=payload.anio)
        .first()
    )
    if existing:
        h = existing
    else:
        h = HoraExtraTrabajador(
            trabajador_id=payload.trabajador_id,
            mes=payload.mes,
            anio=payload.anio,
        )
        db.add(h)

    h.cantidad_50 = payload.cantidad_50
    h.cantidad_100 = payload.cantidad_100
    h.valor_hora_calculado = he_calc["valor_hora"]
    h.monto_50 = he_calc["monto_50"]
    h.monto_100 = he_calc["monto_100"]
    h.monto_total = he_calc["monto_total"]
    h.contrato_version_id = version.id if version else None
    h.sueldo_base_snapshot = sueldo_base
    h.jornada_snapshot = jornada
    h.nota = payload.nota
    h.creado_por = current_user.get("nombre") or current_user.get("username")

    db.commit()
    db.refresh(h)
    return _to_dict(h, t)


@router.delete("/{he_id}")
def eliminar(
    he_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    h = db.get(HoraExtraTrabajador, he_id)
    if not h:
        raise HTTPException(status_code=404, detail="Registro no encontrado")
    db.delete(h)
    db.commit()
    return {"deleted": True}


@router.get("/preview")
def preview_calculo(
    trabajador_id: int = Query(...),
    mes: int = Query(..., ge=1, le=12),
    anio: int = Query(..., ge=2020),
    cantidad_50: float = Query(default=0, ge=0),
    cantidad_100: float = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    """Pre-cálculo en vivo (no persiste) usando la versión contractual vigente."""
    t = db.get(Trabajador, trabajador_id)
    if not t:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")
    version = obtener_version_para_mes(db, t.id, mes, anio)
    sueldo_base = (version.sueldo_base if version else None) or (t.sueldo_base or 0)
    jornada = (version.jornada_semanal_horas if version else None) or 44
    calc = calcular_monto_he(sueldo_base, jornada, cantidad_50, cantidad_100)
    return {
        "trabajador_id": t.id,
        "trabajador_nombre": t.nombre,
        "mes": mes,
        "anio": anio,
        "sueldo_base_usado": sueldo_base,
        "jornada_usada": jornada,
        "valor_hora": calc["valor_hora"],
        "monto_50": calc["monto_50"],
        "monto_100": calc["monto_100"],
        "monto_total": calc["monto_total"],
    }
