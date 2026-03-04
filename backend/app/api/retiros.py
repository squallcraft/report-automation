from typing import Optional, List

import io
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
import pandas as pd

from app.database import get_db
from app.auth import require_admin, require_admin_or_administracion
from app.models import Retiro, Seller, Driver
from app.schemas import RetiroCreate, RetiroOut
from app.services.ingesta import calcular_semana_del_mes, homologar_nombre

router = APIRouter(prefix="/retiros", tags=["Retiros"])


def _enrich_retiro(r, db) -> dict:
    data = {col.name: getattr(r, col.name) for col in r.__table__.columns}
    seller = db.get(Seller, r.seller_id) if r.seller_id else None
    driver = db.get(Driver, r.driver_id) if r.driver_id else None
    data["seller_nombre"] = seller.nombre if seller else r.seller_nombre_raw or "—"
    data["driver_nombre"] = driver.nombre if driver else r.driver_nombre_raw or "—"
    return data


@router.get("", response_model=List[RetiroOut])
def listar_retiros(
    semana: Optional[int] = None,
    mes: Optional[int] = None,
    anio: Optional[int] = None,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    query = db.query(Retiro)
    if semana is not None:
        query = query.filter(Retiro.semana == semana)
    if mes is not None:
        query = query.filter(Retiro.mes == mes)
    if anio is not None:
        query = query.filter(Retiro.anio == anio)
    retiros = query.order_by(Retiro.fecha.desc()).all()
    return [_enrich_retiro(r, db) for r in retiros]


@router.get("/plantilla/descargar")
def descargar_plantilla_retiros():
    """Genera plantilla Excel para importación masiva de retiros."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Retiros"

    columnas = ["Fecha Retiro", "Nombre Conductor", "Nombre Seller"]

    hf = Font(bold=True, color="FFFFFF", size=11)
    hfill = PatternFill(start_color="2B6CB0", end_color="2B6CB0", fill_type="solid")
    ha = Alignment(horizontal="center", vertical="center", wrap_text=True)
    border = Border(
        left=Side(style="thin", color="D0D0D0"), right=Side(style="thin", color="D0D0D0"),
        top=Side(style="thin", color="D0D0D0"), bottom=Side(style="thin", color="D0D0D0"),
    )

    for i, col in enumerate(columnas, 1):
        c = ws.cell(row=1, column=i, value=col)
        c.font = hf
        c.fill = hfill
        c.alignment = ha
        c.border = border

    ejemplos = [
        ["2026-02-28", "Carlos", "MercadoLibre Chile"],
        ["2026-02-28", "Augusto", "Ferretería Oviedo"],
        ["2026-02-27", "Jorge", "Aventura Store"],
    ]

    alt = PatternFill(start_color="F7FAFC", end_color="F7FAFC", fill_type="solid")
    for ri, fila in enumerate(ejemplos, 2):
        for ci, val in enumerate(fila, 1):
            c = ws.cell(row=ri, column=ci, value=val)
            c.font = Font(size=10)
            c.border = border
            if ri % 2 == 0:
                c.fill = alt

    anchos = [18, 28, 30]
    for i, w in enumerate(anchos, 1):
        ws.column_dimensions[ws.cell(1, i).column_letter].width = w

    ws.auto_filter.ref = "A1:C1"
    ws.freeze_panes = "A2"

    wsi = wb.create_sheet("Instrucciones")
    instrucciones = [
        ("Instrucciones para Importación de Retiros", ""),
        ("", ""),
        ("Campo", "Descripción"),
        ("Fecha Retiro", "Fecha en formato YYYY-MM-DD o DD/MM/YYYY. El sistema calcula automáticamente semana, mes y año."),
        ("Nombre Conductor", "Nombre del conductor que realizó el retiro. Se homologa automáticamente con los drivers registrados."),
        ("Nombre Seller", "Nombre del seller donde se hizo el retiro. Se homologa con los sellers registrados. Las tarifas se obtienen automáticamente del seller."),
        ("", ""),
        ("Notas importantes:", ""),
        ("", "Los sellers con 'usa_pickup = Sí' serán ignorados (pickup no genera retiro)."),
        ("", "La tarifa de cobro al seller y el pago al driver se toman de la configuración del seller."),
        ("", "Si un nombre no se puede homologar, el retiro queda como 'sin homologar' y se puede resolver manualmente."),
    ]
    for ri, (a, b) in enumerate(instrucciones, 1):
        ca = wsi.cell(row=ri, column=1, value=a)
        cb = wsi.cell(row=ri, column=2, value=b)
        if ri == 1:
            ca.font = Font(bold=True, size=14, color="1A365D")
        elif ri == 3:
            ca.font = Font(bold=True, size=11)
            cb.font = Font(bold=True, size=11)
        else:
            ca.font = Font(bold=True, size=10) if a else Font(size=10)
            cb.font = Font(size=10, color="4A5568")
    wsi.column_dimensions["A"].width = 22
    wsi.column_dimensions["B"].width = 90

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": "attachment; filename=plantilla_retiros.xlsx"})


@router.post("/importar")
async def importar_retiros(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """Importa retiros desde un archivo Excel. Homologa conductores y sellers automáticamente."""
    if not file.filename or not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Solo se aceptan archivos Excel (.xlsx)")

    content = await file.read()
    df = pd.read_excel(io.BytesIO(content))

    # Map columns flexibly
    col_map = {}
    for col in df.columns:
        cl = col.lower().strip()
        if "fecha" in cl:
            col_map[col] = "fecha"
        elif "conductor" in cl or "driver" in cl:
            col_map[col] = "conductor"
        elif "seller" in cl or "cliente" in cl:
            col_map[col] = "seller"
    df = df.rename(columns=col_map)

    sellers = db.query(Seller).filter(Seller.activo == True).all()
    drivers = db.query(Driver).filter(Driver.activo == True).all()
    seller_cache = {}
    driver_cache = {}
    ingesta_id = str(uuid.uuid4())[:8]

    creados = 0
    ignorados_pickup = 0
    sin_homologar = []
    errores = []

    for idx, row in df.iterrows():
        try:
            fecha_raw = row.get("fecha")
            if pd.isna(fecha_raw):
                errores.append(f"Fila {idx + 2}: sin fecha")
                continue

            if isinstance(fecha_raw, str):
                fecha = pd.to_datetime(fecha_raw).date()
            else:
                fecha = pd.Timestamp(fecha_raw).date()

            conductor_raw = str(row.get("conductor", "")).strip() if not pd.isna(row.get("conductor")) else None
            seller_raw = str(row.get("seller", "")).strip() if not pd.isna(row.get("seller")) else None

            if not conductor_raw or not seller_raw:
                errores.append(f"Fila {idx + 2}: faltan conductor o seller")
                continue

            driver_id = homologar_nombre(conductor_raw, drivers, driver_cache)
            seller_id = homologar_nombre(seller_raw, sellers, seller_cache)

            homologado = driver_id is not None and seller_id is not None

            seller = db.get(Seller, seller_id) if seller_id else None

            # Skip pickup sellers
            if seller and seller.usa_pickup:
                ignorados_pickup += 1
                continue

            tarifa_seller = 0
            tarifa_driver = 0
            if seller:
                tarifa_seller = seller.tarifa_retiro or 0
                tarifa_driver = seller.tarifa_retiro_driver or 0

            semana = calcular_semana_del_mes(fecha)

            retiro = Retiro(
                fecha=fecha,
                semana=semana,
                mes=fecha.month,
                anio=fecha.year,
                seller_id=seller_id,
                driver_id=driver_id,
                tarifa_seller=tarifa_seller,
                tarifa_driver=tarifa_driver,
                seller_nombre_raw=seller_raw,
                driver_nombre_raw=conductor_raw,
                homologado=homologado,
                ingesta_id=ingesta_id,
            )
            db.add(retiro)
            creados += 1

            if not homologado:
                if not driver_id:
                    sin_homologar.append(f"Driver: {conductor_raw}")
                if not seller_id:
                    sin_homologar.append(f"Seller: {seller_raw}")

        except Exception as e:
            errores.append(f"Fila {idx + 2}: {str(e)}")

    db.commit()
    return {
        "creados": creados,
        "ignorados_pickup": ignorados_pickup,
        "sin_homologar": list(set(sin_homologar)),
        "errores": errores,
    }


@router.post("", response_model=RetiroOut, status_code=201)
def crear_retiro(data: RetiroCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    seller = db.get(Seller, data.seller_id)
    if not seller:
        raise HTTPException(status_code=404, detail="Seller no encontrado")
    driver = db.get(Driver, data.driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver no encontrado")
    retiro = Retiro(**data.model_dump())
    db.add(retiro)
    db.commit()
    db.refresh(retiro)
    return _enrich_retiro(retiro, db)


@router.delete("/{retiro_id}")
def eliminar_retiro(retiro_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    retiro = db.get(Retiro, retiro_id)
    if not retiro:
        raise HTTPException(status_code=404, detail="Retiro no encontrado")
    db.delete(retiro)
    db.commit()
    return {"message": "Retiro eliminado"}
