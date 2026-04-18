"""
Generador de PDFs de liquidación para sellers y drivers.
Formato: logo + encabezado, resumen semanal (5 columnas), desglose diario,
gráfico mensual de envíos, footer motivacional.
"""
import io
import os
from datetime import datetime, date
from typing import Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer,
    Image as RLImage,
)
from reportlab.graphics.shapes import Drawing, Rect, String as GString
from sqlalchemy.orm import Session

from app.models import Envio, Seller, Driver, Retiro

# Registrar Roboto (usa font-roboto si está instalado)
try:
    import font_roboto
    _font_dir = os.path.join(os.path.dirname(font_roboto.__file__), "files")
    pdfmetrics.registerFont(TTFont("Roboto", os.path.join(_font_dir, "Roboto-Regular.ttf")))
    pdfmetrics.registerFont(TTFont("Roboto-Bold", os.path.join(_font_dir, "Roboto-Bold.ttf")))
    FONT = "Roboto"
    FONT_BOLD = "Roboto-Bold"
except Exception:
    FONT = "Helvetica"
    FONT_BOLD = "Helvetica-Bold"

MESES = [
    "", "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

LOGO_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets", "logo_ecourier.png")

BLUE_DARK = colors.HexColor("#0d2240")
BLUE_MID = colors.HexColor("#2b6cb0")
BLUE_LIGHT = colors.HexColor("#dbe9f7")
YELLOW_BG = colors.HexColor("#ffd600")
GREEN_AMOUNT = colors.HexColor("#1a8a1a")
GRAY_BG = colors.HexColor("#f0f0f0")
GRAY_TEXT = colors.HexColor("#555555")
WHITE = colors.white
ROW_ALT = colors.HexColor("#f7f9fc")
CHART_BG = colors.HexColor("#1a1d23")
CHART_GRID = colors.HexColor("#2d3238")
CHART_LABEL = colors.HexColor("#9ca3af")
CHART_LINE = colors.HexColor("#60a5fa")

PAGE_W = letter[0]
CONTENT_W = PAGE_W - 80


def _fmt(valor: int) -> str:
    if valor == 0:
        return "$0"
    if valor < 0:
        return f"-${abs(valor):,.0f}".replace(",", ".")
    return f"${valor:,.0f}".replace(",", ".")



def _style(name="s", size=9, color="#333333", align=TA_LEFT, bold=False, leading=None):
    font = FONT_BOLD if bold else FONT
    return ParagraphStyle(name, fontName=font, fontSize=size, textColor=colors.HexColor(color),
                          alignment=align, leading=leading or size + 3)


def _build_header(name: str, mes: int, anio: int, monto_semana: int, is_seller: bool = True):
    elements = []

    # Logo + company info row
    logo_cell = ""
    if os.path.exists(LOGO_PATH):
        logo_cell = RLImage(LOGO_PATH, width=160, height=45)

    info_text = Paragraph(
        '<font size="8" color="#555555">'
        'E-Courier. Chile<br/>'
        'Cam la Farfana 400, C401, Pudahuel.<br/>'
        '+569 65 271 6167 - hablemos@e-courier.cl'
        '</font>',
        _style("info", align=TA_RIGHT, size=8, leading=11),
    )

    header_data = [[logo_cell, info_text]]
    ht = Table(header_data, colWidths=[CONTENT_W * 0.55, CONTENT_W * 0.45])
    ht.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    elements.append(ht)
    elements.append(Spacer(1, 10))

    if is_seller:
        elements.append(Paragraph(
            f'<font name="{FONT_BOLD}">CLIENTE:</font> <font name="{FONT}">{name.upper()}</font>',
            _style("subtitle", size=11, color="#333333"),
        ))
        elements.append(Paragraph(
            f'Este es tu informe de rendimiento semanal de {MESES[mes]} {anio}',
            _style("subtitle2", size=10, color="#555555"),
        ))
    else:
        elements.append(Paragraph(
            f'{name}, este es tu informe de rendimiento semanal de {MESES[mes]} {anio}',
            _style("subtitle", size=10, color="#333333"),
        ))
    elements.append(Spacer(1, 8))

    label = "El monto a cobrar esta semana es:" if is_seller else "El monto a pagar esta semana es:"

    monto_row = [[
        Paragraph(f'<b>{label}</b>', _style("lbl", size=11, align=TA_LEFT)),
        Paragraph(f'<b>{_fmt(monto_semana)}</b>', _style("val", size=18, color="#1a8a1a", align=TA_RIGHT)),
    ]]
    mt = Table(monto_row, colWidths=[CONTENT_W * 0.6, CONTENT_W * 0.4])
    mt.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BACKGROUND", (0, 0), (-1, -1), YELLOW_BG),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (0, 0), 12),
        ("RIGHTPADDING", (1, 0), (1, 0), 12),
    ]))
    elements.append(mt)
    elements.append(Spacer(1, 12))
    return elements


def _weekly_table(rows, semana_labels=True):
    header_row = ["", "Semana 1", "Semana 2", "Semana 3", "Semana 4", "Semana 5"]
    sub_header = ["Item", "1", "2", "3", "4", "5", "Subtotal"]

    data = [sub_header] + rows
    col_widths = [120, 68, 68, 68, 58, 58, 80]

    style_cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), BLUE_DARK),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("FONTNAME", (0, 0), (-1, 0), FONT_BOLD),
        ("FONTSIZE", (0, 0), (-1, 0), 8),
        ("FONTSIZE", (0, 1), (-1, -1), 8),
        ("FONTNAME", (0, 1), (-1, -1), FONT),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]

    for i in range(1, len(data)):
        label = str(rows[i - 1][0]).lower() if rows[i - 1] else ""
        if "subtotal" in label or label == "total" or label.startswith("total"):
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), BLUE_LIGHT))
            style_cmds.append(("FONTNAME", (0, i), (-1, i), FONT_BOLD))
        elif "iva" in label:
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), GRAY_BG))
        elif i % 2 == 0:
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), ROW_ALT))

    t = Table(data, colWidths=col_widths)
    t.setStyle(TableStyle(style_cmds))
    return t


