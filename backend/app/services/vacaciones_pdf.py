"""
Generador de comprobantes PDF de vacaciones.

Hay dos variantes:
  - Comprobante de feriado legal (vacación aprobada en el sistema): firma del
    trabajador (al solicitar) + firma del aprobador RRHH.
  - Comprobante retroactivo: vacación cargada por admin de un período pasado.
    Solo se firma "conformidad" del trabajador. La firma del rep legal es la
    institucional cargada en el sistema.

Reutiliza assets visuales del motor de anexos.
"""
from __future__ import annotations

import io
import os
import base64
from datetime import date
from typing import Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT, TA_JUSTIFY
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as RLImage,
)

from app.models import Trabajador, VacacionTrabajador

ASSETS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets")
LOGO_PATH = os.path.join(ASSETS_DIR, "logo_ecourier.png")
FIRMA_REP_PATH = os.path.join(ASSETS_DIR, "firma_representante.png")

FONT = "Helvetica"
FONT_BOLD = "Helvetica-Bold"
C_PRIMARY = colors.HexColor("#003a8c")
C_TXT = colors.HexColor("#1a1a1a")
C_MUTED = colors.HexColor("#5b5b5b")
C_BORDER = colors.HexColor("#cbd5e1")
C_BG_INFO = colors.HexColor("#eff6ff")
C_BG_RETRO = colors.HexColor("#fef3c7")

_MESES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]


def _st(name, font, size, color, align=TA_LEFT, leading_extra=2.5) -> ParagraphStyle:
    return ParagraphStyle(name=name, fontName=font, fontSize=size,
                          leading=size + leading_extra, alignment=align, textColor=color)


def _fmt_fecha_larga(d: Optional[date]) -> str:
    if not d:
        return "—"
    return f"{d.day} de {_MESES[d.month - 1]} de {d.year}"


def _fmt_rut(rut: Optional[str]) -> str:
    return rut or "—"


def _imagen_firma(src: Optional[str], w: int = 110, h: int = 46):
    """Devuelve un RLImage si la firma viene como data URI o ruta válida; si no, Spacer."""
    if not src:
        return Spacer(w, h)
    try:
        if isinstance(src, str) and src.startswith("data:image"):
            _, b64data = src.split(",", 1)
            return RLImage(io.BytesIO(base64.b64decode(b64data)), width=w, height=h)
        if isinstance(src, str) and os.path.exists(src):
            return RLImage(src, width=w, height=h)
    except Exception:
        pass
    return Spacer(w, h)


def _bloque_firmas_vacaciones(
    rep_nombre: str,
    rep_rut: str,
    trab_nombre: str,
    trab_rut: Optional[str],
    firma_trabajador_src: Optional[str],
    aprobador_nombre: Optional[str],
    aprobador_rol: str = "Recursos Humanos",
    firma_aprobador_src: Optional[str] = None,
    pie_pendiente_trabajador: str = "(Firma pendiente — disponible en portal del trabajador)",
) -> Table:
    """
    Tres columnas: Empresa (rep legal), Aprobador (RRHH) y Trabajador.
    Las firmas se renderizan si vienen como data:image base64 o ruta.
    """
    st_lbl = _st("flbl", FONT_BOLD, 7.5, C_MUTED, TA_CENTER)
    st_rut = _st("frut", FONT, 7, C_MUTED, TA_CENTER)
    st_pend = _st("fpend", FONT, 7, colors.HexColor("#9a3412"), TA_CENTER)
    FIRMA_W, FIRMA_H = 100, 42

    rep_cell = [
        _imagen_firma(FIRMA_REP_PATH, FIRMA_W, FIRMA_H),
        Paragraph(f"{rep_nombre} — Representante Legal", st_lbl),
        Paragraph(f"RUT {rep_rut}", st_rut),
    ]
    if firma_aprobador_src:
        ap_cell = [
            _imagen_firma(firma_aprobador_src, FIRMA_W, FIRMA_H),
            Paragraph(f"{aprobador_nombre or '—'} — {aprobador_rol}", st_lbl),
        ]
    else:
        ap_cell = [
            Spacer(FIRMA_W, FIRMA_H),
            Paragraph(f"{aprobador_nombre or '—'} — {aprobador_rol}", st_lbl),
            Paragraph("(Aprobación digital en sistema)", st_rut),
        ]
    if firma_trabajador_src:
        trab_cell = [
            _imagen_firma(firma_trabajador_src, FIRMA_W, FIRMA_H),
            Paragraph(trab_nombre, st_lbl),
            Paragraph(f"RUT {_fmt_rut(trab_rut)}", st_rut),
        ]
    else:
        trab_cell = [
            Spacer(FIRMA_W, FIRMA_H),
            Paragraph(pie_pendiente_trabajador, st_pend),
            Paragraph(trab_nombre, st_lbl),
            Paragraph(f"RUT {_fmt_rut(trab_rut)}", st_rut),
        ]

    t = Table([[rep_cell, ap_cell, trab_cell]], colWidths=[None, None, None])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -1), 0.8, C_BORDER),
    ]))
    return t


