import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import api from '../../api'
import toast from 'react-hot-toast'
import {
  ArrowLeft, Target, CheckCircle2, AlertCircle, Package,
  TrendingUp, Truck, Calendar, Clock,
} from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import CalendarHeatmap from '../../components/CalendarHeatmap'
import DateRangePicker, { toIsoLocal } from '../../components/DateRangePicker'

const now = new Date()
const parseIso = (s) => {
  if (!s) return null
  const [y, m, d] = s.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}
const fmtPct = (v) => v != null ? `${v}%` : '—'
const fmtN = (v) => v != null ? v.toLocaleString('es-CL') : '—'

const colorPct = (v, target = 90) => {
  if (v == null) return 'text-slate-400'
  if (v >= target) return 'text-emerald-600'
  if (v >= target * 0.75) return 'text-amber-600'
  return 'text-red-600'
}

function KPICard({ label, value, sub, accent = 'blue', icon: Icon }) {
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
      {sub && <p className="text-xs text-gray-400 mt-1.5">{sub}</p>}
    </div>
  )
}

const FRANJAS_CONFIG = [
  { key: 'am',        label: 'AM',         sub: '08:00 – 15:00', color: 'bg-sky-500' },
  { key: 'pm_ideal',  label: 'PM ideal',   sub: '15:01 – 21:00', color: 'bg-emerald-500' },
  { key: 'pm_limite', label: 'PM límite',  sub: '21:01 – 22:00', color: 'bg-amber-400' },
  { key: 'pm_tarde',  label: 'PM tarde',   sub: '22:01+',         color: 'bg-red-500' },
  { key: 'madrugada', label: 'Madrugada',  sub: '00:00 – 07:59', color: 'bg-slate-500' },
  { key: 'sin_hora',  label: 'Sin hora',   sub: 'Sin registro',   color: 'bg-gray-300' },
]

