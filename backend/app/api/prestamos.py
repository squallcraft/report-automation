"""
API Préstamos: gestión de préstamos a trabajadores y drivers.
"""
import math
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc

from app.database import get_db
from app.auth import require_admin, require_permission
from app.models import (
    Prestamo, CuotaPrestamo, Trabajador, Driver,
    EstadoPrestamoEnum, TipoBeneficiarioEnum,
)
from app.schemas import PrestamoCreate, PrestamoOut, CuotaPrestamoOut
from app.services.audit import registrar as audit

router = APIRouter(prefix="/prestamos", tags=["prestamos"])


def _nombre_beneficiario(p: Prestamo, db: Session) -> str:
    if p.tipo_beneficiario == TipoBeneficiarioEnum.TRABAJADOR.value and p.trabajador_id:
        t = db.get(Trabajador, p.trabajador_id)
        return t.nombre if t else "—"
    if p.tipo_beneficiario == TipoBeneficiarioEnum.DRIVER.value and p.driver_id:
        d = db.get(Driver, p.driver_id)
        return d.nombre if d else "—"
    return "—"


def _enrich(p: Prestamo, db: Session) -> dict:
    cuotas_pagadas = db.query(sqlfunc.count(CuotaPrestamo.id)).filter(
        CuotaPrestamo.prestamo_id == p.id, CuotaPrestamo.pagado == True
    ).scalar() or 0
    cuotas_total = db.query(sqlfunc.count(CuotaPrestamo.id)).filter(
        CuotaPrestamo.prestamo_id == p.id
    ).scalar() or 0
    return {
        "id": p.id,
        "tipo_beneficiario": p.tipo_beneficiario,
        "trabajador_id": p.trabajador_id,
        "driver_id": p.driver_id,
        "beneficiario_nombre": _nombre_beneficiario(p, db),
        "monto_total": p.monto_total,
        "monto_cuota": p.monto_cuota,
        "saldo_pendiente": p.saldo_pendiente,
        "modalidad": p.modalidad,
        "porcentaje": p.porcentaje,
        "mes_inicio": p.mes_inicio,
        "anio_inicio": p.anio_inicio,
        "motivo": p.motivo,
        "estado": p.estado,
        "cuotas_pagadas": cuotas_pagadas,
        "cuotas_total": cuotas_total,
        "created_at": p.created_at,
    }


def _generar_cuotas(db: Session, prestamo: Prestamo):
    """Genera las cuotas futuras del préstamo."""
    if prestamo.monto_cuota <= 0:
        return
    n_cuotas = math.ceil(prestamo.monto_total / prestamo.monto_cuota)
    mes = prestamo.mes_inicio
    anio = prestamo.anio_inicio
    restante = prestamo.monto_total

    for _ in range(n_cuotas):
        monto = min(prestamo.monto_cuota, restante)
        cuota = CuotaPrestamo(
            prestamo_id=prestamo.id,
            mes=mes, anio=anio,
            monto=monto,
            pagado=False,
        )
        db.add(cuota)
        restante -= monto
        if restante <= 0:
            break
        mes += 1
        if mes > 12:
            mes = 1
            anio += 1


# ── CRUD ──

@router.get("", response_model=List[PrestamoOut])
def listar_prestamos(
    estado: Optional[str] = None,
    tipo: Optional[str] = None,
    db: Session = Depends(get_db),
    _=require_permission("prestamos:ver"),
):
    query = db.query(Prestamo)
    if estado:
        query = query.filter(Prestamo.estado == estado)
    if tipo:
        query = query.filter(Prestamo.tipo_beneficiario == tipo)
    prestamos = query.order_by(Prestamo.created_at.desc()).all()
    return [_enrich(p, db) for p in prestamos]


@router.get("/{prestamo_id}")
def obtener_prestamo(
    prestamo_id: int,
    db: Session = Depends(get_db),
    _=require_permission("prestamos:ver"),
):
    p = db.get(Prestamo, prestamo_id)
    if not p:
        raise HTTPException(status_code=404, detail="Préstamo no encontrado")
    data = _enrich(p, db)
    data["cuotas"] = [
        {
            "id": c.id, "mes": c.mes, "anio": c.anio,
            "monto": c.monto, "pagado": c.pagado, "fecha_pago": c.fecha_pago,
        }
        for c in p.cuotas
    ]
    return data


