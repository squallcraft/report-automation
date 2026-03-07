"""
Genera el PDF de documentación del sistema de auditoría de ECourier.
Ejecutar: python generate_audit_doc.py
"""
import io
import os
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer,
    PageBreak, ListFlowable, ListItem,
)

PRIMARY = colors.HexColor("#1e3a5f")
ACCENT = colors.HexColor("#2B6CB0")
LIGHT_BG = colors.HexColor("#f0f4f8")
GREEN = colors.HexColor("#276749")
RED = colors.HexColor("#c53030")
GRAY = colors.HexColor("#4a5568")

styles = getSampleStyleSheet()
title_style = ParagraphStyle("DocTitle", parent=styles["Title"], fontSize=24, textColor=PRIMARY, spaceAfter=6)
subtitle_style = ParagraphStyle("DocSubtitle", parent=styles["Normal"], fontSize=12, textColor=GRAY, spaceAfter=20)
h1_style = ParagraphStyle("H1", parent=styles["Heading1"], fontSize=16, textColor=PRIMARY, spaceBefore=18, spaceAfter=8,
                           borderPadding=(0, 0, 4, 0))
h2_style = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=13, textColor=ACCENT, spaceBefore=14, spaceAfter=6)
body_style = ParagraphStyle("Body", parent=styles["Normal"], fontSize=10, leading=14, textColor=colors.black,
                             alignment=TA_JUSTIFY, spaceAfter=6)
code_style = ParagraphStyle("Code", parent=styles["Normal"], fontSize=9, fontName="Courier", textColor=GRAY,
                             backColor=LIGHT_BG, borderPadding=6, spaceAfter=8, leading=12)
note_style = ParagraphStyle("Note", parent=body_style, fontSize=9, textColor=ACCENT, leftIndent=12,
                             borderPadding=4, backColor=LIGHT_BG)

TABLE_STYLE = TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
    ("FONTSIZE", (0, 0), (-1, 0), 9),
    ("FONTSIZE", (0, 1), (-1, -1), 8.5),
    ("ALIGN", (0, 0), (-1, -1), "LEFT"),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e0")),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT_BG]),
    ("TOPPADDING", (0, 0), (-1, -1), 4),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
])


def build_table(headers, rows, col_widths=None):
    data = [headers] + rows
    t = Table(data, colWidths=col_widths, repeatRows=1)
    t.setStyle(TABLE_STYLE)
    return t


