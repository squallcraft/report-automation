from typing import List, Optional
from datetime import date, datetime

import os
import uuid
import shutil

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc

from app.database import get_db
from app.auth import require_admin, require_admin_or_administracion
from app.config import get_settings
from app.models import (
    CategoriaFinanciera, MovimientoFinanciero, EstadoMovimientoEnum,
    PagoSemanaDriver, PagoSemanaSeller, PagoSemanaPickup,
    PagoCartola, PagoCartolaSeller, PagoCartolaPickup,
    PagoTrabajador, PagoMesTrabajador, Trabajador,
    AsientoContable, CalendarioSemanas,
    Driver, Pickup, Seller, EstadoPagoEnum,
)
from app.services.contabilidad import asiento_movimiento_financiero
from app.services.audit import registrar as audit
from app.schemas import (
    CategoriaFinancieraCreate,
    MovimientoFinancieroCreate,
    MovimientoFinancieroUpdate,
    MovimientoFinancieroOut,
)

router = APIRouter(prefix="/finanzas", tags=["Finanzas"])

UPLOAD_DIR = os.path.join(get_settings().UPLOAD_DIR, "documentos_financieros")
ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".webp"}


# ── Helpers ──

def _build_tree(categorias: list, parent_id=None) -> list:
    nodes = []
    for cat in categorias:
        if cat.parent_id == parent_id:
            node = {
                "id": cat.id,
                "nombre": cat.nombre,
                "tipo": cat.tipo,
                "parent_id": cat.parent_id,
                "activo": cat.activo,
                "orden": cat.orden,
                "hijos": _build_tree(categorias, cat.id),
            }
            nodes.append(node)
    nodes.sort(key=lambda x: x["orden"])
    return nodes


def _enrich_movimiento(m: MovimientoFinanciero) -> dict:
    data = {col.name: getattr(m, col.name) for col in m.__table__.columns}
    if m.categoria:
        data["categoria_nombre"] = m.categoria.nombre
        data["categoria_tipo"] = m.categoria.tipo
    else:
        data["categoria_nombre"] = None
        data["categoria_tipo"] = None
    data["tiene_documento"] = bool(m.documento_path)
    return data


def _get_descendant_ids(db: Session, cat_id: int) -> list:
    ids = [cat_id]
    hijos = db.query(CategoriaFinanciera.id).filter(
        CategoriaFinanciera.parent_id == cat_id
    ).all()
    for (hijo_id,) in hijos:
        ids.extend(_get_descendant_ids(db, hijo_id))
    return ids


def _operacional_mes(db: Session, mes: int, anio: int):
    """Ingresos = liquidaciones sellers. Costos = MAX(liquidaciones, pagos reales) drivers + pickups."""
    ingreso_sellers = db.query(
        sqlfunc.coalesce(sqlfunc.sum(PagoSemanaSeller.monto_neto), 0)
    ).filter(PagoSemanaSeller.mes == mes, PagoSemanaSeller.anio == anio).scalar()

    costo_drivers_liq = int(db.query(
        sqlfunc.coalesce(sqlfunc.sum(PagoSemanaDriver.monto_neto), 0)
    ).filter(PagoSemanaDriver.mes == mes, PagoSemanaDriver.anio == anio,
             ~PagoSemanaDriver.driver_id.in_(
                 db.query(Driver.id).filter(Driver.jefe_flota_id.isnot(None))
             )).scalar())

    costo_drivers_real = int(db.query(
        sqlfunc.coalesce(sqlfunc.sum(PagoCartola.monto), 0)
    ).filter(PagoCartola.mes == mes, PagoCartola.anio == anio).scalar())

    costo_pickups_liq = int(db.query(
        sqlfunc.coalesce(sqlfunc.sum(PagoSemanaPickup.monto_neto), 0)
    ).filter(PagoSemanaPickup.mes == mes, PagoSemanaPickup.anio == anio).scalar())

    costo_pickups_real = int(db.query(
        sqlfunc.coalesce(sqlfunc.sum(PagoCartolaPickup.monto), 0)
    ).filter(PagoCartolaPickup.mes == mes, PagoCartolaPickup.anio == anio).scalar())

    costo_drivers = max(costo_drivers_liq, costo_drivers_real)
    costo_pickups = max(costo_pickups_liq, costo_pickups_real)

    return int(ingreso_sellers), costo_drivers + costo_pickups


def _manual_mes(db: Session, mes: int, anio: int):
    """Totales de movimientos manuales (no operacionales) del mes."""
    rows = db.query(
        CategoriaFinanciera.tipo,
        sqlfunc.coalesce(sqlfunc.sum(MovimientoFinanciero.monto), 0).label("total"),
    ).join(CategoriaFinanciera).filter(
        MovimientoFinanciero.mes == mes,
        MovimientoFinanciero.anio == anio,
    ).group_by(CategoriaFinanciera.tipo).all()
    result = {"INGRESO": 0, "EGRESO": 0}
    for r in rows:
        result[r.tipo] = int(r.total)
    return result


# ── Categorías ──

