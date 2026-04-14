import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import api from '../../api'
import toast from 'react-hot-toast'
import { ArrowLeft, TrendingUp, AlertTriangle } from 'lucide-react'
import PageHeader from '../../components/PageHeader'

const now = new Date()
const fmtPct = (v) => v != null ? `${v}%` : '—'
const fmtDias = (v) => v != null ? `${v}d` : '—'
const colorCiclo = (v) => {
  if (v == null) return 'text-gray-400'
  if (v <= 1) return 'text-emerald-600'
  if (v <= 2.5) return 'text-amber-600'
  return 'text-red-600'
}
const colorPct = (v) => {
  if (v == null) return 'text-gray-400'
  if (v >= 60) return 'text-emerald-600'
  if (v >= 40) return 'text-amber-600'
  return 'text-red-600'
}

function BarDist({ label, pct, n, color }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-500 w-20 text-right flex-shrink-0">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
        {pct > 0 && (
          <div className={`${color} h-5 rounded-full flex items-center pl-2 transition-all`} style={{ width: `${Math.max(pct, 3)}%` }}>
            <span className="text-[10px] text-white font-bold">{pct}%</span>
          </div>
        )}
      </div>
      <span className="text-xs text-gray-400 w-8 flex-shrink-0 text-right">{n}</span>
    </div>
  )
}

