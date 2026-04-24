import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api'
import toast from 'react-hot-toast'
import {
  Zap, Target, CheckCircle2, AlertCircle, Package,
  TrendingUp, Truck, Search, ArrowRight, Clock,
} from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import CalendarHeatmap from '../../components/CalendarHeatmap'
import DateRangePicker, { toIsoLocal } from '../../components/DateRangePicker'

const now = new Date()
const fmtPct  = v => v != null ? `${v}%` : '—'
const fmtN    = v => v != null ? v.toLocaleString('es-CL') : '—'

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

const FRANJAS_CONFIG = [
  { key: 'am_mañana',  label: 'Mañana',      sub: '08:00–12:00', color: 'bg-sky-300',     ring: 'ring-sky-200' },
  { key: 'am_tarde',   label: 'Mediodía',    sub: '12:00–15:00', color: 'bg-blue-500',    ring: 'ring-blue-200' },
  { key: 'pm_inicio',  label: '15–16 h',     sub: '15:00–16:00', color: 'bg-indigo-500',  ring: 'ring-indigo-200' },
  { key: 'pm_ideal',   label: 'PM Ideal ★',  sub: '16:00–21:00', color: 'bg-emerald-500', ring: 'ring-emerald-200' },
  { key: 'pm_limite',  label: 'PM Límite',   sub: '21:00–22:00', color: 'bg-amber-400',   ring: 'ring-amber-200' },
  { key: 'pm_tarde',   label: 'PM Tarde',    sub: '22:00+',      color: 'bg-red-500',     ring: 'ring-red-200' },
  { key: 'madrugada',  label: 'Madrugada',   sub: '00:00–08:00', color: 'bg-purple-500',  ring: 'ring-purple-200' },
  { key: 'sin_hora',   label: 'Sin hora',    sub: 'Sin registro', color: 'bg-gray-300',   ring: 'ring-gray-200' },
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

function useSearch(list, keys) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    if (!q.trim()) return list
    const lq = q.toLowerCase()
    return list.filter(row => keys.some(k => String(row[k] ?? '').toLowerCase().includes(lq)))
  }, [list, q, keys])
  return [q, setQ, filtered]
}

