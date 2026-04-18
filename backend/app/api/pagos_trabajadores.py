"""
API Pagos Trabajadores: control mensual de nómina.
Flujo equivalente a CPC (drivers) pero mensual y para trabajadores de planta.

Estado del mes:
  PENDIENTE → aún no se ha registrado ningún pago
  PARCIAL   → se han registrado pagos pero la suma < monto_neto
  PAGADO    → suma de pagos >= monto_neto (mes cerrado)
"""
import io
import re
from calendar import monthrange
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
    MovimientoFinanciero, CategoriaFinanciera,
    LiquidacionMensual,
)
from app.services.audit import registrar as audit
from app.services.contabilidad import asiento_pago_trabajador

# ID fijo de la categoría "Sueldos" en categorias_financieras
_CAT_SUELDOS_ID = 7


def _registrar_movimiento_sueldo(
    db: Session,
    trabajador: "Trabajador",
    pago: "PagoTrabajador",
):
    """Crea un MovimientoFinanciero en categoría Sueldos para cada pago de nómina.
    Esto asegura que el pago aparezca en Estado Ecourier (Detalle).
    Se llama SOLO cuando se registra un PagoTrabajador nuevo.
    """
    from datetime import date as _date
    cat = db.get(CategoriaFinanciera, _CAT_SUELDOS_ID)
    if cat is None:
        cat = db.query(CategoriaFinanciera).filter(
            CategoriaFinanciera.nombre.ilike("sueldos")
        ).first()
    if cat is None:
        return

    fecha_pago = pago.fecha_pago
    if isinstance(fecha_pago, str):
        try:
            fecha_pago = _parse_fecha(fecha_pago)
        except Exception:
            fecha_pago = _date.today()
    elif fecha_pago is None:
        fecha_pago = _date.today()

    mov = MovimientoFinanciero(
        categoria_id=cat.id,
        nombre=f"Sueldo {trabajador.nombre} ({pago.mes}/{pago.anio})",
        descripcion="Pago nómina generado automáticamente desde módulo Pagos Trabajadores",
        monto=pago.monto,
        moneda="CLP",
        mes=pago.mes,
        anio=pago.anio,
        fecha_pago=fecha_pago,
        estado="PAGADO",
        recurrente=False,
    )
    db.add(mov)


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


def _calcular_monto_neto(
    db: Session,
    trabajador: Trabajador,
    mes: int,
    anio: int,
    cuotas_ids_incluir: Optional[List[int]] = None,
) -> dict:
    """
    Calcula el monto neto a pagar a un trabajador para el mes/año dado.
    cuotas_ids_incluir: si se pasa, solo descuenta esas cuotas (None = todas las activas del mes).
    Devuelve dict con monto_bruto, descuento_cuotas, descuento_ajustes, bonificaciones, monto_neto,
    y cuotas_detalle (lista de dicts con id/monto/motivo/prestamo_id).
    """
    monto_bruto = trabajador.sueldo_bruto or 0

    cuotas_query = db.query(CuotaPrestamo).join(Prestamo).filter(
        Prestamo.trabajador_id == trabajador.id,
        Prestamo.estado == EstadoPrestamoEnum.ACTIVO.value,
        CuotaPrestamo.mes == mes,
        CuotaPrestamo.anio == anio,
        CuotaPrestamo.pagado == False,
    )
    todas_cuotas = cuotas_query.all()

    # Si se especificaron IDs, solo contar esas cuotas en el descuento
    if cuotas_ids_incluir is not None:
        cuotas_para_descontar = [c for c in todas_cuotas if c.id in cuotas_ids_incluir]
    else:
        cuotas_para_descontar = todas_cuotas

    descuento_cuotas = sum(c.monto for c in cuotas_para_descontar)

    cuotas_detalle = [
        {
            "id": c.id,
            "prestamo_id": c.prestamo_id,
            "monto": c.monto,
            "motivo": c.prestamo.motivo if c.prestamo else None,
            "monto_total_prestamo": c.prestamo.monto_total if c.prestamo else None,
            "saldo_prestamo": c.prestamo.saldo_pendiente if c.prestamo else None,
        }
        for c in todas_cuotas
    ]

    ajustes_neg = db.query(AjusteLiquidacion).filter(
        AjusteLiquidacion.tipo == "TRABAJADOR",
        AjusteLiquidacion.entidad_id == trabajador.id,
        AjusteLiquidacion.mes == mes,
        AjusteLiquidacion.anio == anio,
        AjusteLiquidacion.monto < 0,
    ).all()
    descuento_ajustes = abs(sum(a.monto for a in ajustes_neg))

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
        "cuotas_detalle": cuotas_detalle,
    }


