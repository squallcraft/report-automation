"""
Recalcula cobro_seller para sellers con tarifas escalonadas por volumen semanal.

Lógica:
1. Obtener reglas activas de TarifaEscalonadaSeller
2. Para cada seller+período, contar envíos en la zona aplicable
3. Determinar el tramo correcto según volumen
4. Actualizar cobro_seller de esos envíos con el precio del tramo
"""
from typing import Optional, Set, Tuple

from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc

from app.models import Envio, TarifaEscalonadaSeller


def _find_precio_tramo(tramos: list, cantidad: int) -> Optional[int]:
    """Busca el precio correspondiente a la cantidad en los tramos ordenados."""
    for tramo in sorted(tramos, key=lambda t: t["min"]):
        t_min = tramo["min"]
        t_max = tramo.get("max")
        if cantidad >= t_min and (t_max is None or cantidad <= t_max):
            return tramo["precio"]
    return None


def recalcular_tarifas_escalonadas(
    db: Session,
    periodos: Set[Tuple[int, int, int]],
    seller_ids: Optional[Set[int]] = None,
):
    """
    Recalcula cobro_seller para sellers con tarifa escalonada en los períodos dados.
    periodos: set de (semana, mes, anio)
    seller_ids: si se proporciona, limita a esos sellers; sino procesa todos los que tengan regla.
    Retorna dict con {seller_id: {periodo: {cantidad, precio_aplicado, envios_actualizados}}}
    """
    query = db.query(TarifaEscalonadaSeller).filter(TarifaEscalonadaSeller.activo == True)
    if seller_ids:
        query = query.filter(TarifaEscalonadaSeller.seller_id.in_(seller_ids))
    reglas = query.all()

    if not reglas:
        return {}

    resultado = {}

    for regla in reglas:
        sid = regla.seller_id
        resultado.setdefault(sid, {})

        for (semana, mes, anio) in periodos:
            filtro_base = (
                Envio.seller_id == sid,
                Envio.semana == semana,
                Envio.mes == mes,
                Envio.anio == anio,
            )

            filtro_zona = []
            if regla.zona_aplicable:
                filtro_zona = [Envio.zona == regla.zona_aplicable]

            cantidad = db.query(sqlfunc.count(Envio.id)).filter(
                *filtro_base, *filtro_zona
            ).scalar() or 0

            if cantidad == 0:
                continue

            precio = _find_precio_tramo(regla.tramos, cantidad)
            if precio is None:
                continue

            actualizados = db.query(Envio).filter(
                *filtro_base, *filtro_zona
            ).update({Envio.cobro_seller: precio}, synchronize_session="fetch")

            resultado[sid][f"S{semana}-{mes}/{anio}"] = {
                "cantidad": cantidad,
                "precio_aplicado": precio,
                "envios_actualizados": actualizados,
            }

    db.commit()
    return resultado
