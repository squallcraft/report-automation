"""
Servicio de cobros para inquilinos (arriendo Tracking Tech).

Encapsula:
  - Cálculo de monto según tarifa (A, B, C) con descuentos y reserva
  - Generación del cobro: CobrosInquilino + Haulmer + MovimientoFinanciero
  - Aprobación de pago: actualiza estado + asiento contable
"""
from __future__ import annotations

import logging
import math
from datetime import date, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.config import get_settings
from app.services.parametros import obtener_uf_fin_de_mes
from app.models import (
    Inquilino,
    CobrosInquilino,
    DescuentoInquilino,
    MovimientoFinanciero,
    CategoriaFinanciera,
    ConfigPlanInquilino,
    PlanInquilinoEnum,
    EstadoCobrosInquilinoEnum,
    EstadoMovimientoEnum,
)
from app.services.haulmer import emitir_factura
from app.services.contabilidad import asiento_movimiento_financiero

logger = logging.getLogger(__name__)

IVA_RATE = 0.19
VENCIMIENTO_DIAS = 10

# ── Slugs / nombres para la categoría de finanzas ─────────────────────────────
CAT_NOMBRE_INQUILINOS = "Inquilinos"
CAT_TIPO_INGRESO = "INGRESO"

# ── Tarifas (neto, sin IVA) ────────────────────────────────────────────────────
TARIFA_A_BASE = 300_000          # hasta 24 conductores
TARIFA_A_MAX_INCL = 24
TARIFA_A_EXTRA_POR = 12_500      # por cada conductor sobre 24

TARIFA_B_BASE = 1_000_000        # hasta 25.000 envíos
TARIFA_B_MAX_INCL = 25_000
TARIFA_B_EXTRA_POR = 250_000     # por cada 5.000 envíos sobre 25.000
TARIFA_B_BLOQUE_ENVIOS = 5_000

TARIFA_C_BASE_UF = 2.0           # base en UF (se convierte a CLP al momento del cobro)
TARIFA_C_EXTRA_POR = 10_000      # por cada conductor (CLP neto)


def _obtener_params_plan(db: Session, plan: str) -> dict:
    """
    Lee la configuración del plan desde DB (tabla config_planes_inquilino).
    Si no existe aún, usa los valores hardcoded como fallback.
    """
    cfg = db.query(ConfigPlanInquilino).filter_by(plan=plan).first()
    if cfg and cfg.params:
        return cfg.params

    # Fallback a constantes si la tabla aún no tiene datos
    fallbacks = {
        PlanInquilinoEnum.TARIFA_A.value: {
            "base": TARIFA_A_BASE, "max_incluidos": TARIFA_A_MAX_INCL,
            "extra_por": TARIFA_A_EXTRA_POR, "variable": "conductores",
        },
        PlanInquilinoEnum.TARIFA_B.value: {
            "base": TARIFA_B_BASE, "max_incluidos": TARIFA_B_MAX_INCL,
            "extra_por": TARIFA_B_EXTRA_POR, "bloque": TARIFA_B_BLOQUE_ENVIOS,
            "variable": "envíos",
        },
        PlanInquilinoEnum.TARIFA_C.value: {
            "base_uf": TARIFA_C_BASE_UF, "extra_por": TARIFA_C_EXTRA_POR,
            "variable": "conductores",
        },
    }
    return fallbacks.get(plan, {})


