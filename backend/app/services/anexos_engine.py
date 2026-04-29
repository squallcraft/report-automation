"""
Motor de generación automática de anexos contractuales.

Genera PDFs por tipo de cambio (aumento de sueldo, reducción jornada,
adecuación a jornada legal, reajuste IMM, cambio cargo, etc.) ligados a
la versión contractual creada y a la firma del trabajador.

Reutiliza los assets visuales del PDF de liquidaciones: logo + firma del
representante legal.
"""
from __future__ import annotations

import os
import io
import base64
from datetime import date
from typing import Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER, TA_JUSTIFY
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as RLImage,
    KeepInFrame, PageBreak,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

from app.models import (
    AnexoContrato,
    ContratoTrabajadorVersion,
    Trabajador,
    EstadoAnexoEnum,
    TipoAnexoEnum,
    MotivoVersionContratoEnum,
)


# ── Assets ──────────────────────────────────────────────────────────────────
ASSETS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets")
LOGO_PATH = os.path.join(ASSETS_DIR, "logo_ecourier.png")
FIRMA_REP_PATH = os.path.join(ASSETS_DIR, "firma_representante.png")

# Reusar fuente del PDF generator
FONT = "Helvetica"
FONT_BOLD = "Helvetica-Bold"

C_PRIMARY = colors.HexColor("#003a8c")
C_TXT = colors.HexColor("#1a1a1a")
C_MUTED = colors.HexColor("#5b5b5b")
C_BORDER = colors.HexColor("#cbd5e1")
C_BG_INFO = colors.HexColor("#eff6ff")
C_BG_CHANGE = colors.HexColor("#fef3c7")


def _fmt(n: int) -> str:
    return "$" + f"{int(n or 0):,}".replace(",", ".")


def _fmt_rut(rut: str | None) -> str:
    if not rut:
        return "—"
    return rut


def _st(name: str, font: str, size: float, color, align=TA_LEFT, leading_extra: float = 2.5) -> ParagraphStyle:
    return ParagraphStyle(
        name=name,
        fontName=font,
        fontSize=size,
        leading=size + leading_extra,
        alignment=align,
        textColor=color,
    )


