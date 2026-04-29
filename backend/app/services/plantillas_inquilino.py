"""
Contexto de plantillas para contratos de inquilinos (arriendo Tracking Tech).

Construye el dict de sustitución para `renderizar()` de plantillas_engine.py
usando los datos del modelo Inquilino.

Namespaces soportados:
  - inquilino.*   → datos de la empresa inquilina
  - reserva.*     → datos de la reserva (si aplica)
  - empresa.*     → datos de E-Courier como emisor del contrato
  - rep_legal.*   → representante legal de E-Courier
  - fecha.*       → fecha actual
"""
from __future__ import annotations

from datetime import date
from typing import Optional

from app.models import Inquilino, ConfiguracionLegal, PlanInquilinoEnum
from app.services.plantillas_engine import renderizar, detectar_faltantes  # noqa: F401 (re-export)


_MESES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]

_PLANES_LABEL = {
    PlanInquilinoEnum.TARIFA_A.value: "Tarifa A — Base conductores",
    PlanInquilinoEnum.TARIFA_B.value: "Tarifa B — Base envíos (plana)",
    PlanInquilinoEnum.TARIFA_C.value: "Tarifa C — Base + por conductor",
}

_PLANES_DESCRIPCION_PRECIO = {
    PlanInquilinoEnum.TARIFA_A.value: (
        "Cargo Fijo Mensual: $300.000 (trescientos mil pesos) neto mensual "
        "por hasta 24 conductores activos en la plataforma. "
        "Por cada conductor adicional sobre los 24, $12.500 (doce mil quinientos pesos) neto mensual adicional. "
        "A todos los valores indicados se agrega el Impuesto al Valor Agregado (IVA) vigente."
    ),
    PlanInquilinoEnum.TARIFA_B.value: (
        "Cargo Fijo Mensual: $1.000.000 (un millón de pesos) neto mensual "
        "por hasta 25.000 envíos procesados en el período. "
        "Por cada 5.000 envíos adicionales sobre los 25.000, $250.000 (doscientos cincuenta mil pesos) neto mensual adicional. "
        "A todos los valores indicados se agrega el Impuesto al Valor Agregado (IVA) vigente."
    ),
    PlanInquilinoEnum.TARIFA_C.value: (
        "Cargo Fijo Base: 2 UF (dos Unidades de Fomento) neto mensual, calculadas al valor de la UF del día de emisión del cobro, "
        "más $10.000 (diez mil pesos) neto mensual por cada conductor activo registrado en la plataforma. "
        "A todos los valores indicados se agrega el Impuesto al Valor Agregado (IVA) vigente."
    ),
}


def _fmt_fecha(d: Optional[date]) -> str:
    if not d:
        return "—"
    return d.strftime("%d/%m/%Y")


def _fmt_fecha_larga(d: Optional[date]) -> str:
    if not d:
        return "—"
    return f"{d.day} de {_MESES[d.month - 1]} de {d.year}"


def _fmt_clp(n: Optional[int]) -> str:
    if n is None:
        return "$0"
    return "$" + f"{int(n):,}".replace(",", ".")


def construir_contexto_inquilino(
    inquilino: Inquilino,
    cfg: Optional[ConfiguracionLegal] = None,
) -> dict[str, str]:
    """
    Devuelve un dict plano `namespace.clave` → string formateado, listo para
    pasarse a `renderizar(contenido, contexto)`.
    """
    hoy = date.today()
    ctx: dict[str, str] = {
        "fecha.hoy": _fmt_fecha(hoy),
        "fecha.hoy_largo": _fmt_fecha_larga(hoy),
        # Datos de la empresa inquilina
        "inquilino.razon_social": inquilino.razon_social or "",
        "inquilino.nombre_fantasia": inquilino.nombre_fantasia or "",
        "inquilino.rut_empresa": inquilino.rut_empresa or "",
        "inquilino.direccion_empresa": inquilino.direccion_empresa or "",
        "inquilino.correo_empresa": inquilino.correo_empresa or "",
        "inquilino.giro_empresa": inquilino.giro_empresa or "",
        # Representante legal del inquilino
        "inquilino.nombre_rep_legal": inquilino.nombre_rep_legal or "",
        "inquilino.rut_rep_legal": inquilino.rut_rep_legal or "",
        "inquilino.direccion_rep_legal": inquilino.direccion_rep_legal or "",
        "inquilino.correo_rep_legal": inquilino.correo_rep_legal or "",
        # Plan
        "inquilino.plan": _PLANES_LABEL.get(inquilino.plan or "", inquilino.plan or ""),
        "inquilino.descripcion_precio": _PLANES_DESCRIPCION_PRECIO.get(inquilino.plan or "", ""),
        # Reserva
        "reserva.monto": str(inquilino.monto_reserva or 0),
        "reserva.monto_formato": _fmt_clp(inquilino.monto_reserva),
    }

    # Datos de E-Courier (empresa emisora del contrato) desde ConfiguracionLegal
    if cfg is not None:
        ctx.update({
            "empresa.razon_social": cfg.empresa_razon_social or "",
            "empresa.rut": cfg.empresa_rut or "",
            "empresa.direccion": cfg.empresa_direccion or "",
            "empresa.giro": getattr(cfg, "empresa_giro", "") or "",
            "empresa.correo": getattr(cfg, "empresa_correo", "") or "",
            "rep_legal.nombre": cfg.rep_legal_nombre or "",
            "rep_legal.rut": cfg.rep_legal_rut or "",
            "rep_legal.cargo": getattr(cfg, "rep_legal_cargo", "") or "",
        })

    return ctx
