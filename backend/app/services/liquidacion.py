"""
Motor de liquidación.

Regla única de inmutabilidad:
  Si PagoSemanaDriver/Seller.estado == PAGADO → esa semana no se recalcula con
  ningún valor del perfil actual. Se usan solo los valores almacenados en las filas
  de Retiro (tarifa_driver / tarifa_seller) y Envio (costo_driver, extras, etc.).

  Semana abierta → se aplican tarifas actuales del perfil (tarifa_retiro_fija, etc.).
"""
from typing import List

from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models import (
    Envio, Seller, Driver, Retiro, AjusteLiquidacion,
    TipoEntidadEnum, PagoSemanaDriver, PagoSemanaSeller, EstadoPagoEnum,
)


def _es_semana_cerrada_driver(db: Session, driver_id: int, semana: int, mes: int, anio: int) -> bool:
    if not driver_id:
        return False
    return db.query(PagoSemanaDriver).filter(
        PagoSemanaDriver.driver_id == driver_id,
        PagoSemanaDriver.semana == semana,
        PagoSemanaDriver.mes == mes,
        PagoSemanaDriver.anio == anio,
        PagoSemanaDriver.estado == EstadoPagoEnum.PAGADO.value,
    ).first() is not None


def _es_semana_cerrada_seller(db: Session, seller_id: int, semana: int, mes: int, anio: int) -> bool:
    if not seller_id:
        return False
    return db.query(PagoSemanaSeller).filter(
        PagoSemanaSeller.seller_id == seller_id,
        PagoSemanaSeller.semana == semana,
        PagoSemanaSeller.mes == mes,
        PagoSemanaSeller.anio == anio,
        PagoSemanaSeller.estado == EstadoPagoEnum.PAGADO.value,
    ).first() is not None


# ── Aliases para compatibilidad con código existente ──
_semana_cerrada_driver = _es_semana_cerrada_driver
_semana_cerrada_seller = _es_semana_cerrada_seller


def _calcular_retiro_driver(driver, retiros: list, semana_cerrada: bool = False) -> int:
    """
    Pago al driver por retiros en una semana.

    Para drivers con tarifa_retiro_fija: la tarifa es por jornada (día), no por retiro.
    Solo se cuenta UNA tarifa por día — el primer retiro del día (menor ID) lleva la
    tarifa; los demás deberían tener tarifa_driver = 0. Esta función es defensiva y
    deduplica por día aunque los datos tuvieran la tarifa repetida.

    Para drivers sin tarifa_retiro_fija: se suma directamente r.tarifa_driver.
    """
    if not retiros:
        return 0

    if driver and getattr(driver, 'tarifa_retiro_fija', 0) and driver.tarifa_retiro_fija > 0:
        # Una sola tarifa por día: tomar el primer retiro (menor ID) de cada día.
        dia_visto: set = set()
        total = 0
        for r in sorted(retiros, key=lambda x: x.id):
            if r.fecha not in dia_visto:
                dia_visto.add(r.fecha)
                total += r.tarifa_driver or 0
        if total > 0:
            return total
        # Fallback para retiros muy antiguos sin snapshot: tarifa_retiro_fija × días.
        return driver.tarifa_retiro_fija * len(dia_visto)

    return sum(r.tarifa_driver or 0 for r in retiros)


def _calcular_retiro_seller(seller, envios: list, retiros_seller: list = None,
                            mes: int = 0, anio: int = 0) -> int:
    """
    Cobro de retiro al seller para una semana.

    Desde abril 2026 se aplica la regla por día: si el seller tiene
    min_paquetes_retiro_gratis y un día tuvo >= ese mínimo de envíos,
    ese día NO se cobra retiro (independiente de retiros almacenados).

    Períodos anteriores: si existen retiros almacenados los usa; sino
    fallback dinámico con conteo semanal.
    """
    if not seller.tiene_retiro or seller.usa_pickup or not envios:
        return 0

    if not anio and envios:
        anio = getattr(envios[0], 'anio', 0) or 0
        mes = getattr(envios[0], 'mes', 0) or 0

    if seller.min_paquetes_retiro_gratis > 0 and (anio, mes) >= (2026, 4):
        if not seller.tarifa_retiro:
            return 0
        envios_por_dia: dict = {}
        for e in envios:
            if e.fecha_entrega:
                envios_por_dia[e.fecha_entrega] = envios_por_dia.get(e.fecha_entrega, 0) + 1
        dias_cobrar = sum(
            1 for cnt in envios_por_dia.values()
            if cnt < seller.min_paquetes_retiro_gratis
        )
        return seller.tarifa_retiro * dias_cobrar

    if retiros_seller:
        total_stored = sum(r.tarifa_seller or 0 for r in retiros_seller)
        if total_stored > 0:
            return total_stored
    # Fallback dinámico (pre abril 2026)
    if seller.min_paquetes_retiro_gratis > 0 and len(envios) >= seller.min_paquetes_retiro_gratis:
        return 0
    if not seller.tarifa_retiro:
        return 0
    dias = len({e.fecha_entrega for e in envios if e.fecha_entrega})
    return seller.tarifa_retiro * dias