# ── Generador principal ─────────────────────────────────────────────────────
def generar_pdf_anexo(
    anexo: AnexoContrato,
    trabajador: Trabajador,
    version_nueva: ContratoTrabajadorVersion,
    version_anterior: Optional[ContratoTrabajadorVersion],
    rep_legal_nombre: str = "Adriana Colina Aguilar",
    rep_legal_rut: str = "25.936.753-0",
    empresa_razon_social: str = "E-Courier SPA",
    empresa_rut: str = "—",
) -> bytes:
    """
    Genera un PDF de anexo contractual según el tipo de cambio.
    """
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=20 * mm,
        leftMargin=20 * mm,
        topMargin=18 * mm,
        bottomMargin=15 * mm,
    )
    story = []

    # ── Encabezado con logo ─────────────────────────────────────────────
    if os.path.exists(LOGO_PATH):
        logo = RLImage(LOGO_PATH, width=140, height=32)
        story.append(logo)
    story.append(Spacer(1, 8))

    st_h1 = _st("h1", FONT_BOLD, 14, C_PRIMARY, TA_CENTER, 3)
    st_h2 = _st("h2", FONT_BOLD, 11, C_PRIMARY, TA_LEFT, 2)
    st_p = _st("p", FONT, 10, C_TXT, TA_JUSTIFY, 3)
    st_p_b = _st("pb", FONT_BOLD, 10, C_TXT, TA_LEFT, 2)
    st_meta = _st("meta", FONT, 8.5, C_MUTED, TA_LEFT, 2)
    st_meta_r = _st("metar", FONT, 8.5, C_MUTED, TA_RIGHT, 2)

    story.append(Paragraph(anexo.titulo, st_h1))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        f"Santiago, {date.today().strftime('%d de %B de %Y')}",
        st_meta_r,
    ))
    story.append(Spacer(1, 10))

    # ── Partes ──────────────────────────────────────────────────────────
    story.append(Paragraph("Comparecen", st_h2))
    story.append(Paragraph(
        f"Por una parte, <b>{empresa_razon_social}</b>, RUT {empresa_rut}, "
        f"representada por su representante legal don/doña <b>{rep_legal_nombre}</b>, "
        f"RUT {rep_legal_rut}, en adelante \"el empleador\";",
        st_p,
    ))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        f"y por la otra parte, don/doña <b>{trabajador.nombre}</b>, RUT {_fmt_rut(trabajador.rut)}, "
        f"en adelante \"el trabajador\".",
        st_p,
    ))
    story.append(Spacer(1, 10))

    # ── Cuerpo según tipo ───────────────────────────────────────────────
    story.extend(_cuerpo_segun_tipo(anexo, version_nueva, version_anterior, st_h2, st_p, st_p_b))

    # ── Tabla resumen ──────────────────────────────────────────────────
    story.append(Spacer(1, 8))
    story.append(_tabla_comparativa(version_nueva, version_anterior))
    story.append(Spacer(1, 10))

    # ── Vigencia y aceptación ──────────────────────────────────────────
    requiere_firma = bool(anexo.requiere_firma_trabajador)
    if requiere_firma:
        story.append(Paragraph(
            f"Este anexo entrará en vigor el día <b>{version_nueva.vigente_desde.strftime('%d/%m/%Y')}</b> "
            f"una vez firmado electrónicamente por ambas partes y se entiende como parte integrante del "
            f"contrato individual de trabajo previamente celebrado entre las partes.",
            st_p,
        ))
    else:
        story.append(Paragraph(
            f"Este anexo es de carácter <b>informativo</b>, dando cuenta de un reajuste legal obligatorio "
            f"que entra en vigor a contar del <b>{version_nueva.vigente_desde.strftime('%d/%m/%Y')}</b>. "
            f"No requiere firma del trabajador para su validez.",
            st_p,
        ))

    if anexo.notas if hasattr(anexo, "notas") else False:
        story.append(Spacer(1, 4))
        story.append(Paragraph(f"<i>Observaciones:</i> {anexo.notas}", st_meta))

    if version_nueva.notas:
        story.append(Spacer(1, 4))
        story.append(Paragraph(f"<i>Notas internas:</i> {version_nueva.notas}", st_meta))

    # ── Firmas ─────────────────────────────────────────────────────────
    story.append(Spacer(1, 24))
    story.append(_bloque_firmas(
        rep_legal_nombre, rep_legal_rut,
        trabajador.nombre, trabajador.rut,
        firma_trabajador_src=anexo.firma_trabajador_snapshot or getattr(trabajador, "firma_base64", None),
        requiere_firma_trabajador=requiere_firma,
    ))

    # ── Pie de página ──────────────────────────────────────────────────
    story.append(Spacer(1, 12))
    st_foot = _st("foot", FONT, 7.5, C_MUTED, TA_CENTER, 1.5)
    story.append(Paragraph(
        f"Documento generado automáticamente por el sistema de remuneraciones E-Courier SPA "
        f"el {date.today().strftime('%d/%m/%Y')}. Anexo Nº {anexo.id or 'BORRADOR'}.",
        st_foot,
    ))

    doc.build(story)
    return buffer.getvalue()


