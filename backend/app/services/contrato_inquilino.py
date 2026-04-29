"""
Servicio encapsulado para el flujo contractual de inquilinos.

Funciones principales:
  - emitir_contrato: genera AnexoContratoInquilino a partir de PlantillaContrato
  - emitir_anexo_reserva: genera automáticamente el anexo de reserva
  - puede_firmar_contrato: verifica si el inquilino está habilitado para firmar
  - firmar_anexo: registra firma, snapshot y regenera PDF
"""
from __future__ import annotations

import base64
import logging
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import (
    Inquilino,
    AnexoContratoInquilino,
    PlantillaContrato,
    ConfiguracionLegal,
    TipoAnexoInquilinoEnum,
    EstadoAnexoInquilinoEnum,
)
from app.services.plantillas_inquilino import construir_contexto_inquilino
from app.services.plantillas_engine import renderizar, detectar_faltantes
from app.services.anexos_engine import generar_pdf_contrato_generico

logger = logging.getLogger(__name__)

_DEFAULT_REP_NOMBRE = "Adriana Colina Aguilar"
_DEFAULT_REP_RUT = "25.936.753-0"
_DEFAULT_EMPRESA = "E-Courier SPA"
_DEFAULT_EMPRESA_RUT = "76.123.456-7"

# Slug de la plantilla de reserva (crear en admin con este slug)
SLUG_PLANTILLA_RESERVA = "reserva-inquilino"


def _obtener_cfg(db: Session) -> Optional[ConfiguracionLegal]:
    return db.query(ConfiguracionLegal).first()


def _rep_legal_datos(cfg: Optional[ConfiguracionLegal]) -> tuple[str, str, str, str]:
    if cfg:
        return (
            cfg.rep_legal_nombre or _DEFAULT_REP_NOMBRE,
            cfg.rep_legal_rut or _DEFAULT_REP_RUT,
            cfg.empresa_razon_social or _DEFAULT_EMPRESA,
            cfg.empresa_rut or _DEFAULT_EMPRESA_RUT,
        )
    return _DEFAULT_REP_NOMBRE, _DEFAULT_REP_RUT, _DEFAULT_EMPRESA, _DEFAULT_EMPRESA_RUT


def _pdf_b64(pdf_bytes: bytes) -> str:
    return base64.b64encode(pdf_bytes).decode("utf-8")


def preview_contrato(
    db: Session,
    inquilino: Inquilino,
    plantilla_id: int,
) -> dict:
    """Renderiza la plantilla con los datos del inquilino y devuelve el texto + faltantes."""
    plantilla = db.get(PlantillaContrato, plantilla_id)
    if not plantilla or not plantilla.activa:
        raise HTTPException(status_code=404, detail="Plantilla no encontrada o inactiva")

    cfg = _obtener_cfg(db)
    contexto = construir_contexto_inquilino(inquilino, cfg)
    rendered = renderizar(plantilla.contenido, contexto)
    faltantes = detectar_faltantes(rendered)

    return {
        "rendered": rendered,
        "faltantes": faltantes,
        "plantilla_id": plantilla.id,
        "plantilla_version": plantilla.version,
    }


def emitir_contrato(
    db: Session,
    inquilino: Inquilino,
    plantilla_id: int,
    titulo: Optional[str] = None,
    creado_por: Optional[str] = None,
) -> AnexoContratoInquilino:
    """
    Emite el contrato principal del inquilino.
    Si tiene reserva, también emite el anexo de reserva automáticamente.
    """
    plantilla = db.get(PlantillaContrato, plantilla_id)
    if not plantilla or not plantilla.activa:
        raise HTTPException(status_code=404, detail="Plantilla no encontrada o inactiva")

    cfg = _obtener_cfg(db)
    contexto = construir_contexto_inquilino(inquilino, cfg)
    rendered = renderizar(plantilla.contenido, contexto)
    rep_nombre, rep_rut, empresa, empresa_rut = _rep_legal_datos(cfg)

    titulo_final = titulo or plantilla.nombre or "Contrato de Arriendo Software Tracking Tech"
    pdf_bytes = generar_pdf_contrato_generico(
        rendered_md=rendered,
        titulo=titulo_final,
        firmante_nombre=inquilino.nombre_rep_legal or inquilino.razon_social or inquilino.email,
        firmante_rut=inquilino.rut_rep_legal,
        rep_legal_nombre=rep_nombre,
        rep_legal_rut=rep_rut,
        empresa_razon_social=empresa,
        empresa_rut=empresa_rut,
        firma_firmante_src=None,
        requiere_firma=True,
    )

    anexo = AnexoContratoInquilino(
        inquilino_id=inquilino.id,
        tipo=TipoAnexoInquilinoEnum.CONTRATO.value,
        titulo=titulo_final,
        pdf_generado=_pdf_b64(pdf_bytes),
        requiere_firma_inquilino=True,
        estado=EstadoAnexoInquilinoEnum.BORRADOR.value,
        plantilla_id=plantilla.id,
        plantilla_version=plantilla.version,
        contenido_renderizado=rendered,
        creado_por=creado_por,
    )
    db.add(anexo)
    db.flush()

    # Si tiene reserva, emitir el anexo de reserva automáticamente
    if inquilino.tiene_reserva and inquilino.monto_reserva:
        try:
            emitir_anexo_reserva(db, inquilino, cfg=cfg, creado_por=creado_por)
        except Exception as exc:
            logger.warning("No se pudo emitir anexo de reserva automáticamente: %s", exc)

    db.commit()
    db.refresh(anexo)
    return anexo