function MiniBar({ pct, color }) {
  return (
    <div className="flex items-center gap-2 flex-1">
      <div className="flex-1 bg-gray-100 rounded-full h-2">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct || 0}%` }} />
      </div>
    </div>
  )
}

function TablaVacia() {
  return <p className="text-center text-xs text-gray-400 py-8">Sin datos para este período</p>
}

function SemanasTab({ rows = [] }) {
  if (!rows.length) return <TablaVacia />
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] text-gray-400 uppercase tracking-wide bg-gray-50 border-b border-gray-100">
            <th className="px-4 py-2 text-left font-semibold">Semana</th>
            <th className="px-4 py-2 text-center font-semibold">Total</th>
            <th className="px-4 py-2 text-center font-semibold">Ciclo prom.</th>
            <th className="px-4 py-2 text-center font-semibold">Mismo día</th>
            <th className="px-4 py-2 font-semibold">Entregados ≤1d</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map(r => (
            <tr key={r.semana} className="hover:bg-gray-50 text-gray-700">
              <td className="px-4 py-2.5 font-semibold">Semana {r.semana}</td>
              <td className="px-4 py-2.5 text-center text-gray-500">{r.total}</td>
              <td className={`px-4 py-2.5 text-center font-bold ${colorCiclo(r.ciclo_avg)}`}>{fmtDias(r.ciclo_avg)}</td>
              <td className="px-4 py-2.5 text-center">
                <span className={`font-semibold ${r.pct_0d >= 30 ? 'text-emerald-600' : 'text-gray-500'}`}>{fmtPct(r.pct_0d)}</span>
              </td>
              <td className="px-4 py-2.5 w-48">
                <div className="flex items-center gap-2">
                  <MiniBar pct={r.pct_rapida} color={r.pct_rapida >= 60 ? 'bg-emerald-500' : r.pct_rapida >= 40 ? 'bg-amber-400' : 'bg-red-400'} />
                  <span className={`font-bold w-10 text-right ${colorPct(r.pct_rapida)}`}>{fmtPct(r.pct_rapida)}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DiasTab({ rows = [] }) {
  if (!rows.length) return <TablaVacia />
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] text-gray-400 uppercase tracking-wide bg-gray-50 border-b border-gray-100">
            <th className="px-4 py-2 text-left font-semibold">Fecha</th>
            <th className="px-4 py-2 text-center font-semibold">Total</th>
            <th className="px-4 py-2 text-center font-semibold">Ciclo prom.</th>
            <th className="px-4 py-2 text-center font-semibold">Mismo día</th>
            <th className="px-4 py-2 font-semibold">Entregados ≤1d</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map(r => (
            <tr key={r.fecha} className="hover:bg-gray-50 text-gray-700">
              <td className="px-4 py-2.5 font-medium text-gray-600">{r.fecha}</td>
              <td className="px-4 py-2.5 text-center text-gray-500">{r.total}</td>
              <td className={`px-4 py-2.5 text-center font-bold ${colorCiclo(r.ciclo_avg)}`}>{fmtDias(r.ciclo_avg)}</td>
              <td className="px-4 py-2.5 text-center">
                <span className={`font-semibold ${r.pct_0d >= 30 ? 'text-emerald-600' : 'text-gray-500'}`}>{fmtPct(r.pct_0d)}</span>
              </td>
              <td className="px-4 py-2.5 w-48">
                <div className="flex items-center gap-2">
                  <MiniBar pct={r.pct_rapida} color={r.pct_rapida >= 60 ? 'bg-emerald-500' : r.pct_rapida >= 40 ? 'bg-amber-400' : 'bg-red-400'} />
                  <span className={`font-bold w-10 text-right ${colorPct(r.pct_rapida)}`}>{fmtPct(r.pct_rapida)}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RutasTab({ rows = [] }) {
  if (!rows.length) return <TablaVacia />
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] text-gray-400 uppercase tracking-wide bg-gray-50 border-b border-gray-100">
            <th className="px-4 py-2 text-left font-semibold">Ruta</th>
            <th className="px-4 py-2 text-center font-semibold">Total</th>
            <th className="px-4 py-2 text-center font-semibold">Ciclo prom.</th>
            <th className="px-4 py-2 text-center font-semibold">Mismo día</th>
            <th className="px-4 py-2 font-semibold">Entregados ≤1d</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-gray-50 text-gray-700">
              <td className="px-4 py-2.5 font-medium max-w-xs truncate" title={r.ruta}>{r.ruta}</td>
              <td className="px-4 py-2.5 text-center text-gray-500">{r.total}</td>
              <td className={`px-4 py-2.5 text-center font-bold ${colorCiclo(r.ciclo_avg)}`}>{fmtDias(r.ciclo_avg)}</td>
              <td className="px-4 py-2.5 text-center">
                <span className={`font-semibold ${r.pct_0d >= 30 ? 'text-emerald-600' : 'text-gray-500'}`}>{fmtPct(r.pct_0d)}</span>
              </td>
              <td className="px-4 py-2.5 w-48">
                <div className="flex items-center gap-2">
                  <MiniBar pct={r.pct_rapida} color={r.pct_rapida >= 60 ? 'bg-emerald-500' : r.pct_rapida >= 40 ? 'bg-amber-400' : 'bg-red-400'} />
                  <span className={`font-bold w-10 text-right ${colorPct(r.pct_rapida)}`}>{fmtPct(r.pct_rapida)}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function EfectividadDriver() {
  const { driverId } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const initMes = searchParams.get('mes') ? +searchParams.get('mes') : now.getMonth() + 1
  const initAnio = searchParams.get('anio') ? +searchParams.get('anio') : now.getFullYear()

  const [period, setPeriod] = useState({ mes: initMes, anio: initAnio })
  const [tab, setTab] = useState('semana')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: d } = await api.get(`/dashboard/efectividad/driver/${driverId}`, {
        params: { mes: period.mes, anio: period.anio }
      })
      setData(d)
    } catch {
      toast.error('Error cargando datos del conductor')
    } finally {
      setLoading(false)
    }
  }, [driverId, period])

  useEffect(() => { load() }, [load])

  const r = data?.resumen

  return (
    <div className="space-y-6 pb-10">
      <div className="flex gap-3 items-stretch flex-wrap w-full">
        <button
          type="button"
          onClick={() => navigate('/admin/efectividad')}
          className="self-center p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors flex-shrink-0"
          title="Volver"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-[280px]">
          <PageHeader
            title={loading ? 'Cargando…' : (r?.nombre || `Conductor #${driverId}`)}
            subtitle="Detalle de efectividad por período"
            icon={TrendingUp}
            accent="green"
            actions={(
              <select
                className="border border-slate-600 rounded-lg px-3 py-1.5 text-xs bg-slate-800 text-slate-200"
                value={`${period.mes}-${period.anio}`}
                onChange={e => { const [m, a] = e.target.value.split('-'); setPeriod({ mes: +m, anio: +a }) }}
              >
                {Array.from({ length: 12 }, (_, i) => {
                  const mes = i + 1
                  const anio = now.getFullYear()
                  return <option key={i} value={`${mes}-${anio}`}>{meses[i]} {anio}</option>
                })}
              </select>
            )}
          />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Cargando métricas del conductor…</div>
      ) : !r ? (
        <div className="text-center py-16 text-gray-400 text-sm">Sin datos para este período</div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 border-l-4 border-l-blue-500">
              <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Total medibles</p>
              <p className="text-3xl font-black text-gray-800 mt-1">{r.total}</p>
              <p className="text-xs text-gray-400 mt-1">{meses[period.mes - 1]} {period.anio}</p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 border-l-4 border-l-emerald-500">
              <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Ciclo promedio</p>
              <p className={`text-3xl font-black mt-1 ${colorCiclo(r.ciclo_promedio)}`}>{fmtDias(r.ciclo_promedio)}</p>
              <p className="text-xs text-gray-400 mt-1">recepción → entrega</p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 border-l-4 border-l-emerald-400">
              <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Entregados ≤1d</p>
              <p className="text-3xl font-black text-emerald-600 mt-1">{fmtPct(r.pct_rapida)}</p>
              <p className="text-xs text-gray-400 mt-1">{(r.n_0d || 0) + (r.n_1d || 0)} envíos</p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 border-l-4 border-l-red-400">
              <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Con +4 días</p>
              <p className="text-3xl font-black text-red-500 mt-1">{fmtPct(r.pct_4plus)}</p>
              <p className="text-xs text-gray-400 mt-1">{r.n_4plus || 0} envíos lentos</p>
            </div>
          </div>

          {/* Distribución */}
          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <p className="text-sm font-semibold text-gray-700 mb-4">Distribución del ciclo de entrega</p>
            <div className="space-y-2.5">
              <BarDist label="Mismo día" pct={r.pct_0d} n={r.n_0d} color="bg-emerald-500" />
              <BarDist label="1 día" pct={r.pct_1d} n={r.n_1d} color="bg-emerald-400" />
              <BarDist label="2 días" pct={r.pct_2d} n={r.n_2d} color="bg-amber-400" />
              <BarDist label="3 días" pct={r.pct_3d} n={r.n_3d} color="bg-orange-400" />
              <BarDist label="+4 días" pct={r.pct_4plus} n={r.n_4plus} color="bg-red-400" />
            </div>
          </div>

          {/* Tabs */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="flex border-b border-gray-100">
              {[
                { id: 'semana', label: 'Por Semana' },
                { id: 'dia', label: 'Por Día' },
                { id: 'ruta', label: 'Por Ruta' },
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-5 py-3 text-xs font-semibold border-b-2 transition-colors ${
                    tab === t.id
                      ? 'border-blue-500 text-blue-600 bg-blue-50/50'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="py-2">
              {tab === 'semana' && <SemanasTab rows={data.por_semana} />}
              {tab === 'dia' && <DiasTab rows={data.por_dia} />}
              {tab === 'ruta' && <RutasTab rows={data.por_ruta} />}
            </div>
          </div>

          {/* Envíos lentos */}
          {data.lentos?.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
                <AlertTriangle size={14} className="text-amber-500" />
                <p className="text-sm font-semibold text-gray-700">Envíos con +3 días</p>
                <span className="ml-auto text-xs text-gray-400">{data.lentos.length} registros</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-[10px] text-gray-400 uppercase tracking-wide border-b border-gray-100">
                      <th className="px-4 py-2 text-left font-semibold">Tracking</th>
                      <th className="px-4 py-2 text-left font-semibold">Seller</th>
                      <th className="px-4 py-2 text-left font-semibold">Fecha Carga</th>
                      <th className="px-4 py-2 text-left font-semibold">Fecha Entrega</th>
                      <th className="px-4 py-2 text-center font-semibold">Días</th>
                      <th className="px-4 py-2 text-left font-semibold">Comuna</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.lentos.map((l, i) => (
                      <tr key={i} className="hover:bg-gray-50 text-gray-700">
                        <td className="px-4 py-2.5 font-mono text-blue-600 text-[10px]">{l.tracking_id}</td>
                        <td className="px-4 py-2.5 max-w-[100px] truncate" title={l.seller}>{l.seller}</td>
                        <td className="px-4 py-2.5 text-gray-500">{l.fecha_carga}</td>
                        <td className="px-4 py-2.5 text-gray-500">{l.fecha_entrega}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${l.ciclo_dias >= 4 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
                            +{l.ciclo_dias}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-500">{l.comuna}</td>
                      </tr>
                    ))}
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
