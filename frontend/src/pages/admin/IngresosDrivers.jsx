import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api'
import toast from 'react-hot-toast'
import { DollarSign, ArrowUpRight, ArrowDownRight, Minus, AlertTriangle, BarChart2 } from 'lucide-react'
import PageHeader from '../../components/PageHeader'

const now = new Date()
const fmtClp = (n) => (n ?? 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP' })
const mNombres = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

function VarBadge({ value, size = 'sm', parcial }) {
  if (value == null) return <span className="text-gray-300 text-[10px]">—</span>
  const isUp = value > 0
  const isDown = value < 0
  const Icon = isUp ? ArrowUpRight : isDown ? ArrowDownRight : Minus
  const color = isUp ? 'text-emerald-600 bg-emerald-50' : isDown ? 'text-red-600 bg-red-50' : 'text-gray-500 bg-gray-100'
  const textSize = size === 'lg' ? 'text-xs' : 'text-[10px]'
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full font-bold ${color} ${textSize}`} title={parcial ? 'Comparación parcial (semanas equivalentes)' : undefined}>
      <Icon size={size === 'lg' ? 12 : 10} />{Math.abs(value)}%{parcial && <span className="text-[8px] ml-0.5 opacity-60">~</span>}
    </span>
  )
}

function SparkLine({ data, maxH = 24, width = 100 }) {
  if (!data || data.length === 0) return null
  const max = Math.max(...data, 1)
  const barW = Math.floor((width - (data.length - 1) * 2) / data.length)
  return (
    <div className="flex items-end gap-[2px]" style={{ height: maxH, width }}>
      {data.map((v, i) => (
        <div
          key={i}
          className="bg-blue-400 rounded-t-sm"
          style={{ width: barW, height: Math.max(Math.round((v / max) * maxH), 2) }}
          title={fmtClp(v)}
        />
      ))}
    </div>
  )
}

export default function IngresosDrivers() {
  const navigate = useNavigate()
  const [period, setPeriod] = useState({ mes: now.getMonth() + 1, anio: now.getFullYear() })
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('ganancia')
  const [sortDir, setSortDir] = useState('desc')

  const periodOptions = []
  for (let a = now.getFullYear(); a >= 2024; a--) {
    const maxM = a === now.getFullYear() ? now.getMonth() + 1 : 12
    for (let m = maxM; m >= 1; m--) periodOptions.push({ mes: m, anio: a })
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: d } = await api.get('/dashboard/ingresos/drivers', {
        params: { mes: period.mes, anio: period.anio }
      })
      setData(d)
    } catch {
      toast.error('Error cargando ingresos de conductores')
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => { load() }, [load])

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('desc') }
  }

  const ranking = (data?.ranking || [])
    .filter(r => !search || r.nombre.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const va = a[sortBy] ?? 0
      const vb = b[sortBy] ?? 0
      return sortDir === 'desc' ? vb - va : va - vb
    })

  const t = data?.totals || {}

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        title="Ingresos Conductores"
        subtitle={`Ranking y estadísticas — ${mNombres[period.mes - 1]} ${period.anio}${data?.comparacion?.parcial ? ` (semanas 1-${data.comparacion.semanas_comparadas} de ${data.comparacion.semanas_totales})` : ''}`}
        icon={DollarSign}
        accent="green"
        actions={(
          <select
            className="border border-slate-600 rounded-lg px-3 py-1.5 text-xs bg-slate-800 text-slate-200"
            value={`${period.mes}-${period.anio}`}
            onChange={e => { const [m, a] = e.target.value.split('-'); setPeriod({ mes: +m, anio: +a }) }}
          >
            {periodOptions.map(p => (
              <option key={`${p.mes}-${p.anio}`} value={`${p.mes}-${p.anio}`}>{mNombres[p.mes-1]} {p.anio}</option>
            ))}
          </select>
        )}
      />

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Cargando datos de ingresos…</div>
      ) : !data ? (
        <div className="text-center py-16 text-gray-400 text-sm">Sin datos para este período</div>
      ) : (
        <>
          {/* KPIs globales */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 border-l-4 border-l-emerald-500">
              <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Ganancias totales</p>
              <p className="text-2xl font-black text-gray-800 mt-1">{fmtClp(t.ganancia_total)}</p>
              <p className="text-xs text-gray-400 mt-1">{t.total_drivers} conductores activos</p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 border-l-4 border-l-blue-500">
              <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Promedio por conductor</p>
              <p className="text-2xl font-black text-gray-800 mt-1">{fmtClp(t.promedio_ganancia)}</p>
              <p className="text-xs text-gray-400 mt-1">{t.promedio_entregas} entregas prom.</p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 border-l-4 border-l-emerald-400">
              <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Creciendo</p>
              <p className="text-2xl font-black text-emerald-600 mt-1">{t.creciendo || 0}</p>
              <p className="text-xs text-gray-400 mt-1">conductores con +2% MoM</p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 border-l-4 border-l-red-400">
              <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Cayendo</p>
              <p className="text-2xl font-black text-red-500 mt-1">{t.cayendo || 0}</p>
              <p className="text-xs text-gray-400 mt-1">conductores con -2% MoM</p>
            </div>
          </div>

          {/* Comparación parcial */}
          {data.comparacion?.parcial && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center gap-2">
              <span className="text-blue-500 text-sm font-bold">~</span>
              <p className="text-xs text-blue-700">
                <span className="font-semibold">Comparación por períodos equivalentes:</span> {mNombres[period.mes - 1]} lleva {data.comparacion.semanas_comparadas} de {data.comparacion.semanas_totales} semanas liquidadas.
                MoM y YoY comparan solo semanas 1-{data.comparacion.semanas_comparadas} de cada período.
              </p>
            </div>
          )}

          {/* Alertas */}
          {data.alertas?.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={16} className="text-red-500" />
                <p className="text-sm font-semibold text-red-700">Alertas de caída fuerte</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {data.alertas.map((a, i) => (
                  <span key={i} className="inline-flex items-center gap-1 bg-red-100 text-red-700 px-3 py-1 rounded-full text-xs font-medium">
                    {a.driver} <VarBadge value={a.valor} />
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Buscador */}
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Buscar conductor…"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-200"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <span className="text-xs text-gray-400">{ranking.length} conductores</span>
          </div>

          {/* Ranking tabla */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] text-gray-400 uppercase tracking-wide bg-gray-50 border-b border-gray-100">
                    <th className="px-4 py-2 text-center font-semibold w-10">#</th>
                    <th className="px-4 py-2 text-left font-semibold">Conductor</th>
                    <th className="px-4 py-2 text-left font-semibold">Zona</th>
                    <th className="px-4 py-2 text-right font-semibold cursor-pointer select-none hover:text-blue-600" onClick={() => toggleSort('entregas')}>
                      Entregas {sortBy === 'entregas' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                    </th>
                    <th className="px-4 py-2 text-right font-semibold cursor-pointer select-none hover:text-blue-600" onClick={() => toggleSort('ganancia')}>
                      Ganancia {sortBy === 'ganancia' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                    </th>
                    <th className="px-4 py-2 text-right font-semibold cursor-pointer select-none hover:text-blue-600" onClick={() => toggleSort('promedio')}>
                      Prom/paq {sortBy === 'promedio' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                    </th>
                    <th className="px-4 py-2 text-center font-semibold">MoM</th>
                    <th className="px-4 py-2 text-center font-semibold">YoY</th>
                    <th className="px-4 py-2 font-semibold">Últimos 6m</th>
                    <th className="px-4 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {ranking.map((r, i) => (
                    <tr key={r.driver_id} className="hover:bg-gray-50 text-gray-700 cursor-pointer" onClick={() => navigate(`/admin/efectividad/driver/${r.driver_id}?mes=${period.mes}&anio=${period.anio}`)}>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold ${
                          i === 0 ? 'bg-yellow-100 text-yellow-700' : i === 1 ? 'bg-gray-100 text-gray-600' : i === 2 ? 'bg-amber-100 text-amber-700' : 'text-gray-400'
                        }`}>{i + 1}</span>
                      </td>
                      <td className="px-4 py-2.5 font-semibold text-gray-800 whitespace-nowrap">
                        {r.nombre}
                        {r.contratado && <span className="ml-1.5 text-[9px] bg-blue-50 text-blue-500 px-1 py-0.5 rounded font-medium">C</span>}
                      </td>
                      <td className="px-4 py-2.5 text-gray-500">{r.zona || '—'}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500">{r.entregas.toLocaleString('es-CL')}</td>
                      <td className="px-4 py-2.5 text-right font-bold text-gray-800">{fmtClp(r.ganancia)}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500">{fmtClp(r.promedio)}</td>
                      <td className="px-4 py-2.5 text-center"><VarBadge value={r.var_mom} parcial={data.comparacion?.parcial} /></td>
                      <td className="px-4 py-2.5 text-center"><VarBadge value={r.var_yoy} parcial={data.comparacion?.parcial} /></td>
                      <td className="px-4 py-2.5"><SparkLine data={r.spark} /></td>
                      <td className="px-4 py-2.5">
                        <BarChart2 size={14} className="text-gray-400" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