def emitir_anexo_reserva(
    db: Session,
    inquilino: Inquilino,
    cfg: Optional[ConfiguracionLegal] = None,
    creado_por: Optional[str] = None,
) -> AnexoContratoInquilino:
    """
    Genera automáticamente el AnexoContratoInquilino de tipo RESERVA.
    Busca la plantilla por slug; si no existe, genera uno con contenido predeterminado.
    """
    if cfg is None:
        cfg = _obtener_cfg(db)

    plantilla = db.query(PlantillaContrato).filter(
        PlantillaContrato.slug == SLUG_PLANTILLA_RESERVA,
        PlantillaContrato.activa == True,
    ).order_by(PlantillaContrato.version.desc()).first()

    monto_fmt = "$" + f"{int(inquilino.monto_reserva or 0):,}".replace(",", ".")

    if plantilla:
        contexto = construir_contexto_inquilino(inquilino, cfg)
        rendered = renderizar(plantilla.contenido, contexto)
        titulo = plantilla.nombre or "Anexo de Reserva"
    else:
        # Contenido predeterminado cuando no existe la plantilla
        titulo = "Anexo de Reserva — Software Tracking Tech"
        rendered = f"""# {titulo}

## Antecedentes

El presente anexo forma parte integral del contrato de arriendo de software suscrito entre
**E-Courier SPA** y **{{inquilino.razon_social}}** (en adelante «el Inquilino»).

## Condiciones de la Reserva

El Inquilino, previo al inicio del servicio, deberá efectuar una transferencia de reserva por
el monto de **{monto_fmt} (más IVA)** a la cuenta bancaria de E-Courier SPA.

Esta reserva tiene carácter de garantía de fiel cumplimiento del contrato y será descontada
del primer cobro mensual generado por el servicio, o bien, del primer cobro posterior al
período de mes sin costo (si aplica).

## Devolución de Reserva

La reserva será devuelta al Inquilino dentro de los 30 días siguientes a la terminación del
contrato, siempre que no existan deudas pendientes ni daños atribuibles al Inquilino.

## Aceptación

Las partes declaran haber leído y comprendido el contenido del presente anexo, aceptando
todas sus cláusulas.

Santiago, {{fecha.hoy_largo}}
"""
        contexto = construir_contexto_inquilino(inquilino, cfg)
        rendered = renderizar(rendered, contexto)

    rep_nombre, rep_rut, empresa, empresa_rut = _rep_legal_datos(cfg)
    pdf_bytes = generar_pdf_contrato_generico(
        rendered_md=rendered,
        titulo=titulo,
        firmante_nombre=inquilino.nombre_rep_legal or inquilino.razon_social or inquilino.email,
        firmante_rut=inquilino.rut_rep_legal,
        rep_legal_nombre=rep_nombre,
        rep_legal_rut=rep_rut,
        empresa_razon_social=empresa,
        empresa_rut=empresa_rut,
        firma_firmante_src=None,
        requiere_firma=True,
    )

    anexo = AnexoContratoInquilino(
        inquilino_id=inquilino.id,
        tipo=TipoAnexoInquilinoEnum.RESERVA.value,
        titulo=titulo,
        pdf_generado=_pdf_b64(pdf_bytes),
        requiere_firma_inquilino=True,
        estado=EstadoAnexoInquilinoEnum.BORRADOR.value,
        plantilla_id=plantilla.id if plantilla else None,
        plantilla_version=plantilla.version if plantilla else None,
        contenido_renderizado=rendered,
        creado_por=creado_por,
    )
    db.add(anexo)
    db.flush()
    return anexo


