from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func as F, case, extract, cast, Date, text
from typing import Optional

from app.database import get_db
from app.auth import require_admin_or_administracion
from app.models import (
    Envio, Seller, Driver, Pickup,
    CategoriaFinanciera, MovimientoFinanciero,
    PagoSemanaSeller, PagoSemanaDriver, PagoSemanaPickup,
    PagoCartola, PagoCartolaSeller, PagoCartolaPickup,
    PagoTrabajador, CalendarioSemanas, GrokAnalisis,
)

router = APIRouter(prefix="/bi", tags=["Business Intelligence"])

MESES = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']


def _env_filters(q, mes, anio, empresa=None, zona=None):
    q = q.filter(Envio.mes == mes, Envio.anio == anio, Envio.estado_entrega == 'delivered')
    if empresa:
        q = q.filter(Envio.empresa == empresa)
    if zona:
        q = q.filter(Envio.zona == zona)
    return q


def _manual_totals(db: Session, mes: int, anio: int):
    rows = db.query(
        CategoriaFinanciera.tipo,
        CategoriaFinanciera.nombre,
        F.coalesce(F.sum(MovimientoFinanciero.monto), 0).label("total"),
    ).join(CategoriaFinanciera).filter(
        MovimientoFinanciero.mes == mes, MovimientoFinanciero.anio == anio,
    ).group_by(CategoriaFinanciera.tipo, CategoriaFinanciera.nombre).all()
    result = {"INGRESO": {}, "EGRESO": {}}
    for r in rows:
        result.get(r.tipo, {})[r.nombre] = int(r.total)
    return result


def _op_from_envios(db: Session, mes: int, anio: int, empresa=None, zona=None):
    q = db.query(
        F.count(Envio.id).label("envios"),
        F.coalesce(F.sum(Envio.cobro_seller), 0).label("cobro_seller"),
        F.coalesce(F.sum(Envio.extra_producto_seller), 0).label("extra_seller"),
        F.coalesce(F.sum(Envio.extra_comuna_seller), 0).label("extra_comuna_seller"),
        F.coalesce(F.sum(Envio.costo_driver), 0).label("costo_driver"),
        F.coalesce(F.sum(Envio.extra_producto_driver), 0).label("extra_driver"),
        F.coalesce(F.sum(Envio.extra_comuna_driver), 0).label("extra_comuna_driver"),
    )
    q = _env_filters(q, mes, anio, empresa, zona)
    r = q.first()
    return {
        "envios": int(r.envios),
        "cobro_seller": int(r.cobro_seller),
        "extra_seller": int(r.extra_seller) + int(r.extra_comuna_seller),
        "costo_driver": int(r.costo_driver),
        "extra_driver": int(r.extra_driver) + int(r.extra_comuna_driver),
    }


# ════════════════════════════════════════════════════
#  INFORME 1 — P&L Operacional + CCC
# ════════════════════════════════════════════════════

