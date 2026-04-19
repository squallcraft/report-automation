from datetime import datetime, timedelta, timezone
from typing import Annotated, Callable

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import AdminUser, Seller, Driver, Pickup, Colaborador, Trabajador, RolEnum

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

# ---------------------------------------------------------------------------
# Permisos disponibles por slug — formato  seccion:ver | seccion:editar
# ADMIN siempre tiene todos.  ADMINISTRACION parte con PERMISOS_DEFAULT_ADMINISTRACION
# y puede tener una lista custom guardada en AdminUser.permisos.
# ---------------------------------------------------------------------------
SECCIONES: list[str] = [
    "sellers", "drivers", "pickups", "ingesta", "envios", "retiros",
    "finanzas", "liquidacion", "facturacion", "cpc", "cpp", "ajustes",
    "productos", "comunas", "calendario",
    "consultas", "logs", "asistente",
    "trabajadores", "prestamos", "pagos-trabajadores",
    "colaboradores",
    # ── RRHH granular (cada uno con :ver y :editar) ─────────────────────────
    # editar implica también aprobar/emitir/firmar acciones del módulo
    "rrhh-contratos",       # generar contratos digitales, plantillas, emitir/aprobar
    "rrhh-vacaciones",      # registrar, aprobar, calendario
    "rrhh-licencias",       # cargar licencias, aprobar, recibir notificaciones
    "rrhh-documentacion",   # documentos del trabajador, vigencias
    "rrhh-plantillas",      # editor de plantillas de contrato
    "rrhh-alertas",         # recibe alertas de vencimientos, firmas pendientes
]

_SECCIONES_SET = set(SECCIONES)

PERMISOS_DISPONIBLES: list[str] = [
    f"{s}:{nivel}" for s in SECCIONES for nivel in ("ver", "editar")
]
_PERMISOS_SET = set(PERMISOS_DISPONIBLES)

PERMISOS_DEFAULT_ADMINISTRACION: list[str] = [
    f"{s}:{nivel}"
    for s in [
        "envios", "liquidacion", "productos", "comunas", "ajustes",
        "retiros", "consultas", "facturacion", "cpc", "logs", "calendario",
        "asistente", "sellers", "drivers",
    ]
    for nivel in ("ver", "editar")
]


def resolver_permisos(user: AdminUser) -> list[str]:
    """Retorna la lista efectiva de permisos para un AdminUser."""
    if user.rol == RolEnum.ADMIN.value:
        return PERMISOS_DISPONIBLES[:]
    # ADMINISTRACION: si tiene permisos custom en DB los usa, si no el default
    if user.permisos is not None:
        resultado: list[str] = []
        for p in user.permisos:
            if ":" in p:
                if p in _PERMISOS_SET:
                    resultado.append(p)
            elif p in _SECCIONES_SET:
                resultado.extend(
                    f"{p}:{n}" for n in ("ver", "editar") if f"{p}:{n}" in _PERMISOS_SET
                )
        return resultado
    return PERMISOS_DEFAULT_ADMINISTRACION[:]


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict) -> str:
    settings = get_settings()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode = {**data, "exp": expire}
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> dict:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido")