def build_pdf():
    output_path = os.path.join(os.path.dirname(__file__), "docs", "Sistema_Auditoria_ECourier.pdf")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    doc = SimpleDocTemplate(
        output_path, pagesize=letter,
        leftMargin=20 * mm, rightMargin=20 * mm,
        topMargin=20 * mm, bottomMargin=20 * mm,
    )
    story = []

    # ── PORTADA ──
    story.append(Spacer(1, 60))
    story.append(Paragraph("Sistema de Auditoría", title_style))
    story.append(Paragraph("ECourier — Plataforma de Liquidación Logística", subtitle_style))
    story.append(Spacer(1, 10))
    story.append(Paragraph(
        "Documentación técnica del sistema de registro de auditoría, trazabilidad de acciones "
        "y control de integridad de datos. Versión 1.0 — Marzo 2026.",
        body_style
    ))
    story.append(Spacer(1, 20))

    # Índice
    story.append(Paragraph("Contenido", h2_style))
    toc_items = [
        "1. Visión general",
        "2. Modelo de datos (AuditLog)",
        "3. Modelo de datos (CartolaCarga)",
        "4. Acciones auditadas",
        "5. Cómo funciona el registro",
        "6. Flujo de cada acción auditada",
        "7. Estructura del campo 'cambios'",
        "8. Estructura del campo 'metadata'",
        "9. Consultas útiles de auditoría",
        "10. Buenas prácticas operativas",
    ]
    for item in toc_items:
        story.append(Paragraph(item, body_style))
    story.append(PageBreak())

    # ── 1. VISIÓN GENERAL ──
    story.append(Paragraph("1. Visión general", h1_style))
    story.append(Paragraph(
        "El sistema de auditoría de ECourier registra automáticamente todas las acciones "
        "relevantes que ocurren en la plataforma. Cada vez que un usuario crea, modifica o "
        "elimina una entidad, carga un archivo, procesa un pago o genera un documento, el "
        "sistema guarda un registro detallado en la tabla <b>audit_logs</b>.",
        body_style
    ))
    story.append(Paragraph(
        "Este registro permite: (a) reconstruir qué pasó y cuándo, (b) identificar quién "
        "realizó cada acción, (c) detectar cambios no autorizados, y (d) cumplir con "
        "requisitos de trazabilidad financiera.",
        body_style
    ))
    story.append(Paragraph(
        "Adicionalmente, cada carga de cartola bancaria (drivers o sellers) genera un "
        "registro en <b>cartola_cargas</b>, vinculando cada pago individual a su archivo "
        "de origen.",
        body_style
    ))

    # ── 2. MODELO AUDIT_LOG ──
    story.append(Paragraph("2. Modelo de datos — AuditLog", h1_style))
    story.append(Paragraph("Tabla: <b>audit_logs</b>", body_style))
    story.append(build_table(
        ["Campo", "Tipo", "Descripción"],
        [
            ["id", "Integer PK", "Identificador único auto-incremental"],
            ["timestamp", "DateTime", "Fecha y hora del evento (UTC, automático)"],
            ["usuario_id", "Integer", "ID del usuario que realizó la acción"],
            ["usuario_nombre", "String", "Nombre del usuario al momento de la acción"],
            ["usuario_rol", "String", "Rol del usuario: ADMIN, ADMINISTRACION, etc."],
            ["ip_address", "String", "Dirección IP del cliente"],
            ["accion", "String", "Identificador de la acción (ver sección 4)"],
            ["entidad", "String", "Tipo de entidad afectada: envio, driver, seller, etc."],
            ["entidad_id", "Integer", "ID de la entidad afectada (null para acciones batch)"],
            ["cambios", "JSONB", "Detalle de campos modificados (ver sección 7)"],
            ["metadata", "JSONB", "Información adicional: archivo, conteos, etc. (ver sección 8)"],
        ],
        col_widths=[80, 70, 380],
    ))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "<b>Nota:</b> Los campos <i>username, action, ip, detail</i> se mantienen por compatibilidad "
        "con los registros de login preexistentes. Las nuevas entradas usan los campos nuevos.",
        note_style
    ))

    # ── 3. MODELO CARTOLA_CARGA ──
    story.append(Paragraph("3. Modelo de datos — CartolaCarga", h1_style))
    story.append(Paragraph("Tabla: <b>cartola_cargas</b>", body_style))
    story.append(build_table(
        ["Campo", "Tipo", "Descripción"],
        [
            ["id", "Integer PK", "Identificador único"],
            ["tipo", "String", "'driver' o 'seller'"],
            ["archivo_nombre", "String", "Nombre original del archivo subido"],
            ["usuario_id", "Integer", "ID del usuario que subió el archivo"],
            ["usuario_nombre", "String", "Nombre del usuario"],
            ["fecha_carga", "DateTime", "Fecha y hora del upload"],
            ["mes, anio", "Integer", "Período al que se asignaron los pagos"],
            ["total_transacciones", "Integer", "Líneas totales del archivo"],
            ["matcheadas", "Integer", "Transacciones vinculadas a un driver/seller"],
            ["no_matcheadas", "Integer", "Transacciones sin match"],
            ["monto_total", "Integer", "Suma de montos matcheados (CLP)"],
            ["detalle", "JSONB", "Resumen de cada transacción procesada"],
        ],
        col_widths=[100, 70, 360],
    ))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "Cada <b>PagoCartola</b> (driver) y <b>PagoCartolaSeller</b> tiene un campo "
        "<b>carga_id</b> que apunta a esta tabla, permitiendo rastrear el origen exacto de "
        "cada pago registrado por cartola.",
        body_style
    ))
    story.append(PageBreak())

    # ── 4. ACCIONES AUDITADAS ──
    story.append(Paragraph("4. Acciones auditadas", h1_style))
    story.append(Paragraph(
        "Cada acción tiene un identificador único (<b>accion</b>) que permite filtrar y buscar "
        "en el registro de auditoría. A continuación se lista cada acción, el módulo donde ocurre "
        "y qué información se registra.",
        body_style
    ))

    story.append(Paragraph("4.1 Ingesta de envíos", h2_style))
    story.append(build_table(
        ["Acción", "Módulo", "Entidad", "Qué registra"],
        [
            ["ingesta_batch", "Ingesta", "envio_batch", "Archivo, task_id, filas procesadas, errores, reproceso"],
            ["resolver_homologacion", "Ingesta", "seller / driver", "Nombre raw, entidad_id, envíos actualizados"],
        ],
        col_widths=[120, 60, 70, 280],
    ))

    story.append(Paragraph("4.2 Pagos a conductores (CPC)", h2_style))
    story.append(build_table(
        ["Acción", "Módulo", "Entidad", "Qué registra"],
        [
            ["carga_cartola_driver", "CPC", "cartola_carga", "Cartola ID, mes/año, transacciones, monto total"],
            ["pago_manual_driver", "CPC", "pago_cartola", "Driver ID, semana, mes/año, estado, monto"],
            ["pago_batch_driver", "CPC", "pago_semana_driver", "Mes/año, cantidad de cambios"],
            ["generar_tef", "CPC", "tef", "Semana/mes/año, cantidad drivers, monto total"],
        ],
        col_widths=[120, 40, 90, 280],
    ))

    story.append(Paragraph("4.3 Facturación y cobros a sellers", h2_style))
    story.append(build_table(
        ["Acción", "Módulo", "Entidad", "Qué registra"],
        [
            ["carga_cartola_seller", "Facturación", "cartola_carga", "Cartola ID, mes/año, transacciones, monto total"],
            ["pago_manual_seller", "Facturación", "pago_semana_seller", "Seller ID, semana, mes/año, estado, monto"],
            ["pago_batch_seller", "Facturación", "pago_semana_seller", "Mes/año, cantidad de cambios"],
            ["generar_facturas", "Facturación", "factura", "Mes/año, seller IDs procesados"],
        ],
        col_widths=[120, 60, 90, 260],
    ))

    story.append(Paragraph("4.4 Retiros y recepciones", h2_style))
    story.append(build_table(
        ["Acción", "Módulo", "Entidad", "Qué registra"],
        [
            ["importar_retiros", "Retiros", "retiro_batch", "Archivo, creados, sin homologar, errores"],
            ["crear_retiro", "Retiros", "retiro", "Seller, driver, fecha, tarifas"],
            ["eliminar_retiro", "Retiros", "retiro", "ID, seller, driver, fecha"],
            ["importar_recepciones", "Pickups", "recepcion_batch", "Archivo, creados, vinculados, errores"],
        ],
        col_widths=[120, 55, 85, 270],
    ))

    story.append(Paragraph("4.5 Gestión de entidades", h2_style))
    story.append(build_table(
        ["Acción", "Entidad", "Qué registra"],
        [
            ["crear_seller / editar_seller / eliminar_seller", "seller", "Datos del seller, campos modificados (diff)"],
            ["crear_driver / editar_driver / eliminar_driver", "driver", "Datos del driver, campos modificados (diff)"],
            ["crear_pickup / editar_pickup / eliminar_pickup", "pickup", "Datos del pickup, campos modificados (diff)"],
            ["editar_envio", "envio", "Cambios en cobro_extra_manual, pago_extra_manual"],
            ["importar_sellers", "seller_batch", "Archivo, creados, actualizados"],
            ["importar_rut_giro", "seller_batch", "Archivo, actualizados"],
            ["importar_homologacion_driver", "driver_batch", "Archivo, aliases, drivers"],
            ["importar_tarifas_driver", "driver_batch", "Archivo, creados, actualizados"],
            ["importar_bancaria_driver", "driver_batch", "Archivo, actualizados"],
        ],
        col_widths=[180, 75, 275],
    ))

    story.append(Paragraph("4.6 Usuarios y seguridad", h2_style))
    story.append(build_table(
        ["Acción", "Entidad", "Qué registra"],
        [
            ["crear_usuario / editar_usuario", "usuario", "Username, rol, nombre, cambios"],
            ["editar_permisos / resetear_permisos", "usuario", "Permisos anteriores y nuevos"],
            ["desactivar_usuario", "usuario", "Username, nombre"],
            ["editar_acceso_seller / editar_acceso_driver", "seller / driver", "Email, cambio de contraseña"],
            ["revocar_acceso_seller / revocar_acceso_driver", "seller / driver", "Nombre de la entidad"],
            ["LOGIN_SUCCESS / LOGIN_FAIL", "auth", "Username, IP (sistema preexistente)"],
            ["RESET_REQUEST / RESET_SUCCESS", "auth", "Email/username, IP"],
        ],
        col_widths=[200, 75, 255],
    ))
    story.append(PageBreak())

    # ── 5. CÓMO FUNCIONA ──
    story.append(Paragraph("5. Cómo funciona el registro", h1_style))
    story.append(Paragraph(
        "El sistema de auditoría opera a nivel de aplicación (no triggers de base de datos). "
        "Esto significa que cada endpoint que necesita ser auditado llama explícitamente a la "
        "función <b>registrar()</b> del servicio de auditoría.",
        body_style
    ))
    story.append(Paragraph("Flujo típico:", body_style))

    steps = [
        "El usuario realiza una acción (ej: sube una cartola, edita un driver).",
        "El endpoint del backend procesa la acción normalmente.",
        "Si la acción es exitosa, el endpoint llama a audit.registrar() con los datos relevantes.",
        "El servicio de auditoría extrae la IP del request y crea un registro en audit_logs.",
        "El registro se persiste en la misma transacción o inmediatamente después.",
    ]
    for i, step in enumerate(steps, 1):
        story.append(Paragraph(f"<b>{i}.</b> {step}", body_style))

    story.append(Spacer(1, 8))
    story.append(Paragraph(
        "Para acciones batch (cartolas, ingesta), el sistema crea una única entrada de "
        "auditoría con el resumen del batch (archivos procesados, conteos, errores) en vez "
        "de una entrada por cada registro individual.",
        note_style
    ))

    # ── 6. FLUJO POR ACCIÓN ──
    story.append(Paragraph("6. Flujo de cada acción auditada", h1_style))

    story.append(Paragraph("6.1 Carga de cartola bancaria", h2_style))
    flow_steps = [
        "Admin sube archivo Excel de cartola (.xls/.xlsx) desde CPC o Facturación.",
        "El sistema parsea el archivo y muestra preview con matches/no-matches.",
        "Admin confirma los matches y el sistema crea los registros de pago.",
        "Se crea un registro <b>CartolaCarga</b> con el resumen del archivo.",
        "Cada <b>PagoCartola/PagoCartolaSeller</b> se vincula al CartolaCarga via <b>carga_id</b>.",
        "Se registra en <b>audit_logs</b> con acción 'carga_cartola_driver' o 'carga_cartola_seller'.",
    ]
    for i, step in enumerate(flow_steps, 1):
        story.append(Paragraph(f"{i}. {step}", body_style))

    story.append(Paragraph("6.2 Pago manual", h2_style))
    manual_steps = [
        "Admin marca un driver/seller como PAGADO en la tabla de CPC/Facturación.",
        "El sistema crea un <b>PagoCartola</b> con fuente='manual'.",
        "Se registra en audit_logs con acción 'pago_manual_driver' o 'pago_manual_seller'.",
    ]
    for i, step in enumerate(manual_steps, 1):
        story.append(Paragraph(f"{i}. {step}", body_style))

    story.append(Paragraph("6.3 Generación de TEF", h2_style))
    tef_steps = [
        "Admin selecciona drivers y montos a pagar, genera archivo TEF.",
        "El sistema genera el archivo .TXT en formato Banco de Chile.",
        "Se registra en audit_logs: drivers incluidos, monto total, período.",
    ]
    for i, step in enumerate(tef_steps, 1):
        story.append(Paragraph(f"{i}. {step}", body_style))

    story.append(Paragraph("6.4 Edición de entidades (seller/driver/pickup)", h2_style))
    edit_steps = [
        "Admin modifica datos de un seller, driver o pickup desde el formulario.",
        "El sistema captura los valores anteriores de los campos financieros.",
        "Aplica los cambios y calcula el diff (campos que efectivamente cambiaron).",
        "Registra en audit_logs solo si hay cambios reales, con el diff completo.",
    ]
    for i, step in enumerate(edit_steps, 1):
        story.append(Paragraph(f"{i}. {step}", body_style))
    story.append(PageBreak())

    # ── 7. ESTRUCTURA CAMBIOS ──
    story.append(Paragraph("7. Estructura del campo 'cambios'", h1_style))
    story.append(Paragraph(
        "El campo <b>cambios</b> es un objeto JSON que registra qué campos fueron "
        "modificados en una acción de edición. Solo se incluyen campos que efectivamente "
        "cambiaron de valor.",
        body_style
    ))
    story.append(Paragraph("Formato:", body_style))
    story.append(Paragraph(
        '{\n'
        '  "precio_base": {"antes": 2500, "despues": 2800},\n'
        '  "tarifa_retiro": {"antes": 0, "despues": 500},\n'
        '  "aliases": {"antes": ["Tienda X"], "despues": ["Tienda X", "TX"]}\n'
        '}',
        code_style
    ))
    story.append(Paragraph(
        "Para acciones de creación, el campo <b>cambios</b> es null (la información se "
        "registra en <b>metadata</b>). Para eliminaciones, se registran los datos clave de "
        "la entidad eliminada en metadata.",
        body_style
    ))

    # ── 8. ESTRUCTURA METADATA ──
    story.append(Paragraph("8. Estructura del campo 'metadata'", h1_style))
    story.append(Paragraph(
        "El campo <b>metadata</b> contiene información contextual que complementa la acción "
        "pero no es un diff de campos. Ejemplos por tipo de acción:",
        body_style
    ))
    story.append(Paragraph("Ingesta batch:", body_style))
    story.append(Paragraph(
        '{"archivo": "reporte_marzo.xlsx", "task_id": "abc123", '
        '"total_filas": 450, "procesados": 430, "errores": 20}',
        code_style
    ))
    story.append(Paragraph("Carga de cartola:", body_style))
    story.append(Paragraph(
        '{"mes": 3, "anio": 2026, "transacciones": 15, "monto_total": 2500000}',
        code_style
    ))
    story.append(Paragraph("Generación TEF:", body_style))
    story.append(Paragraph(
        '{"semana": 1, "mes": 3, "anio": 2026, "drivers": 12, "monto_total": 3200000}',
        code_style
    ))
    story.append(Paragraph("Creación de entidad:", body_style))
    story.append(Paragraph(
        '{"nombre": "Nuevo Seller", "precio_base": 2500, "plan_tarifario": "estandar"}',
        code_style
    ))

    # ── 9. CONSULTAS ÚTILES ──
    story.append(Paragraph("9. Consultas útiles de auditoría", h1_style))
    story.append(Paragraph("Todas las acciones de un usuario específico:", body_style))
    story.append(Paragraph(
        "SELECT * FROM audit_logs\n"
        "WHERE usuario_nombre = 'Oscar'\n"
        "ORDER BY timestamp DESC\n"
        "LIMIT 50;",
        code_style
    ))
    story.append(Paragraph("Historial de cambios de un envío:", body_style))
    story.append(Paragraph(
        "SELECT * FROM audit_logs\n"
        "WHERE entidad = 'envio' AND entidad_id = 12345\n"
        "ORDER BY timestamp DESC;",
        code_style
    ))
    story.append(Paragraph("Todas las cargas de cartola de un mes:", body_style))
    story.append(Paragraph(
        "SELECT * FROM cartola_cargas\n"
        "WHERE mes = 3 AND anio = 2026\n"
        "ORDER BY fecha_carga DESC;",
        code_style
    ))
    story.append(Paragraph("Pagos de un driver con su carga de origen:", body_style))
    story.append(Paragraph(
        "SELECT p.*, c.archivo_nombre, c.fecha_carga, c.usuario_nombre\n"
        "FROM pagos_cartola_drivers p\n"
        "LEFT JOIN cartola_cargas c ON p.carga_id = c.id\n"
        "WHERE p.driver_id = 10\n"
        "ORDER BY p.created_at DESC;",
        code_style
    ))
    story.append(Paragraph("Cambios de tarifas en un rango de fechas:", body_style))
    story.append(Paragraph(
        "SELECT * FROM audit_logs\n"
        "WHERE accion IN ('editar_seller', 'editar_driver')\n"
        "  AND cambios IS NOT NULL\n"
        "  AND timestamp >= '2026-03-01'\n"
        "ORDER BY timestamp DESC;",
        code_style
    ))
    story.append(Paragraph("Resumen de acciones por tipo:", body_style))
    story.append(Paragraph(
        "SELECT accion, COUNT(*) as total,\n"
        "       MIN(timestamp) as primera, MAX(timestamp) as ultima\n"
        "FROM audit_logs\n"
        "WHERE accion IS NOT NULL\n"
        "GROUP BY accion\n"
        "ORDER BY total DESC;",
        code_style
    ))
    story.append(PageBreak())

    # ── 10. BUENAS PRÁCTICAS ──
    story.append(Paragraph("10. Buenas prácticas operativas", h1_style))

    practices = [
        ("<b>Revisar periódicamente.</b> Al menos una vez al mes, revisar las acciones de "
         "auditoría para detectar patrones inusuales: ediciones masivas, pagos manuales "
         "frecuentes, o cambios de tarifas inesperados."),
        ("<b>No modificar audit_logs directamente.</b> La tabla de auditoría es de solo "
         "escritura. Nunca ejecutar UPDATE o DELETE sobre ella. Si un registro es erróneo, "
         "se documenta con una nueva entrada, no se modifica la existente."),
        ("<b>Usar cartola_cargas como referencia.</b> Ante cualquier discrepancia en un pago, "
         "consultar la tabla cartola_cargas para identificar el archivo original y quién lo subió."),
        ("<b>Verificar antes de editar tarifas.</b> Los cambios de tarifa en sellers, drivers "
         "y pickups quedan registrados con valores anteriores y nuevos. Verificar que el cambio "
         "fue intencional comparando los valores del diff."),
        ("<b>Contraseñas.</b> Los cambios de contraseña se auditan, pero el valor de la "
         "contraseña nunca se registra en el log. Solo se indica que hubo un cambio."),
        ("<b>Acciones batch.</b> Las cargas masivas (ingesta, cartolas, retiros) registran "
         "una sola entrada de auditoría con el resumen. Para el detalle individual, consultar "
         "las tablas correspondientes (logs_ingesta, cartola_cargas)."),
    ]
    for p in practices:
        story.append(Paragraph(f"• {p}", body_style))

    story.append(Spacer(1, 30))
    story.append(Paragraph(
        "— Documento generado automáticamente por ECourier. Marzo 2026. —",
        ParagraphStyle("Footer", parent=body_style, alignment=TA_CENTER, textColor=GRAY, fontSize=8)
    ))

    doc.build(story)
    print(f"PDF generado: {output_path}")
    return output_path


if __name__ == "__main__":
    build_pdf()
