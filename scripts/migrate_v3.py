"""
Migración SQLite → PostgreSQL
- Sin TRUNCATE CASCADE (causa deadlock con FKs)
- Convierte booleanos y JSON automáticamente
- Desactiva FKs durante inserción para máxima velocidad
"""
import sys, os, json
sys.path.insert(0, "/app")
os.environ.setdefault("DATABASE_URL", "postgresql://x@db/x")

import psycopg2
from sqlalchemy import create_engine, text

SQLITE_URL = "sqlite:////app/ecourier.db"
PG_URL = os.environ["DATABASE_URL"]

# Orden respetando dependencias FK
TABLES = [
    "admin_users",
    "sellers",
    "drivers",
    "calendario_semanas",
    "productos_con_extra",
    "tarifas_comuna",
    "tarifas_plan_comuna",
    "periodos_liquidacion",
    "logs_ingesta",
    "ajustes_liquidacion",
    "envios",
    "retiros",
    "consultas_portal",
    "pagos_semana_sellers",
    "pagos_semana_drivers",
    "facturas_mensuales_sellers",
    "tarifas_escalonadas_sellers",
]

# Columnas booleanas por tabla
BOOL_COLS = {
    "sellers": {"activo", "tiene_retiro", "usa_pickup", "mensual"},
    "drivers": {"activo"},
    "admin_users": {"activo"},
    "envios": {"homologado"},
    "retiros": {"homologado"},
    "productos_con_extra": {"activo"},
    "periodos_liquidacion": set(),
    "calendario_semanas": {"generado_auto"},
    "tarifas_escalonadas_sellers": {"activo"},
}

# Columnas JSON por tabla (SQLite las guarda como string)
JSON_COLS = {
    "sellers": {"aliases"},
    "drivers": {"aliases"},
    "periodos_liquidacion": {"snapshot_sellers", "snapshot_drivers", "snapshot_rentabilidad"},
    "logs_ingesta": {"sin_homologar_sellers", "sin_homologar_drivers", "errores", "resultado"},
    "tarifas_escalonadas_sellers": {"tramos"},
    "facturas_mensuales_sellers": {"respuesta_api"},
}

def parse_val(val, col, tbl):
    if val is None:
        return None
    bool_set = BOOL_COLS.get(tbl, set())
    json_set = JSON_COLS.get(tbl, set())
    if col in bool_set:
        return bool(val)
    if col in json_set:
        if isinstance(val, str):
            try:
                return json.loads(val)
            except Exception:
                return val
        return val
    return val

def migrate():
    from urllib.parse import urlparse
    u = urlparse(PG_URL.replace("postgresql://", "postgres://"))
    conn = psycopg2.connect(
        host=u.hostname, port=u.port or 5432,
        dbname=u.path.lstrip("/"),
        user=u.username, password=u.password,
    )
    cur = conn.cursor()

    # Crear tablas via SQLAlchemy
    from app.database import Base
    import app.models
    dst_engine = create_engine(PG_URL)
    print("Creando tablas...", flush=True)
    Base.metadata.create_all(bind=dst_engine)
    print("OK\n", flush=True)

    src = create_engine(SQLITE_URL)

    # Desactivar FK checks durante migración
    cur.execute("SET session_replication_role = 'replica';")
    conn.commit()

    total = 0
    for tbl in TABLES:
        with src.connect() as sc:
            count = sc.execute(text(f"SELECT COUNT(*) FROM [{tbl}]")).scalar()
            if count == 0:
                print(f"  {tbl}: vacía (skip)", flush=True)
                continue
            col_info = sc.execute(text(f"PRAGMA table_info([{tbl}])")).fetchall()
            cols = [r[1] for r in col_info]
            rows = sc.execute(text(f"SELECT * FROM [{tbl}]")).fetchall()

        # Limpiar tabla destino sin CASCADE
        cur.execute(f'DELETE FROM "{tbl}"')
        conn.commit()

        col_names = ", ".join([f'"{c}"' for c in cols])
        placeholders = ", ".join(["%s"] * len(cols))
        sql = f'INSERT INTO "{tbl}" ({col_names}) VALUES ({placeholders})'

        batch = []
        batch_size = 200
        inserted = 0

        for row in rows:
            parsed = tuple(parse_val(v, cols[i], tbl) for i, v in enumerate(row))
            # Convertir JSON cols a string JSON para psycopg2
            final = []
            json_set = JSON_COLS.get(tbl, set())
            for i, v in enumerate(parsed):
                if cols[i] in json_set and v is not None and not isinstance(v, str):
                    final.append(json.dumps(v))
                else:
                    final.append(v)
            batch.append(tuple(final))

            if len(batch) >= batch_size:
                cur.executemany(sql, batch)
                conn.commit()
                inserted += len(batch)
                batch = []
                if count > 1000:
                    print(f"    {tbl}: {inserted:,}/{count:,}...", flush=True)

        if batch:
            cur.executemany(sql, batch)
            conn.commit()
            inserted += len(batch)

        # Reset sequence
        if "id" in cols:
            cur.execute(f"SELECT MAX(id) FROM \"{tbl}\"")
            max_id = cur.fetchone()[0] or 0
            try:
                cur.execute(f"SELECT setval('{tbl}_id_seq', %s, false)", (max_id + 1,))
                conn.commit()
            except Exception:
                conn.rollback()

        print(f"  {tbl}: {inserted:,} OK", flush=True)
        total += inserted

    # Reactivar FK checks
    cur.execute("SET session_replication_role = 'origin';")
    conn.commit()
    cur.close()
    conn.close()

    print(f"\n✓ Migración completada: {total:,} registros totales", flush=True)

if __name__ == "__main__":
    migrate()
