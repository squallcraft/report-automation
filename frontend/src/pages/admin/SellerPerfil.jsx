import { useState, useEffect, useCallback } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import api from '../../api'
import toast from 'react-hot-toast'
import { ArrowLeft, TrendingUp, TrendingDown, Package, DollarSign, BarChart3, MapPin, Route, Minus, Users } from 'lucide-react'

// ── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg: '#0d0d0d', surface: '#161616', card: '#1e1e1e', cardHover: '#242424',
  border: '#2a2a2a', borderStrong: '#383838',
  accent: '#e8521a', accentDim: 'rgba(232,82,26,0.12)',
  text: '#f0f0f0', muted: '#8a8a8a', dimmed: '#555555',
  green: '#22c55e', greenDim: 'rgba(34,197,94,0.1)',
  red: '#ef4444', redDim: 'rgba(239,68,68,0.1)',
  blue: '#60a5fa', blueDim: 'rgba(96,165,250,0.1)',
  amber: '#f59e0b', amberDim: 'rgba(245,158,11,0.1)',
  purple: '#a78bfa', purpleDim: 'rgba(167,139,250,0.12)',
}

const MESES_S = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const MESES_L = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

const TIER_CFG = {
  EPICO:  { label: 'Épico',  color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: '#a78bfa44' },
  CLAVE:  { label: 'Clave',  color: '#60a5fa', bg: 'rgba(96,165,250,0.12)',  border: '#60a5fa44' },
  BUENO:  { label: 'Bueno',  color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   border: '#22c55e44' },
  NORMAL: { label: 'Normal', color: '#9ca3af', bg: 'rgba(156,163,175,0.08)', border: '#9ca3af22' },
}

function fmt(v) { return `$${Math.abs(v || 0).toLocaleString('es-CL')}` }
function fmtN(v) { return (v || 0).toLocaleString('es-CL') }