# ── Cuerpos por tipo ────────────────────────────────────────────────────────
def _cuerpo_segun_tipo(
    anexo: AnexoContrato,
    nueva: ContratoTrabajadorVersion,
    anterior: Optional[ContratoTrabajadorVersion],
    st_h2, st_p, st_p_b,
) -> list:
    elems = []
    elems.append(Paragraph("Antecedentes y modificaciones acordadas", st_h2))

    tipo = anexo.tipo

    if tipo == TipoAnexoEnum.AUMENTO_SUELDO.value:
        ant_liq = anterior.sueldo_liquido if anterior else 0
        elems.append(Paragraph(
            f"Las partes acuerdan modificar la cláusula de remuneraciones del contrato individual de "
            f"trabajo, incrementando el sueldo líquido pactado de <b>{_fmt(ant_liq)}</b> a "
            f"<b>{_fmt(nueva.sueldo_liquido)}</b> mensuales, manteniéndose la jornada semanal en "
            f"<b>{nueva.jornada_semanal_horas} horas</b>.",
            st_p,
        ))

    elif tipo == TipoAnexoEnum.REDUCCION_JORNADA.value:
        ant_j = anterior.jornada_semanal_horas if anterior else 44
        elems.append(Paragraph(
            f"Las partes acuerdan reducir la jornada ordinaria semanal de "
            f"<b>{ant_j} horas</b> a <b>{nueva.jornada_semanal_horas} horas</b>, "
            f"manteniéndose el sueldo líquido pactado en <b>{_fmt(nueva.sueldo_liquido)}</b> mensuales. "
            f"En consecuencia, el valor hora ordinaria se recalcula sobre la nueva jornada para efectos "
            f"de horas extraordinarias.",
            st_p,
        ))

    elif tipo == TipoAnexoEnum.ADECUACION_JORNADA_LEGAL.value:
        ant_j = anterior.jornada_semanal_horas if anterior else 44
        ant_liq = anterior.sueldo_liquido if anterior else 0
        cambio_horas = ant_j != nueva.jornada_semanal_horas
        cambio_sueldo = ant_liq != nueva.sueldo_liquido
        if cambio_horas and not cambio_sueldo:
            descripcion = (
                f"reducir la jornada ordinaria semanal de <b>{ant_j} horas</b> a "
                f"<b>{nueva.jornada_semanal_horas} horas</b>, manteniéndose intacto el sueldo "
                f"líquido pactado en <b>{_fmt(nueva.sueldo_liquido)}</b>"
            )
        elif cambio_sueldo and not cambio_horas:
            descripcion = (
                f"mantener la jornada ordinaria en <b>{nueva.jornada_semanal_horas} horas</b> "
                f"e incrementar proporcionalmente el sueldo líquido de <b>{_fmt(ant_liq)}</b> a "
                f"<b>{_fmt(nueva.sueldo_liquido)}</b>"
            )
        else:
            descripcion = (
                f"actualizar las condiciones contractuales: jornada de <b>{ant_j}</b> a "
                f"<b>{nueva.jornada_semanal_horas} horas</b> y sueldo líquido de <b>{_fmt(ant_liq)}</b> a "
                f"<b>{_fmt(nueva.sueldo_liquido)}</b>"
            )
        elems.append(Paragraph(
            f"En cumplimiento de la Ley 21.561 de Reducción de la Jornada Laboral, las partes "
            f"acuerdan {descripcion}, a contar del <b>{nueva.vigente_desde.strftime('%d/%m/%Y')}</b>.",
            st_p,
        ))

    elif tipo == TipoAnexoEnum.REAJUSTE_IMM.value:
        ant_base = anterior.sueldo_base if anterior else 0
        elems.append(Paragraph(
            f"Por aplicación obligatoria del Ingreso Mínimo Mensual establecido en la legislación vigente, "
            f"se ajusta el sueldo base contractual de <b>{_fmt(ant_base)}</b> a <b>{_fmt(nueva.sueldo_base)}</b> "
            f"a contar del <b>{nueva.vigente_desde.strftime('%d/%m/%Y')}</b>. "
            f"Este ajuste es de carácter <b>informativo</b>: opera por mandato legal y no requiere firma "
            f"del trabajador para su exigibilidad.",
            st_p,
        ))

    elif tipo == TipoAnexoEnum.CAMBIO_CARGO.value:
        ant_cargo = (anterior.cargo if anterior else None) or "—"
        elems.append(Paragraph(
            f"Las partes acuerdan modificar la cláusula de funciones del contrato individual de trabajo, "
            f"cambiando el cargo de <b>{ant_cargo}</b> a <b>{nueva.cargo or '—'}</b>, "
            f"manteniéndose el resto de las condiciones contractuales sin alteración.",
            st_p,
        ))

    elif tipo == TipoAnexoEnum.CONTRATO_INICIAL.value:
        elems.append(Paragraph(
            f"Documento de digitalización del contrato individual de trabajo originalmente suscrito en "
            f"papel. Se incorpora al sistema digital con efecto a contar del "
            f"<b>{nueva.vigente_desde.strftime('%d/%m/%Y')}</b>.",
            st_p,
        ))

    else:
        elems.append(Paragraph(
            f"Las partes acuerdan modificar las condiciones contractuales según se detalla en la tabla "
            f"comparativa anexa. Vigencia: <b>{nueva.vigente_desde.strftime('%d/%m/%Y')}</b>.",
            st_p,
        ))

    return elems


