import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api'
import toast from 'react-hot-toast'
import {
  Users, AlertTriangle, TrendingDown, TrendingUp,
  UserCheck, UserX, UserMinus, Search, Download, ExternalLink,
} from 'lucide-react'
import PageHeader from '../../components/PageHeader'

// ─── Design tokens (matching BI dark theme) ──────────────────────────────────
const C = {
  bg: '#f8fafc', surface: '#f1f5f9', card: '#ffffff', cardHover: '#f8fafc',
  border: '#e2e8f0', borderStrong: '#cbd5e1',
  accent: '#1e3a5f', accentDim: 'rgba(30,58,95,0.08)',
  text: '#1e293b', muted: '#64748b', dimmed: '#94a3b8',
  green: '#16a34a', greenDim: 'rgba(22,163,74,0.1)',
  red: '#dc2626', redDim: 'rgba(220,38,38,0.1)',
  blue: '#2563eb', blueDim: 'rgba(37,99,235,0.1)',
  amber: '#d97706', amberDim: 'rgba(217,119,6,0.1)',
  purple: '#7c3aed', purpleDim: 'rgba(124,58,237,0.1)',
}

const MESES_S = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const MESES_L = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

const ESTADO_CFG = {
  activo:               { label: 'Activo',              color: C.green,   bg: C.greenDim,  border: '#22c55e33' },
  nuevo:                { label: 'Nuevo',               color: C.blue,    bg: C.blueDim,   border: '#60a5fa33' },
  recuperado:           { label: 'Recuperado',          color: C.purple,  bg: C.purpleDim, border: '#a78bfa33' },
  en_riesgo:            { label: 'En riesgo',           color: C.amber,   bg: C.amberDim,  border: '#f59e0b33' },
  inactivo:             { label: 'Inactivo',            color: '#f97316', bg: 'rgba(249,115,22,0.1)', border: '#f9731633' },
  perdido:              { label: 'Perdido',             color: C.red,     bg: C.redDim,    border: '#ef444433' },
  en_gestion:           { label: 'En gestión',          color: C.amber,   bg: C.amberDim,  border: '#f59e0b33' },
  seguimiento:          { label: 'Seguimiento',         color: C.blue,    bg: C.blueDim,   border: '#60a5fa33' },
  en_pausa:             { label: 'En pausa',            color: '#f97316', bg: 'rgba(249,115,22,0.1)', border: '#f9731633' },
  en_pausa_lifecycle:   { label: 'En pausa',            color: '#f97316', bg: 'rgba(249,115,22,0.1)', border: '#f9731633' },
  cerrado:              { label: 'Cerrado',             color: '#6b7280', bg: 'rgba(107,114,128,0.1)', border: '#6b728033' },
  pendiente_validacion: { label: '⚠ Validar estado',   color: C.red,     bg: C.redDim,    border: '#ef444433' },
}

const FILTER_GROUPS = {
  _activos: ['activo', 'nuevo', 'recuperado'],
  _en_gestion: ['en_gestion', 'seguimiento'],
}

const GESTION_ESTADO_CFG = {
  en_gestion:  { label: 'En gestión',  color: C.amber,   bg: C.amberDim,   border: '#f59e0b33' },
  activo:      { label: 'Activo CRM',  color: C.green,   bg: C.greenDim,   border: '#22c55e33' },
  recuperado:  { label: 'Recuperado',  color: C.purple,  bg: C.purpleDim,  border: '#a78bfa33' },
  perdido:     { label: 'Perdido',     color: C.red,     bg: C.redDim,     border: '#ef444433' },
  en_pausa:    { label: 'En pausa',    color: '#f97316', bg: 'rgba(249,115,22,0.1)', border: '#f9731633' },
  seguimiento: { label: 'Seguimiento', color: C.blue,    bg: C.blueDim,    border: '#60a5fa33' },
}

const ESTADO_ORDER = {
  pendiente_validacion: 0, cerrado: 1, perdido: 2, en_riesgo: 3,
  inactivo: 4, en_pausa_lifecycle: 5, en_pausa: 5,
  en_gestion: 6, seguimiento: 7, recuperado: 8, nuevo: 9, activo: 10,
}

