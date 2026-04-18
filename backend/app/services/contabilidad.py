"""
Servicio de contabilidad de partida doble.
Genera asientos contables desde operaciones del sistema.
"""
from datetime import date
from typing import List, Tuple, Optional
import logging

from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc

from app.models import (
    CuentaContable, AsientoContable, LineaAsiento,
    PagoSemanaDriver, PagoSemanaSeller, PagoSemanaPickup,
    PagoCartola, PagoCartolaSeller, PagoCartolaPickup,
    MovimientoFinanciero, CategoriaFinanciera,
    Driver, Colaborador, BoletaColaborador,
    PagoIVADriver, PagoCartolaIVA,
)

logger = logging.getLogger(__name__)


def _parse_fecha(valor: str) -> date:
    """Parsea fecha en formato ISO (YYYY-MM-DD) o DD/MM/YYYY."""
    if "/" in valor:
        parts = valor.split("/")
        return date(int(parts[2]), int(parts[1]), int(parts[0]))
    return date.fromisoformat(valor)

# Códigos del plan de cuentas (deben coincidir con el seed)
CUENTA_BANCO = "1.1"
CUENTA_BANCO_CHILE = "1.1.1"
CUENTA_BANCO_SANTANDER = "1.1.2"
CUENTA_CXC_SELLERS = "1.2"
CUENTA_INVERSIONES = "1.4"
CUENTA_FONDOS_MUTUOS = "1.4.1"
CUENTA_DEPOSITOS_PLAZO = "1.4.2"
CUENTA_CXP_DRIVERS = "2.1"
CUENTA_CXP_PICKUPS = "2.2"
CUENTA_CXP_PROVEEDORES = "2.3"
CUENTA_TC_BCHILE = "2.6"
CUENTA_TC_SANTANDER = "2.7"
CUENTA_LINEA_BCHILE = "2.8"
CUENTA_LINEA_SANTANDER = "2.9"
CUENTA_INGRESO_OP = "4.1"
CUENTA_INGRESO_SOFTWARE = "4.2"
CUENTA_OTROS_INGRESOS = "4.3"
CUENTA_INGRESO_FINANCIERO = "4.4"
CUENTA_COSTO_DRIVERS = "5.1"
CUENTA_COSTO_PICKUPS = "5.2"
CUENTA_REMUNERACIONES = "5.3"
CUENTA_ARRIENDO = "5.4"
CUENTA_TECNOLOGIA = "5.5"
CUENTA_FREELANCERS = "5.6"
CUENTA_MARKETING = "5.7"
CUENTA_IMPUESTOS = "5.8"
CUENTA_OTROS_GASTOS = "5.9"
CUENTA_INTERESES = "5.10"
CUENTA_REMUNERACIONES_POR_PAGAR = "2.5"  # Pasivo: retenciones previsionales y aportes empleador
CUENTA_IVA_CREDITO_FISCAL = "1.3"        # Activo: IVA soportado en facturas de proveedores (drivers)

# Mapeo CategoriaFinanciera.nombre → código cuenta contable
_CAT_TO_CUENTA = {
    "Inquilinos": CUENTA_INGRESO_SOFTWARE,
    "Proyectos": CUENTA_INGRESO_SOFTWARE,
    "Software": CUENTA_INGRESO_SOFTWARE,
    "Sueldos": CUENTA_REMUNERACIONES,
    "Cotizaciones Previsionales": CUENTA_REMUNERACIONES,
    "Remuneraciones": CUENTA_REMUNERACIONES,
    "Arriendo": CUENTA_ARRIENDO,
    "Servicios Básicos": CUENTA_ARRIENDO,
    "Arriendo y Servicios": CUENTA_ARRIENDO,
    "Servidores": CUENTA_TECNOLOGIA,
    "Software / APIs": CUENTA_TECNOLOGIA,
    "Tecnología": CUENTA_TECNOLOGIA,
    "Freelancers": CUENTA_FREELANCERS,
    "Marketing": CUENTA_MARKETING,
    "IVA": CUENTA_IMPUESTOS,
    "PPM": CUENTA_IMPUESTOS,
    "Impuestos": CUENTA_IMPUESTOS,
    "Créditos": CUENTA_OTROS_GASTOS,
    "Leasing": CUENTA_OTROS_GASTOS,
    "Deudas": CUENTA_OTROS_GASTOS,
    "Otros": CUENTA_OTROS_GASTOS,
}


