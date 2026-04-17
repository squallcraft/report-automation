from typing import Optional, List
import io

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy import func as sqlfunc
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
import pandas as pd

from app.database import get_db
from app.auth import require_admin, require_admin_or_administracion, require_permission, require_driver, get_current_user, hash_password
from app.models import Driver, RolEnum, Retiro, PagoSemanaDriver, EstadoPagoEnum
from app.schemas import DriverCreate, DriverUpdate, DriverOut, AcuerdoAceptarRequest, ContratoTrabajoAceptarRequest
from app.services.audit import registrar as audit
from app.services.audit import diff_campos

router = APIRouter(prefix="/drivers", tags=["Drivers"])

CURRENT_CONTRATO_TRABAJO_VERSION = "1.0"


def _enrich_driver(d: Driver, db: Session) -> dict:
    data = {c.name: getattr(d, c.name) for c in d.__table__.columns}
    data.pop("acuerdo_firma", None)
    data.pop("carnet_frontal", None)
    data.pop("carnet_trasero", None)
    data["aliases"] = d.aliases or []
    if d.jefe_flota_id:
        jefe = db.get(Driver, d.jefe_flota_id)
        data["jefe_flota_nombre"] = jefe.nombre if jefe else None
    else:
        data["jefe_flota_nombre"] = None
    data["subordinados_count"] = db.query(Driver).filter(
        Driver.jefe_flota_id == d.id, Driver.activo == True
    ).count()
    if d.trabajador_id:
        from app.models import Trabajador
        trab = db.get(Trabajador, d.trabajador_id)
        data["trabajador_nombre"] = trab.nombre if trab else None
    else:
        data["trabajador_nombre"] = None
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
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("drivers:editar")),
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
    audit(
        db, "importar_homologacion_driver",
        usuario=current_user, request=request,
        entidad="driver",
        metadata={"archivo": file.filename, "aliases_agregados": aliases_added,
                   "drivers_creados": drivers_created},
    )
    return {
        "aliases_agregados": aliases_added,
        "drivers_creados": drivers_created,
        "errores": errores,
    }


@router.post("/importar/tarifas")
async def importar_tarifas(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("drivers:editar")),
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
    audit(
        db, "importar_tarifas_driver",
        usuario=current_user, request=request,
        entidad="driver",
        metadata={"archivo": file.filename, "creados": creados,
                   "actualizados": actualizados},
    )
    return {"creados": creados, "actualizados": actualizados, "errores": errores}


@router.get("/plantilla/bancaria/descargar")
def descargar_plantilla_bancaria(db: Session = Depends(get_db), _=Depends(require_admin_or_administracion)):
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
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("drivers:editar")),
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
    audit(
        db, "importar_bancaria_driver",
        usuario=current_user, request=request,
        entidad="driver",
        metadata={"archivo": file.filename, "actualizados": actualizados},
    )
    return {"actualizados": actualizados, "errores": errores}