@router.get("/categorias", response_model=List[dict])
def listar_categorias(
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    cats = db.query(CategoriaFinanciera).filter(CategoriaFinanciera.activo == True).all()
    return _build_tree(cats)


@router.post("/categorias", response_model=dict, status_code=201)
def crear_categoria(
    data: CategoriaFinancieraCreate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    if data.parent_id:
        parent = db.get(CategoriaFinanciera, data.parent_id)
        if not parent:
            raise HTTPException(status_code=404, detail="Categoría padre no encontrada")
    cat = CategoriaFinanciera(**data.model_dump())
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return {"id": cat.id, "nombre": cat.nombre, "tipo": cat.tipo,
            "parent_id": cat.parent_id, "activo": cat.activo, "orden": cat.orden, "hijos": []}


@router.put("/categorias/{cat_id}", response_model=dict)
def actualizar_categoria(
    cat_id: int,
    data: CategoriaFinancieraCreate,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    cat = db.get(CategoriaFinanciera, cat_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(cat, field, value)
    db.commit()
    db.refresh(cat)
    return {"id": cat.id, "nombre": cat.nombre, "tipo": cat.tipo,
            "parent_id": cat.parent_id, "activo": cat.activo, "orden": cat.orden, "hijos": []}


@router.delete("/categorias/{cat_id}")
def eliminar_categoria(
    cat_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    cat = db.get(CategoriaFinanciera, cat_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")
    movs = db.query(MovimientoFinanciero).filter(MovimientoFinanciero.categoria_id == cat_id).count()
    if movs > 0:
        raise HTTPException(status_code=400, detail="No se puede eliminar: tiene movimientos asociados")
    hijos = db.query(CategoriaFinanciera).filter(CategoriaFinanciera.parent_id == cat_id).count()
    if hijos > 0:
        raise HTTPException(status_code=400, detail="No se puede eliminar: tiene subcategorías")
    db.delete(cat)
    db.commit()
    return {"message": "Categoría eliminada"}


# ── Dashboard consolidado ──

@router.get("/dashboard")
def dashboard_consolidado(
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    mes_ant = mes - 1 if mes > 1 else 12
    anio_ant = anio if mes > 1 else anio - 1

    ingreso_op, costo_op = _operacional_mes(db, mes, anio)
    manual = _manual_mes(db, mes, anio)
    ingreso_op_ant, costo_op_ant = _operacional_mes(db, mes_ant, anio_ant)
    manual_ant = _manual_mes(db, mes_ant, anio_ant)

    total_ingresos = ingreso_op + manual["INGRESO"]
    total_egresos = costo_op + manual["EGRESO"]
    total_ingresos_ant = ingreso_op_ant + manual_ant["INGRESO"]
    total_egresos_ant = costo_op_ant + manual_ant["EGRESO"]

    pendientes = db.query(sqlfunc.count(MovimientoFinanciero.id)).filter(
        MovimientoFinanciero.mes == mes, MovimientoFinanciero.anio == anio,
        MovimientoFinanciero.estado == EstadoMovimientoEnum.PENDIENTE.value,
    ).scalar()
    vencidos = db.query(sqlfunc.count(MovimientoFinanciero.id)).filter(
        MovimientoFinanciero.mes == mes, MovimientoFinanciero.anio == anio,
        MovimientoFinanciero.estado == EstadoMovimientoEnum.VENCIDO.value,
    ).scalar()

    # Datos por semana para el gráfico
    ingreso_semanal = db.query(
        PagoSemanaSeller.semana,
        sqlfunc.coalesce(sqlfunc.sum(PagoSemanaSeller.monto_neto), 0).label("total"),
    ).filter(PagoSemanaSeller.mes == mes, PagoSemanaSeller.anio == anio
    ).group_by(PagoSemanaSeller.semana).all()

    costo_driver_liq_semanal = db.query(
        PagoSemanaDriver.semana,
        sqlfunc.coalesce(sqlfunc.sum(PagoSemanaDriver.monto_neto), 0).label("total"),
    ).filter(PagoSemanaDriver.mes == mes, PagoSemanaDriver.anio == anio,
             ~PagoSemanaDriver.driver_id.in_(
                 db.query(Driver.id).filter(Driver.jefe_flota_id.isnot(None))
             )).group_by(PagoSemanaDriver.semana).all()

    costo_driver_real_semanal = db.query(
        PagoCartola.semana,
        sqlfunc.coalesce(sqlfunc.sum(PagoCartola.monto), 0).label("total"),
    ).filter(PagoCartola.mes == mes, PagoCartola.anio == anio
    ).group_by(PagoCartola.semana).all()

    costo_pickup_liq_semanal = db.query(
        PagoSemanaPickup.semana,
        sqlfunc.coalesce(sqlfunc.sum(PagoSemanaPickup.monto_neto), 0).label("total"),
    ).filter(PagoSemanaPickup.mes == mes, PagoSemanaPickup.anio == anio
    ).group_by(PagoSemanaPickup.semana).all()

    costo_pickup_real_semanal = db.query(
        PagoCartolaPickup.semana,
        sqlfunc.coalesce(sqlfunc.sum(PagoCartolaPickup.monto), 0).label("total"),
    ).filter(PagoCartolaPickup.mes == mes, PagoCartolaPickup.anio == anio
    ).group_by(PagoCartolaPickup.semana).all()

    semanas = {w: {"ingreso": 0, "costo_drv_liq": 0, "costo_drv_real": 0,
                    "costo_pk_liq": 0, "costo_pk_real": 0} for w in range(1, 6)}
    for r in ingreso_semanal:
        if r.semana in semanas:
            semanas[r.semana]["ingreso"] = int(r.total)
    for r in costo_driver_liq_semanal:
        if r.semana in semanas:
            semanas[r.semana]["costo_drv_liq"] = int(r.total)
    for r in costo_driver_real_semanal:
        if r.semana in semanas:
            semanas[r.semana]["costo_drv_real"] = int(r.total)
    for r in costo_pickup_liq_semanal:
        if r.semana in semanas:
            semanas[r.semana]["costo_pk_liq"] = int(r.total)
    for r in costo_pickup_real_semanal:
        if r.semana in semanas:
            semanas[r.semana]["costo_pk_real"] = int(r.total)

    chart_data = [{"semana": w,
                   "ingresos": semanas[w]["ingreso"],
                   "egresos": max(semanas[w]["costo_drv_liq"], semanas[w]["costo_drv_real"])
                            + max(semanas[w]["costo_pk_liq"], semanas[w]["costo_pk_real"])}
                  for w in sorted(semanas.keys())]

    # Flujo de caja real: por mes/anio del período (más confiable que parsear fecha_pago)
    cobros_reales = db.query(sqlfunc.coalesce(sqlfunc.sum(PagoCartolaSeller.monto), 0)).filter(
        PagoCartolaSeller.mes == mes, PagoCartolaSeller.anio == anio,
    ).scalar()
    pagos_drivers_reales = db.query(sqlfunc.coalesce(sqlfunc.sum(PagoCartola.monto), 0)).filter(
        PagoCartola.mes == mes, PagoCartola.anio == anio,
    ).scalar()
    pagos_pickups_reales = db.query(sqlfunc.coalesce(sqlfunc.sum(PagoCartolaPickup.monto), 0)).filter(
        PagoCartolaPickup.mes == mes, PagoCartolaPickup.anio == anio,
    ).scalar()
    movs_pagados = db.query(sqlfunc.coalesce(sqlfunc.sum(MovimientoFinanciero.monto), 0)).join(CategoriaFinanciera).filter(
        MovimientoFinanciero.mes == mes, MovimientoFinanciero.anio == anio,
        MovimientoFinanciero.estado == EstadoMovimientoEnum.PAGADO.value,
        CategoriaFinanciera.tipo == "EGRESO",
    ).scalar()
    movs_cobrados = db.query(sqlfunc.coalesce(sqlfunc.sum(MovimientoFinanciero.monto), 0)).join(CategoriaFinanciera).filter(
        MovimientoFinanciero.mes == mes, MovimientoFinanciero.anio == anio,
        MovimientoFinanciero.estado == EstadoMovimientoEnum.PAGADO.value,
        CategoriaFinanciera.tipo == "INGRESO",
    ).scalar()

    flujo_caja = {
        "entradas": int(cobros_reales) + int(movs_cobrados),
        "salidas": int(pagos_drivers_reales) + int(pagos_pickups_reales) + int(movs_pagados),
    }
    flujo_caja["neto"] = flujo_caja["entradas"] - flujo_caja["salidas"]

    return {
        "mes": mes, "anio": anio,
        "ingreso_operacional": ingreso_op,
        "costo_operacional": costo_op,
        "ingreso_no_operacional": manual["INGRESO"],
        "gasto_operacional": manual["EGRESO"],
        "total_ingresos": total_ingresos,
        "total_egresos": total_egresos,
        "margen_neto": total_ingresos - total_egresos,
        "total_ingresos_anterior": total_ingresos_ant,
        "total_egresos_anterior": total_egresos_ant,
        "margen_neto_anterior": total_ingresos_ant - total_egresos_ant,
        "pendientes": pendientes,
        "vencidos": vencidos,
        "chart": chart_data,
        "flujo_caja": flujo_caja,
    }


# ── Flujo de caja proyectado ──

@router.get("/flujo-caja")
def flujo_caja_proyectado(
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    from calendar import monthrange
    from collections import defaultdict

    semanas_data = []
    saldo_acumulado = 0

    # Movimientos manuales agrupados por semana según su fecha_pago real
    # Si no tienen fecha_pago, se asignan a semana 1 como fallback
    movs_manuales = db.query(MovimientoFinanciero).join(CategoriaFinanciera).filter(
        MovimientoFinanciero.mes == mes, MovimientoFinanciero.anio == anio,
    ).all()

    # Mapa semana → {INGRESO, EGRESO} para movimientos manuales
    manual_por_semana: dict[int, dict] = defaultdict(lambda: {"INGRESO": 0, "EGRESO": 0})
    cal_semanas = db.query(CalendarioSemanas).filter_by(mes=mes, anio=anio).all()
    # Construir mapa fecha → semana
    fecha_semana_map: dict = {}
    from datetime import timedelta
    for cs in cal_semanas:
        d = cs.fecha_inicio
        while d <= cs.fecha_fin:
            fecha_semana_map[d] = cs.semana
            d = d + timedelta(days=1)

    for m in movs_manuales:
        tipo = m.categoria.tipo if m.categoria else None
        if not tipo:
            continue
        fp = m.fecha_pago
        semana_manual = fecha_semana_map.get(fp, 1) if fp else 1
        manual_por_semana[semana_manual][tipo] += m.monto

    # Costo nómina trabajadores para el mes (se asigna como egreso de semana 1)
    costo_nomina = int(db.query(sqlfunc.coalesce(sqlfunc.sum(PagoMesTrabajador.monto_neto), 0)).filter(
        PagoMesTrabajador.mes == mes, PagoMesTrabajador.anio == anio,
    ).scalar())

    for s in range(1, 6):
        ingreso_sellers = int(db.query(sqlfunc.coalesce(sqlfunc.sum(PagoSemanaSeller.monto_neto), 0)).filter(
            PagoSemanaSeller.semana == s, PagoSemanaSeller.mes == mes, PagoSemanaSeller.anio == anio,
        ).scalar())

        costo_drivers_liq = int(db.query(sqlfunc.coalesce(sqlfunc.sum(PagoSemanaDriver.monto_neto), 0)).filter(
            PagoSemanaDriver.semana == s, PagoSemanaDriver.mes == mes, PagoSemanaDriver.anio == anio,
        ).scalar())
        costo_drivers_real = int(db.query(sqlfunc.coalesce(sqlfunc.sum(PagoCartola.monto), 0)).filter(
            PagoCartola.semana == s, PagoCartola.mes == mes, PagoCartola.anio == anio,
            PagoCartola.fuente == "cartola",
        ).scalar())

        costo_pickups_liq = int(db.query(sqlfunc.coalesce(sqlfunc.sum(PagoSemanaPickup.monto_neto), 0)).filter(
            PagoSemanaPickup.semana == s, PagoSemanaPickup.mes == mes, PagoSemanaPickup.anio == anio,
        ).scalar())
        costo_pickups_real = int(db.query(sqlfunc.coalesce(sqlfunc.sum(PagoCartolaPickup.monto), 0)).filter(
            PagoCartolaPickup.semana == s, PagoCartolaPickup.mes == mes, PagoCartolaPickup.anio == anio,
            PagoCartolaPickup.fuente == "cartola",
        ).scalar())

        manual_s = manual_por_semana.get(s, {"INGRESO": 0, "EGRESO": 0})
        ingresos = ingreso_sellers + manual_s["INGRESO"]
        egresos = (
            max(costo_drivers_liq, costo_drivers_real)
            + max(costo_pickups_liq, costo_pickups_real)
            + manual_s["EGRESO"]
        )
        # Nómina de trabajadores en semana 1
        if s == 1:
            egresos += costo_nomina

        neto = ingresos - egresos
        saldo_acumulado += neto

        semanas_data.append({
            "semana": s,
            "ingresos": ingresos,
            "egresos": egresos,
            "neto": neto,
            "saldo_acumulado": saldo_acumulado,
        })

    # Proyección mes siguiente (basada en recurrentes del mes actual)
    sig_mes = mes + 1 if mes < 12 else 1
    sig_anio = anio if mes < 12 else anio + 1
    recurrentes = db.query(
        CategoriaFinanciera.tipo,
        sqlfunc.coalesce(sqlfunc.sum(MovimientoFinanciero.monto), 0).label("total"),
    ).join(CategoriaFinanciera).filter(
        MovimientoFinanciero.mes == mes, MovimientoFinanciero.anio == anio,
        MovimientoFinanciero.recurrente == True,
    ).group_by(CategoriaFinanciera.tipo).all()
    rec_map = {r.tipo: int(r.total) for r in recurrentes}

    if rec_map:
        neto_proy = rec_map.get("INGRESO", 0) - rec_map.get("EGRESO", 0)
        saldo_acumulado += neto_proy
        semanas_data.append({
            "semana": f"Proy. {sig_mes}/{sig_anio}",
            "ingresos": rec_map.get("INGRESO", 0),
            "egresos": rec_map.get("EGRESO", 0),
            "neto": neto_proy,
            "saldo_acumulado": saldo_acumulado,
            "es_proyeccion": True,
        })

    return {"mes": mes, "anio": anio, "semanas": semanas_data}


# ── Resumen anual ──

@router.get("/resumen-anual")
def resumen_anual(
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Resumen mensual consolidado para todo un año, con todas las fuentes."""
    meses = []
    acumulado_neto = 0

    for mes in range(1, 13):
        ingreso_op, costo_op = _operacional_mes(db, mes, anio)
        manual = _manual_mes(db, mes, anio)

        cobros_sellers = int(db.query(
            sqlfunc.coalesce(sqlfunc.sum(PagoCartolaSeller.monto), 0)
        ).filter(PagoCartolaSeller.mes == mes, PagoCartolaSeller.anio == anio).scalar())

        pagos_drivers = int(db.query(
            sqlfunc.coalesce(sqlfunc.sum(PagoCartola.monto), 0)
        ).filter(PagoCartola.mes == mes, PagoCartola.anio == anio).scalar())

        pagos_pickups = int(db.query(
            sqlfunc.coalesce(sqlfunc.sum(PagoCartolaPickup.monto), 0)
        ).filter(PagoCartolaPickup.mes == mes, PagoCartolaPickup.anio == anio).scalar())

        total_ingresos = ingreso_op + manual["INGRESO"]
        total_egresos = costo_op + manual["EGRESO"]
        margen = total_ingresos - total_egresos
        acumulado_neto += margen

        meses.append({
            "mes": mes,
            "ingreso_operacional": ingreso_op,
            "costo_operacional": costo_op,
            "ingreso_manual": manual["INGRESO"],
            "egreso_manual": manual["EGRESO"],
            "total_ingresos": total_ingresos,
            "total_egresos": total_egresos,
            "margen": margen,
            "acumulado": acumulado_neto,
            "cobros_sellers": cobros_sellers,
            "pagos_drivers": pagos_drivers,
            "pagos_pickups": pagos_pickups,
        })

    totales = {
        "total_ingresos": sum(m["total_ingresos"] for m in meses),
        "total_egresos": sum(m["total_egresos"] for m in meses),
        "margen": sum(m["margen"] for m in meses),
        "cobros_sellers": sum(m["cobros_sellers"] for m in meses),
        "pagos_drivers": sum(m["pagos_drivers"] for m in meses),
        "pagos_pickups": sum(m["pagos_pickups"] for m in meses),
    }

    return {"anio": anio, "meses": meses, "totales": totales}


# ── Transacciones unificadas ──

@router.get("/transacciones")
def listar_transacciones(
    mes: int = Query(...),
    anio: int = Query(...),
    limit: int = Query(200),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    txns = []

    # 1. Movimientos manuales — fecha real desde fecha_pago
    movs = db.query(MovimientoFinanciero).join(CategoriaFinanciera).filter(
        MovimientoFinanciero.mes == mes, MovimientoFinanciero.anio == anio,
    ).all()
    for m in movs:
        fecha = str(m.fecha_pago) if m.fecha_pago else (
            str(m.created_at.date()) if m.created_at else ""
        )
        txns.append({
            "id": f"mov-{m.id}",
            "fecha": fecha,
            "descripcion": m.nombre,
            "tipo": m.categoria.tipo if m.categoria else "—",
            "fuente": "Manual",
            "categoria": m.categoria.nombre if m.categoria else "—",
            "monto": m.monto,
            "estado": m.estado,
            "tiene_documento": bool(m.documento_path),
        })

    # 2. Pagos a drivers — usar fecha_pago real del PagoSemanaDriver
    pagos_d = db.query(PagoSemanaDriver).filter(
        PagoSemanaDriver.mes == mes, PagoSemanaDriver.anio == anio,
        PagoSemanaDriver.estado == EstadoPagoEnum.PAGADO.value,
    ).all()
    for p in pagos_d:
        driver = db.get(Driver, p.driver_id)
        fecha = str(p.fecha_pago) if p.fecha_pago else (
            str(p.updated_at.date()) if p.updated_at else ""
        )
        txns.append({
            "id": f"drv-{p.id}",
            "fecha": fecha,
            "descripcion": f"Pago S{p.semana} — {driver.nombre if driver else 'Driver'}",
            "tipo": "EGRESO",
            "fuente": "Driver",
            "categoria": "Pago Driver",
            "monto": p.monto_neto,
            "estado": "PAGADO",
            "tiene_documento": False,
        })

    # 3. Cobros de sellers — usar fecha_pago real del registro de cartola
    cobros_s = db.query(PagoCartolaSeller).filter(
        PagoCartolaSeller.mes == mes, PagoCartolaSeller.anio == anio,
        PagoCartolaSeller.fuente == "cartola",
    ).all()
    for c in cobros_s:
        seller = db.get(Seller, c.seller_id)
        fecha = str(c.fecha_pago) if c.fecha_pago else ""
        txns.append({
            "id": f"sel-{c.id}",
            "fecha": fecha,
            "descripcion": f"Cobro S{c.semana} — {seller.nombre if seller else 'Seller'}",
            "tipo": "INGRESO",
            "fuente": "Seller",
            "categoria": "Cobro Seller",
            "monto": c.monto,
            "estado": "PAGADO",
            "tiene_documento": False,
        })

    # 4. Pagos a pickups — usar fecha_pago real
    pagos_p = db.query(PagoSemanaPickup).filter(
        PagoSemanaPickup.mes == mes, PagoSemanaPickup.anio == anio,
        PagoSemanaPickup.estado == EstadoPagoEnum.PAGADO.value,
    ).all()
    for p in pagos_p:
        pickup = db.get(Pickup, p.pickup_id)
        fecha = str(p.fecha_pago) if p.fecha_pago else (
            str(p.updated_at.date()) if p.updated_at else ""
        )
        txns.append({
            "id": f"pku-{p.id}",
            "fecha": fecha,
            "descripcion": f"Pago S{p.semana} — {pickup.nombre if pickup else 'Pickup'}",
            "tipo": "EGRESO",
            "fuente": "Pickup",
            "categoria": "Pago Pickup",
            "monto": p.monto_neto,
            "estado": "PAGADO",
            "tiene_documento": False,
        })

    # 5. Pagos a trabajadores — usar fecha_pago real
    pagos_t = db.query(PagoTrabajador).filter(
        PagoTrabajador.mes == mes, PagoTrabajador.anio == anio,
    ).all()
    for pt in pagos_t:
        trabajador = db.get(Trabajador, pt.trabajador_id)
        fecha = str(pt.fecha_pago) if pt.fecha_pago else (
            str(pt.created_at.date()) if pt.created_at else ""
        )
        txns.append({
            "id": f"trb-{pt.id}",
            "fecha": fecha,
            "descripcion": f"Nómina — {trabajador.nombre if trabajador else 'Trabajador'}",
            "tipo": "EGRESO",
            "fuente": "Nómina",
            "categoria": "Pago Nómina",
            "monto": pt.monto,
            "estado": "PAGADO",
            "tiene_documento": False,
        })

    txns.sort(key=lambda x: x["fecha"] or "", reverse=True)
    return txns[:limit]


# ── Movimientos CRUD ──

@router.get("/movimientos", response_model=List[MovimientoFinancieroOut])
def listar_movimientos(
    mes: Optional[int] = None,
    anio: Optional[int] = None,
    categoria_id: Optional[int] = None,
    estado: Optional[str] = None,
    tipo: Optional[str] = None,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    query = db.query(MovimientoFinanciero).join(CategoriaFinanciera)
    if mes is not None:
        query = query.filter(MovimientoFinanciero.mes == mes)
    if anio is not None:
        query = query.filter(MovimientoFinanciero.anio == anio)
    if categoria_id is not None:
        all_ids = _get_descendant_ids(db, categoria_id)
        query = query.filter(MovimientoFinanciero.categoria_id.in_(all_ids))
    if estado is not None:
        query = query.filter(MovimientoFinanciero.estado == estado)
    if tipo is not None:
        query = query.filter(CategoriaFinanciera.tipo == tipo)
    movs = query.order_by(MovimientoFinanciero.created_at.desc()).all()
    return [_enrich_movimiento(m) for m in movs]


@router.post("/movimientos", response_model=MovimientoFinancieroOut, status_code=201)
def crear_movimiento(
    data: MovimientoFinancieroCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    cat = db.get(CategoriaFinanciera, data.categoria_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")
    mov = MovimientoFinanciero(**data.model_dump())
    if data.fecha_pago:
        mov.mes = data.fecha_pago.month
        mov.anio = data.fecha_pago.year
        mov.estado = EstadoMovimientoEnum.PAGADO.value
    db.add(mov)
    db.flush()
    asiento_movimiento_financiero(db, mov)
    audit(db, "crear_movimiento_financiero", usuario=current_user, request=request,
          entidad="movimiento_financiero", entidad_id=mov.id,
          cambios={"nombre": mov.nombre, "monto": mov.monto, "tipo": cat.tipo})
    db.commit()
    db.refresh(mov)
    return _enrich_movimiento(mov)


@router.put("/movimientos/{mov_id}", response_model=MovimientoFinancieroOut)
def actualizar_movimiento(
    mov_id: int,
    data: MovimientoFinancieroUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    mov = db.get(MovimientoFinanciero, mov_id)
    if not mov:
        raise HTTPException(status_code=404, detail="Movimiento no encontrado")
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(mov, field, value)
    if "fecha_pago" in update_data and update_data["fecha_pago"]:
        mov.mes = update_data["fecha_pago"].month
        mov.anio = update_data["fecha_pago"].year
        if "estado" not in update_data:
            mov.estado = EstadoMovimientoEnum.PAGADO.value

    old_asiento = db.query(AsientoContable).filter(
        AsientoContable.ref_tipo == "MovimientoFinanciero",
        AsientoContable.ref_id == mov_id,
    ).first()
    if old_asiento:
        db.delete(old_asiento)
        db.flush()
    asiento_movimiento_financiero(db, mov)
    audit(db, "actualizar_movimiento_financiero", usuario=current_user, request=request,
          entidad="movimiento_financiero", entidad_id=mov_id,
          cambios=update_data)

    db.commit()
    db.refresh(mov)
    return _enrich_movimiento(mov)


@router.delete("/movimientos/{mov_id}")
def eliminar_movimiento(
    mov_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    mov = db.get(MovimientoFinanciero, mov_id)
    if not mov:
        raise HTTPException(status_code=404, detail="Movimiento no encontrado")
    if mov.documento_path and os.path.exists(mov.documento_path):
        os.remove(mov.documento_path)
    old_asiento = db.query(AsientoContable).filter(
        AsientoContable.ref_tipo == "MovimientoFinanciero",
        AsientoContable.ref_id == mov_id,
    ).first()
    if old_asiento:
        db.delete(old_asiento)
    audit(db, "eliminar_movimiento_financiero", usuario=current_user, request=request,
          entidad="movimiento_financiero", entidad_id=mov_id,
          cambios={"nombre": mov.nombre, "monto": mov.monto})
    db.delete(mov)
    db.commit()
    return {"message": "Movimiento eliminado"}


@router.get("/movimientos/vencidos")
def listar_vencidos(
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Lista todos los movimientos vencidos o pendientes pasados de fecha."""
    hoy = date.today()
    vencidos = db.query(MovimientoFinanciero).filter(
        MovimientoFinanciero.estado.in_([
            EstadoMovimientoEnum.PENDIENTE.value,
            EstadoMovimientoEnum.VENCIDO.value,
        ]),
        MovimientoFinanciero.fecha_vencimiento < hoy,
    ).order_by(MovimientoFinanciero.fecha_vencimiento.asc()).all()

    return [_enrich_movimiento(m) for m in vencidos]


# ── Upload / download de documentos ──

MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10 MB


@router.post("/movimientos/{mov_id}/documento", response_model=MovimientoFinancieroOut)
async def subir_documento(
    mov_id: int,
    archivo: UploadFile = File(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    mov = db.get(MovimientoFinanciero, mov_id)
    if not mov:
        raise HTTPException(status_code=404, detail="Movimiento no encontrado")

    ext = os.path.splitext(archivo.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Formato no permitido. Usar: {', '.join(ALLOWED_EXTENSIONS)}")

    contents = await archivo.read()
    if len(contents) > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail="Archivo demasiado grande. Máximo 10 MB.")
    await archivo.seek(0)

    os.makedirs(UPLOAD_DIR, exist_ok=True)

    if mov.documento_path and os.path.exists(mov.documento_path):
        os.remove(mov.documento_path)

    filename = f"{mov_id}_{uuid.uuid4().hex[:8]}{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    with open(filepath, "wb") as f:
        f.write(contents)

    mov.documento_nombre = archivo.filename
    mov.documento_path = filepath
    db.commit()
    db.refresh(mov)
    return _enrich_movimiento(mov)


@router.get("/movimientos/{mov_id}/documento")
def descargar_documento(
    mov_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    mov = db.get(MovimientoFinanciero, mov_id)
    if not mov or not mov.documento_path:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    if not os.path.exists(mov.documento_path):
        raise HTTPException(status_code=404, detail="Archivo no encontrado en disco")
    return FileResponse(mov.documento_path, filename=mov.documento_nombre or "documento")


@router.delete("/movimientos/{mov_id}/documento")
def eliminar_documento(
    mov_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    mov = db.get(MovimientoFinanciero, mov_id)
    if not mov:
        raise HTTPException(status_code=404, detail="Movimiento no encontrado")
    if mov.documento_path and os.path.exists(mov.documento_path):
        os.remove(mov.documento_path)
    mov.documento_nombre = None
    mov.documento_path = None
    db.commit()
    return {"message": "Documento eliminado"}


# ── Copiar recurrentes ──

@router.post("/movimientos/copiar-recurrentes")
def copiar_recurrentes(
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    siguiente_mes = mes + 1 if mes < 12 else 1
    siguiente_anio = anio if mes < 12 else anio + 1

    recurrentes = db.query(MovimientoFinanciero).filter(
        MovimientoFinanciero.mes == mes,
        MovimientoFinanciero.anio == anio,
        MovimientoFinanciero.recurrente == True,
    ).all()

    creados = 0
    for mov in recurrentes:
        existe = db.query(MovimientoFinanciero).filter(
            MovimientoFinanciero.categoria_id == mov.categoria_id,
            MovimientoFinanciero.nombre == mov.nombre,
            MovimientoFinanciero.mes == siguiente_mes,
            MovimientoFinanciero.anio == siguiente_anio,
        ).first()
        if not existe:
            nuevo = MovimientoFinanciero(
                categoria_id=mov.categoria_id,
                nombre=mov.nombre,
                descripcion=mov.descripcion,
                monto=mov.monto,
                moneda=mov.moneda,
                mes=siguiente_mes,
                anio=siguiente_anio,
                estado=EstadoMovimientoEnum.PENDIENTE.value,
                recurrente=True,
                proveedor=mov.proveedor,
                notas=mov.notas,
            )
            db.add(nuevo)
            creados += 1
    db.commit()
    return {"ok": True, "creados": creados, "mes_destino": siguiente_mes, "anio_destino": siguiente_anio}


# ── Resumen por categoría (legacy, usado por tab Detalle) ──

@router.get("/resumen")
def resumen_financiero(
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    mes_ant = mes - 1 if mes > 1 else 12
    anio_ant = anio if mes > 1 else anio - 1

    def _totales_por_cat(m, a):
        rows = db.query(
            MovimientoFinanciero.categoria_id,
            sqlfunc.sum(MovimientoFinanciero.monto).label("total"),
            sqlfunc.count(MovimientoFinanciero.id).label("count"),
        ).filter(
            MovimientoFinanciero.mes == m, MovimientoFinanciero.anio == a,
        ).group_by(MovimientoFinanciero.categoria_id).all()
        return {r.categoria_id: {"total": r.total or 0, "count": r.count} for r in rows}

    actual = _totales_por_cat(mes, anio)
    anterior = _totales_por_cat(mes_ant, anio_ant)
    cats = db.query(CategoriaFinanciera).filter(CategoriaFinanciera.activo == True).all()
    cat_map = {c.id: c for c in cats}

    resumen = []
    for cat_id, data in actual.items():
        cat = cat_map.get(cat_id)
        ant = anterior.get(cat_id, {"total": 0, "count": 0})
        variacion = ((data["total"] - ant["total"]) / ant["total"] * 100) if ant["total"] else None
        resumen.append({
            "categoria_id": cat_id, "categoria_nombre": cat.nombre if cat else "—",
            "categoria_tipo": cat.tipo if cat else "—",
            "total_actual": data["total"], "count_actual": data["count"],
            "total_anterior": ant["total"], "count_anterior": ant["count"],
            "variacion_pct": round(variacion, 1) if variacion is not None else None,
        })
    for cat_id, data in anterior.items():
        if cat_id not in actual:
            cat = cat_map.get(cat_id)
            resumen.append({
                "categoria_id": cat_id, "categoria_nombre": cat.nombre if cat else "—",
                "categoria_tipo": cat.tipo if cat else "—",
                "total_actual": 0, "count_actual": 0,
                "total_anterior": data["total"], "count_anterior": data["count"],
                "variacion_pct": -100.0,
            })

    total_ingresos = sum(r["total_actual"] for r in resumen if r["categoria_tipo"] == "INGRESO")
    total_egresos = sum(r["total_actual"] for r in resumen if r["categoria_tipo"] == "EGRESO")
    total_ingresos_ant = sum(r["total_anterior"] for r in resumen if r["categoria_tipo"] == "INGRESO")
    total_egresos_ant = sum(r["total_anterior"] for r in resumen if r["categoria_tipo"] == "EGRESO")

    pendientes = db.query(sqlfunc.count(MovimientoFinanciero.id)).filter(
        MovimientoFinanciero.mes == mes, MovimientoFinanciero.anio == anio,
        MovimientoFinanciero.estado == EstadoMovimientoEnum.PENDIENTE.value,
    ).scalar()
    vencidos = db.query(sqlfunc.count(MovimientoFinanciero.id)).filter(
        MovimientoFinanciero.mes == mes, MovimientoFinanciero.anio == anio,
        MovimientoFinanciero.estado == EstadoMovimientoEnum.VENCIDO.value,
    ).scalar()

    return {
        "mes": mes, "anio": anio, "detalle": resumen,
        "total_ingresos": total_ingresos, "total_egresos": total_egresos,
        "flujo_neto": total_ingresos - total_egresos,
        "total_ingresos_anterior": total_ingresos_ant, "total_egresos_anterior": total_egresos_ant,
        "flujo_neto_anterior": total_ingresos_ant - total_egresos_ant,
        "pendientes": pendientes, "vencidos": vencidos,
    }


# ═══════════════════════════════════════════════════════════════════
#  GL — Contabilidad de Partida Doble
# ═══════════════════════════════════════════════════════════════════

from app.models import CuentaContable, LineaAsiento
from app.services.contabilidad import backfill_historico


@router.post("/contabilidad/backfill")
def ejecutar_backfill(
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """Genera asientos contables para todas las operaciones históricas. Idempotente."""
    stats = backfill_historico(db)
    db.commit()
    return stats


@router.get("/contabilidad/libro-diario")
def libro_diario(
    mes: int = Query(...),
    anio: int = Query(...),
    limit: int = Query(200, le=500),
    offset: int = Query(0),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Lista de asientos contables de un período con sus líneas."""
    total = db.query(sqlfunc.count(AsientoContable.id)).filter(
        AsientoContable.mes == mes, AsientoContable.anio == anio,
    ).scalar()

    asientos = db.query(AsientoContable).filter(
        AsientoContable.mes == mes, AsientoContable.anio == anio,
    ).order_by(AsientoContable.fecha.desc(), AsientoContable.id.desc()).offset(offset).limit(limit).all()

    result = []
    for a in asientos:
        lineas = db.query(LineaAsiento).filter(LineaAsiento.asiento_id == a.id).all()
        result.append({
            "id": a.id,
            "fecha": a.fecha.isoformat() if a.fecha else None,
            "descripcion": a.descripcion,
            "ref_tipo": a.ref_tipo,
            "ref_id": a.ref_id,
            "es_backfill": a.es_backfill,
            "creado_por": a.creado_por,
            "lineas": [{
                "cuenta_id": l.cuenta_id,
                "cuenta_codigo": l.cuenta.codigo if l.cuenta else "",
                "cuenta_nombre": l.cuenta.nombre if l.cuenta else "",
                "debe": l.debe,
                "haber": l.haber,
                "glosa": l.glosa,
            } for l in lineas],
        })

    return {"total": total, "offset": offset, "limit": limit, "asientos": result}


@router.get("/contabilidad/balance-comprobacion")
def balance_comprobacion(
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Balance de comprobación: saldos debe/haber por cuenta contable para un período."""
    cuentas = db.query(CuentaContable).filter(CuentaContable.activo == True).order_by(CuentaContable.codigo).all()

    rows = []
    total_debe = 0
    total_haber = 0
    for cuenta in cuentas:
        sumas = db.query(
            sqlfunc.coalesce(sqlfunc.sum(LineaAsiento.debe), 0),
            sqlfunc.coalesce(sqlfunc.sum(LineaAsiento.haber), 0),
        ).join(AsientoContable).filter(
            LineaAsiento.cuenta_id == cuenta.id,
            AsientoContable.mes == mes,
            AsientoContable.anio == anio,
        ).first()
        debe = int(sumas[0])
        haber = int(sumas[1])
        if debe == 0 and haber == 0:
            continue
        saldo = debe - haber
        rows.append({
            "cuenta_id": cuenta.id,
            "codigo": cuenta.codigo,
            "nombre": cuenta.nombre,
            "tipo": cuenta.tipo,
            "debe": debe,
            "haber": haber,
            "saldo": saldo,
        })
        total_debe += debe
        total_haber += haber

    return {
        "mes": mes, "anio": anio,
        "cuentas": rows,
        "total_debe": total_debe,
        "total_haber": total_haber,
        "balanceado": total_debe == total_haber,
    }


@router.get("/contabilidad/saldos")
def saldos_acumulados(
    hasta_mes: int = Query(...),
    hasta_anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Saldos acumulados por cuenta (desde inicio hasta el período indicado)."""
    cuentas = db.query(CuentaContable).filter(CuentaContable.activo == True).order_by(CuentaContable.codigo).all()

    rows = []
    totales = {"activo": 0, "pasivo": 0, "patrimonio": 0, "ingreso": 0, "gasto": 0}
    for cuenta in cuentas:
        sumas = db.query(
            sqlfunc.coalesce(sqlfunc.sum(LineaAsiento.debe), 0),
            sqlfunc.coalesce(sqlfunc.sum(LineaAsiento.haber), 0),
        ).join(AsientoContable).filter(
            LineaAsiento.cuenta_id == cuenta.id,
            (AsientoContable.anio < hasta_anio) | (
                (AsientoContable.anio == hasta_anio) & (AsientoContable.mes <= hasta_mes)
            ),
        ).first()
        debe = int(sumas[0])
        haber = int(sumas[1])
        if debe == 0 and haber == 0:
            continue

        if cuenta.tipo in ("ACTIVO", "GASTO"):
            saldo = debe - haber
        else:
            saldo = haber - debe

        rows.append({
            "cuenta_id": cuenta.id,
            "codigo": cuenta.codigo,
            "nombre": cuenta.nombre,
            "tipo": cuenta.tipo,
            "debe": debe,
            "haber": haber,
            "saldo": saldo,
        })
        totales[cuenta.tipo.lower()] += saldo

    return {
        "hasta_mes": hasta_mes, "hasta_anio": hasta_anio,
        "cuentas": rows,
        "resumen": totales,
    }


@router.get("/contabilidad/plan-cuentas")
def plan_cuentas(
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Retorna el plan de cuentas completo."""
    cuentas = db.query(CuentaContable).order_by(CuentaContable.codigo).all()
    return [{
        "id": c.id,
        "codigo": c.codigo,
        "nombre": c.nombre,
        "tipo": c.tipo,
        "parent_id": c.parent_id,
        "activo": c.activo,
    } for c in cuentas]
