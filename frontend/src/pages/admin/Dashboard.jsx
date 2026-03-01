import { useState, useEffect, useCallback } from 'react'
import api from '../../api'
import StatsCard from '../../components/StatsCard'
import { Users, Truck, Package, DollarSign, TrendingUp, AlertTriangle, MessageSquare, Activity, ChevronDown, ChevronUp, RefreshCw, Trash2 } from 'lucide-react'

const fmt = (n) => `$${(n || 0).toLocaleString('es-CL')}`
const now = new Date()

const WEEKS = [1, 2, 3, 4, 5]

const INCOME_ROWS = [
  { key: 'ingreso_paquete', label: 'Ingreso Paquete', isMoney: true },
  { key: 'paquetes_totales', label: 'Paquetes Totales', isMoney: false },
  { key: 'ingreso_bulto_extra', label: 'Ingreso Bulto Extra', isMoney: true },
  { key: 'ingreso_peso_extra', label: 'Ingreso Peso Extra', isMoney: true },
  { key: 'ingreso_retiro', label: 'Ingreso Retiro', isMoney: true },
]

const COST_ROWS = [
  { key: 'costo_paquete_driver', label: 'Costo Paquete Driver', isMoney: true },
  { key: 'costo_comuna', label: 'Costo Comuna', isMoney: true },
  { key: 'costo_bulto_extra_driver', label: 'Costo Bulto Extra Driver', isMoney: true },
  { key: 'costo_retiro_driver', label: 'Costo Retiro Driver', isMoney: true },
]

function calcIngresoNeto(row) {
  return (row.ingreso_paquete || 0) + (row.ingreso_bulto_extra || 0) + (row.ingreso_peso_extra || 0) + (row.ingreso_retiro || 0)
}

function calcCostos(row) {
  return (row.costo_paquete_driver || 0) + (row.costo_comuna || 0) + (row.costo_bulto_extra_driver || 0) + (row.costo_retiro_driver || 0)
}

function perfColor(ms) {
  if (ms < 300) return 'text-green-600'
  if (ms < 1000) return 'text-amber-600'
  return 'text-red-600'
}

