"""
API CPC (Control de Pagos a Conductores): control semanal de egresos a drivers.
"""
import io
import re
from datetime import date
from difflib import SequenceMatcher


def _parse_fecha(valor: str) -> date:
    valor = valor.strip()
    if "/" in valor:
        parts = valor.split("/")
        if len(parts) == 3 and len(parts[0]) <= 2:
            return date(int(parts[2]), int(parts[1]), int(parts[0]))
    return date.fromisoformat(valor)
from typing import Optional, List

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.auth import require_admin_or_administracion
from app.models import (
    Driver, Envio, Retiro, AjusteLiquidacion,
    PagoSemanaDriver, PagoCartola, CalendarioSemanas,
    CartolaCarga, TipoEntidadEnum, EstadoPagoEnum,
)
from app.services.liquidacion import _calcular_retiro_driver
from app.services.audit import registrar as audit
from app.services.contabilidad import asiento_pago_driver, asiento_pago_driver_cartola

# ---------------------------------------------------------------------------
# Datos fijos del emisor (E-Courier)
# ---------------------------------------------------------------------------
EMISOR_RUT = "77512163"
EMISOR_DV = "7"
EMISOR_NOMBRE = "LOGISTICA Y TRANSPORTE E-COURIER SPA"
EMISOR_BANCO_COD = "001"  # Banco de Chile = 001
EMISOR_CUENTA = "8012931700"
EMISOR_EMAIL = "hablemos@e-courier.cl"

# Códigos banco para el archivo TEF (Banco de Chile predeterminado)
BANCO_CODIGOS = {
    # Bancos tradicionales (códigos según listado oficial Banco de Chile)
    "banco de chile": "001",
    "banco internacional": "009",
    "scotiabank": "012",
    "banco scotiabank": "012",
    "scotiabank chile": "012",
    "banco bice": "014",
    "bice": "014",
    "banco estado": "016",
    "banco estado de chile": "016",
    "bancoestado": "016",
    "bci": "028",
    "banco bci": "028",
    "banco de credito e inversiones": "028",
    "itau": "031",
    "banco itau": "031",
    "itaú": "031",
    "itaucorpbanca": "031",
    "itau corpbanca": "031",
    "itaú corpbanca": "031",
    "corpbanca": "031",
    "security": "034",
    "banco security": "034",
    "santander": "037",
    "banco santander": "037",
    "santander chile": "037",
    "consorcio": "039",
    "banco consorcio": "039",
    "falabella": "402",
    "banco falabella": "402",
    "ripley": "403",
    "banco ripley": "403",
    # Fintech / billeteras digitales
    "coopeuch": "672",
    "prepago los heroes": "729",
    "prepago los héroes": "729",
    "tenpo": "730",        # Tenpo SpA — código TEF propio 730
    "copec pay": "741",    # CMPD S.A. — sponsor Banco Security
    "mercado pago": "875", # Mercado Pago Emisora S.A.
    "mercadopago": "875",
    "mach": "028",         # MACH by BCI — subproducto de BCI (código 028)
    "machbank": "028",
}

router = APIRouter(prefix="/cpc", tags=["CPC"])


class PagoDriverUpdate(BaseModel):
    estado: Optional[str] = None
    monto_override: Optional[int] = None
    nota: Optional[str] = None
    fecha_pago: Optional[str] = None


def _semanas_del_mes(db: Session, mes: int, anio: int) -> List[int]:
    rows = db.query(CalendarioSemanas.semana).filter(
        CalendarioSemanas.mes == mes,
        CalendarioSemanas.anio == anio,
    ).order_by(CalendarioSemanas.semana).all()
    if rows:
        return [r[0] for r in rows]
    return [1, 2, 3, 4, 5]


def _get_monto_semanal_driver(db: Session, driver_id: int, semana: int, mes: int, anio: int) -> int:
    """Subtotal neto semanal para un driver (coincide con liquidación)."""
    envios = db.query(Envio).filter(
        Envio.driver_id == driver_id,
        Envio.semana == semana,
        Envio.mes == mes,
        Envio.anio == anio,
    ).all()
    if not envios:
        return 0

    total_envios = sum(e.costo_driver + e.pago_extra_manual for e in envios)
    total_extras_producto = sum(e.extra_producto_driver for e in envios)
    total_extras_comuna = sum(e.extra_comuna_driver for e in envios)

    retiros = db.query(Retiro).filter(
        Retiro.driver_id == driver_id,
        Retiro.semana == semana, Retiro.mes == mes, Retiro.anio == anio,
    ).all()
    driver = db.get(Driver, driver_id)
    total_retiros = _calcular_retiro_driver(driver, retiros) if driver else sum(r.tarifa_driver for r in retiros)

    ajustes = db.query(AjusteLiquidacion).filter(
        AjusteLiquidacion.tipo == TipoEntidadEnum.DRIVER,
        AjusteLiquidacion.entidad_id == driver_id,
        AjusteLiquidacion.semana == semana,
        AjusteLiquidacion.mes == mes,
        AjusteLiquidacion.anio == anio,
    ).all()
    total_ajustes = sum(a.monto for a in ajustes)

    return total_envios + total_extras_producto + total_extras_comuna + total_retiros + total_ajustes


