from datetime import datetime, date
from sqlalchemy import (
    Column, Integer, String, Boolean, Text, Date, DateTime, Time,
    Enum, ForeignKey, JSON, UniqueConstraint, Index, func, Numeric, Float,
)
from sqlalchemy.orm import relationship
import enum

from app.database import Base


class EmpresaEnum(str, enum.Enum):
    ECOURIER = "ECOURIER"
    TERCERIZADO = "TERCERIZADO"
    OVIEDO = "OVIEDO"
    VALPARAISO = "VALPARAISO"
    MELIPILLA = "MELIPILLA"


class TipoEntidadEnum(str, enum.Enum):
    SELLER = "SELLER"
    DRIVER = "DRIVER"
    TRABAJADOR = "TRABAJADOR"
    COLABORADOR = "COLABORADOR"


class EstadoLiquidacionEnum(str, enum.Enum):
    BORRADOR = "BORRADOR"
    REVISION = "REVISION"
    APROBADO = "APROBADO"
    PAGADO = "PAGADO"


class EstadoConsultaEnum(str, enum.Enum):
    PENDIENTE = "PENDIENTE"
    RESPONDIDA = "RESPONDIDA"
    CERRADA = "CERRADA"


class RolEnum(str, enum.Enum):
    ADMIN = "ADMIN"
    ADMINISTRACION = "ADMINISTRACION"
    SELLER = "SELLER"
    DRIVER = "DRIVER"
    PICKUP = "PICKUP"
    COLABORADOR = "COLABORADOR"
    TRABAJADOR = "TRABAJADOR"
    INQUILINO = "INQUILINO"


class PlanInquilinoEnum(str, enum.Enum):
    TARIFA_A = "TARIFA_A"
    TARIFA_B = "TARIFA_B"
    TARIFA_C = "TARIFA_C"


class EstadoCobrosInquilinoEnum(str, enum.Enum):
    PENDIENTE = "PENDIENTE"
    PAGADO = "PAGADO"
    VENCIDO = "VENCIDO"


class EstadoAnexoInquilinoEnum(str, enum.Enum):
    BORRADOR = "BORRADOR"
    EMITIDO = "EMITIDO"
    FIRMADO = "FIRMADO"


class TipoAnexoInquilinoEnum(str, enum.Enum):
    CONTRATO = "CONTRATO"
    RESERVA = "RESERVA"


class Seller(Base):
    __tablename__ = "sellers"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False, unique=True)
    aliases = Column(JSON, default=list)
    zona = Column(String, default="Santiago")
    empresa = Column(String, nullable=False, default=EmpresaEnum.ECOURIER.value)
    precio_base = Column(Integer, nullable=False, default=0)
    plan_tarifario = Column(String, nullable=True)
    tiene_retiro = Column(Boolean, default=False)
    tarifa_retiro = Column(Integer, default=0)
    tarifa_retiro_driver = Column(Integer, default=0)
    min_paquetes_retiro_gratis = Column(Integer, default=0)
    usa_pickup = Column(Boolean, default=False)
    mensual = Column(Boolean, default=False)
    tipo_pago = Column(String, default="semanal")
    rut = Column(String, nullable=True)
    giro = Column(String, nullable=True)
    dir_fiscal = Column(String(70), nullable=True)   # DirRecep — máx 70 caracteres (estándar SII)
    cmna_fiscal = Column(String(20), nullable=True)  # CmnaRecep — máx 20 caracteres (estándar SII)
    correo_dte = Column(String(80), nullable=True)   # CorreoRecep — notificación DTE, máx 80 caracteres
    correo_informativo = Column(String(120), nullable=True)  # correo para comunicaciones masivas / campañas informativas
    activo = Column(Boolean, default=True)
    email = Column(String, unique=True, nullable=True)  # acceso al portal del seller
    password_hash = Column(String, nullable=True)
    # ── Lifecycle comercial ──────────────────────────────────────────────────
    tipo_cierre = Column(String(20), nullable=True)       # 'pausa' | 'cerrado' | 'desactivado'
    fecha_cierre = Column(Date, nullable=True)
    fecha_pausa_fin = Column(Date, nullable=True)         # solo para tipo_cierre='pausa'
    razones_cierre = Column(JSON, default=list)           # lista de strings (multi-select)
    conversacion_salida = Column(String(20), nullable=True)  # 'si' | 'no' | 'parcial'
    destino_competencia = Column(String(200), nullable=True)
    potencial_recuperacion = Column(String(20), nullable=True)  # 'alto' | 'medio' | 'bajo' | 'ninguno'
    condicion_recuperacion = Column(Text, nullable=True)
    nota_cierre = Column(Text, nullable=True)
    cerrado_por = Column(String(100), nullable=True)
    # ── Comportamiento comercial ─────────────────────────────────────────────
    estacional = Column(Boolean, default=False)           # exime de regla auto-perdido a 3 meses
    telefono_whatsapp = Column(String(20), nullable=True) # número para WhatsApp Business
    tags = Column(JSON, default=list)                     # etiquetas manuales + automáticas (ej. ["pickup", "vip"])
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    envios = relationship("Envio", back_populates="seller")
    retiros = relationship("Retiro", back_populates="seller")
    sucursales = relationship("Sucursal", back_populates="seller", cascade="all, delete-orphan")


class Sucursal(Base):
    __tablename__ = "sucursales"

    id = Column(Integer, primary_key=True, index=True)
    seller_id = Column(Integer, ForeignKey("sellers.id"), nullable=False)
    nombre = Column(String, nullable=False)
    aliases = Column(JSON, default=list)
    tarifa_retiro = Column(Integer, default=0)
    tarifa_retiro_driver = Column(Integer, default=0)
    activo = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())

    seller = relationship("Seller", back_populates="sucursales")
    retiros = relationship("Retiro", back_populates="sucursal")


class Driver(Base):
    __tablename__ = "drivers"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False, unique=True)
    aliases = Column(JSON, default=list)
    tarifa_ecourier = Column(Integer, nullable=False, default=1700)
    tarifa_oviedo = Column(Integer, nullable=False, default=1800)
    tarifa_tercerizado = Column(Integer, nullable=False, default=1500)
    tarifa_valparaiso = Column(Integer, nullable=False, default=0)
    tarifa_melipilla = Column(Integer, nullable=False, default=0)
    zona = Column(String, nullable=True)
    tarifa_retiro_fija = Column(Integer, nullable=False, default=0)
    jefe_flota_id = Column(Integer, ForeignKey("drivers.id"), nullable=True)
    rut = Column(String, nullable=True)
    banco = Column(String, nullable=True)
    tipo_cuenta = Column(String, nullable=True)
    numero_cuenta = Column(String, nullable=True)
    activo = Column(Boolean, default=True)
    contratado = Column(Boolean, default=False)
    email = Column(String, unique=True, nullable=True)
    password_hash = Column(String, nullable=True)
    nombre_completo = Column(String, nullable=True)
    acuerdo_aceptado = Column(Boolean, default=False, nullable=False)
    acuerdo_version = Column(String, nullable=True)
    acuerdo_fecha = Column(DateTime, nullable=True)
    acuerdo_ip = Column(String, nullable=True)
    acuerdo_firma = Column(Text, nullable=True)
    carnet_frontal = Column(Text, nullable=True)
    carnet_trasero = Column(Text, nullable=True)
    correo_notificaciones = Column(String, nullable=True)
    whatsapp = Column(String, nullable=True)
    trabajador_id = Column(Integer, ForeignKey("trabajadores.id"), nullable=True)
    contrato_trabajo_aceptado = Column(Boolean, default=False, nullable=False)
    contrato_trabajo_version = Column(String, nullable=True)
    contrato_trabajo_fecha = Column(DateTime, nullable=True)
    contrato_trabajo_ip = Column(String, nullable=True)
    contrato_trabajo_firma = Column(Text, nullable=True)
    # Vehículo asignado por defecto (FK a flota). Se cambia solo cuando hay reasignación.
    vehiculo_patente = Column(String(12), nullable=True)        # patente del vehículo habitual
    created_at      = Column(DateTime, server_default=func.now())
    updated_at      = Column(DateTime, server_default=func.now(), onupdate=func.now())

    jefe_flota = relationship("Driver", remote_side=[id], back_populates="subordinados")
    subordinados = relationship("Driver", back_populates="jefe_flota")
    envios = relationship("Envio", back_populates="driver")
    retiros = relationship("Retiro", back_populates="driver")
    trabajador = relationship("Trabajador")


class Envio(Base):
    __tablename__ = "envios"
    __table_args__ = (
        Index("ix_envios_periodo", "semana", "mes", "anio"),
        Index("ix_envios_seller_periodo", "seller_id", "mes", "anio"),
        Index("ix_envios_driver_periodo", "driver_id", "mes", "anio"),
        Index("ix_envios_empresa", "empresa"),
        Index("ix_envios_comuna", "comuna"),
    )

    id = Column(Integer, primary_key=True, index=True)
    semana = Column(Integer, nullable=False)
    mes = Column(Integer, nullable=False)
    anio = Column(Integer, nullable=False)
    fecha_carga = Column(Date, nullable=True)
    fecha_entrega = Column(Date, nullable=False)
    hora_entrega = Column(Time, nullable=True)
    seller_id = Column(Integer, ForeignKey("sellers.id"), nullable=True)
    driver_id = Column(Integer, ForeignKey("drivers.id"), nullable=True)
    user_nombre = Column(String, nullable=True)
    seller_nombre_raw = Column(String, nullable=True)
    driver_nombre_raw = Column(String, nullable=True)
    zona = Column(String, nullable=True)
    comuna = Column(String, nullable=True)
    empresa = Column(String, nullable=True)
    cobro_seller = Column(Integer, default=0)
    costo_driver = Column(Integer, default=0)
    extra_producto_seller = Column(Integer, default=0)
    extra_producto_driver = Column(Integer, default=0)
    extra_comuna_seller = Column(Integer, default=0)
    extra_comuna_driver = Column(Integer, default=0)
    cobro_extra_manual = Column(Integer, default=0)
    pago_extra_manual = Column(Integer, default=0)
    costo_orden = Column(Integer, default=0)
    bultos = Column(Integer, default=1)
    tracking_id = Column(String, nullable=True, index=True)
    seller_code = Column(String, nullable=True)
    venta_id = Column(String, nullable=True)
    descripcion_producto = Column(Text, nullable=True)
    codigo_producto = Column(String, nullable=True)
    ruta_nombre = Column(String, nullable=True)
    ruta_id = Column(Integer, nullable=True, index=True)
    fecha_retiro = Column(Date, nullable=True, index=True)
    fecha_ruta = Column(Date, nullable=True, index=True)
    direccion = Column(Text, nullable=True)
    lat = Column(Float, nullable=True)
    lon = Column(Float, nullable=True)
    homologado = Column(Boolean, default=True)
    ingesta_id = Column(String, nullable=True)

    # Auditoría / estados (Fase 2)
    estado_entrega = Column(String, nullable=False, default="delivered")
    estado_financiero = Column(String, nullable=False, default="pendiente", index=True)
    is_liquidado = Column(Boolean, nullable=False, default=False)
    is_facturado = Column(Boolean, nullable=False, default=False)
    is_pagado_driver = Column(Boolean, nullable=False, default=False)
    origen = Column(String, nullable=False, default="ingesta")
    external_id = Column(String, nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    seller = relationship("Seller", back_populates="envios")
    driver = relationship("Driver", back_populates="envios")

    def sync_estado_financiero(self):
        """Recalcula estado_financiero a partir de los flags booleanos."""
        if self.is_facturado and self.is_pagado_driver:
            self.estado_financiero = "cerrado"
        elif self.is_facturado:
            self.estado_financiero = "facturado"
        elif self.is_pagado_driver:
            self.estado_financiero = "pagado_driver"
        elif self.is_liquidado:
            self.estado_financiero = "liquidado"
        else:
            self.estado_financiero = "pendiente"


class Pickup(Base):
    __tablename__ = "pickups"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False, unique=True)
    aliases = Column(JSON, default=list)
    tarifa_driver = Column(Integer, default=0)
    comision_paquete = Column(Integer, default=200)
    seller_id = Column(Integer, ForeignKey("sellers.id"), nullable=True)
    driver_id = Column(Integer, ForeignKey("drivers.id"), nullable=True)
    activo = Column(Boolean, default=True)
    email = Column(String, unique=True, nullable=True)
    password_hash = Column(String, nullable=True)
    rut = Column(String, nullable=True)
    banco = Column(String, nullable=True)
    tipo_cuenta = Column(String, nullable=True)
    numero_cuenta = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    seller = relationship("Seller", foreign_keys=[seller_id])
    driver = relationship("Driver", foreign_keys=[driver_id])
    recepciones = relationship("RecepcionPaquete", back_populates="pickup")
    retiros = relationship("Retiro", back_populates="pickup")


class RecepcionPaquete(Base):
    __tablename__ = "recepciones_paquetes"
    __table_args__ = (
        Index("ix_recpaq_periodo", "semana", "mes", "anio"),
        Index("ix_recpaq_pickup_periodo", "pickup_id", "mes", "anio"),
    )

    id = Column(Integer, primary_key=True, index=True)
    pickup_id = Column(Integer, ForeignKey("pickups.id"), nullable=True)
    pickup_nombre_raw = Column(String, nullable=True)
    envio_id = Column(Integer, ForeignKey("envios.id"), nullable=True)
    fecha_recepcion = Column(Date, nullable=False)
    semana = Column(Integer, nullable=False)
    mes = Column(Integer, nullable=False)
    anio = Column(Integer, nullable=False)
    pedido = Column(String, nullable=False)
    tipo = Column(String, nullable=True)
    comision = Column(Integer, default=200)
    procesado = Column(Boolean, default=True)
    error_msg = Column(String, nullable=True)
    ingesta_id = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    pickup = relationship("Pickup", back_populates="recepciones")
    envio = relationship("Envio")


class Retiro(Base):
    __tablename__ = "retiros"

    id = Column(Integer, primary_key=True, index=True)
    fecha = Column(Date, nullable=False)
    semana = Column(Integer, nullable=False)
    mes = Column(Integer, nullable=False)
    anio = Column(Integer, nullable=False)
    seller_id = Column(Integer, ForeignKey("sellers.id"), nullable=True)
    driver_id = Column(Integer, ForeignKey("drivers.id"), nullable=True)
    pickup_id = Column(Integer, ForeignKey("pickups.id"), nullable=True)
    sucursal_id = Column(Integer, ForeignKey("sucursales.id"), nullable=True)
    tarifa_seller = Column(Integer, nullable=False, default=0)
    tarifa_driver = Column(Integer, nullable=False, default=0)
    # Para conductores contratados: el retiro es parte de su jornada ordinaria;
    # tarifa_driver se fija a 0 (no genera pago extra) y aquí se guarda el valor
    # equivalente que la empresa absorbe (= tarifa_retiro_fija calculada al momento).
    costo_empresa   = Column(Integer, nullable=False, default=0)
    seller_nombre_raw = Column(String, nullable=True)
    driver_nombre_raw = Column(String, nullable=True)
    homologado = Column(Boolean, default=True)
    ingesta_id = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    seller = relationship("Seller", back_populates="retiros")
    driver = relationship("Driver", back_populates="retiros")
    pickup = relationship("Pickup", back_populates="retiros")
    sucursal = relationship("Sucursal", back_populates="retiros")


