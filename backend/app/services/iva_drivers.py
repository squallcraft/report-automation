"""
Servicio IVA Drivers.
Calcula la base imponible mensual de un driver a partir de su liquidación,
y gestiona el ciclo de vida de PagoIVADriver (trigger: factura aprobada).
"""
from datetime import date
from typing import Optional

from sqlalchemy.orm import Session

from app.models import (
    Driver, Envio, Retiro, AjusteLiquidacion,
    PagoSemanaDriver, CalendarioSemanas,
    TipoEntidadEnum, EstadoPagoEnum,
    FacturaDriver, EstadoFacturaDriverEnum,
    PagoIVADriver, EstadoPagoIVAEnum,
)
from app.services.liquidacion import _calcular_retiro_driver

IVA_RATE = 0.19


# ---------------------------------------------------------------------------
# Cálculo de base imponible
# ---------------------------------------------------------------------------

def _semanas_del_mes(db: Session, mes: int, anio: int) -> list[int]:
    rows = db.query(CalendarioSemanas.semana).filter(
        CalendarioSemanas.mes == mes,
        CalendarioSemanas.anio == anio,
    ).order_by(CalendarioSemanas.semana).all()
    return [r[0] for r in rows] if rows else [1, 2, 3, 4, 5]


def _monto_semana_driver(db: Session, driver_id: int, semana: int, mes: int, anio: int) -> int:
    """
    Monto calculado para un driver en una semana.
    Respeta el histórico guardado en PagoSemanaDriver cuando la semana está cerrada,
    igual que hace CPC para evitar recomputar datos ya liquidados.
    """
    pago = db.query(PagoSemanaDriver).filter_by(
        driver_id=driver_id, semana=semana, mes=mes, anio=anio,
    ).first()

    if pago and pago.monto_override is not None:
        return pago.monto_override
    if pago and pago.estado == EstadoPagoEnum.PAGADO.value and pago.monto_neto:
        return pago.monto_neto

    # Cálculo en vivo (idéntico a cpc._get_monto_semanal_driver)
    envios = db.query(Envio).filter_by(
        driver_id=driver_id, semana=semana, mes=mes, anio=anio,
    ).all()
    total = sum(
        e.costo_driver + e.pago_extra_manual + e.extra_producto_driver + e.extra_comuna_driver
        for e in envios
    )

    retiros = db.query(Retiro).filter_by(
        driver_id=driver_id, semana=semana, mes=mes, anio=anio,
    ).all()
    driver = db.get(Driver, driver_id)
    cerrada = pago is not None and pago.estado == EstadoPagoEnum.PAGADO.value
    total += (
        _calcular_retiro_driver(driver, retiros, semana_cerrada=cerrada)
        if driver
        else sum(r.tarifa_driver for r in retiros)
    )

    ajustes = db.query(AjusteLiquidacion).filter_by(
        tipo=TipoEntidadEnum.DRIVER, entidad_id=driver_id,
        semana=semana, mes=mes, anio=anio,
    ).all()
    total += sum(a.monto for a in ajustes)

    return total


def calcular_base_iva_mes(db: Session, driver_id: int, mes: int, anio: int) -> int:
    """
    Suma de montos de todas las semanas del mes para el driver.
    Si es jefe de flota, consolida los montos de sus subordinados (igual que CPC).
    Incluye envíos + extras + retiros + ajustes (positivos y negativos).
    Solo debe llamarse cuando hay >= 1 factura aprobada.
    """
    semanas = _semanas_del_mes(db, mes, anio)
    base = sum(_monto_semana_driver(db, driver_id, s, mes, anio) for s in semanas)

    # Subordinados del jefe de flota
    subordinados = db.query(Driver).filter(
        Driver.jefe_flota_id == driver_id,
        Driver.activo == True,
    ).all()
    for sub in subordinados:
        base += sum(_monto_semana_driver(db, sub.id, s, mes, anio) for s in semanas)

    return base


def calcular_iva(base: int) -> int:
    return round(base * IVA_RATE)


# ---------------------------------------------------------------------------
# Gestión del ciclo de vida de PagoIVADriver
# ---------------------------------------------------------------------------

def recalcular_pago_iva(db: Session, driver_id: int, mes: int, anio: int) -> Optional[PagoIVADriver]:
    """
    Upsert de PagoIVADriver basado en las facturas aprobadas del driver en el mes.

    Reglas:
    - >= 1 factura APROBADA → crear o mantener registro PENDIENTE.
    - 0 facturas APROBADAS + existe PENDIENTE → eliminar (nada que pagar).
    - Estado PAGADO → no tocar (ya está cerrado; cambios posteriores no afectan).

    Retorna el PagoIVADriver resultante, o None si fue eliminado.
    """
    facturas_aprobadas = db.query(FacturaDriver).filter(
        FacturaDriver.driver_id == driver_id,
        FacturaDriver.mes == mes,
        FacturaDriver.anio == anio,
        FacturaDriver.estado == EstadoFacturaDriverEnum.APROBADA.value,
    ).all()

    existente = db.query(PagoIVADriver).filter_by(
        driver_id=driver_id, mes_origen=mes, anio_origen=anio,
    ).first()

    if not facturas_aprobadas:
        # Sin facturas aprobadas: eliminar si estaba PENDIENTE
        if existente and existente.estado == EstadoPagoIVAEnum.PENDIENTE.value:
            db.delete(existente)
        return None

    # Hay facturas aprobadas: ya está PAGADO → no tocar
    if existente and existente.estado == EstadoPagoIVAEnum.PAGADO.value:
        return existente

    # Crear o mantener PENDIENTE
    if not existente:
        existente = PagoIVADriver(
            driver_id=driver_id,
            mes_origen=mes,
            anio_origen=anio,
            estado=EstadoPagoIVAEnum.PENDIENTE.value,
        )
        db.add(existente)

    return existente


def cerrar_pago_iva(
    db: Session,
    pago_iva: PagoIVADriver,
    fecha_pago: Optional[date] = None,
) -> PagoIVADriver:
    """
    Congela snapshots y marca el pago como PAGADO.
    Llamar después de confirmar cartola o pago manual.
    """
    base = calcular_base_iva_mes(db, pago_iva.driver_id, pago_iva.mes_origen, pago_iva.anio_origen)
    iva = calcular_iva(base)

    facturas = db.query(FacturaDriver).filter(
        FacturaDriver.driver_id == pago_iva.driver_id,
        FacturaDriver.mes == pago_iva.mes_origen,
        FacturaDriver.anio == pago_iva.anio_origen,
        FacturaDriver.estado == EstadoFacturaDriverEnum.APROBADA.value,
    ).all()

    pago_iva.base_iva_snapshot = base
    pago_iva.monto_iva_snapshot = iva
    pago_iva.facturas_incluidas = [f.id for f in facturas]
    pago_iva.estado = EstadoPagoIVAEnum.PAGADO.value
    pago_iva.fecha_pago = fecha_pago or date.today()

    return pago_iva
