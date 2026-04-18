"""
Router de remuneraciones y liquidaciones mensuales.

Endpoints admin:
  POST /remuneraciones/liquidaciones/generar-mes   — genera/actualiza liquidaciones del mes
  GET  /remuneraciones/liquidaciones/              — lista liquidaciones por mes/año
  GET  /remuneraciones/liquidaciones/{id}/pdf      — descarga PDF individual
  POST /remuneraciones/liquidaciones/lote-pdf      — ZIP con todos los PDFs del mes
  PUT  /remuneraciones/liquidaciones/{id}          — cambia estado (BORRADOR→EMITIDA)
  POST /remuneraciones/contabilidad/backfill-asientos — regenera asientos enriquecidos

Endpoints portal trabajador (require_trabajador):
  GET  /remuneraciones/portal/perfil
  GET  /remuneraciones/portal/liquidaciones
  GET  /remuneraciones/portal/liquidaciones/{id}/pdf
  GET  /remuneraciones/portal/pagos
  GET  /remuneraciones/portal/imposiciones

Endpoints portal driver-link (require_driver):
  GET  /remuneraciones/portal/driver-link
"""
from __future__ import annotations

import io
import zipfile
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import (
    require_admin_or_administracion,
    require_admin,
    get_current_user,
    RolEnum,
)
from app.models import (
    LiquidacionMensual, Trabajador, ParametrosMensuales,
    PagoMesTrabajador, PagoTrabajador, Driver,
    AjusteLiquidacion, CuotaPrestamo, Prestamo, EstadoPrestamoEnum,
)
from app.services.parametros import obtener_parametros
from app.services.remuneraciones import calcular_desde_liquido

router = APIRouter(prefix="/remuneraciones", tags=["Remuneraciones"])