def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Session = Depends(get_db),
) -> dict:
    payload = decode_token(token)
    rol = payload.get("rol")
    user_id = payload.get("sub")
    if not rol or not user_id:
        raise HTTPException(status_code=401, detail="Token inválido")

    try:
        uid = int(user_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Token inválido")

    if rol in (RolEnum.ADMIN, RolEnum.ADMINISTRACION):
        user = db.query(AdminUser).filter(AdminUser.id == uid).first()
        if not user:
            raise HTTPException(status_code=401, detail="Usuario no encontrado")
        if not user.activo:
            raise HTTPException(status_code=401, detail="Usuario desactivado")
        effective_rol = RolEnum(user.rol) if user.rol else RolEnum.ADMIN
        return {
            "rol": effective_rol,
            "id": user.id,
            "nombre": user.nombre or user.username,
            "permisos": resolver_permisos(user),
        }
    elif rol == RolEnum.SELLER:
        seller = db.query(Seller).filter(Seller.id == uid).first()
        if not seller:
            raise HTTPException(status_code=401, detail="Seller no encontrado")
        if not seller.activo:
            raise HTTPException(status_code=401, detail="Cuenta desactivada")
        return {"rol": RolEnum.SELLER, "id": seller.id, "nombre": seller.nombre, "permisos": []}
    elif rol == RolEnum.DRIVER:
        driver = db.query(Driver).filter(Driver.id == uid).first()
        if not driver:
            raise HTTPException(status_code=401, detail="Driver no encontrado")
        if not driver.activo:
            raise HTTPException(status_code=401, detail="Cuenta desactivada")
        return {"rol": RolEnum.DRIVER, "id": driver.id, "nombre": driver.nombre, "permisos": []}
    elif rol == RolEnum.PICKUP:
        pickup = db.query(Pickup).filter(Pickup.id == uid).first()
        if not pickup:
            raise HTTPException(status_code=401, detail="Pickup no encontrado")
        if not pickup.activo:
            raise HTTPException(status_code=401, detail="Cuenta desactivada")
        return {"rol": RolEnum.PICKUP, "id": pickup.id, "nombre": pickup.nombre, "permisos": []}
    elif rol == RolEnum.COLABORADOR:
        colab = db.query(Colaborador).filter(Colaborador.id == uid).first()
        if not colab:
            raise HTTPException(status_code=401, detail="Colaborador no encontrado")
        if not colab.activo:
            raise HTTPException(status_code=401, detail="Cuenta desactivada")
        return {"rol": RolEnum.COLABORADOR, "id": colab.id, "nombre": colab.nombre, "permisos": []}
    elif rol == RolEnum.TRABAJADOR:
        trabajador = db.query(Trabajador).filter(Trabajador.id == uid).first()
        if not trabajador:
            raise HTTPException(status_code=401, detail="Trabajador no encontrado")
        if not trabajador.activo:
            raise HTTPException(status_code=401, detail="Cuenta desactivada")
        return {"rol": RolEnum.TRABAJADOR, "id": trabajador.id, "nombre": trabajador.nombre, "permisos": []}

    raise HTTPException(status_code=401, detail="Rol no reconocido")


def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    """Only full ADMIN role."""
    if current_user["rol"] != RolEnum.ADMIN:
        raise HTTPException(status_code=403, detail="Acceso solo para administradores")
    return current_user


def require_admin_or_administracion(current_user: dict = Depends(get_current_user)) -> dict:
    """ADMIN or ADMINISTRACION can access (read-only views, downloads, payments, invoicing)."""
    if current_user["rol"] not in (RolEnum.ADMIN, RolEnum.ADMINISTRACION):
        raise HTTPException(status_code=403, detail="Acceso solo para administradores")
    return current_user


def require_seller(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user["rol"] != RolEnum.SELLER:
        raise HTTPException(status_code=403, detail="Acceso solo para sellers")
    return current_user


# Límite de visibilidad para drivers: solo desde semana 4 de febrero 2026 en adelante
DRIVER_CUTOFF_ANIO = 2026
DRIVER_CUTOFF_MES = 2
DRIVER_CUTOFF_SEMANA = 4


def driver_period_allowed(anio: int, mes: int, semana: int) -> bool:
    """True si el período (anio, mes, semana) es visible para rol driver."""
    if anio > DRIVER_CUTOFF_ANIO:
        return True
    if anio < DRIVER_CUTOFF_ANIO:
        return False
    if mes > DRIVER_CUTOFF_MES:
        return True
    if mes < DRIVER_CUTOFF_MES:
        return False
    return semana >= DRIVER_CUTOFF_SEMANA


def require_driver(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user["rol"] != RolEnum.DRIVER:
        raise HTTPException(status_code=403, detail="Acceso solo para drivers")
    return current_user


def require_pickup(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user["rol"] != RolEnum.PICKUP:
        raise HTTPException(status_code=403, detail="Acceso solo para pickups")
    return current_user


def require_colaborador(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user["rol"] != RolEnum.COLABORADOR:
        raise HTTPException(status_code=403, detail="Acceso solo para colaboradores")
    return current_user


def require_trabajador_portal(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user["rol"] != RolEnum.TRABAJADOR:
        raise HTTPException(status_code=403, detail="Acceso solo para trabajadores")
    return current_user


def check_ownership(current_user: dict, entity_id: int) -> None:
    """
    Verifica que el usuario autenticado (seller o driver) solo acceda
    a sus propios datos. Los admins siempre pasan.
    Levanta 403 si hay violación.
    """
    if current_user["rol"] in (RolEnum.ADMIN, RolEnum.ADMINISTRACION):
        return
    if current_user["id"] != entity_id:
        raise HTTPException(status_code=403, detail="No tienes permiso para acceder a estos datos")


def require_permission(slug: str) -> Callable:
    """
    Factory de dependencias. Verifica que el usuario tenga el permiso `slug`.
    ADMIN siempre pasa. ADMINISTRACION necesita el slug en su lista de permisos.
    Uso: current_user=Depends(require_permission("sellers:editar"))
         o bien: dependencies=[Depends(require_permission("ingesta"))]
    """
    def _check(current_user: dict = Depends(get_current_user)) -> dict:
        if current_user["rol"] == RolEnum.ADMIN:
            return current_user
        if slug not in current_user.get("permisos", []):
            raise HTTPException(status_code=403, detail=f"Sin permiso para acceder a esta sección")
        return current_user
    return _check
