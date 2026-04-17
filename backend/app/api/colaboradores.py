"""
API de Colaboradores: CRUD admin + portal del colaborador (boletas, pagos, perfil).
"""
import os
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import (
    hash_password, require_admin_or_administracion, require_colaborador,
    require_permission,
)
from app.models import (
    Colaborador, BoletaColaborador, PagoMesColaborador,
    EstadoBoletaColaboradorEnum, CuentaContable, CategoriaFinanciera,
)
from app.schemas import ColaboradorCreate, ColaboradorUpdate, ColaboradorOut

router = APIRouter(prefix="/colaboradores", tags=["Colaboradores"])

UPLOADS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    "uploads", "boletas_colaboradores",
)

MESES = [
    "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]


# ── ADMIN: CRUD Colaboradores ─────────────────────────────────────────────────


@router.get("/", dependencies=[Depends(require_permission("colaboradores:ver"))])
def listar_colaboradores(
    activo: Optional[bool] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Colaborador).order_by(Colaborador.nombre)
    if activo is not None:
        q = q.filter(Colaborador.activo == activo)
    rows = q.all()
    result = []
    for c in rows:
        d = {col.name: getattr(c, col.name) for col in c.__table__.columns}
        d["cuenta_contable_nombre"] = c.cuenta_contable.nombre if c.cuenta_contable else None
        d["categoria_financiera_nombre"] = c.categoria_financiera.nombre if c.categoria_financiera else None
        result.append(d)
    return result


@router.post("/", dependencies=[Depends(require_permission("colaboradores:editar"))])
def crear_colaborador(data: ColaboradorCreate, db: Session = Depends(get_db)):
    if data.email:
        existing = db.query(Colaborador).filter(Colaborador.email == data.email).first()
        if existing:
            raise HTTPException(status_code=400, detail="Ya existe un colaborador con ese email")

    colab = Colaborador(
        nombre=data.nombre,
        rut=data.rut,
        email=data.email,
        telefono=data.telefono,
        especialidad=data.especialidad,
        tags=data.tags,
        banco=data.banco,
        tipo_cuenta=data.tipo_cuenta,
        numero_cuenta=data.numero_cuenta,
        descripcion_servicio=data.descripcion_servicio,
        monto_acordado=data.monto_acordado,
        frecuencia_pago=data.frecuencia_pago,
        fecha_inicio=data.fecha_inicio,
        fecha_fin=data.fecha_fin,
        activo=data.activo,
        cuenta_contable_id=data.cuenta_contable_id,
        categoria_financiera_id=data.categoria_financiera_id,
    )
    if data.password:
        colab.password_hash = hash_password(data.password)
    db.add(colab)
    db.commit()
    db.refresh(colab)
    return {"ok": True, "id": colab.id}


@router.put("/{colab_id}", dependencies=[Depends(require_permission("colaboradores:editar"))])
def actualizar_colaborador(colab_id: int, data: ColaboradorUpdate, db: Session = Depends(get_db)):
    colab = db.get(Colaborador, colab_id)
    if not colab:
        raise HTTPException(status_code=404, detail="Colaborador no encontrado")
    updates = data.model_dump(exclude_unset=True)
    password = updates.pop("password", None)
    for k, v in updates.items():
        setattr(colab, k, v)
    if password:
        colab.password_hash = hash_password(password)
    db.commit()
    return {"ok": True}


@router.get("/{colab_id}", dependencies=[Depends(require_permission("colaboradores:ver"))])
def obtener_colaborador(colab_id: int, db: Session = Depends(get_db)):
    colab = db.get(Colaborador, colab_id)
    if not colab:
        raise HTTPException(status_code=404, detail="Colaborador no encontrado")
    d = {col.name: getattr(colab, col.name) for col in colab.__table__.columns}
    d["cuenta_contable_nombre"] = colab.cuenta_contable.nombre if colab.cuenta_contable else None
    d["categoria_financiera_nombre"] = colab.categoria_financiera.nombre if colab.categoria_financiera else None
    return d


# ── ADMIN: Boletas ─────────────────────────────────────────────────────────────


@router.get("/admin/boletas", dependencies=[Depends(require_permission("colaboradores:ver"))])
def admin_listar_boletas(
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
):
    boletas = (
        db.query(BoletaColaborador)
        .filter(BoletaColaborador.mes == mes, BoletaColaborador.anio == anio)
        .order_by(BoletaColaborador.colaborador_id)
        .all()
    )
    result = []
    for b in boletas:
        colab = db.get(Colaborador, b.colaborador_id)
        result.append({
            "id": b.id,
            "colaborador_id": b.colaborador_id,
            "colaborador_nombre": colab.nombre if colab else "",
            "especialidad": colab.especialidad if colab else "",
            "mes": b.mes,
            "anio": b.anio,
            "numero_boleta": b.numero_boleta,
            "monto": b.monto,
            "archivo_nombre": b.archivo_nombre,
            "estado": b.estado,
            "nota_colaborador": b.nota_colaborador,
            "nota_admin": b.nota_admin,
            "revisado_por": b.revisado_por,
            "created_at": b.created_at.isoformat() if b.created_at else None,
        })
    return result


@router.put(
    "/admin/boletas/{boleta_id}/revisar",
    dependencies=[Depends(require_permission("colaboradores:editar"))],
)
def admin_revisar_boleta(
    boleta_id: int,
    accion: str = Query(..., pattern="^(aprobar|rechazar)$"),
    nota: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_permission("colaboradores:editar")),
):
    boleta = db.get(BoletaColaborador, boleta_id)
    if not boleta:
        raise HTTPException(status_code=404, detail="Boleta no encontrada")

    if accion == "aprobar":
        boleta.estado = EstadoBoletaColaboradorEnum.APROBADA.value
    else:
        boleta.estado = EstadoBoletaColaboradorEnum.RECHAZADA.value

    boleta.nota_admin = nota
    boleta.revisado_por = current_user.get("nombre", "admin")
    boleta.revisado_en = datetime.utcnow()
    db.commit()
    return {"ok": True, "estado": boleta.estado}


