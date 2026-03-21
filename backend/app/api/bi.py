from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func as F, case, extract, cast, Date, text
from typing import Optional

from app.database import get_db
from app.auth import require_admin_or_administracion
from app.models import (
    Envio, Seller, Driver, Pickup, RecepcionPaquete, Retiro,
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

    # ── Retiros por seller — ingreso (tarifa_seller) y costo (tarifa_driver) ──
    retiro_rows = db.query(
        Retiro.seller_id,
        F.coalesce(F.sum(Retiro.tarifa_seller), 0).label("ret_ingreso"),
        F.coalesce(F.sum(Retiro.tarifa_driver), 0).label("ret_costo"),
    ).filter(Retiro.mes == mes, Retiro.anio == anio, Retiro.seller_id.isnot(None)
    ).group_by(Retiro.seller_id).all()
    ret_map = {r.seller_id: (int(r.ret_ingreso), int(r.ret_costo)) for r in retiro_rows}

    sellers = []
    for r in rows:
        env = int(r.envios)
        rev = int(r.revenue)
        cost = int(r.cost)
        ret_ing, ret_cos = ret_map.get(r.id, (0, 0))
        total_rev = rev + ret_ing
        total_cost = cost + ret_cos
        margin = total_rev - total_cost
        sellers.append({
            "id": r.id, "nombre": r.nombre, "zona": r.zona, "empresa": r.empresa,
            "tipo_pago": r.tipo_pago,
            "envios": env,
            "revenue": total_rev, "revenue_envios": rev, "revenue_retiros": ret_ing,
            "cost": total_cost, "cost_envios": cost, "cost_retiros": ret_cos,
            "margin": margin,
            "margin_pct": round(margin / total_rev * 100, 1) if total_rev > 0 else 0,
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

    # ── Retiros por driver — ingreso (tarifa_seller) y costo (tarifa_driver) ──
    retiro_rows = db.query(
        Retiro.driver_id,
        F.coalesce(F.sum(Retiro.tarifa_seller), 0).label("ret_ingreso"),
        F.coalesce(F.sum(Retiro.tarifa_driver), 0).label("ret_costo"),
    ).filter(Retiro.mes == mes, Retiro.anio == anio, Retiro.driver_id.isnot(None)
    ).group_by(Retiro.driver_id).all()
    ret_map = {r.driver_id: (int(r.ret_ingreso), int(r.ret_costo)) for r in retiro_rows}

    drivers = []
    for r in rows:
        env = int(r.envios)
        rev = int(r.revenue)
        cost = int(r.cost)
        ret_ing, ret_cos = ret_map.get(r.id, (0, 0))
        total_rev = rev + ret_ing
        total_cost = cost + ret_cos
        margin = total_rev - total_cost
        payout_pct = round(total_cost / total_rev * 100, 1) if total_rev > 0 else 0
        drivers.append({
            "id": r.id, "nombre": r.nombre, "contratado": r.contratado,
            "envios": env,
            "revenue": total_rev, "revenue_envios": rev, "revenue_retiros": ret_ing,
            "cost": total_cost, "cost_envios": cost, "cost_retiros": ret_cos,
            "margin": margin,
            "margin_pct": round(margin / total_rev * 100, 1) if total_rev > 0 else 0,
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
    # ── Pickups como puntos de recepción — fuente correcta ────────────────────
    # Usamos RecepcionPaquete (no seller_id) para contar paquetes RECIBIDOS
    rows = db.query(
        Pickup.id, Pickup.nombre,
        F.count(RecepcionPaquete.id).label("recepciones"),
        F.coalesce(F.sum(
            case((Envio.id.isnot(None),
                  Envio.cobro_seller + Envio.extra_producto_seller + Envio.extra_comuna_seller),
                 else_=0)
        ), 0).label("revenue"),
        F.coalesce(F.sum(RecepcionPaquete.comision), 0).label("costo_comisiones"),
    ).join(RecepcionPaquete, RecepcionPaquete.pickup_id == Pickup.id
    ).outerjoin(Envio, Envio.id == RecepcionPaquete.envio_id
    ).filter(
        RecepcionPaquete.mes == mes,
        RecepcionPaquete.anio == anio,
    ).group_by(Pickup.id, Pickup.nombre
    ).all()

    # Bulk fetch PagoSemanaPickup para costo real pagado
    pagos = {
        r.pickup_id: int(r.total)
        for r in db.query(
            PagoSemanaPickup.pickup_id,
            F.coalesce(F.sum(PagoSemanaPickup.monto_neto), 0).label("total"),
        ).filter(PagoSemanaPickup.mes == mes, PagoSemanaPickup.anio == anio
        ).group_by(PagoSemanaPickup.pickup_id).all()
    }

    # ── Retiros por pickup — ingreso (tarifa_seller) y costo (tarifa_driver) ─
    retiro_rows = db.query(
        Retiro.pickup_id,
        F.coalesce(F.sum(Retiro.tarifa_seller), 0).label("ret_ingreso"),
        F.coalesce(F.sum(Retiro.tarifa_driver), 0).label("ret_costo"),
    ).filter(Retiro.mes == mes, Retiro.anio == anio, Retiro.pickup_id.isnot(None)
    ).group_by(Retiro.pickup_id).all()
    ret_map = {r.pickup_id: (int(r.ret_ingreso), int(r.ret_costo)) for r in retiro_rows}

    pickups_out = []
    for r in rows:
        recepciones = int(r.recepciones)
        costo_comisiones = int(r.costo_comisiones)
        pago_pickup = pagos.get(r.id, 0)
        costo_real = max(costo_comisiones, pago_pickup)
        revenue = int(r.revenue)
        ret_ing, ret_cos = ret_map.get(r.id, (0, 0))
        total_rev = revenue + ret_ing
        total_cost = costo_real + ret_cos
        margin = total_rev - total_cost
        margin_pct = round(margin / total_rev * 100, 1) if total_rev > 0 else 0
        pickups_out.append({
            "id": r.id, "nombre": r.nombre,
            "recepciones": recepciones,
            "revenue": total_rev, "revenue_recepciones": revenue, "revenue_retiros": ret_ing,
            "costo": total_cost, "costo_recepciones": costo_real, "costo_retiros": ret_cos,
            "margin": margin,
            "margin_pct": margin_pct,
            "comision_unitaria": round(costo_comisiones / recepciones) if recepciones > 0 else 0,
        })
    pickups_out.sort(key=lambda x: x["recepciones"], reverse=True)

    return {
        "periodo": {"mes": mes, "anio": anio},
        "total_recepciones": sum(p["recepciones"] for p in pickups_out),
        "total_revenue": sum(p["revenue"] for p in pickups_out),
        "total_costo": sum(p["costo"] for p in pickups_out),
        "pickups": pickups_out,
    }


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

    # ── Single query for all envios grouped by anio + mes ──────────────────────
    env_rows = db.query(
        Envio.anio,
        Envio.mes,
        F.count(Envio.id).label("envios"),
        F.coalesce(F.sum(Envio.cobro_seller + Envio.extra_producto_seller + Envio.extra_comuna_seller), 0).label("revenue"),
        F.coalesce(F.sum(Envio.costo_driver + Envio.extra_producto_driver + Envio.extra_comuna_driver), 0).label("cost"),
    ).filter(
        Envio.anio.in_(years),
        Envio.estado_entrega == 'delivered',
    ).group_by(Envio.anio, Envio.mes).all()

    # Build matrix: env_matrix[anio][mes] = {revenue, cost, envios}
    env_matrix = {y: {m: {"revenue": 0, "cost": 0, "envios": 0} for m in range(0, 13)} for y in years}
    for r in env_rows:
        env_matrix[r.anio][r.mes] = {"revenue": int(r.revenue), "cost": int(r.cost), "envios": int(r.envios)}
        # Accumulate into month 0 (annual total)
        env_matrix[r.anio][0]["revenue"] += int(r.revenue)
        env_matrix[r.anio][0]["cost"] += int(r.cost)
        env_matrix[r.anio][0]["envios"] += int(r.envios)

    # ── Manual totals per year (for the requested month or full year) ───────────
    def _manual_for(y, m):
        if m == 0:
            result = {"INGRESO": {}, "EGRESO": {}}
            for mm in range(1, 13):
                mn = _manual_totals(db, mm, y)
                for tipo in ("INGRESO", "EGRESO"):
                    for cat, val in mn[tipo].items():
                        result[tipo][cat] = result[tipo].get(cat, 0) + val
            return result
        return _manual_totals(db, m, y)

    # ── Header KPIs for selected mes ───────────────────────────────────────────
    data = {}
    for y in years:
        op = env_matrix[y][mes]
        manual = _manual_for(y, mes)
        rev = op["revenue"] + sum(manual["INGRESO"].values())
        cost = op["cost"] + sum(manual["EGRESO"].values())
        if mes != 0:
            sellers_q = db.query(F.count(F.distinct(Envio.seller_id))).filter(
                Envio.mes == mes, Envio.anio == y, Envio.estado_entrega == 'delivered').scalar()
            drivers_q = db.query(F.count(F.distinct(Envio.driver_id))).filter(
                Envio.mes == mes, Envio.anio == y, Envio.estado_entrega == 'delivered').scalar()
        else:
            sellers_q = db.query(F.count(F.distinct(Envio.seller_id))).filter(
                Envio.anio == y, Envio.estado_entrega == 'delivered').scalar()
            drivers_q = db.query(F.count(F.distinct(Envio.driver_id))).filter(
                Envio.anio == y, Envio.estado_entrega == 'delivered').scalar()
        data[y] = {
            "anio": y, "envios": op["envios"], "revenue": rev, "cost": cost,
            "resultado": rev - cost,
            "margen_pct": round((rev - cost) / rev * 100, 1) if rev > 0 else 0,
            "rev_envio": round(rev / op["envios"]) if op["envios"] > 0 else 0,
            "cpd": round(cost / op["envios"]) if op["envios"] > 0 else 0,
            "sellers_activos": sellers_q or 0,
            "drivers_activos": drivers_q or 0,
        }

    # ── Monthly chart (always all 12 months) ────────────────────────────────────
    chart = []
    for m in range(1, 13):
        row = {"mes": m, "label": MESES[m]}
        for y in years:
            op = env_matrix[y][m]
            row[f"revenue_{y}"] = op["revenue"]
            row[f"resultado_{y}"] = op["revenue"] - op["cost"]
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
    # ── Concentración de revenue ────────────────────────────────────────────────
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

    # ── Retención / Churn — usando 4 meses previos ─────────────────────────────
    m1, a1 = (mes - 1, anio) if mes > 1 else (12, anio - 1)
    m2, a2 = (m1 - 1, a1) if m1 > 1 else (12, a1 - 1)
    m3, a3 = (m2 - 1, a2) if m2 > 1 else (12, a2 - 1)

    def _active_seller_ids(m, a):
        return set(r[0] for r in db.query(F.distinct(Envio.seller_id)).filter(
            Envio.mes == m, Envio.anio == a, Envio.estado_entrega == 'delivered',
            Envio.seller_id.isnot(None)).all())

    current_ids = _active_seller_ids(mes, anio)
    prev_ids = _active_seller_ids(m1, a1)
    nuevos = current_ids - prev_ids
    churn = prev_ids - current_ids
    retencion = round(len(current_ids - nuevos) / len(prev_ids) * 100, 1) if prev_ids else 100

    # ── Sellers en riesgo — 1 bulk query instead of N×4 queries ───────────────
    risk_months = [(mes, anio), (m1, a1), (m2, a2), (m3, a3)]
    bulk = db.query(
        Envio.seller_id, Envio.mes, Envio.anio,
        F.count(Envio.id).label("cnt"),
    ).filter(
        Envio.seller_id.in_(list(current_ids)),
        Envio.estado_entrega == 'delivered',
        text(f"(envios.mes, envios.anio) IN ({','.join(f'({m},{a})' for m,a in risk_months)})"),
    ).group_by(Envio.seller_id, Envio.mes, Envio.anio).all()

    # Build lookup: {seller_id: {(mes, anio): cnt}}
    cnt_map: dict = {}
    for r in bulk:
        cnt_map.setdefault(r.seller_id, {})[(r.mes, r.anio)] = int(r.cnt)

    seller_names = {r.id: r.nombre for r in db.query(Seller.id, Seller.nombre).filter(Seller.id.in_(list(current_ids))).all()}

    en_riesgo = []
    for sid in current_ids:
        e0 = cnt_map.get(sid, {}).get((mes, anio), 0)
        e1 = cnt_map.get(sid, {}).get((m1, a1), 0)
        e2 = cnt_map.get(sid, {}).get((m2, a2), 0)
        e3 = cnt_map.get(sid, {}).get((m3, a3), 0)
        if e1 > 0 and e0 < e1 * 0.7:
            en_riesgo.append({
                "id": sid, "nombre": seller_names.get(sid, f"ID {sid}"),
                "envios": [e3, e2, e1, e0],
                "tendencia_pct": round((e0 - e1) / e1 * 100, 1) if e1 > 0 else 0,
            })
    en_riesgo.sort(key=lambda x: x["tendencia_pct"])

    # ── Sellers activos por mes (last 3 years) — 1 GROUP BY query ─────────────
    years_range = [anio - 2, anio - 1, anio]
    activos_rows = db.query(
        Envio.mes, Envio.anio,
        F.count(F.distinct(Envio.seller_id)).label("activos"),
    ).filter(
        Envio.anio.in_(years_range),
        Envio.estado_entrega == 'delivered',
    ).group_by(Envio.mes, Envio.anio).all()

    activos_lookup = {(r.mes, r.anio): int(r.activos) for r in activos_rows}
    activos_por_mes = []
    for m in range(1, 13):
        for y in years_range:
            activos_por_mes.append({
                "mes": m, "anio": y,
                "label": f"{MESES[m]} {y}",
                "activos": activos_lookup.get((m, y), 0),
            })

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
    mes: int = 3
    anio: int = 2026


def _smart_context(db: Session, pregunta: str, mes: int, anio: int) -> str:
    """
    Detects drivers, sellers and zones mentioned in the question and fetches
    real data from the DB.  Always prepends a P&L summary for the period so
    Grok never has to invent numbers.
    """
    lines: list[str] = []
    q_low = pregunta.lower()

    # ── Resumen operacional base ─────────────────────────────────────────────
    base = db.query(
        F.count(Envio.id).label("envios"),
        F.coalesce(F.sum(Envio.cobro_seller + Envio.extra_producto_seller + Envio.extra_comuna_seller), 0).label("revenue"),
        F.coalesce(F.sum(Envio.costo_driver + Envio.extra_producto_driver + Envio.extra_comuna_driver), 0).label("costo"),
    ).filter(Envio.mes == mes, Envio.anio == anio, Envio.estado_entrega == 'delivered').first()

    if base and int(base.envios) > 0:
        rev, cost = int(base.revenue), int(base.costo)
        lines.append(f"=== DATOS REALES — Período {mes}/{anio} ===")
        lines.append(f"Envíos entregados: {int(base.envios):,}")
        lines.append(f"Revenue operacional: ${rev:,}")
        lines.append(f"Costo drivers: ${cost:,}")
        lines.append(f"Margen bruto: ${rev - cost:,} ({round((rev - cost) / rev * 100, 1) if rev else 0}%)")

    # ── Detectar conductores ─────────────────────────────────────────────────
    all_drivers = db.query(Driver.id, Driver.nombre).all()
    matched_drivers = []
    for d in all_drivers:
        parts = [p.strip().lower() for p in d.nombre.split() if len(p.strip()) >= 4]
        if any(p in q_low for p in parts):
            matched_drivers.append(d)

    if matched_drivers:
        driver_rows = db.query(
            Driver.nombre,
            Envio.zona,
            F.count(Envio.id).label("envios"),
            F.coalesce(F.sum(Envio.cobro_seller + Envio.extra_producto_seller + Envio.extra_comuna_seller), 0).label("revenue"),
            F.coalesce(F.sum(Envio.costo_driver + Envio.extra_producto_driver + Envio.extra_comuna_driver), 0).label("costo"),
        ).join(Driver, Envio.driver_id == Driver.id
        ).filter(
            Envio.mes == mes, Envio.anio == anio,
            Envio.estado_entrega == 'delivered',
            Driver.id.in_([d.id for d in matched_drivers]),
        ).group_by(Driver.nombre, Envio.zona).all()

        lines.append(f"\n--- Conductores detectados ({mes}/{anio}) ---")
        by_driver: dict = {}
        for r in driver_rows:
            by_driver.setdefault(r.nombre, []).append(r)

        for dname, rows in sorted(by_driver.items()):
            total_env = sum(int(r.envios) for r in rows)
            total_rev = sum(int(r.revenue) for r in rows)
            total_cost = sum(int(r.costo) for r in rows)
            mg = total_rev - total_cost
            lines.append(f"\n{dname}: {total_env} envíos | Revenue ${total_rev:,} | Costo ${total_cost:,} | Margen ${mg:,} ({round(mg / total_rev * 100, 1) if total_rev else 0}%)")
            for r in sorted(rows, key=lambda x: int(x.envios), reverse=True):
                rv, c = int(r.revenue), int(r.costo)
                lines.append(f"  Zona {r.zona or 'Sin zona'}: {int(r.envios)} env | Rev ${rv:,} | Costo ${c:,} | Margen ${rv - c:,}")

    # ── Detectar sellers ─────────────────────────────────────────────────────
    all_sellers = db.query(Seller.id, Seller.nombre).all()
    matched_sellers = []
    for s in all_sellers:
        parts = [p.strip().lower() for p in s.nombre.split() if len(p.strip()) >= 4]
        if any(p in q_low for p in parts):
            matched_sellers.append(s)

    if matched_sellers:
        seller_rows = db.query(
            Seller.nombre,
            F.count(Envio.id).label("envios"),
            F.coalesce(F.sum(Envio.cobro_seller + Envio.extra_producto_seller + Envio.extra_comuna_seller), 0).label("revenue"),
            F.coalesce(F.sum(Envio.costo_driver + Envio.extra_producto_driver + Envio.extra_comuna_driver), 0).label("costo"),
        ).join(Seller, Envio.seller_id == Seller.id
        ).filter(
            Envio.mes == mes, Envio.anio == anio,
            Envio.estado_entrega == 'delivered',
            Seller.id.in_([s.id for s in matched_sellers]),
        ).group_by(Seller.nombre).all()

        lines.append(f"\n--- Sellers detectados ({mes}/{anio}) ---")
        for r in seller_rows:
            rv, c = int(r.revenue), int(r.costo)
            lines.append(f"{r.nombre}: {int(r.envios)} envíos | Revenue ${rv:,} | Costo ${c:,} | Margen ${rv - c:,} ({round((rv - c) / rv * 100, 1) if rv else 0}%)")

    # ── Detectar zonas ───────────────────────────────────────────────────────
    zone_rows = db.query(
        Envio.zona,
        F.count(Envio.id).label("envios"),
        F.coalesce(F.sum(Envio.cobro_seller + Envio.extra_producto_seller + Envio.extra_comuna_seller), 0).label("revenue"),
        F.coalesce(F.sum(Envio.costo_driver + Envio.extra_producto_driver + Envio.extra_comuna_driver), 0).label("costo"),
    ).filter(
        Envio.mes == mes, Envio.anio == anio,
        Envio.estado_entrega == 'delivered',
        Envio.zona.isnot(None),
    ).group_by(Envio.zona).all()

    matched_zones = []
    for r in zone_rows:
        if not r.zona:
            continue
        zona_lower = r.zona.lower()
        if zona_lower in q_low or any(w in q_low for w in zona_lower.split() if len(w) >= 5):
            matched_zones.append(r)

    if matched_zones:
        lines.append(f"\n--- Zonas detectadas ({mes}/{anio}) ---")
        for r in matched_zones:
            rv, c = int(r.revenue), int(r.costo)
            lines.append(f"Zona {r.zona}: {int(r.envios)} envíos | Revenue ${rv:,} | Costo ${c:,} | Margen ${rv - c:,} ({round((rv - c) / rv * 100, 1) if rv else 0}%)")

    return "\n".join(lines)


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
        "Eres un analista financiero senior de E-Courier, empresa chilena de paquetería B2B. "
        "Respondes ÚNICAMENTE en español. Moneda: CLP (pesos chilenos). "
        "REGLA CRÍTICA: Usa EXCLUSIVAMENTE los datos del CONTEXTO FINANCIERO que se te proporciona. "
        "NUNCA inventes, estimes ni uses números hipotéticos. "
        "Si los datos exactos están en el contexto, úsalos directamente. "
        "Si falta algún dato, indica qué información específica no está disponible en lugar de estimarla. "
        "Sé conciso y directo. Usa formato claro con bullets cuando ayude."
    )

    # Contexto automático desde la DB (siempre presente)
    smart_ctx = _smart_context(db, req.pregunta, req.mes, req.anio)
    all_ctx_parts = ([smart_ctx] if smart_ctx else []) + (req.contexto or [])
    context_block = "\n\n".join(all_ctx_parts)

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
                "temperature": 0.2,
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
