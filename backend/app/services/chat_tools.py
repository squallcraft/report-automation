"""
Herramientas de consulta a la BD para el Asistente IA.
Cada función devuelve un dict serializable que Gemini recibe como resultado de tool call.
Todas las consultas usan SQLAlchemy ORM → sin riesgo de SQL Injection.
"""
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc

from app.models import (
    Envio, Seller, Driver, PeriodoLiquidacion,
    FacturaMensualSeller, PagoSemanaSeller, AjusteLiquidacion,
    TipoEntidadEnum, EstadoFacturaEnum,
)


def _fmt(n: int) -> str:
    return f"${n:,}".replace(",", ".")


# ─── 1. Resumen de envíos ────────────────────────────────────────────────────

def consultar_envios(
    db: Session,
    semana: Optional[int] = None,
    mes: Optional[int] = None,
    anio: Optional[int] = None,
    seller_nombre: Optional[str] = None,
    driver_nombre: Optional[str] = None,
    comuna: Optional[str] = None,
) -> dict:
    """Resumen de envíos con filtros opcionales. Devuelve totales y top rankings."""
    q = db.query(Envio)

    if anio:
        q = q.filter(Envio.anio == anio)
    if mes:
        q = q.filter(Envio.mes == mes)
    if semana:
        q = q.filter(Envio.semana == semana)
    if seller_nombre:
        seller = db.query(Seller).filter(
            Seller.nombre.ilike(f"%{seller_nombre}%")
        ).first()
        if seller:
            q = q.filter(Envio.seller_id == seller.id)
        else:
            return {"error": f"No se encontró el seller '{seller_nombre}'"}
    if driver_nombre:
        driver = db.query(Driver).filter(
            Driver.nombre.ilike(f"%{driver_nombre}%")
        ).first()
        if driver:
            q = q.filter(Envio.driver_id == driver.id)
        else:
            return {"error": f"No se encontró el driver '{driver_nombre}'"}
    if comuna:
        q = q.filter(Envio.comuna.ilike(f"%{comuna}%"))

    envios = q.all()
    if not envios:
        return {"total_envios": 0, "mensaje": "No se encontraron envíos con esos filtros."}

    total_cobro = sum(
        e.cobro_seller + e.extra_producto_seller + e.extra_comuna_seller + e.cobro_extra_manual
        for e in envios
    )
    total_costo_drivers = sum(
        e.costo_driver + e.extra_producto_driver + e.extra_comuna_driver + e.pago_extra_manual
        for e in envios
    )

    # Top sellers
    seller_counts: dict = {}
    for e in envios:
        key = e.seller_nombre_raw or "Sin seller"
        if e.seller_id:
            s = db.get(Seller, e.seller_id)
            key = s.nombre if s else key
        seller_counts[key] = seller_counts.get(key, 0) + 1
    top_sellers = sorted(seller_counts.items(), key=lambda x: -x[1])[:5]

    # Top drivers
    driver_counts: dict = {}
    for e in envios:
        key = e.driver_nombre_raw or "Sin driver"
        if e.driver_id:
            d = db.get(Driver, e.driver_id)
            key = d.nombre if d else key
        driver_counts[key] = driver_counts.get(key, 0) + 1
    top_drivers = sorted(driver_counts.items(), key=lambda x: -x[1])[:5]

    # Top comunas
    comuna_counts: dict = {}
    for e in envios:
        k = (e.comuna or "desconocida").capitalize()
        comuna_counts[k] = comuna_counts.get(k, 0) + 1
    top_comunas = sorted(comuna_counts.items(), key=lambda x: -x[1])[:5]

    periodo_desc = []
    if semana:
        periodo_desc.append(f"Semana {semana}")
    if mes:
        periodo_desc.append(f"Mes {mes}")
    if anio:
        periodo_desc.append(f"Año {anio}")

    return {
        "periodo": " / ".join(periodo_desc) if periodo_desc else "Todos los períodos",
        "total_envios": len(envios),
        "total_bultos": sum(e.bultos for e in envios),
        "total_cobro_sellers": _fmt(total_cobro),
        "total_costo_drivers": _fmt(total_costo_drivers),
        "margen_bruto": _fmt(total_cobro - total_costo_drivers),
        "top_sellers": [{"seller": s, "envios": c} for s, c in top_sellers],
        "top_drivers": [{"driver": d, "envios": c} for d, c in top_drivers],
        "top_comunas": [{"comuna": k, "envios": c} for k, c in top_comunas],
    }


