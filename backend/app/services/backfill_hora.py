"""
Backfill de hora_entrega a partir de un archivo Excel/CSV con columnas:
  - Tracking ID  (o tracking_id)
  - Hora Entrega (o hora_entrega, HH:MM o HH:MM:SS)

El proceso hace UPDATE masivo en lotes y reporta progreso vía task_progress.
"""
from datetime import datetime, time as time_type
from typing import Optional
import pandas as pd
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.services.task_progress import update_task


_TIME_FMTS = ("%H:%M:%S", "%H:%M")


def _parse_time(value) -> Optional[time_type]:
    if value is None:
        return None
    if isinstance(value, time_type):
        return value
    if isinstance(value, datetime):
        return value.time()
    s = str(value).strip()
    for fmt in _TIME_FMTS:
        try:
            return datetime.strptime(s, fmt).time()
        except Exception:
            pass
    return None


def _normalizar_col(cols: list[str], candidatos: list[str]) -> Optional[str]:
    """Retorna el primer nombre de columna que coincida (case-insensitive)."""
    low = {c.lower().strip(): c for c in cols}
    for cand in candidatos:
        if cand.lower() in low:
            return low[cand.lower()]
    return None


BATCH_SIZE = 500


def backfill_hora_entrega(
    db: Session,
    filepath: str,
    task_id: Optional[str] = None,
) -> dict:
    """
    Lee el archivo, parsea pares (tracking_id, hora_entrega) y actualiza
    la tabla envios en lotes.

    Retorna un dict con estadísticas: total, actualizados, sin_match, errores.
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

    # Normalizar nombres de columna
    cols = list(df.columns)
    col_tracking = _normalizar_col(cols, ["Tracking ID", "tracking_id", "TrackingID", "Tracking"])
    col_hora = _normalizar_col(cols, ["Hora Entrega", "hora_entrega", "HoraEntrega", "Hora"])

    if not col_tracking:
        raise ValueError(f"No se encontró columna de Tracking ID. Columnas disponibles: {cols}")
    if not col_hora:
        raise ValueError(f"No se encontró columna de Hora Entrega. Columnas disponibles: {cols}")

    df = df[[col_tracking, col_hora]].dropna(subset=[col_tracking])
    total = len(df)
    _prog(0, total, "Iniciando backfill de hora_entrega…")

    actualizados = 0
    sin_match = 0
    errores = 0
    procesados = 0

    rows = df.to_dict("records")
    for i in range(0, len(rows), BATCH_SIZE):
        lote = rows[i: i + BATCH_SIZE]
        pairs = []
        for r in lote:
            tracking = str(r[col_tracking]).strip()
            hora = _parse_time(r.get(col_hora))
            if tracking and hora is not None:
                pairs.append((tracking, hora.strftime("%H:%M:%S")))

        if pairs:
            # Bulk update via VALUES list
            values_sql = ", ".join(
                f"('{t}', '{h}'::TIME)" for t, h in pairs
            )
            sql = text(f"""
                UPDATE envios AS e
                SET hora_entrega = v.hora
                FROM (VALUES {values_sql}) AS v(tid, hora)
                WHERE LOWER(e.tracking_id) = LOWER(v.tid)
                  AND e.hora_entrega IS NULL
            """)
            result = db.execute(sql)
            actualizados += result.rowcount

        procesados += len(lote)
        _prog(procesados, total, f"Procesados {procesados}/{total}…")

        if procesados % (BATCH_SIZE * 10) == 0:
            db.commit()

    db.commit()

    # Contar sin_match = pares válidos enviados - actualizados
    pares_validos = sum(
        1 for r in rows
        if str(r.get(col_tracking, "")).strip() and _parse_time(r.get(col_hora)) is not None
    )
    sin_match = max(0, pares_validos - actualizados)

    stats = {
        "total_filas": total,
        "pares_validos": pares_validos,
        "actualizados": actualizados,
        "sin_match": sin_match,
        "errores": errores,
    }
    _prog(total, total, f"Completado: {actualizados} actualizados, {sin_match} sin match")
    return stats
