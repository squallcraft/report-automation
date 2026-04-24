"""
API para la gestión de certificados de trabajadores y drivers.

Endpoints:
  POST   /certificados/trabajador/{id}/subir        — admin sube o trabajador desde portal
  GET    /certificados/trabajador/{id}               — lista certificados por trabajador
  POST   /certificados/{id}/revisar                  — admin aprueba/rechaza
  GET    /certificados/trabajador/{id}/completitud   — % completitud para emitir contrato

  POST   /certificados/portal/subir                  — portal trabajador
  GET    /certificados/portal/mis-certificados        — portal trabajador
"""
from __future__ import annotations

import os
import uuid
from datetime import date, datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import require_permission, get_current_user, RolEnum
from app.models import (
    Trabajador,
    Driver,
    CertificadoTrabajador,
    TipoCertificadoEnum,
    EstadoCertificadoEnum,
)

router = APIRouter(prefix="/certificados", tags=["Certificados"])

UPLOAD_DIR = "/opt/ecourier/media/certificados"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Certificados que bloquean emisión de contrato (todos deben estar APROBADOS)
CERTIFICADOS_BLOQUEANTES = {
    TipoCertificadoEnum.AFP.value,
    TipoCertificadoEnum.SALUD.value,
    TipoCertificadoEnum.CARNET_FRONTAL.value,
    TipoCertificadoEnum.CARNET_TRASERO.value,
    TipoCertificadoEnum.DOMICILIO.value,
    TipoCertificadoEnum.ANTECEDENTES.value,
}
# Solo para drivers
CERTIFICADOS_SOLO_DRIVER = {TipoCertificadoEnum.LICENCIA_CONDUCIR.value}


def _serializar(cert: CertificadoTrabajador) -> dict:
    return {
        "id": cert.id,
        "trabajador_id": cert.trabajador_id,
        "tipo": cert.tipo,
        "nombre_archivo": cert.nombre_archivo,
        "fecha_emision": cert.fecha_emision.isoformat() if cert.fecha_emision else None,
        "fecha_vencimiento": cert.fecha_vencimiento.isoformat() if cert.fecha_vencimiento else None,
        "estado": cert.estado,
        "nota_admin": cert.nota_admin,
        "revisado_por": cert.revisado_por,
        "revisado_at": cert.revisado_at.isoformat() if cert.revisado_at else None,
        "created_at": cert.created_at.isoformat() if cert.created_at else None,
    }


def _completitud(db: Session, trabajador_id: int, es_driver: bool = False) -> dict:
    """Retorna la completitud de certificados y si hay bloqueo para emitir contrato."""
    tipos_requeridos = list(CERTIFICADOS_BLOQUEANTES)
    if es_driver:
        tipos_requeridos.append(TipoCertificadoEnum.LICENCIA_CONDUCIR.value)

    certs = db.query(CertificadoTrabajador).filter(
        CertificadoTrabajador.trabajador_id == trabajador_id,
    ).all()

    aprobados_por_tipo = {
        c.tipo for c in certs if c.estado == EstadoCertificadoEnum.APROBADO.value
    }
    pendientes = [t for t in tipos_requeridos if t not in aprobados_por_tipo]
    total = len(tipos_requeridos)
    ok = len(tipos_requeridos) - len(pendientes)

    return {
        "total": total,
        "aprobados": ok,
        "porcentaje": round(ok / total * 100) if total else 100,
        "bloqueado": len(pendientes) > 0,
        "faltantes": pendientes,
    }


# ─────────────────────────────────────────────────────────────────────────────
#  Admin: ver y revisar
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/trabajador/{trabajador_id}")
def listar_certificados(
    trabajador_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_permission("certificados:ver")),
):
    certs = db.query(CertificadoTrabajador).filter(
        CertificadoTrabajador.trabajador_id == trabajador_id
    ).order_by(CertificadoTrabajador.tipo, CertificadoTrabajador.created_at.desc()).all()
    return [_serializar(c) for c in certs]


