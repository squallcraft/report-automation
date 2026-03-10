from datetime import datetime, date
from sqlalchemy import (
    Column, Integer, String, Boolean, Text, Date, DateTime,
    Enum, ForeignKey, JSON, UniqueConstraint, Index, func,
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
    rut = Column(String, nullable=True)
    giro = Column(String, nullable=True)
    activo = Column(Boolean, default=True)
    email = Column(String, unique=True, nullable=True)
    password_hash = Column(String, nullable=True)
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
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    jefe_flota = relationship("Driver", remote_side=[id], back_populates="subordinados")
    subordinados = relationship("Driver", back_populates="jefe_flota")
    envios = relationship("Envio", back_populates="driver")
    retiros = relationship("Retiro", back_populates="driver")


class Envio(Base):
    __tablename__ = "envios"
    __table_args__ = (
        Index("ix_envios_periodo", "semana", "mes", "anio"),
        Index("ix_envios_seller_periodo", "seller_id", "mes", "anio"),
        Index("ix_envios_driver_periodo", "driver_id", "mes", "anio"),
    )

    id = Column(Integer, primary_key=True, index=True)
    semana = Column(Integer, nullable=False)
    mes = Column(Integer, nullable=False)
    anio = Column(Integer, nullable=False)
    fecha_carga = Column(Date, nullable=True)
    fecha_entrega = Column(Date, nullable=False)
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
    direccion = Column(Text, nullable=True)
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
    created_at = Column(DateTime, server_default=func.now())

    categoria = relationship("CategoriaFinanciera", back_populates="movimientos")


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