# ─── 2. Detalle de un envío por tracking ────────────────────────────────────

def buscar_envio_por_tracking(db: Session, tracking_id: str) -> dict:
    """Busca un envío específico por su tracking ID."""
    envio = db.query(Envio).filter(
        Envio.tracking_id.ilike(f"%{tracking_id}%")
    ).first()

    if not envio:
        return {"error": f"No se encontró ningún envío con tracking '{tracking_id}'"}

    seller_nombre = None
    if envio.seller_id:
        s = db.get(Seller, envio.seller_id)
        seller_nombre = s.nombre if s else envio.seller_nombre_raw

    driver_nombre = None
    if envio.driver_id:
        d = db.get(Driver, envio.driver_id)
        driver_nombre = d.nombre if d else envio.driver_nombre_raw

    total_cobro = (
        envio.cobro_seller + envio.extra_producto_seller +
        envio.extra_comuna_seller + envio.cobro_extra_manual
    )

    return {
        "tracking_id": envio.tracking_id,
        "fecha_entrega": str(envio.fecha_entrega),
        "seller": seller_nombre or envio.seller_nombre_raw or "—",
        "driver": driver_nombre or envio.driver_nombre_raw or "—",
        "comuna": envio.comuna or "—",
        "descripcion_producto": envio.descripcion_producto or "—",
        "bultos": envio.bultos,
        "semana": envio.semana,
        "mes": envio.mes,
        "anio": envio.anio,
        "cobro_base": _fmt(envio.cobro_seller),
        "bultos_extra": _fmt(envio.extra_producto_seller + envio.cobro_extra_manual),
        "extra_comuna": _fmt(envio.extra_comuna_seller),
        "total_cobro_seller": _fmt(total_cobro),
        "pago_driver": _fmt(envio.costo_driver + envio.pago_extra_manual),
        "costo_orden": _fmt(envio.costo_orden),
    }


# ─── 3. Liquidación de un seller ────────────────────────────────────────────

def obtener_liquidacion_seller(
    db: Session,
    seller_nombre: str,
    semana: int,
    mes: int,
    anio: int,
) -> dict:
    """Detalle de liquidación semanal de un seller: monto base, extras, IVA, total."""
    seller = db.query(Seller).filter(
        Seller.nombre.ilike(f"%{seller_nombre}%")
    ).first()

    if not seller:
        return {"error": f"No se encontró el seller '{seller_nombre}'"}

    envios = db.query(Envio).filter(
        Envio.seller_id == seller.id,
        Envio.semana == semana,
        Envio.mes == mes,
        Envio.anio == anio,
    ).all()

    if not envios:
        return {
            "seller": seller.nombre,
            "periodo": f"Semana {semana}, Mes {mes}/{anio}",
            "mensaje": "Sin envíos en este período.",
        }

    monto_base = sum(e.cobro_seller for e in envios)
    bultos_extra = sum(e.extra_producto_seller + e.cobro_extra_manual for e in envios)
    extra_comuna = sum(e.extra_comuna_seller for e in envios)
    ajustes_q = db.query(AjusteLiquidacion).filter(
        AjusteLiquidacion.tipo == TipoEntidadEnum.SELLER,
        AjusteLiquidacion.entidad_id == seller.id,
        AjusteLiquidacion.semana == semana,
        AjusteLiquidacion.mes == mes,
        AjusteLiquidacion.anio == anio,
    ).all()
    ajustes = sum(a.monto for a in ajustes_q)

    subtotal = monto_base + bultos_extra + extra_comuna + ajustes
    iva = round(subtotal * 0.19)
    total = subtotal + iva

    return {
        "seller": seller.nombre,
        "empresa": seller.empresa or "—",
        "periodo": f"Semana {semana}, Mes {mes}/{anio}",
        "cantidad_envios": len(envios),
        "monto_base": _fmt(monto_base),
        "bultos_extra": _fmt(bultos_extra),
        "extra_comuna": _fmt(extra_comuna),
        "ajustes": _fmt(ajustes),
        "subtotal": _fmt(subtotal),
        "iva_19pct": _fmt(iva),
        "total_con_iva": _fmt(total),
    }