MESES_ES = [
    "", "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_trabajador_portal(current_user: dict, db: Session) -> Trabajador:
    """Resuelve el trabajador autenticado desde rol TRABAJADOR."""
    if current_user["rol"] != RolEnum.TRABAJADOR:
        raise HTTPException(status_code=403, detail="Acceso solo para trabajadores")
    t = db.query(Trabajador).filter(
        Trabajador.id == current_user["id"],
        Trabajador.activo == True,
    ).first()
    if not t:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")
    return t


def require_trabajador(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user["rol"] != RolEnum.TRABAJADOR:
        raise HTTPException(status_code=403, detail="Acceso solo para trabajadores")
    return current_user


def _liq_to_dict(liq: LiquidacionMensual, nombre: str = "") -> dict:
    return {
        "id": liq.id,
        "trabajador_id": liq.trabajador_id,
        "nombre_trabajador": nombre,
        "mes": liq.mes,
        "anio": liq.anio,
        "sueldo_base": liq.sueldo_base,
        "gratificacion": liq.gratificacion,
        "movilizacion": liq.movilizacion,
        "colacion": liq.colacion,
        "viaticos": liq.viaticos,
        "remuneracion_imponible": liq.remuneracion_imponible,
        "descuento_afp": liq.descuento_afp,
        "descuento_salud_legal": liq.descuento_salud_legal,
        "adicional_isapre": liq.adicional_isapre,
        "descuento_cesantia": liq.descuento_cesantia,
        "iusc": liq.iusc,
        "total_descuentos": liq.total_descuentos,
        "sueldo_liquido": liq.sueldo_liquido,
        "costo_sis": liq.costo_sis,
        "costo_cesantia_empleador": liq.costo_cesantia_empleador,
        "costo_mutual": liq.costo_mutual,
        "costo_empresa_total": liq.costo_empresa_total,
        "uf_usada": float(liq.uf_usada) if liq.uf_usada else None,
        "utm_usado": liq.utm_usado,
        "imm_usado": liq.imm_usado,
        "estado": liq.estado,
        "pago_mes_id": liq.pago_mes_id,
        "created_at": liq.created_at.isoformat() if liq.created_at else None,
        "updated_at": liq.updated_at.isoformat() if liq.updated_at else None,
    }


def _generar_pdf_para_liquidacion(liq: LiquidacionMensual, db: Session) -> bytes:
    from app.services.pdf_generator import generar_pdf_liquidacion
    from app.models import AjusteLiquidacion, CuotaPrestamo, Prestamo, EstadoPrestamoEnum
    trabajador = db.get(Trabajador, liq.trabajador_id)
    if not trabajador:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")

    # Recopilar descuentos adicionales (préstamos + ajustes negativos) para el período
    descuentos_adicionales = []

    # Cuotas de préstamos activos del mes
    cuotas = (
        db.query(CuotaPrestamo)
        .join(Prestamo)
        .filter(
            Prestamo.trabajador_id == trabajador.id,
            Prestamo.estado == EstadoPrestamoEnum.ACTIVO.value,
            CuotaPrestamo.mes == liq.mes,
            CuotaPrestamo.anio == liq.anio,
            CuotaPrestamo.pagado == False,
        )
        .all()
    )
    for c in cuotas:
        motivo = c.prestamo.motivo if c.prestamo else "Préstamo"
        descuentos_adicionales.append({
            "concepto": f"Cuota Préstamo — {motivo}",
            "monto": c.monto,
        })

    # Ajustes negativos del mes
    ajustes_neg = (
        db.query(AjusteLiquidacion)
        .filter(
            AjusteLiquidacion.tipo == "TRABAJADOR",
            AjusteLiquidacion.entidad_id == trabajador.id,
            AjusteLiquidacion.mes == liq.mes,
            AjusteLiquidacion.anio == liq.anio,
            AjusteLiquidacion.monto < 0,
        )
        .all()
    )
    for a in ajustes_neg:
        descuentos_adicionales.append({
            "concepto": f"Ajuste — {a.motivo or 'descuento'}",
            "monto": abs(a.monto),
        })

    return generar_pdf_liquidacion(
        liq, trabajador,
        descuentos_adicionales=descuentos_adicionales or None,
    )


# ── Admin — Generación de liquidaciones ──────────────────────────────────────

@router.post("/liquidaciones/generar-mes")
def generar_liquidaciones_mes(
    mes: int = Query(..., ge=1, le=12),
    anio: int = Query(..., ge=2020),
    trabajador_id: Optional[int] = Query(None, description="Si se pasa, solo genera para ese trabajador"),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    """
    Genera (o actualiza si están en BORRADOR) las liquidaciones mensuales.
    Los registros en estado PAGADA no se modifican.
    Idempotente: ejecutar varias veces produce el mismo resultado.
    """
    parametros = obtener_parametros(db, anio, mes)
    param_row = db.query(ParametrosMensuales).filter_by(anio=anio, mes=mes).first()

    query = db.query(Trabajador).filter(Trabajador.activo == True)
    if trabajador_id:
        query = query.filter(Trabajador.id == trabajador_id)
    trabajadores = query.all()

    generadas = []
    omitidas = []
    errores = []

    for t in trabajadores:
        if not t.sueldo_liquido or t.sueldo_liquido <= 0:
            omitidas.append({"id": t.id, "nombre": t.nombre, "motivo": "sin sueldo_liquido"})
            continue

        existing = db.query(LiquidacionMensual).filter_by(
            trabajador_id=t.id, mes=mes, anio=anio
        ).first()

        if existing and existing.estado == "PAGADA":
            omitidas.append({"id": t.id, "nombre": t.nombre, "motivo": "ya está PAGADA"})
            continue

        try:
            r = calcular_desde_liquido(
                sueldo_liquido=t.sueldo_liquido,
                afp=t.afp,
                sistema_salud=t.sistema_salud,
                monto_cotizacion_salud=t.monto_cotizacion_salud,
                tipo_contrato=t.tipo_contrato,
                movilizacion=t.movilizacion or 0,
                colacion=t.colacion or 0,
                viaticos=t.viaticos or 0,
                utm=int(parametros["utm"]),
                valor_uf=float(parametros["uf"]),
                imm=int(parametros["imm"]),
            )
        except Exception as exc:
            errores.append({"id": t.id, "nombre": t.nombre, "error": str(exc)})
            continue

        if existing:
            # Actualizar BORRADOR
            liq = existing
        else:
            liq = LiquidacionMensual(trabajador_id=t.id, mes=mes, anio=anio)
            db.add(liq)

        liq.parametros_id = param_row.id if param_row else None
        liq.sueldo_base = r.sueldo_base
        liq.gratificacion = r.gratificacion
        liq.movilizacion = r.movilizacion
        liq.colacion = r.colacion
        liq.viaticos = r.viaticos
        liq.remuneracion_imponible = r.remuneracion_imponible
        liq.descuento_afp = r.descuento_afp
        liq.descuento_salud_legal = r.descuento_salud_legal
        liq.adicional_isapre = r.adicional_isapre
        liq.descuento_cesantia = r.descuento_cesantia
        liq.iusc = r.iusc
        liq.total_descuentos = r.total_descuentos
        liq.sueldo_liquido = r.sueldo_liquido
        liq.costo_sis = r.costo_empresa_sis
        liq.costo_cesantia_empleador = r.costo_empresa_cesantia
        liq.costo_mutual = r.costo_empresa_mutual
        liq.costo_empresa_total = r.costo_empresa_total
        liq.uf_usada = parametros["uf"]
        liq.utm_usado = int(parametros["utm"])
        liq.imm_usado = int(parametros["imm"])
        liq.estado = liq.estado if existing else "BORRADOR"

        generadas.append({"id": t.id, "nombre": t.nombre})

    db.commit()

    return {
        "mes": mes,
        "anio": anio,
        "generadas": len(generadas),
        "omitidas": len(omitidas),
        "errores": len(errores),
        "detalle_generadas": generadas,
        "detalle_omitidas": omitidas,
        "detalle_errores": errores,
        "parametros_usados": {
            "uf": parametros["uf"],
            "utm": parametros["utm"],
            "imm": parametros["imm"],
            "fuente": parametros.get("fuente"),
        },
    }


@router.get("/liquidaciones/")
def listar_liquidaciones(
    mes: int = Query(..., ge=1, le=12),
    anio: int = Query(..., ge=2020),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    liqs = (
        db.query(LiquidacionMensual)
        .filter_by(mes=mes, anio=anio)
        .order_by(LiquidacionMensual.trabajador_id)
        .all()
    )
    trabajadores_map = {
        t.id: t.nombre
        for t in db.query(Trabajador).filter(Trabajador.id.in_([l.trabajador_id for l in liqs])).all()
    }
    return [_liq_to_dict(liq, trabajadores_map.get(liq.trabajador_id, "")) for liq in liqs]


@router.get("/liquidaciones/{liquidacion_id}/pdf")
def descargar_pdf_liquidacion(
    liquidacion_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    liq = db.get(LiquidacionMensual, liquidacion_id)
    if not liq:
        raise HTTPException(status_code=404, detail="Liquidación no encontrada")
    pdf_bytes = _generar_pdf_para_liquidacion(liq, db)
    trabajador = db.get(Trabajador, liq.trabajador_id)
    nombre = (trabajador.nombre or "trabajador").replace(" ", "_") if trabajador else "trabajador"
    filename = f"liquidacion_{nombre}_{liq.anio}_{liq.mes:02d}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/liquidaciones/lote-pdf")
def descargar_lote_pdf(
    mes: int = Query(..., ge=1, le=12),
    anio: int = Query(..., ge=2020),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    """Genera un ZIP con todos los PDFs de liquidaciones del mes."""
    liqs = db.query(LiquidacionMensual).filter_by(mes=mes, anio=anio).all()
    if not liqs:
        raise HTTPException(status_code=404, detail="No hay liquidaciones para ese período")

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for liq in liqs:
            try:
                pdf_bytes = _generar_pdf_para_liquidacion(liq, db)
                trabajador = db.get(Trabajador, liq.trabajador_id)
                nombre = (trabajador.nombre or f"t{liq.trabajador_id}").replace(" ", "_") if trabajador else f"t{liq.trabajador_id}"
                zf.writestr(f"liquidacion_{nombre}_{anio}_{mes:02d}.pdf", pdf_bytes)
            except Exception:
                continue

    zip_buffer.seek(0)
    mes_str = MESES_ES[mes]
    filename = f"liquidaciones_{mes_str}_{anio}.zip"
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.put("/liquidaciones/{liquidacion_id}")
def actualizar_estado_liquidacion(
    liquidacion_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    """Cambia el estado de una liquidación (BORRADOR → EMITIDA, etc.)."""
    liq = db.get(LiquidacionMensual, liquidacion_id)
    if not liq:
        raise HTTPException(status_code=404, detail="Liquidación no encontrada")
    nuevo_estado = body.get("estado", "").upper()
    if nuevo_estado not in ("BORRADOR", "EMITIDA", "PAGADA"):
        raise HTTPException(status_code=400, detail="Estado inválido. Use BORRADOR, EMITIDA o PAGADA")
    if liq.estado == "PAGADA" and nuevo_estado != "PAGADA":
        raise HTTPException(status_code=400, detail="No se puede revertir una liquidación PAGADA")
    liq.estado = nuevo_estado
    db.commit()
    trabajador = db.get(Trabajador, liq.trabajador_id)
    return _liq_to_dict(liq, trabajador.nombre if trabajador else "")


@router.post("/contabilidad/backfill-asientos")
def backfill_asientos_remuneraciones(
    mes: int = Query(..., ge=1, le=12),
    anio: int = Query(..., ge=2020),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    """
    Regenera los asientos contables enriquecidos para todas las liquidaciones
    PAGADAS del mes indicado. Elimina el asiento previo y crea uno nuevo con
    el desglose completo (AFP, salud, AFC, IUSC).
    Operación no-destructiva: solo actúa sobre registros que tienen LiquidacionMensual.
    """
    from app.services.contabilidad import asiento_pago_trabajador_enriquecido, eliminar_asiento_de_ref
    from app.models import AsientoContable

    liqs = (
        db.query(LiquidacionMensual)
        .filter_by(mes=mes, anio=anio, estado="PAGADA")
        .all()
    )
    if not liqs:
        raise HTTPException(status_code=404, detail="No hay liquidaciones PAGADAS para ese período")

    procesados = 0
    errores = []
    for liq in liqs:
        try:
            if liq.pago_mes_id:
                pago_mes = db.get(PagoMesTrabajador, liq.pago_mes_id)
                if pago_mes:
                    eliminar_asiento_de_ref(db, "PagoMesTrabajador", pago_mes.id)
                    asiento_pago_trabajador_enriquecido(db, pago_mes, liq)
                    procesados += 1
        except Exception as exc:
            trabajador = db.get(Trabajador, liq.trabajador_id)
            errores.append({"trabajador": getattr(trabajador, "nombre", str(liq.trabajador_id)), "error": str(exc)})

    db.commit()
    return {"procesados": procesados, "errores": errores}


# ── Portal Trabajador ─────────────────────────────────────────────────────────

@router.get("/portal/perfil")
def portal_perfil(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_trabajador),
):
    t = _get_trabajador_portal(current_user, db)
    return {
        "id": t.id,
        "nombre": t.nombre,
        "rut": t.rut,
        "email": t.email,
        "cargo": t.cargo,
        "tipo_contrato": t.tipo_contrato,
        "afp": t.afp,
        "sistema_salud": t.sistema_salud,
        "banco": t.banco,
        "tipo_cuenta": t.tipo_cuenta,
        "numero_cuenta": t.numero_cuenta,
        "fecha_ingreso": t.fecha_ingreso.isoformat() if t.fecha_ingreso else None,
        "sueldo_liquido": t.sueldo_liquido,
    }


@router.get("/portal/liquidaciones")
def portal_liquidaciones(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_trabajador),
):
    t = _get_trabajador_portal(current_user, db)
    liqs = (
        db.query(LiquidacionMensual)
        .filter_by(trabajador_id=t.id)
        .filter(LiquidacionMensual.estado.in_(["EMITIDA", "PAGADA"]))
        .order_by(LiquidacionMensual.anio.desc(), LiquidacionMensual.mes.desc())
        .all()
    )
    return [_liq_to_dict(liq, t.nombre) for liq in liqs]


@router.get("/portal/liquidaciones/{liquidacion_id}/pdf")
def portal_descargar_pdf(
    liquidacion_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_trabajador),
):
    t = _get_trabajador_portal(current_user, db)
    liq = db.get(LiquidacionMensual, liquidacion_id)
    if not liq or liq.trabajador_id != t.id:
        raise HTTPException(status_code=404, detail="Liquidación no encontrada")
    if liq.estado == "BORRADOR":
        raise HTTPException(status_code=403, detail="Liquidación aún no emitida")
    pdf_bytes = _generar_pdf_para_liquidacion(liq, db)
    nombre = t.nombre.replace(" ", "_")
    filename = f"liquidacion_{nombre}_{liq.anio}_{liq.mes:02d}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/portal/pagos")
def portal_pagos(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_trabajador),
):
    t = _get_trabajador_portal(current_user, db)
    pagos = (
        db.query(PagoTrabajador)
        .filter_by(trabajador_id=t.id)
        .order_by(PagoTrabajador.anio.desc(), PagoTrabajador.mes.desc(), PagoTrabajador.created_at.desc())
        .all()
    )
    return [
        {
            "id": p.id,
            "mes": p.mes,
            "anio": p.anio,
            "monto": p.monto,
            "fecha_pago": p.fecha_pago,
            "descripcion": p.descripcion,
            "fuente": p.fuente,
            "created_at": p.created_at.isoformat() if p.created_at else None,
        }
        for p in pagos
    ]


@router.get("/portal/imposiciones")
def portal_imposiciones(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_trabajador),
):
    """
    Resumen mensual de imposiciones (AFP, Salud, Cesantía, IUSC) extraído
    de las liquidaciones emitidas/pagadas del trabajador.
    """
    t = _get_trabajador_portal(current_user, db)
    liqs = (
        db.query(LiquidacionMensual)
        .filter_by(trabajador_id=t.id)
        .filter(LiquidacionMensual.estado.in_(["EMITIDA", "PAGADA"]))
        .order_by(LiquidacionMensual.anio.desc(), LiquidacionMensual.mes.desc())
        .all()
    )
    rows = []
    totales = {"afp": 0, "salud": 0, "cesantia": 0, "iusc": 0}
    for liq in liqs:
        rows.append({
            "mes": liq.mes,
            "anio": liq.anio,
            "remuneracion_imponible": liq.remuneracion_imponible,
            "descuento_afp": liq.descuento_afp,
            "descuento_salud_legal": liq.descuento_salud_legal,
            "adicional_isapre": liq.adicional_isapre,
            "descuento_cesantia": liq.descuento_cesantia,
            "iusc": liq.iusc,
            "total_descuentos": liq.total_descuentos,
            "sueldo_liquido": liq.sueldo_liquido,
        })
        totales["afp"] += liq.descuento_afp
        totales["salud"] += liq.descuento_salud_legal + liq.adicional_isapre
        totales["cesantia"] += liq.descuento_cesantia
        totales["iusc"] += liq.iusc
    return {"meses": rows, "totales_periodo": totales}


# ── Portal Driver-Link ────────────────────────────────────────────────────────

@router.get("/portal/driver-link")
def portal_driver_link(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Para un DRIVER autenticado con trabajador_id vinculado, retorna sus
    liquidaciones salariales (EMITIDA o PAGADA).
    """
    if current_user["rol"] != RolEnum.DRIVER:
        raise HTTPException(status_code=403, detail="Solo para drivers")

    driver = db.query(Driver).filter(Driver.id == current_user["id"]).first()
    if not driver or not driver.trabajador_id:
        return {"vinculado": False, "liquidaciones": []}

    t = db.get(Trabajador, driver.trabajador_id)
    if not t:
        return {"vinculado": False, "liquidaciones": []}

    liqs = (
        db.query(LiquidacionMensual)
        .filter_by(trabajador_id=t.id)
        .filter(LiquidacionMensual.estado.in_(["EMITIDA", "PAGADA"]))
        .order_by(LiquidacionMensual.anio.desc(), LiquidacionMensual.mes.desc())
        .all()
    )
    return {
        "vinculado": True,
        "trabajador": {"id": t.id, "nombre": t.nombre, "cargo": t.cargo},
        "liquidaciones": [_liq_to_dict(liq, t.nombre) for liq in liqs],
    }


@router.get("/portal/driver-link/{liquidacion_id}/pdf")
def portal_driver_link_pdf(
    liquidacion_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Descarga un PDF de liquidación para un driver vinculado a un trabajador."""
    if current_user["rol"] != RolEnum.DRIVER:
        raise HTTPException(status_code=403, detail="Solo para drivers")

    driver = db.query(Driver).filter(Driver.id == current_user["id"]).first()
    if not driver or not driver.trabajador_id:
        raise HTTPException(status_code=403, detail="No tienes sueldo vinculado")

    liq = db.get(LiquidacionMensual, liquidacion_id)
    if not liq or liq.trabajador_id != driver.trabajador_id:
        raise HTTPException(status_code=404, detail="Liquidación no encontrada")
    if liq.estado == "BORRADOR":
        raise HTTPException(status_code=403, detail="Liquidación aún no emitida")

    pdf_bytes = _generar_pdf_para_liquidacion(liq, db)
    t = db.get(Trabajador, liq.trabajador_id)
    nombre = (t.nombre or "trabajador").replace(" ", "_") if t else "trabajador"
    filename = f"liquidacion_{nombre}_{liq.anio}_{liq.mes:02d}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