# ── Tabla comparativa ───────────────────────────────────────────────────────
def _tabla_comparativa(
    nueva: ContratoTrabajadorVersion,
    anterior: Optional[ContratoTrabajadorVersion],
) -> Table:
    st_h = _st("th", FONT_BOLD, 9, colors.white, TA_LEFT, 1.5)
    st_hr = _st("thr", FONT_BOLD, 9, colors.white, TA_RIGHT, 1.5)
    st_l = _st("tdl", FONT_BOLD, 8.5, C_TXT, TA_LEFT, 1.5)
    st_v = _st("tdv", FONT, 8.5, C_TXT, TA_RIGHT, 1.5)
    st_v_n = _st("tdvn", FONT_BOLD, 8.5, C_PRIMARY, TA_RIGHT, 1.5)

    rows = [[Paragraph("Concepto", st_h), Paragraph("Anterior", st_hr), Paragraph("Nuevo", st_hr)]]

    def _row(label: str, fmt, attr: str):
        ant = fmt(getattr(anterior, attr, None)) if anterior else "—"
        nue = fmt(getattr(nueva, attr, None))
        rows.append([Paragraph(label, st_l), Paragraph(ant, st_v), Paragraph(nue, st_v_n)])

    _row("Sueldo líquido", lambda v: _fmt(v or 0), "sueldo_liquido")
    _row("Sueldo base", lambda v: _fmt(v or 0), "sueldo_base")
    _row("Gratificación", lambda v: _fmt(v or 0), "gratificacion")
    _row("Movilización", lambda v: _fmt(v or 0), "movilizacion")
    _row("Colación", lambda v: _fmt(v or 0), "colacion")
    _row("Jornada semanal", lambda v: f"{v} hrs" if v else "—", "jornada_semanal_horas")
    _row("Tipo jornada", lambda v: (v or "—"), "tipo_jornada")
    _row("Cargo", lambda v: (v or "—"), "cargo")
    _row("Tipo contrato", lambda v: (v or "—"), "tipo_contrato")

    t = Table(rows, colWidths=[70 * mm, 50 * mm, 50 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), C_PRIMARY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, C_BORDER),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, C_BG_INFO]),
    ]))
    return t


