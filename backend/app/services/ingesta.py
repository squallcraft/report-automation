"""
Motor de ingesta de reportes Excel del software de gestión.
Procesa cada fila: homologa nombres, aplica reglas de negocio, calcula cobros/pagos.
Soporta procesamiento por lotes, detección de duplicados y tracking de progreso.
"""
from typing import Optional, Dict

import os
import re
import uuid
from datetime import date, time as time_type

import pandas as pd
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy import func as sqlfunc

from app.models import (
    Seller, Driver, Envio, ProductoConExtra, TarifaComuna, TarifaPlanComuna,
    EmpresaEnum, LogIngesta, PeriodoLiquidacion, TarifaEscalonadaSeller,
    Pickup, RecepcionPaquete,
)
from app.services.task_progress import update_task
from app.services.calendario import build_fecha_semana_lookup
from app.services.tarifas_escalonadas import recalcular_tarifas_escalonadas
from app.services.homologacion import homologar_nombre

MLC_REGEX = re.compile(r"\[MLC(\d+)\]")

BATCH_SIZE = 500


def _parse_time(value) -> Optional[time_type]:
    """Parsea una hora desde string 'HH:MM', 'HH:MM:SS', objeto time o datetime."""
    if value is None:
        return None
    if isinstance(value, time_type):
        return value
    import datetime as _dt
    if isinstance(value, _dt.datetime):
        return value.time()
    s = str(value).strip()
    for fmt in ("%H:%M:%S", "%H:%M"):
        try:
            return _dt.datetime.strptime(s, fmt).time()
        except Exception:
            pass
    return None

COLUMN_MAP = {
    "User - Nombre": "user_nombre",
    "Pedido Fecha": "fecha_carga",
    "Fecha Entrega": "fecha_entrega",
    "Tracking ID": "tracking_id",
    "Seller Name": "seller_raw",
    "Seller Code": "seller_code",
    "External ID": "venta_id",
    "External Costo Orden": "costo_orden",
    "Dirección": "direccion",
    "Comuna": "comuna_col",
    "Cantidad de Bultos": "bultos",
    "Descripción Paquete": "descripcion",
    "Ruta Nombre": "ruta_nombre",
    "Nombre Conductor": "driver_raw",
    "Ruta Conductor": "driver_raw",
    "Lat": "lat",
    "Lon": "lon",
    "Latitud": "lat",
    "Longitud": "lon",
    "Hora Entrega": "hora_entrega",
    "Hora de Entrega": "hora_entrega",
    "HoraEntrega": "hora_entrega",
    "Ruta Fecha": "fecha_ruta",
    "Ruta ID": "ruta_id_col",
}