# ─── 4. Ranking de drivers ───────────────────────────────────────────────────

def obtener_ranking_drivers(
    db: Session,
    semana: Optional[int] = None,
    mes: Optional[int] = None,
    anio: Optional[int] = None,
) -> dict:
    """Ranking de drivers por cantidad de envíos y monto pagado."""
    q = db.query(Envio).filter(Envio.driver_id.isnot(None))
    if anio:
        q = q.filter(Envio.anio == anio)
    if mes:
        q = q.filter(Envio.mes == mes)
    if semana:
        q = q.filter(Envio.semana == semana)

    envios = q.all()
    if not envios:
        return {"ranking": [], "mensaje": "Sin datos para ese período."}

    driver_stats: dict = {}
    for e in envios:
        did = e.driver_id
        if did not in driver_stats:
            d = db.get(Driver, did)
            driver_stats[did] = {
                "nombre": d.nombre if d else f"Driver #{did}",
                "envios": 0,
                "pago_total": 0,
            }
        driver_stats[did]["envios"] += 1
        driver_stats[did]["pago_total"] += (
            e.costo_driver + e.extra_producto_driver +
            e.extra_comuna_driver + e.pago_extra_manual
        )

    ranking = sorted(driver_stats.values(), key=lambda x: -x["envios"])
    for r in ranking:
        r["pago_total"] = _fmt(r["pago_total"])

    periodo_desc = []
    if semana:
        periodo_desc.append(f"Semana {semana}")
    if mes:
        periodo_desc.append(f"Mes {mes}")
    if anio:
        periodo_desc.append(f"Año {anio}")

    return {
        "periodo": " / ".join(periodo_desc) if periodo_desc else "Todos los períodos",
        "total_drivers": len(ranking),
        "ranking": ranking,
    }


# ─── 5. Resumen de facturación mensual ──────────────────────────────────────

def obtener_resumen_facturacion(db: Session, mes: int, anio: int) -> dict:
    """Resumen de facturación mensual: facturas emitidas, montos y estados de pago."""
    facturas = db.query(FacturaMensualSeller).filter(
        FacturaMensualSeller.mes == mes,
        FacturaMensualSeller.anio == anio,
    ).all()

    pagos = db.query(PagoSemanaSeller).filter(
        PagoSemanaSeller.mes == mes,
        PagoSemanaSeller.anio == anio,
    ).all()

    total_facturado = sum(f.total for f in facturas)
    total_pagado = sum(
        p.monto_override if p.monto_override is not None else p.monto_neto
        for p in pagos if p.estado == "PAGADO"
    )
    total_pendiente = sum(
        p.monto_override if p.monto_override is not None else p.monto_neto
        for p in pagos if p.estado == "PENDIENTE"
    )

    detalle_facturas = []
    for f in facturas:
        s = db.get(Seller, f.seller_id)
        detalle_facturas.append({
            "seller": s.nombre if s else f"#{f.seller_id}",
            "subtotal_neto": _fmt(f.subtotal_neto),
            "iva": _fmt(f.iva),
            "total": _fmt(f.total),
            "estado": f.estado,
            "folio": f.folio_haulmer or "—",
        })

    return {
        "periodo": f"Mes {mes}/{anio}",
        "facturas_emitidas": len([f for f in facturas if f.estado == EstadoFacturaEnum.EMITIDA]),
        "facturas_pendientes": len([f for f in facturas if f.estado == EstadoFacturaEnum.PENDIENTE]),
        "total_facturado": _fmt(total_facturado),
        "total_cobrado": _fmt(total_pagado),
        "total_pendiente_cobro": _fmt(total_pendiente),
        "detalle": detalle_facturas,
    }


# ─── 6. Rentabilidad por seller ──────────────────────────────────────────────