def calcular_liquidacion_sellers(db: Session, semana: int, mes: int, anio: int) -> List[dict]:
    """Calcula el cobro a cada seller para una semana específica."""
    sellers = db.query(Seller).filter(Seller.activo == True).all()

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

    envio_dia_rows = db.query(
        Envio.seller_id, Envio.fecha_entrega, func.count(Envio.id).label("cnt"),
    ).filter(
        Envio.semana == semana, Envio.mes == mes, Envio.anio == anio,
    ).group_by(Envio.seller_id, Envio.fecha_entrega).all()
    envio_dia_map: dict[int, dict] = {}
    for r in envio_dia_rows:
        envio_dia_map.setdefault(r.seller_id, {})[r.fecha_entrega] = r.cnt

    user_rows = db.query(Envio.seller_id, Envio.user_nombre).filter(
        Envio.semana == semana, Envio.mes == mes, Envio.anio == anio,
        Envio.user_nombre.isnot(None),
    ).distinct().all()
    user_nombres_map: dict[int, list] = {}
    for r in user_rows:
        user_nombres_map.setdefault(r.seller_id, []).append(r.user_nombre)
    for k in user_nombres_map:
        user_nombres_map[k] = sorted(user_nombres_map[k])

    all_retiros_seller = db.query(Retiro).filter(
        Retiro.semana == semana, Retiro.mes == mes, Retiro.anio == anio,
        Retiro.seller_id.isnot(None),
    ).all()
    retiro_directo_map: dict[int, list] = {}
    retiro_suc_agg: dict[int, int] = {}
    for r in all_retiros_seller:
        if r.sucursal_id:
            retiro_suc_agg[r.seller_id] = retiro_suc_agg.get(r.seller_id, 0) + (r.tarifa_seller or 0)
        else:
            retiro_directo_map.setdefault(r.seller_id, []).append(r)

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

        if not seller.tiene_retiro or seller.usa_pickup or not seller.tarifa_retiro:
            total_retiro_directo = 0
        elif (anio, mes) >= (2026, 4):
            if seller.min_paquetes_retiro_gratis > 0:
                dia_counts = envio_dia_map.get(seller.id, {})
                dias_cobrar = sum(
                    1 for cnt_d in dia_counts.values()
                    if cnt_d < seller.min_paquetes_retiro_gratis
                )
                total_retiro_directo = seller.tarifa_retiro * dias_cobrar
            else:
                total_retiro_directo = seller.tarifa_retiro * dias
        else:
            retiros_directos = retiro_directo_map.get(seller.id, [])
            if retiros_directos:
                total_retiro_directo = sum(r.tarifa_seller or 0 for r in retiros_directos)
            elif not (seller.min_paquetes_retiro_gratis > 0 and cant >= seller.min_paquetes_retiro_gratis):
                total_retiro_directo = seller.tarifa_retiro * dias
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
    """Calcula el pago a cada driver para una semana específica."""
    drivers = db.query(Driver).filter(Driver.activo == True).all()

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

    all_retiros = db.query(Retiro).filter(
        Retiro.semana == semana, Retiro.mes == mes, Retiro.anio == anio,
    ).all()
    retiros_map: dict[int, list] = {}
    for r in all_retiros:
        retiros_map.setdefault(r.driver_id, []).append(r)

    # Semanas cerradas para esta semana/mes/año — una sola query bulk
    cerrados = db.query(PagoSemanaDriver.driver_id).filter(
        PagoSemanaDriver.semana == semana,
        PagoSemanaDriver.mes == mes,
        PagoSemanaDriver.anio == anio,
        PagoSemanaDriver.estado == EstadoPagoEnum.PAGADO.value,
    ).all()
    drivers_cerrados = {r.driver_id for r in cerrados}

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
        has_retiros = driver.id in retiros_map
        if not has_envios and not has_retiros:
            continue

        t_envios, t_pago_extra, t_ep, t_ec, cant = envio_agg.get(driver.id, (0, 0, 0, 0, 0))
        retiros = retiros_map.get(driver.id, [])
        cerrada = driver.id in drivers_cerrados
        total_retiros = _calcular_retiro_driver(driver, retiros, semana_cerrada=cerrada)
        total_ajustes = ajuste_agg.get(driver.id, 0)
        total = t_envios + t_ep + t_ec + t_pago_extra + total_retiros + total_ajustes

        resultados.append({
            "driver_id": driver.id,
            "driver_nombre": driver.nombre,
            "total_envios": t_envios,
            "cantidad_envios": cant,
            "total_extras_producto": t_ep + t_pago_extra,
            "total_extras_comuna": t_ec,
            "total_retiros": total_retiros,
            "total_ajustes": total_ajustes,
            "subtotal": total,
            "iva": 0,
            "total": total,
        })

    return sorted(resultados, key=lambda x: x["driver_nombre"])


