"""
Generador de PDFs de liquidación para sellers y drivers.
Formato: logo + encabezado, resumen semanal (5 columnas), desglose diario,
gráfico mensual de envíos, footer motivacional.
"""
import io
import os
from datetime import datetime, date

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
