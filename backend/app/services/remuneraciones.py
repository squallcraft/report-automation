"""
Motor de cálculo de remuneraciones chilenas — grado producción.

Arquitectura de dos capas:
  Capa A — bruto_a_liquido():  dirección forward, determinista, auditale.
  Capa B — calcular_desde_liquido(): invierte la Capa A usando búsqueda binaria.

Fuentes legales:
  - Art. 42 nº1 LIR + Art. 50 CT: Gratificación legal 25%, tope 4,75 IMM/año.
  - Ley 19.728: Seguro de Cesantía (0,6% trabajador indefinido / 0% plazo fijo).
  - Superintendencia de Pensiones: tasas AFP 2026.
  - Circular SII nº 4/2026: tabla IUSC mensual con UTM $69.889.
  - DL 3.500: topes imponibles 90 UF (AFP/salud) y 135,2 UF (cesantía).
"""
from __future__ import annotations

from dataclasses import dataclass, field

# ── Constantes vigentes 2026 ─────────────────────────────────────────────────
IMM   = 539_000          # Ingreso Mínimo Mensual desde 01-ene-2026
UTM   = 69_889           # UTM abril 2026
VALOR_UF = 39_842        # UF promedio abril 2026

TOPE_IMPONIBLE_AFP_UF      = 90.0
TOPE_IMPONIBLE_CESANTIA_UF = 135.2
TOPE_IMPONIBLE_AFP         = round(TOPE_IMPONIBLE_AFP_UF * VALOR_UF)       # $3.585.780
TOPE_IMPONIBLE_CESANTIA    = round(TOPE_IMPONIBLE_CESANTIA_UF * VALOR_UF)  # $5.386.638
TOPE_GRATIFICACION_MENSUAL = round(4.75 * IMM / 12)                         # $213.354

TASA_CESANTIA_TRABAJADOR     = 0.006   # 0,6% — contrato indefinido
TASA_SALUD_FONASA            = 0.07    # 7%
SIS_EMPLEADOR                = 0.0154  # 1,54%
CESANTIA_EMPLEADOR_INDEFINIDO = 0.024  # 2,4%
CESANTIA_EMPLEADOR_PLAZO_FIJO = 0.030  # 3,0%
MUTUAL_BASE                  = 0.0093  # 0,93% tasa base accidentes del trabajo

# ── Tasas AFP — cotización obligatoria 10% + comisión administradora ─────────
TASAS_AFP: dict[str, float] = {
    "Uno":      0.1046,
    "Modelo":   0.1058,
    "PlanVital": 0.1116,
    "Habitat":  0.1127,
    "Capital":  0.1144,
    "Cuprum":   0.1144,
    "ProVida":  0.1145,
}
AFP_DEFAULT_TASA = 0.1144

# ── Tabla IUSC mensual — Circular SII 2026 (UTM $69.889) ─────────────────────
# Cada tramo: (tope_superior_en_utm, factor_marginal, rebaja_en_utm)
# Fórmula: impuesto = base_tributable × factor  -  rebaja_utm × UTM
TABLA_IUSC: list[tuple[float, float, float]] = [
    (13.5,        0.00,   0.000),
    (30.0,        0.04,   0.540),
    (50.0,        0.08,   1.740),
    (70.0,        0.135,  4.490),
    (90.0,        0.23,  11.140),
    (120.0,       0.304, 17.800),
    (150.0,       0.35,  23.320),
    (float("inf"), 0.40,  30.820),
]


# ── Dataclass resultado ───────────────────────────────────────────────────────
@dataclass
class ResultadoCalculo:
    sueldo_liquido: int
    sueldo_base: int
    gratificacion: int
    remuneracion_imponible: int
    descuento_afp: int
    descuento_salud_legal: int      # 7% del imponible (deducible IUSC)
    adicional_isapre: int           # excedente plan Isapre sobre 7% (no deducible)
    descuento_cesantia: int
    iusc: int                       # Impuesto Único Segunda Categoría
    total_descuentos: int
    liquido_imponible: int
    liquido_verificado: int
    movilizacion: int
    colacion: int
    viaticos: int
    horas_extras_monto: int = 0
    costo_empresa_sis: int = 0
    costo_empresa_cesantia: int = 0
    costo_empresa_mutual: int = 0
    costo_empresa_total: int = 0
    # Alias de compatibilidad
    sueldo_bruto: int = field(init=False)
    costo_afp: int    = field(init=False)
    costo_salud: int  = field(init=False)

    def __post_init__(self) -> None:
        self.sueldo_bruto = self.remuneracion_imponible
        self.costo_afp    = self.descuento_afp
        self.costo_salud  = self.descuento_salud_legal + self.adicional_isapre


