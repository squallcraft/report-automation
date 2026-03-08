"""
CRUD y gestión de Pickup Points + importación de recepciones de paquetes.
"""
from typing import Optional, List
from datetime import datetime

import io
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
import pandas as pd

from app.database import get_db
from app.auth import (
    require_admin, require_admin_or_administracion, require_pickup,
    hash_password, get_current_user,
)
from app.config import get_settings
from app.models import (
    Pickup, RecepcionPaquete, Envio, Seller, Driver, RolEnum,
    PagoCartola, PagoCartolaSeller, Retiro, CalendarioSemanas,
)
from app.schemas import PickupCreate, PickupUpdate, PickupOut, RecepcionPaqueteOut
from app.services.audit import registrar as audit
from app.services.ingesta import calcular_semana_del_mes, homologar_nombre
from app.services.trackingtech import fetch_pickups_by_date

router = APIRouter(prefix="/pickups", tags=["Pickups"])

COMISION_PAQUETE = 200


def _enrich_pickup(p: Pickup) -> dict:
    data = {col.name: getattr(p, col.name) for col in p.__table__.columns}
    data["seller_nombre"] = p.seller.nombre if p.seller else None
    data["driver_nombre"] = p.driver.nombre if p.driver else None
    return data


# ── Admin CRUD ──