def _daily_table(daily_data, columns):
    header = [c[0] for c in columns]
    data = [header]
    for d in daily_data:
        row = []
        for _, key, fmt_type in columns:
            val = d.get(key, 0)
            if fmt_type == "date":
                if isinstance(val, date):
                    row.append(val.strftime("%d-%m-%y"))
                elif isinstance(val, str) and val:
                    try:
                        row.append(datetime.strptime(val, "%Y-%m-%d").strftime("%d-%m-%y"))
                    except ValueError:
                        row.append(val)
                else:
                    row.append("")
            elif fmt_type == "int":
                row.append(str(val))
            elif fmt_type == "clp":
                row.append(_fmt(val))
            else:
                row.append(str(val))
        data.append(row)

    col_w = [80] + [75] * (len(columns) - 1)
    t = Table(data, colWidths=col_w)
    style_cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), BLUE_DARK),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("FONTNAME", (0, 0), (-1, 0), FONT_BOLD),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("ALIGN", (1, 0), (-1, -1), "CENTER"),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), ROW_ALT))
    t.setStyle(TableStyle(style_cmds))
    return t


def _fmt_date(fecha) -> str:
    if isinstance(fecha, date):
        return fecha.strftime("%d/%m")
    if isinstance(fecha, str) and fecha:
        try:
            return datetime.strptime(fecha, "%Y-%m-%d").strftime("%d/%m")
        except ValueError:
            return str(fecha)[:5] if len(str(fecha)) >= 5 else str(fecha)
    return ""


def _weekly_chart(daily_data, key="envios", width=480, height=190):
    """Gráfico de barras semanal con estética moderna y paleta ECourier."""
    drawing = Drawing(width, height)

    values = [d.get(key, 0) for d in daily_data]
    labels_list = [_fmt_date(d.get("fecha", "")) for d in daily_data]

    if not values or all(v == 0 for v in values):
        return drawing

    n = len(values)
    max_val = max(values) if values else 1

    # Área del gráfico
    pad_left, pad_bottom = 52, 36
    pad_right, pad_top = 16, 30
    chart_w = width - pad_left - pad_right
    chart_h = height - pad_bottom - pad_top

    # Fondo del área
    bg = Rect(pad_left, pad_bottom, chart_w, chart_h,
              fillColor=colors.HexColor("#f8fafc"), strokeColor=colors.HexColor("#e2e8f0"),
              strokeWidth=0.8)
    drawing.add(bg)

    # Líneas horizontales de referencia (4 niveles)
    n_lines = 5
    for li in range(n_lines + 1):
        y_val = (max_val * 1.1) * (li / n_lines)
        y_pos = pad_bottom + (y_val / (max_val * 1.1)) * chart_h
        grid_line = GString(pad_left - 4, y_pos - 3, str(round(y_val)))
        grid_line.fontSize = 6
        grid_line.fontName = FONT
        grid_line.textAnchor = "end"
        grid_line.fillColor = colors.HexColor("#94a3b8")
        drawing.add(grid_line)
        if li > 0:
            from reportlab.graphics.shapes import Line as RLine
            gl = RLine(pad_left, y_pos, pad_left + chart_w, y_pos)
            gl.strokeColor = colors.HexColor("#e2e8f0")
            gl.strokeWidth = 0.5
            drawing.add(gl)

    # Barras
    bar_w = max(4, (chart_w / n) * 0.6)
    bar_gap = chart_w / n

    for i, v in enumerate(values):
        x_center = pad_left + bar_gap * i + bar_gap / 2
        bar_h_px = (v / (max_val * 1.1)) * chart_h if max_val > 0 else 0

        # Barra de fondo (track)
        track = Rect(x_center - bar_w / 2, pad_bottom, bar_w, chart_h,
                     fillColor=colors.HexColor("#e2e8f0"), strokeColor=None)
        drawing.add(track)

        if bar_h_px > 0:
            bar = Rect(x_center - bar_w / 2, pad_bottom, bar_w, bar_h_px,
                       fillColor=BLUE_MID, strokeColor=None)
            drawing.add(bar)

            # Valor encima de la barra
            val_lbl = GString(x_center, pad_bottom + bar_h_px + 3, str(v))
            val_lbl.fontSize = 7
            val_lbl.fontName = FONT_BOLD
            val_lbl.textAnchor = "middle"
            val_lbl.fillColor = BLUE_DARK
            drawing.add(val_lbl)

        # Etiqueta de fecha debajo
        lbl = GString(x_center, pad_bottom - 12, labels_list[i])
        lbl.fontSize = 6
        lbl.fontName = FONT
        lbl.textAnchor = "middle"
        lbl.fillColor = colors.HexColor("#64748b")
        drawing.add(lbl)

    # Título
    title = GString(width / 2, height - 10, "Detalle de Envíos — Semana")
    title.fontSize = 9
    title.fontName = FONT_BOLD
    title.textAnchor = "middle"
    title.fillColor = BLUE_DARK
    drawing.add(title)

    return drawing


def _footer_message():
    return Paragraph(
        "Hecha un vistazo al detalle de tu rendimiento semanal ;) Sigamos creciendo juntos!",
        _style("footer", size=9, color="#555555", align=TA_CENTER, leading=13),
    )


def _driver_note():
    return Paragraph(
        '<font size="8" color="#555555"><i>'
        'Nota: Recuerda que la cuenta y el pago, se guían por la fecha de entrega del envío.'
        '</i></font>',
        _style("note", size=8, color="#555555", align=TA_CENTER, leading=11),
    )


def _company_footer():
    return Paragraph(
        '<font size="7" color="#999999">'
        'E-Courier. Chile — Cam la Farfana 400, C401, Pudahuel. — '
        '+569 65 271 6167 — hablemos@e-courier.cl'
        '</font>',
        _style("cfooter", size=7, color="#999999", align=TA_CENTER),
    )


# ──────────────────────────────────────────────────────────
#  SELLER PDF
# ──────────────────────────────────────────────────────────

