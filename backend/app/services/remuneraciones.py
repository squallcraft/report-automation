"""
Motor de cálculo de remuneraciones chilenas.

Dado un sueldo líquido pactado + AFP + plan de salud, calcula
automáticamente: sueldo base, gratificación, imponible (bruto),
descuentos legales y costo empresa.

Fuentes legales:
- Art. 50 Código del Trabajo: gratificación 25% con tope 4,75 IMM/año
- Ley 19.728: Seguro de Cesantía (0,6% trabajador indefinido)
- Superintendencia de Pensiones: tasas AFP + SIS vigentes 2026
"""
from __future__ import annotations

import math
from dataclasses import dataclass

# ── Constantes vigentes 2026 ─────────────────────────────────────────────────
IMM = 539_000                       # Ingreso Mínimo Mensual desde 01-ene-2026
VALOR_UF = 39_842                   # UF promedio abril 2026
TOPE_IMPONIBLE_AFP_UF = 90.0        # 90 UF
TOPE_IMPONIBLE_CESANTIA_UF = 135.2  # 135,2 UF
TOPE_IMPONIBLE_AFP = round(TOPE_IMPONIBLE_AFP_UF * VALOR_UF)
TOPE_IMPONIBLE_CESANTIA = round(TOPE_IMPONIBLE_CESANTIA_UF * VALOR_UF)
TOPE_GRATIFICACION_MENSUAL = round(4.75 * IMM / 12)  # ~$213.354
TASA_CESANTIA_TRABAJADOR = 0.006    # 0,6% contrato indefinido
TASA_SALUD_FONASA = 0.07            # 7%
SIS_EMPLEADOR = 0.0154              # 1,54% — paga el empleador
CESANTIA_EMPLEADOR_INDEFINIDO = 0.024   # 2,4%
CESANTIA_EMPLEADOR_PLAZO_FIJO = 0.030   # 3,0%
MUTUAL_BASE = 0.0093                # 0,93% tasa base accidentes

# ── Tasas AFP (10% obligatorio + comisión administradora) ────────────────────
TASAS_AFP: dict[str, float] = {
    "Uno":      0.1046,
    "Modelo":   0.1058,
    "PlanVital": 0.1116,
    "Habitat":  0.1127,
    "Capital":  0.1144,
    "Cuprum":   0.1144,
    "ProVida":  0.1145,
}

AFP_DEFAULT_TASA = 0.1144  # fallback si no se reconoce


@dataclass
class ResultadoCalculo:
    sueldo_liquido: int
    sueldo_base: int
    gratificacion: int
    remuneracion_imponible: int    # sueldo_base + gratificacion
    descuento_afp: int
    descuento_salud: int
    descuento_cesantia: int
    total_descuentos: int
    liquido_imponible: int         # imponible - descuentos
    liquido_verificado: int        # imponible - descuentos + no imponibles
    sueldo_bruto: int              # = remuneracion_imponible (para compat)
    costo_afp: int                 # = descuento_afp
    costo_salud: int               # = descuento_salud
    movilizacion: int
    colacion: int
    viaticos: int
    costo_empresa_sis: int
    costo_empresa_cesantia: int
    costo_empresa_mutual: int
    costo_empresa_total: int       # imponible + aportes empleador


def _tasa_afp(nombre_afp: str | None) -> float:
    if not nombre_afp:
        return AFP_DEFAULT_TASA
    for key, tasa in TASAS_AFP.items():
        if key.lower() == nombre_afp.strip().lower():
            return tasa
    return AFP_DEFAULT_TASA


