"""
Servicio F29 — agregador read-only de IVA.

Lee exclusivamente desde tablas ya calculadas y validadas:
  - PagoSemanaSeller.monto_neto  (base débito provisional)
  - FacturaMensualSeller.iva     (débito documentado: DTE emitidos)
  - PagoIVADriver                (crédito IVA drivers)
  - MovimientoFinanciero.monto_iva (crédito IVA compras)
  - LineaAsiento en cuentas 1.3 / 2.4 (GL cross-check)

No ejecuta cálculos de liquidación propios.
"""
from sqlalchemy import func

from app.models import (
    PagoSemanaSeller,
    FacturaMensualSeller, EstadoFacturaEnum,
    PagoIVADriver, EstadoPagoIVAEnum,
    MovimientoFinanciero,
    LineaAsiento, AsientoContable, CuentaContable,
    CalendarioSemanas,
    Seller, Driver,
)
from app.services.iva_drivers import calcular_base_iva_mes, calcular_iva as _calcular_iva_driver

IVA_RATE = 0.19


def _semanas_del_mes(db: Session, mes: int, anio: int) -> list[int]:
    rows = db.query(CalendarioSemanas.semana).filter(
        CalendarioSemanas.mes == mes,
        CalendarioSemanas.anio == anio,
    ).order_by(CalendarioSemanas.semana).all()
    return [r[0] for r in rows] if rows else [1, 2, 3, 4, 5]


# ── IVA Débito (ventas / sellers) ────────────────────────────────────────────

def iva_debito_provisional_mes(db: Session, mes: int, anio: int) -> dict:
    """
    IVA estimado a partir de PagoSemanaSeller.monto_neto ya validados.
    Aplica fórmula SII: round(base * 19 / 100).
    Fuente: pagos semanales del mes según CalendarioSemanas.
    """
    semanas = _semanas_del_mes(db, mes, anio)

    rows = db.query(
        PagoSemanaSeller.seller_id,
        func.sum(PagoSemanaSeller.monto_neto).label("base"),
    ).filter(
        PagoSemanaSeller.mes == mes,
        PagoSemanaSeller.anio == anio,
        PagoSemanaSeller.semana.in_(semanas),
    ).group_by(PagoSemanaSeller.seller_id).all()

    sellers_map = {
        s.id: s.nombre
        for s in db.query(Seller.id, Seller.nombre).filter(
            Seller.id.in_([r.seller_id for r in rows])
        ).all()
    }

    detalle, base_total, iva_total = [], 0, 0
    for r in rows:
        base = r.base or 0
        iva = round(base * IVA_RATE)      # fórmula SII: entero más cercano
        base_total += base
        iva_total += iva
        detalle.append({
            "seller_id": r.seller_id,
            "seller_nombre": sellers_map.get(r.seller_id, f"Seller {r.seller_id}"),
            "base": base,
            "iva": iva,
        })

    return {
        "base_total": base_total,
        "iva_total": iva_total,
        "detalle": sorted(detalle, key=lambda x: x["seller_nombre"]),
    }


def iva_debito_documentado_mes(db: Session, mes: int, anio: int) -> dict:
    """
    IVA de los DTE realmente emitidos (FacturaMensualSeller estado=EMITIDA).
    Estos son los valores que van literalmente al F29.
    """
    rows = db.query(FacturaMensualSeller).filter(
        FacturaMensualSeller.mes == mes,
        FacturaMensualSeller.anio == anio,
        FacturaMensualSeller.estado == EstadoFacturaEnum.EMITIDA.value,
    ).all()

    sellers_map = {
        s.id: s.nombre
        for s in db.query(Seller.id, Seller.nombre).filter(
            Seller.id.in_([f.seller_id for f in rows])
        ).all()
    }

    detalle = [
        {
            "seller_id": f.seller_id,
            "seller_nombre": sellers_map.get(f.seller_id, f"Seller {f.seller_id}"),
            "folio": f.folio_haulmer,
            "base": f.subtotal_neto,
            "iva": f.iva,
            "total": f.total,
            "emitida_en": f.emitida_en.isoformat() if f.emitida_en else None,
        }
        for f in rows
    ]

    return {
        "base_total": sum(f.subtotal_neto for f in rows),
        "iva_total": sum(f.iva for f in rows),
        "count": len(rows),
        "detalle": sorted(detalle, key=lambda x: x["seller_nombre"]),
    }


def iva_debito_gl_mes(db: Session, mes: int, anio: int) -> int:
    """
    Suma Haber en cuenta 2.4 (IVA Débito Fiscal) del período según asientos GL.
    Fuente: LineaAsiento → AsientoContable (mes/anio).
    Se pobla automáticamente desde asiento_cobro_seller.
    """
    cuenta = db.query(CuentaContable).filter_by(codigo="2.4").first()
    if not cuenta:
        return 0
    resultado = db.query(
        func.coalesce(func.sum(LineaAsiento.haber), 0)
    ).join(LineaAsiento.asiento).filter(
        LineaAsiento.cuenta_id == cuenta.id,
        AsientoContable.mes == mes,
        AsientoContable.anio == anio,
    ).scalar()
    return int(resultado or 0)


# ── IVA Crédito (compras) ─────────────────────────────────────────────────────

