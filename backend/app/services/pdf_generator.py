"""
Generador de PDFs de liquidación para sellers y drivers.
Formato: logo + encabezado, resumen semanal (5 columnas), desglose diario,
gráfico mensual de envíos, footer motivacional.
"""
import io
import os
import calendar
from typing import List, Dict
from datetime import datetime, date
from collections import defaultdict

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer,
    Image as RLImage,
)
from reportlab.graphics.shapes import Drawing, Rect, String as GString
from sqlalchemy.orm import Session

from app.models import (
    Envio, Seller, Driver, Retiro, AjusteLiquidacion,
    EmpresaEnum, TipoEntidadEnum,
)
from app.services.calendario import get_dates_for_week as _cal_get_dates

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


def _get_dates_for_week(semana: int, mes: int, anio: int, db=None):
    if db is not None:
        return _cal_get_dates(db, semana, mes, anio)
    # Fallback sin DB
    _, days_in_month = calendar.monthrange(anio, mes)
    start_day = (semana - 1) * 7 + 1
    end_day = min(semana * 7, days_in_month)
    return [date(anio, mes, d) for d in range(start_day, end_day + 1)]



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
    db: Session, seller_id: int, semana: int, mes: int, anio: int
) -> bytes:
    seller = db.get(Seller, seller_id)
    if not seller:
        raise ValueError("Seller no encontrado")

    weekly = {}
    for s in range(1, 6):
        envios = db.query(Envio).filter(
            Envio.seller_id == seller_id, Envio.semana == s,
            Envio.mes == mes, Envio.anio == anio,
        ).all()
        total_retiros = 0
        if seller.tiene_retiro and not seller.usa_pickup and envios and seller.tarifa_retiro:
            if not (seller.min_paquetes_retiro_gratis > 0 and len(envios) >= seller.min_paquetes_retiro_gratis):
                dias_con_envios = len({e.fecha_entrega for e in envios if e.fecha_entrega})
                total_retiros = seller.tarifa_retiro * dias_con_envios

        weekly[s] = {
            "monto": sum(e.cobro_seller + e.cobro_extra_manual for e in envios),
            "envios": len(envios),
            "bultos_extra": sum(e.extra_producto_seller for e in envios),
            "retiros": total_retiros,
            "peso_extra": sum(e.extra_comuna_seller for e in envios),
        }

    def sub(s):
        w = weekly[s]
        return w["monto"] + w["bultos_extra"] + w["retiros"] + w["peso_extra"]

    subtotals = [sub(s) for s in range(1, 6)]
    ivas = [int(v * 0.19) for v in subtotals]
    totals = [subtotals[i] + ivas[i] for i in range(5)]
    total_semana = totals[semana - 1]

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter, topMargin=20, bottomMargin=20, leftMargin=40, rightMargin=40)
    elements = []

    elements.extend(_build_header(seller.nombre, mes, anio, total_semana, is_seller=True))

    def _row(label, key, is_clp=True):
        vals = [weekly[s][key] for s in range(1, 6)]
        total = sum(vals)
        if is_clp:
            return [label] + [_fmt(v) for v in vals] + [_fmt(total)]
        return [label] + [str(v) for v in vals] + [str(total)]

    rows = [
        _row("Monto", "monto"),
        _row("Envíos", "envios", False),
        _row("Bultos Extra", "bultos_extra"),
        _row("Retiros", "retiros"),
        _row("Peso Extra", "peso_extra"),
        ["Subtotal"] + [_fmt(v) for v in subtotals] + [_fmt(sum(subtotals))],
        ["IVA"] + [_fmt(v) for v in ivas] + [_fmt(sum(ivas))],
        ["Total"] + [_fmt(v) for v in totals] + [_fmt(sum(totals))],
    ]

    elements.append(_weekly_table(rows))
    elements.append(Spacer(1, 14))
    elements.append(_footer_message())
    elements.append(Spacer(1, 10))

    # Desglose diario — sin retiros en sellers
    all_dates = _get_dates_for_week(semana, mes, anio, db=db)
    envios_semana = db.query(Envio).filter(
        Envio.seller_id == seller_id, Envio.semana == semana,
        Envio.mes == mes, Envio.anio == anio,
    ).order_by(Envio.fecha_entrega).all()

    daily_map = {d: {"fecha": d, "envios": 0, "bultos_extra": 0, "peso_extra": 0, "cobro": 0} for d in all_dates}
    for e in envios_semana:
        d = e.fecha_entrega
        if d not in daily_map:
            daily_map[d] = {"fecha": d, "envios": 0, "bultos_extra": 0, "peso_extra": 0, "cobro": 0}
        daily_map[d]["envios"] += 1
        daily_map[d]["cobro"] += e.cobro_seller + (e.cobro_extra_manual or 0)
        daily_map[d]["bultos_extra"] += e.extra_producto_seller
        daily_map[d]["peso_extra"] += e.extra_comuna_seller

    daily_data = sorted(daily_map.values(), key=lambda x: x["fecha"])

    if daily_data:
        daily_cols = [
            ("Día", "fecha", "date"),
            ("Envíos", "envios", "int"),
            ("Bultos Extra", "bultos_extra", "clp"),
            ("Peso Extra", "peso_extra", "clp"),
            ("Cobro", "cobro", "clp"),
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
    db: Session, driver_id: int, semana: int, mes: int, anio: int
) -> bytes:
    driver = db.get(Driver, driver_id)
    if not driver:
        raise ValueError("Driver no encontrado")

    weekly = {}
    for s in range(1, 6):
        envios = db.query(Envio).filter(
            Envio.driver_id == driver_id, Envio.semana == s,
            Envio.mes == mes, Envio.anio == anio,
        ).all()
        retiros_q = db.query(Retiro).filter(
            Retiro.driver_id == driver_id, Retiro.semana == s,
            Retiro.mes == mes, Retiro.anio == anio,
        ).all()
        normal = [e for e in envios if e.empresa in (None, "", EmpresaEnum.ECOURIER, EmpresaEnum.ECOURIER.value)]
        oviedo = [e for e in envios if e.empresa in (EmpresaEnum.OVIEDO, EmpresaEnum.OVIEDO.value)]
        tercerizado = [e for e in envios if e.empresa in (EmpresaEnum.TERCERIZADO, EmpresaEnum.TERCERIZADO.value)]
        valparaiso = [e for e in envios if e.empresa in (EmpresaEnum.VALPARAISO, EmpresaEnum.VALPARAISO.value)]
        melipilla = [e for e in envios if e.empresa in (EmpresaEnum.MELIPILLA, EmpresaEnum.MELIPILLA.value)]

        ajustes = db.query(AjusteLiquidacion).filter(
            AjusteLiquidacion.tipo == TipoEntidadEnum.DRIVER,
            AjusteLiquidacion.entidad_id == driver_id,
            AjusteLiquidacion.semana == s,
            AjusteLiquidacion.mes == mes,
            AjusteLiquidacion.anio == anio,
        ).all()
        bonif = sum(a.monto for a in ajustes if a.monto > 0)
        desc = sum(a.monto for a in ajustes if a.monto < 0)

        es_contratado = getattr(driver, 'contratado', False)
        pago_extra_envios = sum(e.pago_extra_manual for e in envios)
        weekly[s] = {
            "normal_count": len(normal),
            "normal_total": sum(e.costo_driver for e in normal),
            "oviedo_count": len(oviedo),
            "oviedo_total": sum(e.costo_driver for e in oviedo),
            "tercerizado_count": len(tercerizado),
            "tercerizado_total": sum(e.costo_driver for e in tercerizado),
            "valparaiso_count": len(valparaiso),
            "valparaiso_total": sum(e.costo_driver for e in valparaiso),
            "melipilla_count": len(melipilla),
            "melipilla_total": sum(e.costo_driver for e in melipilla),
            "comuna": 0 if es_contratado else sum(e.extra_comuna_driver for e in envios),
            "bultos_extra": 0 if es_contratado else sum(e.extra_producto_driver for e in envios) + pago_extra_envios,
            "retiros": sum(r.tarifa_driver for r in retiros_q),
            "bonificaciones": bonif,
            "descuentos": desc,
        }

    def _weekly_total(s):
        w = weekly[s]
        return (w["normal_total"] + w["oviedo_total"] + w["tercerizado_total"]
                + w["valparaiso_total"] + w["melipilla_total"]
                + w["comuna"] + w["bultos_extra"] + w["retiros"]
                + w["bonificaciones"] + w["descuentos"])

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
        vals = [weekly[s][key] for s in range(1, 6)]
        return [label] + [str(v) for v in vals] + [str(sum(vals))]

    def _money_row(label, key):
        vals = [weekly[s][key] for s in range(1, 6)]
        return [label] + [_fmt(v) for v in vals] + [_fmt(sum(vals))]

    totals_vals = [_weekly_total(s) for s in range(1, 6)]

    es_contratado = getattr(driver, 'contratado', False)
    rows = [
        _count_row("General", "normal_count"),
        _money_row("Subtotal Normal", "normal_total"),
        _count_row(f"Oviedo ({_fmt(tarifa_oviedo)})", "oviedo_count"),
        _money_row("Subtotal Oviedo", "oviedo_total"),
        _count_row(f"Tercerizado ({_fmt(tarifa_terc)})", "tercerizado_count"),
        _money_row("Subtotal Tercerizado", "tercerizado_total"),
        _count_row(f"Valparaíso ({_fmt(tarifa_valp)})", "valparaiso_count"),
        _money_row("Subtotal Valparaíso", "valparaiso_total"),
        _count_row(f"Melipilla ({_fmt(tarifa_meli)})", "melipilla_count"),
        _money_row("Subtotal Melipilla", "melipilla_total"),
    ]
    if not es_contratado:
        rows.append(_money_row("Comuna", "comuna"))
        rows.append(_money_row("Bultos Extra", "bultos_extra"))
    rows.extend([
        _money_row("Retiros", "retiros"),
        _money_row("Bonificaciones", "bonificaciones"),
        _money_row("Descuentos", "descuentos"),
        ["Total"] + [_fmt(v) for v in totals_vals] + [_fmt(sum(totals_vals))],
    ])

    elements.append(_weekly_table(rows))
    elements.append(Spacer(1, 14))
    elements.append(_footer_message())
    elements.append(Spacer(1, 6))
    elements.append(_driver_note())
    elements.append(Spacer(1, 10))

    # Daily breakdown with all dates for the week (Mon-Sun via calendario)
    all_dates = _get_dates_for_week(semana, mes, anio, db=db)
    envios_semana = db.query(Envio).filter(
        Envio.driver_id == driver_id, Envio.semana == semana,
        Envio.mes == mes, Envio.anio == anio,
    ).order_by(Envio.fecha_entrega).all()

    es_contratado = getattr(driver, 'contratado', False)
    daily_map = {d: {"fecha": d, "envios": 0, "bultos_extra": 0, "retiros": 0, "comuna": 0, "cobro": 0} for d in all_dates}
    for e in envios_semana:
        d = e.fecha_entrega
        if d not in daily_map:
            daily_map[d] = {"fecha": d, "envios": 0, "bultos_extra": 0, "retiros": 0, "comuna": 0, "cobro": 0}
        daily_map[d]["envios"] += 1
        daily_map[d]["cobro"] += e.costo_driver
        if not es_contratado:
            daily_map[d]["bultos_extra"] += e.extra_producto_driver + (e.pago_extra_manual or 0)
            daily_map[d]["comuna"] += e.extra_comuna_driver

    retiros_semana = db.query(Retiro).filter(
        Retiro.driver_id == driver_id, Retiro.semana == semana,
        Retiro.mes == mes, Retiro.anio == anio,
    ).all()
    for r in retiros_semana:
        d = r.fecha
        if d in daily_map:
            daily_map[d]["retiros"] += r.tarifa_driver

    # cobro = pago envíos + retiro del día
    for info in daily_map.values():
        info["cobro"] = info["cobro"] + info["retiros"]

    daily_data = sorted(daily_map.values(), key=lambda x: x["fecha"])

    if daily_data:
        daily_cols = [
            ("Día", "fecha", "date"),
            ("Envíos", "envios", "int"),
            ("Cobro", "cobro", "clp"),
        ]
        if not es_contratado:
            daily_cols.append(("Bultos Extra", "bultos_extra", "clp"))
        daily_cols.append(("Retiros", "retiros", "clp"))
        if not es_contratado:
            daily_cols.append(("Comuna", "comuna", "clp"))
        elements.append(_daily_table(daily_data, daily_cols))
        elements.append(Spacer(1, 10))
        elements.append(_weekly_chart(daily_data, "envios"))

    elements.append(Spacer(1, 10))
    elements.append(_company_footer())

    doc.build(elements)
    return buffer.getvalue()