def _calcular_neto(plan: str, variable_valor: int, params: dict, valor_uf: float = 0.0) -> tuple[int, str]:
    """
    Calcula el monto neto (sin IVA) usando los parámetros del plan leídos desde DB.
    El campo `tipo_calculo` en params determina la fórmula a aplicar:
      - UMBRAL_FIJO : base + extra_por × max(0, variable - max_incluidos)
      - BLOQUES     : base + extra_por × ceil((variable - max_incluidos) / bloque)
      - BASE_UF     : round(base_uf × uf) + extra_por × variable
      - PLANA       : base fija, sin variable
    """
    variable = params.get("variable", "conductores")
    tipo = params.get("tipo_calculo", "UMBRAL_FIJO")

    if tipo == "UMBRAL_FIJO":
        base = int(params.get("base", TARIFA_A_BASE))
        max_incl = int(params.get("max_incluidos", TARIFA_A_MAX_INCL))
        extra_por = int(params.get("extra_por", TARIFA_A_EXTRA_POR))
        extra = max(0, variable_valor - max_incl) * extra_por
        return base + extra, variable

    if tipo == "BLOQUES":
        base = int(params.get("base", TARIFA_B_BASE))
        max_incl = int(params.get("max_incluidos", TARIFA_B_MAX_INCL))
        extra_por = int(params.get("extra_por", TARIFA_B_EXTRA_POR))
        bloque = int(params.get("bloque", TARIFA_B_BLOQUE_ENVIOS))
        excedente = max(0, variable_valor - max_incl)
        bloques = math.ceil(excedente / bloque) if excedente > 0 else 0
        return base + bloques * extra_por, variable

    if tipo == "BASE_UF":
        base_uf = float(params.get("base_uf", TARIFA_C_BASE_UF))
        extra_por = int(params.get("extra_por", TARIFA_C_EXTRA_POR))
        uf = valor_uf if valor_uf > 0 else 39_842.0
        base_clp = round(base_uf * uf)
        return base_clp + variable_valor * extra_por, variable

    if tipo == "PLANA":
        base = int(params.get("base", 0))
        return base, variable or "—"

    # Fallback: intentar compatibilidad con planes viejos sin tipo_calculo
    if "base_uf" in params:
        base_uf = float(params["base_uf"])
        extra_por = int(params.get("extra_por", 0))
        uf = valor_uf if valor_uf > 0 else 39_842.0
        return round(base_uf * uf) + variable_valor * extra_por, variable
    if "max_incluidos" in params and "bloque" in params:
        base = int(params.get("base", 0))
        max_incl = int(params["max_incluidos"])
        extra_por = int(params.get("extra_por", 0))
        bloque = int(params["bloque"])
        excedente = max(0, variable_valor - max_incl)
        bloques = math.ceil(excedente / bloque) if excedente > 0 else 0
        return base + bloques * extra_por, variable
    if "max_incluidos" in params:
        base = int(params.get("base", 0))
        max_incl = int(params["max_incluidos"])
        extra_por = int(params.get("extra_por", 0))
        return base + max(0, variable_valor - max_incl) * extra_por, variable

    raise ValueError(f"No se puede calcular neto para plan '{plan}' con params: {params}")


