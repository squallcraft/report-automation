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

const heatmapColor = (v, isEmpty) => {
  if (isEmpty) return 'bg-gray-100 text-gray-300'
  if (v == null) return 'bg-gray-100 text-gray-300'
  if (v >= 90) return 'bg-emerald-600 text-white'
  if (v >= 75) return 'bg-emerald-500 text-white'
  if (v >= 60) return 'bg-emerald-400 text-white'
  if (v >= 45) return 'bg-amber-400 text-white'
  if (v >= 30) return 'bg-orange-400 text-white'
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

// "Contribution graph" tipo GitHub: una columna por semana, 5 filas (Lun-Vie),
// cada celda muestra "X/Y" (entregados/a-ruta).
function CalendarHeatmap({ heatmap = [] }) {
  // Agrupamos por semana ISO simple: (año, semana) → dict por weekday.
  // Calculamos semanas con date-only logic basado en fecha del primer día.
  if (!heatmap.length) return <p className="text-center text-xs text-gray-400 py-8">Sin datos en el rango</p>

  const byKey = {}
  heatmap.forEach(d => { byKey[d.fecha] = d })

  const fechas = heatmap.map(d => new Date(d.fecha + 'T00:00:00')).sort((a, b) => a - b)
  const fmin = fechas[0]
  const fmax = fechas[fechas.length - 1]

  // Primer lunes <= fmin
  const start = new Date(fmin)
  while (start.getDay() !== 1) start.setDate(start.getDate() - 1)
  // Domingo final >= fmax
  const end = new Date(fmax)
  while (end.getDay() !== 0) end.setDate(end.getDate() + 1)

  const weeks = []
  const cursor = new Date(start)
  while (cursor <= end) {
    const week = []
    for (let i = 0; i < 7; i++) {
      const dateStr = cursor.toISOString().slice(0, 10)
      week.push({ fecha: dateStr, weekday: cursor.getDay(), data: byKey[dateStr] || null })
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
  }

  const dayLabels = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

  return (
    <div>
      <div className="flex gap-1 overflow-x-auto pb-2">
        {/* Columna de etiquetas */}
        <div className="flex flex-col gap-1 pr-2 pt-6">
          {dayLabels.slice(0, 5).map((d, i) => (
            <div key={i} className="text-[10px] text-gray-400 h-12 flex items-center font-semibold">{d}</div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {/* Etiqueta del mes en la primera semana */}
            <div className="h-4 text-[9px] text-gray-400 text-center">
              {week.find(d => new Date(d.fecha + 'T00:00:00').getDate() <= 7) &&
                ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][new Date(week[0].fecha + 'T00:00:00').getMonth()]}
            </div>
            {[1, 2, 3, 4, 5].map(weekdayIdx => {
              // Map weekdayIdx 1..5 (Mon..Fri) into our week (week[i].weekday returns 0=Sun..6=Sat)
              const cell = week.find(c => {
                const d = new Date(c.fecha + 'T00:00:00').getDay()
                const targetJsDay = weekdayIdx === 7 ? 0 : weekdayIdx
                return d === targetJsDay
              })
              if (!cell) return <div key={weekdayIdx} className="h-12 w-12" />
              const isEmpty = !cell.data
              const colorCls = heatmapColor(cell.data?.pct_same_day, isEmpty)
              return (
                <div
                  key={weekdayIdx}
                  className={`h-12 w-12 rounded-md flex flex-col items-center justify-center transition-transform hover:scale-110 cursor-default ${colorCls}`}
                  title={isEmpty
                    ? `${cell.fecha} · sin actividad`
                    : `${cell.fecha} · ${cell.data.label} (${cell.data.pct_same_day}% same-day)`
                  }
                >
                  {!isEmpty && (
                    <>
                      <span className="text-[13px] font-black leading-none">{cell.data.label}</span>
                      <span className="text-[9px] opacity-90 leading-none mt-0.5">{cell.data.pct_same_day}%</span>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      {/* Leyenda */}
      <div className="mt-3 flex items-center justify-center gap-2 text-[10px] text-gray-500">
        <span>Bajo</span>
        <div className="w-4 h-4 rounded-sm bg-red-400" />
        <div className="w-4 h-4 rounded-sm bg-orange-400" />
        <div className="w-4 h-4 rounded-sm bg-amber-400" />
        <div className="w-4 h-4 rounded-sm bg-emerald-400" />
        <div className="w-4 h-4 rounded-sm bg-emerald-500" />
        <div className="w-4 h-4 rounded-sm bg-emerald-600" />
        <span>Alto · Cada celda muestra <b>entregados / a-ruta</b></span>
      </div>
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
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showAllRoutes, setShowAllRoutes] = useState(false)

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
      const { data: d } = await api.get(`/dashboard/efectividad-v2/driver/${driverId}`, {
        params: { mes: period.mes, anio: period.anio },
      })
      setData(d)
    } catch {
      toast.error('Error cargando datos del conductor')
    } finally {
      setLoading(false)
    }
  }, [driverId, period])
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
            title={loading ? 'Cargando…' : (data?.nombre || `Conductor #${driverId}`)}
            subtitle="Detalle de Same-Day por período"
            icon={Truck}
            accent="emerald"
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

          {/* ── Heatmap calendario ─────────────────────────────────────── */}
          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Calendar size={14} className="text-slate-400" />
                Calendario de actividad — entregados / a-ruta por día
              </p>
              <p className="text-[10px] text-gray-400">Color = % Same-Day · Texto = entregados / a-ruta</p>
            </div>
            <CalendarHeatmap heatmap={data.heatmap} />
          </div>

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

          {/* ── Por Ruta ───────────────────────────────────────────────── */}
          {data.por_ruta?.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-700">Rendimiento por Ruta</p>
                <p className="text-[10px] text-gray-400">{data.por_ruta.length} rutas</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] text-gray-400 uppercase tracking-wide bg-gray-50 border-b border-gray-100">
                      <th className="px-4 py-2 text-left font-semibold">Ruta</th>
                      <th className="px-4 py-2 text-center font-semibold">A ruta</th>
                      <th className="px-4 py-2 text-center font-semibold">Entregados</th>
                      <th className="px-4 py-2 text-center font-semibold">Same-Day</th>
                      <th className="px-4 py-2 text-center font-semibold">%SD</th>
                      <th className="px-4 py-2 text-center font-semibold">%Success</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(showAllRoutes ? data.por_ruta : data.por_ruta.slice(0, 15)).map((r, i) => (
                      <tr key={i} className="hover:bg-gray-50 text-gray-700">
                        <td className="px-4 py-2.5 font-medium max-w-xs truncate" title={r.ruta}>{r.ruta}</td>
                        <td className="px-4 py-2.5 text-center text-gray-500">{fmtN(r.paquetes_a_ruta)}</td>
                        <td className="px-4 py-2.5 text-center text-gray-500">{fmtN(r.paquetes_entregados)}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                            {r.paquetes_entregados}/{r.paquetes_a_ruta}
                          </span>
                        </td>
                        <td className={`px-4 py-2.5 text-center font-bold ${colorPct(r.pct_same_day, 80)}`}>{fmtPct(r.pct_same_day)}</td>
                        <td className={`px-4 py-2.5 text-center font-bold ${colorPct(r.pct_delivery_success, 90)}`}>{fmtPct(r.pct_delivery_success)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.por_ruta.length > 15 && (
                <div className="px-5 py-2 border-t border-gray-100 text-center">
                  <button onClick={() => setShowAllRoutes(s => !s)}
                    className="text-xs text-blue-500 hover:text-blue-700 font-semibold">
                    {showAllRoutes ? 'Ver menos' : `Ver todas (${data.por_ruta.length})`}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── No entregados ──────────────────────────────────────────── */}
          {data.no_entregados?.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
                <AlertCircle size={14} className="text-amber-500" />
                <p className="text-sm font-semibold text-gray-700">Pendientes de entrega</p>
                <span className="ml-auto text-xs text-gray-400">
                  Mostrando {data.no_entregados.length} de {data.no_entregados_total}
                </span>
              </div>
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr className="text-[10px] text-gray-400 uppercase tracking-wide border-b border-gray-100">
                      <th className="px-4 py-2 text-left font-semibold">Tracking</th>
                      <th className="px-4 py-2 text-left font-semibold">Fecha retiro</th>
                      <th className="px-4 py-2 text-center font-semibold">Intento</th>
                      <th className="px-4 py-2 text-left font-semibold">Ruta</th>
                      <th className="px-4 py-2 text-left font-semibold">Seller</th>
                      <th className="px-4 py-2 text-left font-semibold">Comuna</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.no_entregados.map((n, i) => (
                      <tr key={i} className="hover:bg-gray-50 text-gray-700">
                        <td className="px-4 py-2.5 font-mono text-blue-600 text-[10px]">{n.tracking_id}</td>
                        <td className="px-4 py-2.5 text-gray-500">{n.fecha_retiro || '—'}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className="text-[10px] font-bold bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded">#{n.intento_nro}</span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-600 max-w-[180px] truncate" title={n.ruta_nombre}>{n.ruta_nombre || '—'}</td>
                        <td className="px-4 py-2.5 text-gray-600 max-w-[120px] truncate" title={n.seller}>{n.seller || n.seller_code || '—'}</td>
                        <td className="px-4 py-2.5 text-gray-500">{n.comuna || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="text-[10px] text-gray-400 text-center">
            Rango: {data.rango.inicio} → {data.rango.fin} · Same-Day = 0 días hábiles
          </p>
        </>
      )}
    </div>
  )
}
