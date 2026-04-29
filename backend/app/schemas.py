from typing import Optional, List

from pydantic import BaseModel
from datetime import date, datetime
from enum import Enum


class EmpresaEnum(str, Enum):
    ECOURIER = "ECOURIER"
    TERCERIZADO = "TERCERIZADO"
    OVIEDO = "OVIEDO"
    VALPARAISO = "VALPARAISO"
    MELIPILLA = "MELIPILLA"


class TipoEntidadEnum(str, Enum):
    SELLER = "SELLER"
    DRIVER = "DRIVER"
    TRABAJADOR = "TRABAJADOR"
    COLABORADOR = "COLABORADOR"


class EstadoLiquidacionEnum(str, Enum):
    BORRADOR = "BORRADOR"
    REVISION = "REVISION"
    APROBADO = "APROBADO"
    PAGADO = "PAGADO"


# ── Auth ──

class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    rol: str
    nombre: str
    entidad_id: Optional[int] = None
    permisos: Optional[List[str]] = None
    acuerdo_aceptado: Optional[bool] = None
    contratado: Optional[bool] = None
    es_jefe: Optional[bool] = None
    contrato_trabajo_aceptado: Optional[bool] = None
    perfil_completado: Optional[bool] = None


class AcuerdoAceptarRequest(BaseModel):
    nombre_completo: str
    rut: str
    firma_base64: str
    carnet_frontal: str
    carnet_trasero: str
    version: str = "2.0"


# ── Sellers ──

class SellerBase(BaseModel):
    nombre: str
    aliases: List[str] = []
    zona: str = "Santiago"
    empresa: EmpresaEnum = EmpresaEnum.ECOURIER
    precio_base: int = 0
    plan_tarifario: Optional[str] = None
    tiene_retiro: bool = False
    tarifa_retiro: int = 0
    tarifa_retiro_driver: int = 0
    min_paquetes_retiro_gratis: int = 0
    usa_pickup: bool = False
    mensual: bool = False
    tipo_pago: str = "semanal"
    rut: Optional[str] = None
    giro: Optional[str] = None
    dir_fiscal: Optional[str] = None   # Dirección fiscal del receptor — máx 70 caracteres
    cmna_fiscal: Optional[str] = None  # Comuna fiscal del receptor — máx 20 caracteres
    correo_dte: Optional[str] = None   # Correo para notificación DTE — máx 80 caracteres
    correo_informativo: Optional[str] = None  # Correo para comunicaciones masivas/informativas
    telefono_whatsapp: Optional[str] = None
    activo: bool = True
    email: Optional[str] = None        # Acceso al portal del seller


class SellerCreate(SellerBase):
    password: Optional[str] = None


class SellerUpdate(BaseModel):
    nombre: Optional[str] = None
    aliases: Optional[List[str]] = None
    zona: Optional[str] = None
    empresa: Optional[EmpresaEnum] = None
    precio_base: Optional[int] = None
    plan_tarifario: Optional[str] = None
    tiene_retiro: Optional[bool] = None
    tarifa_retiro: Optional[int] = None
    tarifa_retiro_driver: Optional[int] = None
    min_paquetes_retiro_gratis: Optional[int] = None
    usa_pickup: Optional[bool] = None
    mensual: Optional[bool] = None
    tipo_pago: Optional[str] = None
    rut: Optional[str] = None
    giro: Optional[str] = None
    dir_fiscal: Optional[str] = None
    cmna_fiscal: Optional[str] = None
    correo_dte: Optional[str] = None
    correo_informativo: Optional[str] = None
    telefono_whatsapp: Optional[str] = None
    estacional: Optional[bool] = None
    activo: Optional[bool] = None
    email: Optional[str] = None
    password: Optional[str] = None
    tags: Optional[List[str]] = None


class SucursalBase(BaseModel):
    nombre: str
    tarifa_retiro: int = 0
    tarifa_retiro_driver: int = 0
    activo: bool = True


class SucursalCreate(SucursalBase):
    pass


class SucursalOut(SucursalBase):
    id: int
    seller_id: int
    aliases: List[str] = []

    model_config = {"from_attributes": True}


