"""
Backfill de fecha_ruta a partir de un archivo Excel/CSV con columnas:
  - Tracking ID  (o tracking_id)
  - Ruta Fecha   (o fecha_ruta, formato DD-MM-YYYY o YYYY-MM-DD)

Actualiza envios.fecha_ruta y envios.ruta_id (si viene columna Ruta ID).
El proceso hace UPDATE masivo en lotes y reporta progreso vía task_progress.
"""
from datetime import date
from typing import Optional
import pandas as pd
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.services.task_progress import update_task


def _normalizar_col(cols: list[str], candidatos: list[str]) -> Optional[str]:
    low = {c.lower().strip(): c for c in cols}
    for cand in candidatos:
        if cand.lower() in low:
            return low[cand.lower()]
    return None


def _parse_date(value) -> Optional[date]:
    if value is None:
        return None
    if isinstance(value, date):
        return value
    try:
        return pd.to_datetime(str(value).strip(), dayfirst=True).date()
    except Exception:
        return None


BATCH_SIZE = 500


def backfill_fecha_ruta(
    db: Session,
    filepath: str,
    task_id: Optional[str] = None,
) -> dict:
    """
    Lee el archivo, parsea pares (tracking_id, fecha_ruta) y actualiza
    envios.fecha_ruta en lotes. También actualiza ruta_id si está presente.

    Retorna un dict con estadísticas: total_filas, pares_validos, actualizados, sin_match.
    """
    def _prog(procesados, total, msg=""):
        if task_id:
            update_task(task_id, procesados=procesados, total=total, mensaje=msg)

    try:
        if filepath.endswith(".csv"):
            df = pd.read_csv(filepath, dtype=str)
        else:
            df = pd.read_excel(filepath, dtype=str)
    except Exception as e:
        raise ValueError(f"No se pudo leer el archivo: {e}")

    cols = list(df.columns)
    col_tracking = _normalizar_col(cols, ["Tracking ID", "tracking_id", "TrackingID", "Tracking"])
    col_fecha = _normalizar_col(cols, ["Ruta Fecha", "fecha_ruta", "RutaFecha", "Fecha Ruta"])
    col_ruta_id = _normalizar_col(cols, ["Ruta ID", "ruta_id", "RutaID"])

    if not col_tracking:
        raise ValueError(f"No se encontró columna de Tracking ID. Columnas: {cols}")
    if not col_fecha:
        raise ValueError(f"No se encontró columna de Ruta Fecha. Columnas: {cols}")

    df = df.dropna(subset=[col_tracking])
    total = len(df)
    _prog(0, total, "Iniciando backfill de fecha_ruta…")

    actualizados = 0
    procesados = 0
    rows = df.to_dict("records")

    for i in range(0, len(rows), BATCH_SIZE):
        lote = rows[i: i + BATCH_SIZE]
        pairs = []
        for r in lote:
            tracking = str(r[col_tracking]).strip()
            fecha = _parse_date(r.get(col_fecha))
            if not tracking or fecha is None:
                continue
            ruta_id_val = None
            if col_ruta_id:
                try:
                    raw_rid = r.get(col_ruta_id)
                    if raw_rid and str(raw_rid).strip() not in ("", "nan", "None"):
                        ruta_id_val = int(float(str(raw_rid).strip()))
                except Exception:
                    pass
            pairs.append((tracking, str(fecha), ruta_id_val))

        if pairs:
            if col_ruta_id:
                values_sql = ", ".join(
                    f"('{t}', '{f}'::DATE, {rid if rid is not None else 'NULL'})"
                    for t, f, rid in pairs
                )
                sql = text(f"""
                    UPDATE envios AS e
                    SET
                        fecha_ruta = v.fr,
                        ruta_id    = COALESCE(v.rid, e.ruta_id)
                    FROM (VALUES {values_sql}) AS v(tid, fr, rid)
                    WHERE LOWER(e.tracking_id) = LOWER(v.tid)
                      AND e.fecha_ruta IS NULL
                """)
            else:
                values_sql = ", ".join(
                    f"('{t}', '{f}'::DATE)" for t, f, _ in pairs
                )
                sql = text(f"""
                    UPDATE envios AS e
                    SET fecha_ruta = v.fr
                    FROM (VALUES {values_sql}) AS v(tid, fr)
                    WHERE LOWER(e.tracking_id) = LOWER(v.tid)
                      AND e.fecha_ruta IS NULL
                """)
            result = db.execute(sql)
            actualizados += result.rowcount

        procesados += len(lote)
        _prog(procesados, total, f"Procesados {procesados}/{total}…")

        if procesados % (BATCH_SIZE * 10) == 0:
            db.commit()

    db.commit()

    pares_validos = sum(
        1 for r in rows
        if str(r.get(col_tracking, "")).strip() and _parse_date(r.get(col_fecha)) is not None
    )
    sin_match = max(0, pares_validos - actualizados)

    stats = {
        "total_filas": total,
        "pares_validos": pares_validos,
        "actualizados": actualizados,
        "sin_match": sin_match,
    }
    _prog(total, total, f"Completado: {actualizados} actualizados, {sin_match} sin match")
    return stats
