"""
API Trabajadores: CRUD de trabajadores y pagos vía cartola bancaria.
"""
import io
from difflib import SequenceMatcher
from typing import Optional, List

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc

from app.database import get_db
from app.auth import require_admin, require_admin_or_administracion, require_permission
from app.models import Trabajador, PagoTrabajador, Prestamo, VacacionTrabajador
from app.schemas import TrabajadorCreate, TrabajadorUpdate, TrabajadorOut, VacacionCreate, VacacionOut
from app.services.audit import registrar as audit
from app.services.remuneraciones import aplicar_calculo_a_trabajador, calcular_desde_liquido, TASAS_AFP, IMM, VALOR_UF, TOPE_GRATIFICACION_MENSUAL
from app.services.parametros import obtener_parametros, actualizar_mes_actual

router = APIRouter(prefix="/trabajadores", tags=["trabajadores"])


@router.get("/constantes-remuneracion")
def constantes_remuneracion(db: Session = Depends(get_db)):
    """Constantes y tasas vigentes para cálculo de remuneraciones (valores del mes actual)."""
    from datetime import date
    hoy = date.today()
    params = obtener_parametros(db, hoy.year, hoy.month)
    tope_grat = round(4.75 * params["imm"] / 12)
    return {
        "tasas_afp": {k: round(v * 100, 2) for k, v in TASAS_AFP.items()},
        "tasa_salud_fonasa": 7.0,
        "tasa_cesantia_trabajador": 0.6,
        "imm": params["imm"],
        "valor_uf": params["uf"],
        "utm": params["utm"],
        "tope_gratificacion_mensual": tope_grat,
        "fuente": params.get("fuente"),
        "updated_at": params.get("updated_at"),
    }


@router.post("/simular-calculo")
def simular_calculo(
    sueldo_liquido: int = Query(..., gt=0),
    afp: str = Query("Capital"),
    sistema_salud: str = Query("FONASA"),
    monto_cotizacion_salud: Optional[str] = Query(None),
    tipo_contrato: str = Query("INDEFINIDO"),
    movilizacion: int = Query(0),
    colacion: int = Query(0),
    viaticos: int = Query(0),
    db: Session = Depends(get_db),
):
    """Simula el cálculo sin crear ni modificar un trabajador. Usa UF/UTM del mes actual."""
    from datetime import date
    hoy = date.today()
    params = obtener_parametros(db, hoy.year, hoy.month)
    r = calcular_desde_liquido(
        sueldo_liquido=sueldo_liquido,
        afp=afp,
        sistema_salud=sistema_salud,
        monto_cotizacion_salud=monto_cotizacion_salud,
        tipo_contrato=tipo_contrato,
        movilizacion=movilizacion,
        colacion=colacion,
        viaticos=viaticos,
        utm=params["utm"],
        valor_uf=float(params["uf"]),
        imm=params["imm"],
    )
    return {
        "sueldo_liquido": r.sueldo_liquido,
        "sueldo_base": r.sueldo_base,
        "gratificacion": r.gratificacion,
        "remuneracion_imponible": r.remuneracion_imponible,
        "descuento_afp": r.descuento_afp,
        "descuento_salud": r.descuento_salud_legal,
        "adicional_isapre": r.adicional_isapre,
        "descuento_cesantia": r.descuento_cesantia,
        "iusc": r.iusc,
        "total_descuentos": r.total_descuentos,
        "liquido_verificado": r.liquido_verificado,
        "costo_empresa_total": r.costo_empresa_total,
        "uf_usada": float(params["uf"]),
        "utm_usada": params["utm"],
        "imm_usado": params["imm"],
        "fuente": params.get("fuente"),
    }


# ── CRUD ──

@router.get("", response_model=List[TrabajadorOut])
def listar_trabajadores(
    activo: Optional[bool] = None,
    q: Optional[str] = None,
    db: Session = Depends(get_db),
    _=Depends(require_permission("trabajadores:ver")),
):
    query = db.query(Trabajador)
    if activo is not None:
        query = query.filter(Trabajador.activo == activo)
    if q:
        query = query.filter(Trabajador.nombre.ilike(f"%{q}%"))
    return query.order_by(Trabajador.nombre).all()


@router.get("/{trabajador_id}", response_model=TrabajadorOut)
def obtener_trabajador(
    trabajador_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_permission("trabajadores:ver")),
):
    t = db.get(Trabajador, trabajador_id)
    if not t:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")
    return t


