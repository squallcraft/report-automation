"""
API de inquilinos — arriendo del sistema Tracking Tech.

Secciones:
  /api/inquilinos/admin/...  → Rutas para administradores (require_permission)
  /api/inquilinos/portal/... → Rutas para el portal del inquilino (require_inquilino)
"""
import base64
import logging
import os
import uuid
from datetime import date, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response as _Resp
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import require_admin_or_administracion, require_inquilino, require_inquilino_raw, require_permission
from app.database import get_db
from app.models import (
    Inquilino,
    CobrosInquilino,
    DescuentoInquilino,
    AnexoContratoInquilino,
    EstadoCobrosInquilinoEnum,
    EstadoAnexoInquilinoEnum,
    TipoAnexoInquilinoEnum,
    ConfigPlanInquilino,
)
from app.auth import hash_password
from app.schemas import (
    InquilinoCreate,
    InquilinoOut,
    InquilinoUpdate,
    CompletarPerfilIn,
    RegistrarDespliegueIn,
    DescuentoInquilinoCreate,
    DescuentoInquilinoOut,
    GenerarCobrosIn,
    CobrosInquilinoOut,
    AnexoContratoInquilinoOut,
    EmitirContratoInquilinoIn,
    FirmarAnexoInquilinoIn,
    ConfigPlanInquilinoOut,
    ConfigPlanInquilinoUpdate,
    ConfigPlanInquilinoCreate,
)
from app.services import contrato_inquilino as svc_contrato
from app.services import cobros_inquilino as svc_cobros
from app.services.notificaciones_inquilino import notificar_inicio_despliegue

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/inquilinos", tags=["Inquilinos"])

UPLOADS_DIR_COMPROBANTES = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    "uploads", "comprobantes_inquilinos",
)
# ─────────────────────────────────────────────────────────────────────────────
# Rutas ADMIN
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/admin", response_model=InquilinoOut, status_code=201)
def crear_inquilino(
    data: InquilinoCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("inquilinos:editar")),
):
    """Crea un inquilino nuevo. No completa el perfil — el inquilino lo hace al ingresar."""
    existente = db.query(Inquilino).filter(Inquilino.email == data.email).first()
    if existente:
        raise HTTPException(status_code=400, detail="Ya existe un inquilino con ese email")

    password_hash = hash_password(data.password) if data.password else None

    inq = Inquilino(
        email=data.email,
        password_hash=password_hash,
        plan=data.plan,
        tiene_reserva=data.tiene_reserva,
        monto_reserva=data.monto_reserva if data.tiene_reserva else None,
        mes_gratis=data.mes_gratis,
        activo=True,
    )
    db.add(inq)
    db.commit()
    db.refresh(inq)
    return inq


@router.get("/admin", response_model=List[InquilinoOut])
def listar_inquilinos(
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("inquilinos:ver")),
):
    return db.query(Inquilino).order_by(Inquilino.created_at.desc()).all()


@router.get("/admin/{inquilino_id}", response_model=InquilinoOut)
def obtener_inquilino(
    inquilino_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("inquilinos:ver")),
):
    inq = db.get(Inquilino, inquilino_id)
    if not inq:
        raise HTTPException(status_code=404, detail="Inquilino no encontrado")
    return inq


@router.put("/admin/{inquilino_id}", response_model=InquilinoOut)
def editar_inquilino(
    inquilino_id: int,
    data: InquilinoUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("inquilinos:editar")),
):
    inq = db.get(Inquilino, inquilino_id)
    if not inq:
        raise HTTPException(status_code=404, detail="Inquilino no encontrado")

    for field, value in data.model_dump(exclude_none=True).items():
        if field == "password":
            inq.password_hash = hash_password(value)
        else:
            setattr(inq, field, value)

    db.commit()
    db.refresh(inq)
    return inq


