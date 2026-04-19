"""
Router para gestión contractual de trabajadores.

Endpoints:
  GET    /contratos/trabajador/{id}/versiones
  POST   /contratos/trabajador/{id}/versiones        — crea nueva versión + anexo
  GET    /contratos/trabajador/{id}/vigente
  POST   /contratos/trabajador/{id}/contrato-fisico  — sube PDF físico digitalizado
  GET    /contratos/trabajador/{id}/anexos
  POST   /contratos/trabajador/{id}/validar-imm

  GET    /contratos/configuracion-legal
  PUT    /contratos/configuracion-legal

  GET    /contratos/anexos/{id}/pdf
  POST   /contratos/anexos/{id}/regenerar
  POST   /contratos/portal/anexos/{id}/firmar         — firma desde portal
  GET    /contratos/portal/anexos                      — lista anexos del trabajador
  GET    /contratos/portal/anexos/{id}/pdf
"""
from __future__ import annotations

import base64
from datetime import date, datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import require_admin_or_administracion, get_current_user, RolEnum
from app.models import (
    Trabajador,
    ContratoTrabajadorVersion,
    AnexoContrato,
    ConfiguracionLegal,
    EstadoAnexoEnum,
    TipoAnexoEnum,
    MotivoVersionContratoEnum,
    TipoJornadaEnum,
)
from app.services.contratos import (
    obtener_config_legal,
    obtener_version_vigente,
    crear_version,
    validar_imm_para_mes,
)
from app.services.anexos_engine import crear_anexo_para_version, generar_pdf_anexo

router = APIRouter(prefix="/contratos", tags=["Contratos"])


# ── Schemas ─────────────────────────────────────────────────────────────────
class VersionContratoIn(BaseModel):
    vigente_desde: date
    sueldo_liquido: int
    sueldo_base: int = 0
    gratificacion: int = 0
    movilizacion: int = 0
    colacion: int = 0
    viaticos: int = 0
    jornada_semanal_horas: int = Field(default=44, ge=1, le=60)
    tipo_jornada: str = TipoJornadaEnum.COMPLETA.value
    distribucion_jornada: Optional[str] = None
    cargo: Optional[str] = None
    tipo_contrato: Optional[str] = None
    motivo: str = MotivoVersionContratoEnum.CONTRATACION.value
    notas: Optional[str] = None
    generar_anexo: bool = True


class ConfigLegalIn(BaseModel):
    jornada_legal_vigente: int = Field(..., ge=1, le=60)
    jornada_legal_proxima: Optional[int] = Field(default=None, ge=1, le=60)
    jornada_legal_proxima_desde: Optional[date] = None
    rep_legal_nombre: Optional[str] = None
    rep_legal_rut: Optional[str] = None
    empresa_razon_social: Optional[str] = None
    empresa_rut: Optional[str] = None
    empresa_direccion: Optional[str] = None


# ── Mappers ─────────────────────────────────────────────────────────────────
def _version_to_dict(v: ContratoTrabajadorVersion) -> dict:
    return {
        "id": v.id,
        "trabajador_id": v.trabajador_id,
        "vigente_desde": v.vigente_desde.isoformat() if v.vigente_desde else None,
        "vigente_hasta": v.vigente_hasta.isoformat() if v.vigente_hasta else None,
        "sueldo_liquido": v.sueldo_liquido,
        "sueldo_base": v.sueldo_base,
        "gratificacion": v.gratificacion,
        "movilizacion": v.movilizacion,
        "colacion": v.colacion,
        "viaticos": v.viaticos,
        "jornada_semanal_horas": v.jornada_semanal_horas,
        "tipo_jornada": v.tipo_jornada,
        "distribucion_jornada": v.distribucion_jornada,
        "cargo": v.cargo,
        "tipo_contrato": v.tipo_contrato,
        "motivo": v.motivo,
        "notas": v.notas,
        "creado_por": v.creado_por,
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }


