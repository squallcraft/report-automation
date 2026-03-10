from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import require_permission
from app.models import AjusteLiquidacion, Seller, Driver, TipoEntidadEnum
from app.schemas import AjusteCreate, AjusteOut
from app.api.liquidacion import invalidar_snapshots

router = APIRouter(prefix="/ajustes", tags=["Ajustes de Liquidación"])


def _enrich_ajuste(a, db) -> dict:
    data = {col.name: getattr(a, col.name) for col in a.__table__.columns}
    if a.tipo == TipoEntidadEnum.SELLER:
        entidad = db.query(Seller).get(a.entidad_id)
        data["entidad_nombre"] = entidad.nombre if entidad else "—"
    else:
        entidad = db.query(Driver).get(a.entidad_id)
        data["entidad_nombre"] = entidad.nombre if entidad else "—"
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
        entidad = db.query(Seller).get(data.entidad_id)
        if not entidad:
            raise HTTPException(status_code=404, detail="Seller no encontrado")
    else:
        entidad = db.query(Driver).get(data.entidad_id)
        if not entidad:
            raise HTTPException(status_code=404, detail="Driver no encontrado")

    ajuste = AjusteLiquidacion(**data.model_dump(), creado_por=admin["nombre"])
    db.add(ajuste)
    invalidar_snapshots(db, data.semana, data.mes, data.anio)
    db.commit()
    db.refresh(ajuste)
    return ajuste


@router.delete("/{ajuste_id}")
def eliminar_ajuste(ajuste_id: int, db: Session = Depends(get_db), _=require_permission("ajustes:editar")):
    ajuste = db.query(AjusteLiquidacion).get(ajuste_id)
    if not ajuste:
        raise HTTPException(status_code=404, detail="Ajuste no encontrado")
    semana, mes, anio = ajuste.semana, ajuste.mes, ajuste.anio
    db.delete(ajuste)
    invalidar_snapshots(db, semana, mes, anio)
    db.commit()
    return {"message": "Ajuste eliminado"}
