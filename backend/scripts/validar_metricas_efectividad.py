#!/usr/bin/env python3
"""
Script de validación de la capa canónica de métricas.

Uso:
    docker compose exec backend python scripts/validar_metricas_efectividad.py
    docker compose exec backend python scripts/validar_metricas_efectividad.py --inicio 2026-04-01 --fin 2026-04-29

Hace dos cosas:
  1. Calcula KPIs con la capa canónica (metricas_efectividad.py).
  2. Compara contra la lógica vieja de dashboard.py para identificar el delta
     antes del switch (esperado: efectividad baja porque la vieja sobrecuenta).

Imprime un resumen por consola con los números clave y un detalle de los días
con mayor diferencia.
"""
from __future__ import annotations

import argparse
import sys
from datetime import date, datetime, timedelta

sys.path.insert(0, "/app")  # docker container path
sys.path.insert(0, ".")     # local fallback

from app.database import SessionLocal
from app.services.metricas_efectividad import (
    DIMENSION_ROUTE_DATE,
    DIMENSION_WITHDRAWAL_DATE,
    kpis_globales,
    kpis_por_dia,
    kpis_por_driver,
    kpis_por_seller,
)


def parse_date(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--inicio", default=None, help="YYYY-MM-DD (default: hace 30 días)")
    parser.add_argument("--fin", default=None, help="YYYY-MM-DD (default: hoy)")
    parser.add_argument("--driver", type=int, default=None)
    parser.add_argument("--seller", type=int, default=None)
    args = parser.parse_args()

    fin = parse_date(args.fin) if args.fin else date.today()
    inicio = parse_date(args.inicio) if args.inicio else fin - timedelta(days=30)

    db = SessionLocal()
    try:
        print(f"\n{'='*78}")
        print(f"  Validación capa canónica de métricas — {inicio} → {fin}")
        if args.driver:
            print(f"  Filtro driver_id = {args.driver}")
        if args.seller:
            print(f"  Filtro seller_id = {args.seller}")
        print(f"{'='*78}\n")

        # ── Globales ────────────────────────────────────────────────────────
        g = kpis_globales(db, inicio, fin, driver_id=args.driver, seller_id=args.seller)
        print("KPIs GLOBALES (canónicos)")
        print(f"  Paquetes a ruta:       {g['paquetes_a_ruta']:>8}")
        print(f"  Retirados:             {g['retirados']:>8}")
        print(f"  Entregados mismo día:  {g['paquetes_entregados']:>8}")
        print(f"  Same-Day:              {g['same_day']:>8}")
        print(f"  Cancelados:            {g['cancelados']:>8}")
        print(f"  Primer intento ok:     {g['primer_intento_ok']:>8}")
        print()
        print(f"  % Efectividad:         {g['pct_delivery_success']:>7}%")
        print(f"  % Same-Day:            {g['pct_same_day']:>7}%")
        print(f"  % First-Attempt:       {g['pct_first_attempt']:>7}%")
        print(f"  % Intento 1 (ent):     {g['pct_intento_1']:>7}%")
        print(f"  % Intento 2 (ent):     {g['pct_intento_2']:>7}%")
        print(f"  % Intento 3+ (ent):    {g['pct_intento_3plus']:>7}%")
        print()

        # ── Distribución de ciclo ───────────────────────────────────────────
        d = g["distribucion"]
        print("DISTRIBUCIÓN CICLO retiro→entrega (días hábiles)")
        for k in ("0d", "1d", "2d", "3d", "4plus", "sin_entregar"):
            print(f"  {k:>15}: n={d[f'n_{k}']:>6}  pct={d[f'pct_{k}']:>5}%")
        print()

        # ── Serie temporal ──────────────────────────────────────────────────
        serie = kpis_por_dia(db, inicio, fin, driver_id=args.driver, seller_id=args.seller)
        if serie:
            print(f"SERIE TEMPORAL ({len(serie)} días con datos)")
            print(f"  {'fecha':<12} {'a_ruta':>8} {'entreg':>8} {'sd':>6} {'%efect':>8} {'%sd':>8}")
            for row in serie[-15:]:  # últimos 15 días
                print(
                    f"  {row['fecha']:<12} {row['a_ruta']:>8} {row['entregados']:>8} "
                    f"{row['same_day']:>6} {row['pct_delivery_success']:>7}% {row['pct_same_day']:>7}%"
                )
            print()

        # ── Top 10 drivers por efectividad ──────────────────────────────────
        if not args.driver:
            drivers = kpis_por_driver(db, inicio, fin)
            drivers_significativos = [d for d in drivers if d["paquetes_a_ruta"] >= 10]
            top = sorted(drivers_significativos, key=lambda x: -x["pct_delivery_success"])[:10]
            bottom = sorted(drivers_significativos, key=lambda x: x["pct_delivery_success"])[:10]
            print(f"TOP 10 conductores por % Efectividad ({len(drivers_significativos)} con >=10 paq)")
            print(f"  {'driver':<35} {'a_ruta':>8} {'entreg':>8} {'%efect':>8} {'%sd':>8}")
            for r in top:
                print(
                    f"  {(r['nombre'] or '?')[:34]:<35} {r['paquetes_a_ruta']:>8} "
                    f"{r['paquetes_entregados']:>8} {r['pct_delivery_success']:>7}% {r['pct_same_day']:>7}%"
                )
            print()
            print("BOTTOM 10 conductores por % Efectividad")
            for r in bottom:
                print(
                    f"  {(r['nombre'] or '?')[:34]:<35} {r['paquetes_a_ruta']:>8} "
                    f"{r['paquetes_entregados']:>8} {r['pct_delivery_success']:>7}% {r['pct_same_day']:>7}%"
                )
            print()

        # ── Top 10 sellers ──────────────────────────────────────────────────
        if not args.seller:
            sellers = kpis_por_seller(db, inicio, fin)
            sellers_sig = [s for s in sellers if s["paquetes_a_ruta"] >= 10]
            top_s = sorted(sellers_sig, key=lambda x: -x["paquetes_a_ruta"])[:10]
            print(f"TOP 10 sellers por volumen ({len(sellers_sig)} con >=10 paq)")
            print(f"  {'seller':<35} {'a_ruta':>8} {'entreg':>8} {'%efect':>8} {'%sd':>8}")
            for r in top_s:
                print(
                    f"  {(r['nombre'] or '?')[:34]:<35} {r['paquetes_a_ruta']:>8} "
                    f"{r['paquetes_entregados']:>8} {r['pct_delivery_success']:>7}% {r['pct_same_day']:>7}%"
                )
            print()

        # NOTA: la lógica vieja (_calcular_kpis_v2 / _kpis_v2_base_query) ya
        # fue eliminada de dashboard.py en el switch v3-canónica. Si necesitas
        # comparar contra ella, usa este script en una rev anterior al commit
        # del refactor de endpoints.

    finally:
        db.close()


if __name__ == "__main__":
    main()
