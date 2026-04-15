"""
Endpoints de autenticación: login, setup, reset de contraseña.
Rate limit en memoria (sin Redis). AuditLog para eventos de seguridad.
"""
import hashlib
import logging
import secrets
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AdminUser, AuditLog, PasswordResetToken, RolEnum, Seller, Driver, Pickup
from app.schemas import LoginRequest, TokenResponse
from app.auth import verify_password, create_access_token, hash_password
from app.config import get_settings
from app.services.email import send_reset_email
from app.auth import resolver_permisos

logger = logging.getLogger(__name__)

CURRENT_ACUERDO_VERSION = "2.0"

router = APIRouter(prefix="/auth", tags=["Autenticación"])

# ---------------------------------------------------------------------------
# Rate limit en memoria
# ---------------------------------------------------------------------------
_login_attempts: dict[str, list[float]] = defaultdict(list)
_RATE_LIMIT_MAX = 5
_RATE_LIMIT_WINDOW = 60  # segundos


def _check_rate_limit(ip: str) -> None:
    """Levanta 429 si la IP supera 5 intentos en 60 s."""
    now = time.monotonic()
    window = now - _RATE_LIMIT_WINDOW
    attempts = [t for t in _login_attempts[ip] if t > window]
    _login_attempts[ip] = attempts
    if len(attempts) >= _RATE_LIMIT_MAX:
        logger.warning("Rate limit alcanzado para IP %s", ip)
        raise HTTPException(status_code=429, detail="Demasiados intentos. Espera 1 minuto.")
    _login_attempts[ip].append(now)


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


# ---------------------------------------------------------------------------
# AuditLog helper
# ---------------------------------------------------------------------------
def _audit(db: Session, action: str, username: Optional[str], ip: str, detail: Optional[str] = None) -> None:
    try:
        db.add(AuditLog(
            action=action, username=username, ip=ip, detail=detail,
            accion=action, usuario_nombre=username, ip_address=ip,
            entidad="auth", metadata_={"detail": detail} if detail else None,
        ))
        db.commit()
    except Exception as exc:
        logger.error("Error guardando audit log: %s", exc)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class ResetRequestBody(BaseModel):
    email: str


class ResetPasswordBody(BaseModel):
    token: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("La contraseña debe tener al menos 8 caracteres")
        return v


# ---------------------------------------------------------------------------
# Helpers de token
# ---------------------------------------------------------------------------
def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _find_entity_by_email(db: Session, email: str):
    """Busca en Seller y AdminUser (username). Retorna (entity_type, entity, email_field)."""
    seller = db.query(Seller).filter(Seller.email == email, Seller.activo == True).first()
    if seller:
        return "seller", seller

    driver = db.query(Driver).filter(Driver.email == email, Driver.activo == True).first()
    if driver:
        return "driver", driver

    pickup = db.query(Pickup).filter(Pickup.email == email, Pickup.activo == True).first()
    if pickup:
        return "pickup", pickup

    admin = db.query(AdminUser).filter(AdminUser.username == email, AdminUser.activo == True).first()
    if admin:
        return "admin", admin

    return None, None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.post("/login", response_model=TokenResponse)
def login(data: LoginRequest, request: Request, db: Session = Depends(get_db)):
    ip = _client_ip(request)
    _check_rate_limit(ip)

    admin = db.query(AdminUser).filter(AdminUser.username == data.username, AdminUser.activo == True).first()
    if admin and verify_password(data.password, admin.password_hash):
        effective_rol = admin.rol if admin.rol else RolEnum.ADMIN.value
        token = create_access_token({"sub": str(admin.id), "rol": effective_rol})
        _audit(db, "LOGIN_SUCCESS", admin.username, ip)
        return TokenResponse(
            access_token=token,
            rol=effective_rol,
            nombre=admin.nombre or admin.username,
            permisos=resolver_permisos(admin),
        )

    seller = db.query(Seller).filter(Seller.email == data.username, Seller.activo == True).first()
    if seller and seller.password_hash and verify_password(data.password, seller.password_hash):
        token = create_access_token({"sub": str(seller.id), "rol": RolEnum.SELLER})
        _audit(db, "LOGIN_SUCCESS", seller.email, ip)
        return TokenResponse(
            access_token=token,
            rol=RolEnum.SELLER,
            nombre=seller.nombre,
            entidad_id=seller.id,
        )

    driver = db.query(Driver).filter(Driver.email == data.username, Driver.activo == True).first()
    if driver and driver.password_hash and verify_password(data.password, driver.password_hash):
        token = create_access_token({"sub": str(driver.id), "rol": RolEnum.DRIVER})
        _audit(db, "LOGIN_SUCCESS", driver.email, ip)
        acuerdo_ok = bool(
            driver.acuerdo_aceptado and
            driver.acuerdo_version == CURRENT_ACUERDO_VERSION
        )
        return TokenResponse(
            access_token=token,
            rol=RolEnum.DRIVER,
            nombre=driver.nombre,
            entidad_id=driver.id,
            acuerdo_aceptado=acuerdo_ok,
        )

    pickup = db.query(Pickup).filter(Pickup.email == data.username, Pickup.activo == True).first()
    if pickup and pickup.password_hash and verify_password(data.password, pickup.password_hash):
        token = create_access_token({"sub": str(pickup.id), "rol": RolEnum.PICKUP})
        _audit(db, "LOGIN_SUCCESS", pickup.email, ip)
        return TokenResponse(
            access_token=token,
            rol=RolEnum.PICKUP,
            nombre=pickup.nombre,
            entidad_id=pickup.id,
        )

    _audit(db, "LOGIN_FAIL", data.username, ip)
    raise HTTPException(status_code=401, detail="Credenciales incorrectas")


