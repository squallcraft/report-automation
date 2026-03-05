from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_, func as sqlfunc

from app.database import get_db
from app.auth import (
    require_admin, require_admin_or_administracion, get_current_user,
    DRIVER_CUTOFF_ANIO, DRIVER_CUTOFF_MES, DRIVER_CUTOFF_SEMANA,
)
from app.models import Envio, Seller, Driver, RolEnum
from app.schemas import EnvioOut, EnvioUpdate

router = APIRouter(prefix="/envios", tags=["Envíos"])

COMPUTED_SORT_EXPRS = {
    "extra_total_seller": (
        Envio.extra_producto_seller + Envio.extra_comuna_seller + Envio.cobro_extra_manual
    ),
    "extra_total_driver": (
        Envio.extra_producto_driver + Envio.extra_comuna_driver + Envio.pago_extra_manual
    ),
}


SELLER_HIDDEN = {"costo_driver", "extra_producto_driver", "extra_comuna_driver", "pago_extra_manual"}
DRIVER_HIDDEN = {"cobro_seller", "extra_producto_seller", "extra_comuna_seller", "cobro_extra_manual", "costo_orden"}


def _enrich_envio(envio, db, rol=None) -> dict:
    data = {c.name: getattr(envio, c.name) for c in envio.__table__.columns}
    seller = db.get(Seller, envio.seller_id) if envio.seller_id else None
    driver = db.get(Driver, envio.driver_id) if envio.driver_id else None
    data["seller_nombre"] = seller.nombre if seller else envio.seller_nombre_raw
    data["driver_nombre"] = driver.nombre if driver else envio.driver_nombre_raw

    if rol == RolEnum.SELLER:
        for k in SELLER_HIDDEN:
            data[k] = 0
    elif rol == RolEnum.DRIVER:
        for k in DRIVER_HIDDEN:
            data[k] = 0

    return data


def _apply_common_filters(query, semana, mes, anio, seller_id, driver_id, homologado, search, comuna, empresa, is_admin=True, meses=None):
    if semana is not None:
        query = query.filter(Envio.semana == semana)
    if meses:
        query = query.filter(Envio.mes.in_(meses))
    elif mes is not None:
        query = query.filter(Envio.mes == mes)
    if anio is not None:
        query = query.filter(Envio.anio == anio)
    if seller_id is not None and is_admin:
        query = query.filter(Envio.seller_id == seller_id)
    if driver_id is not None and is_admin:
        query = query.filter(Envio.driver_id == driver_id)
    if homologado is not None:
        query = query.filter(Envio.homologado == homologado)
    if comuna:
        query = query.filter(Envio.comuna.ilike(f"%{comuna}%"))
    if empresa:
        query = query.filter(Envio.empresa == empresa)
    if search:
        term = f"%{search}%"
        query = query.filter(or_(
            Envio.tracking_id.ilike(term),
            Envio.seller_nombre_raw.ilike(term),
            Envio.driver_nombre_raw.ilike(term),
            Envio.seller_code.ilike(term),
            Envio.venta_id.ilike(term),
            Envio.descripcion_producto.ilike(term),
            Envio.comuna.ilike(term),
            Envio.direccion.ilike(term),
            Envio.codigo_producto.ilike(term),
        ))
    return query


def _resolve_sort(sort_by: Optional[str]):
    """Resolve sort_by string to a SQLAlchemy expression."""
    if not sort_by:
        return Envio.fecha_entrega

    if sort_by in COMPUTED_SORT_EXPRS:
        return COMPUTED_SORT_EXPRS[sort_by]

    if sort_by == "seller_nombre":
        return Envio.seller_nombre_raw

    if sort_by == "driver_nombre":
        return Envio.driver_nombre_raw

    col = getattr(Envio, sort_by, None)
    return col if col is not None else Envio.fecha_entrega


