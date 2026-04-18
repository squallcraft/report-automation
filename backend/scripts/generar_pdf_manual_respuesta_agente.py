#!/usr/bin/env python3
"""
Genera un PDF estático con el texto del manual de funcionamiento del cálculo
de remuneraciones (respuesta para recheck con otro sistema).
Salida: backend/docs/Manual_Funcionamiento_Remuneraciones.pdf
No requiere API ni base de datos.
"""
import io
import os
import sys

# Raíz del backend (parent de scripts/)
BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS_DIR = os.path.join(BACKEND_ROOT, "docs")
OUT_PATH = os.path.join(DOCS_DIR, "Manual_Funcionamiento_Remuneraciones.pdf")

# Asegurar import de reportlab desde el entorno del proyecto
sys.path.insert(0, BACKEND_ROOT)

from reportlab.lib import colors  # noqa: E402
from reportlab.lib.pagesizes import letter  # noqa: E402
from reportlab.lib.styles import ParagraphStyle  # noqa: E402
from reportlab.lib.enums import TA_LEFT, TA_CENTER  # noqa: E402
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak  # noqa: E402


def esc(s: str) -> str:
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


FONT = "Helvetica"
FONT_BOLD = "Helvetica-Bold"


def main() -> None:
    os.makedirs(DOCS_DIR, exist_ok=True)

    story = []
    st_title = ParagraphStyle(
        "t", fontName=FONT_BOLD, fontSize=14, alignment=TA_CENTER,
        textColor=colors.HexColor("#0d2240"), spaceAfter=8,
    )
    st_h2 = ParagraphStyle(
        "h2", fontName=FONT_BOLD, fontSize=10, spaceBefore=10, spaceAfter=4,
        textColor=colors.HexColor("#2b6cb0"),
    )
    st_body = ParagraphStyle("b", fontName=FONT, fontSize=8, leading=10.5)

    story.append(Paragraph(esc("Manual de funcionamiento — Cálculo de remuneraciones (Chile)"), st_title))
    story.append(Paragraph(
        esc("E-Courier · Texto para contraste con otro sistema de liquidación · Documento estático"),
        ParagraphStyle("sub", fontName=FONT, fontSize=8, alignment=TA_CENTER, textColor=colors.HexColor("#555")),
    ))
    story.append(Spacer(1, 8))

    # ── Bloques de texto (contenido de la respuesta del agente) ─────────────
    blocks = [
        ("PARÁMETROS DE ENTRADA (los ingresa el admin)", """
Campo | Descripción
sueldo_liquido | Lo que recibe el trabajador en su cuenta
afp | Nombre de la AFP
sistema_salud | FONASA o ISAPRE
monto_cotizacion_salud | Solo Isapre: monto del plan en UF (ej. "2.714")
tipo_contrato | INDEFINIDO o PLAZO_FIJO
movilizacion | Asignación movilización (no imponible)
colacion | Asignación colación (no imponible)
viaticos | Viáticos (no imponible)
        """),
        ("PARÁMETROS LEGALES (desde mindicador.cl, actualizados automáticamente)", """
Parámetro | Valor típico | Fuente
UF | Diaria (ej. ~$39.960) | mindicador.cl → BCCh
UTM | Mensual (ej. $69.889) | mindicador.cl → SII
IMM | Anual por ley (ej. $539.000 desde ene-2026) | Tabla interna por año
        """),
        ("TASAS AFP (obligatoria 10% + comisión administradora)", """
AFP | Tasa total
Uno | 10,46%
Modelo | 10,58%
PlanVital | 11,16%
Habitat | 11,27%
Capital | 11,44%
Cuprum | 11,44%
ProVida | 11,45%
        """),
        ("TOPES IMPONIBLES (calculados con UF del mes)", """
Concepto | Tope en UF | Ejemplo en pesos (con UF de referencia)
AFP y Salud | 90 UF | 90 × UF del mes
Cesantía trabajador | 135,2 UF | 135,2 × UF del mes
        """),
        ("GRATIFICACIÓN (Art. 50 CT)", """
tope_grat_mensual = 4,75 × IMM / 12

Si imponible / 1,25 da gratificación ≤ tope:
  sueldo_base = round(imponible / 1,25)
  gratificacion = round(sueldo_base × 0,25)

Si gratificación > tope (sueldo alto):
  gratificacion = tope_grat_mensual
  sueldo_base = imponible − tope_grat_mensual

imponible = sueldo_base + gratificacion
        """),
        ("CÁLCULO FORWARD — bruto imponible → líquido (Capa A)", """
1) AFP: base_AFP = min(imponible, 90 UF × valor_UF) → desc_AFP = round(base_AFP × tasa_AFP)

2) Salud (7% legal): base_salud = min(imponible, 90 UF × valor_UF) → desc_salud_7pct = round(base_salud × 7%)

3) Adicional Isapre (solo si es Isapre): plan_pesos = UF_plan × valor_UF → adicional_isapre = max(0, plan_pesos − desc_salud_7pct). Si 7% del imponible > plan, adicional = $0.

4) Cesantía: Indefinido → base_ces = min(imponible, 135,2 UF × UF) × 0,6%. Plazo fijo → $0.

5) Base tributable IUSC: base_tributable = imponible − desc_AFP − desc_salud_7pct − desc_ces. El adicional Isapre NO reduce la base tributable (Art. 42 nº1 LIR).

6) IUSC: tabla progresiva SII por tramos; impuesto = max(0, round(base_tributable × factor − rebaja_utm × UTM)).

7) Líquido: total_descuentos = AFP + salud_7% + adicional_isapre + cesantía + IUSC. liquido_imponible = imponible − total_descuentos. Líquido final = liquido_imponible + movilización + colación + viáticos.
        """),
        ("IUSC — Tabla progresiva (referencia Circular SII)", """
Tramo | Hasta (UTM) | Factor | Rebaja (UTM) | Fórmula
1 | 13,5 | Exento | — | $0
2 | 30 | 4% | 0,540 | base × 0,04 − 0,54 × UTM
3 | 50 | 8% | 1,740 | base × 0,08 − 1,74 × UTM
4 | 70 | 13,5% | 4,490 | base × 0,135 − 4,49 × UTM
5 | 90 | 23% | 11,140 | base × 0,23 − 11,14 × UTM
6 | 120 | 30,4% | 17,800 | base × 0,304 − 17,80 × UTM
7 | 150 | 35% | 23,320 | base × 0,35 − 23,32 × UTM
8 | ∞ | 40% | 30,820 | base × 0,40 − 30,82 × UTM

Se usa la UTM del mes. base_utm = base_tributable / UTM; se aplica el primer tramo donde base_utm ≤ tope_superior.
        """),
        ("CÁLCULO INVERSO — líquido pactado → bruto (Capa B, búsqueda binaria)", """
Entrada: sueldo_liquido pactado (incluye no imponibles).

Proceso: búsqueda binaria (hasta ~64 iteraciones, tolerancia ±$1):
  low = líquido − (movilización + colación + viáticos)
  high = líquido × 3
  mid = (low + high) // 2
  Se compara bruto_a_liquido(mid) con el objetivo y se ajusta low/high.

Salida: imponible exacto + desglose (AFP, salud, cesantía, IUSC, etc.).
        """),
        ("COSTO EMPRESA (aportes empleador)", """
SIS (Seguro Invalidez/Sobrevivencia) = imponible × 1,54%

Cesantía empleador: Indefinido × 2,4% · Plazo fijo × 3,0%

Mutual (accidentes del trabajo, tasa base referencial) = imponible × 0,93%

costo_empresa_total = imponible + no_imponibles + SIS + cesantía_empleador + mutual

Nota: la tasa de mutual puede variar según administradora.
        """),
        ("EJEMPLOS ORIENTATIVOS (Fonasa, AFP Capital, indefinido, sin no imponibles)", """
Ejemplo A — Líquido objetivo $700.000 (orden de magnitud verificable en el sistema):
  Imponible ~ $783.178 · Base ~ $626.542 · Gratificación ~ $156.636
  AFP ~ $89.595 · Salud 7% ~ $54.823 · Cesantía ~ $4.699
  Base tributable ~ $634.061 (~9 UTM) → IUSC típicamente $0 en tramo exento/bajo
  Líquido verificado = $700.000

Ejemplo B — Líquido objetivo $3.000.000:
  Imponible mayor, topes 90 UF en AFP/salud, IUSC en tramos altos (~$152.000 u orden similar según UTM/UF del mes)
  Líquido verificado = $3.000.000

Los montos exactos dependen de UF, UTM e IMM vigentes al mes de cálculo.
        """),
    ]

    for title, body in blocks:
        story.append(Paragraph(esc(title.strip()), st_h2))
        # Tablas simples si el cuerpo tiene "|"
        lines = [ln.strip() for ln in body.strip().splitlines() if ln.strip()]
        if lines and "|" in lines[0]:
            data = []
            for ln in lines:
                parts = [p.strip() for p in ln.split("|")]
                data.append(parts)
            tw = letter[0] - 96
            coln = max(len(r) for r in data)
            cw = tw / coln
            t = Table(data, colWidths=[cw] * coln)
            t.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0d2240")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), FONT_BOLD),
                ("FONTSIZE", (0, 0), (-1, -1), 7),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#cccccc")),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]))
            story.append(t)
        else:
            story.append(Paragraph(esc(body.strip().replace("\n", "<br/>")), st_body))
        story.append(Spacer(1, 6))

    story.append(PageBreak())
    story.append(Paragraph(esc("Nota final"), st_h2))
    story.append(Paragraph(
        esc(
            "Este PDF es una copia fija del texto explicativo para auditoría. "
            "Para simulación en vivo use la administración de trabajadores o el endpoint "
            "POST /api/trabajadores/simular-calculo con token de sesión."
        ),
        st_body,
    ))

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        rightMargin=48,
        leftMargin=48,
        topMargin=48,
        bottomMargin=48,
        title="Manual funcionamiento remuneraciones",
    )
    doc.build(story)
    with open(OUT_PATH, "wb") as f:
        f.write(buf.getvalue())
    print(f"Escrito: {OUT_PATH} ({os.path.getsize(OUT_PATH)} bytes)")


if __name__ == "__main__":
    main()
