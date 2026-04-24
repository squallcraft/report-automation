import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import api from '../../api'
import toast from 'react-hot-toast'
import { ArrowLeft, TrendingUp, TrendingDown, Package, DollarSign, BarChart3, Calendar, Clock, Award, Minus } from 'lucide-react'

// ── Design tokens (mirrors SellerPerfil) ─────────────────────────────────────
const C = {
  bg: '#f8fafc', surface: '#f1f5f9', card: '#ffffff',
  border: '#e2e8f0', borderStrong: '#cbd5e1',
  accent: '#1e3a5f', accentDim: 'rgba(30,58,95,0.08)',
  text: '#1e293b', muted: '#64748b', dimmed: '#94a3b8',
  green: '#16a34a', greenDim: 'rgba(22,163,74,0.1)',
  red: '#dc2626', redDim: 'rgba(220,38,38,0.1)',
  blue: '#2563eb', blueDim: 'rgba(37,99,235,0.1)',
  amber: '#d97706', amberDim: 'rgba(217,119,6,0.1)',
  purple: '#7c3aed',
}

const MESES_S = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const MESES_L = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

function fmt(v) { return `$${Math.abs(v || 0).toLocaleString('es-CL')}` }
function fmtN(v) { return (v || 0).toLocaleString('es-CL') }
function fmtPct(v, force = false) {
  if (v == null) return '—'
  const sign = v >= 0 ? '+' : ''
  return `${sign}${v}%`
}

function VarBadge({ value }) {
  if (value == null) return <span style={{ color: C.dimmed, fontSize: 11 }}>—</span>
  const up = value >= 0
  const color = up ? C.green : C.red
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color, fontSize: 11, fontWeight: 600 }}>
      <Icon size={11} />
      {fmtPct(value)}
    </span>
  )
}

function KPICard({ label, value, sub, icon: Icon, color = C.accent }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', borderLeft: `4px solid ${color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <p style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{label}</p>
        {Icon && <Icon size={14} style={{ color }} />}
      </div>
      <p style={{ color: C.text, fontSize: 22, fontWeight: 800, marginTop: 4 }}>{value}</p>
      {sub && <p style={{ color: C.dimmed, fontSize: 11, marginTop: 4 }}>{sub}</p>}
    </div>
  )
}

function seniority(primerEntregaIso) {
  if (!primerEntregaIso) return null
  const start = new Date(primerEntregaIso)
  const now = new Date()
  const diffMs = now - start
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  const years = Math.floor(days / 365)
  const months = Math.floor((days % 365) / 30)
  if (years > 0) return `${years} año${years > 1 ? 's' : ''} ${months > 0 ? `${months} mes${months > 1 ? 'es' : ''}` : ''}`
  if (months > 0) return `${months} mes${months > 1 ? 'es' : ''}`
  return `${days} días`
}

