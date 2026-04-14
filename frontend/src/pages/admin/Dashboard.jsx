import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api'
import StatsCard from '../../components/StatsCard'
import { Users, Truck, Package, DollarSign, TrendingUp, TrendingDown, AlertTriangle, MessageSquare, Wallet, XCircle, PauseCircle, X, LayoutDashboard } from 'lucide-react'
import PageHeader from '../../components/PageHeader'

const fmt = (n) => `$${(n || 0).toLocaleString('es-CL')}`
const now = new Date()

const WEEKS = [1, 2, 3, 4, 5]
const MESES_CORTO = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const MESES_12 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

const INCOME_ROWS = [
  { key: 'ingreso_paquete', label: 'Ingreso Paquete', isMoney: true },
  { key: 'paquetes_totales', label: 'Paquetes Totales', isMoney: false },
  { key: 'ingreso_bulto_extra', label: 'Ingreso Bulto Extra', isMoney: true },
  { key: 'ingreso_peso_extra', label: 'Ingreso Peso Extra', isMoney: true },
  { key: 'ingreso_extra_manual', label: 'Ingreso Extra Manual', isMoney: true },
  { key: 'ingreso_retiro', label: 'Ingreso Retiro', isMoney: true },
]

const COST_ROWS = [
  { key: 'costo_paquete_driver', label: 'Costo Paquete Driver', isMoney: true },
  { key: 'costo_comuna', label: 'Costo Comuna', isMoney: true },
  { key: 'costo_bulto_extra_driver', label: 'Costo Bulto Extra Driver', isMoney: true },
  { key: 'costo_extra_manual_driver', label: 'Costo Extra Manual Driver', isMoney: true },
  { key: 'costo_retiro_driver', label: 'Costo Retiro Driver', isMoney: true },
  { key: 'costo_comision_pickup', label: 'Costo Comisión Pickup', isMoney: true },
]

function calcIngresoNeto(row) {
  return (row.ingreso_paquete || 0) + (row.ingreso_bulto_extra || 0) + (row.ingreso_peso_extra || 0)
    + (row.ingreso_extra_manual || 0) + (row.ingreso_retiro || 0)
}