@router.get("/trabajador/{trabajador_id}/completitud")
def completitud_certificados(
    trabajador_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_permission("certificados:ver")),
):
    trabajador = db.get(Trabajador, trabajador_id)
    if not trabajador:
        raise HTTPException(404, "Trabajador no encontrado")
    driver = db.query(Driver).filter(Driver.trabajador_id == trabajador_id).first()
    return _completitud(db, trabajador_id, es_driver=driver is not None)


class RevisarIn(BaseModel):
    estado: str           # APROBADO | RECHAZADO
    nota_admin: Optional[str] = None
    fecha_vencimiento: Optional[date] = None   # para antecedentes, licencia, etc.


@router.post("/{cert_id}/revisar")
def revisar_certificado(
    cert_id: int,
    body: RevisarIn,
    request: Request,
    db: Session = Depends(get_db),
    user=Depends(require_permission("certificados:revisar")),
):
    cert = db.get(CertificadoTrabajador, cert_id)
    if not cert:
        raise HTTPException(404, "Certificado no encontrado")
    if body.estado not in (EstadoCertificadoEnum.APROBADO.value, EstadoCertificadoEnum.RECHAZADO.value):
        raise HTTPException(400, "Estado inválido: usa APROBADO o RECHAZADO")

    cert.estado = body.estado
    cert.nota_admin = body.nota_admin
    cert.revisado_por = user.get("nombre") or user.get("email", "admin")
    cert.revisado_at = datetime.utcnow()
    if body.fecha_vencimiento:
        cert.fecha_vencimiento = body.fecha_vencimiento

    db.commit()
    return _serializar(cert)


@router.post("/trabajador/{trabajador_id}/subir")
async def subir_certificado_admin(
    trabajador_id: int,
    tipo: str = Form(...),
    fecha_emision: Optional[str] = Form(None),
    archivo: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(require_permission("certificados:revisar")),
):
    trabajador = db.get(Trabajador, trabajador_id)
    if not trabajador:
        raise HTTPException(404, "Trabajador no encontrado")

    ext = os.path.splitext(archivo.filename or "")[-1].lower() or ".pdf"
    nombre = f"{trabajador_id}_{tipo}_{uuid.uuid4().hex[:8]}{ext}"
    ruta = os.path.join(UPLOAD_DIR, nombre)
    with open(ruta, "wb") as f:
        f.write(await archivo.read())

    fecha_em = date.fromisoformat(fecha_emision) if fecha_emision else None

    cert = CertificadoTrabajador(
        trabajador_id=trabajador_id,
        tipo=tipo,
        archivo_path=ruta,
        mime_type=archivo.content_type,
        nombre_archivo=archivo.filename,
        fecha_emision=fecha_em,
        estado=EstadoCertificadoEnum.APROBADO.value,   # admin sube = aprobado directamente
        creado_por=user.get("nombre") or "admin",
        revisado_por=user.get("nombre") or "admin",
        revisado_at=datetime.utcnow(),
    )
    db.add(cert)
    db.commit()
    db.refresh(cert)
    return _serializar(cert)


