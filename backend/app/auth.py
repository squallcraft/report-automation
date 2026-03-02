from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import AdminUser, Seller, Driver, RolEnum

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


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
        return {"rol": effective_rol, "id": user.id, "nombre": user.nombre or user.username}
    elif rol == RolEnum.SELLER:
        seller = db.query(Seller).filter(Seller.id == uid).first()
        if not seller:
            raise HTTPException(status_code=401, detail="Seller no encontrado")
        if not seller.activo:
            raise HTTPException(status_code=401, detail="Cuenta desactivada")
        return {"rol": RolEnum.SELLER, "id": seller.id, "nombre": seller.nombre}
    elif rol == RolEnum.DRIVER:
        driver = db.query(Driver).filter(Driver.id == uid).first()
        if not driver:
            raise HTTPException(status_code=401, detail="Driver no encontrado")
        if not driver.activo:
            raise HTTPException(status_code=401, detail="Cuenta desactivada")
        return {"rol": RolEnum.DRIVER, "id": driver.id, "nombre": driver.nombre}

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
