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

        total_retiros = 0
        if seller.tiene_retiro and not seller.usa_pickup and len(envios) > 0:
            if seller.min_paquetes_retiro_gratis > 0 and len(envios) >= seller.min_paquetes_retiro_gratis:
                total_retiros = 0
            else:
                retiros = db.query(Retiro).filter(
                    Retiro.seller_id == seller.id,
                    Retiro.semana == semana,
                    Retiro.mes == mes,
                    Retiro.anio == anio,
                ).all()
                total_retiros = sum(r.tarifa_seller for r in retiros)

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

        subtotal = total_envios + total_extras_producto + total_extras_comuna + total_retiros + total_ajustes
        iva = int(subtotal * 0.19)
        total = subtotal + iva

        resultados.append({
            "driver_id": driver.id,
            "driver_nombre": driver.nombre,
            "total_envios": total_envios,
            "cantidad_envios": len(envios),
            "total_extras_producto": total_extras_producto,
            "total_extras_comuna": total_extras_comuna,
            "total_retiros": total_retiros,
            "total_ajustes": total_ajustes,
            "subtotal": subtotal,
            "iva": iva,
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

        ingreso_retiros = 0
        costo_retiros = 0
        if seller.tiene_retiro and not seller.usa_pickup and len(envios) > 0:
            if not (seller.min_paquetes_retiro_gratis > 0 and len(envios) >= seller.min_paquetes_retiro_gratis):
                retiros = db.query(Retiro).filter(
                    Retiro.seller_id == seller.id,
                    Retiro.semana == semana,
                    Retiro.mes == mes,
                    Retiro.anio == anio,
                ).all()
                ingreso_retiros = sum(r.tarifa_seller for r in retiros)
                costo_retiros = sum(r.tarifa_driver for r in retiros)
        ingreso += ingreso_retiros

        costo_drivers = sum(e.costo_driver + e.pago_extra_manual + e.extra_producto_driver + e.extra_comuna_driver for e in envios)

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
