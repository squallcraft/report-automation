"""
Motor de liquidación: calcula cobros a sellers y pagos a drivers.
"""
from typing import List

from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc

from app.models import (
    Envio, Seller, Driver, Retiro, AjusteLiquidacion,
    TipoEntidadEnum, EmpresaEnum,
)


_RETIRO_FALLBACK_DESDE = (2026, 2, 4)  # (anio, mes, semana) — desde aquí se aplica tarifa diaria


def _periodo_permite_fallback(semana: int, mes: int, anio: int) -> bool:
    return (anio, mes, semana) >= _RETIRO_FALLBACK_DESDE


def _calcular_retiro_seller(seller, envios: list, retiros: list, semana: int, mes: int, anio: int) -> int:
    """
    Calcula el cobro de retiro para un seller en una semana.
    - Si hay registros en la tabla retiros, los suma (siempre).
    - Si no hay registros y el período es >= S4/Feb2026, usa tarifa_retiro
      del seller multiplicada por los días distintos con envíos.
    - Períodos anteriores a S4/Feb2026 no usan el fallback (comportamiento original).
    - Respeta min_paquetes_retiro_gratis y usa_pickup.
    """
    if not seller.tiene_retiro or seller.usa_pickup or not envios:
        return 0
    if seller.min_paquetes_retiro_gratis > 0 and len(envios) >= seller.min_paquetes_retiro_gratis:
        return 0
    if retiros:
        return sum(r.tarifa_seller for r in retiros)
    if seller.tarifa_retiro and _periodo_permite_fallback(semana, mes, anio):
        dias_con_envios = len({e.fecha_entrega for e in envios if e.fecha_entrega})
        return seller.tarifa_retiro * dias_con_envios
    return 0


def _calcular_retiro_seller_driver_cost(seller, envios: list, retiros: list, semana: int, mes: int, anio: int) -> int:
    """Costo para el driver por el retiro del seller (para rentabilidad)."""
    if not seller.tiene_retiro or seller.usa_pickup or not envios:
        return 0
    if seller.min_paquetes_retiro_gratis > 0 and len(envios) >= seller.min_paquetes_retiro_gratis:
        return 0
    if retiros:
        return sum(r.tarifa_driver for r in retiros)
    if seller.tarifa_retiro_driver and _periodo_permite_fallback(semana, mes, anio):
        dias_con_envios = len({e.fecha_entrega for e in envios if e.fecha_entrega})
        return seller.tarifa_retiro_driver * dias_con_envios
    return 0


def calcular_liquidacion_sellers(db: Session, semana: int, mes: int, anio: int) -> List[dict]:
    """Calcula el cobro a cada seller para una semana específica."""
    sellers = db.query(Seller).filter(Seller.activo == True).all()
    resultados = []

    for seller in sellers:
        envios = db.query(Envio).filter(
            Envio.seller_id == seller.id,
            Envio.semana == semana,
            Envio.mes == mes,
            Envio.anio == anio,
        ).all()

        if not envios:
            continue

        user_nombres = sorted({e.user_nombre for e in envios if e.user_nombre})

        total_envios = sum(e.cobro_seller + e.cobro_extra_manual for e in envios)
        total_extras_producto = sum(e.extra_producto_seller for e in envios)
        total_extras_comuna = sum(e.extra_comuna_seller for e in envios)

        retiros_q = db.query(Retiro).filter(
            Retiro.seller_id == seller.id,
            Retiro.semana == semana,
            Retiro.mes == mes,
            Retiro.anio == anio,
        ).all()
        total_retiros = _calcular_retiro_seller(seller, envios, retiros_q, semana, mes, anio)

        ajustes = db.query(AjusteLiquidacion).filter(
            AjusteLiquidacion.tipo == TipoEntidadEnum.SELLER,
            AjusteLiquidacion.entidad_id == seller.id,
            AjusteLiquidacion.semana == semana,
            AjusteLiquidacion.mes == mes,
            AjusteLiquidacion.anio == anio,
        ).all()
        total_ajustes = sum(a.monto for a in ajustes)

        subtotal = total_envios + total_extras_producto + total_extras_comuna + total_retiros + total_ajustes
        iva = int(subtotal * 0.19)
        total_con_iva = subtotal + iva

        resultados.append({
            "seller_id": seller.id,
            "seller_nombre": seller.nombre,
            "empresa": seller.empresa or "",
            "user_nombres": user_nombres,
            "total_envios": total_envios,
            "cantidad_envios": len(envios),
            "total_extras_producto": total_extras_producto,
            "total_extras_comuna": total_extras_comuna,
            "total_retiros": total_retiros,
            "total_ajustes": total_ajustes,
            "subtotal": subtotal,
            "iva": iva,
            "total_con_iva": total_con_iva,
        })

    return sorted(resultados, key=lambda x: x["seller_nombre"])