@router.put(
    "/admin/boletas/{boleta_id}/pagar",
    dependencies=[Depends(require_permission("colaboradores:editar"))],
)
def admin_pagar_boleta(
    boleta_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_permission("colaboradores:editar")),
):
    boleta = db.get(BoletaColaborador, boleta_id)
    if not boleta:
        raise HTTPException(status_code=404, detail="Boleta no encontrada")
    if boleta.estado != EstadoBoletaColaboradorEnum.APROBADA.value:
        raise HTTPException(status_code=400, detail="Solo se pueden pagar boletas aprobadas")

    boleta.estado = EstadoBoletaColaboradorEnum.PAGADA.value
    db.commit()

    from app.services.contabilidad import asiento_pago_colaborador
    try:
        asiento_pago_colaborador(db, boleta)
        db.commit()
    except Exception:
        pass

    return {"ok": True}


@router.get(
    "/admin/boletas/{boleta_id}/descargar",
    dependencies=[Depends(require_permission("colaboradores:ver"))],
)
def admin_descargar_boleta(boleta_id: int, db: Session = Depends(get_db)):
    boleta = db.get(BoletaColaborador, boleta_id)
    if not boleta or not boleta.archivo_path or not os.path.exists(boleta.archivo_path):
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    return FileResponse(
        boleta.archivo_path,
        filename=boleta.archivo_nombre or "boleta.pdf",
        media_type="application/octet-stream",
    )


# ── PORTAL: Colaborador ───────────────────────────────────────────────────────


@router.get("/portal/dashboard")
def portal_dashboard(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_colaborador),
):
    colab = db.get(Colaborador, current_user["id"])
    if not colab:
        raise HTTPException(status_code=404)

    boletas = (
        db.query(BoletaColaborador)
        .filter(BoletaColaborador.colaborador_id == colab.id)
        .order_by(BoletaColaborador.anio.desc(), BoletaColaborador.mes.desc())
        .limit(12)
        .all()
    )
    pendientes = sum(1 for b in boletas if b.estado == EstadoBoletaColaboradorEnum.PENDIENTE.value)
    aprobadas = sum(1 for b in boletas if b.estado == EstadoBoletaColaboradorEnum.APROBADA.value)
    pagadas = sum(1 for b in boletas if b.estado == EstadoBoletaColaboradorEnum.PAGADA.value)
    total_pagado = sum(b.monto for b in boletas if b.estado == EstadoBoletaColaboradorEnum.PAGADA.value)

    return {
        "nombre": colab.nombre,
        "especialidad": colab.especialidad,
        "monto_acordado": colab.monto_acordado,
        "frecuencia_pago": colab.frecuencia_pago,
        "fecha_inicio": colab.fecha_inicio.isoformat() if colab.fecha_inicio else None,
        "fecha_fin": colab.fecha_fin.isoformat() if colab.fecha_fin else None,
        "boletas_pendientes": pendientes,
        "boletas_aprobadas": aprobadas,
        "boletas_pagadas": pagadas,
        "total_pagado": total_pagado,
    }


