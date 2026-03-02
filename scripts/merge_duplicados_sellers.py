"""
Une duplicados de sellers: mantiene el registro principal (con más envíos o ID menor),
desactiva el duplicado y añade su nombre como alias del principal.
"""
import sqlite3
import json
from pathlib import Path
from collections import defaultdict

DB_PATH = Path(__file__).parent.parent / "backend" / "ecourier.db"

def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute("""
        SELECT s.id, s.nombre, s.aliases, s.activo,
               (SELECT COUNT(*) FROM envios e WHERE e.seller_id = s.id) as envios
        FROM sellers s
        ORDER BY s.id
    """)
    rows = [dict(r) for r in cur.fetchall()]

    # Agrupar por nombre normalizado (lower, strip)
    by_key = defaultdict(list)
    for r in rows:
        key = r["nombre"].strip().lower()
        if not key:
            continue
        by_key[key].append(r)

    updates_aliases = []  # (id_principal, nuevo_aliases_json)
    deactivate_ids = []   # ids a poner activo=0

    for key, group in by_key.items():
        if len(group) <= 1:
            continue

        # Ordenar: primero el que tiene más envíos, luego por id menor
        group.sort(key=lambda x: (-x["envios"], x["id"]))
        principal = group[0]
        duplicados = group[1:]

        aliases = json.loads(principal["aliases"] or "[]")
        if not isinstance(aliases, list):
            aliases = []

        for dup in duplicados:
            deactivate_ids.append(dup["id"])
            nombre_dup = dup["nombre"].strip()
            if nombre_dup and nombre_dup not in aliases and nombre_dup != principal["nombre"]:
                aliases.append(nombre_dup)

        # Evitar duplicar el nombre principal en aliases
        nombre_principal = principal["nombre"].strip()
        if nombre_principal in aliases:
            aliases.remove(nombre_principal)
        # Añadir variantes (los nombres de los duplicados ya están)
        updates_aliases.append((principal["id"], json.dumps(aliases, ensure_ascii=False)))

    # Aplicar: desactivar duplicados
    for sid in deactivate_ids:
        cur.execute("UPDATE sellers SET activo = 0 WHERE id = ?", (sid,))

    # Aplicar: actualizar aliases del principal
    for sid, aliases_json in updates_aliases:
        cur.execute("UPDATE sellers SET aliases = ? WHERE id = ?", (aliases_json, sid))

    conn.commit()

    print(f"Duplicados desactivados: {len(deactivate_ids)}")
    print(f"Principales con aliases actualizados: {len(updates_aliases)}")
    if deactivate_ids:
        print("IDs desactivados:", sorted(deactivate_ids))

    conn.close()

if __name__ == "__main__":
    main()