function calcCostos(row) {
  return (row.costo_paquete_driver || 0) + (row.costo_comuna || 0) + (row.costo_bulto_extra_driver || 0)
    + (row.costo_extra_manual_driver || 0) + (row.costo_retiro_driver || 0) + (row.costo_comision_pickup || 0)
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [resumen, setResumen] = useState(null)
  const [resumenAnual, setResumenAnual] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingAnual, setLoadingAnual] = useState(true)
  const [period, setPeriod] = useState({ semana: null, mes: now.getMonth() + 1, anio: now.getFullYear() })
  const [filterSemana, setFilterSemana] = useState(false)
  const [noActivos, setNoActivos] = useState({ pausados: [], cerrados: [] })
  const [alertasOcultas, setAlertasOcultas] = useState(() => {
    try { return JSON.parse(localStorage.getItem('dashboard_alertas_ocultas') || '[]') } catch { return [] }
  })

  const ocultarAlerta = (id) => {
    const nuevas = [...alertasOcultas, id]
    setAlertasOcultas(nuevas)
    localStorage.setItem('dashboard_alertas_ocultas', JSON.stringify(nuevas))
  }

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

  useEffect(() => {
    setLoadingAnual(true)
    api.get('/dashboard/resumen-anual', { params: { anio: period.anio } })
      .then(({ data }) => setResumenAnual(data))
      .catch(() => setResumenAnual(null))
      .finally(() => setLoadingAnual(false))
  }, [period.anio])

  useEffect(() => {
    api.get('/sellers/no-activos').then(({ data }) => setNoActivos(data)).catch(() => {})
  }, [])

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
      <PageHeader
        title="Dashboard"
        subtitle="Resumen del período seleccionado"
        icon={LayoutDashboard}
        accent="blue"
      />

      {/* ── Alertas de cierre: Épico / Clave ──────────────────────────────── */}
      {(noActivos.cerrados.length > 0 || noActivos.pausados.length > 0) && (() => {
        const recientes = noActivos.cerrados.filter(s => {
          if (!s.fecha_cierre) return false
          const dias = (Date.now() - new Date(s.fecha_cierre).getTime()) / (1000 * 60 * 60 * 24)
          return dias <= 30 && !alertasOcultas.includes(`c_${s.id}`)
        })
        const pausados = noActivos.pausados.filter(s => {
          if (!s.fecha_cierre) return false
          const dias = (Date.now() - new Date(s.fecha_cierre).getTime()) / (1000 * 60 * 60 * 24)
          return dias <= 7 && !alertasOcultas.includes(`p_${s.id}`)
        })
        if (recientes.length === 0 && pausados.length === 0) return null
        return (
          <div className="mb-6 flex flex-col gap-2">
            {recientes.map(s => (
              <div key={s.id}
                className="flex items-center gap-3 px-4 py-3 rounded-xl border border-red-200 bg-red-50">
                <XCircle size={16} className="text-red-500 shrink-0" />
                <div
                  className="flex-1 min-w-0 cursor-pointer hover:underline"
                  onClick={() => navigate(`/admin/sellers/${s.id}/perfil?mes=${now.getMonth() + 1}&anio=${now.getFullYear()}`)}>
                  <span className="text-sm font-semibold text-red-800">{s.nombre}</span>
                  <span className="text-sm text-red-600 ml-2">fue cerrado{s.fecha_cierre ? ` el ${s.fecha_cierre}` : ''}</span>
                  {s.potencial_recuperacion && s.potencial_recuperacion !== 'ninguno' && (
                    <span className="ml-2 text-xs font-medium text-red-500">· Potencial de recuperación: {s.potencial_recuperacion}</span>
                  )}
                </div>
                <button
                  onClick={() => ocultarAlerta(`c_${s.id}`)}
                  title="Descartar alerta"
                  className="p-1 rounded hover:bg-red-100 text-red-300 hover:text-red-500 transition-colors shrink-0"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            {pausados.map(s => (
              <div key={s.id}
                className="flex items-center gap-3 px-4 py-3 rounded-xl border border-orange-200 bg-orange-50">
                <PauseCircle size={16} className="text-orange-500 shrink-0" />
                <div
                  className="flex-1 min-w-0 cursor-pointer hover:underline"
                  onClick={() => navigate(`/admin/sellers/${s.id}/perfil?mes=${now.getMonth() + 1}&anio=${now.getFullYear()}`)}>
                  <span className="text-sm font-semibold text-orange-800">{s.nombre}</span>
                  <span className="text-sm text-orange-600 ml-2">fue puesto en pausa{s.fecha_cierre ? ` el ${s.fecha_cierre}` : ''}</span>
                  {s.fecha_pausa_fin && (
                    <span className="ml-2 text-xs text-orange-500">· Retorno estimado: {s.fecha_pausa_fin}</span>
                  )}
                </div>
                <button
                  onClick={() => ocultarAlerta(`p_${s.id}`)}
                  title="Descartar alerta"
                  className="p-1 rounded hover:bg-orange-100 text-orange-300 hover:text-orange-500 transition-colors shrink-0"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )
      })()}

      <div className="card mb-4 sm:mb-6">
        <div className="flex flex-wrap items-end gap-3 sm:gap-4">
          <div className="flex items-end gap-2 sm:gap-3">
            <div>
              <label className="block text-[10px] sm:text-xs font-medium text-gray-500 mb-1">Mes</label>
              <select
                value={period.mes}
                onChange={(e) => setPeriod((p) => ({ ...p, mes: Number(e.target.value) }))}
                className="input-field w-28 sm:w-40 text-sm"
              >
                {['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'].map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] sm:text-xs font-medium text-gray-500 mb-1">Año</label>
              <select
                value={period.anio}
                onChange={(e) => setPeriod((p) => ({ ...p, anio: Number(e.target.value) }))}
                className="input-field w-20 sm:w-28 text-sm"
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
            <StatsCard icon={TrendingUp} label="Margen Bruto" value={fmt(stats.margen_mes)} color="green" sub="Ingresos - Costos directos" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
            <StatsCard icon={DollarSign} label="Total Ingresado" value={fmt(stats.total_cobrado_mes)} color="primary" sub="Pagos Sellers" />
            <StatsCard icon={DollarSign} label="Total Pagado" value={fmt(stats.total_pagado_mes)} color="amber" sub="Pagos a drivers" />
            <StatsCard icon={Wallet} label="Gastos Operacionales" value={fmt(stats.total_gastos_operacionales)} color="red" sub="Sueldos, servidores, etc." />
            <StatsCard
              icon={TrendingDown}
              label="Margen Neto"
              value={fmt(stats.margen_neto)}
              color={stats.margen_neto >= 0 ? 'green' : 'red'}
              sub="Margen bruto - gastos op."
            />
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
          {/* ── Resumen Anual ── */}
          {loadingAnual ? (
            <div className="mt-6 text-center py-8 text-gray-400 text-sm">Cargando resumen anual...</div>
          ) : resumenAnual && (
            <div className="card overflow-hidden p-0 mt-6">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                <h2 className="text-sm font-semibold text-gray-700">Resumen Anual — {period.anio}</h2>
                <p className="text-[10px] text-gray-400 mt-0.5">Desglose mensual de ingresos y costos</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ minWidth: '1100px' }}>
                  <thead>
                    <tr className="bg-[#1e3a5f]">
                      <th className="px-4 py-3 text-left text-[11px] font-semibold text-white uppercase tracking-wider min-w-[180px] sticky left-0 bg-[#1e3a5f] z-10">Item</th>
                      {MESES_12.map(m => (
                        <th key={m} className={headerClass}>{MESES_CORTO[m]}</th>
                      ))}
                      <th className={`${headerClass} border-l border-white/20`}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {INCOME_ROWS.map((row, idx) => (
                      <tr key={row.key} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className={`${labelClass} sticky left-0 z-10 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>{row.label}</td>
                        {MESES_12.map(m => (
                          <td key={m} className={cellClass}>{renderVal(resumenAnual.meses?.[m]?.[row.key] || 0, row.isMoney)}</td>
                        ))}
                        <td className={`${cellClass} font-semibold border-l border-gray-200`}>{renderVal(resumenAnual.total?.[row.key] || 0, row.isMoney)}</td>
                      </tr>
                    ))}

                    {COST_ROWS.map((row, idx) => (
                      <tr key={row.key} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className={`${labelClass} sticky left-0 z-10 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>{row.label}</td>
                        {MESES_12.map(m => (
                          <td key={m} className={cellClass}>{renderVal(resumenAnual.meses?.[m]?.[row.key] || 0, row.isMoney)}</td>
                        ))}
                        <td className={`${cellClass} font-semibold border-l border-gray-200`}>{renderVal(resumenAnual.total?.[row.key] || 0, row.isMoney)}</td>
                      </tr>
                    ))}

                    <tr className="border-t-2 border-[#1e3a5f]">
                      <td colSpan={MESES_12.length + 2} className="h-1 bg-[#1e3a5f]" />
                    </tr>

                    <tr className="bg-blue-50">
                      <td className={`${summaryLabelClass} text-blue-900 sticky left-0 z-10 bg-blue-50`}>Ingreso Neto</td>
                      {MESES_12.map(m => {
                        const row = resumenAnual.meses?.[m] || {}
                        return <td key={m} className={`${summaryCellClass} text-blue-900`}>{fmt(calcIngresoNeto(row))}</td>
                      })}
                      <td className={`${summaryCellClass} text-blue-900 border-l border-blue-200`}>{fmt(calcIngresoNeto(resumenAnual.total))}</td>
                    </tr>

                    <tr className="bg-red-50">
                      <td className={`${summaryLabelClass} text-red-900 sticky left-0 z-10 bg-red-50`}>Costos</td>
                      {MESES_12.map(m => {
                        const row = resumenAnual.meses?.[m] || {}
                        return <td key={m} className={`${summaryCellClass} text-red-900`}>{fmt(calcCostos(row))}</td>
                      })}
                      <td className={`${summaryCellClass} text-red-900 border-l border-red-200`}>{fmt(calcCostos(resumenAnual.total))}</td>
                    </tr>

                    <tr className="bg-emerald-50 border-t border-emerald-200">
                      <td className={`${summaryLabelClass} text-emerald-900 sticky left-0 z-10 bg-emerald-50`}>Margen</td>
                      {MESES_12.map(m => {
                        const row = resumenAnual.meses?.[m] || {}
                        return <td key={m} className={`${summaryCellClass} text-emerald-900`}>{fmt(calcIngresoNeto(row) - calcCostos(row))}</td>
                      })}
                      <td className={`${summaryCellClass} text-emerald-900 border-l border-emerald-200`}>
                        {fmt(calcIngresoNeto(resumenAnual.total) - calcCostos(resumenAnual.total))}
                      </td>
                    </tr>

                    <tr className="bg-gray-100 border-t border-gray-300">
                      <td className={`${summaryLabelClass} text-gray-800 sticky left-0 z-10 bg-gray-100`}>Ingreso por Envío</td>
                      {MESES_12.map(m => {
                        const row = resumenAnual.meses?.[m] || {}
                        const margen = calcIngresoNeto(row) - calcCostos(row)
                        const paq = row.paquetes_totales || 0
                        return <td key={m} className={`${summaryCellClass} text-gray-800`}>{paq > 0 ? fmt(Math.round(margen / paq)) : '—'}</td>
                      })}
                      {(() => {
                        const margen = calcIngresoNeto(resumenAnual.total) - calcCostos(resumenAnual.total)
                        const paq = resumenAnual.total.paquetes_totales || 0
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
        </>
      )}
    </div>
  )
}
