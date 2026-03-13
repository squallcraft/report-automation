from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from sqlalchemy import text, inspect
from app.database import engine, Base
from app.api import auth, sellers, drivers, envios, ingesta, liquidacion, productos, comunas, ajustes, consultas, dashboard, retiros, calendario, facturacion, cpc, cpp, usuarios, tarifas_escalonadas, diagnostics, portal, chat, pickups, auditoria, planes_tarifarios, finanzas, trabajadores, prestamos
from app.middleware.timing import TimingMiddleware

try:
    Base.metadata.create_all(bind=engine, checkfirst=True)
except Exception:
    pass  # Race condition entre workers — la tabla ya fue creada por otro worker

with engine.connect() as conn:
    insp = inspect(engine)
    def safe_exec(sql, multi=False):
        """Ejecuta SQL de migración protegido contra race conditions entre workers."""
        try:
            if multi:
                for s in sql:
                    conn.execute(text(s))
            else:
                conn.execute(text(sql))
            conn.commit()
        except Exception:
            conn.rollback()

    if "admin_users" in insp.get_table_names():
        cols = [c["name"] for c in insp.get_columns("admin_users")]
        if "rol" not in cols:
            safe_exec("ALTER TABLE admin_users ADD COLUMN rol TEXT NOT NULL DEFAULT 'ADMIN'")
    if "drivers" in insp.get_table_names():
        cols = [c["name"] for c in insp.get_columns("drivers")]
        if "contratado" not in cols:
            safe_exec([
                "ALTER TABLE drivers ADD COLUMN contratado BOOLEAN NOT NULL DEFAULT FALSE",
                "UPDATE drivers SET contratado = TRUE WHERE lower(nombre) LIKE '%erick%' OR lower(nombre) LIKE '%edwyn%'",
            ], multi=True)
        if "jefe_flota_id" not in cols:
            safe_exec("ALTER TABLE drivers ADD COLUMN jefe_flota_id INTEGER REFERENCES drivers(id)")
        if "email" not in cols:
            safe_exec("ALTER TABLE drivers ADD COLUMN email TEXT")
        if "rut" not in cols:
            safe_exec("ALTER TABLE drivers ADD COLUMN rut TEXT")
        if "banco" not in cols:
            safe_exec("ALTER TABLE drivers ADD COLUMN banco TEXT")
        if "tipo_cuenta" not in cols:
            safe_exec("ALTER TABLE drivers ADD COLUMN tipo_cuenta TEXT")
        if "numero_cuenta" not in cols:
            safe_exec("ALTER TABLE drivers ADD COLUMN numero_cuenta TEXT")
        if "tarifa_retiro_fija" not in cols:
            safe_exec("ALTER TABLE drivers ADD COLUMN tarifa_retiro_fija INTEGER NOT NULL DEFAULT 0")
        if "tarifa_valparaiso" not in cols:
            safe_exec("ALTER TABLE drivers ADD COLUMN tarifa_valparaiso INTEGER NOT NULL DEFAULT 0")
        if "tarifa_melipilla" not in cols:
            safe_exec("ALTER TABLE drivers ADD COLUMN tarifa_melipilla INTEGER NOT NULL DEFAULT 0")
        if "zona" not in cols:
            safe_exec("ALTER TABLE drivers ADD COLUMN zona TEXT")
    if "admin_users" in insp.get_table_names():
        cols = [c["name"] for c in insp.get_columns("admin_users")]
        if "permisos" not in cols:
            safe_exec("ALTER TABLE admin_users ADD COLUMN permisos JSON")
    if "retiros" in insp.get_table_names() and engine.dialect.name == "postgresql":
        retiro_cols = {c["name"]: c for c in insp.get_columns("retiros")}
        if retiro_cols.get("seller_id", {}).get("nullable") is False:
            safe_exec("ALTER TABLE retiros ALTER COLUMN seller_id DROP NOT NULL")
        if retiro_cols.get("driver_id", {}).get("nullable") is False:
            safe_exec("ALTER TABLE retiros ALTER COLUMN driver_id DROP NOT NULL")
    if "pickups" in insp.get_table_names():
        pickup_cols = [c["name"] for c in insp.get_columns("pickups")]
        if "comision_paquete" not in pickup_cols:
            safe_exec("ALTER TABLE pickups ADD COLUMN comision_paquete INTEGER NOT NULL DEFAULT 200")
    if "retiros" in insp.get_table_names():
        retiro_cols_names = [c["name"] for c in insp.get_columns("retiros")]
        if "pickup_id" not in retiro_cols_names:
            safe_exec("ALTER TABLE retiros ADD COLUMN pickup_id INTEGER REFERENCES pickups(id)")
        if "sucursal_id" not in retiro_cols_names:
            safe_exec("ALTER TABLE retiros ADD COLUMN sucursal_id INTEGER REFERENCES sucursales(id)")

    if "recepciones_paquetes" in insp.get_table_names():
        rp_cols = [c["name"] for c in insp.get_columns("recepciones_paquetes")]
        if "pickup_nombre_raw" not in rp_cols:
            safe_exec("ALTER TABLE recepciones_paquetes ADD COLUMN pickup_nombre_raw TEXT")
        if engine.dialect.name == "postgresql":
            rp_col_info = {c["name"]: c for c in insp.get_columns("recepciones_paquetes")}
            if rp_col_info.get("pickup_id", {}).get("nullable") is False:
                safe_exec("ALTER TABLE recepciones_paquetes ALTER COLUMN pickup_id DROP NOT NULL")

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

    # ── Migración: campos documento en movimientos_financieros ──
    if "movimientos_financieros" in insp.get_table_names():
        mf_cols = [c["name"] for c in insp.get_columns("movimientos_financieros")]
        if "documento_nombre" not in mf_cols:
            safe_exec("ALTER TABLE movimientos_financieros ADD COLUMN documento_nombre TEXT")
        if "documento_path" not in mf_cols:
            safe_exec("ALTER TABLE movimientos_financieros ADD COLUMN documento_path TEXT")

    # ── Migración: fecha_pago en pagos_semana_sellers y pagos_semana_drivers ──
    if "pagos_semana_sellers" in insp.get_table_names():
        ps_cols = [c["name"] for c in insp.get_columns("pagos_semana_sellers")]
        if "fecha_pago" not in ps_cols:
            safe_exec("ALTER TABLE pagos_semana_sellers ADD COLUMN fecha_pago DATE")
    if "pagos_semana_drivers" in insp.get_table_names():
        pd_cols = [c["name"] for c in insp.get_columns("pagos_semana_drivers")]
        if "fecha_pago" not in pd_cols:
            safe_exec("ALTER TABLE pagos_semana_drivers ADD COLUMN fecha_pago DATE")

    # ── Migración: tablas CPP (pagos pickups) y facturas pickups se crean via create_all ──

    # ── Eliminar driver "Oscar" (27) y consolidar en "Oscar Martínez" (54) ─────
    with engine.connect() as conn:
        try:
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
        except Exception:
            conn.rollback()