# ── Helpers ───────────────────────────────────────────────────────────────────
def _tasa_afp(nombre: str | None) -> float:
    if not nombre:
        return AFP_DEFAULT_TASA
    for key, tasa in TASAS_AFP.items():
        if key.lower() == nombre.strip().lower():
            return tasa
    return AFP_DEFAULT_TASA


def _parse_uf_isapre(s: str | None) -> float:
    """'UF 2.714' o '2.714' → 2.714. Retorna 0.0 si no parseable."""
    if not s:
        return 0.0
    cleaned = s.strip().upper().replace("UF", "").replace(",", ".").strip()
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


def _calcular_iusc(base_tributable: int, utm: int = UTM) -> int:
    """
    Aplica la tabla progresiva del Impuesto Único de Segunda Categoría.

    base_tributable = remuneración_imponible - AFP - salud_7pct_legal - cesantía_trabajador
    """
    if base_tributable <= 0:
        return 0
    base_utm = base_tributable / utm
    for tope, factor, rebaja in TABLA_IUSC:
        if base_utm <= tope:
            return max(0, round(base_tributable * factor - rebaja * utm))
    # nunca debería llegar aquí, pero por seguridad:
    return max(0, round(base_tributable * 0.40 - 30.820 * utm))


def _descomponer_en_base_grat(imponible: int, tope_grat_mes: int = TOPE_GRATIFICACION_MENSUAL) -> tuple[int, int]:
    """Descompone el imponible en (sueldo_base, gratificación) según Art. 50 CT."""
    base_tentativo = round(imponible / 1.25)
    grat_tentativa = round(base_tentativo * 0.25)
    if grat_tentativa <= tope_grat_mes:
        return base_tentativo, grat_tentativa
    return imponible - tope_grat_mes, tope_grat_mes


