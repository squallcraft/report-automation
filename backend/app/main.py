from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from sqlalchemy import text, inspect
from app.database import engine, Base
from app.api import auth, sellers, drivers, envios, ingesta, liquidacion, productos, comunas, ajustes, consultas, dashboard, retiros, calendario, facturacion, cpc, cpp, usuarios, tarifas_escalonadas, diagnostics, portal, chat, pickups, auditoria, planes_tarifarios, finanzas, trabajadores, prestamos, pagos_trabajadores, bi, tareas, snapshots, whatsapp, leads, colaboradores, parametros_remuneracion, remuneraciones, iva_drivers, contratos, horas_extras, plantillas_contrato, notificaciones_trabajador, vacaciones, asistencia, email_campaigns, flota, rentabilidad, jornadas_horarias, cron_jobs, asignaciones_ruta
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
            # Datos personales para contratos digitales (Camino B)
            ("telefono", "TEXT"),
            ("whatsapp", "TEXT"),
            ("fecha_nacimiento", "DATE"),
            ("nacionalidad", "TEXT"),
            ("estado_civil", "TEXT"),
            # Feriado progresivo (Art. 68 CT): años acreditados con empleadores anteriores
            ("anios_servicio_previos", "INTEGER NOT NULL DEFAULT 0"),
            # Control horario digital (ZKBioTime)
            ("zkbio_employee_id", "TEXT"),
            ("zkbio_employee_codigo", "TEXT"),
            ("hora_entrada_esperada", "TEXT"),
            ("hora_salida_esperada", "TEXT"),
            ("minutos_colacion", "INTEGER NOT NULL DEFAULT 60"),
        ]:
            if col_name not in trab_cols:
                safe_exec(f"ALTER TABLE trabajadores ADD COLUMN {col_name} {col_def}")
        safe_exec("CREATE INDEX IF NOT EXISTS ix_trabajadores_zkbio ON trabajadores (zkbio_employee_id)")

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
    # Camino B: nuevos campos en anexos_contrato
    if "anexos_contrato" in insp.get_table_names():
        anexo_cols = [c["name"] for c in insp.get_columns("anexos_contrato")]
        for col_name, col_def in [
            ("plantilla_id", "INTEGER"),
            ("plantilla_version", "INTEGER"),
            ("contenido_renderizado", "TEXT"),
            ("aprobado_por", "TEXT"),
            ("aprobado_at", "TIMESTAMP"),
        ]:
            if col_name not in anexo_cols:
                safe_exec(f"ALTER TABLE anexos_contrato ADD COLUMN {col_name} {col_def}")

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

    # configuracion_legal: agregar columnas nuevas si no existen
    if "configuracion_legal" in insp.get_table_names():
        cl_cols = [c["name"] for c in insp.get_columns("configuracion_legal")]
        nuevas_cl = {
            "empresa_giro": "TEXT",
            "rep_legal_ci": "TEXT",
            "rep_legal_cargo": "TEXT",
            "empresa_correo": "TEXT",
            "empresa_telefono": "TEXT",
            "dia_pago_mes": "INTEGER DEFAULT 5",
            "canal_portal_url": "TEXT",
            "plazo_fijo_conductor_meses": "INTEGER DEFAULT 3",
            "empresa_ciudad_comuna": "TEXT",
        }
        for col, tipo in nuevas_cl.items():
            if col not in cl_cols:
                safe_exec(f"ALTER TABLE configuracion_legal ADD COLUMN {col} {tipo}")

    # ── Tabla jornadas_horarias ──────────────────────────────────────────────
    if "jornadas_horarias" not in insp.get_table_names():
        safe_exec("""
            CREATE TABLE jornadas_horarias (
                id SERIAL PRIMARY KEY,
                nombre TEXT NOT NULL,
                hora_entrada VARCHAR(5) NOT NULL DEFAULT '08:00',
                hora_salida VARCHAR(5) NOT NULL DEFAULT '17:00',
                minutos_colacion INTEGER NOT NULL DEFAULT 45,
                activa BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """)

    # ── jornada_horaria_id en trabajadores ──────────────────────────────────
    if "trabajadores" in insp.get_table_names():
        tr_cols = [c["name"] for c in insp.get_columns("trabajadores")]
        if "jornada_horaria_id" not in tr_cols:
            safe_exec("ALTER TABLE trabajadores ADD COLUMN jornada_horaria_id INTEGER REFERENCES jornadas_horarias(id) ON DELETE SET NULL")

    # ── Tabla plantillas_contrato (Camino B: contratos digitales) ────────────
    if "plantillas_contrato" not in insp.get_table_names():
        safe_exec("""
            CREATE TABLE plantillas_contrato (
                id SERIAL PRIMARY KEY,
                slug TEXT NOT NULL,
                nombre TEXT NOT NULL,
                descripcion TEXT,
                tipo_contrato TEXT,
                aplica_a_cargos JSON,
                aplica_a_jornadas JSON,
                contenido TEXT NOT NULL DEFAULT '',
                clausulas_extra JSON,
                version INTEGER NOT NULL DEFAULT 1,
                activa BOOLEAN NOT NULL DEFAULT TRUE,
                creada_por TEXT,
                creada_desde_anexo_id INTEGER REFERENCES anexos_contrato(id),
                notas_version TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """)
        safe_exec("CREATE INDEX IF NOT EXISTS ix_plantilla_slug_version ON plantillas_contrato (slug, version)")

    # ── Tabla notificaciones_trabajador ──────────────────────────────────────
    if "notificaciones_trabajador" not in insp.get_table_names():
        safe_exec("""
            CREATE TABLE notificaciones_trabajador (
                id SERIAL PRIMARY KEY,
                trabajador_id INTEGER NOT NULL REFERENCES trabajadores(id),
                tipo TEXT NOT NULL DEFAULT 'GENERICA',
                titulo TEXT NOT NULL,
                mensaje TEXT NOT NULL,
                url_accion TEXT,
                leida BOOLEAN NOT NULL DEFAULT FALSE,
                leida_at TIMESTAMP,
                enviada_whatsapp BOOLEAN NOT NULL DEFAULT FALSE,
                whatsapp_status TEXT,
                metadata_json JSON,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """)
        safe_exec("CREATE INDEX IF NOT EXISTS ix_notif_trab_leida ON notificaciones_trabajador (trabajador_id, leida)")

    # ── Migración: vacaciones_trabajadores: nuevos campos del flujo formal ───
    if "vacaciones_trabajadores" in insp.get_table_names():
        vac_cols = [c["name"] for c in insp.get_columns("vacaciones_trabajadores")]
        for col_name, col_def in [
            ("dias_corridos", "INTEGER"),
            ("es_retroactiva", "BOOLEAN NOT NULL DEFAULT FALSE"),
            ("dias_derecho_snapshot", "NUMERIC(6,2)"),
            ("dias_progresivo_snapshot", "INTEGER"),
            ("saldo_previo_snapshot", "NUMERIC(6,2)"),
            ("solicitada_at", "TIMESTAMP"),
            ("firma_solicitud", "TEXT"),
            ("firma_solicitud_ip", "TEXT"),
            ("aprobada_at", "TIMESTAMP"),
            ("aprobada_por", "TEXT"),
            ("firma_aprobacion", "TEXT"),
            ("rechazada_at", "TIMESTAMP"),
            ("rechazada_por", "TEXT"),
            ("motivo_rechazo", "TEXT"),
            ("firma_retroactiva", "TEXT"),
            ("firma_retroactiva_at", "TIMESTAMP"),
            ("firma_retroactiva_ip", "TEXT"),
            ("firma_retroactiva_solicitada_at", "TIMESTAMP"),
            ("pdf_comprobante", "TEXT"),
            ("creado_por", "TEXT"),
            ("updated_at", "TIMESTAMP DEFAULT NOW()"),
        ]:
            if col_name not in vac_cols:
                safe_exec(f"ALTER TABLE vacaciones_trabajadores ADD COLUMN {col_name} {col_def}")
        safe_exec("CREATE INDEX IF NOT EXISTS ix_vac_trabajador_estado ON vacaciones_trabajadores (trabajador_id, estado)")
        safe_exec("CREATE INDEX IF NOT EXISTS ix_vac_fecha_inicio ON vacaciones_trabajadores (fecha_inicio)")

    # ── Control horario digital (ZKBioTime) ──────────────────────────────────
    if "configuracion_asistencia" not in insp.get_table_names():
        safe_exec("""
            CREATE TABLE configuracion_asistencia (
                id INTEGER PRIMARY KEY,
                activo BOOLEAN NOT NULL DEFAULT FALSE,
                zkbio_base_url TEXT,
                zkbio_api_token TEXT,
                zkbio_username TEXT,
                zkbio_password TEXT,
                zkbio_token_expira_at TIMESTAMP,
                zkbio_version TEXT,
                tolerancia_atraso_min INTEGER NOT NULL DEFAULT 5,
                tolerancia_salida_anticipada_min INTEGER NOT NULL DEFAULT 5,
                minutos_minimos_he INTEGER NOT NULL DEFAULT 15,
                redondeo_marcas_min INTEGER NOT NULL DEFAULT 1,
                requiere_aprobacion_he BOOLEAN NOT NULL DEFAULT TRUE,
                he_dia_recargo_50_max_diario INTEGER NOT NULL DEFAULT 2,
                consolidar_he_a_liquidacion BOOLEAN NOT NULL DEFAULT TRUE,
                ultima_sync_at TIMESTAMP,
                ultima_sync_hasta TIMESTAMP,
                ultima_sync_marcas_nuevas INTEGER,
                ultima_sync_error TEXT,
                actualizado_por TEXT,
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """)
    # Seed singleton (idempotente)
    safe_exec("""
        INSERT INTO configuracion_asistencia (id, activo)
        VALUES (1, FALSE)
        ON CONFLICT (id) DO NOTHING
    """)

    if "marcas_asistencia" not in insp.get_table_names():
        safe_exec("""
            CREATE TABLE marcas_asistencia (
                id SERIAL PRIMARY KEY,
                trabajador_id INTEGER REFERENCES trabajadores(id),
                zkbio_employee_id TEXT NOT NULL,
                zkbio_employee_codigo TEXT,
                zkbio_transaction_id TEXT NOT NULL,
                dispositivo_sn TEXT,
                dispositivo_alias TEXT,
                terminal_id TEXT,
                timestamp TIMESTAMP NOT NULL,
                fecha DATE NOT NULL,
                tipo TEXT NOT NULL DEFAULT 'DESCONOCIDO',
                punch_state_raw TEXT,
                verify_type TEXT,
                work_code TEXT,
                area TEXT,
                foto_base64 TEXT,
                descartada BOOLEAN NOT NULL DEFAULT FALSE,
                motivo_descarte TEXT,
                sincronizada_at TIMESTAMP DEFAULT NOW(),
                payload_raw JSONB,
                CONSTRAINT uq_marca_zk_tx UNIQUE (zkbio_transaction_id, dispositivo_sn)
            )
        """)
        safe_exec("CREATE INDEX IF NOT EXISTS ix_marca_trab_fecha ON marcas_asistencia (trabajador_id, fecha)")
        safe_exec("CREATE INDEX IF NOT EXISTS ix_marca_timestamp ON marcas_asistencia (timestamp)")
        safe_exec("CREATE INDEX IF NOT EXISTS ix_marca_zkbio_emp ON marcas_asistencia (zkbio_employee_id)")

    if "jornadas_trabajador" not in insp.get_table_names():
        safe_exec("""
            CREATE TABLE jornadas_trabajador (
                id SERIAL PRIMARY KEY,
                trabajador_id INTEGER NOT NULL REFERENCES trabajadores(id),
                fecha DATE NOT NULL,
                primera_entrada TIMESTAMP,
                salida_colacion TIMESTAMP,
                entrada_colacion TIMESTAMP,
                ultima_salida TIMESTAMP,
                cantidad_marcas INTEGER NOT NULL DEFAULT 0,
                minutos_trabajados INTEGER NOT NULL DEFAULT 0,
                minutos_colacion INTEGER NOT NULL DEFAULT 0,
                minutos_atraso INTEGER NOT NULL DEFAULT 0,
                minutos_salida_anticipada INTEGER NOT NULL DEFAULT 0,
                minutos_he_estimadas INTEGER NOT NULL DEFAULT 0,
                hora_entrada_esperada TEXT,
                hora_salida_esperada TEXT,
                jornada_diaria_min_esperada INTEGER NOT NULL DEFAULT 480,
                estado TEXT NOT NULL DEFAULT 'NORMAL',
                observaciones TEXT,
                he_aprobadas_min INTEGER NOT NULL DEFAULT 0,
                he_aprobadas_por TEXT,
                he_aprobadas_at TIMESTAMP,
                he_consolidada_id INTEGER REFERENCES horas_extras_trabajadores(id),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                CONSTRAINT uq_jornada_trab_fecha UNIQUE (trabajador_id, fecha)
            )
        """)
        safe_exec("CREATE INDEX IF NOT EXISTS ix_jornada_fecha ON jornadas_trabajador (fecha)")

    # ── Flota de vehículos, combustible y TAG ────────────────────────────────
    if "vehiculos_empresa" not in insp.get_table_names():
        safe_exec("""
            CREATE TABLE vehiculos_empresa (
                patente     VARCHAR(12) PRIMARY KEY,
                marca       TEXT,
                modelo      TEXT,
                anio        INTEGER,
                tipo        TEXT NOT NULL DEFAULT 'furgon',
                color       TEXT,
                activo      BOOLEAN NOT NULL DEFAULT TRUE,
                notas       TEXT,
                created_at  TIMESTAMP DEFAULT NOW(),
                updated_at  TIMESTAMP DEFAULT NOW()
            )
        """)

    if "uso_vehiculo_excepciones" not in insp.get_table_names():
        safe_exec("""
            CREATE TABLE uso_vehiculo_excepciones (
                id          SERIAL PRIMARY KEY,
                driver_id   INTEGER NOT NULL REFERENCES drivers(id),
                patente     VARCHAR(12) NOT NULL REFERENCES vehiculos_empresa(patente),
                fecha       DATE NOT NULL,
                motivo      TEXT,
                creado_por  TEXT,
                created_at  TIMESTAMP DEFAULT NOW()
            )
        """)
        safe_exec("CREATE INDEX IF NOT EXISTS ix_uso_vehiculo_driver_fecha ON uso_vehiculo_excepciones (driver_id, fecha)")

    if "combustible_registros" not in insp.get_table_names():
        safe_exec("""
            CREATE TABLE combustible_registros (
                id                  SERIAL PRIMARY KEY,
                patente             VARCHAR(12) NOT NULL REFERENCES vehiculos_empresa(patente),
                fecha               DATE NOT NULL,
                semana              INTEGER NOT NULL,
                mes                 INTEGER NOT NULL,
                anio                INTEGER NOT NULL,
                litros              NUMERIC(8,2),
                monto_total         INTEGER NOT NULL,
                proveedor           TEXT,
                driver_id_resuelto  INTEGER REFERENCES drivers(id),
                notas               TEXT,
                creado_por          TEXT,
                created_at          TIMESTAMP DEFAULT NOW()
            )
        """)
        safe_exec("CREATE INDEX IF NOT EXISTS ix_combustible_patente_fecha ON combustible_registros (patente, fecha)")
        safe_exec("CREATE INDEX IF NOT EXISTS ix_combustible_semana ON combustible_registros (semana, mes, anio)")

    if "registros_tag" not in insp.get_table_names():
        safe_exec("""
            CREATE TABLE registros_tag (
                id                      SERIAL PRIMARY KEY,
                patente                 VARCHAR(12) NOT NULL REFERENCES vehiculos_empresa(patente),
                fecha_inicio_periodo    DATE NOT NULL,
                fecha_fin_periodo       DATE NOT NULL,
                monto_total             INTEGER NOT NULL,
                numero_transacciones    INTEGER,
                proveedor               TEXT,
                archivo_origen          TEXT,
                detalle_json            JSON,
                notas                   TEXT,
                creado_por              TEXT,
                created_at              TIMESTAMP DEFAULT NOW()
            )
        """)
        safe_exec("CREATE INDEX IF NOT EXISTS ix_tag_patente_periodo ON registros_tag (patente, fecha_inicio_periodo)")

    # Driver: agregar vehiculo_patente si no existe
    if "drivers" in insp.get_table_names():
        drv_cols = [c["name"] for c in insp.get_columns("drivers")]
        if "vehiculo_patente" not in drv_cols:
            safe_exec("ALTER TABLE drivers ADD COLUMN vehiculo_patente VARCHAR(12)")

    # Retiro: agregar costo_empresa si no existe
    if "retiros" in insp.get_table_names():
        ret_cols = [c["name"] for c in insp.get_columns("retiros")]
        if "costo_empresa" not in ret_cols:
            safe_exec("ALTER TABLE retiros ADD COLUMN costo_empresa INTEGER NOT NULL DEFAULT 0")
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
            # Conductor contratado — CPC
            ("adelantos_cpc", "INTEGER NOT NULL DEFAULT 0"),
            ("adelantos_cpc_detalle", "JSON"),
            ("comisiones_cpc", "INTEGER NOT NULL DEFAULT 0"),
            # Auditoría de modificaciones
            ("modificada_por", "TEXT"),
            ("modificada_at", "TIMESTAMP"),
            ("motivo_modificacion", "TEXT"),
            ("diff_modificacion", "JSON"),
            ("revisada_por_admin", "TEXT"),
            ("revisada_at", "TIMESTAMP"),
            ("resultado_revision", "TEXT"),
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
        if "correo_informativo" not in sel_cols:
            safe_exec("ALTER TABLE sellers ADD COLUMN correo_informativo VARCHAR(120)")

    if "envios" in insp.get_table_names():
        env_cols2 = [c["name"] for c in insp.get_columns("envios")]
        if "fecha_retiro" not in env_cols2:
            safe_exec("ALTER TABLE envios ADD COLUMN fecha_retiro DATE")
            safe_exec("CREATE INDEX IF NOT EXISTS ix_envios_fecha_retiro ON envios (fecha_retiro)")
        if "ruta_id" not in env_cols2:
            safe_exec("ALTER TABLE envios ADD COLUMN ruta_id INTEGER")
            safe_exec("CREATE INDEX IF NOT EXISTS ix_envios_ruta_id ON envios (ruta_id)")
        # Indice funcional para acelerar reconciliacion case-insensitive por tracking_id
        # (rutas_entregas.reconciliar_asignacion hace LOWER(envios.tracking_id) = ...)
        safe_exec("CREATE INDEX IF NOT EXISTS ix_envios_tracking_id_lower ON envios (LOWER(tracking_id))")

    # ── Migración: AsignacionRuta multi-intento (abril 2026) ──────────────────
    # Permite varias filas para el mismo tracking_id (una por withdrawal_date)
    # para soportar Delivery Success Rate y First-Attempt Delivery Rate.
    if "asignacion_ruta" in insp.get_table_names():
        ar_cols = [c["name"] for c in insp.get_columns("asignacion_ruta")]
        if "intento_nro" not in ar_cols:
            safe_exec("ALTER TABLE asignacion_ruta ADD COLUMN intento_nro INTEGER NOT NULL DEFAULT 1")
        # Quitar el unique simple de tracking_id (creado cuando el modelo
        # tenía unique=True). El nombre por defecto en PG es <tabla>_<col>_key.
        safe_exec("ALTER TABLE asignacion_ruta DROP CONSTRAINT IF EXISTS asignacion_ruta_tracking_id_key")
        # En algunas instalaciones el unique se materializa como índice único
        # con nombre ix_*. Lo intentamos por si acaso.
        safe_exec("DROP INDEX IF EXISTS ix_asignacion_ruta_tracking_id")
        # Crear unique compuesto (tracking_id, withdrawal_date) e índice de búsqueda.
        safe_exec(
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_asig_ruta_tracking_withdrawal "
            "ON asignacion_ruta (tracking_id, withdrawal_date)"
        )
        safe_exec("CREATE INDEX IF NOT EXISTS ix_asig_ruta_tracking ON asignacion_ruta (tracking_id)")
        # Backfill: las filas existentes que no fueron tocadas por la nueva
        # lógica deben tener intento_nro=1 (es lo que ya hace el DEFAULT del
        # ALTER, pero lo dejamos explícito por si alguien insertó NULL).
        safe_exec("UPDATE asignacion_ruta SET intento_nro = 1 WHERE intento_nro IS NULL OR intento_nro = 0")

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

    # ── Migración: emails_extra en email_envios (correos sueltos por campaña) ──
    if "email_envios" in insp.get_table_names():
        ee_cols = [c["name"] for c in insp.get_columns("email_envios")]
        if "emails_extra" not in ee_cols:
            safe_exec("ALTER TABLE email_envios ADD COLUMN emails_extra JSONB DEFAULT '[]'::jsonb")

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


