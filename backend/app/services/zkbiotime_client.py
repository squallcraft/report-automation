"""
Cliente HTTP para la API REST de ZKBioTime.

Importante (cumplimiento legal en Chile):
  Este cliente JAMÁS se conecta directamente al reloj físico (SpeedFace-V5L u
  otro). Únicamente consume la API REST de ZKBioTime, que es el software
  CERTIFICADO por la Dirección del Trabajo. Las marcas son enviadas por el
  reloj a ZKBioTime vía protocolo Push, y nosotros solo consultamos la base
  oficial. De lo contrario las marcas no tienen validez probatoria.

Diseño:
  * Auth: ZKBioTime expone `POST /jwt-api-token-auth/` para obtener un JWT
    a partir de username/password. El token se persiste en
    `ConfiguracionAsistencia.zkbio_api_token` con su `zkbio_token_expira_at`.
  * Listado de marcas: `GET /iclock/api/transactions/` con `start_time` y
    `end_time` (formato `YYYY-MM-DD HH:MM:SS`) y paginación por `page`/`page_size`.
  * Listado de empleados: `GET /personnel/api/employees/`.

  La API responde en formato `{"count": N, "next": "...", "previous": "...",
  "data": [...]}`. Iteramos hasta agotar `next`.

  Si la versión instalada usa otro endpoint (algunos despliegues usan
  `/api/v2/`), se puede sobreescribir vía `ConfiguracionAsistencia.zkbio_version`
  + un mapper. Para esta primera fase el mapper soporta el esquema "estándar"
  de ZKBioTime 7.x/8.x.

Errores:
  Cualquier excepción HTTP/red levanta `ZKBioTimeError` con detalle.
  Los métodos sincronos están pensados para ejecutarse desde tareas FastAPI
  (no usamos `httpx.AsyncClient` para no obligar a que TODOS los handlers
  sean async).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Iterable, Iterator, Optional

import httpx

logger = logging.getLogger(__name__)


class ZKBioTimeError(RuntimeError):
    """Cualquier error al hablar con ZKBioTime."""


@dataclass
class ZKBioCredentials:
    base_url: str
    username: Optional[str] = None
    password: Optional[str] = None
    token: Optional[str] = None
    timeout: float = 20.0


# Mapeo punch_state (numérico que devuelve ZKBioTime) -> nuestro TipoMarcaEnum
_PUNCH_STATE_MAP = {
    "0": "ENTRADA",
    "1": "SALIDA",
    "2": "SALIDA_COLACION",
    "3": "ENTRADA_COLACION",
    "4": "SALIDA_HE",
    "5": "ENTRADA_HE",
}


def normalizar_punch_state(raw: Optional[str | int]) -> str:
    if raw is None:
        return "DESCONOCIDO"
    key = str(raw).strip()
    return _PUNCH_STATE_MAP.get(key, "DESCONOCIDO")


class ZKBioTimeClient:
    """
    Wrapper sincrónico sobre la REST API de ZKBioTime.

    Uso:
        client = ZKBioTimeClient(creds)
        client.ensure_token()                 # obtiene/refresca JWT si hace falta
        empleados = list(client.iter_employees())
        marcas = list(client.iter_transactions(start, end))
    """

    AUTH_PATH = "/jwt-api-token-auth/"
    TX_PATH = "/iclock/api/transactions/"
    EMP_PATH = "/personnel/api/employees/"

    def __init__(self, creds: ZKBioCredentials):
        if not creds.base_url:
            raise ZKBioTimeError("Falta zkbio_base_url en la configuración")
        self.creds = creds
        # Normalizamos: quitamos trailing slash
        self.base_url = creds.base_url.rstrip("/")
        self._client: Optional[httpx.Client] = None

    # ── Lifecycle ───────────────────────────────────────────────────────────
    def __enter__(self):
        self._client = httpx.Client(
            base_url=self.base_url,
            timeout=self.creds.timeout,
            headers={"Accept": "application/json"},
        )
        return self

    def __exit__(self, exc_type, exc, tb):
        if self._client:
            self._client.close()
            self._client = None

    @property
    def client(self) -> httpx.Client:
        if self._client is None:
            # Permite usarlo sin context manager
            self._client = httpx.Client(
                base_url=self.base_url,
                timeout=self.creds.timeout,
                headers={"Accept": "application/json"},
            )
        return self._client

    def close(self):
        if self._client:
            self._client.close()
            self._client = None

    # ── Auth ────────────────────────────────────────────────────────────────
    def _auth_headers(self) -> dict:
        if not self.creds.token:
            raise ZKBioTimeError("Sin token; llama a ensure_token() primero")
        return {"Authorization": f"JWT {self.creds.token}"}

    def login(self) -> str:
        """Devuelve un JWT freshly minted. No persiste; eso es responsabilidad
        del caller (típicamente, el endpoint de configuración)."""
        if not (self.creds.username and self.creds.password):
            raise ZKBioTimeError("Faltan credenciales (username/password) para login en ZKBioTime")
        try:
            r = self.client.post(self.AUTH_PATH, json={
                "username": self.creds.username,
                "password": self.creds.password,
            })
            r.raise_for_status()
        except httpx.HTTPError as exc:
            raise ZKBioTimeError(f"Error autenticando con ZKBioTime: {exc}") from exc

        data = r.json()
        token = data.get("token") or data.get("access")
        if not token:
            raise ZKBioTimeError(f"ZKBioTime no devolvió token: {data}")
        self.creds.token = token
        return token

    def ensure_token(self) -> str:
        if self.creds.token:
            return self.creds.token
        return self.login()

    # ── Genérico paginado ───────────────────────────────────────────────────
    def _paginate(self, path: str, params: dict, page_size: int = 200) -> Iterator[dict]:
        params = dict(params or {})
        params.setdefault("page_size", page_size)
        url: Optional[str] = path
        # Algunos despliegues devuelven la URL absoluta en `next`; soportamos ambos.
        first = True
        while url:
            try:
                if first:
                    r = self.client.get(url, params=params, headers=self._auth_headers())
                else:
                    r = self.client.get(url, headers=self._auth_headers())
                r.raise_for_status()
            except httpx.HTTPError as exc:
                raise ZKBioTimeError(f"Error en GET {url}: {exc}") from exc
            payload = r.json()
            data = payload.get("data") or payload.get("results") or []
            for item in data:
                yield item
            url = payload.get("next")
            first = False
            params = {}  # los demás params ya van en `next`

    # ── Endpoints concretos ─────────────────────────────────────────────────
    def iter_employees(self) -> Iterator[dict]:
        """Itera todos los empleados activos en ZKBioTime."""
        self.ensure_token()
        yield from self._paginate(self.EMP_PATH, params={})

    def iter_transactions(
        self,
        start: datetime,
        end: datetime,
        emp_code: Optional[str] = None,
        page_size: int = 500,
    ) -> Iterator[dict]:
        """
        Itera marcas (transacciones) en el rango [start, end] cerrado.
        Si `emp_code` viene, filtra por ese empleado.
        """
        self.ensure_token()
        params = {
            "start_time": start.strftime("%Y-%m-%d %H:%M:%S"),
            "end_time": end.strftime("%Y-%m-%d %H:%M:%S"),
        }
        if emp_code:
            params["emp_code"] = emp_code
        yield from self._paginate(self.TX_PATH, params=params, page_size=page_size)


# ── Helpers de mapeo: ZKBio → modelo nuestro ────────────────────────────────
def parse_timestamp_zkbio(raw: Optional[str]) -> Optional[datetime]:
    """ZKBio devuelve `'2026-04-15 08:32:11'` (sin TZ, hora local del reloj)."""
    if not raw:
        return None
    # Tolera variantes: ISO con T, con offset, etc.
    s = str(raw).replace("T", " ").strip()
    fmts = ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M")
    for fmt in fmts:
        try:
            return datetime.strptime(s[:19] if "." not in s else s, fmt)
        except ValueError:
            continue
    return None


def extraer_campos_transaccion(tx: dict) -> dict:
    """
    Convierte un dict crudo de la API en un dict con las keys de MarcaAsistencia.
    Tolera variantes de naming entre versiones de ZKBioTime.
    """
    ts = parse_timestamp_zkbio(
        tx.get("punch_time") or tx.get("punch_time_local") or tx.get("att_time") or tx.get("event_time")
    )
    return {
        "zkbio_transaction_id": str(tx.get("id") or tx.get("transaction_id") or tx.get("att_id") or ""),
        "zkbio_employee_id": str(tx.get("emp") or tx.get("employee_id") or tx.get("emp_id") or ""),
        "zkbio_employee_codigo": str(tx.get("emp_code") or tx.get("personnel_code") or "") or None,
        "dispositivo_sn": str(tx.get("terminal_sn") or tx.get("device_sn") or "") or None,
        "dispositivo_alias": str(tx.get("terminal_alias") or tx.get("device_alias") or "") or None,
        "terminal_id": str(tx.get("terminal_id") or "") or None,
        "timestamp": ts,
        "fecha": ts.date() if ts else None,
        "punch_state_raw": str(tx.get("punch_state") if tx.get("punch_state") is not None else ""),
        "tipo": normalizar_punch_state(tx.get("punch_state")),
        "verify_type": str(tx.get("verify_type") or "") or None,
        "work_code": str(tx.get("work_code") or "") or None,
        "area": str(tx.get("area_alias") or tx.get("area_name") or "") or None,
        "payload_raw": tx,
    }


def extraer_campos_empleado(emp: dict) -> dict:
    """Normaliza un empleado de ZKBio para mostrarlo en la UI de vinculación."""
    return {
        "zkbio_employee_id": str(emp.get("id") or emp.get("employee_id") or ""),
        "zkbio_employee_codigo": str(emp.get("emp_code") or emp.get("personnel_code") or "") or None,
        "nombre": " ".join(filter(None, [
            str(emp.get("first_name") or "").strip(),
            str(emp.get("last_name") or "").strip(),
        ])) or str(emp.get("nickname") or emp.get("name") or "").strip() or None,
        "departamento": str(emp.get("department_name") or emp.get("dept_name") or "") or None,
        "activo": bool(emp.get("active", True)),
    }