@router.post("", response_model=PrestamoOut, status_code=201)
def crear_prestamo(
    data: PrestamoCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    if data.tipo_beneficiario == TipoBeneficiarioEnum.TRABAJADOR.value:
        if not data.trabajador_id or not db.get(Trabajador, data.trabajador_id):
            raise HTTPException(status_code=400, detail="Trabajador no encontrado")
    elif data.tipo_beneficiario == TipoBeneficiarioEnum.DRIVER.value:
        if not data.driver_id or not db.get(Driver, data.driver_id):
            raise HTTPException(status_code=400, detail="Driver no encontrado")
    else:
        raise HTTPException(status_code=400, detail="Tipo de beneficiario inválido")

    prestamo = Prestamo(
        tipo_beneficiario=data.tipo_beneficiario,
        trabajador_id=data.trabajador_id if data.tipo_beneficiario == TipoBeneficiarioEnum.TRABAJADOR.value else None,
        driver_id=data.driver_id if data.tipo_beneficiario == TipoBeneficiarioEnum.DRIVER.value else None,
        monto_total=data.monto_total,
        monto_cuota=data.monto_cuota,
        saldo_pendiente=data.monto_total,
        modalidad=data.modalidad,
        porcentaje=data.porcentaje,
        mes_inicio=data.mes_inicio,
        anio_inicio=data.anio_inicio,
        motivo=data.motivo,
        estado=EstadoPrestamoEnum.ACTIVO.value,
    )
    db.add(prestamo)
    db.flush()

    _generar_cuotas(db, prestamo)

    audit(db, "crear_prestamo", usuario=current_user, request=request,
          entidad="prestamo", entidad_id=prestamo.id,
          cambios={"monto": data.monto_total, "beneficiario": data.tipo_beneficiario})
    db.commit()
    db.refresh(prestamo)
    return _enrich(prestamo, db)


@router.post("/{prestamo_id}/pagar-cuota")
def pagar_cuota(
    prestamo_id: int,
    request: Request,
    cuota_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    """Marca una cuota como pagada y actualiza el saldo del préstamo."""
    prestamo = db.get(Prestamo, prestamo_id)
    if not prestamo:
        raise HTTPException(status_code=404, detail="Préstamo no encontrado")

    cuota = db.get(CuotaPrestamo, cuota_id)
    if not cuota or cuota.prestamo_id != prestamo_id:
        raise HTTPException(status_code=404, detail="Cuota no encontrada")
    if cuota.pagado:
        raise HTTPException(status_code=400, detail="Cuota ya pagada")

    from datetime import date
    cuota.pagado = True
    cuota.fecha_pago = date.today()
    prestamo.saldo_pendiente = max(0, prestamo.saldo_pendiente - cuota.monto)

    if prestamo.saldo_pendiente <= 0:
        prestamo.estado = EstadoPrestamoEnum.PAGADO.value

    audit(db, "pagar_cuota_prestamo", usuario=current_user, request=request,
          entidad="prestamo", entidad_id=prestamo_id,
          metadata={"cuota_id": cuota_id, "monto": cuota.monto})
    db.commit()
    return {"ok": True, "saldo_pendiente": prestamo.saldo_pendiente, "estado": prestamo.estado}


@router.post("/{prestamo_id}/cancelar")
def cancelar_prestamo(
    prestamo_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin),
):
    prestamo = db.get(Prestamo, prestamo_id)
    if not prestamo:
        raise HTTPException(status_code=404, detail="Préstamo no encontrado")
    prestamo.estado = EstadoPrestamoEnum.CANCELADO.value
    audit(db, "cancelar_prestamo", usuario=current_user, request=request,
          entidad="prestamo", entidad_id=prestamo_id)
    db.commit()
    return {"ok": True}


# ── Consultas por beneficiario ──

@router.get("/por-trabajador/{trabajador_id}")
def prestamos_por_trabajador(
    trabajador_id: int,
    db: Session = Depends(get_db),
    _=require_permission("prestamos:ver"),
):
    prestamos = db.query(Prestamo).filter(
        Prestamo.tipo_beneficiario == TipoBeneficiarioEnum.TRABAJADOR.value,
        Prestamo.trabajador_id == trabajador_id,
    ).order_by(Prestamo.created_at.desc()).all()
    return [_enrich(p, db) for p in prestamos]


@router.get("/por-driver/{driver_id}")
def prestamos_por_driver(
    driver_id: int,
    db: Session = Depends(get_db),
    _=require_permission("prestamos:ver"),
):
    prestamos = db.query(Prestamo).filter(
        Prestamo.tipo_beneficiario == TipoBeneficiarioEnum.DRIVER.value,
        Prestamo.driver_id == driver_id,
    ).order_by(Prestamo.created_at.desc()).all()
    return [_enrich(p, db) for p in prestamos]


# ── Cuotas pendientes de un período (para integrar con liquidaciones) ──

@router.get("/cuotas-pendientes")
def cuotas_pendientes(
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=require_permission("prestamos:ver"),
):
    """Devuelve cuotas pendientes del período, agrupadas por beneficiario."""
    cuotas = db.query(CuotaPrestamo).join(Prestamo).filter(
        CuotaPrestamo.mes == mes,
        CuotaPrestamo.anio == anio,
        CuotaPrestamo.pagado == False,
        Prestamo.estado == EstadoPrestamoEnum.ACTIVO.value,
    ).all()

    resultado = []
    for c in cuotas:
        p = c.prestamo
        resultado.append({
            "cuota_id": c.id,
            "prestamo_id": p.id,
            "tipo_beneficiario": p.tipo_beneficiario,
            "trabajador_id": p.trabajador_id,
            "driver_id": p.driver_id,
            "beneficiario_nombre": _nombre_beneficiario(p, db),
            "monto_cuota": c.monto,
            "saldo_prestamo": p.saldo_pendiente,
            "motivo": p.motivo,
        })
    return resultado
