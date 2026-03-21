import React, { useState, useEffect, useRef } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import {
  BarChart3, TrendingUp, TrendingDown, Minus, Users, Truck, Store,
  DollarSign, Target, AlertTriangle, Brain, Send, X,
  Loader2, Info, Activity, Zap, ShieldCheck,
} from 'lucide-react'

// ─── Design tokens (dark theme) ───────────────────────────────────────────────
// bg:    #0d0d0d  surface: #161616  card: #1e1e1e  border: #2a2a2a
// accent: #e8521a (orange)  accent2: #f97316 (lighter orange)
// text:  #f0f0f0  muted: #8a8a8a  dimmed: #555
// green: #22c55e  red: #ef4444  blue: #60a5fa  amber: #f59e0b

const C = {
  bg: '#0d0d0d',
  surface: '#161616',
  card: '#1e1e1e',
  cardHover: '#242424',
  border: '#2a2a2a',
  borderStrong: '#383838',
  accent: '#e8521a',
  accentHover: '#f97316',
  accentDim: 'rgba(232,82,26,0.12)',
  text: '#f0f0f0',
  muted: '#8a8a8a',
  dimmed: '#555555',
  green: '#22c55e',
  greenDim: 'rgba(34,197,94,0.12)',
  red: '#ef4444',
  redDim: 'rgba(239,68,68,0.12)',
  blue: '#60a5fa',
  blueDim: 'rgba(96,165,250,0.12)',
  amber: '#f59e0b',
  amberDim: 'rgba(245,158,11,0.12)',
}

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const MESES_S = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

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

// ─── Primitive components ──────────────────────────────────────────────────────

