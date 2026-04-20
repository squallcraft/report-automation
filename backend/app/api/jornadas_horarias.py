"""
CRUD de jornadas horarias.

Las jornadas horarias son plantillas de horario (hora entrada, hora salida,
minutos colación) que el admin define en Configuración Legal y luego asigna
a cada trabajador. El motor de plantillas de contratos las usa para resolver
{{jornada.hora_entrada}}, {{jornada.hora_salida}}, {{jornada.minutos_colacion}}.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import JornadaHoraria
from app.auth import require_admin_or_administracion

router = APIRouter(prefix="/jornadas-horarias", tags=["jornadas-horarias"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class JornadaHorariaIn(BaseModel):
    nombre: str
    hora_entrada: str      # "HH:MM"
    hora_salida: str       # "HH:MM"
    minutos_colacion: int = 45
    activa: bool = True


class JornadaHorariaOut(BaseModel):
    id: int
    nombre: str
    hora_entrada: str
    hora_salida: str
    minutos_colacion: int
    activa: bool
    model_config = {"from_attributes": True}


def _to_dict(j: JornadaHoraria) -> dict:
    return {
        "id": j.id,
        "nombre": j.nombre,
        "hora_entrada": j.hora_entrada,
        "hora_salida": j.hora_salida,
        "minutos_colacion": j.minutos_colacion,
        "activa": j.activa,
    }


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("", response_model=List[JornadaHorariaOut])
def listar(
    solo_activas: bool = True,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    q = db.query(JornadaHoraria)
    if solo_activas:
        q = q.filter(JornadaHoraria.activa == True)
    return q.order_by(JornadaHoraria.nombre).all()


@router.post("", response_model=JornadaHorariaOut, status_code=201)
def crear(
    payload: JornadaHorariaIn,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    j = JornadaHoraria(**payload.model_dump())
    db.add(j)
    db.commit()
    db.refresh(j)
    return j


@router.put("/{jornada_id}", response_model=JornadaHorariaOut)
def actualizar(
    jornada_id: int,
    payload: JornadaHorariaIn,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    j = db.query(JornadaHoraria).filter(JornadaHoraria.id == jornada_id).first()
    if not j:
        raise HTTPException(status_code=404, detail="Jornada no encontrada")
    for k, v in payload.model_dump().items():
        setattr(j, k, v)
    db.commit()
    db.refresh(j)
    return j


@router.delete("/{jornada_id}", status_code=204)
def eliminar(
    jornada_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    j = db.query(JornadaHoraria).filter(JornadaHoraria.id == jornada_id).first()
    if not j:
        raise HTTPException(status_code=404, detail="Jornada no encontrada")
    db.delete(j)
    db.commit()
