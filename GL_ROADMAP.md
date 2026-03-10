# ECourier — GL / Contabilidad de Partida Doble

## Estado general

| Fase | Descripción | Estado | Progreso |
|------|-------------|--------|----------|
| **Fase 1** | Fundación contable | **COMPLETADA** | 9/9 |
| Fase 2 | Reportes contables + conciliación | Pendiente | 0/5 |
| Fase 3 | Compliance + automatización | Pendiente | 0/5 |

---

## Fase 1: Fundación Contable (~2.5 semanas)

| # | Tarea | Estado | Notas |
|---|-------|--------|-------|
| 1.1 | Modelos: `CuentaContable`, `AsientoContable`, `LineaAsiento` | ✅ Hecho | UNIQUE(ref_tipo, ref_id), índices en tabla |
| 1.2 | Migración inline en `main.py` + índices compuestos | ✅ Hecho | Auto-create tables vía SQLAlchemy |
| 1.3 | Seed plan de cuentas (Activo/Pasivo/Patrimonio/Ingreso/Gasto) | ✅ Hecho | 23 cuentas: 1.x Activos, 2.x Pasivos, 3.x Patrimonio, 4.x Ingresos, 5.x Gastos |
| 1.4 | `FinanzasContableService` (crear_asiento genérico) | ✅ Hecho | `services/contabilidad.py`, valida debe==haber, idempotente |
| 1.5 | Hooks automáticos: CPC PAGADO, Cartola seller/driver/pickup, Mov manual | ✅ Hecho | cpc.py, facturacion.py, cpp.py, finanzas.py |
| 1.6 | Backfill idempotente de asientos históricos | ✅ Hecho | POST `/finanzas/contabilidad/backfill` + verificación |
| 1.7 | Endpoints GL: libro diario, saldos por cuenta, balance comprobación | ✅ Hecho | `/contabilidad/libro-diario`, `/balance-comprobacion`, `/saldos`, `/plan-cuentas` |
| 1.8 | Audit CRUD movimientos + límite upload 10MB + lista vencidos | ✅ Hecho | audit en crear/actualizar/eliminar, 10MB limit, GET `/movimientos/vencidos` |
| 1.9 | Frontend: Tab "Contabilidad" en Finanzas.jsx | ✅ Hecho | Tabs: Balance Comprobación + Libro Diario, botón Backfill |

---

## Fase 2: Reportes Contables + Conciliación (~2.5 semanas)

| # | Tarea | Estado | Notas |
|---|-------|--------|-------|
| 2.1 | Balance General (Activos - Pasivos = Patrimonio) | ⬜ Pendiente | Lectura de asientos por tipo de cuenta |
| 2.2 | Estado de Resultados / P&L (Ingresos - Gastos = Utilidad) | ⬜ Pendiente | Por mes, trimestre, año |
| 2.3 | Conciliación bancaria (CSV → MovimientoBancario → match) | ⬜ Pendiente | Match auto 95% + fallback manual |
| 2.4 | Cuentas por cobrar / pagar (AR/AP) | ⬜ Pendiente | Liquidado vs cobrado por seller/driver |
| 2.5 | Export CSV/PDF de reportes | ⬜ Pendiente | |

---

## Fase 3: Compliance + Automatización (~2.5 semanas)

| # | Tarea | Estado | Notas |
|---|-------|--------|-------|
| 3.1 | IVA: tracking crédito/débito fiscal | ⬜ Pendiente | Para cálculo F29 |
| 3.2 | Nómina: registro estructurado (bruto/descuentos/neto) | ⬜ Pendiente | Sin fórmulas auto — solo registro |
| 3.3 | PeriodoContable + cierre con bloqueo (guard 403) | ⬜ Pendiente | snapshot_saldos JSON en PeriodoContable |
| 3.4 | Alertas: vencimientos próximos, sellers morosos | ⬜ Pendiente | Badge en dashboard |
| 3.5 | Soft-lock: deleted_at en vez de DELETE físico | ⬜ Pendiente | |

---

## Mejoras implementadas post-Fase 1

| Mejora | Estado | Notas |
|--------|--------|-------|
| `fecha_pago` en PagoSemanaSeller/Driver | ✅ | Distingue devengado vs caja |
| Flujo de caja basado en fecha real de pago | ✅ | Filtra por rango de fechas, no período |
| UI: campo fecha al marcar PAGADO + editar en existentes | ✅ | CPC y CPS |
| PATCH endpoints para editar fecha_pago | ✅ | `/cpc/pago-semana/{id}/fecha-pago`, `/facturacion/pago-semana-seller/{id}/fecha-pago` |
| Plan de cuentas ampliado | ✅ | 2 bancos, 2 TC, 2 líneas crédito, inversiones, ingresos financieros |

### Plan de cuentas actual

```
1.0 Activos
  1.1   Banco (General)
  1.1.1 Banco de Chile CTA CTE
  1.1.2 Santander CTA CTE
  1.2   Cuentas por Cobrar Sellers
  1.3   IVA Crédito Fiscal
  1.4   Inversiones Financieras
  1.4.1 Fondos Mutuos
  1.4.2 Depósitos a Plazo
2.0 Pasivos
  2.1 Cuentas por Pagar Drivers
  2.2 Cuentas por Pagar Pickups
  2.3 Cuentas por Pagar Proveedores
  2.4 IVA Débito Fiscal
  2.5 Remuneraciones por Pagar
  2.6 Tarjeta Crédito Banco de Chile
  2.7 Tarjeta Crédito Santander
  2.8 Línea Crédito Banco de Chile
  2.9 Línea Crédito Santander
3.0 Patrimonio
  3.1 Capital
  3.2 Resultados Acumulados
4.0 Ingresos
  4.1 Ingreso Operacional Sellers
  4.2 Ingreso Software
  4.3 Otros Ingresos
  4.4 Ingresos Financieros
5.0 Gastos
  5.1 Costo Drivers
  5.2 Costo Pickups
  5.3 Remuneraciones
  5.4 Arriendo y Servicios
  5.5 Tecnología
  5.6 Freelancers
  5.7 Marketing
  5.8 Impuestos
  5.9 Otros Gastos
  5.10 Intereses y Comisiones
```

---

## Principios arquitectónicos

- **No duplicar datos**: el dashboard operacional lee de PagoSemanaSeller/Driver. Los asientos son la capa contable subyacente.
- **Backfill idempotente**: UNIQUE(ref_tipo, ref_id) previene duplicados. Filtrar monto NULL.
- **Índices desde día 1**: (ref_tipo, ref_id), (fecha, cuenta_id), (asiento_id).
- **Verificación contable**: SUM(debe) == SUM(haber) siempre. Post-backfill y en cada asiento nuevo.
