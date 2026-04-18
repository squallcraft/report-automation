#!/usr/bin/env python3
"""
Demo: liquidación de Adriana Colina con préstamo $300.000
Corre desde la raíz del proyecto: python3 scripts/demo_liquidacion_adriana.py
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from datetime import date
from dataclasses import dataclass, field
from typing import Optional
from decimal import Decimal

# ── Mock del trabajador ───────────────────────────────────────────────────────
@dataclass
class TrabajadorMock:
    id: int = 2
    nombre: str = "Adriana Vanessa Colina Aguilar"
    rut: str = "25.936.753-0"
    cargo: str = "Dir. Operaciones"
    tipo_contrato: str = "INDEFINIDO"
    afp: str = "Capital"
    sistema_salud: str = "Colmena"
    monto_cotizacion_salud: str = "UF 4.76"
    fecha_ingreso: date = date(2024, 1, 2)
    activo: bool = True

# ── Cálculo real ──────────────────────────────────────────────────────────────
# UF/UTM/IMM de abril 2026
UF_ABRIL  = 39_842.0
UTM_ABRIL = 69_889
IMM_ABRIL = 539_000

# Sueldo líquido pactado (confirmado en liquidaciones reales)
SUELDO_LIQUIDO_PACTADO = 1_986_745  # aprox de las liquidaciones reales

from app.services.remuneraciones import calcular_desde_liquido

r = calcular_desde_liquido(
    sueldo_liquido=SUELDO_LIQUIDO_PACTADO,
    afp="Capital",
    sistema_salud="Colmena",
    monto_cotizacion_salud="UF 4.76",
    tipo_contrato="INDEFINIDO",
    movilizacion=0,
    colacion=0,
    viaticos=0,
    utm=UTM_ABRIL,
    valor_uf=UF_ABRIL,
    imm=IMM_ABRIL,
)

print("=" * 60)
print("Cálculo Adriana Colina — Abril 2026")
print("=" * 60)
print(f"  Sueldo base:        ${r.sueldo_base:>12,}".replace(",", "."))
print(f"  Gratificación:      ${r.gratificacion:>12,}".replace(",", "."))
print(f"  Imponible (bruto):  ${r.remuneracion_imponible:>12,}".replace(",", "."))
print(f"  AFP Capital 11.44%: ${r.descuento_afp:>12,}".replace(",", "."))
print(f"  Salud 7%:           ${r.descuento_salud_legal:>12,}".replace(",", "."))
print(f"  Adicional Isapre:   ${r.adicional_isapre:>12,}".replace(",", "."))
print(f"  Cesantía 0.6%:      ${r.descuento_cesantia:>12,}".replace(",", "."))
print(f"  IUSC:               ${r.iusc:>12,}".replace(",", "."))
print(f"  Total descuentos:   ${r.total_descuentos:>12,}".replace(",", "."))
print(f"  Sueldo líquido:     ${r.sueldo_liquido:>12,}".replace(",", "."))
print(f"  --- Préstamo demo:  ${300_000:>12,}".replace(",", "."))
print(f"  Líquido depositar:  ${r.sueldo_liquido - 100_000:>12,}".replace(",", "."))
print(f"  Costo empresa:      ${r.costo_empresa_total:>12,}".replace(",", "."))
print("=" * 60)

# ── Mock de LiquidacionMensual ────────────────────────────────────────────────
@dataclass
class LiquidacionMock:
    id: int = 9999
    trabajador_id: int = 2
    mes: int = 4
    anio: int = 2026
    parametros_id: int = 1          # señal de fuente real
    sueldo_base: int = r.sueldo_base
    gratificacion: int = r.gratificacion
    movilizacion: int = 0
    colacion: int = 0
    viaticos: int = 0
    remuneracion_imponible: int = r.remuneracion_imponible
    descuento_afp: int = r.descuento_afp
    descuento_salud_legal: int = r.descuento_salud_legal
    adicional_isapre: int = r.adicional_isapre
    descuento_cesantia: int = r.descuento_cesantia
    iusc: int = r.iusc
    total_descuentos: int = r.total_descuentos
    sueldo_liquido: int = r.sueldo_liquido
    costo_sis: int = r.costo_empresa_sis
    costo_cesantia_empleador: int = r.costo_empresa_cesantia
    costo_mutual: int = r.costo_empresa_mutual
    costo_empresa_total: int = r.costo_empresa_total
    uf_usada: float = UF_ABRIL
    utm_usado: int = UTM_ABRIL
    imm_usado: int = IMM_ABRIL
    estado: str = "EMITIDA"
    pago_mes_id: Optional[int] = None

liq = LiquidacionMock()
trab = TrabajadorMock()

# Préstamo de $300.000 en 3 cuotas de $100.000
descuentos_adicionales = [
    {"concepto": "Cuota Préstamo — Adelanto económico (3 cuotas)", "monto": 100_000},
]

# ── Generar PDF ───────────────────────────────────────────────────────────────
from app.services.pdf_generator import generar_pdf_liquidacion

pdf_bytes = generar_pdf_liquidacion(liq, trab, descuentos_adicionales=descuentos_adicionales)

out_path = os.path.join(os.path.dirname(__file__), "..", "docs", "demo_adriana_colina_abril2026.pdf")
os.makedirs(os.path.dirname(out_path), exist_ok=True)
with open(out_path, "wb") as f:
    f.write(pdf_bytes)

print(f"\nPDF generado: {os.path.abspath(out_path)}  ({len(pdf_bytes):,} bytes)")
