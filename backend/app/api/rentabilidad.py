"""
API de rentabilidad de conductores.

Endpoints:
  GET /rentabilidad/semanas           — Lista semanas disponibles
  GET /rentabilidad/general           — Vista todos los conductores (semana o mes)
  GET /rentabilidad/contratados       — Vista detallada conductores contratados
  GET /rentabilidad/contratados/{id}  — Detalle de un conductor contratado

Lógica de cálculo:
  Independientes:
    ingresos_generados = Σ envios del driver en período × tarifa cobrada al seller
    costo_driver       = PagoSemanaDriver del período (monto real pagado)
    margen_bruto       = ingresos_generados - costo_driver

  Contratados (hereda margen bruto + agrega):
    nomina_semana      = LiquidacionMensual.(imponible + leyes) / 4.33
    combustible_semana = Σ CombustibleRegistro del driver en la semana
    tag_semana         = Σ RegistroTag atribuidos al driver (pro-rata por días)
    retiros_valor      = Σ Retiros del driver × tarifa_retiro_fija del driver
    resultado_neto     = margen_bruto + retiros_valor - nomina_semana
                         - combustible_semana - tag_semana
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func as sqlfunc
from sqlalchemy.orm import Session

from app.auth import require_admin_or_administracion
from app.database import get_db
from app.models import (
    Driver, Envio, PagoSemanaDriver, CalendarioSemanas,
    LiquidacionMensual, Retiro,
    CombustibleRegistro, RegistroTag, UsoVehiculoExcepcion,
)

router = APIRouter(prefix="/rentabilidad", tags=["Rentabilidad"])

# Leyes sociales patronales vigentes 2026
_TASA_SIS        = 0.0154
_TASA_AFC_INDEF  = 0.024
_TASA_MUTUAL     = 0.0093
_TASA_LEYES      = _TASA_SIS + _TASA_AFC_INDEF + _TASA_MUTUAL   # 5.47 %
_SEMANAS_MES     = 4.33


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _semanas_del_mes(db: Session, mes: int, anio: int) -> list[CalendarioSemanas]:
    return (
        db.query(CalendarioSemanas)
        .filter_by(mes=mes, anio=anio)
        .order_by(CalendarioSemanas.semana)
        .all()
    )


def _ingresos_driver_semana(db: Session, driver_id: int, semana: int, mes: int, anio: int) -> int:
    """Suma de (tarifa_driver × envios) en la semana — aproximado con monto_neto del CPC."""
    pago = (
        db.query(PagoSemanaDriver)
        .filter_by(driver_id=driver_id, semana=semana, mes=mes, anio=anio)
        .first()
    )
    # monto_neto en PagoSemanaDriver ≈ entregas × tarifa cobrada al seller menos nada
    # Se usa como proxy de ingresos brutos generados; el monto_override si existe.
    if not pago:
        return 0
    return pago.monto_override if pago.monto_override is not None else pago.monto_neto


def _costo_driver_semana(db: Session, driver_id: int, semana: int, mes: int, anio: int) -> int:
    """Lo que pagamos al driver (independiente) esa semana."""
    return _ingresos_driver_semana(db, driver_id, semana, mes, anio)


def _paquetes_semana(db: Session, driver_id: int, semana: int, mes: int, anio: int) -> int:
    row = (
        db.query(sqlfunc.count(Envio.id))
        .filter_by(driver_id=driver_id, semana=semana, mes=mes, anio=anio)
        .scalar()
    )
    return row or 0


def _retiros_semana(db: Session, driver: Driver, semana: int, mes: int, anio: int) -> dict:
    """
    Cantidad de retiros y su valor económico para la empresa.

    Para conductores contratados:
      - tarifa_driver = 0 (no generan pago extra), pero costo_empresa refleja el
        valor que la empresa absorbe por incluirlos en la jornada del conductor.
    Para conductores independientes:
      - tarifa_driver refleja el pago real al driver.
    """
    retiros = (
        db.query(Retiro)
        .filter_by(driver_id=driver.id, semana=semana, mes=mes, anio=anio)
        .all()
    )
    cantidad = len(retiros)
    if driver.contratado:
        valor = sum(r.costo_empresa or 0 for r in retiros)
    else:
        valor = sum(r.tarifa_driver or driver.tarifa_retiro_fija or 0 for r in retiros)
    return {"cantidad": cantidad, "valor": valor}


def _nomina_semana(db: Session, driver: Driver, semana: int, mes: int, anio: int) -> int:
    """Costo semanal prorrateado de la nómina (LiquidacionMensual / 4.33)."""
    if not driver.contratado or not driver.trabajador_id:
        return 0
    liq = (
        db.query(LiquidacionMensual)
        .filter_by(trabajador_id=driver.trabajador_id, mes=mes, anio=anio)
        .first()
    )
    if not liq:
        return 0
    costo_mensual = liq.remuneracion_imponible + round(liq.remuneracion_imponible * _TASA_LEYES)
    return round(costo_mensual / _SEMANAS_MES)


def _combustible_semana(db: Session, driver_id: int, semana: int, mes: int, anio: int) -> int:
    row = (
        db.query(sqlfunc.sum(CombustibleRegistro.monto_total))
        .filter(
            CombustibleRegistro.driver_id_resuelto == driver_id,
            CombustibleRegistro.semana == semana,
            CombustibleRegistro.mes == mes,
            CombustibleRegistro.anio == anio,
        )
        .scalar()
    )
    return int(row or 0)


def _tag_semana(db: Session, driver: Driver, cal: CalendarioSemanas) -> int:
    """
    Suma del TAG atribuido a este conductor en la semana.
    Busca RegistroTag cuyo período se superponga con la semana y prorratea por días.
    """
    if not driver.vehiculo_patente:
        return 0

    # Registros TAG que se solapan con la semana
    tags = (
        db.query(RegistroTag)
        .filter(
            RegistroTag.patente == driver.vehiculo_patente,
            RegistroTag.fecha_inicio_periodo <= cal.fecha_fin,
            RegistroTag.fecha_fin_periodo >= cal.fecha_inicio,
        )
        .all()
    )

    total = 0
    for tag in tags:
        # Días del período total del TAG
        dias_periodo = (tag.fecha_fin_periodo - tag.fecha_inicio_periodo).days + 1
        if dias_periodo <= 0:
            continue

        # Días que este conductor usó el vehículo dentro de la semana
        start = max(tag.fecha_inicio_periodo, cal.fecha_inicio)
        end = min(tag.fecha_fin_periodo, cal.fecha_fin)
        cur = start
        dias_driver = 0
        while cur <= end:
            # ¿Excepción ese día?
            exc = (
                db.query(UsoVehiculoExcepcion)
                .filter_by(patente=driver.vehiculo_patente, fecha=cur)
                .first()
            )
            if exc:
                if exc.driver_id == driver.id:
                    dias_driver += 1
            else:
                # Asignación por defecto: si este driver tiene el vehículo
                dias_driver += 1
            cur += timedelta(days=1)

        total += round(tag.monto_total * dias_driver / dias_periodo)

    return total


def _row_general(db: Session, driver: Driver, semana: int, mes: int, anio: int) -> dict:
    ingresos = _ingresos_driver_semana(db, driver.id, semana, mes, anio)
    costo_cpc = _costo_driver_semana(db, driver.id, semana, mes, anio)
    paquetes = _paquetes_semana(db, driver.id, semana, mes, anio)
    return {
        "driver_id": driver.id,
        "driver_nombre": driver.nombre,
        "zona": driver.zona,
        "contratado": driver.contratado,
        "semana": semana,
        "mes": mes,
        "anio": anio,
        "paquetes": paquetes,
        "ingresos_generados": ingresos,
        "costo_cpc": costo_cpc,
        "margen_bruto": ingresos - costo_cpc,
    }


def _row_contratado(db: Session, driver: Driver, cal: CalendarioSemanas) -> dict:
    semana, mes, anio = cal.semana, cal.mes, cal.anio

    ingresos = _ingresos_driver_semana(db, driver.id, semana, mes, anio)
    paquetes = _paquetes_semana(db, driver.id, semana, mes, anio)
    retiros = _retiros_semana(db, driver, semana, mes, anio)
    nomina = _nomina_semana(db, driver, semana, mes, anio)
    combustible = _combustible_semana(db, driver.id, semana, mes, anio)
    tag = _tag_semana(db, driver, cal)

    resultado_neto = ingresos + retiros["valor"] - nomina - combustible - tag

    # Proyección mensual basada en esta semana
    proyeccion_mensual = round(resultado_neto * _SEMANAS_MES)

    # Meta: 30 paquetes/día × 5 días = 150/semana
    meta_semana = 150
    estado = (
        "verde" if resultado_neto >= 0 else
        "amarillo" if resultado_neto >= -nomina * 0.3 else
        "rojo"
    )

    return {
        "driver_id": driver.id,
        "driver_nombre": driver.nombre,
        "zona": driver.zona,
        "vehiculo_patente": driver.vehiculo_patente,
        "semana": semana,
        "mes": mes,
        "anio": anio,
        "fecha_inicio": cal.fecha_inicio.isoformat(),
        "fecha_fin": cal.fecha_fin.isoformat(),
        "paquetes": paquetes,
        "paquetes_diarios_promedio": round(paquetes / 5, 1),
        "meta_semana": meta_semana,
        "cumple_meta": paquetes >= meta_semana,
        # Ingresos
        "ingresos_entregas": ingresos,
        "retiros_cantidad": retiros["cantidad"],
        "retiros_valor": retiros["valor"],
        "total_ingresos": ingresos + retiros["valor"],
        # Costos
        "nomina_semana": nomina,
        "combustible_semana": combustible,
        "tag_semana": tag,
        "total_costos": nomina + combustible + tag,
        # Resultado
        "resultado_neto": resultado_neto,
        "proyeccion_mensual": proyeccion_mensual,
        "estado": estado,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/semanas")
def listar_semanas(
    mes: Optional[int] = Query(None),
    anio: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    q = db.query(CalendarioSemanas)
    if mes:
        q = q.filter_by(mes=mes)
    if anio:
        q = q.filter_by(anio=anio)
    semanas = q.order_by(CalendarioSemanas.anio.desc(), CalendarioSemanas.mes.desc(), CalendarioSemanas.semana.desc()).limit(52).all()
    return [
        {
            "semana": s.semana, "mes": s.mes, "anio": s.anio,
            "fecha_inicio": s.fecha_inicio.isoformat(),
            "fecha_fin": s.fecha_fin.isoformat(),
        }
        for s in semanas
    ]


@router.get("/general")
def rentabilidad_general(
    semana: Optional[int] = Query(None),
    mes: int = Query(...),
    anio: int = Query(...),
    zona: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    """Vista de todos los conductores: margen bruto. Si semana=None, agrega todo el mes."""
    q = db.query(Driver).filter(Driver.activo == True)
    if zona:
        q = q.filter(Driver.zona.ilike(f"%{zona}%"))
    drivers = q.order_by(Driver.nombre).all()

    if semana is not None:
        rows = [_row_general(db, d, semana, mes, anio) for d in drivers]
    else:
        nums_semana = [
            cal.semana for cal in _semanas_del_mes(db, mes, anio)
        ] or [1, 2, 3, 4]
        rows = []
        for driver in drivers:
            agg: dict = {
                "driver_id": driver.id,
                "driver_nombre": driver.nombre,
                "zona": driver.zona,
                "contratado": driver.contratado,
                "semana": None, "mes": mes, "anio": anio,
                "paquetes": 0, "ingresos_generados": 0, "costo_cpc": 0,
            }
            for s in nums_semana:
                r = _row_general(db, driver, s, mes, anio)
                agg["paquetes"] += r["paquetes"]
                agg["ingresos_generados"] += r["ingresos_generados"]
                agg["costo_cpc"] += r["costo_cpc"]
            agg["margen_bruto"] = agg["ingresos_generados"] - agg["costo_cpc"]
            rows.append(agg)

    rows = [r for r in rows if r["paquetes"] > 0 or r["ingresos_generados"] > 0]
    rows.sort(key=lambda x: x["margen_bruto"], reverse=True)

    totales = {
        "paquetes": sum(r["paquetes"] for r in rows),
        "ingresos_generados": sum(r["ingresos_generados"] for r in rows),
        "costo_cpc": sum(r["costo_cpc"] for r in rows),
        "margen_bruto": sum(r["margen_bruto"] for r in rows),
    }

    return {"semana": semana, "mes": mes, "anio": anio, "drivers": rows, "totales": totales}


@router.get("/contratados")
def rentabilidad_contratados(
    semana: Optional[int] = Query(None),
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    """Vista detallada de conductores contratados. Si semana=None, agrega todo el mes."""
    drivers = (
        db.query(Driver)
        .filter(Driver.contratado == True, Driver.activo == True)
        .order_by(Driver.nombre)
        .all()
    )

    if semana is not None:
        cal = (
            db.query(CalendarioSemanas)
            .filter_by(semana=semana, mes=mes, anio=anio)
            .first()
        )
        if not cal:
            raise HTTPException(status_code=404, detail="Semana no encontrada en el calendario")
        rows = [_row_contratado(db, d, cal) for d in drivers]
        fecha_inicio = cal.fecha_inicio.isoformat()
        fecha_fin = cal.fecha_fin.isoformat()
    else:
        semanas_mes = _semanas_del_mes(db, mes, anio)
        if not semanas_mes:
            raise HTTPException(status_code=404, detail="No hay semanas configuradas para ese período")
        fecha_inicio = semanas_mes[0].fecha_inicio.isoformat()
        fecha_fin = semanas_mes[-1].fecha_fin.isoformat()
        rows = []
        for driver in drivers:
            serie = [_row_contratado(db, driver, cal) for cal in semanas_mes]
            resultado_neto = sum(r["resultado_neto"] for r in serie)
            nomina = sum(r["nomina_semana"] for r in serie)
            rows.append({
                "driver_id": driver.id,
                "driver_nombre": driver.nombre,
                "zona": driver.zona,
                "vehiculo_patente": driver.vehiculo_patente,
                "semana": None, "mes": mes, "anio": anio,
                "fecha_inicio": fecha_inicio, "fecha_fin": fecha_fin,
                "paquetes": sum(r["paquetes"] for r in serie),
                "paquetes_diarios_promedio": round(sum(r["paquetes"] for r in serie) / (len(semanas_mes) * 5), 1),
                "meta_semana": 150 * len(semanas_mes),
                "cumple_meta": sum(r["paquetes"] for r in serie) >= 150 * len(semanas_mes),
                "ingresos_entregas": sum(r["ingresos_entregas"] for r in serie),
                "retiros_cantidad": sum(r["retiros_cantidad"] for r in serie),
                "retiros_valor": sum(r["retiros_valor"] for r in serie),
                "total_ingresos": sum(r["total_ingresos"] for r in serie),
                "nomina_semana": nomina,
                "combustible_semana": sum(r["combustible_semana"] for r in serie),
                "tag_semana": sum(r["tag_semana"] for r in serie),
                "total_costos": sum(r["total_costos"] for r in serie),
                "resultado_neto": resultado_neto,
                "proyeccion_mensual": resultado_neto,  # mes completo, la proyección ES el real
                "estado": (
                    "verde" if resultado_neto >= 0 else
                    "amarillo" if resultado_neto >= -nomina * 0.3 else
                    "rojo"
                ),
            })

    rows.sort(key=lambda x: x["resultado_neto"], reverse=True)

    totales = {
        "paquetes": sum(r["paquetes"] for r in rows),
        "ingresos_entregas": sum(r["ingresos_entregas"] for r in rows),
        "retiros_valor": sum(r["retiros_valor"] for r in rows),
        "nomina_semana": sum(r["nomina_semana"] for r in rows),
        "combustible_semana": sum(r["combustible_semana"] for r in rows),
        "tag_semana": sum(r["tag_semana"] for r in rows),
        "resultado_neto": sum(r["resultado_neto"] for r in rows),
        "proyeccion_mensual": sum(r["proyeccion_mensual"] for r in rows),
    }

    return {
        "semana": semana, "mes": mes, "anio": anio,
        "fecha_inicio": fecha_inicio,
        "fecha_fin": fecha_fin,
        "drivers": rows,
        "totales": totales,
    }


@router.get("/contratados/{driver_id}")
def detalle_contratado(
    driver_id: int,
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin_or_administracion),
):
    """Serie semanal completa del mes para un conductor contratado."""
    driver = db.get(Driver, driver_id)
    if not driver or not driver.contratado:
        raise HTTPException(status_code=404, detail="Conductor contratado no encontrado")

    semanas = _semanas_del_mes(db, mes, anio)
    if not semanas:
        raise HTTPException(status_code=404, detail="No hay semanas configuradas para ese período")

    serie = [_row_contratado(db, driver, cal) for cal in semanas]

    return {
        "driver_id": driver.id,
        "driver_nombre": driver.nombre,
        "zona": driver.zona,
        "vehiculo_patente": driver.vehiculo_patente,
        "mes": mes,
        "anio": anio,
        "serie_semanal": serie,
        "totales_mes": {
            "paquetes": sum(r["paquetes"] for r in serie),
            "ingresos_entregas": sum(r["ingresos_entregas"] for r in serie),
            "retiros_valor": sum(r["retiros_valor"] for r in serie),
            "nomina_mes": sum(r["nomina_semana"] for r in serie),
            "combustible_mes": sum(r["combustible_semana"] for r in serie),
            "tag_mes": sum(r["tag_semana"] for r in serie),
            "resultado_neto_mes": sum(r["resultado_neto"] for r in serie),
        },
    }
