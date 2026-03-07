"""
Motor de liquidación: calcula cobros a sellers y pagos a drivers.

Reglas de negocio — Retiros:
  - La tabla `retiros` representa paradas físicas de un conductor para recoger carga.
  - `tarifa_driver` de cada retiro se suma al pago del conductor.
  - El cobro de retiro al seller se calcula desde la configuración del seller
    (tarifa_retiro × días con envíos), NO desde la tabla retiros.
"""
from typing import List

from sqlalchemy.orm import Session

from app.models import (
    Envio, Seller, Driver, Retiro, AjusteLiquidacion,
    TipoEntidadEnum,
)


def _calcular_retiro_seller(seller, envios: list) -> int:
    """
    Cobro de retiro al seller para una semana.
    Usa tarifa_retiro del seller × días distintos con envíos.
    Respeta min_paquetes_retiro_gratis y usa_pickup.
    """
    if not seller.tiene_retiro or seller.usa_pickup or not envios:
        return 0
    if seller.min_paquetes_retiro_gratis > 0 and len(envios) >= seller.min_paquetes_retiro_gratis:
        return 0
    if not seller.tarifa_retiro:
        return 0
    dias_con_envios = len({e.fecha_entrega for e in envios if e.fecha_entrega})
    return seller.tarifa_retiro * dias_con_envios


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
        total_retiros = _calcular_retiro_seller(seller, envios)

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


def _calcular_retiro_driver(driver, retiros: list) -> int:
    """
    Pago al driver por retiros en una semana.
    Si tiene tarifa_retiro_fija > 0: tarifa_fija × días con al menos 1 retiro.
    Si no: suma de tarifa_driver de cada retiro individual.
    """
    if not retiros:
        return 0
    if driver.tarifa_retiro_fija and driver.tarifa_retiro_fija > 0:
        dias_con_retiro = len({r.fecha for r in retiros if r.fecha})
        return driver.tarifa_retiro_fija * dias_con_retiro
    return sum(r.tarifa_driver for r in retiros)


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

        retiros = db.query(Retiro).filter(
            Retiro.driver_id == driver.id,
            Retiro.semana == semana,
            Retiro.mes == mes,
            Retiro.anio == anio,
        ).all()

        if not envios and not retiros:
            continue

        total_envios = sum(e.costo_driver for e in envios)
        pago_extra_envios = sum(e.pago_extra_manual for e in envios)
        if driver.contratado:
            total_extras_producto = 0
            total_extras_comuna = 0
        else:
            total_extras_producto = sum(e.extra_producto_driver for e in envios) + pago_extra_envios
            total_extras_comuna = sum(e.extra_comuna_driver for e in envios)

        total_retiros = _calcular_retiro_driver(driver, retiros)

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


def _calcular_costo_retiro_para_seller(db: Session, seller_id: int, retiros_seller: list, semana: int, mes: int, anio: int) -> int:
    """
    Costo de retiros atribuido a un seller para rentabilidad.
    Si el driver tiene tarifa fija: reparte el costo diario parejo entre sellers del día.
    Si no: usa la tarifa_driver individual del retiro.
    """
    costo = 0
    for retiro in retiros_seller:
        if not retiro.driver_id:
            costo += retiro.tarifa_driver
            continue
        driver = db.get(Driver, retiro.driver_id)
        if not driver or not driver.tarifa_retiro_fija or driver.tarifa_retiro_fija <= 0:
            costo += retiro.tarifa_driver
            continue
        retiros_driver_dia = db.query(Retiro).filter(
            Retiro.driver_id == retiro.driver_id,
            Retiro.fecha == retiro.fecha,
            Retiro.semana == semana,
            Retiro.mes == mes,
            Retiro.anio == anio,
        ).all()
        sellers_del_dia = {r.seller_id for r in retiros_driver_dia if r.seller_id}
        pickups_del_dia = {r.pickup_id for r in retiros_driver_dia if r.pickup_id}
        total_destinos = len(sellers_del_dia) + len(pickups_del_dia)
        if total_destinos > 0:
            costo += driver.tarifa_retiro_fija // total_destinos
    return costo


def calcular_rentabilidad(db: Session, semana: int, mes: int, anio: int) -> List[dict]:
    """
    Calcula la rentabilidad por seller para una semana.
    Ingreso = cobros al seller por envíos + comisiones de pickup.
    Costo   = pagos a drivers por entregas + pagos a drivers por retiros.
    """
    from app.models import Pickup, RecepcionPaquete

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
        ingreso = sum(
            e.cobro_seller + e.cobro_extra_manual + e.extra_producto_seller + e.extra_comuna_seller
            for e in envios
        )
        ingreso += _calcular_retiro_seller(seller, envios)

        pickup = db.query(Pickup).filter(Pickup.seller_id == seller.id).first()
        ingreso_pickup = 0
        if pickup:
            recepciones = db.query(RecepcionPaquete).filter(
                RecepcionPaquete.pickup_id == pickup.id,
                RecepcionPaquete.semana == semana,
                RecepcionPaquete.mes == mes,
                RecepcionPaquete.anio == anio,
            ).all()
            ingreso_pickup = sum(r.comision for r in recepciones)

        def _costo_envio_driver(e):
            driver_e = db.get(Driver, e.driver_id) if e.driver_id else None
            es_contratado = getattr(driver_e, 'contratado', False) if driver_e else False
            extra_p = 0 if es_contratado else e.extra_producto_driver
            extra_c = 0 if es_contratado else e.extra_comuna_driver
            return e.costo_driver + e.pago_extra_manual + extra_p + extra_c

        costo_drivers = sum(_costo_envio_driver(e) for e in envios)

        retiros = db.query(Retiro).filter(
            Retiro.seller_id == seller.id,
            Retiro.semana == semana,
            Retiro.mes == mes,
            Retiro.anio == anio,
        ).all()
        costo_retiros = _calcular_costo_retiro_para_seller(db, seller.id, retiros, semana, mes, anio)

        ingreso_total = ingreso + ingreso_pickup
        margen_bruto = ingreso_total - costo_drivers - costo_retiros
        margen_porcentaje = (margen_bruto / ingreso_total * 100) if ingreso_total > 0 else 0

        resultados.append({
            "seller_id": seller.id,
            "seller_nombre": seller.nombre,
            "user_nombres": user_nombres,
            "ingreso": ingreso,
            "ingreso_pickup": ingreso_pickup,
            "costo_drivers": costo_drivers,
            "costo_retiros": costo_retiros,
            "margen_bruto": margen_bruto,
            "margen_porcentaje": round(margen_porcentaje, 1),
        })

    return sorted(resultados, key=lambda x: x["margen_bruto"], reverse=True)