@router.post("/request-password-reset", status_code=200)
def request_password_reset(body: ResetRequestBody, request: Request, db: Session = Depends(get_db)):
    """
    Siempre responde con el mismo mensaje para no filtrar si el email existe.
    Si SMTP no está configurado, loguea la URL en consola (útil en desarrollo).
    """
    ip = _client_ip(request)
    settings = get_settings()

    entity_type, entity = _find_entity_by_email(db, body.email)

    if entity is not None:
        # Invalidar tokens anteriores del mismo usuario
        db.query(PasswordResetToken).filter(
            PasswordResetToken.entity_type == entity_type,
            PasswordResetToken.entity_id == entity.id,
            PasswordResetToken.used == False,
        ).update({"used": True})
        db.flush()

        raw_token = secrets.token_urlsafe(32)
        token_hash = _hash_token(raw_token)
        expires = datetime.now(timezone.utc) + timedelta(hours=1)

        db.add(PasswordResetToken(
            token_hash=token_hash,
            entity_type=entity_type,
            entity_id=entity.id,
            expires_at=expires,
        ))
        db.commit()

        reset_url = f"{settings.FRONTEND_URL}/reset-password?token={raw_token}"
        send_reset_email(body.email, reset_url)
        _audit(db, "RESET_REQUEST", body.email, ip)
        logger.info("Token de reset generado para %s (%s id=%s)", body.email, entity_type, entity.id)

    return {"message": "Si el email existe en el sistema, recibirás un enlace para restablecer tu contraseña."}


@router.post("/reset-password", status_code=200)
def reset_password(body: ResetPasswordBody, request: Request, db: Session = Depends(get_db)):
    ip = _client_ip(request)
    token_hash = _hash_token(body.token)

    record = db.query(PasswordResetToken).filter(
        PasswordResetToken.token_hash == token_hash,
        PasswordResetToken.used == False,
    ).first()

    if not record:
        raise HTTPException(status_code=400, detail="Token inválido o ya utilizado")

    now = datetime.now(timezone.utc)
    expires = record.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if now > expires:
        raise HTTPException(status_code=400, detail="El enlace ha expirado. Solicita uno nuevo.")

    new_hash = hash_password(body.new_password)

    if record.entity_type == "seller":
        entity = db.query(Seller).filter(Seller.id == record.entity_id).first()
    elif record.entity_type == "driver":
        entity = db.query(Driver).filter(Driver.id == record.entity_id).first()
    elif record.entity_type == "pickup":
        entity = db.query(Pickup).filter(Pickup.id == record.entity_id).first()
    else:
        entity = db.query(AdminUser).filter(AdminUser.id == record.entity_id).first()

    if not entity:
        raise HTTPException(status_code=400, detail="Token inválido")

    entity.password_hash = new_hash
    record.used = True
    db.commit()

    username = getattr(entity, "email", None) or getattr(entity, "username", None) or str(entity.id)
    _audit(db, "RESET_SUCCESS", username, ip)
    logger.info("Contraseña restablecida para %s (%s)", username, record.entity_type)

    return {"message": "Contraseña actualizada correctamente. Ya puedes iniciar sesión."}


@router.post("/setup")
def setup_admin(db: Session = Depends(get_db)):
    """Crea el usuario admin inicial si no existe."""
    existing = db.query(AdminUser).first()
    if existing:
        raise HTTPException(status_code=400, detail="Ya existe un usuario administrador")
    admin = AdminUser(
        username="admin",
        password_hash=hash_password("admin123"),
        nombre="Administrador",
        rol=RolEnum.ADMIN.value,
    )
    db.add(admin)
    db.commit()
    return {"message": "Usuario admin creado. Credenciales: admin / admin123. Cambie la contraseña."}