@router.post("/admin/{inquilino_id}/descuento", response_model=DescuentoInquilinoOut, status_code=201)
def agregar_descuento(
    inquilino_id: int,
    data: DescuentoInquilinoCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("inquilinos:editar")),
):
    inq = db.get(Inquilino, inquilino_id)
    if not inq:
        raise HTTPException(status_code=404, detail="Inquilino no encontrado")

    desc = DescuentoInquilino(
        inquilino_id=inquilino_id,
        monto=data.monto,
        motivo=data.motivo,
    )
    db.add(desc)
    db.commit()
    db.refresh(desc)
    return desc


@router.get("/admin/{inquilino_id}/descuentos", response_model=List[DescuentoInquilinoOut])
def listar_descuentos(
    inquilino_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("inquilinos:ver")),
):
    return db.query(DescuentoInquilino).filter(
        DescuentoInquilino.inquilino_id == inquilino_id
    ).order_by(DescuentoInquilino.created_at.desc()).all()


# ── Cobros admin ──────────────────────────────────────────────────────────────

@router.post("/admin/{inquilino_id}/preview-cobro")
def preview_cobro(
    inquilino_id: int,
    data: GenerarCobrosIn,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("inquilinos:ver")),
):
    """Calcula el desglose de un cobro sin generarlo ni persistirlo."""
    inq = db.get(Inquilino, inquilino_id)
    if not inq:
        raise HTTPException(status_code=404, detail="Inquilino no encontrado")
    if not inq.plan:
        raise HTTPException(status_code=400, detail="El inquilino no tiene un plan asignado")
    return svc_cobros.calcular_monto(db, inq, data.variable_valor)


@router.post("/admin/{inquilino_id}/generar-cobro", response_model=CobrosInquilinoOut, status_code=201)
def generar_cobro(
    inquilino_id: int,
    data: GenerarCobrosIn,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("inquilinos:editar")),
):
    inq = db.get(Inquilino, inquilino_id)
    if not inq:
        raise HTTPException(status_code=404, detail="Inquilino no encontrado")
    if not inq.plan:
        raise HTTPException(status_code=400, detail="El inquilino no tiene un plan asignado")
    if not inq.perfil_completado:
        raise HTTPException(status_code=400, detail="El inquilino no ha completado su perfil")

    cobro = svc_cobros.generar_cobro(
        db=db,
        inquilino=inq,
        variable_valor=data.variable_valor,
        archivo_adjunto_b64=data.archivo_adjunto_b64,
        archivo_adjunto_nombre=data.archivo_adjunto_nombre,
    )
    return cobro


@router.get("/admin/{inquilino_id}/cobros", response_model=List[CobrosInquilinoOut])
def listar_cobros_admin(
    inquilino_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("inquilinos:ver")),
):
    return db.query(CobrosInquilino).filter(
        CobrosInquilino.inquilino_id == inquilino_id
    ).order_by(CobrosInquilino.created_at.desc()).all()


@router.post("/admin/{inquilino_id}/cobros/{cobro_id}/aprobar-pago", response_model=CobrosInquilinoOut)
def aprobar_pago(
    inquilino_id: int,
    cobro_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("inquilinos:editar")),
):
    cobro = db.query(CobrosInquilino).filter(
        CobrosInquilino.id == cobro_id,
        CobrosInquilino.inquilino_id == inquilino_id,
    ).first()
    if not cobro:
        raise HTTPException(status_code=404, detail="Cobro no encontrado")
    if cobro.estado == EstadoCobrosInquilinoEnum.PAGADO.value:
        raise HTTPException(status_code=400, detail="El cobro ya fue aprobado")

    nombre_admin = current_user.get("nombre", "admin")
    cobro = svc_cobros.aprobar_pago(db, cobro, aprobado_por=nombre_admin)
    db.commit()
    db.refresh(cobro)
    return cobro


# ── Contratos admin ───────────────────────────────────────────────────────────

@router.post("/admin/{inquilino_id}/contratos/preview")
def preview_contrato(
    inquilino_id: int,
    data: EmitirContratoInquilinoIn,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("inquilinos:ver")),
):
    inq = db.get(Inquilino, inquilino_id)
    if not inq:
        raise HTTPException(status_code=404, detail="Inquilino no encontrado")
    return svc_contrato.preview_contrato(db, inq, data.plantilla_id)


