#!/usr/bin/env python3
"""
Backfill inicial de KPIs materializados (kpi_dia + kpi_no_entregado).

Uso típico (una sola vez tras desplegar la migración):
    docker compose exec backend python scripts/backfill_kpis_efectividad.py
    docker compose exec backend python scripts/backfill_kpis_efectividad.py --inicio 2026-04-01 --fin 2026-04-30

Por defecto procesa abril 2026 completo (alineado con la decisión del producto:
arrancamos materializando solo abril). Después los crons mantienen las tablas
actualizadas automáticamente.

Idempotente: correrlo varias veces sobre el mismo rango regenera las filas y
da el mismo resultado.
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, datetime

sys.path.insert(0, "/app")
sys.path.insert(0, ".")

from app.database import SessionLocal
from app.services import materializar_kpis


def parse_date(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--inicio", default="2026-04-01")
    parser.add_argument("--fin", default="2026-04-30")
    args = parser.parse_args()

    inicio = parse_date(args.inicio)
    fin = parse_date(args.fin)

    print(f"\n{'='*60}")
    print(f"  Backfill KPIs efectividad — {inicio} → {fin}")
    print(f"{'='*60}\n")

    db = SessionLocal()
    try:
        info = materializar_kpis.recomputar_rango(db, inicio, fin)
        print(f"\nResumen: {info}\n")
    finally:
        db.close()


if __name__ == "__main__":
    main()
