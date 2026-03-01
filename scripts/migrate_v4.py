"""
Migración SQLite → PostgreSQL — versión definitiva.

Estrategia:
- Crea las tablas en PG via SQLAlchemy
- Consulta el esquema real de PG para detectar tipos (boolean, json, jsonb)
- Convierte cada valor al tipo correcto antes de insertar
- Desactiva FK checks durante la carga
- DELETE en vez de TRUNCATE (evita deadlock con CASCADE)
- Progress bar en consola
- Errores no detienen la migración: los loguea y continúa
"""
import sys, os, json
sys.path.insert(0, "/app")
os.environ.setdefault("DATABASE_URL", "postgresql://x@db/x")

from urllib.parse import urlparse
import psycopg2
from sqlalchemy import create_engine, text

SQLITE_URL = "sqlite:////app/ecourier.db"
PG_URL = os.environ["DATABASE_URL"]

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

BATCH = 300


def pg_connect():
    u = urlparse(PG_URL.replace("postgresql://", "postgres://"))
    return psycopg2.connect(
        host=u.hostname,
        port=u.port or 5432,
        dbname=u.path.lstrip("/"),
        user=u.username,
        password=u.password,
    )


def get_pg_col_types(cur, table):
    """Devuelve {col_name: pg_data_type} consultando information_schema."""
    cur.execute("""
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = %s
    """, (table,))
    return {row[0]: row[1] for row in cur.fetchall()}


def cast_value(val, pg_type):
    """Convierte un valor SQLite al tipo correcto para PostgreSQL."""
    if val is None:
        return None
    if pg_type == "boolean":
        return bool(val)
    if pg_type in ("json", "jsonb"):
        if isinstance(val, (dict, list)):
            return json.dumps(val, ensure_ascii=False)
        if isinstance(val, str):
            try:
                json.loads(val)  # validar que es JSON válido
                return val
            except Exception:
                return json.dumps(val)
        return json.dumps(val)
    return val


def bar(done, total, width=30):
    pct = done / total if total else 1
    filled = int(width * pct)
    return f"[{'█' * filled}{'░' * (width - filled)}] {done:,}/{total:,} ({pct*100:.0f}%)"


def migrate_table(cur, src_engine, table):
    with src_engine.connect() as sc:
        total = sc.execute(text(f"SELECT COUNT(*) FROM [{table}]")).scalar()
        if total == 0:
            print(f"  {table}: vacía, omitida", flush=True)
            return 0

        col_info = sc.execute(text(f"PRAGMA table_info([{table}])")).fetchall()
        cols = [r[1] for r in col_info]
        rows = sc.execute(text(f"SELECT * FROM [{table}]")).fetchall()

    pg_types = get_pg_col_types(cur, table)

    # Limpiar sin CASCADE
    cur.execute(f'DELETE FROM "{table}"')

    col_names = ", ".join([f'"{c}"' for c in cols])
    placeholders = ", ".join(["%s"] * len(cols))
    sql = f'INSERT INTO "{table}" ({col_names}) VALUES ({placeholders})'

    inserted = 0
    errors = 0
    batch = []

    print(f"  {table}: {total:,} registros", flush=True)

    for row in rows:
        pg_type_row = tuple(
            cast_value(val, pg_types.get(cols[i], "text"))
            for i, val in enumerate(row)
        )
        batch.append(pg_type_row)

        if len(batch) >= BATCH:
            try:
                cur.executemany(sql, batch)
                inserted += len(batch)
            except Exception as e:
                errors += len(batch)
                print(f"\n    ERROR en lote: {e}", flush=True)
            batch = []
            print(f"\r    {bar(inserted, total)}", end="", flush=True)

    if batch:
        try:
            cur.executemany(sql, batch)
            inserted += len(batch)
        except Exception as e:
            errors += len(batch)
            print(f"\n    ERROR en último lote: {e}", flush=True)

    print(f"\r    {bar(inserted, total)}  {'✓' if errors == 0 else f'⚠ {errors} errores'}", flush=True)

    # Reset sequence
    if "id" in cols:
        cur.execute(f'SELECT MAX(id) FROM "{table}"')
        max_id = cur.fetchone()[0] or 0
        try:
            cur.execute(f"SELECT setval('{table}_id_seq', %s, false)", (max_id + 1,))
        except Exception:
            pass

    return inserted


def main():
    print("=== Migración SQLite → PostgreSQL ===\n", flush=True)

    # Crear tablas en PG via SQLAlchemy
    print("Creando esquema en PostgreSQL...", flush=True)
    from app.database import Base
    import app.models  # noqa
    dst = create_engine(PG_URL)
    Base.metadata.create_all(bind=dst)
    print("Esquema OK\n", flush=True)

    src = create_engine(SQLITE_URL)
    conn = pg_connect()
    conn.autocommit = False
    cur = conn.cursor()

    # Desactivar FK constraints para la sesión
    cur.execute("SET session_replication_role = 'replica'")
    conn.commit()

    total_rows = 0
    for table in TABLES:
        try:
            n = migrate_table(cur, src, table)
            conn.commit()
            total_rows += n
        except Exception as e:
            conn.rollback()
            print(f"  {table}: ERROR GENERAL — {e}", flush=True)

    # Reactivar FK constraints
    cur.execute("SET session_replication_role = 'origin'")
    conn.commit()

    cur.close()
    conn.close()

    print(f"\n{'='*45}", flush=True)
    print(f"  Migración completada: {total_rows:,} registros", flush=True)
    print(f"{'='*45}", flush=True)


if __name__ == "__main__":
    main()
