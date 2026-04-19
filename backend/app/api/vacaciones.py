"""
Router de vacaciones (feriado legal).

Flujos soportados:
  1. Trabajador SOLICITA vacaciones (firma con su firma digital al solicitar).
  2. RRHH APRUEBA o RECHAZA. Al aprobar se genera comprobante PDF con ambas firmas
     y se notifica al trabajador. Al rechazar también se notifica.
  3. Admin REGISTRA HISTÓRICAMENTE una vacación de un período pasado (es_retroactiva=True).
     Queda en estado REGISTRO_HISTORICO. Opcionalmente, RRHH puede SOLICITAR la firma
     del trabajador (sigue como REGISTRO_HISTORICO pero con flag de firma pendiente).
     Cuando el trabajador firma, se actualiza la firma_retroactiva y se regenera el PDF.

Endpoints:
  GET    /vacaciones                              — admin: lista global con filtros
  GET    /vacaciones/saldo/{trabajador_id}        — admin: saldo + cálculo progresivo
  POST   /vacaciones/registro-historico           — admin: cargar vacación pasada
  POST   /vacaciones/{id}/aprobar                 — RRHH aprueba solicitud
  POST   /vacaciones/{id}/rechazar                — RRHH rechaza solicitud
  POST   /vacaciones/{id}/solicitar-firma         — admin: pide firma retroactiva al trabajador
  POST   /vacaciones/{id}/regenerar-pdf           — admin: re-genera el comprobante
  DELETE /vacaciones/{id}                         — admin: elimina (solo si no está APROBADA)
  GET    /vacaciones/{id}/pdf                     — admin/trabajador: descarga el comprobante

  GET    /portal/vacaciones                       — trabajador: lista propia
  GET    /portal/vacaciones/saldo                 — trabajador: su saldo
  POST   /portal/vacaciones/solicitar             — trabajador: solicita feriado (firma)
  POST   /portal/vacaciones/{id}/firmar-retroactiva — trabajador: firma vacación histórica
"""
from __future__ import annotations

import base64
from datetime import date, datetime
from decimal import Decimal
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import (
    get_current_user,
    require_admin_or_administracion,
    require_permission,
    require_trabajador_portal,
)
from app.models import (
    EstadoVacacionEnum,
    NotificacionTrabajador,
    TipoNotificacionEnum,
    Trabajador,
    VacacionTrabajador,
)
from app.services.contratos import obtener_config_legal
from app.services.feriado_engine import (
    calcular_saldo,
    dias_habiles_entre,
    DIAS_BASE_ANUALES,
    TOPE_ANIOS_PREVIOS_ACREDITABLES,
)
from app.services.notificaciones import notificar_trabajador, notificar_rrhh
from app.services.vacaciones_pdf import generar_pdf_vacacion


router = APIRouter(tags=["Vacaciones"])

PERMISO_VER = "rrhh-vacaciones:ver"
PERMISO_EDITAR = "rrhh-vacaciones:editar"


# ── Schemas ─────────────────────────────────────────────────────────────────
class SolicitarVacacionIn(BaseModel):
    fecha_inicio: date
    fecha_fin: date
    nota: Optional[str] = None
    firma_base64: Optional[str] = None  # data URI; si no viene, se usa la firma del perfil


class RegistroHistoricoIn(BaseModel):
    trabajador_id: int
    fecha_inicio: date
    fecha_fin: date
    dias_habiles: Optional[int] = None  # si no viene, se calcula L-V
    nota: Optional[str] = None
    solicitar_firma_trabajador: bool = True


class AprobarVacacionIn(BaseModel):
    nota_aprobacion: Optional[str] = None
    firma_aprobador_base64: Optional[str] = None  # opcional; recomendado capturar al aprobar


class RechazarVacacionIn(BaseModel):
    motivo: str


class FirmarRetroactivaIn(BaseModel):
    firma_base64: Optional[str] = None  # si no viene, usa la del perfil