@router.post("", response_model=TrabajadorOut, status_code=201)
def crear_trabajador(
    data: TrabajadorCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("trabajadores:editar")),
):
    from datetime import date
    hoy = date.today()
    params = obtener_parametros(db, hoy.year, hoy.month)
    t = Trabajador(**data.model_dump(exclude={"sueldo_bruto", "costo_afp", "costo_salud", "sueldo_base", "gratificacion", "descuento_cesantia", "iusc", "adicional_isapre"}))
    aplicar_calculo_a_trabajador(t, params)
    db.add(t)
    db.commit()
    db.refresh(t)
    audit(db, "crear_trabajador", usuario=current_user, request=request,
          entidad="trabajador", entidad_id=t.id,
          cambios={"nombre": t.nombre})
    db.commit()
    return t


@router.put("/{trabajador_id}", response_model=TrabajadorOut)
def actualizar_trabajador(
    trabajador_id: int,
    data: TrabajadorUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("trabajadores:editar")),
):
    t = db.get(Trabajador, trabajador_id)
    if not t:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(t, field, value)
    from datetime import date as _date
    hoy = _date.today()
    params = obtener_parametros(db, hoy.year, hoy.month)
    aplicar_calculo_a_trabajador(t, params)
    audit(db, "actualizar_trabajador", usuario=current_user, request=request,
          entidad="trabajador", entidad_id=t.id, cambios=update_data)
    db.commit()
    db.refresh(t)
    return t


@router.delete("/{trabajador_id}")
def eliminar_trabajador(
    trabajador_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("trabajadores:editar")),
):
    t = db.get(Trabajador, trabajador_id)
    if not t:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")
    t.activo = False
    audit(db, "desactivar_trabajador", usuario=current_user, request=request,
          entidad="trabajador", entidad_id=t.id)
    db.commit()
    return {"ok": True}


# ── Pagos ──

@router.get("/{trabajador_id}/pagos")
def listar_pagos(
    trabajador_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_permission("trabajadores:ver")),
):
    pagos = db.query(PagoTrabajador).filter(
        PagoTrabajador.trabajador_id == trabajador_id,
    ).order_by(PagoTrabajador.anio.desc(), PagoTrabajador.mes.desc()).all()
    return [
        {
            "id": p.id, "mes": p.mes, "anio": p.anio,
            "monto": p.monto, "fecha_pago": p.fecha_pago,
            "descripcion": p.descripcion, "fuente": p.fuente,
        }
        for p in pagos
    ]


class PagoManualRequest(BaseModel):
    mes: int
    anio: int
    monto: int
    fecha_pago: Optional[str] = None
    descripcion: Optional[str] = None


@router.post("/{trabajador_id}/pagos")
def registrar_pago_manual(
    trabajador_id: int,
    body: PagoManualRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("trabajadores:editar")),
):
    t = db.get(Trabajador, trabajador_id)
    if not t:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")
    pago = PagoTrabajador(
        trabajador_id=trabajador_id,
        mes=body.mes, anio=body.anio,
        monto=body.monto,
        fecha_pago=body.fecha_pago,
        descripcion=body.descripcion,
        fuente="manual",
    )
    db.add(pago)
    audit(db, "pago_manual_trabajador", usuario=current_user, request=request,
          entidad="trabajador", entidad_id=trabajador_id,
          metadata={"monto": body.monto, "mes": body.mes, "anio": body.anio})
    db.commit()
    return {"ok": True, "id": pago.id}


# ── Cartola (import bank payments) ──

