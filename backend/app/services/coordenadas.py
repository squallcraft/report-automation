"""
Backfill y mantenimiento de coordenadas geográficas (lat/lon) en `envios`.

Uso esperado:
1. One-shot: subir Excel/CSV con (Tracking ID, Lat, Lon) → UPDATE masivo en envios.
2. Continuo: el parser de ingesta diaria detecta columnas lat/lon y las
   persiste automáticamente.

Soporta números en formato chileno (coma decimal: "-33,4709"), float nativo
de Excel, y validación de bounding box para Chile (descarta outliers que
podrían venir de geocoding fallido).
"""

from __future__ import annotations

import io
import logging
import re
from typing import Iterable, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Envio
from app.services.task_progress import update_task

logger = logging.getLogger(__name__)


# Bounding box Chile continental + insular cercano. Coordenadas fuera de aquí
# se descartan como ruido (típico: 0,0 / 999 / lat-lon invertidos).
LAT_MIN, LAT_MAX = -56.0, -17.0
LON_MIN, LON_MAX = -76.0, -66.0


# ── Parser numérico tolerante (coma o punto decimal) ────────────────────────
_NUM_RE = re.compile(r"^-?\d+([.,]\d+)?$")


def parse_coord(value) -> Optional[float]:
    """Convierte un valor (float/int/str) en coordenada decimal.

    Acepta:
      -33.4709, -33,4709, "-33.4709", " -33,4709 ", -70 (entero)
    Rechaza:
      None, "", "NaN", "0", strings no-numéricos.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        try:
            f = float(value)
        except (TypeError, ValueError):
            return None
        if f == 0:
            return None
        return f
    if isinstance(value, str):
        s = value.strip().replace(" ", "")
        if not s or s.lower() in ("nan", "none", "null", "-"):
            return None
        # Normaliza coma decimal a punto
        s = s.replace(",", ".")
        if not _NUM_RE.match(s.replace(".", "", 1) + ("." if "." in s else "") if s.count(".") > 1 else s):
            # Permitimos solo un punto/coma como separador decimal
            try:
                f = float(s)
            except ValueError:
                return None
        else:
            try:
                f = float(s)
            except ValueError:
                return None
        if f == 0:
            return None
        return f
    return None


def coords_validas(lat: Optional[float], lon: Optional[float]) -> bool:
    """True si (lat, lon) caen dentro del bounding box de Chile."""
    if lat is None or lon is None:
        return False
    if not (LAT_MIN <= lat <= LAT_MAX):
        return False
    if not (LON_MIN <= lon <= LON_MAX):
        return False
    return True


# ── Parser de archivos Excel/CSV ────────────────────────────────────────────
def parse_archivo_coordenadas(file_bytes: bytes, filename: str) -> tuple[list[dict], Optional[str]]:
    """Devuelve (filas, error). Cada fila: {tracking_id, lat, lon}.

    Acepta .xlsx (con cualquier nombre de columna que contenga 'tracking',
    'lat' y 'lon') y .csv (separador automático).
    """
    name = (filename or "").lower()
    try:
        if name.endswith((".xlsx", ".xls", ".xlsm")):
            import openpyxl  # noqa: WPS433
            wb = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
            ws = wb.active
            rows_iter = ws.iter_rows(values_only=True)
        else:
            # CSV (auto-detect separador)
            import csv  # noqa: WPS433
            text = file_bytes.decode("utf-8-sig", errors="replace")
            sample = text[:4096]
            try:
                dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
                sep = dialect.delimiter
            except Exception:
                sep = ","
            reader = csv.reader(io.StringIO(text), delimiter=sep)
            rows_iter = iter(reader)
    except Exception as e:  # noqa: BLE001
        return [], f"No se pudo abrir el archivo: {e}"

    header = next(rows_iter, None)
    if not header:
        return [], "Archivo vacío"

    header_norm = [(h or "").strip().lower() for h in header]

    def _find(*candidates) -> int:
        for i, h in enumerate(header_norm):
            for c in candidates:
                if c in h:
                    return i
        return -1

    idx_tracking = _find("tracking", "código", "codigo")
    idx_lat = _find("lat")
    idx_lon = _find("lon", "lng", "long")

    if idx_tracking == -1 or idx_lat == -1 or idx_lon == -1:
        return [], (
            f"Columnas requeridas no encontradas. Necesito 'tracking_id'/'codigo', "
            f"'lat' y 'lon'. Encontré: {header}"
        )

    out: list[dict] = []
    for row in rows_iter:
        if not row:
            continue
        try:
            tid = (str(row[idx_tracking]).strip() if row[idx_tracking] is not None else "")
            lat = parse_coord(row[idx_lat])
            lon = parse_coord(row[idx_lon])
        except IndexError:
            continue
        if not tid:
            continue
        out.append({"tracking_id": tid, "lat": lat, "lon": lon})
    return out, None


# ── Backfill masivo (UPDATE por tracking_id) ────────────────────────────────
def backfill_coordenadas(
    db: Session,
    filas: list[dict],
    *,
    sobreescribir: bool = False,
    task_id: Optional[str] = None,
) -> dict:
    """Actualiza envios.lat/envios.lon haciendo match por tracking_id.

    Args:
        sobreescribir: si False (default), solo actualiza envíos sin coordenada
            previa. Si True, pisa cualquier valor anterior.

    El match es case-insensitive (LOWER(tracking_id) = LOWER(?)). Aprovecha el
    índice funcional `ix_envios_tracking_id_lower` ya creado.
    """
    total = len(filas)
    if task_id:
        update_task(task_id, total=total, message=f"Procesando {total} filas…")

    matcheados = 0
    no_matcheados = 0
    actualizados = 0
    ya_tenian = 0
    fuera_rango = 0
    sin_coordenada = 0

    for idx, fila in enumerate(filas):
        tid = (fila.get("tracking_id") or "").strip()
        lat = fila.get("lat")
        lon = fila.get("lon")

        if not tid:
            no_matcheados += 1
            continue

        if not coords_validas(lat, lon):
            if lat is None and lon is None:
                sin_coordenada += 1
            else:
                fuera_rango += 1
            continue

        envio = (
            db.query(Envio)
            .filter(func.lower(Envio.tracking_id) == tid.lower())
            .first()
        )
        if envio is None:
            no_matcheados += 1
            continue

        matcheados += 1
        ya_tenia = envio.lat is not None and envio.lon is not None
        if ya_tenia and not sobreescribir:
            ya_tenian += 1
            continue

        envio.lat = lat
        envio.lon = lon
        actualizados += 1

        if (idx + 1) % 500 == 0:
            try:
                db.commit()
            except Exception:
                logger.exception("Commit intermedio falló en backfill (idx=%d)", idx)
                db.rollback()
            if task_id:
                update_task(
                    task_id,
                    processed=idx + 1,
                    nuevos=actualizados,
                    duplicados=ya_tenian,
                    errores=no_matcheados + fuera_rango,
                    message=f"Procesando… {idx + 1}/{total}",
                )

    db.commit()

    resultado = {
        "ok": True,
        "total_filas": total,
        "matcheados": matcheados,
        "actualizados": actualizados,
        "ya_tenian_coordenada": ya_tenian,
        "no_matcheados": no_matcheados,
        "fuera_rango_chile": fuera_rango,
        "sin_coordenada_origen": sin_coordenada,
        "sobreescribir": sobreescribir,
        "mensaje": (
            f"OK: {actualizados} envíos actualizados de {matcheados} matcheados. "
            f"No encontrados: {no_matcheados}. Sin coord: {sin_coordenada}. "
            f"Fuera de rango Chile: {fuera_rango}. Ya tenían: {ya_tenian}."
        ),
    }
    if task_id:
        update_task(
            task_id,
            status="done",
            processed=total,
            nuevos=actualizados,
            duplicados=ya_tenian,
            errores=no_matcheados + fuera_rango,
            message=resultado["mensaje"],
            result=resultado,
        )
    logger.info("backfill_coordenadas: %s", resultado["mensaje"])
    return resultado


# ── Helper para integrar en parser de ingesta diaria de envíos ──────────────
def extraer_coords_de_fila(fila_dict: dict) -> tuple[Optional[float], Optional[float]]:
    """Busca columnas tipo 'lat'/'lon'/'latitud'/'longitud' en un dict de fila
    de la ingesta CSV y devuelve (lat, lon) parseadas y validadas. Si no son
    válidas devuelve (None, None) sin propagar el error: la ingesta sigue.
    """
    if not isinstance(fila_dict, dict):
        return None, None
    keys = {k.lower().strip(): k for k in fila_dict.keys() if isinstance(k, str)}

    def _pick(*cands):
        for c in cands:
            if c in keys:
                return fila_dict.get(keys[c])
        return None

    raw_lat = _pick("lat", "latitud", "latitude")
    raw_lon = _pick("lon", "lng", "long", "longitud", "longitude")
    lat = parse_coord(raw_lat)
    lon = parse_coord(raw_lon)
    if not coords_validas(lat, lon):
        return None, None
    return lat, lon