# ── Helpers ─────────────────────────────────────────────────────────────────
def _to_dict(v: VacacionTrabajador, *, incluir_pdf: bool = False) -> dict:
    return {
        "id": v.id,
        "trabajador_id": v.trabajador_id,
        "trabajador_nombre": v.trabajador.nombre if v.trabajador else None,
        "fecha_inicio": v.fecha_inicio.isoformat(),
        "fecha_fin": v.fecha_fin.isoformat(),
        "dias_habiles": v.dias_habiles,
        "dias_corridos": v.dias_corridos,
        "estado": v.estado,
        "nota": v.nota,
        "es_retroactiva": bool(v.es_retroactiva),
        "solicitada_at": v.solicitada_at.isoformat() if v.solicitada_at else None,
        "firma_solicitud_presente": bool(v.firma_solicitud),
        "aprobada_at": v.aprobada_at.isoformat() if v.aprobada_at else None,
        "aprobada_por": v.aprobada_por,
        "firma_aprobacion_presente": bool(v.firma_aprobacion),
        "rechazada_at": v.rechazada_at.isoformat() if v.rechazada_at else None,
        "rechazada_por": v.rechazada_por,
        "motivo_rechazo": v.motivo_rechazo,
        "firma_retroactiva_presente": bool(v.firma_retroactiva),
        "firma_retroactiva_at": v.firma_retroactiva_at.isoformat() if v.firma_retroactiva_at else None,
        "firma_retroactiva_solicitada": bool(v.firma_retroactiva_solicitada_at),
        "firma_retroactiva_solicitada_at": v.firma_retroactiva_solicitada_at.isoformat() if v.firma_retroactiva_solicitada_at else None,
        "tiene_pdf": bool(v.pdf_comprobante),
        "creado_por": v.creado_por,
        "created_at": v.created_at.isoformat() if v.created_at else None,
        "dias_derecho_snapshot": float(v.dias_derecho_snapshot) if v.dias_derecho_snapshot is not None else None,
        "dias_progresivo_snapshot": v.dias_progresivo_snapshot,
        "saldo_previo_snapshot": float(v.saldo_previo_snapshot) if v.saldo_previo_snapshot is not None else None,
        **({"pdf_base64": v.pdf_comprobante} if incluir_pdf else {}),
    }


def _saldo_trabajador(db: Session, trabajador: Trabajador) -> dict:
    """Calcula saldo descontando vacaciones APROBADAS o REGISTRO_HISTORICO."""
    consumidas = sum(
        v.dias_habiles for v in db.query(VacacionTrabajador).filter(
            VacacionTrabajador.trabajador_id == trabajador.id,
            VacacionTrabajador.estado.in_([
                EstadoVacacionEnum.APROBADA.value,
                EstadoVacacionEnum.TOMADA.value,
                EstadoVacacionEnum.REGISTRO_HISTORICO.value,
            ])
        ).all()
    )
    pendientes = sum(
        v.dias_habiles for v in db.query(VacacionTrabajador).filter(
            VacacionTrabajador.trabajador_id == trabajador.id,
            VacacionTrabajador.estado == EstadoVacacionEnum.SOLICITADA.value,
        ).all()
    )
    return calcular_saldo(
        fecha_ingreso=trabajador.fecha_ingreso,
        anios_servicio_previos=trabajador.anios_servicio_previos or 0,
        dias_tomados_aprobados=consumidas,
        dias_solicitados_pendientes=pendientes,
    )


def _generar_y_guardar_pdf(db: Session, vac: VacacionTrabajador) -> None:
    """Genera el PDF del comprobante y lo guarda en `vac.pdf_comprobante` (base64)."""
    cfg = obtener_config_legal(db)
    saldo_actual = _saldo_trabajador(db, vac.trabajador)
    snapshot = {
        "dias_acumulados": saldo_actual["dias_acumulados"],
        "dias_tomados": saldo_actual["dias_tomados"],
        "saldo_previo": float(vac.saldo_previo_snapshot) if vac.saldo_previo_snapshot is not None else saldo_actual["dias_disponibles"],
        "dias_progresivo": vac.dias_progresivo_snapshot if vac.dias_progresivo_snapshot is not None else saldo_actual["dias_progresivo"],
    }
    pdf_bytes = generar_pdf_vacacion(
        vac=vac,
        trabajador=vac.trabajador,
        saldo_snapshot=snapshot,
        rep_legal_nombre=cfg.rep_legal_nombre or "Adriana Colina Aguilar",
        rep_legal_rut=cfg.rep_legal_rut or "25.936.753-0",
        empresa_razon_social=cfg.empresa_razon_social or "E-Courier SPA",
        empresa_rut=cfg.empresa_rut or "—",
    )
    vac.pdf_comprobante = base64.b64encode(pdf_bytes).decode("ascii")