function TierBadge({ tier }) {
  const cfg = TIER_CFG[tier] || TIER_CFG.NORMAL
  return (
    <span style={{
      background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`,
      borderRadius: 8, padding: '4px 14px', fontSize: 12, fontWeight: 700, letterSpacing: '0.06em',
    }}>{cfg.label}</span>
  )
}

function HealthRing({ score }) {
  const r = 28
  const circ = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(score, 100))
  const dash = (pct / 100) * circ
  const color = pct >= 70 ? C.green : pct >= 40 ? C.amber : C.red
  return (
    <div style={{ position: 'relative', width: 72, height: 72 }}>
      <svg width={72} height={72} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={36} cy={36} r={r} fill="none" stroke={C.border} strokeWidth={6} />
        <circle cx={36} cy={36} r={r} fill="none" stroke={color} strokeWidth={6}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color, fontSize: 15, fontWeight: 800, lineHeight: 1 }}>{score}</span>
        <span style={{ color: C.dimmed, fontSize: 8, lineHeight: 1 }}>score</span>
      </div>
    </div>
  )
}

function KpiCard({ label, value, sub, color, icon: Icon, delta, deltaNeg }) {
  const valColor = color === 'green' ? C.green : color === 'red' ? C.red : color === 'amber' ? C.amber : color === 'blue' ? C.blue : color === 'purple' ? C.purple : C.text
  const isUp = (delta ?? 0) > 0
  const isDown = (delta ?? 0) < 0
  const deltaColor = deltaNeg
    ? (isUp ? C.red : isDown ? C.green : C.dimmed)
    : (isUp ? C.green : isDown ? C.red : C.dimmed)
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <p style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</p>
        {Icon && <Icon size={14} style={{ color: valColor, opacity: 0.7 }} />}
      </div>
      <p style={{ color: valColor, fontSize: 26, fontWeight: 800, lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ color: C.dimmed, fontSize: 11, marginTop: 4 }}>{sub}</p>}
      {delta !== undefined && delta !== null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
          {isUp ? <TrendingUp size={11} style={{ color: deltaColor }} /> : isDown ? <TrendingDown size={11} style={{ color: deltaColor }} /> : <Minus size={11} style={{ color: C.dimmed }} />}
          <span style={{ fontSize: 11, color: deltaColor }}>{isUp ? '+' : ''}{delta}% vs mes ant.</span>
        </div>
      )}
    </div>
  )
}

// ── Mini bar chart (inline SVG) ───────────────────────────────────────────────
function BarChart({ data, keyY, keyX, height = 80, color = C.blue, highlightLast = true }) {
  const maxVal = Math.max(...data.map(d => d[keyY] || 0), 1)
  const w = 100 / data.length
  return (
    <svg viewBox={`0 0 100 ${height}`} style={{ width: '100%', height }} preserveAspectRatio="none">
      {data.map((d, i) => {
        const h = Math.max((d[keyY] / maxVal) * (height - 10), d[keyY] > 0 ? 3 : 0)
        const x = i * w
        const y = height - h
        const isLast = highlightLast && i === data.length - 1
        return (
          <g key={i}>
            <rect x={x + w * 0.1} y={y} width={w * 0.8} height={h}
              fill={isLast ? C.accent : color} opacity={isLast ? 1 : 0.65} rx={1} />
          </g>
        )
      })}
    </svg>
  )
}

const now = new Date()

export default function SellerPerfil() {
  const { sellerId, grupoName } = useParams()
  const isGrupo = !!grupoName
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const [period, setPeriod] = useState({
    mes: parseInt(searchParams.get('mes')) || now.getMonth() + 1,
    anio: parseInt(searchParams.get('anio')) || now.getFullYear(),
  })
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const endpoint = isGrupo
        ? `/dashboard/grupo/${encodeURIComponent(grupoName)}/perfil`
        : `/dashboard/seller/${sellerId}/perfil`
      const { data: d } = await api.get(endpoint, {
        params: { mes: period.mes, anio: period.anio }
      })
      setData(d)
    } catch {
      toast.error('Error cargando perfil')
    } finally {
      setLoading(false)
    }
  }, [sellerId, grupoName, isGrupo, period])

  useEffect(() => { load() }, [load])

  if (loading) return (
    <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted }}>
      Cargando perfil…
    </div>
  )
  if (!data) return null

  const { seller, kpis, tier, health_score, tendencia_mensual, top_comunas, top_rutas, semanas_detalle, mejor_mes } = data
  const tierCfg = TIER_CFG[tier] || TIER_CFG.NORMAL
  const maxTrend = Math.max(...(tendencia_mensual || []).map(r => r.total), 1)

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '24px 20px', color: C.text, fontFamily: 'system-ui, sans-serif' }}>

      {/* ── Back + period ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <button onClick={() => navigate(-1)} style={{
          display: 'flex', alignItems: 'center', gap: 6, background: 'transparent',
          border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer',
        }}>
          <ArrowLeft size={13} /> Volver
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={period.anio} onChange={e => setPeriod(p => ({ ...p, anio: +e.target.value }))}
            style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '6px 10px', fontSize: 12 }}>
            {[now.getFullYear() - 1, now.getFullYear()].map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={period.mes} onChange={e => setPeriod(p => ({ ...p, mes: +e.target.value }))}
            style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '6px 10px', fontSize: 12 }}>
            {MESES_L.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
        </div>
      </div>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '20px 24px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
        <HealthRing score={health_score} />
          <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: C.text, margin: 0 }}>{seller.nombre}</h1>
            <TierBadge tier={tier} />
            {seller.es_grupo && (
              <span style={{
                display: 'flex', alignItems: 'center', gap: 4,
                background: 'rgba(167,139,250,0.12)', color: '#a78bfa',
                border: '1px solid #a78bfa33', borderRadius: 6, padding: '2px 10px',
                fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
              }}>
                <Users size={10} /> Grupo analítico
              </span>
            )}
          </div>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>
            {seller.empresa || 'ECOURIER'} · RUT {seller.rut || '—'} · {MESES_L[period.mes]} {period.anio}
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ color: C.dimmed, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Último envío</p>
          <p style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>{data.ultimo_envio || '—'}</p>
          {mejor_mes && (
            <p style={{ color: C.dimmed, fontSize: 10, marginTop: 4 }}>Mejor mes: {MESES_S[mejor_mes.mes]}/{mejor_mes.anio} ({fmtN(mejor_mes.total)} paq.)</p>
          )}
        </div>
      </div>

      {/* ── KPIs ────────────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
        <KpiCard label="Paquetes mes" value={fmtN(kpis.total_mes)} icon={Package}
          sub={`${kpis.avg_diario} paq/día · ${kpis.dias_activos} días activos`}
          delta={kpis.delta_pct} color="blue" />
        <KpiCard label="Ingreso bruto" value={fmt(kpis.ingreso_mes)} icon={DollarSign}
          sub={`Ant. ${fmt(kpis.prev_ingreso)}`} delta={kpis.delta_pct} color="green" />
        <KpiCard label="Margen neto" value={fmt(kpis.margen_mes)} icon={BarChart3}
          sub={`${kpis.margen_pct}% del ingreso`} color={kpis.margen_mes >= 0 ? 'green' : 'red'} />
        <KpiCard label="Margen / paquete" value={fmt(kpis.margen_pp)} icon={Package}
          color={kpis.margen_pp >= 0 ? 'green' : 'red'} />
        <KpiCard label="Costo operativo" value={fmt(kpis.costo_mes)}
          sub={`${kpis.ingreso_mes > 0 ? Math.round(kpis.costo_mes / kpis.ingreso_mes * 100) : 0}% del ingreso`}
          color="amber" deltaNeg delta={kpis.delta_pct} icon={TrendingDown} />
      </div>

      {/* ── Trend chart + weekly breakdown ──────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 20 }}>

        {/* Tendencia mensual */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
          <p style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>
            Tendencia de volumen — últimos {tendencia_mensual?.length || 0} meses
          </p>
          {tendencia_mensual && tendencia_mensual.length > 0 ? (
            <>
              <BarChart data={tendencia_mensual} keyY="total" height={90} color={C.blue} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                {tendencia_mensual.slice(-6).map((r, i) => (
                  <span key={i} style={{ color: C.dimmed, fontSize: 9, textAlign: 'center' }}>{MESES_S[r.mes]}</span>
                ))}
              </div>
              {/* Ingreso trend line as simple bars */}
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
                <p style={{ color: C.dimmed, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Ingreso mensual</p>
                <BarChart data={tendencia_mensual} keyY="ingreso" height={50} color={C.green} />
              </div>
            </>
          ) : (
            <p style={{ color: C.dimmed, fontSize: 12 }}>Sin datos de tendencia</p>
          )}
        </div>

        {/* Desglose semanal */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
          <p style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>
            Semanas — {MESES_S[period.mes]}
          </p>
          {semanas_detalle && semanas_detalle.length > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr>
                  {['Semana', 'Paq.', 'Ingreso', 'Margen'].map(h => (
                    <th key={h} style={{ padding: '4px 8px', textAlign: 'right', color: C.dimmed, fontSize: 9, textTransform: 'uppercase', borderBottom: `1px solid ${C.border}`, fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {semanas_detalle.map(s => (
                  <tr key={s.semana} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: '7px 8px', color: C.muted, textAlign: 'right' }}>S{s.semana}</td>
                    <td style={{ padding: '7px 8px', color: C.text, textAlign: 'right', fontWeight: 600 }}>{fmtN(s.total)}</td>
                    <td style={{ padding: '7px 8px', color: C.green, textAlign: 'right' }}>{fmt(s.ingreso)}</td>
                    <td style={{ padding: '7px 8px', color: s.margen >= 0 ? C.green : C.red, textAlign: 'right' }}>{fmt(s.margen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ color: C.dimmed, fontSize: 12 }}>Sin envíos este mes</p>
          )}
        </div>
      </div>

      {/* ── Comunas + Rutas ──────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>

        {/* Top comunas */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <MapPin size={13} style={{ color: C.accent }} />
            <p style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Top comunas — {MESES_S[period.mes]}</p>
          </div>
          {top_comunas && top_comunas.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {top_comunas.map((c, i) => {
                const maxC = top_comunas[0].total
                const pct = Math.round((c.total / maxC) * 100)
                return (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ color: C.text, fontSize: 11, fontWeight: i === 0 ? 600 : 400 }}>{c.comuna}</span>
                      <span style={{ color: C.muted, fontSize: 11 }}>{fmtN(c.total)}</span>
                    </div>
                    <div style={{ height: 4, background: C.border, borderRadius: 2 }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: i === 0 ? C.accent : C.blue, borderRadius: 2, opacity: 0.7 }} />
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p style={{ color: C.dimmed, fontSize: 12 }}>Sin datos de comunas este mes</p>
          )}
        </div>

        {/* Top rutas */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <Route size={13} style={{ color: C.accent }} />
            <p style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Top rutas — {MESES_S[period.mes]}</p>
          </div>
          {top_rutas && top_rutas.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {top_rutas.map((r, i) => {
                const maxR = top_rutas[0].total
                const pct = Math.round((r.total / maxR) * 100)
                return (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ color: C.text, fontSize: 11, fontWeight: i === 0 ? 600 : 400, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.ruta}</span>
                      <span style={{ color: C.muted, fontSize: 11 }}>{fmtN(r.total)}</span>
                    </div>
                    <div style={{ height: 4, background: C.border, borderRadius: 2 }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: i === 0 ? C.accent : C.purple, borderRadius: 2, opacity: 0.7 }} />
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p style={{ color: C.dimmed, fontSize: 12 }}>Sin datos de rutas este mes</p>
          )}
        </div>
      </div>

      {/* ── Monthly table (last 12 months) ──────────────────────────────────── */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '12px 18px', borderBottom: `1px solid ${C.border}` }}>
          <p style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>Histórico mensual</p>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ background: C.surface }}>
              <tr>
                {['Mes/Año', 'Paquetes', 'Ingreso', 'Costo', 'Margen', 'Margen %'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'right', color: C.muted, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', borderBottom: `1px solid ${C.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...(tendencia_mensual || [])].reverse().map((r, i) => {
                const isCurrent = r.mes === period.mes && r.anio === period.anio
                const margenPct = r.ingreso > 0 ? Math.round(r.margen / r.ingreso * 100) : 0
                return (
                  <tr key={i} style={{ borderBottom: `1px solid ${C.border}`, background: isCurrent ? C.accentDim : 'transparent' }}>
                    <td style={{ padding: '8px 12px', color: isCurrent ? C.accent : C.muted, fontWeight: isCurrent ? 700 : 400, textAlign: 'right' }}>
                      {MESES_S[r.mes]} {r.anio}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: C.text, fontWeight: 600 }}>{fmtN(r.total)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: C.green }}>{fmt(r.ingreso)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: C.amber }}>{fmt(r.costo)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: r.margen >= 0 ? C.green : C.red, fontWeight: 600 }}>{fmt(r.margen)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: margenPct >= 20 ? C.green : margenPct >= 10 ? C.amber : C.red }}>
                      {margenPct}%
                    </td>
                  </tr>
                )
              })}
              {!tendencia_mensual?.length && (
                <tr><td colSpan={6} style={{ padding: '28px', textAlign: 'center', color: C.dimmed }}>Sin datos históricos</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  )
}
