from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import require_admin, require_admin_or_administracion
from app.models import TarifaComuna
from app.schemas import TarifaComunaCreate, TarifaComunaUpdate, TarifaComunaOut

router = APIRouter(prefix="/comunas", tags=["Tarifas por Comuna"])


@router.get("", response_model=List[TarifaComunaOut])
def listar_comunas(db: Session = Depends(get_db), _=Depends(require_admin_or_administracion)):
    return db.query(TarifaComuna).order_by(TarifaComuna.comuna).all()


@router.post("", response_model=TarifaComunaOut, status_code=201)
def crear_comuna(data: TarifaComunaCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    comuna_normalizada = data.comuna.lower().strip()
    existing = db.query(TarifaComuna).filter(TarifaComuna.comuna == comuna_normalizada).first()
    if existing:
        raise HTTPException(status_code=400, detail="Ya existe una tarifa para esa comuna")
    tarifa = TarifaComuna(
        comuna=comuna_normalizada,
        extra_seller=data.extra_seller,
        extra_driver=data.extra_driver,
    )
    db.add(tarifa)
    db.commit()
    db.refresh(tarifa)
    return tarifa


@router.put("/{comuna_id}", response_model=TarifaComunaOut)
def actualizar_comuna(
    comuna_id: int, data: TarifaComunaUpdate,
    db: Session = Depends(get_db), _=Depends(require_admin),
):
    tarifa = db.query(TarifaComuna).get(comuna_id)
    if not tarifa:
        raise HTTPException(status_code=404, detail="Tarifa no encontrada")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(tarifa, key, value)
    db.commit()
    db.refresh(tarifa)
    return tarifa


@router.delete("/{comuna_id}")
def eliminar_comuna(comuna_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    tarifa = db.query(TarifaComuna).get(comuna_id)
    if not tarifa:
        raise HTTPException(status_code=404, detail="Tarifa no encontrada")
    db.delete(tarifa)
    db.commit()
    return {"message": "Tarifa eliminada"}