def _resolver_firma(payload_firma: Optional[str], trabajador: Trabajador) -> Optional[str]:
    """Devuelve la firma a usar: la del payload si viene, si no la del perfil."""
    if payload_firma and payload_firma.startswith("data:image"):
        return payload_firma
    return trabajador.firma_base64


# ── Endpoints ADMIN ─────────────────────────────────────────────────────────
@router.get("/vacaciones")
def listar_admin(
    estado: Optional[str] = None,
    trabajador_id: Optional[int] = None,
    pendientes_firma: bool = False,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_permission(PERMISO_VER)),
):
    """Lista vacaciones (admin). Filtros opcionales."""
    q = db.query(VacacionTrabajador)
    if estado:
        q = q.filter(VacacionTrabajador.estado == estado)
    if trabajador_id:
        q = q.filter(VacacionTrabajador.trabajador_id == trabajador_id)
    if pendientes_firma:
        # vacaciones cuya firma está pendiente: solicitadas sin firma O retroactivas con firma solicitada y sin firmar
        q = q.filter(or_(
            VacacionTrabajador.estado == EstadoVacacionEnum.SOLICITADA.value,
            (VacacionTrabajador.firma_retroactiva_solicitada_at.isnot(None)) & (VacacionTrabajador.firma_retroactiva.is_(None)),
        ))
    rows = q.order_by(VacacionTrabajador.fecha_inicio.desc()).all()
    return [_to_dict(v) for v in rows]


@router.get("/vacaciones/saldo/{trabajador_id}")
def saldo_admin(
    trabajador_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_permission(PERMISO_VER)),
):
    t = db.get(Trabajador, trabajador_id)
    if not t:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")
    return {
        "trabajador_id": t.id,
        "trabajador_nombre": t.nombre,
        "fecha_ingreso": t.fecha_ingreso.isoformat() if t.fecha_ingreso else None,
        "anios_servicio_previos": t.anios_servicio_previos or 0,
        "tope_anios_previos_acreditables": TOPE_ANIOS_PREVIOS_ACREDITABLES,
        **_saldo_trabajador(db, t),
    }


@router.post("/vacaciones/registro-historico", status_code=201)
def crear_registro_historico(
    payload: RegistroHistoricoIn,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_permission(PERMISO_EDITAR)),
):
    """
    Carga una vacación que el trabajador ya tomó en el pasado (antes del sistema).
    Queda en estado REGISTRO_HISTORICO. Si `solicitar_firma_trabajador=True`, se
    notifica al trabajador para que firme su conformidad.
    """
    t = db.get(Trabajador, payload.trabajador_id)
    if not t:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")
    if payload.fecha_fin < payload.fecha_inicio:
        raise HTTPException(status_code=400, detail="La fecha fin debe ser ≥ fecha inicio")

    dias = payload.dias_habiles or dias_habiles_entre(payload.fecha_inicio, payload.fecha_fin)
    if dias <= 0:
        raise HTTPException(status_code=400, detail="El rango no contiene días hábiles")

    saldo = _saldo_trabajador(db, t)
    vac = VacacionTrabajador(
        trabajador_id=t.id,
        fecha_inicio=payload.fecha_inicio,
        fecha_fin=payload.fecha_fin,
        dias_habiles=dias,
        dias_corridos=(payload.fecha_fin - payload.fecha_inicio).days + 1,
        estado=EstadoVacacionEnum.REGISTRO_HISTORICO.value,
        nota=payload.nota,
        es_retroactiva=True,
        dias_derecho_snapshot=Decimal(str(saldo["dias_acumulados"])),
        dias_progresivo_snapshot=saldo["dias_progresivo"],
        saldo_previo_snapshot=Decimal(str(saldo["dias_disponibles"])),
        creado_por=current_user.get("nombre") or current_user.get("username"),
    )
    db.add(vac)
    db.flush()

    if payload.solicitar_firma_trabajador:
        vac.firma_retroactiva_solicitada_at = datetime.utcnow()
        notificar_trabajador(
            db,
            trabajador=t,
            titulo="Tienes un registro de vacaciones por confirmar",
            mensaje=(
                f"Hola {t.nombre.split()[0]}. Cargamos en el sistema unas vacaciones que "
                f"ya tomaste ({payload.fecha_inicio.strftime('%d/%m/%Y')} al "
                f"{payload.fecha_fin.strftime('%d/%m/%Y')}, {dias} días hábiles). "
                f"Por favor revisa y firma tu conformidad en el portal."
            ),
            tipo=TipoNotificacionEnum.VACACIONES_APROBADAS.value,
            url_accion=f"/trabajador/vacaciones/{vac.id}",
            commit=False,
        )

    _generar_y_guardar_pdf(db, vac)
    db.commit()
    db.refresh(vac)
    return _to_dict(vac)


