"""
API Trabajadores: CRUD de trabajadores y pagos vía cartola bancaria.
"""
import io
from difflib import SequenceMatcher
from typing import Optional, List

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc

from app.database import get_db
from app.auth import require_admin, require_admin_or_administracion, require_permission
from app.models import Trabajador, PagoTrabajador, Prestamo
from app.schemas import TrabajadorCreate, TrabajadorUpdate, TrabajadorOut
from app.services.audit import registrar as audit

router = APIRouter(prefix="/trabajadores", tags=["trabajadores"])


# ── CRUD ──

@router.get("", response_model=List[TrabajadorOut])
def listar_trabajadores(
    activo: Optional[bool] = None,
    q: Optional[str] = None,
    db: Session = Depends(get_db),
    _=require_permission("trabajadores:ver"),
):
    query = db.query(Trabajador)
    if activo is not None:
        query = query.filter(Trabajador.activo == activo)
    if q:
        query = query.filter(Trabajador.nombre.ilike(f"%{q}%"))
    return query.order_by(Trabajador.nombre).all()


@router.get("/{trabajador_id}", response_model=TrabajadorOut)
def obtener_trabajador(
    trabajador_id: int,
    db: Session = Depends(get_db),
    _=require_permission("trabajadores:ver"),
):
    t = db.get(Trabajador, trabajador_id)
    if not t:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")
    return t


@router.post("", response_model=TrabajadorOut, status_code=201)
def crear_trabajador(
    data: TrabajadorCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("trabajadores:editar")),
):
    t = Trabajador(**data.model_dump())
    db.add(t)
    db.commit()
    db.refresh(t)
    audit(db, "crear_trabajador", usuario=current_user, request=request,
          entidad="trabajador", entidad_id=t.id,
          cambios={"nombre": t.nombre})
    db.commit()
    return t


@router.put("/{trabajador_id}", response_model=TrabajadorOut)
def actualizar_trabajador(
    trabajador_id: int,
    data: TrabajadorUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("trabajadores:editar")),
):
    t = db.get(Trabajador, trabajador_id)
    if not t:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(t, field, value)
    audit(db, "actualizar_trabajador", usuario=current_user, request=request,
          entidad="trabajador", entidad_id=t.id, cambios=update_data)
    db.commit()
    db.refresh(t)
    return t


@router.delete("/{trabajador_id}")
def eliminar_trabajador(
    trabajador_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("trabajadores:editar")),
):
    t = db.get(Trabajador, trabajador_id)
    if not t:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")
    t.activo = False
    audit(db, "desactivar_trabajador", usuario=current_user, request=request,
          entidad="trabajador", entidad_id=t.id)
    db.commit()
    return {"ok": True}


# ── Pagos ──

@router.get("/{trabajador_id}/pagos")
def listar_pagos(
    trabajador_id: int,
    db: Session = Depends(get_db),
    _=require_permission("trabajadores:ver"),
):
    pagos = db.query(PagoTrabajador).filter(
        PagoTrabajador.trabajador_id == trabajador_id,
    ).order_by(PagoTrabajador.anio.desc(), PagoTrabajador.mes.desc()).all()
    return [
        {
            "id": p.id, "mes": p.mes, "anio": p.anio,
            "monto": p.monto, "fecha_pago": p.fecha_pago,
            "descripcion": p.descripcion, "fuente": p.fuente,
        }
        for p in pagos
    ]


class PagoManualRequest(BaseModel):
    mes: int
    anio: int
    monto: int
    fecha_pago: Optional[str] = None
    descripcion: Optional[str] = None


@router.post("/{trabajador_id}/pagos")
def registrar_pago_manual(
    trabajador_id: int,
    body: PagoManualRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("trabajadores:editar")),
):
    t = db.get(Trabajador, trabajador_id)
    if not t:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")
    pago = PagoTrabajador(
        trabajador_id=trabajador_id,
        mes=body.mes, anio=body.anio,
        monto=body.monto,
        fecha_pago=body.fecha_pago,
        descripcion=body.descripcion,
        fuente="manual",
    )
    db.add(pago)
    audit(db, "pago_manual_trabajador", usuario=current_user, request=request,
          entidad="trabajador", entidad_id=trabajador_id,
          metadata={"monto": body.monto, "mes": body.mes, "anio": body.anio})
    db.commit()
    return {"ok": True, "id": pago.id}


# ── Cartola (import bank payments) ──

def _similaridad(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


@router.post("/cartola/preview")
async def cartola_preview(
    mes: int = Query(...),
    anio: int = Query(...),
    archivo: UploadFile = File(...),
    db: Session = Depends(get_db),
    _=require_permission("trabajadores:editar"),
):
    from app.api.cpc import _parsear_cartola

    contenido = await archivo.read()
    movimientos = _parsear_cartola(contenido)

    trabajadores = db.query(Trabajador).filter(Trabajador.activo == True).all()

    resultado = []
    for mov in movimientos:
        nombre_norm = mov["nombre_extraido"].lower()
        mejor = None
        mejor_score = 0.0

        for t in trabajadores:
            score = _similaridad(nombre_norm, t.nombre.lower())
            if score > mejor_score:
                mejor_score = score
                mejor = t

        match_confiable = mejor_score >= 0.55

        resultado.append({
            "descripcion": mov["descripcion"],
            "nombre_extraido": mov["nombre_extraido"],
            "fecha": mov["fecha"],
            "monto": mov["monto"],
            "trabajador_id": mejor.id if mejor else None,
            "trabajador_nombre": mejor.nombre if mejor else None,
            "score": round(mejor_score, 2),
            "match_confiable": match_confiable,
        })

    todos = [{"id": t.id, "nombre": t.nombre} for t in sorted(trabajadores, key=lambda x: x.nombre)]
    return {"mes": mes, "anio": anio, "items": resultado, "trabajadores": todos}


class ItemConfirmarCartolaTrabajador(BaseModel):
    trabajador_id: int
    monto: int
    fecha: Optional[str] = None
    descripcion: Optional[str] = None


class ConfirmarCartolaTrabajadorRequest(BaseModel):
    mes: int
    anio: int
    items: List[ItemConfirmarCartolaTrabajador]


@router.post("/cartola/confirmar")
def cartola_confirmar(
    body: ConfirmarCartolaTrabajadorRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user=require_permission("trabajadores:editar"),
):
    grabados = 0
    for item in body.items:
        if item.trabajador_id <= 0 or item.monto <= 0:
            continue
        pago = PagoTrabajador(
            trabajador_id=item.trabajador_id,
            mes=body.mes, anio=body.anio,
            monto=item.monto,
            fecha_pago=item.fecha,
            descripcion=item.descripcion,
            fuente="cartola",
        )
        db.add(pago)
        grabados += 1

    audit(db, "carga_cartola_trabajadores", usuario=current_user, request=request,
          entidad="cartola_trabajadores", entidad_id=0,
          metadata={"mes": body.mes, "anio": body.anio, "transacciones": grabados})
    db.commit()
    return {"ok": True, "grabados": grabados}


# ── Resumen para finanzas ──

@router.get("/costos/mensual")
def costos_mensuales(
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=require_permission("trabajadores:ver"),
):
    """Total pagado a trabajadores por mes para un año."""
    rows = db.query(
        PagoTrabajador.mes,
        sqlfunc.sum(PagoTrabajador.monto).label("total"),
    ).filter(PagoTrabajador.anio == anio).group_by(PagoTrabajador.mes).all()
    return {str(r.mes): int(r.total) for r in rows}
