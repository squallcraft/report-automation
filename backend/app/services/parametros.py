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


def _fetch_uf_utm_historico(anio: int, mes: int) -> dict[str, float | int] | None:
    """
    Consulta mindicador.cl para obtener UF/UTM de un mes/año específico.
    Usa los endpoints históricos: /api/uf/{YYYY} y /api/utm/{YYYY}.
    Retorna None si la API no responde o no tiene datos para ese período.
    """
    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            r_uf  = client.get(f"{MINDICADOR_BASE}/uf/{anio}")
            r_utm = client.get(f"{MINDICADOR_BASE}/utm/{anio}")
            r_uf.raise_for_status()
            r_utm.raise_for_status()

            # mindicador devuelve lista de {fecha, valor} en serie
            uf_series  = r_uf.json().get("serie", [])
            utm_series = r_utm.json().get("serie", [])

            # Tomar el valor del mes solicitado (o el más cercano anterior)
            target_mes = f"{anio}-{mes:02d}"
            uf_val = None
            for entry in uf_series:
                # fecha viene como "YYYY-MM-DDTHH:MM:SS.000Z"
                if entry.get("fecha", "").startswith(target_mes):
                    uf_val = float(entry["valor"])
                    break
            # Si no hay entrada exacta para ese mes, tomar el primero disponible del año
            if uf_val is None and uf_series:
                uf_val = float(uf_series[0]["valor"])

            utm_val = None
            for entry in utm_series:
                if entry.get("fecha", "").startswith(target_mes):
                    utm_val = int(entry["valor"])
                    break
            if utm_val is None and utm_series:
                utm_val = int(utm_series[0]["valor"])

            if uf_val and utm_val:
                logger.info("UF/UTM histórico %d-%02d obtenido: UF %.2f UTM %d", anio, mes, uf_val, utm_val)
                return {"uf": uf_val, "utm": utm_val}
            return None
    except Exception as exc:
        logger.warning("mindicador.cl histórico no disponible para %d-%02d: %s", anio, mes, exc)
        return None


def obtener_uf_fin_de_mes(anio: int, mes: int) -> float:
    """
    Retorna el ÚLTIMO valor de UF publicado para el mes dado.

    - Mes cerrado (pasado): busca en la serie anual de mindicador el último día
      disponible dentro de ese mes (ordenando por fecha descendente).
    - Mes en curso: retorna el valor vigente de hoy (el más reciente publicado),
      ya que el mes aún no ha terminado.
    - Fallback: constante FALLBACK["uf"] si la API no responde.

    No persiste en DB (valor puntual para cobros).
    """
    hoy = date.today()
    target_prefix = f"{anio}-{mes:02d}"

    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            if (anio, mes) >= (hoy.year, hoy.month):
                # Mes en curso o futuro → valor vigente (último publicado)
                r = client.get(f"{MINDICADOR_BASE}/uf")
                r.raise_for_status()
                data = r.json()
                valor = float(data["uf"]["valor"])
                logger.info("UF fin-de-mes (mes en curso) %d-%02d: %.2f", anio, mes, valor)
                return valor
            else:
                # Mes cerrado → serie anual, tomar el último día del mes
                r = client.get(f"{MINDICADOR_BASE}/uf/{anio}")
                r.raise_for_status()
                serie = r.json().get("serie", [])
                # Filtrar solo entradas de este mes y ordenar por fecha descendente
                del_mes = sorted(
                    [e for e in serie if e.get("fecha", "").startswith(target_prefix)],
                    key=lambda e: e["fecha"],
                    reverse=True,
                )
                if del_mes:
                    valor = float(del_mes[0]["valor"])
                    logger.info("UF último día del mes %d-%02d: %.2f", anio, mes, valor)
                    return valor
    except Exception as exc:
        logger.warning("No se pudo obtener UF fin-de-mes %d-%02d: %s", anio, mes, exc)

    logger.warning("UF fin-de-mes: usando fallback hardcoded %.2f", FALLBACK["uf"])
    return FALLBACK["uf"]


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
      1. DB (caché) — si ya fue consultado antes, usar ese valor inmediatamente
      2. API mindicador.cl — para el mes actual usa el endpoint general;
         para meses históricos usa el endpoint /api/{indicador}/{año}
      3. Fallback hardcoded (último recurso)
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

    imm = _imm_para_anio(anio)
    hoy = date.today()

    if (anio, mes) >= (hoy.year, hoy.month):
        # Mes actual o futuro → endpoint general (valor vigente)
        datos = _fetch_uf_utm()
        if datos:
            return _upsert_y_retornar(db, anio, mes, datos["uf"], datos["utm"], imm, "mindicador.cl")
    else:
        # Mes histórico → endpoint histórico de mindicador.cl
        datos = _fetch_uf_utm_historico(anio, mes)
        if datos:
            return _upsert_y_retornar(db, anio, mes, datos["uf"], datos["utm"], imm, "mindicador.cl/historico")

    # Sin datos históricos en DB ni API → fallback
    logger.warning("Sin datos para %d-%02d, usando fallback hardcoded", anio, mes)
    return {**FALLBACK, "imm": imm, "fuente": "fallback"}


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
