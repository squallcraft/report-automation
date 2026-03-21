import React, { useState, useEffect, useMemo, useRef } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import {
  BarChart3, TrendingUp, TrendingDown, Minus, Users, Truck, Store,
  DollarSign, Target, AlertTriangle, Brain, Send, X, ChevronDown,
  Loader2, ArrowUpRight, ArrowDownRight, Info,
} from 'lucide-react'

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const MESES_SHORT = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

function fmt(v) {
  if (v == null) return '$0'
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `${v < 0 ? '-' : ''}$${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${v < 0 ? '-' : ''}$${(abs / 1_000).toFixed(0)}K`
  return `${v < 0 ? '-' : ''}$${abs.toLocaleString('es-CL')}`
}

function fmtFull(v) {
  if (v == null) return '$0'
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('es-CL')}`
}

function pctDelta(curr, prev) {
  if (!prev) return null
  return ((curr - prev) / Math.abs(prev)) * 100
}

function DeltaBadge({ current, previous, invert = false }) {
  const d = pctDelta(current, previous)
  if (d === null) return <span className="text-xs text-gray-400 flex items-center gap-0.5"><Minus size={10} /> Sin datos previos</span>
  const good = invert ? d <= 0 : d >= 0
  return (
    <span className={`text-xs flex items-center gap-0.5 ${good ? 'text-green-600' : 'text-red-500'}`}>
      {good ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {d > 0 ? '+' : ''}{d.toFixed(1)}% vs ant.
    </span>
  )
}

function KpiCard({ label, value, prev, color = 'gray', sub, invert = false }) {
  const colors = { green: 'text-green-600', red: 'text-red-600', blue: 'text-blue-600', gray: 'text-gray-900', amber: 'text-amber-600' }
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-5">
      <p className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-xl sm:text-2xl font-bold ${colors[color] || colors.gray}`}>{value}</p>
      {sub && <p className="text-[10px] sm:text-xs text-gray-400 mt-0.5">{sub}</p>}
      {prev !== undefined && <div className="mt-1"><DeltaBadge current={typeof value === 'string' ? parseInt(value.replace(/[^-\d]/g, '')) : value} previous={prev} invert={invert} /></div>}
    </div>
  )
}

