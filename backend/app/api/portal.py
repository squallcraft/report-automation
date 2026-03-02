"""
Endpoints del portal de seller y driver:
- Liquidación propia (seller y driver)
- Facturación propia (seller)
- PDF filtrado (seller sin datos driver, driver sin datos seller)
- Excel filtrado (mismas restricciones)
"""
import io
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import require_seller, require_driver
from app.models import (
    Envio, Seller, Driver, Retiro, AjusteLiquidacion,
    TipoEntidadEnum, PagoSemanaSeller, FacturaMensualSeller,
    CalendarioSemanas, EstadoPagoEnum,
)
from app.services.liquidacion import calcular_liquidacion_sellers, calcular_liquidacion_drivers
from app.services.pdf_generator import generar_pdf_seller, generar_pdf_driver

router = APIRouter(prefix="/portal", tags=["Portal"])

MESES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
         "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]


def _semanas_del_mes(db: Session, mes: int, anio: int):
    rows = db.query(CalendarioSemanas.semana).filter(
        CalendarioSemanas.mes == mes,
        CalendarioSemanas.anio == anio,
    ).order_by(CalendarioSemanas.semana).all()
    return [r[0] for r in rows] if rows else [1, 2, 3, 4, 5]


def _monto_semanal_seller(db, seller_id, semana, mes, anio):
    envios = db.query(Envio).filter(
        Envio.seller_id == seller_id, Envio.semana == semana,
        Envio.mes == mes, Envio.anio == anio,
    ).all()
    if not envios:
        return 0
    seller = db.get(Seller, seller_id)
    total = sum(e.cobro_seller + e.cobro_extra_manual + e.extra_producto_seller + e.extra_comuna_seller for e in envios)
    if seller and seller.tiene_retiro and not seller.usa_pickup:
        if not (seller.min_paquetes_retiro_gratis > 0 and len(envios) >= seller.min_paquetes_retiro_gratis):
            retiros = db.query(Retiro).filter(
                Retiro.seller_id == seller_id, Retiro.semana == semana,
                Retiro.mes == mes, Retiro.anio == anio,
            ).all()
            total += sum(r.tarifa_seller for r in retiros)
    ajustes = db.query(AjusteLiquidacion).filter(
        AjusteLiquidacion.tipo == TipoEntidadEnum.SELLER,
        AjusteLiquidacion.entidad_id == seller_id,
        AjusteLiquidacion.semana == semana,
        AjusteLiquidacion.mes == mes,
        AjusteLiquidacion.anio == anio,
    ).all()
    total += sum(a.monto for a in ajustes)
    return total


# ── SELLER ──────────────────────────────────────────────────────────────────

@router.get("/seller/liquidacion")
def seller_liquidacion(
    semana: int = Query(...),
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_seller),
):
    seller_id = current_user["id"]
    resultado = calcular_liquidacion_sellers(db, semana, mes, anio)
    row = next((r for r in resultado if r["seller_id"] == seller_id), None)
    if not row:
        return {
            "seller_id": seller_id, "semana": semana, "mes": mes, "anio": anio,
            "cantidad_envios": 0, "total_envios": 0,
            "total_extras_producto": 0, "total_extras_comuna": 0,
            "total_retiros": 0, "total_ajustes": 0,
            "subtotal": 0, "iva": 0, "total_con_iva": 0,
        }
    # Excluir campos de driver del resultado
    return {k: v for k, v in row.items() if k not in ("empresa", "user_nombres")}


