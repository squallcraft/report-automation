import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api'
import toast from 'react-hot-toast'
import {
  Zap, TrendingUp, Truck, Package, Search, ChevronUp, ChevronDown,
  Download, Calendar, Target, CheckCircle2, AlertCircle, Clock,
} from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import MapaEntregas from '../../components/MapaEntregas'
import CalendarHeatmap from '../../components/CalendarHeatmap'

const now = new Date()

// ── Helpers de formato ─────────────────────────────────────────────────────
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

// ── Componentes auxiliares ─────────────────────────────────────────────────
function KPICard({ label, value, sub, accent = 'blue', icon: Icon, target, benchmark }) {
  const accentClasses = {
    blue:    'border-l-blue-500    text-blue-600   bg-blue-50/40',
    emerald: 'border-l-emerald-500 text-emerald-600 bg-emerald-50/40',
    amber:   'border-l-amber-500   text-amber-600  bg-amber-50/40',
    red:     'border-l-red-500     text-red-600    bg-red-50/40',
    indigo:  'border-l-indigo-500  text-indigo-600 bg-indigo-50/40',
    fuchsia: 'border-l-fuchsia-500 text-fuchsia-600 bg-fuchsia-50/40',
  }
  const cls = accentClasses[accent] || accentClasses.blue
  return (
    <div className={`bg-white rounded-xl p-4 shadow-sm border border-gray-100 border-l-4 ${cls.split(' ')[0]}`}>
      <div className="flex items-start justify-between">
        <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">{label}</p>
        {Icon && <Icon size={14} className={cls.split(' ')[1]} />}
      </div>
      <p className={`text-3xl font-black mt-1 ${cls.split(' ')[1]}`}>{value}</p>
      {(sub || target != null || benchmark != null) && (
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

function SortIcon({ col, sortState }) {
  if (sortState.col !== col) return <ChevronUp size={10} className="text-gray-300 ml-0.5" />
  return sortState.dir === 'asc'
    ? <ChevronUp size={10} className="text-blue-500 ml-0.5" />
    : <ChevronDown size={10} className="text-blue-500 ml-0.5" />
}

function SortableTh({ label, col, sortState, onSort, align = 'center' }) {
  return (
    <th
      onClick={() => onSort(col)}
      className={`px-3 py-2 font-semibold cursor-pointer select-none hover:bg-gray-100 transition-colors text-${align}`}
    >
      <span className={`flex items-center gap-0.5 ${align === 'center' ? 'justify-center' : ''}`}>
        {label}<SortIcon col={col} sortState={sortState} />
      </span>
    </th>
  )
}

function MiniSpark({ data = [], benchmark = 98 }) {
  if (!data.length) return <span className="text-[9px] text-gray-300">—</span>
  const max = Math.max(100, ...data)
  return (
    <div className="flex items-end gap-px h-5 w-14">
      {data.map((v, i) => {
        const h = Math.max(Math.round((v / max) * 100), v > 0 ? 8 : 0)
        const c = v >= benchmark ? 'bg-emerald-500' : v >= benchmark * 0.7 ? 'bg-amber-400' : 'bg-red-400'
        return <div key={i} className={`flex-1 rounded-sm ${c}`} style={{ height: `${h}%` }} title={`${v}%`} />
      })}
    </div>
  )
}

// ── Página principal ───────────────────────────────────────────────────────
export default function EfectividadEntregas() {
  const navigate = useNavigate()
  const [period, setPeriod] = useState({ mes: now.getMonth() + 1, anio: now.getFullYear() })
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  // Tabla por seller
  const [sellerSearch, setSellerSearch] = useState('')
  const [sellerSort, setSellerSort] = useState({ col: 'paquetes_a_ruta', dir: 'desc' })

  // Tabla por driver
  const [driverSearch, setDriverSearch] = useState('')
  const [driverSort, setDriverSort] = useState({ col: 'paquetes_a_ruta', dir: 'desc' })

  const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: d } = await api.get('/dashboard/efectividad-v2', {
        params: { mes: period.mes, anio: period.anio },
      })
      setData(d)
    } catch {
      toast.error('Error cargando dashboard de Same-Day')
    } finally {
      setLoading(false)
    }
  }, [period])
  useEffect(() => { load() }, [load])

  const sellersSorted = useMemo(() => {
    if (!data?.por_seller) return []
    const rows = data.por_seller.filter(s =>
      (s.nombre || '').toLowerCase().includes(sellerSearch.toLowerCase()),
    )
    return [...rows].sort((a, b) => {
      if (sellerSort.col === 'nombre') {
        const cmp = (a.nombre || '').localeCompare(b.nombre || '')
        return sellerSort.dir === 'asc' ? cmp : -cmp
      }
      const va = a[sellerSort.col] ?? -1
      const vb = b[sellerSort.col] ?? -1
      return sellerSort.dir === 'asc' ? va - vb : vb - va
    })
  }, [data?.por_seller, sellerSearch, sellerSort])

  const driversSorted = useMemo(() => {
    if (!data?.por_driver) return []
    const rows = data.por_driver.filter(d =>
      (d.nombre || '').toLowerCase().includes(driverSearch.toLowerCase()),
    )
    return [...rows].sort((a, b) => {
      if (driverSort.col === 'nombre') {
        const cmp = (a.nombre || '').localeCompare(b.nombre || '')
        return driverSort.dir === 'asc' ? cmp : -cmp
      }
      const va = a[driverSort.col] ?? -1
      const vb = b[driverSort.col] ?? -1
      return driverSort.dir === 'asc' ? va - vb : vb - va
    })
  }, [data?.por_driver, driverSearch, driverSort])

  const exportCSV = () => {
    if (!data) return
    const lines = [
      [`Periodo`, `${data.rango.inicio} a ${data.rango.fin}`],
      [],
      ['Driver', 'A ruta', 'Entregados', 'Same-day', '%SD', '%Success', '%FirstAttempt', 'Cancelados'],
      ...data.por_driver.map(d => [
        d.nombre, d.paquetes_a_ruta, d.paquetes_entregados, d.same_day,
        d.pct_same_day, d.pct_delivery_success, d.pct_first_attempt, d.cancelados,
      ]),
      [],
      ['Seller', 'A ruta', 'Entregados', 'Same-day', '%SD', '%Success', '%FirstAttempt', 'Cancelados'],
      ...data.por_seller.map(s => [
        s.nombre, s.paquetes_a_ruta, s.paquetes_entregados, s.same_day,
        s.pct_same_day, s.pct_delivery_success, s.pct_first_attempt, s.cancelados,
      ]),
    ]
    const csv = lines.map(r => Array.isArray(r) ? r.join(',') : '').join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `efectividad_v2_${period.mes}_${period.anio}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const g = data?.global
  const benchmark = data?.benchmark_promesa ?? 98

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        title="Efectividad de Entregas — Same-Day"
        subtitle="% de paquetes entregados el mismo día hábil en que el courier los retira"
        icon={Zap}
        accent="amber"
        actions={(
          <div className="flex items-center gap-3 flex-wrap">
            <select
              className="border border-slate-600 rounded-lg px-3 py-1.5 text-xs bg-slate-800 text-slate-200"
              value={`${period.mes}-${period.anio}`}
              onChange={e => { const [m, a] = e.target.value.split('-'); setPeriod({ mes: +m, anio: +a }) }}
            >
              {[now.getFullYear() - 1, now.getFullYear()].flatMap(anio =>
                Array.from({ length: 12 }, (_, i) => {
                  const mes = i + 1
                  return <option key={`${mes}-${anio}`} value={`${mes}-${anio}`}>{meses[i]} {anio}</option>
                }),
              )}
            </select>
            {data && (
              <button type="button" onClick={exportCSV}
                className="flex items-center gap-1.5 border border-slate-600 rounded-lg px-3 py-1.5 text-xs bg-slate-800 text-slate-200 hover:bg-slate-700 transition-colors">
                <Download size={13} /> Exportar CSV
              </button>
            )}
          </div>
        )}
      />

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Cargando dashboard…</div>
      ) : !data ? (
        <div className="text-center py-16 text-gray-400 text-sm">Sin datos</div>
      ) : (
        <>
          {/* ── KPIs principales ──────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KPICard
              label="Paquetes a ruta"
              value={fmtN(g.paquetes_a_ruta)}
              sub={`${g.intentos_totales} intentos`}
              accent="blue"
              icon={Package}
            />
            <KPICard
              label="Entregados"
              value={fmtN(g.paquetes_entregados)}
              sub={`de ${g.paquetes_a_ruta}`}
              accent="indigo"
              icon={CheckCircle2}
            />
            <KPICard
              label="% Same-Day"
              value={fmtPct(g.pct_same_day)}
              sub={`${g.same_day} envíos`}
              accent="emerald"
              icon={Zap}
              benchmark={benchmark}
            />
            <KPICard
              label="Success Rate"
              value={fmtPct(g.pct_delivery_success)}
              sub="entregados / a ruta"
              accent="emerald"
              icon={Target}
            />
            <KPICard
              label="First Attempt"
              value={fmtPct(g.pct_first_attempt)}
              sub="entregados al 1er intento"
              accent="fuchsia"
              icon={TrendingUp}
            />
            <KPICard
              label="Cancelados"
              value={fmtN(g.cancelados)}
              sub="excluidos del denominador"
              accent="red"
              icon={AlertCircle}
            />
          </div>

          {/* ── Distribución del ciclo ────────────────────────────────── */}
          {g.distribucion && (g.paquetes_a_ruta ?? 0) > 0 && (
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-semibold text-gray-700">Distribución del ciclo de entrega</p>
                <p className="text-[10px] text-gray-400">% sobre paquetes a ruta · suma 100%</p>
              </div>
              <div className="grid grid-cols-6 gap-2">
                {[
                  { lab: 'Mismo día', pct: g.distribucion.pct_0d, n: g.distribucion.n_0d, color: 'bg-emerald-500' },
                  { lab: '1 día',     pct: g.distribucion.pct_1d, n: g.distribucion.n_1d, color: 'bg-emerald-400' },
                  { lab: '2 días',    pct: g.distribucion.pct_2d, n: g.distribucion.n_2d, color: 'bg-amber-400' },
                  { lab: '3 días',    pct: g.distribucion.pct_3d, n: g.distribucion.n_3d, color: 'bg-orange-400' },
                  { lab: '+4 días',   pct: g.distribucion.pct_4plus, n: g.distribucion.n_4plus, color: 'bg-red-400' },
                  { lab: 'Sin entregar', pct: g.distribucion.pct_sin_entregar, n: g.distribucion.n_sin_entregar, color: 'bg-slate-400' },
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

          {/* ── Calendario diario de Same-Day ──────────────────────────── */}
          {data.serie_temporal?.length > 0 && (
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div>
                  <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <Calendar size={14} className="text-slate-400" />
                    Calendario diario · Same-Day
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {data.serie_temporal.length} días con datos · cada celda muestra <b>same-day / a-ruta</b>
                  </p>
                </div>
              </div>
              <CalendarHeatmap data={data.serie_temporal} />
            </div>
          )}

          {/* ── Mapa geográfico de entregas ────────────────────────────── */}
          <MapaEntregas mes={period.mes} anio={period.anio} height={520} />

          {/* ── Tabla por Driver ───────────────────────────────────────── */}
          {data.por_driver?.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  <Truck size={14} className="text-slate-400" />
                  <p className="text-sm font-semibold text-gray-700">Por Conductor</p>
                  <span className="text-[10px] text-gray-400">click para ver detalle</span>
                </div>
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Buscar conductor…"
                    value={driverSearch}
                    onChange={e => setDriverSearch(e.target.value)}
                    className="border border-gray-200 rounded-lg pl-7 pr-3 py-1.5 text-xs w-44 focus:outline-none focus:ring-1 focus:ring-blue-300"
                  />
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] text-gray-400 uppercase tracking-wide bg-gray-50 border-b border-gray-100">
                      <SortableTh label="Conductor" col="nombre" sortState={driverSort} onSort={(c) => setDriverSort(s => ({ col: c, dir: s.col === c && s.dir === 'desc' ? 'asc' : 'desc' }))} align="left" />
                      <SortableTh label="A ruta" col="paquetes_a_ruta" sortState={driverSort} onSort={(c) => setDriverSort(s => ({ col: c, dir: s.col === c && s.dir === 'desc' ? 'asc' : 'desc' }))} />
                      <SortableTh label="Entregados" col="paquetes_entregados" sortState={driverSort} onSort={(c) => setDriverSort(s => ({ col: c, dir: s.col === c && s.dir === 'desc' ? 'asc' : 'desc' }))} />
                      <SortableTh label="Same-Day" col="same_day" sortState={driverSort} onSort={(c) => setDriverSort(s => ({ col: c, dir: s.col === c && s.dir === 'desc' ? 'asc' : 'desc' }))} />
                      <SortableTh label="%SD" col="pct_same_day" sortState={driverSort} onSort={(c) => setDriverSort(s => ({ col: c, dir: s.col === c && s.dir === 'desc' ? 'asc' : 'desc' }))} />
                      <SortableTh label="%Success" col="pct_delivery_success" sortState={driverSort} onSort={(c) => setDriverSort(s => ({ col: c, dir: s.col === c && s.dir === 'desc' ? 'asc' : 'desc' }))} />
                      <SortableTh label="%1er Intento" col="pct_first_attempt" sortState={driverSort} onSort={(c) => setDriverSort(s => ({ col: c, dir: s.col === c && s.dir === 'desc' ? 'asc' : 'desc' }))} />
                      <SortableTh label="Cancel." col="cancelados" sortState={driverSort} onSort={(c) => setDriverSort(s => ({ col: c, dir: s.col === c && s.dir === 'desc' ? 'asc' : 'desc' }))} />
                      <th className="px-3 py-2 text-center font-semibold">Tendencia 7d</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {driversSorted.map((d) => (
                      <tr
                        key={d.driver_id ?? 'sin-driver'}
                        onClick={() => d.driver_id && navigate(`/admin/efectividad/driver/${d.driver_id}?mes=${period.mes}&anio=${period.anio}`)}
                        className={`text-gray-700 ${d.driver_id ? 'hover:bg-blue-50/40 cursor-pointer' : ''} transition-colors`}
                      >
                        <td className="px-3 py-2.5 font-medium">{d.nombre}</td>
                        <td className="px-3 py-2.5 text-center text-gray-500">{fmtN(d.paquetes_a_ruta)}</td>
                        <td className="px-3 py-2.5 text-center text-gray-500">{fmtN(d.paquetes_entregados)}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                            {d.paquetes_entregados}/{d.paquetes_a_ruta}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded font-bold text-[11px] ${ratioBg(d.pct_same_day)}`}>
                            {fmtPct(d.pct_same_day)}
                          </span>
                        </td>
                        <td className={`px-3 py-2.5 text-center font-bold ${colorPct(d.pct_delivery_success, 90)}`}>{fmtPct(d.pct_delivery_success)}</td>
                        <td className={`px-3 py-2.5 text-center font-bold ${colorPct(d.pct_first_attempt, 80)}`}>{fmtPct(d.pct_first_attempt)}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={(d.cancelados ?? 0) > 0 ? 'text-red-500 font-semibold' : 'text-gray-300'}>
                            {d.cancelados ?? 0}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex justify-center"><MiniSpark data={d.spark || []} benchmark={benchmark} /></div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Tabla por Seller ───────────────────────────────────────── */}
          {data.por_seller?.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  <Package size={14} className="text-slate-400" />
                  <p className="text-sm font-semibold text-gray-700">Por Seller</p>
                </div>
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Buscar seller…"
                    value={sellerSearch}
                    onChange={e => setSellerSearch(e.target.value)}
                    className="border border-gray-200 rounded-lg pl-7 pr-3 py-1.5 text-xs w-44 focus:outline-none focus:ring-1 focus:ring-blue-300"
                  />
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] text-gray-400 uppercase tracking-wide bg-gray-50 border-b border-gray-100">
                      <SortableTh label="Seller" col="nombre" sortState={sellerSort} onSort={(c) => setSellerSort(s => ({ col: c, dir: s.col === c && s.dir === 'desc' ? 'asc' : 'desc' }))} align="left" />
                      <SortableTh label="A ruta" col="paquetes_a_ruta" sortState={sellerSort} onSort={(c) => setSellerSort(s => ({ col: c, dir: s.col === c && s.dir === 'desc' ? 'asc' : 'desc' }))} />
                      <SortableTh label="Entregados" col="paquetes_entregados" sortState={sellerSort} onSort={(c) => setSellerSort(s => ({ col: c, dir: s.col === c && s.dir === 'desc' ? 'asc' : 'desc' }))} />
                      <SortableTh label="Same-Day" col="same_day" sortState={sellerSort} onSort={(c) => setSellerSort(s => ({ col: c, dir: s.col === c && s.dir === 'desc' ? 'asc' : 'desc' }))} />
                      <SortableTh label="%SD" col="pct_same_day" sortState={sellerSort} onSort={(c) => setSellerSort(s => ({ col: c, dir: s.col === c && s.dir === 'desc' ? 'asc' : 'desc' }))} />
                      <SortableTh label="%Success" col="pct_delivery_success" sortState={sellerSort} onSort={(c) => setSellerSort(s => ({ col: c, dir: s.col === c && s.dir === 'desc' ? 'asc' : 'desc' }))} />
                      <SortableTh label="%1er Intento" col="pct_first_attempt" sortState={sellerSort} onSort={(c) => setSellerSort(s => ({ col: c, dir: s.col === c && s.dir === 'desc' ? 'asc' : 'desc' }))} />
                      <SortableTh label="Cancel." col="cancelados" sortState={sellerSort} onSort={(c) => setSellerSort(s => ({ col: c, dir: s.col === c && s.dir === 'desc' ? 'asc' : 'desc' }))} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {sellersSorted.map(s => (
                      <tr
                        key={s.seller_id ?? s.nombre}
                        onClick={() => s.seller_id && navigate(`/admin/efectividad/seller/${s.seller_id}?mes=${period.mes}&anio=${period.anio}`)}
                        className={`text-gray-700 ${s.seller_id ? 'hover:bg-blue-50/40 cursor-pointer' : ''} transition-colors`}
                      >
                        <td className="px-3 py-2.5 font-medium">
                          {s.nombre}
                        </td>
                        <td className="px-3 py-2.5 text-center text-gray-500">{fmtN(s.paquetes_a_ruta)}</td>
                        <td className="px-3 py-2.5 text-center text-gray-500">{fmtN(s.paquetes_entregados)}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                            {s.paquetes_entregados}/{s.paquetes_a_ruta}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded font-bold text-[11px] ${ratioBg(s.pct_same_day)}`}>
                            {fmtPct(s.pct_same_day)}
                          </span>
                        </td>
                        <td className={`px-3 py-2.5 text-center font-bold ${colorPct(s.pct_delivery_success, 90)}`}>{fmtPct(s.pct_delivery_success)}</td>
                        <td className={`px-3 py-2.5 text-center font-bold ${colorPct(s.pct_first_attempt, 80)}`}>{fmtPct(s.pct_first_attempt)}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={(s.cancelados ?? 0) > 0 ? 'text-red-500 font-semibold' : 'text-gray-300'}>
                            {s.cancelados ?? 0}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(g?.paquetes_a_ruta ?? 0) === 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
              <Clock size={20} className="text-amber-500 mx-auto mb-2" />
              <p className="text-sm font-semibold text-amber-800">Sin datos de Same-Day en este período</p>
              <p className="text-xs text-amber-600 mt-1">
                El universo se calcula sobre <code>asignacion_ruta</code> (TrackingTech).
                Si todavía no corriste la ingesta para este período, hazlo desde
                <b> Asignaciones de Ruta → Ingestar rango ahora</b>.
              </p>
            </div>
          )}

          <p className="text-[10px] text-gray-400 text-center">
            Rango: {data.rango.inicio} → {data.rango.fin} · Same-Day = 0 días hábiles entre <code>fecha_retiro</code> y <code>fecha_entrega</code>
          </p>
        </>
      )}
    </div>
  )
}
