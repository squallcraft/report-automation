"""
Aplica cambios del CSV sellers_editable.csv a la base de datos local (ecourier.db).

Columnas del CSV:
  id       → ID del seller (NO cambiar)
  nombre   → Nombre que se mostrará en el sistema
  aliases  → JSON array de aliases (ej: ["Alias 1","Alias 2"])
  activo   → 1 = activo, 0 = desactivado

Uso:
  python scripts/aplicar_sellers.py

Luego sube los cambios al servidor con migrate_data.sh o directamente con psql.
"""

import csv
import sqlite3
import json
import sys
from pathlib import Path

CSV_PATH = Path(__file__).parent / "sellers_editable.csv"
DB_PATH = Path(__file__).parent.parent / "backend" / "ecourier.db"

if not CSV_PATH.exists():
    print(f"❌ No se encontró {CSV_PATH}")
    sys.exit(1)

conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()

updated = 0
errors = []

with open(CSV_PATH, newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    rows = list(reader)

print(f"📋 Procesando {len(rows)} sellers...")

for row in rows:
    try:
        seller_id = int(row["id"])
        nombre = row["nombre"].strip()
        aliases_raw = row.get("aliases", "[]").strip() or "[]"
        activo = int(row.get("activo", 1))

        # Validar JSON de aliases
        try:
            aliases = json.loads(aliases_raw)
        except json.JSONDecodeError:
            # Intentar parsear como lista separada por coma
            aliases = [a.strip() for a in aliases_raw.strip("[]").split(",") if a.strip()]

        aliases_json = json.dumps(aliases, ensure_ascii=False)

        cur.execute(
            "UPDATE sellers SET nombre = ?, aliases = ?, activo = ? WHERE id = ?",
            (nombre, aliases_json, activo, seller_id),
        )
        if cur.rowcount == 0:
            errors.append(f"ID {seller_id}: no encontrado en BD")
        else:
            updated += 1

    except Exception as e:
        errors.append(f"Fila ID {row.get('id', '?')}: {e}")

conn.commit()
conn.close()

print(f"\n✅ {updated} sellers actualizados")
if errors:
    print(f"⚠️  {len(errors)} errores:")
    for e in errors:
        print(f"   • {e}")

print("\nPróximo paso: sincronizar con el servidor.")
print("Opción rápida — ejecutar en el servidor:")
print("  docker compose exec db psql -U ecourier -d ecourier")
print("  Y pegar los UPDATE necesarios.")