@router.get("/seller/facturacion")
def seller_facturacion(
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_seller),
):
    seller_id = current_user["id"]
    seller = db.get(Seller, seller_id)
    if not seller:
        raise HTTPException(status_code=404)

    semanas = _semanas_del_mes(db, mes, anio)
    semanas_data = {}
    subtotal = 0

    for sem in semanas:
        pago = db.query(PagoSemanaSeller).filter(
            PagoSemanaSeller.seller_id == seller_id,
            PagoSemanaSeller.semana == sem,
            PagoSemanaSeller.mes == mes,
            PagoSemanaSeller.anio == anio,
        ).first()
        monto = pago.monto_override if (pago and pago.monto_override is not None) else _monto_semanal_seller(db, seller_id, sem, mes, anio)
        estado = pago.estado if pago else EstadoPagoEnum.PENDIENTE.value
        semanas_data[str(sem)] = {"monto_neto": monto, "estado": estado}
        subtotal += monto

    iva = int(subtotal * 0.19)
    factura = db.query(FacturaMensualSeller).filter(
        FacturaMensualSeller.seller_id == seller_id,
        FacturaMensualSeller.mes == mes,
        FacturaMensualSeller.anio == anio,
    ).first()

    return {
        "seller_id": seller_id,
        "seller_nombre": seller.nombre,
        "rut": seller.rut,
        "mes": mes, "anio": anio,
        "semanas_disponibles": semanas,
        "semanas": semanas_data,
        "subtotal_neto": subtotal,
        "iva": iva,
        "total_con_iva": subtotal + iva,
        "factura_estado": factura.estado if factura else None,
        "factura_folio": factura.folio_haulmer if factura else None,
    }


@router.get("/seller/pdf")
def seller_pdf(
    semana: int = Query(...),
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_seller),
):
    seller_id = current_user["id"]
    seller = db.get(Seller, seller_id)
    if not seller:
        raise HTTPException(status_code=404)
    try:
        pdf_bytes = generar_pdf_seller(db, seller_id, semana, mes, anio)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Sin datos para este período: {e}")
    nombre = seller.nombre.replace("/", "-")
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=liquidacion_{nombre}_S{semana}_M{mes}_{anio}.pdf"},
    )


@router.get("/seller/excel")
def seller_excel(
    semana: int = Query(...),
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_seller),
):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Border, Side

    seller_id = current_user["id"]
    seller = db.get(Seller, seller_id)
    if not seller:
        raise HTTPException(status_code=404)

    envios = db.query(Envio).filter(
        Envio.seller_id == seller_id,
        Envio.semana == semana, Envio.mes == mes, Envio.anio == anio,
    ).order_by(Envio.fecha_entrega).all()

    if not envios:
        raise HTTPException(status_code=404, detail="Sin envíos para este período")

    wb = Workbook()
    ws = wb.active
    ws.title = "Mis Envíos"

    # Solo columnas visibles para seller (sin info de driver)
    headers = [
        "Fecha Entrega", "Tracking", "Comuna", "Bultos",
        "Descripción Producto", "Código MLC",
        "Cobro Base", "Extra Prod.", "Extra Com.", "Extra Manual", "Total",
    ]
    hfont = Font(bold=True, color="FFFFFF", size=10)
    hfill = PatternFill(start_color="2B6CB0", end_color="2B6CB0", fill_type="solid")
    thin = Border(
        left=Side(style="thin", color="D0D0D0"), right=Side(style="thin", color="D0D0D0"),
        top=Side(style="thin", color="D0D0D0"), bottom=Side(style="thin", color="D0D0D0"),
    )
    for i, h in enumerate(headers, 1):
        c = ws.cell(row=1, column=i, value=h)
        c.font = hfont
        c.fill = hfill
        c.border = thin

    for idx, e in enumerate(envios, 2):
        total = e.cobro_seller + e.extra_producto_seller + e.extra_comuna_seller + (e.cobro_extra_manual or 0)
        row = [
            str(e.fecha_entrega) if e.fecha_entrega else "",
            e.tracking_id or "",
            (e.comuna or "").title(),
            e.bultos,
            e.descripcion_producto or "",
            e.codigo_producto or "",
            e.cobro_seller,
            e.extra_producto_seller,
            e.extra_comuna_seller,
            e.cobro_extra_manual or 0,
            total,
        ]
        for ci, v in enumerate(row, 1):
            c = ws.cell(row=idx, column=ci, value=v)
            c.border = thin

    ws.auto_filter.ref = f"A1:{chr(64 + len(headers))}1"
    ws.freeze_panes = "A2"
    for col in ws.columns:
        ws.column_dimensions[col[0].column_letter].width = max(len(str(col[0].value or "")), 10) + 4

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    nombre = seller.nombre.replace("/", "-").replace("\\", "-")
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=envios_{nombre}_S{semana}_M{mes}_{anio}.xlsx"},
    )


