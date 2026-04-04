import { useState, useEffect, useCallback, useMemo } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import {
  Users, AlertTriangle, TrendingDown, TrendingUp,
  UserCheck, UserX, UserMinus, Search, Download,
} from 'lucide-react'

// ─── Design tokens (matching BI dark theme) ──────────────────────────────────
const C = {
  bg: '#0d0d0d', surface: '#161616', card: '#1e1e1e', cardHover: '#242424',
  border: '#2a2a2a', borderStrong: '#383838',
  accent: '#e8521a', accentDim: 'rgba(232,82,26,0.12)',
  text: '#f0f0f0', muted: '#8a8a8a', dimmed: '#555555',
  green: '#22c55e', greenDim: 'rgba(34,197,94,0.1)',
  red: '#ef4444', redDim: 'rgba(239,68,68,0.1)',
  blue: '#60a5fa', blueDim: 'rgba(96,165,250,0.1)',
  amber: '#f59e0b', amberDim: 'rgba(245,158,11,0.1)',
  purple: '#a78bfa', purpleDim: 'rgba(167,139,250,0.1)',
}

const MESES_S = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const MESES_L = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

const ESTADO_CFG = {
  activo:     { label: 'Activo',     color: C.green,  bg: C.greenDim,  border: '#22c55e33' },
  nuevo:      { label: 'Nuevo',      color: C.blue,   bg: C.blueDim,   border: '#60a5fa33' },
  recuperado: { label: 'Recuperado', color: C.purple, bg: C.purpleDim, border: '#a78bfa33' },
  en_riesgo:  { label: 'En riesgo',  color: C.amber,  bg: C.amberDim,  border: '#f59e0b33' },
  inactivo:   { label: 'Inactivo',   color: '#f97316', bg: 'rgba(249,115,22,0.1)', border: '#f9731633' },
  perdido:    { label: 'Perdido',    color: C.red,    bg: C.redDim,    border: '#ef444433' },
}

const ESTADO_ORDER = { perdido: 0, en_riesgo: 1, inactivo: 2, recuperado: 3, nuevo: 4, activo: 5 }

const now = new Date()

function fmt(v) {
  if (!v) return '$0'
  return `$${Math.abs(v).toLocaleString('es-CL')}`
}