# ── Seed plantillas HTML base para Email Campaigns ───────────────────────────
from app.models import EmailPlantilla as _EmailPlantilla

_BASE_HTML = """<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{{margin:0;padding:0;background:#f0f0ec;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a}}
  .wrap{{max-width:600px;margin:24px auto;background:#ffffff;border-radius:4px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.1)}}
  .header{{padding:18px 32px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e5e5e5}}
  .logo{{font-size:17px;font-weight:900;letter-spacing:-.5px;color:#0f2044}}
  .logo span{{display:inline-block;background:#0f2044;color:#f5c842;font-size:12px;font-weight:900;padding:2px 5px;border-radius:3px;margin-right:4px;letter-spacing:0}}
  .brand{{font-size:15px;font-weight:700;color:#0f2044}}
  .hero{{background:#0f2044;padding:28px 32px 24px}}
  .badge{{display:inline-block;background:#1e3a6e;color:#a8c4f0;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:4px 10px;border-radius:20px;margin-bottom:14px}}
  .hero h1{{margin:0 0 10px;font-size:22px;font-weight:800;color:#f5c842;line-height:1.3}}
  .hero p{{margin:0;font-size:14px;color:#c8d8f0;line-height:1.6}}
  .section{{padding:20px 32px;border-bottom:1px solid #e5e5e5}}
  .section-label{{font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#2563eb;margin-bottom:10px}}
  .section p{{margin:0;font-size:13px;color:#444;line-height:1.7}}
  .cta-wrap{{padding:24px 32px;text-align:center}}
  .cta{{display:inline-block;background:#0f2044;color:#ffffff!important;text-decoration:none;font-size:13px;font-weight:700;padding:12px 32px;border-radius:6px;letter-spacing:.3px}}
  .footer{{padding:16px 32px;text-align:center;border-top:1px solid #e5e5e5}}
  .footer p{{margin:0;font-size:11px;color:#888;line-height:1.6}}
  .footer a{{color:#2563eb;text-decoration:none}}
  .footer .brand-foot{{display:flex;justify-content:space-between;margin-top:12px;font-size:11px;color:#bbb}}
</style></head>
<body>
<div class="wrap">
  <div class="header">
    <div class="logo"><span>E</span>COURIER</div>
    <div class="brand">Ecourier</div>
  </div>
  {content}
  <div class="footer">
    <p>Ante cualquier duda escríbenos a <a href="mailto:hablamos@e-courier.cl">hablamos@e-courier.cl</a> — con gusto te ayudamos.</p>
    <div class="brand-foot">
      <span>Ecourier</span>
      <span>Equipo de soporte</span>
    </div>
  </div>
</div>
</body></html>"""