def regenerar_pdfs_con_perfil(
    db: Session,
    inquilino: Inquilino,
) -> list[AnexoContratoInquilino]:
    """
    Cuando el inquilino completa su perfil, re-renderiza y regenera el PDF de
    todos sus contratos/anexos en estado BORRADOR que tienen plantilla asociada.
    Así la fecha de emisión queda fijada desde que el admin emitió, pero el
    contenido refleja los datos reales del inquilino.
    """
    pendientes = db.query(AnexoContratoInquilino).filter(
        AnexoContratoInquilino.inquilino_id == inquilino.id,
        AnexoContratoInquilino.estado == EstadoAnexoInquilinoEnum.BORRADOR.value,
        AnexoContratoInquilino.plantilla_id.isnot(None),
    ).all()

    cfg = _obtener_cfg(db)
    rep_nombre, rep_rut, empresa, empresa_rut = _rep_legal_datos(cfg)
    contexto = construir_contexto_inquilino(inquilino, cfg)

    actualizados: list[AnexoContratoInquilino] = []
    for anexo in pendientes:
        plantilla = db.get(PlantillaContrato, anexo.plantilla_id)
        if not plantilla:
            continue
        rendered = renderizar(plantilla.contenido, contexto)
        pdf_bytes = generar_pdf_contrato_generico(
            rendered_md=rendered,
            titulo=anexo.titulo,
            firmante_nombre=inquilino.nombre_rep_legal or inquilino.razon_social or inquilino.email,
            firmante_rut=inquilino.rut_rep_legal,
            rep_legal_nombre=rep_nombre,
            rep_legal_rut=rep_rut,
            empresa_razon_social=empresa,
            empresa_rut=empresa_rut,
            firma_firmante_src=None,
            requiere_firma=True,
        )
        anexo.contenido_renderizado = rendered
        anexo.pdf_generado = _pdf_b64(pdf_bytes)
        actualizados.append(anexo)

    if actualizados:
        db.commit()
        for a in actualizados:
            db.refresh(a)
        logger.info(
            "Regenerados %d contratos/anexos para inquilino %s tras completar perfil",
            len(actualizados),
            inquilino.id,
        )

    return actualizados


def puede_firmar_contrato(
    db: Session,
    inquilino: Inquilino,
    anexo: AnexoContratoInquilino,
) -> tuple[bool, Optional[str]]:
    """
    Verifica si el inquilino puede firmar el anexo dado.

    Reglas:
    - El anexo debe estar en estado BORRADOR.
    - Si tiene reserva y el anexo es de tipo CONTRATO, debe existir un AnexoContratoInquilino
      de tipo RESERVA con comprobante_reserva_aprobado=True.

    Retorna (puede: bool, motivo: str | None).
    """
    if anexo.estado != EstadoAnexoInquilinoEnum.BORRADOR.value:
        return False, f"El anexo está en estado '{anexo.estado}', no puede firmarse"

    if (
        anexo.tipo == TipoAnexoInquilinoEnum.CONTRATO.value
        and inquilino.tiene_reserva
    ):
        anexo_reserva = db.query(AnexoContratoInquilino).filter(
            AnexoContratoInquilino.inquilino_id == inquilino.id,
            AnexoContratoInquilino.tipo == TipoAnexoInquilinoEnum.RESERVA.value,
            AnexoContratoInquilino.comprobante_reserva_aprobado == True,
        ).first()
        if not anexo_reserva:
            return False, "Para firmar el contrato debes subir el comprobante de la reserva y esperar su aprobación"

    return True, None


def firmar_anexo(
    db: Session,
    inquilino: Inquilino,
    anexo: AnexoContratoInquilino,
    firma_base64: str,
    ip: Optional[str] = None,
    cfg: Optional[ConfiguracionLegal] = None,
) -> AnexoContratoInquilino:
    """
    Registra la firma del inquilino en el anexo y regenera el PDF con la firma incluida.
    Marca el contrato como firmado si el tipo es CONTRATO.
    """
    puede, motivo = puede_firmar_contrato(db, inquilino, anexo)
    if not puede:
        raise HTTPException(status_code=400, detail=motivo)

    if cfg is None:
        cfg = _obtener_cfg(db)

    rep_nombre, rep_rut, empresa, empresa_rut = _rep_legal_datos(cfg)

    pdf_bytes = generar_pdf_contrato_generico(
        rendered_md=anexo.contenido_renderizado or "",
        titulo=anexo.titulo,
        firmante_nombre=inquilino.nombre_rep_legal or inquilino.razon_social or inquilino.email,
        firmante_rut=inquilino.rut_rep_legal,
        rep_legal_nombre=rep_nombre,
        rep_legal_rut=rep_rut,
        empresa_razon_social=empresa,
        empresa_rut=empresa_rut,
        firma_firmante_src=firma_base64,
        requiere_firma=True,
    )

    anexo.firma_inquilino_snapshot = firma_base64
    anexo.firmado_at = datetime.utcnow()
    anexo.firmado_ip = ip
    anexo.estado = EstadoAnexoInquilinoEnum.FIRMADO.value
    anexo.pdf_generado = _pdf_b64(pdf_bytes)

    if anexo.tipo == TipoAnexoInquilinoEnum.CONTRATO.value:
        inquilino.contrato_firmado = True

    db.flush()
    return anexo