@router.get("", response_model=List[EnvioOut])
def listar_envios(
    semana: Optional[int] = None,
    mes: Optional[int] = None,
    meses: Optional[str] = None,
    anio: Optional[int] = None,
    seller_id: Optional[int] = None,
    driver_id: Optional[int] = None,
    homologado: Optional[bool] = None,
    search: Optional[str] = None,
    comuna: Optional[str] = None,
    empresa: Optional[str] = None,
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = "desc",
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    meses_list = [int(m) for m in meses.split(',') if m.strip().isdigit()] if meses else None
    query = db.query(Envio)

    if user["rol"] == RolEnum.SELLER:
        query = query.filter(Envio.seller_id == user["id"])
    elif user["rol"] == RolEnum.DRIVER:
        sub_ids = [s.id for s in db.query(Driver.id).filter(
            Driver.jefe_flota_id == user["id"], Driver.activo == True
        ).all()]
        if sub_ids:
            query = query.filter(Envio.driver_id.in_([user["id"]] + sub_ids))
        else:
            query = query.filter(Envio.driver_id == user["id"])
        # Drivers solo ven envíos desde semana 4 de febrero 2026 en adelante
        query = query.filter(or_(
            Envio.anio > DRIVER_CUTOFF_ANIO,
            (Envio.anio == DRIVER_CUTOFF_ANIO) & (Envio.mes > DRIVER_CUTOFF_MES),
            (Envio.anio == DRIVER_CUTOFF_ANIO) & (Envio.mes == DRIVER_CUTOFF_MES) & (Envio.semana >= DRIVER_CUTOFF_SEMANA),
        ))

    is_admin = user["rol"] in (RolEnum.ADMIN, RolEnum.ADMINISTRACION)
    query = _apply_common_filters(query, semana, mes, anio, seller_id, driver_id, homologado, search, comuna, empresa, is_admin, meses=meses_list)

    sort_expr = _resolve_sort(sort_by)
    if sort_dir == "asc":
        query = query.order_by(sort_expr.asc())
    else:
        query = query.order_by(sort_expr.desc())

    envios = query.offset(offset).limit(limit).all()
    return [_enrich_envio(e, db, rol=user["rol"]) for e in envios]


@router.get("/count")
def contar_envios(
    semana: Optional[int] = None,
    mes: Optional[int] = None,
    meses: Optional[str] = None,
    anio: Optional[int] = None,
    seller_id: Optional[int] = None,
    driver_id: Optional[int] = None,
    homologado: Optional[bool] = None,
    search: Optional[str] = None,
    comuna: Optional[str] = None,
    empresa: Optional[str] = None,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    meses_list = [int(m) for m in meses.split(',') if m.strip().isdigit()] if meses else None
    query = db.query(Envio)
    query = _apply_common_filters(query, semana, mes, anio, seller_id, driver_id, homologado, search, comuna, empresa, meses=meses_list)
    return {"count": query.count()}


@router.get("/{envio_id}", response_model=EnvioOut)
def obtener_envio(envio_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    envio = db.get(Envio, envio_id)
    if not envio:
        raise HTTPException(status_code=404, detail="Envío no encontrado")
    if user["rol"] == RolEnum.SELLER and envio.seller_id != user["id"]:
        raise HTTPException(status_code=403, detail="No autorizado")
    if user["rol"] == RolEnum.DRIVER:
        sub_ids = [s.id for s in db.query(Driver.id).filter(
            Driver.jefe_flota_id == user["id"], Driver.activo == True
        ).all()]
        allowed = [user["id"]] + sub_ids
        if envio.driver_id not in allowed:
            raise HTTPException(status_code=403, detail="No autorizado")
    return _enrich_envio(envio, db, rol=user["rol"])


@router.put("/{envio_id}", response_model=EnvioOut)
def actualizar_envio(
    envio_id: int,
    data: EnvioUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    envio = db.get(Envio, envio_id)
    if not envio:
        raise HTTPException(status_code=404, detail="Envío no encontrado")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(envio, key, value)
    db.commit()
    db.refresh(envio)
    return _enrich_envio(envio, db)
