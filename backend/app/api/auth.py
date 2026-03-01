from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AdminUser, Seller, Driver, RolEnum
from app.schemas import LoginRequest, TokenResponse
from app.auth import verify_password, create_access_token, hash_password

router = APIRouter(prefix="/auth", tags=["Autenticación"])


@router.post("/login", response_model=TokenResponse)
def login(data: LoginRequest, db: Session = Depends(get_db)):
    admin = db.query(AdminUser).filter(AdminUser.username == data.username, AdminUser.activo == True).first()
    if admin and verify_password(data.password, admin.password_hash):
        effective_rol = admin.rol if admin.rol else RolEnum.ADMIN.value
        token = create_access_token({"sub": str(admin.id), "rol": effective_rol})
        return TokenResponse(
            access_token=token,
            rol=effective_rol,
            nombre=admin.nombre or admin.username,
        )

    seller = db.query(Seller).filter(Seller.email == data.username, Seller.activo == True).first()
    if seller and seller.password_hash and verify_password(data.password, seller.password_hash):
        token = create_access_token({"sub": str(seller.id), "rol": RolEnum.SELLER})
        return TokenResponse(
            access_token=token,
            rol=RolEnum.SELLER,
            nombre=seller.nombre,
            entidad_id=seller.id,
        )

    driver = db.query(Driver).filter(Driver.email == data.username, Driver.activo == True).first()
    if driver and driver.password_hash and verify_password(data.password, driver.password_hash):
        token = create_access_token({"sub": str(driver.id), "rol": RolEnum.DRIVER})
        return TokenResponse(
            access_token=token,
            rol=RolEnum.DRIVER,
            nombre=driver.nombre,
            entidad_id=driver.id,
        )

    raise HTTPException(status_code=401, detail="Credenciales incorrectas")


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