# ── Bloque firmas ───────────────────────────────────────────────────────────
def _bloque_firmas(
    rep_nombre: str,
    rep_rut: str,
    trab_nombre: str,
    trab_rut: str | None,
    firma_trabajador_src: Optional[str] = None,
    requiere_firma_trabajador: bool = True,
) -> Table:
    FIRMA_W, FIRMA_H = 110, 46
    st_lbl = _st("flbl", FONT_BOLD, 7.5, C_MUTED, TA_CENTER)
    st_rut = _st("frut", FONT, 7, C_MUTED, TA_CENTER)
    st_pend = _st("fpend", FONT, 7, colors.HexColor("#9a3412"), TA_CENTER)

    def _firma_cell(label_nombre, label_rut, firma_src, etiqueta_pend: str = ""):
        elems = []
        if firma_src and isinstance(firma_src, str) and firma_src.startswith("data:image"):
            try:
                _, b64data = firma_src.split(",", 1)
                img_bytes = base64.b64decode(b64data)
                elems.append(RLImage(io.BytesIO(img_bytes), width=FIRMA_W, height=FIRMA_H))
            except Exception:
                elems.append(Spacer(FIRMA_W, FIRMA_H))
        elif firma_src and os.path.exists(firma_src):
            elems.append(RLImage(firma_src, width=FIRMA_W, height=FIRMA_H))
        else:
            elems.append(Spacer(FIRMA_W, FIRMA_H))
            if etiqueta_pend:
                elems.append(Paragraph(etiqueta_pend, st_pend))
        elems.append(Paragraph(label_nombre, st_lbl))
        elems.append(Paragraph(label_rut, st_rut))
        return elems

    rep_cell = _firma_cell(
        f"{rep_nombre} — Representante Legal",
        f"RUT {rep_rut}",
        FIRMA_REP_PATH,
    )
    if requiere_firma_trabajador:
        trab_cell = _firma_cell(
            trab_nombre,
            f"RUT {_fmt_rut(trab_rut)}",
            firma_trabajador_src,
            etiqueta_pend="(Firma pendiente — disponible en portal del trabajador)",
        )
    else:
        trab_cell = [
            Spacer(FIRMA_W, FIRMA_H),
            Paragraph("(Anexo informativo — no requiere firma)", st_pend),
            Paragraph(trab_nombre, st_lbl),
            Paragraph(f"RUT {_fmt_rut(trab_rut)}", st_rut),
        ]

    t = Table([[rep_cell, trab_cell]], colWidths=[None, None])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -1), 0.8, C_BORDER),
    ]))
    return t