@router.post("/admin/{inquilino_id}/contratos/emitir", response_model=AnexoContratoInquilinoOut, status_code=201)
def emitir_contrato(
    inquilino_id: int,
    data: EmitirContratoInquilinoIn,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("inquilinos:editar")),
):
    inq = db.get(Inquilino, inquilino_id)
    if not inq:
        raise HTTPException(status_code=404, detail="Inquilino no encontrado")
    # Nota: se permite emitir aunque el perfil no esté completo.
    # El PDF se regenerará automáticamente cuando el inquilino complete su perfil.

    nombre_admin = current_user.get("nombre", "admin")
    anexo = svc_contrato.emitir_contrato(
        db=db,
        inquilino=inq,
        plantilla_id=data.plantilla_id,
        titulo=data.titulo,
        creado_por=nombre_admin,
    )
    return anexo


@router.get("/admin/{inquilino_id}/contratos", response_model=List[AnexoContratoInquilinoOut])
def listar_contratos_admin(
    inquilino_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("inquilinos:ver")),
):
    return db.query(AnexoContratoInquilino).filter(
        AnexoContratoInquilino.inquilino_id == inquilino_id
    ).order_by(AnexoContratoInquilino.created_at.desc()).all()


@router.get("/admin/{inquilino_id}/contratos/{anexo_id}/pdf")
def descargar_pdf_admin(
    inquilino_id: int,
    anexo_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("inquilinos:ver")),
):
    anexo = db.query(AnexoContratoInquilino).filter(
        AnexoContratoInquilino.id == anexo_id,
        AnexoContratoInquilino.inquilino_id == inquilino_id,
    ).first()
    if not anexo or not anexo.pdf_generado:
        raise HTTPException(status_code=404, detail="PDF no encontrado")
    return {"pdf_base64": anexo.pdf_generado, "titulo": anexo.titulo}


@router.post("/admin/{inquilino_id}/contratos/{anexo_id}/aprobar-reserva", response_model=AnexoContratoInquilinoOut)
def aprobar_comprobante_reserva(
    inquilino_id: int,
    anexo_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("inquilinos:editar")),
):
    """Aprueba el comprobante de reserva subido por el inquilino, desbloqueando la firma del contrato."""
    anexo = db.query(AnexoContratoInquilino).filter(
        AnexoContratoInquilino.id == anexo_id,
        AnexoContratoInquilino.inquilino_id == inquilino_id,
        AnexoContratoInquilino.tipo == TipoAnexoInquilinoEnum.RESERVA.value,
    ).first()
    if not anexo:
        raise HTTPException(status_code=404, detail="Anexo de reserva no encontrado")
    if not anexo.comprobante_reserva_path:
        raise HTTPException(status_code=400, detail="El inquilino no ha subido el comprobante")

    from datetime import datetime
    anexo.comprobante_reserva_aprobado = True
    anexo.aprobado_por = current_user.get("nombre", "admin")
    anexo.aprobado_at = datetime.utcnow()
    db.commit()
    db.refresh(anexo)
    return anexo


# ── Despliegue admin ──────────────────────────────────────────────────────────

@router.post("/admin/{inquilino_id}/registrar-despliegue", response_model=InquilinoOut)
def registrar_despliegue(
    inquilino_id: int,
    data: RegistrarDespliegueIn,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("inquilinos:editar")),
):
    inq = db.get(Inquilino, inquilino_id)
    if not inq:
        raise HTTPException(status_code=404, detail="Inquilino no encontrado")
    if not inq.contrato_firmado:
        raise HTTPException(status_code=400, detail="El contrato no ha sido firmado aún")

    inq.fecha_inicio_despliegue = data.fecha_inicio_despliegue
    inq.mes_gratis_confirmado = data.mes_gratis_confirmado

    if data.mes_gratis_confirmado:
        # Facturación comienza un mes después
        d = data.fecha_inicio_despliegue
        mes_sig = d.month + 1 if d.month < 12 else 1
        anio_sig = d.year if d.month < 12 else d.year + 1
        inq.fecha_inicio_facturacion = date(anio_sig, mes_sig, d.day)
    else:
        inq.fecha_inicio_facturacion = data.fecha_inicio_despliegue

    db.commit()
    db.refresh(inq)

    try:
        notificar_inicio_despliegue(db, inq)
    except Exception as exc:
        logger.warning("Error notificando despliegue inquilino %s: %s", inquilino_id, exc)

    return inq


