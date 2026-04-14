"""
Genera el PDF del Acuerdo de Prestación de Servicios Independientes de Ecourier.
Ejecutar: python3 scripts/generar_acuerdo_pdf.py
"""
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import cm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
from reportlab.lib.colors import HexColor
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, HRFlowable, Table, TableStyle, KeepTogether
)

OUTPUT = (
    "/Users/oscarguzman/Library/CloudStorage/OneDrive-grupoenix.com"
    "/OneDrive Personal/PROYECTOS/Proyectos/E-Courier/Comercial/Contratos"
    "/2026/Colaboradores - Conductores"
    "/ACUERDO DE PRESTACION DE SERVICIOS INDEPENDIENTES.pdf"
)

GRIS_OSCURO = HexColor("#1a1a1a")
GRIS_MEDIO  = HexColor("#555555")
AZUL_SUTIL  = HexColor("#e8edf5")
BORDE_AZUL  = HexColor("#c0ccee")
GRIS_LINEA  = HexColor("#cccccc")

doc = SimpleDocTemplate(
    OUTPUT,
    pagesize=LETTER,
    topMargin=2.5*cm, bottomMargin=2.5*cm,
    leftMargin=3*cm, rightMargin=3*cm,
    title="Acuerdo de Prestacion de Servicios Independientes - Ecourier",
)

base = getSampleStyleSheet()

s_titulo = ParagraphStyle("titulo", parent=base["Normal"],
    fontSize=13, leading=18, textColor=GRIS_OSCURO,
    fontName="Helvetica-Bold", alignment=TA_CENTER, spaceAfter=4)

s_subtitulo = ParagraphStyle("subtitulo", parent=base["Normal"],
    fontSize=10, leading=14, textColor=GRIS_MEDIO,
    fontName="Helvetica", alignment=TA_CENTER, spaceAfter=18)

s_clausula = ParagraphStyle("clausula", parent=base["Normal"],
    fontSize=10, leading=14, textColor=GRIS_OSCURO,
    fontName="Helvetica-Bold", spaceBefore=14, spaceAfter=4)

s_cuerpo = ParagraphStyle("cuerpo", parent=base["Normal"],
    fontSize=9.5, leading=14, textColor=GRIS_OSCURO,
    fontName="Helvetica", alignment=TA_JUSTIFY, spaceAfter=5)

s_bullet = ParagraphStyle("bullet", parent=base["Normal"],
    fontSize=9.5, leading=13.5, textColor=GRIS_OSCURO,
    fontName="Helvetica", alignment=TA_LEFT,
    leftIndent=14, spaceAfter=3, bulletIndent=4)

s_partes = ParagraphStyle("partes", parent=base["Normal"],
    fontSize=9.5, leading=14, textColor=GRIS_OSCURO,
    fontName="Helvetica", spaceAfter=4)

s_pie = ParagraphStyle("pie", parent=base["Normal"],
    fontSize=8.5, leading=12, textColor=GRIS_MEDIO,
    fontName="Helvetica", alignment=TA_CENTER, spaceBefore=10)

story = []

# Encabezado
story.append(Paragraph("ACUERDO DE PRESTACION DE SERVICIOS INDEPENDIENTES", s_titulo))
story.append(Paragraph("Ecourier \u2014 Prestador de Servicios", s_subtitulo))
story.append(HRFlowable(width="100%", thickness=1, color=GRIS_OSCURO, spaceAfter=16))

# Partes
partes = [
    "<b>LOGISTICA Y TRANSPORTE E-COURIER SPA</b>, RUT [\xb7], con domicilio en [\xb7], Santiago (en adelante <b>\"Ecourier\"</b>),",
    "y el <b>Prestador de Servicios</b> identificado al momento de la aceptacion digital de este Acuerdo en la plataforma de facturacion de Ecourier,",
    "celebran el siguiente acuerdo de prestacion de servicios independientes, en conformidad con las normas del Codigo Civil y la legislacion vigente aplicable a prestadores independientes.",
]
tabla_partes = Table(
    [[Paragraph(p, s_partes)] for p in partes],
    colWidths=["100%"]
)
tabla_partes.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,-1), AZUL_SUTIL),
    ("BOX", (0,0), (-1,-1), 0.5, BORDE_AZUL),
    ("LEFTPADDING", (0,0), (-1,-1), 14),
    ("RIGHTPADDING", (0,0), (-1,-1), 14),
    ("TOPPADDING", (0,0), (0,0), 10),
    ("BOTTOMPADDING", (0,-1), (-1,-1), 10),
    ("TOPPADDING", (0,1), (-1,-2), 3),
    ("BOTTOMPADDING", (0,0), (-1,-2), 2),
]))
story.append(tabla_partes)
story.append(Spacer(1, 18))