class SellerOut(SellerBase):
    id: int
    created_at: Optional[datetime] = None
    sucursales: List[SucursalOut] = []
    tipo_cierre: Optional[str] = None
    fecha_cierre: Optional[date] = None
    fecha_pausa_fin: Optional[date] = None
    razones_cierre: Optional[List[str]] = None
    potencial_recuperacion: Optional[str] = None
    tags: Optional[List[str]] = None

    model_config = {"from_attributes": True}


# ── Drivers ──

class DriverBase(BaseModel):
    nombre: str
    aliases: List[str] = []
    tarifa_ecourier: int = 1700
    tarifa_oviedo: int = 1800
    tarifa_tercerizado: int = 1500
    tarifa_valparaiso: int = 0
    tarifa_melipilla: int = 0
    tarifa_retiro_fija: int = 0
    jefe_flota_id: Optional[int] = None
    rut: Optional[str] = None
    banco: Optional[str] = None
    tipo_cuenta: Optional[str] = None
    numero_cuenta: Optional[str] = None
    activo: bool = True
    contratado: bool = False
    email: Optional[str] = None
    correo_notificaciones: Optional[str] = None
    whatsapp: Optional[str] = None
    trabajador_id: Optional[int] = None


class DriverCreate(DriverBase):
    password: Optional[str] = None


class DriverUpdate(BaseModel):
    nombre: Optional[str] = None
    aliases: Optional[List[str]] = None
    tarifa_ecourier: Optional[int] = None
    tarifa_oviedo: Optional[int] = None
    tarifa_tercerizado: Optional[int] = None
    tarifa_valparaiso: Optional[int] = None
    tarifa_melipilla: Optional[int] = None
    tarifa_retiro_fija: Optional[int] = None
    jefe_flota_id: Optional[int] = None
    rut: Optional[str] = None
    banco: Optional[str] = None
    tipo_cuenta: Optional[str] = None
    numero_cuenta: Optional[str] = None
    activo: Optional[bool] = None
    contratado: Optional[bool] = None
    email: Optional[str] = None
    correo_notificaciones: Optional[str] = None
    whatsapp: Optional[str] = None
    password: Optional[str] = None
    trabajador_id: Optional[int] = None


class DriverOut(DriverBase):
    id: int
    jefe_flota_nombre: Optional[str] = None
    subordinados_count: int = 0
    created_at: Optional[datetime] = None
    trabajador_nombre: Optional[str] = None
    acuerdo_aceptado: Optional[bool] = None
    acuerdo_version: Optional[str] = None
    acuerdo_fecha: Optional[datetime] = None

    model_config = {"from_attributes": True}


# ── Envíos ──

class EnvioOut(BaseModel):
    id: int
    semana: int
    mes: int
    anio: int
    fecha_carga: Optional[date] = None
    fecha_entrega: date
    seller_id: Optional[int] = None
    driver_id: Optional[int] = None
    seller_nombre_raw: Optional[str] = None
    driver_nombre_raw: Optional[str] = None
    zona: Optional[str] = None
    comuna: Optional[str] = None
    empresa: Optional[str] = None
    cobro_seller: int = 0
    costo_driver: int = 0
    extra_producto_seller: int = 0
    extra_producto_driver: int = 0
    extra_comuna_seller: int = 0
    extra_comuna_driver: int = 0
    cobro_extra_manual: int = 0
    pago_extra_manual: int = 0
    costo_orden: int = 0
    bultos: int = 1
    tracking_id: Optional[str] = None
    seller_code: Optional[str] = None
    venta_id: Optional[str] = None
    descripcion_producto: Optional[str] = None
    codigo_producto: Optional[str] = None
    ruta_nombre: Optional[str] = None
    direccion: Optional[str] = None
    homologado: bool = True
    estado_entrega: Optional[str] = "delivered"
    estado_financiero: Optional[str] = "pendiente"
    is_liquidado: Optional[bool] = False
    is_facturado: Optional[bool] = False
    is_pagado_driver: Optional[bool] = False
    origen: Optional[str] = "ingesta"
    external_id: Optional[str] = None
    seller_nombre: Optional[str] = None
    driver_nombre: Optional[str] = None

    model_config = {"from_attributes": True}


class EnvioUpdate(BaseModel):
    cobro_extra_manual: Optional[int] = None
    pago_extra_manual: Optional[int] = None


class EnvioBulkUpdate(BaseModel):
    """Edición masiva de extras manuales sobre múltiples envíos.

    Solo se aplica a envíos en estado 'pendiente'; el resto se reporta como skipped.
    """
    ids: List[int]
    cobro_extra_manual: Optional[int] = None
    pago_extra_manual: Optional[int] = None


