"""
Endpoints para gestión de parámetros legales mensuales (UF / UTM / IMM).
"""
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import require_admin_or_administracion
from app.models import ParametrosMensuales
from app.services.parametros import actualizar_mes_actual, obtener_parametros

router = APIRouter(prefix="/parametros-remuneracion", tags=["parametros"])


class ParametrosOut(BaseModel):
    anio: int
    mes: int
    uf: float
    utm: int
    imm: int
    fuente: Optional[str] = None
    updated_at: Optional[str] = None
    model_config = {"from_attributes": True}


class ParametrosManualIn(BaseModel):
    anio: int
    mes: int
    uf: float
    utm: int
    imm: int


@router.get("/mes-actual")
def obtener_mes_actual(db: Session = Depends(get_db)):
    """Retorna los parámetros del mes en curso."""
    hoy = date.today()
    return obtener_parametros(db, hoy.year, hoy.month)


@router.get("/{anio}/{mes}")
def obtener_mes(anio: int, mes: int, db: Session = Depends(get_db)):
    """Retorna los parámetros para un año/mes específico."""
    if not (1 <= mes <= 12):
        raise HTTPException(400, "Mes debe ser 1-12")
    return obtener_parametros(db, anio, mes)


@router.post("/actualizar")
def actualizar_desde_api(
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """
    Fuerza la actualización del mes actual desde mindicador.cl.
    Requiere rol admin o administración.
    """
    return actualizar_mes_actual(db)


@router.post("/manual")
def guardar_manual(
    data: ParametrosManualIn,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """
    Permite ingresar manualmente UF/UTM/IMM para un mes específico.
    Útil cuando mindicador.cl no tiene datos o para correcciones históricas.
    """
    from app.services.parametros import _upsert_y_retornar
    return _upsert_y_retornar(db, data.anio, data.mes, data.uf, data.utm, data.imm, "manual")


@router.get("")
def listar_parametros(
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Lista todos los parámetros almacenados, ordenados por fecha descendente."""
    registros = (
        db.query(ParametrosMensuales)
        .order_by(ParametrosMensuales.anio.desc(), ParametrosMensuales.mes.desc())
        .all()
    )
    return [
        {
            "anio": r.anio,
            "mes": r.mes,
            "uf": float(r.uf),
            "utm": r.utm,
            "imm": r.imm,
            "fuente": r.fuente,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        }
        for r in registros
    ]