# ─────────────────────────────────────────────────────────────────────────────
# Rutas PORTAL (inquilino autenticado)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/portal/completar-perfil", response_model=InquilinoOut)
def completar_perfil(
    data: CompletarPerfilIn,
    db: Session = Depends(get_db),
    current_user=Depends(require_inquilino_raw),
):
    inq = db.get(Inquilino, current_user["id"])
    if not inq:
        raise HTTPException(status_code=404, detail="Inquilino no encontrado")

    for field, value in data.model_dump(exclude_none=True).items():
        setattr(inq, field, value)

    inq.perfil_completado = True
    db.commit()
    db.refresh(inq)

    # Regenerar PDFs de contratos pendientes con los datos del perfil recién completado
    try:
        svc_contrato.regenerar_pdfs_con_perfil(db, inq)
    except Exception as exc:
        logger.warning("Error regenerando contratos tras completar perfil inquilino %s: %s", inq.id, exc)

    return inq


@router.get("/portal/perfil", response_model=InquilinoOut)
def ver_perfil(
    db: Session = Depends(get_db),
    current_user=Depends(require_inquilino_raw),
):
    inq = db.get(Inquilino, current_user["id"])
    if not inq:
        raise HTTPException(status_code=404, detail="Inquilino no encontrado")
    return inq


@router.get("/portal/contratos", response_model=List[AnexoContratoInquilinoOut])
def listar_contratos_portal(
    db: Session = Depends(get_db),
    current_user=Depends(require_inquilino),
):
    return db.query(AnexoContratoInquilino).filter(
        AnexoContratoInquilino.inquilino_id == current_user["id"]
    ).order_by(AnexoContratoInquilino.created_at.desc()).all()


@router.get("/portal/contratos/{anexo_id}/pdf")
def descargar_pdf_portal(
    anexo_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_inquilino),
):
    import base64 as _b64
    anexo = db.query(AnexoContratoInquilino).filter(
        AnexoContratoInquilino.id == anexo_id,
        AnexoContratoInquilino.inquilino_id == current_user["id"],
    ).first()
    if not anexo or not anexo.pdf_generado:
        raise HTTPException(status_code=404, detail="PDF no encontrado")
    pdf_bytes = _b64.b64decode(anexo.pdf_generado)
    # Sanitize filename para header HTTP (solo ASCII)
    safe_name = (anexo.titulo or "contrato").encode("ascii", "ignore").decode("ascii").replace('"', '') or "contrato"
    return _Resp(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{safe_name}.pdf"'},
    )


@router.get("/portal/contratos/{anexo_id}/contenido")
def ver_contenido_portal(
    anexo_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_inquilino),
):
    """Devuelve el contenido renderizado del contrato para mostrarlo en el navegador."""
    inq = db.get(Inquilino, current_user["id"])
    anexo = db.query(AnexoContratoInquilino).filter(
        AnexoContratoInquilino.id == anexo_id,
        AnexoContratoInquilino.inquilino_id == current_user["id"],
    ).first()
    if not anexo:
        raise HTTPException(status_code=404, detail="Documento no encontrado")
    return {
        "id": anexo.id,
        "titulo": anexo.titulo,
        "tipo": anexo.tipo,
        "estado": anexo.estado,
        "contenido_renderizado": anexo.contenido_renderizado or "",
        "requiere_firma_inquilino": anexo.requiere_firma_inquilino,
        "firmado_at": anexo.firmado_at,
        "inquilino": {
            "nombre_rep_legal": inq.nombre_rep_legal or "",
            "rut_rep_legal": inq.rut_rep_legal or "",
        },
    }