def generar_pdf_seller(
    db: Session, seller_id: int, semana: int, mes: int, anio: int,
    weekly_data: dict = None, daily_data: list = None,
) -> bytes:
    """
    Genera PDF de liquidación de un seller.
    Si weekly_data y daily_data se pasan, los usa directamente (misma fuente
    que la vista web). Si no, los calcula internamente como fallback.
    """
    seller = db.get(Seller, seller_id)
    if not seller:
        raise ValueError("Seller no encontrado")

    if weekly_data is None:
        from app.api.liquidacion import _seller_detail
        detail = _seller_detail(db, seller_id, mes, anio)
        weekly_data = detail["weekly"]

    weekly = weekly_data

    def sub(s):
        w = weekly.get(s, {})
        return (w.get("monto", 0) + w.get("bultos_extra", 0) + w.get("cobro_extra_manual", 0)
                + w.get("retiros", 0) + w.get("peso_extra", 0) + w.get("ajustes", 0))

    subtotals = [sub(s) for s in range(1, 6)]
    ivas = [int(v * 0.19) for v in subtotals]
    totals = [subtotals[i] + ivas[i] for i in range(5)]
    total_semana = totals[semana - 1]

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, topMargin=20, bottomMargin=20, leftMargin=40, rightMargin=40)
    elements = []

    elements.extend(_build_header(seller.nombre, mes, anio, total_semana, is_seller=True))

    def _row(label, key, is_clp=True):
        vals = [weekly.get(s, {}).get(key, 0) for s in range(1, 6)]
        total = sum(vals)
        if is_clp:
            return [label] + [_fmt(v) for v in vals] + [_fmt(total)]
        return [label] + [str(v) for v in vals] + [str(total)]

    rows = [
        _row("Monto", "monto"),
        _row("Envíos", "envios", False),
        _row("Bultos Extra", "bultos_extra"),
        _row("Extra Manual", "cobro_extra_manual"),
        _row("Retiros", "retiros"),
        _row("Peso Extra", "peso_extra"),
        _row("Ajustes", "ajustes"),
        ["Subtotal"] + [_fmt(v) for v in subtotals] + [_fmt(sum(subtotals))],
        ["IVA"] + [_fmt(v) for v in ivas] + [_fmt(sum(ivas))],
        ["Total"] + [_fmt(v) for v in totals] + [_fmt(sum(totals))],
    ]

    elements.append(_weekly_table(rows))
    elements.append(Spacer(1, 14))
    elements.append(_footer_message())
    elements.append(Spacer(1, 10))

    if daily_data is None:
        from app.api.liquidacion import _daily_breakdown
        envios_semana = db.query(Envio).filter(
            Envio.seller_id == seller_id, Envio.semana == semana,
            Envio.mes == mes, Envio.anio == anio,
        ).order_by(Envio.fecha_entrega).all()
        daily_data = _daily_breakdown(
            envios_semana, [],
            "extra_producto_seller", "extra_comuna_seller",
            semana, mes, anio, is_seller=True, db=db, seller=seller,
        )

    if daily_data:
        daily_cols = [
            ("Día", "fecha", "date"),
            ("Envíos", "envios", "int"),
            ("Bultos Extra", "bultos_extra", "clp"),
            ("Peso Extra", "peso_extra", "clp"),
            ("Cobro", "monto", "clp"),
        ]
        elements.append(_daily_table(daily_data, daily_cols))
        elements.append(Spacer(1, 10))
        elements.append(_weekly_chart(daily_data, "envios"))

    elements.append(Spacer(1, 14))
    elements.append(_company_footer())

    doc.build(elements)
    return buffer.getvalue()


# ──────────────────────────────────────────────────────────
#  DRIVER PDF
# ──────────────────────────────────────────────────────────

