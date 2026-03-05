"""
API CPC (Control de Pagos a Conductores): control semanal de egresos a drivers.
"""
import io
import re
from datetime import date
from difflib import SequenceMatcher
from typing import Optional, List

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.auth import require_admin_or_administracion
from app.models import (
    Driver, Envio, Retiro, AjusteLiquidacion,
    PagoSemanaDriver, PagoCartola, CalendarioSemanas,
    TipoEntidadEnum, EstadoPagoEnum,
)

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
    "banco de chile": "001",
    "bci": "016",
    "banco estado": "012",
    "banco estado de chile": "012",
    "santander": "037",
    "itau": "039",
    "scotiabank": "014",
    "security": "049",
    "falabella": "051",
    "ripley": "053",
    "consorcio": "055",
    "coopeuch": "672",
}

router = APIRouter(prefix="/cpc", tags=["CPC"])


class PagoDriverUpdate(BaseModel):
    estado: Optional[str] = None
    monto_override: Optional[int] = None
    nota: Optional[str] = None


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
    total_retiros = sum(r.tarifa_driver for r in retiros)

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

    def _build_driver_semanas(driver: Driver) -> tuple[dict, int]:
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
            else:
                monto = _get_monto_semanal_driver(db, driver.id, sem, mes, anio)

            estado = pago.estado if pago else EstadoPagoEnum.PENDIENTE.value
            semanas_data[str(sem)] = {
                "monto_neto": monto,
                "estado": estado,
                "nota": pago.nota if pago else None,
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

        # Sumar semanas de todos los subordinados
        semanas_consolidado: dict[str, dict] = {str(s): {"monto_neto": 0, "estado": EstadoPagoEnum.PENDIENTE.value, "nota": None} for s in semanas}
        subtotal_consolidado = 0

        detalle_subordinados = []
        for sub in sorted(subs, key=lambda d: d.nombre):
            sub_semanas, sub_subtotal = _build_driver_semanas(sub)
            for sem in semanas:
                semanas_consolidado[str(sem)]["monto_neto"] += sub_semanas[str(sem)]["monto_neto"]
            subtotal_consolidado += sub_subtotal
            if sub_subtotal > 0:
                detalle_subordinados.append({
                    "driver_id": sub.id,
                    "driver_nombre": sub.nombre,
                    "semanas": sub_semanas,
                    "subtotal_neto": sub_subtotal,
                })

        # El estado consolidado usa el pago registrado al jefe (si existe)
        for sem in semanas:
            pago_jefe = db.query(PagoSemanaDriver).filter(
                PagoSemanaDriver.driver_id == jefe.id,
                PagoSemanaDriver.semana == sem,
                PagoSemanaDriver.mes == mes,
                PagoSemanaDriver.anio == anio,
            ).first()
            if pago_jefe:
                semanas_consolidado[str(sem)]["estado"] = pago_jefe.estado
                semanas_consolidado[str(sem)]["nota"] = pago_jefe.nota

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


@router.put("/pago-semana/{driver_id}")
def actualizar_pago_semana_driver(
    driver_id: int,
    semana: int = Query(...),
    mes: int = Query(...),
    anio: int = Query(...),
    body: PagoDriverUpdate = ...,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    driver = db.get(Driver, driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver no encontrado")

    pago = db.query(PagoSemanaDriver).filter(
        PagoSemanaDriver.driver_id == driver_id,
        PagoSemanaDriver.semana == semana,
        PagoSemanaDriver.mes == mes,
        PagoSemanaDriver.anio == anio,
    ).first()

    monto_sistema = _get_monto_semanal_driver(db, driver_id, semana, mes, anio)

    if not pago:
        pago = PagoSemanaDriver(
            driver_id=driver_id,
            semana=semana, mes=mes, anio=anio,
            monto_neto=monto_sistema,
        )
        db.add(pago)

    if body.estado is not None:
        pago.estado = body.estado
    if body.monto_override is not None:
        pago.monto_override = body.monto_override
    if body.nota is not None:
        pago.nota = body.nota
    pago.monto_neto = monto_sistema

    db.commit()
    return {"ok": True}


@router.put("/pago-semana-batch")
def actualizar_pagos_batch_driver(
    mes: int = Query(...),
    anio: int = Query(...),
    body: List[dict] = ...,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Batch update: [{driver_id, semana, estado?, monto_override?, nota?}, ...]"""
    updated = 0
    for item in body:
        driver_id = item.get("driver_id")
        semana = item.get("semana")
        if not driver_id or not semana:
            continue

        pago = db.query(PagoSemanaDriver).filter(
            PagoSemanaDriver.driver_id == driver_id,
            PagoSemanaDriver.semana == semana,
            PagoSemanaDriver.mes == mes,
            PagoSemanaDriver.anio == anio,
        ).first()

        monto_sistema = _get_monto_semanal_driver(db, driver_id, semana, mes, anio)

        if not pago:
            pago = PagoSemanaDriver(
                driver_id=driver_id,
                semana=semana, mes=mes, anio=anio,
                monto_neto=monto_sistema,
            )
            db.add(pago)

        if "monto_override" in item:
            pago.monto_override = item["monto_override"]
        if "estado" in item:
            pago.estado = item["estado"]
        if "nota" in item:
            pago.nota = item["nota"]
        pago.monto_neto = monto_sistema
        updated += 1

    db.commit()
    return {"ok": True, "updated": updated}


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
    Genera una línea del archivo TEF Banco de Chile (formato predeterminado).
    Campos de ancho fijo según especificación:
      pos 1-3   : código banco destino (3)
      pos 4-12  : RUT sin DV del beneficiario (9, cero a la izq)
      pos 13    : DV del beneficiario (1)
      pos 14-53 : Nombre beneficiario (40, espacios a la der)
      pos 54-62 : N° cuenta destino (9, cero a la izq)  — se extiende si es más largo
      pos 55-63 (ajuste): tipo cuenta (1): 1=cta cte, 2=ahorro, 3=vista
      pos 64-76 : monto (13, cero a la izq, en pesos sin decimales)
      pos 77-86 : email (40)
      pos 117-119: código banco origen (3)
      pos 120-128: RUT sin DV origen (9)
      pos 129   : DV origen (1)
      pos 130-168: N° cuenta origen (9 → usamos 10 dígitos)
      NOTA: usamos formato simplificado compatible con Banco de Chile estándar.
    """
    banco_cod = _get_banco_codigo(driver.banco)
    rut_num, rut_dv = _normalizar_rut(driver.rut)

    tipo_map = {"corriente": "1", "cta corriente": "1", "ahorro": "2", "vista": "3", "cta vista": "3"}
    tipo_cod = tipo_map.get((driver.tipo_cuenta or "").lower().strip(), "1")

    cuenta_dst = re.sub(r"\D", "", driver.numero_cuenta or "0").zfill(9)[:9]
    nombre = (driver.nombre or "").upper()[:40].ljust(40)
    monto_str = str(monto).zfill(13)
    email = (EMISOR_EMAIL).ljust(40)[:40]

    rut_orig = EMISOR_RUT.zfill(9)
    cuenta_orig = EMISOR_CUENTA.zfill(9)[:9]

    linea = (
        f"{banco_cod}"           # 3  banco destino
        f"{rut_num.zfill(9)}"    # 9  rut beneficiario
        f"{rut_dv}"              # 1  dv beneficiario
        f"{nombre}"              # 40 nombre
        f"{cuenta_dst}"          # 9  cuenta destino
        f"{tipo_cod}"            # 1  tipo cuenta
        f"{monto_str}"           # 13 monto
        f"{email}"               # 40 email beneficiario
        f"{EMISOR_BANCO_COD}"    # 3  banco origen
        f"{rut_orig}"            # 9  rut origen
        f"{EMISOR_DV}"           # 1  dv origen
        f"{cuenta_orig}"         # 9  cuenta origen
        "\r\n"
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
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
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
    Solo cargos (pagos hechos, columna Cargos > 0).
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

    df.columns = [str(df.iloc[header_row, c]).strip() for c in range(df.shape[1])]
    df = df.iloc[header_row + 1:].reset_index(drop=True)

    # Detectar columnas relevantes por nombre aproximado
    col_fecha = next((c for c in df.columns if "fecha" in c.lower()), None)
    col_desc = next((c for c in df.columns if "descripci" in c.lower()), None)
    col_cargos = next((c for c in df.columns if "cargos" in c.lower()), None)

    if not col_cargos:
        raise HTTPException(status_code=400, detail="No se encontró columna de Cargos en la cartola.")

    movimientos = []
    for _, row in df.iterrows():
        monto_raw = row.get(col_cargos, None)
        try:
            monto = int(float(str(monto_raw).replace(".", "").replace(",", ".")))
        except Exception:
            continue
        if monto <= 0:
            continue

        desc = str(row.get(col_desc, "")).strip()
        if not desc or desc.lower() in ("nan", ""):
            continue

        fecha = str(row.get(col_fecha, "")).strip() if col_fecha else ""
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
    No graba nada en BD.
    """
    contenido = await archivo.read()
    movimientos = _parsear_cartola(contenido)

    drivers = db.query(Driver).filter(Driver.activo == True).all()
    driver_map = {d.nombre.lower(): d for d in drivers}

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
        # Buscar mejor match
        mejor_driver = None
        mejor_score = 0.0
        for d_nombre, d in driver_map.items():
            score = _similaridad(nombre_norm, d_nombre)
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

    return {"semana": semana, "mes": mes, "anio": anio, "items": resultado}


# ---------------------------------------------------------------------------
# Endpoint: confirmar cartola
# ---------------------------------------------------------------------------

class ItemConfirmarCartola(BaseModel):
    driver_id: int
    monto: int
    fecha: Optional[str] = None
    descripcion: Optional[str] = None


class ConfirmarCartolaRequest(BaseModel):
    semana: int
    mes: int
    anio: int
    items: List[ItemConfirmarCartola]


@router.post("/cartola/confirmar")
def cartola_confirmar(
    body: ConfirmarCartolaRequest,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Graba los pagos confirmados desde la cartola en BD."""
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
        )
        db.add(pago)
        grabados += 1

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