# ── DRIVER ──────────────────────────────────────────────────────────────────

@router.get("/driver/liquidacion")
def driver_liquidacion(
    semana: int = Query(...),
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_driver),
):
    driver_id = current_user["id"]
    resultado = calcular_liquidacion_drivers(db, semana, mes, anio)
    row = next((r for r in resultado if r["driver_id"] == driver_id), None)
    if not row:
        return {
            "driver_id": driver_id, "semana": semana, "mes": mes, "anio": anio,
            "cantidad_envios": 0, "total_envios": 0,
            "total_extras_producto": 0, "total_extras_comuna": 0,
            "total_retiros": 0, "total_ajustes": 0,
            "subtotal": 0, "iva": 0, "total": 0,
        }
    return row


@router.get("/driver/excel")
def driver_excel(
    semana: int = Query(...),
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_driver),
):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Border, Side

    driver_id = current_user["id"]
    driver = db.get(Driver, driver_id)
    if not driver:
        raise HTTPException(status_code=404)

    envios = db.query(Envio).filter(
        Envio.driver_id == driver_id,
        Envio.semana == semana, Envio.mes == mes, Envio.anio == anio,
    ).order_by(Envio.fecha_entrega).all()

    if not envios:
        raise HTTPException(status_code=404, detail="Sin entregas para este período")

    wb = Workbook()
    ws = wb.active
    ws.title = "Mis Entregas"

    es_contratado = getattr(driver, 'contratado', False)
    if es_contratado:
        headers = [
            "Fecha Entrega", "Tracking", "Seller", "Comuna", "Bultos",
            "Descripción Producto",
            "Pago Base", "Pago Extra Manual", "Total",
        ]
    else:
        headers = [
            "Fecha Entrega", "Tracking", "Seller", "Comuna", "Bultos",
            "Descripción Producto",
            "Pago Base", "Extra Prod.", "Extra Com.", "Pago Extra Manual", "Total",
        ]
    hfont = Font(bold=True, color="FFFFFF", size=10)
    hfill = PatternFill(start_color="059669", end_color="059669", fill_type="solid")
    thin = Border(
        left=Side(style="thin", color="D0D0D0"), right=Side(style="thin", color="D0D0D0"),
        top=Side(style="thin", color="D0D0D0"), bottom=Side(style="thin", color="D0D0D0"),
    )
    for i, h in enumerate(headers, 1):
        c = ws.cell(row=1, column=i, value=h)
        c.font = hfont
        c.fill = hfill
        c.border = thin

    for idx, e in enumerate(envios, 2):
        seller = db.get(Seller, e.seller_id) if e.seller_id else None
        if es_contratado:
            total = e.costo_driver + (e.pago_extra_manual or 0)
            row = [
                str(e.fecha_entrega) if e.fecha_entrega else "",
                e.tracking_id or "",
                seller.nombre if seller else (e.seller_nombre_raw or ""),
                (e.comuna or "").title(),
                e.bultos,
                e.descripcion_producto or "",
                e.costo_driver,
                e.pago_extra_manual or 0,
                total,
            ]
        else:
            total = e.costo_driver + e.extra_producto_driver + e.extra_comuna_driver + (e.pago_extra_manual or 0)
            row = [
                str(e.fecha_entrega) if e.fecha_entrega else "",
                e.tracking_id or "",
                seller.nombre if seller else (e.seller_nombre_raw or ""),
                (e.comuna or "").title(),
                e.bultos,
                e.descripcion_producto or "",
                e.costo_driver,
                e.extra_producto_driver,
                e.extra_comuna_driver,
                e.pago_extra_manual or 0,
                total,
            ]
        for ci, v in enumerate(row, 1):
            c = ws.cell(row=idx, column=ci, value=v)
            c.border = thin

    ws.auto_filter.ref = f"A1:{chr(64 + len(headers))}1"
    ws.freeze_panes = "A2"
    for col in ws.columns:
        ws.column_dimensions[col[0].column_letter].width = max(len(str(col[0].value or "")), 10) + 4

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    nombre = driver.nombre.replace("/", "-").replace("\\", "-")
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=entregas_{nombre}_S{semana}_M{mes}_{anio}.xlsx"},
    )