def generar_pdf_driver(
    db: Session, driver_id: int, semana: int, mes: int, anio: int,
    weekly_data: dict = None, daily_data: list = None,
) -> bytes:
    """
    Genera PDF de liquidación de un driver.
    Si weekly_data y daily_data se pasan, los usa directamente (misma fuente
    que la vista web). Si no, los calcula internamente como fallback.
    """
    driver = db.get(Driver, driver_id)
    if not driver:
        raise ValueError("Driver no encontrado")

    if weekly_data is None:
        from app.api.liquidacion import _driver_detail
        detail = _driver_detail(db, driver_id, mes, anio)
        weekly_data = detail["weekly"]

    weekly = weekly_data

    def _weekly_total(s):
        w = weekly.get(s, {})
        return (
            (w.get("normal_total", 0)) + (w.get("oviedo_total", 0)) + (w.get("tercerizado_total", 0))
            + (w.get("valparaiso_total", 0)) + (w.get("melipilla_total", 0))
            + (w.get("comuna", 0)) + (w.get("bultos_extra", 0)) + (w.get("retiros", 0))
            + (w.get("bonificaciones", 0)) + (w.get("descuentos", 0))
        )

    total_semana = _weekly_total(semana)

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, topMargin=20, bottomMargin=20, leftMargin=40, rightMargin=40)
    elements = []

    elements.extend(_build_header(driver.nombre, mes, anio, total_semana, is_seller=False))

    tarifa_oviedo = driver.tarifa_oviedo
    tarifa_terc = driver.tarifa_tercerizado
    tarifa_valp = getattr(driver, 'tarifa_valparaiso', 0)
    tarifa_meli = getattr(driver, 'tarifa_melipilla', 0)

    def _count_row(label, key):
        vals = [weekly.get(s, {}).get(key, 0) for s in range(1, 6)]
        return [label] + [str(v) for v in vals] + [str(sum(vals))]

    def _money_row(label, key):
        vals = [weekly.get(s, {}).get(key, 0) for s in range(1, 6)]
        return [label] + [_fmt(v) for v in vals] + [_fmt(sum(vals))]

    def _has_data(key):
        return any(weekly.get(s, {}).get(key, 0) != 0 for s in range(1, 6))

    totals_vals = [_weekly_total(s) for s in range(1, 6)]

    es_contratado = getattr(driver, 'contratado', False)
    rows = [
        _count_row("General", "normal_count"),
        _money_row("Subtotal Normal", "normal_total"),
    ]
    if tarifa_oviedo or _has_data("oviedo_count"):
        rows.append(_count_row(f"Oviedo ({_fmt(tarifa_oviedo)})", "oviedo_count"))
        rows.append(_money_row("Subtotal Oviedo", "oviedo_total"))
    if tarifa_terc or _has_data("tercerizado_count"):
        rows.append(_count_row(f"Tercerizado ({_fmt(tarifa_terc)})", "tercerizado_count"))
        rows.append(_money_row("Subtotal Tercerizado", "tercerizado_total"))
    if tarifa_valp or _has_data("valparaiso_count"):
        rows.append(_count_row(f"Valparaíso ({_fmt(tarifa_valp)})", "valparaiso_count"))
        rows.append(_money_row("Subtotal Valparaíso", "valparaiso_total"))
    if tarifa_meli or _has_data("melipilla_count"):
        rows.append(_count_row(f"Melipilla ({_fmt(tarifa_meli)})", "melipilla_count"))
        rows.append(_money_row("Subtotal Melipilla", "melipilla_total"))
    if not es_contratado and _has_data("comuna"):
        rows.append(_money_row("Comuna", "comuna"))
    if not es_contratado and _has_data("bultos_extra"):
        rows.append(_money_row("Bultos Extra", "bultos_extra"))
    if _has_data("retiros"):
        rows.append(_money_row("Retiros", "retiros"))
    if _has_data("bonificaciones"):
        rows.append(_money_row("Bonificaciones", "bonificaciones"))
    if _has_data("descuentos"):
        rows.append(_money_row("Descuentos", "descuentos"))
    rows.append(["Total"] + [_fmt(v) for v in totals_vals] + [_fmt(sum(totals_vals))])

    elements.append(_weekly_table(rows))
    elements.append(Spacer(1, 14))
    elements.append(_footer_message())
    elements.append(Spacer(1, 6))
    elements.append(_driver_note())
    elements.append(Spacer(1, 10))

    if daily_data is None:
        from app.api.liquidacion import _daily_breakdown
        envios_semana = db.query(Envio).filter(
            Envio.driver_id == driver_id, Envio.semana == semana,
            Envio.mes == mes, Envio.anio == anio,
        ).order_by(Envio.fecha_entrega).all()
        retiros_semana = db.query(Retiro).filter(
            Retiro.driver_id == driver_id, Retiro.semana == semana,
            Retiro.mes == mes, Retiro.anio == anio,
        ).all()
        daily_data = _daily_breakdown(
            envios_semana, retiros_semana,
            "extra_producto_driver", "extra_comuna_driver",
            semana, mes, anio, is_seller=False, db=db,
            contratado=es_contratado, driver=driver,
        )

    if daily_data:
        daily_cols = [
            ("Día", "fecha", "date"),
            ("Envíos", "envios", "int"),
        ]
        if not es_contratado:
            daily_cols.append(("Bultos Extra", "bultos_extra", "clp"))
            daily_cols.append(("Comuna", "peso_extra", "clp"))
        daily_cols.append(("Retiros", "retiros", "clp"))
        daily_cols.append(("Pago", "monto", "clp"))
        elements.append(_daily_table(daily_data, daily_cols))
        elements.append(Spacer(1, 10))
        elements.append(_weekly_chart(daily_data, "envios"))

    elements.append(Spacer(1, 10))
    elements.append(_company_footer())

    doc.build(elements)
    return buffer.getvalue()