def _calcular_costo_retiro_para_seller(db: Session, seller_id: int, retiros_seller: list, semana: int, mes: int, anio: int) -> int:
    """Costo de retiros para un seller en rentabilidad. Usa tarifa_driver almacenada."""
    if not retiros_seller:
        return 0
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
        destinos_dia = len({r.id for r in retiros_dia})
        costo += (retiro.tarifa_driver or 0) // max(destinos_dia, 1)
    return costo


def calcular_rentabilidad(db: Session, semana: int, mes: int, anio: int) -> List[dict]:
    """Calcula la rentabilidad por seller para una semana."""
    from app.models import Pickup, RecepcionPaquete

    pickup_seller_map = {p.id: p.seller_id for p in db.query(Pickup).filter(Pickup.seller_id.isnot(None)).all()}
    sellers = db.query(Seller).filter(Seller.activo == True).all()

    envios = db.query(Envio).filter(Envio.semana == semana, Envio.mes == mes, Envio.anio == anio).all()
    envios_by_seller: dict[int, list] = {}
    for e in envios:
        envios_by_seller.setdefault(e.seller_id, []).append(e)

    all_retiros = db.query(Retiro).filter(Retiro.semana == semana, Retiro.mes == mes, Retiro.anio == anio).all()
    retiros_suc_by_seller: dict[int, list] = {}
    retiros_by_seller: dict[int, list] = {}
    for r in all_retiros:
        if r.seller_id:
            retiros_by_seller.setdefault(r.seller_id, []).append(r)
            if r.sucursal_id:
                retiros_suc_by_seller.setdefault(r.seller_id, []).append(r)

    envio_ids = [e.id for e in envios]
    all_recepciones = db.query(RecepcionPaquete).filter(
        RecepcionPaquete.envio_id.in_(envio_ids),
        RecepcionPaquete.semana == semana, RecepcionPaquete.mes == mes, RecepcionPaquete.anio == anio,
    ).all() if envio_ids else []
    recep_by_envio: dict[int, list] = {}
    for r in all_recepciones:
        recep_by_envio.setdefault(r.envio_id, []).append(r)

    user_rows = db.query(Envio.seller_id, Envio.user_nombre).filter(
        Envio.semana == semana, Envio.mes == mes, Envio.anio == anio, Envio.user_nombre.isnot(None),
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
        retiros_directos = [r for r in retiros_by_seller.get(seller.id, []) if not r.sucursal_id]
        ingreso += _calcular_retiro_seller(seller, seller_envios, retiros_directos, mes=mes, anio=anio)
        ingreso += sum(r.tarifa_seller for r in retiros_suc_by_seller.get(seller.id, []))

        costo_drivers = sum(
            e.costo_driver + e.pago_extra_manual + (e.extra_producto_driver or 0) + (e.extra_comuna_driver or 0)
            for e in seller_envios
        )
        costo_retiros = _calcular_costo_retiro_para_seller(db, seller.id, retiros_by_seller.get(seller.id, []), semana, mes, anio)
        costo_pickup = sum(
            r.comision
            for e in seller_envios
            for r in recep_by_envio.get(e.id, [])
            if pickup_seller_map.get(r.pickup_id) != seller.id
        )

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