class ProductoConExtra(Base):
    __tablename__ = "productos_con_extra"

    id = Column(Integer, primary_key=True, index=True)
    codigo_mlc = Column(String, nullable=False, unique=True)
    descripcion = Column(String, nullable=True)
    extra_seller = Column(Integer, default=0)
    extra_driver = Column(Integer, default=0)
    activo = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())


class TarifaComuna(Base):
    __tablename__ = "tarifas_comuna"

    id = Column(Integer, primary_key=True, index=True)
    comuna = Column(String, nullable=False, unique=True)
    extra_seller = Column(Integer, default=0)
    extra_driver = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())


class TarifaPlanComuna(Base):
    __tablename__ = "tarifas_plan_comuna"
    __table_args__ = (
        UniqueConstraint("plan_tarifario", "comuna", name="uq_plan_comuna"),
    )

    id = Column(Integer, primary_key=True, index=True)
    plan_tarifario = Column(String, nullable=False, index=True)
    comuna = Column(String, nullable=False, index=True)
    precio = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, server_default=func.now())


class AjusteLiquidacion(Base):
    __tablename__ = "ajustes_liquidacion"

    id = Column(Integer, primary_key=True, index=True)
    tipo = Column(String, nullable=False)
    entidad_id = Column(Integer, nullable=False)
    semana = Column(Integer, nullable=False)
    mes = Column(Integer, nullable=False)
    anio = Column(Integer, nullable=False)
    monto = Column(Integer, nullable=False)
    motivo = Column(Text, nullable=True)
    creado_por = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())


class PeriodoLiquidacion(Base):
    __tablename__ = "periodos_liquidacion"

    id = Column(Integer, primary_key=True, index=True)
    semana = Column(Integer, nullable=False)
    mes = Column(Integer, nullable=False)
    anio = Column(Integer, nullable=False)
    estado = Column(String, nullable=False, default=EstadoLiquidacionEnum.BORRADOR.value)
    snapshot_sellers = Column(JSON, nullable=True)
    snapshot_drivers = Column(JSON, nullable=True)
    snapshot_rentabilidad = Column(JSON, nullable=True)
    aprobado_por = Column(String, nullable=True)
    aprobado_en = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class ConsultaPortal(Base):
    __tablename__ = "consultas_portal"

    id = Column(Integer, primary_key=True, index=True)
    tipo = Column(String, nullable=False)
    entidad_id = Column(Integer, nullable=False)
    envio_id = Column(Integer, ForeignKey("envios.id"), nullable=True)
    mensaje = Column(Text, nullable=False)
    estado = Column(String, nullable=False, default=EstadoConsultaEnum.PENDIENTE.value)
    respuesta = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    respondida_en = Column(DateTime, nullable=True)

    envio = relationship("Envio")


class LogIngesta(Base):
    __tablename__ = "logs_ingesta"

    id = Column(Integer, primary_key=True, index=True)
    ingesta_id = Column(String, nullable=False, index=True)
    usuario = Column(String, nullable=True)
    tipo = Column(String, nullable=False)
    archivo = Column(String, nullable=True)
    total_filas = Column(Integer, default=0)
    procesados = Column(Integer, default=0)
    errores_count = Column(Integer, default=0)
    sin_homologar_sellers = Column(JSON, default=list)
    sin_homologar_drivers = Column(JSON, default=list)
    errores = Column(JSON, default=list)
    resultado = Column(JSON, default=dict)
    created_at = Column(DateTime, server_default=func.now())


class EstadoPagoEnum(str, enum.Enum):
    PENDIENTE = "PENDIENTE"
    PAGADO = "PAGADO"
    INCOMPLETO = "INCOMPLETO"


class EstadoFacturaEnum(str, enum.Enum):
    PENDIENTE = "PENDIENTE"
    EMITIDA = "EMITIDA"
    ANULADA = "ANULADA"


