-- ══════════════════════════════════════════════════════════════
-- MIGRACIÓN: Agregar correo_dte al perfil de sellers
-- Campo separado del email de acceso al portal.
-- Usado como CorreoRecep en la emisión de facturas electrónicas (Haulmer).
--
-- Límite: máx 80 caracteres (estándar SII / OpenFactura)
--
-- EJECUTAR ANTES DE DESPLEGAR la versión que incluye este cambio.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE sellers
    ADD COLUMN IF NOT EXISTS correo_dte VARCHAR(80);
