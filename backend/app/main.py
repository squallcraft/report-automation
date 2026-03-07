from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from sqlalchemy import text, inspect
from app.database import engine, Base
from app.api import auth, sellers, drivers, envios, ingesta, liquidacion, productos, comunas, ajustes, consultas, dashboard, retiros, calendario, facturacion, cpc, usuarios, tarifas_escalonadas, diagnostics, portal, chat, pickups, auditoria
from app.middleware.timing import TimingMiddleware

try:
    Base.metadata.create_all(bind=engine, checkfirst=True)
except Exception:
    pass  # Race condition entre workers — la tabla ya fue creada por otro worker

with engine.connect() as conn:
    insp = inspect(engine)
    if "admin_users" in insp.get_table_names():
        cols = [c["name"] for c in insp.get_columns("admin_users")]
        if "rol" not in cols:
            conn.execute(text("ALTER TABLE admin_users ADD COLUMN rol TEXT NOT NULL DEFAULT 'ADMIN'"))
            conn.commit()
    if "drivers" in insp.get_table_names():
        cols = [c["name"] for c in insp.get_columns("drivers")]
        if "contratado" not in cols:
            conn.execute(text("ALTER TABLE drivers ADD COLUMN contratado BOOLEAN NOT NULL DEFAULT FALSE"))
            conn.execute(text(
                "UPDATE drivers SET contratado = TRUE "
                "WHERE lower(nombre) LIKE '%erick%' OR lower(nombre) LIKE '%edwyn%'"
            ))
            conn.commit()
        if "jefe_flota_id" not in cols:
            conn.execute(text("ALTER TABLE drivers ADD COLUMN jefe_flota_id INTEGER REFERENCES drivers(id)"))
            conn.commit()
        if "email" not in cols:
            conn.execute(text("ALTER TABLE drivers ADD COLUMN email TEXT"))
            conn.commit()
        if "rut" not in cols:
            conn.execute(text("ALTER TABLE drivers ADD COLUMN rut TEXT"))
            conn.commit()
        if "banco" not in cols:
            conn.execute(text("ALTER TABLE drivers ADD COLUMN banco TEXT"))
            conn.commit()
        if "tipo_cuenta" not in cols:
            conn.execute(text("ALTER TABLE drivers ADD COLUMN tipo_cuenta TEXT"))
            conn.commit()
        if "numero_cuenta" not in cols:
            conn.execute(text("ALTER TABLE drivers ADD COLUMN numero_cuenta TEXT"))
            conn.commit()
        if "tarifa_retiro_fija" not in cols:
            try:
                conn.execute(text("ALTER TABLE drivers ADD COLUMN tarifa_retiro_fija INTEGER NOT NULL DEFAULT 0"))
                conn.commit()
            except Exception:
                conn.rollback()
    if "admin_users" in insp.get_table_names():
        cols = [c["name"] for c in insp.get_columns("admin_users")]
        if "permisos" not in cols:
            conn.execute(text("ALTER TABLE admin_users ADD COLUMN permisos JSON"))
            conn.commit()
    if "retiros" in insp.get_table_names() and engine.dialect.name == "postgresql":
        retiro_cols = {c["name"]: c for c in insp.get_columns("retiros")}
        if retiro_cols.get("seller_id", {}).get("nullable") is False:
            conn.execute(text("ALTER TABLE retiros ALTER COLUMN seller_id DROP NOT NULL"))
            conn.commit()
        if retiro_cols.get("driver_id", {}).get("nullable") is False:
            conn.execute(text("ALTER TABLE retiros ALTER COLUMN driver_id DROP NOT NULL"))
            conn.commit()
    # pickups y recepciones_paquetes se crean via create_all
    if "pickups" in insp.get_table_names():
        pickup_cols = [c["name"] for c in insp.get_columns("pickups")]
        if "comision_paquete" not in pickup_cols:
            conn.execute(text("ALTER TABLE pickups ADD COLUMN comision_paquete INTEGER NOT NULL DEFAULT 200"))
            conn.commit()
    # Agregar pickup_id a retiros si no existe
    if "retiros" in insp.get_table_names():
        retiro_cols_names = [c["name"] for c in insp.get_columns("retiros")]
        if "pickup_id" not in retiro_cols_names:
            conn.execute(text("ALTER TABLE retiros ADD COLUMN pickup_id INTEGER REFERENCES pickups(id)"))
            conn.commit()

    # Pickups se crean manualmente desde el admin — no se migran desde sellers

    # ── Migración audit_logs: agregar nuevas columnas si faltan ──
    if "audit_logs" in insp.get_table_names():
        al_cols = [c["name"] for c in insp.get_columns("audit_logs")]
        for col_name, col_def in [
            ("usuario_id", "INTEGER"),
            ("usuario_nombre", "TEXT"),
            ("usuario_rol", "TEXT"),
            ("ip_address", "TEXT"),
            ("accion", "TEXT"),
            ("entidad", "TEXT"),
            ("entidad_id", "INTEGER"),
            ("cambios", "JSONB"),
            ("metadata", "JSONB"),
        ]:
            if col_name not in al_cols:
                try:
                    conn.execute(text(f"ALTER TABLE audit_logs ADD COLUMN {col_name} {col_def}"))
                    conn.commit()
                except Exception:
                    conn.rollback()
        # Hacer nullable las columnas legacy que antes eran NOT NULL
        for legacy_col in ("action", "username", "ip", "detail"):
            try:
                conn.execute(text(f"ALTER TABLE audit_logs ALTER COLUMN {legacy_col} DROP NOT NULL"))
                conn.commit()
            except Exception:
                conn.rollback()
        # Crear índice en accion y entidad si no existen
        try:
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_accion ON audit_logs (accion)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_entidad ON audit_logs (entidad)"))
            conn.commit()
        except Exception:
            conn.rollback()

    # ── Migración: cartola_cargas se crea via create_all ──
    # ── Migración: carga_id en pagos_cartola_drivers y pagos_cartola_sellers ──
    if "pagos_cartola_drivers" in insp.get_table_names():
        pcd_cols = [c["name"] for c in insp.get_columns("pagos_cartola_drivers")]
        if "carga_id" not in pcd_cols:
            try:
                conn.execute(text("ALTER TABLE pagos_cartola_drivers ADD COLUMN carga_id INTEGER REFERENCES cartola_cargas(id)"))
                conn.commit()
            except Exception:
                conn.rollback()
    if "pagos_cartola_sellers" in insp.get_table_names():
        pcs_cols = [c["name"] for c in insp.get_columns("pagos_cartola_sellers")]
        if "carga_id" not in pcs_cols:
            try:
                conn.execute(text("ALTER TABLE pagos_cartola_sellers ADD COLUMN carga_id INTEGER REFERENCES cartola_cargas(id)"))
                conn.commit()
            except Exception:
                conn.rollback()

    # ── Migración Fase 2: campos de estado en envíos ──
    if "envios" in insp.get_table_names():
        env_cols = [c["name"] for c in insp.get_columns("envios")]
        for col_name, col_def in [
            ("estado_entrega", "TEXT NOT NULL DEFAULT 'delivered'"),
            ("estado_financiero", "TEXT NOT NULL DEFAULT 'pendiente'"),
            ("is_liquidado", "BOOLEAN NOT NULL DEFAULT FALSE"),
            ("is_facturado", "BOOLEAN NOT NULL DEFAULT FALSE"),
            ("is_pagado_driver", "BOOLEAN NOT NULL DEFAULT FALSE"),
            ("origen", "TEXT NOT NULL DEFAULT 'ingesta'"),
            ("external_id", "TEXT"),
        ]:
            if col_name not in env_cols:
                try:
                    conn.execute(text(f"ALTER TABLE envios ADD COLUMN {col_name} {col_def}"))
                    conn.commit()
                except Exception:
                    conn.rollback()
        # Índice en estado_financiero
        try:
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_envios_estado_financiero ON envios (estado_financiero)"))
            conn.commit()
        except Exception:
            conn.rollback()

    # ── Eliminar driver "Oscar" (27) y consolidar en "Oscar Martínez" (54) ─────
    with engine.connect() as conn:
        exists = conn.execute(text("SELECT 1 FROM drivers WHERE id = 27")).fetchone()
        if exists:
            conn.execute(text("UPDATE envios SET driver_id = 54 WHERE driver_id = 27"))
            conn.execute(text("UPDATE retiros SET driver_id = 54 WHERE driver_id = 27"))
            conn.execute(text("DELETE FROM pagos_semana_drivers WHERE driver_id = 27"))
            conn.execute(text("DELETE FROM pagos_cartola_drivers WHERE driver_id = 27"))
            conn.execute(text("""
                UPDATE drivers
                SET aliases = COALESCE(aliases, '[]'::json)::jsonb || '["Oscar Guzman", "Oscar"]'::jsonb
                WHERE id = 54
                  AND NOT (COALESCE(aliases, '[]'::json)::jsonb @> '["Oscar"]'::jsonb)
            """))
            conn.execute(text("DELETE FROM drivers WHERE id = 27"))
            conn.commit()

app = FastAPI(
    title="ECourier — Sistema de Liquidación Logística",
    description="API para gestión de cobros a sellers y pagos a drivers",
    version="1.0.0",
)

settings = get_settings()
app.add_middleware(TimingMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(sellers.router, prefix="/api")
app.include_router(drivers.router, prefix="/api")
app.include_router(envios.router, prefix="/api")
app.include_router(ingesta.router, prefix="/api")
app.include_router(liquidacion.router, prefix="/api")
app.include_router(productos.router, prefix="/api")
app.include_router(comunas.router, prefix="/api")
app.include_router(ajustes.router, prefix="/api")
app.include_router(retiros.router, prefix="/api")
app.include_router(consultas.router, prefix="/api")
app.include_router(calendario.router, prefix="/api")
app.include_router(facturacion.router, prefix="/api")
app.include_router(cpc.router, prefix="/api")
app.include_router(usuarios.router, prefix="/api")
app.include_router(tarifas_escalonadas.router, prefix="/api")
app.include_router(diagnostics.router, prefix="/api")
app.include_router(portal.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(pickups.router, prefix="/api")
app.include_router(auditoria.router, prefix="/api")


@app.get("/")
def root():
    return {"message": "ECourier API v1.0", "docs": "/docs"}