@router.post("/vacaciones/{vac_id}/aprobar")
def aprobar(
    vac_id: int,
    payload: AprobarVacacionIn,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_permission(PERMISO_EDITAR)),
):
    vac = db.get(VacacionTrabajador, vac_id)
    if not vac:
        raise HTTPException(status_code=404, detail="Vacación no encontrada")
    if vac.estado != EstadoVacacionEnum.SOLICITADA.value:
        raise HTTPException(status_code=400, detail=f"No se puede aprobar una vacación en estado {vac.estado}")

    vac.estado = EstadoVacacionEnum.APROBADA.value
    vac.aprobada_at = datetime.utcnow()
    vac.aprobada_por = current_user.get("nombre") or current_user.get("username")
    if payload.firma_aprobador_base64 and payload.firma_aprobador_base64.startswith("data:image"):
        vac.firma_aprobacion = payload.firma_aprobador_base64
    if payload.nota_aprobacion:
        vac.nota = ((vac.nota or "") + f"\n[Aprobación] {payload.nota_aprobacion}").strip()

    _generar_y_guardar_pdf(db, vac)

    notificar_trabajador(
        db,
        trabajador=vac.trabajador,
        titulo="Vacaciones aprobadas",
        mensaje=(
            f"Tu solicitud de vacaciones ({vac.fecha_inicio.strftime('%d/%m/%Y')} → "
            f"{vac.fecha_fin.strftime('%d/%m/%Y')}, {vac.dias_habiles} días hábiles) fue aprobada. "
            f"Descarga el comprobante en tu portal."
        ),
        tipo=TipoNotificacionEnum.VACACIONES_APROBADAS.value,
        url_accion=f"/trabajador/vacaciones/{vac.id}",
        commit=False,
    )

    db.commit()
    db.refresh(vac)
    return _to_dict(vac)


@router.post("/vacaciones/{vac_id}/rechazar")
def rechazar(
    vac_id: int,
    payload: RechazarVacacionIn,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_permission(PERMISO_EDITAR)),
):
    vac = db.get(VacacionTrabajador, vac_id)
    if not vac:
        raise HTTPException(status_code=404, detail="Vacación no encontrada")
    if vac.estado != EstadoVacacionEnum.SOLICITADA.value:
        raise HTTPException(status_code=400, detail="Solo se pueden rechazar vacaciones SOLICITADAS")

    vac.estado = EstadoVacacionEnum.RECHAZADA.value
    vac.rechazada_at = datetime.utcnow()
    vac.rechazada_por = current_user.get("nombre") or current_user.get("username")
    vac.motivo_rechazo = payload.motivo

    notificar_trabajador(
        db,
        trabajador=vac.trabajador,
        titulo="Vacaciones rechazadas",
        mensaje=(
            f"Tu solicitud ({vac.fecha_inicio.strftime('%d/%m/%Y')} → "
            f"{vac.fecha_fin.strftime('%d/%m/%Y')}) fue rechazada.\nMotivo: {payload.motivo}"
        ),
        tipo=TipoNotificacionEnum.VACACIONES_RECHAZADAS.value,
        url_accion=f"/trabajador/vacaciones",
        commit=False,
    )

    db.commit()
    db.refresh(vac)
    return _to_dict(vac)