def clausula(n, titulo_txt, parrafos=None, bullets=None, cierre=None):
    bloque = []
    bloque.append(Paragraph(f"{n}. {titulo_txt.upper()}", s_clausula))
    for p in (parrafos or []):
        bloque.append(Paragraph(p, s_cuerpo))
    for b in (bullets or []):
        bloque.append(Paragraph(f"\u2022  {b}", s_bullet))
    if cierre:
        bloque.append(Paragraph(cierre, s_cuerpo))
    story.append(KeepTogether(bloque))


clausula("1", "Objeto y Vigencia", parrafos=[
    "El Prestador presta a Ecourier servicios de retiro y entrega de carga de manera <b>autonoma e independiente</b>, utilizando su propio vehiculo y recursos. Cada encargo (ruta diaria) constituye una prestacion de servicios independiente, coordinada previamente entre las partes.",
    "Este Acuerdo es de <b>duracion indefinida</b> y puede ser terminado en cualquier momento por cualquiera de las partes conforme a lo establecido en la clausula 13.",
    "Ecourier opera una plataforma digital de trazabilidad operativa que el Prestador utiliza como herramienta de registro de entregas durante la ejecucion de cada encargo. Esta plataforma <b>no es un sistema de intermediacion en tiempo real</b> ni determina la disponibilidad ni los ingresos del Prestador.",
])

clausula("2", "Naturaleza de la Relacion", parrafos=[
    "Las partes declaran expresamente que:",
], bullets=[
    "No existe vinculo de subordinacion ni dependencia laboral entre ellas.",
    "El Prestador <b>no esta sujeto a jornada laboral</b> ni a horario fijo impuesto por Ecourier.",
    "Cada ruta o encargo es coordinado voluntariamente y aceptado libremente por el Prestador.",
    "El Prestador puede <b>declinar encargos</b> sin penalizacion; solo renuncia a los ingresos de esa jornada.",
    "El Prestador <b>puede prestar servicios simultaneos o paralelos</b> a otras empresas o personas, sin restriccion ni exclusividad.",
    "El Prestador es responsable de su propio vehiculo, permisos, seguros, documentacion y combustible.",
    "El Prestador emite <b>boleta de honorarios o factura</b> por los servicios prestados y es responsable de sus cotizaciones previsionales y obligaciones tributarias.",
    "El Prestador actua con plena autonomia. <b>Ecourier no asume responsabilidad alguna por danos o perjuicios causados a terceros</b> por el Prestador durante la prestacion de servicios.",
])

clausula("3", "Coordinacion Operativa", parrafos=[
    "Ecourier coordina con el Prestador los encargos disponibles en el dia segun el volumen de paqueteria y las zonas de entrega. La coordinacion se basa en disponibilidad informada y acuerdo mutuo.",
    "Se valora que el Prestador informe con anticipacion cuando no este disponible:",
], bullets=[
    "Ausencias de un dia: aviso minimo con 12 horas de anticipacion, salvo emergencia.",
    "Ausencias de varios dias o vacaciones: aviso con al menos 15 dias de anticipacion.",
    "En periodos de alta demanda (Navidad, CyberDay, Black Friday, Fiestas Patrias y otros informados): aviso con al menos <b>30 dias de anticipacion</b>. Las emergencias siempre son consideradas.",
], cierre="La falta de aviso oportuno <b>no genera penalizacion</b>, pero puede afectar la asignacion de encargos futuros.")

