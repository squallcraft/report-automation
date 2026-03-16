from typing import Optional, List
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import require_permission, require_admin_or_administracion
from app.models import AjusteLiquidacion, Seller, Driver, Trabajador, TipoEntidadEnum
from app.schemas import AjusteCreate, AjusteOut
from app.api.liquidacion import invalidar_snapshots

router = APIRouter(prefix="/ajustes", tags=["Ajustes de Liquidación"])


def _nombre_entidad(a, db) -> str:
    if a.tipo == TipoEntidadEnum.SELLER.value or a.tipo == "SELLER":
        e = db.get(Seller, a.entidad_id)
    elif a.tipo == TipoEntidadEnum.TRABAJADOR.value or a.tipo == "TRABAJADOR":
        e = db.get(Trabajador, a.entidad_id)
    else:
        e = db.get(Driver, a.entidad_id)
    return e.nombre if e else "—"


def _enrich_ajuste(a, db) -> dict:
    data = {col.name: getattr(a, col.name) for col in a.__table__.columns}
    data["entidad_nombre"] = _nombre_entidad(a, db)
    return data


@router.get("", response_model=List[AjusteOut])
def listar_ajustes(
    semana: Optional[int] = None,
    mes: Optional[int] = None,
    anio: Optional[int] = None,
    tipo: Optional[str] = None,
    db: Session = Depends(get_db),
    _=require_permission("ajustes:ver"),
):
    query = db.query(AjusteLiquidacion)
    if semana is not None:
        query = query.filter(AjusteLiquidacion.semana == semana)
    if mes is not None:
        query = query.filter(AjusteLiquidacion.mes == mes)
    if anio is not None:
        query = query.filter(AjusteLiquidacion.anio == anio)
    if tipo:
        query = query.filter(AjusteLiquidacion.tipo == tipo)
    ajustes = query.order_by(AjusteLiquidacion.created_at.desc()).all()
    return [_enrich_ajuste(a, db) for a in ajustes]


@router.post("", response_model=AjusteOut, status_code=201)
def crear_ajuste(
    data: AjusteCreate,
    db: Session = Depends(get_db),
    admin=require_permission("ajustes:editar"),
):
    if data.tipo == TipoEntidadEnum.SELLER:
        entidad = db.get(Seller, data.entidad_id)
        if not entidad:
            raise HTTPException(status_code=404, detail="Seller no encontrado")
    elif data.tipo == TipoEntidadEnum.TRABAJADOR:
        entidad = db.get(Trabajador, data.entidad_id)
        if not entidad:
            raise HTTPException(status_code=404, detail="Trabajador no encontrado")
    else:
        entidad = db.get(Driver, data.entidad_id)
        if not entidad:
            raise HTTPException(status_code=404, detail="Driver no encontrado")

    ajuste = AjusteLiquidacion(**data.model_dump(), creado_por=admin["nombre"])
    db.add(ajuste)
    if data.tipo != TipoEntidadEnum.TRABAJADOR:
        invalidar_snapshots(db, data.semana, data.mes, data.anio)
    db.commit()
    db.refresh(ajuste)
    return _enrich_ajuste(ajuste, db)


@router.delete("/{ajuste_id}")
def eliminar_ajuste(ajuste_id: int, db: Session = Depends(get_db), _=require_permission("ajustes:editar")):
    ajuste = db.query(AjusteLiquidacion).get(ajuste_id)
    if not ajuste:
        raise HTTPException(status_code=404, detail="Ajuste no encontrado")
    semana, mes, anio = ajuste.semana, ajuste.mes, ajuste.anio
    tipo = ajuste.tipo
    db.delete(ajuste)
    if tipo != TipoEntidadEnum.TRABAJADOR.value:
        invalidar_snapshots(db, semana, mes, anio)
    db.commit()
    return {"message": "Ajuste eliminado"}


# ── Bonificaciones (ajustes positivos para trabajadores) ──

class BonificacionCreate(BaseModel):
    trabajador_id: int
    mes: int
    anio: int
    monto: int
    motivo: Optional[str] = None


@router.get("/bonificaciones")
def listar_bonificaciones(
    mes: Optional[int] = None,
    anio: Optional[int] = None,
    db: Session = Depends(get_db),
    _=require_permission("ajustes:ver"),
):
    """Lista bonificaciones (ajustes positivos) de trabajadores."""
    query = db.query(AjusteLiquidacion).filter(
        AjusteLiquidacion.tipo == TipoEntidadEnum.TRABAJADOR.value,
        AjusteLiquidacion.monto > 0,
    )
    if mes is not None:
        query = query.filter(AjusteLiquidacion.mes == mes)
    if anio is not None:
        query = query.filter(AjusteLiquidacion.anio == anio)
    items = query.order_by(AjusteLiquidacion.created_at.desc()).all()
    result = []
    for a in items:
        t = db.get(Trabajador, a.entidad_id)
        result.append({
            "id": a.id,
            "trabajador_id": a.entidad_id,
            "trabajador_nombre": t.nombre if t else "—",
            "cargo": t.cargo if t else "—",
            "mes": a.mes,
            "anio": a.anio,
            "monto": a.monto,
            "motivo": a.motivo,
            "creado_por": a.creado_por,
            "created_at": a.created_at,
        })
    return result


@router.post("/bonificaciones", status_code=201)
def crear_bonificacion(
    data: BonificacionCreate,
    db: Session = Depends(get_db),
    admin=require_permission("ajustes:editar"),
):
    """Crea una bonificación (ajuste positivo) para un trabajador en un mes."""
    trabajador = db.get(Trabajador, data.trabajador_id)
    if not trabajador:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")
    if data.monto <= 0:
        raise HTTPException(status_code=400, detail="El monto de una bonificación debe ser positivo")

    ajuste = AjusteLiquidacion(
        tipo=TipoEntidadEnum.TRABAJADOR.value,
        entidad_id=data.trabajador_id,
        semana=1,  # las bonificaciones son mensuales, semana 1 es referencial
        mes=data.mes,
        anio=data.anio,
        monto=data.monto,
        motivo=data.motivo,
        creado_por=admin["nombre"],
    )
    db.add(ajuste)
    db.commit()
    db.refresh(ajuste)
    return {
        "id": ajuste.id,
        "trabajador_id": data.trabajador_id,
        "trabajador_nombre": trabajador.nombre,
        "mes": data.mes,
        "anio": data.anio,
        "monto": data.monto,
        "motivo": data.motivo,
    }
