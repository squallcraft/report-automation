-- ══════════════════════════════════════════════════════════════
-- MIGRACIÓN: Agregar campos de dirección fiscal y comuna al perfil de sellers
-- Usados como DirRecep y CmnaRecep en la emisión de facturas electrónicas (Haulmer)
--
-- Límites de caracteres según estándar SII / OpenFactura:
--   dir_fiscal  → DirRecep  — máx 70 caracteres
--   cmna_fiscal → CmnaRecep — máx 20 caracteres
--   email       → CorreoRecep — ya existe, máx 80 caracteres
--
-- EJECUTAR ANTES DE DESPLEGAR la versión que incluye estos cambios.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE sellers
    ADD COLUMN IF NOT EXISTS dir_fiscal  VARCHAR(70),
    ADD COLUMN IF NOT EXISTS cmna_fiscal VARCHAR(20);