@router.post("/vacaciones/{vac_id}/solicitar-firma")
def solicitar_firma_retroactiva(
    vac_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_permission(PERMISO_EDITAR)),
):
    """Pide al trabajador que firme una vacación cargada como REGISTRO_HISTORICO."""
    vac = db.get(VacacionTrabajador, vac_id)
    if not vac:
        raise HTTPException(status_code=404, detail="Vacación no encontrada")
    if vac.estado != EstadoVacacionEnum.REGISTRO_HISTORICO.value:
        raise HTTPException(status_code=400, detail="Solo se pueden solicitar firmas de registros históricos")
    if vac.firma_retroactiva:
        raise HTTPException(status_code=400, detail="Ya está firmada por el trabajador")

    vac.firma_retroactiva_solicitada_at = datetime.utcnow()
    notificar_trabajador(
        db,
        trabajador=vac.trabajador,
        titulo="Confirma tu registro de vacaciones",
        mensaje=(
            f"Por favor confirma con tu firma las vacaciones del {vac.fecha_inicio.strftime('%d/%m/%Y')} "
            f"al {vac.fecha_fin.strftime('%d/%m/%Y')} ({vac.dias_habiles} días hábiles)."
        ),
        tipo=TipoNotificacionEnum.VACACIONES_APROBADAS.value,
        url_accion=f"/trabajador/vacaciones/{vac.id}",
        commit=False,
    )
    db.commit()
    db.refresh(vac)
    return _to_dict(vac)


@router.post("/vacaciones/{vac_id}/regenerar-pdf")
def regenerar_pdf(
    vac_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_permission(PERMISO_EDITAR)),
):
    vac = db.get(VacacionTrabajador, vac_id)
    if not vac:
        raise HTTPException(status_code=404, detail="Vacación no encontrada")
    _generar_y_guardar_pdf(db, vac)
    db.commit()
    db.refresh(vac)
    return _to_dict(vac)


@router.delete("/vacaciones/{vac_id}")
def eliminar(
    vac_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_permission(PERMISO_EDITAR)),
):
    vac = db.get(VacacionTrabajador, vac_id)
    if not vac:
        raise HTTPException(status_code=404, detail="Vacación no encontrada")
    if vac.estado == EstadoVacacionEnum.APROBADA.value:
        raise HTTPException(status_code=400, detail="Para anular una vacación aprobada, usa el flujo correspondiente")
    db.delete(vac)
    db.commit()
    return {"ok": True}