class FirmarContratoBody(BaseModel):
    firma_base64: Optional[str] = None


@router.post("/portal/contratos/{anexo_id}/firmar", response_model=AnexoContratoInquilinoOut)
def firmar_contrato_portal(
    anexo_id: int,
    request: Request,
    body: FirmarContratoBody = None,
    db: Session = Depends(get_db),
    current_user=Depends(require_inquilino),
):
    inq = db.get(Inquilino, current_user["id"])
    if not inq:
        raise HTTPException(status_code=404, detail="Inquilino no encontrado")

    # Acepta firma del body (firma inline) o del perfil guardado
    firma = (body.firma_base64 if body else None) or inq.firma_base64
    if not firma:
        raise HTTPException(
            status_code=400,
            detail="Debes registrar tu firma electrónica antes de firmar documentos",
        )
    # Si viene firma nueva en el body, guardarla también en el perfil
    if body and body.firma_base64:
        inq.firma_base64 = body.firma_base64

    anexo = db.query(AnexoContratoInquilino).filter(
        AnexoContratoInquilino.id == anexo_id,
        AnexoContratoInquilino.inquilino_id == current_user["id"],
    ).first()
    if not anexo:
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    ip = request.headers.get("X-Forwarded-For", "").split(",")[0].strip() or (
        request.client.host if request.client else "unknown"
    )
    anexo = svc_contrato.firmar_anexo(db, inq, anexo, firma, ip=ip)
    db.commit()
    db.refresh(anexo)
    return anexo


@router.put("/portal/firma")
def registrar_firma_portal(
    data: dict,
    db: Session = Depends(get_db),
    current_user=Depends(require_inquilino_raw),
):
    """Guarda o actualiza la firma digital del inquilino."""
    inq = db.get(Inquilino, current_user["id"])
    if not inq:
        raise HTTPException(status_code=404, detail="Inquilino no encontrado")
    firma = data.get("firma_base64")
    if not firma:
        raise HTTPException(status_code=422, detail="firma_base64 es requerido")
    inq.firma_base64 = firma
    db.commit()
    return {"ok": True, "tiene_firma": True}


@router.post("/portal/contratos/{anexo_id}/subir-comprobante-reserva", response_model=AnexoContratoInquilinoOut)
def subir_comprobante_reserva(
    anexo_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_inquilino),
):
    """El inquilino adjunta el comprobante de transferencia de reserva."""
    raise HTTPException(
        status_code=501,
        detail="Endpoint para subir archivos — implementar con multipart/form-data según stack de archivos del proyecto"
    )


@router.get("/portal/cobros", response_model=List[CobrosInquilinoOut])
def listar_cobros_portal(
    db: Session = Depends(get_db),
    current_user=Depends(require_inquilino),
):
    return db.query(CobrosInquilino).filter(
        CobrosInquilino.inquilino_id == current_user["id"]
    ).order_by(CobrosInquilino.created_at.desc()).all()


