"""
Middleware de timing: mide duración de cada request y acumula estadísticas en memoria.
Los datos se exponen vía /api/diagnostics/performance.
"""
import time
import statistics
from collections import defaultdict, deque
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

# ── Almacén en memoria ──
# Por cada ruta guardamos las últimas MAX_SAMPLES duraciones (ms)
MAX_SAMPLES = 500

_stats: dict[str, deque] = defaultdict(lambda: deque(maxlen=MAX_SAMPLES))
_errors: dict[str, int] = defaultdict(int)
_counts: dict[str, int] = defaultdict(int)

# Rutas que no nos interesan medir (estáticas, health, docs)
_SKIP_PREFIXES = ("/docs", "/openapi", "/redoc", "/")


def _route_key(path: str, method: str) -> str:
    """Normaliza la ruta eliminando IDs numéricos para agrupar correctamente."""
    import re
    path = re.sub(r"/\d+", "/{id}", path)
    return f"{method} {path}"


class TimingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Saltar rutas sin interés
        if any(path.startswith(p) for p in _SKIP_PREFIXES) and path != "/":
            return await call_next(request)
        if path in ("/", "/health"):
            return await call_next(request)

        key = _route_key(path, request.method)
        t0 = time.perf_counter()

        try:
            response = await call_next(request)
            elapsed_ms = (time.perf_counter() - t0) * 1000
            _stats[key].append(elapsed_ms)
            _counts[key] += 1
            if response.status_code >= 500:
                _errors[key] += 1
            return response
        except Exception:
            elapsed_ms = (time.perf_counter() - t0) * 1000
            _stats[key].append(elapsed_ms)
            _counts[key] += 1
            _errors[key] += 1
            raise


def get_performance_report() -> list[dict]:
    """Devuelve estadísticas agregadas ordenadas por promedio descendente."""
    report = []
    for key, samples in _stats.items():
        if not samples:
            continue
        sorted_samples = sorted(samples)
        n = len(sorted_samples)
        avg = statistics.mean(sorted_samples)
        p95_idx = max(0, int(n * 0.95) - 1)
        p95 = sorted_samples[p95_idx]
        max_ms = sorted_samples[-1]
        total = _counts[key]
        errors = _errors[key]
        report.append({
            "endpoint": key,
            "llamadas_totales": total,
            "muestras_recientes": n,
            "avg_ms": round(avg, 1),
            "p95_ms": round(p95, 1),
            "max_ms": round(max_ms, 1),
            "errores": errors,
            "error_pct": round((errors / total * 100) if total else 0, 1),
        })
    return sorted(report, key=lambda x: x["avg_ms"], reverse=True)


def reset_stats():
    _stats.clear()
    _errors.clear()
    _counts.clear()