function SimpleBar({ data, labelKey, bars, colors, height = 200 }) {
  const max = Math.max(...data.flatMap(d => bars.map(b => Math.abs(d[b] || 0))), 1)
  return (
    <div className="overflow-x-auto">
      <div className="flex items-end gap-1 sm:gap-2" style={{ minHeight: height, minWidth: data.length * 50 }}>
        {data.map((d, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-0.5 min-w-[40px]">
            <div className="flex gap-px items-end" style={{ height: height - 24 }}>
              {bars.map((b, j) => {
                const v = d[b] || 0
                const h = Math.max((Math.abs(v) / max) * (height - 24), 2)
                return <div key={j} style={{ height: h, minWidth: 8 }} className={`${colors[j]} rounded-t-sm opacity-80`} title={`${b}: ${fmtFull(v)}`} />
              })}
            </div>
            <span className="text-[9px] sm:text-[10px] text-gray-500 whitespace-nowrap">{d[labelKey]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function DataTable({ columns, data, maxH = 'max-h-[500px]' }) {
  return (
    <div className={`overflow-auto ${maxH}`}>
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-gray-50 z-10">
          <tr>{columns.map((c, i) => <th key={i} className={`px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider ${c.align === 'right' ? 'text-right' : ''}`}>{c.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {data.map((row, i) => (
            <tr key={i} className="hover:bg-gray-50">
              {columns.map((c, j) => <td key={j} className={`px-3 py-2 whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''} ${c.className || ''}`}>{c.render ? c.render(row, i) : row[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ═══════════ TABS ═══════════

function TabPnL({ mes, anio, empresa, zona }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const params = { mes, anio }
    if (empresa) params.empresa = empresa
    if (zona) params.zona = zona
    api.get('/bi/pnl', { params }).then(r => setData(r.data)).catch(() => toast.error('Error cargando P&L')).finally(() => setLoading(false))
  }, [mes, anio, empresa, zona])

  if (loading) return <Loader />
  if (!data) return null
  const { resumen: r, desglose_ingresos: di, desglose_egresos: de, ccc, chart } = data

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard label="Ingresos totales" value={fmt(r.total_ingresos)} prev={r.total_ingresos_ant} color="green" />
        <KpiCard label="Egresos totales" value={fmt(r.total_egresos)} prev={r.total_egresos_ant} color="red" invert />
        <KpiCard label="Resultado" value={fmt(r.resultado)} prev={r.resultado_ant} color={r.resultado >= 0 ? 'green' : 'red'} />
        <KpiCard label="Margen" value={`${r.margen}%`} sub={`${r.envios.toLocaleString()} envíos`} color="blue" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-green-700 mb-3">Desglose Ingresos</h3>
          <div className="space-y-2">{Object.entries(di).map(([k, v]) => (
            <div key={k} className="flex justify-between text-sm"><span className="text-gray-600">{k.replace('manual_', '').replace(/_/g, ' ')}</span><span className="font-medium">{fmtFull(v)}</span></div>
          ))}</div>
        </div>
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-red-700 mb-3">Desglose Egresos</h3>
          <div className="space-y-2">{Object.entries(de).map(([k, v]) => (
            <div key={k} className="flex justify-between text-sm"><span className="text-gray-600">{k.replace('manual_', '').replace(/_/g, ' ')}</span><span className="font-medium">{fmtFull(v)}</span></div>
          ))}</div>
        </div>
      </div>

      {ccc && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2"><AlertTriangle size={16} className="text-amber-500" /> Liquidez y Cash Conversion</h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label="Capital atrapado" value={fmt(ccc.capital_atrapado)} color="amber" />
            <KpiCard label="Total facturado" value={fmt(ccc.total_facturado)} />
            <KpiCard label="Total cobrado" value={fmt(ccc.total_cobrado)} color="green" />
            <KpiCard label="% Cobrado" value={`${ccc.pct_cobrado}%`} color="blue" />
          </div>
          {ccc.top_slow.length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-gray-500 font-medium mb-2">Top sellers con mayor deuda pendiente</p>
              <DataTable columns={[
                { label: '#', key: 'rank', render: (_, i) => i + 1 },
                { label: 'Seller', key: 'nombre' },
                { label: 'Facturado', key: 'facturado', align: 'right', render: r => fmtFull(r.facturado) },
                { label: 'Cobrado', key: 'cobrado', align: 'right', render: r => fmtFull(r.cobrado) },
                { label: 'Pendiente', key: 'pendiente', align: 'right', render: r => <span className="text-red-600 font-medium">{fmtFull(r.pendiente)}</span> },
              ]} data={ccc.top_slow.map((s, i) => ({ ...s, rank: i + 1 }))} maxH="max-h-[300px]" />
            </div>
          )}
        </div>
      )}
      {!ccc && anio < 2026 && (
        <div className="card p-4 bg-amber-50 border-amber-200">
          <p className="text-sm text-amber-700 flex items-center gap-2"><Info size={14} /> CCC solo disponible para 2026 (sin datos de pagos para años anteriores)</p>
        </div>
      )}

      <div className="card p-4">
        <h3 className="text-sm font-semibold mb-3">P&L Mensual {anio}</h3>
        <SimpleBar data={chart} labelKey="label" bars={['ingresos', 'egresos', 'resultado']} colors={['bg-green-500', 'bg-red-400', 'bg-blue-500']} />
      </div>
    </div>
  )
}

function TabUnitEconomics({ mes, anio }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.get('/bi/unit-economics', { params: { mes, anio } }).then(r => setData(r.data)).catch(() => toast.error('Error')).finally(() => setLoading(false))
  }, [mes, anio])

  if (loading) return <Loader />
  if (!data) return null
  const { total: t, prev: p, zonas, chart } = data

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard label="Revenue / Envío" value={fmtFull(t.rev_envio)} prev={p.rev_envio} color="green" />
        <KpiCard label="Costo / Envío" value={fmtFull(t.cost_envio)} prev={p.cost_envio} color="red" invert />
        <KpiCard label="Margen / Envío" value={fmtFull(t.margen_envio)} prev={p.margen_envio} color="blue" />
        <KpiCard label="Envíos" value={t.envios.toLocaleString()} prev={p.envios} sub={`Margen ${t.margen_pct}%`} />
      </div>

      <div className="card p-0 overflow-hidden">
        <h3 className="text-sm font-semibold p-4 pb-2">Unit Economics por Zona</h3>
        <DataTable columns={[
          { label: 'Zona', key: 'zona' },
          { label: 'Envíos', key: 'envios', align: 'right', render: r => r.envios.toLocaleString() },
          { label: 'Rev/env', key: 'rev_envio', align: 'right', render: r => fmtFull(r.rev_envio) },
          { label: 'Cost/env', key: 'cost_envio', align: 'right', render: r => fmtFull(r.cost_envio) },
          { label: 'Margen/env', key: 'margen_envio', align: 'right', render: r => fmtFull(r.margen_envio) },
          { label: 'Margen %', key: 'margen_pct', align: 'right', render: r => <span className={r.margen_pct >= 25 ? 'text-green-600' : r.margen_pct >= 0 ? 'text-amber-600' : 'text-red-600'}>{r.margen_pct}%</span> },
        ]} data={zonas} />
      </div>

      <div className="card p-4">
        <h3 className="text-sm font-semibold mb-3">Evolución Unit Economics {anio}</h3>
        <SimpleBar data={chart} labelKey="label" bars={['rev_envio', 'cost_envio', 'margen_envio']} colors={['bg-green-500', 'bg-red-400', 'bg-blue-500']} height={160} />
      </div>
    </div>
  )
}

function TabRentabilidad({ mes, anio }) {
  const [subTab, setSubTab] = useState('sellers')
  const [sData, setSData] = useState(null)
  const [dData, setDData] = useState(null)
  const [pData, setPData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const p = { mes, anio }
    Promise.all([
      api.get('/bi/rentabilidad/sellers', { params: p }),
      api.get('/bi/rentabilidad/drivers', { params: p }),
      api.get('/bi/rentabilidad/pickups', { params: p }),
    ]).then(([s, d, pk]) => { setSData(s.data); setDData(d.data); setPData(pk.data) })
      .catch(() => toast.error('Error')).finally(() => setLoading(false))
  }, [mes, anio])

  if (loading) return <Loader />

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5 w-fit">
        {[['sellers', 'Sellers', Users], ['drivers', 'Drivers', Truck], ['pickups', 'Pickups', Store]].map(([k, l, Icon]) => (
          <button key={k} onClick={() => setSubTab(k)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${subTab === k ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            <Icon size={14} /> {l}
          </button>
        ))}
      </div>

      {subTab === 'sellers' && sData && <RentSellers data={sData} />}
      {subTab === 'drivers' && dData && <RentDrivers data={dData} />}
      {subTab === 'pickups' && pData && <RentPickups data={pData} />}
    </div>
  )
}

function RentSellers({ data }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Sellers activos" value={data.total_sellers} />
        <KpiCard label="Revenue total" value={fmt(data.total_revenue)} color="green" />
        <KpiCard label="Margen promedio" value={`${data.avg_margin_pct}%`} color="blue" />
        <KpiCard label="Top Seller" value={data.best?.nombre || '—'} sub={data.best ? `Margen ${data.best.margin_pct}%` : ''} />
      </div>
      <div className="card p-0 overflow-hidden">
        <DataTable columns={[
          { label: '#', render: (_, i) => i + 1 },
          { label: 'Seller', key: 'nombre', render: r => <span className="font-medium">{r.nombre}</span> },
          { label: 'Tipo pago', key: 'tipo_pago', render: r => <span className={`text-xs px-1.5 py-0.5 rounded ${r.tipo_pago === 'mensual' ? 'bg-blue-100 text-blue-700' : r.tipo_pago === 'quincenal' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>{r.tipo_pago}</span> },
          { label: 'Envíos', key: 'envios', align: 'right', render: r => r.envios.toLocaleString() },
          { label: 'Revenue', key: 'revenue', align: 'right', render: r => fmt(r.revenue) },
          { label: 'Costo', key: 'cost', align: 'right', render: r => fmt(r.cost) },
          { label: 'Margen', key: 'margin', align: 'right', render: r => fmt(r.margin) },
          { label: '%', key: 'margin_pct', align: 'right', render: r => <span className={r.margin_pct >= 25 ? 'text-green-600 font-medium' : r.margin_pct >= 0 ? 'text-amber-600' : 'text-red-600 font-medium'}>{r.margin_pct}%</span> },
        ]} data={data.sellers} />
      </div>
    </div>
  )
}

function RentDrivers({ data }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KpiCard label="Drivers activos" value={data.total_drivers} />
        <KpiCard label="Contratados" value={data.drivers.filter(d => d.contratado).length} sub="Flota propia" />
        <KpiCard label="Tercerizados" value={data.drivers.filter(d => !d.contratado).length} sub="Externos" />
      </div>
      <div className="card p-0 overflow-hidden">
        <DataTable columns={[
          { label: '#', render: (_, i) => i + 1 },
          { label: 'Driver', key: 'nombre', render: r => <span className="font-medium">{r.nombre}</span> },
          { label: 'Tipo', key: 'contratado', render: r => <span className={`text-xs px-1.5 py-0.5 rounded ${r.contratado ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{r.contratado ? 'Contratado' : 'Tercerizado'}</span> },
          { label: 'Envíos', key: 'envios', align: 'right', render: r => r.envios.toLocaleString() },
          { label: 'Revenue', key: 'revenue', align: 'right', render: r => fmt(r.revenue) },
          { label: 'Costo', key: 'cost', align: 'right', render: r => fmt(r.cost) },
          { label: 'Margen %', key: 'margin_pct', align: 'right', render: r => <span className={r.margin_pct >= 25 ? 'text-green-600 font-medium' : r.margin_pct >= 0 ? 'text-amber-600' : 'text-red-600 font-medium'}>{r.margin_pct}%</span> },
          { label: 'Payout %', key: 'payout_pct', align: 'right', render: r => `${r.payout_pct}%` },
        ]} data={data.drivers} />
      </div>
    </div>
  )
}

function RentPickups({ data }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <KpiCard label="Pickups activos" value={data.pickups.length} />
        <KpiCard label="Total envíos vía pickup" value={data.pickups.reduce((a, p) => a + p.envios, 0).toLocaleString()} />
      </div>
      <div className="card p-0 overflow-hidden">
        <DataTable columns={[
          { label: '#', render: (_, i) => i + 1 },
          { label: 'Pickup', key: 'nombre' },
          { label: 'Envíos', key: 'envios', align: 'right', render: r => r.envios.toLocaleString() },
          { label: 'Costo total', key: 'costo', align: 'right', render: r => fmtFull(r.costo) },
          { label: 'Comisión/paq', key: 'comision_unitaria', align: 'right', render: r => fmtFull(r.comision_unitaria) },
        ]} data={data.pickups} />
      </div>
    </div>
  )
}

function TabCostos({ mes, anio }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.get('/bi/costos', { params: { mes, anio } }).then(r => setData(r.data)).catch(() => toast.error('Error')).finally(() => setLoading(false))
  }, [mes, anio])

  if (loading) return <Loader />
  if (!data) return null
  const { contratado: c, tercerizado: t, composicion } = data

  const compEntries = Object.entries(composicion).filter(([, v]) => v > 0)
  const compTotal = compEntries.reduce((a, [, v]) => a + v, 0)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KpiCard label="Costo total" value={fmt(data.total_cost)} color="red" />
        <KpiCard label="CPD Promedio" value={fmtFull(data.cpd_promedio)} />
        <KpiCard label="Driver Payout %" value={`${data.payout_pct}%`} color="amber" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-4">
          <h3 className="text-sm font-semibold mb-3">Composición de costos</h3>
          <div className="space-y-2">
            {compEntries.sort((a, b) => b[1] - a[1]).map(([k, v]) => {
              const pct = compTotal > 0 ? (v / compTotal * 100) : 0
              return (
                <div key={k}>
                  <div className="flex justify-between text-sm mb-0.5"><span className="text-gray-600">{k.replace(/_/g, ' ')}</span><span className="font-medium">{fmtFull(v)} <span className="text-gray-400 text-xs">({pct.toFixed(1)}%)</span></span></div>
                  <div className="w-full bg-gray-100 rounded-full h-1.5"><div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${pct}%` }} /></div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="card p-4">
          <h3 className="text-sm font-semibold mb-3">Contratado vs Tercerizado</h3>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-gray-500 uppercase"><th className="text-left py-1">Métrica</th><th className="text-right py-1">Contratado</th><th className="text-right py-1">Tercerizado</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {[
                  ['Envíos', c.envios?.toLocaleString(), t.envios?.toLocaleString()],
                  ['Revenue', fmt(c.revenue), fmt(t.revenue)],
                  ['Costo', fmt(c.cost), fmt(t.cost)],
                  ['Margen', `${c.margin_pct}%`, `${t.margin_pct}%`],
                  ['CPD', fmtFull(c.cpd), fmtFull(t.cpd)],
                ].map(([label, cv, tv], i) => (
                  <tr key={i}><td className="py-1.5 text-gray-600">{label}</td><td className="text-right font-medium">{cv}</td><td className="text-right font-medium">{tv}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

function TabYoY({ mes }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.get('/bi/yoy', { params: { mes } }).then(r => setData(r.data)).catch(() => toast.error('Error')).finally(() => setLoading(false))
  }, [mes])

  if (loading) return <Loader />
  if (!data) return null

  const y24 = data.years[2024] || {}
  const y25 = data.years[2025] || {}
  const y26 = data.years[2026] || {}

  const delta = (curr, prev) => {
    if (!prev) return '—'
    const d = ((curr - prev) / Math.abs(prev)) * 100
    return <span className={d >= 0 ? 'text-green-600' : 'text-red-500'}>{d > 0 ? '+' : ''}{d.toFixed(0)}%</span>
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <KpiCard label={`Crecimiento Revenue ${MESES[mes]}`} value={y26.revenue && y25.revenue ? `${((y26.revenue - y25.revenue) / y25.revenue * 100).toFixed(0)}%` : '—'} color="green" />
        <KpiCard label="Δ Margen" value={y26.margen_pct && y25.margen_pct ? `${(y26.margen_pct - y25.margen_pct).toFixed(1)}pp` : '—'} color="blue" />
        <KpiCard label="Δ Envíos" value={y26.envios && y25.envios ? `+${(y26.envios - y25.envios).toLocaleString()} (${((y26.envios - y25.envios) / y25.envios * 100).toFixed(0)}%)` : '—'} />
      </div>

      <div className="card p-0 overflow-hidden">
        <h3 className="text-sm font-semibold p-4 pb-2">Comparativa {MESES[mes]}</h3>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-500 uppercase bg-gray-50"><th className="text-left px-3 py-2">Métrica</th><th className="text-right px-3 py-2">2024</th><th className="text-right px-3 py-2">2025</th><th className="text-right px-3 py-2">2026</th><th className="text-right px-3 py-2">Δ YoY</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {[
                ['Envíos', y24.envios, y25.envios, y26.envios, v => v?.toLocaleString() || '0'],
                ['Revenue', y24.revenue, y25.revenue, y26.revenue, fmt],
                ['Costo', y24.cost, y25.cost, y26.cost, fmt],
                ['Resultado', y24.resultado, y25.resultado, y26.resultado, fmt],
                ['Margen %', y24.margen_pct, y25.margen_pct, y26.margen_pct, v => v != null ? `${v}%` : '—'],
                ['Rev/envío', y24.rev_envio, y25.rev_envio, y26.rev_envio, fmtFull],
                ['CPD', y24.cpd, y25.cpd, y26.cpd, fmtFull],
                ['Sellers activos', y24.sellers_activos, y25.sellers_activos, y26.sellers_activos, v => v || 0],
                ['Drivers activos', y24.drivers_activos, y25.drivers_activos, y26.drivers_activos, v => v || 0],
              ].map(([label, v24, v25, v26, formatter], i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-600 font-medium">{label}</td>
                  <td className="text-right px-3 py-2">{formatter(v24)}</td>
                  <td className="text-right px-3 py-2">{formatter(v25)}</td>
                  <td className="text-right px-3 py-2 font-semibold">{formatter(v26)}</td>
                  <td className="text-right px-3 py-2">{delta(v26, v25)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-4">
        <h3 className="text-sm font-semibold mb-3">Revenue mensual por año</h3>
        <SimpleBar data={data.chart} labelKey="label" bars={['revenue_2024', 'revenue_2025', 'revenue_2026']} colors={['bg-gray-400', 'bg-blue-400', 'bg-green-500']} />
      </div>

      <div className="card p-4 bg-amber-50 border-amber-200">
        <p className="text-sm text-amber-700 flex items-center gap-2"><Info size={14} /> 2024-2025: datos operacionales. Sin CCC, pagos detallados ni movimientos financieros completos.</p>
      </div>
    </div>
  )
}

function TabSalud({ mes, anio }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.get('/bi/salud', { params: { mes, anio } }).then(r => setData(r.data)).catch(() => toast.error('Error')).finally(() => setLoading(false))
  }, [mes, anio])

  if (loading) return <Loader />
  if (!data) return null
  const { concentracion: c, retencion: r } = data

  return (
    <div className="space-y-6">
      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Concentración de sellers</h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Sellers activos" value={c.total_sellers} />
        <KpiCard label="Top 5 = % revenue" value={`${c.top5_pct}%`} color={c.top5_pct > 50 ? 'amber' : 'green'} />
        <KpiCard label="Top 10 = % revenue" value={`${c.top10_pct}%`} />
        <KpiCard label="Índice HHI" value={c.hhi.toFixed(4)} sub={c.hhi < 0.15 ? 'Mercado diversificado' : c.hhi < 0.25 ? 'Concentración moderada' : 'Alta concentración'} color={c.hhi < 0.15 ? 'green' : 'amber'} />
      </div>

      <div className="card p-0 overflow-hidden">
        <h3 className="text-sm font-semibold p-4 pb-2">Ranking de sellers (Top 30)</h3>
        <DataTable columns={[
          { label: '#', key: 'rank' },
          { label: 'Seller', key: 'nombre', render: r => <span className="font-medium">{r.nombre}</span> },
          { label: 'Envíos', key: 'envios', align: 'right', render: r => r.envios.toLocaleString() },
          { label: 'Revenue', key: 'revenue', align: 'right', render: r => fmt(r.revenue) },
          { label: '% del total', key: 'pct', align: 'right', render: r => `${r.pct}%` },
          { label: '% acumulado', key: 'pct_acum', align: 'right', render: r => {
            const w = Math.min(r.pct_acum, 100)
            return <div className="flex items-center gap-2 justify-end"><div className="w-16 bg-gray-100 rounded-full h-1.5"><div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${w}%` }} /></div><span className="text-xs">{r.pct_acum}%</span></div>
          }},
        ]} data={c.ranking} />
      </div>

      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mt-8">Retención y Churn</h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Tasa retención" value={`${r.tasa}%`} color={r.tasa >= 90 ? 'green' : r.tasa >= 75 ? 'amber' : 'red'} />
        <KpiCard label="Sellers nuevos" value={r.nuevos} color="green" sub="Este mes" />
        <KpiCard label="Churn" value={r.churn} color={r.churn > 10 ? 'red' : 'amber'} sub="Dejaron de enviar" />
        <KpiCard label="Sellers activos" value={r.sellers_activos} />
      </div>

      {r.en_riesgo.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <h3 className="text-sm font-semibold p-4 pb-2 flex items-center gap-2"><AlertTriangle size={14} className="text-amber-500" /> Sellers en riesgo (caída &gt;30% envíos)</h3>
          <DataTable columns={[
            { label: 'Seller', key: 'nombre', render: r => <span className="font-medium">{r.nombre}</span> },
            { label: 'M-3', key: 'e3', align: 'right', render: r => r.envios[0] },
            { label: 'M-2', key: 'e2', align: 'right', render: r => r.envios[1] },
            { label: 'M-1', key: 'e1', align: 'right', render: r => r.envios[2] },
            { label: 'Actual', key: 'e0', align: 'right', render: r => <span className="font-medium">{r.envios[3]}</span> },
            { label: 'Tendencia', key: 'tendencia_pct', align: 'right', render: r => <span className="text-red-600 font-medium">{r.tendencia_pct}%</span> },
          ]} data={r.en_riesgo} />
        </div>
      )}
    </div>
  )
}

// ═══════════ GROK PANEL ═══════════

function GrokPanel({ open, onClose, mes, anio, activeTab }) {
  const [pregunta, setPregunta] = useState('')
  const [contextos, setContextos] = useState({ pnl: true, unit: false, rent: false, ccc: false })
  const [respuesta, setRespuesta] = useState(null)
  const [tokens, setTokens] = useState(null)
  const [loading, setLoading] = useState(false)
  const [historial, setHistorial] = useState([])
  const endRef = useRef(null)

  const toggleCtx = (k) => setContextos(prev => ({ ...prev, [k]: !prev[k] }))

  const ctxLabels = { pnl: `P&L ${MESES[mes]} ${anio}`, unit: 'Unit Economics', rent: 'Rentabilidad Sellers', ccc: 'CCC / Liquidez' }
  const estimatedTokens = Object.values(contextos).filter(Boolean).length * 400 + 200

  const enviar = async () => {
    if (!pregunta.trim()) return
    setLoading(true)
    const ctxBlocks = []
    if (contextos.pnl) ctxBlocks.push(`Período: ${MESES[mes]} ${anio}. Tab activo: ${activeTab}. Datos de P&L operacional + movimientos financieros.`)
    if (contextos.unit) ctxBlocks.push('Incluye unit economics por zona: revenue/envío, cost/envío, margen/envío.')
    if (contextos.rent) ctxBlocks.push('Incluye rentabilidad por seller con margen % y envíos.')
    if (contextos.ccc) ctxBlocks.push('Incluye datos de CCC: capital atrapado y sellers con deuda pendiente (solo 2026).')

    try {
      const { data } = await api.post('/bi/grok', { pregunta: pregunta.trim(), contexto: ctxBlocks })
      setRespuesta(data.respuesta)
      setTokens(data.tokens)
      setHistorial(prev => [...prev, { q: pregunta, a: data.respuesta, t: data.tokens }])
      setPregunta('')
    } catch {
      toast.error('Error conectando con Grok')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [historial])

  if (!open) return null

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-[420px] bg-white shadow-2xl z-50 flex flex-col border-l border-gray-200">
      <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-900 text-white">
        <div className="flex items-center gap-2"><Brain size={18} /> <span className="font-semibold">Grok AI</span></div>
        <button onClick={onClose} className="p-1 hover:bg-gray-700 rounded"><X size={18} /></button>
      </div>

      <div className="px-4 py-3 border-b bg-gray-50">
        <p className="text-xs text-gray-500 font-medium mb-2">Contexto a inyectar:</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(ctxLabels).map(([k, label]) => (
            <button key={k} onClick={() => toggleCtx(k)} className={`text-xs px-2 py-1 rounded-full border transition-colors ${contextos[k] ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-500'}`}>{contextos[k] ? '✓ ' : ''}{label}</button>
          ))}
        </div>
        <p className="text-[10px] text-gray-400 mt-1.5">~{estimatedTokens} tokens estimados</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {historial.map((h, i) => (
          <div key={i} className="space-y-2">
            <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-900">{h.q}</div>
            <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-800 whitespace-pre-wrap">{h.a}</div>
            {h.t && <p className="text-[10px] text-gray-400 text-right">Tokens: {h.t.total_tokens || '—'}</p>}
          </div>
        ))}
        {loading && <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={16} className="animate-spin" /> Grok está pensando...</div>}
        <div ref={endRef} />
      </div>

      <div className="border-t px-4 py-3">
        <div className="flex gap-2">
          <input value={pregunta} onChange={e => setPregunta(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && enviar()}
            placeholder="Pregunta a Grok..." className="flex-1 input-field text-sm" disabled={loading} />
          <button onClick={enviar} disabled={loading || !pregunta.trim()} className="btn-primary px-3"><Send size={16} /></button>
        </div>
      </div>
    </div>
  )
}

function Loader() {
  return <div className="flex items-center justify-center py-20"><Loader2 size={32} className="animate-spin text-gray-400" /></div>
}

// ═══════════ MAIN PAGE ═══════════

const TABS = [
  { key: 'pnl', label: 'P&L', icon: DollarSign },
  { key: 'unit', label: 'Unit Economics', icon: Target },
  { key: 'rent', label: 'Rentabilidad', icon: TrendingUp },
  { key: 'costos', label: 'Costos', icon: ArrowDownRight },
  { key: 'yoy', label: 'YoY', icon: BarChart3 },
  { key: 'salud', label: 'Salud', icon: Users },
]

export default function BusinessIntelligence() {
  const now = new Date()
  const [mes, setMes] = useState(now.getMonth() + 1)
  const [anio, setAnio] = useState(now.getFullYear())
  const [tab, setTab] = useState('pnl')
  const [empresa, setEmpresa] = useState('')
  const [zona, setZona] = useState('')
  const [grokOpen, setGrokOpen] = useState(false)

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2"><BarChart3 size={28} className="text-primary-600" /> Business Intelligence</h1>
          <p className="page-subtitle">Análisis financiero y operacional de E-Courier</p>
        </div>
      </div>

      <div className="card p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="text-xs text-gray-500 block mb-0.5">Mes</label>
            <select value={mes} onChange={e => setMes(+e.target.value)} className="input-field w-32 text-sm">
              {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-0.5">Año</label>
            <select value={anio} onChange={e => setAnio(+e.target.value)} className="input-field w-24 text-sm">
              {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-0.5">Empresa</label>
            <select value={empresa} onChange={e => setEmpresa(e.target.value)} className="input-field w-32 text-sm">
              <option value="">Todas</option>
              <option value="ECOURIER">ECOURIER</option>
              <option value="OVIEDO">OVIEDO</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-0.5">Zona</label>
            <select value={zona} onChange={e => setZona(e.target.value)} className="input-field w-32 text-sm">
              <option value="">Todas</option>
              <option value="santiago">Santiago</option>
              <option value="valparaiso">Valparaíso</option>
              <option value="melipilla">Melipilla</option>
            </select>
          </div>
        </div>
      </div>

      <div className="flex overflow-x-auto bg-gray-100 rounded-lg p-0.5 gap-0.5">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`flex items-center gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 rounded-md text-xs sm:text-sm font-medium whitespace-nowrap transition-colors ${tab === t.key ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'pnl' && <TabPnL mes={mes} anio={anio} empresa={empresa} zona={zona} />}
      {tab === 'unit' && <TabUnitEconomics mes={mes} anio={anio} />}
      {tab === 'rent' && <TabRentabilidad mes={mes} anio={anio} />}
      {tab === 'costos' && <TabCostos mes={mes} anio={anio} />}
      {tab === 'yoy' && <TabYoY mes={mes} />}
      {tab === 'salud' && <TabSalud mes={mes} anio={anio} />}

      <button onClick={() => setGrokOpen(true)} className="fixed bottom-6 right-6 bg-gray-900 text-white p-3 sm:p-4 rounded-full shadow-lg hover:bg-gray-800 transition-colors z-40" title="Preguntar a Grok">
        <Brain size={22} />
      </button>

      <GrokPanel open={grokOpen} onClose={() => setGrokOpen(false)} mes={mes} anio={anio} activeTab={tab} />
    </div>
  )
}