def calcular_liquidacion_drivers(db: Session, semana: int, mes: int, anio: int) -> List[dict]:
    """Calcula el pago a cada driver para una semana específica."""
    drivers = db.query(Driver).filter(Driver.activo == True).all()
    resultados = []

    for driver in drivers:
        envios = db.query(Envio).filter(
            Envio.driver_id == driver.id,
            Envio.semana == semana,
            Envio.mes == mes,
            Envio.anio == anio,
        ).all()

        if not envios:
            continue

        total_envios = sum(e.costo_driver + e.pago_extra_manual for e in envios)
        if driver.contratado:
            total_extras_producto = 0
            total_extras_comuna = 0
        else:
            total_extras_producto = sum(e.extra_producto_driver for e in envios)
            total_extras_comuna = sum(e.extra_comuna_driver for e in envios)

        retiros = db.query(Retiro).filter(
            Retiro.driver_id == driver.id,
            Retiro.semana == semana,
            Retiro.mes == mes,
            Retiro.anio == anio,
        ).all()
        total_retiros = sum(r.tarifa_driver for r in retiros)

        ajustes = db.query(AjusteLiquidacion).filter(
            AjusteLiquidacion.tipo == TipoEntidadEnum.DRIVER,
            AjusteLiquidacion.entidad_id == driver.id,
            AjusteLiquidacion.semana == semana,
            AjusteLiquidacion.mes == mes,
            AjusteLiquidacion.anio == anio,
        ).all()
        total_ajustes = sum(a.monto for a in ajustes)

        total = total_envios + total_extras_producto + total_extras_comuna + total_retiros + total_ajustes

        resultados.append({
            "driver_id": driver.id,
            "driver_nombre": driver.nombre,
            "total_envios": total_envios,
            "cantidad_envios": len(envios),
            "total_extras_producto": total_extras_producto,
            "total_extras_comuna": total_extras_comuna,
            "total_retiros": total_retiros,
            "total_ajustes": total_ajustes,
            "subtotal": total,
            "iva": 0,
            "total": total,
        })

    return sorted(resultados, key=lambda x: x["driver_nombre"])


def calcular_rentabilidad(db: Session, semana: int, mes: int, anio: int) -> List[dict]:
    """Calcula la rentabilidad por seller para una semana específica."""
    sellers = db.query(Seller).filter(Seller.activo == True).all()
    resultados = []

    for seller in sellers:
        envios = db.query(Envio).filter(
            Envio.seller_id == seller.id,
            Envio.semana == semana,
            Envio.mes == mes,
            Envio.anio == anio,
        ).all()

        if not envios:
            continue

        user_nombres = sorted({e.user_nombre for e in envios if e.user_nombre})
        ingreso = sum(e.cobro_seller + e.cobro_extra_manual + e.extra_producto_seller + e.extra_comuna_seller for e in envios)

        retiros_rent = db.query(Retiro).filter(
            Retiro.seller_id == seller.id,
            Retiro.semana == semana,
            Retiro.mes == mes,
            Retiro.anio == anio,
        ).all()
        ingreso_retiros = _calcular_retiro_seller(seller, envios, retiros_rent, semana, mes, anio)
        costo_retiros = _calcular_retiro_seller_driver_cost(seller, envios, retiros_rent, semana, mes, anio)
        ingreso += ingreso_retiros

        def _costo_envio_driver(e):
            driver_e = db.get(Driver, e.driver_id) if e.driver_id else None
            es_contratado = getattr(driver_e, 'contratado', False) if driver_e else False
            extra_p = 0 if es_contratado else e.extra_producto_driver
            extra_c = 0 if es_contratado else e.extra_comuna_driver
            return e.costo_driver + e.pago_extra_manual + extra_p + extra_c
        costo_drivers = sum(_costo_envio_driver(e) for e in envios)

        margen_bruto = ingreso - costo_drivers - costo_retiros
        margen_porcentaje = (margen_bruto / ingreso * 100) if ingreso > 0 else 0

        resultados.append({
            "seller_id": seller.id,
            "seller_nombre": seller.nombre,
            "user_nombres": user_nombres,
            "ingreso": ingreso,
            "costo_drivers": costo_drivers,
            "costo_retiros": costo_retiros,
            "margen_bruto": margen_bruto,
            "margen_porcentaje": round(margen_porcentaje, 1),
        })

    return sorted(resultados, key=lambda x: x["margen_bruto"], reverse=True)