class PagoSemanaSeller(Base):
    """Control semanal de cobros a sellers (ingresos)."""
    __tablename__ = "pagos_semana_sellers"
    __table_args__ = (
        UniqueConstraint("seller_id", "semana", "mes", "anio", name="uq_pago_semana_seller"),
    )

    id = Column(Integer, primary_key=True, index=True)
    seller_id = Column(Integer, ForeignKey("sellers.id"), nullable=False)
    semana = Column(Integer, nullable=False)
    mes = Column(Integer, nullable=False)
    anio = Column(Integer, nullable=False)
    monto_neto = Column(Integer, default=0)
    monto_override = Column(Integer, nullable=True)
    estado = Column(String, nullable=False, default=EstadoPagoEnum.PENDIENTE.value)
    nota = Column(Text, nullable=True)
    fecha_pago = Column(Date, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    seller = relationship("Seller")


class PagoSemanaDriver(Base):
    """Control semanal de pagos a drivers (egresos / CPC)."""
    __tablename__ = "pagos_semana_drivers"
    __table_args__ = (
        UniqueConstraint("driver_id", "semana", "mes", "anio", name="uq_pago_semana_driver"),
    )

    id = Column(Integer, primary_key=True, index=True)
    driver_id = Column(Integer, ForeignKey("drivers.id"), nullable=False)
    semana = Column(Integer, nullable=False)
    mes = Column(Integer, nullable=False)
    anio = Column(Integer, nullable=False)
    monto_neto = Column(Integer, default=0)
    monto_override = Column(Integer, nullable=True)
    estado = Column(String, nullable=False, default=EstadoPagoEnum.PENDIENTE.value)
    nota = Column(Text, nullable=True)
    fecha_pago = Column(Date, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    driver = relationship("Driver")


class PagoCartola(Base):
    """Pago efectivo a un driver, importado desde cartola bancaria o registrado manualmente."""
    __tablename__ = "pagos_cartola_drivers"

    id = Column(Integer, primary_key=True, index=True)
    driver_id = Column(Integer, ForeignKey("drivers.id"), nullable=False)
    semana = Column(Integer, nullable=False)
    mes = Column(Integer, nullable=False)
    anio = Column(Integer, nullable=False)
    monto = Column(Integer, nullable=False)
    fecha_pago = Column(String, nullable=True)
    descripcion = Column(String, nullable=True)
    fuente = Column(String, nullable=False, default="cartola")
    fingerprint = Column(String(32), nullable=True)   # MD5(fecha|monto|descripcion) — deduplicación
    carga_id = Column(Integer, ForeignKey("cartola_cargas.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    driver = relationship("Driver")
    carga = relationship("CartolaCarga", foreign_keys=[carga_id])


class PagoCartolaSeller(Base):
    """Pago efectivo recibido de un seller, importado desde cartola bancaria o registrado manualmente."""
    __tablename__ = "pagos_cartola_sellers"

    id = Column(Integer, primary_key=True, index=True)
    seller_id = Column(Integer, ForeignKey("sellers.id"), nullable=False)
    semana = Column(Integer, nullable=False)
    mes = Column(Integer, nullable=False)
    anio = Column(Integer, nullable=False)
    monto = Column(Integer, nullable=False)
    fecha_pago = Column(String, nullable=True)
    descripcion = Column(String, nullable=True)
    fuente = Column(String, nullable=False, default="cartola")
    fingerprint = Column(String(32), nullable=True)   # MD5(fecha|monto|descripcion) — deduplicación
    carga_id = Column(Integer, ForeignKey("cartola_cargas.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    seller = relationship("Seller")
    carga = relationship("CartolaCarga", foreign_keys=[carga_id])


class FacturaMensualSeller(Base):
    """Factura mensual consolidada emitida a cada seller vía Haulmer."""
    __tablename__ = "facturas_mensuales_sellers"
    __table_args__ = (
        UniqueConstraint("seller_id", "mes", "anio", name="uq_factura_mensual_seller"),
    )

    id = Column(Integer, primary_key=True, index=True)
    seller_id = Column(Integer, ForeignKey("sellers.id"), nullable=False)
    mes = Column(Integer, nullable=False)
    anio = Column(Integer, nullable=False)
    subtotal_neto = Column(Integer, default=0)
    iva = Column(Integer, default=0)
    total = Column(Integer, default=0)
    folio_haulmer = Column(String, nullable=True)
    estado = Column(String, nullable=False, default=EstadoFacturaEnum.PENDIENTE.value)
    emitida_por = Column(String, nullable=True)
    emitida_en = Column(DateTime, nullable=True)
    respuesta_api = Column(JSON, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    seller = relationship("Seller")


class CalendarioSemanas(Base):
    """
    Define qué semana/mes/año corresponde a cada bloque Mon-Sun del año.
    Regla de negocio: si cualquier día Lun-Vie de la semana cae en el mes siguiente,
    toda la semana (Lun-Dom) pertenece a la semana 1 de ese mes siguiente.
    """
    __tablename__ = "calendario_semanas"
    __table_args__ = (
        UniqueConstraint("semana", "mes", "anio", name="uq_calendario_semana_mes_anio"),
    )

    id = Column(Integer, primary_key=True, index=True)
    semana = Column(Integer, nullable=False)
    mes = Column(Integer, nullable=False)
    anio = Column(Integer, nullable=False)
    fecha_inicio = Column(Date, nullable=False)
    fecha_fin = Column(Date, nullable=False)
    generado_auto = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class TarifaEscalonadaSeller(Base):
    """
    Tarifa escalonada por volumen semanal para un seller específico.
    Los tramos se almacenan como JSON: [{"min": 1, "max": 75, "precio": 2800}, ...]
    max=null en el último tramo significa sin límite superior.
    zona_aplicable filtra envíos (ej: "Santiago"); null = aplica a todos.
    """
    __tablename__ = "tarifas_escalonadas_sellers"

    id = Column(Integer, primary_key=True, index=True)
    seller_id = Column(Integer, ForeignKey("sellers.id"), nullable=False)
    zona_aplicable = Column(String, nullable=True)
    tramos = Column(JSON, nullable=False)
    activo = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    seller = relationship("Seller")


class AdminUser(Base):
    __tablename__ = "admin_users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, nullable=False, unique=True)
    password_hash = Column(String, nullable=False)
    nombre = Column(String, nullable=True)
    rol = Column(String, nullable=False, default=RolEnum.ADMIN.value)
    activo = Column(Boolean, default=True)
    # None = usa defaults del rol. Lista de slugs para ADMINISTRACION con permisos custom.
    permisos = Column(JSON, nullable=True)
    created_at = Column(DateTime, server_default=func.now())


class PasswordResetToken(Base):
    """Token de un solo uso para restablecer contraseña (válido 1 hora)."""
    __tablename__ = "password_reset_tokens"

    id = Column(Integer, primary_key=True, index=True)
    token_hash = Column(String, nullable=False, unique=True, index=True)
    # Puede ser admin_user, seller o driver — guardamos tipo y entidad_id
    entity_type = Column(String, nullable=False)   # "admin" | "seller" | "driver"
    entity_id = Column(Integer, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())


class AuditLog(Base):
    """Registro centralizado de auditoría para todas las acciones del sistema."""
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, server_default=func.now(), index=True)
    usuario_id = Column(Integer, nullable=True)
    usuario_nombre = Column(String, nullable=True)
    usuario_rol = Column(String, nullable=True)
    ip_address = Column(String, nullable=True)
    accion = Column(String, nullable=False, index=True)
    entidad = Column(String, nullable=True, index=True)
    entidad_id = Column(Integer, nullable=True)
    cambios = Column(JSON, nullable=True)
    metadata_ = Column("metadata", JSON, nullable=True)

    # Legacy columns kept for backward compatibility with existing auth audit entries
    username = Column(String, nullable=True)
    action = Column(String, nullable=True)
    ip = Column(String, nullable=True)
    detail = Column(String, nullable=True)


class EstadoFacturaPickupEnum(str, enum.Enum):
    SIN_FACTURA = "SIN_FACTURA"
    CARGADA = "CARGADA"
    APROBADA = "APROBADA"
    RECHAZADA = "RECHAZADA"


class PagoSemanaPickup(Base):
    """Control semanal de pagos a pickups (egresos / CPP)."""
    __tablename__ = "pagos_semana_pickups"
    __table_args__ = (
        UniqueConstraint("pickup_id", "semana", "mes", "anio", name="uq_pago_semana_pickup"),
    )

    id = Column(Integer, primary_key=True, index=True)
    pickup_id = Column(Integer, ForeignKey("pickups.id"), nullable=False)
    semana = Column(Integer, nullable=False)
    mes = Column(Integer, nullable=False)
    anio = Column(Integer, nullable=False)
    monto_neto = Column(Integer, default=0)
    monto_override = Column(Integer, nullable=True)
    estado = Column(String, nullable=False, default=EstadoPagoEnum.PENDIENTE.value)
    nota = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    pickup = relationship("Pickup")


class PagoCartolaPickup(Base):
    """Pago efectivo a un pickup, importado desde cartola bancaria o registrado manualmente."""
    __tablename__ = "pagos_cartola_pickups"

    id = Column(Integer, primary_key=True, index=True)
    pickup_id = Column(Integer, ForeignKey("pickups.id"), nullable=False)
    semana = Column(Integer, nullable=False)
    mes = Column(Integer, nullable=False)
    anio = Column(Integer, nullable=False)
    monto = Column(Integer, nullable=False)
    fecha_pago = Column(String, nullable=True)
    descripcion = Column(String, nullable=True)
    fuente = Column(String, nullable=False, default="cartola")
    fingerprint = Column(String(32), nullable=True)   # MD5(fecha|monto|descripcion) — deduplicación
    carga_id = Column(Integer, ForeignKey("cartola_cargas.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    pickup = relationship("Pickup")
    carga = relationship("CartolaCarga", foreign_keys=[carga_id])


class FacturaPickup(Base):
    """Factura subida por un pickup para un período específico."""
    __tablename__ = "facturas_pickups"
    __table_args__ = (
        UniqueConstraint("pickup_id", "mes", "anio", name="uq_factura_pickup_periodo"),
    )

    id = Column(Integer, primary_key=True, index=True)
    pickup_id = Column(Integer, ForeignKey("pickups.id"), nullable=False)
    mes = Column(Integer, nullable=False)
    anio = Column(Integer, nullable=False)
    monto_neto = Column(Integer, default=0)
    archivo_nombre = Column(String, nullable=True)
    archivo_path = Column(String, nullable=True)
    estado = Column(String, nullable=False, default=EstadoFacturaPickupEnum.CARGADA.value)
    nota_pickup = Column(Text, nullable=True)
    nota_admin = Column(Text, nullable=True)
    revisado_por = Column(String, nullable=True)
    revisado_en = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    pickup = relationship("Pickup")


class EstadoFacturaDriverEnum(str, enum.Enum):
    SIN_FACTURA = "SIN_FACTURA"
    CARGADA = "CARGADA"
    APROBADA = "APROBADA"
    RECHAZADA = "RECHAZADA"


class TipoDocumentoDriverEnum(str, enum.Enum):
    FACTURA = "FACTURA"          # Factura afecta a IVA — empresa devuelve el IVA
    BOLETA  = "BOLETA"           # Boleta de honorarios — sin IVA a devolver


class FacturaDriver(Base):
    """Factura semanal subida por un driver para un período específico."""
    __tablename__ = "facturas_drivers"
    __table_args__ = (
        UniqueConstraint("driver_id", "semana", "mes", "anio", name="uq_factura_driver_periodo"),
    )

    id = Column(Integer, primary_key=True, index=True)
    driver_id = Column(Integer, ForeignKey("drivers.id"), nullable=False)
    semana = Column(Integer, nullable=False)
    mes = Column(Integer, nullable=False)
    anio = Column(Integer, nullable=False)
    archivo_nombre = Column(String, nullable=True)
    archivo_path = Column(String, nullable=True)
    estado = Column(String, nullable=False, default=EstadoFacturaDriverEnum.CARGADA.value)
    tipo_documento = Column(String, nullable=False, default=TipoDocumentoDriverEnum.FACTURA.value)
    nota_driver = Column(Text, nullable=True)
    nota_admin = Column(Text, nullable=True)
    revisado_por = Column(String, nullable=True)
    revisado_en = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    driver = relationship("Driver")


class CartolaCarga(Base):
    """Historial de cada archivo de cartola subido al sistema."""
    __tablename__ = "cartola_cargas"

    id = Column(Integer, primary_key=True, index=True)
    tipo = Column(String, nullable=False)
    archivo_nombre = Column(String, nullable=True)
    usuario_id = Column(Integer, nullable=True)
    usuario_nombre = Column(String, nullable=True)
    fecha_carga = Column(DateTime, server_default=func.now())
    mes = Column(Integer, nullable=False)
    anio = Column(Integer, nullable=False)
    total_transacciones = Column(Integer, default=0)
    matcheadas = Column(Integer, default=0)
    no_matcheadas = Column(Integer, default=0)
    monto_total = Column(Integer, default=0)
    duplicados_omitidos = Column(Integer, default=0)  # filas ignoradas por fingerprint duplicado
    detalle = Column(JSON, nullable=True)


# ── Finanzas / ERP ──


class TipoFinancieroEnum(str, enum.Enum):
    INGRESO = "INGRESO"
    EGRESO = "EGRESO"


class EstadoMovimientoEnum(str, enum.Enum):
    PENDIENTE = "PENDIENTE"
    PAGADO = "PAGADO"
    VENCIDO = "VENCIDO"


class CategoriaFinanciera(Base):
    __tablename__ = "categorias_financieras"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False)
    tipo = Column(String, nullable=False)
    parent_id = Column(Integer, ForeignKey("categorias_financieras.id"), nullable=True)
    activo = Column(Boolean, default=True)
    orden = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())

    parent = relationship("CategoriaFinanciera", remote_side="CategoriaFinanciera.id", backref="hijos")
    movimientos = relationship("MovimientoFinanciero", back_populates="categoria")


class MovimientoFinanciero(Base):
    __tablename__ = "movimientos_financieros"

    id = Column(Integer, primary_key=True, index=True)
    categoria_id = Column(Integer, ForeignKey("categorias_financieras.id"), nullable=False)
    nombre = Column(String, nullable=False)
    descripcion = Column(String, nullable=True)
    monto = Column(Integer, nullable=False)
    moneda = Column(String, default="CLP")
    mes = Column(Integer, nullable=False)
    anio = Column(Integer, nullable=False)
    fecha_vencimiento = Column(Date, nullable=True)
    fecha_pago = Column(Date, nullable=True)
    estado = Column(String, nullable=False, default=EstadoMovimientoEnum.PENDIENTE.value)
    recurrente = Column(Boolean, default=False)
    proveedor = Column(String, nullable=True)
    notas = Column(Text, nullable=True)
    documento_nombre = Column(String, nullable=True)
    documento_path = Column(String, nullable=True)
    # IVA crédito fiscal de esta compra (solo para facturas afectas).
    # NULL = sin IVA (boletas, exentos). Valor positivo = monto IVA a recuperar en F29.
    monto_iva = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    categoria = relationship("CategoriaFinanciera", back_populates="movimientos")


# ── Trabajadores ──


class Trabajador(Base):
    __tablename__ = "trabajadores"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False)
    rut = Column(String, nullable=True, unique=True)
    email = Column(String, nullable=True)
    direccion = Column(String, nullable=True)
    cargo = Column(String, nullable=True)
    sueldo_liquido = Column(Integer, nullable=False, default=0)
    sueldo_base = Column(Integer, nullable=False, default=0)
    gratificacion = Column(Integer, nullable=False, default=0)
    sueldo_bruto = Column(Integer, nullable=False, default=0)
    afp = Column(String, nullable=True)
    costo_afp = Column(Integer, nullable=False, default=0)
    sistema_salud = Column(String, nullable=True)  # FONASA / nombre Isapre
    costo_salud = Column(Integer, nullable=False, default=0)
    descuento_cesantia = Column(Integer, nullable=False, default=0)
    iusc = Column(Integer, nullable=False, default=0)
    adicional_isapre = Column(Integer, nullable=False, default=0)
    banco = Column(String, nullable=True)
    tipo_cuenta = Column(String, nullable=True)
    numero_cuenta = Column(String, nullable=True)
    fecha_ingreso = Column(Date, nullable=True)
    activo = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    movilizacion = Column(Integer, nullable=False, default=0)
    colacion = Column(Integer, nullable=False, default=0)
    viaticos = Column(Integer, nullable=False, default=0)
    tipo_contrato = Column(String, nullable=True)
    monto_cotizacion_salud = Column(String, nullable=True)

    password_hash = Column(String, nullable=True)
    firma_base64  = Column(Text,   nullable=True)

    # ── Datos personales ampliados (necesarios para contrato digital) ──────
    telefono = Column(String, nullable=True)
    whatsapp = Column(String, nullable=True)              # E.164 sin '+': 56912345678
    fecha_nacimiento = Column(Date, nullable=True)
    nacionalidad = Column(String, nullable=True)
    estado_civil = Column(String, nullable=True)          # SOLTERO/CASADO/CONVIVIENTE_CIVIL/VIUDO/DIVORCIADO

    # Años de servicio acreditados con empleadores anteriores (para feriado progresivo Art. 68 CT).
    # Tope legal: 10 años (después de 10 años trabajados se gana 1 día extra cada 3 años nuevos
    # con el empleador actual). Se acreditan con certificados.
    anios_servicio_previos = Column(Integer, nullable=False, default=0)

    # ── Control horario digital (integración ZKBioTime) ──
    # ID interno del trabajador en el software ZKBioTime (NO en el reloj físico).
    # Se vincula manualmente desde admin para que las marcas que llegan vía API
    # se asocien al trabajador correcto. Si está vacío, se ignoran sus marcas.
    zkbio_employee_id = Column(String, nullable=True, index=True)
    zkbio_employee_codigo = Column(String, nullable=True)  # "personnel code" en ZKBioTime
    # Horario esperado (para detectar atrasos / salidas anticipadas / HE).
    # Si es NULL, se usa la jornada del contrato vigente y horarios por defecto.
    hora_entrada_esperada = Column(String, nullable=True)  # "HH:MM"
    hora_salida_esperada = Column(String, nullable=True)   # "HH:MM"
    minutos_colacion = Column(Integer, nullable=False, default=60)
    # Jornada horaria predefinida (para contratos digitales)
    jornada_horaria_id = Column(Integer, ForeignKey("jornadas_horarias.id"), nullable=True)

    pagos = relationship("PagoTrabajador", back_populates="trabajador")
    pagos_mes = relationship("PagoMesTrabajador", back_populates="trabajador")
    prestamos = relationship("Prestamo", back_populates="trabajador", foreign_keys="Prestamo.trabajador_id")
    vacaciones = relationship("VacacionTrabajador", back_populates="trabajador")
    liquidaciones = relationship("LiquidacionMensual", back_populates="trabajador")


class PagoTrabajador(Base):
    """Pago efectivo a un trabajador, importado desde cartola o manual."""
    __tablename__ = "pagos_trabajadores"

    id = Column(Integer, primary_key=True, index=True)
    trabajador_id = Column(Integer, ForeignKey("trabajadores.id"), nullable=False)
    mes = Column(Integer, nullable=False)
    anio = Column(Integer, nullable=False)
    monto = Column(Integer, nullable=False)
    fecha_pago = Column(String, nullable=True)
    descripcion = Column(String, nullable=True)
    fuente = Column(String, nullable=False, default="cartola")
    created_at = Column(DateTime, server_default=func.now())

    trabajador = relationship("Trabajador", back_populates="pagos")


class PagoMesTrabajador(Base):
    """Estado mensual de pago a un trabajador. Equivalente a PagoSemanaDriver pero mensual."""
    __tablename__ = "pagos_mes_trabajadores"
    __table_args__ = (
        UniqueConstraint("trabajador_id", "mes", "anio", name="uq_pago_mes_trabajador"),
    )

    id = Column(Integer, primary_key=True, index=True)
    trabajador_id = Column(Integer, ForeignKey("trabajadores.id"), nullable=False)
    mes = Column(Integer, nullable=False)
    anio = Column(Integer, nullable=False)
    monto_bruto = Column(Integer, nullable=False, default=0)        # sueldo_bruto congelado al cerrar
    bonificaciones = Column(Integer, nullable=False, default=0)     # suma bonificaciones del mes
    descuento_cuotas = Column(Integer, nullable=False, default=0)   # suma cuotas préstamo descontadas
    descuento_ajustes = Column(Integer, nullable=False, default=0)  # suma ajustes negativos
    monto_neto = Column(Integer, nullable=False, default=0)         # monto_bruto + bonificaciones - descuentos
    monto_pagado = Column(Integer, nullable=False, default=0)       # suma acumulada de pagos efectivos realizados
    estado = Column(String, nullable=False, default="PENDIENTE")    # PENDIENTE / PARCIAL / PAGADO
    fecha_pago = Column(Date, nullable=True)
    nota = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    trabajador = relationship("Trabajador", back_populates="pagos_mes")


class EstadoVacacionEnum(str, enum.Enum):
    """
    Estados del flujo de vacaciones:
      SOLICITADA  → trabajador la pidió (firma_solicitud presente). RRHH debe aprobar/rechazar.
      APROBADA    → RRHH aprobó. Genera comprobante PDF firmado por ambos.
      RECHAZADA   → RRHH rechazó (con motivo). No descuenta saldo.
      TOMADA      → fecha_fin < hoy. Sirve para auditoría histórica.
      REGISTRO_HISTORICO → admin cargó vacación pasada (pre-sistema). Pendiente de firma del trabajador.
    """
    SOLICITADA = "SOLICITADA"
    APROBADA = "APROBADA"
    RECHAZADA = "RECHAZADA"
    TOMADA = "TOMADA"
    REGISTRO_HISTORICO = "REGISTRO_HISTORICO"


class VacacionTrabajador(Base):
    __tablename__ = "vacaciones_trabajadores"
    __table_args__ = (
        Index("ix_vac_trabajador_estado", "trabajador_id", "estado"),
        Index("ix_vac_fecha_inicio", "fecha_inicio"),
    )

    id = Column(Integer, primary_key=True, index=True)
    trabajador_id = Column(Integer, ForeignKey("trabajadores.id"), nullable=False)
    fecha_inicio = Column(Date, nullable=False)
    fecha_fin = Column(Date, nullable=False)
    dias_habiles = Column(Integer, nullable=False)
    dias_corridos = Column(Integer, nullable=True)        # informativo
    estado = Column(String, nullable=False, default=EstadoVacacionEnum.APROBADA.value)
    nota = Column(Text, nullable=True)

    # Tipo de carga
    es_retroactiva = Column(Boolean, nullable=False, default=False)  # cargada por admin de un período pasado

    # Snapshot del cálculo al momento de aprobar (auditoría)
    dias_derecho_snapshot = Column(Numeric(6, 2), nullable=True)     # incluye progresivo
    dias_progresivo_snapshot = Column(Integer, nullable=True)
    saldo_previo_snapshot = Column(Numeric(6, 2), nullable=True)     # disponible antes de tomar esta

    # ── Flujo de solicitud ────────────────────────────────────────────────────
    solicitada_at = Column(DateTime, nullable=True)
    firma_solicitud = Column(Text, nullable=True)         # base64 del trabajador al solicitar
    firma_solicitud_ip = Column(String, nullable=True)

    # ── Aprobación / rechazo ──────────────────────────────────────────────────
    aprobada_at = Column(DateTime, nullable=True)
    aprobada_por = Column(String, nullable=True)          # nombre del admin con rrhh-vacaciones:editar
    firma_aprobacion = Column(Text, nullable=True)        # base64 del aprobador
    rechazada_at = Column(DateTime, nullable=True)
    rechazada_por = Column(String, nullable=True)
    motivo_rechazo = Column(Text, nullable=True)

    # ── Firma retroactiva (registro histórico) ────────────────────────────────
    firma_retroactiva = Column(Text, nullable=True)       # base64 del trabajador conformando que tomó las vacaciones
    firma_retroactiva_at = Column(DateTime, nullable=True)
    firma_retroactiva_ip = Column(String, nullable=True)
    firma_retroactiva_solicitada_at = Column(DateTime, nullable=True)

    # ── Comprobante PDF (generado al aprobar / al firmar retroactiva) ────────
    pdf_comprobante = Column(Text, nullable=True)         # base64 del PDF

    creado_por = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    trabajador = relationship("Trabajador", back_populates="vacaciones")


class ParametrosMensuales(Base):
    """Valores oficiales UF / UTM / IMM por mes, con caché en DB."""
    __tablename__ = "parametros_mensuales"

    id = Column(Integer, primary_key=True, index=True)
    anio = Column(Integer, nullable=False)
    mes = Column(Integer, nullable=False)            # 1-12
    uf = Column(Numeric(12, 4), nullable=False)      # valor UF del período
    utm = Column(Integer, nullable=False)             # UTM del mes
    imm = Column(Integer, nullable=False)             # Ingreso Mínimo Mensual
    fuente = Column(String, nullable=True)            # 'mindicador.cl' o 'manual'
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class LiquidacionMensual(Base):
    """Liquidación de sueldo mensual — fuente única de verdad previsional."""
    __tablename__ = "liquidaciones_mensuales"
    __table_args__ = (
        UniqueConstraint("trabajador_id", "mes", "anio", name="uq_liquidacion_mensual"),
    )

    id = Column(Integer, primary_key=True, index=True)
    trabajador_id = Column(Integer, ForeignKey("trabajadores.id"), nullable=False)
    mes = Column(Integer, nullable=False)
    anio = Column(Integer, nullable=False)
    parametros_id = Column(Integer, ForeignKey("parametros_mensuales.id"), nullable=True)

    # Snapshot congelado al momento de generación
    sueldo_base = Column(Integer, nullable=False, default=0)
    gratificacion = Column(Integer, nullable=False, default=0)
    movilizacion = Column(Integer, nullable=False, default=0)
    colacion = Column(Integer, nullable=False, default=0)
    viaticos = Column(Integer, nullable=False, default=0)
    # Horas extras (Art. 32) — se suman al imponible
    horas_extras_50_cantidad = Column(Numeric(6, 2), nullable=False, default=0)
    horas_extras_100_cantidad = Column(Numeric(6, 2), nullable=False, default=0)
    horas_extras_50_monto = Column(Integer, nullable=False, default=0)
    horas_extras_100_monto = Column(Integer, nullable=False, default=0)
    horas_extras_monto = Column(Integer, nullable=False, default=0)
    valor_hora_usado = Column(Integer, nullable=False, default=0)
    jornada_semanal_usada = Column(Integer, nullable=False, default=44)

    remuneracion_imponible = Column(Integer, nullable=False, default=0)
    descuento_afp = Column(Integer, nullable=False, default=0)
    descuento_salud_legal = Column(Integer, nullable=False, default=0)
    adicional_isapre = Column(Integer, nullable=False, default=0)
    descuento_cesantia = Column(Integer, nullable=False, default=0)
    iusc = Column(Integer, nullable=False, default=0)
    total_descuentos = Column(Integer, nullable=False, default=0)
    sueldo_liquido = Column(Integer, nullable=False, default=0)

    # Aportes empleador (informativos)
    costo_sis = Column(Integer, nullable=False, default=0)
    costo_cesantia_empleador = Column(Integer, nullable=False, default=0)
    costo_mutual = Column(Integer, nullable=False, default=0)
    costo_empresa_total = Column(Integer, nullable=False, default=0)

    # Parámetros congelados usados en el cálculo
    uf_usada = Column(Numeric(12, 4), nullable=True)
    utm_usado = Column(Integer, nullable=True)
    imm_usado = Column(Integer, nullable=True)

    # Estado de ciclo de vida
    estado = Column(String, nullable=False, default="BORRADOR")  # BORRADOR / EMITIDA / MODIFICACION_PENDIENTE / APROBADA / PAGADA
    pago_mes_id = Column(Integer, ForeignKey("pagos_mes_trabajadores.id"), nullable=True)

    # ── Adelantos automáticos desde CPC (conductor contratado) ───────────────
    # Suma de los PagoSemanaDriver PAGADOS del mes para drivers con contratado=True.
    # Se importa automáticamente al generar la liquidación y se recalcula al emitir.
    # Aparece como "Adelanto de remuneración ya pagado" en la liquidación impresa.
    adelantos_cpc = Column(Integer, nullable=False, default=0)
    adelantos_cpc_detalle = Column(JSON, nullable=True)          # [{semana, monto, fecha_pago}]

    # Comisiones importadas desde CPC (remuneración variable imponible)
    # Para conductor contratado: equivale al total de entregas × $500 del mes.
    comisiones_cpc = Column(Integer, nullable=False, default=0)

    # ── Auditoría de modificaciones post-emisión ────────────────────────────
    modificada_por = Column(String, nullable=True)               # username del modificador
    modificada_at = Column(DateTime, nullable=True)
    motivo_modificacion = Column(Text, nullable=True)
    diff_modificacion = Column(JSON, nullable=True)              # {campo: {antes, despues}}
    revisada_por_admin = Column(String, nullable=True)
    revisada_at = Column(DateTime, nullable=True)
    resultado_revision = Column(String, nullable=True)           # APROBADA / REVERTIDA

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    trabajador = relationship("Trabajador", back_populates="liquidaciones")
    parametros = relationship("ParametrosMensuales")


# ── Préstamos ──


class EstadoPrestamoEnum(str, enum.Enum):
    ACTIVO = "ACTIVO"
    PAGADO = "PAGADO"
    CANCELADO = "CANCELADO"


class TipoBeneficiarioEnum(str, enum.Enum):
    TRABAJADOR = "TRABAJADOR"
    DRIVER = "DRIVER"


class Prestamo(Base):
    __tablename__ = "prestamos"

    id = Column(Integer, primary_key=True, index=True)
    tipo_beneficiario = Column(String, nullable=False)  # TRABAJADOR / DRIVER
    trabajador_id = Column(Integer, ForeignKey("trabajadores.id"), nullable=True)
    driver_id = Column(Integer, ForeignKey("drivers.id"), nullable=True)
    monto_total = Column(Integer, nullable=False)
    monto_cuota = Column(Integer, nullable=False)
    saldo_pendiente = Column(Integer, nullable=False)
    modalidad = Column(String, nullable=False, default="cuota_fija")  # cuota_fija / porcentaje / unico
    porcentaje = Column(Integer, nullable=True)
    mes_inicio = Column(Integer, nullable=False)
    anio_inicio = Column(Integer, nullable=False)
    motivo = Column(String, nullable=True)
    estado = Column(String, nullable=False, default=EstadoPrestamoEnum.ACTIVO.value)
    created_at = Column(DateTime, server_default=func.now())

    trabajador = relationship("Trabajador", back_populates="prestamos", foreign_keys=[trabajador_id])
    driver = relationship("Driver")
    cuotas = relationship("CuotaPrestamo", back_populates="prestamo", order_by="CuotaPrestamo.mes, CuotaPrestamo.anio")


class CuotaPrestamo(Base):
    __tablename__ = "cuotas_prestamos"

    id = Column(Integer, primary_key=True, index=True)
    prestamo_id = Column(Integer, ForeignKey("prestamos.id"), nullable=False)
    mes = Column(Integer, nullable=False)
    anio = Column(Integer, nullable=False)
    monto = Column(Integer, nullable=False)
    pagado = Column(Boolean, default=False)
    fecha_pago = Column(Date, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    prestamo = relationship("Prestamo", back_populates="cuotas")


# ── IVA Drivers ──


class EstadoPagoIVAEnum(str, enum.Enum):
    PENDIENTE = "PENDIENTE"
    PAGADO = "PAGADO"
    PARCIAL = "PARCIAL"


class PagoIVADriver(Base):
    """Deuda de IVA por driver por mes de facturación. 1 registro por driver/mes."""
    __tablename__ = "pagos_iva_drivers"
    __table_args__ = (
        UniqueConstraint("driver_id", "mes_origen", "anio_origen", name="uq_pago_iva_driver"),
    )

    id = Column(Integer, primary_key=True, index=True)
    driver_id = Column(Integer, ForeignKey("drivers.id"), nullable=False)
    mes_origen = Column(Integer, nullable=False)
    anio_origen = Column(Integer, nullable=False)
    estado = Column(String, nullable=False, default=EstadoPagoIVAEnum.PENDIENTE.value)
    # Snapshots congelados al momento del pago (trazabilidad F29)
    base_iva_snapshot = Column(Integer, nullable=True)
    monto_iva_snapshot = Column(Integer, nullable=True)
    facturas_incluidas = Column(JSON, nullable=True)   # [factura_id, ...]
    fecha_pago = Column(Date, nullable=True)
    nota = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    driver = relationship("Driver")
    pagos_cartola = relationship("PagoCartolaIVA", back_populates="pago_iva")


class PagoCartolaIVA(Base):
    """Transferencias reales de IVA a drivers. Separado de PagoCartola para no inflar CPC semanal."""
    __tablename__ = "pagos_cartola_iva"

    id = Column(Integer, primary_key=True, index=True)
    pago_iva_driver_id = Column(Integer, ForeignKey("pagos_iva_drivers.id"), nullable=False)
    driver_id = Column(Integer, ForeignKey("drivers.id"), nullable=False)
    mes = Column(Integer, nullable=False)
    anio = Column(Integer, nullable=False)
    monto = Column(Integer, nullable=False)
    fecha_pago = Column(String, nullable=True)
    descripcion = Column(String, nullable=True)
    fuente = Column(String, nullable=False, default="cartola")   # cartola | manual
    fingerprint = Column(String, nullable=True, unique=True)
    carga_id = Column(Integer, ForeignKey("cartola_cargas.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    pago_iva = relationship("PagoIVADriver", back_populates="pagos_cartola")
    driver = relationship("Driver")


# ── Colaboradores ──


class EstadoBoletaColaboradorEnum(str, enum.Enum):
    PENDIENTE = "PENDIENTE"
    APROBADA = "APROBADA"
    RECHAZADA = "RECHAZADA"
    PAGADA = "PAGADA"


class Colaborador(Base):
    __tablename__ = "colaboradores"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False)
    rut = Column(String, nullable=True)
    email = Column(String, unique=True, nullable=True)
    telefono = Column(String, nullable=True)
    especialidad = Column(String, nullable=True)
    tags = Column(JSON, default=list)

    banco = Column(String, nullable=True)
    tipo_cuenta = Column(String, nullable=True)
    numero_cuenta = Column(String, nullable=True)

    descripcion_servicio = Column(Text, nullable=True)
    monto_acordado = Column(Integer, nullable=True)
    frecuencia_pago = Column(String, default="mensual")
    fecha_inicio = Column(Date, nullable=True)
    fecha_fin = Column(Date, nullable=True)
    activo = Column(Boolean, default=True)

    cuenta_contable_id = Column(Integer, ForeignKey("cuentas_contables.id"), nullable=True)
    categoria_financiera_id = Column(Integer, ForeignKey("categorias_financieras.id"), nullable=True)

    password_hash = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    cuenta_contable = relationship("CuentaContable")
    categoria_financiera = relationship("CategoriaFinanciera")
    boletas = relationship("BoletaColaborador", back_populates="colaborador")
    pagos_mes = relationship("PagoMesColaborador", back_populates="colaborador")


class BoletaColaborador(Base):
    __tablename__ = "boletas_colaboradores"

    id = Column(Integer, primary_key=True, index=True)
    colaborador_id = Column(Integer, ForeignKey("colaboradores.id"), nullable=False)
    mes = Column(Integer, nullable=False)
    anio = Column(Integer, nullable=False)
    concepto = Column(String, nullable=True)
    numero_boleta = Column(String, nullable=True)
    monto = Column(Integer, nullable=False, default=0)
    archivo_nombre = Column(String, nullable=True)
    archivo_path = Column(String, nullable=True)
    estado = Column(String, nullable=False, default=EstadoBoletaColaboradorEnum.PENDIENTE.value)
    nota_colaborador = Column(Text, nullable=True)
    nota_admin = Column(Text, nullable=True)
    revisado_por = Column(String, nullable=True)
    revisado_en = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    colaborador = relationship("Colaborador", back_populates="boletas")


class PagoMesColaborador(Base):
    __tablename__ = "pagos_mes_colaboradores"
    __table_args__ = (
        UniqueConstraint("colaborador_id", "mes", "anio", name="uq_pago_mes_colaborador"),
    )

    id = Column(Integer, primary_key=True, index=True)
    colaborador_id = Column(Integer, ForeignKey("colaboradores.id"), nullable=False)
    mes = Column(Integer, nullable=False)
    anio = Column(Integer, nullable=False)
    monto_esperado = Column(Integer, nullable=False, default=0)
    monto_boleta = Column(Integer, nullable=False, default=0)
    estado = Column(String, nullable=False, default="PENDIENTE_BOLETA")
    boleta_id = Column(Integer, ForeignKey("boletas_colaboradores.id"), nullable=True)
    fecha_pago = Column(Date, nullable=True)
    nota = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    colaborador = relationship("Colaborador", back_populates="pagos_mes")
    boleta = relationship("BoletaColaborador")


# ── GL: Contabilidad de Partida Doble ──


class TipoCuentaEnum(str, enum.Enum):
    ACTIVO = "ACTIVO"
    PASIVO = "PASIVO"
    PATRIMONIO = "PATRIMONIO"
    INGRESO = "INGRESO"
    GASTO = "GASTO"


class CuentaContable(Base):
    __tablename__ = "cuentas_contables"

    id = Column(Integer, primary_key=True, index=True)
    codigo = Column(String, nullable=False, unique=True)
    nombre = Column(String, nullable=False)
    tipo = Column(String, nullable=False)
    parent_id = Column(Integer, ForeignKey("cuentas_contables.id"), nullable=True)
    categoria_financiera_id = Column(Integer, ForeignKey("categorias_financieras.id"), nullable=True)
    activo = Column(Boolean, default=True)
    orden = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())

    parent = relationship("CuentaContable", remote_side="CuentaContable.id", backref="subcuentas")
    categoria_financiera = relationship("CategoriaFinanciera")
    lineas = relationship("LineaAsiento", back_populates="cuenta")


class AsientoContable(Base):
    __tablename__ = "asientos_contables"
    __table_args__ = (
        UniqueConstraint("ref_tipo", "ref_id", name="uq_asiento_ref"),
        Index("ix_asiento_fecha_periodo", "fecha", "mes", "anio"),
    )

    id = Column(Integer, primary_key=True, index=True)
    fecha = Column(Date, nullable=False)
    descripcion = Column(String, nullable=False)
    ref_tipo = Column(String, nullable=False)
    ref_id = Column(Integer, nullable=False)
    mes = Column(Integer, nullable=False)
    anio = Column(Integer, nullable=False)
    es_backfill = Column(Boolean, default=False)
    creado_por = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    lineas = relationship("LineaAsiento", back_populates="asiento", cascade="all, delete-orphan")


class LineaAsiento(Base):
    __tablename__ = "lineas_asientos"
    __table_args__ = (
        Index("ix_linea_asiento_cuenta", "asiento_id", "cuenta_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    asiento_id = Column(Integer, ForeignKey("asientos_contables.id", ondelete="CASCADE"), nullable=False)
    cuenta_id = Column(Integer, ForeignKey("cuentas_contables.id"), nullable=False)
    debe = Column(Integer, default=0)
    haber = Column(Integer, default=0)
    glosa = Column(String, nullable=True)

    asiento = relationship("AsientoContable", back_populates="lineas")
    cuenta = relationship("CuentaContable", back_populates="lineas")


class GrokAnalisis(Base):
    __tablename__ = "grok_analisis"

    id = Column(Integer, primary_key=True, index=True)
    titulo = Column(Text, nullable=False)
    pregunta = Column(Text, nullable=False)
    respuesta = Column(Text, nullable=False)
    contextos = Column(JSON, default=list)
    mes = Column(Integer)
    anio = Column(Integer)
    tab = Column(String(50))
    tokens_total = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)


class GrokBrief(Base):
    """Descripción estática del negocio que se inyecta como system prompt en cada sesión."""
    __tablename__ = "grok_brief"

    id = Column(Integer, primary_key=True, index=True)
    contenido = Column(Text, nullable=False, default="")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class GrokSnapshot(Base):
    """Snapshot financiero semanal auto-generado desde la DB para contexto de sesión."""
    __tablename__ = "grok_snapshot"

    id = Column(Integer, primary_key=True, index=True)
    contenido = Column(Text, nullable=False, default="")
    generado_en = Column(DateTime, default=datetime.utcnow)
    tokens_aprox = Column(Integer, default=0)


class GrokMemoria(Base):
    """Memoria anual completa: sellers, drivers, P&L mensual por año. Generada una vez."""
    __tablename__ = "grok_memoria"

    id = Column(Integer, primary_key=True, index=True)
    anio = Column(Integer, nullable=False, unique=True)
    contenido = Column(Text, nullable=False, default="")
    tokens_aprox = Column(Integer, default=0)
    generado_en = Column(DateTime, default=datetime.utcnow)


class GestionComercialEntry(Base):
    """Log liviano de gestión comercial por seller (CRM mínimo)."""
    __tablename__ = "gestion_comercial"

    id = Column(Integer, primary_key=True, index=True)
    seller_id = Column(Integer, ForeignKey("sellers.id"), nullable=False, index=True)
    fecha = Column(Date, nullable=False, default=date.today)
    usuario = Column(String(100), nullable=True)       # nombre del usuario que registra
    tipo = Column(String(50), nullable=False)           # llamada | email | reunion | whatsapp | visita | interno | otro
    estado = Column(String(50), nullable=True)          # en_gestion | activo | recuperado | perdido | en_pausa | seguimiento
    razon = Column(String(100), nullable=True)          # precios | servicio | cierre_negocio | estacional | geografico | comunicacion | otro
    nota = Column(Text, nullable=True)
    recordatorio = Column(Date, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class TareaPendiente(Base):
    """Bandeja de tareas pendientes generadas automática o manualmente."""
    __tablename__ = "tareas_pendientes"

    id = Column(Integer, primary_key=True, index=True)
    tipo = Column(String(50), nullable=False)
    # validar_perdido | contactar_riesgo | seguimiento_crm | factura_vencida | tier_cambio | manual
    severidad = Column(String(20), default="alerta")   # critico | alerta | info
    seller_id = Column(Integer, ForeignKey("sellers.id"), nullable=True, index=True)
    titulo = Column(String(200), nullable=False)
    descripcion = Column(Text, nullable=True)
    estado = Column(String(20), default="pendiente")   # pendiente | resuelta | descartada
    resuelta_por = Column(String(100), nullable=True)
    fecha_creacion = Column(DateTime, default=datetime.utcnow)
    fecha_resolucion = Column(DateTime, nullable=True)
    datos = Column(JSON, default=dict)                 # contexto adicional (monto, meses, etc.)


class SellerSnapshot(Base):
    """Snapshot diario del estado consolidado de cada seller."""
    __tablename__ = "seller_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    seller_id = Column(Integer, ForeignKey("sellers.id"), nullable=False, index=True)
    fecha = Column(Date, nullable=False)
    estado_efectivo = Column(String(50), nullable=True)
    estado_operativo = Column(String(50), nullable=True)
    estado_crm = Column(String(50), nullable=True)
    tipo_cierre = Column(String(20), nullable=True)
    tier = Column(String(20), nullable=True)
    vol_mes = Column(Integer, default=0)
    ingreso_mes = Column(Integer, default=0)
    semanas_sin_actividad = Column(Integer, default=0)
    datos = Column(JSON, default=dict)


class WhatsAppTemplate(Base):
    """Plantillas de mensajes para envíos masivos por WhatsApp."""
    __tablename__ = "wa_templates"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(100), nullable=False)
    categoria = Column(String(50), default="marketing")  # marketing | utility | authentication
    idioma = Column(String(10), default="es_CL")
    cuerpo = Column(Text, nullable=False)                # texto con {{1}}, {{2}}, etc.
    variables = Column(JSON, default=list)               # nombres descriptivos
    wa_template_name = Column(String(100), nullable=True)  # nombre aprobado en Meta
    activo = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class WhatsAppEnvio(Base):
    """Registro de un envío masivo de WhatsApp."""
    __tablename__ = "wa_envios"

    id = Column(Integer, primary_key=True, index=True)
    nombre_campaña = Column(String(200), nullable=True)
    template_id = Column(Integer, ForeignKey("wa_templates.id"), nullable=False)
    segmento = Column(String(50), nullable=False)        # todos | tier_epico | en_riesgo | manual
    seller_ids = Column(JSON, default=list)              # para segmento=manual
    variables_valores = Column(JSON, default=dict)       # valores de las variables
    estado = Column(String(20), default="pendiente")     # pendiente | enviando | completado | error
    total = Column(Integer, default=0)
    enviados = Column(Integer, default=0)
    errores = Column(Integer, default=0)
    leidos = Column(Integer, default=0)
    respondidos = Column(Integer, default=0)
    fecha_inicio = Column(DateTime, nullable=True)
    fecha_fin = Column(DateTime, nullable=True)


class WhatsAppMensaje(Base):
    """Registro individual de cada mensaje enviado en un envío masivo."""
    __tablename__ = "wa_mensajes"

    id = Column(Integer, primary_key=True, index=True)
    envio_id = Column(Integer, ForeignKey("wa_envios.id"), nullable=False, index=True)
    seller_id = Column(Integer, ForeignKey("sellers.id"), nullable=True, index=True)
    numero = Column(String(20), nullable=False)
    wa_message_id = Column(String(100), nullable=True, index=True)
    estado = Column(String(20), default="pendiente")     # pendiente | enviado | entregado | leido | respondido | error
    leido = Column(Boolean, default=False)
    respondido = Column(Boolean, default=False)
    respuesta = Column(Text, nullable=True)
    error = Column(Text, nullable=True)
    enviado_at = Column(DateTime, default=datetime.utcnow)


# ── Leads WhatsApp ────────────────────────────────────────────────────────────

class EtapaLeadEnum(str, enum.Enum):
    NUEVO = "nuevo"
    IA_GESTIONANDO = "ia_gestionando"
    CALIFICADO = "calificado"
    REQUIERE_HUMANO = "requiere_humano"
    CONTACTADO = "contactado"
    PROPUESTA = "propuesta"
    GANADO = "ganado"
    PERDIDO = "perdido"


class TemperaturaLeadEnum(str, enum.Enum):
    FRIO = "frio"
    TIBIO = "tibio"
    CALIENTE = "caliente"


class Lead(Base):
    __tablename__ = "leads"

    id = Column(Integer, primary_key=True, index=True)
    phone = Column(String(20), unique=True, nullable=False, index=True)
    nombre = Column(String(200), nullable=True)
    email = Column(String(200), nullable=True)
    origen = Column(String(50), default="directo")  # sitio_web | referido | directo | redes | otro

    # Calificación comercial (llenada por la IA progresivamente)
    negocio = Column(String(200), nullable=True)
    canal_venta = Column(String(100), nullable=True)
    volumen_estimado = Column(String(100), nullable=True)
    ubicacion = Column(String(200), nullable=True)
    intencion = Column(String(100), nullable=True)  # precio | cobertura | servicio | integracion | otro

    # Pipeline
    etapa = Column(String(30), default=EtapaLeadEnum.NUEVO.value, index=True)
    temperatura = Column(String(20), default=TemperaturaLeadEnum.FRIO.value)
    resumen_ia = Column(Text, nullable=True)
    asignado_a = Column(String(100), nullable=True)
    notas_humano = Column(Text, nullable=True)
    tags = Column(JSON, default=list)
    seller_id = Column(Integer, ForeignKey("sellers.id"), nullable=True)

    # Estado conversacional (máquina de estados)
    estado_conversacion = Column(String(30), default="saludo")  # saludo | intencion | calificacion | resolucion | cierre
    interacciones_ia = Column(Integer, default=0)
    gestionado_por = Column(String(10), default="ia")  # ia | humano | mixto

    # Ventana 24h y actividad
    ventana_24h_expira = Column(DateTime, nullable=True)
    ultimo_mensaje_lead = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    mensajes = relationship("MensajeLead", back_populates="lead", order_by="MensajeLead.timestamp")


class MensajeLead(Base):
    __tablename__ = "mensajes_leads"

    id = Column(Integer, primary_key=True, index=True)
    lead_id = Column(Integer, ForeignKey("leads.id"), nullable=False, index=True)
    direccion = Column(String(10), nullable=False)  # inbound | outbound
    autor = Column(String(10), nullable=False)       # lead | ia | humano
    contenido = Column(Text, nullable=False)
    tipo_contenido = Column(String(20), default="texto")  # texto | audio | imagen | documento | sticker
    wa_message_id = Column(String(100), nullable=True, index=True)
    estado_wa = Column(String(20), nullable=True)  # enviado | entregado | leido | error
    meta_datos = Column(JSON, nullable=True)  # tool calls, razón escalada, etc.
    timestamp = Column(DateTime, default=datetime.utcnow)

    lead = relationship("Lead", back_populates="mensajes")


class ConocimientoAgente(Base):
    __tablename__ = "conocimiento_agente"

    id = Column(Integer, primary_key=True, index=True)
    categoria = Column(String(50), nullable=False, index=True)  # empresa | servicios | tarifas | cobertura | integraciones | faq | objeciones
    titulo = Column(String(200), nullable=False)
    contenido = Column(Text, nullable=False)
    keywords = Column(JSON, default=list)
    activo = Column(Boolean, default=True)
    orden = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class NotificacionComercial(Base):
    __tablename__ = "notificaciones_comerciales"

    id = Column(Integer, primary_key=True, index=True)
    lead_id = Column(Integer, ForeignKey("leads.id"), nullable=False, index=True)
    tipo = Column(String(30), nullable=False)  # lead_nuevo | requiere_humano | ventana_expirando | sin_actividad_24h | sin_actividad_3d | sin_actividad_7d | lead_reactivado | agente_error
    titulo = Column(String(200), nullable=False)
    detalle = Column(Text, nullable=True)
    prioridad = Column(String(10), default="normal")  # normal | alta | urgente
    leida = Column(Boolean, default=False)
    accion_url = Column(String(200), nullable=True)  # wa.me link o ruta interna
    created_at = Column(DateTime, default=datetime.utcnow)


# ── Gestión contractual del trabajador (versionado + horas extras + anexos) ──


class TipoJornadaEnum(str, enum.Enum):
    COMPLETA = "COMPLETA"           # > 30 hrs/sem
    PARCIAL = "PARCIAL"             # ≤ 30 hrs/sem (Art. 40 bis)
    EXCEPCIONAL = "EXCEPCIONAL"     # turnos / sistemas excepcionales DT


class MotivoVersionContratoEnum(str, enum.Enum):
    CONTRATACION = "CONTRATACION"
    AUMENTO_SUELDO = "AUMENTO_SUELDO"
    REDUCCION_JORNADA = "REDUCCION_JORNADA"
    ADECUACION_JORNADA_LEGAL = "ADECUACION_JORNADA_LEGAL"
    REAJUSTE_IMM = "REAJUSTE_IMM"
    CAMBIO_CARGO = "CAMBIO_CARGO"
    CAMBIO_ASIGNACIONES = "CAMBIO_ASIGNACIONES"
    PASE_INDEFINIDO = "PASE_INDEFINIDO"
    AJUSTE_CESANTIA = "AJUSTE_CESANTIA"
    RENOVACION = "RENOVACION"
    OTRO = "OTRO"


class ContratoTrabajadorVersion(Base):
    """
    Versión inmutable de las condiciones contractuales de un trabajador.
    Cada cambio de sueldo, jornada, cargo o asignaciones genera una nueva versión.
    Es la fuente de verdad histórica para auditorías, reajustes IMM y horas extras.
    """
    __tablename__ = "contrato_trabajador_versiones"
    __table_args__ = (
        Index("ix_contrato_trab_vigencia", "trabajador_id", "vigente_desde"),
    )

    id = Column(Integer, primary_key=True, index=True)
    trabajador_id = Column(Integer, ForeignKey("trabajadores.id"), nullable=False, index=True)

    vigente_desde = Column(Date, nullable=False)
    vigente_hasta = Column(Date, nullable=True)  # NULL = vigente

    # Condiciones económicas
    sueldo_liquido = Column(Integer, nullable=False, default=0)
    sueldo_base = Column(Integer, nullable=False, default=0)
    gratificacion = Column(Integer, nullable=False, default=0)
    movilizacion = Column(Integer, nullable=False, default=0)
    colacion = Column(Integer, nullable=False, default=0)
    viaticos = Column(Integer, nullable=False, default=0)

    # Condiciones de jornada
    jornada_semanal_horas = Column(Integer, nullable=False, default=44)
    tipo_jornada = Column(String, nullable=False, default=TipoJornadaEnum.COMPLETA.value)
    distribucion_jornada = Column(String, nullable=True)  # LUNES_VIERNES / LUNES_SABADO / TURNOS / OTRO

    # Otros datos contractuales
    cargo = Column(String, nullable=True)
    tipo_contrato = Column(String, nullable=True)  # INDEFINIDO / PLAZO_FIJO / OBRA_FAENA / HONORARIOS

    # ── Plazo fijo: datos de periodo ──────────────────────────────────────────
    fecha_inicio_periodo = Column(Date, nullable=True)    # inicio del periodo pactado
    fecha_termino_periodo = Column(Date, nullable=True)   # NULL = indefinido
    duracion_meses = Column(Integer, nullable=True)       # para renovar por mismo periodo
    numero_renovacion = Column(Integer, nullable=False, default=0)  # 0=original, 1=1ª renovación, 2=2ª
    version_padre_id = Column(Integer, ForeignKey("contrato_trabajador_versiones.id"), nullable=True)
    origen = Column(String, nullable=False, default="MANUAL")  # MANUAL / RENOVACION_AUTOMATICA / CONVERSION_AUTOMATICA_INDEFINIDO

    # Trazabilidad
    motivo = Column(String, nullable=False, default=MotivoVersionContratoEnum.CONTRATACION.value)
    notas = Column(Text, nullable=True)
    creado_por = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    trabajador = relationship("Trabajador")
    version_padre = relationship("ContratoTrabajadorVersion", remote_side="ContratoTrabajadorVersion.id", foreign_keys=[version_padre_id])
    anexos = relationship(
        "AnexoContrato",
        back_populates="version",
        cascade="all, delete-orphan",
    )


class TipoAnexoEnum(str, enum.Enum):
    CONTRATO_INICIAL = "CONTRATO_INICIAL"   # PDF físico digitalizado de la contratación original
    AUMENTO_SUELDO = "AUMENTO_SUELDO"
    REDUCCION_JORNADA = "REDUCCION_JORNADA"
    ADECUACION_JORNADA_LEGAL = "ADECUACION_JORNADA_LEGAL"
    REAJUSTE_IMM = "REAJUSTE_IMM"
    CAMBIO_CARGO = "CAMBIO_CARGO"
    CAMBIO_ASIGNACIONES = "CAMBIO_ASIGNACIONES"
    PASE_INDEFINIDO = "PASE_INDEFINIDO"              # Cambio de plazo fijo → indefinido
    AJUSTE_SEGURO_CESANTIA = "AJUSTE_SEGURO_CESANTIA"  # Alza de base por cotización cesantía
    RENOVACION_PLAZO_FIJO = "RENOVACION_PLAZO_FIJO"  # Nueva versión por renovación
    TERMINO_CONTRATO = "TERMINO_CONTRATO"            # Solo para PLAZO_FIJO; con fecha_efectiva
    OTRO = "OTRO"


class EstadoAnexoEnum(str, enum.Enum):
    BORRADOR = "BORRADOR"
    EMITIDO = "EMITIDO"           # Generado, esperando firma del trabajador
    INFORMATIVO = "INFORMATIVO"   # No requiere firma (ej. reajuste IMM); queda como notificación
    FIRMADO = "FIRMADO"
    RECHAZADO = "RECHAZADO"


class AnexoContrato(Base):
    """
    Anexo contractual generado (o subido) ligado a una versión del contrato.
    Si requiere firma del trabajador, queda visible en su portal hasta que firme.
    """
    __tablename__ = "anexos_contrato"

    id = Column(Integer, primary_key=True, index=True)
    trabajador_id = Column(Integer, ForeignKey("trabajadores.id"), nullable=False, index=True)
    version_id = Column(Integer, ForeignKey("contrato_trabajador_versiones.id"), nullable=True)
    tipo = Column(String, nullable=False)
    titulo = Column(String, nullable=False)

    # PDF: o se generó por el motor (pdf_generado) o se subió físico (pdf_subido_path)
    pdf_generado = Column(Text, nullable=True)        # base64 (PDF generado por anexos_engine)
    pdf_subido_path = Column(String, nullable=True)   # path en disco para PDFs subidos

    requiere_firma_trabajador = Column(Boolean, nullable=False, default=True)
    estado = Column(String, nullable=False, default=EstadoAnexoEnum.BORRADOR.value)

    # Firma capturada al momento (snapshot)
    firma_trabajador_snapshot = Column(Text, nullable=True)  # base64
    firmado_at = Column(DateTime, nullable=True)
    firmado_ip = Column(String, nullable=True)

    visto_at = Column(DateTime, nullable=True)
    creado_por = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # Camino B (contrato digital generado): trazabilidad de la plantilla usada
    plantilla_id = Column(Integer, ForeignKey("plantillas_contrato.id"), nullable=True)
    plantilla_version = Column(Integer, nullable=True)
    contenido_renderizado = Column(Text, nullable=True)              # markdown final
    aprobado_por = Column(String, nullable=True)
    aprobado_at = Column(DateTime, nullable=True)

    # Para TERMINO_CONTRATO: fecha en que surte efecto (puede agendarse antes)
    fecha_efectiva = Column(Date, nullable=True)

    version = relationship("ContratoTrabajadorVersion", back_populates="anexos")
    trabajador = relationship("Trabajador")


# ── Cola de eventos programados (vencimientos, alertas, conversiones) ─────────

class TipoEventoContratoEnum(str, enum.Enum):
    ALERTA_VENCIMIENTO_30D = "ALERTA_VENCIMIENTO_30D"
    ALERTA_VENCIMIENTO_15D = "ALERTA_VENCIMIENTO_15D"
    ALERTA_VENCIMIENTO_7D  = "ALERTA_VENCIMIENTO_7D"
    EJECUTAR_VENCIMIENTO   = "EJECUTAR_VENCIMIENTO"   # día T0: renovar / convertir / terminar


class EstadoEventoContratoEnum(str, enum.Enum):
    PENDIENTE  = "PENDIENTE"
    EJECUTADO  = "EJECUTADO"
    CANCELADO  = "CANCELADO"   # admin tomó acción manual antes del trigger


class EventoContratoProgramado(Base):
    """
    Cola de tiempo para el job diario de contratos.
    Cada versión de plazo fijo genera hasta 4 eventos (T-30, T-15, T-7, T0).
    Idempotente: el job marca EJECUTADO y no reprocesa.
    """
    __tablename__ = "eventos_contrato_programados"
    __table_args__ = (
        Index("ix_evento_contrato_fecha", "ejecutar_en", "estado"),
        UniqueConstraint("version_id", "tipo", name="uq_evento_version_tipo"),
    )

    id = Column(Integer, primary_key=True, index=True)
    trabajador_id = Column(Integer, ForeignKey("trabajadores.id"), nullable=False, index=True)
    version_id = Column(Integer, ForeignKey("contrato_trabajador_versiones.id"), nullable=False)
    tipo = Column(String, nullable=False)   # TipoEventoContratoEnum
    ejecutar_en = Column(Date, nullable=False)
    estado = Column(String, nullable=False, default=EstadoEventoContratoEnum.PENDIENTE.value)
    resultado_anexo_id = Column(Integer, ForeignKey("anexos_contrato.id"), nullable=True)
    notas = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    trabajador = relationship("Trabajador")
    version = relationship("ContratoTrabajadorVersion")


# ── Certificados del trabajador/driver ────────────────────────────────────────

class TipoCertificadoEnum(str, enum.Enum):
    AFP              = "AFP"
    SALUD            = "SALUD"              # FONASA o Isapre
    CARNET_FRONTAL   = "CARNET_FRONTAL"
    CARNET_TRASERO   = "CARNET_TRASERO"
    DOMICILIO        = "DOMICILIO"
    ANTECEDENTES     = "ANTECEDENTES"       # Renovable 1x/año, no bloquea
    LICENCIA_CONDUCIR = "LICENCIA_CONDUCIR" # Solo drivers


class EstadoCertificadoEnum(str, enum.Enum):
    PENDIENTE  = "PENDIENTE"   # nunca subido
    CARGADO    = "CARGADO"     # subido, en revisión
    APROBADO   = "APROBADO"
    RECHAZADO  = "RECHAZADO"   # admin rechazó, requiere resubida
    VENCIDO    = "VENCIDO"     # expiró (calculado, no almacenado directamente)


class CertificadoTrabajador(Base):
    """
    Certificado subido por un trabajador o driver.
    Un trabajador puede tener múltiples versiones de un tipo (historial), pero
    solo uno activo (el más reciente APROBADO o el CARGADO en revisión).
    """
    __tablename__ = "certificados_trabajador"
    __table_args__ = (
        Index("ix_cert_trab_tipo", "trabajador_id", "tipo"),
    )

    id = Column(Integer, primary_key=True, index=True)
    trabajador_id = Column(Integer, ForeignKey("trabajadores.id"), nullable=False, index=True)
    driver_id = Column(Integer, ForeignKey("drivers.id"), nullable=True, index=True)  # si es conductor

    tipo = Column(String, nullable=False)   # TipoCertificadoEnum
    archivo_path = Column(String, nullable=True)
    mime_type = Column(String, nullable=True)
    nombre_archivo = Column(String, nullable=True)

    fecha_emision = Column(Date, nullable=True)       # fecha del documento
    fecha_vencimiento = Column(Date, nullable=True)   # para antecedentes (90 días), licencia, etc.

    estado = Column(String, nullable=False, default=EstadoCertificadoEnum.PENDIENTE.value)
    nota_admin = Column(Text, nullable=True)
    revisado_por = Column(String, nullable=True)
    revisado_at = Column(DateTime, nullable=True)

    creado_por = Column(String, nullable=True)   # "TRABAJADOR" | nombre admin
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    trabajador = relationship("Trabajador")


# ── Snapshot de costo de despido (indemnización acumulada) ────────────────────

class CostoDespidoSnapshot(Base):
    """
    Snapshot mensual del costo estimado de despido de un trabajador.
    Calculado según Arts. 161/163 CT (1 mes por año, tope 330 UF) más
    feriado proporcional (Art. 73 CT) y mes de aviso (Art. 162 CT).
    """
    __tablename__ = "costo_despido_snapshots"
    __table_args__ = (
        UniqueConstraint("trabajador_id", "mes", "anio", name="uq_despido_trab_mes"),
    )

    id = Column(Integer, primary_key=True, index=True)
    trabajador_id = Column(Integer, ForeignKey("trabajadores.id"), nullable=False, index=True)
    mes = Column(Integer, nullable=False)
    anio = Column(Integer, nullable=False)

    # Inputs del cálculo
    fecha_ingreso = Column(Date, nullable=True)
    meses_trabajados = Column(Integer, nullable=False, default=0)
    anios_servicio_indemnizacion = Column(Integer, nullable=False, default=0)  # inc. fracciones > 6 meses
    ultima_remuneracion_base = Column(Integer, nullable=False, default=0)  # imponible sin extraordinarios
    tipo_contrato = Column(String, nullable=True)

    # Componentes del costo
    indemnizacion_anos_servicio = Column(Integer, nullable=False, default=0)   # N × última remun.
    aviso_previo = Column(Integer, nullable=False, default=0)                  # 1 mes (Art. 162)
    feriado_proporcional = Column(Integer, nullable=False, default=0)          # días no tomados
    total_estimado = Column(Integer, nullable=False, default=0)

    # UF de referencia usada para cálculo del tope 330 UF
    uf_referencia = Column(Integer, nullable=True)   # en pesos, ej: 38200

    notas = Column(Text, nullable=True)
    calculado_at = Column(DateTime, server_default=func.now())

    trabajador = relationship("Trabajador")


class HoraExtraTrabajador(Base):
    """
    Carga de horas extras de un trabajador para un mes/año.
    El monto se calcula con la versión contractual vigente al momento de la carga.
    Se importa automáticamente al imponible al generar la liquidación mensual.
    """
    __tablename__ = "horas_extras_trabajadores"
    __table_args__ = (
        UniqueConstraint("trabajador_id", "mes", "anio", name="uq_he_trab_mes"),
    )

    id = Column(Integer, primary_key=True, index=True)
    trabajador_id = Column(Integer, ForeignKey("trabajadores.id"), nullable=False, index=True)
    mes = Column(Integer, nullable=False)
    anio = Column(Integer, nullable=False)

    cantidad_50 = Column(Numeric(6, 2), nullable=False, default=0)   # horas con recargo 50%
    cantidad_100 = Column(Numeric(6, 2), nullable=False, default=0)  # horas con recargo 100%

    # Snapshot del cálculo
    valor_hora_calculado = Column(Integer, nullable=False, default=0)
    monto_50 = Column(Integer, nullable=False, default=0)
    monto_100 = Column(Integer, nullable=False, default=0)
    monto_total = Column(Integer, nullable=False, default=0)

    # Snapshot de las condiciones usadas (auditoría)
    contrato_version_id = Column(Integer, ForeignKey("contrato_trabajador_versiones.id"), nullable=True)
    sueldo_base_snapshot = Column(Integer, nullable=False, default=0)
    jornada_snapshot = Column(Integer, nullable=False, default=44)

    nota = Column(Text, nullable=True)
    creado_por = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    trabajador = relationship("Trabajador")


class ConfiguracionLegal(Base):
    """
    Parámetros legales del sistema editables por admin.
    Una sola fila (id=1) que se actualiza cuando cambia la ley.
    """
    __tablename__ = "configuracion_legal"

    id = Column(Integer, primary_key=True, default=1)
    jornada_legal_vigente = Column(Integer, nullable=False, default=44)
    jornada_legal_proxima = Column(Integer, nullable=True)        # Ej. 42 (vigente desde X)
    jornada_legal_proxima_desde = Column(Date, nullable=True)
    rep_legal_nombre = Column(String, nullable=True)
    rep_legal_rut = Column(String, nullable=True)
    rep_legal_ci = Column(String, nullable=True)                  # cédula de identidad (para contratos)
    rep_legal_cargo = Column(String, nullable=True)               # ej. "Gerente General"
    empresa_razon_social = Column(String, nullable=True)
    empresa_rut = Column(String, nullable=True)
    empresa_direccion = Column(String, nullable=True)
    empresa_ciudad_comuna = Column(String, nullable=True)         # ciudad / comuna de la empresa (para contratos)
    empresa_correo = Column(String, nullable=True)                # correo oficial de la empresa
    empresa_giro = Column(String, nullable=True)                  # giro / actividad económica para contratos
    empresa_telefono = Column(String, nullable=True)
    # Parámetros de remuneración y pago
    dia_pago_mes = Column(Integer, nullable=False, default=5)     # día del mes en que se pagan remuneraciones
    canal_portal_url = Column(String, nullable=True)              # URL del portal de consultas (para contratos)
    # Plazo fijo por defecto para nuevos contratos de conductores (meses)
    plazo_fijo_conductor_meses = Column(Integer, nullable=False, default=3)
    actualizado_por = Column(String, nullable=True)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


# ─────────────────────────────────────────────────────────────────────────────
# Jornadas horarias (plantillas de horario para contratos)
# ─────────────────────────────────────────────────────────────────────────────
class JornadaHoraria(Base):
    """
    Plantilla de horario reutilizable. El admin crea las jornadas disponibles
    (ej. "Santiago 40hrs", "Valparaíso 44hrs") y en el perfil del trabajador
    se selecciona la que aplica. El motor de contratos usa estos valores para
    las variables {{jornada.hora_entrada}}, {{jornada.hora_salida}}, etc.
    """
    __tablename__ = "jornadas_horarias"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False)            # "Santiago 40hrs mañana"
    hora_entrada = Column(String(5), nullable=False)   # "08:00"
    hora_salida = Column(String(5), nullable=False)    # "17:00"
    minutos_colacion = Column(Integer, nullable=False, default=45)
    activa = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


# ─────────────────────────────────────────────────────────────────────────────
# Plantillas de contrato (Camino B: contratos digitales)
# ─────────────────────────────────────────────────────────────────────────────
class PlantillaContrato(Base):
    """
    Plantilla de contrato individual de trabajo. El motor renderiza el contenido
    inyectando datos del trabajador, contrato y configuración legal a través de
    placeholders {{trabajador.nombre}}, {{contrato.sueldo_liquido}}, etc.

    Se versiona: cada cambio publica una nueva versión y la anterior queda como
    histórico. Solo una versión `activa` por slug se ofrece para nuevos contratos.
    """
    __tablename__ = "plantillas_contrato"
    __table_args__ = (
        Index("ix_plantilla_slug_version", "slug", "version"),
    )

    id = Column(Integer, primary_key=True, index=True)
    slug = Column(String, nullable=False, index=True)             # ej. indefinido_administrativo
    nombre = Column(String, nullable=False)                       # ej. "Indefinido — Administrativo"
    descripcion = Column(Text, nullable=True)
    tipo_contrato = Column(String, nullable=True)                 # INDEFINIDO/PLAZO_FIJO/OBRA_FAENA/PART_TIME
    aplica_a_cargos = Column(JSON, nullable=True)                 # ["administrativo", "operador"]
    aplica_a_jornadas = Column(JSON, nullable=True)               # [44, 40, 30, 25]

    contenido = Column(Text, nullable=False, default="")          # markdown con {{placeholders}}
    clausulas_extra = Column(JSON, nullable=True)                 # bloques opcionales activables al emitir

    version = Column(Integer, nullable=False, default=1)
    activa = Column(Boolean, nullable=False, default=True)
    creada_por = Column(String, nullable=True)
    creada_desde_anexo_id = Column(Integer, ForeignKey("anexos_contrato.id"), nullable=True)
    notas_version = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


# ─────────────────────────────────────────────────────────────────────────────
# Notificaciones para trabajadores (portal interno)
# ─────────────────────────────────────────────────────────────────────────────
class TipoNotificacionEnum(str, enum.Enum):
    ANEXO_PARA_FIRMA = "ANEXO_PARA_FIRMA"
    ANEXO_INFORMATIVO = "ANEXO_INFORMATIVO"
    LIQUIDACION_DISPONIBLE = "LIQUIDACION_DISPONIBLE"
    PAGO_REALIZADO = "PAGO_REALIZADO"
    VACACIONES_APROBADAS = "VACACIONES_APROBADAS"
    VACACIONES_RECHAZADAS = "VACACIONES_RECHAZADAS"
    LICENCIA_REGISTRADA = "LICENCIA_REGISTRADA"
    DOCUMENTO_POR_VENCER = "DOCUMENTO_POR_VENCER"
    GENERICA = "GENERICA"


class NotificacionTrabajador(Base):
    """
    Notificación dirigida a un trabajador (visible en su portal).
    Si el trabajador tiene `whatsapp`, se envía además vía WhatsApp Business.
    """
    __tablename__ = "notificaciones_trabajador"
    __table_args__ = (
        Index("ix_notif_trab_leida", "trabajador_id", "leida"),
    )

    id = Column(Integer, primary_key=True, index=True)
    trabajador_id = Column(Integer, ForeignKey("trabajadores.id"), nullable=False, index=True)
    tipo = Column(String, nullable=False, default=TipoNotificacionEnum.GENERICA.value)
    titulo = Column(String, nullable=False)
    mensaje = Column(Text, nullable=False)
    url_accion = Column(String, nullable=True)                    # ej. /portal/anexos/123
    leida = Column(Boolean, nullable=False, default=False)
    leida_at = Column(DateTime, nullable=True)
    enviada_whatsapp = Column(Boolean, nullable=False, default=False)
    whatsapp_status = Column(String, nullable=True)               # ok / failed:<motivo>
    metadata_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    trabajador = relationship("Trabajador")


# ─────────────────────────────────────────────────────────────────────────────
# Control horario digital — integración con ZKBioTime (NUNCA al reloj físico)
# ─────────────────────────────────────────────────────────────────────────────
# Arquitectura legal en Chile (Dirección del Trabajo):
#   Reloj físico (ZKTeco SpeedFace-V5L)
#       └── Push protocol ──> ZKBioTime (software CERTIFICADO por la DT)
#                                 └── REST API ──> nuestro FastAPI
# Conectarse directo al reloj invalida la prueba ante la Inspección del Trabajo
# porque nuestro código no tiene resolución DT. Por eso TODO el flujo pasa por
# ZKBioTime, que es el sistema oficial de control de asistencia.
# ─────────────────────────────────────────────────────────────────────────────


# ─────────────────────────────────────────────────────────────────────────────
# Flota de vehículos, combustible y TAG
# ─────────────────────────────────────────────────────────────────────────────

class TipoVehiculoEnum(str, enum.Enum):
    FURGON      = "furgon"
    CAMIONETA   = "camioneta"
    MOTO        = "moto"
    AUTO        = "auto"
    CAMION      = "camion"
    OTRO        = "otro"


class VehiculoEmpresa(Base):
    """
    Registro de la flota de vehículos propios de la empresa.
    La patente es el identificador único y se usa como clave en combustible y TAG.
    """
    __tablename__ = "vehiculos_empresa"

    patente         = Column(String(12), primary_key=True)
    marca           = Column(String, nullable=True)
    modelo          = Column(String, nullable=True)
    anio            = Column(Integer, nullable=True)
    tipo            = Column(String, nullable=False, default=TipoVehiculoEnum.FURGON.value)
    color           = Column(String, nullable=True)
    activo          = Column(Boolean, default=True, nullable=False)
    notas           = Column(Text, nullable=True)
    created_at      = Column(DateTime, server_default=func.now())
    updated_at      = Column(DateTime, server_default=func.now(), onupdate=func.now())

    # Relationships inversos (se declaran desde el lado FK)
    combustibles    = relationship("CombustibleRegistro", back_populates="vehiculo")
    tags            = relationship("RegistroTag", back_populates="vehiculo")
    excepciones     = relationship("UsoVehiculoExcepcion", back_populates="vehiculo")


class UsoVehiculoExcepcion(Base):
    """
    Registra días puntuales en que un conductor usó un vehículo distinto al asignado
    por defecto en su perfil. Solo se crea cuando hay una excepción — el caso normal
    es la asignación Driver.vehiculo_patente.
    """
    __tablename__ = "uso_vehiculo_excepciones"
    __table_args__ = (
        Index("ix_uso_vehiculo_driver_fecha", "driver_id", "fecha"),
    )

    id              = Column(Integer, primary_key=True, index=True)
    driver_id       = Column(Integer, ForeignKey("drivers.id"), nullable=False)
    patente         = Column(String(12), ForeignKey("vehiculos_empresa.patente"), nullable=False)
    fecha           = Column(Date, nullable=False)
    motivo          = Column(String, nullable=True)
    creado_por      = Column(String, nullable=True)
    created_at      = Column(DateTime, server_default=func.now())

    driver          = relationship("Driver")
    vehiculo        = relationship("VehiculoEmpresa", back_populates="excepciones")


class CombustibleRegistro(Base):
    """
    Registro de abastecimiento de combustible por vehículo.
    El conductor responsable se resuelve automáticamente desde la asignación del vehículo
    en esa fecha (Driver.vehiculo_patente o UsoVehiculoExcepcion si existe).
    """
    __tablename__ = "combustible_registros"
    __table_args__ = (
        Index("ix_combustible_patente_fecha", "patente", "fecha"),
        Index("ix_combustible_semana", "semana", "mes", "anio"),
    )

    id                  = Column(Integer, primary_key=True, index=True)
    patente             = Column(String(12), ForeignKey("vehiculos_empresa.patente"), nullable=False)
    fecha               = Column(Date, nullable=False)
    semana              = Column(Integer, nullable=False)
    mes                 = Column(Integer, nullable=False)
    anio                = Column(Integer, nullable=False)
    litros              = Column(Numeric(8, 2), nullable=True)
    monto_total         = Column(Integer, nullable=False)
    proveedor           = Column(String, nullable=True)          # Copec, Shell, Petrobras…
    # Conductor resuelto al momento del ingreso (driver_id según asignación de esa fecha)
    driver_id_resuelto  = Column(Integer, ForeignKey("drivers.id"), nullable=True)
    notas               = Column(String, nullable=True)
    creado_por          = Column(String, nullable=True)
    created_at          = Column(DateTime, server_default=func.now())

    vehiculo            = relationship("VehiculoEmpresa", back_populates="combustibles")
    driver              = relationship("Driver", foreign_keys=[driver_id_resuelto])


class RegistroTag(Base):
    """
    Costos de TAG / autopistas informados por las empresas concesionarias.
    Se ingresan por patente y período (el período que informa la autopista, que puede
    ser semanal, quincenal o mensual según el proveedor).
    Los costos se atribuyen a conductores prorrateando por días de uso de esa patente
    durante el período, usando la asignación por defecto y las excepciones registradas.
    """
    __tablename__ = "registros_tag"
    __table_args__ = (
        Index("ix_tag_patente_periodo", "patente", "fecha_inicio_periodo"),
    )

    id                      = Column(Integer, primary_key=True, index=True)
    patente                 = Column(String(12), ForeignKey("vehiculos_empresa.patente"), nullable=False)
    fecha_inicio_periodo    = Column(Date, nullable=False)
    fecha_fin_periodo       = Column(Date, nullable=False)
    monto_total             = Column(Integer, nullable=False)
    numero_transacciones    = Column(Integer, nullable=True)
    proveedor               = Column(String, nullable=True)     # Autopista Central, VNE, etc.
    archivo_origen          = Column(String, nullable=True)     # nombre del archivo importado
    detalle_json            = Column(JSON, nullable=True)       # detalle transacción a transacción
    notas                   = Column(String, nullable=True)
    creado_por              = Column(String, nullable=True)
    created_at              = Column(DateTime, server_default=func.now())

    vehiculo                = relationship("VehiculoEmpresa", back_populates="tags")


class ConfiguracionAsistencia(Base):
    """
    Singleton (id=1) con la configuración del módulo de control horario.
    Hasta que `activo=True` y se hayan poblado las credenciales, el módulo
    queda en stand-by (UI lo muestra como "no configurado").
    """
    __tablename__ = "configuracion_asistencia"

    id = Column(Integer, primary_key=True, default=1)
    activo = Column(Boolean, nullable=False, default=False)            # feature flag global

    # Conexión a ZKBioTime (REST API)
    zkbio_base_url = Column(String, nullable=True)                     # https://bio.miempresa.cl
    zkbio_api_token = Column(Text, nullable=True)                      # JWT/access token persistido
    zkbio_username = Column(String, nullable=True)
    zkbio_password = Column(Text, nullable=True)                       # opcional: para refrescar token
    zkbio_token_expira_at = Column(DateTime, nullable=True)
    zkbio_version = Column(String, nullable=True)                      # ej. "ZKBioTime 8.0"

    # Tolerancias (minutos)
    tolerancia_atraso_min = Column(Integer, nullable=False, default=5)         # antes no es atraso
    tolerancia_salida_anticipada_min = Column(Integer, nullable=False, default=5)
    minutos_minimos_he = Column(Integer, nullable=False, default=15)           # mínimo para contar HE
    redondeo_marcas_min = Column(Integer, nullable=False, default=1)           # snap-to nearest

    # Política de horas extras
    requiere_aprobacion_he = Column(Boolean, nullable=False, default=True)     # si False, autoasume
    he_dia_recargo_50_max_diario = Column(Integer, nullable=False, default=2)  # tope legal Art. 31 CT
    consolidar_he_a_liquidacion = Column(Boolean, nullable=False, default=True)

    # Última sincronización
    ultima_sync_at = Column(DateTime, nullable=True)
    ultima_sync_hasta = Column(DateTime, nullable=True)                # fecha máxima ya importada
    ultima_sync_marcas_nuevas = Column(Integer, nullable=True)
    ultima_sync_error = Column(Text, nullable=True)

    actualizado_por = Column(String, nullable=True)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class TipoMarcaEnum(str, enum.Enum):
    """Mapeo de los punch_state de ZKBioTime."""
    ENTRADA = "ENTRADA"               # 0 / Check-In
    SALIDA = "SALIDA"                 # 1 / Check-Out
    SALIDA_COLACION = "SALIDA_COLACION"   # 2 / Break-Out
    ENTRADA_COLACION = "ENTRADA_COLACION" # 3 / Break-In
    SALIDA_HE = "SALIDA_HE"           # 4 / Overtime-Out
    ENTRADA_HE = "ENTRADA_HE"         # 5 / Overtime-In
    DESCONOCIDO = "DESCONOCIDO"


class MarcaAsistencia(Base):
    """
    Registro CRUDO de cada transacción importada desde ZKBioTime.
    Es la fuente de verdad inalterable: jamás se edita, solo se anula
    (se marca `descartada=True` con motivo) y se recalculan las jornadas.

    Idempotencia: la combinación (zkbio_transaction_id, dispositivo_sn) es UNIQUE.
    Si una marca llega de un trabajador sin vincular, queda con
    `trabajador_id=NULL` para que admin la vincule luego.
    """
    __tablename__ = "marcas_asistencia"
    __table_args__ = (
        UniqueConstraint("zkbio_transaction_id", "dispositivo_sn", name="uq_marca_zk_tx"),
        Index("ix_marca_trab_fecha", "trabajador_id", "fecha"),
        Index("ix_marca_timestamp", "timestamp"),
    )

    id = Column(Integer, primary_key=True, index=True)

    # Vínculo (puede ser NULL si llegó una marca de un emp_id no vinculado)
    trabajador_id = Column(Integer, ForeignKey("trabajadores.id"), nullable=True, index=True)
    zkbio_employee_id = Column(String, nullable=False, index=True)
    zkbio_employee_codigo = Column(String, nullable=True)

    # Identificadores ZKBioTime (idempotencia)
    zkbio_transaction_id = Column(String, nullable=False)
    dispositivo_sn = Column(String, nullable=True)
    dispositivo_alias = Column(String, nullable=True)
    terminal_id = Column(String, nullable=True)

    # Datos de la marca
    timestamp = Column(DateTime, nullable=False, index=True)           # fecha+hora local del reloj
    fecha = Column(Date, nullable=False)                               # derivada para queries rápidas
    tipo = Column(String, nullable=False, default=TipoMarcaEnum.DESCONOCIDO.value)
    punch_state_raw = Column(String, nullable=True)                    # valor crudo de ZKBio
    verify_type = Column(String, nullable=True)                        # rostro / huella / tarjeta
    work_code = Column(String, nullable=True)                          # opcional, política propia
    area = Column(String, nullable=True)
    foto_base64 = Column(Text, nullable=True)                          # si ZKBio devuelve imagen

    # Estado interno
    descartada = Column(Boolean, nullable=False, default=False)
    motivo_descarte = Column(Text, nullable=True)
    sincronizada_at = Column(DateTime, server_default=func.now())
    payload_raw = Column(JSON, nullable=True)                          # respaldo defensivo

    trabajador = relationship("Trabajador")


class EstadoJornadaEnum(str, enum.Enum):
    NORMAL = "NORMAL"                 # entrada y salida correctas
    ATRASO = "ATRASO"
    SALIDA_ANTICIPADA = "SALIDA_ANTICIPADA"
    INCOMPLETA = "INCOMPLETA"         # falta entrada o salida
    AUSENTE = "AUSENTE"               # día laborable sin marcas
    LICENCIA = "LICENCIA"             # licencia médica
    VACACIONES = "VACACIONES"
    FERIADO_LEGAL = "FERIADO_LEGAL"   # festivo
    HORAS_EXTRAS = "HORAS_EXTRAS"     # trabajó más allá del horario
    REVISAR = "REVISAR"               # marcas inconsistentes


class JornadaTrabajador(Base):
    """
    Resumen calculado por trabajador y día. Se reconstruye desde MarcaAsistencia
    cada vez que llegan marcas nuevas o se anula una. UNIQUE por (trabajador, fecha).
    """
    __tablename__ = "jornadas_trabajador"
    __table_args__ = (
        UniqueConstraint("trabajador_id", "fecha", name="uq_jornada_trab_fecha"),
        Index("ix_jornada_fecha", "fecha"),
    )

    id = Column(Integer, primary_key=True, index=True)
    trabajador_id = Column(Integer, ForeignKey("trabajadores.id"), nullable=False, index=True)
    fecha = Column(Date, nullable=False)

    # Marcas (timestamps)
    primera_entrada = Column(DateTime, nullable=True)
    salida_colacion = Column(DateTime, nullable=True)
    entrada_colacion = Column(DateTime, nullable=True)
    ultima_salida = Column(DateTime, nullable=True)
    cantidad_marcas = Column(Integer, nullable=False, default=0)

    # Cálculos (minutos)
    minutos_trabajados = Column(Integer, nullable=False, default=0)
    minutos_colacion = Column(Integer, nullable=False, default=0)
    minutos_atraso = Column(Integer, nullable=False, default=0)
    minutos_salida_anticipada = Column(Integer, nullable=False, default=0)
    minutos_he_estimadas = Column(Integer, nullable=False, default=0)         # antes de aprobación

    # Horario esperado (snapshot)
    hora_entrada_esperada = Column(String, nullable=True)
    hora_salida_esperada = Column(String, nullable=True)
    jornada_diaria_min_esperada = Column(Integer, nullable=False, default=480)  # 8h default

    estado = Column(String, nullable=False, default=EstadoJornadaEnum.NORMAL.value)
    observaciones = Column(Text, nullable=True)

    # Aprobación de horas extras (gobernanza)
    he_aprobadas_min = Column(Integer, nullable=False, default=0)
    he_aprobadas_por = Column(String, nullable=True)
    he_aprobadas_at = Column(DateTime, nullable=True)
    he_consolidada_id = Column(Integer, ForeignKey("horas_extras_trabajadores.id"), nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    trabajador = relationship("Trabajador")


# ── Email Marketing (Amazon SES) ──────────────────────────────────────────────

class EmailPlantilla(Base):
    """Plantillas HTML para campañas de email masivo."""
    __tablename__ = "email_plantillas"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(100), nullable=False)
    asunto = Column(String(200), nullable=False)
    cuerpo_html = Column(Text, nullable=False)
    cuerpo_texto = Column(Text, nullable=True)
    variables = Column(JSON, default=list)
    activo = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class EmailEnvio(Base):
    """Registro de una campaña de email masivo."""
    __tablename__ = "email_envios"

    id = Column(Integer, primary_key=True, index=True)
    nombre_campana = Column(String(200), nullable=True)
    plantilla_id = Column(Integer, ForeignKey("email_plantillas.id"), nullable=False)
    segmento = Column(String(50), nullable=False)
    seller_ids = Column(JSON, default=list)
    emails_extra = Column(JSON, default=list)  # destinatarios sueltos, no son sellers
    variables_valores = Column(JSON, default=dict)
    estado = Column(String(20), default="pendiente")  # pendiente | enviando | completado | error
    total = Column(Integer, default=0)
    enviados = Column(Integer, default=0)
    errores = Column(Integer, default=0)
    abiertos = Column(Integer, default=0)
    rebotados = Column(Integer, default=0)
    fecha_inicio = Column(DateTime, nullable=True)
    fecha_fin = Column(DateTime, nullable=True)


class EmailMensaje(Base):
    """Registro individual de cada correo enviado en una campaña."""
    __tablename__ = "email_mensajes"

    id = Column(Integer, primary_key=True, index=True)
    envio_id = Column(Integer, ForeignKey("email_envios.id"), nullable=False, index=True)
    seller_id = Column(Integer, ForeignKey("sellers.id"), nullable=True, index=True)
    email = Column(String(200), nullable=False)
    ses_message_id = Column(String(200), nullable=True, index=True)
    estado = Column(String(20), default="pendiente")  # pendiente | enviado | abierto | rebotado | queja | error
    abierto = Column(Boolean, default=False)
    rebotado = Column(Boolean, default=False)
    error = Column(Text, nullable=True)
    enviado_at = Column(DateTime, default=datetime.utcnow)


class CronJob(Base):
    """Configuración persistida de jobs programados que el scheduler ejecuta."""
    __tablename__ = "cron_jobs"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(80), nullable=False, unique=True)
    descripcion = Column(Text, nullable=True)
    job_key = Column(String(80), nullable=False, unique=True)
    activo = Column(Boolean, nullable=False, default=False)
    hora_ejecucion = Column(String(5), nullable=False, default="03:00")
    config = Column(JSON, nullable=True)

    ultima_ejecucion_at = Column(DateTime, nullable=True)
    ultima_ejecucion_estado = Column(String(20), nullable=True)
    ultima_ejecucion_mensaje = Column(Text, nullable=True)
    ultima_ejecucion_resultado = Column(JSON, nullable=True)
    ultima_ejecucion_duracion_s = Column(Numeric(10, 2), nullable=True)
    proxima_ejecucion_at = Column(DateTime, nullable=True)

    actualizado_por = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class CronEjecucion(Base):
    """Historial de ejecuciones de cron jobs."""
    __tablename__ = "cron_ejecuciones"

    id = Column(Integer, primary_key=True, index=True)
    cron_job_id = Column(Integer, ForeignKey("cron_jobs.id", ondelete="CASCADE"), nullable=False, index=True)
    job_key = Column(String(80), nullable=False, index=True)
    iniciado_at = Column(DateTime, nullable=False, server_default=func.now())
    finalizado_at = Column(DateTime, nullable=True)
    duracion_s = Column(Numeric(10, 2), nullable=True)
    estado = Column(String(20), nullable=False, default="running")
    mensaje = Column(Text, nullable=True)
    resultado = Column(JSON, nullable=True)
    disparado_por = Column(String(40), nullable=False, default="scheduler")
    disparado_por_usuario = Column(String, nullable=True)


class AsignacionRuta(Base):
    """Asignación de un envío a una ruta de conductor según el endpoint del courier.

    Es la fuente de verdad del DENOMINADOR para calcular efectividad.

    Modelo MULTI-INTENTO (a partir de abril 2026):
      - Permite varias filas para el mismo tracking_id: una por cada día en que
        el paquete sale a ruta. Si en un mismo día el paquete cambia de ruta,
        sigue siendo UN solo intento (UPSERT por (tracking_id, withdrawal_date)).
      - `intento_nro` se calcula al insertar como max(intento_nro)+1 para ese
        tracking. Sirve para First-Attempt Delivery Rate y Delivery Success Rate.

    Cada registro intenta enlazarse con un Envio por tracking_id; si el envío
    todavía no existe en BD, queda con envio_id=NULL y se reintenta en cada
    ingesta CSV (hook auto-background).

    Estado calculado:
      - 'entregado'   : envio_id != NULL y envio.fecha_entrega != NULL
      - 'cancelado'   : status del endpoint indica cancelación (no afecta tasa)
      - 'sin_entrega' : todo lo demás
    """
    __tablename__ = "asignacion_ruta"
    __table_args__ = (
        UniqueConstraint("tracking_id", "withdrawal_date", name="ux_asig_ruta_tracking_withdrawal"),
        Index("ix_asig_ruta_withdrawal", "withdrawal_date"),
        Index("ix_asig_ruta_driver_periodo", "driver_id", "withdrawal_date"),
        Index("ix_asig_ruta_route", "route_id"),
        Index("ix_asig_ruta_estado", "estado_calculado"),
        Index("ix_asig_ruta_envio_pendiente", "envio_id", "withdrawal_date"),
        Index("ix_asig_ruta_tracking", "tracking_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    tracking_id = Column(String, nullable=False, index=True)
    external_id = Column(String, nullable=True, index=True)

    intento_nro = Column(Integer, nullable=False, default=1)

    withdrawal_date = Column(Date, nullable=False)
    withdrawal_at = Column(DateTime, nullable=True)
    pedido_creado_at = Column(DateTime, nullable=True)

    route_id = Column(Integer, nullable=True, index=True)
    route_name = Column(String, nullable=True)
    route_date = Column(Date, nullable=True, index=True)

    driver_externo_id = Column(Integer, nullable=True)
    driver_name = Column(String, nullable=True)
    driver_id = Column(Integer, ForeignKey("drivers.id"), nullable=True, index=True)

    seller_code = Column(String, nullable=True, index=True)

    envio_id = Column(Integer, ForeignKey("envios.id", ondelete="SET NULL"), nullable=True, index=True)

    status_externo = Column(String, nullable=True)
    estado_calculado = Column(String(20), nullable=False, default="sin_entrega")

    address_full = Column(String, nullable=True)
    address_lat = Column(String, nullable=True)
    address_lon = Column(String, nullable=True)

    raw_payload = Column(JSON, nullable=True)

    intentos_reconciliacion = Column(Integer, nullable=False, default=0)
    ultima_reconciliacion_at = Column(DateTime, nullable=True)
    primera_ingesta_at = Column(DateTime, server_default=func.now())
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    driver = relationship("Driver")
    envio = relationship("Envio")


# ── Módulo Inquilinos (arriendo Tracking Tech) ────────────────────────────────

class Inquilino(Base):
    __tablename__ = "inquilinos"

    id = Column(Integer, primary_key=True, index=True)
    # Login
    email = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=True)
    activo = Column(Boolean, default=True)
    # Datos empresa (contrato)
    razon_social = Column(String, nullable=True)
    nombre_fantasia = Column(String, nullable=True)
    rut_empresa = Column(String, nullable=True)
    direccion_empresa = Column(String, nullable=True)
    correo_empresa = Column(String, nullable=True)
    giro_empresa = Column(String, nullable=True)
    # Rep. legal
    nombre_rep_legal = Column(String, nullable=True)
    rut_rep_legal = Column(String, nullable=True)
    direccion_rep_legal = Column(String, nullable=True)
    correo_rep_legal = Column(String, nullable=True)
    # Contacto (comunicaciones)
    correo_contacto = Column(String, nullable=True)
    whatsapp = Column(String, nullable=True)
    # Plan de arriendo
    plan = Column(String, nullable=True)
    perfil_completado = Column(Boolean, default=False)
    # Reserva
    tiene_reserva = Column(Boolean, default=False)
    monto_reserva = Column(Integer, nullable=True)
    # Condiciones preconfiguradas
    mes_gratis = Column(Boolean, default=False)
    # Despliegue (post-firma, ingresado por admin)
    fecha_inicio_despliegue = Column(Date, nullable=True)
    mes_gratis_confirmado = Column(Boolean, nullable=True)
    fecha_inicio_facturacion = Column(Date, nullable=True)
    # Firma digital (guardada en perfil, se usa para firmar contratos)
    firma_base64 = Column(Text, nullable=True)
    # Estado general
    contrato_firmado = Column(Boolean, default=False)
    primer_cobro_generado = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    cobros = relationship("CobrosInquilino", back_populates="inquilino", cascade="all, delete-orphan")
    descuentos = relationship("DescuentoInquilino", back_populates="inquilino", cascade="all, delete-orphan")
    anexos = relationship("AnexoContratoInquilino", back_populates="inquilino", cascade="all, delete-orphan")


class DescuentoInquilino(Base):
    __tablename__ = "descuentos_inquilino"

    id = Column(Integer, primary_key=True, index=True)
    inquilino_id = Column(Integer, ForeignKey("inquilinos.id"), nullable=False, index=True)
    monto = Column(Integer, nullable=False)
    motivo = Column(String, nullable=False)
    aplicado = Column(Boolean, default=False)
    fecha_aplicacion = Column(Date, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    inquilino = relationship("Inquilino", back_populates="descuentos")


class CobrosInquilino(Base):
    __tablename__ = "cobros_inquilino"

    id = Column(Integer, primary_key=True, index=True)
    inquilino_id = Column(Integer, ForeignKey("inquilinos.id"), nullable=False, index=True)
    mes = Column(Integer, nullable=False)
    anio = Column(Integer, nullable=False)
    variable_nombre = Column(String, nullable=False)
    variable_valor = Column(Integer, nullable=False, default=0)
    monto_neto = Column(Integer, nullable=False, default=0)
    iva = Column(Integer, nullable=False, default=0)
    total = Column(Integer, nullable=False, default=0)
    descuento_aplicado = Column(Integer, default=0)
    reserva_descontada = Column(Boolean, default=False)
    estado = Column(String, nullable=False, default=EstadoCobrosInquilinoEnum.PENDIENTE.value)
    fecha_emision = Column(Date, nullable=True)
    fecha_vencimiento = Column(Date, nullable=True)
    folio_haulmer = Column(String, nullable=True)
    pdf_factura_path = Column(String, nullable=True)
    pdf_factura_b64 = Column(Text, nullable=True)
    comprobante_pago_path = Column(String, nullable=True)
    comprobante_pago_nombre = Column(String, nullable=True)
    archivo_adjunto_path = Column(String, nullable=True)
    movimiento_financiero_id = Column(Integer, ForeignKey("movimientos_financieros.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    inquilino = relationship("Inquilino", back_populates="cobros")


class AnexoContratoInquilino(Base):
    __tablename__ = "anexos_contrato_inquilino"

    id = Column(Integer, primary_key=True, index=True)
    inquilino_id = Column(Integer, ForeignKey("inquilinos.id"), nullable=False, index=True)
    tipo = Column(String, nullable=False, default=TipoAnexoInquilinoEnum.CONTRATO.value)
    titulo = Column(String, nullable=False)
    pdf_generado = Column(Text, nullable=True)
    requiere_firma_inquilino = Column(Boolean, default=True)
    estado = Column(String, nullable=False, default=EstadoAnexoInquilinoEnum.BORRADOR.value)
    firma_inquilino_snapshot = Column(Text, nullable=True)
    firmado_at = Column(DateTime, nullable=True)
    firmado_ip = Column(String, nullable=True)
    plantilla_id = Column(Integer, ForeignKey("plantillas_contrato.id"), nullable=True)
    plantilla_version = Column(Integer, nullable=True)
    contenido_renderizado = Column(Text, nullable=True)
    comprobante_reserva_path = Column(String, nullable=True)
    comprobante_reserva_aprobado = Column(Boolean, default=False)
    aprobado_por = Column(String, nullable=True)
    aprobado_at = Column(DateTime, nullable=True)
    creado_por = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    inquilino = relationship("Inquilino", back_populates="anexos")


class ConfigPlanInquilino(Base):
    """Configuración editable de cada tarifa de arriendo Tracking Tech."""
    __tablename__ = "config_planes_inquilino"

    id = Column(Integer, primary_key=True, index=True)
    plan = Column(String, unique=True, nullable=False)   # "TARIFA_A" | "TARIFA_B" | "TARIFA_C"
    params = Column(JSON, nullable=False)                 # dict con valores numéricos del plan
    descripcion_contrato = Column(Text, nullable=True)    # texto narrativo para el contrato
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