def calcular_monto(
    db: Session,
    inquilino: Inquilino,
    variable_valor: int,
) -> dict:
    """
    Calcula el desglose completo del cobro (sin persistir nada).

    Para Tarifa C la base se calcula en UF usando el valor vigente del mes
    (misma fuente que las liquidaciones de sueldo: mindicador.cl / ParametrosMensuales).

    Retorna dict con:
      variable_nombre, variable_valor, monto_neto_base, descuento_aplicado,
      neto_con_descuento, reserva_a_descontar, neto_final, iva, total,
      valor_uf (float, solo relevante para Tarifa C)
    """
    hoy = date.today()
    # UF del último día publicado del mes → misma lógica que remuneraciones
    valor_uf: float = obtener_uf_fin_de_mes(hoy.year, hoy.month)

    plan = inquilino.plan or ""
    params = _obtener_params_plan(db, plan)
    neto_base, variable_nombre = _calcular_neto(plan, variable_valor, params, valor_uf)

    # Descuentos pendientes
    descuentos = db.query(DescuentoInquilino).filter(
        DescuentoInquilino.inquilino_id == inquilino.id,
        DescuentoInquilino.aplicado == False,
    ).all()
    descuento_total = sum(d.monto for d in descuentos)
    neto_con_descuento = max(0, neto_base - descuento_total)

    # Reserva: se descuenta en primer cobro (sin mes gratis) o en el segundo (con mes gratis)
    reserva_a_descontar = 0
    if inquilino.tiene_reserva and inquilino.monto_reserva:
        if not inquilino.mes_gratis_confirmado and not inquilino.primer_cobro_generado:
            # Primer cobro y sin mes gratis → descontar reserva ahora
            reserva_a_descontar = inquilino.monto_reserva
        elif inquilino.mes_gratis_confirmado and inquilino.primer_cobro_generado:
            # Ya hubo primer cobro (mes gratis) → es el segundo cobro, descontar reserva
            # Solo si aún no se descontó en ningún cobro anterior
            ya_descontada = db.query(CobrosInquilino).filter(
                CobrosInquilino.inquilino_id == inquilino.id,
                CobrosInquilino.reserva_descontada == True,
            ).first()
            if not ya_descontada:
                reserva_a_descontar = inquilino.monto_reserva

    neto_final = max(0, neto_con_descuento - reserva_a_descontar)
    iva = round(neto_final * IVA_RATE)
    total = neto_final + iva

    return {
        "variable_nombre": variable_nombre,
        "variable_valor": variable_valor,
        "monto_neto_base": neto_base,
        "descuento_aplicado": descuento_total,
        "descuentos_detalle": [{"id": d.id, "monto": d.monto, "motivo": d.motivo} for d in descuentos],
        "reserva_a_descontar": reserva_a_descontar,
        "neto_final": neto_final,
        "iva": iva,
        "total": total,
        "valor_uf": valor_uf,
    }


def _obtener_o_crear_categoria_inquilinos(db: Session) -> CategoriaFinanciera:
    """Obtiene o crea la categoría financiera 'Inquilinos' bajo 'Ingresos > Software'."""
    cat = db.query(CategoriaFinanciera).filter(
        CategoriaFinanciera.nombre == CAT_NOMBRE_INQUILINOS,
        CategoriaFinanciera.tipo == CAT_TIPO_INGRESO,
    ).first()
    if cat:
        return cat

    # Buscar categoría padre "Software" o "Ingresos"
    padre = db.query(CategoriaFinanciera).filter(
        CategoriaFinanciera.nombre.in_(["Software", "Ingresos"]),
        CategoriaFinanciera.tipo == CAT_TIPO_INGRESO,
    ).first()

    cat = CategoriaFinanciera(
        nombre=CAT_NOMBRE_INQUILINOS,
        tipo=CAT_TIPO_INGRESO,
        parent_id=padre.id if padre else None,
        activo=True,
        orden=90,
    )
    db.add(cat)
    db.flush()
    return cat


