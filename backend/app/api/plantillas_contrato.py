"""
Router de plantillas de contrato (admin).

Endpoints:
  GET    /plantillas-contrato                    — lista (filtros: activa, slug)
  GET    /plantillas-contrato/variables          — variables disponibles para el editor
  GET    /plantillas-contrato/{id}               — detalle
  POST   /plantillas-contrato                    — crea nueva plantilla (versión 1)
  POST   /plantillas-contrato/{id}/nueva-version — publica nueva versión basada en otra
  PUT    /plantillas-contrato/{id}               — edita (solo si todavía no se ha usado)
  POST   /plantillas-contrato/{id}/activar       — activa (desactiva las demás del mismo slug)
  POST   /plantillas-contrato/{id}/desactivar
  POST   /plantillas-contrato/{id}/preview       — renderiza con un trabajador
  POST   /plantillas-contrato/desde-anexo/{anexo_id} — clona desde un anexo firmado
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc

from app.database import get_db
from app.auth import require_permission, require_admin_or_administracion
from app.models import (
    AnexoContrato,
    ConfiguracionLegal,
    ContratoTrabajadorVersion,
    PlantillaContrato,
    Trabajador,
)
from app.services.plantillas_engine import (
    VARIABLES_DISPONIBLES,
    construir_contexto,
    detectar_faltantes,
    renderizar,
)
from app.services.contratos import obtener_config_legal


router = APIRouter(prefix="/plantillas-contrato", tags=["Plantillas de Contrato"])


# ── Schemas ─────────────────────────────────────────────────────────────────
class PlantillaIn(BaseModel):
    slug: str
    nombre: str
    descripcion: Optional[str] = None
    tipo_contrato: Optional[str] = None
    aplica_a_cargos: Optional[List[str]] = None
    aplica_a_jornadas: Optional[List[int]] = None
    contenido: str = ""
    clausulas_extra: Optional[List[dict]] = None
    notas_version: Optional[str] = None


class PlantillaUpdate(BaseModel):
    nombre: Optional[str] = None
    descripcion: Optional[str] = None
    tipo_contrato: Optional[str] = None
    aplica_a_cargos: Optional[List[str]] = None
    aplica_a_jornadas: Optional[List[int]] = None
    contenido: Optional[str] = None
    clausulas_extra: Optional[List[dict]] = None
    notas_version: Optional[str] = None


class PreviewIn(BaseModel):
    trabajador_id: int
    contrato_version_id: Optional[int] = None  # si no viene, usa la vigente o un objeto vacío


# ── Mapper ──────────────────────────────────────────────────────────────────
def _to_dict(p: PlantillaContrato) -> dict:
    return {
        "id": p.id,
        "slug": p.slug,
        "nombre": p.nombre,
        "descripcion": p.descripcion,
        "tipo_contrato": p.tipo_contrato,
        "aplica_a_cargos": p.aplica_a_cargos,
        "aplica_a_jornadas": p.aplica_a_jornadas,
        "contenido": p.contenido,
        "clausulas_extra": p.clausulas_extra,
        "version": p.version,
        "activa": bool(p.activa),
        "creada_por": p.creada_por,
        "creada_desde_anexo_id": p.creada_desde_anexo_id,
        "notas_version": p.notas_version,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


# ── Endpoints ───────────────────────────────────────────────────────────────
@router.get("/variables")
def listar_variables(
    current_user: dict = Depends(require_admin_or_administracion),
):
    """Variables disponibles para insertar en el editor de plantillas."""
    return VARIABLES_DISPONIBLES


@router.get("")
def listar(
    activa: Optional[bool] = None,
    slug: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    q = db.query(PlantillaContrato)
    if activa is not None:
        q = q.filter(PlantillaContrato.activa == activa)
    if slug:
        q = q.filter(PlantillaContrato.slug == slug)
    rows = q.order_by(
        PlantillaContrato.slug.asc(),
        PlantillaContrato.version.desc(),
    ).all()
    return [_to_dict(p) for p in rows]


@router.get("/{plantilla_id}")
def detalle(
    plantilla_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    p = db.get(PlantillaContrato, plantilla_id)
    if not p:
        raise HTTPException(status_code=404, detail="Plantilla no encontrada")
    return _to_dict(p)


@router.post("", status_code=201)
def crear(
    payload: PlantillaIn,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_permission("rrhh-plantillas:editar")),
):
    if not payload.slug or not payload.nombre:
        raise HTTPException(status_code=400, detail="slug y nombre son requeridos")
    # Si ya existe slug, esta es nueva versión (evita choques de versión)
    siguiente = (
        db.query(sqlfunc.coalesce(sqlfunc.max(PlantillaContrato.version), 0))
        .filter(PlantillaContrato.slug == payload.slug)
        .scalar()
    ) or 0
    siguiente += 1

    # Si ya había una activa en este slug, la nueva queda activa y desactiva las anteriores
    if siguiente > 1:
        db.query(PlantillaContrato).filter(
            PlantillaContrato.slug == payload.slug,
            PlantillaContrato.activa == True,  # noqa: E712
        ).update({PlantillaContrato.activa: False}, synchronize_session=False)

    p = PlantillaContrato(
        slug=payload.slug,
        nombre=payload.nombre,
        descripcion=payload.descripcion,
        tipo_contrato=payload.tipo_contrato,
        aplica_a_cargos=payload.aplica_a_cargos,
        aplica_a_jornadas=payload.aplica_a_jornadas,
        contenido=payload.contenido,
        clausulas_extra=payload.clausulas_extra,
        version=siguiente,
        activa=True,
        creada_por=current_user.get("nombre"),
        notas_version=payload.notas_version,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return _to_dict(p)


@router.post("/{plantilla_id}/nueva-version")
def nueva_version(
    plantilla_id: int,
    payload: PlantillaUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_permission("rrhh-plantillas:editar")),
):
    base = db.get(PlantillaContrato, plantilla_id)
    if not base:
        raise HTTPException(status_code=404, detail="Plantilla base no encontrada")
    siguiente = (
        db.query(sqlfunc.coalesce(sqlfunc.max(PlantillaContrato.version), 0))
        .filter(PlantillaContrato.slug == base.slug)
        .scalar()
    ) or 0
    siguiente += 1

    db.query(PlantillaContrato).filter(
        PlantillaContrato.slug == base.slug,
        PlantillaContrato.activa == True,  # noqa: E712
    ).update({PlantillaContrato.activa: False}, synchronize_session=False)

    p = PlantillaContrato(
        slug=base.slug,
        nombre=payload.nombre or base.nombre,
        descripcion=payload.descripcion if payload.descripcion is not None else base.descripcion,
        tipo_contrato=payload.tipo_contrato or base.tipo_contrato,
        aplica_a_cargos=payload.aplica_a_cargos if payload.aplica_a_cargos is not None else base.aplica_a_cargos,
        aplica_a_jornadas=payload.aplica_a_jornadas if payload.aplica_a_jornadas is not None else base.aplica_a_jornadas,
        contenido=payload.contenido if payload.contenido is not None else base.contenido,
        clausulas_extra=payload.clausulas_extra if payload.clausulas_extra is not None else base.clausulas_extra,
        version=siguiente,
        activa=True,
        creada_por=current_user.get("nombre"),
        notas_version=payload.notas_version,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return _to_dict(p)


@router.put("/{plantilla_id}")
def editar(
    plantilla_id: int,
    payload: PlantillaUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_permission("rrhh-plantillas:editar")),
):
    """
    Edita una plantilla in-place. Solo recomendado si todavía no se ha usado para
    emitir un contrato. Si ya hay anexos generados con ella, conviene crear nueva versión.
    """
    p = db.get(PlantillaContrato, plantilla_id)
    if not p:
        raise HTTPException(status_code=404, detail="Plantilla no encontrada")

    for field, value in payload.dict(exclude_unset=True).items():
        setattr(p, field, value)

    p.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(p)
    return _to_dict(p)


@router.post("/{plantilla_id}/activar")
def activar(
    plantilla_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_permission("rrhh-plantillas:editar")),
):
    p = db.get(PlantillaContrato, plantilla_id)
    if not p:
        raise HTTPException(status_code=404, detail="Plantilla no encontrada")
    db.query(PlantillaContrato).filter(
        PlantillaContrato.slug == p.slug,
        PlantillaContrato.id != p.id,
        PlantillaContrato.activa == True,  # noqa: E712
    ).update({PlantillaContrato.activa: False}, synchronize_session=False)
    p.activa = True
    db.commit()
    db.refresh(p)
    return _to_dict(p)


@router.post("/{plantilla_id}/desactivar")
def desactivar(
    plantilla_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_permission("rrhh-plantillas:editar")),
):
    p = db.get(PlantillaContrato, plantilla_id)
    if not p:
        raise HTTPException(status_code=404, detail="Plantilla no encontrada")
    p.activa = False
    db.commit()
    db.refresh(p)
    return _to_dict(p)


@router.post("/{plantilla_id}/preview")
def preview(
    plantilla_id: int,
    payload: PreviewIn,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    p = db.get(PlantillaContrato, plantilla_id)
    if not p:
        raise HTTPException(status_code=404, detail="Plantilla no encontrada")
    t = db.get(Trabajador, payload.trabajador_id)
    if not t:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")

    contrato: Optional[ContratoTrabajadorVersion] = None
    if payload.contrato_version_id:
        contrato = db.get(ContratoTrabajadorVersion, payload.contrato_version_id)
    if contrato is None:
        # Construye una versión "in-memory" desde el perfil del trabajador
        contrato = ContratoTrabajadorVersion(
            trabajador_id=t.id,
            sueldo_liquido=t.sueldo_liquido,
            sueldo_base=t.sueldo_base,
            gratificacion=t.gratificacion,
            movilizacion=t.movilizacion,
            colacion=t.colacion,
            viaticos=t.viaticos,
            jornada_semanal_horas=44,
            tipo_jornada="COMPLETA",
            cargo=t.cargo,
            tipo_contrato=t.tipo_contrato,
        )

    cfg = obtener_config_legal(db)
    ctx = construir_contexto(t, contrato, cfg)
    rendered = renderizar(p.contenido, ctx)
    faltantes = detectar_faltantes(rendered)

    return {
        "rendered": rendered,
        "contexto_usado": ctx,
        "faltantes": faltantes,
    }


@router.post("/desde-anexo/{anexo_id}", status_code=201)
def clonar_desde_anexo(
    anexo_id: int,
    slug: str,
    nombre: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_permission("rrhh-plantillas:editar")),
):
    """
    Crea una nueva plantilla tomando como base un anexo firmado.
    El admin debe revisar el contenido (que será texto sin placeholders)
    y agregar los placeholders {{ }} manualmente para que sea reusable.

    Por ahora se incrusta una guía mínima al inicio del contenido para que el
    administrador edite y agregue las variables.
    """
    a = db.get(AnexoContrato, anexo_id)
    if not a:
        raise HTTPException(status_code=404, detail="Anexo no encontrado")

    guia = (
        "<!-- Esta plantilla fue clonada desde un anexo firmado.\n"
        "Reemplazá los datos concretos por placeholders, por ejemplo:\n"
        "  {{trabajador.nombre}}, {{trabajador.rut}},\n"
        "  {{contrato.sueldo_liquido}}, {{contrato.cargo}}, {{contrato.jornada_semanal_horas}},\n"
        "  {{empresa.razon_social}}, {{rep_legal.nombre}}, {{fecha.hoy_largo}} -->\n\n"
        f"# {a.titulo}\n\n"
        "Edite acá el cuerpo del contrato basándose en el anexo original."
    )

    siguiente = (
        db.query(sqlfunc.coalesce(sqlfunc.max(PlantillaContrato.version), 0))
        .filter(PlantillaContrato.slug == slug)
        .scalar()
    ) or 0
    siguiente += 1

    p = PlantillaContrato(
        slug=slug,
        nombre=nombre,
        descripcion=f"Clonada desde anexo #{a.id}",
        contenido=guia,
        version=siguiente,
        activa=False,  # nace desactivada hasta que el admin la deje lista
        creada_por=current_user.get("nombre"),
        creada_desde_anexo_id=a.id,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return _to_dict(p)