def obtener_rentabilidad(
    db: Session,
    semana: Optional[int] = None,
    mes: Optional[int] = None,
    anio: Optional[int] = None,
) -> dict:
    """Rentabilidad bruta por seller: ingresos, costos de drivers y margen."""
    q = db.query(Envio).filter(Envio.seller_id.isnot(None))
    if anio:
        q = q.filter(Envio.anio == anio)
    if mes:
        q = q.filter(Envio.mes == mes)
    if semana:
        q = q.filter(Envio.semana == semana)

    envios = q.all()
    if not envios:
        return {"sellers": [], "mensaje": "Sin datos para ese período."}

    stats: dict = {}
    for e in envios:
        sid = e.seller_id
        if sid not in stats:
            s = db.get(Seller, sid)
            stats[sid] = {"nombre": s.nombre if s else f"#{sid}", "ingreso": 0, "costo_driver": 0}
        stats[sid]["ingreso"] += (
            e.cobro_seller + e.extra_producto_seller +
            e.extra_comuna_seller + e.cobro_extra_manual
        )
        stats[sid]["costo_driver"] += (
            e.costo_driver + e.extra_producto_driver +
            e.extra_comuna_driver + e.pago_extra_manual
        )

    resultado = []
    for s in sorted(stats.values(), key=lambda x: -(x["ingreso"] - x["costo_driver"])):
        margen = s["ingreso"] - s["costo_driver"]
        pct = round(margen / s["ingreso"] * 100, 1) if s["ingreso"] > 0 else 0
        resultado.append({
            "seller": s["nombre"],
            "ingreso": _fmt(s["ingreso"]),
            "costo_driver": _fmt(s["costo_driver"]),
            "margen_bruto": _fmt(margen),
            "margen_pct": f"{pct}%",
        })

    periodo_desc = []
    if semana:
        periodo_desc.append(f"Semana {semana}")
    if mes:
        periodo_desc.append(f"Mes {mes}")
    if anio:
        periodo_desc.append(f"Año {anio}")

    return {
        "periodo": " / ".join(periodo_desc) if periodo_desc else "Todos los períodos",
        "sellers": resultado,
    }


# ─── 7. Listar sellers activos ───────────────────────────────────────────────

def listar_sellers(db: Session) -> dict:
    """Lista todos los sellers activos con su tarifa base."""
    sellers = db.query(Seller).filter(Seller.activo == True).order_by(Seller.nombre).all()
    return {
        "total": len(sellers),
        "sellers": [
            {
                "nombre": s.nombre,
                "empresa": s.empresa,
                "precio_base": _fmt(s.precio_base),
                "plan_tarifario": s.plan_tarifario or "sin plan",
            }
            for s in sellers
        ],
    }


# ─── 8. Listar drivers activos ───────────────────────────────────────────────

def listar_drivers(db: Session) -> dict:
    """Lista todos los drivers activos con sus tarifas."""
    drivers = db.query(Driver).filter(Driver.activo == True).order_by(Driver.nombre).all()
    return {
        "total": len(drivers),
        "drivers": [
            {
                "nombre": d.nombre,
                "tarifa_ecourier": _fmt(d.tarifa_ecourier),
                "tarifa_oviedo": _fmt(d.tarifa_oviedo),
                "tarifa_tercerizado": _fmt(d.tarifa_tercerizado),
                "contratado": d.contratado,
            }
            for d in drivers
        ],
    }


# ─── Dispatcher central ──────────────────────────────────────────────────────

TOOL_REGISTRY = {
    "consultar_envios": consultar_envios,
    "buscar_envio_por_tracking": buscar_envio_por_tracking,
    "obtener_liquidacion_seller": obtener_liquidacion_seller,
    "obtener_ranking_drivers": obtener_ranking_drivers,
    "obtener_resumen_facturacion": obtener_resumen_facturacion,
    "obtener_rentabilidad": obtener_rentabilidad,
    "listar_sellers": listar_sellers,
    "listar_drivers": listar_drivers,
}


def ejecutar_tool(db: Session, nombre: str, args: dict) -> dict:
    """Ejecuta la herramienta indicada con los argumentos dados."""
    fn = TOOL_REGISTRY.get(nombre)
    if not fn:
        return {"error": f"Herramienta '{nombre}' no reconocida."}
    return fn(db, **args)
