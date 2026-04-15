"""
Genera el PDF del Acuerdo de Prestación de Servicios Independientes de Ecourier.
Versión 2.0 — Fusión documento abogada + operativo Ecourier.
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
    "/ACUERDO DE PRESTACION DE SERVICIOS INDEPENDIENTES v2.pdf"
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
    title="Acuerdo de Prestacion de Servicios Independientes - Ecourier v2.0",
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

story.append(Paragraph("ACUERDO DE PRESTACION DE SERVICIOS INDEPENDIENTES", s_titulo))
story.append(Paragraph("Ecourier \u2014 Prestador de Servicios", s_subtitulo))
story.append(HRFlowable(width="100%", thickness=1, color=GRIS_OSCURO, spaceAfter=16))

partes = [
    "En Santiago, entre <b>LOGISTICA Y TRANSPORTE E-COURIER SpA</b>, RUT N\xb0 77.512.163-7, con domicilio en Moneda N\xb01137, Oficina 56, comuna de Santiago, en adelante \"Ecourier\";",
    "y el <b>Prestador de Servicios</b> identificado al momento de la aceptacion digital de este Acuerdo en la plataforma de facturacion de Ecourier,",
    "se ha convenido el siguiente Acuerdo de Prestacion de Servicios Independientes:",
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


clausula("1", "Naturaleza del Acuerdo", parrafos=[
    "Las partes declaran expresa y categoricamente que el presente acuerdo tiene caracter <b>estrictamente civil y comercial</b>, rigiendose por las disposiciones del Codigo Civil y demas normativa aplicable.",
    "No existe entre ellas vinculo de subordinacion ni dependencia, ni relacion laboral en los terminos del Codigo del Trabajo, por cuanto el Prestador ejecuta sus servicios de manera autonoma, por cuenta propia, bajo su exclusivo riesgo y responsabilidad.",
    "El Prestador <b>no forma parte de la estructura organizacional</b> de Ecourier, no estando sujeto a jerarquia, dependencia ni integracion funcional dentro de la empresa.",
])

clausula("2", "Objeto de los Servicios", parrafos=[
    "El presente acuerdo tiene por objeto la prestacion de servicios de retiro, transporte y entrega de mercancias por parte del Prestador, quien utilizara para ello sus propios medios materiales, incluyendo vehiculo, combustible, dispositivos tecnologicos y demas herramientas necesarias. Cada servicio encomendado constituira una prestacion independiente, que debera ser previamente aceptada por el Prestador en forma libre y voluntaria.",
    "Este Acuerdo es de <b>duracion indefinida</b> y puede ser terminado en cualquier momento por cualquiera de las partes conforme a lo establecido en la clausula de Terminacion.",
])

clausula("3", "Autonomia, Libertad Operativa y Zona Geografica", parrafos=[
    "El Prestador gozara de plena autonomia en la organizacion y ejecucion de sus servicios, pudiendo determinar libremente su disponibilidad, horarios, dias de trabajo y forma de prestacion. Podra <b>aceptar o rechazar cualquier servicio sin expresion de causa</b>, sin que ello implique sancion, penalizacion ni afectacion alguna. No existe clausula de exclusividad; el Prestador puede prestar servicios a terceros sin restriccion.",
    "El Prestador podra ejecutar servicios en las zonas geograficas donde Ecourier mantenga operaciones. La sugerencia de zonas, rutas o areas de operacion tendra caracter meramente referencial, no constituyendo una instruccion obligatoria. El Prestador es responsable de evaluar las condiciones de seguridad, distancia y conveniencia de cada servicio, asumiendo los costos asociados a su desplazamiento.",
])

clausula("4", "Uso de la Plataforma Digital \u2014 Acceso Personal e Intransferible", parrafos=[
    "La plataforma digital de Ecourier constituye unicamente una herramienta tecnologica destinada a facilitar la coordinacion, registro y trazabilidad de los servicios. Su utilizacion <b>no implica el ejercicio de facultades de direccion, control laboral o supervision jerarquica</b> por parte de Ecourier. No es un sistema de intermediacion en tiempo real y no determina la disponibilidad ni los ingresos del Prestador.",
    "Las credenciales de acceso son <b>estrictamente personales e intransferibles</b>. Queda prohibido cederlas, compartirlas o permitir su uso a terceros. Toda actividad registrada bajo las credenciales del Prestador es de su exclusiva responsabilidad. El incumplimiento es causal de termino inmediato.",
])

clausula("5", "Coordinacion Operativa", parrafos=[
    "Las comunicaciones y coordinaciones tendran caracter estrictamente colaborativo. Las sugerencias o recomendaciones de Ecourier tendran naturaleza referencial y no obligatoria, no constituyendo instrucciones laborales.",
    "Se valora que el Prestador informe con anticipacion cuando no este disponible:",
], bullets=[
    "Ausencias de un dia: aviso minimo con 12 horas de anticipacion, salvo emergencia.",
    "Ausencias de varios dias o vacaciones: aviso con al menos 15 dias de anticipacion.",
    "En periodos de alta demanda (Navidad, CyberDay, Black Friday, Fiestas Patrias y otros informados): aviso con al menos <b>30 dias de anticipacion</b>.",
], cierre="La falta de aviso oportuno <b>no genera penalizacion</b>, pero puede afectar la asignacion de encargos futuros.")

clausula("6", "Estandares de Calidad del Servicio", parrafos=[
    "El Prestador ejecutara los servicios en forma diligente conforme a los estandares de calidad y buenas practicas de la actividad. Se compromete a:",
], bullets=[
    "Manipular la carga con cuidado, verificando que coincida con la guia antes de retirarla, y reportando cualquier dano o anomalia.",
    "No abrir ni alterar empaques bajo ninguna circunstancia.",
    "Mantener un trato respetuoso y profesional con los destinatarios y clientes.",
    "Respetar las normas de transito vigentes y mantener la documentacion del vehiculo al dia.",
    "Utilizar los canales oficiales de comunicacion con el equipo de operaciones.",
    "Abstenerse de realizar negociaciones paralelas con clientes de Ecourier o solicitar datos personales de destinatarios o propinas.",
], cierre="El incumplimiento grave o reiterado puede ser causal de termino de la colaboracion conforme a la clausula de Incumplimientos.")

clausula("7", "Regimen de Incumplimientos", parrafos=[
    "<b>Clasificacion:</b> a) <i>Incumplimientos leves:</i> aquellos que no afecten sustancialmente la ejecucion del servicio (retrasos menores, omisiones formales, errores subsanables sin perjuicio economico relevante). b) <i>Incumplimientos graves:</i> aquellos que afecten la ejecucion del servicio, la experiencia del cliente o la integridad de la carga, especialmente cuando generen perjuicio economico (entregas fallidas imputables, manipulacion indebida, perdida o dano de carga, infracciones relevantes). c) <i>Incumplimientos reiterados:</i> dos o mas incumplimientos en un periodo de 30 dias corridos; constituyen causal suficiente para terminar el acuerdo.",
    "<b>Medidas:</b> Los leves generan amonestacion escrita. Los graves, cuando generan perjuicio economico directo, obligan al Prestador a indemnizar el dano acreditado (dolo o culpa grave), pudiendo Ecourier compensar de pagos pendientes. Los reiterados facultan el termino inmediato.",
    "<b>Procedimiento:</b> Previo a medidas economicas o termino, Ecourier notificara al Prestador, otorgara 5 dias habiles para descargos y resolvera con decision fundada. La responsabilidad economica se limita al dano directo con tope en el valor de la carga o servicio afectado, salvo dolo.",
])

clausula("8", "Responsabilidad y Riesgo", parrafos=[
    "El Prestador actuara en todo momento por cuenta propia, respondiendo unicamente por danos consecuencia directa de su dolo o culpa grave debidamente acreditados. No respondera por caso fortuito, fuerza mayor o actos de terceros.",
    "La responsabilidad frente a Ecourier se limita a los danos directos ocasionados por incumplimientos graves, con tope en el valor del servicio o carga involucrada, salvo dolo. <b>Ecourier no sera responsable por los actos ejecutados por el Prestador en el ejercicio autonomo de su actividad.</b>",
])

clausula("9", "Seguridad Personal y Protocolo de Robo", parrafos=[
    "El Prestador prioriza en todo momento su <b>integridad fisica</b> por sobre la carga o cualquier otro objetivo. Se recomienda el uso de calzado de seguridad y chaleco reflectante.",
    "En caso de asalto o robo durante la prestacion de servicios:",
], bullets=[
    "No oponer resistencia. La integridad fisica es la prioridad absoluta.",
    "Comunicar de inmediato a operaciones: ubicacion, hora, detalles y estado del Prestador.",
    "Realizar denuncia en Carabineros dentro de las 24 horas siguientes y enviar copia a Ecourier.",
    "Completar el formulario interno de incidente.",
])

clausula("10", "Responsabilidad por Infracciones de Transito", parrafos=[
    "Toda multa, infraccion o sancion de transito ocurrida durante la prestacion de servicios es de <b>exclusiva responsabilidad del Prestador</b>, incluyendo aquellas derivadas del estado del vehiculo, documentacion vencida o conducta al volante. Ecourier no asume ninguna responsabilidad en esta materia.",
])

clausula("11", "Tarifas y Condiciones Economicas", parrafos=[
    "Los servicios seran remunerados conforme a las tarifas vigentes, consultables en todo momento en el perfil del Prestador dentro de la plataforma de facturacion de Ecourier. Las tarifas se detallan en el <b>Anexo de Tarifas</b>, el cual se actualiza automaticamente ante cualquier cambio. Ecourier podra modificarlas con <b>30 dias de aviso previo</b>.",
    "No existe remuneracion fija, continuidad asegurada ni garantia de ingresos minimos. El Prestador debera emitir <b>boleta de honorarios o factura</b> como requisito para el pago.",
])

clausula("12", "Proteccion de Datos Personales", parrafos=[
    "En conformidad con la <b>Ley N\xb0 19.628</b>, el Prestador usara los datos personales de destinatarios unicamente para fines de la entrega, no los almacenara fuera de la plataforma y no los compartira con terceros.",
    "El Prestador autoriza expresamente a Ecourier para el tratamiento de sus datos personales (identificacion, contacto, ubicacion geografica y registros operativos) con la finalidad de gestionar la relacion contractual. El Prestador podra ejercer sus derechos de acceso, rectificacion, cancelacion y oposicion conforme a la normativa vigente.",
])

clausula("13", "Trazabilidad y Prueba", parrafos=[
    "Las partes acuerdan que toda informacion relativa a la ejecucion de los servicios, incluyendo registros en la plataforma, comunicaciones electronicas y evidencia digital, constituira <b>medio valido de prueba</b> para determinar el cumplimiento de las obligaciones.",
])

clausula("14", "Confidencialidad", parrafos=[
    "El Prestador mantiene estricta confidencialidad sobre datos de clientes, rutas, tarifas, procesos operativos y estrategias comerciales durante la colaboracion y por <b>24 meses despues de su termino</b>. Queda prohibido compartir esta informacion con terceros o utilizarla para beneficio propio o de competidores. El incumplimiento puede derivar en acciones legales.",
])

clausula("15", "Terminacion", parrafos=[
    "El presente acuerdo podra ser terminado por cualquiera de las partes en cualquier momento, sin expresion de causa y <b>sin derecho a indemnizacion</b>, mediante comunicacion simple.",
    "Son causales de termino inmediato por parte de Ecourier:",
], bullets=[
    "Incumplimientos graves o reiterados de los estandares de calidad.",
    "Faltas graves de conducta con clientes o destinatarios.",
    "Perdida de carga por negligencia comprobada.",
    "Falsificacion de informacion o registros.",
    "Uso indebido de informacion confidencial o datos personales de terceros.",
    "Manipulacion indebida de paquetes o cesion de credenciales de plataforma a terceros.",
])

clausula("16", "Ley Aplicable y Resolucion de Disputas", parrafos=[
    "Este Acuerdo se rige por las leyes de la Republica de Chile. Las controversias seran sometidas a la jurisdiccion de los <b>Tribunales Ordinarios de Justicia de Santiago</b>, renunciando las partes a cualquier otro fuero.",
])

clausula("17", "Modificaciones al Acuerdo", parrafos=[
    "Ecourier podra modificar los terminos de este Acuerdo con <b>30 dias de aviso previo</b>. Si el Prestador continua prestando servicios tras el vencimiento del plazo, se entendera que acepta las modificaciones. El Anexo de Tarifas se actualiza automaticamente y no requiere nueva aceptacion del acuerdo.",
])

clausula("18", "Aceptacion Digital", parrafos=[
    "Este Acuerdo se acepta de forma electronica a traves de la plataforma de facturacion de Ecourier, en conformidad con la <b>Ley N\xb0 19.799 sobre Documentos Electronicos, Firma Electronica y Servicios de Certificacion</b>.",
    "La aceptacion se formaliza mediante el ingreso del <b>nombre completo</b>, <b>RUT</b>, <b>firma dibujada digitalmente</b> y <b>fotografia de cedula de identidad</b> (anverso y reverso) del Prestador, quedando registrados en el sistema junto con fecha, hora, version del documento y direccion IP. Este registro tiene plena validez legal.",
])

story.append(Spacer(1, 20))
story.append(HRFlowable(width="100%", thickness=0.5, color=GRIS_LINEA, spaceAfter=10))
story.append(Paragraph("Version 2.0 \u00b7 Abril 2026 \u00b7 Logistica y Transporte E-Courier SpA \u00b7 RUT 77.512.163-7", s_pie))

doc.build(story)
print("PDF generado:", OUTPUT)