# ── CAPA A: forward bruto → líquido ──────────────────────────────────────────
def bruto_a_liquido(
    remuneracion_imponible: int,
    afp: str | None,
    sistema_salud: str | None,
    monto_cotizacion_salud: str | None,
    tipo_contrato: str | None,
    movilizacion: int = 0,
    colacion: int = 0,
    viaticos: int = 0,
    horas_extras_monto: int = 0,
    utm: int = UTM,
    valor_uf: float = VALOR_UF,
    imm: int = IMM,
) -> ResultadoCalculo:
    """
    CAPA A — Función forward determinista.

    Dado el imponible bruto calcula el líquido exacto aplicando:
    topes AFP/salud (90 UF) y cesantía (135,2 UF), IUSC por tramos,
    y separa el adicional Isapre del descuento 7% legal.

    `remuneracion_imponible` debe incluir ya el `horas_extras_monto` si las hay.
    El argumento horas_extras_monto se usa solo para descomposición y reporting.
    """
    tope_afp      = round(TOPE_IMPONIBLE_AFP_UF * valor_uf)
    tope_cesantia = round(TOPE_IMPONIBLE_CESANTIA_UF * valor_uf)
    tope_grat_mes = round(4.75 * imm / 12)

    tasa_afp = _tasa_afp(afp)
    es_plazo_fijo = (tipo_contrato or "").upper() == "PLAZO_FIJO"
    no_imponibles = movilizacion + colacion + viaticos

    # ── AFP ──────────────────────────────────────────────────────────────────
    base_afp = min(remuneracion_imponible, tope_afp)
    descuento_afp = round(base_afp * tasa_afp)

    # ── Salud ─────────────────────────────────────────────────────────────────
    base_salud = min(remuneracion_imponible, tope_afp)
    descuento_salud_legal = round(base_salud * TASA_SALUD_FONASA)  # 7%
    adicional_isapre = 0
    if sistema_salud and sistema_salud.upper() != "FONASA":
        uf_plan = _parse_uf_isapre(monto_cotizacion_salud)
        if uf_plan > 0:
            plan_pesos = round(uf_plan * valor_uf)
            adicional_isapre = max(0, plan_pesos - descuento_salud_legal)

    # ── Cesantía ─────────────────────────────────────────────────────────────
    base_cesantia = min(remuneracion_imponible, tope_cesantia)
    descuento_cesantia = round(base_cesantia * (0.0 if es_plazo_fijo else TASA_CESANTIA_TRABAJADOR))

    # ── IUSC (Impuesto Único Segunda Categoría) ───────────────────────────────
    # Base tributable = imponible - AFP - 7% legal salud - cesantía
    # El adicional Isapre NO es deducible del impuesto (Art. 42 nº1 LIR)
    base_tributable = remuneracion_imponible - descuento_afp - descuento_salud_legal - descuento_cesantia
    iusc = _calcular_iusc(max(0, base_tributable), utm)

    # ── Totales ───────────────────────────────────────────────────────────────
    total_descuentos = descuento_afp + descuento_salud_legal + adicional_isapre + descuento_cesantia + iusc
    liquido_imponible = remuneracion_imponible - total_descuentos
    liquido_verificado = liquido_imponible + no_imponibles

    # ── Costo empresa ─────────────────────────────────────────────────────────
    costo_sis = round(remuneracion_imponible * SIS_EMPLEADOR)
    tasa_ces_emp = CESANTIA_EMPLEADOR_PLAZO_FIJO if es_plazo_fijo else CESANTIA_EMPLEADOR_INDEFINIDO
    costo_ces_emp = round(remuneracion_imponible * tasa_ces_emp)
    costo_mutual = round(remuneracion_imponible * MUTUAL_BASE)
    costo_empresa_total = remuneracion_imponible + no_imponibles + costo_sis + costo_ces_emp + costo_mutual

    # ── Descomponer en base + gratificación ───────────────────────────────────
    # Las horas extras NO entran a base ni gratificación; quedan como ítem aparte
    imponible_base = max(0, remuneracion_imponible - horas_extras_monto)
    sueldo_base, gratificacion = _descomponer_en_base_grat(imponible_base, tope_grat_mes)

    return ResultadoCalculo(
        sueldo_liquido=liquido_verificado,
        sueldo_base=sueldo_base,
        gratificacion=gratificacion,
        remuneracion_imponible=remuneracion_imponible,
        descuento_afp=descuento_afp,
        descuento_salud_legal=descuento_salud_legal,
        adicional_isapre=adicional_isapre,
        descuento_cesantia=descuento_cesantia,
        iusc=iusc,
        total_descuentos=total_descuentos,
        liquido_imponible=liquido_imponible,
        liquido_verificado=liquido_verificado,
        movilizacion=movilizacion,
        colacion=colacion,
        viaticos=viaticos,
        horas_extras_monto=horas_extras_monto,
        costo_empresa_sis=costo_sis,
        costo_empresa_cesantia=costo_ces_emp,
        costo_empresa_mutual=costo_mutual,
        costo_empresa_total=costo_empresa_total,
    )


