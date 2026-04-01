-- Migración: Deduplicación por fingerprint en tablas de pagos cartola
-- Fecha: 2026-03-30
-- Descripción: Agrega columna fingerprint (MD5) a las 3 tablas de pagos cartola
--              y un índice único parcial para prevenir duplicados a nivel de BD.
--              También agrega duplicados_omitidos a cartola_cargas para auditoría.

-- 1. Columnas fingerprint
ALTER TABLE pagos_cartola_drivers  ADD COLUMN IF NOT EXISTS fingerprint VARCHAR(32);
ALTER TABLE pagos_cartola_sellers  ADD COLUMN IF NOT EXISTS fingerprint VARCHAR(32);
ALTER TABLE pagos_cartola_pickups  ADD COLUMN IF NOT EXISTS fingerprint VARCHAR(32);

-- 2. Columna de auditoría en carga
ALTER TABLE cartola_cargas ADD COLUMN IF NOT EXISTS duplicados_omitidos INTEGER DEFAULT 0;

-- 3. Índices únicos parciales (solo aplican a filas con fingerprint, seguro para data existente)
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_fingerprint_drivers
    ON pagos_cartola_drivers (fingerprint)
    WHERE fingerprint IS NOT NULL;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_fingerprint_sellers
    ON pagos_cartola_sellers (fingerprint)
    WHERE fingerprint IS NOT NULL;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_fingerprint_pickups
    ON pagos_cartola_pickups (fingerprint)
    WHERE fingerprint IS NOT NULL;