def _xml_esc(s: str) -> str:
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def generar_pdf_manual_calculo_remuneraciones(
    *,
    uf: Optional[float] = None,
    utm: Optional[int] = None,
    imm: Optional[int] = None,
    fecha_referencia: Optional[str] = None,
) -> bytes:
    """
    PDF técnico del motor de remuneraciones (Chile) para auditoría / contraste
    con otros sistemas. Contenido alineado con app.services.remuneraciones.
    """
    from app.services.remuneraciones import (
        TASAS_AFP,
        TABLA_IUSC,
        TOPE_IMPONIBLE_AFP_UF,
        TOPE_IMPONIBLE_CESANTIA_UF,
        VALOR_UF as _UF_DEF,
        UTM as _UTM_DEF,
        IMM as _IMM_DEF,
        SIS_EMPLEADOR,
        CESANTIA_EMPLEADOR_INDEFINIDO,
        CESANTIA_EMPLEADOR_PLAZO_FIJO,
        MUTUAL_BASE,
    )

    uf_v = float(uf if uf is not None else _UF_DEF)
    utm_v = int(utm if utm is not None else _UTM_DEF)
    imm_v = int(imm if imm is not None else _IMM_DEF)
    tope_afp_pesos = round(TOPE_IMPONIBLE_AFP_UF * uf_v)
    tope_ces_pesos = round(TOPE_IMPONIBLE_CESANTIA_UF * uf_v)
    tope_grat = round(4.75 * imm_v / 12)

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=48,
        leftMargin=48,
        topMargin=48,
        bottomMargin=48,
        title="Manual cálculo remuneraciones Chile",
    )
    story: list = []

    st_title = ParagraphStyle(
        "mt_manual", fontName=FONT_BOLD, fontSize=15, alignment=TA_CENTER,
        textColor=BLUE_DARK, spaceAfter=6,
    )
    st_sub = ParagraphStyle(
        "ms_manual", fontName=FONT, fontSize=9, alignment=TA_CENTER,
        textColor=GRAY_TEXT, spaceAfter=14,
    )
    st_h2 = ParagraphStyle(
        "mh2_manual", fontName=FONT_BOLD, fontSize=11, textColor=BLUE_MID,
        spaceBefore=12, spaceAfter=6,
    )
    st_body = ParagraphStyle(
        "mb_manual", fontName=FONT, fontSize=8.5, leading=11, alignment=TA_LEFT,
    )

    story.append(Paragraph(_xml_esc("Manual de cálculo — Remuneraciones Chile"), st_title))
    story.append(Paragraph(
        _xml_esc(
            "E-Courier · Motor Capa A (forward) + Capa B (búsqueda binaria) · "
            "Para contraste con otros sistemas"
        ),
        st_sub,
    ))
    ref = fecha_referencia or datetime.now().strftime("%d-%m-%Y %H:%M")
    story.append(Paragraph(
        _xml_esc(
            f"Valores de referencia en este documento: UF ${uf_v:,.2f} · UTM ${utm_v:,} · "
            f"IMM ${imm_v:,} · Generado {ref}"
        ).replace(",", "."),
        st_body,
    ))
    story.append(Spacer(1, 10))

    story.append(Paragraph("1. Parámetros de entrada (admin)", st_h2))
    story.append(Paragraph(
        _xml_esc(
            "• sueldo_liquido: monto que recibe el trabajador en cuenta.<br/>"
            "• afp: nombre de la AFP.<br/>"
            "• sistema_salud: FONASA o ISAPRE.<br/>"
            "• monto_cotizacion_salud: solo Isapre, plan en UF (ej. 2,714).<br/>"
            "• tipo_contrato: INDEFINIDO o PLAZO_FIJO.<br/>"
            "• movilizacion, colacion, viaticos: asignaciones no imponibles."
        ),
        st_body,
    ))

    story.append(Paragraph("2. Parámetros legales dinámicos", st_h2))
    story.append(Paragraph(
        _xml_esc(
            "UF y UTM: obtenidos de mindicador.cl (BCCh / SII), cacheados en tabla "
            "parametros_mensuales. IMM: tabla interna por año (cambia por ley, típicamente enero)."
        ),
        st_body,
    ))

    story.append(Paragraph("3. Tasas AFP (obligatoria 10% + comisión)", st_h2))
    afp_rows = [["AFP", "Tasa total"]]
    for nombre, tasa in sorted(TASAS_AFP.items(), key=lambda x: x[0]):
        afp_rows.append([nombre, f"{tasa * 100:.2f}%"])
    t_afp = Table(afp_rows, colWidths=[140, 80])
    t_afp.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE_DARK),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("FONTNAME", (0, 0), (-1, 0), FONT_BOLD),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(t_afp)
    story.append(Spacer(1, 8))

    story.append(Paragraph("4. Topes imponibles (DL 3.500)", st_h2))
    story.append(Paragraph(
        _xml_esc(
            f"Tope AFP y salud: {TOPE_IMPONIBLE_AFP_UF} UF = ${tope_afp_pesos:,} (con UF de referencia).<br/>"
            f"Tope cesantía trabajador: {TOPE_IMPONIBLE_CESANTIA_UF} UF = ${tope_ces_pesos:,}."
        ).replace(",", "."),
        st_body,
    ))

    story.append(Paragraph("5. Gratificación legal (Art. 50 CT)", st_h2))
    story.append(Paragraph(
        _xml_esc(
            f"tope_grat_mensual = 4,75 × IMM / 12 = ${tope_grat:,} (con IMM de referencia).<br/>"
            "Si imponible/1,25 da gratificación ≤ tope: base = round(imponible/1,25), "
            "grat = round(base×0,25).<br/>"
            "Si gratificación supera el tope: grat = tope, base = imponible − tope."
        ).replace(",", "."),
        st_body,
    ))

    story.append(Paragraph("6. Capa A — Forward (bruto imponible → líquido)", st_h2))
    story.append(Paragraph(
        _xml_esc(
            "base_AFP = min(imponible, 90 UF × valor_UF) → desc_AFP = round(base_AFP × tasa_AFP).<br/>"
            "base_salud = min(imponible, 90 UF × valor_UF) → desc_salud_7% = round(base_salud × 7%).<br/>"
            "Isapre: plan_pesos = UF_plan × valor_UF → adicional_isapre = max(0, plan_pesos − desc_salud_7%).<br/>"
            "Cesantía: indefinido → min(imponible, 135,2 UF×UF) × 0,6%; plazo fijo → $0.<br/>"
            "base_tributable_IUSC = imponible − desc_AFP − desc_salud_7% − desc_cesantía "
            "(el adicional Isapre NO reduce la base tributable).<br/>"
            "total_descuentos = AFP + salud_7% + adicional_isapre + cesantía + IUSC.<br/>"
            "liquido_imponible = imponible − total_descuentos; líquido final = liquido_imponible + no imponibles."
        ),
        st_body,
    ))

    story.append(Paragraph("7. IUSC — Tabla progresiva (Circular SII)", st_h2))
    story.append(Paragraph(
        _xml_esc(
            "Fórmula por tramo: impuesto = max(0, round(base_tributable × factor − rebaja_utm × UTM)).<br/>"
            "base_utm = base_tributable / UTM; se elige el primer tramo donde base_utm ≤ tope_superior."
        ),
        st_body,
    ))
    iusc_header = ["Rango UTM (aprox.)", "Tope sup.", "Factor", "Rebaja (UTM)"]
    iusc_data = [iusc_header]
    prev_lo = 0.0
    for tope, factor, rebaja in TABLA_IUSC:
        if tope == float("inf"):
            rango = f">{prev_lo:.1f} UTM"
            tope_s = "∞"
        else:
            rango = f"{prev_lo:.1f} – {tope:.1f} UTM"
            tope_s = f"≤ {tope:.1f}"
            prev_lo = tope
        if factor == 0:
            fac_s = "Exento"
        else:
            fac_s = f"{factor * 100:.1f}%"
        iusc_data.append([rango, tope_s, fac_s, f"{rebaja:.3f}"])
    t_iusc = Table(iusc_data, colWidths=[118, 62, 52, 62])
    t_iusc.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE_DARK),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("FONTNAME", (0, 0), (-1, 0), FONT_BOLD),
        ("FONTSIZE", (0, 0), (-1, -1), 7.5),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(t_iusc)
    story.append(Spacer(1, 8))

    story.append(Paragraph("8. Capa B — Inverso (líquido pactado → imponible)", st_h2))
    story.append(Paragraph(
        _xml_esc(
            "Búsqueda binaria (hasta 64 iteraciones, tolerancia ±$1): "
            "low = líquido − no_imponibles; high = líquido × 3; "
            "en cada paso mid = (low+high)//2; se compara bruto_a_liquido(mid) con el objetivo."
        ),
        st_body,
    ))

    story.append(Paragraph("9. Costo empresa (aportes empleador)", st_h2))
    story.append(Paragraph(
        _xml_esc(
            f"SIS = imponible × {SIS_EMPLEADOR * 100:.2f}%. "
            f"Cesantía empleador: indefinido × {CESANTIA_EMPLEADOR_INDEFINIDO * 100:.1f}%, "
            f"plazo fijo × {CESANTIA_EMPLEADOR_PLAZO_FIJO * 100:.1f}%. "
            f"Mutual (tasa base) = imponible × {MUTUAL_BASE * 100:.2f}%.<br/>"
            "costo_empresa_total = imponible + no_imponibles + SIS + cesantía_empleador + mutual."
        ),
        st_body,
    ))

    story.append(Paragraph("10. Notas para contraste", st_h2))
    story.append(Paragraph(
        _xml_esc(
            "• Redondeo: montos en pesos chilenos enteros (round).<br/>"
            "• Si el otro sistema usa otra UF del día o UTM distinta del mes, habrá diferencias menores.<br/>"
            "• Tasa mutual puede variar según administradora (0,93% es tasa base referencial).<br/>"
            "• Endpoint de simulación: POST /api/trabajadores/simular-calculo"
        ),
        st_body,
    ))

    from app.services.remuneraciones import calcular_desde_liquido

    r700 = calcular_desde_liquido(
        700_000, "Capital", "FONASA", None, "INDEFINIDO", 0, 0, 0,
        utm=utm_v, valor_uf=uf_v, imm=imm_v,
    )
    r3m = calcular_desde_liquido(
        3_000_000, "Capital", "FONASA", None, "INDEFINIDO", 0, 0, 0,
        utm=utm_v, valor_uf=uf_v, imm=imm_v,
    )

    story.append(Paragraph("11. Ejemplos numéricos (AFP Capital, Fonasa, indefinido, sin no imponibles)", st_h2))
    ex_rows = [
        ["Concepto", "Líquido $700.000", "Líquido $3.000.000"],
        [
            "Imponible (bruto)",
            f"${r700.remuneracion_imponible:,}".replace(",", "."),
            f"${r3m.remuneracion_imponible:,}".replace(",", "."),
        ],
        ["AFP", f"${r700.descuento_afp:,}".replace(",", "."), f"${r3m.descuento_afp:,}".replace(",", ".")],
        ["Salud 7%", f"${r700.descuento_salud_legal:,}".replace(",", "."), f"${r3m.descuento_salud_legal:,}".replace(",", ".")],
        ["Cesantía 0,6%", f"${r700.descuento_cesantia:,}".replace(",", "."), f"${r3m.descuento_cesantia:,}".replace(",", ".")],
        ["IUSC", f"${r700.iusc:,}".replace(",", "."), f"${r3m.iusc:,}".replace(",", ".")],
        [
            "Líquido verificado",
            f"${r700.liquido_verificado:,}".replace(",", "."),
            f"${r3m.liquido_verificado:,}".replace(",", "."),
        ],
    ]
    t_ex = Table(ex_rows, colWidths=[150, 125, 125])
    t_ex.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BLUE_DARK),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("FONTNAME", (0, 0), (-1, 0), FONT_BOLD),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(t_ex)

    story.append(Spacer(1, 14))
    story.append(Paragraph(
        _xml_esc(
            "E-Courier SPA — Documento generado automáticamente desde el código del motor "
            "de remuneraciones."
        ),
        ParagraphStyle(
            "mf_manual", fontName=FONT, fontSize=7, textColor=GRAY_TEXT, alignment=TA_CENTER,
        ),
    ))

    doc.build(story)
    return buffer.getvalue()