# ── CAPA B: búsqueda binaria líquido → bruto ─────────────────────────────────
def calcular_desde_liquido(
    sueldo_liquido: int,
    afp: str | None,
    sistema_salud: str | None,
    monto_cotizacion_salud: str | None,
    tipo_contrato: str | None,
    movilizacion: int = 0,
    colacion: int = 0,
    viaticos: int = 0,
    horas_extras_monto: int = 0,
    utm: int = UTM,
    valor_uf: float = VALOR_UF,
    imm: int = IMM,
    tolerancia: int = 1,
) -> ResultadoCalculo:
    """
    CAPA B — Búsqueda binaria.

    Itera sobre bruto_a_liquido() hasta encontrar el imponible que produce
    exactamente el líquido pactado (tolerancia ±1 peso por redondeo).

    El líquido pactado se refiere al **sueldo regular** sin horas extras.
    Si se pasa horas_extras_monto > 0, primero se converge el imponible base
    para el líquido pactado, y luego se agregan las HE al imponible
    (afectando cotizaciones e IUSC marginales). El líquido final será
    mayor que el pactado — esto es lo esperado.

    Soporta cualquier nivel salarial — el IUSC por tramos y los topes
    de UF son manejados transparentemente por la Capa A.
    """
    # Si hay HE, primero converger sin ellas y después agregarlas al imponible
    if horas_extras_monto > 0:
        base_sin_he = calcular_desde_liquido(
            sueldo_liquido=sueldo_liquido,
            afp=afp,
            sistema_salud=sistema_salud,
            monto_cotizacion_salud=monto_cotizacion_salud,
            tipo_contrato=tipo_contrato,
            movilizacion=movilizacion,
            colacion=colacion,
            viaticos=viaticos,
            horas_extras_monto=0,
            utm=utm,
            valor_uf=valor_uf,
            imm=imm,
            tolerancia=tolerancia,
        )
        return bruto_a_liquido(
            remuneracion_imponible=base_sin_he.remuneracion_imponible + horas_extras_monto,
            afp=afp,
            sistema_salud=sistema_salud,
            monto_cotizacion_salud=monto_cotizacion_salud,
            tipo_contrato=tipo_contrato,
            movilizacion=movilizacion,
            colacion=colacion,
            viaticos=viaticos,
            horas_extras_monto=horas_extras_monto,
            utm=utm,
            valor_uf=valor_uf,
            imm=imm,
        )

    kwargs = dict(
        afp=afp,
        sistema_salud=sistema_salud,
        monto_cotizacion_salud=monto_cotizacion_salud,
        tipo_contrato=tipo_contrato,
        movilizacion=movilizacion,
        colacion=colacion,
        viaticos=viaticos,
        horas_extras_monto=0,
        utm=utm,
        valor_uf=valor_uf,
        imm=imm,
    )

    # Límite inferior: el imponible nunca puede ser menor que el líquido
    low = max(1, sueldo_liquido - (movilizacion + colacion + viaticos))
    # Límite superior: 3× es holgado incluso para el tramo 40% de IUSC
    high = sueldo_liquido * 3

    best: ResultadoCalculo | None = None

    for _ in range(64):  # 64 iteraciones → precisión sub-peso
        mid = (low + high) // 2
        result = bruto_a_liquido(mid, **kwargs)
        diff = result.sueldo_liquido - sueldo_liquido

        if abs(diff) <= tolerancia:
            # Ajustar el líquido almacenado al valor pactado exacto
            result.sueldo_liquido = sueldo_liquido
            result.liquido_verificado = result.sueldo_liquido
            return result

        best = result
        if diff > 0:
            high = mid
        else:
            low = mid

    # Fallback: retornar la mejor aproximación encontrada SIN mentir.
    # Antes este bloque pegaba `sueldo_liquido = pactado`, lo cual
    # ocultaba inconsistencias graves (ej. líquido pactado matemáticamente
    # inalcanzable por el bruto). Ahora respetamos el líquido REAL calculado
    # y el caller debe detectar la diferencia para alertar al usuario.
    if best is not None:
        # mantener best.sueldo_liquido tal como lo calculó bruto_a_liquido
        return best
    return bruto_a_liquido(sueldo_liquido, **kwargs)


def aplicar_calculo_a_trabajador(trabajador, parametros: dict | None = None) -> None:
    """
    Recalcula todos los campos derivados de un ORM Trabajador in-place.
    No hace nada si sueldo_liquido es 0 o no hay AFP asignada.

    parametros: dict con {'uf': float, 'utm': int, 'imm': int} del mes.
    Si no se provee, usa las constantes hardcoded.
    """
    liq = getattr(trabajador, "sueldo_liquido", 0) or 0
    if liq <= 0:
        return

    uf_val  = float((parametros or {}).get("uf",  VALOR_UF))
    utm_val = int((parametros or {}).get("utm", UTM))
    imm_val = int((parametros or {}).get("imm", IMM))

    r = calcular_desde_liquido(
        sueldo_liquido=liq,
        afp=trabajador.afp,
        sistema_salud=trabajador.sistema_salud,
        monto_cotizacion_salud=trabajador.monto_cotizacion_salud,
        tipo_contrato=trabajador.tipo_contrato,
        movilizacion=trabajador.movilizacion or 0,
        colacion=trabajador.colacion or 0,
        viaticos=trabajador.viaticos or 0,
        utm=utm_val,
        valor_uf=uf_val,
        imm=imm_val,
    )
    trabajador.sueldo_base        = r.sueldo_base
    trabajador.gratificacion      = r.gratificacion
    trabajador.sueldo_bruto       = r.remuneracion_imponible
    trabajador.costo_afp          = r.descuento_afp
    trabajador.costo_salud        = r.descuento_salud_legal + r.adicional_isapre
    trabajador.descuento_cesantia = r.descuento_cesantia
    trabajador.iusc               = r.iusc
    trabajador.adicional_isapre   = r.adicional_isapre