_PLANTILLAS_SEED = [
    {
        "nombre": "Base — Comunicado",
        "asunto": "{{empresa}}: comunicado importante de Ecourier",
        "variables": ["nombre", "empresa"],
        "content": """
  <div class="hero">
    <div class="badge">COMUNICADO</div>
    <h1>Hola {{nombre}} 👋</h1>
    <p>Tenemos una novedad importante para <strong>{{empresa}}</strong> que queremos compartirte.</p>
  </div>
  <div class="section">
    <div class="section-label">Detalle</div>
    <p>[Escribe aquí el cuerpo principal del comunicado. Puedes incluir instrucciones, cambios de proceso o cualquier información relevante para el seller.]</p>
  </div>
  <div class="section">
    <div class="section-label">¿Qué debes hacer?</div>
    <p>[Describe los pasos o acciones que el seller debe tomar, si aplica.]</p>
  </div>
  <div class="cta-wrap">
    <a href="https://facturacion.e-courier.cl" class="cta">Ir a mi cuenta</a>
  </div>""",
        "texto": "Hola {{nombre}}, tenemos un comunicado importante para {{empresa}}. Ingresa a https://facturacion.e-courier.cl para más detalles.",
    },
    {
        "nombre": "Base — Anuncio Comercial",
        "asunto": "{{empresa}}: una novedad que te va a interesar",
        "variables": ["nombre", "empresa"],
        "content": """
  <div class="hero">
    <div class="badge">NOVEDAD</div>
    <h1>Tenemos algo nuevo para {{empresa}} 🎉</h1>
    <p>Hola <strong>{{nombre}}</strong>, queremos contarte sobre una mejora en nuestro servicio.</p>
  </div>
  <div class="section">
    <div class="section-label">¿Qué hay de nuevo?</div>
    <p>[Describe la novedad, mejora o anuncio comercial aquí. Sé específico y menciona el valor para el seller.]</p>
  </div>
  <div class="section">
    <div class="section-label">Beneficios para ti</div>
    <p>✅ [Beneficio 1]<br>✅ [Beneficio 2]<br>✅ [Beneficio 3]</p>
  </div>
  <div class="cta-wrap">
    <a href="https://facturacion.e-courier.cl" class="cta">Conocer más</a>
  </div>""",
        "texto": "Hola {{nombre}}, tenemos una novedad para {{empresa}}. Visita https://facturacion.e-courier.cl para conocer más.",
    },
    {
        "nombre": "Base — Boletín Mensual",
        "asunto": "Resumen del mes para {{empresa}} · Ecourier",
        "variables": ["nombre", "empresa", "mes"],
        "content": """
  <div class="hero">
    <div class="badge">BOLETÍN {{mes}}</div>
    <h1>Tu resumen del mes, {{nombre}}</h1>
    <p>Aquí está lo más importante de <strong>{{empresa}}</strong> en Ecourier durante {{mes}}.</p>
  </div>
  <div class="section">
    <div class="section-label">Resumen operacional</div>
    <p>[Incluye métricas clave del mes: envíos totales, tasa de entrega, retiros, etc.]</p>
  </div>
  <div class="section">
    <div class="section-label">Novedades del mes</div>
    <p>[Incluye cambios de servicio, nuevas funcionalidades, tarifas u otras novedades relevantes para el período.]</p>
  </div>
  <div class="section">
    <div class="section-label">Próximos pasos</div>
    <p>[Agenda, fechas importantes, recordatorios o cualquier acción pendiente.]</p>
  </div>
  <div class="cta-wrap">
    <a href="https://facturacion.e-courier.cl" class="cta">Ver mi liquidación</a>
  </div>""",
        "texto": "Hola {{nombre}}, aquí está el resumen de {{mes}} para {{empresa}}. Ingresa a https://facturacion.e-courier.cl para ver tu liquidación.",
    },
]


