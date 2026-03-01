"""Migración directa SQLite → PostgreSQL sin MetaData.reflect()"""
import sys, os
sys.path.insert(0, "/app")
os.environ.setdefault("DATABASE_URL", "postgresql://x@db/x")

from sqlalchemy import create_engine, text, Boolean, inspect as sa_inspect
from app.database import Base
import app.models

SQLITE = "sqlite:////app/ecourier.db"
PG = os.environ["DATABASE_URL"]

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

def get_bool_columns():
    """Find all Boolean columns from SQLAlchemy models."""
    bool_cols = {}
    for table_name, table in Base.metadata.tables.items():
        bools = set()
        for col in table.columns:
            if isinstance(col.type, Boolean):
                bools.add(col.name)
        if bools:
            bool_cols[table_name] = bools
    return bool_cols

def fix_row(row, bool_fields):
    """Convert SQLite integer booleans to Python booleans."""
    for k in bool_fields:
        if k in row and row[k] is not None:
            row[k] = bool(row[k])
    return row

def migrate():
    src = create_engine(SQLITE)
    dst = create_engine(PG)

    print("Creando tablas en PostgreSQL...", flush=True)
    Base.metadata.create_all(bind=dst)
    print("OK\n", flush=True)

    bool_cols = get_bool_columns()
    total = 0

    for tbl in TABLES:
        with src.connect() as sc:
            count = sc.execute(text(f"SELECT COUNT(*) FROM [{tbl}]")).scalar()
            if count == 0:
                print(f"  {tbl}: 0 (skip)", flush=True)
                continue

            cols_result = sc.execute(text(f"PRAGMA table_info([{tbl}])")).fetchall()
            cols = [r[1] for r in cols_result]
            rows = sc.execute(text(f"SELECT * FROM [{tbl}]")).fetchall()

        data = [dict(zip(cols, row)) for row in rows]

        bools = bool_cols.get(tbl, set())
        if bools:
            data = [fix_row(r, bools) for r in data]

        with dst.begin() as dc:
            dc.execute(text(f'TRUNCATE TABLE "{tbl}" CASCADE'))

            placeholders = ", ".join([f":{c}" for c in cols])
            col_names = ", ".join([f'"{c}"' for c in cols])
            insert_sql = text(f'INSERT INTO "{tbl}" ({col_names}) VALUES ({placeholders})')

            batch = 500
            for i in range(0, len(data), batch):
                dc.execute(insert_sql, data[i:i+batch])
                if count > 1000:
                    print(f"    {tbl}: {min(i+batch, len(data)):,}/{len(data):,}...", flush=True)

            if "id" in cols:
                max_id = max(r.get("id", 0) for r in data)
                try:
                    dc.execute(text(f"SELECT setval('{tbl}_id_seq', {max_id + 1}, false)"))
                except Exception:
                    pass

        print(f"  {tbl}: {len(data):,} registros OK", flush=True)
        total += len(data)

    print(f"\nTotal migrado: {total:,} registros", flush=True)

if __name__ == "__main__":
    migrate()
