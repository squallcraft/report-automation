from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import require_admin, hash_password, resolver_permisos, PERMISOS_DISPONIBLES
from app.models import AdminUser, Seller, Driver, RolEnum
from app.services.audit import registrar as audit

router = APIRouter(prefix="/usuarios", tags=["Usuarios"])


class UsuarioCreate(BaseModel):
    username: str
    password: str
    nombre: Optional[str] = None
    rol: str = RolEnum.ADMINISTRACION.value


class UsuarioUpdate(BaseModel):
    username: Optional[str] = None
    nombre: Optional[str] = None
    rol: Optional[str] = None
    password: Optional[str] = None
    activo: Optional[bool] = None


class PermisosUpdate(BaseModel):
    permisos: List[str]


class UsuarioOut(BaseModel):
    id: int
    username: str
    nombre: Optional[str] = None
    rol: str
    activo: bool
    permisos_efectivos: List[str] = []

    model_config = {"from_attributes": True}


def _to_out(user: AdminUser) -> UsuarioOut:
    return UsuarioOut(
        id=user.id,
        username=user.username,
        nombre=user.nombre,
        rol=user.rol,
        activo=user.activo,
        permisos_efectivos=resolver_permisos(user),
    )


@router.get("", response_model=List[UsuarioOut])
def listar_usuarios(db: Session = Depends(get_db), _=Depends(require_admin)):
    users = db.query(AdminUser).order_by(AdminUser.username).all()
    return [_to_out(u) for u in users]