def _similaridad(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


@router.post("/cartola/preview")
async def cartola_preview(
    mes: int = Query(...),
    anio: int = Query(...),
    archivo: UploadFile = File(...),
    db: Session = Depends(get_db),
    _=Depends(require_permission("trabajadores:editar")),
):
    from app.api.cpc import _parsear_cartola

    contenido = await archivo.read()
    movimientos = _parsear_cartola(contenido)

    trabajadores = db.query(Trabajador).filter(Trabajador.activo == True).all()

    resultado = []
    for mov in movimientos:
        nombre_norm = mov["nombre_extraido"].lower()
        mejor = None
        mejor_score = 0.0

        for t in trabajadores:
            score = _similaridad(nombre_norm, t.nombre.lower())
            if score > mejor_score:
                mejor_score = score
                mejor = t

        match_confiable = mejor_score >= 0.55

        resultado.append({
            "descripcion": mov["descripcion"],
            "nombre_extraido": mov["nombre_extraido"],
            "fecha": mov["fecha"],
            "monto": mov["monto"],
            "trabajador_id": mejor.id if mejor else None,
            "trabajador_nombre": mejor.nombre if mejor else None,
            "score": round(mejor_score, 2),
            "match_confiable": match_confiable,
        })

    todos = [{"id": t.id, "nombre": t.nombre} for t in sorted(trabajadores, key=lambda x: x.nombre)]
    return {"mes": mes, "anio": anio, "items": resultado, "trabajadores": todos}


class ItemConfirmarCartolaTrabajador(BaseModel):
    trabajador_id: int
    monto: int
    fecha: Optional[str] = None
    descripcion: Optional[str] = None


class ConfirmarCartolaTrabajadorRequest(BaseModel):
    mes: int
    anio: int
    items: List[ItemConfirmarCartolaTrabajador]


@router.post("/cartola/confirmar")
def cartola_confirmar(
    body: ConfirmarCartolaTrabajadorRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("trabajadores:editar")),
):
    grabados = 0
    for item in body.items:
        if item.trabajador_id <= 0 or item.monto <= 0:
            continue
        pago = PagoTrabajador(
            trabajador_id=item.trabajador_id,
            mes=body.mes, anio=body.anio,
            monto=item.monto,
            fecha_pago=item.fecha,
            descripcion=item.descripcion,
            fuente="cartola",
        )
        db.add(pago)
        grabados += 1

    audit(db, "carga_cartola_trabajadores", usuario=current_user, request=request,
          entidad="cartola_trabajadores", entidad_id=0,
          metadata={"mes": body.mes, "anio": body.anio, "transacciones": grabados})
    db.commit()
    return {"ok": True, "grabados": grabados}


# ── Resumen para finanzas ──

@router.get("/costos/mensual")
def costos_mensuales(
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_permission("trabajadores:ver")),
):
    """Total pagado a trabajadores por mes para un año."""
    rows = db.query(
        PagoTrabajador.mes,
        sqlfunc.sum(PagoTrabajador.monto).label("total"),
    ).filter(PagoTrabajador.anio == anio).group_by(PagoTrabajador.mes).all()
    return {str(r.mes): int(r.total) for r in rows}


# ── Vacaciones ──

@router.get("/{trabajador_id}/vacaciones", response_model=List[VacacionOut])
def listar_vacaciones(
    trabajador_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_permission("trabajadores:ver")),
):
    t = db.get(Trabajador, trabajador_id)
    if not t:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")
    return (
        db.query(VacacionTrabajador)
        .filter(VacacionTrabajador.trabajador_id == trabajador_id)
        .order_by(VacacionTrabajador.fecha_inicio.desc())
        .all()
    )


@router.post("/{trabajador_id}/vacaciones", response_model=VacacionOut, status_code=201)
def registrar_vacacion(
    trabajador_id: int,
    data: VacacionCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("trabajadores:editar")),
):
    t = db.get(Trabajador, trabajador_id)
    if not t:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")
    vac = VacacionTrabajador(
        trabajador_id=trabajador_id,
        fecha_inicio=data.fecha_inicio,
        fecha_fin=data.fecha_fin,
        dias_habiles=data.dias_habiles,
        nota=data.nota,
    )
    db.add(vac)
    audit(db, "registrar_vacacion", usuario=current_user, request=request,
          entidad="trabajador", entidad_id=trabajador_id,
          metadata={"fecha_inicio": str(data.fecha_inicio), "fecha_fin": str(data.fecha_fin),
                     "dias_habiles": data.dias_habiles})
    db.commit()
    db.refresh(vac)
    return vac


@router.delete("/vacaciones/{vacacion_id}")
def eliminar_vacacion(
    vacacion_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("trabajadores:editar")),
):
    vac = db.get(VacacionTrabajador, vacacion_id)
    if not vac:
        raise HTTPException(status_code=404, detail="Vacación no encontrada")
    tid = vac.trabajador_id
    db.delete(vac)
    audit(db, "eliminar_vacacion", usuario=current_user, request=request,
          entidad="trabajador", entidad_id=tid,
          metadata={"vacacion_id": vacacion_id})
    db.commit()
    return {"ok": True}


# ── Situación laboral (vacaciones + finiquito) ──

