"""
API IVA Drivers — Control de pagos de IVA a conductores externos.
Módulo independiente: no toca PagoCartola ni PagoSemanaDriver (CPC semanal).
"""
import hashlib
import io
import re
from datetime import date
from typing import Optional, List

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.auth import require_admin_or_administracion
from app.models import (
    Driver, PagoIVADriver, PagoCartolaIVA, EstadoPagoIVAEnum,
    FacturaDriver, EstadoFacturaDriverEnum, CartolaCarga, MovimientoFinanciero,
    CategoriaFinanciera,
)
from app.services.iva_drivers import (
    calcular_base_iva_mes, calcular_iva, recalcular_pago_iva, cerrar_pago_iva,
    IVA_RATE,
)
from app.services.contabilidad import asiento_pago_iva_driver
from app.services.audit import registrar as audit

# Reutilizar helpers de CPC para TEF y cartola
from app.api.cpc import (
    _generar_linea_tef, _parsear_cartola, _generar_fingerprint,
    _extraer_nombre_cartola, _similaridad,
    EMISOR_RUT, EMISOR_DV, EMISOR_CUENTA,
)

router = APIRouter(prefix="/iva-drivers", tags=["IVA Drivers"])


# ---------------------------------------------------------------------------
# GET /tabla — listado dinámico de IVA pendiente/pagado por mes de origen
# ---------------------------------------------------------------------------

