"""
Módulo unificado de homologación de nombres de conductores y sellers.

Sustituye la lógica duplicada entre:
  - ingesta.homologar_nombre
  - rutas_entregas.build_driver_index + _resolver_driver_local

Estrategias de matching (en orden de confianza):
  1. Exacto case-insensitive
  2. Aliases configurados (JSON)
  3. Prefijo: nombre local (≥2 palabras) es prefijo del nombre externo
  4. Palabras-clave: TODAS las palabras del nombre local (≥2 palabras, ≥3 chars)
     aparecen en el nombre externo (captura "Constanza Galaz" en "Maritza Constanza Galaz Aguilera")
"""
import logging
import os
import json
import time
from typing import Optional, Dict, List, Tuple

logger = logging.getLogger(__name__)

_DEBUG_LOG = os.path.join(os.path.dirname(__file__), "..", "..", ".cursor", "debug-cbef42.log")


def _debug_log(msg: str, data: dict, hypothesis: str = "") -> None:
    try:
        entry = {
            "sessionId": "cbef42",
            "timestamp": int(time.time() * 1000),
            "location": "homologacion.py",
            "message": msg,
            "hypothesisId": hypothesis,
            "data": data,
        }
        with open(_DEBUG_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass


def homologar_nombre(
    nombre_raw: str,
    entidades: list,
    cache: Dict[str, int],
) -> Optional[int]:
    """
    Mapea un nombre crudo a un id de entidad local (Driver o Seller).
    Versión de ingesta (pasa lista de entidades ya cargadas).
    """
    if not nombre_raw:
        return None
    nombre_clean = nombre_raw.strip()
    if nombre_clean in cache:
        return cache[nombre_clean]

    result = _match_nombre(nombre_clean, [(e.nombre, e.id, getattr(e, "aliases", None) or []) for e in entidades])
    if result is not None:
        cache[nombre_clean] = result
    return result


def _match_nombre(
    name_low_input: str,
    entries: List[Tuple[str, int, list]],
) -> Optional[int]:
    """
    Lógica de matching central usada por ambos flujos.

    `entries`: lista de (nombre_local, id, aliases_list)
    """
    name_low = name_low_input.strip().lower()

    # 1. Exacto
    for nombre, eid, aliases in entries:
        if nombre.lower() == name_low:
            return eid

    # 2. Aliases
    for nombre, eid, aliases in entries:
        for alias in aliases:
            if alias.lower() == name_low:
                return eid

    # 3. Prefijo (nombre local ≥2 palabras es prefijo del nombre externo)
    for nombre, eid, aliases in entries:
        nl = nombre.lower()
        palabras = nl.split()
        if len(palabras) >= 2:
            if name_low.startswith(nl + " ") or name_low == nl:
                return eid

    # 4. Palabras-clave: TODAS las palabras del nombre local (≥2 palabras, ≥3 chars)
    #    deben aparecer como palabras en el nombre externo.
    #    Captura "Constanza Galaz" → "Maritza Constanza Galaz Aguilera"
    external_words = set(name_low.split())
    for nombre, eid, aliases in entries:
        nl = nombre.lower()
        local_words = [w for w in nl.split() if len(w) >= 3]
        if len(local_words) >= 2 and all(w in external_words for w in local_words):
            return eid

    return None


# ── Índice en memoria para el flujo de rutas (cron, batch) ───────────────────

_driver_index: Optional[dict] = None


def invalidar_indice_drivers() -> None:
    global _driver_index
    _driver_index = None


def build_driver_index(db) -> dict:
    global _driver_index
    from app.models import Driver

    drivers = db.query(Driver).filter(Driver.activo == True).all()
    exact: Dict[str, int] = {}
    alias: Dict[str, int] = {}
    prefix: List[Tuple[str, int]] = []
    keywords: List[Tuple[List[str], int]] = []

    for d in drivers:
        nl = d.nombre.lower()
        exact[nl] = d.id
        for a in (d.aliases or []):
            alias[a.lower()] = d.id
        palabras = nl.split()
        if len(palabras) >= 2:
            prefix.append((nl, d.id))
        kw = [w for w in palabras if len(w) >= 3]
        if len(kw) >= 2:
            keywords.append((kw, d.id))

    _driver_index = {"exact": exact, "alias": alias, "prefix": prefix, "keywords": keywords}
    return _driver_index


def resolver_driver(
    db,
    driver_name: Optional[str],
    driver_externo_id: Optional[int] = None,
) -> Optional[int]:
    """
    Mapea nombre del courier → driver_id local.
    Usa el índice en memoria (construído una vez por proceso).
    Para flujo de cron / batch.
    """
    if not driver_name:
        return None
    name_low = driver_name.strip().lower()
    if not name_low:
        return None

    global _driver_index
    if _driver_index is None:
        build_driver_index(db)

    idx = _driver_index

    # 1. Exacto
    if name_low in idx["exact"]:
        _debug_log("driver resuelto exacto", {"name": driver_name, "driver_id": idx["exact"][name_low]}, "H2")
        return idx["exact"][name_low]

    # 2. Alias
    if name_low in idx["alias"]:
        _debug_log("driver resuelto alias", {"name": driver_name, "driver_id": idx["alias"][name_low]}, "H2")
        return idx["alias"][name_low]

    # 3. Prefijo
    for nl, did in idx["prefix"]:
        if name_low.startswith(nl + " ") or name_low == nl:
            _debug_log("driver resuelto prefijo", {"name": driver_name, "local": nl, "driver_id": did}, "H2")
            return did

    # 4. Palabras-clave
    external_words = set(name_low.split())
    for kw_list, did in idx["keywords"]:
        if all(w in external_words for w in kw_list):
            _debug_log("driver resuelto keywords", {"name": driver_name, "kw": kw_list, "driver_id": did}, "H2")
            return did

    _debug_log("driver SIN resolver", {"name": driver_name}, "H2")
    return None