export default function EfectividadDriver() {
  const { driverId } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const initRange = useMemo(() => {
    const fi = parseIso(searchParams.get('fecha_inicio'))
    const ff = parseIso(searchParams.get('fecha_fin'))
    if (fi && ff) return { inicio: fi, fin: ff }
    const m = searchParams.get('mes') ? +searchParams.get('mes') : now.getMonth() + 1
    const a = searchParams.get('anio') ? +searchParams.get('anio') : now.getFullYear()
    return { inicio: new Date(a, m - 1, 1), fin: new Date(a, m, 0) }
  }, [searchParams])
  const [range, setRange] = useState(initRange)
  const [data, setData] = useState(null)
  const [franjas, setFranjas] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showAllRoutes, setShowAllRoutes] = useState(false)

  const fechaInicioIso = useMemo(() => range.inicio ? toIsoLocal(range.inicio) : null, [range.inicio])
  const fechaFinIso = useMemo(() => range.fin ? toIsoLocal(range.fin) : null, [range.fin])

  const load = useCallback(async () => {
    if (!fechaInicioIso || !fechaFinIso) return
    setLoading(true)
    try {
      const params = { fecha_inicio: fechaInicioIso, fecha_fin: fechaFinIso }
      const [{ data: d }, { data: f }] = await Promise.all([
        api.get(`/dashboard/efectividad-v2/driver/${driverId}`, { params }),
        api.get(`/dashboard/franjas-horarias`, { params: { ...params, driver_id: driverId, agrupacion: 'global' } }),
      ])
      setData(d)
      setFranjas(f?.global ?? null)
    } catch {
      toast.error('Error cargando datos del conductor')
    } finally {
      setLoading(false)
    }
  }, [driverId, fechaInicioIso, fechaFinIso])
  useEffect(() => { load() }, [load])

  const k = data?.kpis
  const r = data?.rendimiento

  // Construir heatmap con pct_success calculado desde a_ruta/entregados
  const heatmapConSuccess = useMemo(() => {
    if (!data?.heatmap) return []
    return data.heatmap.map(h => ({
      ...h,
      pct_success: h.a_ruta > 0 ? Math.round(100 * h.entregados / h.a_ruta * 10) / 10 : null,
    }))
  }, [data?.heatmap])

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
            subtitle="Efectividad de entregas por período"
            icon={Truck}
            accent="emerald"
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
          {/* ── KPIs ───────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <KPICard label="Paquetes a ruta" value={fmtN(k.paquetes_a_ruta)} sub={`${k.intentos_totales} intentos totales`} accent="blue" icon={Package} />
            <KPICard label="Entregados" value={fmtN(k.paquetes_entregados)} sub={`de ${k.paquetes_a_ruta} asignados`} accent="indigo" icon={CheckCircle2} />
            <KPICard label="% Efectividad" value={fmtPct(k.pct_delivery_success)} sub="entregados / a ruta" accent="emerald" icon={Target} />
            <KPICard label="Primer intento" value={fmtPct(k.pct_first_attempt)} sub="entregados al 1er intento" accent="fuchsia" icon={TrendingUp} />
            <KPICard label="Cancelados" value={fmtN(k.cancelados)} sub="excluidos del denominador" accent="red" icon={AlertCircle} />
          </div>

          {/* ── Heatmap calendario ─────────────────────────────────────── */}
          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Calendar size={14} className="text-slate-400" />
                Calendario de actividad — entregados / a-ruta por día
              </p>
              <p className="text-[10px] text-gray-400">Color = % efectividad · Texto = entregados / a-ruta</p>
            </div>
            <CalendarHeatmap data={heatmapConSuccess} valueKey="pct_success" />
          </div>

          {/* ── Rendimiento del conductor (route_date) ────────────────── */}
          {r && (r.paquetes_a_ruta > 0) && (
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 space-y-4">
              <div>
                <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Truck size={14} className="text-indigo-500" />
                  Rendimiento operativo del conductor
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  ¿Cuántos entregó el mismo día que salió a ruta? · Base: fecha de ruta
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <KPICard label="A ruta (route_date)" value={fmtN(r.paquetes_a_ruta)} sub="paquetes con fecha de ruta" accent="indigo" icon={Package} />
                <KPICard label="Entregados mismo día" value={fmtN(r.paquetes_entregados)} sub={`${r.paquetes_sin_entregar} no entregados ese día`} accent="emerald" icon={CheckCircle2} />
                <KPICard
                  label="% Entrega mismo día"
                  value={fmtPct(r.pct_entrega_mismo_dia)}
                  sub="rendimiento del conductor"
                  accent={r.pct_entrega_mismo_dia >= 80 ? 'emerald' : r.pct_entrega_mismo_dia >= 60 ? 'amber' : 'red'}
                  icon={TrendingUp}
                />
              </div>
              {r.heatmap?.length > 0 && (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-gray-600 flex items-center gap-2">
                      <Calendar size={12} className="text-slate-400" />
                      Rendimiento por día de ruta
                    </p>
                    <p className="text-[10px] text-gray-400">Color = % entregado ese día · Texto = entregados / a-ruta</p>
                  </div>
                  <CalendarHeatmap data={r.heatmap} valueKey="pct_entrega" />
                </>
              )}
            </div>
          )}

          {/* ── Franjas Horarias ───────────────────────────────────────── */}
          {franjas && (
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Clock size={14} className="text-slate-400" />
                  Franjas horarias de entrega
                </p>
                <p className="text-[10px] text-gray-400">
                  Total con hora registrada: {fmtN((franjas.am?.n ?? 0) + (franjas.pm_ideal?.n ?? 0) + (franjas.pm_limite?.n ?? 0) + (franjas.pm_tarde?.n ?? 0) + (franjas.madrugada?.n ?? 0))} envíos
                </p>
              </div>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                {FRANJAS_CONFIG.map(f => {
                  const d = franjas[f.key] ?? { n: 0, pct: 0 }
                  return (
                    <div key={f.key} className="text-center">
                      <div className={`${f.color} text-white py-4 rounded-xl`}>
                        <div className="text-2xl font-black">{d.pct ?? 0}%</div>
                        <div className="text-[11px] opacity-90 mt-0.5">{fmtN(d.n)} envíos</div>
                      </div>
                      <p className="text-[10px] text-gray-600 mt-1.5 font-semibold">{f.label}</p>
                      <p className="text-[9px] text-gray-400">{f.sub}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Por Ruta ───────────────────────────────────────────────── */}
          {data.por_ruta?.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-700">Efectividad por fecha de ruta</p>
                <p className="text-[10px] text-gray-400">{data.por_ruta.length} rutas</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] text-gray-400 uppercase tracking-wide bg-gray-50 border-b border-gray-100">
                      <th className="px-4 py-2 text-left font-semibold">Ruta</th>
                      <th className="px-4 py-2 text-center font-semibold">A ruta</th>
                      <th className="px-4 py-2 text-center font-semibold">Entregados</th>
                      <th className="px-4 py-2 text-center font-semibold">% Efectividad</th>
                      <th className="px-4 py-2 text-center font-semibold">1er intento</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(showAllRoutes ? data.por_ruta : data.por_ruta.slice(0, 15)).map((row, i) => (
                      <tr key={i} className="hover:bg-gray-50 text-gray-700">
                        <td className="px-4 py-2.5 font-medium max-w-xs truncate" title={row.ruta}>{row.ruta}</td>
                        <td className="px-4 py-2.5 text-center text-gray-500">{fmtN(row.paquetes_a_ruta)}</td>
                        <td className="px-4 py-2.5 text-center text-gray-500">{fmtN(row.paquetes_entregados)}</td>
                        <td className={`px-4 py-2.5 text-center font-bold ${colorPct(row.pct_delivery_success, 90)}`}>{fmtPct(row.pct_delivery_success)}</td>
                        <td className={`px-4 py-2.5 text-center font-bold ${colorPct(row.pct_first_attempt, 85)}`}>{fmtPct(row.pct_first_attempt)}</td>
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
            Rango: {data.rango.inicio} → {data.rango.fin} · Efectividad = entregados / paquetes a ruta
          </p>
        </>
      )}
    </div>
  )
}
