"""
API de gestión de flota de vehículos.

Recursos:
  GET/POST   /flota/vehiculos
  GET/PUT/DELETE /flota/vehiculos/{patente}

  GET/POST   /flota/combustible
  DELETE     /flota/combustible/{id}

  GET/POST   /flota/tag
  DELETE     /flota/tag/{id}

  GET/POST   /flota/excepciones
  DELETE     /flota/excepciones/{id}

El conductor responsable de un registro de combustible o TAG se resuelve en este
orden para la fecha del registro:
  1. ¿Existe un UsoVehiculoExcepcion para (patente, fecha)? → usar ese driver.
  2. Si no: usar Driver.vehiculo_patente == patente → conductor asignado por defecto.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.auth import require_admin_or_administracion, require_admin
from app.database import get_db
from app.models import (
    VehiculoEmpresa, UsoVehiculoExcepcion,
    CombustibleRegistro, RegistroTag, Driver,
)

router = APIRouter(prefix="/flota", tags=["Flota"])


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _resolver_conductor(db: Session, patente: str, fecha: date) -> Optional[int]:
    """
    Devuelve el driver_id responsable de la patente en la fecha indicada.
    Prioridad: excepción registrada > asignación por defecto en Driver.vehiculo_patente.
    """
    exc = db.query(UsoVehiculoExcepcion).filter(
        UsoVehiculoExcepcion.patente == patente,
        UsoVehiculoExcepcion.fecha == fecha,
    ).first()
    if exc:
        return exc.driver_id

    driver = db.query(Driver).filter(
        Driver.vehiculo_patente == patente,
        Driver.activo == True,
    ).first()
    return driver.id if driver else None


def _semana_iso(d: date) -> int:
    return d.isocalendar()[1]


def _vehiculo_dict(v: VehiculoEmpresa, driver: Optional[Driver] = None) -> dict:
    return {
        "patente": v.patente,
        "marca": v.marca,
        "modelo": v.modelo,
        "anio": v.anio,
        "tipo": v.tipo,
        "color": v.color,
        "activo": v.activo,
        "notas": v.notas,
        "driver_asignado": {
            "id": driver.id,
            "nombre": driver.nombre,
            "nombre_completo": driver.nombre_completo,
        } if driver else None,
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Vehículos
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/vehiculos")
def listar_vehiculos(
    solo_activos: bool = Query(True),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    q = db.query(VehiculoEmpresa)
    if solo_activos:
        q = q.filter(VehiculoEmpresa.activo == True)
    vehiculos = q.order_by(VehiculoEmpresa.patente).all()

    # Mapa conductor asignado por defecto
    drivers_map = {
        d.vehiculo_patente: d
        for d in db.query(Driver).filter(
            Driver.vehiculo_patente.isnot(None),
            Driver.activo == True,
        ).all()
    }
    return [_vehiculo_dict(v, drivers_map.get(v.patente)) for v in vehiculos]


@router.post("/vehiculos", status_code=201)
def crear_vehiculo(
    body: dict,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    patente = (body.get("patente") or "").strip().upper()
    if not patente:
        raise HTTPException(status_code=400, detail="La patente es obligatoria")
    if db.get(VehiculoEmpresa, patente):
        raise HTTPException(status_code=409, detail="Ya existe un vehículo con esa patente")

    v = VehiculoEmpresa(
        patente=patente,
        marca=body.get("marca"),
        modelo=body.get("modelo"),
        anio=body.get("anio"),
        tipo=body.get("tipo", "furgon"),
        color=body.get("color"),
        activo=body.get("activo", True),
        notas=body.get("notas"),
    )
    db.add(v)

    # Asignar conductor por defecto si se indica
    driver_id = body.get("driver_id")
    if driver_id:
        driver = db.get(Driver, driver_id)
        if not driver:
            raise HTTPException(status_code=404, detail="Driver no encontrado")
        driver.vehiculo_patente = patente

    db.commit()
    db.refresh(v)
    driver = db.query(Driver).filter(Driver.vehiculo_patente == patente).first()
    return _vehiculo_dict(v, driver)


@router.get("/vehiculos/{patente}")
def detalle_vehiculo(
    patente: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    v = db.get(VehiculoEmpresa, patente.upper())
    if not v:
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")
    driver = db.query(Driver).filter(Driver.vehiculo_patente == patente.upper()).first()
    return _vehiculo_dict(v, driver)


@router.put("/vehiculos/{patente}")
def actualizar_vehiculo(
    patente: str,
    body: dict,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    v = db.get(VehiculoEmpresa, patente.upper())
    if not v:
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")

    for campo in ("marca", "modelo", "anio", "tipo", "color", "activo", "notas"):
        if campo in body:
            setattr(v, campo, body[campo])

    # Reasignar conductor por defecto
    if "driver_id" in body:
        # Desasignar cualquier driver que tuviera esta patente
        antiguos = db.query(Driver).filter(Driver.vehiculo_patente == patente.upper()).all()
        for d in antiguos:
            d.vehiculo_patente = None
        # Asignar al nuevo
        if body["driver_id"]:
            nuevo = db.get(Driver, body["driver_id"])
            if not nuevo:
                raise HTTPException(status_code=404, detail="Driver no encontrado")
            nuevo.vehiculo_patente = patente.upper()

    db.commit()
    driver = db.query(Driver).filter(Driver.vehiculo_patente == patente.upper()).first()
    return _vehiculo_dict(v, driver)


@router.delete("/vehiculos/{patente}", status_code=204)
def eliminar_vehiculo(
    patente: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    v = db.get(VehiculoEmpresa, patente.upper())
    if not v:
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")
    v.activo = False
    db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# Excepciones de uso
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/excepciones")
def listar_excepciones(
    driver_id: Optional[int] = Query(None),
    patente: Optional[str] = Query(None),
    desde: Optional[date] = Query(None),
    hasta: Optional[date] = Query(None),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    q = db.query(UsoVehiculoExcepcion)
    if driver_id:
        q = q.filter(UsoVehiculoExcepcion.driver_id == driver_id)
    if patente:
        q = q.filter(UsoVehiculoExcepcion.patente == patente.upper())
    if desde:
        q = q.filter(UsoVehiculoExcepcion.fecha >= desde)
    if hasta:
        q = q.filter(UsoVehiculoExcepcion.fecha <= hasta)

    excepciones = q.order_by(UsoVehiculoExcepcion.fecha.desc()).all()
    drivers_map = {d.id: d for d in db.query(Driver).all()}

    return [
        {
            "id": e.id,
            "driver_id": e.driver_id,
            "driver_nombre": drivers_map.get(e.driver_id, Driver()).nombre,
            "patente": e.patente,
            "fecha": e.fecha.isoformat(),
            "motivo": e.motivo,
            "creado_por": e.creado_por,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in excepciones
    ]


@router.post("/excepciones", status_code=201)
def crear_excepcion(
    body: dict,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    driver_id = body.get("driver_id")
    patente = (body.get("patente") or "").strip().upper()
    fecha_str = body.get("fecha")
    if not driver_id or not patente or not fecha_str:
        raise HTTPException(status_code=400, detail="driver_id, patente y fecha son obligatorios")

    fecha = date.fromisoformat(fecha_str)

    if not db.get(Driver, driver_id):
        raise HTTPException(status_code=404, detail="Driver no encontrado")
    if not db.get(VehiculoEmpresa, patente):
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")

    usuario = current_user.get("username") or current_user.get("sub", "admin")
    exc = UsoVehiculoExcepcion(
        driver_id=driver_id,
        patente=patente,
        fecha=fecha,
        motivo=body.get("motivo"),
        creado_por=usuario,
    )
    db.add(exc)
    db.commit()
    db.refresh(exc)
    return {"id": exc.id, "ok": True}


@router.delete("/excepciones/{excepcion_id}", status_code=204)
def eliminar_excepcion(
    excepcion_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    exc = db.get(UsoVehiculoExcepcion, excepcion_id)
    if not exc:
        raise HTTPException(status_code=404, detail="Excepción no encontrada")
    db.delete(exc)
    db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# Combustible
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/combustible")
def listar_combustible(
    patente: Optional[str] = Query(None),
    driver_id: Optional[int] = Query(None),
    mes: Optional[int] = Query(None),
    anio: Optional[int] = Query(None),
    semana: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    q = db.query(CombustibleRegistro)
    if patente:
        q = q.filter(CombustibleRegistro.patente == patente.upper())
    if driver_id:
        q = q.filter(CombustibleRegistro.driver_id_resuelto == driver_id)
    if mes:
        q = q.filter(CombustibleRegistro.mes == mes)
    if anio:
        q = q.filter(CombustibleRegistro.anio == anio)
    if semana:
        q = q.filter(CombustibleRegistro.semana == semana)

    registros = q.order_by(CombustibleRegistro.fecha.desc()).all()
    drivers_map = {d.id: d for d in db.query(Driver).all()}

    return [
        {
            "id": r.id,
            "patente": r.patente,
            "fecha": r.fecha.isoformat(),
            "semana": r.semana,
            "mes": r.mes,
            "anio": r.anio,
            "litros": float(r.litros) if r.litros else None,
            "monto_total": r.monto_total,
            "proveedor": r.proveedor,
            "driver_id_resuelto": r.driver_id_resuelto,
            "driver_nombre": drivers_map.get(r.driver_id_resuelto, Driver()).nombre if r.driver_id_resuelto else None,
            "notas": r.notas,
        }
        for r in registros
    ]


@router.post("/combustible", status_code=201)
def registrar_combustible(
    body: dict,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    patente = (body.get("patente") or "").strip().upper()
    fecha_str = body.get("fecha")
    monto = body.get("monto_total")

    if not patente or not fecha_str or monto is None:
        raise HTTPException(status_code=400, detail="patente, fecha y monto_total son obligatorios")

    if not db.get(VehiculoEmpresa, patente):
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")

    fecha = date.fromisoformat(fecha_str)
    driver_id = _resolver_conductor(db, patente, fecha)

    usuario = current_user.get("username") or current_user.get("sub", "admin")
    reg = CombustibleRegistro(
        patente=patente,
        fecha=fecha,
        semana=_semana_iso(fecha),
        mes=fecha.month,
        anio=fecha.year,
        litros=body.get("litros"),
        monto_total=int(monto),
        proveedor=body.get("proveedor"),
        driver_id_resuelto=driver_id,
        notas=body.get("notas"),
        creado_por=usuario,
    )
    db.add(reg)
    db.commit()
    db.refresh(reg)
    return {"id": reg.id, "driver_id_resuelto": driver_id, "ok": True}


@router.delete("/combustible/{registro_id}", status_code=204)
def eliminar_combustible(
    registro_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    reg = db.get(CombustibleRegistro, registro_id)
    if not reg:
        raise HTTPException(status_code=404, detail="Registro no encontrado")
    db.delete(reg)
    db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# TAG / Peajes
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/tag")
def listar_tag(
    patente: Optional[str] = Query(None),
    desde: Optional[date] = Query(None),
    hasta: Optional[date] = Query(None),
    proveedor: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    q = db.query(RegistroTag)
    if patente:
        q = q.filter(RegistroTag.patente == patente.upper())
    if desde:
        q = q.filter(RegistroTag.fecha_inicio_periodo >= desde)
    if hasta:
        q = q.filter(RegistroTag.fecha_fin_periodo <= hasta)
    if proveedor:
        q = q.filter(RegistroTag.proveedor.ilike(f"%{proveedor}%"))

    registros = q.order_by(RegistroTag.fecha_inicio_periodo.desc()).all()

    # Para cada registro calcular atribución a conductores
    result = []
    for r in registros:
        atribucion = _calcular_atribucion_tag(db, r)
        result.append({
            "id": r.id,
            "patente": r.patente,
            "fecha_inicio_periodo": r.fecha_inicio_periodo.isoformat(),
            "fecha_fin_periodo": r.fecha_fin_periodo.isoformat(),
            "monto_total": r.monto_total,
            "numero_transacciones": r.numero_transacciones,
            "proveedor": r.proveedor,
            "archivo_origen": r.archivo_origen,
            "notas": r.notas,
            "atribucion": atribucion,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })
    return result


def _calcular_atribucion_tag(db: Session, tag: RegistroTag) -> list[dict]:
    """
    Distribuye el costo del período del TAG entre los conductores según días de uso.
    Lógica:
      - Para cada día del período busca el conductor responsable (excepción > defecto).
      - Agrupa días por driver_id y prorratea el monto total.
    """
    dias_por_driver: dict[int, int] = {}
    dias_sin_conductor = 0
    dias_totales = (tag.fecha_fin_periodo - tag.fecha_inicio_periodo).days + 1

    cur = tag.fecha_inicio_periodo
    while cur <= tag.fecha_fin_periodo:
        driver_id = _resolver_conductor(db, tag.patente, cur)
        if driver_id:
            dias_por_driver[driver_id] = dias_por_driver.get(driver_id, 0) + 1
        else:
            dias_sin_conductor += 1
        cur += timedelta(days=1)

    drivers_map = {d.id: d for d in db.query(Driver).filter(Driver.id.in_(dias_por_driver.keys())).all()}

    atribucion = []
    for driver_id, dias in dias_por_driver.items():
        monto = round(tag.monto_total * dias / dias_totales)
        d = drivers_map.get(driver_id)
        atribucion.append({
            "driver_id": driver_id,
            "driver_nombre": d.nombre if d else str(driver_id),
            "dias": dias,
            "monto_atribuido": monto,
            "porcentaje": round(dias / dias_totales * 100, 1),
        })

    if dias_sin_conductor > 0:
        atribucion.append({
            "driver_id": None,
            "driver_nombre": "Sin conductor asignado",
            "dias": dias_sin_conductor,
            "monto_atribuido": round(tag.monto_total * dias_sin_conductor / dias_totales),
            "porcentaje": round(dias_sin_conductor / dias_totales * 100, 1),
        })

    return sorted(atribucion, key=lambda x: x["dias"], reverse=True)


@router.post("/tag", status_code=201)
def registrar_tag(
    body: dict,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    patente = (body.get("patente") or "").strip().upper()
    inicio_str = body.get("fecha_inicio_periodo")
    fin_str = body.get("fecha_fin_periodo")
    monto = body.get("monto_total")

    if not patente or not inicio_str or not fin_str or monto is None:
        raise HTTPException(
            status_code=400,
            detail="patente, fecha_inicio_periodo, fecha_fin_periodo y monto_total son obligatorios",
        )

    if not db.get(VehiculoEmpresa, patente):
        raise HTTPException(status_code=404, detail="Vehículo no encontrado")

    usuario = current_user.get("username") or current_user.get("sub", "admin")
    reg = RegistroTag(
        patente=patente,
        fecha_inicio_periodo=date.fromisoformat(inicio_str),
        fecha_fin_periodo=date.fromisoformat(fin_str),
        monto_total=int(monto),
        numero_transacciones=body.get("numero_transacciones"),
        proveedor=body.get("proveedor"),
        archivo_origen=body.get("archivo_origen"),
        detalle_json=body.get("detalle_json"),
        notas=body.get("notas"),
        creado_por=usuario,
    )
    db.add(reg)
    db.commit()
    db.refresh(reg)
    return {"id": reg.id, "ok": True, "atribucion": _calcular_atribucion_tag(db, reg)}


@router.delete("/tag/{tag_id}", status_code=204)
def eliminar_tag(
    tag_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin),
):
    reg = db.get(RegistroTag, tag_id)
    if not reg:
        raise HTTPException(status_code=404, detail="Registro TAG no encontrado")
    db.delete(reg)
    db.commit()