export default function DriverIngresoPerfil() {
  const { driverId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const now = new Date()

  const [period, setPeriod] = useState({
    mes:  parseInt(searchParams.get('mes'))  || now.getMonth() + 1,
    anio: parseInt(searchParams.get('anio')) || now.getFullYear(),
  })
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expandedWeeks, setExpandedWeeks] = useState(new Set())
  const [expandedYears, setExpandedYears] = useState(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setExpandedWeeks(new Set())
    try {
      const { data: d } = await api.get(`/dashboard/ingresos/driver/${driverId}`, {
        params: { mes: period.mes, anio: period.anio },
      })
      setData(d)
    } catch {
      toast.error('Error cargando perfil del conductor')
    } finally {
      setLoading(false)
    }
  }, [driverId, period])

  useEffect(() => { load() }, [load])

  // ── Annual / semester grouping (computed from meses) ───────────────────
  const porAnio = useMemo(() => {
    if (!data?.meses?.length) return []
    const map = {}
    for (const m of data.meses) {
      if (!map[m.anio]) map[m.anio] = { anio: m.anio, ganancia: 0, entregas: 0, h1: { ganancia: 0, entregas: 0 }, h2: { ganancia: 0, entregas: 0 } }
      map[m.anio].ganancia += m.ganancia
      map[m.anio].entregas += m.entregas
      if (m.mes <= 6) { map[m.anio].h1.ganancia += m.ganancia; map[m.anio].h1.entregas += m.entregas }
      else { map[m.anio].h2.ganancia += m.ganancia; map[m.anio].h2.entregas += m.entregas }
    }
    const years = Object.values(map).sort((a, b) => b.anio - a.anio)
    for (let i = 0; i < years.length; i++) {
      const prev = years[i + 1]
      years[i].var_yoy = prev ? Math.round((years[i].ganancia - prev.ganancia) / prev.ganancia * 100 * 10) / 10 : null
    }
    return years
  }, [data])

  if (loading) {
    return (
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 32, height: 32, border: `3px solid ${C.border}`, borderTopColor: C.accent, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      </div>
    )
  }

  if (!data) return null

  const { driver, stats, primer_entrega, semanas_detalle, periodo_semanas } = data
  const meses = [...(data.meses || [])].reverse() // most recent first
  const sen = seniority(primer_entrega)
  const mejorMes = stats.mejor_mes
  const peorMes  = stats.peor_mes

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '24px 28px', fontFamily: 'inherit' }}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <button
          onClick={() => navigate(-1)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.muted, fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', padding: '6px 10px', borderRadius: 8, transition: 'background 0.15s' }}
        >
          <ArrowLeft size={13} /> Volver
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={period.anio} onChange={e => setPeriod(p => ({ ...p, anio: +e.target.value }))}
            style={{ fontSize: 12, padding: '6px 10px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.card, color: C.text, cursor: 'pointer' }}>
            {[now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear()].map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={period.mes} onChange={e => setPeriod(p => ({ ...p, mes: +e.target.value }))}
            style={{ fontSize: 12, padding: '6px 10px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.card, color: C.text, cursor: 'pointer' }}>
            {MESES_L.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
        </div>
      </div>

      {/* ── Driver identity ───────────────────────────────────────────────── */}
      <div style={{ background: C.accent, borderRadius: 16, padding: '20px 24px', marginBottom: 24, color: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Package size={18} />
              </div>
              <div>
                <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>{driver.nombre}</h1>
                <p style={{ fontSize: 12, opacity: 0.75, margin: 0 }}>
                  {driver.zona || 'Sin zona asignada'}
                  {driver.contratado && <span style={{ marginLeft: 8, background: 'rgba(255,255,255,0.2)', borderRadius: 6, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>CONTRATADO</span>}
                </p>
              </div>
            </div>
            {primer_entrega && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: 0.8, marginTop: 4 }}>
                <Clock size={12} />
                Conductor desde {primer_entrega.slice(0, 7).replace('-', ' · ')}
                {sen && <span style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 6, padding: '1px 8px', marginLeft: 4 }}>{sen}</span>}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>{fmt(stats.ganancia_total)}</p>
              <p style={{ fontSize: 10, opacity: 0.7, margin: 0, textTransform: 'uppercase' }}>Ganancia total</p>
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>{fmtN(stats.entregas_total)}</p>
              <p style={{ fontSize: 10, opacity: 0.7, margin: 0, textTransform: 'uppercase' }}>Entregas totales</p>
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>{stats.total_meses}</p>
              <p style={{ fontSize: 10, opacity: 0.7, margin: 0, textTransform: 'uppercase' }}>Meses activo</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── KPI cards ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
        <KPICard label="Promedio mensual" value={fmt(stats.promedio_mensual)} sub={`${stats.total_meses} meses con actividad`} icon={BarChart3} color={C.accent} />
        <KPICard label="Promedio por entrega" value={fmt(stats.promedio_por_entrega)} sub="Por paquete entregado" icon={DollarSign} color={C.blue} />
        {mejorMes && <KPICard label="Mejor mes" value={fmt(mejorMes.ganancia)} sub={`${MESES_S[mejorMes.mes]} ${mejorMes.anio} · ${fmtN(mejorMes.entregas)} entregas`} icon={Award} color={C.green} />}
        {peorMes  && <KPICard label="Mes más bajo" value={fmt(peorMes.ganancia)} sub={`${MESES_S[peorMes.mes]} ${peorMes.anio} · ${fmtN(peorMes.entregas)} entregas`} icon={Minus} color={C.amber} />}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 20 }}>

        {/* ── Historial mensual ──────────────────────────────────────────── */}
        <div>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Calendar size={13} style={{ color: C.accent }} />
              <p style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, margin: 0 }}>
                Historial mensual
              </p>
              <span style={{ marginLeft: 'auto', color: C.dimmed, fontSize: 10 }}>{meses.length} meses</span>
            </div>
            <div style={{ maxHeight: 420, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead style={{ position: 'sticky', top: 0, background: C.card, zIndex: 1 }}>
                  <tr>
                    {['Mes', 'Entregas', 'Ganancia', 'Prom/paq', 'MoM', 'YoY'].map(h => (
                      <th key={h} style={{ padding: '4px 8px', textAlign: h === 'Mes' ? 'left' : 'right', color: C.dimmed, fontSize: 9, textTransform: 'uppercase', borderBottom: `1px solid ${C.border}`, fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {meses.map((m, i) => {
                    const isMejor = mejorMes && m.mes === mejorMes.mes && m.anio === mejorMes.anio
                    const isSelected = m.mes === period.mes && m.anio === period.anio
                    return (
                      <tr
                        key={`${m.anio}-${m.mes}`}
                        onClick={() => setPeriod({ mes: m.mes, anio: m.anio })}
                        style={{
                          borderBottom: `1px solid ${C.border}`,
                          cursor: 'pointer',
                          background: isSelected ? C.accentDim : 'transparent',
                          transition: 'background 0.1s',
                        }}
                      >
                        <td style={{ padding: '6px 8px', color: C.text, fontWeight: isSelected ? 700 : 400 }}>
                          {MESES_S[m.mes]} {m.anio}
                          {m.parcial && <span style={{ marginLeft: 4, fontSize: 9, color: C.amber }}>parcial</span>}
                          {isMejor && <span style={{ marginLeft: 4, fontSize: 9, color: C.green }}>★</span>}
                        </td>
                        <td style={{ padding: '6px 8px', color: C.muted, textAlign: 'right' }}>{fmtN(m.entregas)}</td>
                        <td style={{ padding: '6px 8px', color: C.green, textAlign: 'right', fontWeight: 600 }}>{fmt(m.ganancia)}</td>
                        <td style={{ padding: '6px 8px', color: C.muted, textAlign: 'right' }}>{fmt(m.promedio)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}><VarBadge value={m.var_mom} /></td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}><VarBadge value={m.var_yoy} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Análisis anual / semestral ────────────────────────────────── */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <TrendingUp size={13} style={{ color: C.accent }} />
              <p style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, margin: 0 }}>
                Análisis anual
              </p>
            </div>
            {porAnio.length === 0 ? (
              <p style={{ color: C.dimmed, fontSize: 12 }}>Sin datos</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr>
                    {['Año', 'Entregas', 'Ganancia', 'vs Año ant.'].map(h => (
                      <th key={h} style={{ padding: '4px 8px', textAlign: h === 'Año' ? 'left' : 'right', color: C.dimmed, fontSize: 9, textTransform: 'uppercase', borderBottom: `1px solid ${C.border}`, fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {porAnio.map(y => {
                    const isExpanded = expandedYears.has(y.anio)
                    return (
                      <React.Fragment key={y.anio}>
                        <tr
                          onClick={() => setExpandedYears(prev => { const n = new Set(prev); n.has(y.anio) ? n.delete(y.anio) : n.add(y.anio); return n })}
                          style={{ borderBottom: `1px solid ${C.border}`, cursor: 'pointer' }}
                        >
                          <td style={{ padding: '7px 8px', color: C.text, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 9, color: C.dimmed, display: 'inline-block', transition: 'transform 0.15s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                            {y.anio}
                          </td>
                          <td style={{ padding: '7px 8px', color: C.muted, textAlign: 'right' }}>{fmtN(y.entregas)}</td>
                          <td style={{ padding: '7px 8px', color: C.green, textAlign: 'right', fontWeight: 600 }}>{fmt(y.ganancia)}</td>
                          <td style={{ padding: '7px 8px', textAlign: 'right' }}><VarBadge value={y.var_yoy} /></td>
                        </tr>
                        {isExpanded && (
                          <>
                            {y.h1.entregas > 0 && (
                              <tr style={{ background: C.surface, borderBottom: `1px solid ${C.border}` }}>
                                <td style={{ padding: '5px 8px 5px 22px', color: C.muted, fontSize: 10 }}>H1 (Ene–Jun)</td>
                                <td style={{ padding: '5px 8px', color: C.muted, textAlign: 'right', fontSize: 10 }}>{fmtN(y.h1.entregas)}</td>
                                <td style={{ padding: '5px 8px', color: C.green, textAlign: 'right', fontSize: 10 }}>{fmt(y.h1.ganancia)}</td>
                                <td />
                              </tr>
                            )}
                            {y.h2.entregas > 0 && (
                              <tr style={{ background: C.surface, borderBottom: `1px solid ${C.border}` }}>
                                <td style={{ padding: '5px 8px 5px 22px', color: C.muted, fontSize: 10 }}>H2 (Jul–Dic)</td>
                                <td style={{ padding: '5px 8px', color: C.muted, textAlign: 'right', fontSize: 10 }}>{fmtN(y.h2.entregas)}</td>
                                <td style={{ padding: '5px 8px', color: C.green, textAlign: 'right', fontSize: 10 }}>{fmt(y.h2.ganancia)}</td>
                                <td />
                              </tr>
                            )}
                          </>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── Right column: sparkline bars + weekly breakdown ────────────── */}
        <div>
          {/* Mini bar chart — last 12 months */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px', marginBottom: 20 }}>
            <p style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14, fontWeight: 600 }}>
              Tendencia — últimos {Math.min(meses.length, 12)} meses
            </p>
            {(() => {
              const last12 = [...meses].slice(0, 12).reverse()
              const maxG = Math.max(...last12.map(m => m.ganancia), 1)
              return (
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 72 }}>
                  {last12.map(m => {
                    const h = Math.max(4, Math.round((m.ganancia / maxG) * 64))
                    const isSelected = m.mes === period.mes && m.anio === period.anio
                    return (
                      <div
                        key={`${m.anio}-${m.mes}`}
                        title={`${MESES_S[m.mes]} ${m.anio}: ${fmt(m.ganancia)}`}
                        onClick={() => setPeriod({ mes: m.mes, anio: m.anio })}
                        style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer' }}
                      >
                        <div style={{ width: '100%', height: `${h}px`, background: isSelected ? C.accent : C.border, borderRadius: '3px 3px 0 0', transition: 'background 0.15s' }} />
                        <span style={{ fontSize: 8, color: C.dimmed, marginTop: 3, writingMode: 'vertical-rl', transform: 'rotate(180deg)', height: 18 }}>
                          {MESES_S[m.mes]}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>

          {/* ── Weekly breakdown ────────────────────────────────────────── */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px' }}>
            <p style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14, fontWeight: 600 }}>
              Semanas — {MESES_S[periodo_semanas?.mes]} {periodo_semanas?.anio}
            </p>
            {semanas_detalle && semanas_detalle.length > 0 ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr>
                    {['Semana', 'Entregas', 'Prom/día', 'Ganancia'].map(h => (
                      <th key={h} style={{ padding: '4px 8px', textAlign: h === 'Semana' ? 'left' : 'right', color: C.dimmed, fontSize: 9, textTransform: 'uppercase', borderBottom: `1px solid ${C.border}`, fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {semanas_detalle.map(s => {
                    const isExp = expandedWeeks.has(s.semana)
                    return (
                      <React.Fragment key={s.semana}>
                        <tr
                          onClick={() => setExpandedWeeks(prev => { const n = new Set(prev); n.has(s.semana) ? n.delete(s.semana) : n.add(s.semana); return n })}
                          style={{ borderBottom: `1px solid ${C.border}`, cursor: 'pointer' }}
                        >
                          <td style={{ padding: '7px 8px', color: C.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 9, color: C.dimmed, display: 'inline-block', transition: 'transform 0.15s', transform: isExp ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                            S{s.semana}
                          </td>
                          <td style={{ padding: '7px 8px', color: C.text, textAlign: 'right', fontWeight: 600 }}>{fmtN(s.entregas)}</td>
                          <td style={{ padding: '7px 8px', color: C.blue, textAlign: 'right' }}>{s.prom_diario}</td>
                          <td style={{ padding: '7px 8px', color: C.green, textAlign: 'right' }}>{fmt(s.ganancia)}</td>
                        </tr>
                        {isExp && s.dias?.map(d => (
                          <tr key={d.fecha} style={{ background: C.surface, borderBottom: `1px solid ${C.border}` }}>
                            <td style={{ padding: '5px 8px 5px 22px', color: C.muted, fontSize: 10 }}>
                              <span style={{ color: C.dimmed, marginRight: 5 }}>{d.dia}</span>
                              {d.fecha}
                            </td>
                            <td style={{ padding: '5px 8px', color: C.text, textAlign: 'right', fontSize: 10 }}>{fmtN(d.entregas)}</td>
                            <td />
                            <td style={{ padding: '5px 8px', color: C.green, textAlign: 'right', fontSize: 10 }}>{fmt(d.ganancia)}</td>
                          </tr>
                        ))}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            ) : (
              <p style={{ color: C.dimmed, fontSize: 12 }}>Sin actividad en {MESES_S[periodo_semanas?.mes]} {periodo_semanas?.anio}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