# ── Helpers de orquestación ─────────────────────────────────────────────────
def crear_anexo_para_version(
    db,
    trabajador: Trabajador,
    version_nueva: ContratoTrabajadorVersion,
    version_anterior: Optional[ContratoTrabajadorVersion],
    creado_por: Optional[str] = None,
) -> AnexoContrato:
    """
    Crea (en BD) un AnexoContrato para una versión recién generada.
    Lo deja en estado EMITIDO o INFORMATIVO según el tipo.
    Genera el PDF y lo guarda en `pdf_generado` (base64).
    """
    from app.services.contratos import obtener_config_legal

    motivo = version_nueva.motivo

    # Mapeo motivo → tipo anexo + estado base
    if motivo == MotivoVersionContratoEnum.CONTRATACION.value:
        tipo = TipoAnexoEnum.CONTRATO_INICIAL.value
        titulo = "Contrato Individual de Trabajo"
        # Requiere aprobación admin antes de quedar disponible para que el
        # trabajador firme. Pasa por flujo BORRADOR → EMITIDO → FIRMADO.
        estado = EstadoAnexoEnum.BORRADOR.value
        requiere_firma = True
    elif motivo == MotivoVersionContratoEnum.AUMENTO_SUELDO.value:
        tipo = TipoAnexoEnum.AUMENTO_SUELDO.value
        titulo = "Anexo de Contrato — Aumento de Remuneración"
        estado = EstadoAnexoEnum.EMITIDO.value
        requiere_firma = True
    elif motivo == MotivoVersionContratoEnum.REDUCCION_JORNADA.value:
        tipo = TipoAnexoEnum.REDUCCION_JORNADA.value
        titulo = "Anexo de Contrato — Reducción de Jornada"
        estado = EstadoAnexoEnum.EMITIDO.value
        requiere_firma = True
    elif motivo == MotivoVersionContratoEnum.ADECUACION_JORNADA_LEGAL.value:
        tipo = TipoAnexoEnum.ADECUACION_JORNADA_LEGAL.value
        titulo = "Anexo de Contrato — Adecuación a Nueva Jornada Legal"
        estado = EstadoAnexoEnum.EMITIDO.value
        requiere_firma = True
    elif motivo == MotivoVersionContratoEnum.REAJUSTE_IMM.value:
        tipo = TipoAnexoEnum.REAJUSTE_IMM.value
        titulo = "Notificación de Reajuste por Ingreso Mínimo Mensual"
        estado = EstadoAnexoEnum.INFORMATIVO.value
        requiere_firma = False
    elif motivo == MotivoVersionContratoEnum.CAMBIO_CARGO.value:
        tipo = TipoAnexoEnum.CAMBIO_CARGO.value
        titulo = "Anexo de Contrato — Cambio de Cargo"
        estado = EstadoAnexoEnum.EMITIDO.value
        requiere_firma = True
    else:
        tipo = TipoAnexoEnum.OTRO.value
        titulo = "Anexo de Contrato"
        estado = EstadoAnexoEnum.EMITIDO.value
        requiere_firma = True

    cfg = obtener_config_legal(db)
    pdf_bytes = generar_pdf_anexo(
        anexo=AnexoContrato(  # objeto temporal para pintar título; aún sin id
            tipo=tipo, titulo=titulo,
            requiere_firma_trabajador=requiere_firma,
            firma_trabajador_snapshot=None,
        ),
        trabajador=trabajador,
        version_nueva=version_nueva,
        version_anterior=version_anterior,
        rep_legal_nombre=cfg.rep_legal_nombre or "—",
        rep_legal_rut=cfg.rep_legal_rut or "—",
        empresa_razon_social=cfg.empresa_razon_social or "—",
        empresa_rut=cfg.empresa_rut or "—",
    )
    pdf_b64 = base64.b64encode(pdf_bytes).decode("ascii")

    anexo = AnexoContrato(
        trabajador_id=trabajador.id,
        version_id=version_nueva.id,
        tipo=tipo,
        titulo=titulo,
        pdf_generado=pdf_b64,
        requiere_firma_trabajador=requiere_firma,
        estado=estado,
        creado_por=creado_por,
    )
    db.add(anexo)
    db.flush()

    # Notificación al trabajador (in-app + WhatsApp si tiene número configurado).
    # Best-effort: si falla, no rompe la creación del anexo.
    try:
        from app.services.notificaciones import notificar_trabajador
        from app.models import TipoNotificacionEnum
        if requiere_firma:
            tipo_notif = TipoNotificacionEnum.ANEXO_PARA_FIRMA.value
            mensaje = (
                f"Tienes un nuevo {titulo} disponible en tu portal. "
                "Por favor revísalo y fírmalo electrónicamente."
            )
        else:
            tipo_notif = TipoNotificacionEnum.ANEXO_INFORMATIVO.value
            mensaje = f"Se generó un {titulo} (informativo, no requiere firma)."
        notificar_trabajador(
            db,
            trabajador=trabajador,
            titulo=titulo,
            mensaje=mensaje,
            tipo=tipo_notif,
            url_accion=f"/portal/anexos/{anexo.id}",
            commit=False,
        )
    except Exception:
        pass

    return anexo


