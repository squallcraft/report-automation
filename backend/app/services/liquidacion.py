"""
Motor de liquidación: calcula cobros a sellers y pagos a drivers.

Reglas de negocio — Retiros:
  - La tabla `retiros` representa paradas físicas de un conductor para recoger carga.
  - `tarifa_driver` de cada retiro ya contiene la tarifa efectiva (fija o por retiro) al momento
    de creación, por lo que la liquidación siempre suma r.tarifa_driver directamente.
  - `tarifa_seller` de cada retiro ya contiene el cobro efectivo al seller al momento de creación.
  - Para semanas cerradas (PAGADO), los valores almacenados son inmutables; el perfil del
    driver/seller puede cambiar sin retroafectar pagos históricos.
"""
from typing import List

from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models import (
    Envio, Seller, Driver, Retiro, AjusteLiquidacion,
    TipoEntidadEnum, PagoSemanaDriver, PagoSemanaSeller, EstadoPagoEnum,
)


def _semana_cerrada_driver(db: Session, driver_id: int, semana: int, mes: int, anio: int) -> bool:
    """Retorna True si la semana ya está pagada (cerrada) para este driver."""
    if not driver_id:
        return False
    return db.query(PagoSemanaDriver).filter(
        PagoSemanaDriver.driver_id == driver_id,
        PagoSemanaDriver.semana == semana,
        PagoSemanaDriver.mes == mes,
        PagoSemanaDriver.anio == anio,
        PagoSemanaDriver.estado == EstadoPagoEnum.PAGADO.value,
    ).first() is not None


def _semana_cerrada_seller(db: Session, seller_id: int, semana: int, mes: int, anio: int) -> bool:
    """Retorna True si la semana ya está pagada (cerrada) para este seller."""
    if not seller_id:
        return False
    return db.query(PagoSemanaSeller).filter(
        PagoSemanaSeller.seller_id == seller_id,
        PagoSemanaSeller.semana == semana,
        PagoSemanaSeller.mes == mes,
        PagoSemanaSeller.anio == anio,
        PagoSemanaSeller.estado == EstadoPagoEnum.PAGADO.value,
    ).first() is not None


def _calcular_retiro_seller(seller, envios: list, retiros_seller: list = None) -> int:
    """
    Cobro de retiro al seller para una semana.

    Si existen registros en la tabla retiros con tarifa_seller > 0, los usa directamente
    (valores históricos inmutables). De lo contrario, calcula dinámicamente desde el perfil
    del seller (comportamiento legacy para semanas abiertas sin retiros importados).

    Respeta min_paquetes_retiro_gratis y usa_pickup.
    """
    if not seller.tiene_retiro or seller.usa_pickup or not envios:
        return 0

    # Si hay retiros con tarifa_seller guardada, sumar esos valores (inmutables)
    if retiros_seller:
        total_stored = sum(r.tarifa_seller for r in retiros_seller if r.tarifa_seller)
        if total_stored > 0:
            return total_stored

    # Fallback dinámico (semanas sin retiros importados)
    if seller.min_paquetes_retiro_gratis > 0 and len(envios) >= seller.min_paquetes_retiro_gratis:
        return 0
    if not seller.tarifa_retiro:
        return 0
    dias_con_envios = len({e.fecha_entrega for e in envios if e.fecha_entrega})
    return seller.tarifa_retiro * dias_con_envios


def _calcular_retiro_driver(driver, retiros: list, semana_cerrada: bool = False) -> int:
    """
    Pago al driver por retiros en una semana.

    - semana_cerrada=True (PAGADO): usar sum(r.tarifa_driver) — valor histórico inmutable.
    - semana_cerrada=False y tarifa_retiro_fija > 0: tarifa_fija × días distintos con retiro.
    - Sin tarifa fija: sum(r.tarifa_driver).
    """
    if not retiros:
        return 0
    if not semana_cerrada and driver and driver.tarifa_retiro_fija and driver.tarifa_retiro_fija > 0:
        dias_con_retiro = len({r.fecha for r in retiros if r.fecha})
        return driver.tarifa_retiro_fija * dias_con_retiro
    return sum(r.tarifa_driver or 0 for r in retiros)


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

    # Bulk: todos los retiros del periodo (seller directo + sucursal)
    all_retiros_seller = db.query(Retiro).filter(
        Retiro.semana == semana, Retiro.mes == mes, Retiro.anio == anio,
        Retiro.seller_id.isnot(None),
    ).all()

    # Separar retiros de sucursal vs directos del seller
    retiro_directo_map: dict[int, list] = {}   # seller_id -> retiros sin sucursal
    retiro_suc_agg: dict[int, int] = {}         # seller_id -> sum(tarifa_seller) de sucursal
    for r in all_retiros_seller:
        if r.sucursal_id:
            retiro_suc_agg[r.seller_id] = retiro_suc_agg.get(r.seller_id, 0) + (r.tarifa_seller or 0)
        else:
            retiro_directo_map.setdefault(r.seller_id, []).append(r)

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

        # Retiro directo del seller: usar tarifa_seller almacenada si existe,
        # si no, calcular dinámicamente (legacy para sellers sin retiros importados)
        retiros_directos = retiro_directo_map.get(seller.id, [])
        if retiros_directos:
            # Usar valores almacenados (inmutables, no afectados por cambios de perfil)
            total_retiro_directo = sum(r.tarifa_seller or 0 for r in retiros_directos)
        elif seller.tiene_retiro and not seller.usa_pickup and seller.tarifa_retiro:
            # Cálculo dinámico solo para semanas sin retiros importados
            if not (seller.min_paquetes_retiro_gratis > 0 and cant >= seller.min_paquetes_retiro_gratis):
                total_retiro_directo = seller.tarifa_retiro * dias
            else:
                total_retiro_directo = 0
        else:
            total_retiro_directo = 0

        total_retiros = total_retiro_directo + retiro_suc_agg.get(seller.id, 0)

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


