from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import require_admin, require_admin_or_administracion
from app.models import CalendarioSemanas
from app.services.calendario import generar_calendario_anio

router = APIRouter(prefix="/calendario", tags=["Calendario"])


class SemanaOut(BaseModel):
    id: int
    semana: int
    mes: int
    anio: int
    fecha_inicio: date
    fecha_fin: date
    generado_auto: bool
    editable: bool = True

    class Config:
        from_attributes = True


class SemanaUpdate(BaseModel):
    fecha_inicio: date
    fecha_fin: date


NOMBRES_MES = [
    "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]


@router.get("", response_model=List[SemanaOut])
def listar_semanas(
    anio: int = Query(...),
    mes: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    hoy = date.today()
    q = db.query(CalendarioSemanas).filter(CalendarioSemanas.anio == anio)
    if mes:
        q = q.filter(CalendarioSemanas.mes == mes)
    semanas = q.order_by(CalendarioSemanas.mes, CalendarioSemanas.semana).all()

    result = []
    for s in semanas:
        editable = s.fecha_inicio > hoy
        result.append(SemanaOut(
            id=s.id,
            semana=s.semana,
            mes=s.mes,
            anio=s.anio,
            fecha_inicio=s.fecha_inicio,
            fecha_fin=s.fecha_fin,
            generado_auto=s.generado_auto,
            editable=editable,
        ))
    return result


@router.put("/{semana_id}", response_model=SemanaOut)
def editar_semana(
    semana_id: int,
    body: SemanaUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    hoy = date.today()
    semana = db.query(CalendarioSemanas).filter(CalendarioSemanas.id == semana_id).first()
    if not semana:
        raise HTTPException(status_code=404, detail="Semana no encontrada")
    if semana.fecha_inicio <= hoy:
        raise HTTPException(
            status_code=400,
            detail="No se pueden editar semanas pasadas o en curso para preservar la integridad de la liquidación.",
        )
    if body.fecha_inicio.weekday() != 0:
        raise HTTPException(status_code=400, detail="La fecha de inicio debe ser un lunes.")
    if body.fecha_fin <= body.fecha_inicio:
        raise HTTPException(status_code=400, detail="La fecha fin debe ser posterior a la fecha inicio.")
    if (body.fecha_fin - body.fecha_inicio).days > 13:
        raise HTTPException(status_code=400, detail="El rango de la semana no puede superar 14 días.")

    semana.fecha_inicio = body.fecha_inicio
    semana.fecha_fin = body.fecha_fin
    semana.generado_auto = False
    db.commit()
    db.refresh(semana)

    return SemanaOut(
        id=semana.id,
        semana=semana.semana,
        mes=semana.mes,
        anio=semana.anio,
        fecha_inicio=semana.fecha_inicio,
        fecha_fin=semana.fecha_fin,
        generado_auto=semana.generado_auto,
        editable=True,
    )


@router.post("/generar")
def generar_calendario(
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    creados = generar_calendario_anio(anio, db, sobrescribir_futuro=True)
    return {"message": f"Calendario {anio} generado/actualizado.", "semanas": creados}


@router.get("/preview")
def preview_calendario(
    anio: int = Query(...),
    _=Depends(require_admin_or_administracion),
):
    """Preview del calendario generado sin guardar en DB (útil para mostrar antes de confirmar)."""
    from app.services.calendario import _calcular_semanas_anio
    records = _calcular_semanas_anio(anio)
    hoy = date.today()
    return [
        {
            "semana": r["semana"],
            "mes": r["mes"],
            "mes_nombre": NOMBRES_MES[r["mes"]],
            "anio": r["anio"],
            "fecha_inicio": r["fecha_inicio"].isoformat(),
            "fecha_fin": r["fecha_fin"].isoformat(),
            "editable": r["fecha_inicio"] > hoy,
        }
        for r in records
    ]