function EstadoBadge({ estado }) {
  const cfg = ESTADO_CFG[estado] || { label: estado, color: C.muted, bg: 'transparent', border: C.border }
  return (
    <span style={{
      background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`,
      borderRadius: 6, padding: '2px 8px', fontSize: 10, fontWeight: 700,
      letterSpacing: '0.04em', whiteSpace: 'nowrap',
    }}>
      {cfg.label}
    </span>
  )
}

function MiniSpark({ data, maxVal }) {
  const max = maxVal || Math.max(...data, 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 22, width: 80 }}>
      {data.map((v, i) => {
        const h = max > 0 ? Math.max(Math.round((v / max) * 100), v > 0 ? 6 : 0) : 0
        const isActive = v > 0
        return (
          <div key={i} style={{
            flex: 1, height: `${h}%`, borderRadius: '2px 2px 0 0',
            background: isActive ? C.blue : C.border, opacity: isActive ? 0.85 : 0.3,
            minHeight: isActive ? 2 : 1,
          }} />
        )
      })}
    </div>
  )
}

function heatColor(val, maxVal) {
  if (!val || val === 0) return C.card
  const t = Math.min(val / maxVal, 1)
  if (t < 0.05) return '#112233'
  if (t < 0.15) return '#1a3a5c'
  if (t < 0.35) return '#1a4f82'
  if (t < 0.6)  return '#1a65a8'
  if (t < 0.85) return '#1a7acc'
  return '#2090f0'
}

function KpiCard({ label, value, sub, color, icon: Icon, delta, deltaLabel }) {
  const valColor = color === 'green' ? C.green : color === 'red' ? C.red : color === 'amber' ? C.amber : color === 'blue' ? C.blue : color === 'purple' ? C.purple : C.text
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <p style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</p>
        {Icon && <Icon size={14} style={{ color: valColor, opacity: 0.7 }} />}
      </div>
      <p style={{ color: valColor, fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ color: C.dimmed, fontSize: 11, marginTop: 4 }}>{sub}</p>}
      {delta !== undefined && delta !== null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
          {delta > 0
            ? <TrendingUp size={11} style={{ color: color === 'green' ? C.green : C.red }} />
            : delta < 0
            ? <TrendingDown size={11} style={{ color: color === 'green' ? C.red : C.green }} />
            : null}
          <span style={{ fontSize: 11, color: C.dimmed }}>
            {delta > 0 ? '+' : ''}{delta} vs {deltaLabel}
          </span>
        </div>
      )}
    </div>
  )
}

export default function Retencion() {
  const [period, setPeriod] = useState({ anio: now.getFullYear(), mes: now.getMonth() + 1 })
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [vista, setVista] = useState('semaforo') // 'semaforo' | 'heatmap'

  // Table controls
  const [search, setSearch] = useState('')
  const [filterEstado, setFilterEstado] = useState('todos')
  const [sortCol, setSortCol] = useState('ingreso_mensual_avg')
  const [sortDir, setSortDir] = useState('desc')
  const [pageSize, setPageSize] = useState(30)
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: d } = await api.get('/dashboard/retencion', {
        params: { anio: period.anio, mes_ref: period.mes }
      })
      setData(d)
    } catch {
      toast.error('Error cargando análisis de retención')
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search, filterEstado, sortCol, sortDir])

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortCol(col); setSortDir('desc') }
  }

  const sellersFiltrados = useMemo(() => {
    if (!data?.sellers) return []
    let rows = data.sellers.filter(s => {
      const matchSearch = s.nombre.toLowerCase().includes(search.toLowerCase())
      const matchEstado = filterEstado === 'todos' || s.estado === filterEstado
      return matchSearch && matchEstado
    })
    rows = [...rows].sort((a, b) => {
      if (sortCol === 'nombre') {
        const c = a.nombre.localeCompare(b.nombre)
        return sortDir === 'asc' ? c : -c
      }
      if (sortCol === 'estado') {
        const c = (ESTADO_ORDER[a.estado] ?? 9) - (ESTADO_ORDER[b.estado] ?? 9)
        return sortDir === 'asc' ? c : -c
      }
      const va = a[sortCol] ?? -1
      const vb = b[sortCol] ?? -1
      return sortDir === 'asc' ? va - vb : vb - va
    })
    return rows
  }, [data?.sellers, search, filterEstado, sortCol, sortDir])

  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(sellersFiltrados.length / pageSize))
  const pageClamped = Math.min(page, totalPages)
  const sellersVisible = pageSize === 0
    ? sellersFiltrados
    : sellersFiltrados.slice((pageClamped - 1) * pageSize, pageClamped * pageSize)

  const r = data?.resumen
  const maxVol = data?.max_vol || 1

  // CSV export
  const exportCSV = () => {
    if (!data?.sellers) return
    const header = 'Seller,Estado,Último mes activo,Meses activo,Prom. paquetes/mes,Ingreso mensual prom.,Impacto anual,Semanas sin actividad'
    const rows = sellersFiltrados.map(s =>
      `"${s.nombre}",${ESTADO_CFG[s.estado]?.label || s.estado},${MESES_L[s.ultimo_mes_activo] || '—'},${s.meses_activo},${s.promedio_mensual},${s.ingreso_mensual_avg},${s.impacto_anual},${s.semanas_sin_actividad}`
    )
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `retencion_${period.anio}_${MESES_S[period.mes]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const ThSort = ({ col, label, align = 'left' }) => (
    <th
      onClick={() => handleSort(col)}
      style={{
        padding: '8px 12px', textAlign: align, color: sortCol === col ? C.accent : C.muted,
        fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
        borderBottom: `1px solid ${C.border}`, cursor: 'pointer', userSelect: 'none',
        whiteSpace: 'nowrap', transition: 'color 0.15s',
      }}
    >
      {label} <span style={{ opacity: sortCol === col ? 1 : 0.25 }}>{sortCol === col ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
    </th>
  )

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '24px 20px', color: C.text, fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: C.text, margin: 0 }}>Retención y Salud Comercial</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>¿Quiénes siguen enviando, quiénes están en riesgo y cuánto vale perderlos?</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={period.anio}
            onChange={e => setPeriod(p => ({ ...p, anio: +e.target.value }))}
            style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '6px 10px', fontSize: 12 }}
          >
            {[now.getFullYear() - 1, now.getFullYear()].map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select
            value={period.mes}
            onChange={e => setPeriod(p => ({ ...p, mes: +e.target.value }))}
            style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '6px 10px', fontSize: 12 }}
          >
            {MESES_L.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '80px 0', color: C.muted }}>Cargando análisis…</div>
      ) : !data ? null : (
        <>
          {/* BLOQUE A: KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
            <KpiCard
              label="Activos este mes" value={r.activo}
              sub={`${r.nuevo} nuevos · ${r.recuperado} recuperados`}
              color="green" icon={UserCheck}
              delta={r.activo - r.prev_activo} deltaLabel={MESES_S[period.mes - 1] || 'prev'}
            />
            <KpiCard
              label="En riesgo" value={r.en_riesgo}
              sub="Activos el mes pasado, silencio ahora"
              color="amber" icon={AlertTriangle}
              delta={r.en_riesgo - r.prev_en_riesgo} deltaLabel={MESES_S[period.mes - 1] || 'prev'}
            />
            <KpiCard
              label="Inactivos" value={r.inactivo}
              sub="Sin envíos hace 2-4 meses"
              color="amber" icon={UserMinus}
            />
            <KpiCard
              label="Perdidos" value={r.perdido}
              sub="Sin actividad hace +4 meses"
              color="red" icon={UserX}
              delta={r.perdido - r.prev_perdido} deltaLabel={MESES_S[period.mes - 1] || 'prev'}
            />
            <KpiCard
              label="Total sellers año" value={r.total_sellers}
              sub={`${period.anio}`}
              color="blue" icon={Users}
            />
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, background: C.surface, borderRadius: 10, padding: 4, width: 'fit-content', marginBottom: 20 }}>
            {[['semaforo', '🚦 Semáforo'], ['heatmap', '🌡️ Mapa de calor']].map(([id, label]) => (
              <button key={id} onClick={() => setVista(id)} style={{
                background: vista === id ? C.card : 'transparent',
                border: vista === id ? `1px solid ${C.border}` : '1px solid transparent',
                color: vista === id ? C.text : C.muted, borderRadius: 8,
                padding: '6px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
              }}>{label}</button>
            ))}
          </div>

          {/* BLOQUE B: Semáforo */}
          {vista === 'semaforo' && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 24 }}>
              {/* Toolbar */}
              <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 260 }}>
                  <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.muted }} />
                  <input
                    value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Buscar seller…"
                    style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '6px 10px 6px 30px', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
                <select value={filterEstado} onChange={e => { setFilterEstado(e.target.value); setPage(1) }}
                  style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '6px 10px', fontSize: 12 }}>
                  <option value="todos">Todos los estados</option>
                  {Object.entries(ESTADO_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
                <select value={pageSize} onChange={e => { setPageSize(+e.target.value); setPage(1) }}
                  style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '6px 10px', fontSize: 12 }}>
                  {[[30, '30'], [50, '50'], [100, '100'], [200, '200'], [0, 'Todos']].map(([v, l]) =>
                    <option key={v} value={v}>{l}</option>
                  )}
                </select>
                <button onClick={exportCSV} style={{
                  background: 'transparent', border: `1px solid ${C.border}`, color: C.muted,
                  borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <Download size={12} /> CSV
                </button>
              </div>

              {/* Table */}
              <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 520 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead style={{ position: 'sticky', top: 0, background: C.surface, zIndex: 1 }}>
                    <tr>
                      <ThSort col="nombre" label="Seller" />
                      <ThSort col="estado" label="Estado" />
                      <ThSort col="ultimo_mes_activo" label="Último activo" align="center" />
                      <ThSort col="meses_activo" label="Meses activo" align="right" />
                      <th style={{ padding: '8px 12px', color: C.muted, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>Tendencia anual</th>
                      <ThSort col="promedio_mensual" label="Prom. paq./mes" align="right" />
                      <ThSort col="ingreso_mensual_avg" label="Ingreso prom./mes" align="right" />
                      <ThSort col="impacto_anual" label="Impacto anual" align="right" />
                      <ThSort col="semanas_sin_actividad" label="Sem. inactivo" align="right" />
                    </tr>
                  </thead>
                  <tbody>
                    {sellersVisible.map((s, i) => {
                      const cfg = ESTADO_CFG[s.estado] || {}
                      const isRisk = ['perdido', 'en_riesgo'].includes(s.estado)
                      return (
                        <tr key={s.seller_id}
                          style={{ borderBottom: `1px solid ${C.border}`, background: isRisk ? `${cfg.bg}` : 'transparent', transition: 'background 0.1s' }}
                          onMouseEnter={e => e.currentTarget.style.background = C.cardHover}
                          onMouseLeave={e => e.currentTarget.style.background = isRisk ? cfg.bg : 'transparent'}
                        >
                          <td style={{ padding: '9px 12px', color: C.text, fontWeight: 500, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.nombre}</td>
                          <td style={{ padding: '9px 12px' }}><EstadoBadge estado={s.estado} /></td>
                          <td style={{ padding: '9px 12px', textAlign: 'center', color: C.muted }}>{s.ultimo_mes_activo ? MESES_S[s.ultimo_mes_activo] : '—'}</td>
                          <td style={{ padding: '9px 12px', textAlign: 'right', color: C.muted }}>{s.meses_activo}</td>
                          <td style={{ padding: '9px 12px' }}><MiniSpark data={s.vol_anual} maxVal={maxVol} /></td>
                          <td style={{ padding: '9px 12px', textAlign: 'right', color: C.text }}>{s.promedio_mensual.toLocaleString()}</td>
                          <td style={{ padding: '9px 12px', textAlign: 'right', color: C.green, fontWeight: 600 }}>{fmt(s.ingreso_mensual_avg)}</td>
                          <td style={{ padding: '9px 12px', textAlign: 'right', color: isRisk ? C.red : C.dimmed, fontWeight: isRisk ? 700 : 400 }}>
                            {s.impacto_anual > 0 ? fmt(s.impacto_anual) : '—'}
                          </td>
                          <td style={{ padding: '9px 12px', textAlign: 'right', color: s.semanas_sin_actividad > 8 ? C.red : s.semanas_sin_actividad > 4 ? C.amber : C.muted }}>
                            {s.semanas_sin_actividad > 0 ? `${s.semanas_sin_actividad}s` : '—'}
                          </td>
                        </tr>
                      )
                    })}
                    {sellersVisible.length === 0 && (
                      <tr><td colSpan={9} style={{ padding: '32px', textAlign: 'center', color: C.dimmed }}>Sin resultados</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {pageSize > 0 && totalPages > 1 && (
                <div style={{ padding: '10px 16px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: C.dimmed, fontSize: 11 }}>{sellersFiltrados.length} sellers · pág. {pageClamped}/{totalPages}</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={pageClamped === 1}
                      style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, opacity: pageClamped === 1 ? 0.4 : 1 }}>‹</button>
                    <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={pageClamped === totalPages}
                      style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, opacity: pageClamped === totalPages ? 0.4 : 1 }}>›</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* BLOQUE C: Mapa de calor */}
          {vista === 'heatmap' && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 24 }}>
              <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>Actividad mensual {period.anio}</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 10, color: C.muted }}>
                  <span style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                    {[C.card, '#112233', '#1a3a5c', '#1a4f82', '#1a65a8', '#2090f0'].map((c, i) => (
                      <div key={i} style={{ width: 14, height: 14, borderRadius: 3, background: c, border: `1px solid ${C.border}` }} />
                    ))}
                    <span style={{ marginLeft: 4 }}>Bajo → Alto</span>
                  </span>
                </div>
              </div>
              <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 580 }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 11, minWidth: '100%' }}>
                  <thead style={{ position: 'sticky', top: 0, background: C.surface, zIndex: 1 }}>
                    <tr>
                      <th style={{ padding: '8px 12px', textAlign: 'left', color: C.muted, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', borderBottom: `1px solid ${C.border}`, minWidth: 160 }}>Seller</th>
                      {MESES_S.slice(1).map((m, i) => (
                        <th key={i} style={{
                          padding: '8px 8px', textAlign: 'center', color: i + 1 === period.mes ? C.accent : C.muted,
                          fontSize: 10, fontWeight: i + 1 === period.mes ? 700 : 600,
                          borderBottom: `1px solid ${C.border}`, minWidth: 46, whiteSpace: 'nowrap',
                        }}>{m}</th>
                      ))}
                      <th style={{ padding: '8px 8px', textAlign: 'right', color: C.muted, fontSize: 10, fontWeight: 600, borderBottom: `1px solid ${C.border}`, minWidth: 60 }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sellers.map(s => {
                      const total = s.vol_anual.reduce((a, b) => a + b, 0)
                      return (
                        <tr key={s.seller_id} style={{ borderBottom: `1px solid ${C.border}22` }}
                          onMouseEnter={e => e.currentTarget.style.background = C.cardHover}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                          <td style={{ padding: '6px 12px', color: C.text, whiteSpace: 'nowrap', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            <span style={{ marginRight: 6 }}>
                              <EstadoBadge estado={s.estado} />
                            </span>
                            {s.nombre}
                          </td>
                          {s.vol_anual.map((v, mi) => (
                            <td key={mi} title={`${s.nombre} · ${MESES_L[mi + 1]}: ${v.toLocaleString()} paq.`}
                              style={{
                                padding: '4px 3px', textAlign: 'center',
                                background: heatColor(v, maxVol),
                                color: v > maxVol * 0.3 ? '#fff' : v > 0 ? '#aaccee' : C.dimmed,
                                fontSize: 10, fontWeight: v > 0 ? 600 : 400,
                                border: mi + 1 === period.mes ? `2px solid ${C.accent}88` : `1px solid ${C.bg}`,
                                borderRadius: 3, cursor: 'default',
                              }}>
                              {v > 0 ? v.toLocaleString() : ''}
                            </td>
                          ))}
                          <td style={{ padding: '6px 8px', textAlign: 'right', color: C.muted, fontWeight: 600 }}>{total.toLocaleString()}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* BLOQUE D: Impacto económico */}
          {data.top_riesgo?.length > 0 && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={14} style={{ color: C.amber }} />
                <div>
                  <span style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>Impacto económico en riesgo</span>
                  <span style={{ color: C.muted, fontSize: 11, marginLeft: 8 }}>
                    Top {data.top_riesgo.length} clientes inactivos ordenados por ingreso histórico
                  </span>
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      {['#', 'Seller', 'Estado', 'Sem. inactivo', 'Prom. paq./mes', 'Ingreso mensual prom.', 'Ingreso perdido estimado'].map((h, i) => (
                        <th key={i} style={{ padding: '8px 12px', textAlign: i >= 3 ? 'right' : 'left', color: C.muted, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', borderBottom: `1px solid ${C.border}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.top_riesgo.map((s, i) => (
                      <tr key={s.seller_id} style={{ borderBottom: `1px solid ${C.border}` }}
                        onMouseEnter={e => e.currentTarget.style.background = C.cardHover}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <td style={{ padding: '9px 12px', color: C.dimmed, fontWeight: 700 }}>{i + 1}</td>
                        <td style={{ padding: '9px 12px', color: C.text, fontWeight: 600 }}>{s.nombre}</td>
                        <td style={{ padding: '9px 12px' }}><EstadoBadge estado={s.estado} /></td>
                        <td style={{ padding: '9px 12px', textAlign: 'right', color: s.semanas_sin_actividad > 8 ? C.red : C.amber }}>
                          {s.semanas_sin_actividad > 0 ? `~${s.semanas_sin_actividad} sem.` : '< 1 mes'}
                        </td>
                        <td style={{ padding: '9px 12px', textAlign: 'right', color: C.muted }}>{s.promedio_mensual.toLocaleString()}</td>
                        <td style={{ padding: '9px 12px', textAlign: 'right', color: C.green, fontWeight: 600 }}>{fmt(s.ingreso_mensual_avg)}</td>
                        <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                          <span style={{ color: C.red, fontWeight: 800, fontSize: 13 }}>{fmt(s.impacto_anual)}</span>
                          <span style={{ color: C.dimmed, fontSize: 10, marginLeft: 4 }}>
                            ({12 - period.mes + 1} meses rest.)
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: `1px solid ${C.borderStrong}` }}>
                      <td colSpan={6} style={{ padding: '10px 12px', color: C.muted, fontSize: 11, fontWeight: 600 }}>TOTAL EXPUESTO</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        <span style={{ color: C.red, fontWeight: 800, fontSize: 14 }}>
                          {fmt(data.top_riesgo.reduce((acc, s) => acc + s.impacto_anual, 0))}
                        </span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