def calcular_liquidacion_drivers(db: Session, semana: int, mes: int, anio: int) -> List[dict]:
    """Calcula el pago a cada driver para una semana específica. Optimizado con bulk queries."""
    drivers = db.query(Driver).filter(Driver.activo == True).all()
    drivers_map = {d.id: d for d in drivers}

    # Bulk: envio aggregates
    # Los extras ya están almacenados en el envío con el valor efectivo al momento de ingesta.
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

    # Bulk: semanas cerradas para esta semana/mes/año (para saber si usar tarifa fija o histórica)
    pagos_cerrados = db.query(PagoSemanaDriver.driver_id).filter(
        PagoSemanaDriver.semana == semana,
        PagoSemanaDriver.mes == mes,
        PagoSemanaDriver.anio == anio,
        PagoSemanaDriver.estado == EstadoPagoEnum.PAGADO.value,
    ).all()
    drivers_con_semana_cerrada = {r.driver_id for r in pagos_cerrados}

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
        total_extras_producto = t_ep + t_pago_extra
        total_extras_comuna = t_ec

        retiros = retiros_map.get(driver.id, [])
        semana_cerrada = driver.id in drivers_con_semana_cerrada
        total_retiros = _calcular_retiro_driver(driver, retiros, semana_cerrada=semana_cerrada)
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
    Usa tarifa_driver almacenada en cada retiro (valor histórico inmutable).
    Si el driver tiene múltiples paradas en el mismo día, prorratear el costo entre sellers/pickups.
    """
    if not retiros_seller:
        return 0

    # Agrupar retiros del mismo driver por día para prorratear
    from collections import defaultdict
    # all_retiros_dia[driver_id][fecha] = list of retiros
    driver_fecha_retiros: dict = {}
    for r in retiros_seller:
        if r.driver_id:
            key = (r.driver_id, r.fecha)
            if key not in driver_fecha_retiros:
                driver_fecha_retiros[key] = db.query(Retiro).filter(
                    Retiro.driver_id == r.driver_id,
                    Retiro.fecha == r.fecha,
                    Retiro.semana == semana,
                    Retiro.mes == mes,
                    Retiro.anio == anio,
                ).all()

    costo = 0
    for retiro in retiros_seller:
        if not retiro.driver_id:
            costo += retiro.tarifa_driver or 0
            continue
        key = (retiro.driver_id, retiro.fecha)
        retiros_dia = driver_fecha_retiros.get(key, [retiro])
        # Prorratear tarifa_driver del retiro entre todos los destinos del día
        destinos_dia = len({r.id for r in retiros_dia})
        if destinos_dia > 1:
            costo += (retiro.tarifa_driver or 0) // destinos_dia
        else:
            costo += retiro.tarifa_driver or 0
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
        # Retiro directo del seller: usar tarifa_seller almacenada
        retiros_directos_seller = [r for r in retiros_by_seller.get(seller.id, []) if not r.sucursal_id]
        ingreso += _calcular_retiro_seller(seller, seller_envios, retiros_directos_seller)
        ingreso += sum(r.tarifa_seller for r in retiros_suc_by_seller.get(seller.id, []))

        costo_drivers = 0
        for e in seller_envios:
            # Usar valores almacenados en el envío (no depender de driver.contratado actual)
            costo_drivers += e.costo_driver + e.pago_extra_manual + (e.extra_producto_driver or 0) + (e.extra_comuna_driver or 0)

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