# ─────────────────────────────────────────────────────────────────────────────
# Camino B: PDF de contrato inicial digital (a partir de plantilla renderizada)
# ─────────────────────────────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────────────────────
# Camino B: PDF de contrato inicial digital (a partir de plantilla renderizada)
# ─────────────────────────────────────────────────────────────────────────────
def generar_pdf_contrato_generico(
    rendered_md: str,
    titulo: str,
    firmante_nombre: str,
    firmante_rut: Optional[str],
    rep_legal_nombre: str = "Adriana Colina Aguilar",
    rep_legal_rut: str = "25.936.753-0",
    empresa_razon_social: str = "E-Courier SPA",
    empresa_rut: str = "—",
    firma_firmante_src: Optional[str] = None,
    requiere_firma: bool = True,
) -> bytes:
    """
    Genera el PDF de un contrato a partir de markdown renderizado.
    Función genérica: acepta cualquier tipo de firmante (trabajador, inquilino, etc.).
    El bloque de firmas usa `firmante_nombre` y `firmante_rut` como firma derecha.
    """
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=20 * mm,
        leftMargin=20 * mm,
        topMargin=18 * mm,
        bottomMargin=15 * mm,
    )
    story = []

    if os.path.exists(LOGO_PATH):
        story.append(RLImage(LOGO_PATH, width=140, height=32))
    story.append(Spacer(1, 8))

    st_h1 = _st("h1cb", FONT_BOLD, 14, C_PRIMARY, TA_CENTER, 3)
    st_h2 = _st("h2cb", FONT_BOLD, 11, C_PRIMARY, TA_LEFT, 2)
    st_h3 = _st("h3cb", FONT_BOLD, 10, C_TXT, TA_LEFT, 2)
    st_p = _st("pcb", FONT, 10, C_TXT, TA_JUSTIFY, 3)
    st_meta_r = _st("metar", FONT, 8.5, C_MUTED, TA_RIGHT, 2)

    story.append(Paragraph(titulo, st_h1))
    story.append(Spacer(1, 4))
    story.append(Paragraph(f"Santiago, {date.today().strftime('%d/%m/%Y')}", st_meta_r))
    story.append(Spacer(1, 10))

    bloques = (rendered_md or "").split("\n\n")
    for bloque in bloques:
        bloque = bloque.strip()
        if not bloque:
            continue
        if bloque.startswith("### "):
            story.append(Spacer(1, 4))
            story.append(Paragraph(bloque[4:].strip(), st_h3))
        elif bloque.startswith("## "):
            story.append(Spacer(1, 6))
            story.append(Paragraph(bloque[3:].strip(), st_h2))
        elif bloque.startswith("# "):
            story.append(Spacer(1, 8))
            story.append(Paragraph(bloque[2:].strip(), st_h1))
        elif bloque.startswith("<!--"):
            continue
        else:
            html_friendly = bloque.replace("\n", "<br/>")
            story.append(Paragraph(html_friendly, st_p))
            story.append(Spacer(1, 4))

    story.append(Spacer(1, 18))
    story.append(_bloque_firmas(
        rep_legal_nombre, rep_legal_rut,
        firmante_nombre, firmante_rut,
        firma_trabajador_src=firma_firmante_src,
        requiere_firma_trabajador=requiere_firma,
    ))

    story.append(Spacer(1, 10))
    st_foot = _st("footcb", FONT, 7.5, C_MUTED, TA_CENTER, 1.5)
    story.append(Paragraph(
        f"Documento generado automáticamente por el sistema de remuneraciones "
        f"{empresa_razon_social} (RUT {empresa_rut}) el {date.today().strftime('%d/%m/%Y')}.",
        st_foot,
    ))

    doc.build(story)
    return buffer.getvalue()


def generar_pdf_contrato_caminob(
    rendered_md: str,
    titulo: str,
    trabajador: Trabajador,
    version_nueva: ContratoTrabajadorVersion,
    rep_legal_nombre: str = "Adriana Colina Aguilar",
    rep_legal_rut: str = "25.936.753-0",
    empresa_razon_social: str = "E-Courier SPA",
    empresa_rut: str = "—",
    firma_trabajador_src: Optional[str] = None,
    requiere_firma_trabajador: bool = True,
) -> bytes:
    """Wrapper sobre generar_pdf_contrato_generico para el flujo de trabajadores (Camino B)."""
    return generar_pdf_contrato_generico(
        rendered_md=rendered_md,
        titulo=titulo,
        firmante_nombre=trabajador.nombre,
        firmante_rut=trabajador.rut,
        rep_legal_nombre=rep_legal_nombre,
        rep_legal_rut=rep_legal_rut,
        empresa_razon_social=empresa_razon_social,
        empresa_rut=empresa_rut,
        firma_firmante_src=firma_trabajador_src,
        requiere_firma=requiere_firma_trabajador,
    )
