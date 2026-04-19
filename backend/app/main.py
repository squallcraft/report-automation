from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from sqlalchemy import text, inspect
from app.database import engine, Base
from app.api import auth, sellers, drivers, envios, ingesta, liquidacion, productos, comunas, ajustes, consultas, dashboard, retiros, calendario, facturacion, cpc, cpp, usuarios, tarifas_escalonadas, diagnostics, portal, chat, pickups, auditoria, planes_tarifarios, finanzas, trabajadores, prestamos, pagos_trabajadores, bi, tareas, snapshots, whatsapp, leads, colaboradores, parametros_remuneracion, remuneraciones, iva_drivers, contratos, horas_extras
from app.middleware.timing import TimingMiddleware

for _attempt in range(3):
    try:
        Base.metadata.create_all(bind=engine, checkfirst=True)
        break
    except Exception:
        import time as _t; _t.sleep(1)

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
        if "acuerdo_aceptado" not in cols:
            safe_exec("ALTER TABLE drivers ADD COLUMN acuerdo_aceptado BOOLEAN NOT NULL DEFAULT FALSE")
        if "acuerdo_version" not in cols:
            safe_exec("ALTER TABLE drivers ADD COLUMN acuerdo_version TEXT")
        if "acuerdo_fecha" not in cols:
            safe_exec("ALTER TABLE drivers ADD COLUMN acuerdo_fecha TIMESTAMP")
        if "acuerdo_ip" not in cols:
            safe_exec("ALTER TABLE drivers ADD COLUMN acuerdo_ip TEXT")
        if "acuerdo_firma" not in cols:
            safe_exec("ALTER TABLE drivers ADD COLUMN acuerdo_firma TEXT")
        if "trabajador_id" not in cols:
            safe_exec("ALTER TABLE drivers ADD COLUMN trabajador_id INTEGER REFERENCES trabajadores(id)")
        if "contrato_trabajo_aceptado" not in cols:
            safe_exec("ALTER TABLE drivers ADD COLUMN contrato_trabajo_aceptado BOOLEAN NOT NULL DEFAULT FALSE")
        if "contrato_trabajo_version" not in cols:
            safe_exec("ALTER TABLE drivers ADD COLUMN contrato_trabajo_version TEXT")
        if "contrato_trabajo_fecha" not in cols:
            safe_exec("ALTER TABLE drivers ADD COLUMN contrato_trabajo_fecha TIMESTAMP")
        if "contrato_trabajo_ip" not in cols:
            safe_exec("ALTER TABLE drivers ADD COLUMN contrato_trabajo_ip TEXT")
        if "contrato_trabajo_firma" not in cols:
            safe_exec("ALTER TABLE drivers ADD COLUMN contrato_trabajo_firma TEXT")
    if "admin_users" in insp.get_table_names():
        cols = [c["name"] for c in insp.get_columns("admin_users")]
        if "permisos" not in cols:
            safe_exec("ALTER TABLE admin_users ADD COLUMN permisos JSON")
    if "trabajadores" in insp.get_table_names():
        trab_cols = [c["name"] for c in insp.get_columns("trabajadores")]
        for col_name, col_def in [
            ("movilizacion", "INTEGER NOT NULL DEFAULT 0"),
            ("colacion", "INTEGER NOT NULL DEFAULT 0"),
            ("viaticos", "INTEGER NOT NULL DEFAULT 0"),
            ("tipo_contrato", "TEXT"),
            ("monto_cotizacion_salud", "TEXT"),
            ("sueldo_liquido", "INTEGER NOT NULL DEFAULT 0"),
            ("sueldo_base", "INTEGER NOT NULL DEFAULT 0"),
            ("gratificacion", "INTEGER NOT NULL DEFAULT 0"),
            ("descuento_cesantia", "INTEGER NOT NULL DEFAULT 0"),
            ("iusc", "INTEGER NOT NULL DEFAULT 0"),
            ("adicional_isapre", "INTEGER NOT NULL DEFAULT 0"),
            ("password_hash", "TEXT"),
            ("firma_base64",  "TEXT"),
        ]:
            if col_name not in trab_cols:
                safe_exec(f"ALTER TABLE trabajadores ADD COLUMN {col_name} {col_def}")

    # ── Tabla parametros_mensuales ───────────────────────────────────────────
    if "parametros_mensuales" not in insp.get_table_names():
        safe_exec("""
            CREATE TABLE parametros_mensuales (
                id SERIAL PRIMARY KEY,
                anio INTEGER NOT NULL,
                mes INTEGER NOT NULL,
                uf NUMERIC(12,4) NOT NULL,
                utm INTEGER NOT NULL,
                imm INTEGER NOT NULL,
                fuente TEXT,
                updated_at TIMESTAMP DEFAULT now(),
                UNIQUE (anio, mes)
            )
        """)

    # ── Tabla liquidaciones_mensuales ────────────────────────────────────────
    if "liquidaciones_mensuales" not in insp.get_table_names():
        safe_exec("""
            CREATE TABLE liquidaciones_mensuales (
                id SERIAL PRIMARY KEY,
                trabajador_id INTEGER NOT NULL REFERENCES trabajadores(id),
                mes INTEGER NOT NULL,
                anio INTEGER NOT NULL,
                parametros_id INTEGER REFERENCES parametros_mensuales(id),
                sueldo_base INTEGER NOT NULL DEFAULT 0,
                gratificacion INTEGER NOT NULL DEFAULT 0,
                movilizacion INTEGER NOT NULL DEFAULT 0,
                colacion INTEGER NOT NULL DEFAULT 0,
                viaticos INTEGER NOT NULL DEFAULT 0,
                remuneracion_imponible INTEGER NOT NULL DEFAULT 0,
                descuento_afp INTEGER NOT NULL DEFAULT 0,
                descuento_salud_legal INTEGER NOT NULL DEFAULT 0,
                adicional_isapre INTEGER NOT NULL DEFAULT 0,
                descuento_cesantia INTEGER NOT NULL DEFAULT 0,
                iusc INTEGER NOT NULL DEFAULT 0,
                total_descuentos INTEGER NOT NULL DEFAULT 0,
                sueldo_liquido INTEGER NOT NULL DEFAULT 0,
                costo_sis INTEGER NOT NULL DEFAULT 0,
                costo_cesantia_empleador INTEGER NOT NULL DEFAULT 0,
                costo_mutual INTEGER NOT NULL DEFAULT 0,
                costo_empresa_total INTEGER NOT NULL DEFAULT 0,
                uf_usada NUMERIC(12,4),
                utm_usado INTEGER,
                imm_usado INTEGER,
                estado TEXT NOT NULL DEFAULT 'BORRADOR',
                pago_mes_id INTEGER REFERENCES pagos_mes_trabajadores(id),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                CONSTRAINT uq_liquidacion_mensual UNIQUE (trabajador_id, mes, anio)
            )
        """)
    # ── Tabla contrato_trabajador_versiones (versionado contractual) ─────────
    if "contrato_trabajador_versiones" not in insp.get_table_names():
        safe_exec("""
            CREATE TABLE contrato_trabajador_versiones (
                id SERIAL PRIMARY KEY,
                trabajador_id INTEGER NOT NULL REFERENCES trabajadores(id),
                vigente_desde DATE NOT NULL,
                vigente_hasta DATE,
                sueldo_liquido INTEGER NOT NULL DEFAULT 0,
                sueldo_base INTEGER NOT NULL DEFAULT 0,
                gratificacion INTEGER NOT NULL DEFAULT 0,
                movilizacion INTEGER NOT NULL DEFAULT 0,
                colacion INTEGER NOT NULL DEFAULT 0,
                viaticos INTEGER NOT NULL DEFAULT 0,
                jornada_semanal_horas INTEGER NOT NULL DEFAULT 44,
                tipo_jornada TEXT NOT NULL DEFAULT 'COMPLETA',
                distribucion_jornada TEXT,
                cargo TEXT,
                tipo_contrato TEXT,
                motivo TEXT NOT NULL DEFAULT 'CONTRATACION',
                notas TEXT,
                creado_por TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        safe_exec("CREATE INDEX IF NOT EXISTS ix_contrato_trab_vigencia ON contrato_trabajador_versiones (trabajador_id, vigente_desde)")

    # ── Tabla anexos_contrato ────────────────────────────────────────────────
    if "anexos_contrato" not in insp.get_table_names():
        safe_exec("""
            CREATE TABLE anexos_contrato (
                id SERIAL PRIMARY KEY,
                trabajador_id INTEGER NOT NULL REFERENCES trabajadores(id),
                version_id INTEGER REFERENCES contrato_trabajador_versiones(id),
                tipo TEXT NOT NULL,
                titulo TEXT NOT NULL,
                pdf_generado TEXT,
                pdf_subido_path TEXT,
                requiere_firma_trabajador BOOLEAN NOT NULL DEFAULT TRUE,
                estado TEXT NOT NULL DEFAULT 'BORRADOR',
                firma_trabajador_snapshot TEXT,
                firmado_at TIMESTAMP,
                firmado_ip TEXT,
                visto_at TIMESTAMP,
                creado_por TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """)
        safe_exec("CREATE INDEX IF NOT EXISTS ix_anexos_contrato_trab ON anexos_contrato (trabajador_id)")

    # ── Tabla horas_extras_trabajadores ──────────────────────────────────────
    if "horas_extras_trabajadores" not in insp.get_table_names():
        safe_exec("""
            CREATE TABLE horas_extras_trabajadores (
                id SERIAL PRIMARY KEY,
                trabajador_id INTEGER NOT NULL REFERENCES trabajadores(id),
                mes INTEGER NOT NULL,
                anio INTEGER NOT NULL,
                cantidad_50 NUMERIC(6,2) NOT NULL DEFAULT 0,
                cantidad_100 NUMERIC(6,2) NOT NULL DEFAULT 0,
                valor_hora_calculado INTEGER NOT NULL DEFAULT 0,
                monto_50 INTEGER NOT NULL DEFAULT 0,
                monto_100 INTEGER NOT NULL DEFAULT 0,
                monto_total INTEGER NOT NULL DEFAULT 0,
                contrato_version_id INTEGER REFERENCES contrato_trabajador_versiones(id),
                sueldo_base_snapshot INTEGER NOT NULL DEFAULT 0,
                jornada_snapshot INTEGER NOT NULL DEFAULT 44,
                nota TEXT,
                creado_por TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                CONSTRAINT uq_he_trab_mes UNIQUE (trabajador_id, mes, anio)
            )
        """)

    # ── Tabla configuracion_legal (singleton) ────────────────────────────────
    if "configuracion_legal" not in insp.get_table_names():
        safe_exec("""
            CREATE TABLE configuracion_legal (
                id INTEGER PRIMARY KEY,
                jornada_legal_vigente INTEGER NOT NULL DEFAULT 44,
                jornada_legal_proxima INTEGER,
                jornada_legal_proxima_desde DATE,
                rep_legal_nombre TEXT,
                rep_legal_rut TEXT,
                empresa_razon_social TEXT,
                empresa_rut TEXT,
                empresa_direccion TEXT,
                actualizado_por TEXT,
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """)
    # Seed singleton (idempotente; corre aunque la tabla la haya creado SQLAlchemy)
    safe_exec("""
        INSERT INTO configuracion_legal (id, jornada_legal_vigente, rep_legal_nombre, rep_legal_rut, empresa_razon_social)
        VALUES (1, 44, 'Adriana Colina Aguilar', '25.936.753-0', 'E-Courier')
        ON CONFLICT (id) DO NOTHING
    """)

    # ── Migración: liquidaciones_mensuales: agregar campos de horas extras ───
    if "liquidaciones_mensuales" in insp.get_table_names():
        liq_cols = [c["name"] for c in insp.get_columns("liquidaciones_mensuales")]
        for col_name, col_def in [
            ("horas_extras_50_cantidad", "NUMERIC(6,2) NOT NULL DEFAULT 0"),
            ("horas_extras_100_cantidad", "NUMERIC(6,2) NOT NULL DEFAULT 0"),
            ("horas_extras_50_monto", "INTEGER NOT NULL DEFAULT 0"),
            ("horas_extras_100_monto", "INTEGER NOT NULL DEFAULT 0"),
            ("horas_extras_monto", "INTEGER NOT NULL DEFAULT 0"),
            ("valor_hora_usado", "INTEGER NOT NULL DEFAULT 0"),
            ("jornada_semanal_usada", "INTEGER NOT NULL DEFAULT 44"),
        ]:
            if col_name not in liq_cols:
                safe_exec(f"ALTER TABLE liquidaciones_mensuales ADD COLUMN {col_name} {col_def}")

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

    # ── Migración: pagos_mes_trabajadores ──
    if "pagos_mes_trabajadores" not in insp.get_table_names():
        safe_exec("""
            CREATE TABLE IF NOT EXISTS pagos_mes_trabajadores (
                id SERIAL PRIMARY KEY,
                trabajador_id INTEGER NOT NULL REFERENCES trabajadores(id),
                mes INTEGER NOT NULL,
                anio INTEGER NOT NULL,
                monto_bruto INTEGER NOT NULL DEFAULT 0,
                bonificaciones INTEGER NOT NULL DEFAULT 0,
                descuento_cuotas INTEGER NOT NULL DEFAULT 0,
                descuento_ajustes INTEGER NOT NULL DEFAULT 0,
                monto_neto INTEGER NOT NULL DEFAULT 0,
                estado TEXT NOT NULL DEFAULT 'PENDIENTE',
                fecha_pago DATE,
                nota TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                CONSTRAINT uq_pago_mes_trabajador UNIQUE (trabajador_id, mes, anio)
            )
        """)
    else:
        # Agregar columna bonificaciones si no existe
        pmt_cols = [c["name"] for c in insp.get_columns("pagos_mes_trabajadores")]
        if "bonificaciones" not in pmt_cols:
            safe_exec("ALTER TABLE pagos_mes_trabajadores ADD COLUMN bonificaciones INTEGER NOT NULL DEFAULT 0")
        if "monto_pagado" not in pmt_cols:
            safe_exec("ALTER TABLE pagos_mes_trabajadores ADD COLUMN monto_pagado INTEGER NOT NULL DEFAULT 0")

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

    # ── Migración: tipo_pago en sellers ──
    if "sellers" in insp.get_table_names():
        sel_cols = [c["name"] for c in insp.get_columns("sellers")]
        if "tipo_pago" not in sel_cols:
            safe_exec("ALTER TABLE sellers ADD COLUMN tipo_pago TEXT NOT NULL DEFAULT 'semanal'")

    # ── Migración: Grok Memory System (brief + snapshot) ──
    safe_exec("""
        CREATE TABLE IF NOT EXISTS grok_brief (
            id SERIAL PRIMARY KEY,
            contenido TEXT NOT NULL DEFAULT '',
            updated_at TIMESTAMP DEFAULT NOW()
        )
    """)
    safe_exec("""
        CREATE TABLE IF NOT EXISTS grok_snapshot (
            id SERIAL PRIMARY KEY,
            contenido TEXT NOT NULL DEFAULT '',
            generado_en TIMESTAMP DEFAULT NOW(),
            tokens_aprox INTEGER DEFAULT 0
        )
    """)
    safe_exec("""
        CREATE TABLE IF NOT EXISTS grok_memoria (
            id SERIAL PRIMARY KEY,
            anio INTEGER NOT NULL UNIQUE,
            contenido TEXT NOT NULL DEFAULT '',
            tokens_aprox INTEGER DEFAULT 0,
            generado_en TIMESTAMP DEFAULT NOW()
        )
    """)
    # Seed: insertar fila inicial del brief si no existe
    with engine.connect() as conn:
        try:
            count = conn.execute(text("SELECT COUNT(*) FROM grok_brief")).scalar()
            if count == 0:
                conn.execute(text("""
                    INSERT INTO grok_brief (contenido) VALUES (
                        'E-Courier es una empresa chilena de paquetería B2B. '
                        'Opera con sellers (clientes que generan envíos), drivers (conductores que entregan), '
                        'y pickups (puntos de retiro/recepción). '
                        'Los drivers pueden ser contratados (flota propia con sueldos, combustible y mantención) '
                        'o tercerizados. Algunos drivers son Jefes de Flota con conductores subordinados. '
                        'Los sellers tienen tipo de pago: semanal, quincenal o mensual. '
                        'La empresa tiene créditos vehiculares activos: Forum-JAC ($483.085/mes, vence día 2) '
                        'y Tanner-Foton ($395.179/mes, vence día 23). '
                        'El sistema registra envíos con cobro_seller (ingreso) y costo_driver (egreso). '
                        'Los extras (producto, comuna) se suman al cobro del seller y al costo del driver. '
                        'Moneda: CLP. Datos históricos disponibles desde 2024.'
                    )
                """))
                conn.commit()
        except Exception:
            conn.rollback()

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

    # ── Migración: agregar columna concepto a boletas_colaboradores y eliminar constraint único ──
    if "boletas_colaboradores" in insp.get_table_names():
        cols = [c["name"] for c in insp.get_columns("boletas_colaboradores")]
        if "concepto" not in cols:
            safe_exec("ALTER TABLE boletas_colaboradores ADD COLUMN concepto TEXT")
        safe_exec("ALTER TABLE boletas_colaboradores DROP CONSTRAINT IF EXISTS uq_boleta_colaborador_periodo")

    # ── Migración: tipo_documento en facturas_drivers ──
    if "facturas_drivers" in insp.get_table_names():
        fd_cols = [c["name"] for c in insp.get_columns("facturas_drivers")]
        if "tipo_documento" not in fd_cols:
            safe_exec("ALTER TABLE facturas_drivers ADD COLUMN tipo_documento TEXT NOT NULL DEFAULT 'FACTURA'")

    # ── Migración: IVA Drivers ──    if "pagos_iva_drivers" not in insp.get_table_names():
        safe_exec("""
            CREATE TABLE pagos_iva_drivers (
                id SERIAL PRIMARY KEY,
                driver_id INTEGER NOT NULL REFERENCES drivers(id),
                mes_origen INTEGER NOT NULL,
                anio_origen INTEGER NOT NULL,
                estado TEXT NOT NULL DEFAULT 'PENDIENTE',
                base_iva_snapshot INTEGER,
                monto_iva_snapshot INTEGER,
                facturas_incluidas JSONB,
                fecha_pago DATE,
                nota TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                CONSTRAINT uq_pago_iva_driver UNIQUE (driver_id, mes_origen, anio_origen)
            )
        """)
    if "pagos_cartola_iva" not in insp.get_table_names():
        safe_exec("""
            CREATE TABLE pagos_cartola_iva (
                id SERIAL PRIMARY KEY,
                pago_iva_driver_id INTEGER NOT NULL REFERENCES pagos_iva_drivers(id),
                driver_id INTEGER NOT NULL REFERENCES drivers(id),
                mes INTEGER NOT NULL,
                anio INTEGER NOT NULL,
                monto INTEGER NOT NULL,
                fecha_pago TEXT,
                descripcion TEXT,
                fuente TEXT NOT NULL DEFAULT 'cartola',
                fingerprint TEXT UNIQUE,
                carga_id INTEGER REFERENCES cartola_cargas(id),
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)

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
app.include_router(pagos_trabajadores.router, prefix="/api")  # antes de trabajadores para evitar colisión de rutas /{id}
app.include_router(trabajadores.router, prefix="/api")
app.include_router(prestamos.router, prefix="/api")
app.include_router(bi.router, prefix="/api")
app.include_router(tareas.router, prefix="/api")
app.include_router(snapshots.router, prefix="/api")
app.include_router(whatsapp.router, prefix="/api")
app.include_router(leads.router, prefix="/api")
app.include_router(colaboradores.router, prefix="/api")
app.include_router(parametros_remuneracion.router, prefix="/api")
app.include_router(remuneraciones.router, prefix="/api")
app.include_router(iva_drivers.router, prefix="/api")
app.include_router(contratos.router, prefix="/api")
app.include_router(horas_extras.router, prefix="/api")


@app.on_event("startup")
async def _startup_parametros():
    """Actualiza UF/UTM del mes actual al arrancar. Falla silenciosamente."""
    try:
        from app.database import SessionLocal
        from app.services.parametros import actualizar_mes_actual
        db = SessionLocal()
        try:
            actualizar_mes_actual(db)
        finally:
            db.close()
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning("Startup parametros failed (non-fatal): %s", exc)


@app.get("/")
def root():
    return {"message": "ECourier API v1.0", "docs": "/docs"}
