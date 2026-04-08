-- Migración: Módulo A — Columna Vertebral
-- Ejecutar en producción: psql -U ecourier -d ecourier -c "$(cat migration_modulo_a.sql)"

-- Tabla: bandeja de tareas pendientes
CREATE TABLE IF NOT EXISTS tareas_pendientes (
    id SERIAL PRIMARY KEY,
    tipo VARCHAR(50) NOT NULL,
    severidad VARCHAR(20) DEFAULT 'alerta',
    seller_id INTEGER REFERENCES sellers(id),
    titulo VARCHAR(200) NOT NULL,
    descripcion TEXT,
    estado VARCHAR(20) DEFAULT 'pendiente',
    resuelta_por VARCHAR(100),
    fecha_creacion TIMESTAMP DEFAULT NOW(),
    fecha_resolucion TIMESTAMP,
    datos JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_tareas_estado ON tareas_pendientes(estado);
CREATE INDEX IF NOT EXISTS idx_tareas_seller ON tareas_pendientes(seller_id);
CREATE INDEX IF NOT EXISTS idx_tareas_severidad ON tareas_pendientes(severidad);

-- Tabla: snapshots diarios de seller
CREATE TABLE IF NOT EXISTS seller_snapshots (
    id SERIAL PRIMARY KEY,
    seller_id INTEGER NOT NULL REFERENCES sellers(id),
    fecha DATE NOT NULL,
    estado_efectivo VARCHAR(50),
    estado_operativo VARCHAR(50),
    estado_crm VARCHAR(50),
    tipo_cierre VARCHAR(20),
    tier VARCHAR(20),
    vol_mes INTEGER DEFAULT 0,
    ingreso_mes INTEGER DEFAULT 0,
    semanas_sin_actividad INTEGER DEFAULT 0,
    datos JSONB DEFAULT '{}',
    UNIQUE(seller_id, fecha)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_seller_fecha ON seller_snapshots(seller_id, fecha);
CREATE INDEX IF NOT EXISTS idx_snapshots_fecha ON seller_snapshots(fecha);

-- Campo estacional (si no existe ya)
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS estacional BOOLEAN DEFAULT FALSE;
-- Campo telefono_whatsapp (si no existe ya)
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS telefono_whatsapp VARCHAR(20);
