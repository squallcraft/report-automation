-- ══════════════════════════════════════════════════════════════
-- FIX: Revertir is_facturado=true en semana 3+ de Marzo 2026
-- Causa: bug en Fase 4 de generar_facturas — marcaba todo el mes
--        en lugar de solo las semanas incluidas en la factura.
-- 
-- La factura de semana 2 incluye semanas 1 y 2 (o solo semana 2).
-- Los envíos de semana 3 (y posteriores) NO deben estar facturados.
--
-- ANTES DE EJECUTAR: verificar qué semanas fueron incluidas en las facturas.
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- 1. Ver cuántos envíos serán corregidos (semana 3 y 4 de Marzo 2026)
SELECT semana, COUNT(*) AS envios, SUM(cobro_seller) AS cobro_total
FROM envios
WHERE mes = 3 AND anio = 2026 
  AND semana >= 3           -- semanas posteriores a la facturada
  AND is_facturado = true
  AND origen = 'ingesta'
GROUP BY semana
ORDER BY semana;

-- 2. Revertir is_facturado a false en semana 3 y 4 de Marzo 2026
UPDATE envios
SET 
    is_facturado = false,
    estado_financiero = CASE 
        WHEN is_liquidado = true AND is_pagado_driver = true THEN 'cerrado'
        WHEN is_liquidado = true THEN 'liquidado'
        ELSE 'pendiente'
    END
WHERE mes = 3 AND anio = 2026
  AND semana >= 3
  AND is_facturado = true
  AND origen = 'ingesta';

-- 3. Verificar resultado
SELECT semana, is_facturado, COUNT(*) AS envios
FROM envios
WHERE mes = 3 AND anio = 2026 AND origen = 'ingesta'
GROUP BY semana, is_facturado
ORDER BY semana, is_facturado;

COMMIT;