const TIER_COLORS = {
  EPICO:     { label: 'Épico',     color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: '#a78bfa33', min: 500 },
  CLAVE:     { label: 'Clave',     color: '#60a5fa', bg: 'rgba(96,165,250,0.12)',  border: '#60a5fa33', min: 100 },
  DESTACADO: { label: 'Destacado', color: '#14b8a6', bg: 'rgba(20,184,166,0.12)',  border: '#14b8a633', min: 50  },
  BUENO:     { label: 'Bueno',     color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   border: '#22c55e33', min: 20  },
  NORMAL:    { label: 'Normal',    color: '#9ca3af', bg: 'rgba(156,163,175,0.08)', border: '#9ca3af22', min: 0   },
}

function TierBadge({ tier }) {
  const cfg = TIER_COLORS[tier] || TIER_COLORS.NORMAL
  return (
    <span style={{
      background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`,
      borderRadius: 6, padding: '2px 8px', fontSize: 10, fontWeight: 700,
      letterSpacing: '0.04em', whiteSpace: 'nowrap',
    }}>{cfg.label}</span>
  )
}

function TendBadge({ tendencia, delta }) {
  const cfg = tendencia === 'CRECIENDO'
    ? { color: '#22c55e', icon: '▲' }
    : tendencia === 'BAJANDO'
    ? { color: '#ef4444', icon: '▼' }
    : { color: '#9ca3af', icon: '→' }
  return (
    <span style={{ color: cfg.color, fontSize: 11, fontWeight: 600 }}>
      {cfg.icon} {delta > 0 ? '+' : ''}{delta}%
    </span>
  )
}

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

function KpiCard({ label, value, sub, color, icon: Icon, delta, deltaLabel, onClick, active }) {
  const valColor = color === 'green' ? C.green : color === 'red' ? C.red : color === 'amber' ? C.amber : color === 'blue' ? C.blue : color === 'purple' ? C.purple : C.text
  return (
    <div
      onClick={onClick}
      style={{
        background: active ? `${valColor}11` : C.card,
        border: `1px solid ${active ? valColor : C.border}`,
        borderRadius: 12, padding: '16px 18px',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.15s',
        boxShadow: active ? `0 0 0 1px ${valColor}44` : 'none',
      }}
    >
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
  const navigate = useNavigate()
  const [period, setPeriod] = useState({ anio: now.getFullYear(), mes: now.getMonth() + 1 })
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [vista, setVista] = useState('semaforo') // 'semaforo' | 'heatmap' | 'tiers' | 'churn'

  // Tiers state
  const [tiersData, setTiersData] = useState(null)
  const [loadingTiers, setLoadingTiers] = useState(false)
  const [tiersSearch, setTiersSearch] = useState('')
  const [tiersFiltroTier, setTiersFiltroTier] = useState('')
  const [tiersSortCol, setTiersSortCol] = useState('avg_diario')
  const [tiersSortDir, setTiersSortDir] = useState('desc')

  // Churn intelligence state
  const [churnData, setChurnData] = useState(null)
  const [loadingChurn, setLoadingChurn] = useState(false)

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

  const loadTiers = useCallback(async () => {
    setLoadingTiers(true)
    try {
      const { data: d } = await api.get('/dashboard/tiers', {
        params: { mes: period.mes, anio: period.anio }
      })
      setTiersData(d)
    } catch {
      toast.error('Error cargando tiers de sellers')
    } finally {
      setLoadingTiers(false)
    }
  }, [period])

  const loadChurn = async () => {
    setLoadingChurn(true)
    try {
      const [{ data: analytics }, { data: noActivos }] = await Promise.all([
        api.get('/sellers/churn-analytics'),
        api.get('/sellers/no-activos'),
      ])
      setChurnData({ analytics, noActivos })
    } catch {
      toast.error('Error cargando datos de churn')
    } finally {
      setLoadingChurn(false)
    }
  }

  useEffect(() => { load() }, [load])
  useEffect(() => { if (vista === 'tiers') loadTiers() }, [vista, loadTiers])
  useEffect(() => { if (vista === 'churn') loadChurn() }, [vista])
  useEffect(() => { setPage(1) }, [search, filterEstado, sortCol, sortDir])

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortCol(col); setSortDir('desc') }
  }

  const sellersFiltrados = useMemo(() => {
    if (!data?.sellers) return []
    let rows = data.sellers.filter(s => {
      const matchSearch = s.nombre.toLowerCase().includes(search.toLowerCase())
      const group = FILTER_GROUPS[filterEstado]
      const matchEstado = filterEstado === 'todos' || (group ? group.includes(s.estado_efectivo) : s.estado_efectivo === filterEstado)
      return matchSearch && matchEstado
    })
    rows = [...rows].sort((a, b) => {
      if (sortCol === 'nombre') {
        const c = a.nombre.localeCompare(b.nombre)
        return sortDir === 'asc' ? c : -c
      }
      if (sortCol === 'estado') {
        const c = (ESTADO_ORDER[a.estado_efectivo] ?? 9) - (ESTADO_ORDER[b.estado_efectivo] ?? 9)
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

  const tiersSellers = useMemo(() => {
    if (!tiersData?.sellers) return []
    let rows = tiersData.sellers.filter(s => {
      const matchSearch = !tiersSearch || s.nombre.toLowerCase().includes(tiersSearch.toLowerCase())
      const matchTier = !tiersFiltroTier || s.tier === tiersFiltroTier
      return matchSearch && matchTier
    })
    rows = [...rows].sort((a, b) => {
      if (tiersSortCol === 'nombre') {
        const c = a.nombre.localeCompare(b.nombre)
        return tiersSortDir === 'asc' ? c : -c
      }
      if (tiersSortCol === 'tier') {
        const TIER_ORD = { EPICO: 0, CLAVE: 1, DESTACADO: 2, BUENO: 3, NORMAL: 4 }
        const c = (TIER_ORD[a.tier] ?? 9) - (TIER_ORD[b.tier] ?? 9)
        return tiersSortDir === 'asc' ? c : -c
      }
      const va = a[tiersSortCol] ?? -Infinity
      const vb = b[tiersSortCol] ?? -Infinity
      return tiersSortDir === 'asc' ? va - vb : vb - va
    })
    return rows
  }, [tiersData?.sellers, tiersSearch, tiersFiltroTier, tiersSortCol, tiersSortDir])

  const handleTiersSort = (col) => {
    if (tiersSortCol === col) setTiersSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setTiersSortCol(col); setTiersSortDir('desc') }
  }

  // CSV export
  const exportCSV = () => {
    if (!data?.sellers) return
    const header = 'Seller,Estado,Último mes activo,Meses activo,Prom. paquetes/mes,Ingreso mensual prom.,Impacto anual,Semanas sin actividad'
    const rows = sellersFiltrados.map(s =>
      `"${s.nombre}",${ESTADO_CFG[s.estado_efectivo]?.label || s.estado_efectivo || s.estado},${MESES_L[s.ultimo_mes_activo] || '—'},${s.meses_activo},${s.promedio_mensual},${s.ingreso_mensual_avg},${s.impacto_anual},${s.semanas_sin_actividad}`
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

      <PageHeader
        title="Retención y Salud Comercial"
        subtitle="Análisis del estado de cada seller"
        icon={UserCheck}
        accent="green"
        actions={(
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
        )}
      />

      {loading ? (
        <div style={{ textAlign: 'center', padding: '80px 0', color: C.muted }}>Cargando análisis…</div>
      ) : !data ? null : (
        <>
          {/* BLOQUE A: KPIs (clickeables para filtrar) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
            <KpiCard
              label="Activos este mes" value={r.activo}
              sub={`${r.nuevo} nuevos · ${r.recuperado} recuperados`}
              color="green" icon={UserCheck}
              delta={r.activo - r.prev_activo} deltaLabel={MESES_S[period.mes - 1] || 'prev'}
              active={filterEstado === '_activos'} onClick={() => { setFilterEstado(f => f === '_activos' ? 'todos' : '_activos'); setVista('semaforo'); setPage(1) }}
            />
            <KpiCard
              label="En riesgo" value={r.en_riesgo}
              sub="Sin señal este mes, sin gestión activa"
              color="amber" icon={AlertTriangle}
              delta={r.en_riesgo - r.prev_en_riesgo} deltaLabel={MESES_S[period.mes - 1] || 'prev'}
              active={filterEstado === 'en_riesgo'} onClick={() => { setFilterEstado(f => f === 'en_riesgo' ? 'todos' : 'en_riesgo'); setVista('semaforo'); setPage(1) }}
            />
            <KpiCard
              label="Inactivos" value={r.inactivo}
              sub="Sin envíos hace 2-4 meses, sin gestión"
              color="amber" icon={UserMinus}
              active={filterEstado === 'inactivo'} onClick={() => { setFilterEstado(f => f === 'inactivo' ? 'todos' : 'inactivo'); setVista('semaforo'); setPage(1) }}
            />
            <KpiCard
              label="Perdidos" value={r.perdido}
              sub="CRM o sistema: baja definitiva"
              color="red" icon={UserX}
              delta={r.perdido - r.prev_perdido} deltaLabel={MESES_S[period.mes - 1] || 'prev'}
              active={filterEstado === 'perdido'} onClick={() => { setFilterEstado(f => f === 'perdido' ? 'todos' : 'perdido'); setVista('semaforo'); setPage(1) }}
            />
            {(r.en_gestion > 0) && (
              <KpiCard
                label="En gestión" value={r.en_gestion}
                sub="Con gestión comercial activa"
                color="blue" icon={UserCheck}
                active={filterEstado === '_en_gestion'} onClick={() => { setFilterEstado(f => f === '_en_gestion' ? 'todos' : '_en_gestion'); setVista('semaforo'); setPage(1) }}
              />
            )}
            {(r.pendiente_validacion > 0) && (
              <KpiCard
                label="⚠ Validar estado" value={r.pendiente_validacion}
                sub="90+ días sin envíos — requiere acción"
                color="red" icon={AlertTriangle}
                active={filterEstado === 'pendiente_validacion'} onClick={() => { setFilterEstado(f => f === 'pendiente_validacion' ? 'todos' : 'pendiente_validacion'); setVista('semaforo'); setPage(1) }}
              />
            )}
            <KpiCard
              label="Total sellers año" value={r.total_sellers}
              sub={`${period.anio}`}
              color="blue" icon={Users}
              active={filterEstado === 'todos'} onClick={() => { setFilterEstado('todos'); setVista('semaforo'); setPage(1) }}
            />
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, background: C.surface, borderRadius: 10, padding: 4, width: 'fit-content', marginBottom: 20 }}>
            {[['semaforo', '🚦 Semáforo'], ['tiers', '🏆 Tiers'], ['heatmap', '🌡️ Mapa de calor'], ['churn', '🔒 Inteligencia de churn']].map(([id, label]) => (
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
                      <th style={{ padding: '8px 12px', color: C.muted, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>Última gestión</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sellersVisible.map((s, i) => {
                      const cfg = ESTADO_CFG[s.estado_efectivo] || {}
                      const isRisk = ['perdido', 'en_riesgo', 'pendiente_validacion'].includes(s.estado_efectivo)
                      const handlePerfilClick = () => {
                        if (s.es_grupo) navigate(`/admin/sellers/grupo/${encodeURIComponent(s.grupo_nombre)}/perfil?mes=${period.mes}&anio=${period.anio}`)
                        else navigate(`/admin/sellers/${s.seller_id}/perfil?mes=${period.mes}&anio=${period.anio}`)
                      }
                      return (
                        <tr key={s.seller_id ?? s.nombre}
                          onClick={handlePerfilClick}
                          style={{ borderBottom: `1px solid ${C.border}`, background: isRisk ? `${cfg.bg}` : 'transparent', transition: 'background 0.1s', cursor: 'pointer' }}
                          onMouseEnter={e => e.currentTarget.style.background = C.cardHover}
                          onMouseLeave={e => e.currentTarget.style.background = isRisk ? cfg.bg : 'transparent'}
                        >
                          <td style={{ padding: '9px 12px', color: C.text, fontWeight: 500, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {s.nombre}
                            {s.es_grupo && <span style={{ marginLeft: 6, background: C.purpleDim, color: C.purple, border: `1px solid ${C.purple}33`, borderRadius: 4, padding: '1px 6px', fontSize: 9, fontWeight: 700 }}>Grupo</span>}
                            {s.estacional && <span style={{ marginLeft: 4, background: 'rgba(96,165,250,0.1)', color: C.blue, border: `1px solid ${C.blue}33`, borderRadius: 4, padding: '1px 5px', fontSize: 9, fontWeight: 700 }}>Estacional</span>}
                          </td>
                          <td style={{ padding: '9px 12px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <EstadoBadge estado={s.estado_efectivo} />
                              {s.estado_efectivo !== s.estado && (
                                <span style={{ fontSize: 9, color: C.dimmed }}>Envíos: {ESTADO_CFG[s.estado]?.label || s.estado}</span>
                              )}
                            </div>
                          </td>
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
                          <td style={{ padding: '9px 12px', maxWidth: 200 }}>
                            {s.ultima_gestion ? (() => {
                              const TIPO_COLOR = {
                                llamada: C.green, email: C.blue, reunion: C.purple,
                                whatsapp: '#25d366', visita: C.amber, interno: C.muted, otro: C.dimmed,
                              }
                              const GESTION_ESTADO_COLOR = {
                                en_gestion: C.amber, activo: C.green, recuperado: C.purple,
                                perdido: C.red, en_pausa: '#f97316', seguimiento: C.blue,
                              }
                              const g = s.ultima_gestion
                              return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                    <span style={{ fontSize: 9, fontWeight: 700, color: TIPO_COLOR[g.tipo] || C.muted, background: `${TIPO_COLOR[g.tipo] || C.muted}18`, border: `1px solid ${TIPO_COLOR[g.tipo] || C.muted}33`, borderRadius: 4, padding: '1px 5px', textTransform: 'uppercase' }}>{g.tipo}</span>
                                    {g.estado && <span style={{ fontSize: 9, color: GESTION_ESTADO_COLOR[g.estado] || C.muted, fontWeight: 600 }}>{g.estado.replace('_', ' ')}</span>}
                                    <span style={{ fontSize: 9, color: C.dimmed }}>{g.fecha}</span>
                                  </div>
                                  {g.nota && <span style={{ fontSize: 10, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 190 }}>{g.nota}</span>}
                                </div>
                              )
                            })() : <span style={{ color: C.dimmed, fontSize: 10 }}>—</span>}
                          </td>
                        </tr>
                      )
                    })}
                    {sellersVisible.length === 0 && (
                      <tr><td colSpan={10} style={{ padding: '32px', textAlign: 'center', color: C.dimmed }}>Sin resultados</td></tr>
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

          {/* BLOQUE TIERS */}
          {vista === 'tiers' && (
            <div style={{ marginBottom: 24 }}>
              {loadingTiers ? (
                <div style={{ textAlign: 'center', padding: '60px 0', color: C.muted }}>Cargando tiers…</div>
              ) : !tiersData ? null : (
                <>
                  {/* Tier summary cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
                    {['EPICO', 'CLAVE', 'DESTACADO', 'BUENO', 'NORMAL'].map(tier => {
                      const cfg = TIER_COLORS[tier]
                      const res = tiersData.resumen_tiers?.[tier] || {}
                      return (
                        <div key={tier} style={{
                          background: C.card, border: `1px solid ${cfg.border}`, borderRadius: 12,
                          padding: '16px 18px', cursor: 'pointer', transition: 'border-color 0.15s',
                        }}
                          onClick={() => setTiersFiltroTier(tiersFiltroTier === tier ? '' : tier)}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <span style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`, borderRadius: 6, padding: '2px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em' }}>{cfg.label}</span>
                            <span style={{ color: C.muted, fontSize: 10 }}>≥{cfg.min}/día</span>
                          </div>
                          <p style={{ color: cfg.color, fontSize: 28, fontWeight: 800, lineHeight: 1, marginBottom: 2 }}>{res.count ?? 0}</p>
                          <p style={{ color: C.muted, fontSize: 11 }}>sellers</p>
                          <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                            <p style={{ color: C.dimmed, fontSize: 10, marginBottom: 2 }}>{(res.total_paquetes || 0).toLocaleString()} paq. · {(res.avg_diario_tier || 0).toFixed(1)}/día</p>
                            <p style={{ color: C.green, fontSize: 11, fontWeight: 600 }}>${(res.total_ingreso || 0).toLocaleString('es-CL')}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Tiers table */}
                  <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
                    <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 260 }}>
                        <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.muted }} />
                        <input
                          value={tiersSearch} onChange={e => setTiersSearch(e.target.value)}
                          placeholder="Buscar seller…"
                          style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '6px 10px 6px 30px', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                        />
                      </div>
                      <select value={tiersFiltroTier} onChange={e => setTiersFiltroTier(e.target.value)}
                        style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '6px 10px', fontSize: 12 }}>
                        <option value="">Todos los tiers</option>
                        {['EPICO', 'CLAVE', 'DESTACADO', 'BUENO', 'NORMAL'].map(t => <option key={t} value={t}>{TIER_COLORS[t].label}</option>)}
                      </select>
                      <span style={{ color: C.dimmed, fontSize: 11, marginLeft: 'auto' }}>{tiersSellers.length} sellers</span>
                    </div>
                    <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 560 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead style={{ position: 'sticky', top: 0, background: C.surface, zIndex: 1 }}>
                          <tr>
                            {[
                              ['nombre', 'Seller', 'left'],
                              ['tier', 'Tier', 'center'],
                              ['avg_diario', 'Prom. diario', 'right'],
                              ['total_mes', 'Total mes', 'right'],
                              ['ingreso_mes', 'Ingreso mes', 'right'],
                              ['margen_mes', 'Margen', 'right'],
                              ['margen_pp', '$/paquete', 'right'],
                              ['delta_pct', 'vs mes ant.', 'right'],
                            ].map(([col, label, align]) => (
                              <th key={col} onClick={() => handleTiersSort(col)} style={{
                                padding: '8px 12px', textAlign: align, color: tiersSortCol === col ? C.accent : C.muted,
                                fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
                                borderBottom: `1px solid ${C.border}`, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
                              }}>
                                {label} <span style={{ opacity: tiersSortCol === col ? 1 : 0.25 }}>{tiersSortCol === col ? (tiersSortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
                              </th>
                            ))}
                            <th style={{ padding: '8px 12px', color: C.muted, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', borderBottom: `1px solid ${C.border}` }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {tiersSellers.map(s => (
                            <tr key={s.seller_id}
                              onClick={() => navigate(`/admin/sellers/${s.seller_id}/perfil?mes=${period.mes}&anio=${period.anio}`)}
                              style={{ borderBottom: `1px solid ${C.border}`, cursor: 'pointer', transition: 'background 0.1s' }}
                              onMouseEnter={e => e.currentTarget.style.background = C.cardHover}
                              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            >
                              <td style={{ padding: '9px 12px', color: C.text, fontWeight: 500, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.nombre}</td>
                              <td style={{ padding: '9px 12px', textAlign: 'center' }}><TierBadge tier={s.tier} /></td>
                              <td style={{ padding: '9px 12px', textAlign: 'right', color: C.text, fontWeight: 600 }}>{s.avg_diario.toFixed(1)}</td>
                              <td style={{ padding: '9px 12px', textAlign: 'right', color: C.muted }}>{(s.total_mes || 0).toLocaleString()}</td>
                              <td style={{ padding: '9px 12px', textAlign: 'right', color: C.green, fontWeight: 600 }}>${(s.ingreso_mes || 0).toLocaleString('es-CL')}</td>
                              <td style={{ padding: '9px 12px', textAlign: 'right', color: s.margen_mes >= 0 ? C.green : C.red, fontWeight: 600 }}>${(s.margen_mes || 0).toLocaleString('es-CL')}</td>
                              <td style={{ padding: '9px 12px', textAlign: 'right', color: C.muted }}>${(s.margen_pp || 0).toLocaleString()}</td>
                              <td style={{ padding: '9px 12px', textAlign: 'right' }}><TendBadge tendencia={s.tendencia} delta={s.delta_pct} /></td>
                              <td style={{ padding: '9px 12px', textAlign: 'center' }}>
                                <ExternalLink size={12} style={{ color: C.muted, opacity: 0.5 }} />
                              </td>
                            </tr>
                          ))}
                          {tiersSellers.length === 0 && (
                            <tr><td colSpan={9} style={{ padding: '32px', textAlign: 'center', color: C.dimmed }}>Sin resultados</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
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
                        <tr key={s.seller_id ?? s.nombre} style={{ borderBottom: `1px solid ${C.border}22`, cursor: 'pointer' }}
                          onClick={() => {
                            if (s.es_grupo) navigate(`/admin/sellers/grupo/${encodeURIComponent(s.grupo_nombre)}/perfil?mes=${period.mes}&anio=${period.anio}`)
                            else navigate(`/admin/sellers/${s.seller_id}/perfil?mes=${period.mes}&anio=${period.anio}`)
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = C.cardHover}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                          <td style={{ padding: '6px 12px', color: C.text, whiteSpace: 'nowrap', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            <span style={{ marginRight: 6 }}>
                              <EstadoBadge estado={s.estado_efectivo || s.estado} />
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
                        <td style={{ padding: '9px 12px' }}><EstadoBadge estado={s.estado_efectivo || s.estado} /></td>
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
          {vista === 'churn' && (
            <div>
              {loadingChurn ? (
                <div style={{ textAlign: 'center', padding: '40px', color: C.muted }}>Cargando datos de churn…</div>
              ) : churnData ? (() => {
                const { analytics, noActivos } = churnData
                const POTENCIAL_COLOR = {
                  alto: { color: C.green, bg: C.greenDim },
                  medio: { color: C.amber, bg: C.amberDim },
                  bajo: { color: C.muted, bg: 'rgba(156,163,175,0.08)' },
                  ninguno: { color: C.red, bg: C.redDim },
                }
                return (
                  <>
                    {/* KPIs de churn */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
                      {[
                        { label: 'Clientes cerrados', value: analytics.total_cerrados, color: C.red },
                        { label: 'En pausa', value: noActivos.pausados.length, color: '#f97316' },
                        { label: 'Recuperables', value: analytics.recuperables, color: C.amber },
                        { label: 'Tasa de recuperación', value: analytics.total_cerrados > 0 ? `${Math.round(analytics.recuperables / analytics.total_cerrados * 100)}%` : '—', color: C.green },
                      ].map(({ label, value, color }) => (
                        <div key={label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
                          <p style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{label}</p>
                          <p style={{ color, fontSize: 28, fontWeight: 800 }}>{value}</p>
                        </div>
                      ))}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                      {/* Top razones */}
                      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
                        <p style={{ color: C.text, fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Top razones de cierre</p>
                        {analytics.razones.length === 0 && (
                          <p style={{ color: C.dimmed, fontSize: 12 }}>Sin datos aún</p>
                        )}
                        {analytics.razones.map((r, i) => {
                          const maxC = analytics.razones[0]?.count || 1
                          return (
                            <div key={r.razon} style={{ marginBottom: 10 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                <span style={{ color: C.text, fontSize: 12 }}>{r.razon.replace(/_/g, ' ')}</span>
                                <span style={{ color: C.muted, fontSize: 12, fontWeight: 600 }}>{r.count}</span>
                              </div>
                              <div style={{ height: 5, background: C.border, borderRadius: 3 }}>
                                <div style={{ width: `${Math.round(r.count / maxC * 100)}%`, height: '100%', background: i === 0 ? C.red : C.accent, borderRadius: 3, opacity: 0.8 }} />
                              </div>
                            </div>
                          )
                        })}
                      </div>

                      {/* Potencial de recuperación */}
                      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
                        <p style={{ color: C.text, fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Potencial de recuperación</p>
                        {Object.keys(analytics.potencial_recuperacion).length === 0 && (
                          <p style={{ color: C.dimmed, fontSize: 12 }}>Sin datos aún</p>
                        )}
                        {Object.entries(analytics.potencial_recuperacion).sort((a, b) => {
                          const order = { alto: 0, medio: 1, bajo: 2, ninguno: 3 }
                          return (order[a[0]] ?? 4) - (order[b[0]] ?? 4)
                        }).map(([pot, count]) => {
                          const cfg = POTENCIAL_COLOR[pot] || { color: C.muted, bg: 'transparent' }
                          return (
                            <div key={pot} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderRadius: 8, background: cfg.bg, marginBottom: 6 }}>
                              <span style={{ color: cfg.color, fontWeight: 600, fontSize: 12, textTransform: 'capitalize' }}>{pot}</span>
                              <span style={{ color: cfg.color, fontWeight: 800, fontSize: 20 }}>{count}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {/* Listado cerrados con potencial */}
                    {noActivos.cerrados.filter(s => ['alto', 'medio'].includes(s.potencial_recuperacion)).length > 0 && (
                      <div style={{ background: C.card, border: `1px solid ${C.green}33`, borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
                        <div style={{ padding: '12px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ color: C.green, fontSize: 16 }}>🎯</span>
                          <p style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>Clientes cerrados recuperables</p>
                          <span style={{ color: C.muted, fontSize: 11, marginLeft: 4 }}>(alto/medio potencial)</span>
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                          <thead style={{ background: C.surface }}>
                            <tr>
                              {['Seller', 'Cierre', 'Razones', 'Potencial', 'Condición de regreso', 'Acciones'].map(h => (
                                <th key={h} style={{ padding: '8px 14px', textAlign: 'left', color: C.dimmed, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', borderBottom: `1px solid ${C.border}` }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {noActivos.cerrados.filter(s => ['alto', 'medio'].includes(s.potencial_recuperacion)).map(s => {
                              const cfg = POTENCIAL_COLOR[s.potencial_recuperacion] || { color: C.muted, bg: 'transparent' }
                              return (
                                <tr key={s.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                                  <td style={{ padding: '10px 14px', color: C.text, fontWeight: 600 }}>{s.nombre}</td>
                                  <td style={{ padding: '10px 14px', color: C.muted }}>{s.fecha_cierre || '—'}</td>
                                  <td style={{ padding: '10px 14px' }}>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                                      {(s.razones_cierre || []).map(r => (
                                        <span key={r} style={{ fontSize: 9, background: C.redDim, color: C.red, padding: '2px 6px', borderRadius: 4 }}>{r.replace(/_/g, ' ')}</span>
                                      ))}
                                    </div>
                                  </td>
                                  <td style={{ padding: '10px 14px' }}>
                                    <span style={{ color: cfg.color, fontWeight: 700, fontSize: 11, textTransform: 'capitalize' }}>{s.potencial_recuperacion}</span>
                                  </td>
                                  <td style={{ padding: '10px 14px', color: C.muted, maxWidth: 200 }}>{s.condicion_recuperacion || '—'}</td>
                                  <td style={{ padding: '10px 14px' }}>
                                    <button onClick={() => navigate(`/admin/sellers/${s.id}/perfil?mes=${new Date().getMonth() + 1}&anio=${new Date().getFullYear()}`)}
                                      style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, padding: '4px 10px', fontSize: 10, cursor: 'pointer' }}>
                                      Ver perfil
                                    </button>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* En pausa */}
                    {noActivos.pausados.length > 0 && (
                      <div style={{ background: C.card, border: `1px solid #f9731633`, borderRadius: 12, overflow: 'hidden' }}>
                        <div style={{ padding: '12px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ color: '#f97316', fontSize: 16 }}>⏸</span>
                          <p style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>Clientes en pausa</p>
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                          <thead style={{ background: C.surface }}>
                            <tr>
                              {['Seller', 'En pausa desde', 'Retorno estimado', 'Nota'].map(h => (
                                <th key={h} style={{ padding: '8px 14px', textAlign: 'left', color: C.dimmed, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', borderBottom: `1px solid ${C.border}` }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {noActivos.pausados.map(s => (
                              <tr key={s.id} style={{ borderBottom: `1px solid ${C.border}`, cursor: 'pointer' }}
                                onClick={() => navigate(`/admin/sellers/${s.id}/perfil?mes=${new Date().getMonth() + 1}&anio=${new Date().getFullYear()}`)}>
                                <td style={{ padding: '10px 14px', color: C.text, fontWeight: 600 }}>{s.nombre}</td>
                                <td style={{ padding: '10px 14px', color: C.muted }}>{s.fecha_cierre || '—'}</td>
                                <td style={{ padding: '10px 14px', color: '#f97316', fontWeight: 600 }}>{s.fecha_pausa_fin || '—'}</td>
                                <td style={{ padding: '10px 14px', color: C.muted }}>{s.nota_cierre || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )
              })() : (
                <div style={{ textAlign: 'center', padding: '40px', color: C.dimmed }}>Sin datos de churn disponibles</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
