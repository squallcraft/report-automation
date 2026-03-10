"""
API CPP (Control de Pagos a Pickups): control semanal de egresos a pickups.
"""
import io
import os
import re
import uuid
from datetime import date, datetime
from difflib import SequenceMatcher
from typing import Optional, List

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.auth import require_admin_or_administracion, require_pickup
from app.models import (
    Pickup, RecepcionPaquete, Envio, Seller, Driver, Retiro,
    PagoSemanaPickup, PagoCartolaPickup, CalendarioSemanas,
    CartolaCarga, EstadoPagoEnum, FacturaPickup, EstadoFacturaPickupEnum,
)
from app.services.audit import registrar as audit
from app.services.contabilidad import asiento_pago_pickup

EMISOR_RUT = "77512163"
EMISOR_DV = "7"
EMISOR_NOMBRE = "LOGISTICA Y TRANSPORTE E-COURIER SPA"
EMISOR_BANCO_COD = "001"
EMISOR_CUENTA = "8012931700"

BANCO_CODIGOS = {
    "banco de chile": "001",
    "banco internacional": "009",
    "scotiabank": "012", "banco scotiabank": "012", "scotiabank chile": "012",
    "banco bice": "014", "bice": "014",
    "banco estado": "016", "banco estado de chile": "016", "bancoestado": "016",
    "bci": "028", "banco bci": "028", "banco de credito e inversiones": "028",
    "itau": "031", "banco itau": "031", "itaú": "031", "itaucorpbanca": "031",
    "itau corpbanca": "031", "itaú corpbanca": "031", "corpbanca": "031",
    "security": "034", "banco security": "034",
    "santander": "037", "banco santander": "037", "santander chile": "037",
    "consorcio": "039", "banco consorcio": "039",
    "falabella": "402", "banco falabella": "402",
    "ripley": "403", "banco ripley": "403",
    "coopeuch": "672",
    "prepago los heroes": "729", "prepago los héroes": "729",
    "tenpo": "730",
    "copec pay": "741",
    "mercado pago": "875", "mercadopago": "875",
    "mach": "028", "machbank": "028",
}

BANCO_RUTS = {
    "001": "0970040005", "009": "0970110003", "012": "0970320008",
    "014": "097080000K", "016": "0970300007", "028": "0970060006",
    "031": "0970230009", "034": "0970530002", "037": "097036000K",
    "039": "0966527005", "402": "0965096604", "403": "0979470002",
    "672": "0855860000", "729": "0762609309", "730": "0769676929",
    "741": "0970530002", "875": "0762838641",
}

UPLOADS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads", "facturas_pickups")

router = APIRouter(prefix="/cpp", tags=["CPP"])


class PagoPickupUpdate(BaseModel):
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


def _get_monto_semanal_pickup(db: Session, pickup_id: int, semana: int, mes: int, anio: int) -> int:
    """Calcula el monto neto semanal a pagar a un pickup (comisiones - cargo seller)."""
    from app.services.liquidacion import _calcular_retiro_seller, _calcular_retiro_driver

    pickup = db.get(Pickup, pickup_id)
    if not pickup:
        return 0

    recs = db.query(RecepcionPaquete).filter(
        RecepcionPaquete.pickup_id == pickup_id,
        RecepcionPaquete.semana == semana,
        RecepcionPaquete.mes == mes,
        RecepcionPaquete.anio == anio,
    ).all()

    comision = 0
    for r in recs:
        skip = False
        if r.envio_id:
            envio = db.get(Envio, r.envio_id)
            if envio:
                if pickup.driver_id and envio.driver_id == pickup.driver_id:
                    skip = True
                elif pickup.seller_id and envio.seller_id == pickup.seller_id:
                    skip = True
        if not skip:
            comision += r.comision

    ganancia_driver = 0
    if pickup.driver_id:
        envios_d = db.query(Envio).filter(
            Envio.driver_id == pickup.driver_id,
            Envio.semana == semana, Envio.mes == mes, Envio.anio == anio,
        ).all()
        driver = db.get(Driver, pickup.driver_id)
        ganancia_driver = sum(e.costo_driver + e.pago_extra_manual for e in envios_d)
        if driver and not driver.contratado:
            ganancia_driver += sum(e.extra_producto_driver + e.extra_comuna_driver for e in envios_d)
        retiros_d = db.query(Retiro).filter(
            Retiro.driver_id == pickup.driver_id,
            Retiro.semana == semana, Retiro.mes == mes, Retiro.anio == anio,
        ).all()
        if driver:
            ganancia_driver += _calcular_retiro_driver(driver, retiros_d)

    cargo_seller = 0
    if pickup.seller_id:
        seller = db.get(Seller, pickup.seller_id)
        if seller:
            envios_s = db.query(Envio).filter(
                Envio.seller_id == seller.id,
                Envio.semana == semana, Envio.mes == mes, Envio.anio == anio,
            ).all()
            cargo_seller = sum(
                e.cobro_seller + e.cobro_extra_manual + e.extra_producto_seller + e.extra_comuna_seller
                for e in envios_s
            )
            cargo_seller += _calcular_retiro_seller(seller, envios_s)

    return comision + ganancia_driver - cargo_seller


