from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import require_admin, hash_password
from app.models import AdminUser, RolEnum

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


class UsuarioOut(BaseModel):
    id: int
    username: str
    nombre: Optional[str] = None
    rol: str
    activo: bool

    model_config = {"from_attributes": True}


@router.get("", response_model=List[UsuarioOut])
def listar_usuarios(db: Session = Depends(get_db), _=Depends(require_admin)):
    return db.query(AdminUser).order_by(AdminUser.username).all()


@router.post("", response_model=UsuarioOut, status_code=201)
def crear_usuario(data: UsuarioCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
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
    return user


@router.put("/{user_id}", response_model=UsuarioOut)
def actualizar_usuario(user_id: int, data: UsuarioUpdate, db: Session = Depends(get_db), _=Depends(require_admin)):
    user = db.get(AdminUser, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
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
    return user


@router.delete("/{user_id}")
def desactivar_usuario(user_id: int, db: Session = Depends(get_db), current_user=Depends(require_admin)):
    user = db.get(AdminUser, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if user.id == current_user["id"]:
        raise HTTPException(status_code=400, detail="No puedes desactivarte a ti mismo")
    user.activo = False
    db.commit()
    return {"message": "Usuario desactivado"}
