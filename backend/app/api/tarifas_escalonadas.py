from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import require_admin
from app.models import TarifaEscalonadaSeller, Seller, Envio
from app.services.tarifas_escalonadas import recalcular_tarifas_escalonadas

router = APIRouter(prefix="/tarifas-escalonadas", tags=["Tarifas Escalonadas"])


class TramoItem(BaseModel):
    min: int
    max: Optional[int] = None
    precio: int


class TarifaEscalonadaCreate(BaseModel):
    seller_id: int
    zona_aplicable: Optional[str] = None
    tramos: List[TramoItem]
    activo: bool = True


class TarifaEscalonadaUpdate(BaseModel):
    zona_aplicable: Optional[str] = None
    tramos: Optional[List[TramoItem]] = None
    activo: Optional[bool] = None


class TarifaEscalonadaOut(BaseModel):
    id: int
    seller_id: int
    seller_nombre: Optional[str] = None
    zona_aplicable: Optional[str] = None
    tramos: list
    activo: bool

    model_config = {"from_attributes": True}


def _enrich(tarifa, db) -> dict:
    seller = db.get(Seller, tarifa.seller_id)
    return {
        "id": tarifa.id,
        "seller_id": tarifa.seller_id,
        "seller_nombre": seller.nombre if seller else None,
        "zona_aplicable": tarifa.zona_aplicable,
        "tramos": tarifa.tramos,
        "activo": tarifa.activo,
    }


@router.get("", response_model=List[TarifaEscalonadaOut])
def listar(db: Session = Depends(get_db), _=Depends(require_admin)):
    rows = db.query(TarifaEscalonadaSeller).order_by(TarifaEscalonadaSeller.seller_id).all()
    return [_enrich(r, db) for r in rows]


@router.post("", response_model=TarifaEscalonadaOut)
def crear(data: TarifaEscalonadaCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    seller = db.get(Seller, data.seller_id)
    if not seller:
        raise HTTPException(status_code=404, detail="Seller no encontrado")

    existing = db.query(TarifaEscalonadaSeller).filter(
        TarifaEscalonadaSeller.seller_id == data.seller_id,
        TarifaEscalonadaSeller.activo == True,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Ya existe una tarifa escalonada activa para este seller")

    tarifa = TarifaEscalonadaSeller(
        seller_id=data.seller_id,
        zona_aplicable=data.zona_aplicable,
        tramos=[t.model_dump() for t in data.tramos],
        activo=data.activo,
    )
    db.add(tarifa)
    db.commit()
    db.refresh(tarifa)
    return _enrich(tarifa, db)


@router.put("/{tarifa_id}", response_model=TarifaEscalonadaOut)
def actualizar(tarifa_id: int, data: TarifaEscalonadaUpdate, db: Session = Depends(get_db), _=Depends(require_admin)):
    tarifa = db.get(TarifaEscalonadaSeller, tarifa_id)
    if not tarifa:
        raise HTTPException(status_code=404, detail="Tarifa no encontrada")

    if data.zona_aplicable is not None:
        tarifa.zona_aplicable = data.zona_aplicable
    if data.tramos is not None:
        tarifa.tramos = [t.model_dump() for t in data.tramos]
    if data.activo is not None:
        tarifa.activo = data.activo

    db.commit()
    db.refresh(tarifa)
    return _enrich(tarifa, db)


@router.delete("/{tarifa_id}")
def eliminar(tarifa_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    tarifa = db.get(TarifaEscalonadaSeller, tarifa_id)
    if not tarifa:
        raise HTTPException(status_code=404, detail="Tarifa no encontrada")
    db.delete(tarifa)
    db.commit()
    return {"ok": True}


@router.post("/recalcular")
def recalcular(
    semana: int = Query(...),
    mes: int = Query(...),
    anio: int = Query(...),
    seller_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """Recalcula cobro_seller para sellers con tarifa escalonada en el período indicado."""
    periodos = {(semana, mes, anio)}
    seller_ids = {seller_id} if seller_id else None
    resultado = recalcular_tarifas_escalonadas(db, periodos, seller_ids)
    return {"resultado": resultado}