# ── Seed categorías financieras ──
from app.database import SessionLocal
from app.models import CategoriaFinanciera

def _seed_categorias():
    db = SessionLocal()
    try:
        if db.query(CategoriaFinanciera).first():
            return
        tree = [
            ("INGRESO", "Ingresos", [
                ("Software", [
                    ("Inquilinos", []),
                    ("Proyectos", []),
                ]),
            ]),
            ("EGRESO", "Egresos", [
                ("Remuneraciones", [
                    ("Sueldos", []),
                    ("Cotizaciones Previsionales", []),
                ]),
                ("Arriendo y Servicios", [
                    ("Arriendo", []),
                    ("Servicios Básicos", []),
                ]),
                ("Tecnología", [
                    ("Servidores", []),
                    ("Software / APIs", []),
                ]),
                ("Freelancers", []),
                ("Marketing", []),
                ("Impuestos", [
                    ("IVA", []),
                    ("PPM", []),
                ]),
                ("Deudas", [
                    ("Créditos", []),
                    ("Leasing", []),
                ]),
                ("Otros", []),
            ]),
        ]

        def _insert(tipo, nombre, hijos, parent_id=None, orden=0):
            cat = CategoriaFinanciera(nombre=nombre, tipo=tipo, parent_id=parent_id, orden=orden)
            db.add(cat)
            db.flush()
            for i, hijo in enumerate(hijos):
                if len(hijo) == 2:
                    child_nombre, child_hijos = hijo
                else:
                    child_nombre, child_hijos = hijo[0], []
                _insert(tipo, child_nombre, child_hijos, parent_id=cat.id, orden=i)

        for i, (tipo, nombre, hijos) in enumerate(tree):
            _insert(tipo, nombre, hijos, orden=i)

        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()

_seed_categorias()


# ── Seed plan de cuentas contables (GL) ──
from app.models import CuentaContable

