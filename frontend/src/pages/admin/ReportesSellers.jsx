import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api'
import toast from 'react-hot-toast'
import { Search, TrendingUp, TrendingDown, Minus, ExternalLink, BarChart3 } from 'lucide-react'
import PageHeader from '../../components/PageHeader'

const C = {
  bg: '#f8fafc', surface: '#f1f5f9', card: '#ffffff', cardHover: '#f8fafc',
  border: '#e2e8f0',
  accent: '#1e3a5f',
  text: '#1e293b', muted: '#64748b', dimmed: '#94a3b8',
  green: '#16a34a', red: '#dc2626', blue: '#2563eb',
  amber: '#d97706', purple: '#7c3aed',
}

const MESES_L = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

const TIER_CFG = {
  EPICO:     { label: 'Épico',     color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: '#a78bfa33' },
  CLAVE:     { label: 'Clave',     color: '#60a5fa', bg: 'rgba(96,165,250,0.12)',  border: '#60a5fa33' },
  DESTACADO: { label: 'Destacado', color: '#14b8a6', bg: 'rgba(20,184,166,0.12)',  border: '#14b8a633' },
  BUENO:     { label: 'Bueno',     color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   border: '#22c55e33' },
  NORMAL:    { label: 'Normal',    color: '#9ca3af', bg: 'rgba(156,163,175,0.08)', border: '#9ca3af22' },
}

const TIER_ORDER = { EPICO: 0, CLAVE: 1, DESTACADO: 2, BUENO: 3, NORMAL: 4 }

const now = new Date()

function fmt(v) { return `$${Math.abs(v || 0).toLocaleString('es-CL')}` }

