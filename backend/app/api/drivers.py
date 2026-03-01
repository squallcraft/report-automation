from typing import Optional, List
import io

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy import func as sqlfunc
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
import pandas as pd

from app.database import get_db
from app.auth import require_admin, require_admin_or_administracion, require_driver, get_current_user, hash_password
from app.models import Driver, RolEnum
from app.schemas import DriverCreate, DriverUpdate, DriverOut

router = APIRouter(prefix="/drivers", tags=["Drivers"])


def _enrich_driver(d: Driver, db: Session) -> dict:
    data = {c.name: getattr(d, c.name) for c in d.__table__.columns}
    data["aliases"] = d.aliases or []
    if d.jefe_flota_id:
        jefe = db.get(Driver, d.jefe_flota_id)
        data["jefe_flota_nombre"] = jefe.nombre if jefe else None
    else:
        data["jefe_flota_nombre"] = None
    data["subordinados_count"] = db.query(Driver).filter(
        Driver.jefe_flota_id == d.id, Driver.activo == True
    ).count()
    return data


@router.get("", response_model=List[DriverOut])
def listar_drivers(
    activo: Optional[bool] = None,
    q: Optional[str] = None,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    query = db.query(Driver)
    if activo is not None:
        query = query.filter(Driver.activo == activo)
    if q:
        query = query.filter(Driver.nombre.ilike(f"%{q}%"))
    drivers = query.order_by(Driver.nombre).all()
    return [_enrich_driver(d, db) for d in drivers]


@router.get("/plantilla/homologacion/descargar")
def descargar_plantilla_homologacion(db: Session = Depends(get_db)):
    """Genera plantilla Excel para homologación de nombres de drivers."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Homologación"

    columnas = ["Nombre Driver Raw", "Nombre Driver"]

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

    drivers = db.query(Driver).filter(Driver.activo == True).order_by(Driver.nombre).all()
    alt = PatternFill(start_color="F7FAFC", end_color="F7FAFC", fill_type="solid")
    ri = 2
    for d in drivers:
        for alias in (d.aliases or []):
            ws.cell(row=ri, column=1, value=alias).font = Font(size=10)
            ws.cell(row=ri, column=2, value=d.nombre).font = Font(size=10)
            for ci in (1, 2):
                ws.cell(row=ri, column=ci).border = border
                if ri % 2 == 0:
                    ws.cell(row=ri, column=ci).fill = alt
            ri += 1

    if ri == 2:
        ejemplos = [
            ["Carlos Pérez (auto-create)", "Carlos"],
            ["Carlos P.", "Carlos"],
            ["AUGUSTO", "Augusto"],
            ["Jorge Diaz", "Jorge"],
        ]
        for fila in ejemplos:
            for ci, val in enumerate(fila, 1):
                c = ws.cell(row=ri, column=ci, value=val)
                c.font = Font(size=10)
                c.border = border
                if ri % 2 == 0:
                    c.fill = alt
            ri += 1

    anchos = [36, 30]
    for i, w in enumerate(anchos, 1):
        ws.column_dimensions[ws.cell(1, i).column_letter].width = w

    ws.auto_filter.ref = "A1:B1"
    ws.freeze_panes = "A2"

    wsi = wb.create_sheet("Instrucciones")
    instrucciones = [
        ("Plantilla de Homologación de Drivers", ""),
        ("", ""),
        ("Campo", "Descripción"),
        ("Nombre Driver Raw", "Nombre tal como llega desde el software de gestión (ej: 'Carlos Pérez (auto-create)', 'AUGUSTO')."),
        ("Nombre Driver", "Nombre oficial del conductor en el sistema. Si no existe, se creará automáticamente."),
        ("", ""),
        ("Nota", "Cada fila mapea un nombre raw a un driver. Un driver puede tener múltiples nombres raw."),
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
                             headers={"Content-Disposition": "attachment; filename=plantilla_homologacion_drivers.xlsx"})


@router.get("/plantilla/tarifas/descargar")
def descargar_plantilla_tarifas(db: Session = Depends(get_db)):
    """Genera plantilla Excel para tarifas de drivers."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Tarifas"

    columnas = ["Nombre Driver", "Tarifa ECOURIER", "Tarifa OVIEDO", "Tarifa TERCERIZADO"]

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

    drivers = db.query(Driver).filter(Driver.activo == True).order_by(Driver.nombre).all()
    alt = PatternFill(start_color="F7FAFC", end_color="F7FAFC", fill_type="solid")
    for ri, d in enumerate(drivers, 2):
        vals = [d.nombre, d.tarifa_ecourier, d.tarifa_oviedo, d.tarifa_tercerizado]
        for ci, val in enumerate(vals, 1):
            c = ws.cell(row=ri, column=ci, value=val)
            c.font = Font(size=10)
            c.border = border
            if ri % 2 == 0:
                c.fill = alt

    if not drivers:
        ejemplos = [
            ["Carlos", 1700, 1800, 1500],
            ["Augusto", 1900, 1800, 1500],
            ["Jorge", 2000, 1800, 1500],
        ]
        for ri, fila in enumerate(ejemplos, 2):
            for ci, val in enumerate(fila, 1):
                c = ws.cell(row=ri, column=ci, value=val)
                c.font = Font(size=10)
                c.border = border
                if ri % 2 == 0:
                    c.fill = alt

    anchos = [28, 18, 18, 22]
    for i, w in enumerate(anchos, 1):
        ws.column_dimensions[ws.cell(1, i).column_letter].width = w

    ws.auto_filter.ref = "A1:D1"
    ws.freeze_panes = "A2"

    wsi = wb.create_sheet("Instrucciones")
    instrucciones = [
        ("Plantilla de Tarifas de Drivers", ""),
        ("", ""),
        ("Campo", "Descripción"),
        ("Nombre Driver", "Nombre oficial del conductor (obligatorio, único). Si no existe, se creará."),
        ("Tarifa ECOURIER", "Monto en CLP por envío de seller tipo ECOURIER."),
        ("Tarifa OVIEDO", "Monto en CLP por envío de seller tipo OVIEDO."),
        ("Tarifa TERCERIZADO", "Monto en CLP por envío de seller tipo TERCERIZADO."),
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
                             headers={"Content-Disposition": "attachment; filename=plantilla_tarifas_drivers.xlsx"})


@router.post("/importar/homologacion")
async def importar_homologacion(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """
    Importa plantilla de homologación.
    Columnas: Nombre Driver Raw, Nombre Driver.
    Agrega cada raw_name como alias del driver. Si el driver no existe, lo crea.
    """
    if not file.filename or not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Solo se aceptan archivos Excel")

    content = await file.read()
    df = pd.read_excel(io.BytesIO(content))

    col_map = {}
    for col in df.columns:
        cl = col.lower().strip()
        if "raw" in cl:
            col_map[col] = "raw_name"
        elif "driver" in cl or "conductor" in cl or "nombre" in cl:
            if "raw_name" not in col_map.values():
                col_map[col] = "raw_name"
            else:
                col_map[col] = "driver_name"
    df = df.rename(columns=col_map)

    if "raw_name" not in df.columns or "driver_name" not in df.columns:
        cols = list(df.columns)
        if len(cols) >= 2:
            df = df.rename(columns={cols[0]: "raw_name", cols[1]: "driver_name"})
        else:
            raise HTTPException(status_code=400, detail="Se esperan al menos 2 columnas: Nombre Driver Raw, Nombre Driver")

    aliases_added = 0
    drivers_created = 0
    errores = []

    for idx, row in df.iterrows():
        try:
            raw_name = str(row.get("raw_name", "")).strip()
            driver_name = str(row.get("driver_name", "")).strip()

            if not raw_name or raw_name == "nan" or not driver_name or driver_name == "nan":
                continue

            driver = db.query(Driver).filter(
                sqlfunc.lower(Driver.nombre) == driver_name.lower()
            ).first()
            if not driver:
                driver = Driver(nombre=driver_name)
                db.add(driver)
                db.flush()
                drivers_created += 1

            current_aliases = list(driver.aliases or [])
            already = any(a.lower() == raw_name.lower() for a in current_aliases)
            if not already:
                current_aliases.append(raw_name)
                driver.aliases = current_aliases
                flag_modified(driver, "aliases")
                aliases_added += 1

        except Exception as e:
            errores.append(f"Fila {idx + 2}: {str(e)}")

    db.commit()
    return {
        "aliases_agregados": aliases_added,
        "drivers_creados": drivers_created,
        "errores": errores,
    }


@router.post("/importar/tarifas")
async def importar_tarifas(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """
    Importa plantilla de tarifas.
    Columnas: Nombre Driver, Tarifa ECOURIER, Tarifa OVIEDO, Tarifa TERCERIZADO.
    """
    if not file.filename or not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Solo se aceptan archivos Excel")

    content = await file.read()
    df = pd.read_excel(io.BytesIO(content))

    col_map = {}
    for col in df.columns:
        cl = col.lower().strip()
        if "ecourier" in cl:
            col_map[col] = "tarifa_ecourier"
        elif "oviedo" in cl:
            col_map[col] = "tarifa_oviedo"
        elif "tercerizado" in cl:
            col_map[col] = "tarifa_tercerizado"
        elif ("nombre" in cl or "driver" in cl or "conductor" in cl) and "tarifa" not in cl:
            col_map[col] = "nombre"
    df = df.rename(columns=col_map)

    if "nombre" not in df.columns:
        cols = [c for c in df.columns if c not in col_map.values()]
        if cols:
            df = df.rename(columns={cols[0]: "nombre"})
        else:
            raise HTTPException(status_code=400, detail="No se encontró columna de nombre del driver")

    creados = 0
    actualizados = 0
    errores = []
    seen_names = set()

    for idx, row in df.iterrows():
        try:
            nombre = str(row.get("nombre", "")).strip()
            if not nombre or nombre == "nan":
                continue
            if nombre in seen_names:
                continue
            seen_names.add(nombre)

            t_ec = int(row.get("tarifa_ecourier", 1700)) if not pd.isna(row.get("tarifa_ecourier", 0)) else 1700
            t_ov = int(row.get("tarifa_oviedo", 1800)) if not pd.isna(row.get("tarifa_oviedo", 0)) else 1800
            t_te = int(row.get("tarifa_tercerizado", 1500)) if not pd.isna(row.get("tarifa_tercerizado", 0)) else 1500

            existing = db.query(Driver).filter(
                sqlfunc.lower(Driver.nombre) == nombre.lower()
            ).first()
            if existing:
                existing.tarifa_ecourier = t_ec
                existing.tarifa_oviedo = t_ov
                existing.tarifa_tercerizado = t_te
                actualizados += 1
            else:
                driver = Driver(
                    nombre=nombre,
                    tarifa_ecourier=t_ec, tarifa_oviedo=t_ov, tarifa_tercerizado=t_te,
                )
                db.add(driver)
                creados += 1
        except Exception as e:
            errores.append(f"Fila {idx + 2}: {str(e)}")

    db.commit()
    return {"creados": creados, "actualizados": actualizados, "errores": errores}


@router.get("/plantilla/bancaria/descargar")
def descargar_plantilla_bancaria(db: Session = Depends(get_db), _=Depends(require_admin)):
    """Plantilla Excel con drivers para completar datos bancarios."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Datos Bancarios"

    columnas = ["Conductor", "RUT", "Banco", "Tipo Cuenta", "N° Cuenta"]
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

    drivers = db.query(Driver).filter(Driver.activo == True).order_by(Driver.nombre).all()
    alt = PatternFill(start_color="F7FAFC", end_color="F7FAFC", fill_type="solid")
    for ri, d in enumerate(drivers, 2):
        vals = [d.nombre, d.rut or "", d.banco or "", d.tipo_cuenta or "", d.numero_cuenta or ""]
        for ci, val in enumerate(vals, 1):
            c = ws.cell(row=ri, column=ci, value=val)
            c.font = Font(size=10, bold=(ci == 1))
            c.border = border
            if ri % 2 == 0:
                c.fill = alt

    ws.column_dimensions["A"].width = 30
    ws.column_dimensions["B"].width = 18
    ws.column_dimensions["C"].width = 25
    ws.column_dimensions["D"].width = 20
    ws.column_dimensions["E"].width = 22
    ws.auto_filter.ref = "A1:E1"
    ws.freeze_panes = "A2"

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": "attachment; filename=plantilla_bancaria_drivers.xlsx"})


@router.post("/importar/bancaria")
async def importar_bancaria(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin),
):
    """Importa datos bancarios de drivers desde Excel."""
    if not file.filename or not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Solo se aceptan archivos Excel")

    content = await file.read()
    df = pd.read_excel(io.BytesIO(content))

    col_map = {}
    for col in df.columns:
        cl = col.lower().strip()
        if "conductor" in cl or "driver" in cl or "nombre" in cl:
            col_map[col] = "nombre"
        elif "rut" in cl:
            col_map[col] = "rut"
        elif "banco" in cl:
            col_map[col] = "banco"
        elif "tipo" in cl and "cuenta" in cl:
            col_map[col] = "tipo_cuenta"
        elif ("cuenta" in cl or "numero" in cl) and "tipo" not in cl:
            col_map[col] = "numero_cuenta"
    df = df.rename(columns=col_map)

    actualizados = 0
    errores = []

    for idx, row in df.iterrows():
        try:
            nombre = str(row.get("nombre", "")).strip()
            if not nombre or nombre == "nan":
                continue

            driver = db.query(Driver).filter(
                sqlfunc.lower(Driver.nombre) == nombre.lower()
            ).first()
            if not driver:
                errores.append(f"Fila {idx + 2}: driver '{nombre}' no encontrado")
                continue

            for field in ["rut", "banco", "tipo_cuenta", "numero_cuenta"]:
                val = str(row.get(field, "")).strip() if not pd.isna(row.get(field, "")) else None
                if val and val != "nan":
                    setattr(driver, field, val)

            actualizados += 1
        except Exception as e:
            errores.append(f"Fila {idx + 2}: {str(e)}")

    db.commit()
    return {"actualizados": actualizados, "errores": errores}


@router.get("/{driver_id}", response_model=DriverOut)
def obtener_driver(driver_id: int, db: Session = Depends(get_db), _=Depends(require_admin_or_administracion)):
    driver = db.query(Driver).get(driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver no encontrado")
    return _enrich_driver(driver, db)


@router.post("", response_model=DriverOut, status_code=201)
def crear_driver(data: DriverCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    existing = db.query(Driver).filter(Driver.nombre == data.nombre).first()
    if existing:
        raise HTTPException(status_code=400, detail="Ya existe un driver con ese nombre")
    driver = Driver(**data.model_dump(exclude={"password"}))
    if data.password:
        driver.password_hash = hash_password(data.password)
    db.add(driver)
    db.commit()
    db.refresh(driver)
    return _enrich_driver(driver, db)


@router.put("/{driver_id}", response_model=DriverOut)
def actualizar_driver(
    driver_id: int, data: DriverUpdate,
    db: Session = Depends(get_db), _=Depends(require_admin),
):
    driver = db.query(Driver).get(driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver no encontrado")
    update_data = data.model_dump(exclude_unset=True, exclude={"password"})
    for key, value in update_data.items():
        setattr(driver, key, value)
    if data.password:
        driver.password_hash = hash_password(data.password)
    db.commit()
    db.refresh(driver)
    return _enrich_driver(driver, db)


@router.delete("/{driver_id}")
def eliminar_driver(driver_id: int, db: Session = Depends(get_db), _=Depends(require_admin)):
    driver = db.query(Driver).get(driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver no encontrado")
    driver.activo = False
    db.commit()
    return {"message": "Driver desactivado"}


@router.get("/mi-flota/info")
def obtener_mi_flota(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Devuelve info de flota para el driver logueado."""
    if user["rol"] != RolEnum.DRIVER:
        raise HTTPException(status_code=403, detail="Solo para drivers")
    driver = db.get(Driver, user["id"])
    if not driver:
        raise HTTPException(status_code=404, detail="Driver no encontrado")
    subordinados = db.query(Driver).filter(
        Driver.jefe_flota_id == driver.id, Driver.activo == True
    ).order_by(Driver.nombre).all()
    return {
        "es_jefe_flota": len(subordinados) > 0,
        "subordinados": [{"id": s.id, "nombre": s.nombre} for s in subordinados],
    }