@router.get("/tabla")
def tabla_iva_drivers(
    mes: int = Query(...),
    anio: int = Query(...),
    estado: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """
    Lista drivers con >= 1 factura aprobada en el mes indicado.
    Calcula base e IVA on-demand para los PENDIENTES.
    Para los PAGADOS retorna los snapshots guardados.
    """
    q = db.query(PagoIVADriver).filter(
        PagoIVADriver.mes_origen == mes,
        PagoIVADriver.anio_origen == anio,
    )
    if estado:
        q = q.filter(PagoIVADriver.estado == estado)
    registros = q.order_by(PagoIVADriver.driver_id).all()

    result = []
    for reg in registros:
        driver = db.get(Driver, reg.driver_id)
        if not driver:
            continue

        # Calcular montos on-demand si PENDIENTE; usar snapshot si PAGADO
        if reg.estado == EstadoPagoIVAEnum.PAGADO.value:
            base = reg.base_iva_snapshot or 0
            iva = reg.monto_iva_snapshot or 0
        else:
            base = calcular_base_iva_mes(db, reg.driver_id, mes, anio)
            iva = calcular_iva(base)

        # Total ya pagado desde cartola IVA
        total_pagado = db.query(
            func.coalesce(func.sum(PagoCartolaIVA.monto), 0)
        ).filter(PagoCartolaIVA.pago_iva_driver_id == reg.id).scalar()

        # Facturas aprobadas del periodo
        facturas = db.query(FacturaDriver).filter(
            FacturaDriver.driver_id == reg.driver_id,
            FacturaDriver.mes == mes,
            FacturaDriver.anio == anio,
            FacturaDriver.estado == EstadoFacturaDriverEnum.APROBADA.value,
        ).all()

        result.append({
            "id": reg.id,
            "driver_id": reg.driver_id,
            "driver_nombre": driver.nombre,
            "rut": driver.rut,
            "banco": driver.banco,
            "tipo_cuenta": driver.tipo_cuenta,
            "numero_cuenta": driver.numero_cuenta,
            "email": driver.email,
            "mes_origen": reg.mes_origen,
            "anio_origen": reg.anio_origen,
            "estado": reg.estado,
            "base_imponible": base,
            "monto_iva": iva,
            "monto_pagado": int(total_pagado),
            "saldo_pendiente": max(0, iva - int(total_pagado)),
            "facturas_count": len(facturas),
            "facturas_ids": [f.id for f in facturas],
            "fecha_pago": reg.fecha_pago.isoformat() if reg.fecha_pago else None,
            "nota": reg.nota,
            "created_at": reg.created_at.isoformat() if reg.created_at else None,
        })

    return {"mes": mes, "anio": anio, "items": result, "total_items": len(result)}


# ---------------------------------------------------------------------------
# GET /resumen — totales para dashboard
# ---------------------------------------------------------------------------

@router.get("/resumen")
def resumen_iva_drivers(
    mes: int = Query(...),
    anio: int = Query(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    registros = db.query(PagoIVADriver).filter(
        PagoIVADriver.mes_origen == mes,
        PagoIVADriver.anio_origen == anio,
    ).all()

    total_pendiente = 0
    total_pagado = 0
    count_pendiente = 0
    count_pagado = 0

    for reg in registros:
        if reg.estado == EstadoPagoIVAEnum.PAGADO.value:
            total_pagado += reg.monto_iva_snapshot or 0
            count_pagado += 1
        else:
            base = calcular_base_iva_mes(db, reg.driver_id, mes, anio)
            total_pendiente += calcular_iva(base)
            count_pendiente += 1

    return {
        "mes": mes, "anio": anio,
        "total_pendiente": total_pendiente,
        "total_pagado": total_pagado,
        "count_pendiente": count_pendiente,
        "count_pagado": count_pagado,
    }


# ---------------------------------------------------------------------------
# POST /generar-tef — archivo TEF para IVA
# ---------------------------------------------------------------------------

class ItemTEFIVA(BaseModel):
    pago_iva_id: int
    driver_id: int
    monto: int


class GenerarTEFIVARequest(BaseModel):
    mes: int
    anio: int
    items: List[ItemTEFIVA]


def _generar_linea_tef_iva(seq: int, driver: Driver, monto: int) -> str:
    """Genera línea TEF idéntica a CPC pero con motivo 'PAGO IVA CONDUCTOR'."""
    from app.api.cpc import BANCO_CODIGOS, _normalizar_rut, _get_banco_codigo
    BANCO_RUTS = {
        "001": "0970040005", "009": "0970110003", "012": "0970320008",
        "014": "097080000K", "016": "0970300007", "028": "0970060006",
        "031": "0970230009", "034": "0970530002", "037": "097036000K",
        "039": "0966527005", "402": "0965096604", "403": "0979470002",
        "672": "0855860000", "729": "0762609309", "730": "0769676929",
        "741": "0970530002", "875": "0762838641",
    }
    banco_destino_cod = _get_banco_codigo(driver.banco)
    tipo_op = "TEC" if banco_destino_cod == "001" else "TOB"
    rut_cliente = (EMISOR_RUT + EMISOR_DV).zfill(10)
    cuenta_cargo = re.sub(r"\D", "", EMISOR_CUENTA).zfill(12)[:12]
    rut_num, rut_dv = _normalizar_rut(driver.rut)
    rut_benef = (rut_num + rut_dv).zfill(10)
    nombre = (driver.nombre or "").upper()[:30].ljust(30)
    cuenta_benef_raw = re.sub(r"\D", "", driver.numero_cuenta or "")
    if not cuenta_benef_raw or (
        banco_destino_cod == "016"
        and (driver.tipo_cuenta or "").lower().strip() in ("vista", "cuenta vista")
        and cuenta_benef_raw == re.sub(r"\D", "", rut_num)
    ):
        cuenta_benef_raw = rut_num + rut_dv
    cuenta_benef = cuenta_benef_raw.ljust(18)[:18]
    rut_banco_benef = BANCO_RUTS.get(banco_destino_cod, "0970040005")
    monto_str = str(monto).zfill(11)[:11]
    motivo = "PAGO IVA CONDUCTOR".ljust(30)[:30]
    asunto = "IVA eCourier".ljust(30)[:30]
    email_benef = (driver.email or "").ljust(50)[:50]
    tipo_raw = (driver.tipo_cuenta or "").lower().strip()
    tipo_cuenta = "CTD" if "corriente" in tipo_raw else "JUV"
    linea = (
        f"{tipo_op}"
        f"{rut_cliente}"
        f"{cuenta_cargo}"
        f"{rut_benef}"
        f"{nombre}"
        f"{cuenta_benef}"
        f"{rut_banco_benef}"
        f"{monto_str}"
        f" "
        f"{motivo}"
        f"1"
        f"{asunto}"
        f"{email_benef}"
        + (tipo_cuenta if tipo_op == "TOB" else "")
        + "\r\n"
    )
    return linea


@router.post("/generar-tef")
def generar_tef_iva(
    body: GenerarTEFIVARequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin_or_administracion),
):
    """Genera archivo .TXT TEF para los pagos de IVA seleccionados."""
    lineas = []
    total_monto = 0
    for idx, item in enumerate(body.items, start=1):
        driver = db.get(Driver, item.driver_id)
        if not driver:
            continue
        lineas.append(_generar_linea_tef_iva(idx, driver, item.monto))
        total_monto += item.monto

    contenido = "".join(lineas)
    hoy = date.today().strftime("%Y%m%d")
    filename = f"TEF_IVA_Drivers_{hoy}_{body.mes}_{body.anio}.txt"

    audit(db, "generar_tef_iva", usuario=current_user, request=request,
          entidad="tef_iva", metadata={
              "mes": body.mes, "anio": body.anio,
              "drivers": len(body.items), "monto_total": total_monto,
          })
    db.commit()

    return StreamingResponse(
        io.BytesIO(contenido.encode("latin-1", errors="replace")),
        media_type="text/plain; charset=latin-1",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# POST /cartola/preview — preview de cartola bancaria IVA
# ---------------------------------------------------------------------------

@router.post("/cartola/preview")
async def cartola_preview_iva(
    mes: int = Query(...),
    anio: int = Query(...),
    archivo: UploadFile = File(...),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """
    Parsea una cartola y la coteja contra los PagoIVADriver PENDIENTES del mes indicado.
    No graba nada en BD.
    """
    contenido = await archivo.read()
    movimientos = _parsear_cartola(contenido)

    # Registros de IVA pendiente para el mes de origen indicado
    pendientes = db.query(PagoIVADriver).filter(
        PagoIVADriver.mes_origen == mes,
        PagoIVADriver.anio_origen == anio,
        PagoIVADriver.estado.in_([
            EstadoPagoIVAEnum.PENDIENTE.value,
            EstadoPagoIVAEnum.PARCIAL.value,
        ]),
    ).all()

    drivers_pendientes: dict[int, Driver] = {}
    iva_esperado: dict[int, int] = {}
    for p in pendientes:
        driver = db.get(Driver, p.driver_id)
        if driver:
            drivers_pendientes[p.driver_id] = driver
            base = calcular_base_iva_mes(db, p.driver_id, mes, anio)
            iva_esperado[p.driver_id] = calcular_iva(base)

    # Fingerprints ya existentes en PagoCartolaIVA
    fps_movs = [
        _generar_fingerprint(m["fecha"], m["monto"], m["descripcion"])
        for m in movimientos
    ]
    fps_existentes: set[str] = set()
    if fps_movs:
        for p in db.query(PagoCartolaIVA).filter(
            PagoCartolaIVA.fingerprint.in_(fps_movs)
        ).all():
            if p.fingerprint:
                fps_existentes.add(p.fingerprint)

    resultado = []
    for mov, fp in zip(movimientos, fps_movs):
        nombre_norm = mov["nombre_extraido"].lower()
        mejor_driver = None
        mejor_score = 0.0

        for driver in drivers_pendientes.values():
            score = _similaridad(nombre_norm, driver.nombre.lower())
            for alias in (driver.aliases or []):
                s = _similaridad(nombre_norm, alias.lower())
                if s > score:
                    score = s
            if score > mejor_score:
                mejor_score = score
                mejor_driver = driver

        match_confiable = mejor_score >= 0.55
        ya_existe = fp in fps_existentes

        resultado.append({
            "descripcion": mov["descripcion"],
            "nombre_extraido": mov["nombre_extraido"],
            "fecha": mov["fecha"],
            "monto": mov["monto"],
            "driver_id": mejor_driver.id if mejor_driver else None,
            "driver_nombre": mejor_driver.nombre if mejor_driver else None,
            "score": round(mejor_score, 2),
            "match_confiable": match_confiable,
            "iva_esperado": iva_esperado.get(mejor_driver.id, 0) if mejor_driver else 0,
            "fingerprint": fp,
            "ya_existe": ya_existe,
        })

    todos_drivers_pendientes = [
        {"id": d.id, "nombre": d.nombre, "iva": iva_esperado.get(d.id, 0)}
        for d in sorted(drivers_pendientes.values(), key=lambda x: x.nombre)
    ]

    return {
        "mes": mes, "anio": anio,
        "items": resultado,
        "drivers_pendientes": todos_drivers_pendientes,
    }


# ---------------------------------------------------------------------------
# POST /cartola/confirmar — confirmar pagos desde cartola
# ---------------------------------------------------------------------------

class ItemConfirmarCartolaIVA(BaseModel):
    driver_id: int
    monto: int
    fecha: Optional[str] = None
    descripcion: Optional[str] = None
    nombre_extraido: Optional[str] = None
    fingerprint: Optional[str] = None


class ConfirmarCartolaIVARequest(BaseModel):
    mes: int
    anio: int
    items: List[ItemConfirmarCartolaIVA]


@router.post("/cartola/confirmar")
def cartola_confirmar_iva(
    body: ConfirmarCartolaIVARequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin_or_administracion),
):
    """
    Graba los pagos de IVA confirmados desde cartola.
    Cierra PagoIVADriver con snapshot cuando el monto pagado >= monto IVA calculado.
    NO toca PagoCartola ni PagoSemanaDriver.
    """
    carga = CartolaCarga(
        tipo="iva_driver",
        archivo_nombre="cartola_iva",
        usuario_id=current_user.get("id"),
        usuario_nombre=current_user.get("nombre"),
        mes=body.mes,
        anio=body.anio,
        total_transacciones=len(body.items),
        matcheadas=len(body.items),
        no_matcheadas=0,
        monto_total=sum(it.monto for it in body.items),
    )
    db.add(carga)
    db.flush()

    grabados = 0
    duplicados = 0

    for item in body.items:
        if item.driver_id <= 0 or item.monto <= 0:
            continue

        fp = item.fingerprint or _generar_fingerprint(
            item.fecha or "", item.monto, item.descripcion or ""
        )

        # Dedup
        if db.query(PagoCartolaIVA.id).filter(
            PagoCartolaIVA.fingerprint == fp
        ).first():
            duplicados += 1
            continue

        # Buscar el PagoIVADriver PENDIENTE del mes de origen
        pago_iva = db.query(PagoIVADriver).filter_by(
            driver_id=item.driver_id,
            mes_origen=body.mes,
            anio_origen=body.anio,
        ).first()

        if not pago_iva:
            # Crear si no existía (edge case: factura aprobada sin trigger previo)
            pago_iva = recalcular_pago_iva(db, item.driver_id, body.mes, body.anio)
            if not pago_iva:
                continue
            db.flush()

        entrada = PagoCartolaIVA(
            pago_iva_driver_id=pago_iva.id,
            driver_id=item.driver_id,
            mes=body.mes,
            anio=body.anio,
            monto=item.monto,
            fecha_pago=item.fecha,
            descripcion=item.descripcion,
            fuente="cartola",
            fingerprint=fp,
            carga_id=carga.id,
        )
        db.add(entrada)
        db.flush()
        grabados += 1

        # Guardar alias si viene nombre_extraido
        if item.nombre_extraido:
            driver = db.get(Driver, item.driver_id)
            if driver:
                alias = item.nombre_extraido.strip()
                if (alias.lower() != driver.nombre.lower()
                        and alias.lower() not in [a.lower() for a in (driver.aliases or [])]):
                    driver.aliases = list(driver.aliases or []) + [alias]

        # Verificar si el IVA quedó cubierto → cerrar
        base = calcular_base_iva_mes(db, item.driver_id, body.mes, body.anio)
        iva_total = calcular_iva(base)
        total_pagado = db.query(
            func.coalesce(func.sum(PagoCartolaIVA.monto), 0)
        ).filter(PagoCartolaIVA.pago_iva_driver_id == pago_iva.id).scalar()

        fecha_obj = None
        if item.fecha:
            try:
                fecha_obj = date.fromisoformat(item.fecha)
            except Exception:
                pass

        if int(total_pagado) >= iva_total > 0:
            cerrar_pago_iva(db, pago_iva, fecha_pago=fecha_obj or date.today())
        elif int(total_pagado) > 0:
            pago_iva.estado = EstadoPagoIVAEnum.PARCIAL.value
            if not pago_iva.fecha_pago and fecha_obj:
                pago_iva.fecha_pago = fecha_obj

        # Asiento contable
        asiento_pago_iva_driver(db, entrada)

    carga.duplicados_omitidos = duplicados
    audit(db, "cartola_iva_confirmar", usuario=current_user, request=request,
          entidad="cartola_iva", entidad_id=carga.id,
          metadata={
              "mes": body.mes, "anio": body.anio,
              "grabados": grabados, "duplicados": duplicados,
              "monto_total": sum(it.monto for it in body.items),
          })
    db.commit()
    return {"ok": True, "grabados": grabados, "duplicados_omitidos": duplicados}


# ---------------------------------------------------------------------------
# PUT /{id}/marcar-pagado — pago manual (sin cartola)
# ---------------------------------------------------------------------------

class MarcarPagadoRequest(BaseModel):
    fecha_pago: Optional[str] = None
    nota: Optional[str] = None
    monto: Optional[int] = None   # Si no se indica, usa el IVA calculado


@router.put("/{pago_iva_id}/marcar-pagado")
def marcar_pagado_manual(
    pago_iva_id: int,
    body: MarcarPagadoRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin_or_administracion),
):
    pago_iva = db.get(PagoIVADriver, pago_iva_id)
    if not pago_iva:
        raise HTTPException(status_code=404, detail="Pago IVA no encontrado")
    if pago_iva.estado == EstadoPagoIVAEnum.PAGADO.value:
        raise HTTPException(status_code=400, detail="El pago ya está cerrado como PAGADO")

    fecha_obj = None
    if body.fecha_pago:
        try:
            fecha_obj = date.fromisoformat(body.fecha_pago)
        except Exception:
            raise HTTPException(status_code=400, detail="Formato de fecha inválido (YYYY-MM-DD)")

    if body.nota:
        pago_iva.nota = body.nota

    # Determinar monto
    base = calcular_base_iva_mes(db, pago_iva.driver_id, pago_iva.mes_origen, pago_iva.anio_origen)
    iva = calcular_iva(base)
    monto_pago = body.monto if body.monto and body.monto > 0 else iva

    # Crear registro en PagoCartolaIVA (fuente manual)
    fp = _generar_fingerprint(
        (fecha_obj or date.today()).isoformat(),
        monto_pago,
        f"manual-iva-{pago_iva_id}",
    )
    existe = db.query(PagoCartolaIVA.id).filter(PagoCartolaIVA.fingerprint == fp).first()
    if not existe:
        entrada = PagoCartolaIVA(
            pago_iva_driver_id=pago_iva.id,
            driver_id=pago_iva.driver_id,
            mes=pago_iva.mes_origen,
            anio=pago_iva.anio_origen,
            monto=monto_pago,
            fecha_pago=(fecha_obj or date.today()).isoformat(),
            descripcion="Pago manual IVA por administrador",
            fuente="manual",
            fingerprint=fp,
        )
        db.add(entrada)
        db.flush()
        asiento_pago_iva_driver(db, entrada)

    cerrar_pago_iva(db, pago_iva, fecha_pago=fecha_obj or date.today())

    # MovimientoFinanciero
    cat = db.query(CategoriaFinanciera).filter_by(nombre="IVA Conductores").first()
    if not cat:
        # Crear categoría IVA Conductores bajo "Impuestos" si no existe
        parent = db.query(CategoriaFinanciera).filter_by(nombre="Impuestos").first()
        cat = CategoriaFinanciera(
            nombre="IVA Conductores",
            tipo="EGRESO",
            parent_id=parent.id if parent else None,
        )
        db.add(cat)
        db.flush()

    driver = db.get(Driver, pago_iva.driver_id)
    mov = MovimientoFinanciero(
        nombre=f"IVA conductor {driver.nombre if driver else pago_iva.driver_id} {pago_iva.mes_origen}/{pago_iva.anio_origen}",
        monto=monto_pago,
        mes=pago_iva.mes_origen,
        anio=pago_iva.anio_origen,
        fecha_pago=fecha_obj or date.today(),
        categoria_id=cat.id,
        estado="PAGADO",
        notas=f"IVA drivers mes {pago_iva.mes_origen}/{pago_iva.anio_origen}",
    )
    db.add(mov)

    audit(db, "pago_manual_iva_driver", usuario=current_user, request=request,
          entidad="pago_iva_driver", entidad_id=pago_iva_id,
          cambios={"estado": {"antes": "PENDIENTE", "despues": "PAGADO"}},
          metadata={"driver_id": pago_iva.driver_id, "monto_iva": monto_pago,
                    "mes": pago_iva.mes_origen, "anio": pago_iva.anio_origen})

    db.commit()
    return {
        "ok": True,
        "estado": pago_iva.estado,
        "monto_iva": pago_iva.monto_iva_snapshot,
        "base": pago_iva.base_iva_snapshot,
        "fecha_pago": pago_iva.fecha_pago.isoformat() if pago_iva.fecha_pago else None,
    }


# ---------------------------------------------------------------------------
# PUT /{id}/reabrir — reabrir un pago PAGADO (corrección de errores)
# ---------------------------------------------------------------------------

@router.put("/{pago_iva_id}/reabrir")
def reabrir_pago_iva(
    pago_iva_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_admin_or_administracion),
):
    pago_iva = db.get(PagoIVADriver, pago_iva_id)
    if not pago_iva:
        raise HTTPException(status_code=404, detail="Pago IVA no encontrado")

    pago_iva.estado = EstadoPagoIVAEnum.PENDIENTE.value
    pago_iva.base_iva_snapshot = None
    pago_iva.monto_iva_snapshot = None
    pago_iva.facturas_incluidas = None
    pago_iva.fecha_pago = None

    audit(db, "reabrir_pago_iva", usuario=current_user, request=request,
          entidad="pago_iva_driver", entidad_id=pago_iva_id,
          metadata={"driver_id": pago_iva.driver_id})
    db.commit()
    return {"ok": True}