def _anexo_to_dict(a: AnexoContrato) -> dict:
    return {
        "id": a.id,
        "trabajador_id": a.trabajador_id,
        "version_id": a.version_id,
        "tipo": a.tipo,
        "titulo": a.titulo,
        "requiere_firma_trabajador": a.requiere_firma_trabajador,
        "estado": a.estado,
        "tiene_pdf_generado": bool(a.pdf_generado),
        "tiene_pdf_subido": bool(a.pdf_subido_path),
        "firmado_at": a.firmado_at.isoformat() if a.firmado_at else None,
        "visto_at": a.visto_at.isoformat() if a.visto_at else None,
        "creado_por": a.creado_por,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
    }


def _config_to_dict(c: ConfiguracionLegal) -> dict:
    return {
        "jornada_legal_vigente": c.jornada_legal_vigente,
        "jornada_legal_proxima": c.jornada_legal_proxima,
        "jornada_legal_proxima_desde": c.jornada_legal_proxima_desde.isoformat() if c.jornada_legal_proxima_desde else None,
        "rep_legal_nombre": c.rep_legal_nombre,
        "rep_legal_rut": c.rep_legal_rut,
        "empresa_razon_social": c.empresa_razon_social,
        "empresa_rut": c.empresa_rut,
        "empresa_direccion": c.empresa_direccion,
        "actualizado_por": c.actualizado_por,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


# ── Versiones contractuales (admin) ─────────────────────────────────────────
@router.get("/trabajador/{trabajador_id}/versiones")
def listar_versiones(
    trabajador_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    versiones = (
        db.query(ContratoTrabajadorVersion)
        .filter_by(trabajador_id=trabajador_id)
        .order_by(ContratoTrabajadorVersion.vigente_desde.desc())
        .all()
    )
    return [_version_to_dict(v) for v in versiones]


@router.get("/trabajador/{trabajador_id}/vigente")
def version_vigente(
    trabajador_id: int,
    en_fecha: Optional[date] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    v = obtener_version_vigente(db, trabajador_id, en_fecha)
    return _version_to_dict(v) if v else None


@router.post("/trabajador/{trabajador_id}/versiones")
def crear_version_endpoint(
    trabajador_id: int,
    payload: VersionContratoIn,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    t = db.get(Trabajador, trabajador_id)
    if not t:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")

    anterior = obtener_version_vigente(db, trabajador_id, payload.vigente_desde)

    # Si no envían sueldo_base, lo derivamos del cálculo gross-from-net
    sueldo_base = payload.sueldo_base
    gratificacion = payload.gratificacion
    if sueldo_base <= 0 and payload.sueldo_liquido > 0:
        from app.services.remuneraciones import calcular_desde_liquido
        from app.services.parametros import obtener_parametros
        params = obtener_parametros(db, payload.vigente_desde.year, payload.vigente_desde.month)
        r = calcular_desde_liquido(
            sueldo_liquido=payload.sueldo_liquido,
            afp=t.afp,
            sistema_salud=t.sistema_salud,
            monto_cotizacion_salud=t.monto_cotizacion_salud,
            tipo_contrato=payload.tipo_contrato or t.tipo_contrato,
            movilizacion=payload.movilizacion,
            colacion=payload.colacion,
            viaticos=payload.viaticos,
            utm=int(params["utm"]),
            valor_uf=float(params["uf"]),
            imm=int(params["imm"]),
        )
        sueldo_base = r.sueldo_base
        gratificacion = r.gratificacion

    nueva = crear_version(
        db,
        trabajador_id=trabajador_id,
        vigente_desde=payload.vigente_desde,
        sueldo_liquido=payload.sueldo_liquido,
        sueldo_base=sueldo_base,
        gratificacion=gratificacion,
        movilizacion=payload.movilizacion,
        colacion=payload.colacion,
        viaticos=payload.viaticos,
        jornada_semanal_horas=payload.jornada_semanal_horas,
        tipo_jornada=payload.tipo_jornada,
        distribucion_jornada=payload.distribucion_jornada,
        cargo=payload.cargo,
        tipo_contrato=payload.tipo_contrato,
        motivo=payload.motivo,
        notas=payload.notas,
        creado_por=current_user.get("nombre") or current_user.get("username"),
    )

    # Sincronizar la ficha base del trabajador con el último cambio
    t.sueldo_liquido = payload.sueldo_liquido
    t.sueldo_base = sueldo_base
    t.gratificacion = gratificacion
    t.movilizacion = payload.movilizacion
    t.colacion = payload.colacion
    t.viaticos = payload.viaticos
    if payload.tipo_contrato:
        t.tipo_contrato = payload.tipo_contrato
    if payload.cargo:
        t.cargo = payload.cargo

    anexo = None
    if payload.generar_anexo:
        anexo = crear_anexo_para_version(
            db,
            trabajador=t,
            version_nueva=nueva,
            version_anterior=anterior,
            creado_por=current_user.get("nombre") or current_user.get("username"),
        )

    db.commit()
    db.refresh(nueva)
    return {
        "version": _version_to_dict(nueva),
        "anexo": _anexo_to_dict(anexo) if anexo else None,
    }


# ── Subir contrato físico digitalizado (PDF) ───────────────────────────────
@router.post("/trabajador/{trabajador_id}/contrato-fisico")
async def subir_contrato_fisico(
    trabajador_id: int,
    archivo: UploadFile = File(...),
    vigente_desde: date = Form(...),
    sueldo_liquido: int = Form(...),
    jornada_semanal_horas: int = Form(44),
    cargo: Optional[str] = Form(None),
    tipo_contrato: Optional[str] = Form(None),
    notas: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    """
    Migra un contrato físico (PDF) al sistema. Crea una versión contractual con
    motivo CONTRATACION y registra el PDF subido como anexo CONTRATO_INICIAL.
    """
    t = db.get(Trabajador, trabajador_id)
    if not t:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")

    contenido = await archivo.read()
    if not contenido or len(contenido) == 0:
        raise HTTPException(status_code=400, detail="Archivo vacío")

    pdf_b64 = base64.b64encode(contenido).decode("ascii")

    nueva = crear_version(
        db,
        trabajador_id=trabajador_id,
        vigente_desde=vigente_desde,
        sueldo_liquido=sueldo_liquido,
        jornada_semanal_horas=jornada_semanal_horas,
        cargo=cargo,
        tipo_contrato=tipo_contrato,
        motivo=MotivoVersionContratoEnum.CONTRATACION.value,
        notas=notas or "Contrato físico digitalizado",
        creado_por=current_user.get("nombre") or current_user.get("username"),
    )

    anexo = AnexoContrato(
        trabajador_id=trabajador_id,
        version_id=nueva.id,
        tipo=TipoAnexoEnum.CONTRATO_INICIAL.value,
        titulo="Contrato Individual de Trabajo (digitalizado)",
        pdf_generado=pdf_b64,  # guardamos el PDF físico aquí mismo
        requiere_firma_trabajador=False,  # ya viene firmado en papel
        estado=EstadoAnexoEnum.FIRMADO.value,
        firmado_at=datetime.utcnow(),
        creado_por=current_user.get("nombre") or current_user.get("username"),
    )
    db.add(anexo)
    db.commit()
    db.refresh(nueva)
    db.refresh(anexo)

    return {
        "version": _version_to_dict(nueva),
        "anexo": _anexo_to_dict(anexo),
    }


# ── Anexos (admin) ──────────────────────────────────────────────────────────
@router.get("/trabajador/{trabajador_id}/anexos")
def listar_anexos_admin(
    trabajador_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    anexos = (
        db.query(AnexoContrato)
        .filter_by(trabajador_id=trabajador_id)
        .order_by(AnexoContrato.created_at.desc())
        .all()
    )
    return [_anexo_to_dict(a) for a in anexos]


@router.get("/anexos/{anexo_id}/pdf")
def descargar_pdf_anexo(
    anexo_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    a = db.get(AnexoContrato, anexo_id)
    if not a:
        raise HTTPException(status_code=404, detail="Anexo no encontrado")
    pdf_bytes = _resolver_pdf_anexo(a)
    nombre = (a.titulo or "anexo").replace(" ", "_")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{nombre}.pdf"'},
    )


@router.post("/anexos/{anexo_id}/regenerar")
def regenerar_pdf_anexo(
    anexo_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    a = db.get(AnexoContrato, anexo_id)
    if not a:
        raise HTTPException(status_code=404, detail="Anexo no encontrado")
    if a.tipo == TipoAnexoEnum.CONTRATO_INICIAL.value and a.pdf_subido_path is None and a.pdf_generado:
        # Si es un contrato físico ya subido, no se regenera
        if a.firmado_at and not a.version:
            raise HTTPException(status_code=400, detail="El PDF subido no se puede regenerar")
    if not a.version:
        raise HTTPException(status_code=400, detail="Anexo sin versión asociada")

    t = db.get(Trabajador, a.trabajador_id)
    cfg = obtener_config_legal(db)
    anterior = (
        db.query(ContratoTrabajadorVersion)
        .filter(
            ContratoTrabajadorVersion.trabajador_id == a.trabajador_id,
            ContratoTrabajadorVersion.id != a.version.id,
            ContratoTrabajadorVersion.vigente_desde < a.version.vigente_desde,
        )
        .order_by(ContratoTrabajadorVersion.vigente_desde.desc())
        .first()
    )
    pdf_bytes = generar_pdf_anexo(
        anexo=a,
        trabajador=t,
        version_nueva=a.version,
        version_anterior=anterior,
        rep_legal_nombre=cfg.rep_legal_nombre or "Adriana Colina Aguilar",
        rep_legal_rut=cfg.rep_legal_rut or "25.936.753-0",
        empresa_razon_social=cfg.empresa_razon_social or "E-Courier SPA",
        empresa_rut=cfg.empresa_rut or "—",
    )
    a.pdf_generado = base64.b64encode(pdf_bytes).decode("ascii")
    db.commit()
    return _anexo_to_dict(a)


def _resolver_pdf_anexo(a: AnexoContrato) -> bytes:
    if a.pdf_generado:
        return base64.b64decode(a.pdf_generado)
    if a.pdf_subido_path:
        try:
            with open(a.pdf_subido_path, "rb") as f:
                return f.read()
        except Exception:
            raise HTTPException(status_code=404, detail="PDF físico no disponible en disco")
    raise HTTPException(status_code=404, detail="Anexo sin PDF asociado")


# ── Validador IMM ───────────────────────────────────────────────────────────
@router.post("/validar-imm")
def validar_imm(
    mes: int,
    anio: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    from app.services.parametros import obtener_parametros
    params = obtener_parametros(db, anio, mes)
    alertas = validar_imm_para_mes(db, mes, anio, int(params["imm"]))
    return {
        "mes": mes,
        "anio": anio,
        "imm_legal": int(params["imm"]),
        "alertas": alertas,
        "total_alertas": len(alertas),
    }


# ── Configuración legal ─────────────────────────────────────────────────────
@router.get("/configuracion-legal")
def obtener_config(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    cfg = obtener_config_legal(db)
    return _config_to_dict(cfg)


@router.put("/configuracion-legal")
def actualizar_config(
    payload: ConfigLegalIn,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    cfg = obtener_config_legal(db)
    cfg.jornada_legal_vigente = payload.jornada_legal_vigente
    cfg.jornada_legal_proxima = payload.jornada_legal_proxima
    cfg.jornada_legal_proxima_desde = payload.jornada_legal_proxima_desde
    if payload.rep_legal_nombre is not None:
        cfg.rep_legal_nombre = payload.rep_legal_nombre
    if payload.rep_legal_rut is not None:
        cfg.rep_legal_rut = payload.rep_legal_rut
    if payload.empresa_razon_social is not None:
        cfg.empresa_razon_social = payload.empresa_razon_social
    if payload.empresa_rut is not None:
        cfg.empresa_rut = payload.empresa_rut
    if payload.empresa_direccion is not None:
        cfg.empresa_direccion = payload.empresa_direccion
    cfg.actualizado_por = current_user.get("nombre") or current_user.get("username")
    db.commit()
    return _config_to_dict(cfg)


# ── Portal trabajador ───────────────────────────────────────────────────────
def _require_trabajador(current_user: dict, db: Session) -> Trabajador:
    if current_user.get("rol") != RolEnum.TRABAJADOR:
        raise HTTPException(status_code=403, detail="Solo trabajadores")
    t = db.query(Trabajador).filter(Trabajador.id == current_user["id"]).first()
    if not t:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")
    return t


@router.get("/portal/anexos")
def listar_anexos_portal(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    t = _require_trabajador(current_user, db)
    anexos = (
        db.query(AnexoContrato)
        .filter_by(trabajador_id=t.id)
        .order_by(AnexoContrato.created_at.desc())
        .all()
    )
    return [_anexo_to_dict(a) for a in anexos]


@router.get("/portal/anexos/{anexo_id}/pdf")
def descargar_pdf_anexo_portal(
    anexo_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    t = _require_trabajador(current_user, db)
    a = db.get(AnexoContrato, anexo_id)
    if not a or a.trabajador_id != t.id:
        raise HTTPException(status_code=404, detail="Anexo no encontrado")
    if a.visto_at is None:
        a.visto_at = datetime.utcnow()
        db.commit()
    pdf_bytes = _resolver_pdf_anexo(a)
    nombre = (a.titulo or "anexo").replace(" ", "_")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{nombre}.pdf"'},
    )


@router.post("/portal/anexos/{anexo_id}/firmar")
def firmar_anexo_portal(
    anexo_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Firma un anexo desde el portal del trabajador usando su firma_base64
    almacenada. Si no tiene firma todavía, retorna 400 indicando que debe
    crear su firma primero.
    """
    t = _require_trabajador(current_user, db)
    a = db.get(AnexoContrato, anexo_id)
    if not a or a.trabajador_id != t.id:
        raise HTTPException(status_code=404, detail="Anexo no encontrado")
    if not a.requiere_firma_trabajador:
        raise HTTPException(status_code=400, detail="Este anexo no requiere firma")
    if a.estado == EstadoAnexoEnum.FIRMADO.value:
        return _anexo_to_dict(a)
    firma = getattr(t, "firma_base64", None)
    if not firma:
        raise HTTPException(
            status_code=400,
            detail="Debes registrar tu firma en 'Mi Firma' antes de firmar anexos.",
        )

    # Snapshot de la firma + regeneración del PDF con la firma
    a.firma_trabajador_snapshot = firma
    a.firmado_at = datetime.utcnow()
    a.firmado_ip = request.client.host if request.client else None
    a.estado = EstadoAnexoEnum.FIRMADO.value

    if a.version:
        cfg = obtener_config_legal(db)
        anterior = (
            db.query(ContratoTrabajadorVersion)
            .filter(
                ContratoTrabajadorVersion.trabajador_id == t.id,
                ContratoTrabajadorVersion.id != a.version.id,
                ContratoTrabajadorVersion.vigente_desde < a.version.vigente_desde,
            )
            .order_by(ContratoTrabajadorVersion.vigente_desde.desc())
            .first()
        )
        pdf_bytes = generar_pdf_anexo(
            anexo=a,
            trabajador=t,
            version_nueva=a.version,
            version_anterior=anterior,
            rep_legal_nombre=cfg.rep_legal_nombre or "Adriana Colina Aguilar",
            rep_legal_rut=cfg.rep_legal_rut or "25.936.753-0",
            empresa_razon_social=cfg.empresa_razon_social or "E-Courier SPA",
            empresa_rut=cfg.empresa_rut or "—",
        )
        a.pdf_generado = base64.b64encode(pdf_bytes).decode("ascii")

    db.commit()
    return _anexo_to_dict(a)
