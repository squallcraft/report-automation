from fastapi import APIRouter, Depends
from app.auth import require_admin
from app.middleware.timing import get_performance_report, reset_stats

router = APIRouter(prefix="/diagnostics", tags=["Diagnostics"])


@router.get("/performance")
def performance_report(_=Depends(require_admin)):
    """
    Devuelve estadísticas de tiempo de respuesta por endpoint.
    Muestra las últimas 500 llamadas por ruta, ordenadas de más lenta a más rápida.
    """
    return get_performance_report()


@router.delete("/performance")
def reset_performance(_=Depends(require_admin)):
    """Resetea todas las estadísticas acumuladas."""
    reset_stats()
    return {"message": "Estadísticas reseteadas"}
