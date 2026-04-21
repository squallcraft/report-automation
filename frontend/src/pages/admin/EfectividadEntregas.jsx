import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api'
import toast from 'react-hot-toast'
import { TrendingUp, AlertTriangle, Clock, ChevronUp, ChevronDown, Search, ArrowRight, Download } from 'lucide-react'
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

function Sparkline({ data = [] }) {
  if (!data.length) return <div className="h-6 text-[9px] text-gray-300 flex items-center">—</div>
  const max = Math.max(...data, 1)
  return (
    <div className="flex items-end gap-0.5 h-6 w-16">
      {data.map((v, i) => {
        const h = Math.max(Math.round((v / max) * 100), v > 0 ? 8 : 0)
        const bg = v >= 70 ? 'bg-emerald-400' : v >= 40 ? 'bg-amber-400' : 'bg-red-400'
        return <div key={i} className={`flex-1 rounded-sm ${bg}`} style={{ height: `${h}%` }} />
      })}
    </div>
  )
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

function SortIcon({ col, sortState }) {
  if (sortState.col !== col) return <ChevronUp size={10} className="text-gray-300 ml-0.5" />
  return sortState.dir === 'asc'
    ? <ChevronUp size={10} className="text-blue-500 ml-0.5" />
    : <ChevronDown size={10} className="text-blue-500 ml-0.5" />
}

function SortableTh({ label, col, sortState, onSort, className = '' }) {
  return (
    <th
      onClick={() => onSort(col)}
      className={`px-4 py-2 font-semibold cursor-pointer select-none hover:bg-gray-100 transition-colors ${className}`}
    >
      <span className="flex items-center justify-center gap-0.5">
        {label}
        <SortIcon col={col} sortState={sortState} />
      </span>
    </th>
  )
}

const PAGE_OPTIONS = [
  { label: '30', value: 30 },
  { label: '50', value: 50 },
  { label: '100', value: 100 },
  { label: '200', value: 200 },
  { label: 'Todos', value: 0 },
]

export default function EfectividadEntregas() {
  const navigate = useNavigate()
  const [period, setPeriod] = useState({ mes: now.getMonth() + 1, anio: now.getFullYear(), semana: null })
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [vista, setVista] = useState('mensual')

  // Seller table controls
  const [sellerSearch, setSellerSearch] = useState('')
  const [sellerSort, setSellerSort] = useState({ col: 'total', dir: 'desc' })
  const [sellerPageSize, setSellerPageSize] = useState(30)
  const [sellerPage, setSellerPage] = useState(1)

  // Driver table controls
  const [driverSearch, setDriverSearch] = useState('')
  const [driverSort, setDriverSort] = useState({ col: 'con_fecha_retiro', dir: 'desc' })
  const [driverPageSize, setDriverPageSize] = useState(30)
  const [driverPage, setDriverPage] = useState(1)

  const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { mes: period.mes, anio: period.anio }
      if (vista === 'semanal' && period.semana) params.semana = period.semana
      const { data: d } = await api.get('/dashboard/efectividad', { params })
      setData(d)
    } catch {
      toast.error('Error cargando efectividad')
    } finally {
      setLoading(false)
    }
  }, [period, vista])

  useEffect(() => { load() }, [load])
  // Reset pages when search changes
  useEffect(() => { setSellerPage(1) }, [sellerSearch, sellerSort])
  useEffect(() => { setDriverPage(1) }, [driverSearch, driverSort])

  const handleSellerSort = (col) => {
    setSellerSort(s => ({ col, dir: s.col === col && s.dir === 'desc' ? 'asc' : 'desc' }))
  }
  const handleDriverSort = (col) => {
    setDriverSort(s => ({ col, dir: s.col === col && s.dir === 'desc' ? 'asc' : 'desc' }))
  }

  const sellersSorted = useMemo(() => {
    if (!data?.por_seller) return []
    let rows = data.por_seller.filter(s =>
      s.nombre.toLowerCase().includes(sellerSearch.toLowerCase())
    )
    rows = [...rows].sort((a, b) => {
      if (sellerSort.col === 'nombre') {
        const cmp = (a.nombre || '').localeCompare(b.nombre || '')
        return sellerSort.dir === 'asc' ? cmp : -cmp
      }
      const va = a[sellerSort.col] ?? -1
      const vb = b[sellerSort.col] ?? -1
      return sellerSort.dir === 'asc' ? va - vb : vb - va
    })
    return rows
  }, [data?.por_seller, sellerSearch, sellerSort])

  const sellerTotalPages = sellerPageSize === 0 ? 1 : Math.max(1, Math.ceil(sellersSorted.length / sellerPageSize))
  const sellerPageClamped = Math.min(sellerPage, sellerTotalPages)
  const sellersVisible = sellerPageSize === 0
    ? sellersSorted
    : sellersSorted.slice((sellerPageClamped - 1) * sellerPageSize, sellerPageClamped * sellerPageSize)

  const driversSorted = useMemo(() => {
    if (!data?.por_driver) return []
    let rows = data.por_driver.filter(d =>
      d.nombre.toLowerCase().includes(driverSearch.toLowerCase())
    )
    rows = [...rows].sort((a, b) => {
      if (driverSort.col === 'nombre') {
        const cmp = (a.nombre || '').localeCompare(b.nombre || '')
        return driverSort.dir === 'asc' ? cmp : -cmp
      }
      const va = a[driverSort.col] ?? -1
      const vb = b[driverSort.col] ?? -1
      return driverSort.dir === 'asc' ? va - vb : vb - va
    })
    return rows
  }, [data?.por_driver, driverSearch, driverSort])

  const driverTotalPages = driverPageSize === 0 ? 1 : Math.max(1, Math.ceil(driversSorted.length / driverPageSize))
  const driverPageClamped = Math.min(driverPage, driverTotalPages)
  const driversVisible = driverPageSize === 0
    ? driversSorted
    : driversSorted.slice((driverPageClamped - 1) * driverPageSize, driverPageClamped * driverPageSize)

  const g = data?.global
  const prev = data?.prev_global

  // Delta helpers: positive = worsened (higher ciclo / lower pct_rapida = bad)
  const deltaCiclo = (g && prev && prev.ciclo_promedio && g.ciclo_promedio != null)
    ? +(g.ciclo_promedio - prev.ciclo_promedio).toFixed(1) : null
  const deltaRapida = (g && prev && prev.pct_rapida != null && g.pct_rapida != null)
    ? +(g.pct_rapida - prev.pct_rapida).toFixed(1) : null

  const DeltaBadge = ({ val, invert = false }) => {
    if (val === null || val === undefined) return null
    const improved = invert ? val > 0 : val < 0
    const neutral = val === 0
    return (
      <span className={`text-[10px] font-semibold ml-1 ${neutral ? 'text-gray-400' : improved ? 'text-emerald-500' : 'text-red-500'}`}>
        {val > 0 ? `+${val}` : val}{invert ? 'pp' : 'd'} vs mes ant.
      </span>
    )
  }

  const exportCSV = () => {
    if (!data?.por_seller) return
    const rows = [
      ['Seller', 'Envíos', 'Cancelados', 'Medibles', 'Ciclo prom.', '% Rápida (≤1d)', '% Lenta (≥4d)'],
      ...data.por_seller.map(s => [s.nombre, s.total, s.cancelados ?? 0, s.con_fecha_retiro ?? s.con_fecha_carga ?? 0, s.ciclo_promedio ?? '', s.pct_rapida ?? '', s.pct_4plus ?? '']),
      [],
      ['Driver', 'Envíos', 'Cancelados', 'Medibles', 'Ciclo prom.', '% Rápida (≤1d)', '% Lenta (≥4d)'],
      ...data.por_driver.map(d => [d.nombre, d.total, d.cancelados ?? 0, d.con_fecha_retiro ?? d.con_fecha_carga ?? 0, d.ciclo_promedio ?? '', d.pct_rapida ?? '', d.pct_4plus ?? '']),
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `efectividad_${period.mes}_${period.anio}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        title="Efectividad de Entregas"
        subtitle="Métricas de desempeño por conductor"
        icon={TrendingUp}
        accent="green"
        actions={(
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex gap-1 bg-slate-800/80 rounded-lg p-1 border border-slate-600/50">
              <button type="button" onClick={() => setVista('mensual')} className={`text-xs px-3 py-1 rounded-md font-medium transition-all ${vista === 'mensual' ? 'bg-slate-700 text-slate-100 shadow' : 'text-slate-400'}`}>Mensual</button>
              <button type="button" onClick={() => setVista('semanal')} className={`text-xs px-3 py-1 rounded-md font-medium transition-all ${vista === 'semanal' ? 'bg-slate-700 text-slate-100 shadow' : 'text-slate-400'}`}>Semanal</button>
            </div>
            {vista === 'semanal' && (
              <select className="border border-slate-600 rounded-lg px-3 py-1.5 text-xs bg-slate-800 text-slate-200"
                value={period.semana || ''} onChange={e => setPeriod(p => ({ ...p, semana: e.target.value ? +e.target.value : null }))}>
                <option value="">Todas las semanas</option>
                {[1,2,3,4,5].map(s => <option key={s} value={s}>Semana {s}</option>)}
              </select>
            )}
            <select className="border border-slate-600 rounded-lg px-3 py-1.5 text-xs bg-slate-800 text-slate-200"
              value={`${period.mes}-${period.anio}`}
              onChange={e => { const [m, a] = e.target.value.split('-'); setPeriod(p => ({ ...p, mes: +m, anio: +a })) }}>
              {[now.getFullYear() - 1, now.getFullYear()].flatMap(anio =>
                Array.from({ length: 12 }, (_, i) => {
                  const mes = i + 1
                  return <option key={`${mes}-${anio}`} value={`${mes}-${anio}`}>{meses[i]} {anio}</option>
                })
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
        <div className="text-center py-16 text-gray-400 text-sm">Cargando métricas…</div>
      ) : (
        <>
          {/* KPIs globales */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 border-l-4 border-l-blue-500">
              <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Total envíos</p>
              <p className="text-3xl font-black text-gray-800 mt-1">{(g?.total || 0).toLocaleString()}</p>
              <p className="text-xs text-gray-400 mt-1">
                {(g?.con_fecha_retiro ?? g?.con_fecha_carga ?? 0)} con ciclo medible
                {(g?.cancelados ?? 0) > 0 && (
                  <span className="ml-1">· <span className="text-red-500 font-semibold">{g.cancelados}</span> cancelados</span>
                )}
              </p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 border-l-4 border-l-emerald-500">
              <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Ciclo promedio</p>
              <p className={`text-3xl font-black mt-1 ${colorCiclo(g?.ciclo_promedio)}`}>{fmtDias(g?.ciclo_promedio)}</p>
              <div className="text-xs text-gray-400 mt-1 flex items-center">
                días hábiles · retiro → entrega
                <DeltaBadge val={deltaCiclo} invert={false} />
              </div>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 border-l-4 border-l-emerald-400">
              <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Entregados en ≤1d</p>
              <p className="text-3xl font-black text-emerald-600 mt-1">{fmtPct(g?.pct_rapida)}</p>
              <div className="text-xs text-gray-400 mt-1 flex items-center">
                {g ? (g.n_0d || 0) + (g.n_1d || 0) : 0} envíos
                <DeltaBadge val={deltaRapida} invert={true} />
              </div>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 border-l-4 border-l-red-400">
              <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Con +4 días</p>
              <p className="text-3xl font-black text-red-500 mt-1">{fmtPct(g?.pct_4plus)}</p>
              <p className="text-xs text-gray-400 mt-1">{g?.n_4plus || 0} envíos lentos</p>
            </div>
          </div>

          {/* Distribución global */}
          {(g?.con_fecha_retiro ?? g?.con_fecha_carga ?? 0) > 0 && (
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <p className="text-sm font-semibold text-gray-700 mb-4">Distribución global del ciclo de entrega</p>
              <div className="space-y-2.5">
                <BarDist label="Mismo día" pct={g.pct_0d} n={g.n_0d} color="bg-emerald-500" />
                <BarDist label="1 día" pct={g.pct_1d} n={g.n_1d} color="bg-emerald-400" />
                <BarDist label="2 días" pct={g.pct_2d} n={g.n_2d} color="bg-amber-400" />
                <BarDist label="3 días" pct={g.pct_3d} n={g.n_3d} color="bg-orange-400" />
                <BarDist label="+4 días" pct={g.pct_4plus} n={g.n_4plus} color="bg-red-400" />
              </div>
            </div>
          )}

          {/* Tabla por Seller */}
          {data?.por_seller?.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
                <p className="text-sm font-semibold text-gray-700">Por Seller</p>
                <div className="flex items-center gap-3 flex-wrap">
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
                  <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    <span>Mostrar</span>
                    <select
                      value={sellerPageSize}
                      onChange={e => { setSellerPageSize(+e.target.value); setSellerPage(1) }}
                      className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white"
                    >
                      {PAGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] text-gray-400 uppercase tracking-wide bg-gray-50 border-b border-gray-100">
                      <th
                        onClick={() => handleSellerSort('nombre')}
                        className="px-4 py-2 text-left font-semibold cursor-pointer hover:bg-gray-100 transition-colors"
                      >
                        <span className="flex items-center gap-0.5">Seller <SortIcon col="nombre" sortState={sellerSort} /></span>
                      </th>
                      <SortableTh label="Total" col="total" sortState={sellerSort} onSort={handleSellerSort} className="text-center" />
                      <SortableTh label="Cancelados" col="cancelados" sortState={sellerSort} onSort={handleSellerSort} className="text-center" />
                      <SortableTh label="Ciclo prom." col="ciclo_promedio" sortState={sellerSort} onSort={handleSellerSort} className="text-center" />
                      <SortableTh label="Entregados ≤1d" col="pct_rapida" sortState={sellerSort} onSort={handleSellerSort} className="text-center" />
                      <SortableTh label="Mismo día" col="pct_0d" sortState={sellerSort} onSort={handleSellerSort} className="text-center" />
                      <SortableTh label="+4 días" col="pct_4plus" sortState={sellerSort} onSort={handleSellerSort} className="text-center" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {sellersVisible.map(s => (
                      <tr key={s.seller_id ?? s.nombre}
                        className={`text-gray-700 hover:bg-gray-50 cursor-pointer ${s.pct_4plus > 15 ? 'bg-red-50/30' : ''}`}
                        onClick={() => {
                          if (s.es_grupo) navigate(`/admin/sellers/grupo/${encodeURIComponent(s.grupo_nombre)}/perfil?mes=${period.mes}&anio=${period.anio}`)
                          else navigate(`/admin/sellers/${s.seller_id}/perfil?mes=${period.mes}&anio=${period.anio}`)
                        }}
                      >
                        <td className="px-4 py-2.5 font-medium">
                          {s.nombre}
                          {s.es_grupo && <span className="ml-1.5 text-[9px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full font-bold">Grupo</span>}
                          {s.pct_4plus > 15 && <span className="ml-1.5 text-[9px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-bold">Alerta</span>}
                        </td>
                        <td className="px-4 py-2.5 text-center text-gray-500">{s.total}</td>
                        <td className="px-4 py-2.5 text-center" title="Cancelados externamente (no entran al denominador)">
                          <span className={(s.cancelados ?? 0) > 0 ? 'text-red-500 font-semibold' : 'text-gray-300'}>
                            {s.cancelados ?? 0}
                          </span>
                        </td>
                        <td className={`px-4 py-2.5 text-center font-bold ${colorCiclo(s.ciclo_promedio)}`}>{fmtDias(s.ciclo_promedio)}</td>
                        <td className="px-4 py-2.5 w-44">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-100 rounded-full h-2">
                              <div className={`h-2 rounded-full ${s.pct_rapida >= 60 ? 'bg-emerald-500' : s.pct_rapida >= 40 ? 'bg-amber-400' : 'bg-red-400'}`}
                                style={{ width: `${s.pct_rapida}%` }} />
                            </div>
                            <span className={`font-bold w-9 ${colorPct(s.pct_rapida)}`}>{fmtPct(s.pct_rapida)}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-center"><span className={`font-semibold ${s.pct_0d >= 30 ? 'text-emerald-600' : 'text-gray-500'}`}>{fmtPct(s.pct_0d)}</span></td>
                        <td className="px-4 py-2.5 text-center"><span className={`font-semibold ${s.pct_4plus > 10 ? 'text-red-500' : 'text-gray-400'}`}>{fmtPct(s.pct_4plus)}</span></td>
                      </tr>
                    ))}
                    {sellersVisible.length === 0 && (
                      <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">Sin resultados</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {/* Paginación sellers */}
              {sellerPageSize > 0 && sellerTotalPages > 1 && (
                <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
                  <span>{sellersSorted.length} sellers · página {sellerPageClamped} de {sellerTotalPages}</span>
                  <div className="flex gap-1">
                    <button onClick={() => setSellerPage(p => Math.max(1, p - 1))} disabled={sellerPageClamped === 1}
                      className="px-2.5 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40">‹</button>
                    <button onClick={() => setSellerPage(p => Math.min(sellerTotalPages, p + 1))} disabled={sellerPageClamped === sellerTotalPages}
                      className="px-2.5 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40">›</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tabla por Driver */}
          {data?.por_driver?.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-700">Por Conductor</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Haz clic en una fila para ver el detalle completo</p>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
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
                  <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    <span>Mostrar</span>
                    <select
                      value={driverPageSize}
                      onChange={e => { setDriverPageSize(+e.target.value); setDriverPage(1) }}
                      className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white"
                    >
                      {PAGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] text-gray-400 uppercase tracking-wide bg-gray-50 border-b border-gray-100">
                      <th
                        onClick={() => handleDriverSort('nombre')}
                        className="px-4 py-2 text-left font-semibold cursor-pointer hover:bg-gray-100 transition-colors"
                      >
                        <span className="flex items-center gap-0.5">Conductor <SortIcon col="nombre" sortState={driverSort} /></span>
                      </th>
                      <SortableTh label="Asignados" col="total" sortState={driverSort} onSort={handleDriverSort} className="text-center" />
                      <SortableTh label="Cancelados" col="cancelados" sortState={driverSort} onSort={handleDriverSort} className="text-center" />
                      <SortableTh label="Medibles" col="con_fecha_retiro" sortState={driverSort} onSort={handleDriverSort} className="text-center" />
                      <SortableTh label="Ciclo prom." col="ciclo_promedio" sortState={driverSort} onSort={handleDriverSort} className="text-center" />
                      <SortableTh label="≤1 día" col="pct_rapida" sortState={driverSort} onSort={handleDriverSort} className="text-center" />
                      <SortableTh label="Mismo día" col="pct_0d" sortState={driverSort} onSort={handleDriverSort} className="text-center" />
                      <SortableTh label="+4 días" col="pct_4plus" sortState={driverSort} onSort={handleDriverSort} className="text-center" />
                      <th className="px-4 py-2 text-center font-semibold">Tendencia</th>
                      <th className="px-4 py-2 text-center font-semibold"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {driversVisible.map(d => (
                      <tr
                        key={d.driver_id}
                        onClick={() => navigate(`/admin/efectividad/driver/${d.driver_id}?mes=${period.mes}&anio=${period.anio}`)}
                        className={`text-gray-700 hover:bg-blue-50/40 cursor-pointer transition-colors ${d.alerta ? 'bg-red-50/20' : ''}`}
                      >
                        <td className="px-4 py-2.5 font-medium">
                          {d.nombre}
                          {d.alerta && <span className="ml-1.5 text-[9px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-bold">⚠ Alerta</span>}
                        </td>
                        <td className="px-4 py-2.5 text-center text-gray-500">{d.total ?? 0}</td>
                        <td className="px-4 py-2.5 text-center" title="Cancelados externamente (no entran al denominador)">
                          <span className={(d.cancelados ?? 0) > 0 ? 'text-red-500 font-semibold' : 'text-gray-300'}>
                            {d.cancelados ?? 0}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-center text-gray-500">{d.con_fecha_retiro ?? d.con_fecha_carga ?? 0}</td>
                        <td className={`px-4 py-2.5 text-center font-bold ${colorCiclo(d.ciclo_promedio)}`}>{fmtDias(d.ciclo_promedio)}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`font-bold ${colorPct(d.pct_rapida)}`}>{fmtPct(d.pct_rapida)}</span>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`font-semibold ${d.pct_0d >= 30 ? 'text-emerald-600' : 'text-gray-500'}`}>{fmtPct(d.pct_0d)}</span>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`font-semibold ${d.pct_4plus > 10 ? 'text-red-500' : 'text-gray-400'}`}>{fmtPct(d.pct_4plus)}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex justify-center">
                            <Sparkline data={d.spark || []} />
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <ArrowRight size={14} className="text-gray-300 group-hover:text-blue-400 mx-auto" />
                        </td>
                      </tr>
                    ))}
                    {driversVisible.length === 0 && (
                      <tr><td colSpan={10} className="px-4 py-6 text-center text-gray-400">Sin resultados</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {/* Paginación drivers */}
              {driverPageSize > 0 && driverTotalPages > 1 && (
                <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
                  <span>{driversSorted.length} conductores · página {driverPageClamped} de {driverTotalPages}</span>
                  <div className="flex gap-1">
                    <button onClick={() => setDriverPage(p => Math.max(1, p - 1))} disabled={driverPageClamped === 1}
                      className="px-2.5 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40">‹</button>
                    <button onClick={() => setDriverPage(p => Math.min(driverTotalPages, p + 1))} disabled={driverPageClamped === driverTotalPages}
                      className="px-2.5 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40">›</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {!(g?.con_fecha_retiro ?? g?.con_fecha_carga) && !loading && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
              <Clock size={20} className="text-amber-500 mx-auto mb-2" />
              <p className="text-sm font-semibold text-amber-800">Sin datos de fecha de retiro en este período</p>
              <p className="text-xs text-amber-600 mt-1">El ciclo se calcula desde <code>fecha_retiro</code> (TrackingTech) hasta <code>fecha_entrega</code>. Si todavía no corriste la ingesta de asignaciones para este mes, hazlo desde <b>Asignaciones de Ruta → Ingestar rango ahora</b>.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
