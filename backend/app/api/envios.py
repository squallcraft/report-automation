from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_, func as sqlfunc

from app.database import get_db
from app.auth import (
    require_admin, require_admin_or_administracion, get_current_user,
    DRIVER_CUTOFF_ANIO, DRIVER_CUTOFF_MES, DRIVER_CUTOFF_SEMANA,
)
from app.models import Envio, Seller, Driver, Pickup, RolEnum
from app.schemas import EnvioOut, EnvioUpdate, EnvioBulkUpdate, EnvioBulkUpdateResult
from app.services.audit import registrar as audit

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


def _enrich_envio(envio, seller=None, driver=None, rol=None) -> dict:
    data = {c.name: getattr(envio, c.name) for c in envio.__table__.columns}
    data["seller_nombre"] = seller.nombre if seller else envio.seller_nombre_raw
    data["driver_nombre"] = driver.nombre if driver else envio.driver_nombre_raw

    if rol == RolEnum.SELLER:
        for k in SELLER_HIDDEN:
            data[k] = 0
    elif rol == RolEnum.DRIVER:
        for k in DRIVER_HIDDEN:
            data[k] = 0

    return data


def _enrich_envios_bulk(envios, db, rol=None):
    seller_ids = {e.seller_id for e in envios if e.seller_id}
    driver_ids = {e.driver_id for e in envios if e.driver_id}
    sellers_map = {s.id: s for s in db.query(Seller).filter(Seller.id.in_(seller_ids)).all()} if seller_ids else {}
    drivers_map = {d.id: d for d in db.query(Driver).filter(Driver.id.in_(driver_ids)).all()} if driver_ids else {}
    return [
        _enrich_envio(e, seller=sellers_map.get(e.seller_id), driver=drivers_map.get(e.driver_id), rol=rol)
        for e in envios
    ]


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
    elif user["rol"] == RolEnum.PICKUP:
        pickup = db.query(Pickup).get(user["id"])
        if pickup and pickup.seller_id:
            query = query.filter(Envio.seller_id == pickup.seller_id)
        else:
            query = query.filter(Envio.id < 0)

    is_admin = user["rol"] in (RolEnum.ADMIN, RolEnum.ADMINISTRACION)
    query = _apply_common_filters(query, semana, mes, anio, seller_id, driver_id, homologado, search, comuna, empresa, is_admin, meses=meses_list)

    sort_expr = _resolve_sort(sort_by)
    if sort_dir == "asc":
        query = query.order_by(sort_expr.asc())
    else:
        query = query.order_by(sort_expr.desc())

    envios = query.offset(offset).limit(limit).all()
    return _enrich_envios_bulk(envios, db, rol=user["rol"])


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


@router.put("/bulk", response_model=EnvioBulkUpdateResult)
def actualizar_envios_bulk(
    data: EnvioBulkUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    """Aplica los mismos extras manuales a varios envíos a la vez.

    Reglas:
    - Solo envíos en estado 'pendiente' son modificados.
    - Solo se actualizan los campos enviados explícitamente (los demás quedan intactos).
    - Cada cambio se audita individualmente para mantener trazabilidad por envío.
    """
    if not data.ids:
        raise HTTPException(status_code=400, detail="Debe indicar al menos un envío")

    # Pydantic v2 trae exclude_unset; permite distinguir "no enviado" de "enviado como 0/null".
    update_fields = {
        k: v for k, v in data.model_dump(exclude_unset=True).items()
        if k in {"cobro_extra_manual", "pago_extra_manual"}
    }
    if not update_fields:
        raise HTTPException(status_code=400, detail="No se indicaron campos a actualizar")

    envios = db.query(Envio).filter(Envio.id.in_(data.ids)).all()
    encontrados_ids = {e.id for e in envios}

    skipped = []
    for missing_id in set(data.ids) - encontrados_ids:
        skipped.append({"id": missing_id, "motivo": "no_encontrado"})

    updated = 0
    for envio in envios:
        if envio.estado_financiero != "pendiente":
            skipped.append({
                "id": envio.id,
                "motivo": f"estado={envio.estado_financiero}",
                "tracking": envio.tracking_id,
            })
            continue

        antes = {c: getattr(envio, c) for c in update_fields}
        for k, v in update_fields.items():
            setattr(envio, k, v)
        despues = {c: getattr(envio, c) for c in update_fields}
        cambios = {c: {"antes": antes[c], "despues": despues[c]} for c in update_fields if antes[c] != despues[c]}
        if cambios:
            audit(db, "editar_envio_bulk", usuario=current_user, request=request,
                  entidad="envio", entidad_id=envio.id, cambios=cambios,
                  metadata={"tracking": envio.tracking_id, "bulk_size": len(data.ids)})
        updated += 1

    db.commit()
    return {"updated": updated, "skipped": skipped, "total": len(data.ids)}


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
    if user["rol"] == RolEnum.PICKUP:
        pickup = db.query(Pickup).get(user["id"])
        if not pickup or not pickup.seller_id or envio.seller_id != pickup.seller_id:
            raise HTTPException(status_code=403, detail="No autorizado")
    seller = db.get(Seller, envio.seller_id) if envio.seller_id else None
    driver = db.get(Driver, envio.driver_id) if envio.driver_id else None
    return _enrich_envio(envio, seller=seller, driver=driver, rol=user["rol"])


@router.put("/{envio_id}", response_model=EnvioOut)
def actualizar_envio(
    envio_id: int,
    data: EnvioUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    envio = db.get(Envio, envio_id)
    if not envio:
        raise HTTPException(status_code=404, detail="Envío no encontrado")

    if envio.estado_financiero != "pendiente":
        raise HTTPException(
            status_code=403,
            detail=f"Envío en estado '{envio.estado_financiero}'. "
                   "Los campos financieros no pueden modificarse. "
                   "Use Ajustes de Liquidación para correcciones.",
        )

    campos = list(data.model_dump(exclude_unset=True).keys())
    antes = {c: getattr(envio, c) for c in campos}

    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(envio, key, value)
    db.commit()
    db.refresh(envio)

    despues = {c: getattr(envio, c) for c in campos}
    cambios = {c: {"antes": antes[c], "despues": despues[c]} for c in campos if antes[c] != despues[c]}
    if cambios:
        audit(db, "editar_envio", usuario=current_user, request=request,
              entidad="envio", entidad_id=envio_id, cambios=cambios,
              metadata={"tracking": envio.tracking_id})

    seller = db.get(Seller, envio.seller_id) if envio.seller_id else None
    driver = db.get(Driver, envio.driver_id) if envio.driver_id else None
    return _enrich_envio(envio, seller=seller, driver=driver)