class EnvioBulkUpdateResult(BaseModel):
    updated: int
    skipped: List[dict]
    total: int


# ── Tarifas Plan-Comuna ──

class TarifaPlanComunaBase(BaseModel):
    plan_tarifario: str
    comuna: str
    precio: int = 0


class TarifaPlanComunaCreate(TarifaPlanComunaBase):
    pass


class TarifaPlanComunaOut(TarifaPlanComunaBase):
    id: int

    model_config = {"from_attributes": True}


# ── Ingesta ──

class IngestaResult(BaseModel):
    total_filas: int
    envios_creados: int
    duplicados_omitidos: int = 0
    eliminados_reproceso: int = 0
    sin_homologar_sellers: List[str] = []
    sin_homologar_drivers: List[str] = []
    errores: List[str] = []
    ingesta_id: str


class HomologacionPendiente(BaseModel):
    nombre_raw: str
    tipo: str
    cantidad: int


class ResolverHomologacion(BaseModel):
    nombre_raw: str
    tipo: str
    entidad_id: int


# ── Productos con Extra ──

class ProductoExtraBase(BaseModel):
    codigo_mlc: str
    descripcion: Optional[str] = None
    extra_seller: int = 0
    extra_driver: int = 0
    activo: bool = True


class ProductoExtraCreate(ProductoExtraBase):
    pass


class ProductoExtraUpdate(BaseModel):
    descripcion: Optional[str] = None
    extra_seller: Optional[int] = None
    extra_driver: Optional[int] = None
    activo: Optional[bool] = None


class ProductoExtraOut(ProductoExtraBase):
    id: int

    model_config = {"from_attributes": True}


# ── Tarifas Comuna ──

class TarifaComunaBase(BaseModel):
    comuna: str
    extra_seller: int = 0
    extra_driver: int = 0


class TarifaComunaCreate(TarifaComunaBase):
    pass


class TarifaComunaUpdate(BaseModel):
    extra_seller: Optional[int] = None
    extra_driver: Optional[int] = None


class TarifaComunaOut(TarifaComunaBase):
    id: int

    model_config = {"from_attributes": True}


# ── Ajustes ──

class AjusteBase(BaseModel):
    tipo: TipoEntidadEnum
    entidad_id: int
    semana: int
    mes: int
    anio: int
    monto: int
    motivo: Optional[str] = None


class AjusteCreate(AjusteBase):
    pass


class AjusteOut(AjusteBase):
    id: int
    creado_por: Optional[str] = None
    created_at: Optional[datetime] = None
    entidad_nombre: Optional[str] = None

    model_config = {"from_attributes": True}


# ── Liquidación ──

class LiquidacionSellerOut(BaseModel):
    seller_id: int
    seller_nombre: str
    empresa: str
    user_nombres: List[str] = []
    total_envios: int
    cantidad_envios: int
    total_extras_producto: int
    total_extras_comuna: int
    total_retiros: int
    total_ajustes: int
    subtotal: int
    iva: int
    total_con_iva: int


class LiquidacionDriverOut(BaseModel):
    driver_id: int
    driver_nombre: str
    total_envios: int
    cantidad_envios: int
    total_extras_producto: int
    total_extras_comuna: int
    total_retiros: int
    total_ajustes: int
    subtotal: int
    iva: int
    total: int


class RentabilidadSellerOut(BaseModel):
    seller_id: int
    seller_nombre: str
    user_nombres: List[str] = []
    ingreso: int
    costo_drivers: int
    costo_retiros: int
    costo_pickup: int = 0
    costo_total: int = 0
    margen_bruto: int
    margen_porcentaje: float


class PeriodoBase(BaseModel):
    semana: int
    mes: int
    anio: int
    estado: EstadoLiquidacionEnum = EstadoLiquidacionEnum.BORRADOR


class PeriodoOut(PeriodoBase):
    id: int
    aprobado_por: Optional[str] = None
    aprobado_en: Optional[datetime] = None

    model_config = {"from_attributes": True}


class PeriodoUpdate(BaseModel):
    estado: EstadoLiquidacionEnum


# ── Consultas Portal ──

class ConsultaCreate(BaseModel):
    envio_id: Optional[int] = None
    mensaje: str


