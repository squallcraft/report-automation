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


def generar_pdf_liquidacion(
    liquidacion,
    trabajador,
    descuentos_adicionales: Optional[list] = None,
) -> bytes:
    """
    Genera la liquidación de sueldo mensual oficial (formato chileno).

    Args:
        liquidacion: ORM LiquidacionMensual (o dataclass-like con los mismos campos)
        trabajador:  ORM Trabajador
        descuentos_adicionales: lista de dicts con {concepto, monto} para préstamos y ajustes
                                negativos. Ej: [{"concepto": "Cuota Préstamo", "monto": 100000}]
    Returns:
        bytes del PDF generado
    """
    # ── Paleta de colores (tema claro, secciones en color uniforme) ──────────
    # Haberes → azul
    C_BLUE_H   = colors.HexColor("#1d4ed8")   # header haberes
    C_BLUE_R1  = colors.HexColor("#eff6ff")   # fila impar
    C_BLUE_R2  = colors.HexColor("#dbeafe")   # fila par
    C_BLUE_TOT = colors.HexColor("#bfdbfe")   # fila total haberes
    C_BLUE_TXT = colors.HexColor("#1e3a8a")   # texto total haberes

    # Descuentos → rojo
    C_RED_H    = colors.HexColor("#b91c1c")   # header descuentos
    C_RED_R1   = colors.HexColor("#fff1f2")   # fila impar
    C_RED_R2   = colors.HexColor("#fee2e2")   # fila par
    C_RED_TOT  = colors.HexColor("#fecaca")   # fila total descuentos
    C_RED_TXT  = colors.HexColor("#991b1b")   # texto total descuentos

    # Adicionales → morado
    C_PUR_H    = colors.HexColor("#6d28d9")   # header adicionales
    C_PUR_R1   = colors.HexColor("#f5f3ff")   # fila impar
    C_PUR_R2   = colors.HexColor("#ede9fe")   # fila par
    C_PUR_TOT  = colors.HexColor("#ddd6fe")   # fila total adicionales
    C_PUR_TXT  = colors.HexColor("#4c1d95")   # texto total adicionales

    # Globals
    C_WHITE    = colors.white
    C_DARK_NAV = colors.HexColor("#003c72")   # header y barra final (= fondo del logo)
    C_YELLOW   = colors.HexColor("#fbbf24")   # monto final
    C_GRAY_TXT = colors.HexColor("#64748b")   # texto secundario/labels
    C_BORDER   = colors.HexColor("#cbd5e1")   # bordes generales
    C_CARD_BG  = colors.HexColor("#f8fafc")   # fondo datos trabajador

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        leftMargin=40, rightMargin=40,
        topMargin=38, bottomMargin=38,
    )

    story = []
    C1 = 385   # ancho columna concepto
    C2 = 111   # ancho columna monto  (535 - 40*2 = 455 útil... ajusto)
    # letter = 612 pt, márgenes 40 c/u → útil = 532
    C1 = 382
    C2 = 150

    mes_anio_str = _fmt_mes_anio(liquidacion.mes, liquidacion.anio)

    # ── Estilos generales ─────────────────────────────────────────────────────
    def _st(name, font=FONT, size=9, color=colors.black, align=TA_LEFT):
        return ParagraphStyle(name, fontName=font, fontSize=size,
                              textColor=color, alignment=align)

    st_th_w  = _st("thw",  FONT_BOLD, 9,  C_WHITE)
    st_th_wr = _st("thwr", FONT_BOLD, 9,  C_WHITE, TA_RIGHT)
    st_lbl   = _st("lbl",  FONT_BOLD, 7,  C_GRAY_TXT)
    st_val   = _st("val",  FONT,      9,  colors.HexColor("#1e293b"))
    st_foot  = _st("foot", FONT,      7,  C_GRAY_TXT)

    # ── Header ────────────────────────────────────────────────────────────────
    if os.path.exists(LOGO_PATH):
        logo_img = RLImage(LOGO_PATH, width=140, height=32)
    else:
        logo_img = Paragraph("E-COURIER SPA",
                              _st("lfb", FONT_BOLD, 14, C_BLUE_TXT))

    hdr = Table(
        [[logo_img,
          Paragraph("", st_lbl),
          [Paragraph("LIQUIDACIÓN DE SUELDO",
                     _st("lt", FONT_BOLD, 11, C_WHITE, TA_RIGHT)),
           Paragraph(mes_anio_str.upper(),
                     _st("lm", FONT_BOLD, 13, C_YELLOW, TA_RIGHT))]]],
        colWidths=[160, 180, 192],
    )
    hdr.setStyle(TableStyle([
        ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
        ("BACKGROUND",   (0, 0), (-1, -1), C_DARK_NAV),
        ("TOPPADDING",   (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 10),
        ("LEFTPADDING",  (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
    ]))
    story.append(hdr)
    story.append(Spacer(1, 8))

    # ── Datos del trabajador ──────────────────────────────────────────────────
    cargo         = trabajador.cargo or "—"
    tipo_contrato = (trabajador.tipo_contrato or "—").replace("_", " ").title()
    afp           = trabajador.afp or "—"
    salud         = trabajador.sistema_salud or "FONASA"
    rut           = _fmt_rut(trabajador.rut)
    fecha_ingreso = _fmt_date(trabajador.fecha_ingreso)

    def _wrow(l1, v1, l2, v2):
        return [
            Paragraph(l1, st_lbl),
            Paragraph(str(v1) if v1 else "—", st_val),
            Paragraph(l2, st_lbl),
            Paragraph(str(v2) if v2 else "—", st_val),
        ]

    flat_rows = []
    for l1, v1, l2, v2 in [
        ("NOMBRE",        trabajador.nombre,  "RUT",              rut),
        ("CARGO",         cargo,              "TIPO CONTRATO",    tipo_contrato),
        ("AFP",           afp,                "SISTEMA DE SALUD", salud),
        ("FECHA INGRESO", fecha_ingreso,      "PERÍODO",          mes_anio_str),
    ]:
        flat_rows.append([
            Paragraph(l1, st_lbl),
            Paragraph(str(v1) if v1 else "—", st_val),
            Paragraph(l2, st_lbl),
            Paragraph(str(v2) if v2 else "—", st_val),
        ])

    t_worker = Table(flat_rows, colWidths=[78, 194, 78, 182])
    t_worker.setStyle(TableStyle([
        ("BACKGROUND",   (0, 0), (-1, -1), C_CARD_BG),
        ("BOX",          (0, 0), (-1, -1), 0.8, C_BORDER),
        ("INNERGRID",    (0, 0), (-1, -1), 0.4, C_BORDER),
        ("TOPPADDING",   (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 4),
        ("LEFTPADDING",  (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(t_worker)
    story.append(Spacer(1, 10))

    # ── Helper: tabla de 2 col con esquema de color uniforme ─────────────────
    def _color_table(rows, h_color, r1, r2, tot_bg, tot_txt):
        """
        rows[0]  = header (texto blanco sobre h_color)
        rows[1:-1] = cuerpo alternando r1/r2
        rows[-1] = total (tot_txt sobre tot_bg)
        """
        t = Table(rows, colWidths=[C1, C2])
        s = [
            ("BACKGROUND",    (0,  0), (-1,  0), h_color),
            ("BACKGROUND",    (0, -1), (-1, -1), tot_bg),
            ("GRID",          (0,  0), (-1, -1), 0.5, C_BORDER),
            ("TOPPADDING",    (0,  0), (-1, -1), 5),
            ("BOTTOMPADDING", (0,  0), (-1, -1), 5),
            ("LEFTPADDING",   (0,  0), (-1, -1), 10),
            ("RIGHTPADDING",  (0,  0), (-1, -1), 10),
            ("LINEABOVE",     (0, -1), (-1, -1), 1.5, h_color),
        ]
        for i in range(1, len(rows) - 1):
            s.append(("BACKGROUND", (0, i), (-1, i), r1 if i % 2 != 0 else r2))
        t.setStyle(TableStyle(s))
        return t

    # ── Haberes ───────────────────────────────────────────────────────────────
    no_imp      = (liquidacion.movilizacion or 0) + (liquidacion.colacion or 0) + (liquidacion.viaticos or 0)
    total_bruto = (liquidacion.remuneracion_imponible or 0) + no_imp

    st_td_b  = _st("tdb",  FONT, 9, C_BLUE_TXT)
    st_td_br = _st("tdbr", FONT, 9, C_BLUE_TXT, TA_RIGHT)

    hab_rows = [
        [Paragraph("HABERES", st_th_w),                  Paragraph("MONTO", st_th_wr)],
        [Paragraph("Sueldo Base", st_td_b),               Paragraph(_fmt(liquidacion.sueldo_base or 0), st_td_br)],
        [Paragraph("Gratificación Legal (Art. 50 CT)", st_td_b), Paragraph(_fmt(liquidacion.gratificacion or 0), st_td_br)],
    ]
    if liquidacion.movilizacion:
        hab_rows.append([Paragraph("Movilización (no imponible)", st_td_b), Paragraph(_fmt(liquidacion.movilizacion), st_td_br)])
    if liquidacion.colacion:
        hab_rows.append([Paragraph("Colación (no imponible)", st_td_b), Paragraph(_fmt(liquidacion.colacion), st_td_br)])
    if liquidacion.viaticos:
        hab_rows.append([Paragraph("Viáticos (no imponible)", st_td_b), Paragraph(_fmt(liquidacion.viaticos), st_td_br)])
    hab_rows.append([Paragraph("TOTAL HABERES", _st("thab", FONT_BOLD, 9, C_BLUE_TXT)),
                     Paragraph(_fmt(total_bruto), _st("thabr", FONT_BOLD, 9, C_BLUE_TXT, TA_RIGHT))])

    story.append(_color_table(hab_rows, C_BLUE_H, C_BLUE_R1, C_BLUE_R2, C_BLUE_TOT, C_BLUE_TXT))
    story.append(Spacer(1, 6))

    # ── Descuentos legales ────────────────────────────────────────────────────
    tasa_afp_str = ""
    if trabajador.afp:
        from app.services.remuneraciones import TASAS_AFP, AFP_DEFAULT_TASA
        tasa_val = TASAS_AFP.get(trabajador.afp, AFP_DEFAULT_TASA)
        tasa_afp_str = f" ({tasa_val*100:.2f}%)"

    st_td_r  = _st("tdr",  FONT, 9, C_RED_TXT)
    st_td_rr = _st("tdrr", FONT, 9, C_RED_TXT, TA_RIGHT)

    desc_rows = [
        [Paragraph("DESCUENTOS LEGALES", st_th_w),                                 Paragraph("MONTO", st_th_wr)],
        [Paragraph(f"AFP {trabajador.afp or ''}{tasa_afp_str}", st_td_r),           Paragraph(_fmt(liquidacion.descuento_afp or 0), st_td_rr)],
        [Paragraph("Salud Legal 7%", st_td_r),                                     Paragraph(_fmt(liquidacion.descuento_salud_legal or 0), st_td_rr)],
    ]
    if liquidacion.adicional_isapre:
        desc_rows.append([
            Paragraph(f"Adicional Isapre ({trabajador.sistema_salud or ''})", st_td_r),
            Paragraph(_fmt(liquidacion.adicional_isapre), st_td_rr),
        ])
    desc_rows.append([
        Paragraph("Seguro de Cesantía (0,6%)" if liquidacion.descuento_cesantia else "Seguro de Cesantía (Plazo Fijo: 0%)", st_td_r),
        Paragraph(_fmt(liquidacion.descuento_cesantia or 0), st_td_rr),
    ])
    if liquidacion.iusc:
        desc_rows.append([Paragraph("Imp. Único 2ª Categoría (IUSC)", st_td_r), Paragraph(_fmt(liquidacion.iusc), st_td_rr)])
    desc_rows.append([Paragraph("TOTAL DESCUENTOS LEGALES", _st("tdesc", FONT_BOLD, 9, C_RED_TXT)),
                      Paragraph(_fmt(liquidacion.total_descuentos or 0), _st("tdescr", FONT_BOLD, 9, C_RED_TXT, TA_RIGHT))])

    story.append(_color_table(desc_rows, C_RED_H, C_RED_R1, C_RED_R2, C_RED_TOT, C_RED_TXT))
    story.append(Spacer(1, 8))

    # ── Subtotal y descuentos adicionales ─────────────────────────────────────
    sueldo_liquido         = liquidacion.sueldo_liquido or 0
    total_desc_adicionales = sum(d.get("monto", 0) for d in (descuentos_adicionales or []))
    liquido_a_depositar    = max(0, sueldo_liquido - total_desc_adicionales)

    if descuentos_adicionales:
        # Subtotal: líquido legal (verde oscuro sobre fondo muy claro)
        C_GRN = colors.HexColor("#166534")
        sub = Table(
            [[Paragraph("LÍQUIDO LEGAL (sueldo – descuentos previsionales)",
                        _st("sbl", FONT_BOLD, 9, C_GRN)),
              Paragraph(_fmt(sueldo_liquido),
                        _st("sbr", FONT_BOLD, 9, C_GRN, TA_RIGHT))]],
            colWidths=[C1, C2],
        )
        sub.setStyle(TableStyle([
            ("BACKGROUND",    (0, 0), (-1, -1), colors.HexColor("#dcfce7")),
            ("BOX",           (0, 0), (-1, -1), 1.0, colors.HexColor("#16a34a")),
            ("TOPPADDING",    (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ("LEFTPADDING",   (0, 0), (-1, -1), 12),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 12),
        ]))
        story.append(sub)
        story.append(Spacer(1, 6))

        # Sección adicionales en morado
        st_td_p  = _st("tdp",  FONT, 9, C_PUR_TXT)
        st_td_pr = _st("tdpr", FONT, 9, C_PUR_TXT, TA_RIGHT)

        add_rows = [
            [Paragraph("DESCUENTOS ADICIONALES (préstamos y ajustes)", st_th_w),
             Paragraph("MONTO", st_th_wr)],
        ]
        for d in descuentos_adicionales:
            add_rows.append([
                Paragraph(d.get("concepto", "Descuento"), st_td_p),
                Paragraph(_fmt(d.get("monto", 0)), st_td_pr),
            ])
        add_rows.append([
            Paragraph("TOTAL DESCUENTOS ADICIONALES", _st("tadd", FONT_BOLD, 9, C_PUR_TXT)),
            Paragraph(_fmt(total_desc_adicionales), _st("taddr", FONT_BOLD, 9, C_PUR_TXT, TA_RIGHT)),
        ])
        story.append(_color_table(add_rows, C_PUR_H, C_PUR_R1, C_PUR_R2, C_PUR_TOT, C_PUR_TXT))
        story.append(Spacer(1, 8))

    # ── Monto final ───────────────────────────────────────────────────────────
    label_final = "LÍQUIDO A DEPOSITAR" if descuentos_adicionales else "LÍQUIDO A PAGAR"
    monto_final  = liquido_a_depositar   if descuentos_adicionales else sueldo_liquido

    fin = Table(
        [[Paragraph(label_final, _st("finl", FONT_BOLD, 12, C_WHITE)),
          Paragraph(_fmt(monto_final), _st("finv", FONT_BOLD, 18, C_YELLOW, TA_RIGHT))]],
        colWidths=[C1, C2],
    )
    fin.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), C_DARK_NAV),
        ("TOPPADDING",    (0, 0), (-1, -1), 13),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 13),
        ("LEFTPADDING",   (0, 0), (-1, -1), 14),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 14),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(fin)
    story.append(Spacer(1, 14))

    # ── Firmas ────────────────────────────────────────────────────────────────
    FIRMA_REP_PATH = os.path.join(
        os.path.dirname(os.path.dirname(__file__)), "assets", "firma_representante.png"
    )
    FIRMA_W, FIRMA_H = 110, 46   # tamaño de render de la firma en el PDF

    def _firma_cell(label_nombre, label_rut, firma_src, w=FIRMA_W, h=FIRMA_H):
        """Devuelve una lista de elementos [img_o_blank, nombre, rut] para una celda de firma."""
        st_firm_lbl = _st("flbl", FONT_BOLD, 7.5, C_GRAY_TXT, TA_CENTER)
        st_firm_rut = _st("frut", FONT,      7,   C_GRAY_TXT, TA_CENTER)
        elems = []
        if firma_src and os.path.exists(firma_src):
            elems.append(RLImage(firma_src, width=w, height=h))
        elif firma_src and firma_src.startswith("data:image"):
            # base64 data URL → bytes → BytesIO
            import base64
            header, b64data = firma_src.split(",", 1)
            img_bytes = base64.b64decode(b64data)
            elems.append(RLImage(io.BytesIO(img_bytes), width=w, height=h))
        else:
            # espacio en blanco del mismo tamaño
            from reportlab.platypus import Spacer as _Sp
            elems.append(_Sp(w, h))
        elems.append(Paragraph(label_nombre, st_firm_lbl))
        elems.append(Paragraph(label_rut,    st_firm_rut))
        return elems

    firma_rep   = _firma_cell(
        "Adriana Colina Aguilar — Representante Legal",
        "RUT 25.936.753-0",
        FIRMA_REP_PATH,
    )
    firma_trab  = _firma_cell(
        f"{trabajador.nombre}",
        f"RUT {_fmt_rut(trabajador.rut)}",
        getattr(trabajador, "firma_base64", None),
    )

    # Línea separadora bajo cada firma
    st_sep = _st("sep", FONT, 7, C_GRAY_TXT, TA_CENTER)

    firma_table = Table(
        [[firma_rep, firma_trab]],
        colWidths=[C1 // 2 + C2 // 2, C1 // 2 + C2 // 2],
    )
    firma_table.setStyle(TableStyle([
        ("VALIGN",       (0, 0), (-1, -1), "BOTTOM"),
        ("ALIGN",        (0, 0), (-1, -1), "CENTER"),
        ("TOPPADDING",   (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 6),
        ("LINEBELOW",    (0, 0), (-1, -1), 0.8, C_BORDER),
    ]))
    story.append(firma_table)
    story.append(Spacer(1, 10))

    # ── Parámetros legales ────────────────────────────────────────────────────
    uf_str  = f"${float(liquidacion.uf_usada):,.2f}".replace(",", ".") if getattr(liquidacion, "uf_usada",  None) else "—"
    utm_str = _fmt(liquidacion.utm_usado) if getattr(liquidacion, "utm_usado",  None) else "—"
    imm_str = _fmt(liquidacion.imm_usado) if getattr(liquidacion, "imm_usado",  None) else "—"
    fuente  = "mindicador.cl" if getattr(liquidacion, "parametros_id", None) else "fallback"

    story.append(Paragraph(
        f"Parámetros legales {mes_anio_str}: UF {uf_str} · UTM {utm_str} · IMM {imm_str} · Fuente: {fuente}",
        st_foot,
    ))
    story.append(Spacer(1, 3))
    story.append(Paragraph(
        f"Documento generado automáticamente por el sistema de remuneraciones E-Courier SPA. "
        f"Generado el {date.today().strftime('%d/%m/%Y')}.",
        st_foot,
    ))

    doc.build(story)
    return buffer.getvalue()