def _seed_email_plantillas():
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        for p in _PLANTILLAS_SEED:
            existe = db.query(_EmailPlantilla).filter(_EmailPlantilla.nombre == p["nombre"]).first()
            if not existe:
                html = _BASE_HTML.format(content=p["content"])
                db.add(_EmailPlantilla(
                    nombre=p["nombre"],
                    asunto=p["asunto"],
                    cuerpo_html=html,
                    cuerpo_texto=p.get("texto", ""),
                    variables=p.get("variables", []),
                ))
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


_seed_email_plantillas()


# ── Seed: plantillas de contrato conductor (idempotente) ─────────────────────

_CONTRATO_CONDUCTOR_CONTENIDO = """# CONTRATO INDIVIDUAL DE TRABAJO

En {{empresa.ciudad_comuna}}, a {{fecha.hoy_largo}}, entre **{{empresa.razon_social}}**, RUT **{{empresa.rut}}**, con domicilio en **{{empresa.direccion}}**, representada legalmente por don/doña **{{rep_legal.nombre}}**, RUT **{{rep_legal.rut}}**, cédula de identidad N° **{{rep_legal.ci}}**, en calidad de **{{rep_legal.cargo}}** (en adelante el **«Empleador»**); y don/doña **{{trabajador.nombre}}**, de nacionalidad **{{trabajador.nacionalidad}}**, estado civil **{{trabajador.estado_civil}}**, RUT **{{trabajador.rut}}**, con domicilio en **{{trabajador.direccion}}** (en adelante el **«Trabajador»**), se ha celebrado el siguiente contrato individual de trabajo:

---

## PRIMERO: CARGO Y FUNCIONES

El Trabajador se desempeñará como **CONDUCTOR DE REPARTO Y DISTRIBUCIÓN**. Sus funciones comprenden la conducción de vehículos motorizados de propiedad o a disposición del Empleador, la recepción, custodia y entrega de encomiendas y paquetes en los domicilios y puntos indicados por la aplicación tecnológica dispuesta por el Empleador, el registro fotográfico de entregas en la misma plataforma, la comunicación oportuna de incidencias y el cumplimiento de las normas de tránsito, de los protocolos internos y de las instrucciones que le imparta el jefe directo. La plataforma tecnológica y la aplicación móvil son herramientas de trabajo y trazabilidad operacional, equivalentes a cualquier otro instrumento o vehículo de la empresa; el Empleador conserva plena potestad de dirección y control sobre la prestación de servicios.

---

## SEGUNDO: LUGAR DE TRABAJO

El Trabajador prestará sus servicios en las zonas de reparto asignadas por el Empleador, las que podrán variar según necesidades operacionales. El lugar de inicio y término de la jornada será el centro de distribución del Empleador o el punto que este designe. El uso de las herramientas tecnológicas durante la jornada puede realizarse en cualquier lugar donde exista cobertura de red.

---

## TERCERO: JORNADA DE TRABAJO

La jornada ordinaria es de **{{jornada.horas_semana}} horas semanales**, distribuidas de lunes a sábado. Las partes acuerdan que dicha jornada podrá promediarse en ciclos de hasta cuatro (4) semanas calendario, conforme al artículo 22 bis del Código del Trabajo, de modo que en ningún caso el promedio semanal dentro del ciclo supere las {{jornada.horas_semana}} horas.

El horario habitual será de **{{jornada.hora_entrada}} a {{jornada.hora_salida}} horas**, con **{{jornada.minutos_colacion}} minutos** de descanso de colación en los términos del artículo 34 del Código del Trabajo, tiempo que no será imputable a la jornada. Las rutas dinámicas que excedan el horario regular dentro del ciclo mensual se compensarán con días o fracciones de menor duración, sin generar automáticamente derecho a horas extraordinarias, siempre que el promedio del ciclo no supere el límite legal.

Las horas extraordinarias que deban pagarse se liquidarán con el recargo legal del 50 % sobre el valor de la hora ordinaria, calculado sobre el sueldo base vigente.

---

## CUARTO: REMUNERACIÓN

El Trabajador percibirá mensualmente las siguientes remuneraciones y asignaciones:

| Concepto | Monto mensual | Naturaleza |
|---|---|---|
| Sueldo base | {{contrato.sueldo_base}} | Imponible y tributable |
| Comisión variable | $500 por paquete entregado y confirmado en sistema | Imponible y tributable |
| Gratificación legal | 25 % de lo devengado imponible, con tope de 4,75 IMM anual (Art. 50 CT) | Imponible y tributable |
| Asignación de colación | {{contrato.colacion}} | No imponible, no tributable |
| Asignación de movilización | {{contrato.movilizacion}} | No imponible, no tributable |

El monto de la comisión variable se determinará según los registros del sistema de gestión del Empleador al cierre del período mensual. Dicho registro constituye la fuente oficial y fidedigna del conteo de paquetes entregados.

Las remuneraciones se pagarán dentro de los primeros **{{empresa.dia_pago}} días** de cada mes mediante transferencia bancaria a la cuenta indicada por el Trabajador.

---

## QUINTO: VEHÍCULO

El Empleador asignará al Trabajador el vehículo necesario para el desempeño de sus funciones. El vehículo asignado podrá variar según disponibilidad operacional y necesidades de la empresa, lo que el Trabajador acepta expresamente. La asignación no confiere derecho de dominio ni uso personal fuera de la jornada laboral.

---

## SEXTO: OBLIGACIONES DEL TRABAJADOR

El Trabajador se obliga a: (a) Mantener su licencia de conducir al día y en la clase que corresponda al vehículo asignado; (b) Informar de inmediato cualquier accidente, daño o falla mecánica; (c) Abstenerse de usar el vehículo en actividades ajenas a sus funciones; (d) Respetar íntegramente el Reglamento Interno de Orden, Higiene y Seguridad y los procedimientos operacionales; (e) Usar correctamente el uniforme y los equipos de protección personal que el Empleador facilite; (f) No ceder, transferir ni compartir el acceso a la aplicación tecnológica con terceros.

---

## SÉPTIMO: CANAL OFICIAL DE COMUNICACIONES Y RECLAMOS

Toda comunicación relacionada con la relación laboral, objeciones, reclamos o consultas deberá canalizarse mediante el **portal del trabajador** disponible en **{{empresa.canal_portal_url}}**, sección «Consultas». El Empleador dispondrá de un plazo máximo de **cinco (5) días hábiles** para dar respuesta, salvo que una norma legal exija un plazo distinto, en cuyo caso prevalecerá este último.

---

## OCTAVO: CONFIDENCIALIDAD

El Trabajador se obliga a mantener reserva de toda información comercial, operacional y tecnológica del Empleador de la que tome conocimiento con motivo de sus funciones, incluso con posterioridad al término del contrato.

---

## NOVENO: PREVENCIÓN DE RIESGOS

El Trabajador deberá observar estrictamente las normas de seguridad vial y las instrucciones del Organismo Administrador de la Ley N° 16.744 y del Comité Paritario de Higiene y Seguridad, si los hubiere. Queda absolutamente prohibido conducir bajo la influencia del alcohol u otras sustancias que alteren las capacidades físicas o psíquicas.

---

## DÉCIMO: VIGENCIA

El presente contrato es **a plazo fijo** y comenzará a regir el día **{{trabajador.fecha_ingreso}}**, con vencimiento a los **{{empresa.plazo_fijo_meses}} meses** de su inicio. Si al vencimiento del plazo el Trabajador continuare prestando servicios con conocimiento del Empleador, el contrato se entenderá prorrogado por igual período; transcurrida dicha prórroga sin nuevación expresa, se convertirá en contrato de **duración indefinida** de pleno derecho.

---

## UNDÉCIMO: TÉRMINO DEL CONTRATO

El contrato podrá terminar por cualquiera de las causales establecidas en los artículos 159, 160 y 161 del Código del Trabajo, con las formalidades que la ley establece.

---

## DUODÉCIMO: NORMA SUPLETORIA

En todo lo no previsto en el presente instrumento, se estará a lo dispuesto en el Código del Trabajo y demás normas laborales vigentes.

---

## DÉCIMOTERCERO: EJEMPLARES

El presente contrato se firma en **dos ejemplares** del mismo tenor y fecha, quedando uno en poder de cada parte. El Trabajador declara haber recibido su ejemplar en la fecha de suscripción.

---

**{{empresa.razon_social}}**
RUT {{empresa.rut}}
Representado/a por: {{rep_legal.nombre}}, RUT {{rep_legal.rut}}

___________________________
Firma Empleador

**{{trabajador.nombre}}**
RUT {{trabajador.rut}}

___________________________
Firma Trabajador
"""