class ConsultaResponder(BaseModel):
    respuesta: str


class ConsultaOut(BaseModel):
    id: int
    tipo: TipoEntidadEnum
    entidad_id: int
    envio_id: Optional[int] = None
    mensaje: str
    estado: str
    respuesta: Optional[str] = None
    created_at: Optional[datetime] = None
    respondida_en: Optional[datetime] = None
    entidad_nombre: Optional[str] = None

    model_config = {"from_attributes": True}


# ── Pickups ──

class PickupBase(BaseModel):
    nombre: str
    aliases: List[str] = []
    tarifa_driver: int = 0
    comision_paquete: int = 200
    seller_id: Optional[int] = None
    driver_id: Optional[int] = None
    activo: bool = True
    email: Optional[str] = None
    rut: Optional[str] = None
    banco: Optional[str] = None
    tipo_cuenta: Optional[str] = None
    numero_cuenta: Optional[str] = None


class PickupCreate(PickupBase):
    password: Optional[str] = None


class PickupUpdate(BaseModel):
    nombre: Optional[str] = None
    aliases: Optional[List[str]] = None
    tarifa_driver: Optional[int] = None
    comision_paquete: Optional[int] = None
    seller_id: Optional[int] = None
    driver_id: Optional[int] = None
    activo: Optional[bool] = None
    email: Optional[str] = None
    password: Optional[str] = None
    rut: Optional[str] = None
    banco: Optional[str] = None
    tipo_cuenta: Optional[str] = None
    numero_cuenta: Optional[str] = None


class PickupOut(PickupBase):
    id: int
    seller_nombre: Optional[str] = None
    driver_nombre: Optional[str] = None
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# ── Recepciones Paquete ──

class RecepcionPaqueteOut(BaseModel):
    id: int
    pickup_id: int
    envio_id: Optional[int] = None
    fecha_recepcion: date
    semana: int
    mes: int
    anio: int
    pedido: str
    tipo: Optional[str] = None
    comision: int = 200
    procesado: bool = True
    error_msg: Optional[str] = None
    pickup_nombre: Optional[str] = None

    model_config = {"from_attributes": True}


# ── Retiros ──

class RetiroBase(BaseModel):
    fecha: date
    semana: int
    mes: int
    anio: int
    seller_id: Optional[int] = None
    driver_id: Optional[int] = None
    pickup_id: Optional[int] = None
    tarifa_seller: int = 0
    tarifa_driver: int = 0


class RetiroCreate(BaseModel):
    fecha: date
    semana: Optional[int] = None
    mes: Optional[int] = None
    anio: Optional[int] = None
    seller_id: Optional[int] = None
    pickup_id: Optional[int] = None
    sucursal_id: Optional[int] = None
    driver_id: int
    tarifa_seller: int = 0
    tarifa_driver: int = 0


class RetiroUpdate(BaseModel):
    fecha: Optional[date] = None
    seller_id: Optional[int] = None
    driver_id: Optional[int] = None
    tarifa_seller: Optional[int] = None
    tarifa_driver: Optional[int] = None


class RetiroOut(RetiroBase):
    id: int
    sucursal_id: Optional[int] = None
    seller_nombre: Optional[str] = None
    driver_nombre: Optional[str] = None
    pickup_nombre: Optional[str] = None
    sucursal_nombre: Optional[str] = None
    seller_nombre_raw: Optional[str] = None
    driver_nombre_raw: Optional[str] = None
    homologado: bool = True

    model_config = {"from_attributes": True}


# ── Dashboard ──

class DashboardStats(BaseModel):
    total_sellers: int
    total_drivers: int
    total_envios_mes: int
    total_cobrado_mes: int
    total_pagado_mes: int
    margen_mes: int
    envios_sin_homologar: int
    consultas_pendientes: int
    total_gastos_operacionales: int = 0
    margen_neto: int = 0
    total_sueldos_mes: int = 0
    total_imposiciones_mes: int = 0
    total_impuestos_mes: int = 0


# ── Finanzas ──

class CategoriaFinancieraBase(BaseModel):
    nombre: str
    tipo: str
    parent_id: Optional[int] = None
    activo: bool = True
    orden: int = 0

class CategoriaFinancieraCreate(CategoriaFinancieraBase):
    pass