@router.get("/{driver_id}", response_model=DriverOut)
def obtener_driver(driver_id: int, db: Session = Depends(get_db), _=Depends(require_admin_or_administracion)):
    driver = db.query(Driver).get(driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver no encontrado")
    return _enrich_driver(driver, db)


@router.post("", response_model=DriverOut, status_code=201)
def crear_driver(data: DriverCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(require_permission("drivers:editar"))):
    existing = db.query(Driver).filter(Driver.nombre == data.nombre).first()
    if existing:
        raise HTTPException(status_code=400, detail="Ya existe un driver con ese nombre")
    driver = Driver(**data.model_dump(exclude={"password"}))
    if data.password:
        driver.password_hash = hash_password(data.password)
    db.add(driver)
    db.commit()
    db.refresh(driver)
    audit(
        db, "crear_driver",
        usuario=current_user, request=request,
        entidad="driver", entidad_id=driver.id,
        metadata={"nombre": driver.nombre, "contratado": driver.contratado,
                   "tarifa_ecourier": driver.tarifa_ecourier,
                   "tarifa_oviedo": driver.tarifa_oviedo,
                   "tarifa_tercerizado": driver.tarifa_tercerizado},
    )
    return _enrich_driver(driver, db)


@router.put("/{driver_id}", response_model=DriverOut)
def actualizar_driver(
    driver_id: int, data: DriverUpdate, request: Request,
    db: Session = Depends(get_db), current_user=Depends(require_permission("drivers:editar")),
):
    driver = db.query(Driver).get(driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver no encontrado")
    campos_audit = [
        "nombre", "tarifa_ecourier", "tarifa_oviedo", "tarifa_tercerizado",
        "tarifa_retiro_fija", "aliases", "contratado", "jefe_flota_id",
        "rut", "banco", "tipo_cuenta", "numero_cuenta", "email", "trabajador_id",
    ]
    antes = {c: getattr(driver, c, None) for c in campos_audit}
    update_data = data.model_dump(exclude_unset=True, exclude={"password"})
    for nullable_unique in ("email", "rut"):
        if nullable_unique in update_data and update_data[nullable_unique] == "":
            update_data[nullable_unique] = None
    for key, value in update_data.items():
        setattr(driver, key, value)
    if "trabajador_id" in update_data:
        driver.contratado = update_data["trabajador_id"] is not None
    if data.password:
        driver.password_hash = hash_password(data.password)
    db.flush()
    despues = {c: getattr(driver, c, None) for c in campos_audit}
    cambios = diff_campos(antes, despues, campos_audit)

    # Si cambió tarifa_retiro_fija, actualizar Retiro.tarifa_driver en semanas NO cerradas
    nueva_tarifa_fija = despues.get("tarifa_retiro_fija")
    vieja_tarifa_fija = antes.get("tarifa_retiro_fija")
    if nueva_tarifa_fija != vieja_tarifa_fija and nueva_tarifa_fija is not None and nueva_tarifa_fija > 0:
        # Obtener semanas cerradas para este driver
        semanas_cerradas = db.query(
            PagoSemanaDriver.semana, PagoSemanaDriver.mes, PagoSemanaDriver.anio,
        ).filter(
            PagoSemanaDriver.driver_id == driver_id,
            PagoSemanaDriver.estado == EstadoPagoEnum.PAGADO.value,
        ).all()
        semanas_cerradas_set = {(r.semana, r.mes, r.anio) for r in semanas_cerradas}

        # Actualizar solo retiros de semanas abiertas
        retiros_abiertos = db.query(Retiro).filter(
            Retiro.driver_id == driver_id,
        ).all()
        for retiro in retiros_abiertos:
            if (retiro.semana, retiro.mes, retiro.anio) not in semanas_cerradas_set:
                retiro.tarifa_driver = nueva_tarifa_fija

    if cambios:
        audit(
            db, "editar_driver",
            usuario=current_user, request=request,
            entidad="driver", entidad_id=driver.id,
            cambios=cambios,
            metadata={"nombre": driver.nombre},
        )
    db.commit()
    db.refresh(driver)
    return _enrich_driver(driver, db)


@router.delete("/{driver_id}")
def eliminar_driver(driver_id: int, request: Request, db: Session = Depends(get_db), current_user=Depends(require_permission("drivers:editar"))):
    driver = db.query(Driver).get(driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver no encontrado")
    driver.activo = False
    db.commit()
    audit(
        db, "eliminar_driver",
        usuario=current_user, request=request,
        entidad="driver", entidad_id=driver.id,
        metadata={"nombre": driver.nombre},
    )
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


@router.post("/me/acuerdo")
def aceptar_acuerdo(
    body: AcuerdoAceptarRequest,
    request: Request,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Registra la aceptación digital del acuerdo de colaboración."""
    from datetime import datetime, timezone
    from app.auth import create_access_token
    from app.schemas import TokenResponse
    from app.api.auth import CURRENT_ACUERDO_VERSION

    if user["rol"] != RolEnum.DRIVER:
        raise HTTPException(status_code=403, detail="Solo para drivers")

    driver = db.get(Driver, user["id"])
    if not driver:
        raise HTTPException(status_code=404, detail="Driver no encontrado")
    if driver.contratado:
        raise HTTPException(status_code=400, detail="Los conductores contratados no requieren este acuerdo")

    ip = request.headers.get("X-Forwarded-For", "")
    if ip:
        ip = ip.split(",")[0].strip()
    else:
        ip = request.client.host if request.client else "unknown"

    driver.nombre_completo = body.nombre_completo
    driver.rut = body.rut
    driver.acuerdo_aceptado = True
    driver.acuerdo_version = CURRENT_ACUERDO_VERSION
    driver.acuerdo_fecha = datetime.now(timezone.utc)
    driver.acuerdo_ip = ip
    driver.acuerdo_firma = body.firma_base64
    driver.carnet_frontal = body.carnet_frontal
    driver.carnet_trasero = body.carnet_trasero

    audit(
        db, "aceptar_acuerdo",
        usuario=user, request=request,
        entidad="driver", entidad_id=driver.id,
        metadata={"version": CURRENT_ACUERDO_VERSION, "ip": ip, "rut": body.rut, "nombre_completo": body.nombre_completo},
    )
    db.commit()
    db.refresh(driver)

    token = create_access_token({"sub": str(driver.id), "rol": RolEnum.DRIVER})
    es_jefe = db.query(Driver).filter(Driver.jefe_flota_id == driver.id, Driver.activo == True).count() > 0
    return TokenResponse(
        access_token=token,
        rol=RolEnum.DRIVER,
        nombre=driver.nombre,
        entidad_id=driver.id,
        acuerdo_aceptado=True,
        contratado=driver.contratado,
        es_jefe=es_jefe,
    )


@router.get("/me/acuerdo-info")
def mi_acuerdo_info(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Devuelve los detalles del acuerdo aceptado por el driver logueado."""
    from app.api.auth import CURRENT_ACUERDO_VERSION

    if user["rol"] != RolEnum.DRIVER:
        raise HTTPException(status_code=403, detail="Solo para drivers")
    driver = db.get(Driver, user["id"])
    if not driver:
        raise HTTPException(status_code=404, detail="Driver no encontrado")
    return {
        "nombre": driver.nombre,
        "nombre_completo": driver.nombre_completo,
        "rut": driver.rut,
        "contratado": driver.contratado,
        "acuerdo_aceptado": bool(driver.contratado) or bool(driver.acuerdo_aceptado and driver.acuerdo_version == CURRENT_ACUERDO_VERSION),
        "acuerdo_version": driver.acuerdo_version,
        "acuerdo_fecha": driver.acuerdo_fecha.isoformat() if driver.acuerdo_fecha else None,
        "acuerdo_ip": driver.acuerdo_ip,
        "acuerdo_firma": driver.acuerdo_firma,
        "carnet_frontal": driver.carnet_frontal,
        "carnet_trasero": driver.carnet_trasero,
        "version_actual": CURRENT_ACUERDO_VERSION,
        "tarifas": _tarifas_driver(driver),
    }


@router.get("/me/acuerdo-tarifas")
def mi_acuerdo_tarifas(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Anexo de tarifas dinámico — siempre refleja la configuración actual."""
    if user["rol"] != RolEnum.DRIVER:
        raise HTTPException(status_code=403, detail="Solo para drivers")
    driver = db.get(Driver, user["id"])
    if not driver:
        raise HTTPException(status_code=404, detail="Driver no encontrado")
    return _tarifas_driver(driver)


def _tarifas_driver(driver: Driver) -> dict:
    tarifas = {}
    if driver.tarifa_ecourier:
        tarifas["Entrega estándar (Ecourier)"] = driver.tarifa_ecourier
    if driver.tarifa_oviedo:
        tarifas["Entrega Oviedo"] = driver.tarifa_oviedo
    if driver.tarifa_tercerizado:
        tarifas["Entrega tercerizado"] = driver.tarifa_tercerizado
    if driver.tarifa_valparaiso:
        tarifas["Entrega Valparaíso"] = driver.tarifa_valparaiso
    if driver.tarifa_melipilla:
        tarifas["Entrega Melipilla"] = driver.tarifa_melipilla
    if driver.tarifa_retiro_fija:
        tarifas["Retiro fijo"] = driver.tarifa_retiro_fija
    return tarifas


@router.get("/{driver_id}/acuerdo")
def acuerdo_del_driver(
    driver_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin_or_administracion),
):
    """(Admin) Devuelve los detalles del acuerdo firmado por un driver."""
    from app.api.auth import CURRENT_ACUERDO_VERSION

    driver = db.get(Driver, driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver no encontrado")
    return {
        "nombre": driver.nombre,
        "nombre_completo": driver.nombre_completo,
        "rut": driver.rut,
        "contratado": driver.contratado,
        "acuerdo_aceptado": bool(driver.contratado) or bool(driver.acuerdo_aceptado and driver.acuerdo_version == CURRENT_ACUERDO_VERSION),
        "acuerdo_version": driver.acuerdo_version,
        "acuerdo_fecha": driver.acuerdo_fecha.isoformat() if driver.acuerdo_fecha else None,
        "acuerdo_ip": driver.acuerdo_ip,
        "acuerdo_firma": driver.acuerdo_firma,
        "carnet_frontal": driver.carnet_frontal,
        "carnet_trasero": driver.carnet_trasero,
        "version_actual": CURRENT_ACUERDO_VERSION,
        "tarifas": _tarifas_driver(driver),
    }


@router.get("/me/contrato-trabajo-info")
def mi_contrato_trabajo_info(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Returns contract data for a contratado driver, pulling from linked Trabajador."""
    if user["rol"] != RolEnum.DRIVER:
        raise HTTPException(status_code=403, detail="Solo para drivers")
    driver = db.get(Driver, user["id"])
    if not driver:
        raise HTTPException(status_code=404, detail="Driver no encontrado")
    if not driver.contratado or not driver.trabajador_id:
        raise HTTPException(status_code=400, detail="Solo para conductores contratados vinculados")

    from app.models import Trabajador
    trabajador = db.get(Trabajador, driver.trabajador_id)
    if not trabajador:
        raise HTTPException(status_code=404, detail="Trabajador vinculado no encontrado")

    return {
        "driver_nombre": driver.nombre,
        "contrato_trabajo_aceptado": driver.contrato_trabajo_aceptado,
        "contrato_trabajo_version": driver.contrato_trabajo_version,
        "contrato_trabajo_fecha": driver.contrato_trabajo_fecha.isoformat() if driver.contrato_trabajo_fecha else None,
        "version_actual": CURRENT_CONTRATO_TRABAJO_VERSION,
        "trabajador": {
            "nombre": trabajador.nombre,
            "rut": trabajador.rut,
            "cargo": trabajador.cargo,
            "sueldo_bruto": trabajador.sueldo_bruto,
            "movilizacion": trabajador.movilizacion,
            "colacion": trabajador.colacion,
            "viaticos": trabajador.viaticos,
            "afp": trabajador.afp,
            "sistema_salud": trabajador.sistema_salud,
            "monto_cotizacion_salud": trabajador.monto_cotizacion_salud,
            "fecha_ingreso": trabajador.fecha_ingreso.isoformat() if trabajador.fecha_ingreso else None,
            "tipo_contrato": trabajador.tipo_contrato,
            "banco": trabajador.banco,
            "tipo_cuenta": trabajador.tipo_cuenta,
            "numero_cuenta": trabajador.numero_cuenta,
        },
    }


@router.post("/me/contrato-trabajo")
def aceptar_contrato_trabajo(
    body: ContratoTrabajoAceptarRequest,
    request: Request,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Registers digital acceptance of employment contract for contratado drivers."""
    from datetime import datetime, timezone
    from app.auth import create_access_token
    from app.schemas import TokenResponse

    if user["rol"] != RolEnum.DRIVER:
        raise HTTPException(status_code=403, detail="Solo para drivers")

    driver = db.get(Driver, user["id"])
    if not driver:
        raise HTTPException(status_code=404, detail="Driver no encontrado")
    if not driver.contratado or not driver.trabajador_id:
        raise HTTPException(status_code=400, detail="Solo para conductores contratados vinculados")

    ip = request.headers.get("X-Forwarded-For", "")
    if ip:
        ip = ip.split(",")[0].strip()
    else:
        ip = request.client.host if request.client else "unknown"

    driver.nombre_completo = body.nombre_completo
    driver.rut = body.rut
    driver.contrato_trabajo_aceptado = True
    driver.contrato_trabajo_version = CURRENT_CONTRATO_TRABAJO_VERSION
    driver.contrato_trabajo_fecha = datetime.now(timezone.utc)
    driver.contrato_trabajo_ip = ip
    driver.contrato_trabajo_firma = body.firma_base64
    driver.carnet_frontal = body.carnet_frontal
    driver.carnet_trasero = body.carnet_trasero

    audit(
        db, "aceptar_contrato_trabajo",
        usuario=user, request=request,
        entidad="driver", entidad_id=driver.id,
        metadata={"version": CURRENT_CONTRATO_TRABAJO_VERSION, "ip": ip, "rut": body.rut},
    )
    db.commit()
    db.refresh(driver)

    token = create_access_token({"sub": str(driver.id), "rol": RolEnum.DRIVER})
    es_jefe = db.query(Driver).filter(Driver.jefe_flota_id == driver.id, Driver.activo == True).count() > 0
    return TokenResponse(
        access_token=token,
        rol=RolEnum.DRIVER,
        nombre=driver.nombre,
        entidad_id=driver.id,
        acuerdo_aceptado=True,
        contratado=driver.contratado,
        contrato_trabajo_aceptado=True,
        es_jefe=es_jefe,
    )