_ANEXO_MULTAS_CONTENIDO = """# ANEXO DE CONTRATO — ACEPTACIÓN VOLUNTARIA DE RESPONSABILIDAD POR MULTAS DE TRÁNSITO

En {{empresa.ciudad_comuna}}, a {{fecha.hoy_largo}}, entre **{{empresa.razon_social}}**, RUT **{{empresa.rut}}**, representada por **{{rep_legal.nombre}}**, RUT **{{rep_legal.rut}}** (en adelante el **«Empleador»**), y don/doña **{{trabajador.nombre}}**, RUT **{{trabajador.rut}}** (en adelante el **«Trabajador»**), ambas partes del contrato individual de trabajo suscrito con fecha **{{trabajador.fecha_ingreso}}**, acuerdan el siguiente anexo:

---

## PRIMERO: OBJETO

El presente instrumento regula, de forma **voluntaria y libre**, la responsabilidad del Trabajador respecto de las multas de tránsito que se originen durante el ejercicio de sus funciones como conductor de reparto.

---

## SEGUNDO: ACEPTACIÓN VOLUNTARIA

El Trabajador declara libre y voluntariamente que **acepta ser responsable** del pago de las multas de tránsito que sean cursadas por infracciones cometidas mientras conduce vehículos del Empleador en el ejercicio de sus funciones, cuando dichas infracciones sean atribuibles a su conducta o negligencia.

---

## TERCERO: MODALIDAD DE PAGO

Ante la emisión de una multa de tránsito que cumpla con los requisitos de la cláusula segunda, el Empleador notificará al Trabajador con la copia del comprobante correspondiente. Las partes acuerdan que el monto de la multa podrá, a **opción del Trabajador**:

a) Ser pagado directamente por el Trabajador a la autoridad competente dentro del plazo legal; o  
b) Ser descontado de la remuneración mensual en la liquidación de sueldo del mes siguiente, o en cuotas no superiores a **tres (3) períodos mensuales**, respetando en todo caso el límite del 15 % de la remuneración mensual, conforme al artículo 58 inciso 2° del Código del Trabajo.

---

## CUARTO: PROCEDIMIENTO DE IMPUGNACIÓN

Si el Trabajador estimare que la multa no le es imputable, podrá presentar sus descargos por escrito al área de Recursos Humanos en un plazo de **cinco (5) días hábiles** desde la notificación. El Empleador evaluará los antecedentes y resolverá dentro de los **diez (10) días hábiles** siguientes.

---

## QUINTO: EXCLUSIONES

No serán de responsabilidad del Trabajador las multas originadas por: (a) desperfectos mecánicos del vehículo que el Trabajador hubiere comunicado oportunamente; (b) instrucciones expresas del Empleador que contravengan la normativa de tránsito; o (c) circunstancias de fuerza mayor debidamente acreditadas.

---

## SEXTO: CARÁCTER VOLUNTARIO

El Trabajador declara expresamente que la suscripción del presente anexo es **voluntaria**, que no ha mediado coacción ni presión de ningún tipo, que ha contado con tiempo suficiente para leer y comprender su contenido y que, de estimarlo conveniente, ha podido consultar con un asesor legal o sindical antes de suscribirlo.

---

Firman en conformidad las partes:

**{{empresa.razon_social}}**

___________________________
Firma Empleador

**{{trabajador.nombre}}**  
RUT {{trabajador.rut}}

___________________________
Firma Trabajador
"""