def generar_cobro(
    db: Session,
    inquilino: Inquilino,
    variable_valor: int,
    archivo_adjunto_b64: Optional[str] = None,
    archivo_adjunto_nombre: Optional[str] = None,
) -> CobrosInquilino:
    """
    Genera un cobro mensual:
    1. Calcula montos
    2. Crea CobrosInquilino
    3. Emite factura vía Haulmer
    4. Crea MovimientoFinanciero PENDIENTE
    5. Marca descuentos como aplicados
    """
    desglose = calcular_monto(db, inquilino, variable_valor)
    settings = get_settings()
    hoy = date.today()

    cobro = CobrosInquilino(
        inquilino_id=inquilino.id,
        mes=hoy.month,
        anio=hoy.year,
        variable_nombre=desglose["variable_nombre"],
        variable_valor=variable_valor,
        monto_neto=desglose["neto_final"],
        iva=desglose["iva"],
        total=desglose["total"],
        descuento_aplicado=desglose["descuento_aplicado"],
        reserva_descontada=desglose["reserva_a_descontar"] > 0,
        estado=EstadoCobrosInquilinoEnum.PENDIENTE.value,
        fecha_emision=hoy,
        fecha_vencimiento=hoy + timedelta(days=VENCIMIENTO_DIAS),
    )

    if archivo_adjunto_b64:
        cobro.archivo_adjunto_path = archivo_adjunto_nombre or "adjunto.pdf"

    db.add(cobro)
    db.flush()

    # region agent log - hipótesis A
    import json, time as _t
    _log_path = "/Users/oscarguzman/ecourier/.cursor/debug-866a5b.log"
    try:
        with open(_log_path, "a") as _f:
            _f.write(json.dumps({"sessionId":"866a5b","hypothesisId":"A","location":"cobros_inquilino.py:generar_cobro","message":"cobro flush OK","data":{"cobro_id":cobro.id,"total":cobro.total,"neto":cobro.monto_neto,"iva":cobro.iva},"timestamp":int(_t.time()*1000)}) + "\n")
    except Exception: pass
    # endregion

    # Marcar descuentos como aplicados
    for d_info in desglose["descuentos_detalle"]:
        desc = db.get(DescuentoInquilino, d_info["id"])
        if desc:
            desc.aplicado = True
            desc.fecha_aplicacion = hoy

    # Emitir factura Haulmer
    folio = None
    pdf_factura_b64 = None
    if (
        getattr(settings, "HAULMER_API_KEY", None)
        and inquilino.rut_empresa
        and desglose["total"] > 0
    ):
        glosa = f"Servicio de software Tracking Tech — {inquilino.razon_social or inquilino.nombre_fantasia or ''}"
        folio, resp_data, error = emitir_factura(
            api_key=settings.HAULMER_API_KEY,
            api_url=getattr(settings, "HAULMER_API_URL", "https://api.haulmer.com/v2/dte/document"),
            emisor_rut=getattr(settings, "HAULMER_EMISOR_RUT", ""),
            emisor_razon=getattr(settings, "HAULMER_EMISOR_RAZON", "E-Courier SPA"),
            emisor_giro=getattr(settings, "HAULMER_EMISOR_GIRO", "Servicios de tecnología y logística"),
            emisor_dir=getattr(settings, "HAULMER_EMISOR_DIR", ""),
            emisor_cmna=getattr(settings, "HAULMER_EMISOR_CMNA", ""),
            emisor_acteco=int(getattr(settings, "HAULMER_EMISOR_ACTECO", 730000)),
            receptor_rut=inquilino.rut_empresa,
            receptor_razon=inquilino.razon_social or inquilino.nombre_fantasia or "",
            receptor_giro=inquilino.giro_empresa or "Sin giro",
            receptor_dir=inquilino.direccion_empresa or "",
            receptor_email=inquilino.correo_empresa or "",
            mnt_neto=desglose["neto_final"],
            iva=desglose["iva"],
            mnt_total=desglose["total"],
            glosa_detalle=glosa,
            idempotency_key=f"cobro-inquilino-{cobro.id}",
        )
        if error:
            logger.warning("Haulmer error para cobro %s inquilino %s: %s", cobro.id, inquilino.id, error)
        else:
            cobro.folio_haulmer = folio
            if resp_data and isinstance(resp_data, dict):
                pdf_b64_haulmer = resp_data.get("PDF") or resp_data.get("pdf")
                if pdf_b64_haulmer:
                    cobro.pdf_factura_b64 = pdf_b64_haulmer
    else:
        logger.info("Haulmer no configurado o datos incompletos — cobro %s sin factura electrónica", cobro.id)

    # Crear MovimientoFinanciero PENDIENTE
    cat = _obtener_o_crear_categoria_inquilinos(db)
    mov = MovimientoFinanciero(
        categoria_id=cat.id,
        nombre=f"Cobro mensual inquilino — {inquilino.razon_social or inquilino.email}",
        descripcion=f"Folio {folio or 'pendiente'} | {desglose['variable_nombre']}: {variable_valor}",
        monto=desglose["total"],
        mes=hoy.month,
        anio=hoy.year,
        fecha_vencimiento=cobro.fecha_vencimiento,
        estado=EstadoMovimientoEnum.PENDIENTE.value,
        notas=(
            f"IVA: ${desglose['iva']:,} | Neto: ${desglose['neto_final']:,}"
            + (f" | UF: ${desglose['valor_uf']:,.2f}" if desglose.get("valor_uf") else "")
        ),
    )
    db.add(mov)
    db.flush()
    cobro.movimiento_financiero_id = mov.id

    # region agent log - hipótesis A (movimiento creado)
    import json, time as _t
    _log_path = "/Users/oscarguzman/ecourier/.cursor/debug-866a5b.log"
    try:
        with open(_log_path, "a") as _f:
            _f.write(json.dumps({"sessionId":"866a5b","hypothesisId":"A","location":"cobros_inquilino.py:generar_cobro_mov","message":"MovimientoFinanciero creado","data":{"mov_id":mov.id,"cobro_id":cobro.id,"cobro_mov_id":cobro.movimiento_financiero_id,"cat_id":cat.id,"cat_nombre":cat.nombre,"estado":mov.estado},"timestamp":int(_t.time()*1000)}) + "\n")
    except Exception: pass
    # endregion

    # Marcar primer cobro generado
    if not inquilino.primer_cobro_generado:
        inquilino.primer_cobro_generado = True

    db.commit()
    db.refresh(cobro)

    # Notificar (best-effort, fuera de la transacción)
    try:
        from app.services.notificaciones_inquilino import notificar_cobro
        notificar_cobro(db, inquilino, cobro, archivo_adjunto_b64=archivo_adjunto_b64)
    except Exception as exc:
        logger.warning("No se pudo notificar cobro inquilino %s: %s", inquilino.id, exc)

    return cobro


