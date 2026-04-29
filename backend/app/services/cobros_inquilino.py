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
from app.services.parametros import obtener_parametros
from app.models import (
    Inquilino,
    CobrosInquilino,
    DescuentoInquilino,
    MovimientoFinanciero,
    CategoriaFinanciera,
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


def _calcular_neto(plan: str, variable_valor: int, valor_uf: float = 0.0) -> tuple[int, str]:
    """
    Calcula el monto neto (sin IVA) según el plan y el valor de la variable.
    Retorna (neto: int, variable_nombre: str).

    Tarifa C usa base en UF (valor_uf debe ser > 0 para reflejar el valor real del mes).
    """
    plan = plan or ""
    if plan == PlanInquilinoEnum.TARIFA_A.value:
        base = TARIFA_A_BASE
        extra = max(0, variable_valor - TARIFA_A_MAX_INCL) * TARIFA_A_EXTRA_POR
        return base + extra, "conductores"

    if plan == PlanInquilinoEnum.TARIFA_B.value:
        base = TARIFA_B_BASE
        extra_envios = max(0, variable_valor - TARIFA_B_MAX_INCL)
        bloques = math.ceil(extra_envios / TARIFA_B_BLOQUE_ENVIOS) if extra_envios > 0 else 0
        extra = bloques * TARIFA_B_EXTRA_POR
        return base + extra, "envíos"

    if plan == PlanInquilinoEnum.TARIFA_C.value:
        base_clp = round(TARIFA_C_BASE_UF * valor_uf) if valor_uf > 0 else round(TARIFA_C_BASE_UF * 39_842)
        return base_clp + variable_valor * TARIFA_C_EXTRA_POR, "conductores"

    raise ValueError(f"Plan desconocido: {plan!r}")


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
    params = obtener_parametros(db, hoy.year, hoy.month)
    valor_uf: float = params["uf"]

    neto_base, variable_nombre = _calcular_neto(inquilino.plan or "", variable_valor, valor_uf)

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
        notas=f"IVA: ${desglose['iva']:,} | Neto: ${desglose['neto_final']:,}",
    )
    db.add(mov)
    db.flush()
    cobro.movimiento_financiero_id = mov.id

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
            try:
                asiento_movimiento_financiero(db, mov)
            except Exception as exc:
                logger.warning("Error creando asiento contable para cobro %s: %s", cobro.id, exc)

    db.flush()
    return cobro
