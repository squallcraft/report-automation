from typing import Optional, List

from pydantic import BaseModel
from datetime import date, datetime
from enum import Enum


class EmpresaEnum(str, Enum):
    ECOURIER = "ECOURIER"
    TERCERIZADO = "TERCERIZADO"
    OVIEDO = "OVIEDO"


class TipoEntidadEnum(str, Enum):
    SELLER = "SELLER"
    DRIVER = "DRIVER"


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
    rut: Optional[str] = None
    giro: Optional[str] = None
    activo: bool = True
    email: Optional[str] = None


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
    rut: Optional[str] = None
    giro: Optional[str] = None
    activo: Optional[bool] = None
    email: Optional[str] = None
    password: Optional[str] = None


class SellerOut(SellerBase):
    id: int
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# ── Drivers ──

class DriverBase(BaseModel):
    nombre: str
    aliases: List[str] = []
    tarifa_ecourier: int = 1700
    tarifa_oviedo: int = 1800
    tarifa_tercerizado: int = 1500
    jefe_flota_id: Optional[int] = None
    rut: Optional[str] = None
    banco: Optional[str] = None
    tipo_cuenta: Optional[str] = None
    numero_cuenta: Optional[str] = None
    activo: bool = True
    email: Optional[str] = None


class DriverCreate(DriverBase):
    password: Optional[str] = None


class DriverUpdate(BaseModel):
    nombre: Optional[str] = None
    aliases: Optional[List[str]] = None
    tarifa_ecourier: Optional[int] = None
    tarifa_oviedo: Optional[int] = None
    tarifa_tercerizado: Optional[int] = None
    jefe_flota_id: Optional[int] = None
    rut: Optional[str] = None
    banco: Optional[str] = None
    tipo_cuenta: Optional[str] = None
    numero_cuenta: Optional[str] = None
    activo: Optional[bool] = None
    email: Optional[str] = None
    password: Optional[str] = None


class DriverOut(DriverBase):
    id: int
    jefe_flota_nombre: Optional[str] = None
    subordinados_count: int = 0
    created_at: Optional[datetime] = None

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
    seller_nombre: Optional[str] = None
    driver_nombre: Optional[str] = None

    model_config = {"from_attributes": True}


class EnvioUpdate(BaseModel):
    cobro_extra_manual: Optional[int] = None
    pago_extra_manual: Optional[int] = None


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


# ── Retiros ──

class RetiroBase(BaseModel):
    fecha: date
    semana: int
    mes: int
    anio: int
    seller_id: int
    driver_id: int
    tarifa_seller: int = 0
    tarifa_driver: int = 0


class RetiroCreate(RetiroBase):
    pass


class RetiroOut(RetiroBase):
    id: int
    seller_nombre: Optional[str] = None
    driver_nombre: Optional[str] = None
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
