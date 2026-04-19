"""
Router del módulo de Control Horario Digital (integración ZKBioTime).

IMPORTANTE — Cumplimiento legal en Chile (Dirección del Trabajo):
  Este módulo consume EXCLUSIVAMENTE la API REST de ZKBioTime, que es el
  software certificado por la DT. Está prohibido (y aquí imposibilitado)
  conectarse directo al reloj físico (SpeedFace-V5L), ya que ello invalida
  las marcas como prueba ante la Inspección del Trabajo.

Endpoints (todos /api/asistencia/...):

  GET    /asistencia/configuracion                   — admin: ver config + estado
  PUT    /asistencia/configuracion                   — admin: actualizar config
  POST   /asistencia/configuracion/probar            — admin: ping a ZKBioTime
  POST   /asistencia/configuracion/activar           — admin: activa el módulo
  POST   /asistencia/configuracion/desactivar        — admin: desactiva el módulo

  GET    /asistencia/empleados-zkbio                 — lista los empleados de ZKBio (para vincular)
  PUT    /asistencia/trabajadores/{id}/vincular      — vincula trabajador ↔ zkbio_employee_id

  POST   /asistencia/sincronizar                     — pull de transacciones (rango opcional)
  GET    /asistencia/marcas                          — listar marcas (filtros)
  POST   /asistencia/marcas/{id}/descartar           — anula una marca específica

  GET    /asistencia/jornadas                        — listar jornadas calculadas
  POST   /asistencia/jornadas/recalcular             — recalcula un rango (sin volver a pullear)
  POST   /asistencia/jornadas/{id}/aprobar-he        — aprobar HE de una jornada
  POST   /asistencia/jornadas/consolidar-mes         — vuelca HE aprobadas a horas_extras_*

El módulo respeta el feature flag `ConfiguracionAsistencia.activo`: cuando
está apagado, todos los endpoints (excepto los de configuración) responden
424 (FAILED DEPENDENCY) explicando que el módulo está en stand-by.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_admin_or_administracion
from app.database import get_db
from app.models import (
    ConfiguracionAsistencia,
    JornadaTrabajador,
    MarcaAsistencia,
    Trabajador,
)
from app.services.asistencia_engine import (
    aprobar_he_jornada,
    consolidar_he_mes,
    recalcular_jornadas_trabajador,
)
from app.services.zkbiotime_client import (
    ZKBioCredentials,
    ZKBioTimeClient,
    ZKBioTimeError,
    extraer_campos_empleado,
    extraer_campos_transaccion,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Asistencia"])


PERMISO_VER = "asistencia:ver"
PERMISO_EDITAR = "asistencia:editar"


# ── Helpers ─────────────────────────────────────────────────────────────────
def _get_or_create_config(db: Session) -> ConfiguracionAsistencia:
    cfg = db.query(ConfiguracionAsistencia).filter(ConfiguracionAsistencia.id == 1).first()
    if cfg is None:
        cfg = ConfiguracionAsistencia(id=1, activo=False)
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


def _require_activo(cfg: ConfiguracionAsistencia):
    if not cfg.activo:
        raise HTTPException(
            status_code=status.HTTP_424_FAILED_DEPENDENCY,
            detail=(
                "El módulo de Control Horario Digital está apagado. Configura ZKBioTime "
                "y actívalo desde Configuración antes de operar."
            ),
        )


def _require_zkbio_listo(cfg: ConfiguracionAsistencia):
    if not (cfg.zkbio_base_url and (cfg.zkbio_api_token or (cfg.zkbio_username and cfg.zkbio_password))):
        raise HTTPException(
            status_code=400,
            detail="Faltan credenciales de ZKBioTime (URL + token o usuario/contraseña).",
        )


def _build_client(cfg: ConfiguracionAsistencia) -> ZKBioTimeClient:
    creds = ZKBioCredentials(
        base_url=cfg.zkbio_base_url or "",
        username=cfg.zkbio_username,
        password=cfg.zkbio_password,
        token=cfg.zkbio_api_token,
    )
    return ZKBioTimeClient(creds)


# ── Schemas ─────────────────────────────────────────────────────────────────
class ConfiguracionIn(BaseModel):
    zkbio_base_url: Optional[str] = None
    zkbio_username: Optional[str] = None
    zkbio_password: Optional[str] = None
    zkbio_api_token: Optional[str] = None
    zkbio_version: Optional[str] = None
    tolerancia_atraso_min: Optional[int] = Field(None, ge=0, le=120)
    tolerancia_salida_anticipada_min: Optional[int] = Field(None, ge=0, le=120)
    minutos_minimos_he: Optional[int] = Field(None, ge=0, le=240)
    requiere_aprobacion_he: Optional[bool] = None
    he_dia_recargo_50_max_diario: Optional[int] = Field(None, ge=0, le=12)
    consolidar_he_a_liquidacion: Optional[bool] = None


class ConfiguracionOut(BaseModel):
    activo: bool
    zkbio_base_url: Optional[str] = None
    zkbio_username: Optional[str] = None
    zkbio_version: Optional[str] = None
    tiene_token: bool = False
    tiene_password: bool = False
    tolerancia_atraso_min: int
    tolerancia_salida_anticipada_min: int
    minutos_minimos_he: int
    requiere_aprobacion_he: bool
    he_dia_recargo_50_max_diario: int
    consolidar_he_a_liquidacion: bool
    ultima_sync_at: Optional[datetime] = None
    ultima_sync_hasta: Optional[datetime] = None
    ultima_sync_marcas_nuevas: Optional[int] = None
    ultima_sync_error: Optional[str] = None


class VincularZkBioIn(BaseModel):
    zkbio_employee_id: Optional[str] = None
    zkbio_employee_codigo: Optional[str] = None
    hora_entrada_esperada: Optional[str] = None
    hora_salida_esperada: Optional[str] = None
    minutos_colacion: Optional[int] = Field(None, ge=0, le=180)


class SincronizarIn(BaseModel):
    desde: Optional[datetime] = None
    hasta: Optional[datetime] = None
    recalcular_jornadas: bool = True


class AprobarHEIn(BaseModel):
    minutos: int = Field(..., ge=0, le=600)


class ConsolidarMesIn(BaseModel):
    mes: int = Field(..., ge=1, le=12)
    anio: int = Field(..., ge=2024, le=2100)
    trabajador_id: Optional[int] = None  # si None, todos


class RecalcularJornadasIn(BaseModel):
    desde: date
    hasta: date
    trabajador_id: Optional[int] = None


# ── Configuración ───────────────────────────────────────────────────────────
def _to_out(cfg: ConfiguracionAsistencia) -> ConfiguracionOut:
    return ConfiguracionOut(
        activo=cfg.activo,
        zkbio_base_url=cfg.zkbio_base_url,
        zkbio_username=cfg.zkbio_username,
        zkbio_version=cfg.zkbio_version,
        tiene_token=bool(cfg.zkbio_api_token),
        tiene_password=bool(cfg.zkbio_password),
        tolerancia_atraso_min=cfg.tolerancia_atraso_min,
        tolerancia_salida_anticipada_min=cfg.tolerancia_salida_anticipada_min,
        minutos_minimos_he=cfg.minutos_minimos_he,
        requiere_aprobacion_he=cfg.requiere_aprobacion_he,
        he_dia_recargo_50_max_diario=cfg.he_dia_recargo_50_max_diario,
        consolidar_he_a_liquidacion=cfg.consolidar_he_a_liquidacion,
        ultima_sync_at=cfg.ultima_sync_at,
        ultima_sync_hasta=cfg.ultima_sync_hasta,
        ultima_sync_marcas_nuevas=cfg.ultima_sync_marcas_nuevas,
        ultima_sync_error=cfg.ultima_sync_error,
    )


@router.get("/asistencia/configuracion", response_model=ConfiguracionOut)
def obtener_configuracion(
    db: Session = Depends(get_db),
    user=Depends(require_admin_or_administracion),
):
    cfg = _get_or_create_config(db)
    return _to_out(cfg)


@router.put("/asistencia/configuracion", response_model=ConfiguracionOut)
def actualizar_configuracion(
    payload: ConfiguracionIn,
    db: Session = Depends(get_db),
    user=Depends(require_admin_or_administracion),
):
    cfg = _get_or_create_config(db)
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(cfg, k, v)
    cfg.actualizado_por = getattr(user, "username", None) or getattr(user, "email", None)
    db.commit()
    db.refresh(cfg)
    return _to_out(cfg)


@router.post("/asistencia/configuracion/probar")
def probar_conexion(
    db: Session = Depends(get_db),
    user=Depends(require_admin_or_administracion),
):
    """Hace login (si hace falta) y trae 1 empleado para validar credenciales."""
    cfg = _get_or_create_config(db)
    _require_zkbio_listo(cfg)
    try:
        with _build_client(cfg) as client:
            client.ensure_token()
            it = client.iter_employees()
            primer = next(it, None)
            # Persistimos el token recién obtenido
            cfg.zkbio_api_token = client.creds.token
            cfg.ultima_sync_error = None
            db.commit()
            return {
                "ok": True,
                "tiene_empleados": primer is not None,
                "ejemplo": extraer_campos_empleado(primer) if primer else None,
            }
    except ZKBioTimeError as exc:
        cfg.ultima_sync_error = str(exc)
        db.commit()
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/asistencia/configuracion/activar", response_model=ConfiguracionOut)
def activar(
    db: Session = Depends(get_db),
    user=Depends(require_admin_or_administracion),
):
    cfg = _get_or_create_config(db)
    _require_zkbio_listo(cfg)
    cfg.activo = True
    db.commit()
    return _to_out(cfg)


@router.post("/asistencia/configuracion/desactivar", response_model=ConfiguracionOut)
def desactivar(
    db: Session = Depends(get_db),
    user=Depends(require_admin_or_administracion),
):
    cfg = _get_or_create_config(db)
    cfg.activo = False
    db.commit()
    return _to_out(cfg)


# ── Empleados ZKBio + vinculación ───────────────────────────────────────────
@router.get("/asistencia/empleados-zkbio")
def listar_empleados_zkbio(
    db: Session = Depends(get_db),
    user=Depends(require_admin_or_administracion),
):
    cfg = _get_or_create_config(db)
    _require_activo(cfg)
    _require_zkbio_listo(cfg)
    try:
        with _build_client(cfg) as client:
            empleados = [extraer_campos_empleado(e) for e in client.iter_employees()]
            cfg.zkbio_api_token = client.creds.token
            db.commit()
    except ZKBioTimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    # Anotar quién está ya vinculado
    ids_vinculados = {
        t.zkbio_employee_id: {"trabajador_id": t.id, "nombre": t.nombre}
        for t in db.query(Trabajador).filter(Trabajador.zkbio_employee_id.isnot(None)).all()
    }
    for e in empleados:
        v = ids_vinculados.get(e["zkbio_employee_id"])
        e["vinculado_a"] = v
    return empleados


@router.put("/asistencia/trabajadores/{trabajador_id}/vincular")
def vincular_trabajador(
    trabajador_id: int,
    payload: VincularZkBioIn,
    db: Session = Depends(get_db),
    user=Depends(require_admin_or_administracion),
):
    t = db.query(Trabajador).filter(Trabajador.id == trabajador_id).first()
    if t is None:
        raise HTTPException(404, "Trabajador no encontrado")

    if payload.zkbio_employee_id:
        # Validar unicidad
        otro = (
            db.query(Trabajador)
            .filter(
                Trabajador.zkbio_employee_id == payload.zkbio_employee_id,
                Trabajador.id != trabajador_id,
            )
            .first()
        )
        if otro:
            raise HTTPException(409, f"Ese ID ZKBio ya está vinculado a {otro.nombre}")

    for f in ("zkbio_employee_id", "zkbio_employee_codigo", "hora_entrada_esperada",
              "hora_salida_esperada", "minutos_colacion"):
        v = getattr(payload, f)
        if v is not None:
            setattr(t, f, v)

    db.commit()
    db.refresh(t)

    # Re-asignar marcas huérfanas que coincidan con su zkbio_employee_id
    if payload.zkbio_employee_id:
        actualizadas = (
            db.query(MarcaAsistencia)
            .filter(
                MarcaAsistencia.trabajador_id.is_(None),
                MarcaAsistencia.zkbio_employee_id == payload.zkbio_employee_id,
            )
            .update({MarcaAsistencia.trabajador_id: t.id}, synchronize_session=False)
        )
        db.commit()
    else:
        actualizadas = 0

    return {
        "ok": True,
        "trabajador_id": t.id,
        "zkbio_employee_id": t.zkbio_employee_id,
        "marcas_reasignadas": actualizadas,
    }


# ── Sincronización ─────────────────────────────────────────────────────────
@router.post("/asistencia/sincronizar")
def sincronizar(
    payload: SincronizarIn,
    db: Session = Depends(get_db),
    user=Depends(require_admin_or_administracion),
):
    cfg = _get_or_create_config(db)
    _require_activo(cfg)
    _require_zkbio_listo(cfg)

    # Rango por defecto: desde la última sync (o 7 días atrás) hasta ahora.
    end = payload.hasta or datetime.now()
    if payload.desde:
        start = payload.desde
    elif cfg.ultima_sync_hasta:
        start = cfg.ultima_sync_hasta - timedelta(minutes=5)  # solapamos un poco para no perder
    else:
        start = end - timedelta(days=7)

    if start >= end:
        raise HTTPException(400, "El rango de sincronización es inválido (desde ≥ hasta).")

    # Index trabajadores por zkbio id
    trabajadores_idx = {
        t.zkbio_employee_id: t.id
        for t in db.query(Trabajador).filter(Trabajador.zkbio_employee_id.isnot(None)).all()
    }

    nuevas = 0
    huerfanas = 0
    afectados_dias: set = set()
    afectados_trab: set = set()

    try:
        with _build_client(cfg) as client:
            for tx in client.iter_transactions(start=start, end=end):
                campos = extraer_campos_transaccion(tx)
                if not (campos["zkbio_transaction_id"] and campos["timestamp"]):
                    continue
                # Idempotencia por (zkbio_transaction_id, dispositivo_sn)
                ya = (
                    db.query(MarcaAsistencia)
                    .filter(
                        MarcaAsistencia.zkbio_transaction_id == campos["zkbio_transaction_id"],
                        MarcaAsistencia.dispositivo_sn == campos["dispositivo_sn"],
                    )
                    .first()
                )
                if ya:
                    continue

                trab_id = trabajadores_idx.get(campos["zkbio_employee_id"])
                if trab_id is None:
                    huerfanas += 1
                else:
                    afectados_trab.add(trab_id)
                    afectados_dias.add((trab_id, campos["fecha"]))

                marca = MarcaAsistencia(trabajador_id=trab_id, **campos)
                db.add(marca)
                nuevas += 1

            cfg.zkbio_api_token = client.creds.token
    except ZKBioTimeError as exc:
        cfg.ultima_sync_error = str(exc)
        db.commit()
        raise HTTPException(status_code=502, detail=str(exc))

    cfg.ultima_sync_at = datetime.utcnow()
    cfg.ultima_sync_hasta = end
    cfg.ultima_sync_marcas_nuevas = nuevas
    cfg.ultima_sync_error = None
    db.commit()

    # Recalcular jornadas afectadas
    recalculadas = 0
    if payload.recalcular_jornadas and afectados_trab:
        # Reconstruimos por trabajador en su rango afectado
        por_trab: dict[int, tuple[date, date]] = {}
        for (tid, f) in afectados_dias:
            r = por_trab.get(tid)
            if r is None:
                por_trab[tid] = (f, f)
            else:
                por_trab[tid] = (min(r[0], f), max(r[1], f))
        for tid, (d1, d2) in por_trab.items():
            t = db.query(Trabajador).filter(Trabajador.id == tid).first()
            if t:
                recalculadas += recalcular_jornadas_trabajador(db, t, d1, d2, cfg=cfg)
        db.commit()

    return {
        "ok": True,
        "rango": {"desde": start.isoformat(), "hasta": end.isoformat()},
        "marcas_nuevas": nuevas,
        "marcas_huerfanas_sin_vinculacion": huerfanas,
        "trabajadores_afectados": len(afectados_trab),
        "jornadas_recalculadas": recalculadas,
    }


# ── Marcas ──────────────────────────────────────────────────────────────────
@router.get("/asistencia/marcas")
def listar_marcas(
    trabajador_id: Optional[int] = Query(None),
    desde: Optional[date] = Query(None),
    hasta: Optional[date] = Query(None),
    solo_huerfanas: bool = Query(False),
    incluir_descartadas: bool = Query(False),
    limite: int = Query(500, le=2000),
    db: Session = Depends(get_db),
    user=Depends(require_admin_or_administracion),
):
    q = db.query(MarcaAsistencia)
    if trabajador_id is not None:
        q = q.filter(MarcaAsistencia.trabajador_id == trabajador_id)
    if solo_huerfanas:
        q = q.filter(MarcaAsistencia.trabajador_id.is_(None))
    if desde:
        q = q.filter(MarcaAsistencia.fecha >= desde)
    if hasta:
        q = q.filter(MarcaAsistencia.fecha <= hasta)
    if not incluir_descartadas:
        q = q.filter(MarcaAsistencia.descartada.is_(False))
    rows = q.order_by(MarcaAsistencia.timestamp.desc()).limit(limite).all()

    return [
        {
            "id": m.id,
            "trabajador_id": m.trabajador_id,
            "trabajador_nombre": m.trabajador.nombre if m.trabajador else None,
            "zkbio_employee_id": m.zkbio_employee_id,
            "zkbio_employee_codigo": m.zkbio_employee_codigo,
            "timestamp": m.timestamp.isoformat() if m.timestamp else None,
            "fecha": m.fecha.isoformat() if m.fecha else None,
            "tipo": m.tipo,
            "punch_state_raw": m.punch_state_raw,
            "verify_type": m.verify_type,
            "dispositivo_alias": m.dispositivo_alias,
            "dispositivo_sn": m.dispositivo_sn,
            "descartada": m.descartada,
            "motivo_descarte": m.motivo_descarte,
        }
        for m in rows
    ]


@router.post("/asistencia/marcas/{marca_id}/descartar")
def descartar_marca(
    marca_id: int,
    motivo: str = Query(..., min_length=3, max_length=500),
    db: Session = Depends(get_db),
    user=Depends(require_admin_or_administracion),
):
    m = db.query(MarcaAsistencia).filter(MarcaAsistencia.id == marca_id).first()
    if m is None:
        raise HTTPException(404, "Marca no encontrada")
    m.descartada = True
    m.motivo_descarte = motivo
    db.commit()

    if m.trabajador_id and m.fecha:
        t = db.query(Trabajador).filter(Trabajador.id == m.trabajador_id).first()
        cfg = _get_or_create_config(db)
        if t:
            recalcular_jornadas_trabajador(db, t, m.fecha, m.fecha, cfg=cfg)
            db.commit()

    return {"ok": True}


# ── Jornadas ────────────────────────────────────────────────────────────────
@router.get("/asistencia/jornadas")
def listar_jornadas(
    trabajador_id: Optional[int] = Query(None),
    desde: Optional[date] = Query(None),
    hasta: Optional[date] = Query(None),
    estado: Optional[str] = Query(None),
    limite: int = Query(500, le=2000),
    db: Session = Depends(get_db),
    user=Depends(require_admin_or_administracion),
):
    q = db.query(JornadaTrabajador)
    if trabajador_id is not None:
        q = q.filter(JornadaTrabajador.trabajador_id == trabajador_id)
    if desde:
        q = q.filter(JornadaTrabajador.fecha >= desde)
    if hasta:
        q = q.filter(JornadaTrabajador.fecha <= hasta)
    if estado:
        q = q.filter(JornadaTrabajador.estado == estado)
    rows = q.order_by(JornadaTrabajador.fecha.desc(), JornadaTrabajador.trabajador_id.asc()).limit(limite).all()
    return [
        {
            "id": j.id,
            "trabajador_id": j.trabajador_id,
            "trabajador_nombre": j.trabajador.nombre if j.trabajador else None,
            "fecha": j.fecha.isoformat(),
            "primera_entrada": j.primera_entrada.isoformat() if j.primera_entrada else None,
            "ultima_salida": j.ultima_salida.isoformat() if j.ultima_salida else None,
            "salida_colacion": j.salida_colacion.isoformat() if j.salida_colacion else None,
            "entrada_colacion": j.entrada_colacion.isoformat() if j.entrada_colacion else None,
            "minutos_trabajados": j.minutos_trabajados,
            "minutos_colacion": j.minutos_colacion,
            "minutos_atraso": j.minutos_atraso,
            "minutos_salida_anticipada": j.minutos_salida_anticipada,
            "minutos_he_estimadas": j.minutos_he_estimadas,
            "he_aprobadas_min": j.he_aprobadas_min,
            "he_aprobadas_por": j.he_aprobadas_por,
            "estado": j.estado,
            "observaciones": j.observaciones,
            "hora_entrada_esperada": j.hora_entrada_esperada,
            "hora_salida_esperada": j.hora_salida_esperada,
            "jornada_diaria_min_esperada": j.jornada_diaria_min_esperada,
        }
        for j in rows
    ]


@router.post("/asistencia/jornadas/recalcular")
def recalcular_jornadas(
    payload: RecalcularJornadasIn,
    db: Session = Depends(get_db),
    user=Depends(require_admin_or_administracion),
):
    if payload.desde > payload.hasta:
        raise HTTPException(400, "Rango inválido")
    cfg = _get_or_create_config(db)
    q = db.query(Trabajador)
    if payload.trabajador_id:
        q = q.filter(Trabajador.id == payload.trabajador_id)
    trabajadores = q.all()
    total = 0
    for t in trabajadores:
        total += recalcular_jornadas_trabajador(db, t, payload.desde, payload.hasta, cfg=cfg)
    db.commit()
    return {"ok": True, "jornadas_actualizadas": total, "trabajadores": len(trabajadores)}


@router.post("/asistencia/jornadas/{jornada_id}/aprobar-he")
def aprobar_he(
    jornada_id: int,
    payload: AprobarHEIn,
    db: Session = Depends(get_db),
    user=Depends(require_admin_or_administracion),
):
    j = db.query(JornadaTrabajador).filter(JornadaTrabajador.id == jornada_id).first()
    if j is None:
        raise HTTPException(404, "Jornada no encontrada")
    aprobar_he_jornada(
        db, j, payload.minutos,
        aprobador=getattr(user, "username", None) or getattr(user, "email", "admin"),
    )
    db.commit()
    return {"ok": True, "he_aprobadas_min": j.he_aprobadas_min}


@router.post("/asistencia/jornadas/consolidar-mes")
def consolidar_mes(
    payload: ConsolidarMesIn,
    db: Session = Depends(get_db),
    user=Depends(require_admin_or_administracion),
):
    cfg = _get_or_create_config(db)
    if not cfg.consolidar_he_a_liquidacion:
        raise HTTPException(400, "La consolidación automática está deshabilitada en la configuración.")
    q = db.query(Trabajador)
    if payload.trabajador_id:
        q = q.filter(Trabajador.id == payload.trabajador_id)
    trabajadores = q.all()
    consolidadas = 0
    for t in trabajadores:
        fila = consolidar_he_mes(db, t, payload.mes, payload.anio, cfg=cfg)
        if fila is not None:
            consolidadas += 1
    db.commit()
    return {"ok": True, "horas_extras_consolidadas": consolidadas, "trabajadores_evaluados": len(trabajadores)}