def aprobar_pago(
    db: Session,
    cobro: CobrosInquilino,
    aprobado_por: Optional[str] = None,
) -> CobrosInquilino:
    """
    El admin aprueba el comprobante de pago:
    1. Actualiza estado a PAGADO
    2. Actualiza MovimientoFinanciero a PAGADO
    3. Registra asiento contable
    """
    cobro.estado = EstadoCobrosInquilinoEnum.PAGADO.value
    hoy = date.today()

    if cobro.movimiento_financiero_id:
        mov = db.get(MovimientoFinanciero, cobro.movimiento_financiero_id)
        if mov:
            mov.estado = EstadoMovimientoEnum.PAGADO.value
            mov.fecha_pago = hoy
            db.flush()
            # region agent log - hipótesis B
            import json, time as _t
            _log_path = "/Users/oscarguzman/ecourier/.cursor/debug-866a5b.log"
            try:
                with open(_log_path, "a") as _f:
                    _f.write(json.dumps({"sessionId":"866a5b","hypothesisId":"B","location":"cobros_inquilino.py:aprobar_pago_pre_asiento","message":"antes de asiento_movimiento_financiero","data":{"mov_id":mov.id,"mov_estado":mov.estado,"cat_id":mov.categoria_id},"timestamp":int(_t.time()*1000)}) + "\n")
            except Exception: pass
            # endregion
            try:
                asiento = asiento_movimiento_financiero(db, mov)
                # region agent log - hipótesis B/C/D
                try:
                    with open(_log_path, "a") as _f:
                        _f.write(json.dumps({"sessionId":"866a5b","hypothesisId":"B","location":"cobros_inquilino.py:aprobar_pago_post_asiento","message":"asiento_movimiento_financiero resultado","data":{"asiento":str(asiento),"asiento_id":getattr(asiento,"id",None) if asiento else None},"timestamp":int(_t.time()*1000)}) + "\n")
                except Exception: pass
                # endregion
            except Exception as exc:
                # region agent log - hipótesis B
                try:
                    with open(_log_path, "a") as _f:
                        _f.write(json.dumps({"sessionId":"866a5b","hypothesisId":"B","location":"cobros_inquilino.py:aprobar_pago_asiento_exc","message":"EXCEPCION en asiento_movimiento_financiero","data":{"error":str(exc)},"timestamp":int(_t.time()*1000)}) + "\n")
                except Exception: pass
                # endregion
                logger.warning("Error creando asiento contable para cobro %s: %s", cobro.id, exc)

    db.flush()
    return cobro