function perfBadge(ms) {
  if (ms < 300) return 'bg-green-100 text-green-700'
  if (ms < 1000) return 'bg-amber-100 text-amber-700'
  return 'bg-red-100 text-red-700'
}

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [resumen, setResumen] = useState(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState({ semana: null, mes: now.getMonth() + 1, anio: now.getFullYear() })
  const [filterSemana, setFilterSemana] = useState(false)
  const [perfOpen, setPerfOpen] = useState(false)
  const [perfData, setPerfData] = useState(null)
  const [perfLoading, setPerfLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    const params = { mes: period.mes, anio: period.anio }
    if (filterSemana && period.semana) params.semana = period.semana

    Promise.all([
      api.get('/dashboard/stats', { params }),
      api.get('/dashboard/resumen-financiero', { params: { mes: period.mes, anio: period.anio } }),
    ])
      .then(([statsRes, resumenRes]) => {
        setStats(statsRes.data)
        setResumen(resumenRes.data)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [period, filterSemana])

  const loadPerf = useCallback(async () => {
    setPerfLoading(true)
    try {
      const res = await api.get('/diagnostics/performance')
      setPerfData(res.data)
    } catch {
      // sin acceso o sin datos aún
    } finally {
      setPerfLoading(false)
    }
  }, [])

  const resetPerf = async () => {
    await api.delete('/diagnostics/performance')
    setPerfData([])
  }

  useEffect(() => {
    if (perfOpen && !perfData) loadPerf()
  }, [perfOpen, perfData, loadPerf])

  const getVal = (weekNum, key) => {
    if (!resumen?.semanas?.[weekNum]) return 0
    return resumen.semanas[weekNum][key] || 0
  }

  const getSubtotal = (key) => resumen?.subtotal?.[key] || 0

  const cellClass = 'px-3 py-2 text-right text-xs whitespace-nowrap'
  const labelClass = 'px-4 py-2 text-xs font-medium text-gray-700 whitespace-nowrap'
  const headerClass = 'px-3 py-3 text-right text-[11px] font-semibold text-white uppercase tracking-wider'
  const summaryLabelClass = 'px-4 py-2.5 text-xs font-semibold whitespace-nowrap'
  const summaryCellClass = 'px-3 py-2.5 text-right text-xs font-semibold whitespace-nowrap'

  const renderVal = (val, isMoney) => isMoney ? fmt(val) : (val || 0).toLocaleString('es-CL')

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Resumen del período seleccionado</p>
      </div>

      <div className="card mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Mes</label>
              <select
                value={period.mes}
                onChange={(e) => setPeriod((p) => ({ ...p, mes: Number(e.target.value) }))}
                className="input-field w-40"
              >
                {['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'].map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Año</label>
              <select
                value={period.anio}
                onChange={(e) => setPeriod((p) => ({ ...p, anio: Number(e.target.value) }))}
                className="input-field w-28"
              >
                {Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-end gap-3">
            <label className="flex items-center gap-2 pb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filterSemana}
                onChange={(e) => setFilterSemana(e.target.checked)}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-gray-600">Filtrar por semana</span>
            </label>
            {filterSemana && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Semana</label>
                <select
                  value={period.semana || 1}
                  onChange={(e) => setPeriod((p) => ({ ...p, semana: Number(e.target.value) }))}
                  className="input-field w-24"
                >
                  {WEEKS.map((s) => (
                    <option key={s} value={s}>Sem {s}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-gray-400">Cargando...</div>
      ) : !stats ? (
        <div className="text-center py-12 text-gray-500">No se pudieron cargar las estadísticas</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
            <StatsCard icon={Users} label="Sellers con Envíos" value={stats.total_sellers} color="primary" sub="En el período" />
            <StatsCard icon={Truck} label="Drivers con Envíos" value={stats.total_drivers} color="green" sub="En el período" />
            <StatsCard icon={Package} label="Envíos" value={stats.total_envios_mes.toLocaleString()} color="purple" />
            <StatsCard icon={TrendingUp} label="Margen" value={fmt(stats.margen_mes)} color="green" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
            <StatsCard icon={DollarSign} label="Total Cobrado" value={fmt(stats.total_cobrado_mes)} color="primary" sub="Cobros a sellers" />
            <StatsCard icon={DollarSign} label="Total Pagado" value={fmt(stats.total_pagado_mes)} color="amber" sub="Pagos a drivers" />
            <StatsCard
              icon={AlertTriangle}
              label="Sin Homologar"
              value={stats.envios_sin_homologar}
              color={stats.envios_sin_homologar > 0 ? 'red' : 'green'}
              sub="Envíos pendientes de revisión"
            />
            <StatsCard
              icon={MessageSquare}
              label="Consultas Pendientes"
              value={stats.consultas_pendientes}
              color={stats.consultas_pendientes > 0 ? 'amber' : 'green'}
              sub="Del portal de transparencia"
            />
          </div>

          {resumen && (
            <div className="card overflow-hidden p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#1e3a5f]">
                      <th className="px-4 py-3 text-left text-[11px] font-semibold text-white uppercase tracking-wider min-w-[200px]">Item</th>
                      {WEEKS.map((w) => (
                        <th key={w} className={headerClass}>{w}</th>
                      ))}
                      <th className={`${headerClass} border-l border-white/20`}>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {INCOME_ROWS.map((row, idx) => (
                      <tr key={row.key} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className={labelClass}>{row.label}</td>
                        {WEEKS.map((w) => (
                          <td key={w} className={cellClass}>{renderVal(getVal(w, row.key), row.isMoney)}</td>
                        ))}
                        <td className={`${cellClass} font-semibold border-l border-gray-200`}>{renderVal(getSubtotal(row.key), row.isMoney)}</td>
                      </tr>
                    ))}

                    {COST_ROWS.map((row, idx) => (
                      <tr key={row.key} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className={labelClass}>{row.label}</td>
                        {WEEKS.map((w) => (
                          <td key={w} className={cellClass}>{renderVal(getVal(w, row.key), row.isMoney)}</td>
                        ))}
                        <td className={`${cellClass} font-semibold border-l border-gray-200`}>{renderVal(getSubtotal(row.key), row.isMoney)}</td>
                      </tr>
                    ))}

                    <tr className="border-t-2 border-[#1e3a5f]">
                      <td colSpan={WEEKS.length + 2} className="h-1 bg-[#1e3a5f]" />
                    </tr>

                    <tr className="bg-blue-50">
                      <td className={summaryLabelClass + ' text-blue-900'}>Ingreso Neto</td>
                      {WEEKS.map((w) => {
                        const row = resumen.semanas?.[w] || {}
                        return <td key={w} className={summaryCellClass + ' text-blue-900'}>{fmt(calcIngresoNeto(row))}</td>
                      })}
                      <td className={`${summaryCellClass} text-blue-900 border-l border-blue-200`}>{fmt(calcIngresoNeto(resumen.subtotal))}</td>
                    </tr>

                    <tr className="bg-red-50">
                      <td className={summaryLabelClass + ' text-red-900'}>Costos</td>
                      {WEEKS.map((w) => {
                        const row = resumen.semanas?.[w] || {}
                        return <td key={w} className={summaryCellClass + ' text-red-900'}>{fmt(calcCostos(row))}</td>
                      })}
                      <td className={`${summaryCellClass} text-red-900 border-l border-red-200`}>{fmt(calcCostos(resumen.subtotal))}</td>
                    </tr>

                    <tr className="bg-emerald-50 border-t border-emerald-200">
                      <td className={summaryLabelClass + ' text-emerald-900'}>Ingreso Neto</td>
                      {WEEKS.map((w) => {
                        const row = resumen.semanas?.[w] || {}
                        const margen = calcIngresoNeto(row) - calcCostos(row)
                        return <td key={w} className={summaryCellClass + ' text-emerald-900'}>{fmt(margen)}</td>
                      })}
                      <td className={`${summaryCellClass} text-emerald-900 border-l border-emerald-200`}>
                        {fmt(calcIngresoNeto(resumen.subtotal) - calcCostos(resumen.subtotal))}
                      </td>
                    </tr>

                    <tr className="bg-gray-100 border-t border-gray-300">
                      <td className={summaryLabelClass + ' text-gray-800'}>Ingreso por Envío</td>
                      {WEEKS.map((w) => {
                        const row = resumen.semanas?.[w] || {}
                        const margen = calcIngresoNeto(row) - calcCostos(row)
                        const paq = row.paquetes_totales || 0
                        return <td key={w} className={summaryCellClass + ' text-gray-800'}>{paq > 0 ? fmt(Math.round(margen / paq)) : '—'}</td>
                      })}
                      {(() => {
                        const margen = calcIngresoNeto(resumen.subtotal) - calcCostos(resumen.subtotal)
                        const paq = resumen.subtotal.paquetes_totales || 0
                        return (
                          <td className={`${summaryCellClass} text-gray-800 border-l border-gray-300`}>
                            {paq > 0 ? fmt(Math.round(margen / paq)) : '—'}
                          </td>
                        )
                      })()}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {/* ── Panel de rendimiento API ── */}
          <div className="mt-6 border border-gray-200 rounded-xl overflow-hidden">
            <button
              onClick={() => setPerfOpen(o => !o)}
              className="w-full flex items-center justify-between px-5 py-3.5 bg-gray-50 hover:bg-gray-100 transition-colors text-sm font-medium text-gray-700"
            >
              <span className="flex items-center gap-2">
                <Activity size={16} className="text-primary-500" />
                Rendimiento de la API
                <span className="text-xs text-gray-400 font-normal">(últimas 500 llamadas por endpoint)</span>
              </span>
              {perfOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {perfOpen && (
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-gray-500">
                    Verde &lt;300ms · Amarillo &lt;1s · Rojo ≥1s — Los datos se acumulan desde el último reinicio del servidor.
                  </p>
                  <div className="flex gap-2">
                    <button onClick={loadPerf} disabled={perfLoading} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 text-gray-600">
                      <RefreshCw size={12} className={perfLoading ? 'animate-spin' : ''} />
                      Actualizar
                    </button>
                    <button onClick={resetPerf} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-white border border-red-200 hover:bg-red-50 text-red-600">
                      <Trash2 size={12} />
                      Resetear
                    </button>
                  </div>
                </div>

                {perfLoading ? (
                  <div className="text-center py-8 text-gray-400 text-sm">Cargando estadísticas...</div>
                ) : !perfData || perfData.length === 0 ? (
                  <div className="text-center py-8 text-gray-400 text-sm">
                    Sin datos aún. Las estadísticas se acumulan con el uso del sistema.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-gray-500 border-b border-gray-100">
                          <th className="pb-2 font-medium pr-4">Endpoint</th>
                          <th className="pb-2 font-medium text-right pr-3">Llamadas</th>
                          <th className="pb-2 font-medium text-right pr-3">Promedio</th>
                          <th className="pb-2 font-medium text-right pr-3">P95</th>
                          <th className="pb-2 font-medium text-right pr-3">Máximo</th>
                          <th className="pb-2 font-medium text-right">Errores</th>
                        </tr>
                      </thead>
                      <tbody>
                        {perfData.map((row) => (
                          <tr key={row.endpoint} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="py-2 pr-4 font-mono text-gray-700 max-w-xs truncate" title={row.endpoint}>
                              {row.endpoint}
                            </td>
                            <td className="py-2 pr-3 text-right text-gray-600">{row.llamadas_totales.toLocaleString()}</td>
                            <td className={`py-2 pr-3 text-right font-semibold ${perfColor(row.avg_ms)}`}>
                              <span className={`px-2 py-0.5 rounded-full text-[11px] ${perfBadge(row.avg_ms)}`}>
                                {row.avg_ms < 1000 ? `${row.avg_ms}ms` : `${(row.avg_ms / 1000).toFixed(1)}s`}
                              </span>
                            </td>
                            <td className={`py-2 pr-3 text-right ${perfColor(row.p95_ms)}`}>
                              {row.p95_ms < 1000 ? `${row.p95_ms}ms` : `${(row.p95_ms / 1000).toFixed(1)}s`}
                            </td>
                            <td className={`py-2 pr-3 text-right ${perfColor(row.max_ms)}`}>
                              {row.max_ms < 1000 ? `${row.max_ms}ms` : `${(row.max_ms / 1000).toFixed(1)}s`}
                            </td>
                            <td className="py-2 text-right">
                              {row.errores > 0
                                ? <span className="text-red-600 font-semibold">{row.errores} ({row.error_pct}%)</span>
                                : <span className="text-gray-300">—</span>
                              }
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