@router.get("/portal/boletas")
def portal_listar_boletas(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_colaborador),
):
    boletas = (
        db.query(BoletaColaborador)
        .filter(BoletaColaborador.colaborador_id == current_user["id"])
        .order_by(BoletaColaborador.anio.desc(), BoletaColaborador.mes.desc())
        .all()
    )
    return [
        {
            "id": b.id,
            "mes": b.mes,
            "anio": b.anio,
            "numero_boleta": b.numero_boleta,
            "monto": b.monto,
            "archivo_nombre": b.archivo_nombre,
            "estado": b.estado,
            "nota_colaborador": b.nota_colaborador,
            "nota_admin": b.nota_admin,
            "created_at": b.created_at.isoformat() if b.created_at else None,
        }
        for b in boletas
    ]


@router.post("/portal/boletas/upload")
async def portal_upload_boleta(
    mes: int = Query(...),
    anio: int = Query(...),
    monto: int = Query(...),
    numero_boleta: Optional[str] = Query(None),
    nota: Optional[str] = Query(None),
    archivo: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_colaborador),
):
    colab_id = current_user["id"]

    allowed_ext = (".pdf", ".jpg", ".jpeg", ".png", ".webp")
    ext = os.path.splitext(archivo.filename or "")[1].lower()
    if ext not in allowed_ext:
        raise HTTPException(status_code=400, detail=f"Formato no permitido. Use: {', '.join(allowed_ext)}")

    existing = db.query(BoletaColaborador).filter(
        BoletaColaborador.colaborador_id == colab_id,
        BoletaColaborador.mes == mes,
        BoletaColaborador.anio == anio,
    ).first()

    if existing and existing.estado in (
        EstadoBoletaColaboradorEnum.APROBADA.value,
        EstadoBoletaColaboradorEnum.PAGADA.value,
    ):
        raise HTTPException(status_code=400, detail="La boleta de este período ya fue aprobada/pagada")

    os.makedirs(UPLOADS_DIR, exist_ok=True)
    unique_name = f"{colab_id}_{mes}_{anio}_{uuid.uuid4().hex[:8]}{ext}"
    file_path = os.path.join(UPLOADS_DIR, unique_name)

    content = await archivo.read()
    with open(file_path, "wb") as f:
        f.write(content)

    if existing:
        if existing.archivo_path and os.path.exists(existing.archivo_path):
            try:
                os.remove(existing.archivo_path)
            except OSError:
                pass
        existing.archivo_nombre = archivo.filename
        existing.archivo_path = file_path
        existing.monto = monto
        existing.numero_boleta = numero_boleta
        existing.estado = EstadoBoletaColaboradorEnum.PENDIENTE.value
        existing.nota_colaborador = nota
        existing.nota_admin = None
        existing.revisado_por = None
        existing.revisado_en = None
    else:
        existing = BoletaColaborador(
            colaborador_id=colab_id,
            mes=mes,
            anio=anio,
            monto=monto,
            numero_boleta=numero_boleta,
            archivo_nombre=archivo.filename,
            archivo_path=file_path,
            estado=EstadoBoletaColaboradorEnum.PENDIENTE.value,
            nota_colaborador=nota,
        )
        db.add(existing)

    db.commit()
    db.refresh(existing)
    return {"ok": True, "boleta_id": existing.id, "estado": existing.estado}


@router.get("/portal/boletas/{boleta_id}/descargar")
def portal_descargar_boleta(
    boleta_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_colaborador),
):
    boleta = db.get(BoletaColaborador, boleta_id)
    if not boleta or boleta.colaborador_id != current_user["id"]:
        raise HTTPException(status_code=404, detail="Boleta no encontrada")
    if not boleta.archivo_path or not os.path.exists(boleta.archivo_path):
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    return FileResponse(
        boleta.archivo_path,
        filename=boleta.archivo_nombre or "boleta.pdf",
        media_type="application/octet-stream",
    )


@router.get("/portal/perfil")
def portal_perfil(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_colaborador),
):
    colab = db.get(Colaborador, current_user["id"])
    if not colab:
        raise HTTPException(status_code=404)
    return {
        "id": colab.id,
        "nombre": colab.nombre,
        "rut": colab.rut,
        "email": colab.email,
        "telefono": colab.telefono,
        "especialidad": colab.especialidad,
        "banco": colab.banco,
        "tipo_cuenta": colab.tipo_cuenta,
        "numero_cuenta": colab.numero_cuenta,
        "descripcion_servicio": colab.descripcion_servicio,
        "monto_acordado": colab.monto_acordado,
        "frecuencia_pago": colab.frecuencia_pago,
        "fecha_inicio": colab.fecha_inicio.isoformat() if colab.fecha_inicio else None,
        "fecha_fin": colab.fecha_fin.isoformat() if colab.fecha_fin else None,
    }
