#!/usr/bin/env python3
"""
Migra TODA la data de SQLite (ecourier.db) → PostgreSQL.

Se puede ejecutar de dos formas:

  A) Localmente (con PostgreSQL accesible en localhost:5432):
     cd ecourier
     POSTGRES_URL=postgresql://ecourier:ecourier@localhost:5432/ecourier \
       python scripts/migrate_sqlite_to_postgres.py

  B) Dentro del container backend (con ecourier.db copiado a /app/):
     docker compose exec backend python /app/migrate.py
"""
import os
import sys

backend_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend")
if os.path.exists(backend_path):
    sys.path.insert(0, backend_path)
else:
    sys.path.insert(0, "/app")

from sqlalchemy import create_engine, text, inspect, MetaData
from sqlalchemy.orm import sessionmaker

SQLITE_CANDIDATES = [
    os.environ.get("SQLITE_URL", ""),
    "sqlite:///./ecourier.db",
    "sqlite:////app/ecourier.db",
    f"sqlite:///{os.path.join(backend_path, 'ecourier.db')}",
]

POSTGRES_URL = os.environ.get(
    "POSTGRES_URL",
    os.environ.get(
        "DATABASE_URL",
        "postgresql://ecourier:ecourier@db:5432/ecourier",
    ),
)

TABLES_ORDER = [
    "sellers",
    "drivers",
    "envios",
    "retiros",
    "productos_con_extra",
    "tarifas_comuna",
    "tarifas_plan_comuna",
    "ajustes_liquidacion",
    "periodos_liquidacion",
    "consultas_portal",
    "logs_ingesta",
    "pagos_semana_sellers",
    "pagos_semana_drivers",
    "facturas_mensuales_sellers",
    "calendario_semanas",
    "tarifas_escalonadas_sellers",
    "admin_users",
]


def find_sqlite_url():
    for url in SQLITE_CANDIDATES:
        if not url:
            continue
        path = url.replace("sqlite:///", "")
        if os.path.exists(path):
            return url
    return None


def main():
    sqlite_url = find_sqlite_url()
    if not sqlite_url:
        print("ERROR: No se encontró archivo ecourier.db")
        print("Candidatos buscados:")
        for c in SQLITE_CANDIDATES:
            if c:
                print(f"  {c}")
        sys.exit(1)

    print(f"SQLite : {sqlite_url}")
    print(f"Postgres: {POSTGRES_URL}")
    print()

    sqlite_engine = create_engine(sqlite_url)
    pg_engine = create_engine(POSTGRES_URL)

    from app.database import Base
    import app.models  # noqa: F401

    print("Creando tablas en PostgreSQL...")
    Base.metadata.create_all(bind=pg_engine)
    print("  OK\n")

    sqlite_insp = inspect(sqlite_engine)
    sqlite_tables = set(sqlite_insp.get_table_names())

    sqlite_meta = MetaData()
    sqlite_meta.reflect(bind=sqlite_engine)

    total_migrated = 0

    for table_name in TABLES_ORDER:
        if table_name not in sqlite_tables:
            print(f"  {table_name}: no existe en SQLite, omitida")
            continue

        table = sqlite_meta.tables[table_name]

        with sqlite_engine.connect() as src:
            rows = src.execute(table.select()).fetchall()
            columns = [c.name for c in table.columns]

        if not rows:
            print(f"  {table_name}: 0 registros")
            continue

        data = [dict(zip(columns, row)) for row in rows]

        with pg_engine.begin() as dest:
            dest.execute(text(f'TRUNCATE TABLE "{table_name}" CASCADE'))

            pg_meta = MetaData()
            pg_meta.reflect(bind=pg_engine, only=[table_name])
            pg_table = pg_meta.tables[table_name]

            batch_size = 1000
            for i in range(0, len(data), batch_size):
                dest.execute(pg_table.insert(), data[i:i + batch_size])

            if "id" in columns:
                max_id = max(r.get("id", 0) for r in data) or 0
                seq_name = f"{table_name}_id_seq"
                try:
                    dest.execute(text(f"SELECT setval('{seq_name}', {max_id + 1}, false)"))
                except Exception:
                    pass

        print(f"  {table_name}: {len(data):,} registros migrados")
        total_migrated += len(data)

    print(f"\nMigración completada: {total_migrated:,} registros en total.")


if __name__ == "__main__":
    main()
