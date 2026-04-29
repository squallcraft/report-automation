"""
Motor de renderizado de plantillas de contrato.

Soporta placeholders del tipo `{{namespace.atributo}}` con namespaces:
  - trabajador.*       (datos personales del Trabajador)
  - contrato.*         (campos de la ContratoTrabajadorVersion siendo emitida)
  - empresa.*          (ConfiguracionLegal: razón social, RUT, dirección, giro)
  - rep_legal.*        (representante legal)
  - fecha.*            (hoy en distintos formatos)

Diseño:
  - El renderizado es puramente sustitución de strings (no se evalúa código).
  - Las claves desconocidas quedan como `[[FALTA: clave]]` para que sean
    visibles en la previsualización y se puedan completar antes de emitir.
  - El listado VARIABLES_DISPONIBLES expone al frontend qué placeholders se
    pueden insertar desde el editor.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Optional

from app.models import (
    ConfiguracionLegal,
    ContratoTrabajadorVersion,
    Trabajador,
)


_RE_PLACEHOLDER = re.compile(r"\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}")


VARIABLES_DISPONIBLES: list[dict] = [
    # Trabajador
    {"key": "trabajador.nombre", "label": "Nombre completo", "grupo": "Trabajador"},
    {"key": "trabajador.rut", "label": "RUT", "grupo": "Trabajador"},
    {"key": "trabajador.email", "label": "Email", "grupo": "Trabajador"},
    {"key": "trabajador.direccion", "label": "Dirección", "grupo": "Trabajador"},
    {"key": "trabajador.telefono", "label": "Teléfono", "grupo": "Trabajador"},
    {"key": "trabajador.whatsapp", "label": "WhatsApp", "grupo": "Trabajador"},
    {"key": "trabajador.fecha_nacimiento", "label": "Fecha de nacimiento", "grupo": "Trabajador"},
    {"key": "trabajador.fecha_ingreso", "label": "Fecha de ingreso", "grupo": "Trabajador"},
    {"key": "trabajador.nacionalidad", "label": "Nacionalidad", "grupo": "Trabajador"},
    {"key": "trabajador.estado_civil", "label": "Estado civil", "grupo": "Trabajador"},
    {"key": "trabajador.afp", "label": "AFP", "grupo": "Trabajador"},
    {"key": "trabajador.sistema_salud", "label": "Sistema de salud", "grupo": "Trabajador"},
    {"key": "trabajador.banco", "label": "Banco", "grupo": "Trabajador"},
    {"key": "trabajador.tipo_cuenta", "label": "Tipo de cuenta", "grupo": "Trabajador"},
    {"key": "trabajador.numero_cuenta", "label": "Nº cuenta", "grupo": "Trabajador"},
    # Contrato (versión emitida)
    {"key": "contrato.cargo", "label": "Cargo", "grupo": "Contrato"},
    {"key": "contrato.tipo_contrato", "label": "Tipo de contrato", "grupo": "Contrato"},
    {"key": "contrato.vigente_desde", "label": "Vigente desde", "grupo": "Contrato"},
    {"key": "contrato.vigente_hasta", "label": "Vigente hasta", "grupo": "Contrato"},
    {"key": "contrato.sueldo_liquido", "label": "Sueldo líquido pactado", "grupo": "Contrato"},
    {"key": "contrato.sueldo_base", "label": "Sueldo base", "grupo": "Contrato"},
    {"key": "contrato.gratificacion", "label": "Gratificación", "grupo": "Contrato"},
    {"key": "contrato.movilizacion", "label": "Movilización", "grupo": "Contrato"},
    {"key": "contrato.colacion", "label": "Colación", "grupo": "Contrato"},
    {"key": "contrato.viaticos", "label": "Viáticos", "grupo": "Contrato"},
    {"key": "contrato.jornada_semanal_horas", "label": "Jornada semanal (hrs)", "grupo": "Contrato"},
    {"key": "contrato.tipo_jornada", "label": "Tipo de jornada", "grupo": "Contrato"},
    {"key": "contrato.distribucion_jornada", "label": "Distribución jornada", "grupo": "Contrato"},
    # Empresa
    {"key": "empresa.razon_social", "label": "Razón social", "grupo": "Empresa"},
    {"key": "empresa.rut", "label": "RUT empresa", "grupo": "Empresa"},
    {"key": "empresa.direccion", "label": "Dirección empresa", "grupo": "Empresa"},
    {"key": "empresa.ciudad_comuna", "label": "Ciudad / Comuna empresa", "grupo": "Empresa"},
    {"key": "empresa.giro", "label": "Giro / actividad", "grupo": "Empresa"},
    {"key": "empresa.correo", "label": "Correo empresa", "grupo": "Empresa"},
    {"key": "empresa.telefono", "label": "Teléfono empresa", "grupo": "Empresa"},
    {"key": "empresa.dia_pago", "label": "Día de pago del mes", "grupo": "Empresa"},
    {"key": "empresa.canal_portal_url", "label": "URL portal consultas", "grupo": "Empresa"},
    {"key": "empresa.plazo_fijo_meses", "label": "Plazo fijo conductor (meses)", "grupo": "Empresa"},
    # Representante legal
    {"key": "rep_legal.nombre", "label": "Nombre representante legal", "grupo": "Rep. legal"},
    {"key": "rep_legal.rut", "label": "RUT representante legal", "grupo": "Rep. legal"},
    {"key": "rep_legal.ci", "label": "Cédula de identidad representante", "grupo": "Rep. legal"},
    {"key": "rep_legal.cargo", "label": "Cargo representante legal", "grupo": "Rep. legal"},
    # Jornada calculada (conductor)
    {"key": "jornada.hora_entrada", "label": "Hora de entrada (calculada por zona)", "grupo": "Jornada"},
    {"key": "jornada.hora_salida", "label": "Hora de salida (calculada)", "grupo": "Jornada"},
    {"key": "jornada.minutos_colacion", "label": "Minutos de colación", "grupo": "Jornada"},
    {"key": "jornada.horas_semana", "label": "Horas semanales", "grupo": "Jornada"},
    # Fecha
    {"key": "fecha.hoy", "label": "Fecha hoy (DD/MM/YYYY)", "grupo": "Fecha"},
    {"key": "fecha.hoy_largo", "label": "Fecha hoy en palabras", "grupo": "Fecha"},
    # Inquilino (contratos de arriendo Tracking Tech)
    {"key": "inquilino.razon_social", "label": "Razón social", "grupo": "Inquilino"},
    {"key": "inquilino.nombre_fantasia", "label": "Nombre de fantasía", "grupo": "Inquilino"},
    {"key": "inquilino.rut_empresa", "label": "RUT empresa", "grupo": "Inquilino"},
    {"key": "inquilino.direccion_empresa", "label": "Dirección empresa", "grupo": "Inquilino"},
    {"key": "inquilino.correo_empresa", "label": "Correo empresa", "grupo": "Inquilino"},
    {"key": "inquilino.giro_empresa", "label": "Giro empresa", "grupo": "Inquilino"},
    {"key": "inquilino.nombre_rep_legal", "label": "Nombre representante legal", "grupo": "Inquilino"},
    {"key": "inquilino.rut_rep_legal", "label": "RUT representante legal", "grupo": "Inquilino"},
    {"key": "inquilino.direccion_rep_legal", "label": "Dirección representante legal", "grupo": "Inquilino"},
    {"key": "inquilino.correo_rep_legal", "label": "Correo representante legal", "grupo": "Inquilino"},
    {"key": "inquilino.plan", "label": "Plan contratado (A/B/C)", "grupo": "Inquilino"},
    {"key": "inquilino.descripcion_precio", "label": "Descripción del precio según plan", "grupo": "Inquilino"},
    {"key": "reserva.monto", "label": "Monto de reserva", "grupo": "Reserva"},
    {"key": "reserva.monto_formato", "label": "Monto de reserva formateado ($)", "grupo": "Reserva"},
]


_MESES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]


def _fmt_clp(n) -> str:
    try:
        return "$" + f"{int(n or 0):,}".replace(",", ".")
    except Exception:
        return "$0"


def _fmt_fecha(d: Optional[date]) -> str:
    if not d:
        return "—"
    try:
        return d.strftime("%d/%m/%Y")
    except Exception:
        return str(d)


def _fmt_fecha_larga(d: Optional[date]) -> str:
    if not d:
        return "—"
    try:
        return f"{d.day} de {_MESES[d.month - 1]} de {d.year}"
    except Exception:
        return str(d)


def construir_contexto(
    trabajador: Trabajador,
    contrato: Optional[ContratoTrabajadorVersion],
    cfg: Optional[ConfiguracionLegal],
    jornada=None,  # JornadaHoraria | None
) -> dict[str, str]:
    """Devuelve un dict plano con `clave_dot.notation` -> string ya formateado."""
    hoy = date.today()
    ctx: dict[str, str] = {
        "fecha.hoy": _fmt_fecha(hoy),
        "fecha.hoy_largo": _fmt_fecha_larga(hoy),
    }

    # Trabajador
    if trabajador is not None:
        ctx.update({
            "trabajador.nombre": trabajador.nombre or "",
            "trabajador.rut": trabajador.rut or "",
            "trabajador.email": trabajador.email or "",
            "trabajador.direccion": trabajador.direccion or "",
            "trabajador.telefono": getattr(trabajador, "telefono", "") or "",
            "trabajador.whatsapp": getattr(trabajador, "whatsapp", "") or "",
            "trabajador.fecha_nacimiento": _fmt_fecha(getattr(trabajador, "fecha_nacimiento", None)),
            "trabajador.fecha_ingreso": _fmt_fecha(getattr(trabajador, "fecha_ingreso", None)),
            "trabajador.nacionalidad": getattr(trabajador, "nacionalidad", "") or "",
            "trabajador.estado_civil": getattr(trabajador, "estado_civil", "") or "",
            "trabajador.afp": trabajador.afp or "",
            "trabajador.sistema_salud": trabajador.sistema_salud or "",
            "trabajador.banco": trabajador.banco or "",
            "trabajador.tipo_cuenta": trabajador.tipo_cuenta or "",
            "trabajador.numero_cuenta": trabajador.numero_cuenta or "",
        })

    # Contrato
    if contrato is not None:
        ctx.update({
            "contrato.cargo": contrato.cargo or "",
            "contrato.tipo_contrato": contrato.tipo_contrato or "",
            "contrato.vigente_desde": _fmt_fecha(contrato.vigente_desde),
            "contrato.vigente_hasta": _fmt_fecha(contrato.vigente_hasta),
            "contrato.sueldo_liquido": _fmt_clp(contrato.sueldo_liquido),
            "contrato.sueldo_base": _fmt_clp(contrato.sueldo_base),
            "contrato.gratificacion": _fmt_clp(contrato.gratificacion),
            "contrato.movilizacion": _fmt_clp(contrato.movilizacion),
            "contrato.colacion": _fmt_clp(contrato.colacion),
            "contrato.viaticos": _fmt_clp(contrato.viaticos),
            "contrato.jornada_semanal_horas": str(contrato.jornada_semanal_horas or 44),
            "contrato.tipo_jornada": contrato.tipo_jornada or "",
            "contrato.distribucion_jornada": contrato.distribucion_jornada or "",
        })

    # Empresa + rep legal
    if cfg is not None:
        ctx.update({
            "empresa.razon_social": cfg.empresa_razon_social or "",
            "empresa.rut": cfg.empresa_rut or "",
            "empresa.direccion": cfg.empresa_direccion or "",
            "empresa.ciudad_comuna": getattr(cfg, "empresa_ciudad_comuna", "") or "",
            "empresa.giro": getattr(cfg, "empresa_giro", "") or "",
            "empresa.correo": getattr(cfg, "empresa_correo", "") or "",
            "empresa.telefono": getattr(cfg, "empresa_telefono", "") or "",
            "empresa.dia_pago": str(getattr(cfg, "dia_pago_mes", 5)),
            "empresa.canal_portal_url": getattr(cfg, "canal_portal_url", "") or "",
            "empresa.plazo_fijo_meses": str(getattr(cfg, "plazo_fijo_conductor_meses", 3)),
            "rep_legal.nombre": cfg.rep_legal_nombre or "",
            "rep_legal.rut": cfg.rep_legal_rut or "",
            "rep_legal.ci": getattr(cfg, "rep_legal_ci", "") or "",
            "rep_legal.cargo": getattr(cfg, "rep_legal_cargo", "") or "",
        })

    # Variables de jornada calculadas (conductor contratado con jornada promediada)
    # Si el trabajador tiene una jornada horaria asignada, se usa directamente.
    # Si no, se calcula automáticamente por zona (lógica legacy).
    if contrato is not None:
        horas_semana = contrato.jornada_semanal_horas or 40

        if jornada is not None:
            # ── Jornada fija seleccionada en el perfil ────────────────────────
            ctx.update({
                "jornada.hora_entrada": jornada.hora_entrada or "08:00",
                "jornada.hora_salida": jornada.hora_salida or "17:00",
                "jornada.minutos_colacion": str(jornada.minutos_colacion or 45),
                "jornada.horas_semana": str(horas_semana),
            })
        else:
            # ── Cálculo automático por zona (legacy) ──────────────────────────
            zona = getattr(trabajador, "zona", "") or "" if trabajador else ""
            horas_dia = horas_semana / 5
            mins_colacion = int(getattr(contrato, "minutos_colacion", 45) or 45)

            if "valpara" in zona.lower() or "valparaiso" in zona.lower() or "valparaíso" in zona.lower():
                entrada_h, entrada_m = 10, 0
            elif any(z in zona.lower() for z in ["santiago", "metropolitana", "rm"]):
                entrada_h, entrada_m = 12, 0
            else:
                entrada_h, entrada_m = 8, 0

            total_mins = int(horas_dia * 60) + mins_colacion
            salida_h = entrada_h + total_mins // 60
            salida_m = entrada_m + total_mins % 60
            if salida_m >= 60:
                salida_h += 1
                salida_m -= 60

            ctx.update({
                "jornada.hora_entrada": f"{entrada_h:02d}:{entrada_m:02d}",
                "jornada.hora_salida": f"{salida_h:02d}:{salida_m:02d}",
                "jornada.minutos_colacion": str(mins_colacion),
                "jornada.horas_semana": str(horas_semana),
            })

    return ctx


def renderizar(contenido: str, contexto: dict[str, str]) -> str:
    """Reemplaza `{{ clave }}` por el valor del contexto. Marca faltantes."""
    def _resolve(match: re.Match) -> str:
        key = match.group(1)
        if key in contexto:
            val = contexto[key]
            return val if val not in ("", None) else f"[[FALTA: {key}]]"
        return f"[[FALTA: {key}]]"
    return _RE_PLACEHOLDER.sub(_resolve, contenido or "")


def detectar_faltantes(rendered: str) -> list[str]:
    """Devuelve la lista de claves marcadas como faltantes en el render."""
    return sorted(set(re.findall(r"\[\[FALTA:\s*([a-zA-Z0-9_.]+)\s*\]\]", rendered)))


# ─────────────────────────────────────────────────────────────────────────────
# Comparación entre contratos (homologación de versiones antiguas)
# ─────────────────────────────────────────────────────────────────────────────
_CAMPOS_HOMOLOGAR = [
    ("sueldo_liquido", "Sueldo líquido"),
    ("sueldo_base", "Sueldo base"),
    ("gratificacion", "Gratificación"),
    ("movilizacion", "Movilización"),
    ("colacion", "Colación"),
    ("viaticos", "Viáticos"),
    ("jornada_semanal_horas", "Jornada semanal (hrs)"),
    ("tipo_jornada", "Tipo de jornada"),
    ("distribucion_jornada", "Distribución jornada"),
    ("tipo_contrato", "Tipo de contrato"),
]


def comparar_versiones(
    referencia: ContratoTrabajadorVersion,
    candidato: ContratoTrabajadorVersion,
) -> list[dict]:
    """
    Devuelve la lista de campos donde `candidato` difiere de `referencia`.
    Útil para sugerir anexos de homologación.
    """
    diffs = []
    for attr, label in _CAMPOS_HOMOLOGAR:
        a = getattr(referencia, attr, None)
        b = getattr(candidato, attr, None)
        if (a or 0) != (b or 0):
            diffs.append({
                "campo": attr,
                "label": label,
                "valor_referencia": a,
                "valor_candidato": b,
            })
    return diffs