@router.post("", response_model=UsuarioOut, status_code=201)
def crear_usuario(data: UsuarioCreate, request: Request, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    if data.rol not in (RolEnum.ADMIN.value, RolEnum.ADMINISTRACION.value):
        raise HTTPException(status_code=400, detail="Rol debe ser ADMIN o ADMINISTRACION")
    existing = db.query(AdminUser).filter(AdminUser.username == data.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Ya existe un usuario con ese nombre")
    user = AdminUser(
        username=data.username,
        password_hash=hash_password(data.password),
        nombre=data.nombre,
        rol=data.rol,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    audit(db, "crear_usuario", usuario=current_user, request=request,
          entidad="usuario", entidad_id=user.id,
          metadata={"username": user.username, "rol": user.rol, "nombre": user.nombre})
    return _to_out(user)


@router.put("/{user_id}", response_model=UsuarioOut)
def actualizar_usuario(user_id: int, data: UsuarioUpdate, request: Request, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    user = db.get(AdminUser, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    antes = {"username": user.username, "nombre": user.nombre, "rol": user.rol, "activo": user.activo}

    if data.username is not None:
        dup = db.query(AdminUser).filter(AdminUser.username == data.username, AdminUser.id != user_id).first()
        if dup:
            raise HTTPException(status_code=400, detail="Ya existe un usuario con ese nombre")
        user.username = data.username
    if data.nombre is not None:
        user.nombre = data.nombre
    if data.rol is not None:
        if data.rol not in (RolEnum.ADMIN.value, RolEnum.ADMINISTRACION.value):
            raise HTTPException(status_code=400, detail="Rol debe ser ADMIN o ADMINISTRACION")
        user.rol = data.rol
    if data.password:
        user.password_hash = hash_password(data.password)
    if data.activo is not None:
        user.activo = data.activo
    db.commit()
    db.refresh(user)

    despues = {"username": user.username, "nombre": user.nombre, "rol": user.rol, "activo": user.activo}
    cambios = {k: {"antes": antes[k], "despues": despues[k]} for k in antes if antes[k] != despues[k]}
    if data.password:
        cambios["password"] = {"antes": "***", "despues": "***"}
    if cambios:
        audit(db, "editar_usuario", usuario=current_user, request=request,
              entidad="usuario", entidad_id=user_id, cambios=cambios)

    return _to_out(user)


@router.put("/{user_id}/permisos", response_model=UsuarioOut)
def actualizar_permisos(
    user_id: int,
    data: PermisosUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    """Establece la lista de permisos custom para un usuario ADMINISTRACION."""
    user = db.get(AdminUser, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if user.rol == RolEnum.ADMIN.value:
        raise HTTPException(status_code=400, detail="Los usuarios ADMIN siempre tienen acceso total")

    invalidos = [p for p in data.permisos if p not in PERMISOS_DISPONIBLES]
    if invalidos:
        raise HTTPException(status_code=400, detail=f"Permisos inválidos: {', '.join(invalidos)}")

    permisos_antes = list(user.permisos) if user.permisos else []
    user.permisos = data.permisos
    db.commit()
    db.refresh(user)

    audit(db, "editar_permisos", usuario=current_user, request=request,
          entidad="usuario", entidad_id=user_id,
          cambios={"permisos": {"antes": permisos_antes, "despues": data.permisos}})

    return _to_out(user)


@router.delete("/{user_id}/permisos", response_model=UsuarioOut)
def resetear_permisos(
    user_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    """Elimina permisos custom — el usuario vuelve a usar los defaults del rol."""
    user = db.get(AdminUser, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    user.permisos = None
    db.commit()
    db.refresh(user)
    audit(db, "resetear_permisos", usuario=current_user, request=request,
          entidad="usuario", entidad_id=user_id)
    return _to_out(user)


@router.delete("/{user_id}")
def desactivar_usuario(user_id: int, request: Request, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    user = db.get(AdminUser, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if user.id == current_user["id"]:
        raise HTTPException(status_code=400, detail="No puedes desactivarte a ti mismo")
    user.activo = False
    db.commit()
    audit(db, "desactivar_usuario", usuario=current_user, request=request,
          entidad="usuario", entidad_id=user_id,
          metadata={"username": user.username, "nombre": user.nombre})
    return {"message": "Usuario desactivado"}


# ---------------------------------------------------------------------------
# Accesos Portal — Sellers y Drivers
# ---------------------------------------------------------------------------

class AccesoPortalOut(BaseModel):
    id: int
    nombre: str
    email: Optional[str] = None
    tiene_acceso: bool
    activo: bool

    model_config = {"from_attributes": True}


class AccesoPortalUpsert(BaseModel):
    email: str
    password: Optional[str] = None  # requerido solo al crear


@router.get("/accesos/sellers", response_model=List[AccesoPortalOut])
def listar_accesos_sellers(db: Session = Depends(get_db), _=Depends(require_admin)):
    sellers = db.query(Seller).order_by(Seller.nombre).all()
    return [
        AccesoPortalOut(
            id=s.id,
            nombre=s.nombre,
            email=s.email,
            tiene_acceso=bool(s.email and s.password_hash),
            activo=s.activo,
        )
        for s in sellers
    ]


@router.get("/accesos/drivers", response_model=List[AccesoPortalOut])
def listar_accesos_drivers(db: Session = Depends(get_db), _=Depends(require_admin)):
    drivers = db.query(Driver).order_by(Driver.nombre).all()
    return [
        AccesoPortalOut(
            id=d.id,
            nombre=d.nombre,
            email=d.email,
            tiene_acceso=bool(d.email and d.password_hash),
            activo=d.activo,
        )
        for d in drivers
    ]


@router.put("/accesos/sellers/{seller_id}", response_model=AccesoPortalOut)
def upsert_acceso_seller(
    seller_id: int,
    data: AccesoPortalUpsert,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    seller = db.get(Seller, seller_id)
    if not seller:
        raise HTTPException(status_code=404, detail="Seller no encontrado")

    dup = db.query(Seller).filter(Seller.email == data.email, Seller.id != seller_id).first()
    if dup:
        raise HTTPException(status_code=400, detail="Ese email ya está en uso por otro seller")

    seller.email = data.email
    if data.password:
        seller.password_hash = hash_password(data.password)
    elif not seller.password_hash:
        raise HTTPException(status_code=400, detail="La contraseña es obligatoria al crear acceso")

    db.commit()
    db.refresh(seller)

    audit(db, "editar_acceso_seller", usuario=current_user, request=request,
          entidad="seller", entidad_id=seller_id,
          metadata={"nombre": seller.nombre, "email": data.email})

    return AccesoPortalOut(
        id=seller.id,
        nombre=seller.nombre,
        email=seller.email,
        tiene_acceso=bool(seller.email and seller.password_hash),
        activo=seller.activo,
    )


@router.put("/accesos/drivers/{driver_id}", response_model=AccesoPortalOut)
def upsert_acceso_driver(
    driver_id: int,
    data: AccesoPortalUpsert,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    driver = db.get(Driver, driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver no encontrado")

    dup = db.query(Driver).filter(Driver.email == data.email, Driver.id != driver_id).first()
    if dup:
        raise HTTPException(status_code=400, detail="Ese email ya está en uso por otro driver")

    driver.email = data.email
    if data.password:
        driver.password_hash = hash_password(data.password)
    elif not driver.password_hash:
        raise HTTPException(status_code=400, detail="La contraseña es obligatoria al crear acceso")

    db.commit()
    db.refresh(driver)

    audit(db, "editar_acceso_driver", usuario=current_user, request=request,
          entidad="driver", entidad_id=driver_id,
          metadata={"nombre": driver.nombre, "email": data.email})

    return AccesoPortalOut(
        id=driver.id,
        nombre=driver.nombre,
        email=driver.email,
        tiene_acceso=bool(driver.email and driver.password_hash),
        activo=driver.activo,
    )


@router.delete("/accesos/sellers/{seller_id}", response_model=AccesoPortalOut)
def revocar_acceso_seller(
    seller_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    seller = db.get(Seller, seller_id)
    if not seller:
        raise HTTPException(status_code=404, detail="Seller no encontrado")
    seller.email = None
    seller.password_hash = None
    db.commit()
    db.refresh(seller)
    audit(db, "revocar_acceso_seller", usuario=current_user, request=request,
          entidad="seller", entidad_id=seller_id,
          metadata={"nombre": seller.nombre})
    return AccesoPortalOut(
        id=seller.id, nombre=seller.nombre, email=None, tiene_acceso=False, activo=seller.activo
    )


@router.delete("/accesos/drivers/{driver_id}", response_model=AccesoPortalOut)
def revocar_acceso_driver(
    driver_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    driver = db.get(Driver, driver_id)
    if not driver:
        raise HTTPException(status_code=404, detail="Driver no encontrado")
    driver.email = None
    driver.password_hash = None
    db.commit()
    db.refresh(driver)
    audit(db, "revocar_acceso_driver", usuario=current_user, request=request,
          entidad="driver", entidad_id=driver_id,
          metadata={"nombre": driver.nombre})
    return AccesoPortalOut(
        id=driver.id, nombre=driver.nombre, email=None, tiene_acceso=False, activo=driver.activo
    )