@router.get("/tabla")
def tabla_cpc(
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """
    Tabla mensual CPC agrupada por jefe de flota (Opción A).
    - Drivers con jefe: se consolidan bajo el jefe → 1 pago TEF al jefe.
    - Drivers sin jefe: aparecen individualmente.
    """
    semanas = _semanas_del_mes(db, mes, anio)
    drivers = db.query(Driver).filter(Driver.activo == True).order_by(Driver.nombre).all()

    def _build_driver_semanas(driver: Driver, es_jefe: bool = False) -> tuple[dict, int]:
        semanas_data = {}
        subtotal = 0
        for sem in semanas:
            pago = db.query(PagoSemanaDriver).filter(
                PagoSemanaDriver.driver_id == driver.id,
                PagoSemanaDriver.semana == sem,
                PagoSemanaDriver.mes == mes,
                PagoSemanaDriver.anio == anio,
            ).first()

            if pago and pago.monto_override is not None:
                monto = pago.monto_override
            elif es_jefe:
                monto = _get_monto_consolidado_driver(db, driver.id, sem, mes, anio)
            else:
                monto = _get_monto_semanal_driver(db, driver.id, sem, mes, anio)

            estado = pago.estado if pago else EstadoPagoEnum.PENDIENTE.value
            semanas_data[str(sem)] = {
                "monto_neto": monto,
                "estado": estado,
                "nota": pago.nota if pago else None,
                "fecha_pago": pago.fecha_pago.isoformat() if pago and pago.fecha_pago else None,
                "pago_id": pago.id if pago else None,
            }
            subtotal += monto
        return semanas_data, subtotal

    # Separar jefes y subordinados
    jefes: dict[int, Driver] = {}
    subordinados_por_jefe: dict[int, list[Driver]] = {}
    independientes: list[Driver] = []

    for driver in drivers:
        if driver.jefe_flota_id:
            jid = driver.jefe_flota_id
            if jid not in subordinados_por_jefe:
                subordinados_por_jefe[jid] = []
            subordinados_por_jefe[jid].append(driver)
        else:
            # Es jefe o independiente — se determina si tiene subordinados después
            pass

    for driver in drivers:
        if driver.id in subordinados_por_jefe:
            jefes[driver.id] = driver
        elif not driver.jefe_flota_id:
            independientes.append(driver)

    result = []

    # Jefes de flota: consolidan el monto de su flota completa
    for jefe_id, jefe in sorted(jefes.items(), key=lambda x: x[1].nombre):
        subs = subordinados_por_jefe.get(jefe_id, [])

        # Monto consolidado (jefe + subordinados) calculado en _build_driver_semanas con es_jefe=True
        semanas_consolidado, subtotal_consolidado = _build_driver_semanas(jefe, es_jefe=True)

        # Detalle de subordinados (para expandir en UI)
        detalle_subordinados = []
        for sub in sorted(subs, key=lambda d: d.nombre):
            sub_semanas, sub_subtotal = _build_driver_semanas(sub)
            if sub_subtotal > 0:
                detalle_subordinados.append({
                    "driver_id": sub.id,
                    "driver_nombre": sub.nombre,
                    "semanas": sub_semanas,
                    "subtotal_neto": sub_subtotal,
                })

        if subtotal_consolidado > 0:
            result.append({
                "driver_id": jefe.id,
                "driver_nombre": jefe.nombre,
                "rut": jefe.rut,
                "banco": jefe.banco,
                "tipo_cuenta": jefe.tipo_cuenta,
                "numero_cuenta": jefe.numero_cuenta,
                "es_jefe_flota": True,
                "semanas": semanas_consolidado,
                "subtotal_neto": subtotal_consolidado,
                "subordinados": detalle_subordinados,
            })

    # Drivers independientes (sin jefe ni subordinados)
    for driver in independientes:
        semanas_data, subtotal = _build_driver_semanas(driver)
        if subtotal > 0:
            result.append({
                "driver_id": driver.id,
                "driver_nombre": driver.nombre,
                "rut": driver.rut,
                "banco": driver.banco,
                "tipo_cuenta": driver.tipo_cuenta,
                "numero_cuenta": driver.numero_cuenta,
                "es_jefe_flota": False,
                "semanas": semanas_data,
                "subtotal_neto": subtotal,
                "subordinados": [],
            })

    # Ordenar por nombre
    result.sort(key=lambda r: r["driver_nombre"])

    return {"semanas_disponibles": semanas, "drivers": result}


def _get_monto_consolidado_driver(db: Session, driver_id: int, semana: int, mes: int, anio: int) -> int:
    """
    Monto total a pagar: si el driver es jefe de flota, incluye la suma de sus subordinados.
    Este es el monto real que se paga al jefe por toda su flota.
    """
    monto_propio = _get_monto_semanal_driver(db, driver_id, semana, mes, anio)
    subordinados = db.query(Driver).filter(
        Driver.jefe_flota_id == driver_id,
        Driver.activo == True,
    ).all()
    monto_subs = sum(_get_monto_semanal_driver(db, sub.id, semana, mes, anio) for sub in subordinados)
    return monto_propio + monto_subs


def _upsert_pago_semana(db: Session, driver_id: int, semana: int, mes: int, anio: int, estado: str = None, nota: str = None, monto_override: int = None, fecha_pago: str = None):
    """Crea o actualiza un PagoSemanaDriver. Retorna el registro.
    Si el estado cambia a PAGADO, crea un registro manual en PagoCartola.
    Si el estado cambia a PENDIENTE/INCOMPLETO, elimina el registro manual previo.
    """
    pago = db.query(PagoSemanaDriver).filter(
        PagoSemanaDriver.driver_id == driver_id,
        PagoSemanaDriver.semana == semana,
        PagoSemanaDriver.mes == mes,
        PagoSemanaDriver.anio == anio,
    ).first()
    estado_anterior = pago.estado if pago else None

    # Para jefes de flota, monto_neto = consolidado de su flota
    monto_sistema = _get_monto_consolidado_driver(db, driver_id, semana, mes, anio)
    if not pago:
        pago = PagoSemanaDriver(
            driver_id=driver_id,
            semana=semana, mes=mes, anio=anio,
            monto_neto=monto_sistema,
        )
        db.add(pago)
    if estado is not None:
        pago.estado = estado
    if monto_override is not None:
        pago.monto_override = monto_override
    if nota is not None:
        pago.nota = nota
    if fecha_pago is not None:
        pago.fecha_pago = _parse_fecha(fecha_pago) if isinstance(fecha_pago, str) else fecha_pago
    elif estado == EstadoPagoEnum.PAGADO.value and not pago.fecha_pago:
        pago.fecha_pago = date.today()
    if estado in (EstadoPagoEnum.PENDIENTE.value, EstadoPagoEnum.INCOMPLETO.value):
        pago.fecha_pago = None
    pago.monto_neto = monto_sistema

    fecha_pago_str = (pago.fecha_pago.isoformat() if pago.fecha_pago else date.today().isoformat())

    # Gestión de registro en PagoCartola al cambiar estado
    if estado is not None and estado != estado_anterior:
        if estado == EstadoPagoEnum.PAGADO.value:
            existe_manual = db.query(PagoCartola).filter(
                PagoCartola.driver_id == driver_id,
                PagoCartola.semana == semana,
                PagoCartola.mes == mes,
                PagoCartola.anio == anio,
                PagoCartola.fuente == "manual",
            ).first()
            if not existe_manual:
                db.add(PagoCartola(
                    driver_id=driver_id,
                    semana=semana,
                    mes=mes,
                    anio=anio,
                    monto=monto_sistema,
                    fecha_pago=fecha_pago_str,
                    descripcion="Pago emitido manual por administrador",
                    fuente="manual",
                ))
        elif estado in (EstadoPagoEnum.PENDIENTE.value, EstadoPagoEnum.INCOMPLETO.value):
            db.query(PagoCartola).filter(
                PagoCartola.driver_id == driver_id,
                PagoCartola.semana == semana,
                PagoCartola.mes == mes,
                PagoCartola.anio == anio,
                PagoCartola.fuente == "manual",
                PagoCartola.descripcion == "Pago emitido manual por administrador",
            ).delete()

    return pago


@router.put("/pago-semana/{driver_id}")
def actualizar_pago_semana_driver(
    driver_id: int,
    request: Request,
    semana: int = Query(...),
    mes: int = Query(...),
    anio: int = Query(...),
    body: PagoDriverUpdate = ...,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin_or_administracion),
):
    driver = db.get(Driver, driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver no encontrado")

    _upsert_pago_semana(
        db, driver_id, semana, mes, anio,
        estado=body.estado,
        monto_override=body.monto_override,
        nota=body.nota,
        fecha_pago=body.fecha_pago,
    )

    # Si es jefe de flota, propagar el estado a todos sus subordinados
    if body.estado is not None:
        subordinados = db.query(Driver).filter(
            Driver.jefe_flota_id == driver_id,
            Driver.activo == True,
        ).all()
        for sub in subordinados:
            _upsert_pago_semana(db, sub.id, semana, mes, anio, estado=body.estado, fecha_pago=body.fecha_pago)

    if body.estado == EstadoPagoEnum.PAGADO.value:
        # Fase 4: marcar envíos del driver como pagados
        driver_ids = [driver_id] + [s.id for s in db.query(Driver).filter(
            Driver.jefe_flota_id == driver_id, Driver.activo == True).all()]
        for did in driver_ids:
            for e in db.query(Envio).filter(
                Envio.driver_id == did, Envio.semana == semana,
                Envio.mes == mes, Envio.anio == anio, Envio.is_pagado_driver == False,
            ).all():
                e.is_pagado_driver = True
                e.sync_estado_financiero()

    if body.estado is not None:
        audit(db, "pago_manual_driver", usuario=current_user, request=request,
              entidad="pago_semana_driver", entidad_id=driver_id,
              cambios={"estado": {"antes": "—", "despues": body.estado}},
              metadata={"nombre": driver.nombre, "semana": semana, "mes": mes, "anio": anio, "monto": body.monto_override})

    if body.estado == EstadoPagoEnum.PAGADO.value:
        pago = db.query(PagoSemanaDriver).filter(
            PagoSemanaDriver.driver_id == driver_id,
            PagoSemanaDriver.semana == semana,
            PagoSemanaDriver.mes == mes,
            PagoSemanaDriver.anio == anio,
        ).first()
        if pago:
            asiento_pago_driver(db, pago)

    db.commit()
    return {"ok": True}


@router.put("/pago-semana-batch")
def actualizar_pagos_batch_driver(
    request: Request,
    mes: int = Query(...),
    anio: int = Query(...),
    body: List[dict] = ...,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin_or_administracion),
):
    """Batch update: [{driver_id, semana, estado?, monto_override?, nota?}, ...]"""
    updated = 0
    for item in body:
        driver_id = item.get("driver_id")
        semana = item.get("semana")
        if not driver_id or not semana:
            continue

        estado = item.get("estado")
        _upsert_pago_semana(
            db, driver_id, semana, mes, anio,
            estado=estado,
            monto_override=item.get("monto_override"),
            nota=item.get("nota"),
            fecha_pago=item.get("fecha_pago"),
        )

        # Propagar estado a subordinados si es jefe de flota
        if estado is not None:
            subordinados = db.query(Driver).filter(
                Driver.jefe_flota_id == driver_id,
                Driver.activo == True,
            ).all()
            for sub in subordinados:
                _upsert_pago_semana(db, sub.id, semana, mes, anio, estado=estado, fecha_pago=item.get("fecha_pago"))

        # Fase 4: marcar envíos como pagados
        if estado == EstadoPagoEnum.PAGADO.value:
            all_driver_ids = [driver_id] + [s.id for s in db.query(Driver).filter(
                Driver.jefe_flota_id == driver_id, Driver.activo == True).all()]
            for did in all_driver_ids:
                for e in db.query(Envio).filter(
                    Envio.driver_id == did, Envio.semana == semana,
                    Envio.mes == mes, Envio.anio == anio, Envio.is_pagado_driver == False,
                ).all():
                    e.is_pagado_driver = True
                    e.sync_estado_financiero()

        updated += 1

    for item in body:
        if item.get("estado") == EstadoPagoEnum.PAGADO.value and item.get("driver_id") and item.get("semana"):
            pago = db.query(PagoSemanaDriver).filter(
                PagoSemanaDriver.driver_id == item["driver_id"],
                PagoSemanaDriver.semana == item["semana"],
                PagoSemanaDriver.mes == mes,
                PagoSemanaDriver.anio == anio,
            ).first()
            if pago:
                asiento_pago_driver(db, pago)

    audit(db, "pago_batch_driver", usuario=current_user, request=request, entidad="pago_semana_driver", metadata={"mes": mes, "anio": anio, "cambios": len(body)})

    db.commit()
    return {"ok": True, "updated": updated}