@router.post("/portal/cobros/{cobro_id}/subir-comprobante")
async def subir_comprobante_pago(
    cobro_id: int,
    archivo: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_inquilino),
):
    """El inquilino adjunta el comprobante del pago mensual."""
    inq_id = current_user["id"]
    cobro = db.query(CobrosInquilino).filter(
        CobrosInquilino.id == cobro_id,
        CobrosInquilino.inquilino_id == inq_id,
    ).first()
    if not cobro:
        raise HTTPException(status_code=404, detail="Cobro no encontrado")
    if cobro.estado == "PAGADO":
        raise HTTPException(status_code=400, detail="Este cobro ya fue marcado como pagado")

    allowed_ext = (".pdf", ".jpg", ".jpeg", ".png", ".webp")
    ext = os.path.splitext(archivo.filename or "")[1].lower()
    if ext not in allowed_ext:
        raise HTTPException(status_code=400, detail=f"Formato no permitido. Usa: {', '.join(allowed_ext)}")

    os.makedirs(UPLOADS_DIR_COMPROBANTES, exist_ok=True)
    unique_name = f"inq{inq_id}_cobro{cobro_id}_{uuid.uuid4().hex[:8]}{ext}"
    file_path = os.path.join(UPLOADS_DIR_COMPROBANTES, unique_name)

    # Eliminar archivo anterior si existe
    if cobro.comprobante_pago_path and os.path.exists(cobro.comprobante_pago_path):
        try:
            os.remove(cobro.comprobante_pago_path)
        except OSError:
            pass

    content = await archivo.read()
    with open(file_path, "wb") as f:
        f.write(content)

    cobro.comprobante_pago_path = file_path
    cobro.comprobante_pago_nombre = archivo.filename
    db.commit()
    return {"ok": True, "nombre": archivo.filename}


@router.get("/portal/cobros/{cobro_id}/factura")
def descargar_factura_portal(
    cobro_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_inquilino),
):
    cobro = db.query(CobrosInquilino).filter(
        CobrosInquilino.id == cobro_id,
        CobrosInquilino.inquilino_id == current_user["id"],
    ).first()
    if not cobro:
        raise HTTPException(status_code=404, detail="Cobro no encontrado")
    if not cobro.pdf_factura_b64:
        raise HTTPException(status_code=404, detail="Factura no disponible aún")
    return {"pdf_base64": cobro.pdf_factura_b64, "folio": cobro.folio_haulmer}


# ─────────────────────────────────────────────────────────────────────────────
# Rutas ADMIN — Configuración de planes
# ─────────────────────────────────────────────────────────────────────────────

_DEFAULTS_PLANES = {
    "TARIFA_A": {
        "params": {
            "tipo_calculo": "UMBRAL_FIJO",
            "base": 300_000,
            "max_incluidos": 24,
            "extra_por": 12_500,
            "variable": "conductores",
        },
        "descripcion_contrato": (
            "Cargo Fijo Base: $300.000 (trescientos mil pesos) neto mensual por hasta 24 conductores activos. "
            "Por cada conductor activo sobre los 24, $12.500 (doce mil quinientos pesos) neto mensual adicional. "
            "A todos los valores indicados se agrega el Impuesto al Valor Agregado (IVA) vigente."
        ),
    },
    "TARIFA_B": {
        "params": {
            "tipo_calculo": "BLOQUES",
            "base": 1_000_000,
            "max_incluidos": 25_000,
            "extra_por": 250_000,
            "bloque": 5_000,
            "variable": "envíos",
        },
        "descripcion_contrato": (
            "Cargo Fijo Base: $1.000.000 (un millón de pesos) neto mensual por hasta 25.000 envíos mensuales. "
            "Por cada 5.000 envíos adicionales sobre los 25.000, $250.000 (doscientos cincuenta mil pesos) neto mensual adicional. "
            "A todos los valores indicados se agrega el Impuesto al Valor Agregado (IVA) vigente."
        ),
    },
    "TARIFA_C": {
        "params": {
            "tipo_calculo": "BASE_UF",
            "base_uf": 2.0,
            "extra_por": 10_000,
            "variable": "conductores",
        },
        "descripcion_contrato": (
            "Cargo Fijo Base: 2 UF (dos Unidades de Fomento) neto mensual, calculadas al valor de la UF "
            "del último día del mes de facturación. "
            "Más $10.000 (diez mil pesos) neto mensual por cada conductor activo registrado en la plataforma. "
            "A todos los valores indicados se agrega el Impuesto al Valor Agregado (IVA) vigente."
        ),
    },
}


def _seed_planes_si_faltan(db: Session) -> None:
    """Crea los registros de planes con valores por defecto si no existen."""
    for plan_key, data in _DEFAULTS_PLANES.items():
        exists = db.query(ConfigPlanInquilino).filter_by(plan=plan_key).first()
        if not exists:
            db.add(ConfigPlanInquilino(
                plan=plan_key,
                params=data["params"],
                descripcion_contrato=data["descripcion_contrato"],
            ))
    db.commit()