@router.get("/pnl")
def pnl(
    mes: int = Query(...), anio: int = Query(...),
    empresa: Optional[str] = None, zona: Optional[str] = None,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    op = _op_from_envios(db, mes, anio, empresa, zona)

    retiro_ingreso = int(db.query(F.coalesce(F.sum(Envio.cobro_extra_manual), 0)).filter(
        Envio.mes == mes, Envio.anio == anio, Envio.cobro_extra_manual > 0,
    ).scalar() or 0)
    retiro_costo = int(db.query(F.coalesce(F.sum(Envio.pago_extra_manual), 0)).filter(
        Envio.mes == mes, Envio.anio == anio, Envio.pago_extra_manual > 0,
    ).scalar() or 0)

    manual = _manual_totals(db, mes, anio)
    total_manual_ingreso = sum(manual["INGRESO"].values())
    total_manual_egreso = sum(manual["EGRESO"].values())

    ingreso_op = op["cobro_seller"] + op["extra_seller"] + retiro_ingreso
    costo_op = op["costo_driver"] + op["extra_driver"] + retiro_costo
    total_ingresos = ingreso_op + total_manual_ingreso
    total_egresos = costo_op + total_manual_egreso
    resultado = total_ingresos - total_egresos
    margen = round(resultado / total_ingresos * 100, 1) if total_ingresos > 0 else 0

    mes_ant = mes - 1 if mes > 1 else 12
    anio_ant = anio if mes > 1 else anio - 1
    op_ant = _op_from_envios(db, mes_ant, anio_ant, empresa, zona)
    manual_ant = _manual_totals(db, mes_ant, anio_ant)
    ingreso_op_ant = op_ant["cobro_seller"] + op_ant["extra_seller"]
    costo_op_ant = op_ant["costo_driver"] + op_ant["extra_driver"]
    total_ing_ant = ingreso_op_ant + sum(manual_ant["INGRESO"].values())
    total_egr_ant = costo_op_ant + sum(manual_ant["EGRESO"].values())

    ccc = None
    if anio >= 2026:
        ccc = _calc_ccc(db, mes, anio)

    chart = []
    for m in range(1, 13):
        o = _op_from_envios(db, m, anio, empresa, zona)
        mn = _manual_totals(db, m, anio)
        ing = o["cobro_seller"] + o["extra_seller"] + sum(mn["INGRESO"].values())
        egr = o["costo_driver"] + o["extra_driver"] + sum(mn["EGRESO"].values())
        chart.append({"mes": m, "label": MESES[m], "ingresos": ing, "egresos": egr, "resultado": ing - egr,
                       "margen": round((ing - egr) / ing * 100, 1) if ing > 0 else 0})

    return {
        "periodo": {"mes": mes, "anio": anio},
        "resumen": {
            "total_ingresos": total_ingresos, "total_egresos": total_egresos,
            "resultado": resultado, "margen": margen, "envios": op["envios"],
            "total_ingresos_ant": total_ing_ant, "total_egresos_ant": total_egr_ant,
            "resultado_ant": total_ing_ant - total_egr_ant,
        },
        "desglose_ingresos": {
            "cobro_envios": op["cobro_seller"], "extras_seller": op["extra_seller"],
            "retiros": retiro_ingreso,
            **{f"manual_{k}": v for k, v in manual["INGRESO"].items()},
        },
        "desglose_egresos": {
            "pago_drivers": op["costo_driver"], "extras_driver": op["extra_driver"],
            "retiros": retiro_costo,
            **{f"manual_{k}": v for k, v in manual["EGRESO"].items()},
        },
        "ccc": ccc,
        "chart": chart,
    }


def _calc_ccc(db: Session, mes: int, anio: int):
    sellers_data = db.query(
        Seller.id, Seller.nombre,
        F.coalesce(F.sum(PagoSemanaSeller.monto_neto), 0).label("facturado"),
        F.coalesce(F.sum(PagoCartolaSeller.monto), 0).label("cobrado"),
    ).outerjoin(PagoSemanaSeller, (PagoSemanaSeller.seller_id == Seller.id) & (PagoSemanaSeller.mes == mes) & (PagoSemanaSeller.anio == anio)
    ).outerjoin(PagoCartolaSeller, (PagoCartolaSeller.seller_id == Seller.id) & (PagoCartolaSeller.mes == mes) & (PagoCartolaSeller.anio == anio)
    ).filter(Seller.activo == True
    ).group_by(Seller.id, Seller.nombre).all()

    total_facturado = 0
    total_cobrado = 0
    slow_sellers = []
    for s in sellers_data:
        fac = int(s.facturado)
        cob = int(s.cobrado)
        if fac <= 0:
            continue
        total_facturado += fac
        total_cobrado += cob
        pendiente = fac - cob
        if pendiente > 0:
            slow_sellers.append({"id": s.id, "nombre": s.nombre, "facturado": fac, "cobrado": cob, "pendiente": pendiente})

    slow_sellers.sort(key=lambda x: x["pendiente"], reverse=True)
    capital_atrapado = total_facturado - total_cobrado

    return {
        "capital_atrapado": capital_atrapado,
        "total_facturado": total_facturado,
        "total_cobrado": total_cobrado,
        "pct_cobrado": round(total_cobrado / total_facturado * 100, 1) if total_facturado > 0 else 0,
        "top_slow": slow_sellers[:10],
    }


# ════════════════════════════════════════════════════
#  INFORME 2 — Unit Economics
# ════════════════════════════════════════════════════

@router.get("/unit-economics")
def unit_economics(
    mes: int = Query(...), anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    total = _ue_for_period(db, mes, anio)
    mes_ant = mes - 1 if mes > 1 else 12
    anio_ant = anio if mes > 1 else anio - 1
    prev = _ue_for_period(db, mes_ant, anio_ant)

    by_zona = db.query(
        Envio.zona,
        F.count(Envio.id).label("envios"),
        F.coalesce(F.sum(Envio.cobro_seller + Envio.extra_producto_seller + Envio.extra_comuna_seller), 0).label("revenue"),
        F.coalesce(F.sum(Envio.costo_driver + Envio.extra_producto_driver + Envio.extra_comuna_driver), 0).label("cost"),
    ).filter(Envio.mes == mes, Envio.anio == anio, Envio.estado_entrega == 'delivered'
    ).group_by(Envio.zona).all()

    zonas = []
    for z in by_zona:
        env = int(z.envios)
        rev = int(z.revenue)
        cost = int(z.cost)
        if env == 0:
            continue
        zonas.append({
            "zona": z.zona or "Sin zona",
            "envios": env,
            "rev_envio": round(rev / env),
            "cost_envio": round(cost / env),
            "margen_envio": round((rev - cost) / env),
            "margen_pct": round((rev - cost) / rev * 100, 1) if rev > 0 else 0,
        })
    zonas.sort(key=lambda x: x["envios"], reverse=True)

    chart = []
    for m in range(1, 13):
        ue = _ue_for_period(db, m, anio)
        chart.append({"mes": m, "label": MESES[m], **ue})

    return {"periodo": {"mes": mes, "anio": anio}, "total": total, "prev": prev, "zonas": zonas, "chart": chart}


def _ue_for_period(db, mes, anio):
    r = db.query(
        F.count(Envio.id).label("envios"),
        F.coalesce(F.sum(Envio.cobro_seller + Envio.extra_producto_seller + Envio.extra_comuna_seller), 0).label("revenue"),
        F.coalesce(F.sum(Envio.costo_driver + Envio.extra_producto_driver + Envio.extra_comuna_driver), 0).label("cost"),
    ).filter(Envio.mes == mes, Envio.anio == anio, Envio.estado_entrega == 'delivered').first()
    env = int(r.envios)
    rev = int(r.revenue)
    cost = int(r.cost)
    margin = rev - cost
    return {
        "envios": env,
        "revenue": rev,
        "cost": cost,
        "rev_envio": round(rev / env) if env > 0 else 0,
        "cost_envio": round(cost / env) if env > 0 else 0,
        "margen_envio": round(margin / env) if env > 0 else 0,
        "margen_pct": round(margin / rev * 100, 1) if rev > 0 else 0,
    }


# ════════════════════════════════════════════════════
#  INFORME 3/4/5 — Rentabilidad Seller/Driver/Pickup
# ════════════════════════════════════════════════════

@router.get("/rentabilidad/sellers")
def rentabilidad_sellers(
    mes: int = Query(...), anio: int = Query(...),
    zona: Optional[str] = None, empresa: Optional[str] = None,
    min_envios: int = Query(1),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    q = db.query(
        Seller.id, Seller.nombre, Seller.zona, Seller.empresa, Seller.tipo_pago,
        F.count(Envio.id).label("envios"),
        F.coalesce(F.sum(Envio.cobro_seller + Envio.extra_producto_seller + Envio.extra_comuna_seller), 0).label("revenue"),
        F.coalesce(F.sum(Envio.costo_driver + Envio.extra_producto_driver + Envio.extra_comuna_driver), 0).label("cost"),
    ).join(Envio, Envio.seller_id == Seller.id
    ).filter(Envio.mes == mes, Envio.anio == anio, Envio.estado_entrega == 'delivered')
    if zona:
        q = q.filter(Envio.zona == zona)
    if empresa:
        q = q.filter(Envio.empresa == empresa)
    q = q.group_by(Seller.id, Seller.nombre, Seller.zona, Seller.empresa, Seller.tipo_pago
    ).having(F.count(Envio.id) >= min_envios)
    rows = q.all()

    sellers = []
    for r in rows:
        env = int(r.envios)
        rev = int(r.revenue)
        cost = int(r.cost)
        margin = rev - cost
        sellers.append({
            "id": r.id, "nombre": r.nombre, "zona": r.zona, "empresa": r.empresa,
            "tipo_pago": r.tipo_pago,
            "envios": env, "revenue": rev, "cost": cost, "margin": margin,
            "margin_pct": round(margin / rev * 100, 1) if rev > 0 else 0,
            "rev_envio": round(rev / env) if env > 0 else 0,
            "cost_envio": round(cost / env) if env > 0 else 0,
        })
    sellers.sort(key=lambda x: x["margin"], reverse=True)

    total_rev = sum(s["revenue"] for s in sellers)
    total_margin = sum(s["margin"] for s in sellers)
    best = sellers[0] if sellers else None
    worst = sellers[-1] if sellers else None

    return {
        "periodo": {"mes": mes, "anio": anio},
        "total_sellers": len(sellers),
        "total_revenue": total_rev,
        "total_margin": total_margin,
        "avg_margin_pct": round(total_margin / total_rev * 100, 1) if total_rev > 0 else 0,
        "best": best,
        "worst": worst,
        "sellers": sellers,
    }


@router.get("/rentabilidad/drivers")
def rentabilidad_drivers(
    mes: int = Query(...), anio: int = Query(...),
    empresa: Optional[str] = None,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    q = db.query(
        Driver.id, Driver.nombre, Driver.contratado,
        F.count(Envio.id).label("envios"),
        F.coalesce(F.sum(Envio.cobro_seller + Envio.extra_producto_seller + Envio.extra_comuna_seller), 0).label("revenue"),
        F.coalesce(F.sum(Envio.costo_driver + Envio.extra_producto_driver + Envio.extra_comuna_driver), 0).label("cost"),
    ).join(Envio, Envio.driver_id == Driver.id
    ).filter(Envio.mes == mes, Envio.anio == anio, Envio.estado_entrega == 'delivered',
             Driver.jefe_flota_id.is_(None))
    if empresa:
        q = q.filter(Envio.empresa == empresa)
    q = q.group_by(Driver.id, Driver.nombre, Driver.contratado)
    rows = q.all()

    drivers = []
    for r in rows:
        env = int(r.envios)
        rev = int(r.revenue)
        cost = int(r.cost)
        margin = rev - cost
        payout_pct = round(cost / rev * 100, 1) if rev > 0 else 0
        drivers.append({
            "id": r.id, "nombre": r.nombre, "contratado": r.contratado,
            "envios": env, "revenue": rev, "cost": cost, "margin": margin,
            "margin_pct": round(margin / rev * 100, 1) if rev > 0 else 0,
            "payout_pct": payout_pct,
            "cost_envio": round(cost / env) if env > 0 else 0,
        })
    drivers.sort(key=lambda x: x["envios"], reverse=True)

    return {
        "periodo": {"mes": mes, "anio": anio},
        "total_drivers": len(drivers),
        "drivers": drivers,
    }


@router.get("/rentabilidad/pickups")
def rentabilidad_pickups(
    mes: int = Query(...), anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    q = db.query(
        Pickup.id, Pickup.nombre, Pickup.comision_paquete,
        F.count(Envio.id).label("envios"),
        F.coalesce(F.sum(Envio.cobro_seller), 0).label("revenue_envios"),
    ).join(Envio, Envio.seller_id == Pickup.seller_id
    ).filter(Envio.mes == mes, Envio.anio == anio, Envio.estado_entrega == 'delivered',
             Pickup.seller_id.isnot(None)
    ).group_by(Pickup.id, Pickup.nombre, Pickup.comision_paquete)
    rows = q.all()

    pickups_out = []
    for r in rows:
        env = int(r.envios)
        costo_pickup = env * (r.comision_paquete or 200)
        pago_pickup = int(db.query(
            F.coalesce(F.sum(PagoSemanaPickup.monto_neto), 0)
        ).filter(PagoSemanaPickup.pickup_id == r.id, PagoSemanaPickup.mes == mes, PagoSemanaPickup.anio == anio).scalar())
        costo_real = max(costo_pickup, pago_pickup)
        pickups_out.append({
            "id": r.id, "nombre": r.nombre,
            "envios": env, "costo": costo_real,
            "comision_unitaria": r.comision_paquete or 200,
        })
    pickups_out.sort(key=lambda x: x["envios"], reverse=True)

    return {"periodo": {"mes": mes, "anio": anio}, "pickups": pickups_out}


# ════════════════════════════════════════════════════
#  INFORME 6+9 — Costos + Contratado vs Tercerizado
# ════════════════════════════════════════════════════

@router.get("/costos")
def costos(
    mes: int = Query(...), anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    op = _op_from_envios(db, mes, anio)
    manual = _manual_totals(db, mes, anio)

    by_type = db.query(
        Driver.contratado,
        F.count(Envio.id).label("envios"),
        F.coalesce(F.sum(Envio.cobro_seller + Envio.extra_producto_seller + Envio.extra_comuna_seller), 0).label("revenue"),
        F.coalesce(F.sum(Envio.costo_driver + Envio.extra_producto_driver + Envio.extra_comuna_driver), 0).label("cost"),
    ).join(Driver, Envio.driver_id == Driver.id
    ).filter(Envio.mes == mes, Envio.anio == anio, Envio.estado_entrega == 'delivered',
             Driver.jefe_flota_id.is_(None)
    ).group_by(Driver.contratado).all()

    contratado = {"envios": 0, "revenue": 0, "cost": 0}
    tercerizado = {"envios": 0, "revenue": 0, "cost": 0}
    for r in by_type:
        d = contratado if r.contratado else tercerizado
        d["envios"] = int(r.envios)
        d["revenue"] = int(r.revenue)
        d["cost"] = int(r.cost)

    for d in [contratado, tercerizado]:
        d["margin"] = d["revenue"] - d["cost"]
        d["margin_pct"] = round(d["margin"] / d["revenue"] * 100, 1) if d["revenue"] > 0 else 0
        d["cpd"] = round(d["cost"] / d["envios"]) if d["envios"] > 0 else 0

    total_cost = op["costo_driver"] + op["extra_driver"] + sum(manual["EGRESO"].values())
    payout_pct = round((op["costo_driver"] + op["extra_driver"]) / (op["cobro_seller"] + op["extra_seller"]) * 100, 1) if (op["cobro_seller"] + op["extra_seller"]) > 0 else 0

    composicion = {
        "pago_drivers": op["costo_driver"],
        "extras_driver": op["extra_driver"],
    }
    for k, v in manual["EGRESO"].items():
        composicion[k] = v

    return {
        "periodo": {"mes": mes, "anio": anio},
        "total_cost": total_cost,
        "cpd_promedio": round(total_cost / op["envios"]) if op["envios"] > 0 else 0,
        "payout_pct": payout_pct,
        "composicion": composicion,
        "contratado": contratado,
        "tercerizado": tercerizado,
    }


# ════════════════════════════════════════════════════
#  INFORME 7 — YoY Comparativo
# ════════════════════════════════════════════════════

@router.get("/yoy")
def yoy(
    mes: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    years = [2024, 2025, 2026]
    data = {}

    def _op_anio(y):
        """Sum all months of a year when mes=0."""
        if mes != 0:
            return _op_from_envios(db, mes, y)
        totals = {"envios": 0, "cobro_seller": 0, "extra_seller": 0, "costo_driver": 0, "extra_driver": 0}
        for m in range(1, 13):
            op = _op_from_envios(db, m, y)
            for k in totals:
                totals[k] += op[k]
        return totals

    def _manual_anio(y):
        if mes != 0:
            return _manual_totals(db, mes, y)
        result = {"INGRESO": {}, "EGRESO": {}}
        for m in range(1, 13):
            mn = _manual_totals(db, m, y)
            for tipo in ("INGRESO", "EGRESO"):
                for cat, val in mn[tipo].items():
                    result[tipo][cat] = result[tipo].get(cat, 0) + val
        return result

    for y in years:
        op = _op_anio(y)
        manual = _manual_anio(y)
        rev = op["cobro_seller"] + op["extra_seller"] + sum(manual["INGRESO"].values())
        cost = op["costo_driver"] + op["extra_driver"] + sum(manual["EGRESO"].values())
        if mes != 0:
            sellers_activos = db.query(F.count(F.distinct(Envio.seller_id))).filter(
                Envio.mes == mes, Envio.anio == y, Envio.estado_entrega == 'delivered').scalar()
            drivers_activos = db.query(F.count(F.distinct(Envio.driver_id))).filter(
                Envio.mes == mes, Envio.anio == y, Envio.estado_entrega == 'delivered').scalar()
        else:
            sellers_activos = db.query(F.count(F.distinct(Envio.seller_id))).filter(
                Envio.anio == y, Envio.estado_entrega == 'delivered').scalar()
            drivers_activos = db.query(F.count(F.distinct(Envio.driver_id))).filter(
                Envio.anio == y, Envio.estado_entrega == 'delivered').scalar()
        data[y] = {
            "anio": y, "envios": op["envios"], "revenue": rev, "cost": cost,
            "resultado": rev - cost,
            "margen_pct": round((rev - cost) / rev * 100, 1) if rev > 0 else 0,
            "rev_envio": round(rev / op["envios"]) if op["envios"] > 0 else 0,
            "cpd": round(cost / op["envios"]) if op["envios"] > 0 else 0,
            "sellers_activos": sellers_activos or 0,
            "drivers_activos": drivers_activos or 0,
        }

    chart = []
    for m in range(1, 13):
        row = {"mes": m, "label": MESES[m]}
        for y in years:
            op = _op_from_envios(db, m, y)
            mn = _manual_totals(db, m, y)
            rev = op["cobro_seller"] + op["extra_seller"] + sum(mn["INGRESO"].values())
            cost = op["costo_driver"] + op["extra_driver"] + sum(mn["EGRESO"].values())
            row[f"revenue_{y}"] = rev
            row[f"resultado_{y}"] = rev - cost
            row[f"envios_{y}"] = op["envios"]
        chart.append(row)

    return {"mes": mes, "years": data, "chart": chart}


# ════════════════════════════════════════════════════
#  INFORME 8 — Salud Comercial
# ════════════════════════════════════════════════════

@router.get("/salud")
def salud_comercial(
    mes: int = Query(...), anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    sellers_rev = db.query(
        Seller.id, Seller.nombre,
        F.coalesce(F.sum(Envio.cobro_seller + Envio.extra_producto_seller + Envio.extra_comuna_seller), 0).label("revenue"),
        F.count(Envio.id).label("envios"),
    ).join(Envio, Envio.seller_id == Seller.id
    ).filter(Envio.mes == mes, Envio.anio == anio, Envio.estado_entrega == 'delivered'
    ).group_by(Seller.id, Seller.nombre
    ).order_by(F.sum(Envio.cobro_seller + Envio.extra_producto_seller + Envio.extra_comuna_seller).desc()
    ).all()

    total_rev = sum(int(s.revenue) for s in sellers_rev)
    acum = 0
    ranking = []
    for i, s in enumerate(sellers_rev):
        rev = int(s.revenue)
        acum += rev
        ranking.append({
            "rank": i + 1, "id": s.id, "nombre": s.nombre,
            "revenue": rev, "envios": int(s.envios),
            "pct": round(rev / total_rev * 100, 1) if total_rev > 0 else 0,
            "pct_acum": round(acum / total_rev * 100, 1) if total_rev > 0 else 0,
        })

    top5_pct = ranking[4]["pct_acum"] if len(ranking) >= 5 else 100
    top10_pct = ranking[9]["pct_acum"] if len(ranking) >= 10 else 100
    hhi = sum((s["pct"] / 100) ** 2 for s in ranking)

    m1, a1 = (mes - 1, anio) if mes > 1 else (12, anio - 1)
    m2, a2 = (m1 - 1, a1) if m1 > 1 else (12, a1 - 1)
    m3, a3 = (m2 - 1, a2) if m2 > 1 else (12, a2 - 1)

    def _active_seller_ids(m, a):
        return set(r[0] for r in db.query(F.distinct(Envio.seller_id)).filter(
            Envio.mes == m, Envio.anio == a, Envio.estado_entrega == 'delivered', Envio.seller_id.isnot(None)).all())

    current_ids = _active_seller_ids(mes, anio)
    prev_ids = _active_seller_ids(m1, a1)
    nuevos = current_ids - prev_ids
    churn = prev_ids - current_ids
    retencion = round(len(current_ids - nuevos) / len(prev_ids) * 100, 1) if prev_ids else 100

    def _seller_envios(sid, m, a):
        return db.query(F.count(Envio.id)).filter(
            Envio.seller_id == sid, Envio.mes == m, Envio.anio == a, Envio.estado_entrega == 'delivered').scalar() or 0

    en_riesgo = []
    for sid in current_ids:
        e3 = _seller_envios(sid, m3, a3)
        e2 = _seller_envios(sid, m2, a2)
        e1 = _seller_envios(sid, m1, a1)
        e0 = _seller_envios(sid, mes, anio)
        if e1 > 0 and e0 < e1 * 0.7:
            nombre = db.query(Seller.nombre).filter(Seller.id == sid).scalar()
            en_riesgo.append({"id": sid, "nombre": nombre, "envios": [e3, e2, e1, e0],
                              "tendencia_pct": round((e0 - e1) / e1 * 100, 1) if e1 > 0 else 0})
    en_riesgo.sort(key=lambda x: x["tendencia_pct"])

    activos_por_mes = []
    for m in range(1, 13):
        for y in [anio - 2, anio - 1, anio]:
            cnt = db.query(F.count(F.distinct(Envio.seller_id))).filter(
                Envio.mes == m, Envio.anio == y, Envio.estado_entrega == 'delivered').scalar() or 0
            activos_por_mes.append({"mes": m, "anio": y, "label": f"{MESES[m]} {y}", "activos": cnt})

    return {
        "periodo": {"mes": mes, "anio": anio},
        "concentracion": {
            "total_sellers": len(ranking),
            "total_revenue": total_rev,
            "top5_pct": top5_pct, "top10_pct": top10_pct,
            "hhi": round(hhi, 4),
            "ranking": ranking[:30],
        },
        "retencion": {
            "tasa": retencion, "nuevos": len(nuevos), "churn": len(churn),
            "sellers_activos": len(current_ids),
            "en_riesgo": en_riesgo[:15],
        },
        "activos_por_mes": activos_por_mes,
    }


# ════════════════════════════════════════════════════
#  GROK AI — Proxy
# ════════════════════════════════════════════════════

from pydantic import BaseModel
from typing import List
import httpx


class GrokRequest(BaseModel):
    pregunta: str
    contexto: List[str] = []


@router.post("/grok")
async def grok_query(
    req: GrokRequest,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    import os
    api_key = os.environ.get("XAI_API_KEY", "")
    if not api_key:
        return {"error": "XAI_API_KEY no configurada en el servidor"}
    system_prompt = (
        "Eres un analista financiero senior de E-Courier, una empresa chilena de paquetería B2B. "
        "Respondes en español. Usas moneda CLP. Sé conciso y directo. "
        "Si te dan contexto numérico, basa tus respuestas en esos datos."
    )
    context_block = "\n\n".join(req.contexto) if req.contexto else ""
    user_msg = f"CONTEXTO FINANCIERO:\n{context_block}\n\nPREGUNTA: {req.pregunta}" if context_block else req.pregunta

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            "https://api.x.ai/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": "grok-3",
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_msg},
                ],
                "temperature": 0.3,
            },
        )
    if resp.status_code != 200:
        return {"error": f"Grok API error: {resp.status_code}", "detail": resp.text}
    data = resp.json()
    answer = data["choices"][0]["message"]["content"]
    usage = data.get("usage", {})
    return {"respuesta": answer, "tokens": usage}


# ════════════════════════════════════════════════════
#  GROK — Guardar / Historial de análisis
# ════════════════════════════════════════════════════

class GuardarAnalisisRequest(BaseModel):
    titulo: str = ""
    pregunta: str
    respuesta: str
    contextos: List[str] = []
    mes: int
    anio: int
    tab: str = ""
    tokens_total: int = 0


@router.post("/grok/guardar")
def guardar_analisis(
    req: GuardarAnalisisRequest,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    titulo = req.titulo.strip() or req.pregunta[:80]
    analisis = GrokAnalisis(
        titulo=titulo,
        pregunta=req.pregunta,
        respuesta=req.respuesta,
        contextos=req.contextos,
        mes=req.mes,
        anio=req.anio,
        tab=req.tab,
        tokens_total=req.tokens_total,
    )
    db.add(analisis)
    db.commit()
    db.refresh(analisis)
    return {"ok": True, "id": analisis.id}


@router.get("/grok/historial")
def listar_historial(
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    rows = (
        db.query(GrokAnalisis)
        .order_by(GrokAnalisis.created_at.desc())
        .limit(200)
        .all()
    )
    return [
        {
            "id": r.id,
            "titulo": r.titulo,
            "pregunta": r.pregunta,
            "respuesta": r.respuesta,
            "contextos": r.contextos,
            "mes": r.mes,
            "anio": r.anio,
            "tab": r.tab,
            "tokens_total": r.tokens_total,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.delete("/grok/historial/{analisis_id}")
def eliminar_analisis(
    analisis_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    row = db.query(GrokAnalisis).filter(GrokAnalisis.id == analisis_id).first()
    if not row:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Análisis no encontrado")
    db.delete(row)
    db.commit()
    return {"ok": True}
