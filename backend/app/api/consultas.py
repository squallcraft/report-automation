from typing import Optional, List

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import require_admin, require_admin_or_administracion, get_current_user
from app.models import ConsultaPortal, Seller, Driver, TipoEntidadEnum, RolEnum, EstadoConsultaEnum
from app.schemas import ConsultaCreate, ConsultaResponder, ConsultaOut

router = APIRouter(prefix="/consultas", tags=["Consultas del Portal"])


def _enrich_consulta(c, db) -> dict:
    data = {col.name: getattr(c, col.name) for col in c.__table__.columns}
    if c.tipo == TipoEntidadEnum.SELLER:
        entidad = db.query(Seller).get(c.entidad_id)
        data["entidad_nombre"] = entidad.nombre if entidad else "—"
    else:
        entidad = db.query(Driver).get(c.entidad_id)
        data["entidad_nombre"] = entidad.nombre if entidad else "—"
    return data


@router.get("", response_model=List[ConsultaOut])
def listar_consultas(
    estado: Optional[str] = None,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    query = db.query(ConsultaPortal)

    if user["rol"] == RolEnum.SELLER:
        query = query.filter(
            ConsultaPortal.tipo == TipoEntidadEnum.SELLER,
            ConsultaPortal.entidad_id == user["id"],
        )
    elif user["rol"] == RolEnum.DRIVER:
        query = query.filter(
            ConsultaPortal.tipo == TipoEntidadEnum.DRIVER,
            ConsultaPortal.entidad_id == user["id"],
        )

    if estado:
        query = query.filter(ConsultaPortal.estado == estado)

    consultas = query.order_by(ConsultaPortal.created_at.desc()).all()
    return [_enrich_consulta(c, db) for c in consultas]


@router.post("", response_model=ConsultaOut, status_code=201)
def crear_consulta(
    data: ConsultaCreate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    if user["rol"] not in (RolEnum.SELLER, RolEnum.DRIVER):
        raise HTTPException(status_code=403, detail="Solo sellers y drivers pueden crear consultas")

    tipo = TipoEntidadEnum.SELLER if user["rol"] == RolEnum.SELLER else TipoEntidadEnum.DRIVER
    consulta = ConsultaPortal(
        tipo=tipo,
        entidad_id=user["id"],
        envio_id=data.envio_id,
        mensaje=data.mensaje,
    )
    db.add(consulta)
    db.commit()
    db.refresh(consulta)
    return _enrich_consulta(consulta, db)


@router.put("/{consulta_id}/responder", response_model=ConsultaOut)
def responder_consulta(
    consulta_id: int,
    data: ConsultaResponder,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    consulta = db.query(ConsultaPortal).get(consulta_id)
    if not consulta:
        raise HTTPException(status_code=404, detail="Consulta no encontrada")
    consulta.respuesta = data.respuesta
    consulta.estado = EstadoConsultaEnum.RESPONDIDA
    consulta.respondida_en = datetime.now(timezone.utc)
    db.commit()
    db.refresh(consulta)
    return _enrich_consulta(consulta, db)


@router.put("/{consulta_id}/cerrar")
def cerrar_consulta(consulta_id: int, db: Session = Depends(get_db), _=Depends(require_admin_or_administracion)):
    consulta = db.query(ConsultaPortal).get(consulta_id)
    if not consulta:
        raise HTTPException(status_code=404, detail="Consulta no encontrada")
    consulta.estado = EstadoConsultaEnum.CERRADA
    db.commit()
    return {"message": "Consulta cerrada"}