@router.get("/config/planes", response_model=List[ConfigPlanInquilinoOut])
def listar_planes(
    db: Session = Depends(get_db),
    _=Depends(require_permission("inquilinos")),
):
    """Lista la configuración actual de los 3 planes Tracking Tech."""
    _seed_planes_si_faltan(db)
    planes = db.query(ConfigPlanInquilino).order_by(ConfigPlanInquilino.plan).all()
    return planes


@router.put("/config/planes/{plan}", response_model=ConfigPlanInquilinoOut)
def actualizar_plan(
    plan: str,
    body: ConfigPlanInquilinoUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_permission("inquilinos")),
):
    """Actualiza los parámetros y/o descripción de contrato de un plan."""
    plan = plan.upper()
    if plan not in _DEFAULTS_PLANES:
        raise HTTPException(status_code=404, detail=f"Plan '{plan}' no existe. Opciones: TARIFA_A, TARIFA_B, TARIFA_C")

    _seed_planes_si_faltan(db)
    cfg = db.query(ConfigPlanInquilino).filter_by(plan=plan).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Config no encontrada")

    cfg.params = body.params
    if body.descripcion_contrato is not None:
        cfg.descripcion_contrato = body.descripcion_contrato
    db.commit()
    db.refresh(cfg)
    return cfg


@router.post("/config/planes/reset", response_model=List[ConfigPlanInquilinoOut])
def resetear_planes(
    db: Session = Depends(get_db),
    _=Depends(require_permission("inquilinos")),
):
    """Restaura todos los planes a los valores por defecto."""
    for plan_key, data in _DEFAULTS_PLANES.items():
        cfg = db.query(ConfigPlanInquilino).filter_by(plan=plan_key).first()
        if cfg:
            cfg.params = data["params"]
            cfg.descripcion_contrato = data["descripcion_contrato"]
        else:
            db.add(ConfigPlanInquilino(plan=plan_key, **data))
    db.commit()
    return db.query(ConfigPlanInquilino).order_by(ConfigPlanInquilino.plan).all()


@router.post("/config/planes", response_model=ConfigPlanInquilinoOut, status_code=201)
def crear_plan(
    body: ConfigPlanInquilinoCreate,
    db: Session = Depends(get_db),
    _=Depends(require_permission("inquilinos")),
):
    """Crea un nuevo plan de arriendo personalizado."""
    clave = body.plan.upper().replace(" ", "_")
    if db.query(ConfigPlanInquilino).filter_by(plan=clave).first():
        raise HTTPException(status_code=409, detail=f"Ya existe un plan con el nombre '{clave}'")
    if "tipo_calculo" not in body.params:
        raise HTTPException(status_code=422, detail="El campo 'tipo_calculo' es obligatorio en params (UMBRAL_FIJO | BLOQUES | BASE_UF | PLANA)")
    cfg = ConfigPlanInquilino(
        plan=clave,
        params=body.params,
        descripcion_contrato=body.descripcion_contrato,
    )
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return cfg


@router.delete("/config/planes/{plan}", status_code=204)
def eliminar_plan(
    plan: str,
    db: Session = Depends(get_db),
    _=Depends(require_permission("inquilinos")),
):
    """Elimina un plan. No se puede eliminar si hay inquilinos activos con ese plan."""
    plan = plan.upper()
    cfg = db.query(ConfigPlanInquilino).filter_by(plan=plan).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="Plan no encontrado")
    # Verificar que no haya inquilinos con este plan
    en_uso = db.query(Inquilino).filter(Inquilino.plan == plan, Inquilino.activo == True).count()
    if en_uso:
        raise HTTPException(
            status_code=409,
            detail=f"No se puede eliminar: {en_uso} inquilino(s) activo(s) usan este plan"
        )
    db.delete(cfg)
    db.commit()