clausula("4", "Uso de la Plataforma Digital \u2014 Acceso Personal e Intransferible", parrafos=[
    "El Prestador utiliza la aplicacion de Ecourier como herramienta de trazabilidad durante la ejecucion de cada encargo: registro fotografico de entregas, actualizacion de estados e informe de incidencias.",
    "Las credenciales de acceso son <b>estrictamente personales e intransferibles</b>. Queda prohibido cederlas, compartirlas o permitir su uso a terceros. Toda actividad registrada bajo las credenciales del Prestador es de su exclusiva responsabilidad. El incumplimiento es causal de termino inmediato.",
])

clausula("5", "Estandares de Calidad del Servicio", parrafos=[
    "Para mantener una colaboracion productiva y la confianza de los clientes de Ecourier, el Prestador se compromete a:",
], bullets=[
    "Manipular la carga con cuidado, verificando que coincida con la guia antes de retirarla, y reportando cualquier dano o anomalia.",
    "No abrir ni alterar empaques bajo ninguna circunstancia.",
    "Mantener un trato respetuoso y profesional con los destinatarios y clientes.",
    "Respetar las normas de transito vigentes y mantener la documentacion del vehiculo al dia.",
    "Utilizar los canales oficiales de comunicacion con el equipo de operaciones.",
    "Abstenerse de realizar negociaciones paralelas con clientes de Ecourier o solicitar datos personales de destinatarios o propinas.",
    "Abstenerse de hacer comentarios negativos sobre Ecourier, sus clientes o sus operaciones frente a terceros.",
], cierre="El incumplimiento grave o reiterado puede ser causal de termino de la colaboracion.")

clausula("6", "Proteccion de Datos Personales", parrafos=[
    "En conformidad con la <b>Ley N\xb0 19.628</b> sobre Proteccion de la Vida Privada, el Prestador utilizara los datos personales de destinatarios unicamente para los fines de la entrega, no los almacenara fuera de la plataforma de Ecourier, y no los compartira con terceros bajo ninguna circunstancia.",
    "El incumplimiento puede derivar en responsabilidad civil y penal para el Prestador, con independencia del termino de la colaboracion.",
])

clausula("7", "Seguridad Personal", parrafos=[
    "El Prestador prioriza en todo momento su integridad fisica por sobre la carga o cualquier otro objetivo operativo. Se recomienda el uso de calzado de seguridad y chaleco reflectante. El Prestador es responsable de contar con los elementos que estime necesarios para su proteccion.",
    "Ecourier evaluara, a medida que su situacion financiera lo permita, mecanismos de apoyo en materia de seguridad y bienestar para sus prestadores.",
])

clausula("8", "Protocolo en caso de Robo, Hurto o Asalto", parrafos=[
    "En caso de asalto o robo durante la prestacion de servicios:",
], bullets=[
    "No oponer resistencia. La integridad fisica es la prioridad absoluta.",
    "Comunicar de inmediato a operaciones: ubicacion, hora, detalles y estado del Prestador.",
    "Realizar denuncia en Carabineros dentro de las 24 horas siguientes y enviar copia a Ecourier.",
    "Completar el formulario interno de incidente.",
], cierre="Si el evento se determina como negligente del Prestador, puede ser causal de termino conforme a la clausula 9.")

clausula("9", "Responsabilidad por la Carga", parrafos=[
    "El Prestador es responsable de la carga desde su recepcion hasta la entrega, salvo fuerza mayor o delito debidamente denunciado. En casos de <b>negligencia comprobada</b>, se seguira el siguiente procedimiento:",
], bullets=[
    "Ecourier notificara al Prestador por escrito los hechos y el monto estimado del perjuicio.",
    "El Prestador tendra <b>5 dias habiles</b> para presentar sus descargos.",
    "Ecourier resolvera y comunicara su decision fundada.",
    "El cobro, si procede, no podra exceder el <b>valor declarado de la carga afectada</b>.",
])

clausula("10", "Responsabilidad por Infracciones de Transito", parrafos=[
    "Toda multa, infraccion o sancion de transito ocurrida durante la prestacion de servicios es de <b>exclusiva responsabilidad del Prestador</b>, incluyendo aquellas derivadas del estado del vehiculo, documentacion vencida o conducta al volante. Ecourier no asume ninguna responsabilidad en esta materia.",
])

