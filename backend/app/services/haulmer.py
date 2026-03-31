"""
Integración con API Haulmer (OpenFactura) para emisión de facturas electrónicas.
Documentación: https://www.openfactura.cl/factura-electronica/api/
"""
import logging
from datetime import date
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)


def _formatear_rut(rut: Optional[str]) -> str:
    """Asegura formato RUT con guión (12345678-9). Retorna '' si el RUT es inválido."""
    if not rut or not str(rut).strip():
        return ""
    r = str(rut).strip().upper().replace(".", "").replace(" ", "")
    if not r:
        return ""
    if "-" not in r and len(r) > 1:
        r = r[:-1] + "-" + r[-1]
    parts = r.split("-")
    if len(parts) != 2 or not parts[0] or not parts[1]:
        logger.warning("RUT con formato inválido (partes): %r → %r", rut, r)
        return ""
    # La parte numérica debe tener al menos 7 dígitos
    if not parts[0].isdigit() or len(parts[0]) < 7:
        logger.warning("RUT con parte numérica inválida: %r → %r", rut, r)
        return ""
    # El dígito verificador debe ser dígito o 'K'
    if parts[1] not in [str(d) for d in range(10)] + ["K"]:
        logger.warning("RUT con dígito verificador inválido: %r → %r", rut, r)
        return ""
    return r


def emitir_factura(
    api_key: str,
    api_url: str,
    emisor_rut: str,
    emisor_razon: str,
    emisor_giro: str,
    emisor_dir: str,
    emisor_cmna: str,
    emisor_acteco: int,
    receptor_rut: str,
    receptor_razon: str,
    receptor_giro: str,
    receptor_dir: str = "",    # DirRecep  — máx 70 caracteres (estándar SII)
    receptor_cmna: str = "",   # CmnaRecep — máx 20 caracteres (estándar SII)
    receptor_email: str = "",  # CorreoRecep — correo DTE del receptor, máx 80 caracteres
    mnt_neto: int = 0,
    iva: int = 0,
    mnt_total: int = 0,
    glosa_detalle: str = "Servicios de transporte y logística",
    idempotency_key: Optional[str] = None,
) -> tuple[Optional[str], Optional[dict], Optional[str]]:
    """
    Emite una factura electrónica vía API Haulmer.

    Returns:
        (folio, respuesta_completa, error)
        Si éxito: folio con el número, respuesta con el JSON, error None.
        Si fallo: folio None, respuesta puede tener body, error con mensaje.
    """
    if not api_key or not api_key.strip():
        return None, None, "HAULMER_API_KEY no configurada"

    receptor_rut_original = receptor_rut
    receptor_rut = _formatear_rut(receptor_rut)
    emisor_rut = _formatear_rut(emisor_rut)
    logger.info("Haulmer emit — emisor_rut=%r receptor_rut=%r receptor_razon=%r mnt_total=%s",
                emisor_rut, receptor_rut, receptor_razon, mnt_total)
    if not receptor_rut:
        return None, None, f"RUT del receptor (seller) inválido o vacío — valor original: {receptor_rut_original!r}"
    if not emisor_rut:
        return None, None, "RUT del emisor no configurado (HAULMER_EMISOR_RUT)"

    fch_emis = date.today().strftime("%Y-%m-%d")

    body: dict[str, Any] = {
        "response": ["XML", "PDF", "FOLIO", "RESOLUCION"],
        "dte": {
            "Encabezado": {
                "IdDoc": {
                    "TipoDTE": 33,
                    "Folio": 0,
                    "FchEmis": fch_emis,
                    "TpoTranCompra": 1,
                    "TpoTranVenta": 1,
                    "FmaPago": 1,
                },
                "Emisor": {
                    "RUTEmisor": emisor_rut,
                    "RznSoc": (emisor_razon or "Emisor").strip()[:100],
                    "GiroEmis": (emisor_giro or "Servicios de transporte").strip()[:80],
                    "Acteco": emisor_acteco,
                    "DirOrigen": (emisor_dir or "Sin dirección").strip()[:70],
                    "CmnaOrigen": (emisor_cmna or "Sin comuna").strip()[:20],
                },
                "Receptor": {
                    "RUTRecep": receptor_rut,
                    "RznSocRecep": (receptor_razon or "Receptor").strip()[:100],
                    "GiroRecep": (receptor_giro or "Sin giro").strip()[:40],
                    "Contacto": "",
                    "CorreoRecep": receptor_email.strip()[:80] if receptor_email and receptor_email.strip() else "",
                    "DirRecep": (receptor_dir or "No especificada").strip()[:70],
                    "CmnaRecep": (receptor_cmna or "No especificada").strip()[:20],
                },
                "Totales": {
                    "MntNeto": mnt_neto,
                    "TasaIVA": "19",
                    "IVA": iva,
                    "MntTotal": mnt_total,
                },
            },
            "Detalle": [
                {
                    "NroLinDet": 1,
                    "NmbItem": glosa_detalle[:80] if glosa_detalle else "Servicios de transporte",
                    "DscItem": glosa_detalle[:1000] if glosa_detalle else "",
                    "QtyItem": 1,
                    "PrcItem": mnt_neto,
                    "MontoItem": mnt_neto,
                }
            ],
        },
    }

    headers = {
        "apikey": api_key.strip(),
        "Content-Type": "application/json",
    }
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key[:64]

    import json as _json
    logger.info("Haulmer payload: %s", _json.dumps(body, ensure_ascii=False)[:2000])

    try:
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(api_url, json=body, headers=headers)
    except httpx.TimeoutException as e:
        logger.warning("Haulmer API timeout: %s", e)
        return None, None, "Timeout al conectar con Haulmer"
    except Exception as e:
        logger.exception("Haulmer API error")
        return None, None, str(e)

    try:
        data = resp.json() if resp.content else {}
    except Exception:
        data = {}

    if resp.status_code != 200 and resp.status_code != 201:
        msg = data.get("message") or data.get("error") or resp.text or f"HTTP {resp.status_code}"
        logger.warning("Haulmer API error %s: %s | body=%s", resp.status_code, msg, resp.text[:500])
        return None, data, msg

    # Respuesta exitosa: puede venir FOLIO en el body (según doc)
    folio = None
    if isinstance(data, dict):
        folio = data.get("FOLIO") or data.get("folio")
        if folio is not None:
            folio = str(folio).strip()
        # Algunas APIs devuelven el folio dentro de un objeto
        if not folio and "documento" in data:
            doc = data["documento"]
            if isinstance(doc, dict):
                folio = doc.get("folio") or doc.get("Folio")
                if folio is not None:
                    folio = str(folio).strip()

    return folio, data, None
