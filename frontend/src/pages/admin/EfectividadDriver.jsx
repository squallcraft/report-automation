import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import api from '../../api'
import toast from 'react-hot-toast'
import {
  ArrowLeft, Target, CheckCircle2, AlertCircle, Package,
  TrendingUp, Truck, Calendar, Clock, Star, ChevronUp, ChevronDown,
} from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import CalendarHeatmap from '../../components/CalendarHeatmap'
import DateRangePicker, { toIsoLocal } from '../../components/DateRangePicker'
import ComparisonBars from '../../components/ComparisonBars'

function useSortable(data, defaultKey, defaultDir = 'desc') {
  const [sort, setSort] = useState({ key: defaultKey, dir: defaultDir })
  const sorted = useMemo(() => {
    if (!data?.length || !sort.key) return data ?? []
    return [...data].sort((a, b) => {
      const va = a[sort.key] ?? ''
      const vb = b[sort.key] ?? ''
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [data, sort])
  const toggle = (key) => setSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))
  return [sorted, sort, toggle]
}

function SortTh({ label, sortKey, sort, onToggle, className = '' }) {
  const active = sort.key === sortKey
  return (
    <th
      className={`px-4 py-2 cursor-pointer select-none hover:text-gray-600 transition-colors ${className}`}
      onClick={() => onToggle(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active
          ? sort.dir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />
          : <ChevronDown size={10} className="opacity-20" />}
      </span>
    </th>
  )
}

const now = new Date()
const parseIso = s => {
  if (!s) return null
  const [y, m, d] = s.split('-').map(Number)
  return (y && m && d) ? new Date(y, m - 1, d) : null
}
const fmtPct = v => v != null ? `${v}%` : '—'
const fmtN   = v => v != null ? v.toLocaleString('es-CL') : '—'
const fmtDate = s => {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}
const colorPct = (v, good = 90, mid = 75) => {
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

const FRANJAS_CONFIG = [
  { key: 'am_mañana',  label: 'Mañana',      sub: '08:00–12:00', color: 'bg-sky-300' },
  { key: 'am_tarde',   label: 'Mediodía',    sub: '12:00–15:00', color: 'bg-blue-500' },
  { key: 'pm_inicio',  label: '15–16 h',     sub: '15:00–16:00', color: 'bg-indigo-500' },
  { key: 'pm_ideal',   label: 'PM Ideal ★',  sub: '16:00–21:00', color: 'bg-emerald-500' },
  { key: 'pm_limite',  label: 'PM Límite',   sub: '21:00–22:00', color: 'bg-amber-400' },
  { key: 'pm_tarde',   label: 'PM Tarde',    sub: '22:00+',      color: 'bg-red-500' },
  { key: 'madrugada',  label: 'Madrugada',   sub: '00:00–08:00', color: 'bg-purple-500' },
  { key: 'sin_hora',   label: 'Sin hora',    sub: 'Sin registro', color: 'bg-gray-300' },
]

const AGRUPACIONES = [
  { key: 'dia',    label: 'Por día' },
  { key: 'semana', label: 'Por semana' },
  { key: 'mes',    label: 'Por mes' },
  { key: 'ruta',   label: 'Por ruta' },
]

function KPICard({ label, value, sub, accent = 'blue', icon: Icon }) {
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
      {sub && <p className="text-xs text-gray-400 mt-1.5">{sub}</p>}
    </div>
  )
}

function FranjasBlocks({ data, onFranjaClick, activeFranja }) {
  if (!data) return null
  const totalConHora = FRANJAS_CONFIG.filter(f => f.key !== 'sin_hora')
    .reduce((s, f) => s + (data[f.key]?.n ?? 0), 0)
  return (
    <div className="grid grid-cols-4 md:grid-cols-8 gap-3">
      {FRANJAS_CONFIG.map(f => {
        const d = data[f.key] ?? { n: 0, pct: 0 }
        const isActive = activeFranja === f.key
        const isClickable = !!onFranjaClick && f.key !== 'sin_hora'
        return (
          <div key={f.key}
            className={`text-center ${isClickable ? 'cursor-pointer' : ''}`}
            onClick={isClickable ? () => onFranjaClick(isActive ? null : f.key) : undefined}
          >
            <div className={`${f.color} text-white py-4 rounded-xl transition-opacity ${isClickable ? 'hover:opacity-85' : ''} ${isActive ? 'ring-2 ring-offset-1 ring-gray-700' : ''}`}>
              <div className="text-2xl font-black">{d.pct ?? 0}%</div>
              <div className="text-[11px] opacity-90 mt-0.5">{fmtN(d.n)}</div>
            </div>
            <p className="text-[10px] text-gray-600 mt-1.5 font-semibold">{f.label}</p>
            <p className="text-[9px] text-gray-400">{f.sub}</p>
          </div>
        )
      })}
    </div>
  )
}

function FranjasTable({ rows, agrupacion }) {
  const [sort, setSort] = useState({ key: 'label', dir: 'asc' })
  const sorted = useMemo(() => {
    if (!rows?.length) return []
    return [...rows].sort((a, b) => {
      const va = a[sort.key] ?? ''
      const vb = b[sort.key] ?? ''
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [rows, sort])
  const toggle = (key) => setSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))
  const Th = ({ label, sKey, className = '' }) => {
    const active = sort.key === sKey
    return (
      <th className={`px-4 py-2 cursor-pointer select-none hover:text-gray-600 transition-colors ${className}`} onClick={() => toggle(sKey)}>
        <span className="inline-flex items-center gap-1">
          {label}
          {active ? sort.dir === 'asc' ? <ChevronUp size={9} /> : <ChevronDown size={9} /> : <ChevronDown size={9} className="opacity-20" />}
        </span>
      </th>
    )
  }
  if (!rows?.length) return <p className="text-sm text-gray-400 text-center py-8">Sin datos</p>
  const labelCol = agrupacion === 'ruta' ? 'Ruta' : agrupacion === 'dia' ? 'Fecha' : agrupacion === 'semana' ? 'Semana' : 'Mes'
  return (
    <div className="overflow-x-auto max-h-72">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-gray-50">
          <tr className="text-[10px] text-gray-400 uppercase border-b border-gray-100">
            <Th label={labelCol} sKey="label" className="text-left" />
            <Th label="Total" sKey="total" className="text-center" />
            {FRANJAS_CONFIG.map(f => <th key={f.key} className="px-3 py-2 text-center">{f.label}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {sorted.map((row, i) => (
            <tr key={i} className="hover:bg-gray-50 text-gray-700">
              <td className="px-4 py-2 font-medium max-w-[180px] truncate" title={row.label}>{row.label}</td>
              <td className="px-4 py-2 text-center text-gray-500">{fmtN(row.total)}</td>
              {FRANJAS_CONFIG.map(f => (
                <td key={f.key} className="px-3 py-2 text-center">
                  <span className={`text-[10px] font-bold ${(row[`pct_${f.key}`] ?? 0) > 0 ? 'text-gray-700' : 'text-gray-300'}`}>
                    {row[`pct_${f.key}`] ?? 0}%
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function EfectividadDriver() {
  const { driverId } = useParams()
  const navigate     = useNavigate()
  const [searchParams] = useSearchParams()

  const initRange = useMemo(() => {
    const fi = parseIso(searchParams.get('fecha_inicio'))
    const ff = parseIso(searchParams.get('fecha_fin'))
    if (fi && ff) return { inicio: fi, fin: ff }
    const m = searchParams.get('mes')  ? +searchParams.get('mes')  : now.getMonth() + 1
    const a = searchParams.get('anio') ? +searchParams.get('anio') : now.getFullYear()
    return { inicio: new Date(a, m - 1, 1), fin: new Date(a, m, 0) }
  }, [searchParams])

  const [range,     setRange]     = useState(initRange)
  const [data,      setData]      = useState(null)
  const [comp,      setComp]      = useState(null)
  const [franjasAg, setFranjasAg] = useState({ dia: null, semana: null, mes: null, ruta: null })
  const [loading,   setLoading]   = useState(true)
  const [compLoad,  setCompLoad]  = useState(true)
  const [activeTab, setActiveTab] = useState('dia')
  const [tabLoaded, setTabLoaded] = useState({ dia: false, semana: false, mes: false, ruta: false })
  const [showAllRoutes, setShowAllRoutes] = useState(false)
  const [selectedFranja, setSelectedFranja] = useState(null)
  const [horaDetail,     setHoraDetail]     = useState(null)
  const [horaDetailLoad, setHoraDetailLoad] = useState(false)
  const [driversList,    setDriversList]    = useState([])

  useEffect(() => {
    api.get('/drivers').then(r => setDriversList(r.data.filter(d => d.activo))).catch(() => {})
  }, [])

  const fi = useMemo(() => range.inicio ? toIsoLocal(range.inicio) : null, [range.inicio])
  const ff = useMemo(() => range.fin    ? toIsoLocal(range.fin)    : null, [range.fin])

  // Main data + franja global del conductor
  const load = useCallback(async () => {
    if (!fi || !ff) return
    setLoading(true)
    setTabLoaded({ dia: false, semana: false, mes: false, ruta: false })
    try {
      const params = { fecha_inicio: fi, fecha_fin: ff }
      const [{ data: d }, { data: f }] = await Promise.all([
        api.get(`/dashboard/efectividad-v2/driver/${driverId}`, { params }),
        api.get('/dashboard/franjas-horarias', { params: { ...params, driver_id: driverId, agrupacion: 'global' } }),
      ])
      setData(d)
      setFranjasAg(prev => ({ ...prev, _global: f?.global ?? null }))
    } catch {
      toast.error('Error cargando datos del conductor')
    } finally {
      setLoading(false)
    }
  }, [driverId, fi, ff])

  // Comparación (zona/global) — llamada independiente, más lenta
  const loadComp = useCallback(async () => {
    if (!fi || !ff) return
    setCompLoad(true)
    try {
      const { data: c } = await api.get(
        `/dashboard/efectividad-v2/driver/${driverId}/comparacion`,
        { params: { fecha_inicio: fi, fecha_fin: ff } }
      )
      setComp(c)
    } catch {
      // No bloquea el resto de la página
    } finally {
      setCompLoad(false)
    }
  }, [driverId, fi, ff])

  useEffect(() => { load(); loadComp() }, [load, loadComp])

  // Franjas por agrupación — lazy load al cambiar de tab
  const loadFranjasTab = useCallback(async (ag) => {
    if (!fi || !ff || tabLoaded[ag]) return
    try {
      const { data: f } = await api.get('/dashboard/franjas-horarias', {
        params: { fecha_inicio: fi, fecha_fin: ff, driver_id: driverId, agrupacion: ag },
      })
      setFranjasAg(prev => ({ ...prev, [ag]: f?.rows ?? [] }))
      setTabLoaded(prev => ({ ...prev, [ag]: true }))
    } catch { /* silent */ }
  }, [driverId, fi, ff, tabLoaded])

  useEffect(() => { loadFranjasTab(activeTab) }, [activeTab, loadFranjasTab])

  // Hour drill-down — load per-hour data when a franja is selected
  useEffect(() => {
    if (!selectedFranja || !fi || !ff) { setHoraDetail(null); return }
    setHoraDetailLoad(true)
    api.get('/dashboard/franjas-horarias', {
      params: { fecha_inicio: fi, fecha_fin: ff, driver_id: driverId, agrupacion: 'hora', franja: selectedFranja },
    })
      .then(r => setHoraDetail(r.data))
      .catch(() => setHoraDetail(null))
      .finally(() => setHoraDetailLoad(false))
  }, [selectedFranja, driverId, fi, ff])

  const k = data?.kpis
  const r = data?.rendimiento

  const [rutasSorted, rutasSort, rutasToggle] = useSortable(data?.por_ruta ?? [], 'route_date', 'desc')
  const [pendSorted,  pendSort,  pendToggle]  = useSortable(data?.no_entregados ?? [], 'fecha_retiro', 'desc')

  // Heatmap para "Calendario de rendimiento por día de ruta" (en la sección rendimiento)
  // El "Calendario de actividad" fue eliminado — solo se mantiene el de rendimiento (r.heatmap)

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
            title={loading ? 'Cargando…' : (data?.nombre || `Conductor #${driverId}`)}
            subtitle={
              <span className="flex items-center gap-3 flex-wrap">
                <span>Efectividad de entregas por período</span>
                {comp?.zona && (
                  <span className="inline-flex items-center gap-1 text-[11px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-semibold">
                    <Truck size={10} /> {comp.zona}
                  </span>
                )}
                {comp?.seniority_desde && (
                  <span className="inline-flex items-center gap-1 text-[11px] bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full font-semibold">
                    <Star size={10} /> Desde {fmtDate(comp.seniority_desde)}
                  </span>
                )}
              </span>
            }
            icon={Truck}
            accent="emerald"
            actions={
              <div className="flex items-center gap-2 flex-wrap">
                {driversList.length > 0 && (
                  <select
                    value={driverId}
                    onChange={e => navigate(`/admin/efectividad/driver/${e.target.value}?fecha_inicio=${fi}&fecha_fin=${ff}`)}
                    className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 max-w-[180px] truncate"
                  >
                    {driversList.map(d => (
                      <option key={d.id} value={String(d.id)}>{d.nombre}</option>
                    ))}
                  </select>
                )}
                <DateRangePicker value={range} onChange={setRange} />
              </div>
            }
          />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Cargando métricas…</div>
      ) : !k ? (
        <div className="text-center py-16 text-gray-400 text-sm">Sin datos para este período</div>
      ) : (
        <>
          {/* ── KPIs propios ──────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPICard label="Paquetes a ruta"  value={fmtN(k.paquetes_a_ruta)}        sub={`${k.intentos_totales} intentos`}    accent="blue"    icon={Package} />
            <KPICard label="Entregados"        value={fmtN(k.paquetes_entregados)}    sub={`de ${k.paquetes_a_ruta} asignados`} accent="indigo"  icon={CheckCircle2} />
            <KPICard label="% Efectividad"     value={fmtPct(k.pct_delivery_success)} sub="entregados / a ruta"                 accent="emerald" icon={Target} />
            <KPICard label="% Primer intento"  value={fmtPct(k.pct_first_attempt)}   sub="entregado al 1er intento"            accent="fuchsia" icon={TrendingUp} />
          </div>

          {/* ── Comparación zona / global ─────────────────────────────── */}
          <ComparisonBars data={comp} zona={comp?.zona} loading={compLoad} />

          {/* ── Rendimiento operativo (route_date) ──────────────────────── */}
          {r && r.paquetes_a_ruta > 0 && (
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 space-y-4">
              <div>
                <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Truck size={14} className="text-indigo-500" />
                  Rendimiento operativo
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  ¿Cuántos paquetes entregó el mismo día que salió a ruta? · base: fecha de ruta
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <KPICard label="A ruta (route_date)"  value={fmtN(r.paquetes_a_ruta)}      sub="paquetes con fecha de ruta"        accent="indigo"  icon={Package} />
                <KPICard label="Entregados mismo día" value={fmtN(r.paquetes_entregados)}  sub={`${r.paquetes_sin_entregar} no entregados`} accent="emerald" icon={CheckCircle2} />
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
                  <p className="text-xs font-semibold text-gray-600 flex items-center gap-2">
                    <Calendar size={12} className="text-slate-400" />
                    Calendario de rendimiento por día de ruta
                    <span className="ml-auto text-[10px] text-gray-400 font-normal">Color = % entregado ese día</span>
                  </p>
                  <CalendarHeatmap data={r.heatmap} valueKey="pct_entrega" />
                </>
              )}
            </div>
          )}

          {/* ── Franjas horarias ─────────────────────────────────────── */}
          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Clock size={14} className="text-slate-400" />
                Franjas horarias de entrega
              </p>
            </div>

            {/* Bloques globales del conductor — clic para ver detalle por hora */}
            <FranjasBlocks
              data={franjasAg._global}
              onFranjaClick={setSelectedFranja}
              activeFranja={selectedFranja}
            />

            {/* Hour drill-down panel */}
            {selectedFranja && (
              <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                    <Clock size={12} className="text-slate-400" />
                    Detalle por hora — {FRANJAS_CONFIG.find(f => f.key === selectedFranja)?.label}
                  </p>
                  <button
                    onClick={() => setSelectedFranja(null)}
                    className="text-[11px] text-gray-400 hover:text-gray-600 px-2 py-0.5 rounded hover:bg-gray-200 transition"
                  >
                    Cerrar ×
                  </button>
                </div>
                {horaDetailLoad ? (
                  <div className="flex justify-center py-5">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-emerald-500" />
                  </div>
                ) : horaDetail?.rows?.length ? (
                  <div className="flex items-end gap-1.5 h-20">
                    {(() => {
                      const maxN = Math.max(...horaDetail.rows.map(r => r.total))
                      const fc = FRANJAS_CONFIG.find(f => f.key === selectedFranja)
                      return horaDetail.rows.map(row => {
                        const barH = maxN > 0 ? Math.max(4, Math.round((row.total / maxN) * 72)) : 4
                        return (
                          <div key={row.key} className="flex-1 flex flex-col items-center justify-end">
                            <span className="text-[9px] text-gray-500 mb-0.5">{row.total}</span>
                            <div
                              className={`w-full rounded-t-sm ${fc?.color ?? 'bg-emerald-400'} opacity-80`}
                              style={{ height: `${barH}px` }}
                            />
                            <span className="text-[9px] text-gray-400 mt-0.5">{row.key}h</span>
                          </div>
                        )
                      })
                    })()}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 text-center py-4">Sin datos para esta franja</p>
                )}
              </div>
            )}

            {/* Tabs detalle */}
            <div>
              <div className="flex gap-1 border-b border-gray-100 mb-3">
                {AGRUPACIONES.map(ag => (
                  <button
                    key={ag.key}
                    onClick={() => setActiveTab(ag.key)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-t-lg transition-colors ${
                      activeTab === ag.key
                        ? 'bg-white border border-b-white border-gray-100 -mb-px text-blue-600'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {ag.label}
                  </button>
                ))}
              </div>
              <FranjasTable rows={franjasAg[activeTab]} agrupacion={activeTab} />
            </div>
          </div>

          {/* ── Por ruta ──────────────────────────────────────────────── */}
          {data.por_ruta?.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-700">Efectividad por ruta</p>
                <p className="text-[10px] text-gray-400">{data.por_ruta.length} rutas</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] text-gray-400 uppercase bg-gray-50 border-b border-gray-100">
                      <SortTh label="Ruta" sortKey="ruta" sort={rutasSort} onToggle={rutasToggle} className="text-left" />
                      <SortTh label="Fecha" sortKey="route_date" sort={rutasSort} onToggle={rutasToggle} className="text-center" />
                      <SortTh label="A ruta" sortKey="paquetes_a_ruta" sort={rutasSort} onToggle={rutasToggle} className="text-center" />
                      <SortTh label="Entregados" sortKey="paquetes_entregados" sort={rutasSort} onToggle={rutasToggle} className="text-center" />
                      <SortTh label="% Efectividad" sortKey="pct_delivery_success" sort={rutasSort} onToggle={rutasToggle} className="text-center" />
                      <SortTh label="% 1er Intento" sortKey="pct_first_attempt" sort={rutasSort} onToggle={rutasToggle} className="text-center" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(showAllRoutes ? rutasSorted : rutasSorted.slice(0, 15)).map((row, i) => (
                      <tr key={i} className="hover:bg-gray-50 text-gray-700">
                        <td className="px-4 py-2.5 font-medium max-w-xs truncate" title={row.ruta}>{row.ruta}</td>
                        <td className="px-4 py-2.5 text-center text-gray-400">{row.route_date ? fmtDate(row.route_date) : '—'}</td>
                        <td className="px-4 py-2.5 text-center text-gray-500">{fmtN(row.paquetes_a_ruta)}</td>
                        <td className="px-4 py-2.5 text-center text-gray-500">{fmtN(row.paquetes_entregados)}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded font-bold text-[11px] ${ratioBg(row.pct_delivery_success)}`}>
                            {fmtPct(row.pct_delivery_success)}
                          </span>
                        </td>
                        <td className={`px-4 py-2.5 text-center font-bold ${colorPct(row.pct_first_attempt, 85, 70)}`}>
                          {fmtPct(row.pct_first_attempt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.por_ruta.length > 15 && (
                <div className="px-5 py-2 border-t border-gray-100 text-center">
                  <button onClick={() => setShowAllRoutes(s => !s)} className="text-xs text-blue-500 hover:text-blue-700 font-semibold">
                    {showAllRoutes ? 'Ver menos' : `Ver todas (${data.por_ruta.length})`}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Pendientes de entrega ─────────────────────────────────── */}
          {data.no_entregados?.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
                <AlertCircle size={14} className="text-amber-500" />
                <p className="text-sm font-semibold text-gray-700">Pendientes de entrega</p>
                <span className="ml-auto text-xs text-gray-400">
                  {data.no_entregados.length} de {data.no_entregados_total}
                </span>
              </div>
              <div className="overflow-x-auto max-h-80">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr className="text-[10px] text-gray-400 uppercase border-b border-gray-100">
                      <SortTh label="Tracking" sortKey="tracking_id" sort={pendSort} onToggle={pendToggle} className="text-left" />
                      <SortTh label="Fecha retiro" sortKey="fecha_retiro" sort={pendSort} onToggle={pendToggle} className="text-left" />
                      <SortTh label="Intento" sortKey="intento_nro" sort={pendSort} onToggle={pendToggle} className="text-center" />
                      <SortTh label="Ruta" sortKey="ruta_nombre" sort={pendSort} onToggle={pendToggle} className="text-left" />
                      <SortTh label="Seller" sortKey="seller" sort={pendSort} onToggle={pendToggle} className="text-left" />
                      <SortTh label="Comuna" sortKey="comuna" sort={pendSort} onToggle={pendToggle} className="text-left" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {pendSorted.map((n, i) => (
                      <tr key={i} className="hover:bg-gray-50 text-gray-700">
                        <td className="px-4 py-2.5 font-mono text-blue-600 text-[10px]">{n.tracking_id}</td>
                        <td className="px-4 py-2.5 text-gray-500">{n.fecha_retiro || '—'}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className="text-[10px] font-bold bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded">#{n.intento_nro}</span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-600 max-w-[180px] truncate">{n.ruta_nombre || '—'}</td>
                        <td className="px-4 py-2.5 text-gray-600 max-w-[120px] truncate">{n.seller || n.seller_code || '—'}</td>
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