def _suma_pagado(db: Session, trabajador_id: int, mes: int, anio: int) -> int:
    """Suma todos los PagoTrabajador ya registrados para ese mes."""
    result = db.query(func.sum(PagoTrabajador.monto)).filter(
        PagoTrabajador.trabajador_id == trabajador_id,
        PagoTrabajador.mes == mes,
        PagoTrabajador.anio == anio,
    ).scalar()
    return result or 0


def _estado_segun_pagos(monto_pagado: int, monto_neto: int) -> str:
    """Determina PENDIENTE / PARCIAL / PAGADO según cuánto se ha pagado vs. el total."""
    if monto_pagado <= 0:
        return "PENDIENTE"
    if monto_pagado < monto_neto:
        return "PARCIAL"
    return "PAGADO"


def _upsert_pago_mes(
    db: Session,
    trabajador: Trabajador,
    mes: int,
    anio: int,
    monto_nuevo_pago: int,
    fecha_pago: date,
    forzar_cerrado: bool = False,
    cuotas_ids_incluir: Optional[List[int]] = None,
) -> tuple:
    """
    Actualiza (o crea) el registro PagoMesTrabajador sumando monto_nuevo_pago.
    - Si el mes ya estaba PAGADO, no vuelve a congelar montos ni descuenta cuotas.
    - Si con el nuevo pago la suma alcanza monto_neto → estado PAGADO.
    - Si no llega → estado PARCIAL.
    - forzar_cerrado=True fuerza PAGADO independiente del monto (pago manual "confirmar todo").
    Retorna (pago_mes, es_primera_vez_pagado).
    """
    pago_mes = db.query(PagoMesTrabajador).filter(
        PagoMesTrabajador.trabajador_id == trabajador.id,
        PagoMesTrabajador.mes == mes,
        PagoMesTrabajador.anio == anio,
    ).first()

    ya_cerrado = pago_mes is not None and pago_mes.estado == "PAGADO"

    if ya_cerrado:
        # Mes ya cerrado: sólo actualizamos monto_pagado acumulado
        pago_mes.monto_pagado = (pago_mes.monto_pagado or 0) + monto_nuevo_pago
        return pago_mes, False

    # Calcular/obtener montos
    if pago_mes is None:
        montos_calc = _calcular_monto_neto(db, trabajador, mes, anio, cuotas_ids_incluir)
        montos_orm = {k: v for k, v in montos_calc.items() if k != "cuotas_detalle"}
        pago_mes = PagoMesTrabajador(
            trabajador_id=trabajador.id,
            mes=mes,
            anio=anio,
            monto_pagado=0,
            **montos_orm,
        )
        db.add(pago_mes)
        db.flush()
    elif pago_mes.estado in ("PENDIENTE", "PARCIAL"):
        # Actualizar montos en tiempo real mientras no esté cerrado
        montos_calc = _calcular_monto_neto(db, trabajador, mes, anio, cuotas_ids_incluir)
        pago_mes.monto_bruto = montos_calc["monto_bruto"]
        pago_mes.bonificaciones = montos_calc["bonificaciones"]
        pago_mes.descuento_cuotas = montos_calc["descuento_cuotas"]
        pago_mes.descuento_ajustes = montos_calc["descuento_ajustes"]
        pago_mes.monto_neto = montos_calc["monto_neto"]

    # Acumular pago
    pago_mes.monto_pagado = (pago_mes.monto_pagado or 0) + monto_nuevo_pago
    pago_mes.fecha_pago = fecha_pago

    # Determinar nuevo estado
    if forzar_cerrado or pago_mes.monto_pagado >= pago_mes.monto_neto:
        pago_mes.estado = "PAGADO"
        es_primera_vez_pagado = True
    else:
        pago_mes.estado = "PARCIAL"
        es_primera_vez_pagado = False

    return pago_mes, es_primera_vez_pagado


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
    Incluye monto_pagado acumulado y saldo pendiente.
    """
    ultimo_dia_mes = date(anio, mes, monthrange(anio, mes)[1])

    trabajadores = db.query(Trabajador).filter(
        Trabajador.activo == True,
        (Trabajador.fecha_ingreso == None) | (Trabajador.fecha_ingreso <= ultimo_dia_mes),
    ).order_by(Trabajador.nombre).all()

    pagos_map = {
        p.trabajador_id: p
        for p in db.query(PagoMesTrabajador).filter(
            PagoMesTrabajador.mes == mes,
            PagoMesTrabajador.anio == anio,
        ).all()
    }

    liqs_map = {
        liq.trabajador_id: liq.id
        for liq in db.query(LiquidacionMensual).filter_by(mes=mes, anio=anio).all()
    }

    resultado = []
    for t in trabajadores:
        pago = pagos_map.get(t.id)

        if pago and pago.estado == "PAGADO":
            # Mes cerrado: usar valores congelados
            montos = {
                "monto_bruto": pago.monto_bruto,
                "bonificaciones": pago.bonificaciones,
                "descuento_cuotas": pago.descuento_cuotas,
                "descuento_ajustes": pago.descuento_ajustes,
                "monto_neto": pago.monto_neto,
                "cuotas_detalle": [],  # mes cerrado, cuotas ya procesadas
            }
        else:
            montos = _calcular_monto_neto(db, t, mes, anio)

        monto_pagado = pago.monto_pagado if pago else 0
        saldo = max(0, montos["monto_neto"] - monto_pagado)

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
            "monto_pagado": monto_pagado,
            "saldo": saldo,
            "pago_id": pago.id if pago else None,
            "estado": pago.estado if pago else "PENDIENTE",
            "fecha_pago": str(pago.fecha_pago) if pago and pago.fecha_pago else None,
            "nota": pago.nota if pago else None,
            "liquidacion_id": liqs_map.get(t.id),
        })

    return {"mes": mes, "anio": anio, "items": resultado}


# ──────────────────────────────────────────────────────────
# POST /trabajadores/pago-manual  (nuevo: agrega un pago parcial o completo)
# ──────────────────────────────────────────────────────────

class PagoManualRequest(BaseModel):
    trabajador_id: int
    monto: int                              # monto efectivamente pagado ahora
    fecha_pago: Optional[str] = None
    nota: Optional[str] = None
    forzar_cierre: bool = False             # True = marcar PAGADO aunque monto < monto_neto
    cuotas_a_pagar: Optional[List[int]] = None  # IDs de CuotaPrestamo a descontar; None = todas


@router.post("/pago-manual")
def registrar_pago_manual(
    body: PagoManualRequest,
    request: Request,
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_admin_or_administracion),
):
    """
    Registra un pago manual (parcial o completo) para un trabajador en el mes.
    Puede llamarse múltiples veces: cada llamada acumula el monto_pagado.
    Cuando monto_pagado >= monto_neto (o forzar_cierre=True) → estado PAGADO.
    """
    trabajador = db.get(Trabajador, body.trabajador_id)
    if not trabajador:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")
    if body.monto <= 0:
        raise HTTPException(status_code=400, detail="El monto debe ser mayor a 0")

    if trabajador.fecha_ingreso:
        ultimo_dia_mes = date(anio, mes, monthrange(anio, mes)[1])
        if trabajador.fecha_ingreso > ultimo_dia_mes:
            raise HTTPException(
                status_code=400,
                detail=f"{trabajador.nombre} ingresó el {trabajador.fecha_ingreso} — no puede tener nómina en {mes}/{anio}"
            )

    fecha_pago = _parse_fecha(body.fecha_pago) if body.fecha_pago else date.today()

    # Registrar PagoTrabajador individual
    pago_t = PagoTrabajador(
        trabajador_id=body.trabajador_id,
        mes=mes,
        anio=anio,
        monto=body.monto,
        fecha_pago=str(fecha_pago),
        descripcion=f"Nómina {mes}/{anio}" + (f" — {body.nota}" if body.nota else ""),
        fuente="manual",
    )
    db.add(pago_t)
    db.flush()
    _registrar_movimiento_sueldo(db, trabajador, pago_t)

    # Upsert PagoMesTrabajador acumulativo — con las cuotas que el usuario eligió pagar
    pago_mes, se_cerro = _upsert_pago_mes(
        db, trabajador, mes, anio,
        monto_nuevo_pago=body.monto,
        fecha_pago=fecha_pago,
        forzar_cerrado=body.forzar_cierre,
        cuotas_ids_incluir=body.cuotas_a_pagar,
    )

    if body.nota:
        pago_mes.nota = body.nota

    db.flush()

    # Si se cerró en este pago → descontar cuotas seleccionadas y asiento contable
    if se_cerro:
        _descontar_cuotas(db, body.trabajador_id, mes, anio, cuotas_ids=body.cuotas_a_pagar)
        asiento_pago_trabajador(db, pago_mes)

    audit(db, "pago_manual_trabajador", usuario=current_user, request=request,
          entidad="pago_mes_trabajador", entidad_id=pago_mes.id,
          metadata={"trabajador_id": body.trabajador_id, "mes": mes, "anio": anio,
                    "monto": body.monto, "estado_resultante": pago_mes.estado})

    db.commit()
    return {
        "ok": True,
        "pago_id": pago_mes.id,
        "estado": pago_mes.estado,
        "monto_pagado": pago_mes.monto_pagado,
        "saldo": max(0, pago_mes.monto_neto - pago_mes.monto_pagado),
        "monto_neto": pago_mes.monto_neto,
    }


# ──────────────────────────────────────────────────────────
# PUT /trabajadores/pago-mes/{trabajador_id}  (revertir / actualizar fecha)
# ──────────────────────────────────────────────────────────

class ActualizarPagoMesRequest(BaseModel):
    estado: str                       # PENDIENTE = revertir
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
    """
    Actualiza estado del mes:
    - PENDIENTE: revierte todo (borra PagoTrabajador del mes, resetea monto_pagado)
    - PAGADO con fecha: sólo actualiza fecha_pago si ya estaba PAGADO
    """
    trabajador = db.get(Trabajador, trabajador_id)
    if not trabajador:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")

    pago = db.query(PagoMesTrabajador).filter(
        PagoMesTrabajador.trabajador_id == trabajador_id,
        PagoMesTrabajador.mes == mes,
        PagoMesTrabajador.anio == anio,
    ).first()

    if body.estado == "PENDIENTE":
        # Revertir: borrar todos los PagoTrabajador del mes y resetear registro
        db.query(PagoTrabajador).filter(
            PagoTrabajador.trabajador_id == trabajador_id,
            PagoTrabajador.mes == mes,
            PagoTrabajador.anio == anio,
        ).delete(synchronize_session=False)

        if pago:
            pago.estado = "PENDIENTE"
            pago.monto_pagado = 0
            pago.fecha_pago = None
            if body.nota is not None:
                pago.nota = body.nota

    elif body.estado == "PAGADO":
        if pago and pago.estado == "PAGADO":
            # Solo actualizar fecha
            if body.fecha_pago:
                pago.fecha_pago = _parse_fecha(body.fecha_pago)
            if body.nota is not None:
                pago.nota = body.nota

    audit(db, "actualizar_pago_mes_trabajador", usuario=current_user, request=request,
          entidad="pago_mes_trabajador", entidad_id=pago.id if pago else None,
          metadata={"trabajador_id": trabajador_id, "mes": mes, "anio": anio, "estado": body.estado})

    db.commit()
    return {
        "ok": True,
        "pago_id": pago.id if pago else None,
        "estado": pago.estado if pago else "PENDIENTE",
        "monto_pagado": pago.monto_pagado if pago else 0,
    }


def _descontar_cuotas(
    db: Session,
    trabajador_id: int,
    mes: int,
    anio: int,
    cuotas_ids: Optional[List[int]] = None,
):
    """Marca como pagadas las cuotas de préstamo del trabajador para el mes.
    Si cuotas_ids se especifica, solo marca esas cuotas. None = todas las del mes.
    """
    q = db.query(CuotaPrestamo).join(Prestamo).filter(
        Prestamo.trabajador_id == trabajador_id,
        Prestamo.estado == EstadoPrestamoEnum.ACTIVO.value,
        CuotaPrestamo.mes == mes,
        CuotaPrestamo.anio == anio,
        CuotaPrestamo.pagado == False,
    )
    if cuotas_ids is not None:
        q = q.filter(CuotaPrestamo.id.in_(cuotas_ids))
    cuotas = q.all()

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
    """Genera plantilla Excel TEF con los trabajadores con saldo pendiente del mes."""
    ultimo_dia_mes = date(anio, mes, monthrange(anio, mes)[1])
    trabajadores = db.query(Trabajador).filter(
        Trabajador.activo == True,
        (Trabajador.fecha_ingreso == None) | (Trabajador.fecha_ingreso <= ultimo_dia_mes),
    ).order_by(Trabajador.nombre).all()

    pagos_map = {
        p.trabajador_id: p
        for p in db.query(PagoMesTrabajador).filter(
            PagoMesTrabajador.mes == mes,
            PagoMesTrabajador.anio == anio,
        ).all()
    }

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = f"Nomina {mes}-{anio}"

    headers = ["Nombre", "RUT", "Banco", "Tipo Cuenta", "Número Cuenta", "AFP", "Costo AFP",
               "Sistema Salud", "Costo Salud", "Sueldo Bruto", "Ya Pagado", "Saldo a Pagar"]
    ws.append(headers)

    for t in trabajadores:
        pago = pagos_map.get(t.id)
        if pago and pago.estado == "PAGADO":
            continue  # completamente pagado
        montos = _calcular_monto_neto(db, t, mes, anio)
        ya_pagado = pago.monto_pagado if pago else 0
        saldo = max(0, montos["monto_neto"] - ya_pagado)
        if saldo <= 0:
            continue
        ws.append([
            t.nombre, t.rut or "", t.banco or "", t.tipo_cuenta or "", t.numero_cuenta or "",
            t.afp or "", t.costo_afp or 0,
            t.sistema_salud or "", t.costo_salud or 0,
            montos["monto_bruto"], ya_pagado, saldo,
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
    idx_fecha  = next((i for i, v in enumerate(header_vals) if "fecha" in v), None)
    idx_desc   = next((i for i, v in enumerate(header_vals) if "descripci" in v), None)
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
    contenido = await archivo.read()
    movimientos = _parsear_cartola_trabajadores(contenido)

    trabajadores = db.query(Trabajador).filter(Trabajador.activo == True).all()

    # Pagos ya registrados este mes (acumulados)
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
        ya_pagado = pagados_existentes.get(mejor.id, 0) if mejor else 0
        liquidado = montos.get("monto_neto", 0)
        saldo = max(0, liquidado - ya_pagado)

        resultado.append({
            "descripcion": mov["descripcion"],
            "nombre_extraido": mov["nombre_extraido"],
            "fecha": mov["fecha"],
            "monto": mov["monto"],
            "trabajador_id": mejor.id if mejor else None,
            "trabajador_nombre": mejor.nombre if mejor else None,
            "score": round(mejor_score, 2),
            "match_confiable": match_confiable,
            "ya_pagado": ya_pagado,
            "liquidado": liquidado,
            "saldo": saldo,
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
    Acumula monto_pagado. Si suma >= monto_neto → PAGADO, si no → PARCIAL.
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

        # Registro de pago efectivo individual
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
        db.flush()
        _registrar_movimiento_sueldo(db, trabajador, pago_t)
        grabados += 1

        # Upsert acumulativo
        pago_mes, se_cerro = _upsert_pago_mes(
            db, trabajador, body.mes, body.anio,
            monto_nuevo_pago=item.monto,
            fecha_pago=fecha_pago_date,
        )
        db.flush()

        if se_cerro:
            _descontar_cuotas(db, item.trabajador_id, body.mes, body.anio)
            asiento_pago_trabajador(db, pago_mes)

    audit(db, "carga_cartola_trabajador", usuario=current_user, request=request,
          entidad="cartola_carga", entidad_id=carga.id,
          metadata={"mes": body.mes, "anio": body.anio, "transacciones": len(body.items),
                    "monto_total": sum(it.monto for it in body.items)})

    db.commit()
    return {"ok": True, "grabados": grabados}