# ── Liquidación mensual de sueldo (formato oficial chileno) ───────────────────

def _fmt_mes_anio(mes: int, anio: int) -> str:
    return f"{MESES[mes].capitalize()} {anio}"


def _fmt_rut(rut: Optional[str]) -> str:
    return rut or "—"


def _fmt_date(d) -> str:
    if not d:
        return "—"
    if isinstance(d, str):
        return d
    try:
        return d.strftime("%d/%m/%Y")
    except Exception:
        return str(d)


def generar_pdf_liquidacion(liquidacion, trabajador) -> bytes:
    """
    Genera la liquidación de sueldo mensual oficial (formato chileno).

    Args:
        liquidacion: ORM LiquidacionMensual
        trabajador: ORM Trabajador
    Returns:
        bytes del PDF generado
    """
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        leftMargin=40, rightMargin=40,
        topMargin=40, bottomMargin=40,
    )

    story = []

    # ── Encabezado empresa + datos trabajador ─────────────────────────────────
    logo_cell = ""
    if os.path.exists(LOGO_PATH):
        logo_cell = RLImage(LOGO_PATH, width=90, height=30)

    empresa_block = [
        Paragraph("E-Courier SPA", ParagraphStyle("emp_h", fontName=FONT_BOLD, fontSize=12, textColor=BLUE_DARK)),
        Paragraph("RUT: 77.XXX.XXX-X", ParagraphStyle("emp_s", fontName=FONT, fontSize=8, textColor=GRAY_TEXT)),
        Paragraph("Av. Ejemplo 123, Santiago", ParagraphStyle("emp_s2", fontName=FONT, fontSize=8, textColor=GRAY_TEXT)),
    ]

    mes_anio_str = _fmt_mes_anio(liquidacion.mes, liquidacion.anio)
    titulo_block = [
        Paragraph("LIQUIDACIÓN DE SUELDO", ParagraphStyle("lt", fontName=FONT_BOLD, fontSize=13, textColor=WHITE, alignment=TA_CENTER)),
        Paragraph(mes_anio_str.upper(), ParagraphStyle("lm", fontName=FONT_BOLD, fontSize=10, textColor=YELLOW_BG, alignment=TA_CENTER)),
    ]

    header_table = Table(
        [[logo_cell, empresa_block, titulo_block]],
        colWidths=[100, 220, 215],
    )
    header_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BACKGROUND", (2, 0), (2, 0), BLUE_DARK),
        ("ROUNDEDCORNERS", [4, 4, 4, 4]),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (2, 0), (2, 0), 10),
        ("RIGHTPADDING", (2, 0), (2, 0), 10),
    ]))
    story.append(header_table)
    story.append(Spacer(1, 10))

    # ── Datos del trabajador ──────────────────────────────────────────────────
    st_label = ParagraphStyle("lbl", fontName=FONT_BOLD, fontSize=8, textColor=GRAY_TEXT)
    st_value = ParagraphStyle("val", fontName=FONT, fontSize=9, textColor=BLUE_DARK)

    def _cell(label, value):
        return [Paragraph(label, st_label), Paragraph(str(value) if value else "—", st_value)]

    cargo = trabajador.cargo or "—"
    tipo_contrato = (trabajador.tipo_contrato or "—").replace("_", " ").title()
    afp = trabajador.afp or "—"
    salud = trabajador.sistema_salud or "FONASA"
    fecha_ingreso = _fmt_date(trabajador.fecha_ingreso)
    rut = _fmt_rut(trabajador.rut)

    worker_data = [
        [_cell("NOMBRE", trabajador.nombre), _cell("RUT", rut)],
        [_cell("CARGO", cargo), _cell("TIPO CONTRATO", tipo_contrato)],
        [_cell("AFP", afp), _cell("SISTEMA DE SALUD", salud)],
        [_cell("FECHA INGRESO", fecha_ingreso), _cell("PERÍODO LIQUIDACIÓN", mes_anio_str)],
    ]

    flat_rows = []
    for row in worker_data:
        flat_rows.append([row[0][0], row[0][1], row[1][0], row[1][1]])

    t_worker = Table(flat_rows, colWidths=[90, 140, 90, 145])
    t_worker.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#c7d6e8")),
        ("BACKGROUND", (0, 0), (-1, -1), BLUE_LIGHT),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("LINEABOVE", (0, 0), (-1, 0), 0.5, colors.HexColor("#c7d6e8")),
        ("LINEBELOW", (0, -1), (-1, -1), 0.5, colors.HexColor("#c7d6e8")),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#d0dff0")),
    ]))
    story.append(t_worker)
    story.append(Spacer(1, 10))

    # ── Haberes ───────────────────────────────────────────────────────────────
    st_th = ParagraphStyle("th", fontName=FONT_BOLD, fontSize=9, textColor=WHITE)
    st_td = ParagraphStyle("td", fontName=FONT, fontSize=9, textColor=BLUE_DARK)
    st_td_r = ParagraphStyle("tdr", fontName=FONT, fontSize=9, textColor=BLUE_DARK, alignment=TA_RIGHT)
    st_total_lbl = ParagraphStyle("ttl", fontName=FONT_BOLD, fontSize=9, textColor=BLUE_DARK)
    st_total_val = ParagraphStyle("ttv", fontName=FONT_BOLD, fontSize=9, textColor=BLUE_DARK, alignment=TA_RIGHT)

    haberes_rows = [
        [Paragraph("HABERES", st_th), Paragraph("MONTO", st_th)],
        [Paragraph("Sueldo Base", st_td), Paragraph(_fmt(liquidacion.sueldo_base), st_td_r)],
        [Paragraph("Gratificación Legal (Art. 50 CT)", st_td), Paragraph(_fmt(liquidacion.gratificacion), st_td_r)],
    ]
    if liquidacion.movilizacion:
        haberes_rows.append([Paragraph("Movilización (no imponible)", st_td), Paragraph(_fmt(liquidacion.movilizacion), st_td_r)])
    if liquidacion.colacion:
        haberes_rows.append([Paragraph("Colación (no imponible)", st_td), Paragraph(_fmt(liquidacion.colacion), st_td_r)])
    if liquidacion.viaticos:
        haberes_rows.append([Paragraph("Viáticos (no imponible)", st_td), Paragraph(_fmt(liquidacion.viaticos), st_td_r)])
    total_bruto_display = liquidacion.remuneracion_imponible + liquidacion.movilizacion + liquidacion.colacion + liquidacion.viaticos
    haberes_rows.append([Paragraph("TOTAL HABERES", st_total_lbl), Paragraph(_fmt(total_bruto_display), st_total_val)])

    t_hab = Table(haberes_rows, colWidths=[380, 155])
    t_hab_style = [
        ("BACKGROUND", (0, 0), (-1, 0), BLUE_MID),
        ("BACKGROUND", (0, -1), (-1, -1), BLUE_LIGHT),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#c7d6e8")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("FONTNAME", (0, -1), (-1, -1), FONT_BOLD),
        ("LINEABOVE", (0, -1), (-1, -1), 1.0, BLUE_MID),
    ]
    for i in range(1, len(haberes_rows) - 1):
        if i % 2 == 0:
            t_hab_style.append(("BACKGROUND", (0, i), (-1, i), ROW_ALT))
    t_hab.setStyle(TableStyle(t_hab_style))
    story.append(t_hab)
    story.append(Spacer(1, 6))

    # ── Descuentos ────────────────────────────────────────────────────────────
    tasa_afp_str = ""
    if trabajador.afp:
        from app.services.remuneraciones import TASAS_AFP, AFP_DEFAULT_TASA
        tasa_val = TASAS_AFP.get(trabajador.afp, AFP_DEFAULT_TASA)
        tasa_afp_str = f" ({tasa_val*100:.2f}%)"

    descuentos_rows = [
        [Paragraph("DESCUENTOS", st_th), Paragraph("MONTO", st_th)],
        [Paragraph(f"AFP {trabajador.afp or ''}{tasa_afp_str}", st_td), Paragraph(_fmt(liquidacion.descuento_afp), st_td_r)],
        [Paragraph("Salud Legal 7%", st_td), Paragraph(_fmt(liquidacion.descuento_salud_legal), st_td_r)],
    ]
    if liquidacion.adicional_isapre:
        descuentos_rows.append([Paragraph(f"Adicional Isapre ({trabajador.sistema_salud or ''})", st_td), Paragraph(_fmt(liquidacion.adicional_isapre), st_td_r)])
    if liquidacion.descuento_cesantia:
        descuentos_rows.append([Paragraph("Seguro de Cesantía (0,6%)", st_td), Paragraph(_fmt(liquidacion.descuento_cesantia), st_td_r)])
    else:
        descuentos_rows.append([Paragraph("Seguro de Cesantía (Plazo Fijo: 0%)", st_td), Paragraph(_fmt(0), st_td_r)])
    if liquidacion.iusc:
        descuentos_rows.append([Paragraph("Imp. Único 2ª Categoría (IUSC)", st_td), Paragraph(_fmt(liquidacion.iusc), st_td_r)])
    descuentos_rows.append([Paragraph("TOTAL DESCUENTOS", st_total_lbl), Paragraph(_fmt(liquidacion.total_descuentos), st_total_val)])

    t_desc = Table(descuentos_rows, colWidths=[380, 155])
    t_desc_style = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#c0392b")),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#fde8e8")),
        ("TEXTCOLOR", (0, -1), (-1, -1), colors.HexColor("#c0392b")),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#f0c0c0")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("FONTNAME", (0, -1), (-1, -1), FONT_BOLD),
        ("LINEABOVE", (0, -1), (-1, -1), 1.0, colors.HexColor("#c0392b")),
    ]
    for i in range(1, len(descuentos_rows) - 1):
        if i % 2 == 0:
            t_desc_style.append(("BACKGROUND", (0, i), (-1, i), ROW_ALT))
    t_desc.setStyle(TableStyle(t_desc_style))
    story.append(t_desc)
    story.append(Spacer(1, 6))

    # ── Aportes empleador (informativo) ───────────────────────────────────────
    st_th_g = ParagraphStyle("thg", fontName=FONT_BOLD, fontSize=9, textColor=WHITE)
    st_td_g = ParagraphStyle("tdg", fontName=FONT, fontSize=8, textColor=GRAY_TEXT)
    st_td_gr = ParagraphStyle("tdgr", fontName=FONT, fontSize=8, textColor=GRAY_TEXT, alignment=TA_RIGHT)

    aportes_rows = [
        [Paragraph("APORTES EMPLEADOR (informativos, no afectan líquido)", st_th_g), Paragraph("MONTO", st_th_g)],
        [Paragraph("SIS — Seguro Invalidez y Sobrevivencia (1,54%)", st_td_g), Paragraph(_fmt(liquidacion.costo_sis), st_td_gr)],
        [Paragraph("AFC — Cesantía Empleador (2,4% / 3,0% plazo fijo)", st_td_g), Paragraph(_fmt(liquidacion.costo_cesantia_empleador), st_td_gr)],
        [Paragraph("Mutual — Accidentes del Trabajo (0,93%)", st_td_g), Paragraph(_fmt(liquidacion.costo_mutual), st_td_gr)],
        [Paragraph("COSTO TOTAL EMPRESA (bruto + aportes)", st_total_lbl), Paragraph(_fmt(liquidacion.costo_empresa_total), st_total_val)],
    ]

    t_aportes = Table(aportes_rows, colWidths=[380, 155])
    t_aportes.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#5a6a7a")),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#f0f0f0")),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cccccc")),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("FONTNAME", (0, -1), (-1, -1), FONT_BOLD),
        ("LINEABOVE", (0, -1), (-1, -1), 1.0, colors.HexColor("#777777")),
    ]))
    story.append(t_aportes)
    story.append(Spacer(1, 10))

    # ── Monto líquido a pagar ─────────────────────────────────────────────────
    st_liq_lbl = ParagraphStyle("llbl", fontName=FONT_BOLD, fontSize=14, textColor=WHITE, alignment=TA_LEFT)
    st_liq_val = ParagraphStyle("lval", fontName=FONT_BOLD, fontSize=16, textColor=YELLOW_BG, alignment=TA_RIGHT)

    liquido_row = Table(
        [[Paragraph("LÍQUIDO A PAGAR", st_liq_lbl), Paragraph(_fmt(liquidacion.sueldo_liquido), st_liq_val)]],
        colWidths=[380, 155],
    )
    liquido_row.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), BLUE_DARK),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("ROUNDEDCORNERS", [4, 4, 4, 4]),
        ("BOX", (0, 0), (-1, -1), 1, BLUE_MID),
    ]))
    story.append(liquido_row)
    story.append(Spacer(1, 8))

    # ── Parámetros legales utilizados ─────────────────────────────────────────
    uf_str = f"${float(liquidacion.uf_usada):,.2f}".replace(",", ".") if liquidacion.uf_usada else "—"
    utm_str = _fmt(liquidacion.utm_usado) if liquidacion.utm_usado else "—"
    imm_str = _fmt(liquidacion.imm_usado) if liquidacion.imm_usado else "—"
    fuente_str = "mindicador.cl" if liquidacion.parametros_id else "fallback"

    st_foot = ParagraphStyle("foot", fontName=FONT, fontSize=7, textColor=GRAY_TEXT)
    story.append(Paragraph(
        f"Parámetros legales {mes_anio_str}: UF {uf_str} · UTM {utm_str} · IMM {imm_str} · Fuente: {fuente_str}",
        st_foot,
    ))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        "Documento generado automáticamente por el sistema de remuneraciones E-Courier SPA. "
        f"Generado el {date.today().strftime('%d/%m/%Y')}.",
        st_foot,
    ))

    doc.build(story)
    return buffer.getvalue()