def _get_cuenta(db: Session, codigo: str) -> Optional[CuentaContable]:
    return db.query(CuentaContable).filter(CuentaContable.codigo == codigo).first()


def _cuenta_id(db: Session, codigo: str) -> int:
    cuenta = _get_cuenta(db, codigo)
    if not cuenta:
        raise ValueError(f"Cuenta contable '{codigo}' no encontrada. Ejecutar seed.")
    return cuenta.id


def cuenta_para_categoria(db: Session, categoria: CategoriaFinanciera) -> int:
    """Determina la cuenta contable que corresponde a una CategoriaFinanciera."""
    codigo = _CAT_TO_CUENTA.get(categoria.nombre)
    if not codigo:
        if categoria.parent:
            codigo = _CAT_TO_CUENTA.get(categoria.parent.nombre)
    if not codigo:
        codigo = CUENTA_OTROS_INGRESOS if categoria.tipo == "INGRESO" else CUENTA_OTROS_GASTOS
    return _cuenta_id(db, codigo)


def crear_asiento(
    db: Session,
    fecha: date,
    descripcion: str,
    ref_tipo: str,
    ref_id: int,
    lineas: List[Tuple],
    creado_por: str = "sistema",
    es_backfill: bool = False,
) -> Optional[AsientoContable]:
    """
    Crea un asiento contable con N líneas.

    lineas: lista de (cuenta_id, debe, haber) o (cuenta_id, debe, haber, glosa)
    Valida: sum(debe) == sum(haber), no duplicados, montos > 0.
    Retorna None si el asiento ya existe (idempotente).
    """
    existing = db.query(AsientoContable).filter(
        AsientoContable.ref_tipo == ref_tipo,
        AsientoContable.ref_id == ref_id,
    ).first()
    if existing:
        return None

    total_debe = sum(l[1] for l in lineas)
    total_haber = sum(l[2] for l in lineas)
    if total_debe != total_haber:
        logger.error(f"Asiento desbalanceado: debe={total_debe} haber={total_haber} ref={ref_tipo}:{ref_id}")
        raise ValueError(f"Asiento desbalanceado: debe={total_debe} != haber={total_haber}")

    if total_debe == 0:
        logger.warning(f"Asiento con monto 0 ignorado: ref={ref_tipo}:{ref_id}")
        return None

    asiento = AsientoContable(
        fecha=fecha,
        descripcion=descripcion,
        ref_tipo=ref_tipo,
        ref_id=ref_id,
        mes=fecha.month,
        anio=fecha.year,
        es_backfill=es_backfill,
        creado_por=creado_por,
    )
    db.add(asiento)
    db.flush()

    for linea in lineas:
        cuenta_id, debe, haber = linea[0], linea[1], linea[2]
        glosa = linea[3] if len(linea) > 3 else None
        db.add(LineaAsiento(
            asiento_id=asiento.id,
            cuenta_id=cuenta_id,
            debe=debe,
            haber=haber,
            glosa=glosa,
        ))

    return asiento


def eliminar_asiento_de_ref(db: Session, ref_tipo: str, ref_id: int) -> bool:
    """Elimina el asiento contable asociado a una referencia. Retorna True si eliminó algo."""
    asiento = db.query(AsientoContable).filter(
        AsientoContable.ref_tipo == ref_tipo,
        AsientoContable.ref_id == ref_id,
    ).first()
    if asiento:
        db.delete(asiento)
        db.flush()
        return True
    return False


# ── Asientos desde operaciones ──

def asiento_pago_driver(db: Session, pago: PagoSemanaDriver, es_backfill=False):
    """CPC PAGADO → Debe: Costo Driver / Haber: Banco"""
    monto = pago.monto_override if pago.monto_override is not None else pago.monto_neto
    if not monto or monto <= 0:
        return None
    fecha = pago.fecha_pago or (pago.updated_at.date() if pago.updated_at else date.today())
    driver = db.get(Driver, pago.driver_id)
    nombre = driver.nombre if driver else f"Driver {pago.driver_id}"
    return crear_asiento(db, fecha,
        f"Pago driver S{pago.semana} — {nombre}",
        "PagoSemanaDriver", pago.id,
        [
            (_cuenta_id(db, CUENTA_COSTO_DRIVERS), monto, 0),
            (_cuenta_id(db, CUENTA_BANCO), 0, monto),
        ],
        es_backfill=es_backfill,
    )


