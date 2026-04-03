import { useState, useEffect, useCallback } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import { TrendingUp, AlertTriangle, Clock, Package, ChevronRight } from 'lucide-react'

const now = new Date()
const fmtPct = (v) => v != null ? `${v}%` : '—'
const fmtDias = (v) => v != null ? `${v}d` : '—'
const colorCiclo = (v) => {
  if (v == null) return 'text-gray-400'
  if (v <= 1) return 'text-emerald-600'
  if (v <= 2.5) return 'text-amber-600'
  return 'text-red-600'
}
const colorPct = (v, invert = false) => {
  if (v == null) return 'text-gray-400'
  const ok = invert ? v <= 5 : v >= 60
  const warn = invert ? v <= 15 : v >= 40
  if (ok) return invert ? 'text-emerald-600' : 'text-emerald-600'
  if (warn) return invert ? 'text-amber-600' : 'text-amber-600'
  return 'text-red-600'
}

function Sparkline({ data = [] }) {
  if (!data.length) return <div className="h-6 text-[9px] text-gray-300 flex items-center">sin datos</div>
  const max = Math.max(...data, 1)
  return (
    <div className="flex items-end gap-0.5 h-6">
      {data.map((v, i) => {
        const h = Math.max(Math.round((v / max) * 100), v > 0 ? 8 : 0)
        const bg = v >= 70 ? 'bg-emerald-400' : v >= 40 ? 'bg-amber-400' : 'bg-red-400'
        return <div key={i} className={`flex-1 rounded-sm ${bg}`} style={{ height: `${h}%` }} />
      })}
    </div>
  )
}

function DriverCard({ d, active, onClick }) {
  const alertColor = d.alerta ? 'border-red-200' : d.ciclo_promedio <= 1.5 ? 'border-emerald-200' : 'border-gray-100'
  const badge = d.ciclo_promedio == null ? 'bg-gray-100 text-gray-400'
    : d.ciclo_promedio <= 1.5 ? 'bg-emerald-100 text-emerald-700'
    : d.ciclo_promedio <= 2.5 ? 'bg-amber-100 text-amber-700'
    : 'bg-red-100 text-red-700'
  const initials = d.nombre.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
  const avatarBg = d.alerta ? 'bg-red-100 text-red-700'
    : d.ciclo_promedio != null && d.ciclo_promedio <= 1.5 ? 'bg-emerald-100 text-emerald-700'
    : 'bg-gray-100 text-gray-600'

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl p-3 cursor-pointer border transition-all hover:-translate-y-0.5 hover:shadow-md ${alertColor} ${active ? 'outline outline-2 outline-blue-500 outline-offset-2' : ''}`}
    >
      <div className="flex justify-between items-start mb-2">
        <div className={`w-8 h-8 rounded-full text-xs font-bold flex items-center justify-center ${avatarBg}`}>
          {initials}
        </div>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${badge}`}>
          {fmtDias(d.ciclo_promedio)}
        </span>
      </div>
      <p className="text-xs font-semibold text-gray-800 truncate">{d.nombre.split(' ')[0]} {d.nombre.split(' ')[1] || ''}</p>
      <p className="text-[10px] text-gray-400">{d.con_fecha_carga} envíos medibles</p>
      <div className="mt-2">
        <Sparkline data={d.spark || []} />
      </div>
      {d.alerta && <p className="text-[9px] text-red-500 mt-1">⚠ ciclo &gt; 2.5d</p>}
      {!d.alerta && d.pct_rapida != null && (
        <p className="text-[9px] text-gray-400 mt-1">{d.pct_rapida}% en ≤1d</p>
      )}
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

