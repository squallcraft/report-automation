import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import api from '../../api'
import toast from 'react-hot-toast'
import {
  ArrowLeft, Zap, Target, CheckCircle2, AlertCircle, Package,
  TrendingUp, Calendar, Clock, MapPin,
} from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import CalendarHeatmap from '../../components/CalendarHeatmap'
import DateRangePicker, { toIsoLocal } from '../../components/DateRangePicker'

const now = new Date()
const parseIso = s => {
  if (!s) return null
  const [y, m, d] = s.split('-').map(Number)
  return (y && m && d) ? new Date(y, m - 1, d) : null
}
const fmtPct = v => v != null ? `${v}%` : '—'
const fmtN   = v => v != null ? v.toLocaleString('es-CL') : '—'

const colorPct = (v, good = 90, mid = 70) => {
  if (v == null) return 'text-slate-400'
  if (v >= good) return 'text-emerald-600'
  if (v >= mid)  return 'text-amber-600'
  return 'text-red-600'
}
const ratioBg = v => {
  if (v == null) return 'bg-slate-100 text-slate-400'
  if (v >= 90) return 'bg-emerald-500 text-white'
  if (v >= 75) return 'bg-emerald-400 text-white'
  if (v >= 60) return 'bg-amber-400 text-white'
  return 'bg-red-400 text-white'
}

const DIAS = { Mon: 'Lun', Tue: 'Mar', Wed: 'Mié', Thu: 'Jue', Fri: 'Vie', Sat: 'Sáb', Sun: 'Dom' }

const FRANJAS_CONFIG = [
  { key: 'am',        label: 'AM',        sub: '08:00–15:00', color: 'bg-sky-500' },
  { key: 'pm_ideal',  label: 'PM Ideal',  sub: '15:01–21:00', color: 'bg-emerald-500' },
  { key: 'pm_limite', label: 'PM Límite', sub: '21:01–22:00', color: 'bg-amber-400' },
  { key: 'pm_tarde',  label: 'PM Tarde',  sub: '22:01+',      color: 'bg-red-500' },
  { key: 'madrugada', label: 'Madrugada', sub: '00:00–07:59', color: 'bg-purple-500' },
  { key: 'sin_hora',  label: 'Sin hora',  sub: 'Sin registro', color: 'bg-gray-300' },
]

