"""
In-memory task progress tracking for long-running ingesta operations.
Thread-safe via threading.Lock.
"""
import threading
import time
from typing import Optional, Dict, Any

_tasks: Dict[str, Dict[str, Any]] = {}
_lock = threading.Lock()


def create_task(task_id: str, total: int, archivo: str = ""):
    with _lock:
        _tasks[task_id] = {
            "status": "processing",
            "total": total,
            "processed": 0,
            "nuevos": 0,
            "duplicados": 0,
            "errores": 0,
            "archivo": archivo,
            "started_at": time.time(),
            "message": "Leyendo archivo Excel...",
            "result": None,
        }


def update_task(task_id: str, **kwargs):
    with _lock:
        if task_id in _tasks:
            _tasks[task_id].update(kwargs)


def get_task(task_id: str) -> Optional[Dict[str, Any]]:
    with _lock:
        if task_id not in _tasks:
            return None
        task = _tasks[task_id].copy()

    elapsed = time.time() - task["started_at"]
    task["elapsed_seconds"] = round(elapsed, 1)

    if task["processed"] > 0 and task["status"] == "processing":
        rate = task["processed"] / elapsed
        remaining_rows = task["total"] - task["processed"]
        remaining_secs = remaining_rows / rate if rate > 0 else 0
        task["estimated_remaining_seconds"] = round(remaining_secs, 1)
        task["rate_per_second"] = round(rate, 1)
    else:
        task["estimated_remaining_seconds"] = 0
        task["rate_per_second"] = 0

    return task


def remove_task(task_id: str):
    with _lock:
        _tasks.pop(task_id, None)


def cleanup_old_tasks(max_age_seconds: int = 7200):
    with _lock:
        now = time.time()
        to_delete = [
            k for k, v in _tasks.items()
            if now - v["started_at"] > max_age_seconds
        ]
        for k in to_delete:
            del _tasks[k]
