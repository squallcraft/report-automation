"""
Servicio de parámetros legales mensuales.

Fuentes:
  UF  → mindicador.cl/api/uf  (publica el BCCh)
  UTM → mindicador.cl/api/utm (publica el SII)
  IMM → tabla interna (solo cambia con ley, 1 vez al año)

Los valores se cachean en la tabla `parametros_mensuales`.
Si la API externa no responde, se usa el último valor en DB
o las constantes hardcoded como último fallback.
"""
from __future__ import annotations

import logging
from datetime import date, datetime

import httpx
from sqlalchemy.orm import Session

from app.models import ParametrosMensuales

logger = logging.getLogger(__name__)

# ── Fallbacks hardcoded (actualizados manualmente si falla todo) ──────────────
FALLBACK = {
    "uf":  39_842.0,
    "utm": 69_889,
    "imm": 539_000,
}

MINDICADOR_BASE = "https://mindicador.cl/api"
TIMEOUT = 8.0  # segundos


def _fetch_uf_utm() -> dict[str, float | int] | None:
    """
    Consulta mindicador.cl y retorna {'uf': float, 'utm': int}.
    Retorna None si la API no responde.
    """
    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            r_all = client.get(f"{MINDICADOR_BASE}")
            r_all.raise_for_status()
            data = r_all.json()
            uf  = float(data["uf"]["valor"])
            utm = int(data["utm"]["valor"])
            return {"uf": uf, "utm": utm}
    except Exception as exc:
        logger.warning("mindicador.cl no disponible: %s", exc)
        return None


def _imm_para_anio(anio: int) -> int:
    """
    IMM histórico por año. Solo cambia por ley (normalmente en enero).
    Actualizar cuando el Ministerio del Trabajo promulgue el nuevo valor.
    """
    tabla_imm = {
        2024: 500_000,
        2025: 520_000,
        2026: 539_000,
    }
    return tabla_imm.get(anio, 539_000)


def obtener_parametros(db: Session, anio: int, mes: int) -> dict:
    """
    Retorna los parámetros para el año/mes dado.
    Orden de prioridad:
      1. DB (caché)
      2. API mindicador.cl (si es el mes actual)
      3. Fallback hardcoded
    """
    registro = db.query(ParametrosMensuales).filter_by(anio=anio, mes=mes).first()
    if registro:
        return {
            "uf":  float(registro.uf),
            "utm": registro.utm,
            "imm": registro.imm,
            "fuente": registro.fuente,
            "updated_at": registro.updated_at.isoformat() if registro.updated_at else None,
        }

    # Solo intentar API para el mes/año actual o futuro
    hoy = date.today()
    if (anio, mes) >= (hoy.year, hoy.month):
        datos = _fetch_uf_utm()
        if datos:
            imm = _imm_para_anio(anio)
            return _upsert_y_retornar(db, anio, mes, datos["uf"], datos["utm"], imm, "mindicador.cl")

    # Sin datos históricos en DB ni API → fallback
    logger.warning("Sin datos para %d-%02d, usando fallback hardcoded", anio, mes)
    return {**FALLBACK, "imm": _imm_para_anio(anio), "fuente": "fallback"}


def actualizar_mes_actual(db: Session) -> dict:
    """
    Fuerza la actualización del mes actual desde mindicador.cl.
    Se llama en startup y desde el endpoint de admin.
    """
    hoy = date.today()
    datos = _fetch_uf_utm()
    if not datos:
        logger.error("No se pudo actualizar parámetros desde mindicador.cl")
        existing = obtener_parametros(db, hoy.year, hoy.month)
        return existing

    imm = _imm_para_anio(hoy.year)
    return _upsert_y_retornar(db, hoy.year, hoy.month, datos["uf"], datos["utm"], imm, "mindicador.cl")


def _upsert_y_retornar(
    db: Session,
    anio: int, mes: int,
    uf: float, utm: int, imm: int,
    fuente: str,
) -> dict:
    registro = db.query(ParametrosMensuales).filter_by(anio=anio, mes=mes).first()
    if registro:
        registro.uf     = uf
        registro.utm    = utm
        registro.imm    = imm
        registro.fuente = fuente
        registro.updated_at = datetime.utcnow()
    else:
        registro = ParametrosMensuales(
            anio=anio, mes=mes, uf=uf, utm=utm, imm=imm, fuente=fuente
        )
        db.add(registro)
    db.commit()
    db.refresh(registro)
    logger.info("Parámetros %d-%02d actualizados: UF %.2f UTM %d IMM %d [%s]",
                anio, mes, uf, utm, imm, fuente)
    return {
        "uf": float(registro.uf),
        "utm": registro.utm,
        "imm": registro.imm,
        "fuente": registro.fuente,
        "updated_at": registro.updated_at.isoformat() if registro.updated_at else None,
    }
