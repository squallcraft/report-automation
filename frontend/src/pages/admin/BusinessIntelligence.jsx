import React, { useState, useEffect, useRef, useMemo } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import {
  BarChart3, TrendingUp, TrendingDown, Minus, Users, Truck, Store,
  DollarSign, Target, AlertTriangle, Brain, Send, X,
  Loader2, Info, Activity, Zap, ShieldCheck,
  BookOpen, Bookmark, Trash2, ChevronDown, ChevronRight,
  Database, RefreshCw,
} from 'lucide-react'

// ─── Design tokens (light theme — consistente con el resto del sistema) ───────
const C = {
  bg:           '#f8fafc',
  surface:      '#f1f5f9',
  card:         '#ffffff',
  cardHover:    '#f8fafc',
  border:       '#e2e8f0',
  borderStrong: '#cbd5e1',
  accent:       '#1e3a5f',
  accentHover:  '#1e40af',
  accentDim:    'rgba(30,58,95,0.08)',
  text:         '#1e293b',
  muted:        '#64748b',
  dimmed:       '#94a3b8',
  green:        '#16a34a',
  greenDim:     'rgba(22,163,74,0.1)',
  red:          '#dc2626',
  redDim:       'rgba(220,38,38,0.1)',
  blue:         '#2563eb',
  blueDim:      'rgba(37,99,235,0.1)',
  amber:        '#d97706',
  amberDim:     'rgba(217,119,6,0.1)',
}

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const MESES_S = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

