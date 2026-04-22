"""
Servicio de ingesta de asignaciones de ruta (denominador para efectividad).

Flujo:
1. Cliente HTTP descarga del endpoint del courier los paquetes que SALIERON a ruta
   en el rango de fechas (withdrawal_date).
2. Upsert en `asignacion_ruta` por tracking_id.
3. Reconciliación con `envios` por tracking_id:
   - Si el envío existe → enlazar (envio_id) y propagar `ruta_id`/`ruta_nombre`/
     `fecha_retiro` al `Envio` si están vacíos.
   - Si el envío no existe aún → queda pendiente (envio_id=NULL).
4. Calcula `estado_calculado`:
   - 'cancelado' si el status externo indica cancelación
   - 'entregado' si envio_id != NULL y envio.fecha_entrega != NULL
   - 'sin_entrega' en cualquier otro caso

El cliente HTTP real al endpoint del courier todavía NO está disponible: el
desarrollador externo lo va a publicar. Hasta entonces, `fetch_routes_by_date`
devuelve `(None, "no implementado")` y la lógica de upsert queda lista para
recibir los datos.
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import AsignacionRuta, Driver, Envio
from app.services.task_progress import update_task
from app.services.trackingtech import fetch_packages_withdrawals

logger = logging.getLogger(__name__)


# ── Estados ───────────────────────────────────────────────────────────────────
ESTADO_ENTREGADO = "entregado"
ESTADO_CANCELADO = "cancelado"
ESTADO_SIN_ENTREGA = "sin_entrega"

# Status externos que se consideran cancelación. Se ajusta al payload real.
# El endpoint del courier devuelve, por ejemplo: "delivered", "cancelled", etc.
STATUS_CANCELADOS = {
    "cancelado", "cancelled", "canceled", "anulado", "annulled",
    "rechazado", "devuelto",
}
STATUS_ENTREGADOS = {"delivered", "entregado"}


# ── Cliente HTTP: TrackingTech withdrawal-orders ──────────────────────────────
def fetch_routes_by_date(
    fecha_inicio: str,
    fecha_fin: str,
) -> tuple[Optional[list[dict]], Optional[str]]:
    """
    Descarga las asignaciones de ruta del courier (TrackingTech) para
    `[fecha_inicio, fecha_fin]` (formato YYYY-MM-DD).

    Mapea cada registro del endpoint a la forma que espera `upsert_asignacion`:
        external_id          ← id
        tracking_id          ← tracking_id
        seller_code          ← seller_code
        status               ← status (lowercase)
        withdrawal_date      ← date(withdrawal_date)
        withdrawal_at        ← datetime(withdrawal_date)
        pedido_creado_at     ← datetime(created_at)
        route_id, route_name ← route_id, route_name
        driver_id, driver_name ← driver_id, driver_name
        raw                  ← payload original
    """
    settings = get_settings()
    raw_records, error = fetch_packages_withdrawals(
        api_url=settings.TRACKINGTECH_API_URL,
        email=settings.TRACKINGTECH_EMAIL,
        password=settings.TRACKINGTECH_PASSWORD,
        start_date=fecha_inicio,
        end_date=fecha_fin,
    )
    if error and not raw_records:
        return None, error

    out: list[dict] = []
    for r in raw_records or []:
        if not isinstance(r, dict):
            continue
        tracking = (r.get("tracking_id") or "").strip()
        if not tracking:
            continue
        wd = _parse_dt(r.get("withdrawal_date"))
        out.append({
            "external_id": str(r.get("id")) if r.get("id") is not None else None,
            "tracking_id": tracking,
            "seller_code": r.get("seller_code"),
            "status": (r.get("status") or "").strip().lower() or None,
            "withdrawal_date": wd.date() if wd else None,
            "withdrawal_at": wd,
            "pedido_creado_at": _parse_dt(r.get("created_at")),
            "route_id": r.get("route_id"),
            "route_name": r.get("route_name"),
            "driver_id": r.get("driver_id"),
            "driver_name": r.get("driver_name"),
            "raw": r,
        })
    # Si el endpoint trajo error parcial pero sí hay datos, lo logueamos y seguimos.
    if error:
        logger.warning("fetch_routes_by_date warning: %s", error)
    return out, None


# ── Helpers ───────────────────────────────────────────────────────────────────
_DATE_FORMATS = ("%Y-%m-%d", "%Y%m%d", "%d/%m/%Y")
_DATETIME_FORMATS = (
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%d/%m/%Y %H:%M:%S",
    "%d/%m/%Y %H:%M",
)


def _parse_date(value) -> Optional[date]:
    if value is None:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        for fmt in _DATE_FORMATS:
            try:
                return datetime.strptime(s, fmt).date()
            except Exception:
                pass
        # último recurso: fromisoformat
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00")).date()
        except Exception:
            return None
    return None


def _parse_dt(value) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time())
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        for fmt in _DATETIME_FORMATS:
            try:
                return datetime.strptime(s, fmt)
            except Exception:
                pass
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
        except Exception:
            d = _parse_date(s)
            if d:
                return datetime.combine(d, datetime.min.time())
    return None


def _calcular_estado(asig: AsignacionRuta, envio: Optional[Envio]) -> str:
    if asig.status_externo and asig.status_externo.strip().lower() in STATUS_CANCELADOS:
        return ESTADO_CANCELADO
    if envio and envio.fecha_entrega:
        return ESTADO_ENTREGADO
    return ESTADO_SIN_ENTREGA


# Cache de drivers para resolver driver_local sin hacer una query por asignación.
# Se invalida al inicio de cada ingesta (build_driver_index) o cuando se quiera
# refrescar. Drivers son ~300 entries.
_driver_index: Optional[dict] = None


def build_driver_index(db: Session) -> dict:
    """(Re)construye el índice de drivers en memoria. Llamar al inicio de la
    ingesta y cada vez que se haya editado la tabla `drivers` durante el proceso.

    Estructura:
      {
        "exact": {nombre_lower: driver_id},
        "alias": {alias_lower: driver_id},
        "prefix": [(nombre_lower_con_espacios, driver_id), ...]  # solo nombres ≥2 palabras
      }
    """
    global _driver_index
    exact: dict[str, int] = {}
    alias: dict[str, int] = {}
    prefix: list[tuple[str, int]] = []
    for d in db.query(Driver).all():
        nl = (d.nombre or "").strip().lower()
        if not nl:
            continue
        # El primer driver con ese nombre gana (raro que se repita).
        exact.setdefault(nl, d.id)
        if " " in nl:
            prefix.append((nl, d.id))
        for a in (d.aliases or []):
            if isinstance(a, str):
                al = a.strip().lower()
                if al:
                    alias.setdefault(al, d.id)
    _driver_index = {"exact": exact, "alias": alias, "prefix": prefix}
    return _driver_index


def _resolver_driver_local(db: Session, driver_externo_id: Optional[int], driver_name: Optional[str]) -> Optional[int]:
    """Mapea el driver del courier (id externo + nombre) a un driver local.

    Estrategia, en orden:
      1. Match exacto case-insensitive contra `Driver.nombre`.
      2. Match dentro de `Driver.aliases` (JSON array case-insensitive). Aquí
         cae la gran mayoría: el courier reporta "Augusto Guerrero" mientras
         el local guarda "Augusto" + alias "Augusto Guerrero".
      3. Fallback por prefijo: nombre local con ≥2 palabras es prefijo del
         nombre del courier (p.ej. "Diego Mendez" prefijo de "Diego Mendez
         Delgado"). Evita falsos positivos tipo "Diego" → "Diego Santander".
    """
    if not driver_name:
        return None
    name_low = driver_name.strip().lower()
    if not name_low:
        return None

    idx = _driver_index if _driver_index is not None else build_driver_index(db)

    if name_low in idx["exact"]:
        return idx["exact"][name_low]
    if name_low in idx["alias"]:
        return idx["alias"][name_low]
    for nl, did in idx["prefix"]:
        if name_low.startswith(nl + " ") or name_low == nl:
            return did
    return None


# ── Upsert + reconciliación ───────────────────────────────────────────────────
def upsert_asignacion(db: Session, raw: dict) -> tuple[AsignacionRuta, bool]:
    """Upsert por (tracking_id, withdrawal_date). Devuelve (asignacion, creada).

    Regla multi-intento (abril 2026):
      - Si ya existe una fila con ese (tracking_id, withdrawal_date) → UPDATE.
        Esto contempla el caso "el mismo día el paquete cambió de ruta": al
        sólo recibir el último estado del día, esa fila se sobrescribe y NO
        se cuenta como un nuevo intento.
      - Si NO existe → INSERT con intento_nro = max(intento_nro)+1 para ese
        tracking. Cada día distinto en que el paquete sale a ruta cuenta como
        un intento independiente (First-Attempt Delivery Rate, Delivery Success
        Rate).
    """
    tracking_id = (raw.get("tracking_id") or "").strip()
    if not tracking_id:
        raise ValueError("tracking_id requerido")

    withdrawal_date = _parse_date(raw.get("withdrawal_date"))
    if not withdrawal_date:
        raise ValueError("withdrawal_date requerido")

    asig = (
        db.query(AsignacionRuta)
        .filter(
            AsignacionRuta.tracking_id == tracking_id,
            AsignacionRuta.withdrawal_date == withdrawal_date,
        )
        .first()
    )
    creada = False
    if asig is None:
        # Calcular el próximo número de intento para este tracking.
        max_intento = (
            db.query(func.coalesce(func.max(AsignacionRuta.intento_nro), 0))
            .filter(AsignacionRuta.tracking_id == tracking_id)
            .scalar()
        ) or 0
        asig = AsignacionRuta(
            tracking_id=tracking_id,
            withdrawal_date=withdrawal_date,
            intento_nro=int(max_intento) + 1,
        )
        db.add(asig)
        creada = True
    else:
        # Aseguramos coherencia: la fecha es la clave, no debería cambiar,
        # pero si el cron repite el día sí actualizamos el resto del payload.
        asig.withdrawal_date = withdrawal_date

    asig.external_id = raw.get("external_id") or asig.external_id
    asig.withdrawal_at = _parse_dt(raw.get("withdrawal_at")) or asig.withdrawal_at
    asig.pedido_creado_at = _parse_dt(raw.get("pedido_creado_at")) or asig.pedido_creado_at
    asig.route_id = raw.get("route_id") if raw.get("route_id") is not None else asig.route_id
    asig.route_name = raw.get("route_name") or asig.route_name
    asig.driver_externo_id = raw.get("driver_id") if raw.get("driver_id") is not None else asig.driver_externo_id
    asig.driver_name = raw.get("driver_name") or asig.driver_name
    asig.seller_code = raw.get("seller_code") or asig.seller_code
    asig.status_externo = raw.get("status") or asig.status_externo
    asig.raw_payload = raw.get("raw") or raw

    if asig.driver_id is None:
        asig.driver_id = _resolver_driver_local(db, asig.driver_externo_id, asig.driver_name)

    return asig, creada


def reconciliar_asignacion(db: Session, asig: AsignacionRuta) -> bool:
    """Intenta enlazar la asignación con un Envio por tracking_id.

    Si lo encuentra: setea envio_id, propaga ruta_id/ruta_nombre/fecha_retiro
    al Envio cuando estén vacíos, y recalcula estado.
    Devuelve True si el envío fue encontrado/enlazado.
    """
    envio = None
    if asig.envio_id:
        envio = db.query(Envio).filter(Envio.id == asig.envio_id).first()
    if envio is None:
        envio = (
            db.query(Envio)
            .filter(func.lower(Envio.tracking_id) == asig.tracking_id.strip().lower())
            .first()
        )
        if envio is not None:
            asig.envio_id = envio.id

    if envio is not None:
        if envio.fecha_retiro is None and asig.withdrawal_date:
            envio.fecha_retiro = asig.withdrawal_date
        if envio.ruta_id is None and asig.route_id is not None:
            envio.ruta_id = asig.route_id
        if (envio.ruta_nombre is None or envio.ruta_nombre == "") and asig.route_name:
            envio.ruta_nombre = asig.route_name

    asig.estado_calculado = _calcular_estado(asig, envio)
    asig.intentos_reconciliacion = (asig.intentos_reconciliacion or 0) + 1
    asig.ultima_reconciliacion_at = datetime.utcnow()
    return envio is not None


def reconciliar_pendientes(
    db: Session,
    fecha_desde: Optional[date] = None,
    limite: Optional[int] = None,
) -> dict:
    """Recorre asignaciones sin envio_id y/o en estado 'sin_entrega' e intenta enlazar.
    Útil para correr post-ingesta CSV o como cron de mantenimiento.
    """
    q = db.query(AsignacionRuta).filter(
        (AsignacionRuta.envio_id.is_(None)) | (AsignacionRuta.estado_calculado == ESTADO_SIN_ENTREGA)
    )
    if fecha_desde is not None:
        q = q.filter(AsignacionRuta.withdrawal_date >= fecha_desde)
    q = q.order_by(AsignacionRuta.withdrawal_date.desc())
    if limite:
        q = q.limit(limite)

    revisadas = 0
    enlazadas_nuevas = 0
    cambiaron_a_entregado = 0
    for asig in q.all():
        revisadas += 1
        ya_estaba_enlazada = asig.envio_id is not None
        estado_previo = asig.estado_calculado
        encontrado = reconciliar_asignacion(db, asig)
        if encontrado and not ya_estaba_enlazada:
            enlazadas_nuevas += 1
        if estado_previo != ESTADO_ENTREGADO and asig.estado_calculado == ESTADO_ENTREGADO:
            cambiaron_a_entregado += 1
    db.commit()

    return {
        "revisadas": revisadas,
        "enlazadas_nuevas": enlazadas_nuevas,
        "cambiaron_a_entregado": cambiaron_a_entregado,
        "fecha_desde": fecha_desde.isoformat() if fecha_desde else None,
    }


def reresolver_drivers(
    db: Session,
    fecha_desde: Optional[date] = None,
) -> dict:
    """Re-aplica `_resolver_driver_local` a todas las asignaciones cuyo driver_id
    local quedó NULL pero tienen `driver_name` del courier.

    Útil después de ampliar la lógica de matching (p.ej. soporte de aliases) o
    de agregar nuevos aliases a un Driver.
    """
    build_driver_index(db)
    q = db.query(AsignacionRuta).filter(
        AsignacionRuta.driver_id.is_(None),
        AsignacionRuta.driver_name.isnot(None),
    )
    if fecha_desde is not None:
        q = q.filter(AsignacionRuta.withdrawal_date >= fecha_desde)

    revisadas = 0
    resueltos = 0
    sin_match: dict[str, int] = {}
    BATCH = 500
    for asig in q.yield_per(BATCH):
        revisadas += 1
        did = _resolver_driver_local(db, asig.driver_externo_id, asig.driver_name)
        if did:
            asig.driver_id = did
            resueltos += 1
        else:
            sin_match[asig.driver_name] = sin_match.get(asig.driver_name, 0) + 1
        if revisadas % BATCH == 0:
            db.commit()
    db.commit()

    top_sin_match = sorted(sin_match.items(), key=lambda x: -x[1])[:10]
    return {
        "revisadas": revisadas,
        "resueltos": resueltos,
        "sin_match": revisadas - resueltos,
        "top_sin_match": [{"driver_name": n, "n": c} for n, c in top_sin_match],
        "fecha_desde": fecha_desde.isoformat() if fecha_desde else None,
    }


# ── Ingesta principal (a invocar desde el cron) ───────────────────────────────
def ingestar_rutas(
    db: Session,
    fecha_inicio: str,
    fecha_fin: str,
    task_id: Optional[str] = None,
) -> dict:
    """
    Descarga del endpoint y procesa todas las asignaciones para el rango.
    Se llama desde el handler del cron job o desde un thread (con task_id)
    para reportar progreso a la UI.
    """
    if task_id:
        update_task(task_id, message=f"Conectando con TrackingTech ({fecha_inicio} → {fecha_fin})…")

    # Refresca el índice de drivers en memoria para que `_resolver_driver_local`
    # use los aliases más recientes (≈300 entries, costo despreciable).
    build_driver_index(db)

    registros, error = fetch_routes_by_date(fecha_inicio, fecha_fin)
    if registros is None:
        resultado = {
            "ok": False,
            "mensaje": error or "Sin datos",
            "fecha_inicio": fecha_inicio,
            "fecha_fin": fecha_fin,
            "asignaciones_creadas": 0,
            "asignaciones_actualizadas": 0,
            "enlazadas_a_envio": 0,
            "sin_envio": 0,
        }
        if task_id:
            update_task(task_id, status="error", message=error or "Sin datos", result=resultado)
        return resultado

    total = len(registros)
    logger.info(
        "ingestar_rutas: %d registros descargados de TrackingTech para %s -> %s",
        total, fecha_inicio, fecha_fin,
    )
    if task_id:
        update_task(task_id, total=total, message=f"Descargados {total} registros del courier. Procesando…")

    creadas = 0
    actualizadas = 0
    enlazadas = 0
    sin_envio = 0
    errores = 0

    for idx, raw in enumerate(registros):
        try:
            asig, creada_provisional = upsert_asignacion(db, raw)
            db.flush()
            encontrado = reconciliar_asignacion(db, asig)
            db.flush()
            if creada_provisional:
                creadas += 1
            else:
                actualizadas += 1
            if encontrado:
                enlazadas += 1
            else:
                sin_envio += 1
        except Exception:  # noqa: BLE001
            errores += 1
            logger.exception("Error procesando asignacion: %s", raw.get("tracking_id"))
            db.rollback()
            continue

        # Commits intermedios para liberar memoria, evitar transacciones gigantes
        # y permitir que el progreso sea visible en la BD durante la corrida.
        if (idx + 1) % 200 == 0:
            try:
                db.commit()
            except Exception:
                logger.exception("Commit intermedio fallo en idx=%d", idx)
                db.rollback()

        if task_id and ((idx + 1) % 25 == 0 or (idx + 1) == total):
            update_task(
                task_id,
                processed=idx + 1,
                nuevos=creadas,
                duplicados=actualizadas,
                errores=errores,
                message=f"Procesando… {idx + 1}/{total}",
            )

    db.commit()

    procesadas_ok = creadas + actualizadas
    resultado = {
        "ok": True,
        "mensaje": (
            f"API: {total} - Procesadas OK: {procesadas_ok} "
            f"({creadas} nuevas, {actualizadas} actualizadas) - "
            f"Con envio local: {enlazadas} - Sin envio local: {sin_envio} - Errores: {errores}"
        ),
        "fecha_inicio": fecha_inicio,
        "fecha_fin": fecha_fin,
        "total_api": total,
        "asignaciones_creadas": creadas,
        "asignaciones_actualizadas": actualizadas,
        "enlazadas_a_envio": enlazadas,
        "sin_envio": sin_envio,
        "errores": errores,
    }
    logger.info("ingestar_rutas resumen: %s", resultado["mensaje"])

    if task_id:
        update_task(
            task_id,
            status="done",
            processed=total,
            nuevos=creadas,
            duplicados=actualizadas,
            errores=errores,
            message=resultado["mensaje"],
            result=resultado,
        )

    return resultado