function Delta({ current, previous, invert = false }) {
  const d = pctDelta(current, previous)
  if (d === null) return <span style={{ color: C.dimmed, fontSize: 11 }}>— sin prev.</span>
  const good = invert ? d <= 0 : d >= 0
  const color = good ? C.green : C.red
  return (
    <span style={{ color, fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}>
      {good ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {d > 0 ? '+' : ''}{d.toFixed(1)}%
    </span>
  )
}

function KpiCard({ label, value, prev, prevVal, accent = false, color, sub, invert = false, wide = false }) {
  const valColor = color === 'green' ? C.green : color === 'red' ? C.red : color === 'blue' ? C.blue : color === 'amber' ? C.amber : C.text
  return (
    <div style={{
      background: C.card, border: `1px solid ${accent ? C.accent : C.border}`,
      borderRadius: 12, padding: '16px 18px',
      boxShadow: accent ? `0 0 0 1px ${C.accent}33` : 'none',
      gridColumn: wide ? 'span 2' : undefined,
    }}>
      <p style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{label}</p>
      <p style={{ color: valColor, fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>{value}</p>
      {sub && <p style={{ color: C.dimmed, fontSize: 11, marginTop: 3 }}>{sub}</p>}
      {(prev !== undefined || prevVal !== undefined) && (
        <div style={{ marginTop: 6 }}>
          <Delta current={typeof value === 'string' ? parseFloat(value.replace(/[^-\d.]/g, '')) : value} previous={prevVal ?? prev} invert={invert} />
        </div>
      )}
    </div>
  )
}

function DarkCard({ title, icon: Icon, children, noPad = false }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
      {title && (
        <div style={{ padding: '14px 18px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
          {Icon && <Icon size={14} style={{ color: C.accent }} />}
          <span style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>{title}</span>
        </div>
      )}
      <div style={noPad ? {} : { padding: '16px 18px' }}>{children}</div>
    </div>
  )
}

function DarkTable({ columns, data, maxH = 400 }) {
  return (
    <div style={{ overflowY: 'auto', maxHeight: maxH }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead style={{ position: 'sticky', top: 0, background: C.surface, zIndex: 1 }}>
          <tr>
            {columns.map((c, i) => (
              <th key={i} style={{ padding: '8px 12px', textAlign: c.align === 'right' ? 'right' : 'left', color: C.muted, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${C.border}` }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}
              onMouseEnter={e => e.currentTarget.style.background = C.cardHover}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              {columns.map((c, j) => (
                <td key={j} style={{ padding: '8px 12px', textAlign: c.align === 'right' ? 'right' : 'left', color: C.text, whiteSpace: 'nowrap' }}>
                  {c.render ? c.render(row, i) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BarChart({ data, labelKey, bars, colors, height = 180 }) {
  const max = Math.max(...data.flatMap(d => bars.map(b => Math.abs(d[b] || 0))), 1)
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, minHeight: height, minWidth: data.length * 52 }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 40 }}>
            <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: height - 24 }}>
              {bars.map((b, j) => {
                const v = d[b] || 0
                const h = Math.max((Math.abs(v) / max) * (height - 24), 2)
                return (
                  <div key={j} title={`${b}: ${fmtFull(v)}`}
                    style={{ height: h, minWidth: 9, borderRadius: '3px 3px 0 0', background: colors[j], opacity: 0.85, transition: 'opacity 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                    onMouseLeave={e => e.currentTarget.style.opacity = '0.85'}
                  />
                )
              })}
            </div>
            <span style={{ fontSize: 9, color: C.muted, whiteSpace: 'nowrap' }}>{d[labelKey]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ProgressBar({ value, max, color = C.accent }) {
  const pct = max > 0 ? Math.min(value / max * 100, 100) : 0
  return (
    <div style={{ background: C.surface, borderRadius: 4, height: 4, width: '100%', overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 4, transition: 'width 0.4s ease' }} />
    </div>
  )
}

function DarkLoader() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '80px 0' }}>
      <Loader2 size={28} style={{ color: C.accent, animation: 'spin 1s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

function InfoBanner({ children, type = 'amber' }) {
  const color = type === 'amber' ? C.amber : type === 'green' ? C.green : C.blue
  return (
    <div style={{ background: `${color}15`, border: `1px solid ${color}40`, borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
      <Info size={13} style={{ color, flexShrink: 0 }} />
      <span style={{ color: `${color}dd`, fontSize: 12 }}>{children}</span>
    </div>
  )
}

// ─── TAB COMPONENTS ───────────────────────────────────────────────────────────

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
  if (loading) return <DarkLoader />
  if (!data) return null
  const { resumen: r, desglose_ingresos: di, desglose_egresos: de, ccc, chart } = data

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard label="Ingresos" value={fmt(r.total_ingresos)} prevVal={r.total_ingresos_ant} color="green" />
        <KpiCard label="Egresos" value={fmt(r.total_egresos)} prevVal={r.total_egresos_ant} color="red" invert />
        <KpiCard label="Resultado" value={fmt(r.resultado)} prevVal={r.resultado_ant} color={r.resultado >= 0 ? 'green' : 'red'} accent={r.resultado > 0} />
        <KpiCard label="Margen neto" value={`${r.margen}%`} sub={`${r.envios.toLocaleString()} envíos`} color="blue" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <DarkCard title="Desglose Ingresos" icon={TrendingUp}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Object.entries(di).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: C.muted, fontSize: 13 }}>{k.replace('manual_', '').replace(/_/g, ' ')}</span>
                <span style={{ color: C.green, fontWeight: 600, fontSize: 13 }}>{fmtFull(v)}</span>
              </div>
            ))}
          </div>
        </DarkCard>
        <DarkCard title="Desglose Egresos" icon={TrendingDown}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Object.entries(de).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: C.muted, fontSize: 13 }}>{k.replace('manual_', '').replace(/_/g, ' ')}</span>
                <span style={{ color: C.red, fontWeight: 600, fontSize: 13 }}>{fmtFull(v)}</span>
              </div>
            ))}
          </div>
        </DarkCard>
      </div>

      {ccc && (
        <DarkCard title="Liquidez y Cash Conversion" icon={AlertTriangle}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
            <KpiCard label="Capital atrapado" value={fmt(ccc.capital_atrapado)} color="amber" />
            <KpiCard label="Facturado" value={fmt(ccc.total_facturado)} />
            <KpiCard label="Cobrado" value={fmt(ccc.total_cobrado)} color="green" />
            <KpiCard label="% Cobrado" value={`${ccc.pct_cobrado}%`} color="blue" />
          </div>
          {ccc.top_slow.length > 0 && (
            <DarkTable columns={[
              { label: '#', render: (_, i) => <span style={{ color: C.dimmed }}>{i + 1}</span> },
              { label: 'Seller', key: 'nombre', render: r => <span style={{ color: C.text, fontWeight: 500 }}>{r.nombre}</span> },
              { label: 'Facturado', align: 'right', render: r => <span style={{ color: C.muted }}>{fmtFull(r.facturado)}</span> },
              { label: 'Cobrado', align: 'right', render: r => <span style={{ color: C.green }}>{fmtFull(r.cobrado)}</span> },
              { label: 'Pendiente', align: 'right', render: r => <span style={{ color: C.red, fontWeight: 600 }}>{fmtFull(r.pendiente)}</span> },
            ]} data={ccc.top_slow} maxH={240} />
          )}
        </DarkCard>
      )}
      {!ccc && anio < 2026 && <InfoBanner>CCC solo disponible para 2026 — sin datos de pagos para años anteriores.</InfoBanner>}

      <DarkCard title={`P&L Mensual ${anio}`} icon={BarChart3}>
        <BarChart data={chart} labelKey="label" bars={['ingresos', 'egresos', 'resultado']} colors={[C.green, C.red, C.accent]} />
        <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
          {[['Ingresos', C.green], ['Egresos', C.red], ['Resultado', C.accent]].map(([l, c]) => (
            <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: C.muted }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: c, display: 'inline-block' }} />{l}
            </span>
          ))}
        </div>
      </DarkCard>
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
  if (loading) return <DarkLoader />
  if (!data) return null
  const { total: t, prev: p, zonas, chart } = data

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard label="Revenue / Envío" value={fmtFull(t.rev_envio)} prevVal={p.rev_envio} color="green" />
        <KpiCard label="Costo / Envío" value={fmtFull(t.cost_envio)} prevVal={p.cost_envio} color="red" invert />
        <KpiCard label="Margen / Envío" value={fmtFull(t.margen_envio)} prevVal={p.margen_envio} color="blue" />
        <KpiCard label="Total Envíos" value={t.envios.toLocaleString()} prevVal={p.envios} sub={`Margen ${t.margen_pct}%`} />
      </div>

      <DarkCard title="Unit Economics por Zona" icon={Target} noPad>
        <DarkTable columns={[
          { label: 'Zona', key: 'zona', render: r => <span style={{ color: C.text, fontWeight: 500 }}>{r.zona}</span> },
          { label: 'Envíos', align: 'right', render: r => <span style={{ color: C.muted }}>{r.envios.toLocaleString()}</span> },
          { label: 'Rev/env', align: 'right', render: r => <span style={{ color: C.green }}>{fmtFull(r.rev_envio)}</span> },
          { label: 'Cost/env', align: 'right', render: r => <span style={{ color: C.red }}>{fmtFull(r.cost_envio)}</span> },
          { label: 'Margen/env', align: 'right', render: r => <span style={{ color: C.blue }}>{fmtFull(r.margen_envio)}</span> },
          { label: 'Margen %', align: 'right', render: r => {
            const col = r.margen_pct >= 25 ? C.green : r.margen_pct >= 0 ? C.amber : C.red
            return <span style={{ color: col, fontWeight: 600 }}>{r.margen_pct}%</span>
          }},
        ]} data={zonas} />
      </DarkCard>

      <DarkCard title={`Evolución ${anio}`} icon={Activity}>
        <BarChart data={chart} labelKey="label" bars={['rev_envio', 'cost_envio', 'margen_envio']} colors={[C.green, C.red, C.accent]} height={150} />
      </DarkCard>
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

  if (loading) return <DarkLoader />

  const subTabs = [['sellers', 'Sellers', Users], ['drivers', 'Drivers', Truck], ['pickups', 'Pickups', Store]]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 4, background: C.surface, borderRadius: 8, padding: 3, width: 'fit-content', border: `1px solid ${C.border}` }}>
        {subTabs.map(([k, l, Icon]) => (
          <button key={k} onClick={() => setSubTab(k)} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 6,
            fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s', border: 'none',
            background: subTab === k ? C.accent : 'transparent',
            color: subTab === k ? '#fff' : C.muted,
          }}>
            <Icon size={13} /> {l}
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard label="Sellers activos" value={data.total_sellers} />
        <KpiCard label="Revenue total" value={fmt(data.total_revenue)} color="green" />
        <KpiCard label="Margen promedio" value={`${data.avg_margin_pct}%`} color="blue" />
        <KpiCard label="Top Seller" value={data.best?.nombre?.split(' ')[0] || '—'} sub={data.best ? `Margen ${data.best.margin_pct}%` : ''} color="amber" />
      </div>
      <DarkCard title="Ranking Sellers" noPad>
        <DarkTable columns={[
          { label: '#', render: (_, i) => <span style={{ color: C.dimmed, fontSize: 12 }}>{i + 1}</span> },
          { label: 'Seller', render: r => <span style={{ color: C.text, fontWeight: 500 }}>{r.nombre}</span> },
          { label: 'Tipo pago', render: r => {
            const colors = { mensual: C.blue, quincenal: '#a78bfa', semanal: C.dimmed }
            const c = colors[r.tipo_pago] || C.dimmed
            return <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 20, border: `1px solid ${c}44`, color: c, background: `${c}15` }}>{r.tipo_pago}</span>
          }},
          { label: 'Envíos', align: 'right', render: r => <span style={{ color: C.muted }}>{r.envios.toLocaleString()}</span> },
          { label: 'Revenue', align: 'right', render: r => <span style={{ color: C.text }}>{fmt(r.revenue)}</span> },
          { label: 'Costo', align: 'right', render: r => <span style={{ color: C.muted }}>{fmt(r.cost)}</span> },
          { label: 'Margen', align: 'right', render: r => <span style={{ color: C.green, fontWeight: 600 }}>{fmt(r.margin)}</span> },
          { label: '%', align: 'right', render: r => {
            const col = r.margin_pct >= 25 ? C.green : r.margin_pct >= 0 ? C.amber : C.red
            return <span style={{ color: col, fontWeight: 700 }}>{r.margin_pct}%</span>
          }},
        ]} data={data.sellers} />
      </DarkCard>
    </div>
  )
}

function RentDrivers({ data }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <KpiCard label="Drivers activos" value={data.total_drivers} />
        <KpiCard label="Contratados" value={data.drivers.filter(d => d.contratado).length} sub="Flota propia" color="amber" />
        <KpiCard label="Tercerizados" value={data.drivers.filter(d => !d.contratado).length} sub="Externos" />
      </div>
      <DarkCard title="Ranking Drivers" noPad>
        <DarkTable columns={[
          { label: '#', render: (_, i) => <span style={{ color: C.dimmed, fontSize: 12 }}>{i + 1}</span> },
          { label: 'Driver', render: r => <span style={{ color: C.text, fontWeight: 500 }}>{r.nombre}</span> },
          { label: 'Tipo', render: r => <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 20, border: `1px solid ${r.contratado ? C.accent : C.dimmed}44`, color: r.contratado ? C.accent : C.dimmed, background: `${r.contratado ? C.accent : C.dimmed}15` }}>{r.contratado ? 'Contratado' : 'Tercerizado'}</span> },
          { label: 'Envíos', align: 'right', render: r => <span style={{ color: C.muted }}>{r.envios.toLocaleString()}</span> },
          { label: 'Revenue', align: 'right', render: r => <span style={{ color: C.text }}>{fmt(r.revenue)}</span> },
          { label: 'Margen %', align: 'right', render: r => {
            const col = r.margin_pct >= 25 ? C.green : r.margin_pct >= 0 ? C.amber : C.red
            return <span style={{ color: col, fontWeight: 700 }}>{r.margin_pct}%</span>
          }},
          { label: 'Payout %', align: 'right', render: r => <span style={{ color: C.muted }}>{r.payout_pct}%</span> },
        ]} data={data.drivers} />
      </DarkCard>
    </div>
  )
}

function RentPickups({ data }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <KpiCard label="Pickups activos" value={data.pickups.length} />
        <KpiCard label="Envíos vía pickup" value={data.pickups.reduce((a, p) => a + p.envios, 0).toLocaleString()} />
      </div>
      <DarkCard title="Detalle Pickups" noPad>
        <DarkTable columns={[
          { label: '#', render: (_, i) => <span style={{ color: C.dimmed }}>{i + 1}</span> },
          { label: 'Pickup', render: r => <span style={{ color: C.text, fontWeight: 500 }}>{r.nombre}</span> },
          { label: 'Envíos', align: 'right', render: r => <span style={{ color: C.muted }}>{r.envios.toLocaleString()}</span> },
          { label: 'Costo total', align: 'right', render: r => <span style={{ color: C.red }}>{fmtFull(r.costo)}</span> },
          { label: 'Com/paq', align: 'right', render: r => <span style={{ color: C.muted }}>{fmtFull(r.comision_unitaria)}</span> },
        ]} data={data.pickups} />
      </DarkCard>
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
  if (loading) return <DarkLoader />
  if (!data) return null
  const { contratado: ct, tercerizado: tc, composicion } = data
  const compEntries = Object.entries(composicion).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  const compMax = compEntries[0]?.[1] || 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <KpiCard label="Costo total" value={fmt(data.total_cost)} color="red" />
        <KpiCard label="CPD Promedio" value={fmtFull(data.cpd_promedio)} />
        <KpiCard label="Driver Payout %" value={`${data.payout_pct}%`} color="amber" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <DarkCard title="Composición de costos">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {compEntries.map(([k, v]) => (
              <div key={k}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: C.muted, fontSize: 12 }}>{k.replace(/_/g, ' ')}</span>
                  <span style={{ color: C.text, fontSize: 12, fontWeight: 600 }}>{fmtFull(v)}</span>
                </div>
                <ProgressBar value={v} max={compMax} color={C.accent} />
              </div>
            ))}
          </div>
        </DarkCard>

        <DarkCard title="Contratado vs Tercerizado">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', color: C.dimmed, fontSize: 10, textTransform: 'uppercase', paddingBottom: 8 }}>Métrica</th>
                <th style={{ textAlign: 'right', color: C.accent, fontSize: 10, textTransform: 'uppercase', paddingBottom: 8 }}>Contratado</th>
                <th style={{ textAlign: 'right', color: C.muted, fontSize: 10, textTransform: 'uppercase', paddingBottom: 8 }}>Tercerizado</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Envíos', ct.envios?.toLocaleString(), tc.envios?.toLocaleString()],
                ['Revenue', fmt(ct.revenue), fmt(tc.revenue)],
                ['Costo', fmt(ct.cost), fmt(tc.cost)],
                ['Margen %', `${ct.margin_pct}%`, `${tc.margin_pct}%`],
                ['CPD', fmtFull(ct.cpd), fmtFull(tc.cpd)],
              ].map(([label, cv, tv], i) => (
                <tr key={i} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ padding: '7px 0', color: C.muted }}>{label}</td>
                  <td style={{ textAlign: 'right', color: C.text, fontWeight: 600 }}>{cv}</td>
                  <td style={{ textAlign: 'right', color: C.text }}>{tv}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DarkCard>
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
  if (loading) return <DarkLoader />
  if (!data) return null

  const y24 = data.years[2024] || {}
  const y25 = data.years[2025] || {}
  const y26 = data.years[2026] || {}

  const delta = (curr, prev) => {
    if (!prev) return <span style={{ color: C.dimmed }}>—</span>
    const d = ((curr - prev) / Math.abs(prev)) * 100
    return <span style={{ color: d >= 0 ? C.green : C.red, fontWeight: 600 }}>{d > 0 ? '+' : ''}{d.toFixed(0)}%</span>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <KpiCard label={`Revenue ${MESES[mes]} YoY`} value={y26.revenue && y25.revenue ? `+${((y26.revenue - y25.revenue) / y25.revenue * 100).toFixed(0)}%` : '—'} color="green" />
        <KpiCard label="Δ Margen" value={y26.margen_pct && y25.margen_pct ? `${(y26.margen_pct - y25.margen_pct) > 0 ? '+' : ''}${(y26.margen_pct - y25.margen_pct).toFixed(1)}pp` : '—'} color="blue" />
        <KpiCard label="Δ Envíos" value={y26.envios && y25.envios ? `+${((y26.envios - y25.envios) / y25.envios * 100).toFixed(0)}%` : '—'} sub={y26.envios && y25.envios ? `+${(y26.envios - y25.envios).toLocaleString()} unidades` : ''} />
      </div>

      <DarkCard title={`Comparativa ${MESES[mes]} — 2024 vs 2025 vs 2026`} noPad>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: C.surface }}>
              <tr>
                {['Métrica', '2024', '2025', '2026', 'Δ YoY'].map((h, i) => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: i > 0 ? 'right' : 'left', color: i === 3 ? C.accent : C.muted, fontSize: 11, textTransform: 'uppercase', fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ['Envíos', y24.envios, y25.envios, y26.envios, v => v?.toLocaleString() || '0'],
                ['Revenue', y24.revenue, y25.revenue, y26.revenue, fmt],
                ['Costo', y24.cost, y25.cost, y26.cost, fmt],
                ['Resultado', y24.resultado, y25.resultado, y26.resultado, fmt],
                ['Margen %', y24.margen_pct, y25.margen_pct, y26.margen_pct, v => v != null ? `${v}%` : '—'],
                ['Rev/envío', y24.rev_envio, y25.rev_envio, y26.rev_envio, fmtFull],
                ['CPD', y24.cpd, y25.cpd, y26.cpd, fmtFull],
                ['Sellers', y24.sellers_activos, y25.sellers_activos, y26.sellers_activos, v => v || 0],
                ['Drivers', y24.drivers_activos, y25.drivers_activos, y26.drivers_activos, v => v || 0],
              ].map(([label, v24, v25, v26, f], i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}
                  onMouseEnter={e => e.currentTarget.style.background = C.cardHover}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ padding: '9px 14px', color: C.muted, fontWeight: 500 }}>{label}</td>
                  <td style={{ padding: '9px 14px', textAlign: 'right', color: C.dimmed }}>{f(v24)}</td>
                  <td style={{ padding: '9px 14px', textAlign: 'right', color: C.muted }}>{f(v25)}</td>
                  <td style={{ padding: '9px 14px', textAlign: 'right', color: C.accent, fontWeight: 700 }}>{f(v26)}</td>
                  <td style={{ padding: '9px 14px', textAlign: 'right' }}>{delta(v26, v25)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DarkCard>

      <DarkCard title={`Revenue mensual por año`} icon={BarChart3}>
        <BarChart data={data.chart} labelKey="label" bars={['revenue_2024', 'revenue_2025', 'revenue_2026']} colors={[C.dimmed, C.blue, C.accent]} />
        <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
          {[['2024', C.dimmed], ['2025', C.blue], ['2026', C.accent]].map(([l, c]) => (
            <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: C.muted }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: c, display: 'inline-block' }} />{l}
            </span>
          ))}
        </div>
      </DarkCard>
      <InfoBanner>2024–2025: datos operacionales sin CCC ni movimientos financieros completos.</InfoBanner>
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
  if (loading) return <DarkLoader />
  if (!data) return null
  const { concentracion: c, retencion: r } = data

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <p style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Concentración de sellers</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard label="Sellers activos" value={c.total_sellers} />
        <KpiCard label="Top 5 = % revenue" value={`${c.top5_pct}%`} color={c.top5_pct > 50 ? 'amber' : 'green'} />
        <KpiCard label="Top 10 = % revenue" value={`${c.top10_pct}%`} />
        <KpiCard label="Índice HHI" value={c.hhi.toFixed(4)} sub={c.hhi < 0.15 ? 'Diversificado ✓' : c.hhi < 0.25 ? 'Concentración moderada' : 'Alta concentración'} color={c.hhi < 0.15 ? 'green' : 'amber'} />
      </div>

      <DarkCard title="Pareto — Ranking Sellers (Top 30)" noPad>
        <DarkTable columns={[
          { label: '#', render: r => <span style={{ color: C.dimmed }}>{r.rank}</span> },
          { label: 'Seller', render: r => <span style={{ color: C.text, fontWeight: 500 }}>{r.nombre}</span> },
          { label: 'Envíos', align: 'right', render: r => <span style={{ color: C.muted }}>{r.envios.toLocaleString()}</span> },
          { label: 'Revenue', align: 'right', render: r => <span style={{ color: C.text }}>{fmt(r.revenue)}</span> },
          { label: '% del total', align: 'right', render: r => <span style={{ color: C.muted }}>{r.pct}%</span> },
          { label: '% acumulado', align: 'right', render: row => (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
              <div style={{ width: 64 }}><ProgressBar value={row.pct_acum} max={100} color={row.pct_acum < 50 ? C.accent : row.pct_acum < 80 ? C.amber : C.red} /></div>
              <span style={{ color: C.muted, fontSize: 12, minWidth: 32, textAlign: 'right' }}>{row.pct_acum}%</span>
            </div>
          )},
        ]} data={c.ranking} />
      </DarkCard>

      <p style={{ color: C.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginTop: 8 }}>Retención y Churn</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard label="Tasa retención" value={`${r.tasa}%`} color={r.tasa >= 90 ? 'green' : r.tasa >= 75 ? 'amber' : 'red'} accent={r.tasa >= 90} />
        <KpiCard label="Nuevos sellers" value={r.nuevos} color="green" sub="Este mes" />
        <KpiCard label="Churn" value={r.churn} color={r.churn > 10 ? 'red' : 'amber'} sub="Dejaron de enviar" />
        <KpiCard label="Activos" value={r.sellers_activos} />
      </div>

      {r.en_riesgo.length > 0 && (
        <DarkCard title="Sellers en riesgo — caída >30%" icon={AlertTriangle} noPad>
          <DarkTable columns={[
            { label: 'Seller', render: r => <span style={{ color: C.text, fontWeight: 500 }}>{r.nombre}</span> },
            { label: 'M-3', align: 'right', render: r => <span style={{ color: C.dimmed }}>{r.envios[0]}</span> },
            { label: 'M-2', align: 'right', render: r => <span style={{ color: C.dimmed }}>{r.envios[1]}</span> },
            { label: 'M-1', align: 'right', render: r => <span style={{ color: C.muted }}>{r.envios[2]}</span> },
            { label: 'Actual', align: 'right', render: r => <span style={{ color: C.text, fontWeight: 600 }}>{r.envios[3]}</span> },
            { label: 'Tendencia', align: 'right', render: r => <span style={{ color: C.red, fontWeight: 700 }}>{r.tendencia_pct}%</span> },
          ]} data={r.en_riesgo} />
        </DarkCard>
      )}
    </div>
  )
}

// ─── GROK PANEL ───────────────────────────────────────────────────────────────

function GrokPanel({ open, onClose, mes, anio, activeTab }) {
  const [pregunta, setPregunta] = useState('')
  const [contextos, setContextos] = useState({ pnl: true, unit: false, rent: false, ccc: false })
  const [loading, setLoading] = useState(false)
  const [historial, setHistorial] = useState([])
  const endRef = useRef(null)

  const ctxLabels = { pnl: `P&L ${MESES_S[mes]} ${anio}`, unit: 'Unit Economics', rent: 'Rentabilidad', ccc: 'CCC / Liquidez' }
  const estimatedTokens = Object.values(contextos).filter(Boolean).length * 400 + 200

  const enviar = async () => {
    if (!pregunta.trim()) return
    setLoading(true)
    const ctxBlocks = []
    if (contextos.pnl) ctxBlocks.push(`Período: ${MESES[mes]} ${anio}. Tab activo: ${activeTab}. P&L operacional + movimientos financieros.`)
    if (contextos.unit) ctxBlocks.push('Unit economics por zona: revenue/envío, cost/envío, margen/envío.')
    if (contextos.rent) ctxBlocks.push('Rentabilidad por seller con margen % y envíos.')
    if (contextos.ccc) ctxBlocks.push('CCC: capital atrapado y sellers con deuda pendiente (solo 2026).')
    try {
      const { data } = await api.post('/bi/grok', { pregunta: pregunta.trim(), contexto: ctxBlocks })
      setHistorial(prev => [...prev, { q: pregunta, a: data.respuesta, t: data.tokens }])
      setPregunta('')
    } catch { toast.error('Error conectando con Grok') }
    finally { setLoading(false) }
  }

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [historial])
  if (!open) return null

  return (
    <div style={{
      position: 'fixed', inset: '0 0 0 auto', width: 420, background: '#111', zIndex: 50,
      display: 'flex', flexDirection: 'column', borderLeft: `1px solid ${C.borderStrong}`,
      boxShadow: '-8px 0 32px rgba(0,0,0,0.6)',
    }}>
      <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.borderStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ background: C.accentDim, padding: 6, borderRadius: 8, display: 'flex' }}><Brain size={16} style={{ color: C.accent }} /></div>
          <div>
            <p style={{ color: C.text, fontWeight: 700, fontSize: 14, lineHeight: 1 }}>Grok AI</p>
            <p style={{ color: C.dimmed, fontSize: 10, marginTop: 2 }}>Analista financiero</p>
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.muted, padding: 4, borderRadius: 6 }}
          onMouseEnter={e => e.currentTarget.style.color = C.text}
          onMouseLeave={e => e.currentTarget.style.color = C.muted}>
          <X size={18} />
        </button>
      </div>

      <div style={{ padding: '12px 18px', borderBottom: `1px solid ${C.border}` }}>
        <p style={{ color: C.dimmed, fontSize: 11, marginBottom: 8 }}>Contexto a inyectar:</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {Object.entries(ctxLabels).map(([k, label]) => (
            <button key={k} onClick={() => setContextos(prev => ({ ...prev, [k]: !prev[k] }))}
              style={{
                fontSize: 11, padding: '4px 10px', borderRadius: 20, cursor: 'pointer', transition: 'all 0.15s',
                border: `1px solid ${contextos[k] ? C.accent : C.border}`,
                background: contextos[k] ? C.accentDim : 'transparent',
                color: contextos[k] ? C.accent : C.dimmed,
              }}>
              {contextos[k] ? '✓ ' : ''}{label}
            </button>
          ))}
        </div>
        <p style={{ color: C.dimmed, fontSize: 10, marginTop: 8 }}>~{estimatedTokens} tokens estimados</p>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {historial.length === 0 && (
          <div style={{ color: C.dimmed, fontSize: 13, textAlign: 'center', marginTop: 40 }}>
            <Brain size={32} style={{ color: C.borderStrong, marginBottom: 12, display: 'block', margin: '0 auto 12px' }} />
            Hazle una pregunta a Grok sobre los datos del período.
          </div>
        )}
        {historial.map((h, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ background: C.accentDim, border: `1px solid ${C.accent}33`, borderRadius: 8, padding: '10px 12px', fontSize: 13, color: C.text }}>{h.q}</div>
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', fontSize: 13, color: C.muted, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{h.a}</div>
            {h.t && <p style={{ color: C.dimmed, fontSize: 10, textAlign: 'right' }}>Tokens: {h.t.total_tokens || '—'}</p>}
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.dimmed, fontSize: 13 }}>
            <Loader2 size={14} style={{ color: C.accent, animation: 'spin 1s linear infinite' }} />
            Grok está analizando...
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div style={{ padding: '12px 18px', borderTop: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={pregunta} onChange={e => setPregunta(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && enviar()}
            placeholder="Pregunta sobre los datos..."
            disabled={loading}
            style={{
              flex: 1, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
              padding: '9px 12px', fontSize: 13, color: C.text, outline: 'none',
            }}
            onFocus={e => e.target.style.borderColor = C.accent}
            onBlur={e => e.target.style.borderColor = C.border}
          />
          <button onClick={enviar} disabled={loading || !pregunta.trim()}
            style={{
              background: pregunta.trim() ? C.accent : C.surface, border: 'none', borderRadius: 8,
              padding: '9px 14px', cursor: pregunta.trim() ? 'pointer' : 'default',
              color: pregunta.trim() ? '#fff' : C.dimmed, transition: 'all 0.15s',
            }}>
            <Send size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── MAIN PAGE ─────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'pnl', label: 'P&L', icon: DollarSign },
  { key: 'unit', label: 'Unit Economics', icon: Target },
  { key: 'rent', label: 'Rentabilidad', icon: TrendingUp },
  { key: 'costos', label: 'Costos', icon: Zap },
  { key: 'yoy', label: 'YoY', icon: BarChart3 },
  { key: 'salud', label: 'Salud', icon: ShieldCheck },
]

export default function BusinessIntelligence() {
  const now = new Date()
  const [mes, setMes] = useState(now.getMonth() + 1)
  const [anio, setAnio] = useState(now.getFullYear())
  const [tab, setTab] = useState('pnl')
  const [empresa, setEmpresa] = useState('')
  const [zona, setZona] = useState('')
  const [grokOpen, setGrokOpen] = useState(false)

  const selectStyle = {
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
    color: C.text, padding: '6px 10px', fontSize: 13, outline: 'none', cursor: 'pointer',
  }

  return (
    <div style={{ background: C.bg, minHeight: '100vh', margin: '-12px -12px -12px -12px', padding: '28px 28px 80px' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        * { box-sizing: border-box; }
        select option { background: #1e1e1e; color: #f0f0f0; }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <div style={{ background: C.accentDim, padding: 8, borderRadius: 10, display: 'flex' }}>
              <BarChart3 size={20} style={{ color: C.accent }} />
            </div>
            <h1 style={{ color: C.text, fontSize: 22, fontWeight: 700, margin: 0 }}>Business Intelligence</h1>
          </div>
          <p style={{ color: C.dimmed, fontSize: 13, margin: 0, paddingLeft: 46 }}>Análisis financiero y operacional · E-Courier</p>
        </div>

        {/* Filtros */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {[
            { label: 'Mes', val: mes, set: v => setMes(+v), opts: MESES.slice(1).map((m, i) => ({ v: i + 1, l: m })) },
            { label: 'Año', val: anio, set: v => setAnio(+v), opts: [2024, 2025, 2026].map(y => ({ v: y, l: y })) },
            { label: 'Empresa', val: empresa, set: setEmpresa, opts: [{ v: '', l: 'Todas' }, { v: 'ECOURIER', l: 'ECOURIER' }, { v: 'OVIEDO', l: 'OVIEDO' }] },
            { label: 'Zona', val: zona, set: setZona, opts: [{ v: '', l: 'Todas' }, { v: 'santiago', l: 'Santiago' }, { v: 'valparaiso', l: 'Valparaíso' }, { v: 'melipilla', l: 'Melipilla' }] },
          ].map(({ label, val, set, opts }) => (
            <div key={label}>
              <p style={{ color: C.dimmed, fontSize: 10, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
              <select value={val} onChange={e => set(e.target.value)} style={selectStyle}>
                {opts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 24, borderBottom: `1px solid ${C.border}`, paddingBottom: 1 }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
            fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s',
            border: 'none', borderBottom: `2px solid ${tab === t.key ? C.accent : 'transparent'}`,
            background: 'transparent', color: tab === t.key ? C.text : C.muted,
            marginBottom: -1,
          }}
          onMouseEnter={e => { if (tab !== t.key) e.currentTarget.style.color = C.text }}
          onMouseLeave={e => { if (tab !== t.key) e.currentTarget.style.color = C.muted }}>
            <t.icon size={14} style={{ color: tab === t.key ? C.accent : 'inherit' }} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'pnl' && <TabPnL mes={mes} anio={anio} empresa={empresa} zona={zona} />}
      {tab === 'unit' && <TabUnitEconomics mes={mes} anio={anio} />}
      {tab === 'rent' && <TabRentabilidad mes={mes} anio={anio} />}
      {tab === 'costos' && <TabCostos mes={mes} anio={anio} />}
      {tab === 'yoy' && <TabYoY mes={mes} />}
      {tab === 'salud' && <TabSalud mes={mes} anio={anio} />}

      {/* Grok FAB */}
      <button onClick={() => setGrokOpen(true)}
        style={{
          position: 'fixed', bottom: 28, right: 28, background: C.accent, border: 'none',
          borderRadius: '50%', width: 52, height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', zIndex: 40, boxShadow: `0 4px 20px ${C.accent}66`, transition: 'all 0.2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = C.accentHover; e.currentTarget.style.transform = 'scale(1.08)' }}
        onMouseLeave={e => { e.currentTarget.style.background = C.accent; e.currentTarget.style.transform = 'scale(1)' }}
        title="Preguntar a Grok">
        <Brain size={22} color="#fff" />
      </button>

      <GrokPanel open={grokOpen} onClose={() => setGrokOpen(false)} mes={mes} anio={anio} activeTab={tab} />
    </div>
  )
}