def _encabezado(canvas_obj, doc):
    """Header simple con logo y título."""
    canvas_obj.saveState()
    if os.path.exists(LOGO_PATH):
        try:
            canvas_obj.drawImage(
                LOGO_PATH, 18 * mm, A4[1] - 22 * mm,
                width=28 * mm, height=12 * mm, preserveAspectRatio=True, mask="auto",
            )
        except Exception:
            pass
    canvas_obj.setFont(FONT_BOLD, 9)
    canvas_obj.setFillColor(C_PRIMARY)
    canvas_obj.drawRightString(A4[0] - 18 * mm, A4[1] - 14 * mm, "COMPROBANTE DE FERIADO LEGAL")
    canvas_obj.setFont(FONT, 7)
    canvas_obj.setFillColor(C_MUTED)
    canvas_obj.drawRightString(A4[0] - 18 * mm, A4[1] - 18 * mm, "Art. 67 y siguientes — Código del Trabajo")
    canvas_obj.restoreState()


def generar_pdf_vacacion(
    vac: VacacionTrabajador,
    trabajador: Trabajador,
    saldo_snapshot: dict,
    rep_legal_nombre: str = "Adriana Colina Aguilar",
    rep_legal_rut: str = "25.936.753-0",
    empresa_razon_social: str = "E-Courier SPA",
    empresa_rut: str = "—",
) -> bytes:
    """
    Genera el comprobante PDF de la vacación. Lee los snapshots de firma que ya
    están en el modelo (trabajador y aprobador RRHH).
    """
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=28 * mm, bottomMargin=18 * mm,
        title=f"Vacaciones — {trabajador.nombre}",
        author=empresa_razon_social,
    )
    story: list = []

    es_retro = bool(vac.es_retroactiva)
    st_h1 = _st("h1", FONT_BOLD, 13, C_PRIMARY, TA_LEFT, 4)
    st_p = _st("p", FONT, 9, C_TXT, TA_JUSTIFY, 3)
    st_lbl = _st("lbl", FONT_BOLD, 7.5, C_MUTED, TA_LEFT)
    st_val = _st("val", FONT, 9, C_TXT, TA_LEFT)

    titulo = "Comprobante de Feriado Legal"
    if es_retro:
        titulo += " (Registro Histórico)"
    story.append(Paragraph(titulo, st_h1))
    story.append(Spacer(1, 4))

    if es_retro:
        story.append(Paragraph(
            "Este documento registra un feriado legal tomado por el trabajador en un período "
            "anterior a la implementación del sistema digital de gestión de vacaciones. "
            "La firma del trabajador en este comprobante constituye conformidad respecto a "
            "los días informados.",
            _st("intro", FONT, 8.5, C_MUTED, TA_JUSTIFY, 3),
        ))
    else:
        story.append(Paragraph(
            f"Por el presente, {empresa_razon_social} otorga a {trabajador.nombre} el feriado "
            f"legal correspondiente, en uso del derecho establecido en el Art. 67 del Código del "
            f"Trabajo.",
            _st("intro", FONT, 8.5, C_MUTED, TA_JUSTIFY, 3),
        ))
    story.append(Spacer(1, 8))

    # Bloque datos del trabajador
    datos_trab = [
        [Paragraph("TRABAJADOR", st_lbl), Paragraph(trabajador.nombre or "—", st_val)],
        [Paragraph("RUT", st_lbl), Paragraph(_fmt_rut(trabajador.rut), st_val)],
        [Paragraph("CARGO", st_lbl), Paragraph(trabajador.cargo or "—", st_val)],
        [Paragraph("FECHA INGRESO", st_lbl), Paragraph(
            _fmt_fecha_larga(trabajador.fecha_ingreso) if trabajador.fecha_ingreso else "—", st_val)],
    ]
    t_trab = Table(datos_trab, colWidths=[35 * mm, None])
    t_trab.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LINEBELOW", (0, 0), (-1, -1), 0.3, C_BORDER),
    ]))
    story.append(t_trab)
    story.append(Spacer(1, 8))

    # Bloque del feriado
    bg = C_BG_RETRO if es_retro else C_BG_INFO
    dias_corridos = vac.dias_corridos
    if dias_corridos is None and vac.fecha_inicio and vac.fecha_fin:
        dias_corridos = (vac.fecha_fin - vac.fecha_inicio).days + 1

    feriado_data = [
        [Paragraph("DÍAS HÁBILES", st_lbl), Paragraph(str(vac.dias_habiles), st_val),
         Paragraph("DÍAS CORRIDOS", st_lbl), Paragraph(str(dias_corridos or "—"), st_val)],
        [Paragraph("DESDE", st_lbl), Paragraph(_fmt_fecha_larga(vac.fecha_inicio), st_val),
         Paragraph("HASTA", st_lbl), Paragraph(_fmt_fecha_larga(vac.fecha_fin), st_val)],
    ]
    t_fer = Table(feriado_data, colWidths=[28 * mm, None, 28 * mm, None])
    t_fer.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("BOX", (0, 0), (-1, -1), 0.3, C_BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.2, C_BORDER),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(t_fer)
    story.append(Spacer(1, 10))

    # Bloque del saldo (snapshot)
    if saldo_snapshot:
        story.append(Paragraph("Estado del feriado al momento de aprobar:", st_lbl))
        story.append(Spacer(1, 3))
        saldo_data = [
            [Paragraph("Días devengados (acumulados)", st_val),
             Paragraph(str(saldo_snapshot.get("dias_acumulados", "—")), st_val)],
            [Paragraph("Días tomados previamente", st_val),
             Paragraph(str(saldo_snapshot.get("dias_tomados", "—")), st_val)],
            [Paragraph("Saldo previo a este feriado", st_val),
             Paragraph(str(saldo_snapshot.get("saldo_previo", "—")), st_val)],
            [Paragraph("Días progresivos vigentes (Art. 68)", st_val),
             Paragraph(str(saldo_snapshot.get("dias_progresivo", 0)), st_val)],
        ]
        t_saldo = Table(saldo_data, colWidths=[None, 30 * mm])
        t_saldo.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), FONT),
            ("FONTSIZE", (0, 0), (-1, -1), 8.5),
            ("LINEBELOW", (0, 0), (-1, -1), 0.2, C_BORDER),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        story.append(t_saldo)
        story.append(Spacer(1, 10))

    if vac.nota:
        story.append(Paragraph(f"<b>Observaciones:</b> {vac.nota}", _st("nota", FONT, 8, C_MUTED, TA_LEFT, 3)))
        story.append(Spacer(1, 8))

    # Texto legal según tipo
    if es_retro:
        story.append(Paragraph(
            "El trabajador, al firmar este documento, declara conformidad respecto a las fechas "
            "y días hábiles consignados, correspondientes a un feriado legal efectivamente tomado "
            "con anterioridad.",
            _st("legal", FONT, 8, C_MUTED, TA_JUSTIFY, 3),
        ))
    else:
        story.append(Paragraph(
            "El trabajador toma conocimiento y acepta el período de feriado legal aquí indicado, "
            "comprometiéndose a reincorporarse a sus labores el día hábil siguiente al de término.",
            _st("legal", FONT, 8, C_MUTED, TA_JUSTIFY, 3),
        ))
    story.append(Spacer(1, 16))

    # Firmas
    firma_trab = vac.firma_solicitud or vac.firma_retroactiva or getattr(trabajador, "firma_base64", None)
    pie_pend = (
        "(Firma de conformidad pendiente — disponible en portal del trabajador)"
        if es_retro else
        "(Firma pendiente — disponible en portal del trabajador)"
    )
    story.append(_bloque_firmas_vacaciones(
        rep_nombre=rep_legal_nombre,
        rep_rut=rep_legal_rut,
        trab_nombre=trabajador.nombre,
        trab_rut=trabajador.rut,
        firma_trabajador_src=firma_trab,
        aprobador_nombre=vac.aprobada_por,
        firma_aprobador_src=vac.firma_aprobacion,
        pie_pendiente_trabajador=pie_pend,
    ))

    doc.build(story, onFirstPage=_encabezado, onLaterPages=_encabezado)
    return buf.getvalue()