class CategoriaFinancieraOut(CategoriaFinancieraBase):
    id: int
    hijos: List["CategoriaFinancieraOut"] = []
    model_config = {"from_attributes": True}

class MovimientoFinancieroBase(BaseModel):
    categoria_id: int
    nombre: str
    descripcion: Optional[str] = None
    monto: int
    moneda: str = "CLP"
    mes: int
    anio: int
    fecha_vencimiento: Optional[date] = None
    fecha_pago: Optional[date] = None
    estado: str = "PENDIENTE"
    recurrente: bool = False
    proveedor: Optional[str] = None
    notas: Optional[str] = None

class MovimientoFinancieroCreate(MovimientoFinancieroBase):
    pass

class MovimientoFinancieroUpdate(BaseModel):
    categoria_id: Optional[int] = None
    nombre: Optional[str] = None
    descripcion: Optional[str] = None
    monto: Optional[int] = None
    moneda: Optional[str] = None
    mes: Optional[int] = None
    anio: Optional[int] = None
    fecha_vencimiento: Optional[date] = None
    fecha_pago: Optional[date] = None
    estado: Optional[str] = None
    recurrente: Optional[bool] = None
    proveedor: Optional[str] = None
    notas: Optional[str] = None

class MovimientoFinancieroOut(MovimientoFinancieroBase):
    id: int
    categoria_nombre: Optional[str] = None
    categoria_tipo: Optional[str] = None
    documento_nombre: Optional[str] = None
    tiene_documento: bool = False
    created_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


# ── Trabajadores ──

class TrabajadorBase(BaseModel):
    nombre: str
    rut: Optional[str] = None
    email: Optional[str] = None
    direccion: Optional[str] = None
    cargo: Optional[str] = None
    sueldo_liquido: int = 0
    sueldo_base: int = 0
    gratificacion: int = 0
    sueldo_bruto: int = 0
    afp: Optional[str] = None
    costo_afp: int = 0
    sistema_salud: Optional[str] = None
    costo_salud: int = 0
    descuento_cesantia: int = 0
    iusc: int = 0
    adicional_isapre: int = 0
    banco: Optional[str] = None
    tipo_cuenta: Optional[str] = None
    numero_cuenta: Optional[str] = None
    fecha_ingreso: Optional[date] = None
    activo: bool = True
    movilizacion: int = 0
    colacion: int = 0
    viaticos: int = 0
    tipo_contrato: Optional[str] = None
    # Datos personales para contratos digitales / notificaciones
    telefono: Optional[str] = None
    whatsapp: Optional[str] = None
    fecha_nacimiento: Optional[date] = None
    nacionalidad: Optional[str] = None
    estado_civil: Optional[str] = None
    monto_cotizacion_salud: Optional[str] = None
    # Feriado progresivo (Art. 68 CT): años acreditados con empleadores anteriores
    anios_servicio_previos: int = 0
    # Jornada horaria predefinida (para contratos digitales)
    jornada_horaria_id: Optional[int] = None

class TrabajadorCreate(TrabajadorBase):
    pass

class TrabajadorUpdate(BaseModel):
    nombre: Optional[str] = None
    rut: Optional[str] = None
    email: Optional[str] = None
    direccion: Optional[str] = None
    cargo: Optional[str] = None
    sueldo_liquido: Optional[int] = None
    afp: Optional[str] = None
    sistema_salud: Optional[str] = None
    banco: Optional[str] = None
    tipo_cuenta: Optional[str] = None
    numero_cuenta: Optional[str] = None
    fecha_ingreso: Optional[date] = None
    activo: Optional[bool] = None
    movilizacion: Optional[int] = None
    colacion: Optional[int] = None
    viaticos: Optional[int] = None
    tipo_contrato: Optional[str] = None
    monto_cotizacion_salud: Optional[str] = None
    telefono: Optional[str] = None
    whatsapp: Optional[str] = None
    fecha_nacimiento: Optional[date] = None
    nacionalidad: Optional[str] = None
    estado_civil: Optional[str] = None
    anios_servicio_previos: Optional[int] = None
    jornada_horaria_id: Optional[int] = None

class TrabajadorOut(TrabajadorBase):
    id: int
    created_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


# ── Préstamos ──