def _seed_plantillas_contrato():
    from app.database import SessionLocal
    from app.models import PlantillaContrato

    db = SessionLocal()
    try:
        plantillas = [
            {
                "slug": "conductor_reparto_plazo_fijo",
                "nombre": "Conductor de Reparto — Plazo Fijo (3 meses)",
                "descripcion": (
                    "Contrato a plazo fijo de 3 meses para conductores de reparto. "
                    "Incluye jornada promediada 4 semanas (Art. 22 bis), comisión $500/paquete, "
                    "asignaciones no imponibles (colación + movilización). "
                    "La hora de entrada se ajusta automáticamente según la zona del trabajador."
                ),
                "tipo_contrato": "PLAZO_FIJO",
                "aplica_a_cargos": ["conductor", "conductor_reparto"],
                "aplica_a_jornadas": [40],
                "contenido": _CONTRATO_CONDUCTOR_CONTENIDO,
            },
            {
                "slug": "anexo_multas_transito",
                "nombre": "Anexo — Responsabilidad Multas de Tránsito (Voluntario)",
                "descripcion": (
                    "Anexo de contrato en que el conductor acepta voluntariamente responsabilidad "
                    "por multas de tránsito imputables a su conducta, con opción de pago directo "
                    "o descuento en nómina (máx. 15 % remuneración, tope 3 cuotas)."
                ),
                "tipo_contrato": "ANEXO",
                "aplica_a_cargos": ["conductor", "conductor_reparto"],
                "aplica_a_jornadas": None,
                "contenido": _ANEXO_MULTAS_CONTENIDO,
            },
        ]

        for p in plantillas:
            existe = db.query(PlantillaContrato).filter(
                PlantillaContrato.slug == p["slug"],
                PlantillaContrato.activa == True,
            ).first()
            if not existe:
                db.add(PlantillaContrato(
                    slug=p["slug"],
                    nombre=p["nombre"],
                    descripcion=p["descripcion"],
                    tipo_contrato=p["tipo_contrato"],
                    aplica_a_cargos=p["aplica_a_cargos"],
                    aplica_a_jornadas=p["aplica_a_jornadas"],
                    contenido=p["contenido"],
                    version=1,
                    activa=True,
                    creada_por="seed_sistema",
                ))
        db.commit()
    except Exception as exc:
        db.rollback()
        print(f"[seed_plantillas_contrato] Error: {exc}")
    finally:
        db.close()