function fmt(v) {
  if (v == null) return '$0'
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('es-CL')}`
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
  const [sortCol, setSortCol] = useState(null)
  const [sortDir, setSortDir] = useState('desc')

  const sorted = useMemo(() => {
    if (sortCol === null) return data
    const col = columns[sortCol]
    if (!col.sortVal && !col.key) return data
    return [...data].sort((a, b) => {
      const va = col.sortVal ? col.sortVal(a) : a[col.key]
      const vb = col.sortVal ? col.sortVal(b) : b[col.key]
      if (va === vb) return 0
      if (sortDir === 'asc') return va < vb ? -1 : 1
      return va > vb ? -1 : 1
    })
  }, [data, sortCol, sortDir, columns])

  const handleSort = (i) => {
    const col = columns[i]
    if (!col.sortVal && !col.key) return
    if (sortCol === i) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(i); setSortDir('desc') }
  }

  return (
    <div style={{ overflowY: 'auto', maxHeight: maxH }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead style={{ position: 'sticky', top: 0, background: C.surface, zIndex: 1 }}>
          <tr>
            {columns.map((c, i) => {
              const sortable = !!(c.sortVal || c.key)
              const isActive = sortCol === i
              return (
                <th key={i} onClick={sortable ? () => handleSort(i) : undefined} style={{
                  padding: '8px 12px', textAlign: c.align === 'right' ? 'right' : 'left',
                  color: isActive ? C.accent : C.muted, fontSize: 10, fontWeight: 600,
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  borderBottom: `1px solid ${C.border}`,
                  cursor: sortable ? 'pointer' : 'default',
                  userSelect: 'none', whiteSpace: 'nowrap',
                  transition: 'color 0.15s',
                }}>
                  {c.label}
                  {c.tooltip && <ColTooltip text={c.tooltip} />}
                  {sortable && (
                    <span style={{ marginLeft: 4, opacity: isActive ? 1 : 0.25, fontSize: 9 }}>
                      {isActive ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                    </span>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
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

function BarChart({ data, labelKey, bars, barLabels, colors, height = 180 }) {
  const [tooltip, setTooltip] = useState(null)
  const max = Math.max(...data.flatMap(d => bars.map(b => Math.abs(d[b] || 0))), 1)
  return (
    <div style={{ overflowX: 'auto', position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, minHeight: height, minWidth: data.length * 52 }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 40 }}>
            <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: height - 24 }}>
              {bars.map((b, j) => {
                const v = d[b] || 0
                const h = Math.max((Math.abs(v) / max) * (height - 24), 2)
                const label = barLabels?.[j] || b
                return (
                  <div key={j} style={{ position: 'relative' }}
                    onMouseEnter={() => setTooltip({ col: i, bar: j, label, value: fmtFull(v), sublabel: d[labelKey] })}
                    onMouseLeave={() => setTooltip(null)}>
                    <div style={{ height: h, minWidth: 9, borderRadius: '3px 3px 0 0', background: colors[j], opacity: tooltip?.col === i && tooltip?.bar === j ? 1 : 0.8, transition: 'opacity 0.1s', cursor: 'default' }} />
                    {tooltip?.col === i && tooltip?.bar === j && (
                      <div style={{
                        position: 'absolute', bottom: h + 6, left: '50%', transform: 'translateX(-50%)',
                        background: '#111', border: `1px solid ${C.borderStrong}`, borderRadius: 6,
                        padding: '5px 9px', whiteSpace: 'nowrap', zIndex: 20,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                        pointerEvents: 'none',
                      }}>
                        <p style={{ color: colors[j], fontSize: 10, margin: 0, fontWeight: 600 }}>{label}</p>
                        <p style={{ color: C.text, fontSize: 12, margin: '2px 0 0', fontWeight: 700 }}>{tooltip.value}</p>
                        <div style={{ position: 'absolute', bottom: -5, left: '50%', width: 8, height: 8, background: '#111', border: `1px solid ${C.borderStrong}`, borderTop: 'none', borderLeft: 'none', transform: 'translateX(-50%) rotate(45deg)' }} />
                      </div>
                    )}
                  </div>
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
      <style>{`@keyframes spin { to { transform: rotate(360deg) } } @keyframes grokPulse { 0%, 80%, 100% { opacity: 0.2; transform: scale(0.8) } 40% { opacity: 1; transform: scale(1) } }`}</style>
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

const GLOSSARY = {
  'Revenue': 'Ingresos brutos operacionales: suma del cobro al seller más extras cobrados (bulto, comuna).',
  'Ingresos': 'Total de ingresos del período: revenue operacional + ingresos de software + otros.',
  'Egresos': 'Total de egresos del período: costo drivers + pickups + remuneraciones + servicios + otros.',
  'Resultado': 'Utilidad operacional neta: Ingresos − Egresos. Positivo = ganancia, negativo = pérdida.',
  'Margen %': 'Porcentaje de utilidad sobre los ingresos: Resultado / Ingresos × 100.',
  'Margen neto': 'Porcentaje de utilidad sobre los ingresos totales del período.',
  'CPD': 'Costo Por Despacho: promedio que paga E-Courier al driver por cada envío entregado.',
  'Rev/envío': 'Revenue promedio por envío: cuánto cobra E-Courier al seller por cada paquete.',
  'Payout %': 'Porcentaje del revenue que se destina a pagar al driver. Menor = más eficiente.',
  'CCC': 'Cash Conversion Cycle: días promedio entre que se entrega el paquete y se recibe el pago del seller.',
  'Capital atrapado': 'Dinero en cuentas por cobrar pendientes de pago: revenue entregado pero no cobrado aún.',
  'HHI': 'Índice Herfindahl-Hirschman: concentración del revenue. <0.15 = diversificado · 0.15–0.25 = moderado · >0.25 = alta concentración.',
  'Top 5': 'Los 5 sellers con mayor revenue acumulado en el período. Su % muestra cuánto del total representan.',
  'Δ YoY': 'Variación año sobre año: diferencia porcentual entre el valor actual (2026) y el período equivalente del año anterior (2025).',
  'Margen promedio': 'Promedio ponderado del margen operacional de todos los sellers o drivers activos en el período.',
  'Envíos': 'Cantidad total de paquetes entregados (estado: delivered) en el período.',
  'Contratado': 'Driver con vínculo laboral directo: la empresa paga sueldo, combustible y mantención de vehículo.',
  'Tercerizado': 'Driver independiente: la empresa paga una tarifa por envío, sin costos de nómina.',
}

function ColTooltip({ text }) {
  const [show, setShow] = useState(false)
  if (!text) return null
  return (
    <span style={{ position: 'relative', display: 'inline-flex', marginLeft: 3, verticalAlign: 'middle' }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <Info size={10} style={{ color: C.dimmed, cursor: 'help' }} />
      {show && (
        <div style={{
          position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
          background: '#111', border: `1px solid ${C.borderStrong}`, borderRadius: 8,
          padding: '8px 12px', width: 230, zIndex: 100,
          boxShadow: '0 8px 24px rgba(0,0,0,0.6)', pointerEvents: 'none',
        }}>
          <p style={{ color: C.muted, fontSize: 11, margin: 0, lineHeight: 1.6 }}>{text}</p>
        </div>
      )}
    </span>
  )
}

function InfoTooltip({ term }) {
  const [show, setShow] = useState(false)
  const def = GLOSSARY[term]
  if (!def) return null
  return (
    <span style={{ position: 'relative', display: 'inline-flex', marginLeft: 4, verticalAlign: 'middle' }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <Info size={11} style={{ color: C.dimmed, cursor: 'help' }} />
      {show && (
        <div style={{
          position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)',
          background: '#111', border: `1px solid ${C.borderStrong}`, borderRadius: 8,
          padding: '8px 12px', width: 220, zIndex: 50,
          boxShadow: '0 8px 24px rgba(0,0,0,0.6)', pointerEvents: 'none',
        }}>
          <p style={{ color: C.accent, fontSize: 11, fontWeight: 700, margin: '0 0 4px' }}>{term}</p>
          <p style={{ color: C.muted, fontSize: 11, margin: 0, lineHeight: 1.5 }}>{def}</p>
        </div>
      )}
    </span>
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
        <KpiCard label={<span>Ingresos<InfoTooltip term="Ingresos" /></span>} value={fmt(r.total_ingresos)} prevVal={r.total_ingresos_ant} color="green" />
        <KpiCard label={<span>Egresos<InfoTooltip term="Egresos" /></span>} value={fmt(r.total_egresos)} prevVal={r.total_egresos_ant} color="red" invert />
        <KpiCard label={<span>Resultado<InfoTooltip term="Resultado" /></span>} value={fmt(r.resultado)} prevVal={r.resultado_ant} color={r.resultado >= 0 ? 'green' : 'red'} accent={r.resultado > 0} />
        <KpiCard label={<span>Margen neto<InfoTooltip term="Margen neto" /></span>} value={`${r.margen}%`} sub={`${r.envios.toLocaleString()} envíos`} color="blue" />
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
              { label: 'Seller', key: 'nombre', tooltip: 'Seller con mayor deuda pendiente de cobro en el período.', render: r => <span style={{ color: C.text, fontWeight: 500 }}>{r.nombre}</span> },
              { label: 'Facturado', align: 'right', sortVal: r => r.facturado, tooltip: 'Total facturado a este seller: monto cobrado según facturas emitidas.', render: r => <span style={{ color: C.muted }}>{fmtFull(r.facturado)}</span> },
              { label: 'Cobrado', align: 'right', sortVal: r => r.cobrado, tooltip: 'Monto efectivamente recibido (confirmado en cartola bancaria).', render: r => <span style={{ color: C.green }}>{fmtFull(r.cobrado)}</span> },
              { label: 'Pendiente', align: 'right', sortVal: r => r.pendiente, tooltip: 'Facturado − Cobrado: dinero aún no recibido de este seller. Cuánto nos debe.', render: r => <span style={{ color: C.red, fontWeight: 600 }}>{fmtFull(r.pendiente)}</span> },
            ]} data={ccc.top_slow} maxH={240} />
          )}
        </DarkCard>
      )}
      {!ccc && anio < 2026 && <InfoBanner>CCC solo disponible para 2026 — sin datos de pagos para años anteriores.</InfoBanner>}

      <DarkCard title={`P&L Mensual ${anio}`} icon={BarChart3}>
        <BarChart data={chart} labelKey="label" bars={['ingresos', 'egresos', 'resultado']} barLabels={['Ingresos', 'Egresos', 'Resultado']} colors={[C.green, C.red, C.accent]} />
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
          { label: 'Zona', key: 'zona', tooltip: 'Zona geográfica de entrega (ej: Santiago, Valparaíso). Agrupación de comunas.', render: r => <span style={{ color: C.text, fontWeight: 500 }}>{r.zona}</span> },
          { label: 'Envíos', align: 'right', sortVal: r => r.envios, tooltip: 'Cantidad de paquetes entregados en esta zona durante el período.', render: r => <span style={{ color: C.muted }}>{r.envios.toLocaleString()}</span> },
          { label: 'Rev/env', align: 'right', sortVal: r => r.rev_envio, tooltip: 'Revenue promedio por envío: cuánto cobra E-Courier al seller por cada paquete en esta zona.', render: r => <span style={{ color: C.green }}>{fmtFull(r.rev_envio)}</span> },
          { label: 'Cost/env', align: 'right', sortVal: r => r.cost_envio, tooltip: 'Costo promedio por envío: cuánto paga E-Courier al driver por cada entrega en esta zona.', render: r => <span style={{ color: C.red }}>{fmtFull(r.cost_envio)}</span> },
          { label: 'Margen/env', align: 'right', sortVal: r => r.margen_envio, tooltip: 'Ganancia neta promedio por envío en esta zona: Rev/env − Cost/env.', render: r => <span style={{ color: C.blue }}>{fmtFull(r.margen_envio)}</span> },
          { label: 'Margen %', align: 'right', sortVal: r => r.margen_pct, tooltip: 'Porcentaje de margen sobre el revenue de la zona: Margen / Revenue × 100.', render: r => {
            const col = r.margen_pct >= 25 ? C.green : r.margen_pct >= 0 ? C.amber : C.red
            return <span style={{ color: col, fontWeight: 600 }}>{r.margen_pct}%</span>
          }},
        ]} data={zonas} />
      </DarkCard>

      <DarkCard title={`Evolución ${anio}`} icon={Activity}>
        <BarChart data={chart} labelKey="label" bars={['rev_envio', 'cost_envio', 'margen_envio']} barLabels={['Rev/Envío', 'Costo/Envío', 'Margen/Envío']} colors={[C.green, C.red, C.accent]} height={150} />
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
  const [errors, setErrors] = useState({})

  useEffect(() => {
    setLoading(true)
    setErrors({})
    const p = { mes, anio }
    Promise.allSettled([
      api.get('/bi/rentabilidad/sellers', { params: p }),
      api.get('/bi/rentabilidad/drivers', { params: p }),
      api.get('/bi/rentabilidad/pickups', { params: p }),
    ]).then(([s, d, pk]) => {
      if (s.status === 'fulfilled') setSData(s.value.data)
      else setErrors(e => ({ ...e, sellers: true }))
      if (d.status === 'fulfilled') setDData(d.value.data)
      else setErrors(e => ({ ...e, drivers: true }))
      if (pk.status === 'fulfilled') setPData(pk.value.data)
      else setErrors(e => ({ ...e, pickups: true }))
    }).finally(() => setLoading(false))
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
      {subTab === 'sellers' && (errors.sellers ? <InfoBanner type="blue">Error cargando datos de sellers.</InfoBanner> : sData ? <RentSellers data={sData} /> : null)}
      {subTab === 'drivers' && (errors.drivers ? <InfoBanner type="blue">Error cargando datos de drivers.</InfoBanner> : dData ? <RentDrivers data={dData} /> : null)}
      {subTab === 'pickups' && (errors.pickups ? <InfoBanner type="blue">Error cargando datos de pickups.</InfoBanner> : pData ? <RentPickups data={pData} /> : null)}
    </div>
  )
}

function RentSellers({ data }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard label="Sellers activos" value={data.total_sellers} />
        <KpiCard label={<span>Revenue total<InfoTooltip term="Revenue" /></span>} value={fmt(data.total_revenue)} color="green" />
        <KpiCard label={<span>Margen promedio<InfoTooltip term="Margen promedio" /></span>} value={`${data.avg_margin_pct}%`} color="blue" />
        <KpiCard label="Top Seller" value={data.best?.nombre?.split(' ')[0] || '—'} sub={data.best ? `Margen ${data.best.margin_pct}%` : ''} color="amber" />
      </div>
      <DarkCard title="Ranking Sellers" noPad>
        <DarkTable columns={[
          { label: '#', render: (_, i) => <span style={{ color: C.dimmed, fontSize: 12 }}>{i + 1}</span> },
          { label: 'Seller', key: 'nombre', tooltip: 'Nombre del seller (cliente B2B).', render: r => <span style={{ color: C.text, fontWeight: 500 }}>{r.nombre}</span> },
          { label: 'Tipo pago', key: 'tipo_pago', tooltip: 'Frecuencia de pago acordada con el seller: semanal, quincenal o mensual.', render: r => {
            const colors = { mensual: C.blue, quincenal: '#a78bfa', semanal: C.dimmed }
            const c = colors[r.tipo_pago] || C.dimmed
            return <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 20, border: `1px solid ${c}44`, color: c, background: `${c}15` }}>{r.tipo_pago}</span>
          }},
          { label: 'Envíos', align: 'right', sortVal: r => r.envios, tooltip: 'Cantidad de paquetes entregados de este seller en el período.', render: r => <span style={{ color: C.muted }}>{r.envios.toLocaleString()}</span> },
          { label: 'Revenue', align: 'right', sortVal: r => r.revenue, tooltip: 'Ingresos totales: cobro por envíos + extras cobrados + ingresos por retiros de este seller.', render: r => <span style={{ color: C.text }}>{fmt(r.revenue)}</span> },
          { label: 'Costo', align: 'right', sortVal: r => r.cost, tooltip: 'Costos totales: pago a drivers por envíos + extras pagados + costo de retiros asociados.', render: r => <span style={{ color: C.muted }}>{fmt(r.cost)}</span> },
          { label: 'Margen', align: 'right', sortVal: r => r.margin, tooltip: 'Revenue − Costo. Ganancia bruta que genera este seller para E-Courier.', render: r => <span style={{ color: C.green, fontWeight: 600 }}>{fmt(r.margin)}</span> },
          { label: '%', align: 'right', sortVal: r => r.margin_pct, tooltip: 'Margen sobre revenue: (Revenue − Costo) / Revenue × 100. Verde ≥25%, naranja 0–25%, rojo negativo.', render: r => {
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
          { label: 'Driver', key: 'nombre', tooltip: 'Nombre del conductor.', render: r => <span style={{ color: C.text, fontWeight: 500 }}>{r.nombre}</span> },
          { label: 'Tipo', key: 'contratado', tooltip: 'Contratado = conductor en planilla (sueldo fijo + vehículo). Tercerizado = conductor independiente (pago por envío).', render: r => <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 20, border: `1px solid ${r.contratado ? C.accent : C.dimmed}44`, color: r.contratado ? C.accent : C.dimmed, background: `${r.contratado ? C.accent : C.dimmed}15` }}>{r.contratado ? 'Contratado' : 'Tercerizado'}</span> },
          { label: 'Envíos', align: 'right', sortVal: r => r.envios, tooltip: 'Cantidad de paquetes entregados por este conductor en el período.', render: r => <span style={{ color: C.muted }}>{r.envios.toLocaleString()}</span> },
          { label: 'Revenue', align: 'right', sortVal: r => r.revenue, tooltip: 'Revenue generado por los envíos de este driver (cobro al seller) + ingresos por retiros que realizó.', render: r => <span style={{ color: C.text }}>{fmt(r.revenue)}</span> },
          { label: 'Margen %', align: 'right', sortVal: r => r.margin_pct, tooltip: 'Margen bruto: (Revenue − Costo driver) / Revenue × 100. Nota: para contratados no incluye sueldo ni combustible.', render: r => {
            const col = r.margin_pct >= 25 ? C.green : r.margin_pct >= 0 ? C.amber : C.red
            return <span style={{ color: col, fontWeight: 700 }}>{r.margin_pct}%</span>
          }},
          { label: 'Payout %', align: 'right', sortVal: r => r.payout_pct, tooltip: 'Porcentaje del revenue que se paga al conductor (costo / revenue × 100). Menor = más eficiente para la empresa.', render: r => <span style={{ color: C.muted }}>{r.payout_pct}%</span> },
        ]} data={data.drivers} />
      </DarkCard>
    </div>
  )
}

function RentPickups({ data }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard label="Pickups activos" value={data.pickups.length} />
        <KpiCard label="Recepciones" value={(data.total_recepciones || 0).toLocaleString()} />
        <KpiCard label="Revenue total" value={fmt(data.total_revenue || 0)} color="green" />
        <KpiCard label="Costo total" value={fmt(data.total_costo || 0)} color="red" />
      </div>
      <DarkCard title="Detalle Pickups (como puntos de recepción)" noPad>
        <DarkTable columns={[
          { label: '#', render: (_, i) => <span style={{ color: C.dimmed }}>{i + 1}</span> },
          { label: 'Pickup', key: 'nombre', tooltip: 'Nombre del punto de recepción (sucursal física que recibe paquetes de sellers).', render: r => <span style={{ color: C.text, fontWeight: 500 }}>{r.nombre}</span> },
          { label: 'Recepciones', align: 'right', sortVal: r => r.recepciones, tooltip: 'Cantidad de paquetes recibidos por este pickup durante el período (fuente: tabla recepciones_paquetes).', render: r => <span style={{ color: C.muted }}>{r.recepciones.toLocaleString()}</span> },
          { label: 'Revenue', align: 'right', sortVal: r => r.revenue, tooltip: 'Ingresos totales: cobro al seller por paquetes recepcionados + ingresos por retiros vinculados a este pickup.', render: r => <span style={{ color: C.green }}>{fmtFull(r.revenue)}</span> },
          { label: 'Costo', align: 'right', sortVal: r => r.costo, tooltip: 'Costos totales: comisiones pagadas al pickup por recepción + costo de retiros asociados.', render: r => <span style={{ color: C.red }}>{fmtFull(r.costo)}</span> },
          { label: 'Margen', align: 'right', sortVal: r => r.margin, tooltip: 'Revenue − Costo: ganancia bruta generada por este punto de recepción.', render: r => <span style={{ color: r.margin >= 0 ? C.green : C.red, fontWeight: 600 }}>{fmtFull(r.margin)}</span> },
          { label: 'Margen %', align: 'right', sortVal: r => r.margin_pct, tooltip: 'Porcentaje de margen sobre el revenue: Margen / Revenue × 100.', render: r => {
            const col = r.margin_pct >= 25 ? C.green : r.margin_pct >= 0 ? C.amber : C.red
            return <span style={{ color: col, fontWeight: 700 }}>{r.margin_pct}%</span>
          }},
          { label: 'Com/unid', align: 'right', sortVal: r => r.comision_unitaria, tooltip: 'Comisión promedio pagada al pickup por cada paquete recepcionado.', render: r => <span style={{ color: C.muted }}>{fmtFull(r.comision_unitaria)}</span> },
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

function TabYoY({ mes: mesProp }) {
  const [mesYoY, setMesYoY] = useState(mesProp)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { setMesYoY(mesProp) }, [mesProp])

  useEffect(() => {
    setLoading(true)
    // mes=0 → anual (backend suma todos los meses)
    api.get('/bi/yoy', { params: { mes: mesYoY } })
      .then(r => setData(r.data))
      .catch(() => toast.error('Error'))
      .finally(() => setLoading(false))
  }, [mesYoY])

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

  const periodoLabel = mesYoY === 0 ? 'Anual' : MESES[mesYoY]
  const selStyle = {
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
    color: C.text, padding: '6px 10px', fontSize: 13, outline: 'none', cursor: 'pointer',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Selector de período propio para YoY */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <p style={{ color: C.dimmed, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Período comparado:</p>
        <select value={mesYoY} onChange={e => setMesYoY(+e.target.value)} style={selStyle}>
          <option value={0}>Todos los meses (anual)</option>
          {MESES.slice(1).map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <KpiCard label={`Revenue ${periodoLabel} YoY`} value={y26.revenue && y25.revenue ? `+${((y26.revenue - y25.revenue) / y25.revenue * 100).toFixed(0)}%` : '—'} color="green" />
        <KpiCard label="Δ Margen" value={y26.margen_pct && y25.margen_pct ? `${(y26.margen_pct - y25.margen_pct) > 0 ? '+' : ''}${(y26.margen_pct - y25.margen_pct).toFixed(1)}pp` : '—'} color="blue" />
        <KpiCard label="Δ Envíos" value={y26.envios && y25.envios ? `+${((y26.envios - y25.envios) / y25.envios * 100).toFixed(0)}%` : '—'} sub={y26.envios && y25.envios ? `+${(y26.envios - y25.envios).toLocaleString()} unidades` : ''} />
      </div>

      <DarkCard title={`Comparativa ${periodoLabel} — 2024 vs 2025 vs 2026`} noPad>
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
        <BarChart data={data.chart} labelKey="label" bars={['revenue_2024', 'revenue_2025', 'revenue_2026']} barLabels={['Revenue 2024', 'Revenue 2025', 'Revenue 2026']} colors={[C.dimmed, C.blue, C.accent]} />
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
          { label: '#', sortVal: r => r.rank, tooltip: 'Posición en el ranking ordenada por revenue descendente.', render: r => <span style={{ color: C.dimmed }}>{r.rank}</span> },
          { label: 'Seller', key: 'nombre', tooltip: 'Nombre del seller.', render: r => <span style={{ color: C.text, fontWeight: 500 }}>{r.nombre}</span> },
          { label: 'Envíos', align: 'right', sortVal: r => r.envios, tooltip: 'Cantidad de paquetes entregados en el período.', render: r => <span style={{ color: C.muted }}>{r.envios.toLocaleString()}</span> },
          { label: 'Revenue', align: 'right', sortVal: r => r.revenue, tooltip: 'Revenue total generado por este seller en el período.', render: r => <span style={{ color: C.text }}>{fmt(r.revenue)}</span> },
          { label: '% del total', align: 'right', sortVal: r => r.pct, tooltip: 'Participación de este seller sobre el revenue total de todos los sellers (Pareto).', render: r => <span style={{ color: C.muted }}>{r.pct}%</span> },
          { label: '% acumulado', align: 'right', sortVal: r => r.pct_acum, tooltip: 'Suma acumulada del % de los sellers hasta esta posición. Ej: si el top 5 tiene 70%, esos 5 sellers generan el 70% del revenue total.', render: row => (
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
            { label: 'Seller', key: 'nombre', tooltip: 'Seller cuyas entregas cayeron más del 30% respecto al mes anterior.', render: r => <span style={{ color: C.text, fontWeight: 500 }}>{r.nombre}</span> },
            { label: 'M-3', align: 'right', sortVal: r => r.envios[0], tooltip: 'Envíos hace 3 meses.', render: r => <span style={{ color: C.dimmed }}>{r.envios[0]}</span> },
            { label: 'M-2', align: 'right', sortVal: r => r.envios[1], tooltip: 'Envíos hace 2 meses.', render: r => <span style={{ color: C.dimmed }}>{r.envios[1]}</span> },
            { label: 'M-1', align: 'right', sortVal: r => r.envios[2], tooltip: 'Envíos el mes anterior (base de comparación para calcular la caída).', render: r => <span style={{ color: C.muted }}>{r.envios[2]}</span> },
            { label: 'Actual', align: 'right', sortVal: r => r.envios[3], tooltip: 'Envíos en el mes seleccionado (período activo).', render: r => <span style={{ color: C.text, fontWeight: 600 }}>{r.envios[3]}</span> },
            { label: 'Tendencia', align: 'right', sortVal: r => r.tendencia_pct, tooltip: 'Variación % entre M-1 y Actual: (Actual − M-1) / M-1 × 100. Solo aparecen sellers con caída >30%.', render: r => <span style={{ color: C.red, fontWeight: 700 }}>{r.tendencia_pct}%</span> },
          ]} data={r.en_riesgo} />
        </DarkCard>
      )}
    </div>
  )
}

// ─── GROK PANEL ───────────────────────────────────────────────────────────────

function GrokPanel({ open, onClose, mes, anio, activeTab }) {
  const [view, setView] = useState('chat')  // 'chat' | 'memoria' | 'historial'
  const [pregunta, setPregunta] = useState('')
  const [loading, setLoading] = useState(false)
  const [chat, setChat] = useState([])
  // historial de la sesión activa: [{role:'user'|'assistant', content:'...'}]
  const [sesionHistorial, setSesionHistorial] = useState([])
  const [savedList, setSavedList] = useState([])
  const [loadingHist, setLoadingHist] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const endRef = useRef(null)

  // ── Brief ────────────────────────────────────────────────────────────────────
  const [brief, setBrief] = useState('')
  const [briefOrig, setBriefOrig] = useState('')
  const [briefUpdated, setBriefUpdated] = useState(null)
  const [savingBrief, setSavingBrief] = useState(false)

  // ── Snapshot (flujo de caja) ──────────────────────────────────────────────
  const [snapshot, setSnapshot] = useState(null)
  const [generatingSnap, setGeneratingSnap] = useState(false)

  // ── Memoria anual ─────────────────────────────────────────────────────────
  const [memorias, setMemorias] = useState({})      // { 2024: {tokens_aprox, generado_en}, ... }
  const [generandoAnio, setGenerandoAnio] = useState(null)

  // ── Contextos manuales ────────────────────────────────────────────────────
  const [contextos, setContextos] = useState({ pnl: false, unit: false, rent: false, ccc: false })
  const ctxLabels = { pnl: `P&L ${MESES_S[mes]} ${anio}`, unit: 'Unit Economics', rent: 'Rentabilidad', ccc: 'CCC / Liquidez' }

  const TABS_LABEL = { pnl: 'P&L', unit: 'Unit Economics', rent: 'Rentabilidad', costos: 'Costos', yoy: 'YoY', salud: 'Salud' }

  const memoriaActiva = Object.keys(memorias).length > 0
  const totalTokensMemoria = Object.values(memorias).reduce((s, m) => s + (m.tokens_aprox || 0), 0)

  // ── Carga inicial ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    api.get('/bi/grok/brief').then(({ data }) => {
      setBrief(data.contenido || '')
      setBriefOrig(data.contenido || '')
      setBriefUpdated(data.updated_at)
    }).catch(() => {})
    api.get('/bi/grok/snapshot').then(({ data }) => {
      setSnapshot(data)
    }).catch(() => {})
    api.get('/bi/grok/memoria').then(({ data }) => {
      const map = {}
      data.forEach(m => { map[m.anio] = m })
      setMemorias(map)
    }).catch(() => {})
  }, [open])

  const cargarHistorial = async () => {
    setLoadingHist(true)
    try {
      const { data } = await api.get('/bi/grok/historial')
      setSavedList(data)
    } catch { toast.error('Error cargando historial') }
    finally { setLoadingHist(false) }
  }

  const guardarBrief = async () => {
    setSavingBrief(true)
    try {
      await api.put('/bi/grok/brief', { contenido: brief })
      setBriefOrig(brief)
      setBriefUpdated(new Date().toISOString())
      toast.success('Brief guardado — Grok lo usará desde la próxima sesión')
    } catch { toast.error('Error guardando brief') }
    finally { setSavingBrief(false) }
  }

  const generarSnapshot = async () => {
    setGeneratingSnap(true)
    try {
      const { data } = await api.post('/bi/grok/snapshot/generar')
      setSnapshot({ contenido: data.preview, generado_en: data.generado_en, tokens_aprox: data.tokens_aprox })
      toast.success(`Snapshot generado (~${data.tokens_aprox} tokens)`)
    } catch { toast.error('Error generando snapshot') }
    finally { setGeneratingSnap(false) }
  }

  const generarMemoriaAnio = async (anio) => {
    setGenerandoAnio(anio)
    try {
      const { data } = await api.post(`/bi/grok/memoria/generar/${anio}`)
      setMemorias(prev => ({ ...prev, [anio]: { tokens_aprox: data.tokens_aprox, generado_en: data.generado_en } }))
      toast.success(`Memoria ${anio} generada (~${data.tokens_aprox.toLocaleString()} tokens)`)
    } catch { toast.error(`Error generando memoria ${anio}`) }
    finally { setGenerandoAnio(null) }
  }

  const nuevaSesion = () => {
    setChat([])
    setSesionHistorial([])
    toast('Nueva sesión iniciada', { icon: '🔄' })
  }

  const enviar = async () => {
    if (!pregunta.trim() || loading) return
    setLoading(true)
    const q = pregunta.trim()
    const esPrimero = chat.length === 0
    const idx = chat.length
    setChat(prev => [...prev, { q, a: null, t: null, saved: false, pending: true, esPrimero }])
    setPregunta('')

    // Construir contextos manuales seleccionados
    const ctxActivos = []
    if (contextos.pnl) ctxActivos.push(`[SOLICITADO] Ver sección P&L ${MESES_S[mes]} ${anio}`)
    if (contextos.unit) ctxActivos.push(`[SOLICITADO] Ver sección Unit Economics ${MESES_S[mes]} ${anio}`)
    if (contextos.rent) ctxActivos.push(`[SOLICITADO] Ver sección Rentabilidad ${MESES_S[mes]} ${anio}`)
    if (contextos.ccc) ctxActivos.push(`[SOLICITADO] Ver sección CCC/Liquidez ${MESES_S[mes]} ${anio}`)

    try {
      const { data } = await api.post('/bi/grok', {
        pregunta: q,
        contexto: ctxActivos,
        mes, anio,
        es_primer_mensaje: esPrimero,
        historial: sesionHistorial,
      })
      const respuesta = data.respuesta || '⚠ Sin respuesta'
      setChat(prev => prev.map((x, i) => i === idx ? { ...x, a: respuesta, t: data.tokens, pending: false } : x))
      // Añadir al historial de sesión para siguiente pregunta
      setSesionHistorial(prev => [
        ...prev,
        { role: 'user', content: q },
        { role: 'assistant', content: respuesta },
      ])
    } catch {
      setChat(prev => prev.map((x, i) => i === idx ? { ...x, a: '⚠ Error conectando con Grok. Intenta de nuevo.', pending: false } : x))
      toast.error('Error conectando con Grok')
    }
    finally { setLoading(false) }
  }

  const guardar = async (idx) => {
    const h = chat[idx]
    if (h.saved) return
    try {
      await api.post('/bi/grok/guardar', {
        pregunta: h.q,
        respuesta: h.a,
        contextos: [],
        mes, anio,
        tab: activeTab,
        tokens_total: h.t?.total_tokens || 0,
      })
      setChat(prev => prev.map((x, i) => i === idx ? { ...x, saved: true } : x))
      toast.success('Análisis guardado')
      if (view === 'historial') cargarHistorial()
    } catch { toast.error('Error guardando análisis') }
  }

  const eliminar = async (id) => {
    try {
      await api.delete(`/bi/grok/historial/${id}`)
      setSavedList(prev => prev.filter(x => x.id !== id))
      if (expanded === id) setExpanded(null)
    } catch { toast.error('Error eliminando análisis') }
  }

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chat])
  useEffect(() => { if (view === 'historial') cargarHistorial() }, [view])

  if (!open) return null

  const btnTab = (v, label, Icon) => (
    <button onClick={() => setView(v)} style={{
      display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px',
      background: view === v ? C.accentDim : 'transparent',
      border: `1px solid ${view === v ? C.accent : C.border}`,
      borderRadius: 20, color: view === v ? C.accent : C.muted,
      fontSize: 11, fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s',
    }}>
      <Icon size={12} /> {label}
    </button>
  )

  const snapFecha = snapshot?.generado_en
    ? new Date(snapshot.generado_en).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div style={{
      position: 'fixed', inset: '0 0 0 auto', width: 460, background: '#111', zIndex: 50,
      display: 'flex', flexDirection: 'column', borderLeft: `1px solid ${C.borderStrong}`,
      boxShadow: '-8px 0 32px rgba(0,0,0,0.6)',
    }}>
      {/* Header */}
      <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.borderStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ background: C.accentDim, padding: 6, borderRadius: 8, display: 'flex' }}><Brain size={16} style={{ color: C.accent }} /></div>
          <div>
            <p style={{ color: C.text, fontWeight: 700, fontSize: 14, lineHeight: 1 }}>Grok AI</p>
            <p style={{ color: C.dimmed, fontSize: 10, marginTop: 2 }}>
              {sesionHistorial.length > 0
                ? `Sesión activa · ${sesionHistorial.length / 2 | 0} pregunta${sesionHistorial.length > 2 ? 's' : ''}`
                : 'Sin sesión activa'}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {btnTab('chat', 'Chat', Brain)}
          {btnTab('memoria', 'Memoria', Database)}
          {btnTab('historial', 'Índice', BookOpen)}
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.muted, padding: 4, borderRadius: 6, marginLeft: 2 }}
            onMouseEnter={e => e.currentTarget.style.color = C.text}
            onMouseLeave={e => e.currentTarget.style.color = C.muted}>
            <X size={18} />
          </button>
        </div>
      </div>

      {/* ── CHAT VIEW ── */}
      {view === 'chat' && (
        <>
          {/* Barra de estado de memoria */}
          <div style={{ padding: '8px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 4,
              background: briefOrig ? C.accentDim : C.surface,
              border: `1px solid ${briefOrig ? C.accent + '55' : C.border}`,
              color: briefOrig ? C.accent : C.dimmed,
            }}>
              <Database size={9} /> Brief {briefOrig ? '✓' : 'vacío'}
            </span>
            <span style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 4,
              background: snapshot?.contenido ? C.accentDim : C.surface,
              border: `1px solid ${snapshot?.contenido ? C.accent + '55' : C.border}`,
              color: snapshot?.contenido ? C.accent : C.dimmed,
            }}>
              <Zap size={9} /> Snapshot {snapFecha ? snapFecha : 'sin generar'}
            </span>
            {sesionHistorial.length > 0 && (
              <button onClick={nuevaSesion} style={{
                marginLeft: 'auto', fontSize: 10, padding: '2px 8px', borderRadius: 10,
                background: 'transparent', border: `1px solid ${C.border}`, color: C.dimmed,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <RefreshCw size={9} /> Nueva sesión
              </button>
            )}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {chat.length === 0 && (
              <div style={{ color: C.dimmed, fontSize: 13, textAlign: 'center', marginTop: 40 }}>
                <Brain size={32} style={{ color: C.borderStrong, marginBottom: 12, display: 'block', margin: '0 auto 12px' }} />
                <p>Hazle una pregunta a Grok.</p>
                {memoriaActiva ? (
                  <p style={{ fontSize: 11, marginTop: 10, color: C.accent }}>
                    ✓ Memoria activa ({totalTokensMemoria.toLocaleString()} tokens) — {Object.keys(memorias).join(', ')}
                  </p>
                ) : (
                  <p style={{ fontSize: 11, marginTop: 10, color: C.dimmed }}>
                    💡 Genera la <button onClick={() => setView('memoria')} style={{ background: 'none', border: 'none', color: C.accent, cursor: 'pointer', fontSize: 11, padding: 0, textDecoration: 'underline' }}>Memoria anual</button> para que Grok conozca el historial completo.
                  </p>
                )}
                {!briefOrig && (
                  <p style={{ fontSize: 11, marginTop: 6, color: C.dimmed }}>
                    💡 Configura el <button onClick={() => setView('memoria')} style={{ background: 'none', border: 'none', color: C.accent, cursor: 'pointer', fontSize: 11, padding: 0, textDecoration: 'underline' }}>Brief del negocio</button> para que Grok conozca E-Courier.
                  </p>
                )}
              </div>
            )}
            {chat.map((h, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ background: C.accentDim, border: `1px solid ${C.accent}33`, borderRadius: 8, padding: '10px 12px', fontSize: 13, color: C.text }}>
                  {h.esPrimero && (
                    <span style={{ fontSize: 9, color: C.accent, background: C.accentDim, border: `1px solid ${C.accent}44`, borderRadius: 8, padding: '1px 6px', marginBottom: 6, display: 'inline-block' }}>
                      {memoriaActiva ? `+ Memoria ${Object.keys(memorias).join('/')} inyectada` : '+ Snapshot y brief inyectados'}
                    </span>
                  )}
                  <p>{h.q}</p>
                </div>
                {h.pending ? (
                  <div style={{ background: C.surface, border: `1px solid ${C.accent}55`, borderRadius: 8, padding: '16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ display: 'flex', gap: 5 }}>
                      {[0, 1, 2].map(j => (
                        <div key={j} style={{ width: 7, height: 7, borderRadius: '50%', background: C.accent, animation: `grokPulse 1.2s ease-in-out ${j * 0.22}s infinite` }} />
                      ))}
                    </div>
                    <span style={{ color: C.muted, fontSize: 12 }}>Grok está analizando...</span>
                  </div>
                ) : (
                  <>
                    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', fontSize: 13, color: C.muted, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{h.a}</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      {h.t && <p style={{ color: C.dimmed, fontSize: 10 }}>Tokens: {h.t.total_tokens?.toLocaleString('es-CL') || '—'}</p>}
                      <button onClick={() => guardar(i)} disabled={h.saved}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 10px',
                          borderRadius: 20, cursor: h.saved ? 'default' : 'pointer', transition: 'all 0.15s',
                          border: `1px solid ${h.saved ? C.border : C.accent}`,
                          background: h.saved ? 'transparent' : C.accentDim,
                          color: h.saved ? C.dimmed : C.accent,
                        }}>
                        <Bookmark size={11} fill={h.saved ? C.dimmed : 'none'} />
                        {h.saved ? 'Guardado' : 'Guardar análisis'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
            <div ref={endRef} />
          </div>

          <div style={{ padding: '12px 18px', borderTop: `1px solid ${C.border}` }}>
            {/* Checkboxes de contexto adicional */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              {Object.entries(ctxLabels).map(([key, label]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 11, color: contextos[key] ? C.accent : C.dimmed, background: contextos[key] ? `${C.accent}22` : C.surface, border: `1px solid ${contextos[key] ? C.accent : C.border}`, borderRadius: 20, padding: '3px 10px', transition: 'all 0.15s' }}>
                  <input type="checkbox" checked={contextos[key]} onChange={e => setContextos(p => ({ ...p, [key]: e.target.checked }))} style={{ display: 'none' }} />
                  {contextos[key] ? '✓' : '+'} {label}
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={pregunta} onChange={e => setPregunta(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && enviar()}
                placeholder="Pregunta sobre el negocio..."
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
        </>
      )}

      {/* ── MEMORIA VIEW ── */}
      {view === 'memoria' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* ── Memoria anual ── */}
          <div>
            <p style={{ color: C.text, fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Memoria anual completa</p>
            <p style={{ color: C.dimmed, fontSize: 11, marginBottom: 14 }}>
              Genera una sola vez por año. Incluye todos los sellers, drivers, P&L mensual, retiros. Se inyecta completa al inicio de cada sesión.
              {totalTokensMemoria > 0 && <span style={{ color: C.accent }}> Total: ~{totalTokensMemoria.toLocaleString()} tokens</span>}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[2024, 2025, 2026].map(anioBtn => {
                const mem = memorias[anioBtn]
                const generando = generandoAnio === anioBtn
                return (
                  <div key={anioBtn} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: C.surface, border: `1px solid ${mem ? C.accent + '55' : C.border}`, borderRadius: 8, padding: '10px 14px' }}>
                    <div>
                      <p style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>
                        {anioBtn === 2026 ? `${anioBtn} — Tiempo real` : `${anioBtn} — Snapshot histórico`}
                        {mem && <span style={{ color: C.accent, fontSize: 10, marginLeft: 8 }}>✓ Generado</span>}
                      </p>
                      {mem ? (
                        <p style={{ color: C.dimmed, fontSize: 10, marginTop: 2 }}>
                          ~{(mem.tokens_aprox || 0).toLocaleString()} tokens · {mem.generado_en ? new Date(mem.generado_en).toLocaleDateString('es-CL') : ''}
                        </p>
                      ) : (
                        <p style={{ color: C.dimmed, fontSize: 10, marginTop: 2 }}>Sin generar</p>
                      )}
                    </div>
                    <button onClick={() => generarMemoriaAnio(anioBtn)} disabled={generando || generandoAnio !== null}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '7px 14px',
                        borderRadius: 8, cursor: (generando || generandoAnio !== null) ? 'default' : 'pointer',
                        background: mem ? C.surface : C.accent, border: `1px solid ${mem ? C.border : C.accent}`,
                        color: mem ? C.text : '#fff', opacity: (generando || generandoAnio !== null) ? 0.6 : 1, whiteSpace: 'nowrap',
                      }}>
                      {generando ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={12} />}
                      {generando ? 'Generando...' : mem ? 'Regenerar' : 'Generar'}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          <div style={{ borderTop: `1px solid ${C.border}` }} />

          {/* ── Snapshot flujo de caja ── */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div>
                <p style={{ color: C.text, fontWeight: 600, fontSize: 13 }}>Snapshot flujo de caja</p>
                <p style={{ color: C.dimmed, fontSize: 11, marginTop: 2 }}>
                  Cobros pendientes, pagos próximos 30 días. Se inyecta como complemento al inicio de cada sesión.
                </p>
              </div>
              <button onClick={generarSnapshot} disabled={generatingSnap}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '7px 14px',
                  borderRadius: 8, cursor: generatingSnap ? 'default' : 'pointer',
                  background: C.accent, border: 'none', color: '#fff', opacity: generatingSnap ? 0.6 : 1,
                  transition: 'opacity 0.15s', whiteSpace: 'nowrap', flexShrink: 0,
                }}>
                {generatingSnap ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={12} />}
                {generatingSnap ? 'Generando...' : 'Actualizar'}
              </button>
            </div>
            {snapshot?.contenido ? (
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px', fontSize: 11, color: C.muted, whiteSpace: 'pre-wrap', lineHeight: 1.7, maxHeight: 200, overflowY: 'auto' }}>
                {snapshot.contenido}
              </div>
            ) : (
              <div style={{ background: C.surface, border: `1px dashed ${C.border}`, borderRadius: 8, padding: '20px', textAlign: 'center', color: C.dimmed, fontSize: 12 }}>
                Sin snapshot generado.
              </div>
            )}
            {snapshot?.generado_en && (
              <p style={{ color: C.dimmed, fontSize: 10, marginTop: 6 }}>
                Generado el {new Date(snapshot.generado_en).toLocaleString('es-CL')} · ~{snapshot?.tokens_aprox || 0} tokens
              </p>
            )}
          </div>

          <div style={{ borderTop: `1px solid ${C.border}` }} />

          {/* Brief */}
          <div>
            <div style={{ marginBottom: 10 }}>
              <p style={{ color: C.text, fontWeight: 600, fontSize: 13 }}>Brief del negocio</p>
              <p style={{ color: C.dimmed, fontSize: 11, marginTop: 2 }}>
                Descripción permanente de E-Courier: modelo de negocio, créditos, estructura de costos, etc. Grok lo lee en cada sesión como su "conocimiento base".
              </p>
            </div>
            <textarea
              value={brief}
              onChange={e => setBrief(e.target.value)}
              rows={14}
              style={{
                width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
                padding: '10px 12px', fontSize: 12, color: C.text, outline: 'none', resize: 'vertical',
                lineHeight: 1.6, fontFamily: 'monospace', boxSizing: 'border-box',
              }}
              onFocus={e => e.target.style.borderColor = C.accent}
              onBlur={e => e.target.style.borderColor = C.border}
              placeholder="Describe el negocio de E-Courier: modelo, sellers clave, conductores, créditos, tarifas, contexto relevante..."
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
              <p style={{ color: C.dimmed, fontSize: 10 }}>
                ~{(brief.length / 4) | 0} tokens · {brief.length} chars
                {briefUpdated && ` · Guardado ${new Date(briefUpdated).toLocaleDateString('es-CL')}`}
              </p>
              <button onClick={guardarBrief} disabled={savingBrief || brief === briefOrig}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '7px 16px',
                  borderRadius: 8, cursor: (savingBrief || brief === briefOrig) ? 'default' : 'pointer',
                  background: brief !== briefOrig ? C.accent : C.surface,
                  border: `1px solid ${brief !== briefOrig ? C.accent : C.border}`,
                  color: brief !== briefOrig ? '#fff' : C.dimmed,
                  opacity: savingBrief ? 0.6 : 1, transition: 'all 0.15s',
                }}>
                {savingBrief ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : null}
                {savingBrief ? 'Guardando...' : brief === briefOrig ? 'Sin cambios' : 'Guardar brief'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── HISTORIAL VIEW ── */}
      {view === 'historial' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {loadingHist ? (
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}>
              <Loader2 size={24} style={{ color: C.accent, animation: 'spin 1s linear infinite' }} />
            </div>
          ) : savedList.length === 0 ? (
            <div style={{ color: C.dimmed, fontSize: 13, textAlign: 'center', marginTop: 60 }}>
              <BookOpen size={32} style={{ color: C.borderStrong, display: 'block', margin: '0 auto 12px' }} />
              No hay análisis guardados aún.<br />
              <span style={{ fontSize: 11 }}>Usa el botón "Guardar análisis" en el chat.</span>
            </div>
          ) : (
            <>
              <p style={{ color: C.dimmed, fontSize: 11, marginBottom: 6 }}>{savedList.length} análisis guardados</p>
              {savedList.map(item => {
                const isOpen = expanded === item.id
                const fecha = item.created_at ? new Date(item.created_at).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
                return (
                  <div key={item.id} style={{ background: C.card, border: `1px solid ${isOpen ? C.accent + '55' : C.border}`, borderRadius: 10, overflow: 'hidden', transition: 'border-color 0.15s' }}>
                    <div onClick={() => setExpanded(isOpen ? null : item.id)}
                      style={{ padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 8 }}
                      onMouseEnter={e => e.currentTarget.style.background = C.cardHover}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <div style={{ paddingTop: 2, color: C.accent, flexShrink: 0 }}>
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ color: C.text, fontSize: 13, fontWeight: 500, lineHeight: 1.3, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.titulo}
                        </p>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {item.mes && item.anio && (
                            <span style={{ fontSize: 10, color: C.dimmed, background: C.surface, padding: '1px 6px', borderRadius: 10 }}>
                              {MESES_S[item.mes]} {item.anio}
                            </span>
                          )}
                          {item.tab && (
                            <span style={{ fontSize: 10, color: C.dimmed, background: C.surface, padding: '1px 6px', borderRadius: 10 }}>
                              {TABS_LABEL[item.tab] || item.tab}
                            </span>
                          )}
                          {fecha && <span style={{ fontSize: 10, color: C.dimmed }}>{fecha}</span>}
                        </div>
                      </div>
                      <button onClick={e => { e.stopPropagation(); eliminar(item.id) }}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.dimmed, padding: 4, borderRadius: 6, flexShrink: 0 }}
                        onMouseEnter={e => e.currentTarget.style.color = C.red}
                        onMouseLeave={e => e.currentTarget.style.color = C.dimmed}
                        title="Eliminar">
                        <Trash2 size={13} />
                      </button>
                    </div>
                    {isOpen && (
                      <div style={{ borderTop: `1px solid ${C.border}`, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ background: C.accentDim, border: `1px solid ${C.accent}33`, borderRadius: 8, padding: '8px 12px', fontSize: 12, color: C.text }}>
                          {item.pregunta}
                        </div>
                        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 12, color: C.muted, whiteSpace: 'pre-wrap', lineHeight: 1.6, maxHeight: 320, overflowY: 'auto' }}>
                          {item.respuesta}
                        </div>
                        {item.tokens_total > 0 && (
                          <p style={{ fontSize: 10, color: C.dimmed }}>Tokens usados: {item.tokens_total.toLocaleString('es-CL')}</p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>
      )}
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
        @keyframes grokPulse { 0%, 80%, 100% { opacity: 0.2; transform: scale(0.8) } 40% { opacity: 1; transform: scale(1) } }
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
            { label: 'Mes', val: mes, set: v => { const n = +v; setMes(n); if (n === 0) setTab('yoy') }, opts: [{ v: 0, l: 'Todos los meses' }, ...MESES.slice(1).map((m, i) => ({ v: i + 1, l: m }))] },
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