export default function EfectividadEntregas() {
  const navigate = useNavigate()
  const [range, setRange] = useState({
    inicio: new Date(now.getFullYear(), now.getMonth(), 1),
    fin:    new Date(now.getFullYear(), now.getMonth() + 1, 0),
  })
  const [data,    setData]    = useState(null)
  const [franjas, setFranjas] = useState(null)
  const [loading, setLoading] = useState(true)

  const fi = useMemo(() => range.inicio ? toIsoLocal(range.inicio) : null, [range.inicio])
  const ff = useMemo(() => range.fin    ? toIsoLocal(range.fin)    : null, [range.fin])

  const load = useCallback(async () => {
    if (!fi || !ff) return
    setLoading(true)
    try {
      const params = { fecha_inicio: fi, fecha_fin: ff }
      const [{ data: d }, { data: f }] = await Promise.all([
        api.get('/dashboard/efectividad-v2', { params }),
        api.get('/dashboard/franjas-horarias', { params: { ...params, agrupacion: 'global' } }),
      ])
      setData(d)
      setFranjas(f?.global ?? null)
    } catch {
      toast.error('Error cargando efectividad')
    } finally {
      setLoading(false)
    }
  }, [fi, ff])
  useEffect(() => { load() }, [load])

  const g = data?.global

  // Driver list enriched with franjas data (from por_driver)
  const drivers = useMemo(() => (data?.por_driver ?? []).filter(d => d.driver_id), [data])
  const sellers = useMemo(() => (data?.por_seller ?? []).filter(s => s.seller_id), [data])

  // Top 5 by efectividad (min 5 paquetes)
  const topEfectividad = useMemo(() =>
    [...drivers].filter(d => d.paquetes_a_ruta >= 5)
      .sort((a, b) => (b.pct_delivery_success ?? 0) - (a.pct_delivery_success ?? 0))
      .slice(0, 5),
    [drivers])

  // Top 5 by PM Ideal — we get it from driver franjas (we'll need agrupacion=driver)
  // For now use pct_same_day as a proxy until franjas-by-driver is loaded lazily
  const topSameDay = useMemo(() =>
    [...sellers].filter(s => s.paquetes_a_ruta >= 5)
      .sort((a, b) => (b.pct_same_day ?? 0) - (a.pct_same_day ?? 0))
      .slice(0, 5),
    [sellers])

  const [driverQ, setDriverQ, filteredDrivers] = useSearch(drivers, ['nombre'])
  const [sellerQ, setSellerQ, filteredSellers] = useSearch(sellers, ['nombre'])

  const [showAllDrivers, setShowAllDrivers] = useState(false)
  const [showAllSellers, setShowAllSellers] = useState(false)
  const visDrivers = showAllDrivers ? filteredDrivers : filteredDrivers.slice(0, 10)
  const visSellers = showAllSellers ? filteredSellers : filteredSellers.slice(0, 10)

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        title="Efectividad Operacional"
        subtitle="Same-Day · Rendimiento de conductores · SLA sellers"
        icon={Zap}
        accent="emerald"
        actions={<DateRangePicker value={range} onChange={setRange} />}
      />

      {/* ── KPIs globales ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <KPICard label="% Same-Day" value={loading ? '…' : fmtPct(g?.pct_same_day)} sub={`${fmtN(g?.same_day)} envíos`} accent="emerald" icon={Zap} benchmark={98} />
        <KPICard label="% Efectividad" value={loading ? '…' : fmtPct(g?.pct_delivery_success)} sub="entregados / a ruta" accent="indigo" icon={Target} />
        <KPICard label="% Primer Intento" value={loading ? '…' : fmtPct(g?.pct_first_attempt)} sub="1er intento exitoso" accent="fuchsia" icon={TrendingUp} />
        <KPICard label="Paquetes a ruta" value={loading ? '…' : fmtN(g?.paquetes_a_ruta)} sub={`${fmtN(g?.intentos_totales)} intentos`} accent="blue" icon={Package} />
        <KPICard label="Cancelados" value={loading ? '…' : fmtN(g?.cancelados)} sub="excluidos del denom." accent="red" icon={AlertCircle} />
      </div>

      {/* ── Distribución del ciclo ─────────────────────────────────────── */}
      {g?.distribucion && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-gray-700">Distribución del ciclo de entrega · operación global</p>
            <p className="text-[10px] text-gray-400">% sobre paquetes a ruta</p>
          </div>
          <div className="grid grid-cols-6 gap-2">
            {[
              { lab: 'Mismo día', pct: g.distribucion.pct_0d,           n: g.distribucion.n_0d,           color: 'bg-emerald-500' },
              { lab: '1 día',     pct: g.distribucion.pct_1d,           n: g.distribucion.n_1d,           color: 'bg-emerald-400' },
              { lab: '2 días',    pct: g.distribucion.pct_2d,           n: g.distribucion.n_2d,           color: 'bg-amber-400' },
              { lab: '3 días',    pct: g.distribucion.pct_3d,           n: g.distribucion.n_3d,           color: 'bg-orange-400' },
              { lab: '+4 días',   pct: g.distribucion.pct_4plus,        n: g.distribucion.n_4plus,        color: 'bg-red-400' },
              { lab: 'Sin entregar', pct: g.distribucion.pct_sin_entregar, n: g.distribucion.n_sin_entregar, color: 'bg-slate-400' },
            ].map(b => (
              <div key={b.lab} className="text-center">
                <div className={`${b.color} text-white py-3 rounded-xl`}>
                  <div className="text-2xl font-black">{b.pct}%</div>
                  <div className="text-[10px] opacity-90">{fmtN(b.n)}</div>
                </div>
                <p className="text-[10px] text-gray-500 mt-1.5 font-semibold">{b.lab}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Calendario heatmap ─────────────────────────────────────────── */}
      {data?.serie_temporal?.length > 0 && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-gray-700">Calendario Same-Day diario</p>
            <p className="text-[10px] text-gray-400">Color = % Same-Day · Texto = entregados / a-ruta</p>
          </div>
          <CalendarHeatmap data={data.serie_temporal} />
        </div>
      )}

      {/* ── Franjas horarias globales ──────────────────────────────────── */}
      {franjas && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Clock size={14} className="text-slate-400" />
              Franjas horarias · operación global
            </p>
            <p className="text-[10px] text-gray-400">Total: {fmtN(franjas.total)} entregas con hora registrada</p>
          </div>
          <div className="grid grid-cols-4 md:grid-cols-8 gap-3">
            {FRANJAS_CONFIG.map(f => {
              const d = franjas[f.key] ?? { n: 0, pct: 0 }
              return (
                <div key={f.key} className="text-center">
                  <div className={`${f.color} text-white py-4 rounded-xl ring-2 ${f.ring}`}>
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

      {/* ── Top Rankings ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Top conductores por efectividad */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
            <TrendingUp size={14} className="text-emerald-500" />
            <p className="text-sm font-semibold text-gray-700">Top conductores · efectividad</p>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-gray-400 uppercase bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-2 text-left">#</th>
                <th className="px-4 py-2 text-left">Conductor</th>
                <th className="px-4 py-2 text-center">Entregados</th>
                <th className="px-4 py-2 text-center">% Efectividad</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {topEfectividad.map((d, i) => (
                <tr
                  key={d.driver_id}
                  onClick={() => navigate(`/admin/efectividad/driver/${d.driver_id}?fecha_inicio=${fi}&fecha_fin=${ff}`)}
                  className="hover:bg-blue-50/40 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-2.5 text-gray-400 font-bold">#{i + 1}</td>
                  <td className="px-4 py-2.5 font-medium text-gray-800">{d.nombre}</td>
                  <td className="px-4 py-2.5 text-center text-gray-500">{fmtN(d.paquetes_entregados)}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded font-bold text-[11px] ${ratioBg(d.pct_delivery_success)}`}>
                      {fmtPct(d.pct_delivery_success)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Top sellers por Same-Day */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
            <Zap size={14} className="text-indigo-500" />
            <p className="text-sm font-semibold text-gray-700">Top sellers · % Same-Day</p>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-gray-400 uppercase bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-2 text-left">#</th>
                <th className="px-4 py-2 text-left">Seller</th>
                <th className="px-4 py-2 text-center">A ruta</th>
                <th className="px-4 py-2 text-center">% Same-Day</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {topSameDay.map((s, i) => (
                <tr
                  key={s.seller_id}
                  onClick={() => navigate(`/admin/efectividad/seller/${s.seller_id}?fecha_inicio=${fi}&fecha_fin=${ff}`)}
                  className="hover:bg-blue-50/40 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-2.5 text-gray-400 font-bold">#{i + 1}</td>
                  <td className="px-4 py-2.5 font-medium text-gray-800">{s.nombre}</td>
                  <td className="px-4 py-2.5 text-center text-gray-500">{fmtN(s.paquetes_a_ruta)}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded font-bold text-[11px] ${ratioBg(s.pct_same_day)}`}>
                      {fmtPct(s.pct_same_day)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Tabla conductores ─────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3">
          <Truck size={14} className="text-slate-400" />
          <p className="text-sm font-semibold text-gray-700">Conductores</p>
          <span className="text-[10px] text-gray-400">{filteredDrivers.length} conductores</span>
          <div className="ml-auto flex items-center gap-2 bg-gray-50 rounded-lg px-2.5 py-1.5">
            <Search size={12} className="text-gray-400" />
            <input
              value={driverQ}
              onChange={e => setDriverQ(e.target.value)}
              placeholder="Buscar conductor…"
              className="bg-transparent text-xs outline-none w-36 text-gray-700 placeholder:text-gray-400"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-gray-400 uppercase bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-2 text-left">Conductor</th>
                <th className="px-4 py-2 text-center">A ruta</th>
                <th className="px-4 py-2 text-center">Entregados</th>
                <th className="px-4 py-2 text-center">% Efectividad</th>
                <th className="px-4 py-2 text-center">% 1er Intento</th>
                <th className="px-4 py-2 text-center">Cancelados</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {visDrivers.map(d => (
                <tr
                  key={d.driver_id}
                  onClick={() => navigate(`/admin/efectividad/driver/${d.driver_id}?fecha_inicio=${fi}&fecha_fin=${ff}`)}
                  className="hover:bg-blue-50/40 cursor-pointer transition-colors text-gray-700"
                >
                  <td className="px-4 py-2.5 font-medium">{d.nombre}</td>
                  <td className="px-4 py-2.5 text-center text-gray-500">{fmtN(d.paquetes_a_ruta)}</td>
                  <td className="px-4 py-2.5 text-center text-gray-500">{fmtN(d.paquetes_entregados)}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded font-bold text-[11px] ${ratioBg(d.pct_delivery_success)}`}>
                      {fmtPct(d.pct_delivery_success)}
                    </span>
                  </td>
                  <td className={`px-4 py-2.5 text-center font-bold ${colorPct(d.pct_first_attempt, 85, 70)}`}>
                    {fmtPct(d.pct_first_attempt)}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={(d.cancelados ?? 0) > 0 ? 'text-red-500 font-semibold' : 'text-gray-300'}>
                      {d.cancelados ?? 0}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <ArrowRight size={12} className="text-gray-300 inline" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredDrivers.length > 10 && (
          <div className="px-5 py-2 border-t border-gray-100 text-center">
            <button onClick={() => setShowAllDrivers(s => !s)} className="text-xs text-blue-500 hover:text-blue-700 font-semibold">
              {showAllDrivers ? 'Ver menos' : `Ver todos (${filteredDrivers.length})`}
            </button>
          </div>
        )}
      </div>

      {/* ── Tabla sellers ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3">
          <Package size={14} className="text-slate-400" />
          <p className="text-sm font-semibold text-gray-700">Sellers</p>
          <span className="text-[10px] text-gray-400">{filteredSellers.length} sellers</span>
          <div className="ml-auto flex items-center gap-2 bg-gray-50 rounded-lg px-2.5 py-1.5">
            <Search size={12} className="text-gray-400" />
            <input
              value={sellerQ}
              onChange={e => setSellerQ(e.target.value)}
              placeholder="Buscar seller…"
              className="bg-transparent text-xs outline-none w-36 text-gray-700 placeholder:text-gray-400"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-gray-400 uppercase bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-2 text-left">Seller</th>
                <th className="px-4 py-2 text-center">A ruta</th>
                <th className="px-4 py-2 text-center">Entregados</th>
                <th className="px-4 py-2 text-center">% Same-Day</th>
                <th className="px-4 py-2 text-center">% Success</th>
                <th className="px-4 py-2 text-center">Cancel.</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {visSellers.map(s => (
                <tr
                  key={s.seller_id}
                  onClick={() => navigate(`/admin/efectividad/seller/${s.seller_id}?fecha_inicio=${fi}&fecha_fin=${ff}`)}
                  className="hover:bg-blue-50/40 cursor-pointer transition-colors text-gray-700"
                >
                  <td className="px-4 py-2.5 font-medium">{s.nombre}</td>
                  <td className="px-4 py-2.5 text-center text-gray-500">{fmtN(s.paquetes_a_ruta)}</td>
                  <td className="px-4 py-2.5 text-center text-gray-500">{fmtN(s.paquetes_entregados)}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded font-bold text-[11px] ${ratioBg(s.pct_same_day)}`}>
                      {fmtPct(s.pct_same_day)}
                    </span>
                  </td>
                  <td className={`px-4 py-2.5 text-center font-bold ${colorPct(s.pct_delivery_success, 90, 75)}`}>
                    {fmtPct(s.pct_delivery_success)}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={(s.cancelados ?? 0) > 0 ? 'text-red-500 font-semibold' : 'text-gray-300'}>
                      {s.cancelados ?? 0}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <ArrowRight size={12} className="text-gray-300 inline" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredSellers.length > 10 && (
          <div className="px-5 py-2 border-t border-gray-100 text-center">
            <button onClick={() => setShowAllSellers(s => !s)} className="text-xs text-blue-500 hover:text-blue-700 font-semibold">
              {showAllSellers ? 'Ver menos' : `Ver todos (${filteredSellers.length})`}
            </button>
          </div>
        )}
      </div>

      <p className="text-[10px] text-gray-400 text-center">
        {data && `Rango: ${data.rango?.inicio} → ${data.rango?.fin} · `}
        Same-Day = 0 días hábiles entre retiro y entrega · meta operacional 98%
      </p>
    </div>
  )
}