clausula("11", "Tarifas y Condiciones Economicas", parrafos=[
    "Las tarifas aplicables a cada servicio son las que Ecourier tiene <b>vigentes al momento de la prestacion</b>, consultables en todo momento en el perfil del Prestador dentro de la plataforma de facturacion de Ecourier.",
    "Ecourier podra modificarlas con <b>30 dias de aviso previo</b>, notificado mediante la plataforma y/o canal oficial de mensajeria.",
    "Los pagos se realizan contra emision de <b>boleta de honorarios o factura</b> por parte del Prestador, en los plazos acordados operativamente.",
])

clausula("12", "Confidencialidad", parrafos=[
    "Durante la colaboracion y hasta <b>24 meses despues de su termino</b>, el Prestador mantendra estricta confidencialidad sobre: datos de clientes y destinatarios, direcciones y rutas, tarifas y condiciones comerciales, procesos operativos e informacion logistica, y estrategias comerciales de Ecourier.",
    "Queda prohibido compartir esta informacion con terceros, utilizarla para beneficio propio o de competidores, almacenar bases de datos de clientes, o difundir fotografias, documentos u operaciones internas sin autorizacion expresa.",
    "El incumplimiento puede derivar en acciones legales, independientemente del termino de la colaboracion.",
])

clausula("13", "Termino de la Colaboracion", parrafos=[
    "Cualquiera de las partes puede terminar esta colaboracion en cualquier momento, sin expresion de causa y <b>sin derecho a indemnizacion</b>, mediante comunicacion por correo electronico o canal oficial de mensajeria.",
    "Son causales de termino inmediato por parte de Ecourier:",
], bullets=[
    "Incumplimientos graves o reiterados de los estandares de calidad.",
    "Faltas graves de conducta con clientes o destinatarios.",
    "Perdida de carga por negligencia comprobada.",
    "Falsificacion de informacion o registros.",
    "Uso indebido de informacion confidencial o datos personales de terceros.",
    "Manipulacion indebida de paquetes o cesion de credenciales de plataforma a terceros.",
])

clausula("14", "Ley Aplicable y Resolucion de Disputas", parrafos=[
    "Este Acuerdo se rige por las leyes de la Republica de Chile. Cualquier controversia derivada de su interpretacion, cumplimiento o termino sera sometida a la jurisdiccion de los <b>Tribunales Ordinarios de Justicia de Santiago</b>, renunciando las partes a cualquier otro fuero que pudiera corresponderles.",
])

clausula("15", "Modificaciones al Acuerdo", parrafos=[
    "Ecourier podra modificar los terminos de este Acuerdo con <b>30 dias de aviso previo</b>, notificado mediante la plataforma y/o canal oficial de mensajeria. Si el Prestador continua prestando servicios tras el vencimiento del plazo, se entendera que acepta las modificaciones.",
])

clausula("16", "Aceptacion Digital", parrafos=[
    "Este Acuerdo se acepta de forma electronica a traves de la plataforma de facturacion de Ecourier, en conformidad con la <b>Ley N\xb0 19.799 sobre Documentos Electronicos, Firma Electronica y Servicios de Certificacion</b>.",
    "La aceptacion se formaliza mediante el ingreso del <b>RUT del Prestador</b> y su <b>firma dibujada digitalmente</b>, quedando registrados en el sistema: nombre completo, RUT, fecha, hora y version del documento. Este registro tiene plena validez legal.",
    "El Prestador declara haber leido y comprendido integra mente este Acuerdo antes de aceptarlo. Ante cualquier duda, puede contactar a Ecourier antes de proceder.",
])

# Pie
story.append(Spacer(1, 20))
story.append(HRFlowable(width="100%", thickness=0.5, color=GRIS_LINEA, spaceAfter=10))
story.append(Paragraph("Version 1.0 \u00b7 Abril 2026 \u00b7 Logistica y Transporte E-Courier SpA", s_pie))

doc.build(story)
print("PDF generado:", OUTPUT)