def _parse_monto_isapre(monto_str: str | None) -> float | None:
    """Parsea 'UF 2.714' o '2.714' → float UF. Retorna None si Fonasa."""
    if not monto_str:
        return None
    s = monto_str.strip().upper().replace("UF", "").strip()
    s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def calcular_desde_liquido(
    sueldo_liquido: int,
    afp: str | None,
    sistema_salud: str | None,
    monto_cotizacion_salud: str | None,
    tipo_contrato: str | None,
    movilizacion: int = 0,
    colacion: int = 0,
    viaticos: int = 0,
) -> ResultadoCalculo:
    """
    Cálculo inverso: dado el líquido pactado, obtiene sueldo base y bruto.

    El líquido pactado INCLUYE movilización, colación y viáticos.
    """
    tasa_afp = _tasa_afp(afp)
    no_imponibles = movilizacion + colacion + viaticos
    liquido_imponible_target = sueldo_liquido - no_imponibles

    es_isapre = False
    isapre_uf = 0.0
    isapre_pesos = 0
    if sistema_salud and sistema_salud.upper() != "FONASA":
        uf_val = _parse_monto_isapre(monto_cotizacion_salud)
        if uf_val and uf_val > 0:
            es_isapre = True
            isapre_uf = uf_val
            isapre_pesos = round(uf_val * VALOR_UF)

    aplica_cesantia = (tipo_contrato or "").upper() != "PLAZO_FIJO"
    tasa_cesantia = TASA_CESANTIA_TRABAJADOR if aplica_cesantia else 0.0

    # ── Cálculo inverso del imponible ────────────────────────────────────
    if es_isapre:
        # imponible - imponible*afp - isapre_pesos - imponible*cesantia = liq_imp
        # imponible * (1 - afp - cesantia) = liq_imp + isapre_pesos
        tasa_desc_pct = tasa_afp + tasa_cesantia
        imponible = round((liquido_imponible_target + isapre_pesos) / (1 - tasa_desc_pct))
        # Isapre: pago es max(7% imponible, plan UF)
        salud_7pct = round(imponible * TASA_SALUD_FONASA)
        descuento_salud = max(salud_7pct, isapre_pesos)
        # Si salud real > isapre_pesos, recalcular con 7%
        if descuento_salud > isapre_pesos:
            tasa_desc_pct = tasa_afp + TASA_SALUD_FONASA + tasa_cesantia
            imponible = round(liquido_imponible_target / (1 - tasa_desc_pct))
            descuento_salud = round(imponible * TASA_SALUD_FONASA)
    else:
        tasa_desc_pct = tasa_afp + TASA_SALUD_FONASA + tasa_cesantia
        imponible = round(liquido_imponible_target / (1 - tasa_desc_pct))
        descuento_salud = round(imponible * TASA_SALUD_FONASA)

    # Aplicar tope imponible AFP
    base_afp = min(imponible, TOPE_IMPONIBLE_AFP)
    descuento_afp = round(base_afp * tasa_afp)

    base_cesantia = min(imponible, TOPE_IMPONIBLE_CESANTIA)
    descuento_cesantia = round(base_cesantia * tasa_cesantia)

    if es_isapre:
        salud_7pct = round(min(imponible, TOPE_IMPONIBLE_AFP) * TASA_SALUD_FONASA)
        descuento_salud = max(salud_7pct, isapre_pesos)

    # ── Descomponer imponible en base + gratificación ────────────────────
    # imponible = base + min(base*0.25, tope_grat)
    # Caso 1: base*0.25 <= tope → imponible = base*1.25 → base = imponible/1.25
    sueldo_base_tentativo = round(imponible / 1.25)
    grat_tentativa = round(sueldo_base_tentativo * 0.25)

    if grat_tentativa <= TOPE_GRATIFICACION_MENSUAL:
        sueldo_base = sueldo_base_tentativo
        gratificacion = grat_tentativa
    else:
        # Caso 2: gratificación topada
        sueldo_base = imponible - TOPE_GRATIFICACION_MENSUAL
        gratificacion = TOPE_GRATIFICACION_MENSUAL

    # Recalcular imponible exacto
    remuneracion_imponible = sueldo_base + gratificacion

    # Recalcular descuentos con imponible exacto
    base_afp = min(remuneracion_imponible, TOPE_IMPONIBLE_AFP)
    descuento_afp = round(base_afp * tasa_afp)

    if es_isapre:
        salud_7pct = round(min(remuneracion_imponible, TOPE_IMPONIBLE_AFP) * TASA_SALUD_FONASA)
        descuento_salud = max(salud_7pct, isapre_pesos)
    else:
        descuento_salud = round(min(remuneracion_imponible, TOPE_IMPONIBLE_AFP) * TASA_SALUD_FONASA)

    base_cesantia = min(remuneracion_imponible, TOPE_IMPONIBLE_CESANTIA)
    descuento_cesantia = round(base_cesantia * tasa_cesantia)

    total_descuentos = descuento_afp + descuento_salud + descuento_cesantia
    liquido_imponible = remuneracion_imponible - total_descuentos
    liquido_verificado = liquido_imponible + no_imponibles

    # ── Costo empleador ──────────────────────────────────────────────────
    costo_sis = round(remuneracion_imponible * SIS_EMPLEADOR)
    tasa_ces_emp = CESANTIA_EMPLEADOR_PLAZO_FIJO if (tipo_contrato or "").upper() == "PLAZO_FIJO" else CESANTIA_EMPLEADOR_INDEFINIDO
    costo_ces_emp = round(remuneracion_imponible * tasa_ces_emp)
    costo_mutual = round(remuneracion_imponible * MUTUAL_BASE)
    costo_empresa_total = remuneracion_imponible + no_imponibles + costo_sis + costo_ces_emp + costo_mutual

    return ResultadoCalculo(
        sueldo_liquido=sueldo_liquido,
        sueldo_base=sueldo_base,
        gratificacion=gratificacion,
        remuneracion_imponible=remuneracion_imponible,
        descuento_afp=descuento_afp,
        descuento_salud=descuento_salud,
        descuento_cesantia=descuento_cesantia,
        total_descuentos=total_descuentos,
        liquido_imponible=liquido_imponible,
        liquido_verificado=liquido_verificado,
        sueldo_bruto=remuneracion_imponible,
        costo_afp=descuento_afp,
        costo_salud=descuento_salud,
        movilizacion=movilizacion,
        colacion=colacion,
        viaticos=viaticos,
        costo_empresa_sis=costo_sis,
        costo_empresa_cesantia=costo_ces_emp,
        costo_empresa_mutual=costo_mutual,
        costo_empresa_total=costo_empresa_total,
    )


def aplicar_calculo_a_trabajador(trabajador, recalc: bool = True) -> None:
    """
    Recalcula campos derivados de un ORM Trabajador in-place.
    Solo recalcula si sueldo_liquido > 0 y tiene AFP asignada.
    """
    liq = getattr(trabajador, "sueldo_liquido", 0) or 0
    if liq <= 0:
        return

    r = calcular_desde_liquido(
        sueldo_liquido=liq,
        afp=trabajador.afp,
        sistema_salud=trabajador.sistema_salud,
        monto_cotizacion_salud=trabajador.monto_cotizacion_salud,
        tipo_contrato=trabajador.tipo_contrato,
        movilizacion=trabajador.movilizacion or 0,
        colacion=trabajador.colacion or 0,
        viaticos=trabajador.viaticos or 0,
    )
    trabajador.sueldo_base = r.sueldo_base
    trabajador.gratificacion = r.gratificacion
    trabajador.sueldo_bruto = r.sueldo_bruto
    trabajador.costo_afp = r.costo_afp
    trabajador.costo_salud = r.costo_salud
    trabajador.descuento_cesantia = r.descuento_cesantia
