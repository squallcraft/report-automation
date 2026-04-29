"""
API F29 IVA — panel de IVA crédito / débito para apoyo al F29.
Lee datos ya calculados: no ejecuta lógica de liquidación propia.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth import require_admin_or_administracion
from app.services import iva_f29 as svc

router = APIRouter(prefix="/iva-f29", tags=["IVA F29"])


@router.get("/resumen")
def get_resumen_f29(
    mes: int = Query(..., ge=1, le=12),
    anio: int = Query(..., ge=2020),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """
    Resumen F29 del período: IVA débito (ventas) vs IVA crédito (compras).
    Incluye vista provisional, documentada y GL para cada lado.
    """
    return svc.resumen_f29(db, mes, anio)


@router.get("/detalle-debito")
def get_detalle_debito(
    mes: int = Query(..., ge=1, le=12),
    anio: int = Query(..., ge=2020),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """
    Detalle del IVA débito: provisional (PagoSemanaSeller) y documentado (DTE emitidos).
    """
    return {
        "provisional": svc.iva_debito_provisional_mes(db, mes, anio),
        "documentado": svc.iva_debito_documentado_mes(db, mes, anio),
        "gl":          svc.iva_debito_gl_mes(db, mes, anio),
    }


@router.get("/detalle-credito")
def get_detalle_credito(
    mes: int = Query(..., ge=1, le=12),
    anio: int = Query(..., ge=2020),
    db: Session = Depends(get_db),
    _=Depends(require_admin_or_administracion),
):
    """
    Detalle del IVA crédito: drivers (por PagoIVADriver) y compras (MovimientoFinanciero.monto_iva).
    """
    return {
        "drivers": svc.iva_credito_drivers_mes(db, mes, anio),
        "compras": svc.iva_credito_compras_mes(db, mes, anio),
        "gl":      svc.iva_credito_gl_mes(db, mes, anio),
    }