def iva_credito_drivers_mes(db: Session, mes: int, anio: int) -> dict:
    """
    IVA crédito de facturas de conductores.
    Pagados: snapshot inmutable (ya cerrado).
    Pendientes: cálculo desde servicio iva_drivers existente (sin cambios).
    """
    registros = db.query(PagoIVADriver).filter(
        PagoIVADriver.mes_origen == mes,
        PagoIVADriver.anio_origen == anio,
    ).all()

    pagado, pendiente = 0, 0
    detalle = []
    for r in registros:
        driver = db.get(Driver, r.driver_id)
        nombre = driver.nombre if driver else f"Driver {r.driver_id}"
        if r.estado == EstadoPagoIVAEnum.PAGADO.value:
            monto = r.monto_iva_snapshot or 0
            pagado += monto
        else:
            base = calcular_base_iva_mes(db, r.driver_id, mes, anio)
            monto = _calcular_iva_driver(base)
            pendiente += monto
        detalle.append({
            "driver_id": r.driver_id,
            "driver_nombre": nombre,
            "estado": r.estado,
            "monto_iva": monto,
        })

    return {
        "pagado": pagado,
        "pendiente": pendiente,
        "total": pagado + pendiente,
        "detalle": sorted(detalle, key=lambda x: x["driver_nombre"]),
    }


def iva_credito_compras_mes(db: Session, mes: int, anio: int) -> dict:
    """
    IVA crédito de facturas de compras (MovimientoFinanciero.monto_iva).
    Solo se incluyen registros con monto_iva no nulo (facturas afectas).
    """
    rows = db.query(MovimientoFinanciero).filter(
        MovimientoFinanciero.mes == mes,
        MovimientoFinanciero.anio == anio,
        MovimientoFinanciero.monto_iva.isnot(None),
        MovimientoFinanciero.monto_iva > 0,
    ).all()

    detalle = [
        {
            "id": r.id,
            "nombre": r.nombre,
            "monto_compra": r.monto,
            "monto_iva": r.monto_iva,
            "proveedor": r.proveedor,
            "estado": r.estado,
        }
        for r in rows
    ]

    return {
        "total": sum(r.monto_iva for r in rows),
        "count": len(rows),
        "detalle": detalle,
    }


def iva_credito_gl_mes(db: Session, mes: int, anio: int) -> int:
    """
    Suma Debe en cuenta 1.3 (IVA Crédito Fiscal) del período según asientos GL.
    Fuente: asiento_pago_iva_driver (ya pobla esta cuenta).
    """
    cuenta = db.query(CuentaContable).filter_by(codigo="1.3").first()
    if not cuenta:
        return 0
    resultado = db.query(
        func.coalesce(func.sum(LineaAsiento.debe), 0)
    ).join(LineaAsiento.asiento).filter(
        LineaAsiento.cuenta_id == cuenta.id,
        AsientoContable.mes == mes,
        AsientoContable.anio == anio,
    ).scalar()
    return int(resultado or 0)


# ── Resumen F29 ───────────────────────────────────────────────────────────────

def resumen_f29(db: Session, mes: int, anio: int) -> dict:
    """
    Resumen orientativo para el F29 del mes.

    Estructura:
      debito.provisional  → IVA estimado (PagoSemanaSeller validados)
      debito.documentado  → IVA en DTE emitidos (FacturaMensualSeller EMITIDA)
      debito.gl           → IVA en cuenta 2.4 del GL (crece con cada cobro cartola)
      credito.drivers     → IVA pagado/pendiente a conductores
      credito.compras     → IVA crédito de facturas de compras
      credito.gl          → IVA en cuenta 1.3 del GL
      saldo_orientativo   → debito.documentado - credito.total
      diferencia_prov_doc → diferencia entre estimado y documentado (alerta)
    """
    debito_prov = iva_debito_provisional_mes(db, mes, anio)
    debito_doc  = iva_debito_documentado_mes(db, mes, anio)
    debito_gl   = iva_debito_gl_mes(db, mes, anio)

    credito_drv = iva_credito_drivers_mes(db, mes, anio)
    credito_cmp = iva_credito_compras_mes(db, mes, anio)
    credito_gl  = iva_credito_gl_mes(db, mes, anio)

    credito_total = credito_drv["total"] + credito_cmp["total"]

    return {
        "mes": mes,
        "anio": anio,
        "debito": {
            "provisional":        debito_prov["iva_total"],
            "provisional_base":   debito_prov["base_total"],
            "documentado":        debito_doc["iva_total"],
            "documentado_count":  debito_doc["count"],
            "gl":                 debito_gl,
        },
        "credito": {
            "drivers_pagado":    credito_drv["pagado"],
            "drivers_pendiente": credito_drv["pendiente"],
            "drivers_total":     credito_drv["total"],
            "compras":           credito_cmp["total"],
            "compras_count":     credito_cmp["count"],
            "gl":                credito_gl,
            "total":             credito_total,
        },
        "saldo_orientativo":   debito_doc["iva_total"] - credito_total,
        "diferencia_prov_doc": debito_prov["iva_total"] - debito_doc["iva_total"],
        "nota": (
            "Provisional = PagoSemanaSeller validados × 19%. "
            "Documentado = DTE emitidos (F29 real). "
            "GL = asientos contables (crece con cartolas + IVA drivers pagados). "
            "NC, PPM y otros ajustes requieren criterio del contador."
        ),
    }
