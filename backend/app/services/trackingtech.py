"""
Integración con API TrackingTech para obtener escaneos de pickup points.
Flujo: login con email/password → obtener Bearer token → consultar endpoints.
Docs: API TrackingTech v2
"""
import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


def _login(api_url: str, email: str, password: str) -> tuple[Optional[str], Optional[str]]:
    """
    Autentica contra POST /external/login y devuelve el Bearer token.

    Returns:
        (token, error)
    """
    url = f"{api_url.rstrip('/')}/external/login"
    try:
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(url, json={"email": email, "password": password}, headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
            })
    except httpx.TimeoutException:
        return None, "Timeout al conectar con TrackingTech (login)"
    except Exception as e:
        logger.exception("TrackingTech login error")
        return None, str(e)

    if resp.status_code != 200:
        msg = resp.text[:300] if resp.text else f"HTTP {resp.status_code}"
        logger.warning("TrackingTech login failed: %s", msg)
        return None, f"Login fallido: {msg}"

    try:
        data = resp.json()
    except Exception:
        return None, "Respuesta de login no es JSON válido"

    token = data.get("token")
    if not token:
        return None, f"Login no devolvió token. Respuesta: {data}"

    return token, None


def fetch_pickups_by_date(
    api_url: str,
    email: str,
    password: str,
    fecha_inicio: str,
    fecha_fin: str,
    per_page: int = 100,
) -> tuple[list[dict], Optional[str]]:
    """
    Descarga todos los registros de escaneos de pickup de TrackingTech
    para el rango [fecha_inicio, fecha_fin] (formato YYYYMMDD).

    Primero hace login para obtener el token, luego itera todas las páginas.

    Returns:
        (registros, error)
    """
    if not email or not password:
        return [], "TRACKINGTECH_EMAIL y TRACKINGTECH_PASSWORD no configurados"

    token, login_error = _login(api_url, email, password)
    if login_error:
        return [], login_error

    url = f"{api_url.rstrip('/')}/pickups/getPickupsByDate"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }
    params = {
        "fecha_inicio": fecha_inicio,
        "fecha_fin": fecha_fin,
        "per_page": per_page,
    }

    all_records: list[dict] = []
    page = 1

    try:
        with httpx.Client(timeout=60.0) as client:
            while True:
                params["page"] = page
                logger.info(
                    "TrackingTech fetch page=%d fecha_inicio=%s fecha_fin=%s",
                    page, fecha_inicio, fecha_fin,
                )
                resp = client.get(url, params=params, headers=headers)

                if resp.status_code != 200:
                    msg = f"HTTP {resp.status_code}: {resp.text[:500]}"
                    logger.warning("TrackingTech API error: %s", msg)
                    return all_records if all_records else [], msg

                data = resp.json()
                records = data.get("data", [])
                all_records.extend(records)

                last_page = data.get("last_page", 1)
                total = data.get("total", 0)
                logger.info(
                    "TrackingTech page %d/%d — %d registros en página, %d total acumulado de %d",
                    page, last_page, len(records), len(all_records), total,
                )

                if page >= last_page:
                    break
                page += 1

    except httpx.TimeoutException:
        logger.warning("TrackingTech API timeout en página %d", page)
        if all_records:
            return all_records, f"Timeout en página {page}, se obtuvieron {len(all_records)} registros parciales"
        return [], "Timeout al conectar con TrackingTech"
    except Exception as e:
        logger.exception("TrackingTech API error")
        return [], str(e)

    return all_records, None