_seed_plantillas_contrato()


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
app.include_router(jornadas_horarias.router, prefix="/api")
app.include_router(horas_extras.router, prefix="/api")
app.include_router(plantillas_contrato.router, prefix="/api")
app.include_router(notificaciones_trabajador.router, prefix="/api")
app.include_router(vacaciones.router, prefix="/api")
app.include_router(asistencia.router, prefix="/api")
app.include_router(email_campaigns.router, prefix="/api")
app.include_router(flota.router, prefix="/api")
app.include_router(rentabilidad.router, prefix="/api")
app.include_router(cron_jobs.router, prefix="/api")
app.include_router(asignaciones_ruta.router, prefix="/api")


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


@app.on_event("startup")
async def _startup_scheduler():
    """Inicia APScheduler, registra handlers y siembra los cron jobs por defecto.

    Cada worker uvicorn corre su propio scheduler. La duplicación se evita
    con advisory locks de Postgres dentro del job (ver services/scheduler.py).
    """
    import logging
    logger = logging.getLogger(__name__)
    try:
        from app.database import SessionLocal
        from app.services.cron_handlers import register_all_handlers, seed_default_cron_jobs
        from app.services.scheduler import start_scheduler

        register_all_handlers()
        db = SessionLocal()
        try:
            seed_default_cron_jobs(db)
        finally:
            db.close()
        start_scheduler()
    except Exception as exc:
        logger.warning("Startup scheduler failed (non-fatal): %s", exc)


@app.on_event("shutdown")
async def _shutdown_scheduler():
    try:
        from app.services.scheduler import shutdown_scheduler
        shutdown_scheduler()
    except Exception:
        pass


@app.get("/")
def root():
    return {"message": "ECourier API v1.0", "docs": "/docs"}