def asiento_cobro_seller(db: Session, pago: PagoCartolaSeller, es_backfill=False):
    """Cartola seller → Debe: Banco / Haber: Ingreso Operacional"""
    if not pago.monto or pago.monto <= 0:
        return None
    fecha = _parse_fecha(pago.fecha_pago) if pago.fecha_pago else date.today()
    from app.models import Seller
    seller = db.get(Seller, pago.seller_id)
    nombre = seller.nombre if seller else f"Seller {pago.seller_id}"
    return crear_asiento(db, fecha,
        f"Cobro seller S{pago.semana} — {nombre}",
        "PagoCartolaSeller", pago.id,
        [
            (_cuenta_id(db, CUENTA_BANCO), pago.monto, 0),
            (_cuenta_id(db, CUENTA_INGRESO_OP), 0, pago.monto),
        ],
        es_backfill=es_backfill,
    )


def asiento_pago_pickup(db: Session, pago: PagoCartolaPickup, es_backfill=False):
    """Cartola pickup → Debe: Costo Pickup / Haber: Banco"""
    if not pago.monto or pago.monto <= 0:
        return None
    fecha = _parse_fecha(pago.fecha_pago) if pago.fecha_pago else date.today()
    return crear_asiento(db, fecha,
        f"Pago pickup S{pago.semana}",
        "PagoCartolaPickup", pago.id,
        [
            (_cuenta_id(db, CUENTA_COSTO_PICKUPS), pago.monto, 0),
            (_cuenta_id(db, CUENTA_BANCO), 0, pago.monto),
        ],
        es_backfill=es_backfill,
    )


def asiento_pago_driver_cartola(db: Session, pago: PagoCartola, es_backfill=False):
    """Cartola driver → Debe: Costo Driver / Haber: Banco"""
    if not pago.monto or pago.monto <= 0:
        return None
    fecha = _parse_fecha(pago.fecha_pago) if pago.fecha_pago else date.today()
    driver = db.get(Driver, pago.driver_id)
    nombre = driver.nombre if driver else f"Driver {pago.driver_id}"
    return crear_asiento(db, fecha,
        f"Pago cartola driver — {nombre}",
        "PagoCartolaDriver", pago.id,
        [
            (_cuenta_id(db, CUENTA_COSTO_DRIVERS), pago.monto, 0),
            (_cuenta_id(db, CUENTA_BANCO), 0, pago.monto),
        ],
        es_backfill=es_backfill,
    )


def asiento_pago_trabajador(db: Session, pago_mes, es_backfill=False):
    """Pago mensual a trabajador → Debe: Remuneraciones / Haber: Banco"""
    monto = pago_mes.monto_neto
    if not monto or monto <= 0:
        return None
    fecha = pago_mes.fecha_pago or date.today()
    from app.models import Trabajador, LiquidacionMensual
    trabajador = db.get(Trabajador, pago_mes.trabajador_id)
    nombre = trabajador.nombre if trabajador else f"Trabajador {pago_mes.trabajador_id}"

    # Si existe una liquidación, usar el asiento enriquecido
    liq = db.query(LiquidacionMensual).filter_by(
        trabajador_id=pago_mes.trabajador_id,
        mes=pago_mes.mes,
        anio=pago_mes.anio,
    ).first()
    if liq:
        return asiento_pago_trabajador_enriquecido(db, pago_mes, liq, es_backfill=es_backfill)

    return crear_asiento(db, fecha,
        f"Pago nómina {pago_mes.mes}/{pago_mes.anio} — {nombre}",
        "PagoMesTrabajador", pago_mes.id,
        [
            (_cuenta_id(db, CUENTA_REMUNERACIONES), monto, 0),
            (_cuenta_id(db, CUENTA_BANCO), 0, monto),
        ],
        es_backfill=es_backfill,
    )


