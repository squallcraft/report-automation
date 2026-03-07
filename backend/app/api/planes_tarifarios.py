from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.auth import require_admin, require_admin_or_administracion
from app.models import TarifaPlanComuna, Seller, Envio
from app.services.audit import registrar as audit

router = APIRouter(prefix="/planes-tarifarios", tags=["Planes Tarifarios"])


class ComunaIn(BaseModel):
    comuna: str
    precio: int


class PlanIn(BaseModel):
    plan: str
    comunas: list[ComunaIn]


@router.get("")
def listar_planes(db: Session = Depends(get_db), _=Depends(require_admin_or_administracion)):
    rows = (
        db.query(TarifaPlanComuna)
        .order_by(TarifaPlanComuna.plan_tarifario, TarifaPlanComuna.comuna)
        .all()
    )

    planes_map: dict[str, list] = {}
    for r in rows:
        planes_map.setdefault(r.plan_tarifario, []).append(
            {"id": r.id, "comuna": r.comuna, "precio": r.precio}
        )

    sellers = db.query(Seller).filter(Seller.plan_tarifario.isnot(None)).all()
    sellers_map: dict[str, list] = {}
    for s in sellers:
        sellers_map.setdefault(s.plan_tarifario, []).append(
            {"id": s.id, "nombre": s.nombre}
        )

    return [
        {
            "plan": plan,
            "sellers": sellers_map.get(plan, []),
            "comunas": comunas,
        }
        for plan, comunas in planes_map.items()
    ]


@router.post("", status_code=201)
def crear_plan(
    data: PlanIn,
    request: Request,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    plan_name = data.plan.strip().lower()
    if not plan_name:
        raise HTTPException(status_code=400, detail="El nombre del plan es requerido")

    existing = db.query(TarifaPlanComuna).filter(
        TarifaPlanComuna.plan_tarifario == plan_name
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Ya existe un plan con ese nombre")

    created = []
    for c in data.comunas:
        row = TarifaPlanComuna(
            plan_tarifario=plan_name,
            comuna=c.comuna.strip().lower(),
            precio=c.precio,
        )
        db.add(row)
        created.append(row)

    db.commit()
    for r in created:
        db.refresh(r)

    audit(
        db, "crear_plan_tarifario",
        usuario=user, request=request,
        entidad="plan_tarifario", metadata={"plan": plan_name},
    )

    return {
        "plan": plan_name,
        "comunas": [{"id": r.id, "comuna": r.comuna, "precio": r.precio} for r in created],
    }


@router.put("/{plan_name}/comuna")
def upsert_comuna(
    plan_name: str,
    data: ComunaIn,
    request: Request,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    comuna_norm = data.comuna.strip().lower()
    row = db.query(TarifaPlanComuna).filter(
        TarifaPlanComuna.plan_tarifario == plan_name,
        func.lower(TarifaPlanComuna.comuna) == comuna_norm,
    ).first()

    if row:
        row.precio = data.precio
        audit(
            db, "editar_comuna_plan",
            usuario=user, request=request,
            entidad="plan_tarifario",
            metadata={"plan": plan_name, "comuna": comuna_norm, "precio": data.precio},
        )
    else:
        row = TarifaPlanComuna(
            plan_tarifario=plan_name,
            comuna=comuna_norm,
            precio=data.precio,
        )
        db.add(row)
        audit(
            db, "agregar_comuna_plan",
            usuario=user, request=request,
            entidad="plan_tarifario",
            metadata={"plan": plan_name, "comuna": comuna_norm, "precio": data.precio},
        )

    db.commit()
    db.refresh(row)
    return {"id": row.id, "comuna": row.comuna, "precio": row.precio}


@router.delete("/{plan_name}/comuna/{comuna_id}")
def eliminar_comuna(
    plan_name: str,
    comuna_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    row = db.query(TarifaPlanComuna).filter(
        TarifaPlanComuna.id == comuna_id,
        TarifaPlanComuna.plan_tarifario == plan_name,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Comuna no encontrada en el plan")

    audit(
        db, "eliminar_comuna_plan",
        usuario=user, request=request,
        entidad="plan_tarifario",
        metadata={"plan": plan_name, "comuna": row.comuna},
    )

    db.delete(row)
    db.commit()
    return {"message": "Comuna eliminada del plan"}


@router.delete("/{plan_name}")
def eliminar_plan(
    plan_name: str,
    request: Request,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    rows = db.query(TarifaPlanComuna).filter(
        TarifaPlanComuna.plan_tarifario == plan_name
    ).all()
    if not rows:
        raise HTTPException(status_code=404, detail="Plan no encontrado")

    for r in rows:
        db.delete(r)

    audit(
        db, "eliminar_plan_tarifario",
        usuario=user, request=request,
        entidad="plan_tarifario",
        metadata={"plan": plan_name, "comunas_eliminadas": len(rows)},
    )

    db.commit()
    return {"message": "Plan eliminado"}


@router.put("/{plan_name}/recalcular")
def recalcular_plan(
    plan_name: str,
    request: Request,
    db: Session = Depends(get_db),
    user=Depends(require_admin),
):
    tarifas = (
        db.query(TarifaPlanComuna)
        .filter(TarifaPlanComuna.plan_tarifario == plan_name)
        .all()
    )
    precio_por_comuna = {t.comuna.lower(): t.precio for t in tarifas}

    seller_ids = [
        s.id for s in
        db.query(Seller.id).filter(Seller.plan_tarifario == plan_name).all()
    ]
    if not seller_ids:
        return {"actualizados": 0}

    # precio_base per seller for fallback
    sellers = db.query(Seller).filter(Seller.id.in_(seller_ids)).all()
    precio_base_map = {s.id: s.precio_base for s in sellers}

    envios = (
        db.query(Envio)
        .filter(
            Envio.seller_id.in_(seller_ids),
            Envio.estado_financiero == "pendiente",
        )
        .all()
    )

    count = 0
    for envio in envios:
        comuna_norm = (envio.comuna or "").strip().lower()
        nuevo_precio = precio_por_comuna.get(comuna_norm, precio_base_map.get(envio.seller_id, 0))
        if envio.cobro_seller != nuevo_precio:
            envio.cobro_seller = nuevo_precio
            count += 1

    db.flush()

    audit(
        db, "recalcular_plan_tarifario",
        usuario=user, request=request,
        entidad="plan_tarifario",
        metadata={"plan": plan_name, "envios_actualizados": count},
    )

    db.commit()
    return {"actualizados": count}