# ─────────────────────────────────────────────────────────────────────────────
#  Portal trabajador / driver
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/portal/mis-certificados")
def mis_certificados(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Devuelve certificados propios del trabajador logueado."""
    if user["rol"] not in (RolEnum.TRABAJADOR, RolEnum.DRIVER):
        raise HTTPException(403, "Solo para trabajadores o drivers")

    trabajador_id = _get_trabajador_id(db, user)
    es_driver = user["rol"] == RolEnum.DRIVER

    certs = db.query(CertificadoTrabajador).filter(
        CertificadoTrabajador.trabajador_id == trabajador_id
    ).order_by(CertificadoTrabajador.tipo, CertificadoTrabajador.created_at.desc()).all()

    tipos_requeridos = list(CERTIFICADOS_BLOQUEANTES)
    if es_driver:
        tipos_requeridos.append(TipoCertificadoEnum.LICENCIA_CONDUCIR.value)

    # Agrupar por tipo: devolver el más reciente por tipo
    por_tipo: dict[str, CertificadoTrabajador] = {}
    for c in certs:
        if c.tipo not in por_tipo:
            por_tipo[c.tipo] = c

    resultado = []
    for tipo in tipos_requeridos:
        cert = por_tipo.get(tipo)
        resultado.append({
            "tipo": tipo,
            "obligatorio": True,
            "cert": _serializar(cert) if cert else None,
        })

    return resultado


@router.post("/portal/subir")
async def subir_certificado_portal(
    tipo: str = Form(...),
    fecha_emision: Optional[str] = Form(None),
    archivo: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """Permite al trabajador o driver subir uno de sus certificados."""
    if user["rol"] not in (RolEnum.TRABAJADOR, RolEnum.DRIVER):
        raise HTTPException(403, "Solo para trabajadores o drivers")

    trabajador_id = _get_trabajador_id(db, user)
    es_driver = user["rol"] == RolEnum.DRIVER

    tipos_permitidos = set(CERTIFICADOS_BLOQUEANTES)
    if es_driver:
        tipos_permitidos.add(TipoCertificadoEnum.LICENCIA_CONDUCIR.value)
    if tipo not in tipos_permitidos:
        raise HTTPException(400, f"Tipo de certificado no válido: {tipo}")

    # Verificar que no haya uno CARGADO o APROBADO activo (solo resubir si RECHAZADO)
    existing = db.query(CertificadoTrabajador).filter(
        CertificadoTrabajador.trabajador_id == trabajador_id,
        CertificadoTrabajador.tipo == tipo,
    ).order_by(CertificadoTrabajador.created_at.desc()).first()

    if existing and existing.estado == EstadoCertificadoEnum.APROBADO.value:
        # Antecedentes: permitir renovar anual (vencimiento > 1 año)
        if tipo == TipoCertificadoEnum.ANTECEDENTES.value:
            if existing.fecha_vencimiento and existing.fecha_vencimiento >= date.today():
                raise HTTPException(400, "Tu certificado de antecedentes está vigente y aprobado.")
        else:
            raise HTTPException(400, "Este certificado ya está aprobado. No es necesario resubir.")

    if existing and existing.estado == EstadoCertificadoEnum.CARGADO.value:
        raise HTTPException(400, "Ya tienes un certificado en revisión. Espera la respuesta del equipo.")

    ext = os.path.splitext(archivo.filename or "")[-1].lower() or ".pdf"
    nombre = f"{trabajador_id}_{tipo}_{uuid.uuid4().hex[:8]}{ext}"
    ruta = os.path.join(UPLOAD_DIR, nombre)
    with open(ruta, "wb") as f:
        f.write(await archivo.read())

    fecha_em = date.fromisoformat(fecha_emision) if fecha_emision else None

    cert = CertificadoTrabajador(
        trabajador_id=trabajador_id,
        tipo=tipo,
        archivo_path=ruta,
        mime_type=archivo.content_type,
        nombre_archivo=archivo.filename,
        fecha_emision=fecha_em,
        estado=EstadoCertificadoEnum.CARGADO.value,
        creado_por="TRABAJADOR",
    )
    db.add(cert)
    db.commit()
    db.refresh(cert)
    return _serializar(cert)


def _get_trabajador_id(db: Session, user: dict) -> int:
    """Resuelve trabajador_id desde el usuario logueado (TRABAJADOR o DRIVER)."""
    if user["rol"] == RolEnum.TRABAJADOR:
        return user["id"]
    # DRIVER: buscar vinculación a trabajador
    driver = db.get(Driver, user["id"])
    if not driver or not driver.trabajador_id:
        raise HTTPException(400, "Driver no vinculado a un trabajador")
    return driver.trabajador_id