def asiento_pago_trabajador_enriquecido(db: Session, pago_mes, liquidacion, es_backfill=False):
    """
    Asiento completo de remuneraciones con desglose previsional (partida doble).

    Estructura:
      Debe 1: 5.3 Remuneraciones = remuneracion_imponible + no_imponibles
      Debe 2: 5.3 Remuneraciones = aportes patronales (SIS + AFC + Mutual)
      Haber 1: 1.1 Banco = sueldo_liquido (monto efectivo al trabajador)
      Haber 2: 2.5 Retenciones = total_descuentos + aportes_patronales
    """
    from app.models import Trabajador
    trabajador = db.get(Trabajador, pago_mes.trabajador_id)
    nombre = trabajador.nombre if trabajador else f"Trabajador {pago_mes.trabajador_id}"
    fecha = pago_mes.fecha_pago or date.today()

    no_imponibles = (liquidacion.movilizacion or 0) + (liquidacion.colacion or 0) + (liquidacion.viaticos or 0)
    aportes = (liquidacion.costo_sis or 0) + (liquidacion.costo_cesantia_empleador or 0) + (liquidacion.costo_mutual or 0)

    debe_bruto = liquidacion.remuneracion_imponible + no_imponibles
    debe_aportes = aportes
    haber_liquido = liquidacion.sueldo_liquido
    haber_retenciones = (liquidacion.total_descuentos or 0) + aportes

    # Verificar balance
    total_debe = debe_bruto + debe_aportes
    total_haber = haber_liquido + haber_retenciones
    if total_debe != total_haber:
        # Ajuste de redondeo: cuadrar en la retención
        haber_retenciones += total_debe - total_haber

    lineas = [
        (
            _cuenta_id(db, CUENTA_REMUNERACIONES), debe_bruto, 0,
            f"Rem. bruta {pago_mes.mes}/{pago_mes.anio} — {nombre}",
        ),
        (
            _cuenta_id(db, CUENTA_REMUNERACIONES), debe_aportes, 0,
            f"Aportes empleador (SIS+AFC+Mutual) {pago_mes.mes}/{pago_mes.anio} — {nombre}",
        ),
        (
            _cuenta_id(db, CUENTA_BANCO), 0, haber_liquido,
            f"Pago líquido a {nombre}",
        ),
        (
            _cuenta_id(db, CUENTA_REMUNERACIONES_POR_PAGAR), 0, haber_retenciones,
            f"Retenciones previsionales y aportes {pago_mes.mes}/{pago_mes.anio}",
        ),
    ]

    return crear_asiento(db, fecha,
        f"Nómina {pago_mes.mes}/{pago_mes.anio} — {nombre}",
        "PagoMesTrabajador", pago_mes.id,
        lineas,
        es_backfill=es_backfill,
    )


def asiento_movimiento_financiero(db: Session, mov: MovimientoFinanciero, es_backfill=False):
    """MovimientoFinanciero manual → Asiento según tipo de categoría."""
    if not mov.monto or mov.monto <= 0:
        return None
    cat = mov.categoria or db.get(CategoriaFinanciera, mov.categoria_id)
    if not cat:
        return None

    cuenta_gasto_ingreso = cuenta_para_categoria(db, cat)
    fecha = mov.fecha_pago or date(mov.anio, mov.mes, 1)

    if cat.tipo == "EGRESO":
        lineas = [
            (cuenta_gasto_ingreso, mov.monto, 0),
            (_cuenta_id(db, CUENTA_BANCO), 0, mov.monto),
        ]
    else:
        lineas = [
            (_cuenta_id(db, CUENTA_BANCO), mov.monto, 0),
            (cuenta_gasto_ingreso, 0, mov.monto),
        ]

    return crear_asiento(db, fecha,
        f"{cat.tipo}: {mov.nombre}",
        "MovimientoFinanciero", mov.id,
        lineas,
        es_backfill=es_backfill,
    )


def asiento_pago_iva_driver(db: Session, pago_cartola_iva: PagoCartolaIVA, es_backfill=False):
    """
    Pago de IVA a driver → Debe: IVA Crédito Fiscal (1.3) / Haber: Banco (1.1)

    El IVA pagado al driver es un crédito fiscal para la empresa:
    al recibir su factura, nace el crédito; al transferirle el IVA, se cancela
    contra la cuenta bancaria.
    """
    if not pago_cartola_iva.monto or pago_cartola_iva.monto <= 0:
        return None
    fecha = (
        _parse_fecha(pago_cartola_iva.fecha_pago)
        if pago_cartola_iva.fecha_pago
        else date.today()
    )
    driver = db.get(Driver, pago_cartola_iva.driver_id)
    nombre = driver.nombre if driver else f"Driver {pago_cartola_iva.driver_id}"
    pago_iva = db.get(PagoIVADriver, pago_cartola_iva.pago_iva_driver_id)
    periodo = f"{pago_iva.mes_origen}/{pago_iva.anio_origen}" if pago_iva else "?"
    return crear_asiento(
        db, fecha,
        f"IVA driver {periodo} — {nombre}",
        "PagoCartolaIVA", pago_cartola_iva.id,
        [
            (_cuenta_id(db, CUENTA_IVA_CREDITO_FISCAL), pago_cartola_iva.monto, 0,
             f"IVA crédito fiscal factura {nombre} {periodo}"),
            (_cuenta_id(db, CUENTA_BANCO), 0, pago_cartola_iva.monto,
             f"Pago IVA a {nombre}"),
        ],
        es_backfill=es_backfill,
    )


