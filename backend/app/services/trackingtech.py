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


def fetch_packages_withdrawals(
    api_url: str,
    email: str,
    password: str,
    start_date: str,
    end_date: str,
    per_page: int = 100,
) -> tuple[list[dict], Optional[str]]:
    """
    Descarga las asignaciones de paquetes a rutas (efectividad de entrega).

    Endpoint: GET /withdrawal-orders/getPackagesWithdrawals
    Params: start_date, end_date (formato YYYY-MM-DD).

    Cada registro tiene esta forma:
        {
          "id": 531661,
          "created_at": "20/12/2025 09:01",
          "tracking_id": "LMTCL201225HLSES",
          "seller_code": "25904",
          "status": "delivered",
          "status_name": "Entregado",
          "withdrawal_date": "20/12/2025 14:05",
          "route_id": 22274,
          "route_name": "OSCAR MARTINEZ 20-12",
          "driver_id": 163,
          "driver_name": "Oscar Martínez"
        }

    Devuelve (registros, error). Pagina si la respuesta trae `last_page`/`data`.
    Si la respuesta es una lista plana, la devuelve tal cual.
    """
    if not email or not password:
        return [], "TRACKINGTECH_EMAIL y TRACKINGTECH_PASSWORD no configurados"

    token, login_error = _login(api_url, email, password)
    if login_error:
        return [], login_error

    url = f"{api_url.rstrip('/')}/withdrawal-orders/getPackagesWithdrawals"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }
    base_params = {
        "start_date": start_date,
        "end_date": end_date,
        "per_page": per_page,
    }

    all_records: list[dict] = []
    page = 1

    try:
        with httpx.Client(timeout=60.0) as client:
            while True:
                params = {**base_params, "page": page}
                logger.info(
                    "TrackingTech withdrawals page=%d start=%s end=%s",
                    page, start_date, end_date,
                )
                resp = client.get(url, params=params, headers=headers)

                if resp.status_code != 200:
                    msg = f"HTTP {resp.status_code}: {resp.text[:500]}"
                    logger.warning("TrackingTech withdrawals error: %s", msg)
                    return all_records if all_records else [], msg

                data = resp.json()

                # La respuesta puede ser:
                #  - una lista plana
                #  - un dict con {"meta": {"last_page": N, "total": N}, "data": [...]}
                #  - un dict con {"data": [...], "last_page": N, "total": N}  (legado)
                if isinstance(data, list):
                    all_records.extend(data)
                    break

                if isinstance(data, dict):
                    records = data.get("data") or []
                    all_records.extend(records)
                    # Soportar paginación en "meta" (nuevo) o raíz (legado)
                    meta = data.get("meta") or {}
                    last_page = int(meta.get("last_page") or data.get("last_page") or 1)
                    total = meta.get("total") or data.get("total")
                    logger.info(
                        "TrackingTech withdrawals page %d/%d — %d en pagina, %d acumulado de %s",
                        page, last_page, len(records), len(all_records), total,
                    )
                    if page >= last_page or not records:
                        break
                    page += 1
                else:
                    logger.warning("TrackingTech withdrawals: respuesta inesperada (no list ni dict)")
                    break

    except httpx.TimeoutException:
        logger.warning("TrackingTech withdrawals timeout en página %d", page)
        if all_records:
            return all_records, f"Timeout en página {page}, se obtuvieron {len(all_records)} registros parciales"
        return [], "Timeout al conectar con TrackingTech"
    except Exception as e:
        logger.exception("TrackingTech withdrawals error")
        return [], str(e)

    return all_records, None