# ---------------------------------------------------------------------------
# Tabla CPP
# ---------------------------------------------------------------------------

@router.get("/tabla")
def tabla_cpp(
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Tabla mensual CPP: una fila por pickup con monto por semana."""
    semanas = _semanas_del_mes(db, mes, anio)
    pickups = db.query(Pickup).filter(Pickup.activo == True).order_by(Pickup.nombre).all()

    result = []
    for pickup in pickups:
        semanas_data = {}
        subtotal = 0
        for sem in semanas:
            pago = db.query(PagoSemanaPickup).filter(
                PagoSemanaPickup.pickup_id == pickup.id,
                PagoSemanaPickup.semana == sem,
                PagoSemanaPickup.mes == mes,
                PagoSemanaPickup.anio == anio,
            ).first()

            if pago and pago.monto_override is not None:
                monto = pago.monto_override
            else:
                monto = _get_monto_semanal_pickup(db, pickup.id, sem, mes, anio)

            estado = pago.estado if pago else EstadoPagoEnum.PENDIENTE.value
            semanas_data[str(sem)] = {
                "monto_neto": monto,
                "estado": estado,
                "nota": pago.nota if pago else None,
            }
            subtotal += monto

        factura = db.query(FacturaPickup).filter(
            FacturaPickup.pickup_id == pickup.id,
            FacturaPickup.mes == mes,
            FacturaPickup.anio == anio,
        ).first()

        if subtotal > 0 or (factura and factura.estado != EstadoFacturaPickupEnum.SIN_FACTURA.value):
            result.append({
                "pickup_id": pickup.id,
                "pickup_nombre": pickup.nombre,
                "rut": pickup.rut,
                "banco": pickup.banco,
                "tipo_cuenta": pickup.tipo_cuenta,
                "numero_cuenta": pickup.numero_cuenta,
                "semanas": semanas_data,
                "subtotal_neto": subtotal,
                "factura_estado": factura.estado if factura else EstadoFacturaPickupEnum.SIN_FACTURA.value,
                "factura_id": factura.id if factura else None,
            })

    result.sort(key=lambda r: r["pickup_nombre"])
    return {"semanas_disponibles": semanas, "pickups": result}


# ---------------------------------------------------------------------------
# Actualizar estado de pago semanal
# ---------------------------------------------------------------------------

def _upsert_pago_semana_pickup(db: Session, pickup_id: int, semana: int, mes: int, anio: int,
                                estado: str = None, nota: str = None, monto_override: int = None):
    pago = db.query(PagoSemanaPickup).filter(
        PagoSemanaPickup.pickup_id == pickup_id,
        PagoSemanaPickup.semana == semana,
        PagoSemanaPickup.mes == mes,
        PagoSemanaPickup.anio == anio,
    ).first()
    estado_anterior = pago.estado if pago else None
    monto_sistema = _get_monto_semanal_pickup(db, pickup_id, semana, mes, anio)

    if not pago:
        pago = PagoSemanaPickup(
            pickup_id=pickup_id,
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
    pago.monto_neto = monto_sistema

    if estado is not None and estado != estado_anterior:
        if estado == EstadoPagoEnum.PAGADO.value:
            existe_manual = db.query(PagoCartolaPickup).filter(
                PagoCartolaPickup.pickup_id == pickup_id,
                PagoCartolaPickup.semana == semana,
                PagoCartolaPickup.mes == mes,
                PagoCartolaPickup.anio == anio,
                PagoCartolaPickup.fuente == "manual",
            ).first()
            if not existe_manual:
                db.add(PagoCartolaPickup(
                    pickup_id=pickup_id,
                    semana=semana, mes=mes, anio=anio,
                    monto=monto_sistema,
                    fecha_pago=date.today().isoformat(),
                    descripcion="Pago emitido manual por administrador",
                    fuente="manual",
                ))
        elif estado in (EstadoPagoEnum.PENDIENTE.value, EstadoPagoEnum.INCOMPLETO.value):
            db.query(PagoCartolaPickup).filter(
                PagoCartolaPickup.pickup_id == pickup_id,
                PagoCartolaPickup.semana == semana,
                PagoCartolaPickup.mes == mes,
                PagoCartolaPickup.anio == anio,
                PagoCartolaPickup.fuente == "manual",
                PagoCartolaPickup.descripcion == "Pago emitido manual por administrador",
            ).delete()

    return pago


@router.put("/pago-semana/{pickup_id}")
def actualizar_pago_semana_pickup(
    pickup_id: int,
    request: Request,
    semana: int = Query(...),
    mes: int = Query(...),
    anio: int = Query(...),
    body: PagoPickupUpdate = ...,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin_or_administracion),
):
    pickup = db.get(Pickup, pickup_id)
    if not pickup:
        raise HTTPException(status_code=404, detail="Pickup no encontrado")

    _upsert_pago_semana_pickup(
        db, pickup_id, semana, mes, anio,
        estado=body.estado, monto_override=body.monto_override, nota=body.nota,
    )

    if body.estado is not None:
        audit(db, "pago_manual_pickup", usuario=current_user, request=request,
              entidad="pago_semana_pickup", entidad_id=pickup_id,
              cambios={"estado": {"antes": "—", "despues": body.estado}},
              metadata={"nombre": pickup.nombre, "semana": semana, "mes": mes, "anio": anio})

    db.commit()
    return {"ok": True}


@router.put("/pago-semana-batch")
def actualizar_pagos_batch_pickup(
    request: Request,
    mes: int = Query(...),
    anio: int = Query(...),
    body: List[dict] = ...,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin_or_administracion),
):
    updated = 0
    for item in body:
        pickup_id = item.get("pickup_id")
        semana = item.get("semana")
        if not pickup_id or not semana:
            continue
        _upsert_pago_semana_pickup(
            db, pickup_id, semana, mes, anio,
            estado=item.get("estado"),
            monto_override=item.get("monto_override"),
            nota=item.get("nota"),
        )
        updated += 1

    audit(db, "pago_batch_pickup", usuario=current_user, request=request,
          entidad="pago_semana_pickup",
          metadata={"mes": mes, "anio": anio, "cambios": len(body)})
    db.commit()
    return {"ok": True, "updated": updated}


# ---------------------------------------------------------------------------
# TEF para pickups
# ---------------------------------------------------------------------------

def _get_banco_codigo(banco_nombre: Optional[str]) -> str:
    if not banco_nombre:
        return "001"
    return BANCO_CODIGOS.get(banco_nombre.lower().strip(), "001")


def _normalizar_rut(rut: Optional[str]) -> tuple:
    if not rut:
        return ("00000000", "0")
    clean = re.sub(r"[.\s]", "", rut.upper().strip())
    if "-" in clean:
        partes = clean.split("-")
        return (partes[0], partes[1])
    if len(clean) > 1:
        return (clean[:-1], clean[-1])
    return (clean, "0")


def _generar_linea_tef_pickup(seq: int, pickup: Pickup, monto: int) -> str:
    banco_destino_cod = _get_banco_codigo(pickup.banco)
    tipo_op = "TEC" if banco_destino_cod == "001" else "TOB"
    rut_cliente = (EMISOR_RUT + EMISOR_DV).zfill(10)
    cuenta_cargo = re.sub(r"\D", "", EMISOR_CUENTA).zfill(12)[:12]
    rut_num, rut_dv = _normalizar_rut(pickup.rut)
    rut_benef = (rut_num + rut_dv).zfill(10)
    nombre = (pickup.nombre or "").upper()[:30].ljust(30)
    cuenta_benef_raw = re.sub(r"\D", "", pickup.numero_cuenta or "")
    if not cuenta_benef_raw or (
        banco_destino_cod == "016"
        and (pickup.tipo_cuenta or "").lower().strip() in ("vista", "cuenta vista")
        and cuenta_benef_raw == re.sub(r"\D", "", rut_num)
    ):
        cuenta_benef_raw = rut_num + rut_dv
    cuenta_benef = cuenta_benef_raw.ljust(18)[:18]
    rut_banco_benef = BANCO_RUTS.get(banco_destino_cod, "0970040005")
    monto_str = str(monto).zfill(11)[:11]
    abono = " "
    motivo = "PAGO PICKUP".ljust(30)[:30]
    notif = "1"
    asunto = "Pago eCourier".ljust(30)[:30]
    email_benef = (pickup.email or "").ljust(50)[:50]
    tipo_raw = (pickup.tipo_cuenta or "").lower().strip()
    tipo_cuenta = "CTD" if "corriente" in tipo_raw else "JUV"

    linea = (
        f"{tipo_op}{rut_cliente}{cuenta_cargo}{rut_benef}{nombre}"
        f"{cuenta_benef}{rut_banco_benef}{monto_str}{abono}{motivo}"
        f"{notif}{asunto}{email_benef}"
        + (tipo_cuenta if tipo_op == "TOB" else "")
        + "\r\n"
    )
    return linea


class ItemTEFPickup(BaseModel):
    pickup_id: int
    monto: int


class GenerarTEFPickupRequest(BaseModel):
    semana: int
    mes: int
    anio: int
    items: List[ItemTEFPickup]


@router.post("/generar-tef")
def generar_tef_pickup(
    body: GenerarTEFPickupRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin_or_administracion),
):
    lineas = []
    for idx, item in enumerate(body.items, start=1):
        pickup = db.get(Pickup, item.pickup_id)
        if not pickup:
            continue
        lineas.append(_generar_linea_tef_pickup(idx, pickup, item.monto))

    contenido = "".join(lineas)
    hoy = date.today().strftime("%Y%m%d")
    filename = f"TEF_Pickups_{hoy}_S{body.semana}.txt"

    audit(db, "generar_tef_pickup", usuario=current_user, request=request,
          entidad="tef_pickup",
          metadata={"semana": body.semana, "mes": body.mes, "anio": body.anio,
                    "pickups": len(body.items), "monto_total": sum(it.monto for it in body.items)})
    db.commit()

    return StreamingResponse(
        io.BytesIO(contenido.encode("latin-1", errors="replace")),
        media_type="text/plain; charset=latin-1",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Cartola pickups
# ---------------------------------------------------------------------------

def _similaridad(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def _parsear_cartola_pickup(archivo_bytes: bytes) -> list:
    try:
        df = pd.read_excel(io.BytesIO(archivo_bytes), header=None)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"No se pudo leer el archivo: {exc}")

    header_row = None
    for i, row in df.iterrows():
        vals = [str(v).strip().lower() for v in row.values]
        if any("fecha" in v for v in vals) and any("cargos" in v for v in vals):
            header_row = i
            break
    if header_row is None:
        raise HTTPException(status_code=400, detail="No se encontró encabezado en la cartola.")

    header_vals = [str(df.iloc[header_row, c]).strip().lower() for c in range(df.shape[1])]
    idx_fecha = next((i for i, v in enumerate(header_vals) if "fecha" in v), None)
    idx_desc = next((i for i, v in enumerate(header_vals) if "descripci" in v), None)
    idx_cargos = next((i for i, v in enumerate(header_vals) if "cargos" in v), None)

    if idx_cargos is None:
        raise HTTPException(status_code=400, detail="No se encontró columna de Cargos.")

    movimientos = []
    for i in range(header_row + 1, len(df)):
        row = df.iloc[i]
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
        desc_lower = desc.lower()
        if not any(desc_lower.startswith(p) for p in [
            "traspaso a:", "app-traspaso a:", "transferencia a:", "app-transferencia a:"
        ]):
            continue
        fecha = str(row.iloc[idx_fecha]).strip() if idx_fecha is not None else ""
        nombre = desc
        for prefijo in ["traspaso a:", "app-traspaso a:", "transferencia a:", "app-transferencia a:"]:
            if desc_lower.startswith(prefijo):
                nombre = desc[len(prefijo):].strip()
                break
        movimientos.append({"fecha": fecha, "descripcion": desc, "nombre_extraido": nombre, "monto": monto})
    return movimientos


@router.post("/cartola/preview")
async def cartola_pickup_preview(
    semana: int = Query(...),
    mes: int = Query(...),
    anio: int = Query(...),
    archivo: UploadFile = File(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    contenido = await archivo.read()
    movimientos = _parsear_cartola_pickup(contenido)
    pickups = db.query(Pickup).filter(Pickup.activo == True).all()

    pagados_existentes: dict[int, int] = {}
    for p in db.query(PagoCartolaPickup).filter(
        PagoCartolaPickup.semana == semana,
        PagoCartolaPickup.mes == mes,
        PagoCartolaPickup.anio == anio,
    ).all():
        pagados_existentes[p.pickup_id] = pagados_existentes.get(p.pickup_id, 0) + p.monto

    resultado = []
    for mov in movimientos:
        nombre_norm = mov["nombre_extraido"].lower()
        mejor_pickup = None
        mejor_score = 0.0
        for pk in pickups:
            score = _similaridad(nombre_norm, pk.nombre.lower())
            for alias in (pk.aliases or []):
                s = _similaridad(nombre_norm, alias.lower())
                if s > score:
                    score = s
            if score > mejor_score:
                mejor_score = score
                mejor_pickup = pk

        match_confiable = mejor_score >= 0.55
        ya_pagado = pagados_existentes.get(mejor_pickup.id, 0) if mejor_pickup else 0
        liquidado = _get_monto_semanal_pickup(db, mejor_pickup.id, semana, mes, anio) if mejor_pickup else 0

        resultado.append({
            "descripcion": mov["descripcion"],
            "nombre_extraido": mov["nombre_extraido"],
            "fecha": mov["fecha"],
            "monto": mov["monto"],
            "pickup_id": mejor_pickup.id if mejor_pickup else None,
            "pickup_nombre": mejor_pickup.nombre if mejor_pickup else None,
            "score": round(mejor_score, 2),
            "match_confiable": match_confiable,
            "ya_pagado": ya_pagado,
            "liquidado": liquidado,
        })

    todos_pickups = [{"id": p.id, "nombre": p.nombre} for p in sorted(pickups, key=lambda x: x.nombre)]
    return {"semana": semana, "mes": mes, "anio": anio, "items": resultado, "pickups": todos_pickups}


class ItemConfirmarCartolaPickup(BaseModel):
    pickup_id: int
    monto: int
    fecha: Optional[str] = None
    descripcion: Optional[str] = None
    nombre_extraido: Optional[str] = None


class ConfirmarCartolaPickupRequest(BaseModel):
    semana: int
    mes: int
    anio: int
    items: List[ItemConfirmarCartolaPickup]


@router.post("/cartola/confirmar")
def cartola_pickup_confirmar(
    body: ConfirmarCartolaPickupRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin_or_administracion),
):
    carga = CartolaCarga(
        tipo="pickup", archivo_nombre="cartola_bancaria",
        usuario_id=current_user.get("id"), usuario_nombre=current_user.get("nombre"),
        mes=body.mes, anio=body.anio,
        total_transacciones=len(body.items),
        matcheadas=len(body.items), no_matcheadas=0,
        monto_total=sum(it.monto for it in body.items),
    )
    db.add(carga)
    db.flush()

    grabados = 0
    for item in body.items:
        if item.pickup_id <= 0 or item.monto <= 0:
            continue
        db.add(PagoCartolaPickup(
            pickup_id=item.pickup_id, semana=body.semana,
            mes=body.mes, anio=body.anio, monto=item.monto,
            fecha_pago=item.fecha, descripcion=item.descripcion,
            fuente="cartola", carga_id=carga.id,
        ))
        grabados += 1

        if item.nombre_extraido:
            pickup = db.get(Pickup, item.pickup_id)
            if pickup:
                alias_nuevo = item.nombre_extraido.strip()
                aliases_actuales = [a.lower() for a in (pickup.aliases or [])]
                if alias_nuevo.lower() != pickup.nombre.lower() and alias_nuevo.lower() not in aliases_actuales:
                    pickup.aliases = list(pickup.aliases or []) + [alias_nuevo]

    db.flush()
    for pago_p in db.query(PagoCartolaPickup).filter(PagoCartolaPickup.carga_id == carga.id).all():
        asiento_pago_pickup(db, pago_p)

    audit(db, "carga_cartola_pickup", usuario=current_user, request=request,
          entidad="cartola_carga", entidad_id=carga.id,
          metadata={"mes": body.mes, "anio": body.anio,
                    "transacciones": len(body.items),
                    "monto_total": sum(it.monto for it in body.items)})
    db.commit()
    return {"ok": True, "grabados": grabados}


@router.get("/pagos-acumulados")
def pagos_acumulados_pickups(
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    rows = db.query(
        PagoCartolaPickup.pickup_id,
        PagoCartolaPickup.semana,
        func.sum(PagoCartolaPickup.monto).label("total"),
    ).filter(
        PagoCartolaPickup.mes == mes,
        PagoCartolaPickup.anio == anio,
    ).group_by(PagoCartolaPickup.pickup_id, PagoCartolaPickup.semana).all()

    resultado: dict[str, dict[str, int]] = {}
    for r in rows:
        pid = str(r.pickup_id)
        sem = str(r.semana)
        if pid not in resultado:
            resultado[pid] = {}
        resultado[pid][sem] = r.total
    return resultado


# ---------------------------------------------------------------------------
# Facturas de pickups (admin: listar, aprobar, rechazar)
# ---------------------------------------------------------------------------

@router.get("/facturas")
def listar_facturas_pickups(
    mes: Optional[int] = None,
    anio: Optional[int] = None,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    q = db.query(FacturaPickup)
    if mes is not None:
        q = q.filter(FacturaPickup.mes == mes)
    if anio is not None:
        q = q.filter(FacturaPickup.anio == anio)
    facturas = q.order_by(FacturaPickup.created_at.desc()).all()

    result = []
    for f in facturas:
        pickup = db.get(Pickup, f.pickup_id)
        result.append({
            "id": f.id,
            "pickup_id": f.pickup_id,
            "pickup_nombre": pickup.nombre if pickup else "—",
            "mes": f.mes, "anio": f.anio,
            "monto_neto": f.monto_neto,
            "archivo_nombre": f.archivo_nombre,
            "estado": f.estado,
            "nota_pickup": f.nota_pickup,
            "nota_admin": f.nota_admin,
            "revisado_por": f.revisado_por,
            "revisado_en": f.revisado_en.isoformat() if f.revisado_en else None,
            "created_at": f.created_at.isoformat() if f.created_at else None,
        })
    return result


@router.put("/facturas/{factura_id}/revisar")
def revisar_factura_pickup(
    factura_id: int,
    estado: str = Query(...),
    nota_admin: Optional[str] = Query(None),
    request: Request = None,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin_or_administracion),
):
    factura = db.get(FacturaPickup, factura_id)
    if not factura:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    if estado not in (EstadoFacturaPickupEnum.APROBADA.value, EstadoFacturaPickupEnum.RECHAZADA.value):
        raise HTTPException(status_code=400, detail="Estado inválido")

    factura.estado = estado
    if nota_admin is not None:
        factura.nota_admin = nota_admin
    factura.revisado_por = current_user.get("nombre", current_user.get("username", "admin"))
    factura.revisado_en = datetime.utcnow()

    audit(db, "revisar_factura_pickup", usuario=current_user, request=request,
          entidad="factura_pickup", entidad_id=factura_id,
          cambios={"estado": {"antes": "CARGADA", "despues": estado}},
          metadata={"pickup_id": factura.pickup_id, "mes": factura.mes, "anio": factura.anio})
    db.commit()
    return {"ok": True, "estado": estado}


@router.get("/facturas/{factura_id}/descargar")
def descargar_factura_pickup(
    factura_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    factura = db.get(FacturaPickup, factura_id)
    if not factura or not factura.archivo_path:
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    if not os.path.exists(factura.archivo_path):
        raise HTTPException(status_code=404, detail="Archivo no encontrado en disco")
    return FileResponse(
        factura.archivo_path,
        filename=factura.archivo_nombre or "factura.pdf",
        media_type="application/octet-stream",
    )


# ---------------------------------------------------------------------------
# Portal pickup: subir factura
# ---------------------------------------------------------------------------

@router.post("/portal/facturas/upload")
async def pickup_upload_factura(
    mes: int = Query(...),
    anio: int = Query(...),
    nota: Optional[str] = Query(None),
    archivo: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_pickup),
):
    pickup_id = current_user["id"]
    pickup = db.get(Pickup, pickup_id)
    if not pickup:
        raise HTTPException(status_code=404, detail="Pickup no encontrado")

    allowed_ext = (".pdf", ".jpg", ".jpeg", ".png", ".webp")
    ext = os.path.splitext(archivo.filename or "")[1].lower()
    if ext not in allowed_ext:
        raise HTTPException(status_code=400, detail=f"Formato no permitido. Use: {', '.join(allowed_ext)}")

    existing = db.query(FacturaPickup).filter(
        FacturaPickup.pickup_id == pickup_id,
        FacturaPickup.mes == mes,
        FacturaPickup.anio == anio,
    ).first()

    if existing and existing.estado == EstadoFacturaPickupEnum.APROBADA.value:
        raise HTTPException(status_code=400, detail="La factura de este período ya fue aprobada")

    os.makedirs(UPLOADS_DIR, exist_ok=True)
    unique_name = f"{pickup_id}_{mes}_{anio}_{uuid.uuid4().hex[:8]}{ext}"
    file_path = os.path.join(UPLOADS_DIR, unique_name)

    content = await archivo.read()
    with open(file_path, "wb") as f:
        f.write(content)

    semanas = _semanas_del_mes(db, mes, anio)
    monto_total = sum(_get_monto_semanal_pickup(db, pickup_id, sem, mes, anio) for sem in semanas)

    if existing:
        if existing.archivo_path and os.path.exists(existing.archivo_path):
            try:
                os.remove(existing.archivo_path)
            except OSError:
                pass
        existing.archivo_nombre = archivo.filename
        existing.archivo_path = file_path
        existing.estado = EstadoFacturaPickupEnum.CARGADA.value
        existing.nota_pickup = nota
        existing.nota_admin = None
        existing.revisado_por = None
        existing.revisado_en = None
        existing.monto_neto = monto_total
    else:
        existing = FacturaPickup(
            pickup_id=pickup_id, mes=mes, anio=anio,
            monto_neto=monto_total,
            archivo_nombre=archivo.filename,
            archivo_path=file_path,
            estado=EstadoFacturaPickupEnum.CARGADA.value,
            nota_pickup=nota,
        )
        db.add(existing)

    db.commit()
    db.refresh(existing)

    return {
        "ok": True,
        "factura_id": existing.id,
        "estado": existing.estado,
        "archivo_nombre": existing.archivo_nombre,
    }


@router.get("/portal/facturas")
def pickup_listar_facturas(
    mes: Optional[int] = None,
    anio: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_pickup),
):
    pickup_id = current_user["id"]
    q = db.query(FacturaPickup).filter(FacturaPickup.pickup_id == pickup_id)
    if mes is not None:
        q = q.filter(FacturaPickup.mes == mes)
    if anio is not None:
        q = q.filter(FacturaPickup.anio == anio)
    facturas = q.order_by(FacturaPickup.anio.desc(), FacturaPickup.mes.desc()).all()

    return [
        {
            "id": f.id,
            "mes": f.mes, "anio": f.anio,
            "monto_neto": f.monto_neto,
            "archivo_nombre": f.archivo_nombre,
            "estado": f.estado,
            "nota_pickup": f.nota_pickup,
            "nota_admin": f.nota_admin,
            "revisado_por": f.revisado_por,
            "revisado_en": f.revisado_en.isoformat() if f.revisado_en else None,
            "created_at": f.created_at.isoformat() if f.created_at else None,
        }
        for f in facturas
    ]


@router.get("/portal/facturas/{factura_id}/descargar")
def pickup_descargar_factura(
    factura_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_pickup),
):
    factura = db.get(FacturaPickup, factura_id)
    if not factura or factura.pickup_id != current_user["id"]:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    if not factura.archivo_path or not os.path.exists(factura.archivo_path):
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    return FileResponse(
        factura.archivo_path,
        filename=factura.archivo_nombre or "factura.pdf",
        media_type="application/octet-stream",
    )