def asiento_pago_colaborador(db: Session, boleta: BoletaColaborador, es_backfill=False):
    """Boleta colaborador PAGADA → Debe: [cuenta asignada] / Haber: Banco"""
    if not boleta.monto or boleta.monto <= 0:
        return None
    colaborador = db.get(Colaborador, boleta.colaborador_id)
    if not colaborador:
        return None
    cuenta_gasto = colaborador.cuenta_contable_id
    if not cuenta_gasto:
        cuenta_gasto = _cuenta_id(db, CUENTA_FREELANCERS)
    nombre = colaborador.nombre
    concepto = boleta.concepto or ""
    desc_extra = f" ({concepto})" if concepto else ""
    fecha = date(boleta.anio, boleta.mes, 1)
    return crear_asiento(db, fecha,
        f"Pago colaborador {boleta.mes}/{boleta.anio} — {nombre}{desc_extra}",
        "BoletaColaborador", boleta.id,
        [
            (cuenta_gasto, boleta.monto, 0),
            (_cuenta_id(db, CUENTA_BANCO), 0, boleta.monto),
        ],
        es_backfill=es_backfill,
    )


# ── Backfill ──

def backfill_historico(db: Session) -> dict:
    """Genera asientos para todas las operaciones históricas. Idempotente."""
    stats = {"drivers": 0, "sellers": 0, "pickups": 0, "cartola_drivers": 0, "movimientos": 0, "errores": 0}

    # PagoSemanaDriver PAGADO (excl. subordinados jefe flota)
    sub_ids = [r[0] for r in db.query(Driver.id).filter(Driver.jefe_flota_id.isnot(None)).all()]
    pagos_d = db.query(PagoSemanaDriver).filter(
        PagoSemanaDriver.estado == "PAGADO",
        ~PagoSemanaDriver.id.in_([0]),
    ).all()
    for p in pagos_d:
        if p.driver_id in sub_ids:
            continue
        try:
            if asiento_pago_driver(db, p, es_backfill=True):
                stats["drivers"] += 1
        except Exception as e:
            logger.error(f"Backfill PagoSemanaDriver {p.id}: {e}")
            stats["errores"] += 1

    # PagoCartolaSeller
    for p in db.query(PagoCartolaSeller).all():
        try:
            if asiento_cobro_seller(db, p, es_backfill=True):
                stats["sellers"] += 1
        except Exception as e:
            logger.error(f"Backfill PagoCartolaSeller {p.id}: {e}")
            stats["errores"] += 1

    # PagoCartolaPickup
    for p in db.query(PagoCartolaPickup).all():
        try:
            if asiento_pago_pickup(db, p, es_backfill=True):
                stats["pickups"] += 1
        except Exception as e:
            logger.error(f"Backfill PagoCartolaPickup {p.id}: {e}")
            stats["errores"] += 1

    # PagoCartola (drivers)
    for p in db.query(PagoCartola).all():
        try:
            if asiento_pago_driver_cartola(db, p, es_backfill=True):
                stats["cartola_drivers"] += 1
        except Exception as e:
            logger.error(f"Backfill PagoCartola {p.id}: {e}")
            stats["errores"] += 1

    # MovimientoFinanciero
    for m in db.query(MovimientoFinanciero).all():
        try:
            if asiento_movimiento_financiero(db, m, es_backfill=True):
                stats["movimientos"] += 1
        except Exception as e:
            logger.error(f"Backfill MovimientoFinanciero {m.id}: {e}")
            stats["errores"] += 1

    db.flush()

    # Verificación post-backfill
    total_debe = db.query(sqlfunc.coalesce(sqlfunc.sum(LineaAsiento.debe), 0)).scalar()
    total_haber = db.query(sqlfunc.coalesce(sqlfunc.sum(LineaAsiento.haber), 0)).scalar()
    stats["verificacion"] = {
        "total_debe": int(total_debe),
        "total_haber": int(total_haber),
        "balanceado": int(total_debe) == int(total_haber),
    }

    return stats