@router.get("/vacaciones/{vac_id}/pdf")
def descargar_pdf(
    vac_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Descarga el comprobante PDF. Acceso: admin/administracion siempre; trabajador
    solo sobre los suyos. Si no existe el PDF persistido, lo genera al vuelo.
    """
    vac = db.get(VacacionTrabajador, vac_id)
    if not vac:
        raise HTTPException(status_code=404, detail="Vacación no encontrada")

    rol = current_user["rol"]
    if rol == "TRABAJADOR" and current_user["id"] != vac.trabajador_id:
        raise HTTPException(status_code=403, detail="Sin acceso")

    if not vac.pdf_comprobante:
        _generar_y_guardar_pdf(db, vac)
        db.commit()
        db.refresh(vac)

    pdf_bytes = base64.b64decode(vac.pdf_comprobante)
    filename = f"vacaciones-{vac.trabajador.nombre.replace(' ', '_')}-{vac.fecha_inicio.isoformat()}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


# ── Endpoints PORTAL DEL TRABAJADOR ─────────────────────────────────────────
@router.get("/portal/vacaciones")
def listar_propias(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_trabajador_portal),
):
    rows = (
        db.query(VacacionTrabajador)
        .filter(VacacionTrabajador.trabajador_id == current_user["id"])
        .order_by(VacacionTrabajador.fecha_inicio.desc())
        .all()
    )
    return [_to_dict(v) for v in rows]


@router.get("/portal/vacaciones/saldo")
def saldo_propio(
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_trabajador_portal),
):
    t = db.get(Trabajador, current_user["id"])
    if not t:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")
    return {
        "trabajador_id": t.id,
        "fecha_ingreso": t.fecha_ingreso.isoformat() if t.fecha_ingreso else None,
        "anios_servicio_previos": t.anios_servicio_previos or 0,
        **_saldo_trabajador(db, t),
    }


@router.post("/portal/vacaciones/solicitar", status_code=201)
def solicitar_portal(
    payload: SolicitarVacacionIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_trabajador_portal),
):
    t = db.get(Trabajador, current_user["id"])
    if not t:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")
    if payload.fecha_fin < payload.fecha_inicio:
        raise HTTPException(status_code=400, detail="La fecha fin debe ser ≥ fecha inicio")
    if payload.fecha_inicio <= date.today():
        raise HTTPException(status_code=400, detail="La fecha de inicio debe ser futura")

    firma = _resolver_firma(payload.firma_base64, t)
    if not firma:
        raise HTTPException(
            status_code=400,
            detail="Necesitas registrar tu firma en el portal antes de solicitar vacaciones",
        )

    dias = dias_habiles_entre(payload.fecha_inicio, payload.fecha_fin)
    if dias <= 0:
        raise HTTPException(status_code=400, detail="El rango no contiene días hábiles")

    saldo = _saldo_trabajador(db, t)
    if dias > saldo["dias_disponibles"]:
        raise HTTPException(
            status_code=400,
            detail=f"Saldo insuficiente: tienes {saldo['dias_disponibles']} días disponibles y solicitas {dias}",
        )

    # Persistir firma del perfil si vino en el payload (memoria del trabajador)
    if payload.firma_base64 and payload.firma_base64.startswith("data:image") and not t.firma_base64:
        t.firma_base64 = payload.firma_base64

    vac = VacacionTrabajador(
        trabajador_id=t.id,
        fecha_inicio=payload.fecha_inicio,
        fecha_fin=payload.fecha_fin,
        dias_habiles=dias,
        dias_corridos=(payload.fecha_fin - payload.fecha_inicio).days + 1,
        estado=EstadoVacacionEnum.SOLICITADA.value,
        nota=payload.nota,
        es_retroactiva=False,
        solicitada_at=datetime.utcnow(),
        firma_solicitud=firma,
        firma_solicitud_ip=(request.client.host if request and request.client else None),
        dias_derecho_snapshot=Decimal(str(saldo["dias_acumulados"])),
        dias_progresivo_snapshot=saldo["dias_progresivo"],
        saldo_previo_snapshot=Decimal(str(saldo["dias_disponibles"])),
        creado_por=t.nombre,
    )
    db.add(vac)
    db.flush()

    notificar_rrhh(
        db,
        permiso_slug=PERMISO_EDITAR,
        titulo="Solicitud de vacaciones pendiente",
        mensaje=(
            f"{t.nombre} solicitó vacaciones del {payload.fecha_inicio.strftime('%d/%m/%Y')} "
            f"al {payload.fecha_fin.strftime('%d/%m/%Y')} ({dias} días hábiles)."
        ),
        url_accion="/admin/vacaciones",
    )

    db.commit()
    db.refresh(vac)
    return _to_dict(vac)


@router.post("/portal/vacaciones/{vac_id}/firmar-retroactiva")
def firmar_retroactiva_portal(
    vac_id: int,
    payload: FirmarRetroactivaIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_trabajador_portal),
):
    vac = db.get(VacacionTrabajador, vac_id)
    if not vac:
        raise HTTPException(status_code=404, detail="Vacación no encontrada")
    if vac.trabajador_id != current_user["id"]:
        raise HTTPException(status_code=403, detail="Sin acceso")
    if vac.estado != EstadoVacacionEnum.REGISTRO_HISTORICO.value:
        raise HTTPException(status_code=400, detail="Esta vacación no requiere firma retroactiva")
    if vac.firma_retroactiva:
        raise HTTPException(status_code=400, detail="Ya firmaste esta vacación")

    t = vac.trabajador
    firma = _resolver_firma(payload.firma_base64, t)
    if not firma:
        raise HTTPException(status_code=400, detail="Necesitas tu firma registrada en el portal")
    if payload.firma_base64 and payload.firma_base64.startswith("data:image") and not t.firma_base64:
        t.firma_base64 = payload.firma_base64

    vac.firma_retroactiva = firma
    vac.firma_retroactiva_at = datetime.utcnow()
    vac.firma_retroactiva_ip = request.client.host if request and request.client else None

    _generar_y_guardar_pdf(db, vac)

    notificar_rrhh(
        db,
        permiso_slug=PERMISO_EDITAR,
        titulo="Vacación histórica firmada",
        mensaje=f"{t.nombre} firmó la vacación del {vac.fecha_inicio.strftime('%d/%m/%Y')}.",
        url_accion="/admin/vacaciones",
    )

    db.commit()
    db.refresh(vac)
    return _to_dict(vac)