def calcular_semana_del_mes(fecha: date) -> int:
    dia = fecha.day
    return min((dia - 1) // 7 + 1, 5)


def extraer_codigo_mlc(descripcion: Optional[str]) -> Optional[str]:
    if not descripcion:
        return None
    match = MLC_REGEX.search(descripcion)
    if match:
        return f"MLC{match.group(1)}"
    return None


def normalizar_comuna(direccion: Optional[str]) -> Optional[str]:
    if not direccion:
        return None
    partes = [p.strip() for p in direccion.split(",")]
    if len(partes) >= 2:
        return partes[-2].lower().strip()
    return partes[0].lower().strip()




def _build_envio_from_row(
    row, idx, sellers, drivers, seller_by_id, driver_by_id,
    seller_cache, driver_cache,
    productos_map, comunas_map, plan_comuna_map, ingesta_id, stats,
    fecha_lookup=None,
):
    """Construye un objeto Envio a partir de una fila del DataFrame. Retorna (envio, tracking_id) o None."""
    fecha_entrega_raw = row.get("fecha_entrega")
    if pd.isna(fecha_entrega_raw):
        stats["errores"].append(f"Fila {idx + 2}: sin fecha de entrega")
        return None

    if isinstance(fecha_entrega_raw, str):
        fecha_entrega = pd.to_datetime(fecha_entrega_raw, dayfirst=True).date()
    else:
        fecha_entrega = pd.Timestamp(fecha_entrega_raw).date()

    fecha_carga = None
    fecha_carga_raw = row.get("fecha_carga")
    if not pd.isna(fecha_carga_raw):
        if isinstance(fecha_carga_raw, str):
            fecha_carga = pd.to_datetime(fecha_carga_raw, dayfirst=True).date()
        else:
            fecha_carga = pd.Timestamp(fecha_carga_raw).date()

    user_nombre = str(row.get("user_nombre", "")).strip() if not pd.isna(row.get("user_nombre")) else None
    seller_raw = str(row.get("seller_raw", "")).strip() if not pd.isna(row.get("seller_raw")) else None
    driver_raw = str(row.get("driver_raw", "")).strip() if not pd.isna(row.get("driver_raw")) else None

    seller_id = homologar_nombre(seller_raw, sellers, seller_cache) if seller_raw else None
    driver_id = homologar_nombre(driver_raw, drivers, driver_cache) if driver_raw else None

    homologado = True
    if seller_raw and seller_id is None:
        stats["sin_homologar_sellers"].add(seller_raw)
        homologado = False
    if driver_raw and driver_id is None:
        stats["sin_homologar_drivers"].add(driver_raw)
        homologado = False

    seller = seller_by_id.get(seller_id) if seller_id else None
    driver = driver_by_id.get(driver_id) if driver_id else None

    comuna_col = str(row.get("comuna_col", "")).strip() if not pd.isna(row.get("comuna_col")) else None
    empresa = seller.empresa if seller else None

    cobro_seller = 0
    if seller:
        if seller.plan_tarifario and comuna_col:
            key = (seller.plan_tarifario.lower(), comuna_col.lower())
            cobro_seller = plan_comuna_map.get(key, seller.precio_base)
        else:
            cobro_seller = seller.precio_base

    costo_driver = 0
    if driver and empresa:
        if empresa in (EmpresaEnum.ECOURIER, EmpresaEnum.ECOURIER.value):
            costo_driver = driver.tarifa_ecourier
        elif empresa in (EmpresaEnum.OVIEDO, EmpresaEnum.OVIEDO.value):
            costo_driver = driver.tarifa_oviedo
        elif empresa in (EmpresaEnum.TERCERIZADO, EmpresaEnum.TERCERIZADO.value):
            costo_driver = driver.tarifa_tercerizado
        elif empresa in (EmpresaEnum.VALPARAISO, EmpresaEnum.VALPARAISO.value):
            costo_driver = driver.tarifa_valparaiso
        elif empresa in (EmpresaEnum.MELIPILLA, EmpresaEnum.MELIPILLA.value):
            costo_driver = driver.tarifa_melipilla

    descripcion = str(row.get("descripcion", "")) if not pd.isna(row.get("descripcion")) else None
    codigo_mlc = extraer_codigo_mlc(descripcion)

    extra_producto_seller = 0
    extra_producto_driver = 0
    if codigo_mlc and codigo_mlc.upper() in productos_map:
        prod = productos_map[codigo_mlc.upper()]
        extra_producto_seller = prod.extra_seller
        extra_producto_driver = prod.extra_driver

    direccion = str(row.get("direccion", "")) if not pd.isna(row.get("direccion")) else None
    comuna = comuna_col.lower().strip() if comuna_col else normalizar_comuna(direccion)

    extra_comuna_seller = 0
    extra_comuna_driver = 0
    if comuna and comuna in comunas_map:
        tc = comunas_map[comuna]
        extra_comuna_seller = tc.extra_seller
        extra_comuna_driver = tc.extra_driver

    # Regla: si el driver tiene extra por bulto/producto Y extra por comuna,
    # se aplica solo el mayor; el menor queda en 0.
    if extra_producto_driver > 0 and extra_comuna_driver > 0:
        if extra_producto_driver >= extra_comuna_driver:
            extra_comuna_driver = 0
        else:
            extra_producto_driver = 0

    # Conductores contratados no reciben pago por extras de bultos ni de comuna.
    if driver and getattr(driver, 'contratado', False):
        extra_producto_driver = 0
        extra_comuna_driver = 0

    # Usar calendario si está disponible, sino fallback a fórmula simple
    if fecha_lookup and fecha_entrega in fecha_lookup:
        semana, mes_envio, anio_envio = fecha_lookup[fecha_entrega]
    else:
        semana = calcular_semana_del_mes(fecha_entrega)
        mes_envio = fecha_entrega.month
        anio_envio = fecha_entrega.year

    bultos_val = row.get("bultos", 1)
    bultos = int(bultos_val) if not pd.isna(bultos_val) else 1

    costo_orden_raw = row.get("costo_orden", 0)
    costo_orden = int(costo_orden_raw) if not pd.isna(costo_orden_raw) else 0

    tracking_id = str(row.get("tracking_id", "")) if not pd.isna(row.get("tracking_id")) else None
    seller_code = str(row.get("seller_code", "")) if not pd.isna(row.get("seller_code")) else None
    venta_id = str(row.get("venta_id", "")) if not pd.isna(row.get("venta_id")) else None
    ruta_nombre = str(row.get("ruta_nombre", "")) if not pd.isna(row.get("ruta_nombre")) else None

    # Coordenadas geográficas (opcional). Tolera coma decimal y valida bounding box Chile.
    # Si la columna no viene, no afecta nada (compat hacia atrás).
    from app.services.coordenadas import parse_coord, coords_validas
    raw_lat = row.get("lat") if "lat" in row.index else None
    raw_lon = row.get("lon") if "lon" in row.index else None
    lat_val = parse_coord(raw_lat) if raw_lat is not None and not (isinstance(raw_lat, float) and pd.isna(raw_lat)) else None
    lon_val = parse_coord(raw_lon) if raw_lon is not None and not (isinstance(raw_lon, float) and pd.isna(raw_lon)) else None
    if not coords_validas(lat_val, lon_val):
        lat_val, lon_val = None, None

    hora_entrega_val = None
    raw_hora = row.get("hora_entrega") if "hora_entrega" in row.index else None
    if raw_hora is not None and not (isinstance(raw_hora, float) and pd.isna(raw_hora)):
        hora_entrega_val = _parse_time(raw_hora)

    fecha_ruta_val = None
    raw_fecha_ruta = row.get("fecha_ruta") if "fecha_ruta" in row.index else None
    if raw_fecha_ruta is not None and not (isinstance(raw_fecha_ruta, float) and pd.isna(raw_fecha_ruta)):
        try:
            if isinstance(raw_fecha_ruta, str):
                fecha_ruta_val = pd.to_datetime(raw_fecha_ruta, dayfirst=True).date()
            else:
                fecha_ruta_val = pd.Timestamp(raw_fecha_ruta).date()
        except Exception:
            fecha_ruta_val = None

    ruta_id_from_col = None
    raw_ruta_id = row.get("ruta_id_col") if "ruta_id_col" in row.index else None
    if raw_ruta_id is not None and not (isinstance(raw_ruta_id, float) and pd.isna(raw_ruta_id)):
        try:
            ruta_id_from_col = int(float(str(raw_ruta_id)))
        except Exception:
            ruta_id_from_col = None

    envio = Envio(
        semana=semana,
        mes=mes_envio,
        anio=anio_envio,
        fecha_carga=fecha_carga,
        fecha_entrega=fecha_entrega,
        seller_id=seller_id,
        driver_id=driver_id,
        user_nombre=user_nombre,
        seller_nombre_raw=seller_raw,
        driver_nombre_raw=driver_raw,
        zona=seller.zona if seller else None,
        comuna=comuna,
        empresa=empresa,
        cobro_seller=cobro_seller,
        costo_driver=costo_driver,
        extra_producto_seller=extra_producto_seller,
        extra_producto_driver=extra_producto_driver,
        extra_comuna_seller=extra_comuna_seller,
        extra_comuna_driver=extra_comuna_driver,
        costo_orden=costo_orden,
        bultos=bultos,
        tracking_id=tracking_id,
        seller_code=seller_code,
        venta_id=venta_id,
        descripcion_producto=descripcion,
        codigo_producto=codigo_mlc,
        ruta_nombre=ruta_nombre,
        direccion=direccion,
        lat=lat_val,
        lon=lon_val,
        hora_entrega=hora_entrega_val,
        fecha_ruta=fecha_ruta_val,
        ruta_id=ruta_id_from_col,
        homologado=homologado,
        ingesta_id=ingesta_id,
    )
    return envio, tracking_id


def _invalidate_snapshots(db: Session, periodos_afectados: set):
    """Limpia snapshots de liquidación para períodos que recibieron datos nuevos."""
    for (semana, mes, anio) in periodos_afectados:
        periodo = db.query(PeriodoLiquidacion).filter(
            PeriodoLiquidacion.semana == semana,
            PeriodoLiquidacion.mes == mes,
            PeriodoLiquidacion.anio == anio,
        ).first()
        if periodo:
            periodo.snapshot_sellers = None
            periodo.snapshot_drivers = None
            periodo.snapshot_rentabilidad = None
            flag_modified(periodo, "snapshot_sellers")
            flag_modified(periodo, "snapshot_drivers")
            flag_modified(periodo, "snapshot_rentabilidad")


def procesar_reporte_excel(
    db: Session,
    filepath: str,
    usuario: str = None,
    task_id: str = None,
    reprocesar_semana: int = None,
    reprocesar_mes: int = None,
    reprocesar_anio: int = None,
) -> dict:
    """
    Procesa un archivo Excel del software de gestión.
    - Procesamiento por lotes (BATCH_SIZE filas) con commits intermedios.
    - Detección de duplicados por tracking_id (omite envíos ya existentes).
    - Si reprocesar_* están definidos, elimina envíos del período antes de procesar.
    - Actualiza progreso via task_progress si task_id es proporcionado.
    """
    ingesta_id = str(uuid.uuid4())[:8]

    try:
        if task_id:
            update_task(task_id, message="Leyendo archivo Excel...")
        df = pd.read_excel(filepath)
    except Exception as e:
        error_msg = f"No se pudo leer el archivo: {str(e)}"
        if task_id:
            update_task(task_id, status="error", message=error_msg)
        return {"error": error_msg}

    rename_map = {}
    for col_original, col_interno in COLUMN_MAP.items():
        for col_df in df.columns:
            if col_original.lower() in col_df.lower():
                rename_map[col_df] = col_interno
                break
    df = df.rename(columns=rename_map)

    total = len(df)
    if task_id:
        update_task(task_id, total=total, message="Cargando datos de referencia...")

    sellers = db.query(Seller).filter(Seller.activo == True).all()
    drivers = db.query(Driver).filter(Driver.activo == True).all()
    productos_extra = db.query(ProductoConExtra).filter(ProductoConExtra.activo == True).all()
    tarifas_comuna = db.query(TarifaComuna).all()
    tarifas_plan = db.query(TarifaPlanComuna).all()

    productos_map = {p.codigo_mlc.upper(): p for p in productos_extra}
    comunas_map = {t.comuna.lower(): t for t in tarifas_comuna}
    plan_comuna_map = {(t.plan_tarifario.lower(), t.comuna.lower()): t.precio for t in tarifas_plan}

    # --- Re-procesamiento: eliminar envíos del período indicado ---
    reprocesando = all(v is not None for v in [reprocesar_semana, reprocesar_mes, reprocesar_anio])
    eliminados = 0
    if reprocesando:
        bloqueados = db.query(Envio).filter(
            Envio.semana == reprocesar_semana,
            Envio.mes == reprocesar_mes,
            Envio.anio == reprocesar_anio,
            Envio.estado_financiero != "pendiente",
        ).count()
        if bloqueados > 0:
            error_msg = (
                f"No se puede reprocesar: {bloqueados} envíos de semana {reprocesar_semana} "
                f"({reprocesar_mes}/{reprocesar_anio}) ya están liquidados/facturados/pagados."
            )
            if task_id:
                update_task(task_id, status="error", message=error_msg)
            return {"error": error_msg, "envios_creados": 0}
        if task_id:
            update_task(
                task_id,
                message=f"Eliminando envíos de semana {reprocesar_semana}, {reprocesar_mes}/{reprocesar_anio}...",
            )
        eliminados = db.query(Envio).filter(
            Envio.semana == reprocesar_semana,
            Envio.mes == reprocesar_mes,
            Envio.anio == reprocesar_anio,
        ).delete(synchronize_session="fetch")
        db.commit()

    # --- Cargar tracking_ids existentes para detección de duplicados ---
    if task_id:
        update_task(task_id, message="Verificando duplicados...")
    existing_tracking_ids = set()
    existing_rows = db.query(Envio.tracking_id).filter(
        Envio.tracking_id.isnot(None),
        Envio.tracking_id != "",
    ).all()
    existing_tracking_ids = {r[0] for r in existing_rows}

    # --- Cargar lookup de fechas desde el calendario ---
    if task_id:
        update_task(task_id, message="Cargando calendario de semanas...")
    fecha_lookup = build_fecha_semana_lookup(db)

    seller_by_id = {s.id: s for s in sellers}
    driver_by_id = {d.id: d for d in drivers}
    seller_cache: Dict[str, int] = {}
    driver_cache: Dict[str, int] = {}

    stats = {
        "total_filas": total,
        "envios_creados": 0,
        "duplicados_omitidos": 0,
        "eliminados_reproceso": eliminados,
        "sin_homologar_sellers": set(),
        "sin_homologar_drivers": set(),
        "errores": [],
        "ingesta_id": ingesta_id,
    }

    if task_id:
        update_task(task_id, message="Procesando envíos...")

    batch = []
    periodos_afectados = set()

    for idx, row in df.iterrows():
        try:
            tracking_id_raw = row.get("tracking_id")
            tid = str(tracking_id_raw).strip() if not pd.isna(tracking_id_raw) else None

            if tid and tid in existing_tracking_ids:
                stats["duplicados_omitidos"] += 1
                if task_id and (idx + 1) % 200 == 0:
                    update_task(
                        task_id,
                        processed=idx + 1,
                        nuevos=stats["envios_creados"],
                        duplicados=stats["duplicados_omitidos"],
                        errores=len(stats["errores"]),
                        message=f"Procesando fila {idx + 1:,} de {total:,}...",
                    )
                continue

            result = _build_envio_from_row(
                row, idx, sellers, drivers, seller_by_id, driver_by_id,
                seller_cache, driver_cache,
                productos_map, comunas_map, plan_comuna_map, ingesta_id, stats,
                fecha_lookup=fecha_lookup,
            )
            if result is None:
                if task_id and (idx + 1) % 200 == 0:
                    update_task(
                        task_id,
                        processed=idx + 1,
                        nuevos=stats["envios_creados"],
                        duplicados=stats["duplicados_omitidos"],
                        errores=len(stats["errores"]),
                        message=f"Procesando fila {idx + 1:,} de {total:,}...",
                    )
                continue

            envio, tracking_id = result
            batch.append(envio)
            periodos_afectados.add((envio.semana, envio.mes, envio.anio))

            if tracking_id:
                existing_tracking_ids.add(tracking_id)
            stats["envios_creados"] += 1

            if len(batch) >= BATCH_SIZE:
                db.add_all(batch)
                db.flush()
                db.commit()
                batch = []
                if task_id:
                    update_task(
                        task_id,
                        processed=idx + 1,
                        nuevos=stats["envios_creados"],
                        duplicados=stats["duplicados_omitidos"],
                        errores=len(stats["errores"]),
                        message=f"Procesando fila {idx + 1:,} de {total:,}... ({stats['envios_creados']:,} nuevos)",
                    )

        except Exception as e:
            stats["errores"].append(f"Fila {idx + 2}: {str(e)}")

        if task_id and (idx + 1) % 200 == 0 and len(batch) > 0 and len(batch) < BATCH_SIZE:
            update_task(
                task_id,
                processed=idx + 1,
                nuevos=stats["envios_creados"],
                duplicados=stats["duplicados_omitidos"],
                errores=len(stats["errores"]),
                message=f"Procesando fila {idx + 1:,} de {total:,}...",
            )

    if batch:
        db.add_all(batch)
        db.flush()
    db.commit()

    if periodos_afectados:
        _invalidate_snapshots(db, periodos_afectados)
        db.commit()

        has_escalonadas = db.query(TarifaEscalonadaSeller).filter(
            TarifaEscalonadaSeller.activo == True
        ).count() > 0
        if has_escalonadas:
            if task_id:
                update_task(task_id, message="Recalculando tarifas escalonadas...")
            recalcular_tarifas_escalonadas(db, periodos_afectados)

    stats["sin_homologar_sellers"] = list(stats["sin_homologar_sellers"])
    stats["sin_homologar_drivers"] = list(stats["sin_homologar_drivers"])

    log = LogIngesta(
        ingesta_id=ingesta_id,
        usuario=usuario,
        tipo="REPROCESO" if reprocesando else "REPORTE_EXCEL",
        archivo=os.path.basename(filepath),
        total_filas=stats["total_filas"],
        procesados=stats["envios_creados"],
        errores_count=len(stats["errores"]),
        sin_homologar_sellers=stats["sin_homologar_sellers"],
        sin_homologar_drivers=stats["sin_homologar_drivers"],
        errores=stats["errores"][:200],
        resultado={
            "envios_creados": stats["envios_creados"],
            "duplicados_omitidos": stats["duplicados_omitidos"],
            "eliminados_reproceso": eliminados,
        },
    )
    db.add(log)
    db.commit()

    if task_id:
        update_task(
            task_id,
            status="completed",
            processed=total,
            nuevos=stats["envios_creados"],
            duplicados=stats["duplicados_omitidos"],
            errores=len(stats["errores"]),
            message="Procesamiento completado",
            result=stats,
        )

    return stats


def _persist_alias(entidad, nombre_raw: str):
    """Agrega nombre_raw como alias de la entidad si no existe."""
    current = list(entidad.aliases or [])
    if nombre_raw not in current:
        current.append(nombre_raw)
        entidad.aliases = current
        flag_modified(entidad, "aliases")


TARIFA_MAP_DRIVER = {
    EmpresaEnum.ECOURIER.value: "tarifa_ecourier",
    EmpresaEnum.OVIEDO.value: "tarifa_oviedo",
    EmpresaEnum.TERCERIZADO.value: "tarifa_tercerizado",
    EmpresaEnum.VALPARAISO.value: "tarifa_valparaiso",
    EmpresaEnum.MELIPILLA.value: "tarifa_melipilla",
}


def _get_tarifa_driver(driver, empresa_value: str) -> int:
    attr = TARIFA_MAP_DRIVER.get(empresa_value)
    return getattr(driver, attr, 0) if attr else 0


def resolver_homologacion(db: Session, nombre_raw: str, tipo: str, entidad_id: int) -> int:
    if tipo == "SELLER":
        entidad = db.query(Seller).get(entidad_id)
        if not entidad:
            raise ValueError("Seller no encontrado")
        _persist_alias(entidad, nombre_raw)
        tarifas_plan = db.query(TarifaPlanComuna).all()
        plan_comuna_map = {(t.plan_tarifario.lower(), t.comuna.lower()): t.precio for t in tarifas_plan}

        envios = db.query(Envio).filter(
            Envio.seller_nombre_raw == nombre_raw,
            Envio.seller_id.is_(None),
        ).all()
        for envio in envios:
            envio.seller_id = entidad_id
            envio.empresa = entidad.empresa
            envio.zona = entidad.zona
            if entidad.plan_tarifario and envio.comuna:
                key = (entidad.plan_tarifario.lower(), envio.comuna.lower())
                envio.cobro_seller = plan_comuna_map.get(key, entidad.precio_base)
            else:
                envio.cobro_seller = entidad.precio_base
            envio.homologado = envio.driver_id is not None
        db.commit()
        return len(envios)

    elif tipo == "DRIVER":
        entidad = db.query(Driver).get(entidad_id)
        if not entidad:
            raise ValueError("Driver no encontrado")
        _persist_alias(entidad, nombre_raw)
        seller_cache = {}
        envios = db.query(Envio).filter(
            Envio.driver_nombre_raw == nombre_raw,
            Envio.driver_id.is_(None),
        ).all()
        for envio in envios:
            envio.driver_id = entidad_id
            if envio.seller_id:
                if envio.seller_id not in seller_cache:
                    seller_cache[envio.seller_id] = db.query(Seller).get(envio.seller_id)
                seller = seller_cache[envio.seller_id]
                if seller:
                    envio.costo_driver = _get_tarifa_driver(entidad, seller.empresa)
            envio.homologado = envio.seller_id is not None
        db.commit()
        return len(envios)

    elif tipo == "PICKUP":
        pickup = db.query(Pickup).get(entidad_id)
        if not pickup:
            raise ValueError("Pickup no encontrado")
        _persist_alias(pickup, nombre_raw)

        recepciones = db.query(RecepcionPaquete).filter(
            RecepcionPaquete.pickup_nombre_raw == nombre_raw,
            RecepcionPaquete.pickup_id.is_(None),
        ).all()
        for rec in recepciones:
            rec.pickup_id = pickup.id
            rec.comision = pickup.comision_paquete
            if pickup.seller_id and rec.envio_id:
                envio = db.query(Envio).get(rec.envio_id)
                if envio and envio.seller_id == pickup.seller_id:
                    rec.comision = 0
        db.commit()
        return len(recepciones)

    else:
        raise ValueError(f"Tipo no soportado: {tipo}")