class PrestamoCreate(BaseModel):
    tipo_beneficiario: str  # TRABAJADOR / DRIVER
    trabajador_id: Optional[int] = None
    driver_id: Optional[int] = None
    monto_total: int
    monto_cuota: int
    modalidad: str = "cuota_fija"
    porcentaje: Optional[int] = None
    mes_inicio: int
    anio_inicio: int
    motivo: Optional[str] = None

class PrestamoOut(BaseModel):
    id: int
    tipo_beneficiario: str
    trabajador_id: Optional[int] = None
    driver_id: Optional[int] = None
    beneficiario_nombre: Optional[str] = None
    monto_total: int
    monto_cuota: int
    saldo_pendiente: int
    modalidad: str
    porcentaje: Optional[int] = None
    mes_inicio: int
    anio_inicio: int
    motivo: Optional[str] = None
    estado: str
    cuotas_pagadas: int = 0
    cuotas_total: int = 0
    created_at: Optional[datetime] = None
    model_config = {"from_attributes": True}

class CuotaPrestamoOut(BaseModel):
    id: int
    prestamo_id: int
    mes: int
    anio: int
    monto: int
    pagado: bool
    fecha_pago: Optional[date] = None
    model_config = {"from_attributes": True}


# ── Contrato de Trabajo (drivers contratados) ──

class ContratoTrabajoAceptarRequest(BaseModel):
    nombre_completo: str
    rut: str
    firma_base64: str
    carnet_frontal: str
    carnet_trasero: str
    version: str = "1.0"


# ── Vacaciones Trabajadores ──

class VacacionCreate(BaseModel):
    trabajador_id: int
    fecha_inicio: date
    fecha_fin: date
    dias_habiles: int
    nota: Optional[str] = None

class VacacionOut(BaseModel):
    id: int
    trabajador_id: int
    fecha_inicio: date
    fecha_fin: date
    dias_habiles: int
    estado: str
    nota: Optional[str] = None
    created_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


# ── Colaboradores ──

class ColaboradorBase(BaseModel):
    nombre: str
    rut: Optional[str] = None
    email: Optional[str] = None
    telefono: Optional[str] = None
    especialidad: Optional[str] = None
    tags: List[str] = []
    banco: Optional[str] = None
    tipo_cuenta: Optional[str] = None
    numero_cuenta: Optional[str] = None
    descripcion_servicio: Optional[str] = None
    monto_acordado: Optional[int] = None
    frecuencia_pago: str = "mensual"
    fecha_inicio: Optional[date] = None
    fecha_fin: Optional[date] = None
    activo: bool = True
    cuenta_contable_id: Optional[int] = None
    categoria_financiera_id: Optional[int] = None


class ColaboradorCreate(ColaboradorBase):
    password: Optional[str] = None


class ColaboradorUpdate(BaseModel):
    nombre: Optional[str] = None
    rut: Optional[str] = None
    email: Optional[str] = None
    telefono: Optional[str] = None
    especialidad: Optional[str] = None
    tags: Optional[List[str]] = None
    banco: Optional[str] = None
    tipo_cuenta: Optional[str] = None
    numero_cuenta: Optional[str] = None
    descripcion_servicio: Optional[str] = None
    monto_acordado: Optional[int] = None
    frecuencia_pago: Optional[str] = None
    fecha_inicio: Optional[date] = None
    fecha_fin: Optional[date] = None
    activo: Optional[bool] = None
    cuenta_contable_id: Optional[int] = None
    categoria_financiera_id: Optional[int] = None
    password: Optional[str] = None


class ColaboradorOut(ColaboradorBase):
    id: int
    cuenta_contable_nombre: Optional[str] = None
    categoria_financiera_nombre: Optional[str] = None
    created_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


# ── Inquilinos ──

class InquilinoCreate(BaseModel):
    email: str
    plan: str
    tiene_reserva: bool = False
    monto_reserva: Optional[int] = None
    mes_gratis: bool = False
    password: Optional[str] = None


class CompletarPerfilIn(BaseModel):
    razon_social: str
    nombre_fantasia: Optional[str] = None
    rut_empresa: str
    direccion_empresa: str
    correo_empresa: str
    giro_empresa: Optional[str] = None
    nombre_rep_legal: str
    rut_rep_legal: str
    direccion_rep_legal: str
    correo_rep_legal: str
    correo_contacto: Optional[str] = None
    whatsapp: Optional[str] = None