export default function EfectividadEntregas() {
  const [period, setPeriod] = useState({ mes: now.getMonth() + 1, anio: now.getFullYear(), semana: null })
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedDriver, setSelectedDriver] = useState(null)
  const [detalle, setDetalle] = useState(null)
  const [loadingDetalle, setLoadingDetalle] = useState(false)
  const [vista, setVista] = useState('mensual')

  const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = { mes: period.mes, anio: period.anio }
      if (vista === 'semanal' && period.semana) params.semana = period.semana
      const { data: d } = await api.get('/dashboard/efectividad', { params })
      setData(d)
      // Auto-select first driver with data
      if (d.por_driver?.length && !selectedDriver) {
        setSelectedDriver(d.por_driver[0].driver_id)
      }
    } catch {
      toast.error('Error cargando efectividad')
    } finally {
      setLoading(false)
    }
  }, [period, vista])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!selectedDriver) return
    setLoadingDetalle(true)
    api.get(`/dashboard/efectividad/driver/${selectedDriver}`, { params: { mes: period.mes, anio: period.anio } })
      .then(({ data: d }) => setDetalle(d))
      .catch(() => toast.error('Error cargando detalle'))
      .finally(() => setLoadingDetalle(false))
  }, [selectedDriver, period])

  const g = data?.global

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <TrendingUp size={20} className="text-blue-600" />
            Efectividad de Entregas
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">Ciclo recepción → entrega · solo admin</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            <button onClick={() => setVista('mensual')} className={`text-xs px-3 py-1 rounded-md font-medium transition-all ${vista === 'mensual' ? 'bg-white shadow text-gray-700' : 'text-gray-500'}`}>Mensual</button>
            <button onClick={() => setVista('semanal')} className={`text-xs px-3 py-1 rounded-md font-medium transition-all ${vista === 'semanal' ? 'bg-white shadow text-gray-700' : 'text-gray-500'}`}>Semanal</button>
          </div>
          {vista === 'semanal' && (
            <select className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs bg-white text-gray-700"
              value={period.semana || ''} onChange={e => setPeriod(p => ({ ...p, semana: e.target.value ? +e.target.value : null }))}>
              <option value="">Todas las semanas</option>
              {[1,2,3,4,5].map(s => <option key={s} value={s}>Semana {s}</option>)}
            </select>
          )}
          <select className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs bg-white text-gray-700"
            value={`${period.mes}-${period.anio}`}
            onChange={e => { const [m, a] = e.target.value.split('-'); setPeriod(p => ({ ...p, mes: +m, anio: +a })) }}>
            {Array.from({ length: 12 }, (_, i) => {
              const mes = i + 1
              const anio = now.getFullYear()
              return <option key={i} value={`${mes}-${anio}`}>{meses[i]} {anio}</option>
            })}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Cargando métricas…</div>
      ) : (
        <>
          {/* KPIs globales */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 border-l-4 border-l-blue-500">
              <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Total envíos</p>
              <p className="text-3xl font-black text-gray-800 mt-1">{(g?.total || 0).toLocaleString()}</p>
              <p className="text-xs text-gray-400 mt-1">{g?.con_fecha_carga} con ciclo medible</p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 border-l-4 border-l-emerald-500">
              <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Ciclo promedio</p>
              <p className={`text-3xl font-black mt-1 ${colorCiclo(g?.ciclo_promedio)}`}>{fmtDias(g?.ciclo_promedio)}</p>
              <p className="text-xs text-gray-400 mt-1">recepción → entrega</p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 border-l-4 border-l-emerald-400">
              <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Entregados en ≤1d</p>
              <p className="text-3xl font-black text-emerald-600 mt-1">{fmtPct(g?.pct_rapida)}</p>
              <p className="text-xs text-gray-400 mt-1">{g ? (g.n_0d || 0) + (g.n_1d || 0) : 0} envíos</p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 border-l-4 border-l-red-400">
              <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Con +4 días</p>
              <p className="text-3xl font-black text-red-500 mt-1">{fmtPct(g?.pct_4plus)}</p>
              <p className="text-xs text-gray-400 mt-1">{g?.n_4plus || 0} envíos lentos</p>
            </div>
          </div>

          {/* Distribución global */}
          {g?.con_fecha_carga > 0 && (
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
              <div className="px-5 py-3 border-b border-gray-100">
                <p className="text-sm font-semibold text-gray-700">Por Seller</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] text-gray-400 uppercase tracking-wide bg-gray-50 border-b border-gray-100">
                      <th className="px-4 py-2 text-left font-semibold">Seller</th>
                      <th className="px-4 py-2 text-center font-semibold">Total</th>
                      <th className="px-4 py-2 text-center font-semibold">Ciclo prom.</th>
                      <th className="px-4 py-2 font-semibold">Entregados en ≤1d</th>
                      <th className="px-4 py-2 text-center font-semibold">Mismo día</th>
                      <th className="px-4 py-2 text-center font-semibold">+4 días</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.por_seller.map(s => (
                      <tr key={s.seller_id} className={`text-gray-700 hover:bg-gray-50 ${s.pct_4plus > 15 ? 'bg-red-50/30' : ''}`}>
                        <td className="px-4 py-2.5 font-medium">
                          {s.nombre}
                          {s.pct_4plus > 15 && <span className="ml-1.5 text-[9px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-bold">Alerta</span>}
                        </td>
                        <td className="px-4 py-2.5 text-center text-gray-500">{s.total}</td>
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
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Grid de Drivers */}
          {data?.por_driver?.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">
                Conductores — clic para ver detalle
                <span className="ml-2 text-gray-300 normal-case font-normal">Sparkline = % entregas en ≤1d por semana</span>
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                {data.por_driver.map(d => (
                  <DriverCard
                    key={d.driver_id}
                    d={d}
                    active={selectedDriver === d.driver_id}
                    onClick={() => setSelectedDriver(d.driver_id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Panel de detalle del driver */}
          {selectedDriver && (
            <div className="space-y-4">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                Detalle — {detalle?.resumen?.nombre || '…'}
              </p>

              {loadingDetalle ? (
                <div className="text-center py-8 text-gray-400 text-sm">Cargando…</div>
              ) : detalle && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

                  {/* Col 1: métricas + distribución */}
                  <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 space-y-4">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Resumen del período</p>
                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div className="bg-gray-50 rounded-lg p-2.5">
                        <p className="text-[10px] text-gray-400">Total medibles</p>
                        <p className="text-xl font-bold text-gray-800">{detalle.resumen.total}</p>
                      </div>
                      <div className="bg-blue-50 rounded-lg p-2.5">
                        <p className="text-[10px] text-blue-500">Ciclo promedio</p>
                        <p className={`text-xl font-bold ${colorCiclo(detalle.resumen.ciclo_promedio)}`}>{fmtDias(detalle.resumen.ciclo_promedio)}</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">Distribución del ciclo</p>
                      <BarDist label="Mismo día" pct={detalle.resumen.pct_0d} n={detalle.resumen.n_0d} color="bg-emerald-500" />
                      <BarDist label="1 día" pct={detalle.resumen.pct_1d} n={detalle.resumen.n_1d} color="bg-emerald-400" />
                      <BarDist label="2 días" pct={detalle.resumen.pct_2d} n={detalle.resumen.n_2d} color="bg-amber-400" />
                      <BarDist label="3 días" pct={detalle.resumen.pct_3d} n={detalle.resumen.n_3d} color="bg-orange-400" />
                      <BarDist label="+4 días" pct={detalle.resumen.pct_4plus} n={detalle.resumen.n_4plus} color="bg-red-400" />
                    </div>
                    <p className="text-[10px] text-emerald-600 font-medium">{detalle.resumen.pct_rapida}% entregados en ≤1 día</p>
                  </div>

                  {/* Col 2: tendencia diaria */}
                  <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-3">Tendencia diaria</p>
                    {detalle.por_dia.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-8">Sin datos diarios</p>
                    ) : (
                      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                        {detalle.por_dia.map(d => (
                          <div key={d.fecha} className="flex items-center gap-2 text-[10px]">
                            <span className="text-gray-400 w-16 flex-shrink-0">{d.fecha.slice(5)}</span>
                            <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                              <div className={`h-3 rounded-full transition-all ${d.pct_rapida >= 60 ? 'bg-emerald-400' : d.pct_rapida >= 30 ? 'bg-amber-400' : 'bg-red-400'}`}
                                style={{ width: `${d.pct_rapida}%` }} />
                            </div>
                            <span className={`w-8 text-right font-semibold ${colorPct(d.pct_rapida)}`}>{d.pct_rapida}%</span>
                            <span className="text-gray-300 w-8 text-right">{d.total}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Col 3: envíos lentos */}
                  <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                      <AlertTriangle size={13} className="text-amber-500" />
                      <div>
                        <p className="text-xs font-semibold text-gray-700">Envíos con +3 días</p>
                        <p className="text-[10px] text-gray-400">{detalle.lentos.length} registros</p>
                      </div>
                    </div>
                    {detalle.lentos.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-6">Sin envíos lentos ✓</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-gray-50 text-[10px] text-gray-400 border-b border-gray-100">
                              <th className="px-3 py-2 text-left font-medium">Tracking</th>
                              <th className="px-3 py-2 text-left font-medium">Seller</th>
                              <th className="px-3 py-2 text-center font-medium">Días</th>
                              <th className="px-3 py-2 text-left font-medium">Comuna</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {detalle.lentos.map((l, i) => (
                              <tr key={i} className="hover:bg-gray-50">
                                <td className="px-3 py-2 font-mono text-blue-600 text-[10px]">{l.tracking_id.slice(-8)}</td>
                                <td className="px-3 py-2 text-gray-700 max-w-[80px] truncate" title={l.seller}>{l.seller}</td>
                                <td className="px-3 py-2 text-center">
                                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${l.ciclo_dias >= 4 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
                                    +{l.ciclo_dias}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-gray-500">{l.comuna}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                </div>
              )}
            </div>
          )}

          {!g?.con_fecha_carga && !loading && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
              <Clock size={20} className="text-amber-500 mx-auto mb-2" />
              <p className="text-sm font-semibold text-amber-800">Sin datos de fecha de carga en este período</p>
              <p className="text-xs text-amber-600 mt-1">Los ciclos solo se calculan cuando el envío tiene <code>fecha_carga</code></p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