function KPICard({ label, value, sub, accent = 'blue', icon: Icon, benchmark }) {
  const map = {
    blue:    { b: 'border-l-blue-500',    t: 'text-blue-600' },
    emerald: { b: 'border-l-emerald-500', t: 'text-emerald-600' },
    amber:   { b: 'border-l-amber-500',   t: 'text-amber-600' },
    indigo:  { b: 'border-l-indigo-500',  t: 'text-indigo-600' },
    fuchsia: { b: 'border-l-fuchsia-500', t: 'text-fuchsia-600' },
    red:     { b: 'border-l-red-500',     t: 'text-red-600' },
  }
  const cls = map[accent] || map.blue
  return (
    <div className={`bg-white rounded-xl p-4 shadow-sm border border-gray-100 border-l-4 ${cls.b}`}>
      <div className="flex items-start justify-between">
        <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">{label}</p>
        {Icon && <Icon size={14} className={cls.t} />}
      </div>
      <p className={`text-3xl font-black mt-1 ${cls.t}`}>{value}</p>
      {(sub || benchmark != null) && (
        <div className="text-xs text-gray-400 mt-1.5 flex items-center gap-1.5">
          {sub && <span>{sub}</span>}
          {benchmark != null && (
            <span className="ml-auto inline-flex px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[9px] font-bold">
              meta {benchmark}%
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export default function EfectividadSeller() {
  const { sellerId }   = useParams()
  const navigate       = useNavigate()
  const [searchParams] = useSearchParams()

  const initRange = useMemo(() => {
    const fi = parseIso(searchParams.get('fecha_inicio'))
    const ff = parseIso(searchParams.get('fecha_fin'))
    if (fi && ff) return { inicio: fi, fin: ff }
    const m = searchParams.get('mes')  ? +searchParams.get('mes')  : now.getMonth() + 1
    const a = searchParams.get('anio') ? +searchParams.get('anio') : now.getFullYear()
    return { inicio: new Date(a, m - 1, 1), fin: new Date(a, m, 0) }
  }, [searchParams])

  const [range,      setRange]      = useState(initRange)
  const [data,       setData]       = useState(null)
  const [franjasG,   setFranjasG]   = useState(null)
  const [comunas,    setComunas]    = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [showAllDia, setShowAllDia] = useState(false)

  const fi = useMemo(() => range.inicio ? toIsoLocal(range.inicio) : null, [range.inicio])
  const ff = useMemo(() => range.fin    ? toIsoLocal(range.fin)    : null, [range.fin])

  const load = useCallback(async () => {
    if (!fi || !ff) return
    setLoading(true)
    try {
      const params = { fecha_inicio: fi, fecha_fin: ff }
      const [{ data: d }, { data: f }, { data: c }] = await Promise.all([
        api.get(`/dashboard/efectividad-v2/seller/${sellerId}`, { params }),
        api.get('/dashboard/franjas-horarias', { params: { ...params, seller_id: sellerId, agrupacion: 'global' } }),
        api.get('/dashboard/franjas-horarias', { params: { ...params, seller_id: sellerId, agrupacion: 'comuna' } }),
      ])
      setData(d)
      setFranjasG(f?.global ?? null)
      setComunas(c?.rows ?? [])
    } catch {
      toast.error('Error cargando datos del seller')
    } finally {
      setLoading(false)
    }
  }, [sellerId, fi, ff])
  useEffect(() => { load() }, [load])

  const k = data?.kpis

  // Comunas ordenadas por total desc
  const comunasOrdenadas = useMemo(() =>
    [...(comunas ?? [])].sort((a, b) => b.total - a.total),
    [comunas])

  // Franja dominante por comunappt
  const franjaDominante = row => {
    const best = FRANJAS_CONFIG.reduce((acc, f) => {
      const pct = row[`pct_${f.key}`] ?? 0
      return pct > (acc.pct ?? 0) ? { key: f.key, label: f.label, pct } : acc
    }, { pct: 0 })
    return best.label ?? '—'
  }

  return (
    <div className="space-y-6 pb-10">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex gap-3 items-stretch flex-wrap w-full">
        <button onClick={() => navigate('/admin/efectividad')}
          className="self-center p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors flex-shrink-0">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-[280px]">
          <PageHeader
            title={loading ? 'Cargando…' : (data?.nombre || `Seller #${sellerId}`)}
            subtitle="SLA Same-Day · Franjas horarias · Rendimiento por zona"
            icon={Package}
            accent="indigo"
            actions={<DateRangePicker value={range} onChange={setRange} />}
          />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Cargando métricas…</div>
      ) : !k ? (
        <div className="text-center py-16 text-gray-400 text-sm">Sin datos para este período</div>
      ) : (
        <>
          {/* ── KPIs SLA Same-Day ─────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KPICard label="Paquetes a ruta"  value={fmtN(k.paquetes_a_ruta)}        sub={`${k.intentos_totales} intentos`} accent="blue"    icon={Package} />
            <KPICard label="Entregados"        value={fmtN(k.paquetes_entregados)}    sub={`de ${k.paquetes_a_ruta}`}       accent="indigo"  icon={CheckCircle2} />
            <KPICard label="% Same-Day"        value={fmtPct(k.pct_same_day)}         sub={`${fmtN(k.same_day)} envíos`}   accent="emerald" icon={Zap}         benchmark={98} />
            <KPICard label="% Success"         value={fmtPct(k.pct_delivery_success)} sub="entregados / a ruta"             accent="emerald" icon={Target} />
            <KPICard label="% Primer Intento"  value={fmtPct(k.pct_first_attempt)}   sub="al 1er intento"                  accent="fuchsia" icon={TrendingUp} />
            <KPICard label="Cancelados"        value={fmtN(k.cancelados)}             sub="excluidos del denom."            accent="red"     icon={AlertCircle} />
          </div>

          {/* ── Distribución del ciclo ────────────────────────────────── */}
          {k.distribucion && (
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-semibold text-gray-700">Distribución del ciclo de entrega · SLA Same-Day</p>
                <p className="text-[10px] text-gray-400">% sobre paquetes a ruta</p>
              </div>
              <div className="grid grid-cols-6 gap-2">
                {[
                  { lab: 'Mismo día',    pct: k.distribucion.pct_0d,           n: k.distribucion.n_0d,           color: 'bg-emerald-500' },
                  { lab: '1 día',        pct: k.distribucion.pct_1d,           n: k.distribucion.n_1d,           color: 'bg-emerald-400' },
                  { lab: '2 días',       pct: k.distribucion.pct_2d,           n: k.distribucion.n_2d,           color: 'bg-amber-400' },
                  { lab: '3 días',       pct: k.distribucion.pct_3d,           n: k.distribucion.n_3d,           color: 'bg-orange-400' },
                  { lab: '+4 días',      pct: k.distribucion.pct_4plus,        n: k.distribucion.n_4plus,        color: 'bg-red-400' },
                  { lab: 'Sin entregar', pct: k.distribucion.pct_sin_entregar, n: k.distribucion.n_sin_entregar, color: 'bg-slate-400' },
                ].map(b => (
                  <div key={b.lab} className="text-center">
                    <div className={`${b.color} text-white py-3 rounded-xl`}>
                      <div className="text-2xl font-black">{b.pct}%</div>
                      <div className="text-[10px] opacity-90">{fmtN(b.n)} envíos</div>
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1.5 font-semibold">{b.lab}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Calendario Same-Day ───────────────────────────────────── */}
          {data.serie_temporal?.length > 0 && (
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Calendar size={14} className="text-slate-400" />
                  Calendario diario · % Same-Day
                </p>
                <p className="text-[10px] text-gray-400">Color = % Same-Day · Texto = same-day / a-ruta</p>
              </div>
              <CalendarHeatmap data={data.serie_temporal} />
            </div>
          )}

          {/* ── Franjas horarias ──────────────────────────────────────── */}
          {franjasG && (
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Clock size={14} className="text-slate-400" />
                  ¿En qué horario entregamos los envíos de este seller?
                </p>
                <p className="text-[10px] text-gray-400">Total: {fmtN(franjasG.total)} entregas</p>
              </div>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                {FRANJAS_CONFIG.map(f => {
                  const d = franjasG[f.key] ?? { n: 0, pct: 0 }
                  return (
                    <div key={f.key} className="text-center">
                      <div className={`${f.color} text-white py-4 rounded-xl`}>
                        <div className="text-2xl font-black">{d.pct ?? 0}%</div>
                        <div className="text-[11px] opacity-90 mt-0.5">{fmtN(d.n)}</div>
                      </div>
                      <p className="text-[10px] text-gray-600 mt-1.5 font-semibold">{f.label}</p>
                      <p className="text-[9px] text-gray-400">{f.sub}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Rendimiento por comuna ────────────────────────────────── */}
          {comunasOrdenadas.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
                <MapPin size={14} className="text-slate-400" />
                <p className="text-sm font-semibold text-gray-700">Rendimiento por zona / comuna</p>
                <span className="ml-auto text-[10px] text-gray-400">{comunasOrdenadas.length} comunas</span>
              </div>
              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50 z-10">
                    <tr className="text-[10px] text-gray-400 uppercase border-b border-gray-100">
                      <th className="px-4 py-2 text-left">Comuna</th>
                      <th className="px-4 py-2 text-center">Entregas</th>
                      {FRANJAS_CONFIG.filter(f => f.key !== 'sin_hora').map(f => (
                        <th key={f.key} className="px-3 py-2 text-center">{f.label}</th>
                      ))}
                      <th className="px-4 py-2 text-center">Franja dominante</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {comunasOrdenadas.map((c, i) => (
                      <tr key={i} className="hover:bg-gray-50 text-gray-700">
                        <td className="px-4 py-2.5 font-medium">{c.label}</td>
                        <td className="px-4 py-2.5 text-center text-gray-500">{fmtN(c.total)}</td>
                        {FRANJAS_CONFIG.filter(f => f.key !== 'sin_hora').map(f => (
                          <td key={f.key} className="px-3 py-2.5 text-center">
                            <span className={`text-[10px] font-bold ${(c[`pct_${f.key}`] ?? 0) >= 30 ? 'text-emerald-600' : (c[`pct_${f.key}`] ?? 0) > 0 ? 'text-gray-600' : 'text-gray-300'}`}>
                              {c[`pct_${f.key}`] ?? 0}%
                            </span>
                          </td>
                        ))}
                        <td className="px-4 py-2.5 text-center">
                          <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-semibold">
                            {franjaDominante(c)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Detalle día a día ─────────────────────────────────────── */}
          {data.por_dia?.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Calendar size={13} className="text-slate-400" />
                  Detalle día a día
                </p>
                <p className="text-[10px] text-gray-400">{data.por_dia.length} días con actividad</p>
              </div>
              <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50 z-10">
                    <tr className="text-[10px] text-gray-400 uppercase border-b border-gray-100">
                      <th className="px-4 py-2 text-left">Fecha</th>
                      <th className="px-4 py-2 text-left">Día</th>
                      <th className="px-4 py-2 text-center">A ruta</th>
                      <th className="px-4 py-2 text-center">Entregados</th>
                      <th className="px-4 py-2 text-center">Same-Day</th>
                      <th className="px-4 py-2 text-center">% Same-Day</th>
                      <th className="px-4 py-2 text-center">% Success</th>
                      <th className="px-4 py-2 text-center">Cancel.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {[...data.por_dia].reverse()
                      .slice(0, showAllDia ? undefined : 15)
                      .map((d, i) => (
                        <tr key={i} className="hover:bg-gray-50 text-gray-700">
                          <td className="px-4 py-2.5 font-mono text-gray-600 text-[11px]">{d.fecha}</td>
                          <td className="px-4 py-2.5 text-gray-400">{DIAS[d.weekday] ?? d.weekday}</td>
                          <td className="px-4 py-2.5 text-center font-semibold">{fmtN(d.a_ruta)}</td>
                          <td className="px-4 py-2.5 text-center text-gray-500">{fmtN(d.entregados)}</td>
                          <td className="px-4 py-2.5 text-center">
                            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                              {d.same_day}/{d.a_ruta}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={`inline-block px-2 py-0.5 rounded font-bold text-[11px] ${ratioBg(d.pct_same_day)}`}>
                              {fmtPct(d.pct_same_day)}
                            </span>
                          </td>
                          <td className={`px-4 py-2.5 text-center font-bold ${colorPct(d.pct_delivery_success, 90, 75)}`}>
                            {fmtPct(d.pct_delivery_success)}
                          </td>
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
              {data.por_dia.length > 15 && (
                <div className="px-5 py-2 border-t border-gray-100 text-center">
                  <button onClick={() => setShowAllDia(s => !s)} className="text-xs text-blue-500 hover:text-blue-700 font-semibold">
                    {showAllDia ? 'Ver menos' : `Ver todos los días (${data.por_dia.length})`}
                  </button>
                </div>
              )}
            </div>
          )}

          <p className="text-[10px] text-gray-400 text-center">
            Rango: {data.rango.inicio} → {data.rango.fin} · Same-Day = 0 días hábiles entre retiro y entrega
            {data.codigos?.length > 0 && <> · seller_codes: {data.codigos.join(', ')}</>}
          </p>
        </>
      )}
    </div>
  )
}