def _seed_cuentas_contables():
    db = SessionLocal()
    try:
        if db.query(CuentaContable).first():
            return

        plan = [
            ("ACTIVO", [
                ("1.0", "Activos", [
                    ("1.1", "Banco", []),
                    ("1.2", "Cuentas por Cobrar Sellers", []),
                    ("1.3", "IVA Crédito Fiscal", []),
                ]),
            ]),
            ("PASIVO", [
                ("2.0", "Pasivos", [
                    ("2.1", "Cuentas por Pagar Drivers", []),
                    ("2.2", "Cuentas por Pagar Pickups", []),
                    ("2.3", "Cuentas por Pagar Proveedores", []),
                    ("2.4", "IVA Débito Fiscal", []),
                    ("2.5", "Remuneraciones por Pagar", []),
                ]),
            ]),
            ("PATRIMONIO", [
                ("3.0", "Patrimonio", [
                    ("3.1", "Capital", []),
                    ("3.2", "Resultados Acumulados", []),
                ]),
            ]),
            ("INGRESO", [
                ("4.0", "Ingresos", [
                    ("4.1", "Ingreso Operacional Sellers", []),
                    ("4.2", "Ingreso Software", []),
                    ("4.3", "Otros Ingresos", []),
                ]),
            ]),
            ("GASTO", [
                ("5.0", "Gastos", [
                    ("5.1", "Costo Drivers", []),
                    ("5.2", "Costo Pickups", []),
                    ("5.3", "Remuneraciones", []),
                    ("5.4", "Arriendo y Servicios", []),
                    ("5.5", "Tecnología", []),
                    ("5.6", "Freelancers", []),
                    ("5.7", "Marketing", []),
                    ("5.8", "Impuestos", []),
                    ("5.9", "Otros Gastos", []),
                ]),
            ]),
        ]

        def _insert_cuenta(tipo, codigo, nombre, hijos, parent_id=None, orden=0):
            cuenta = CuentaContable(codigo=codigo, nombre=nombre, tipo=tipo, parent_id=parent_id, orden=orden)
            db.add(cuenta)
            db.flush()
            for i, (c_codigo, c_nombre, c_hijos) in enumerate(hijos):
                _insert_cuenta(tipo, c_codigo, c_nombre, c_hijos, parent_id=cuenta.id, orden=i)

        for i, (tipo, cuentas) in enumerate(plan):
            for j, (codigo, nombre, hijos) in enumerate(cuentas):
                _insert_cuenta(tipo, codigo, nombre, hijos, orden=i * 10 + j)

        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()

_seed_cuentas_contables()


# ── Migración: ampliar plan de cuentas (bancos, TC, líneas crédito, inversiones) ──
def _ampliar_plan_cuentas():
    db = SessionLocal()
    try:
        nuevas = [
            ("1.1.1", "Banco de Chile CTA CTE", "ACTIVO", "1.0"),
            ("1.1.2", "Santander CTA CTE", "ACTIVO", "1.0"),
            ("1.4", "Inversiones Financieras", "ACTIVO", "1.0"),
            ("1.4.1", "Fondos Mutuos", "ACTIVO", "1.4"),
            ("1.4.2", "Depósitos a Plazo", "ACTIVO", "1.4"),
            ("2.6", "Tarjeta Crédito Banco de Chile", "PASIVO", "2.0"),
            ("2.7", "Tarjeta Crédito Santander", "PASIVO", "2.0"),
            ("2.8", "Línea Crédito Banco de Chile", "PASIVO", "2.0"),
            ("2.9", "Línea Crédito Santander", "PASIVO", "2.0"),
            ("4.4", "Ingresos Financieros", "INGRESO", "4.0"),
            ("5.10", "Intereses y Comisiones", "GASTO", "5.0"),
        ]
        for codigo, nombre, tipo, parent_codigo in nuevas:
            exists = db.query(CuentaContable).filter(CuentaContable.codigo == codigo).first()
            if exists:
                continue
            parent = db.query(CuentaContable).filter(CuentaContable.codigo == parent_codigo).first()
            if not parent:
                continue
            db.add(CuentaContable(codigo=codigo, nombre=nombre, tipo=tipo, parent_id=parent.id))

        # Renombrar 1.1 "Banco" → "Banco (General)" para distinguir de las subcuentas
        vieja = db.query(CuentaContable).filter(CuentaContable.codigo == "1.1").first()
        if vieja and vieja.nombre == "Banco":
            vieja.nombre = "Banco (General)"

        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()

_ampliar_plan_cuentas()


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
app.include_router(cpp.router, prefix="/api")
app.include_router(usuarios.router, prefix="/api")
app.include_router(tarifas_escalonadas.router, prefix="/api")
app.include_router(diagnostics.router, prefix="/api")
app.include_router(portal.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(pickups.router, prefix="/api")
app.include_router(auditoria.router, prefix="/api")
app.include_router(planes_tarifarios.router, prefix="/api")
app.include_router(finanzas.router, prefix="/api")
app.include_router(trabajadores.router, prefix="/api")
app.include_router(prestamos.router, prefix="/api")


@app.get("/")
def root():
    return {"message": "ECourier API v1.0", "docs": "/docs"}
