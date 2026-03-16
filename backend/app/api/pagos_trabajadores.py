"""
API Pagos Trabajadores: control mensual de nómina.
Flujo equivalente a CPC (drivers) pero mensual y para trabajadores de planta.
"""
import io
import re
from datetime import date
from difflib import SequenceMatcher
from typing import Optional, List

import pandas as pd
import openpyxl
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.auth import require_admin_or_administracion
from app.models import (
    Trabajador, PagoTrabajador, PagoMesTrabajador,
    Prestamo, CuotaPrestamo, AjusteLiquidacion,
    CartolaCarga, EstadoPrestamoEnum,
)
from app.services.audit import registrar as audit
from app.services.contabilidad import asiento_pago_trabajador


router = APIRouter(prefix="/trabajadores", tags=["PagosTrabajadores"])


# ──────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────

def _parse_fecha(valor: str) -> date:
    valor = valor.strip()
    if "/" in valor:
        parts = valor.split("/")
        if len(parts) == 3 and len(parts[0]) <= 2:
            return date(int(parts[2]), int(parts[1]), int(parts[0]))
    return date.fromisoformat(valor)


def _similaridad(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def _extraer_nombre_cartola(descripcion: str) -> str:
    """Extrae el nombre desde la descripción de la cartola."""
    prefijos = [
        "traspaso a:", "app-traspaso a:", "transferencia a:", "app-transferencia a:",
    ]
    desc_lower = descripcion.lower()
    for p in prefijos:
        if desc_lower.startswith(p):
            return descripcion[len(p):].strip()
    return descripcion.strip()


def _calcular_monto_neto(db: Session, trabajador: Trabajador, mes: int, anio: int) -> dict:
    """
    Calcula el monto neto a pagar a un trabajador para el mes/año dado.
    Devuelve dict con monto_bruto, descuento_cuotas, descuento_ajustes, monto_neto.
    """
    monto_bruto = trabajador.sueldo_bruto or 0

    # Sumar cuotas de préstamo pendientes del mes
    cuotas = db.query(CuotaPrestamo).join(Prestamo).filter(
        Prestamo.trabajador_id == trabajador.id,
        Prestamo.estado == EstadoPrestamoEnum.ACTIVO.value,
        CuotaPrestamo.mes == mes,
        CuotaPrestamo.anio == anio,
        CuotaPrestamo.pagado == False,
    ).all()
    descuento_cuotas = sum(c.monto for c in cuotas)

    # Sumar ajustes negativos del mes
    ajustes_neg = db.query(AjusteLiquidacion).filter(
        AjusteLiquidacion.tipo == "TRABAJADOR",
        AjusteLiquidacion.entidad_id == trabajador.id,
        AjusteLiquidacion.mes == mes,
        AjusteLiquidacion.anio == anio,
        AjusteLiquidacion.monto < 0,
    ).all()
    descuento_ajustes = abs(sum(a.monto for a in ajustes_neg))

    # Sumar bonificaciones (ajustes positivos) del mes
    ajustes_pos = db.query(AjusteLiquidacion).filter(
        AjusteLiquidacion.tipo == "TRABAJADOR",
        AjusteLiquidacion.entidad_id == trabajador.id,
        AjusteLiquidacion.mes == mes,
        AjusteLiquidacion.anio == anio,
        AjusteLiquidacion.monto > 0,
    ).all()
    bonificaciones = sum(a.monto for a in ajustes_pos)

    monto_neto = max(0, monto_bruto + bonificaciones - descuento_cuotas - descuento_ajustes)

    return {
        "monto_bruto": monto_bruto,
        "bonificaciones": bonificaciones,
        "descuento_cuotas": descuento_cuotas,
        "descuento_ajustes": descuento_ajustes,
        "monto_neto": monto_neto,
    }


# ──────────────────────────────────────────────────────────
# GET /trabajadores/pagos-mes
# ──────────────────────────────────────────────────────────

@router.get("/pagos-mes")
def listar_pagos_mes(
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """
    Devuelve lista de todos los trabajadores activos con su estado de pago del mes.
    Si no existe PagoMesTrabajador para el mes, calcula el monto en tiempo real.
    """
    trabajadores = db.query(Trabajador).filter(Trabajador.activo == True).order_by(Trabajador.nombre).all()

    # Cargar registros de pago del mes de una vez
    pagos_map = {
        p.trabajador_id: p
        for p in db.query(PagoMesTrabajador).filter(
            PagoMesTrabajador.mes == mes,
            PagoMesTrabajador.anio == anio,
        ).all()
    }

    resultado = []
    for t in trabajadores:
        pago = pagos_map.get(t.id)
        if pago and pago.estado == "PAGADO":
            montos = {
                "monto_bruto": pago.monto_bruto,
                "bonificaciones": getattr(pago, 'bonificaciones', 0),
                "descuento_cuotas": pago.descuento_cuotas,
                "descuento_ajustes": pago.descuento_ajustes,
                "monto_neto": pago.monto_neto,
            }
        else:
            montos = _calcular_monto_neto(db, t, mes, anio)

        resultado.append({
            "id": t.id,
            "nombre": t.nombre,
            "cargo": t.cargo,
            "sueldo_bruto": t.sueldo_bruto,
            "afp": t.afp,
            "costo_afp": t.costo_afp,
            "sistema_salud": t.sistema_salud,
            "costo_salud": t.costo_salud,
            "banco": t.banco,
            "tipo_cuenta": t.tipo_cuenta,
            "numero_cuenta": t.numero_cuenta,
            "rut": t.rut,
            **montos,
            "pago_id": pago.id if pago else None,
            "estado": pago.estado if pago else "PENDIENTE",
            "fecha_pago": str(pago.fecha_pago) if pago and pago.fecha_pago else None,
            "nota": pago.nota if pago else None,
        })

    return {"mes": mes, "anio": anio, "items": resultado}


# ──────────────────────────────────────────────────────────
# PUT /trabajadores/pago-mes/{trabajador_id}
# ──────────────────────────────────────────────────────────

class ActualizarPagoMesRequest(BaseModel):
    estado: str  # PENDIENTE / PAGADO
    fecha_pago: Optional[str] = None
    nota: Optional[str] = None


@router.put("/pago-mes/{trabajador_id}")
def actualizar_pago_mes(
    trabajador_id: int,
    body: ActualizarPagoMesRequest,
    request: Request,
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_admin_or_administracion),
):
    """Marca el pago mensual de un trabajador como PAGADO o PENDIENTE."""
    trabajador = db.get(Trabajador, trabajador_id)
    if not trabajador:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")

    pago = db.query(PagoMesTrabajador).filter(
        PagoMesTrabajador.trabajador_id == trabajador_id,
        PagoMesTrabajador.mes == mes,
        PagoMesTrabajador.anio == anio,
    ).first()

    ya_estaba_pagado = pago is not None and pago.estado == "PAGADO"

    if not pago:
        montos = _calcular_monto_neto(db, trabajador, mes, anio)
        pago = PagoMesTrabajador(
            trabajador_id=trabajador_id,
            mes=mes,
            anio=anio,
            **montos,
        )
        db.add(pago)
    elif not ya_estaba_pagado:
        # Actualizar montos en tiempo real sólo si aún PENDIENTE
        montos = _calcular_monto_neto(db, trabajador, mes, anio)
    else:
        # Ya cerrado: usar montos congelados
        montos = {
            "monto_bruto": pago.monto_bruto,
            "bonificaciones": pago.bonificaciones,
            "descuento_cuotas": pago.descuento_cuotas,
            "descuento_ajustes": pago.descuento_ajustes,
            "monto_neto": pago.monto_neto,
        }

    pago.estado = body.estado

    if body.estado == "PAGADO":
        if not ya_estaba_pagado:
            # Primera vez que se marca PAGADO: congelar montos, crear registros
            pago.monto_bruto = montos["monto_bruto"]
            pago.bonificaciones = montos["bonificaciones"]
            pago.descuento_cuotas = montos["descuento_cuotas"]
            pago.descuento_ajustes = montos["descuento_ajustes"]
            pago.monto_neto = montos["monto_neto"]
            pago.fecha_pago = _parse_fecha(body.fecha_pago) if body.fecha_pago else date.today()

            # Crear PagoTrabajador como registro de pago
            pago_t = PagoTrabajador(
                trabajador_id=trabajador_id,
                mes=mes,
                anio=anio,
                monto=montos["monto_neto"],
                fecha_pago=str(pago.fecha_pago),
                descripcion=f"Nómina {mes}/{anio}",
                fuente="manual",
            )
            db.add(pago_t)
            db.flush()

            # Descontar cuotas de préstamo
            _descontar_cuotas(db, trabajador_id, mes, anio)

            # Asiento contable
            asiento_pago_trabajador(db, pago)
        else:
            # Ya estaba PAGADO: sólo actualizar fecha si se envía una nueva
            if body.fecha_pago:
                pago.fecha_pago = _parse_fecha(body.fecha_pago)
    else:
        pago.fecha_pago = None

    if body.nota is not None:
        pago.nota = body.nota

    audit(db, "actualizar_pago_mes_trabajador", usuario=current_user, request=request,
          entidad="pago_mes_trabajador", entidad_id=pago.id,
          metadata={"trabajador_id": trabajador_id, "mes": mes, "anio": anio, "estado": body.estado})

    db.commit()
    return {"ok": True, "pago_id": pago.id, "estado": pago.estado, "monto_neto": pago.monto_neto}


def _descontar_cuotas(db: Session, trabajador_id: int, mes: int, anio: int):
    """Marca como pagadas las cuotas de préstamo del trabajador para el mes."""
    cuotas = db.query(CuotaPrestamo).join(Prestamo).filter(
        Prestamo.trabajador_id == trabajador_id,
        Prestamo.estado == EstadoPrestamoEnum.ACTIVO.value,
        CuotaPrestamo.mes == mes,
        CuotaPrestamo.anio == anio,
        CuotaPrestamo.pagado == False,
    ).all()

    for cuota in cuotas:
        cuota.pagado = True
        cuota.fecha_pago = date.today()
        prestamo = db.get(Prestamo, cuota.prestamo_id)
        if prestamo:
            prestamo.saldo_pendiente = max(0, prestamo.saldo_pendiente - cuota.monto)
            if prestamo.saldo_pendiente == 0:
                prestamo.estado = EstadoPrestamoEnum.PAGADO.value


# ──────────────────────────────────────────────────────────
# GET /trabajadores/plantilla-bancaria
# ──────────────────────────────────────────────────────────

@router.get("/plantilla-bancaria-trabajadores")
def plantilla_bancaria_trabajadores(
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Genera plantilla Excel TEF con los trabajadores PENDIENTES del mes."""
    trabajadores = db.query(Trabajador).filter(Trabajador.activo == True).order_by(Trabajador.nombre).all()

    pagos_map = {
        p.trabajador_id: p
        for p in db.query(PagoMesTrabajador).filter(
            PagoMesTrabajador.mes == mes,
            PagoMesTrabajador.anio == anio,
            PagoMesTrabajador.estado == "PAGADO",
        ).all()
    }

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = f"Nomina {mes}-{anio}"

    headers = ["Nombre", "RUT", "Banco", "Tipo Cuenta", "Número Cuenta", "AFP", "Costo AFP",
               "Sistema Salud", "Costo Salud", "Sueldo Bruto", "Descuento Cuotas", "Monto Neto"]
    ws.append(headers)

    for t in trabajadores:
        if t.id in pagos_map:
            continue  # ya pagado
        montos = _calcular_monto_neto(db, t, mes, anio)
        ws.append([
            t.nombre, t.rut or "", t.banco or "", t.tipo_cuenta or "", t.numero_cuenta or "",
            t.afp or "", t.costo_afp or 0,
            t.sistema_salud or "", t.costo_salud or 0,
            montos["monto_bruto"], montos["descuento_cuotas"], montos["monto_neto"],
        ])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=nomina_{mes}_{anio}.xlsx"},
    )


# ──────────────────────────────────────────────────────────
# Cartola parser
# ──────────────────────────────────────────────────────────

def _parsear_cartola_trabajadores(archivo_bytes: bytes) -> list[dict]:
    """
    Lee el .xls/.xlsx de cartola Banco de Chile.
    Retorna lista de {fecha, descripcion, monto, nombre_extraido}.
    Solo incluye cargos de "Traspaso A:" (pagos emitidos).
    """
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
        raise HTTPException(status_code=400, detail="No se encontró encabezado de movimientos en la cartola.")

    header_vals = [str(df.iloc[header_row, c]).strip().lower() for c in range(df.shape[1])]
    idx_fecha = next((i for i, v in enumerate(header_vals) if "fecha" in v), None)
    idx_desc  = next((i for i, v in enumerate(header_vals) if "descripci" in v), None)
    idx_cargos = next((i for i, v in enumerate(header_vals) if "cargos" in v), None)

    if idx_cargos is None:
        raise HTTPException(status_code=400, detail="No se encontró columna de Cargos en la cartola.")

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
        nombre = _extraer_nombre_cartola(desc)
        movimientos.append({
            "fecha": fecha,
            "descripcion": desc,
            "nombre_extraido": nombre,
            "monto": monto,
        })

    return movimientos


# ──────────────────────────────────────────────────────────
# POST /trabajadores/cartola/preview
# ──────────────────────────────────────────────────────────

@router.post("/cartola-trabajadores/preview")
async def cartola_preview(
    mes: int = Query(...),
    anio: int = Query(...),
    archivo: UploadFile = File(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """
    Parsea la cartola bancaria y retorna preview con matches propuestos contra trabajadores.
    No escribe nada en BD.
    """
    contenido = await archivo.read()
    movimientos = _parsear_cartola_trabajadores(contenido)

    trabajadores = db.query(Trabajador).filter(Trabajador.activo == True).all()

    # Pagos ya registrados este mes
    pagados_existentes: dict[int, int] = {}
    for p in db.query(PagoTrabajador).filter(
        PagoTrabajador.mes == mes,
        PagoTrabajador.anio == anio,
    ).all():
        pagados_existentes[p.trabajador_id] = pagados_existentes.get(p.trabajador_id, 0) + p.monto

    resultado = []
    for mov in movimientos:
        nombre_norm = mov["nombre_extraido"].lower()
        mejor = None
        mejor_score = 0.0

        for t in trabajadores:
            score = _similaridad(nombre_norm, t.nombre.lower())
            if score > mejor_score:
                mejor_score = score
                mejor = t

        match_confiable = mejor_score >= 0.55
        montos = _calcular_monto_neto(db, mejor, mes, anio) if mejor else {}

        resultado.append({
            "descripcion": mov["descripcion"],
            "nombre_extraido": mov["nombre_extraido"],
            "fecha": mov["fecha"],
            "monto": mov["monto"],
            "trabajador_id": mejor.id if mejor else None,
            "trabajador_nombre": mejor.nombre if mejor else None,
            "score": round(mejor_score, 2),
            "match_confiable": match_confiable,
            "ya_pagado": pagados_existentes.get(mejor.id, 0) if mejor else 0,
            "liquidado": montos.get("monto_neto", 0),
        })

    todos = [{"id": t.id, "nombre": t.nombre} for t in sorted(trabajadores, key=lambda x: x.nombre)]
    return {"mes": mes, "anio": anio, "items": resultado, "trabajadores": todos}


# ──────────────────────────────────────────────────────────
# POST /trabajadores/cartola/confirmar
# ──────────────────────────────────────────────────────────

class ItemConfirmarCartolaTrabajador(BaseModel):
    trabajador_id: int
    monto: int
    fecha: Optional[str] = None
    descripcion: Optional[str] = None
    nombre_extraido: Optional[str] = None


class ConfirmarCartolaTrabajadorRequest(BaseModel):
    mes: int
    anio: int
    items: List[ItemConfirmarCartolaTrabajador]


@router.post("/cartola-trabajadores/confirmar")
def cartola_confirmar(
    body: ConfirmarCartolaTrabajadorRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin_or_administracion),
):
    """
    Confirma los pagos de la cartola para trabajadores.
    - Crea PagoTrabajador por cada ítem.
    - Upsert PagoMesTrabajador con estado PAGADO.
    - Descuenta cuotas de préstamo del mes.
    - Crea asiento contable de egreso nómina.
    """
    carga = CartolaCarga(
        tipo="trabajador",
        archivo_nombre="cartola_bancaria_trabajadores",
        usuario_id=current_user.get("id"),
        usuario_nombre=current_user.get("nombre"),
        mes=body.mes,
        anio=body.anio,
        total_transacciones=len(body.items),
        matcheadas=len(body.items),
        no_matcheadas=0,
        monto_total=sum(it.monto for it in body.items),
    )
    db.add(carga)
    db.flush()

    grabados = 0
    for item in body.items:
        if item.trabajador_id <= 0 or item.monto <= 0:
            continue

        trabajador = db.get(Trabajador, item.trabajador_id)
        if not trabajador:
            continue

        fecha_pago_date = _parse_fecha(item.fecha) if item.fecha else date.today()

        # Registro de pago efectivo
        pago_t = PagoTrabajador(
            trabajador_id=item.trabajador_id,
            mes=body.mes,
            anio=body.anio,
            monto=item.monto,
            fecha_pago=str(fecha_pago_date),
            descripcion=item.descripcion or f"Cartola nómina {body.mes}/{body.anio}",
            fuente="cartola",
        )
        db.add(pago_t)
        grabados += 1

        # Upsert PagoMesTrabajador
        pago_mes = db.query(PagoMesTrabajador).filter(
            PagoMesTrabajador.trabajador_id == item.trabajador_id,
            PagoMesTrabajador.mes == body.mes,
            PagoMesTrabajador.anio == body.anio,
        ).first()

        montos = _calcular_monto_neto(db, trabajador, body.mes, body.anio)

        if not pago_mes:
            pago_mes = PagoMesTrabajador(
                trabajador_id=item.trabajador_id,
                mes=body.mes,
                anio=body.anio,
                **montos,
            )
            db.add(pago_mes)
        else:
            pago_mes.monto_bruto = montos["monto_bruto"]
            pago_mes.bonificaciones = montos["bonificaciones"]
            pago_mes.descuento_cuotas = montos["descuento_cuotas"]
            pago_mes.descuento_ajustes = montos["descuento_ajustes"]
            pago_mes.monto_neto = montos["monto_neto"]

        pago_mes.estado = "PAGADO"
        pago_mes.fecha_pago = fecha_pago_date

        db.flush()

        # Descontar cuotas de préstamo
        _descontar_cuotas(db, item.trabajador_id, body.mes, body.anio)

        # Asiento contable
        asiento_pago_trabajador(db, pago_mes)

    audit(db, "carga_cartola_trabajador", usuario=current_user, request=request,
          entidad="cartola_carga", entidad_id=carga.id,
          metadata={"mes": body.mes, "anio": body.anio, "transacciones": len(body.items),
                    "monto_total": sum(it.monto for it in body.items)})

    db.commit()
    return {"ok": True, "grabados": grabados}