@router.get("/{trabajador_id}/situacion-laboral")
def situacion_laboral(
    trabajador_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_permission("trabajadores:ver")),
):
    from datetime import date as date_type
    import math

    t = db.get(Trabajador, trabajador_id)
    if not t:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")

    hoy = date_type.today()
    fecha_ingreso = t.fecha_ingreso or hoy

    delta = (hoy.year - fecha_ingreso.year) * 12 + (hoy.month - fecha_ingreso.month)
    if hoy.day < fecha_ingreso.day:
        delta -= 1
    antiguedad_meses = max(delta, 0)
    antiguedad_anios_completos = antiguedad_meses // 12

    # Vacation: 1.25 business days per month worked (15 days/year)
    dias_derecho_total = round(antiguedad_meses * 1.25, 2)

    vacaciones = (
        db.query(VacacionTrabajador)
        .filter(VacacionTrabajador.trabajador_id == trabajador_id,
                VacacionTrabajador.estado == "APROBADA")
        .order_by(VacacionTrabajador.fecha_inicio)
        .all()
    )
    dias_tomados = sum(v.dias_habiles for v in vacaciones)
    dias_disponibles = round(dias_derecho_total - dias_tomados, 2)

    detalle_tomadas = [
        {
            "id": v.id,
            "fecha_inicio": v.fecha_inicio.isoformat(),
            "fecha_fin": v.fecha_fin.isoformat(),
            "dias_habiles": v.dias_habiles,
            "nota": v.nota,
        }
        for v in vacaciones
    ]

    # Severance calculation (Chilean labor law)
    sueldo = t.sueldo_bruto or 0
    movilizacion = t.movilizacion or 0
    colacion = t.colacion or 0
    viaticos = t.viaticos or 0
    base_remuneracion = sueldo + movilizacion + colacion + viaticos

    tope_90uf = VALOR_UF * 90
    base_aplicable = min(base_remuneracion, tope_90uf)

    # Years of service: full years + fraction > 6 months counts as extra year
    meses_fraccion = antiguedad_meses % 12
    anios_servicio = antiguedad_anios_completos + (1 if meses_fraccion > 6 else 0)
    tope_anios = 11
    anios_indemnizables = min(anios_servicio, tope_anios)

    indemnizacion_anios = base_aplicable * anios_indemnizables
    aviso_previo = base_aplicable

    # Feriado proporcional: pending vacation days * (sueldo_bruto / 30)
    tasa_diaria = sueldo / 30 if sueldo > 0 else 0
    feriado_proporcional_valor = round(dias_disponibles * tasa_diaria) if dias_disponibles > 0 else 0

    total_finiquito = indemnizacion_anios + aviso_previo + feriado_proporcional_valor

    return {
        "trabajador_id": t.id,
        "nombre": t.nombre,
        "fecha_ingreso": fecha_ingreso.isoformat(),
        "antiguedad_meses": antiguedad_meses,
        "antiguedad_anios_completos": antiguedad_anios_completos,
        "vacaciones": {
            "dias_derecho_total": dias_derecho_total,
            "dias_tomados": dias_tomados,
            "dias_disponibles": dias_disponibles,
            "detalle_tomadas": detalle_tomadas,
        },
        "indemnizacion": {
            "anios_servicio_indemnizables": anios_indemnizables,
            "tope_anios": tope_anios,
            "base_remuneracion": base_remuneracion,
            "tope_90uf": tope_90uf,
            "base_aplicable": base_aplicable,
            "indemnizacion_anios_servicio": indemnizacion_anios,
            "indemnizacion_aviso_previo": aviso_previo,
            "feriado_proporcional_dias": dias_disponibles if dias_disponibles > 0 else 0,
            "feriado_proporcional_valor": feriado_proporcional_valor,
            "total_finiquito_estimado": total_finiquito,
        },
    }


class SetPasswordRequest(BaseModel):
    password: str


@router.put("/{trabajador_id}/password", dependencies=[Depends(require_admin)])
def set_trabajador_password(
    trabajador_id: int,
    body: SetPasswordRequest,
    db: Session = Depends(get_db),
):
    """Establece o actualiza la contraseña de acceso al portal para un trabajador."""
    t = db.query(Trabajador).filter(Trabajador.id == trabajador_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")
    if not t.email:
        raise HTTPException(status_code=400, detail="El trabajador no tiene email registrado. Agrégalo primero.")
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 6 caracteres.")
    from app.auth import hash_password
    t.password_hash = hash_password(body.password)
    db.commit()
    return {"ok": True, "mensaje": f"Contraseña establecida para {t.nombre}"}


class FirmaRequest(BaseModel):
    firma_base64: str  # data URL: "data:image/png;base64,..."


@router.put("/{trabajador_id}/firma", dependencies=[Depends(require_admin)])
def set_trabajador_firma(
    trabajador_id: int,
    body: FirmaRequest,
    db: Session = Depends(get_db),
):
    """(Admin) Guarda o actualiza la firma digital del trabajador."""
    t = db.query(Trabajador).filter(Trabajador.id == trabajador_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Trabajador no encontrado")
    t.firma_base64 = body.firma_base64
    db.commit()
    return {"ok": True, "mensaje": f"Firma guardada para {t.nombre}"}