class InquilinoUpdate(BaseModel):
    email: Optional[str] = None
    plan: Optional[str] = None
    tiene_reserva: Optional[bool] = None
    monto_reserva: Optional[int] = None
    mes_gratis: Optional[bool] = None
    activo: Optional[bool] = None
    razon_social: Optional[str] = None
    nombre_fantasia: Optional[str] = None
    rut_empresa: Optional[str] = None
    direccion_empresa: Optional[str] = None
    correo_empresa: Optional[str] = None
    giro_empresa: Optional[str] = None
    nombre_rep_legal: Optional[str] = None
    rut_rep_legal: Optional[str] = None
    direccion_rep_legal: Optional[str] = None
    correo_rep_legal: Optional[str] = None
    correo_contacto: Optional[str] = None
    whatsapp: Optional[str] = None
    password: Optional[str] = None


class InquilinoOut(BaseModel):
    id: int
    email: str
    plan: Optional[str] = None
    perfil_completado: bool
    activo: bool
    razon_social: Optional[str] = None
    nombre_fantasia: Optional[str] = None
    rut_empresa: Optional[str] = None
    direccion_empresa: Optional[str] = None
    correo_empresa: Optional[str] = None
    giro_empresa: Optional[str] = None
    nombre_rep_legal: Optional[str] = None
    rut_rep_legal: Optional[str] = None
    direccion_rep_legal: Optional[str] = None
    correo_rep_legal: Optional[str] = None
    correo_contacto: Optional[str] = None
    whatsapp: Optional[str] = None
    tiene_reserva: bool
    monto_reserva: Optional[int] = None
    mes_gratis: bool
    fecha_inicio_despliegue: Optional[date] = None
    mes_gratis_confirmado: Optional[bool] = None
    fecha_inicio_facturacion: Optional[date] = None
    contrato_firmado: bool
    primer_cobro_generado: bool
    created_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


class RegistrarDespliegueIn(BaseModel):
    fecha_inicio_despliegue: date
    mes_gratis_confirmado: bool


class DescuentoInquilinoCreate(BaseModel):
    monto: int
    motivo: str


class DescuentoInquilinoOut(BaseModel):
    id: int
    inquilino_id: int
    monto: int
    motivo: str
    aplicado: bool
    fecha_aplicacion: Optional[date] = None
    created_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


class GenerarCobrosIn(BaseModel):
    variable_valor: int
    archivo_adjunto_b64: Optional[str] = None
    archivo_adjunto_nombre: Optional[str] = None


class CobrosInquilinoOut(BaseModel):
    id: int
    inquilino_id: int
    mes: int
    anio: int
    variable_nombre: str
    variable_valor: int
    monto_neto: int
    iva: int
    total: int
    descuento_aplicado: int
    reserva_descontada: bool
    estado: str
    fecha_emision: Optional[date] = None
    fecha_vencimiento: Optional[date] = None
    folio_haulmer: Optional[str] = None
    pdf_factura_path: Optional[str] = None
    comprobante_pago_path: Optional[str] = None
    archivo_adjunto_path: Optional[str] = None
    movimiento_financiero_id: Optional[int] = None
    created_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


class AnexoContratoInquilinoOut(BaseModel):
    id: int
    inquilino_id: int
    tipo: str
    titulo: str
    requiere_firma_inquilino: bool
    estado: str
    firmado_at: Optional[datetime] = None
    plantilla_id: Optional[int] = None
    contenido_renderizado: Optional[str] = None
    comprobante_reserva_path: Optional[str] = None
    comprobante_reserva_aprobado: bool
    aprobado_por: Optional[str] = None
    aprobado_at: Optional[datetime] = None
    creado_por: Optional[str] = None
    created_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


class EmitirContratoInquilinoIn(BaseModel):
    plantilla_id: int
    titulo: Optional[str] = None


class FirmarAnexoInquilinoIn(BaseModel):
    firma_base64: str


# ── Configuración de planes Tracking Tech ─────────────────────────────────────

class ConfigPlanInquilinoOut(BaseModel):
    plan: str
    params: dict
    descripcion_contrato: Optional[str] = None
    updated_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


class ConfigPlanInquilinoUpdate(BaseModel):
    params: dict
    descripcion_contrato: Optional[str] = None


class ConfigPlanInquilinoCreate(BaseModel):
    plan: str
    params: dict
    descripcion_contrato: Optional[str] = None