function TierBadge({ tier }) {
  const cfg = TIER_CFG[tier] || TIER_CFG.NORMAL
  return (
    <span style={{
      background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`,
      borderRadius: 6, padding: '2px 10px', fontSize: 10, fontWeight: 700,
      letterSpacing: '0.05em', whiteSpace: 'nowrap',
    }}>{cfg.label}</span>
  )
}

function DeltaBadge({ delta, tendencia }) {
  const color = tendencia === 'CRECIENDO' ? C.green : tendencia === 'BAJANDO' ? C.red : C.muted
  const Icon = tendencia === 'CRECIENDO' ? TrendingUp : tendencia === 'BAJANDO' ? TrendingDown : Minus
  return (
    <span style={{ color, fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3, justifyContent: 'flex-end' }}>
      <Icon size={11} />{delta > 0 ? '+' : ''}{delta}%
    </span>
  )
}

function ThSort({ col, label, align = 'right', sortCol, sortDir, onSort }) {
  const active = sortCol === col
  return (
    <th onClick={() => onSort(col)} style={{
      padding: '8px 14px', textAlign: align,
      color: active ? C.accent : C.muted,
      fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
      borderBottom: `1px solid ${C.border}`, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
    }}>
      {label} <span style={{ opacity: active ? 1 : 0.25 }}>{active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
    </th>
  )
}

export default function ReportesSellers() {
  const navigate = useNavigate()
  const [period, setPeriod] = useState({ mes: now.getMonth() + 1, anio: now.getFullYear() })
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [filtroTier, setFiltroTier] = useState('')
  const [sortCol, setSortCol] = useState('avg_diario')
  const [sortDir, setSortDir] = useState('desc')
  const [pageSize, setPageSize] = useState(30)
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: d } = await api.get('/dashboard/tiers', {
        params: { mes: period.mes, anio: period.anio }
      })
      setData(d)
    } catch {
      toast.error('Error cargando reportes de sellers')
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search, filtroTier, sortCol, sortDir])

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortCol(col); setSortDir('desc') }
  }

  const sellersFiltrados = useMemo(() => {
    if (!data?.sellers) return []
    let rows = data.sellers.filter(s => {
      const matchSearch = !search || s.nombre.toLowerCase().includes(search.toLowerCase())
      const matchTier = !filtroTier || s.tier === filtroTier
      return matchSearch && matchTier
    })
    rows = [...rows].sort((a, b) => {
      if (sortCol === 'nombre') {
        const c = a.nombre.localeCompare(b.nombre)
        return sortDir === 'asc' ? c : -c
      }
      if (sortCol === 'tier') {
        const c = (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9)
        return sortDir === 'asc' ? c : -c
      }
      const va = a[sortCol] ?? -Infinity
      const vb = b[sortCol] ?? -Infinity
      return sortDir === 'asc' ? va - vb : vb - va
    })
    return rows
  }, [data?.sellers, search, filtroTier, sortCol, sortDir])

  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(sellersFiltrados.length / pageSize))
  const pageClamped = Math.min(page, totalPages)
  const sellersVisible = pageSize === 0
    ? sellersFiltrados
    : sellersFiltrados.slice((pageClamped - 1) * pageSize, pageClamped * pageSize)

  const handleRowClick = (s) => {
    if (s.es_grupo) navigate(`/admin/sellers/grupo/${encodeURIComponent(s.grupo_nombre)}/perfil?mes=${period.mes}&anio=${period.anio}`)
    else navigate(`/admin/sellers/${s.seller_id}/perfil?mes=${period.mes}&anio=${period.anio}`)
  }

  const res = data?.resumen_tiers || {}

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '24px 20px', color: C.text, fontFamily: 'system-ui, sans-serif' }}>

      <PageHeader
        title="Reportes Sellers"
        subtitle="Análisis de rendimiento por tier y período"
        icon={BarChart3}
        accent="purple"
        actions={(
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={period.anio} onChange={e => setPeriod(p => ({ ...p, anio: +e.target.value }))}
              style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '6px 10px', fontSize: 12 }}>
              {[now.getFullYear() - 1, now.getFullYear()].map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={period.mes} onChange={e => setPeriod(p => ({ ...p, mes: +e.target.value }))}
              style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '6px 10px', fontSize: 12 }}>
              {MESES_L.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
          </div>
        )}
      />

      {/* Tier summary cards */}
      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
          {['EPICO', 'CLAVE', 'DESTACADO', 'BUENO', 'NORMAL'].map(tier => {
            const cfg = TIER_CFG[tier]
            const r = res[tier] || {}
            return (
              <div key={tier}
                onClick={() => setFiltroTier(filtroTier === tier ? '' : tier)}
                style={{
                  background: filtroTier === tier ? cfg.bg : C.card,
                  border: `1px solid ${filtroTier === tier ? cfg.color : C.border}`,
                  borderRadius: 12, padding: '14px 16px', cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`, borderRadius: 6, padding: '2px 10px', fontSize: 10, fontWeight: 700 }}>{cfg.label}</span>
                  <span style={{ color: C.muted, fontSize: 10 }}>≥{cfg.min}/día</span>
                </div>
                <p style={{ color: cfg.color, fontSize: 26, fontWeight: 800, lineHeight: 1, margin: '4px 0 2px' }}>{r.count ?? 0}</p>
                <p style={{ color: C.dimmed, fontSize: 10 }}>sellers · {(r.total_paquetes || 0).toLocaleString()} paq.</p>
                <p style={{ color: C.green, fontSize: 11, fontWeight: 600, marginTop: 4 }}>{fmt(r.total_ingreso || 0)}</p>
              </div>
            )
          })}
        </div>
      )}

      {/* Table */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        {/* Toolbar */}
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 280 }}>
            <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.muted }} />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar seller…"
              style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '6px 10px 6px 30px', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          <select value={filtroTier} onChange={e => setFiltroTier(e.target.value)}
            style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '6px 10px', fontSize: 12 }}>
            <option value="">Todos los tiers</option>
            {['EPICO', 'CLAVE', 'DESTACADO', 'BUENO', 'NORMAL'].map(t => <option key={t} value={t}>{TIER_CFG[t].label}</option>)}
          </select>
          <select value={pageSize} onChange={e => { setPageSize(+e.target.value); setPage(1) }}
            style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '6px 10px', fontSize: 12 }}>
            {[[30, '30 filas'], [50, '50 filas'], [100, '100 filas'], [0, 'Todos']].map(([v, l]) =>
              <option key={v} value={v}>{l}</option>
            )}
          </select>
          <span style={{ color: C.dimmed, fontSize: 11, marginLeft: 'auto' }}>
            {loading ? 'Cargando…' : `${sellersFiltrados.length} sellers`}
          </span>
        </div>

        {/* Table body */}
        <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 600 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ position: 'sticky', top: 0, background: C.surface, zIndex: 1 }}>
              <tr>
                <ThSort col="nombre"     label="Seller"       align="left"  sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <ThSort col="tier"       label="Tier"         align="center" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <ThSort col="avg_diario" label="Prom. diario" align="right" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <ThSort col="total_mes"  label="Total mes"    align="right" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <ThSort col="ingreso_mes" label="Ingreso"     align="right" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <ThSort col="margen_mes" label="Margen"       align="right" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <ThSort col="margen_pp"  label="$/paq."       align="right" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <ThSort col="delta_pct"  label="vs mes ant."  align="right" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <th style={{ padding: '8px 14px', borderBottom: `1px solid ${C.border}` }} />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} style={{ padding: '48px', textAlign: 'center', color: C.dimmed }}>Cargando…</td></tr>
              ) : sellersVisible.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: '48px', textAlign: 'center', color: C.dimmed }}>Sin resultados</td></tr>
              ) : sellersVisible.map(s => (
                <tr key={s.seller_id ?? s.nombre}
                  onClick={() => handleRowClick(s)}
                  style={{ borderBottom: `1px solid ${C.border}`, cursor: 'pointer', transition: 'background 0.1s' }}
                  onMouseEnter={e => e.currentTarget.style.background = C.cardHover}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '10px 14px', color: C.text, fontWeight: 500 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.nombre}</span>
                      {s.es_grupo && (
                        <span style={{ background: 'rgba(167,139,250,0.12)', color: '#a78bfa', border: '1px solid #a78bfa33', borderRadius: 4, padding: '1px 6px', fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap' }}>Grupo</span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'center' }}><TierBadge tier={s.tier} /></td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: C.text, fontWeight: 600 }}>{s.avg_diario?.toFixed(1)}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: C.muted }}>{(s.total_mes || 0).toLocaleString()}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: C.green, fontWeight: 600 }}>{fmt(s.ingreso_mes)}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: s.margen_mes >= 0 ? C.green : C.red, fontWeight: 600 }}>{fmt(s.margen_mes)}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: C.muted }}>{fmt(s.margen_pp)}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right' }}><DeltaBadge delta={s.delta_pct} tendencia={s.tendencia} /></td>
                  <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                    <ExternalLink size={12} style={{ color: C.muted, opacity: 0.5 }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pageSize > 0 && totalPages > 1 && (
          <div style={{ padding: '10px 16px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: C.dimmed, fontSize: 11 }}>
              {sellersFiltrados.length} sellers · pág. {pageClamped}/{totalPages}
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={pageClamped === 1}
                style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12, opacity: pageClamped === 1 ? 0.4 : 1 }}>‹</button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={pageClamped === totalPages}
                style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12, opacity: pageClamped === totalPages ? 0.4 : 1 }}>›</button>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
