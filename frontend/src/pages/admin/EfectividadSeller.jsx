import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import api from '../../api'
import toast from 'react-hot-toast'
import {
  ArrowLeft, Zap, Target, CheckCircle2, AlertCircle, Package,
  TrendingUp, Truck, Calendar,
} from 'lucide-react'
import PageHeader from '../../components/PageHeader'

const now = new Date()
const fmtPct = (v) => v != null ? `${v}%` : '—'
const fmtN = (v) => v != null ? v.toLocaleString('es-CL') : '—'

const colorPct = (v, target = 60) => {
  if (v == null) return 'text-slate-400'
  if (v >= target) return 'text-emerald-600'
  if (v >= target * 0.65) return 'text-amber-600'
  return 'text-red-600'
}

const ratioBg = (v) => {
  if (v == null) return 'bg-slate-100 text-slate-400'
  if (v >= 90) return 'bg-emerald-500 text-white'
  if (v >= 75) return 'bg-emerald-400 text-white'
  if (v >= 60) return 'bg-amber-400 text-white'
  if (v >= 40) return 'bg-orange-400 text-white'
  return 'bg-red-400 text-white'
}

function KPICard({ label, value, sub, accent = 'blue', icon: Icon, benchmark }) {
  const accentClasses = {
    blue:    { border: 'border-l-blue-500',    text: 'text-blue-600' },
    emerald: { border: 'border-l-emerald-500', text: 'text-emerald-600' },
    amber:   { border: 'border-l-amber-500',   text: 'text-amber-600' },
    red:     { border: 'border-l-red-500',     text: 'text-red-600' },
    indigo:  { border: 'border-l-indigo-500',  text: 'text-indigo-600' },
    fuchsia: { border: 'border-l-fuchsia-500', text: 'text-fuchsia-600' },
  }
  const cls = accentClasses[accent] || accentClasses.blue
  return (
    <div className={`bg-white rounded-xl p-4 shadow-sm border border-gray-100 border-l-4 ${cls.border}`}>
      <div className="flex items-start justify-between">
        <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">{label}</p>
        {Icon && <Icon size={14} className={cls.text} />}
      </div>
      <p className={`text-3xl font-black mt-1 ${cls.text}`}>{value}</p>
      {(sub || benchmark != null) && (
        <div className="text-xs text-gray-400 mt-1.5 flex items-center gap-1.5">
          {sub && <span>{sub}</span>}
          {benchmark != null && (
            <span className="ml-auto inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[9px] font-bold">
              meta {benchmark}%
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function TemporalChart({ data = [], benchmark = 98 }) {
  if (!data.length) return <p className="text-center text-xs text-gray-400 py-8">Sin datos en el rango</p>
  const max = Math.max(100, ...data.map(d => d.pct_same_day || 0))
  const w = 100 / Math.max(data.length, 1)
  return (
    <div>
      <div className="flex items-end gap-[1px] relative" style={{ height: 180 }}>
        <div
          className="absolute left-0 right-0 border-t-2 border-dashed border-emerald-300 z-10"
          style={{ bottom: `${(benchmark / max) * 100}%` }}
          title={`Meta: ${benchmark}%`}
        />
        {data.map((d) => {
          const h = Math.round(((d.pct_same_day || 0) / max) * 160)
          const color = (d.pct_same_day || 0) >= benchmark
            ? 'bg-emerald-500'
            : (d.pct_same_day || 0) >= benchmark * 0.7 ? 'bg-amber-400' : 'bg-red-400'
          return (
            <div
              key={d.fecha}
              className="flex flex-col items-center group cursor-pointer"
              style={{ width: `${w}%` }}
              title={`${d.fecha} · ${d.same_day}/${d.a_ruta} (${d.pct_same_day}%)`}
            >
              <div className={`${color} w-full rounded-t-sm group-hover:opacity-80 transition-opacity`} style={{ height: Math.max(h, 2) }} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function EfectividadSeller() {
  const { sellerId } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const initMes = searchParams.get('mes') ? +searchParams.get('mes') : now.getMonth() + 1
  const initAnio = searchParams.get('anio') ? +searchParams.get('anio') : now.getFullYear()
  const [period, setPeriod] = useState({ mes: initMes, anio: initAnio })
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
  const periodOptions = useMemo(() => {
    const opts = []
    for (let a = now.getFullYear(); a >= 2024; a--) {
      const maxM = a === now.getFullYear() ? now.getMonth() + 1 : 12
      for (let m = maxM; m >= 1; m--) opts.push({ mes: m, anio: a })
    }
    return opts
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: d } = await api.get(`/dashboard/efectividad-v2/seller/${sellerId}`, {
        params: { mes: period.mes, anio: period.anio },
      })
      setData(d)
    } catch {
      toast.error('Error cargando datos del seller')
    } finally {
      setLoading(false)
    }
  }, [sellerId, period])
  useEffect(() => { load() }, [load])

  const k = data?.kpis

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
            title={loading ? 'Cargando…' : (data?.nombre || `Seller #${sellerId}`)}
            subtitle="Detalle de Same-Day por período"
            icon={Package}
            accent="indigo"
            actions={(
              <select
                className="border border-slate-600 rounded-lg px-3 py-1.5 text-xs bg-slate-800 text-slate-200"
                value={`${period.mes}-${period.anio}`}
                onChange={e => { const [m, a] = e.target.value.split('-'); setPeriod({ mes: +m, anio: +a }) }}
              >
                {periodOptions.map(p => (
                  <option key={`${p.mes}-${p.anio}`} value={`${p.mes}-${p.anio}`}>{meses[p.mes-1]} {p.anio}</option>
                ))}
              </select>
            )}
          />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Cargando métricas…</div>
      ) : !k ? (
        <div className="text-center py-16 text-gray-400 text-sm">Sin datos para este período</div>
      ) : (
        <>
          {/* ── KPIs ───────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KPICard label="Paquetes a ruta" value={fmtN(k.paquetes_a_ruta)} sub={`${k.intentos_totales} intentos`} accent="blue" icon={Package} />
            <KPICard label="Entregados" value={fmtN(k.paquetes_entregados)} sub={`de ${k.paquetes_a_ruta}`} accent="indigo" icon={CheckCircle2} />
            <KPICard label="% Same-Day" value={fmtPct(k.pct_same_day)} sub={`${k.same_day} envíos`} accent="emerald" icon={Zap} benchmark={98} />
            <KPICard label="Success Rate" value={fmtPct(k.pct_delivery_success)} sub="entregados/a-ruta" accent="emerald" icon={Target} />
            <KPICard label="First Attempt" value={fmtPct(k.pct_first_attempt)} sub="entregados al 1er intento" accent="fuchsia" icon={TrendingUp} />
            <KPICard label="Cancelados" value={fmtN(k.cancelados)} sub="excluidos del denom." accent="red" icon={AlertCircle} />
          </div>

          {/* ── Serie temporal ─────────────────────────────────────────── */}
          {data.serie_temporal?.length > 0 && (
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <p className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Calendar size={14} className="text-slate-400" />
                Evolución diaria del % Same-Day
              </p>
              <TemporalChart data={data.serie_temporal} />
            </div>
          )}

          {/* ── Distribución del ciclo ─────────────────────────────────── */}
          {k.distribucion && (k.paquetes_entregados ?? 0) > 0 && (
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <p className="text-sm font-semibold text-gray-700 mb-4">Distribución del ciclo de entrega</p>
              <div className="grid grid-cols-5 gap-2">
                {[
                  { lab: 'Mismo día', pct: k.distribucion.pct_0d, n: k.distribucion.n_0d, color: 'bg-emerald-500' },
                  { lab: '1 día',     pct: k.distribucion.pct_1d, n: k.distribucion.n_1d, color: 'bg-emerald-400' },
                  { lab: '2 días',    pct: k.distribucion.pct_2d, n: k.distribucion.n_2d, color: 'bg-amber-400' },
                  { lab: '3 días',    pct: k.distribucion.pct_3d, n: k.distribucion.n_3d, color: 'bg-orange-400' },
                  { lab: '+4 días',   pct: k.distribucion.pct_4plus, n: k.distribucion.n_4plus, color: 'bg-red-400' },
                ].map(b => (
                  <div key={b.lab} className="text-center">
                    <div className={`${b.color} text-white py-3 rounded-lg`}>
                      <div className="text-2xl font-black">{b.pct}%</div>
                      <div className="text-[10px] opacity-90">{b.n} envíos</div>
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1.5 font-semibold">{b.lab}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Por driver que entregó ─────────────────────────────────── */}
          {data.por_driver?.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
                <Truck size={14} className="text-slate-400" />
                <p className="text-sm font-semibold text-gray-700">Conductores que despacharon a este seller</p>
                <span className="ml-auto text-[10px] text-gray-400">{data.por_driver.length} conductores</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] text-gray-400 uppercase tracking-wide bg-gray-50 border-b border-gray-100">
                      <th className="px-4 py-2 text-left font-semibold">Conductor</th>
                      <th className="px-4 py-2 text-center font-semibold">A ruta</th>
                      <th className="px-4 py-2 text-center font-semibold">Entregados</th>
                      <th className="px-4 py-2 text-center font-semibold">Same-Day</th>
                      <th className="px-4 py-2 text-center font-semibold">%SD</th>
                      <th className="px-4 py-2 text-center font-semibold">%Success</th>
                      <th className="px-4 py-2 text-center font-semibold">Cancel.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.por_driver.map((d) => (
                      <tr
                        key={d.driver_id ?? 'sin-driver'}
                        onClick={() => d.driver_id && navigate(`/admin/efectividad/driver/${d.driver_id}?mes=${period.mes}&anio=${period.anio}`)}
                        className={`text-gray-700 ${d.driver_id ? 'hover:bg-blue-50/40 cursor-pointer' : ''} transition-colors`}
                      >
                        <td className="px-4 py-2.5 font-medium">{d.nombre}</td>
                        <td className="px-4 py-2.5 text-center text-gray-500">{fmtN(d.paquetes_a_ruta)}</td>
                        <td className="px-4 py-2.5 text-center text-gray-500">{fmtN(d.paquetes_entregados)}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                            {d.paquetes_entregados}/{d.paquetes_a_ruta}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded font-bold text-[11px] ${ratioBg(d.pct_same_day)}`}>
                            {fmtPct(d.pct_same_day)}
                          </span>
                        </td>
                        <td className={`px-4 py-2.5 text-center font-bold ${colorPct(d.pct_delivery_success, 90)}`}>{fmtPct(d.pct_delivery_success)}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={(d.cancelados ?? 0) > 0 ? 'text-red-500 font-semibold' : 'text-gray-300'}>
                            {d.cancelados ?? 0}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="text-[10px] text-gray-400 text-center">
            Rango: {data.rango.inicio} → {data.rango.fin}
            {data.codigos?.length > 0 && <> · seller_codes: {data.codigos.join(', ')}</>}
          </p>
        </>
      )}
    </div>
  )
}
