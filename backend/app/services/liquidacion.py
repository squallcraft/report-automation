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
from sqlalchemy import func

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
    """Calcula el cobro a cada seller para una semana específica. Optimizado con bulk queries."""
    sellers = db.query(Seller).filter(Seller.activo == True).all()
    sellers_map = {s.id: s for s in sellers}

    # Bulk: envio aggregates
    envio_rows = db.query(
        Envio.seller_id,
        func.sum(Envio.cobro_seller + Envio.cobro_extra_manual).label("t_envios"),
        func.sum(Envio.extra_producto_seller).label("t_extras_prod"),
        func.sum(Envio.extra_comuna_seller).label("t_extras_com"),
        func.count(Envio.id).label("cant"),
        func.count(func.distinct(Envio.fecha_entrega)).label("dias"),
    ).filter(
        Envio.semana == semana, Envio.mes == mes, Envio.anio == anio,
    ).group_by(Envio.seller_id).all()

    envio_agg = {r.seller_id: (r.t_envios or 0, r.t_extras_prod or 0, r.t_extras_com or 0, r.cant, r.dias) for r in envio_rows}

    # Bulk: user_nombres per seller
    user_rows = db.query(Envio.seller_id, Envio.user_nombre).filter(
        Envio.semana == semana, Envio.mes == mes, Envio.anio == anio,
        Envio.user_nombre.isnot(None),
    ).distinct().all()
    user_nombres_map: dict[int, list] = {}
    for r in user_rows:
        user_nombres_map.setdefault(r.seller_id, []).append(r.user_nombre)
    for k in user_nombres_map:
        user_nombres_map[k] = sorted(user_nombres_map[k])

    # Bulk: retiros sucursal
    retiro_suc_rows = db.query(
        Retiro.seller_id,
        func.sum(Retiro.tarifa_seller).label("total"),
    ).filter(
        Retiro.sucursal_id.isnot(None),
        Retiro.semana == semana, Retiro.mes == mes, Retiro.anio == anio,
    ).group_by(Retiro.seller_id).all()
    retiro_suc_agg = {r.seller_id: (r.total or 0) for r in retiro_suc_rows}

    # Bulk: ajustes
    ajuste_rows = db.query(
        AjusteLiquidacion.entidad_id,
        func.sum(AjusteLiquidacion.monto).label("total"),
    ).filter(
        AjusteLiquidacion.tipo == TipoEntidadEnum.SELLER,
        AjusteLiquidacion.semana == semana, AjusteLiquidacion.mes == mes, AjusteLiquidacion.anio == anio,
    ).group_by(AjusteLiquidacion.entidad_id).all()
    ajuste_agg = {r.entidad_id: (r.total or 0) for r in ajuste_rows}

    resultados = []
    for seller in sellers:
        if seller.id not in envio_agg:
            continue

        t_envios, t_ep, t_ec, cant, dias = envio_agg[seller.id]

        total_retiros = 0
        if seller.tiene_retiro and not seller.usa_pickup and seller.tarifa_retiro:
            if not (seller.min_paquetes_retiro_gratis > 0 and cant >= seller.min_paquetes_retiro_gratis):
                total_retiros = seller.tarifa_retiro * dias
        total_retiros += retiro_suc_agg.get(seller.id, 0)

        total_ajustes = ajuste_agg.get(seller.id, 0)
        subtotal = t_envios + t_ep + t_ec + total_retiros + total_ajustes
        iva = int(subtotal * 0.19)

        resultados.append({
            "seller_id": seller.id,
            "seller_nombre": seller.nombre,
            "empresa": seller.empresa or "",
            "user_nombres": user_nombres_map.get(seller.id, []),
            "total_envios": t_envios,
            "cantidad_envios": cant,
            "total_extras_producto": t_ep,
            "total_extras_comuna": t_ec,
            "total_retiros": total_retiros,
            "total_ajustes": total_ajustes,
            "subtotal": subtotal,
            "iva": iva,
            "total_con_iva": subtotal + iva,
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
    """Calcula el pago a cada driver para una semana específica. Optimizado con bulk queries."""
    drivers = db.query(Driver).filter(Driver.activo == True).all()
    drivers_map = {d.id: d for d in drivers}

    # Bulk: envio aggregates (separamos contratado/no-contratado en Python)
    envio_rows = db.query(
        Envio.driver_id,
        func.sum(Envio.costo_driver).label("t_envios"),
        func.sum(Envio.pago_extra_manual).label("t_pago_extra"),
        func.sum(Envio.extra_producto_driver).label("t_extras_prod"),
        func.sum(Envio.extra_comuna_driver).label("t_extras_com"),
        func.count(Envio.id).label("cant"),
    ).filter(
        Envio.semana == semana, Envio.mes == mes, Envio.anio == anio,
    ).group_by(Envio.driver_id).all()

    envio_agg = {r.driver_id: (r.t_envios or 0, r.t_pago_extra or 0, r.t_extras_prod or 0, r.t_extras_com or 0, r.cant) for r in envio_rows}

    # Bulk: retiros
    all_retiros = db.query(Retiro).filter(
        Retiro.semana == semana, Retiro.mes == mes, Retiro.anio == anio,
    ).all()
    retiros_map: dict[int, list] = {}
    for r in all_retiros:
        retiros_map.setdefault(r.driver_id, []).append(r)

    driver_ids_con_retiros = set(retiros_map.keys())

    # Bulk: ajustes
    ajuste_rows = db.query(
        AjusteLiquidacion.entidad_id,
        func.sum(AjusteLiquidacion.monto).label("total"),
    ).filter(
        AjusteLiquidacion.tipo == TipoEntidadEnum.DRIVER,
        AjusteLiquidacion.semana == semana, AjusteLiquidacion.mes == mes, AjusteLiquidacion.anio == anio,
    ).group_by(AjusteLiquidacion.entidad_id).all()
    ajuste_agg = {r.entidad_id: (r.total or 0) for r in ajuste_rows}

    resultados = []
    for driver in drivers:
        has_envios = driver.id in envio_agg
        has_retiros = driver.id in driver_ids_con_retiros
        if not has_envios and not has_retiros:
            continue

        t_envios, t_pago_extra, t_ep, t_ec, cant = envio_agg.get(driver.id, (0, 0, 0, 0, 0))
        if driver.contratado:
            total_extras_producto = 0
            total_extras_comuna = 0
        else:
            total_extras_producto = t_ep + t_pago_extra
            total_extras_comuna = t_ec

        retiros = retiros_map.get(driver.id, [])
        total_retiros = _calcular_retiro_driver(driver, retiros)
        total_ajustes = ajuste_agg.get(driver.id, 0)
        total = t_envios + total_extras_producto + total_extras_comuna + total_retiros + total_ajustes

        resultados.append({
            "driver_id": driver.id,
            "driver_nombre": driver.nombre,
            "total_envios": t_envios,
            "cantidad_envios": cant,
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
    Calcula la rentabilidad por seller para una semana. Optimizado con bulk queries.
    """
    from app.models import Pickup, RecepcionPaquete

    pickup_seller_map = {}
    for p in db.query(Pickup).filter(Pickup.seller_id.isnot(None)).all():
        pickup_seller_map[p.id] = p.seller_id

    sellers = db.query(Seller).filter(Seller.activo == True).all()

    # Bulk: all drivers for contratado check
    all_drivers = db.query(Driver).all()
    drivers_map = {d.id: d for d in all_drivers}

    # Bulk: envíos por seller (ingreso + costo driver)
    envios = db.query(Envio).filter(
        Envio.semana == semana, Envio.mes == mes, Envio.anio == anio,
    ).all()

    envios_by_seller: dict[int, list] = {}
    for e in envios:
        envios_by_seller.setdefault(e.seller_id, []).append(e)

    # Bulk: retiros
    all_retiros = db.query(Retiro).filter(
        Retiro.semana == semana, Retiro.mes == mes, Retiro.anio == anio,
    ).all()

    retiros_suc_by_seller: dict[int, list] = {}
    retiros_by_seller: dict[int, list] = {}
    for r in all_retiros:
        if r.seller_id:
            retiros_by_seller.setdefault(r.seller_id, []).append(r)
            if r.sucursal_id:
                retiros_suc_by_seller.setdefault(r.seller_id, []).append(r)

    # Bulk: recepciones
    envio_ids = [e.id for e in envios]
    all_recepciones = db.query(RecepcionPaquete).filter(
        RecepcionPaquete.envio_id.in_(envio_ids),
        RecepcionPaquete.semana == semana,
        RecepcionPaquete.mes == mes,
        RecepcionPaquete.anio == anio,
    ).all() if envio_ids else []

    recep_by_envio: dict[int, list] = {}
    for r in all_recepciones:
        recep_by_envio.setdefault(r.envio_id, []).append(r)

    # Bulk: user_nombres
    user_rows = db.query(Envio.seller_id, Envio.user_nombre).filter(
        Envio.semana == semana, Envio.mes == mes, Envio.anio == anio,
        Envio.user_nombre.isnot(None),
    ).distinct().all()
    user_nombres_map: dict[int, list] = {}
    for r in user_rows:
        user_nombres_map.setdefault(r.seller_id, []).append(r.user_nombre)
    for k in user_nombres_map:
        user_nombres_map[k] = sorted(user_nombres_map[k])

    resultados = []
    for seller in sellers:
        seller_envios = envios_by_seller.get(seller.id, [])
        if not seller_envios:
            continue

        ingreso = sum(
            e.cobro_seller + e.cobro_extra_manual + e.extra_producto_seller + e.extra_comuna_seller
            for e in seller_envios
        )
        ingreso += _calcular_retiro_seller(seller, seller_envios)
        ingreso += sum(r.tarifa_seller for r in retiros_suc_by_seller.get(seller.id, []))

        costo_drivers = 0
        for e in seller_envios:
            driver_e = drivers_map.get(e.driver_id)
            es_contratado = getattr(driver_e, 'contratado', False) if driver_e else False
            extra_p = 0 if es_contratado else e.extra_producto_driver
            extra_c = 0 if es_contratado else e.extra_comuna_driver
            costo_drivers += e.costo_driver + e.pago_extra_manual + extra_p + extra_c

        retiros = retiros_by_seller.get(seller.id, [])
        costo_retiros = _calcular_costo_retiro_para_seller(db, seller.id, retiros, semana, mes, anio)

        costo_pickup = 0
        for e in seller_envios:
            for r in recep_by_envio.get(e.id, []):
                own_seller = pickup_seller_map.get(r.pickup_id)
                if own_seller and own_seller == seller.id:
                    continue
                costo_pickup += r.comision

        costo_total = costo_drivers + costo_retiros + costo_pickup
        margen_bruto = ingreso - costo_total
        margen_porcentaje = (margen_bruto / ingreso * 100) if ingreso > 0 else 0

        resultados.append({
            "seller_id": seller.id,
            "seller_nombre": seller.nombre,
            "user_nombres": user_nombres_map.get(seller.id, []),
            "ingreso": ingreso,
            "costo_drivers": costo_drivers,
            "costo_retiros": costo_retiros,
            "costo_pickup": costo_pickup,
            "costo_total": costo_total,
            "margen_bruto": margen_bruto,
            "margen_porcentaje": round(margen_porcentaje, 1),
        })

    return sorted(resultados, key=lambda x: x["margen_bruto"], reverse=True)