@router.get("", response_model=List[PickupOut])
def listar_pickups(
    activo: Optional[bool] = None,
    q: Optional[str] = None,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    query = db.query(Pickup)
    if activo is not None:
        query = query.filter(Pickup.activo == activo)
    if q:
        query = query.filter(Pickup.nombre.ilike(f"%{q}%"))
    pickups = query.order_by(Pickup.nombre).all()
    return [_enrich_pickup(p) for p in pickups]


@router.get("/resumen")
def resumen_recepciones(
    mes: Optional[int] = None,
    anio: Optional[int] = None,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Resumen de recepciones agrupado por pickup para un período."""
    query = db.query(RecepcionPaquete)
    if mes is not None:
        query = query.filter(RecepcionPaquete.mes == mes)
    if anio is not None:
        query = query.filter(RecepcionPaquete.anio == anio)
    recepciones = query.all()

    pickups_map = {}
    for r in recepciones:
        pid = r.pickup_id
        if pid not in pickups_map:
            pickup = db.get(Pickup, pid)
            pickups_map[pid] = {
                "pickup_id": pid,
                "pickup_nombre": pickup.nombre if pickup else "—",
                "_seller_id": pickup.seller_id if pickup else None,
                "total_paquetes": 0,
                "total_comision": 0,
                "vinculados": 0,
            }
        pickups_map[pid]["total_paquetes"] += 1
        comision = r.comision
        own_seller = pickups_map[pid]["_seller_id"]
        if own_seller and r.envio_id:
            envio = db.get(Envio, r.envio_id)
            if envio and envio.seller_id == own_seller:
                comision = 0
        pickups_map[pid]["total_comision"] += comision
        if r.envio_id:
            pickups_map[pid]["vinculados"] += 1

    return list(pickups_map.values())


@router.get("/liquidacion")
def liquidacion_pickups(
    semana: Optional[int] = None,
    mes: Optional[int] = None,
    anio: Optional[int] = None,
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """Liquidación de todos los pickups para un período (vista admin)."""
    from app.services.liquidacion import _calcular_retiro_seller
    pickups_all = db.query(Pickup).filter(Pickup.activo == True).all()
    resultados = []

    for pickup in pickups_all:
        recepciones = db.query(RecepcionPaquete).filter(
            RecepcionPaquete.pickup_id == pickup.id,
        )
        if semana is not None:
            recepciones = recepciones.filter(RecepcionPaquete.semana == semana)
        if mes is not None:
            recepciones = recepciones.filter(RecepcionPaquete.mes == mes)
        if anio is not None:
            recepciones = recepciones.filter(RecepcionPaquete.anio == anio)
        recepciones = recepciones.all()

        if not recepciones:
            continue

        total_comision = 0
        auto_entregas = 0
        for r in recepciones:
            if r.envio_id:
                envio = db.get(Envio, r.envio_id)
                if envio:
                    if pickup.driver_id and envio.driver_id == pickup.driver_id:
                        auto_entregas += 1
                        continue
                    if pickup.seller_id and envio.seller_id == pickup.seller_id:
                        continue
            total_comision += r.comision
        iva_comision = int(total_comision * 0.19)

        cargo_envios = 0
        if pickup.seller_id:
            seller = db.get(Seller, pickup.seller_id)
            if seller:
                envios_seller = db.query(Envio).filter(Envio.seller_id == seller.id)
                if semana is not None:
                    envios_seller = envios_seller.filter(Envio.semana == semana)
                if mes is not None:
                    envios_seller = envios_seller.filter(Envio.mes == mes)
                if anio is not None:
                    envios_seller = envios_seller.filter(Envio.anio == anio)
                envios_list = envios_seller.all()
                cargo_envios = sum(
                    e.cobro_seller + e.cobro_extra_manual + e.extra_producto_seller + e.extra_comuna_seller
                    for e in envios_list
                )
                cargo_envios += _calcular_retiro_seller(seller, envios_list)

        balance_neto = total_comision - cargo_envios

        resultados.append({
            "pickup_id": pickup.id,
            "pickup_nombre": pickup.nombre,
            "total_paquetes": len(recepciones),
            "total_comision": total_comision,
            "iva_comision": iva_comision,
            "total_con_iva": total_comision + iva_comision,
            "cargo_envios": cargo_envios,
            "balance_neto": balance_neto,
            "seller_nombre": pickup.seller.nombre if pickup.seller else None,
        })

    return sorted(resultados, key=lambda x: x["pickup_nombre"])


@router.get("/{pickup_id}", response_model=PickupOut)
def obtener_pickup(pickup_id: int, db: Session = Depends(get_db), _=Depends(require_admin_or_administracion)):
    pickup = db.get(Pickup, pickup_id)
    if not pickup:
        raise HTTPException(status_code=404, detail="Pickup no encontrado")
    return _enrich_pickup(pickup)


@router.post("", response_model=PickupOut, status_code=201)
def crear_pickup(data: PickupCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    existing = db.query(Pickup).filter(Pickup.nombre == data.nombre).first()
    if existing:
        raise HTTPException(status_code=400, detail="Ya existe un pickup con ese nombre")
    dump = data.model_dump(exclude={"password"})
    if dump.get("email") == "":
        dump["email"] = None
    pickup = Pickup(**dump)
    if data.password:
        pickup.password_hash = hash_password(data.password)
    db.add(pickup)
    db.commit()
    db.refresh(pickup)
    audit(db, "crear_pickup", usuario=current_user, request=request, entidad="pickup", entidad_id=pickup.id, metadata={"nombre": data.nombre, "seller_id": data.seller_id, "driver_id": data.driver_id})
    return _enrich_pickup(pickup)


@router.put("/{pickup_id}", response_model=PickupOut)
def actualizar_pickup(
    pickup_id: int, data: PickupUpdate, request: Request,
    db: Session = Depends(get_db), current_user=Depends(require_admin),
):
    pickup = db.get(Pickup, pickup_id)
    if not pickup:
        raise HTTPException(status_code=404, detail="Pickup no encontrado")
    update_data = data.model_dump(exclude_unset=True, exclude={"password"})
    if update_data.get("email") == "":
        update_data["email"] = None
    old_values = {k: getattr(pickup, k) for k in update_data}
    for key, value in update_data.items():
        setattr(pickup, key, value)
    if data.password:
        pickup.password_hash = hash_password(data.password)
    db.commit()
    db.refresh(pickup)
    cambios_dict = {k: {"antes": old_values[k], "despues": v} for k, v in update_data.items() if old_values[k] != v}
    if data.password:
        cambios_dict["password"] = {"antes": "***", "despues": "***"}
    if cambios_dict:
        audit(db, "editar_pickup", usuario=current_user, request=request, entidad="pickup", entidad_id=pickup_id, cambios=cambios_dict)
    return _enrich_pickup(pickup)


@router.delete("/{pickup_id}")
def eliminar_pickup(pickup_id: int, request: Request, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    pickup = db.get(Pickup, pickup_id)
    if not pickup:
        raise HTTPException(status_code=404, detail="Pickup no encontrado")
    pickup.activo = False
    db.commit()
    audit(db, "eliminar_pickup", usuario=current_user, request=request, entidad="pickup", entidad_id=pickup_id, metadata={"nombre": pickup.nombre})
    return {"message": "Pickup desactivado"}


# ── Recepciones ──

@router.get("/{pickup_id}/recepciones", response_model=List[RecepcionPaqueteOut])
def listar_recepciones(
    pickup_id: int,
    semana: Optional[int] = None,
    mes: Optional[int] = None,
    anio: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    if current_user["rol"] == RolEnum.PICKUP and current_user["id"] != pickup_id:
        raise HTTPException(status_code=403, detail="No tienes permiso")

    query = db.query(RecepcionPaquete).filter(RecepcionPaquete.pickup_id == pickup_id)
    if semana is not None:
        query = query.filter(RecepcionPaquete.semana == semana)
    if mes is not None:
        query = query.filter(RecepcionPaquete.mes == mes)
    if anio is not None:
        query = query.filter(RecepcionPaquete.anio == anio)
    recs = query.order_by(RecepcionPaquete.fecha_recepcion.desc()).all()

    pickup = db.get(Pickup, pickup_id)
    pickup_nombre = pickup.nombre if pickup else "—"
    result = []
    for r in recs:
        d = {col.name: getattr(r, col.name) for col in r.__table__.columns}
        d["pickup_nombre"] = pickup_nombre
        result.append(d)
    return result


@router.post("/recepciones/importar")
async def importar_recepciones(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    """Importa recepciones de paquetes desde Excel. Vincula pedido a envíos existentes."""
    if not file.filename or not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Solo se aceptan archivos Excel")

    content = await file.read()
    df = pd.read_excel(io.BytesIO(content))

    col_map = {}
    for col in df.columns:
        cl = col.lower().strip()
        if "fecha" in cl:
            col_map[col] = "fecha_recepcion"
        elif "pickup" in cl or "punto" in cl:
            col_map[col] = "pickup"
        elif "pedido" in cl or "orden" in cl or "tracking" in cl:
            col_map[col] = "pedido"
        elif "tipo" in cl:
            col_map[col] = "tipo"
        elif "procesado" in cl:
            col_map[col] = "procesado"
        elif "error" in cl:
            col_map[col] = "error_msg"
    df = df.rename(columns=col_map)

    pickups = db.query(Pickup).filter(Pickup.activo == True).all()
    pickup_cache = {}
    pickup_obj_cache = {p.id: p for p in pickups}
    ingesta_id = str(uuid.uuid4())[:8]

    creados = 0
    vinculados = 0
    sin_homologar = []
    errores = []

    for idx, row in df.iterrows():
        try:
            fecha_raw = row.get("fecha_recepcion")
            if pd.isna(fecha_raw):
                errores.append(f"Fila {idx + 2}: sin fecha")
                continue

            if isinstance(fecha_raw, str):
                fecha = pd.to_datetime(fecha_raw).date()
            else:
                fecha = pd.Timestamp(fecha_raw).date()

            pickup_raw = str(row.get("pickup", "")).strip() if not pd.isna(row.get("pickup")) else None
            pedido_raw = str(row.get("pedido", "")).strip() if not pd.isna(row.get("pedido")) else None

            if not pickup_raw or not pedido_raw:
                errores.append(f"Fila {idx + 2}: faltan pickup o pedido")
                continue

            pickup_id = homologar_nombre(pickup_raw, pickups, pickup_cache)
            if not pickup_id:
                sin_homologar.append(pickup_raw)
                continue

            tipo = str(row.get("tipo", "")).strip() if not pd.isna(row.get("tipo")) else None
            procesado_raw = row.get("procesado")
            procesado = True
            if not pd.isna(procesado_raw):
                p_str = str(procesado_raw).strip().upper()
                procesado = p_str in ("S", "SI", "SÍ", "TRUE", "1", "Y", "YES")
            error_msg = str(row.get("error_msg", "")).strip() if not pd.isna(row.get("error_msg")) else None

            envio_id = None
            envio = db.query(Envio).filter(
                (Envio.tracking_id == pedido_raw) | (Envio.venta_id == pedido_raw)
            ).first()
            if envio:
                envio_id = envio.id
                vinculados += 1

            semana = calcular_semana_del_mes(fecha)

            pickup_obj = pickup_obj_cache.get(pickup_id)
            comision = pickup_obj.comision_paquete if pickup_obj else COMISION_PAQUETE
            if pickup_obj and pickup_obj.seller_id and envio and envio.seller_id == pickup_obj.seller_id:
                comision = 0

            rec = RecepcionPaquete(
                pickup_id=pickup_id,
                envio_id=envio_id,
                fecha_recepcion=fecha,
                semana=semana,
                mes=fecha.month,
                anio=fecha.year,
                pedido=pedido_raw,
                tipo=tipo,
                comision=comision,
                procesado=procesado,
                error_msg=error_msg,
                ingesta_id=ingesta_id,
            )
            db.add(rec)
            creados += 1

        except Exception as e:
            errores.append(f"Fila {idx + 2}: {str(e)}")

    db.commit()
    resultado = {
        "creados": creados,
        "vinculados": vinculados,
        "sin_homologar": list(set(sin_homologar)),
        "errores": errores,
    }
    audit(db, "importar_recepciones", usuario=current_user, request=request, entidad="recepcion_paquete", metadata={
        "archivo": file.filename,
        "creados": creados,
        "vinculados": vinculados,
        "errores_count": len(errores),
        "sin_homologar": resultado["sin_homologar"],
        "ingesta_id": ingesta_id,
    })
    return resultado


@router.post("/recepciones/importar-trackingtech")
def importar_desde_trackingtech(
    request: Request,
    fecha_inicio: str = Query(..., description="Fecha inicio YYYYMMDD"),
    fecha_fin: str = Query(..., description="Fecha fin YYYYMMDD"),
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    """
    Importa recepciones de paquetes desde la API TrackingTech.
    Consulta todos los escaneos en el rango de fechas y los crea como RecepcionPaquete.
    """
    if len(fecha_inicio) != 8 or len(fecha_fin) != 8:
        raise HTTPException(status_code=400, detail="Formato de fecha inválido. Use YYYYMMDD")

    settings = get_settings()
    records, api_error = fetch_pickups_by_date(
        api_url=settings.TRACKINGTECH_API_URL,
        email=settings.TRACKINGTECH_EMAIL,
        password=settings.TRACKINGTECH_PASSWORD,
        fecha_inicio=fecha_inicio,
        fecha_fin=fecha_fin,
    )

    if api_error and not records:
        raise HTTPException(status_code=502, detail=f"Error API TrackingTech: {api_error}")

    pickups = db.query(Pickup).filter(Pickup.activo == True).all()
    pickup_cache: dict = {}
    pickup_obj_cache = {p.id: p for p in pickups}
    ingesta_id = f"tt-{uuid.uuid4().hex[:8]}"

    creados = 0
    duplicados = 0
    vinculados = 0
    descartados = 0
    sin_homologar: list[str] = []
    errores: list[str] = []

    for idx, rec in enumerate(records):
        try:
            pending = rec.get("pending", False)
            error_msg_api = rec.get("error_msg") or None

            if pending or error_msg_api:
                descartados += 1
                continue

            created_at_raw = rec.get("created_at")
            if not created_at_raw:
                errores.append(f"Registro {idx + 1}: sin fecha")
                continue

            fecha = datetime.strptime(created_at_raw, "%Y-%m-%d %H:%M:%S").date()

            pickup_raw = (rec.get("Pickup") or "").strip()
            seller_code = (rec.get("seller_code") or "").strip()
            id_interno = (rec.get("id_interno") or "").strip()
            tipo = (rec.get("tipo") or "").strip() or None

            pedido = id_interno or seller_code
            if not pedido:
                errores.append(f"Registro {idx + 1}: sin seller_code ni id_interno")
                continue

            if not pickup_raw:
                errores.append(f"Registro {idx + 1}: sin nombre de pickup")
                continue

            pickup_id = homologar_nombre(pickup_raw, pickups, pickup_cache)
            if not pickup_id:
                sin_homologar.append(pickup_raw)
                continue

            existing = db.query(RecepcionPaquete).filter(
                RecepcionPaquete.pickup_id == pickup_id,
                RecepcionPaquete.pedido == pedido,
                RecepcionPaquete.fecha_recepcion == fecha,
            ).first()
            if existing:
                duplicados += 1
                continue

            envio_id = None
            envio = db.query(Envio).filter(
                (Envio.tracking_id == pedido) | (Envio.venta_id == pedido)
            ).first()
            if envio:
                envio_id = envio.id
                vinculados += 1

            semana = calcular_semana_del_mes(fecha)

            pickup_obj = pickup_obj_cache.get(pickup_id)
            comision = pickup_obj.comision_paquete if pickup_obj else COMISION_PAQUETE
            if pickup_obj and pickup_obj.seller_id and envio and envio.seller_id == pickup_obj.seller_id:
                comision = 0

            new_rec = RecepcionPaquete(
                pickup_id=pickup_id,
                envio_id=envio_id,
                fecha_recepcion=fecha,
                semana=semana,
                mes=fecha.month,
                anio=fecha.year,
                pedido=pedido,
                tipo=tipo,
                comision=comision,
                procesado=True,
                error_msg=None,
                ingesta_id=ingesta_id,
            )
            db.add(new_rec)
            creados += 1

        except Exception as e:
            errores.append(f"Registro {idx + 1}: {str(e)}")

    db.commit()

    resultado = {
        "creados": creados,
        "duplicados": duplicados,
        "descartados": descartados,
        "vinculados": vinculados,
        "total_api": len(records),
        "sin_homologar": list(set(sin_homologar)),
        "errores": errores,
        "advertencia_api": api_error,
        "ingesta_id": ingesta_id,
    }

    audit(db, "importar_recepciones_trackingtech", usuario=current_user, request=request, entidad="recepcion_paquete", metadata={
        "fecha_inicio": fecha_inicio,
        "fecha_fin": fecha_fin,
        "total_api": len(records),
        "creados": creados,
        "duplicados": duplicados,
        "descartados": descartados,
        "vinculados": vinculados,
        "errores_count": len(errores),
        "sin_homologar": resultado["sin_homologar"],
        "ingesta_id": ingesta_id,
    })

    return resultado


# ── Portal Pickup ──

def _calcular_periodo_pickup(db: Session, pickup, mes: int, anio: int) -> dict:
    """Calcula todas las métricas de un pickup para un mes/año dado."""
    from app.services.liquidacion import _calcular_retiro_seller, _calcular_retiro_driver

    pickup_id = pickup.id

    recepciones = db.query(RecepcionPaquete).filter(
        RecepcionPaquete.pickup_id == pickup_id,
        RecepcionPaquete.mes == mes,
        RecepcionPaquete.anio == anio,
    ).all()

    total_paquetes = len(recepciones)
    total_comision_neto = 0
    auto_entregas = 0
    for r in recepciones:
        if r.envio_id:
            envio = db.get(Envio, r.envio_id)
            if envio:
                if pickup.driver_id and envio.driver_id == pickup.driver_id:
                    auto_entregas += 1
                    continue
                if pickup.seller_id and envio.seller_id == pickup.seller_id:
                    continue
        total_comision_neto += r.comision
    total_comision_iva = int(total_comision_neto * 0.19)

    cargo_envios = 0
    cargo_envios_base = 0
    cargo_extras_producto = 0
    cargo_extras_comuna = 0
    cargo_extras_manual = 0
    cargo_retiros_seller = 0
    cantidad_envios_seller = 0
    if pickup.seller_id:
        seller = db.get(Seller, pickup.seller_id)
        if seller:
            envios_seller = db.query(Envio).filter(
                Envio.seller_id == seller.id,
                Envio.mes == mes,
                Envio.anio == anio,
            ).all()
            cantidad_envios_seller = len(envios_seller)
            cargo_envios_base = sum(e.cobro_seller for e in envios_seller)
            cargo_extras_producto = sum(e.extra_producto_seller for e in envios_seller)
            cargo_extras_comuna = sum(e.extra_comuna_seller for e in envios_seller)
            cargo_extras_manual = sum(e.cobro_extra_manual for e in envios_seller)
            cargo_retiros_seller = _calcular_retiro_seller(seller, envios_seller)
            cargo_envios = cargo_envios_base + cargo_extras_producto + cargo_extras_comuna + cargo_extras_manual + cargo_retiros_seller

    ganancias_driver = 0
    cantidad_entregas = 0
    if pickup.driver_id:
        envios_driver = db.query(Envio).filter(
            Envio.driver_id == pickup.driver_id,
            Envio.mes == mes,
            Envio.anio == anio,
        ).all()
        cantidad_entregas = len(envios_driver)
        driver = db.get(Driver, pickup.driver_id)
        ganancias_driver = sum(e.costo_driver + e.pago_extra_manual for e in envios_driver)
        if driver and not driver.contratado:
            ganancias_driver += sum(e.extra_producto_driver + e.extra_comuna_driver for e in envios_driver)
        retiros_driver = db.query(Retiro).filter(
            Retiro.driver_id == pickup.driver_id,
            Retiro.mes == mes,
            Retiro.anio == anio,
        ).all()
        if driver:
            ganancias_driver += _calcular_retiro_driver(driver, retiros_driver)

    balance_neto = total_comision_neto + ganancias_driver - cargo_envios

    semanas_rows = db.query(CalendarioSemanas.semana).filter(
        CalendarioSemanas.mes == mes, CalendarioSemanas.anio == anio,
    ).order_by(CalendarioSemanas.semana).all()
    semanas_lista = [r[0] for r in semanas_rows] if semanas_rows else [1, 2, 3, 4, 5]

    by_semana = {}
    for sem in semanas_lista:
        recs_sem = [r for r in recepciones if r.semana == sem]
        comision_sem = 0
        paquetes_sem = len(recs_sem)
        for r in recs_sem:
            skip = False
            if r.envio_id:
                envio = db.get(Envio, r.envio_id)
                if envio:
                    if pickup.driver_id and envio.driver_id == pickup.driver_id:
                        skip = True
                    elif pickup.seller_id and envio.seller_id == pickup.seller_id:
                        skip = True
            if not skip:
                comision_sem += r.comision
        if paquetes_sem > 0 or comision_sem > 0:
            by_semana[sem] = {"semana": sem, "paquetes": paquetes_sem, "comision": comision_sem}

    pagos_recibidos = []
    if pickup.driver_id:
        pcs = db.query(PagoCartola).filter(
            PagoCartola.driver_id == pickup.driver_id,
            PagoCartola.mes == mes,
            PagoCartola.anio == anio,
        ).order_by(PagoCartola.created_at.desc()).all()
        for p in pcs:
            pagos_recibidos.append({
                "id": p.id, "fecha": p.fecha_pago, "monto": p.monto,
                "descripcion": p.descripcion, "fuente": p.fuente, "tipo": "recibido",
            })

    pagos_emitidos = []
    if pickup.seller_id:
        pss = db.query(PagoCartolaSeller).filter(
            PagoCartolaSeller.seller_id == pickup.seller_id,
            PagoCartolaSeller.mes == mes,
            PagoCartolaSeller.anio == anio,
        ).order_by(PagoCartolaSeller.created_at.desc()).all()
        for p in pss:
            pagos_emitidos.append({
                "id": p.id, "fecha": p.fecha_pago, "monto": p.monto,
                "descripcion": p.descripcion, "fuente": p.fuente, "tipo": "emitido",
            })

    return {
        "total_paquetes": total_paquetes,
        "total_comision_neto": total_comision_neto,
        "total_comision_iva": total_comision_iva,
        "total_comision": total_comision_neto + total_comision_iva,
        "auto_entregas": auto_entregas,
        "cargo_envios": cargo_envios,
        "cargo_envios_base": cargo_envios_base,
        "cargo_extras_producto": cargo_extras_producto,
        "cargo_extras_comuna": cargo_extras_comuna,
        "cargo_extras_manual": cargo_extras_manual,
        "cargo_retiros_seller": cargo_retiros_seller,
        "cantidad_envios_seller": cantidad_envios_seller,
        "ganancias_driver": ganancias_driver,
        "cantidad_entregas": cantidad_entregas,
        "balance_neto": balance_neto,
        "semanas": sorted(by_semana.values(), key=lambda x: x["semana"]),
        "pagos_recibidos": pagos_recibidos,
        "pagos_emitidos": pagos_emitidos,
    }


@router.get("/portal/dashboard")
def pickup_dashboard(
    mes: Optional[int] = None,
    anio: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_pickup),
):
    """Dashboard completo del pickup con comparación al período anterior."""
    pickup_id = current_user["id"]
    pickup = db.get(Pickup, pickup_id)
    if not pickup:
        raise HTTPException(status_code=404, detail="Pickup no encontrado")

    from datetime import date
    hoy = date.today()
    if mes is None:
        mes = hoy.month
    if anio is None:
        anio = hoy.year

    actual = _calcular_periodo_pickup(db, pickup, mes, anio)

    prev_mes = mes - 1 if mes > 1 else 12
    prev_anio = anio if mes > 1 else anio - 1
    anterior = _calcular_periodo_pickup(db, pickup, prev_mes, prev_anio)

    def pct(actual_v, anterior_v):
        if anterior_v == 0:
            return None
        return round((actual_v - anterior_v) / abs(anterior_v) * 100, 1)

    result = {
        "pickup_nombre": pickup.nombre,
        "mes": mes,
        "anio": anio,
        "seller_id": pickup.seller_id,
        "driver_id": pickup.driver_id,
        **actual,
        "comparacion": {
            "paquetes": pct(actual["total_paquetes"], anterior["total_paquetes"]),
            "comision": pct(actual["total_comision_neto"], anterior["total_comision_neto"]),
            "entregas": pct(actual["cantidad_entregas"], anterior["cantidad_entregas"]),
            "balance": pct(actual["balance_neto"], anterior["balance_neto"]) if anterior["balance_neto"] != 0 else None,
        },
    }
    return result


@router.get("/portal/ganancias")
def pickup_ganancias(
    mes: Optional[int] = None,
    anio: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_pickup),
):
    """Mis Ganancias para pickup: desglose semanal + pagos recibidos."""
    from app.services.liquidacion import _calcular_retiro_seller, _calcular_retiro_driver
    from datetime import date

    pickup_id = current_user["id"]
    pickup = db.get(Pickup, pickup_id)
    if not pickup:
        raise HTTPException(status_code=404, detail="Pickup no encontrado")

    hoy = date.today()
    if mes is None:
        mes = hoy.month
    if anio is None:
        anio = hoy.year

    semanas_rows = db.query(CalendarioSemanas).filter(
        CalendarioSemanas.mes == mes, CalendarioSemanas.anio == anio,
    ).order_by(CalendarioSemanas.semana).all()
    semanas_lista = [r.semana for r in semanas_rows] if semanas_rows else [1, 2, 3, 4]

    semanas = []
    total_liquidado = 0
    total_pagado = 0

    for sem in semanas_lista:
        recs = db.query(RecepcionPaquete).filter(
            RecepcionPaquete.pickup_id == pickup_id,
            RecepcionPaquete.semana == sem, RecepcionPaquete.mes == mes, RecepcionPaquete.anio == anio,
        ).all()
        comision_sem = 0
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
                comision_sem += r.comision

        ganancia_driver_sem = 0
        entregas_sem = 0
        if pickup.driver_id:
            envios_d = db.query(Envio).filter(
                Envio.driver_id == pickup.driver_id,
                Envio.semana == sem, Envio.mes == mes, Envio.anio == anio,
            ).all()
            entregas_sem = len(envios_d)
            driver = db.get(Driver, pickup.driver_id)
            ganancia_driver_sem = sum(e.costo_driver + e.pago_extra_manual for e in envios_d)
            if driver and not driver.contratado:
                ganancia_driver_sem += sum(e.extra_producto_driver + e.extra_comuna_driver for e in envios_d)
            retiros_d = db.query(Retiro).filter(
                Retiro.driver_id == pickup.driver_id,
                Retiro.semana == sem, Retiro.mes == mes, Retiro.anio == anio,
            ).all()
            if driver:
                ganancia_driver_sem += _calcular_retiro_driver(driver, retiros_d)

        cargo_seller_sem = 0
        envios_seller_sem = 0
        if pickup.seller_id:
            seller = db.get(Seller, pickup.seller_id)
            if seller:
                envios_s = db.query(Envio).filter(
                    Envio.seller_id == seller.id,
                    Envio.semana == sem, Envio.mes == mes, Envio.anio == anio,
                ).all()
                envios_seller_sem = len(envios_s)
                cargo_seller_sem = sum(
                    e.cobro_seller + e.cobro_extra_manual + e.extra_producto_seller + e.extra_comuna_seller
                    for e in envios_s
                )
                cargo_seller_sem += _calcular_retiro_seller(seller, envios_s)

        liquidado_sem = comision_sem + ganancia_driver_sem - cargo_seller_sem

        pagado_sem = 0
        if pickup.driver_id:
            pcs = db.query(PagoCartola).filter(
                PagoCartola.driver_id == pickup.driver_id,
                PagoCartola.semana == sem, PagoCartola.mes == mes, PagoCartola.anio == anio,
            ).all()
            pagado_sem += sum(p.monto for p in pcs)

        estado = "PENDIENTE"
        if pagado_sem > 0 and pagado_sem >= liquidado_sem:
            estado = "PAGADO"
        elif pagado_sem > 0:
            estado = "INCOMPLETO"

        total_liquidado += liquidado_sem
        total_pagado += pagado_sem

        if liquidado_sem > 0 or pagado_sem > 0 or len(recs) > 0:
            semanas.append({
                "semana": sem,
                "paquetes": len(recs),
                "comision": comision_sem,
                "ganancias_driver": ganancia_driver_sem,
                "entregas": entregas_sem,
                "cargo_seller": cargo_seller_sem,
                "envios_seller": envios_seller_sem,
                "liquidado": liquidado_sem,
                "pagado": pagado_sem,
                "estado": estado,
            })

    pagos = []
    if pickup.driver_id:
        pcs = db.query(PagoCartola).filter(
            PagoCartola.driver_id == pickup.driver_id,
            PagoCartola.mes == mes, PagoCartola.anio == anio,
        ).order_by(PagoCartola.created_at.desc()).all()
        for p in pcs:
            pagos.append({
                "id": p.id, "semana": p.semana, "fecha_pago": p.fecha_pago,
                "monto": p.monto, "descripcion": p.descripcion, "fuente": p.fuente,
            })

    return {
        "mes": mes,
        "anio": anio,
        "resumen": {
            "total_liquidado": total_liquidado,
            "total_pagado": total_pagado,
            "pendiente": max(0, total_liquidado - total_pagado),
        },
        "semanas": semanas,
        "pagos": pagos,
    }


@router.get("/portal/recepciones")
def pickup_recepciones(
    semana: Optional[int] = None,
    mes: Optional[int] = None,
    anio: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_pickup),
):
    """Recepciones del pickup autenticado."""
    pickup_id = current_user["id"]
    query = db.query(RecepcionPaquete).filter(RecepcionPaquete.pickup_id == pickup_id)
    if semana is not None:
        query = query.filter(RecepcionPaquete.semana == semana)
    if mes is not None:
        query = query.filter(RecepcionPaquete.mes == mes)
    if anio is not None:
        query = query.filter(RecepcionPaquete.anio == anio)

    recs = query.order_by(RecepcionPaquete.fecha_recepcion.desc()).all()
    pickup = db.get(Pickup, pickup_id)
    pickup_nombre = pickup.nombre if pickup else "—"
    result = []
    for r in recs:
        d = {col.name: getattr(r, col.name) for col in r.__table__.columns}
        d["pickup_nombre"] = pickup_nombre
        result.append(d)
    return result


@router.get("/portal/entregas")
def pickup_entregas(
    semana: Optional[int] = None,
    mes: Optional[int] = None,
    anio: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_pickup),
):
    """Entregas realizadas por el conductor vinculado al pickup."""
    pickup_id = current_user["id"]
    pickup = db.get(Pickup, pickup_id)
    if not pickup or not pickup.driver_id:
        return []
    query = db.query(Envio).filter(Envio.driver_id == pickup.driver_id)
    if semana is not None:
        query = query.filter(Envio.semana == semana)
    if mes is not None:
        query = query.filter(Envio.mes == mes)
    if anio is not None:
        query = query.filter(Envio.anio == anio)
    envios = query.order_by(Envio.fecha_entrega.desc()).limit(500).all()
    return [
        {
            "id": e.id,
            "fecha_entrega": str(e.fecha_entrega) if e.fecha_entrega else None,
            "tracking_id": e.tracking_id,
            "comuna": e.comuna,
            "costo_driver": e.costo_driver,
            "seller_nombre": e.seller.nombre if e.seller else e.seller_nombre_raw,
        }
        for e in envios
    ]


@router.get("/portal/envios-seller")
def pickup_envios_seller(
    semana: Optional[int] = None,
    mes: Optional[int] = None,
    anio: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_pickup),
):
    """Envíos emitidos por el seller vinculado al pickup."""
    pickup_id = current_user["id"]
    pickup = db.get(Pickup, pickup_id)
    if not pickup or not pickup.seller_id:
        return []
    query = db.query(Envio).filter(Envio.seller_id == pickup.seller_id)
    if semana is not None:
        query = query.filter(Envio.semana == semana)
    if mes is not None:
        query = query.filter(Envio.mes == mes)
    if anio is not None:
        query = query.filter(Envio.anio == anio)
    envios = query.order_by(Envio.fecha_entrega.desc()).limit(500).all()
    return [
        {
            "id": e.id,
            "fecha_entrega": str(e.fecha_entrega) if e.fecha_entrega else None,
            "tracking_id": e.tracking_id,
            "comuna": e.comuna,
            "cobro_seller": e.cobro_seller,
            "extra_producto_seller": e.extra_producto_seller,
            "extra_comuna_seller": e.extra_comuna_seller,
            "cobro_extra_manual": e.cobro_extra_manual,
        }
        for e in envios
    ]