@router.patch("/pago-semana/{pago_id}/fecha-pago")
def actualizar_fecha_pago_driver(
    pago_id: int,
    body: dict,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Actualiza la fecha_pago de un PagoSemanaDriver existente."""
    pago = db.get(PagoSemanaDriver, pago_id)
    if not pago:
        raise HTTPException(status_code=404, detail="Pago no encontrado")
    nueva_fecha = body.get("fecha_pago")
    if not nueva_fecha:
        raise HTTPException(status_code=400, detail="fecha_pago requerida")
    pago.fecha_pago = _parse_fecha(nueva_fecha)
    # Sincronizar con PagoCartola manual si existe
    cartola_manual = db.query(PagoCartola).filter(
        PagoCartola.driver_id == pago.driver_id,
        PagoCartola.semana == pago.semana,
        PagoCartola.mes == pago.mes,
        PagoCartola.anio == pago.anio,
        PagoCartola.fuente == "manual",
    ).first()
    if cartola_manual:
        cartola_manual.fecha_pago = nueva_fecha
    db.commit()
    return {"ok": True, "fecha_pago": pago.fecha_pago.isoformat()}


# ---------------------------------------------------------------------------
# Helpers TEF
# ---------------------------------------------------------------------------

def _get_banco_codigo(banco_nombre: Optional[str]) -> str:
    if not banco_nombre:
        return "001"
    return BANCO_CODIGOS.get(banco_nombre.lower().strip(), "001")


def _normalizar_rut(rut: Optional[str]) -> tuple[str, str]:
    """Retorna (rut_sin_puntos_sin_dv, dv)."""
    if not rut:
        return ("00000000", "0")
    clean = re.sub(r"[.\s]", "", rut.upper().strip())
    if "-" in clean:
        partes = clean.split("-")
        return (partes[0], partes[1])
    if len(clean) > 1:
        return (clean[:-1], clean[-1])
    return (clean, "0")


def _generar_linea_tef(seq: int, driver: Driver, monto: int) -> str:
    """
    Genera una línea del archivo TEF Banco de Chile (Formato Predeterminado oficial).
    Largo total: 219 caracteres + CRLF.

    Pos  1- 3  Tipo Operación (3):  TOB=otro banco, TEC=Banco de Chile
    Pos  4-13  RUT Cliente/Emisor (10): derecha, ceros
    Pos 14-25  Cuenta de Cargo (12): derecha, ceros
    Pos 26-35  RUT Beneficiario (10): derecha, ceros  (rutNum+DV sin puntos)
    Pos 36-65  Nombre Beneficiario (30): izquierda, espacios
    Pos 66-83  Cuenta Beneficiario (18): izquierda, espacios
    Pos 84-93  RUT Banco Beneficiario (10): derecha, ceros
    Pos 94-104 Monto (11): derecha, ceros
    Pos 105    Abono Inmediato (1): espacio
    Pos 106-135 Motivo (30): izquierda, espacios
    Pos 136    Notificación email (1): "1"
    Pos 137-166 Asunto email (30): izquierda, espacios
    Pos 167-216 Dirección email (50): izquierda, espacios
    Pos 217-219 Tipo de Cuenta (3): CTD=corriente, JUV=vista/ahorro
    """
    # Tipo operación: TOB si el banco destino es distinto de Banco de Chile
    banco_destino_cod = _get_banco_codigo(driver.banco)
    tipo_op = "TEC" if banco_destino_cod == "001" else "TOB"

    # RUT emisor sin DV + DV → concatenados → zfill(10)
    rut_cliente = (EMISOR_RUT + EMISOR_DV).zfill(10)

    # Cuenta de cargo (12, derecha, ceros)
    cuenta_cargo = re.sub(r"\D", "", EMISOR_CUENTA).zfill(12)[:12]

    # RUT beneficiario: numeros+DV sin puntos → zfill(10)
    rut_num, rut_dv = _normalizar_rut(driver.rut)
    rut_benef = (rut_num + rut_dv).zfill(10)

    # Nombre beneficiario (30, izquierda, espacios)
    nombre = (driver.nombre or "").upper()[:30].ljust(30)

    # Cuenta beneficiario (18, izquierda, espacios) — solo dígitos
    cuenta_benef_raw = re.sub(r"\D", "", driver.numero_cuenta or "")
    # Banco Estado Vista (Cuenta RUT): el número de cuenta es el RUT con DV.
    # Si registraron solo los dígitos del RUT sin DV, completamos automáticamente.
    if not cuenta_benef_raw or (
        banco_destino_cod == "016"
        and (driver.tipo_cuenta or "").lower().strip() in ("vista", "cuenta vista")
        and cuenta_benef_raw == re.sub(r"\D", "", rut_num)
    ):
        cuenta_benef_raw = rut_num + rut_dv
    cuenta_benef = cuenta_benef_raw.ljust(18)[:18]

    # RUT banco beneficiario — RUT oficial del banco como persona jurídica (10, derecha, ceros)
    BANCO_RUTS = {
        "001": "0970040005",  # Banco de Chile           97.004.000-5
        "009": "0970110003",  # Banco Internacional      97.011.000-3
        "012": "0970320008",  # Scotiabank Chile         97.032.000-8
        "014": "097080000K",  # Banco BICE               97.080.000-K
        "016": "0970300007",  # Banco Estado de Chile    97.030.000-7
        "028": "0970060006",  # BCI                      97.006.000-6
        "031": "0970230009",  # Itaú CorpBanca           97.023.000-9
        "034": "0970530002",  # Banco Security           97.053.000-2
        "037": "097036000K",  # Banco Santander          97.036.000-K
        "039": "0966527005",  # Banco Consorcio          96.652.700-5
        "402": "0965096604",  # Banco Falabella          96.509.660-4
        "403": "0979470002",  # Banco Ripley             97.947.000-2
        "672": "0855860000",  # Coopeuch                 85.586.000-0
        "729": "0762609309",  # Prepago Los Héroes       76.260.930-9
        "730": "0769676929",  # Tenpo Payments S.A.      76.967.692-9
        "741": "0970530002",  # Copec Pay → RUT Banco Security (sponsor) 97.053.000-2
        "875": "0762838641",  # Mercado Pago Emisora S.A. 76.283.864-1
    }
    rut_banco_benef = BANCO_RUTS.get(banco_destino_cod, "0970040005")

    # Monto (11, derecha, ceros)
    monto_str = str(monto).zfill(11)[:11]

    # Abono inmediato (1 espacio en blanco)
    abono = " "

    # Motivo (30, izquierda, espacios)
    motivo = "PAGO CONDUCTOR".ljust(30)[:30]

    # Notificación email (1)
    notif = "1"

    # Asunto (30, izquierda, espacios)
    asunto = "Pago eCourier".ljust(30)[:30]

    # Email beneficiario (50, izquierda, espacios)
    email_benef = (driver.email or "").ljust(50)[:50]

    # Tipo de cuenta (3): CTD=corriente, JUV=vista o ahorro
    tipo_raw = (driver.tipo_cuenta or "").lower().strip()
    tipo_cuenta = "CTD" if "corriente" in tipo_raw else "JUV"

    linea = (
        f"{tipo_op}"          # 1-3   Tipo Operación       (3)
        f"{rut_cliente}"      # 4-13  RUT Cliente          (10)
        f"{cuenta_cargo}"     # 14-25 Cuenta Cargo         (12)
        f"{rut_benef}"        # 26-35 RUT Beneficiario     (10)
        f"{nombre}"           # 36-65 Nombre Beneficiario  (30)
        f"{cuenta_benef}"     # 66-83 Cuenta Beneficiario  (18)
        f"{rut_banco_benef}"  # 84-93 RUT Banco Benef.     (10)
        f"{monto_str}"        # 94-104 Monto               (11)
        f"{abono}"            # 105   Abono Inmediato      (1)
        f"{motivo}"           # 106-135 Motivo             (30)
        f"{notif}"            # 136   Notif email          (1)
        f"{asunto}"           # 137-166 Asunto             (30)
        f"{email_benef}"      # 167-216 Email              (50)
        # Tipo de Cuenta (CTD/JUV) solo para TOB (otros bancos), NO para TEC (Banco de Chile)
        + (tipo_cuenta if tipo_op == "TOB" else "")  # 217-219 (solo TOB)
        + "\r\n"
    )
    return linea


# ---------------------------------------------------------------------------
# Endpoint: generar planilla TEF
# ---------------------------------------------------------------------------

class ItemTEF(BaseModel):
    driver_id: int
    monto: int


class GenerarTEFRequest(BaseModel):
    semana: int
    mes: int
    anio: int
    items: List[ItemTEF]


@router.post("/generar-tef")
def generar_tef(
    body: GenerarTEFRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin_or_administracion),
):
    """Genera el archivo .TXT TEF Banco de Chile para los drivers seleccionados."""
    lineas = []
    total_monto = 0
    for idx, item in enumerate(body.items, start=1):
        driver = db.get(Driver, item.driver_id)
        if not driver:
            continue
        lineas.append(_generar_linea_tef(idx, driver, item.monto))
        total_monto += item.monto

    contenido = "".join(lineas)
    hoy = date.today().strftime("%Y%m%d")
    filename = f"TEF_ECourier_{hoy}_S{body.semana}.txt"

    audit(db, "generar_tef", usuario=current_user, request=request, entidad="tef", metadata={"semana": body.semana, "mes": body.mes, "anio": body.anio, "drivers": len(body.items), "monto_total": sum(it.monto for it in body.items)})
    db.commit()

    return StreamingResponse(
        io.BytesIO(contenido.encode("latin-1", errors="replace")),
        media_type="text/plain; charset=latin-1",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Helpers cartola
# ---------------------------------------------------------------------------

def _similaridad(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def _extraer_nombre_cartola(descripcion: str) -> str:
    """De 'Traspaso A: Diego Santander Driver' extrae 'Diego Santander Driver'."""
    for prefijo in ["traspaso a:", "traspaso de:", "app-traspaso a:", "app-traspaso de:"]:
        if descripcion.lower().startswith(prefijo):
            return descripcion[len(prefijo):].strip()
    return descripcion.strip()


def _parsear_cartola(archivo_bytes: bytes) -> list[dict]:
    """
    Lee el .xls/.xlsx de cartola Banco de Chile.
    Retorna lista de {fecha, descripcion, monto, nombre_extraido}.
    Solo incluye cargos de "Traspaso A:" (pagos emitidos a terceros).
    """
    try:
        df = pd.read_excel(io.BytesIO(archivo_bytes), header=None)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"No se pudo leer el archivo: {exc}")

    # Buscar fila de encabezado que contenga "Fecha" y "Cargos"
    header_row = None
    for i, row in df.iterrows():
        vals = [str(v).strip().lower() for v in row.values]
        if any("fecha" in v for v in vals) and any("cargos" in v for v in vals):
            header_row = i
            break

    if header_row is None:
        raise HTTPException(status_code=400, detail="No se encontró encabezado de movimientos en la cartola.")

    # Detectar índices de columnas por posición en la fila de encabezado
    header_vals = [str(df.iloc[header_row, c]).strip().lower() for c in range(df.shape[1])]
    idx_fecha = next((i for i, v in enumerate(header_vals) if "fecha" in v), None)
    idx_desc  = next((i for i, v in enumerate(header_vals) if "descripci" in v), None)
    idx_cargos = next((i for i, v in enumerate(header_vals) if "cargos" in v), None)

    if idx_cargos is None:
        raise HTTPException(status_code=400, detail="No se encontró columna de Cargos en la cartola.")

    movimientos = []
    for i in range(header_row + 1, len(df)):
        row = df.iloc[i]

        # Monto en columna de cargos
        monto_raw = row.iloc[idx_cargos] if idx_cargos < len(row) else None
        try:
            monto = int(float(str(monto_raw).replace(".", "").replace(",", ".")))
        except Exception:
            continue
        if monto <= 0:
            continue

        desc = str(row.iloc[idx_desc]).strip() if idx_desc is not None else ""
        if not desc or desc.lower() in ("nan", ""):
            continue

        # Solo incluir traspasos emitidos (pagos a drivers)
        desc_lower = desc.lower()
        if not any(desc_lower.startswith(p) for p in [
            "traspaso a:", "app-traspaso a:", "transferencia a:", "app-transferencia a:"
        ]):
            continue

        fecha = str(row.iloc[idx_fecha]).strip() if idx_fecha is not None else ""
        nombre = _extraer_nombre_cartola(desc)
        movimientos.append({
            "fecha": fecha,
            "descripcion": desc,
            "nombre_extraido": nombre,
            "monto": monto,
        })

    return movimientos


# ---------------------------------------------------------------------------
# Endpoint: preview cartola
# ---------------------------------------------------------------------------

@router.post("/cartola/preview")
async def cartola_preview(
    semana: int = Query(...),
    mes: int = Query(...),
    anio: int = Query(...),
    archivo: UploadFile = File(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """
    Parsea la cartola bancaria y retorna un preview con los matches propuestos.
    Busca matches en nombre principal y aliases del driver.
    No graba nada en BD.
    """
    contenido = await archivo.read()
    movimientos = _parsear_cartola(contenido)

    drivers = db.query(Driver).filter(Driver.activo == True).all()

    # Pagos ya registrados esta semana (para mostrar acumulado)
    pagados_existentes: dict[int, int] = {}
    for p in db.query(PagoCartola).filter(
        PagoCartola.semana == semana,
        PagoCartola.mes == mes,
        PagoCartola.anio == anio,
    ).all():
        pagados_existentes[p.driver_id] = pagados_existentes.get(p.driver_id, 0) + p.monto

    resultado = []
    for mov in movimientos:
        nombre_norm = mov["nombre_extraido"].lower()
        mejor_driver = None
        mejor_score = 0.0

        for d in drivers:
            # Buscar contra nombre principal
            score = _similaridad(nombre_norm, d.nombre.lower())
            # Buscar contra cada alias — tomar el mejor
            for alias in (d.aliases or []):
                s = _similaridad(nombre_norm, alias.lower())
                if s > score:
                    score = s
            if score > mejor_score:
                mejor_score = score
                mejor_driver = d

        match_confiable = mejor_score >= 0.55

        ya_pagado = pagados_existentes.get(mejor_driver.id, 0) if mejor_driver else 0
        liquidado = _get_monto_semanal_driver(db, mejor_driver.id, semana, mes, anio) if mejor_driver else 0

        resultado.append({
            "descripcion": mov["descripcion"],
            "nombre_extraido": mov["nombre_extraido"],
            "fecha": mov["fecha"],
            "monto": mov["monto"],
            "driver_id": mejor_driver.id if mejor_driver else None,
            "driver_nombre": mejor_driver.nombre if mejor_driver else None,
            "score": round(mejor_score, 2),
            "match_confiable": match_confiable,
            "ya_pagado": ya_pagado,
            "liquidado": liquidado,
        })

    # Devolver también la lista de todos los drivers para el dropdown de edición
    todos_drivers = [{"id": d.id, "nombre": d.nombre} for d in sorted(drivers, key=lambda x: x.nombre)]

    return {"semana": semana, "mes": mes, "anio": anio, "items": resultado, "drivers": todos_drivers}


# ---------------------------------------------------------------------------
# Endpoint: confirmar cartola
# ---------------------------------------------------------------------------

class ItemConfirmarCartola(BaseModel):
    driver_id: int
    monto: int
    fecha: Optional[str] = None
    descripcion: Optional[str] = None
    nombre_extraido: Optional[str] = None  # Para guardar como alias


class ConfirmarCartolaRequest(BaseModel):
    semana: int
    mes: int
    anio: int
    items: List[ItemConfirmarCartola]


@router.post("/cartola/confirmar")
def cartola_confirmar(
    body: ConfirmarCartolaRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin_or_administracion),
):
    """
    Graba los pagos confirmados desde la cartola en BD.
    Guarda nombre_extraido como alias del driver si no existe ya.
    """
    carga = CartolaCarga(
        tipo="driver", archivo_nombre="cartola_bancaria",
        usuario_id=current_user.get("id"), usuario_nombre=current_user.get("nombre"),
        mes=body.mes, anio=body.anio,
        total_transacciones=len(body.items),
        matcheadas=len(body.items),
        no_matcheadas=0,
        monto_total=sum(it.monto for it in body.items),
    )
    db.add(carga)
    db.flush()

    grabados = 0
    for item in body.items:
        if item.driver_id <= 0 or item.monto <= 0:
            continue
        pago = PagoCartola(
            driver_id=item.driver_id,
            semana=body.semana,
            mes=body.mes,
            anio=body.anio,
            monto=item.monto,
            fecha_pago=item.fecha,
            descripcion=item.descripcion,
            fuente="cartola",
            carga_id=carga.id,
        )
        db.add(pago)
        grabados += 1

        # Propagar estado PAGADO y fecha_pago al PagoSemanaDriver
        pago_sem = db.query(PagoSemanaDriver).filter(
            PagoSemanaDriver.driver_id == item.driver_id,
            PagoSemanaDriver.semana == body.semana,
            PagoSemanaDriver.mes == body.mes,
            PagoSemanaDriver.anio == body.anio,
        ).first()
        if not pago_sem:
            monto_sistema = _get_monto_semanal_driver(db, item.driver_id, body.semana, body.mes, body.anio)
            pago_sem = PagoSemanaDriver(
                driver_id=item.driver_id, semana=body.semana,
                mes=body.mes, anio=body.anio, monto_neto=monto_sistema,
            )
            db.add(pago_sem)
        pago_sem.estado = EstadoPagoEnum.PAGADO.value
        if item.fecha:
            pago_sem.fecha_pago = _parse_fecha(item.fecha) if isinstance(item.fecha, str) else item.fecha
        elif not pago_sem.fecha_pago:
            pago_sem.fecha_pago = date.today()

        # Guardar alias si viene nombre_extraido y no coincide exactamente con el nombre del driver
        if item.nombre_extraido:
            driver = db.get(Driver, item.driver_id)
            if driver:
                alias_nuevo = item.nombre_extraido.strip()
                alias_lower = alias_nuevo.lower()
                nombre_lower = driver.nombre.lower()
                aliases_actuales = [a.lower() for a in (driver.aliases or [])]
                # Solo agregar si no es el nombre principal ni ya existe como alias
                if alias_lower != nombre_lower and alias_lower not in aliases_actuales:
                    driver.aliases = list(driver.aliases or []) + [alias_nuevo]

    db.flush()
    for pago_c in db.query(PagoCartola).filter(PagoCartola.carga_id == carga.id).all():
        asiento_pago_driver_cartola(db, pago_c)

    audit(db, "carga_cartola_driver", usuario=current_user, request=request, entidad="cartola_carga", entidad_id=carga.id, metadata={"mes": body.mes, "anio": body.anio, "transacciones": len(body.items), "monto_total": sum(it.monto for it in body.items)})

    db.commit()
    return {"ok": True, "grabados": grabados}


# ---------------------------------------------------------------------------
# Endpoint: pagos acumulados por semana/driver
# ---------------------------------------------------------------------------

@router.get("/pagos-acumulados")
def pagos_acumulados(
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """
    Retorna monto total pagado por driver_id y semana para el mes/año dado.
    { driver_id: { "1": monto, "2": monto, ... } }
    """
    rows = db.query(
        PagoCartola.driver_id,
        PagoCartola.semana,
        func.sum(PagoCartola.monto).label("total"),
    ).filter(
        PagoCartola.mes == mes,
        PagoCartola.anio == anio,
    ).group_by(PagoCartola.driver_id, PagoCartola.semana).all()

    resultado: dict[str, dict[str, int]] = {}
    for r in rows:
        did = str(r.driver_id)
        sem = str(r.semana)
        if did not in resultado:
            resultado[did] = {}
        resultado[did][sem] = r.total

    return resultado


# ---------------------------------------------------------------------------
# Endpoint: total pagado (para dashboard)
# ---------------------------------------------------------------------------

@router.get("/total-pagado")
def total_pagado_mes(
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    total = db.query(func.sum(PagoCartola.monto)).filter(
        PagoCartola.mes == mes,
        PagoCartola.anio == anio,
    ).scalar() or 0
    return {"total_pagado": total}
