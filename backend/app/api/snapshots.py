"""
SellerSnapshot — Snapshot diario del estado consolidado de cada seller.
Corre una vez por día (o bajo demanda). Todos los módulos pueden leer
el snapshot en lugar de re-calcular desde cero.
"""
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc

from app.database import get_db
from app.auth import require_admin_or_administracion
from app.models import SellerSnapshot, Seller, Envio, GestionComercialEntry

router = APIRouter(prefix="/snapshots", tags=["Snapshots"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _asignar_tier(avg_diario: float) -> str:
    if avg_diario >= 500:
        return "EPICO"
    elif avg_diario >= 100:
        return "CLAVE"
    elif avg_diario >= 20:
        return "BUENO"
    return "NORMAL"


def _compute_estado_efectivo(tipo_cierre, estacional, ug_estado, ug_fecha, estado_op, semanas_sin):
    from datetime import date as _d
    if tipo_cierre in ("cerrado", "desactivado"):
        return "cerrado"
    if tipo_cierre == "pausa":
        return "en_pausa_lifecycle"
    if ug_estado and ug_fecha:
        try:
            dias = (_d.today() - ug_fecha).days
            if dias <= 60:
                return ug_estado
        except Exception:
            pass
    if not estacional and semanas_sin >= 12:
        return "pendiente_validacion"
    return estado_op


def _classify_op(meses_dict: dict, mes_ref: int) -> str:
    vol_ref = meses_dict.get(mes_ref, 0)
    vol_prev = meses_dict.get(mes_ref - 1, 0) if mes_ref > 1 else 0
    active = sorted(m for m, v in meses_dict.items() if v > 0)
    if not active:
        return "perdido"
    if active[0] >= mes_ref - 1 and not any(meses_dict.get(m, 0) > 0 for m in range(1, mes_ref - 1)):
        return "nuevo"
    if vol_ref > 0:
        if vol_prev == 0 and any(meses_dict.get(m, 0) > 0 for m in range(1, mes_ref - 1)):
            return "recuperado"
        return "activo"
    else:
        if vol_prev > 0:
            return "en_riesgo"
        elif any(meses_dict.get(m, 0) > 0 for m in range(max(1, mes_ref - 4), mes_ref)):
            return "inactivo"
        return "perdido"


# ── Generación de snapshots ───────────────────────────────────────────────────

def generar_snapshots_hoy(db: Session):
    """Genera o actualiza el snapshot del día para todos los sellers activos."""
    hoy = date.today()
    mes_ref = hoy.month
    anio = hoy.year

    sellers = db.query(Seller).filter(Seller.activo == True).all()

    # Envíos del año en curso
    monthly = db.query(
        Envio.seller_id,
        Envio.mes,
        sqlfunc.count(Envio.id).label("paquetes"),
        sqlfunc.sum(
            sqlfunc.coalesce(Envio.cobro_seller, 0)
            + sqlfunc.coalesce(Envio.extra_producto_seller, 0)
            + sqlfunc.coalesce(Envio.extra_comuna_seller, 0)
            + sqlfunc.coalesce(Envio.cobro_extra_manual, 0)
        ).label("ingreso"),
    ).filter(
        Envio.anio == anio,
        Envio.seller_id.isnot(None),
    ).group_by(Envio.seller_id, Envio.mes).all()

    by_seller: dict = {}
    for r in monthly:
        if r.seller_id not in by_seller:
            by_seller[r.seller_id] = {"meses": {}, "ingresos": {}}
        by_seller[r.seller_id]["meses"][r.mes] = by_seller[r.seller_id]["meses"].get(r.mes, 0) + r.paquetes
        by_seller[r.seller_id]["ingresos"][r.mes] = by_seller[r.seller_id]["ingresos"].get(r.mes, 0) + int(r.ingreso or 0)

    # Última gestión por seller
    latest_gestion_sub = (
        db.query(
            GestionComercialEntry.seller_id,
            sqlfunc.max(GestionComercialEntry.id).label("max_id"),
        )
        .group_by(GestionComercialEntry.seller_id)
        .subquery()
    )
    latest_entries = (
        db.query(GestionComercialEntry)
        .join(latest_gestion_sub, GestionComercialEntry.id == latest_gestion_sub.c.max_id)
        .all()
    )
    gestion_map = {e.seller_id: e for e in latest_entries}

    for seller in sellers:
        sd = by_seller.get(seller.id, {"meses": {}, "ingresos": {}})
        meses_dict = sd["meses"]
        ingresos_dict = sd["ingresos"]

        active_months = sorted(m for m, v in meses_dict.items() if v > 0)
        vol_mes = meses_dict.get(mes_ref, 0)
        ingreso_mes = ingresos_dict.get(mes_ref, 0)
        ultimo_mes_activo = max(active_months) if active_months else None

        meses_sin = (mes_ref - ultimo_mes_activo) if (ultimo_mes_activo and vol_mes == 0) else 0
        semanas_sin = meses_sin * 4

        estado_op = _classify_op(meses_dict, mes_ref)
        avg_diario = vol_mes / max(hoy.day, 1)
        tier = _asignar_tier(avg_diario)

        ug = gestion_map.get(seller.id)
        ug_estado = ug.estado if ug else None
        ug_fecha = ug.fecha if ug else None

        estado_efectivo = _compute_estado_efectivo(
            seller.tipo_cierre, seller.estacional,
            ug_estado, ug_fecha,
            estado_op, semanas_sin,
        )

        existing = db.query(SellerSnapshot).filter(
            SellerSnapshot.seller_id == seller.id,
            SellerSnapshot.fecha == hoy,
        ).first()

        datos = {
            "vol_mes": vol_mes,
            "semanas_sin_actividad": semanas_sin,
            "ultimo_mes_activo": ultimo_mes_activo,
        }

        if existing:
            existing.estado_efectivo = estado_efectivo
            existing.estado_operativo = estado_op
            existing.estado_crm = ug_estado
            existing.tipo_cierre = seller.tipo_cierre
            existing.tier = tier
            existing.vol_mes = vol_mes
            existing.ingreso_mes = ingreso_mes
            existing.semanas_sin_actividad = semanas_sin
            existing.datos = datos
        else:
            db.add(SellerSnapshot(
                seller_id=seller.id,
                fecha=hoy,
                estado_efectivo=estado_efectivo,
                estado_operativo=estado_op,
                estado_crm=ug_estado,
                tipo_cierre=seller.tipo_cierre,
                tier=tier,
                vol_mes=vol_mes,
                ingreso_mes=ingreso_mes,
                semanas_sin_actividad=semanas_sin,
                datos=datos,
            ))

    db.commit()
    return len(sellers)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/generar")
def generar(
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Genera snapshots del día para todos los sellers activos."""
    n = generar_snapshots_hoy(db)
    return {"ok": True, "sellers_procesados": n, "fecha": date.today().isoformat()}


@router.get("/seller/{seller_id}")
def historial_seller(
    seller_id: int,
    dias: int = Query(90),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Historial de snapshots de un seller (últimos N días)."""
    desde = date.today() - timedelta(days=dias)
    snaps = (
        db.query(SellerSnapshot)
        .filter(SellerSnapshot.seller_id == seller_id, SellerSnapshot.fecha >= desde)
        .order_by(SellerSnapshot.fecha.desc())
        .all()
    )
    return [
        {
            "fecha": s.fecha.isoformat(),
            "estado_efectivo": s.estado_efectivo,
            "estado_operativo": s.estado_operativo,
            "estado_crm": s.estado_crm,
            "tier": s.tier,
            "vol_mes": s.vol_mes,
            "ingreso_mes": s.ingreso_mes,
            "semanas_sin_actividad": s.semanas_sin_actividad,
        }
        for s in snaps
    ]


@router.get("/hoy")
def snapshot_hoy(
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Todos los snapshots del día de hoy."""
    hoy = date.today()
    snaps = db.query(SellerSnapshot).filter(SellerSnapshot.fecha == hoy).all()
    sellers = {s.id: s.nombre for s in db.query(Seller.id, Seller.nombre).all()}
    return [
        {
            "seller_id": s.seller_id,
            "nombre": sellers.get(s.seller_id),
            "estado_efectivo": s.estado_efectivo,
            "tier": s.tier,
            "vol_mes": s.vol_mes,
            "ingreso_mes": s.ingreso_mes,
        }
        for s in snaps
    ]
