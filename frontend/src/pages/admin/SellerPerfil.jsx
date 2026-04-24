import { useState, useEffect, useCallback, useRef } from 'react'
import React from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import api from '../../api'
import toast from 'react-hot-toast'
import { ArrowLeft, TrendingUp, TrendingDown, Package, DollarSign, BarChart3, MapPin, Route, Minus, Users, Plus, Trash2, MessageSquare, Bell, Calculator, PauseCircle, XCircle, PlayCircle, AlertTriangle } from 'lucide-react'

// ── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg: '#f8fafc', surface: '#f1f5f9', card: '#ffffff', cardHover: '#f8fafc',
  border: '#e2e8f0', borderStrong: '#cbd5e1',
  accent: '#1e3a5f', accentDim: 'rgba(30,58,95,0.08)',
  text: '#1e293b', muted: '#64748b', dimmed: '#94a3b8',
  green: '#16a34a', greenDim: 'rgba(22,163,74,0.1)',
  red: '#dc2626', redDim: 'rgba(220,38,38,0.1)',
  blue: '#2563eb', blueDim: 'rgba(37,99,235,0.1)',
  amber: '#d97706', amberDim: 'rgba(217,119,6,0.1)',
  purple: '#7c3aed', purpleDim: 'rgba(124,58,237,0.12)',
}

const MESES_S = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const MESES_L = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

const TIER_CFG = {
  EPICO:     { label: 'Épico',     color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: '#a78bfa44' },
  CLAVE:     { label: 'Clave',     color: '#60a5fa', bg: 'rgba(96,165,250,0.12)',  border: '#60a5fa44' },
  DESTACADO: { label: 'Destacado', color: '#14b8a6', bg: 'rgba(20,184,166,0.12)',  border: '#14b8a644' },
  BUENO:     { label: 'Bueno',     color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   border: '#22c55e44' },
  NORMAL:    { label: 'Normal',    color: '#9ca3af', bg: 'rgba(156,163,175,0.08)', border: '#9ca3af22' },
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

  const [expandedWeeks, setExpandedWeeks] = useState(new Set())

  // Gestión comercial
  const [gestion, setGestion] = useState([])
  const [tagInput, setTagInput] = useState('')
  const [savingTags, setSavingTags] = useState(false)
  const [showGestionModal, setShowGestionModal] = useState(false)
  const [gestionForm, setGestionForm] = useState({
    fecha: new Date().toISOString().split('T')[0],
    tipo: 'llamada', estado: '', razon: '', nota: '', recordatorio: '',
  })
  const [savingGestion, setSavingGestion] = useState(false)

  // Simulador de descuento
  const [simDescuento, setSimDescuento] = useState('')     // % descuento
  const [simPaquetes, setSimPaquetes] = useState('')        // paquetes proyectados (opcional)
  const [simModo, setSimModo] = useState('pct')             // 'pct' | 'precio'
  const [simPrecioDirecto, setSimPrecioDirecto] = useState('') // precio directo por paquete

  // Lifecycle comercial (cerrar / pausar / reabrir)
  const [showCierreModal, setShowCierreModal] = useState(false)
  const [showPausaModal, setShowPausaModal] = useState(false)
  const [showReabrirModal, setShowReabrirModal] = useState(false)
  const [lifecycleForm, setLifecycleForm] = useState({})
  const [savingLifecycle, setSavingLifecycle] = useState(false)

  const RAZONES_CIERRE_OPTS = [
    { value: 'tarifas', label: 'Buscó mejores tarifas' },
    { value: 'calidad_servicio', label: 'Problemas de calidad/servicio' },
    { value: 'cierre_negocio', label: 'Cerró su negocio' },
    { value: 'competidor', label: 'Se fue con la competencia' },
    { value: 'ubicacion', label: 'Cambio de ubicación/zona' },
    { value: 'comunicacion', label: 'Problemas de comunicación' },
    { value: 'mal_pagador', label: 'Mal pagador' },
    { value: 'metodologia', label: 'Diferencias metodológicas' },
    { value: 'otro', label: 'Otro' },
  ]

  const cerrarSeller = async () => {
    setSavingLifecycle(true)
    try {
      await api.post(`/sellers/${sellerId}/cerrar`, lifecycleForm)
      toast.success('Cliente cerrado')
      setShowCierreModal(false)
      setLifecycleForm({})
      load()
    } catch { toast.error('Error al cerrar cliente') }
    finally { setSavingLifecycle(false) }
  }

  const pausarSeller = async () => {
    setSavingLifecycle(true)
    try {
      await api.post(`/sellers/${sellerId}/pausar`, lifecycleForm)
      toast.success('Cliente pausado')
      setShowPausaModal(false)
      setLifecycleForm({})
      load()
    } catch { toast.error('Error al pausar cliente') }
    finally { setSavingLifecycle(false) }
  }

  const reabrir = async () => {
    setSavingLifecycle(true)
    try {
      await api.post(`/sellers/${sellerId}/reabrir`, lifecycleForm)
      toast.success('Cliente reactivado')
      setShowReabrirModal(false)
      setLifecycleForm({})
      load()
    } catch { toast.error('Error al reabrir cliente') }
    finally { setSavingLifecycle(false) }
  }

  const load = useCallback(async () => {
    setLoading(true)
    setExpandedWeeks(new Set())
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

  const loadGestion = useCallback(async () => {
    if (isGrupo) return   // grupos no tienen gestión individual
    try {
      const { data: d } = await api.get(`/dashboard/seller/${sellerId}/gestion`)
      setGestion(d)
    } catch { /* silent */ }
  }, [sellerId, isGrupo])

  useEffect(() => { loadGestion() }, [loadGestion])

  const saveTags = async (nuevosTags) => {
    setSavingTags(true)
    try {
      await api.put(`/sellers/${sellerId}/tags`, { tags: nuevosTags })
      setData(d => ({ ...d, seller: { ...d.seller, tags: nuevosTags } }))
      toast.success('Tags actualizados')
    } catch { toast.error('Error guardando tags') }
    finally { setSavingTags(false) }
  }

  const addTag = () => {
    const t = tagInput.trim().toLowerCase().replace(/\s+/g, '_')
    if (!t) return
    const curr = data?.seller?.tags || []
    if (curr.includes(t)) { setTagInput(''); return }
    saveTags([...curr.filter(x => !x.startsWith('auto:')), t])
    setTagInput('')
  }

  const removeTag = (tag) => {
    if (tag.startsWith('auto:')) return // no se pueden borrar tags automáticos
    const curr = data?.seller?.tags || []
    saveTags(curr.filter(t => t !== tag))
  }

  const saveGestion = async () => {
    if (!gestionForm.tipo) return toast.error('Selecciona el tipo de contacto')
    setSavingGestion(true)
    try {
      await api.post(`/dashboard/seller/${sellerId}/gestion`, gestionForm)
      toast.success('Registro guardado')
      setShowGestionModal(false)
      setGestionForm({ fecha: new Date().toISOString().split('T')[0], tipo: 'llamada', estado: '', razon: '', nota: '', recordatorio: '' })
      loadGestion()
    } catch { toast.error('Error guardando registro') }
    finally { setSavingGestion(false) }
  }

  const deleteGestion = async (id) => {
    if (!window.confirm('¿Eliminar este registro?')) return
    try {
      await api.delete(`/dashboard/seller/${sellerId}/gestion/${id}`)
      setGestion(g => g.filter(e => e.id !== id))
    } catch { toast.error('Error eliminando registro') }
  }

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

      {/* ── Header (premium dark style) ────────────────────────────────────── */}
      <div style={{
        background: 'linear-gradient(135deg, #1e3a5f 0%, #264a73 50%, #1e3a5f 100%)',
        borderRadius: 16, padding: '40px 36px', marginBottom: 20,
        display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap',
        position: 'relative', overflow: 'hidden', minHeight: 140,
      }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 20% 50%, rgba(30,58,95,0.6) 0%, transparent 70%), radial-gradient(ellipse at 80% 20%, rgba(37,99,235,0.1) 0%, transparent 50%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: 0, right: 0, width: '40%', height: '100%', background: 'linear-gradient(135deg, transparent 40%, rgba(255,255,255,0.03) 100%)', pointerEvents: 'none' }} />

        {/* Score ring (glow effect) */}
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ position: 'absolute', inset: -8, borderRadius: '50%', background: `radial-gradient(circle, ${health_score >= 70 ? 'rgba(22,163,74,0.2)' : health_score >= 40 ? 'rgba(217,119,6,0.2)' : 'rgba(220,38,38,0.2)'} 0%, transparent 70%)` }} />
          <HealthRing score={health_score} />
        </div>

        <div style={{ flex: 1, minWidth: 180, position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 33, fontWeight: 800, color: '#f1f5f9', margin: 0, letterSpacing: '0.02em', textTransform: 'uppercase' }}>{seller.nombre}</h1>
            <TierBadge tier={tier} />
            {seller.es_grupo && (
              <span style={{
                display: 'flex', alignItems: 'center', gap: 4,
                background: 'rgba(167,139,250,0.15)', color: '#a78bfa',
                border: '1px solid rgba(167,139,250,0.3)', borderRadius: 6, padding: '3px 10px',
                fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
              }}>
                <Users size={10} /> Grupo analítico
              </span>
            )}
            {seller.tipo_cierre === 'pausa' && (
              <span style={{
                display: 'flex', alignItems: 'center', gap: 4,
                background: 'rgba(249,115,22,0.15)', color: '#fb923c',
                border: '1px solid rgba(249,115,22,0.3)', borderRadius: 6, padding: '3px 10px',
                fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
              }}>
                <PauseCircle size={10} /> En pausa {seller.fecha_pausa_fin ? `· retorno est. ${seller.fecha_pausa_fin}` : ''}
              </span>
            )}
            {seller.tipo_cierre === 'cerrado' && (
              <span style={{
                display: 'flex', alignItems: 'center', gap: 4,
                background: 'rgba(239,68,68,0.15)', color: '#f87171',
                border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, padding: '3px 10px',
                fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
              }}>
                <XCircle size={10} /> Cerrado {seller.fecha_cierre ? `· ${seller.fecha_cierre}` : ''}
              </span>
            )}
          </div>
          <p style={{ color: '#94a3b8', fontSize: 12, marginTop: 6 }}>
            {seller.empresa || 'ECOURIER'} · RUT {seller.rut || '—'} · {MESES_L[period.mes]} {period.anio}
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, position: 'relative', zIndex: 1 }}>
          <div style={{ textAlign: 'right' }}>
            <p style={{ color: '#64748b', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Último envío</p>
            <p style={{ color: '#f1f5f9', fontSize: 18, fontWeight: 700 }}>{data.ultimo_envio || '—'}</p>
            {mejor_mes && (
              <p style={{ color: '#64748b', fontSize: 10, marginTop: 4 }}>Mejor mes: {MESES_S[mejor_mes.mes]}/{mejor_mes.anio} ({fmtN(mejor_mes.total)} paq.)</p>
            )}
          </div>
          {!isGrupo && (
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              {(!seller.tipo_cierre) && (
                <>
                  <button onClick={() => { setLifecycleForm({}); setShowPausaModal(true) }}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'transparent', border: '1px solid rgba(249,115,22,0.4)', color: '#fb923c', borderRadius: 7, padding: '5px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                    <PauseCircle size={12} /> Poner en pausa
                  </button>
                  <button onClick={() => { setLifecycleForm({ razones_cierre: [] }); setShowCierreModal(true) }}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'transparent', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171', borderRadius: 7, padding: '5px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                    <XCircle size={12} /> Cerrar cliente
                  </button>
                </>
              )}
              {seller.tipo_cierre && (
                <button onClick={() => { setLifecycleForm({}); setShowReabrirModal(true) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'transparent', border: '1px solid rgba(22,163,74,0.4)', color: '#4ade80', borderRadius: 7, padding: '5px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                  <PlayCircle size={12} /> Reabrir cliente
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Tags ────────────────────────────────────────────────────────────── */}
      {!isGrupo && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: C.dimmed, fontWeight: 600, whiteSpace: 'nowrap' }}>Tags:</span>
          {(data.seller.tags || []).map(tag => {
            const isAuto = tag.startsWith('auto:')
            const label = isAuto ? tag.replace('auto:', '') : tag
            return (
              <span key={tag} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                background: isAuto ? 'rgba(37,99,235,0.1)' : 'rgba(100,116,139,0.1)',
                color: isAuto ? '#2563eb' : C.muted,
                border: `1px solid ${isAuto ? '#2563eb33' : C.border}`,
                borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 600,
              }}>
                {isAuto && <span style={{ fontSize: 9, opacity: 0.7 }}>AUTO</span>}
                {label}
                {!isAuto && (
                  <button onClick={() => removeTag(tag)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginLeft: 2, color: C.muted, display: 'flex' }}>
                    ×
                  </button>
                )}
              </span>
            )
          })}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addTag()}
              placeholder="+ nuevo tag"
              style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 20, padding: '2px 10px', fontSize: 11, outline: 'none', width: 100 }}
            />
            <button onClick={addTag} disabled={savingTags}
              style={{ background: C.accent, color: '#fff', border: 'none', borderRadius: 20, padding: '2px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
              Agregar
            </button>
          </div>
        </div>
      )}

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
                  {['Semana', 'Paq.', 'Prom./día', 'Ingreso', 'Margen'].map(h => (
                    <th key={h} style={{ padding: '4px 8px', textAlign: 'right', color: C.dimmed, fontSize: 9, textTransform: 'uppercase', borderBottom: `1px solid ${C.border}`, fontWeight: 600,
                      ...(h === 'Semana' ? { textAlign: 'left' } : {}) }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {semanas_detalle.map(s => {
                  const isExpanded = expandedWeeks.has(s.semana)
                  return (
                    <React.Fragment key={s.semana}>
                      <tr
                        key={s.semana}
                        style={{ borderBottom: `1px solid ${C.border}`, cursor: 'pointer' }}
                        onClick={() => setExpandedWeeks(prev => {
                          const next = new Set(prev)
                          next.has(s.semana) ? next.delete(s.semana) : next.add(s.semana)
                          return next
                        })}
                      >
                        <td style={{ padding: '7px 8px', color: C.muted, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 9, color: C.dimmed, userSelect: 'none', transition: 'transform 0.15s', display: 'inline-block', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                          S{s.semana}
                        </td>
                        <td style={{ padding: '7px 8px', color: C.text, textAlign: 'right', fontWeight: 600 }}>{fmtN(s.total)}</td>
                        <td style={{ padding: '7px 8px', color: C.blue, textAlign: 'right' }}>{s.prom_diario}</td>
                        <td style={{ padding: '7px 8px', color: C.green, textAlign: 'right' }}>{fmt(s.ingreso)}</td>
                        <td style={{ padding: '7px 8px', color: s.margen >= 0 ? C.green : C.red, textAlign: 'right' }}>{fmt(s.margen)}</td>
                      </tr>
                      {isExpanded && s.dias?.map(d => (
                        <tr key={d.fecha} style={{ background: C.surface, borderBottom: `1px solid ${C.border}` }}>
                          <td style={{ padding: '5px 8px 5px 24px', color: C.muted, textAlign: 'left', fontSize: 10 }}>
                            <span style={{ color: C.dimmed, marginRight: 6 }}>{d.dia}</span>
                            {d.fecha}
                          </td>
                          <td style={{ padding: '5px 8px', color: C.text, textAlign: 'right', fontSize: 10 }}>{fmtN(d.total)}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right' }}></td>
                          <td style={{ padding: '5px 8px', color: C.green, textAlign: 'right', fontSize: 10 }}>{fmt(d.ingreso)}</td>
                          <td style={{ padding: '5px 8px', color: d.margen >= 0 ? C.green : C.red, textAlign: 'right', fontSize: 10 }}>{fmt(d.margen)}</td>
                        </tr>
                      ))}
                    </React.Fragment>
                  )
                })}
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

      {/* ── Dos columnas: Gestión comercial + Simulador ────────────────────── */}
      {!isGrupo && (
        <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 16, marginTop: 20 }}>

          {/* ── Motor 4: Gestión Comercial ─────────────────────────────────── */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '12px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <MessageSquare size={14} style={{ color: C.accent }} />
                <p style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>Gestión Comercial</p>
              </div>
              <button onClick={() => setShowGestionModal(true)} style={{
                display: 'flex', alignItems: 'center', gap: 5, background: C.accent,
                border: 'none', color: '#fff', borderRadius: 7, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}>
                <Plus size={12} /> Registrar
              </button>
            </div>

            {gestion.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: C.dimmed, fontSize: 12 }}>
                Sin registros de gestión. Usa el botón para agregar el primer contacto.
              </div>
            ) : (
              <div style={{ overflowY: 'auto', maxHeight: 420 }}>
                {gestion.map(e => {
                  const TIPO_CFG = {
                    llamada: { color: C.green,  label: 'Llamada' },
                    email:   { color: C.blue,   label: 'Email' },
                    reunion: { color: C.purple, label: 'Reunión' },
                    whatsapp:{ color: '#25d366', label: 'WhatsApp' },
                    visita:  { color: C.amber,  label: 'Visita' },
                    interno: { color: C.muted,  label: 'Interno' },
                    otro:    { color: C.dimmed, label: 'Otro' },
                  }
                  const ESTADO_CFG = {
                    en_gestion: { color: C.amber },
                    activo:     { color: C.green },
                    recuperado: { color: C.purple },
                    perdido:    { color: C.red },
                    en_pausa:   { color: '#f97316' },
                    seguimiento:{ color: C.blue },
                  }
                  const RAZON_LABEL = {
                    precios: 'Precios', servicio: 'Servicio', cierre_negocio: 'Cierre negocio',
                    estacional: 'Estacional', geografico: 'Geográfico', comunicacion: 'Comunicación', otro: 'Otro',
                  }
                  const tipo = TIPO_CFG[e.tipo] || TIPO_CFG.otro
                  const estadoCfg = ESTADO_CFG[e.estado] || {}
                  return (
                    <div key={e.id} style={{ padding: '12px 18px', borderBottom: `1px solid ${C.border}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ background: 'transparent', color: tipo.color, border: `1px solid ${tipo.color}44`, borderRadius: 5, padding: '1px 8px', fontSize: 10, fontWeight: 700 }}>{tipo.label}</span>
                          {e.estado && <span style={{ color: estadoCfg.color || C.muted, fontSize: 10, fontWeight: 600 }}>{e.estado.replace('_', ' ')}</span>}
                          {e.razon && <span style={{ color: C.dimmed, fontSize: 10 }}>{RAZON_LABEL[e.razon] || e.razon}</span>}
                          <span style={{ color: C.dimmed, fontSize: 10 }}>{e.fecha}</span>
                          {e.usuario && <span style={{ color: C.dimmed, fontSize: 10 }}>· {e.usuario}</span>}
                        </div>
                        <button onClick={() => deleteGestion(e.id)}
                          style={{ background: 'transparent', border: 'none', color: C.dimmed, cursor: 'pointer', padding: '2px 4px' }}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                      {e.nota && <p style={{ color: C.text, fontSize: 12, lineHeight: 1.5, margin: '4px 0 0' }}>{e.nota}</p>}
                      {e.recordatorio && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
                          <Bell size={10} style={{ color: C.amber }} />
                          <span style={{ color: C.amber, fontSize: 10, fontWeight: 600 }}>Recordatorio: {e.recordatorio}</span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── Motor 2: Simulador de descuento ────────────────────────────── */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '12px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Calculator size={14} style={{ color: C.accent }} />
              <p style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>Simulador de Descuento</p>
            </div>
            <div style={{ padding: 18 }}>
              {(() => {
                const ingresoMes = kpis?.ingreso_mes || 0
                const costoMes = kpis?.costo_mes || 0
                const totalPaq = kpis?.total_mes || 0
                const margenActual = ingresoMes - costoMes
                const ingPorPaq = totalPaq > 0 ? ingresoMes / totalPaq : (seller?.precio_base || 0)
                const costoPorPaq = totalPaq > 0 ? costoMes / totalPaq : 0
                const sinDatosMes = totalPaq === 0

                // Calcular precio y descuento según modo
                const precioDirectoVal = parseFloat(simPrecioDirecto) || 0
                const descPct = simModo === 'pct'
                  ? (parseFloat(simDescuento) || 0)
                  : (ingPorPaq > 0 && precioDirectoVal > 0 ? Math.round((1 - precioDirectoVal / ingPorPaq) * 1000) / 10 : 0)
                const nuevoPrecio = simModo === 'pct'
                  ? ingPorPaq * (1 - descPct / 100)
                  : precioDirectoVal

                const paqProy = parseFloat(simPaquetes) || (totalPaq > 0 ? totalPaq : 0)
                const nuevoIngreso = nuevoPrecio * paqProy
                const nuevoMargen = nuevoIngreso - (paqProy * costoPorPaq)
                const impactoMensual = nuevoIngreso - (ingresoMes || nuevoPrecio * (totalPaq > 0 ? totalPaq : paqProy))
                const impactoAnual = impactoMensual * 12
                const margenNuevoPct = nuevoIngreso > 0 ? Math.round(nuevoMargen / nuevoIngreso * 100) : 0
                const threshold = ingPorPaq > 0 && ingresoMes > 0 ? Math.max(0, Math.round((1 - costoMes / ingresoMes) * 100 * 0.5)) : 0

                const haySimulacion = simModo === 'pct' ? descPct > 0 : precioDirectoVal > 0

                return (
                  <>
                    {/* Fila de precio actual */}
                    <p style={{ color: C.dimmed, fontSize: 11, marginBottom: 14 }}>
                      Precio actual: <strong style={{ color: C.text }}>{fmt(Math.round(ingPorPaq))}/paq.</strong>
                      {' '}· Costo: <strong style={{ color: C.amber }}>{fmt(Math.round(costoPorPaq))}/paq.</strong>
                      {sinDatosMes && <span style={{ color: C.amber, marginLeft: 6 }}>(sin datos este mes — usando precio base)</span>}
                    </p>

                    {/* Toggle modo */}
                    <div style={{ display: 'flex', gap: 4, marginBottom: 14, background: C.surface, borderRadius: 8, padding: 3 }}>
                      {[['pct', '% Descuento'], ['precio', 'Precio por paquete']].map(([val, label]) => (
                        <button key={val} onClick={() => setSimModo(val)}
                          style={{
                            flex: 1, padding: '5px 8px', borderRadius: 6, border: 'none', cursor: 'pointer',
                            fontSize: 11, fontWeight: 600, transition: 'all 0.15s',
                            background: simModo === val ? C.accent : 'transparent',
                            color: simModo === val ? '#fff' : C.muted,
                          }}>
                          {label}
                        </button>
                      ))}
                    </div>

                    {/* Input principal */}
                    {simModo === 'pct' ? (
                      <div style={{ marginBottom: 12 }}>
                        <label style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>Descuento propuesto (%)</label>
                        <input type="number" min="0" max="50" step="0.5"
                          value={simDescuento} onChange={e => setSimDescuento(e.target.value)}
                          placeholder="Ej: 5"
                          style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '8px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                        />
                        {descPct > 0 && ingPorPaq > 0 && (
                          <p style={{ marginTop: 5, fontSize: 11, color: C.muted }}>
                            Precio resultante:{' '}
                            <strong style={{ color: C.text, fontSize: 13 }}>{fmt(Math.round(nuevoPrecio))}/paq.</strong>
                            <span style={{ color: C.red, marginLeft: 6 }}>(-{fmt(Math.round(ingPorPaq - nuevoPrecio))})</span>
                          </p>
                        )}
                      </div>
                    ) : (
                      <div style={{ marginBottom: 12 }}>
                        <label style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>Precio propuesto por paquete ($)</label>
                        <input type="number" min="0" step="10"
                          value={simPrecioDirecto} onChange={e => setSimPrecioDirecto(e.target.value)}
                          placeholder={`Actual: ${fmt(Math.round(ingPorPaq))}`}
                          style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '8px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                        />
                        {precioDirectoVal > 0 && ingPorPaq > 0 && (
                          <p style={{ marginTop: 5, fontSize: 11, color: C.muted }}>
                            Equivale a un descuento de{' '}
                            <strong style={{ color: descPct > 0 ? C.red : C.green }}>
                              {descPct > 0 ? `-${descPct.toFixed(1)}%` : `+${Math.abs(descPct).toFixed(1)}%`}
                            </strong>
                            {' '}respecto al precio actual
                          </p>
                        )}
                      </div>
                    )}

                    {/* Paquetes proyectados */}
                    <div style={{ marginBottom: 16 }}>
                      <label style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>Paquetes proyectados (opcional)</label>
                      <input type="number" min="0"
                        value={simPaquetes} onChange={e => setSimPaquetes(e.target.value)}
                        placeholder={`Actual: ${fmtN(totalPaq)}`}
                        style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '8px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                      />
                    </div>

                    {haySimulacion && paqProy > 0 && (
                      <div style={{ background: C.surface, borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {[
                          ['Ingreso proyectado/mes', fmt(Math.round(nuevoIngreso)), nuevoIngreso >= ingresoMes ? C.green : C.red],
                          ['Margen proyectado/mes', fmt(Math.round(nuevoMargen)), nuevoMargen >= margenActual ? C.green : C.red],
                          ['Margen %', `${margenNuevoPct}%`, margenNuevoPct >= 15 ? C.green : margenNuevoPct >= 8 ? C.amber : C.red],
                          ['Impacto mensual', `${impactoMensual >= 0 ? '+' : ''}${fmt(Math.round(impactoMensual))}`, impactoMensual >= 0 ? C.green : C.red],
                          ['Impacto anual', `${impactoAnual >= 0 ? '+' : ''}${fmt(Math.round(impactoAnual))}`, impactoAnual >= 0 ? C.green : C.red],
                        ].map(([label, val, color]) => (
                          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: C.muted, fontSize: 11 }}>{label}</span>
                            <span style={{ color, fontWeight: 700, fontSize: 13 }}>{val}</span>
                          </div>
                        ))}
                        <div style={{ marginTop: 4, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
                          <p style={{ color: descPct <= threshold ? C.green : descPct <= threshold * 1.5 ? C.amber : C.red, fontSize: 11, fontWeight: 600 }}>
                            {descPct <= threshold
                              ? `✓ Descuento sostenible (margen > ${threshold * 2}% del ingreso)`
                              : descPct <= threshold * 1.5
                              ? `⚠ Descuento moderado — negocia con contrapartida`
                              : `✗ Descuento agresivo — requiere mayor volumen comprometido`}
                          </p>
                        </div>
                      </div>
                    )}
                    {!haySimulacion && (
                      <p style={{ color: C.dimmed, fontSize: 11 }}>
                        {simModo === 'pct' ? 'Ingresa un % de descuento para ver el impacto.' : 'Ingresa el precio propuesto por paquete para ver el impacto.'}
                      </p>
                    )}
                  </>
                )
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Cerrar cliente ─────────────────────────────────────────────── */}
      {showCierreModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={e => e.target === e.currentTarget && setShowCierreModal(false)}>
          <div style={{ background: C.card, border: `1px solid #ef444444`, borderRadius: 16, padding: 24, width: '100%', maxWidth: 560 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
              <XCircle size={18} style={{ color: '#ef4444' }} />
              <h2 style={{ color: C.text, fontSize: 16, fontWeight: 700, margin: 0 }}>Cerrar cliente: {seller.nombre}</h2>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 8 }}>Razones de cierre (multi-selección)</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {RAZONES_CIERRE_OPTS.map(opt => {
                  const selected = (lifecycleForm.razones_cierre || []).includes(opt.value)
                  return (
                    <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, border: `1px solid ${selected ? '#ef444466' : C.border}`, background: selected ? 'rgba(239,68,68,0.08)' : 'transparent', cursor: 'pointer', fontSize: 12, color: selected ? '#ef4444' : C.text }}>
                      <input type="checkbox" checked={selected}
                        onChange={() => setLifecycleForm(f => {
                          const arr = f.razones_cierre || []
                          return { ...f, razones_cierre: selected ? arr.filter(v => v !== opt.value) : [...arr, opt.value] }
                        })}
                        style={{ accentColor: '#ef4444' }} />
                      {opt.label}
                    </label>
                  )
                })}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>Conversación de salida</label>
                <select value={lifecycleForm.conversacion_salida || ''} onChange={e => setLifecycleForm(f => ({ ...f, conversacion_salida: e.target.value }))}
                  style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '7px 10px', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}>
                  <option value="">—</option>
                  <option value="si">Sí</option>
                  <option value="no">No</option>
                  <option value="parcial">Parcial</option>
                </select>
              </div>
              <div>
                <label style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>Potencial de recuperación</label>
                <select value={lifecycleForm.potencial_recuperacion || ''} onChange={e => setLifecycleForm(f => ({ ...f, potencial_recuperacion: e.target.value }))}
                  style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '7px 10px', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}>
                  <option value="">—</option>
                  <option value="alto">Alto</option>
                  <option value="medio">Medio</option>
                  <option value="bajo">Bajo</option>
                  <option value="ninguno">Ninguno</option>
                </select>
              </div>
              <div>
                <label style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>Destino (competidor)</label>
                <input type="text" placeholder="Nombre (opcional)" value={lifecycleForm.destino_competencia || ''}
                  onChange={e => setLifecycleForm(f => ({ ...f, destino_competencia: e.target.value }))}
                  style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '7px 10px', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>Condición para recuperación (opcional)</label>
              <input type="text" placeholder="Ej: mejora de tarifa, resolución de conflicto…" value={lifecycleForm.condicion_recuperacion || ''}
                onChange={e => setLifecycleForm(f => ({ ...f, condicion_recuperacion: e.target.value }))}
                style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '7px 10px', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>Nota interna</label>
              <textarea rows={3} value={lifecycleForm.nota_cierre || ''} onChange={e => setLifecycleForm(f => ({ ...f, nota_cierre: e.target.value }))}
                placeholder="Contexto adicional del cierre…"
                style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '8px 10px', fontSize: 12, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
            </div>

            <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid #ef444433', borderRadius: 10, padding: '10px 14px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={13} style={{ color: '#ef4444', flexShrink: 0 }} />
              <p style={{ color: '#ef4444', fontSize: 11, margin: 0 }}>El cliente dejará de aparecer en todos los flujos operativos diarios. Podrás reactivarlo desde el listado de cerrados.</p>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowCierreModal(false)}
                style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, padding: '8px 16px', fontSize: 12, cursor: 'pointer' }}>
                Cancelar
              </button>
              <button onClick={cerrarSeller} disabled={savingLifecycle || !(lifecycleForm.razones_cierre?.length)}
                style={{ background: '#ef4444', border: 'none', color: '#fff', borderRadius: 8, padding: '8px 20px', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: (savingLifecycle || !(lifecycleForm.razones_cierre?.length)) ? 0.5 : 1 }}>
                {savingLifecycle ? 'Cerrando…' : 'Confirmar cierre'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Poner en pausa ─────────────────────────────────────────────── */}
      {showPausaModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={e => e.target === e.currentTarget && setShowPausaModal(false)}>
          <div style={{ background: C.card, border: `1px solid #f9731644`, borderRadius: 16, padding: 24, width: '100%', maxWidth: 460 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
              <PauseCircle size={18} style={{ color: '#f97316' }} />
              <h2 style={{ color: C.text, fontSize: 16, fontWeight: 700, margin: 0 }}>Pausar cliente: {seller.nombre}</h2>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>Fecha estimada de regreso (opcional)</label>
              <input type="date" value={lifecycleForm.fecha_pausa_fin || ''}
                onChange={e => setLifecycleForm(f => ({ ...f, fecha_pausa_fin: e.target.value }))}
                style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '7px 10px', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>Nota</label>
              <textarea rows={3} value={lifecycleForm.nota || ''} onChange={e => setLifecycleForm(f => ({ ...f, nota: e.target.value }))}
                placeholder="Vacaciones, reestructuración interna, temporada baja…"
                style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '8px 10px', fontSize: 12, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowPausaModal(false)}
                style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, padding: '8px 16px', fontSize: 12, cursor: 'pointer' }}>
                Cancelar
              </button>
              <button onClick={pausarSeller} disabled={savingLifecycle}
                style={{ background: '#f97316', border: 'none', color: '#fff', borderRadius: 8, padding: '8px 20px', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: savingLifecycle ? 0.5 : 1 }}>
                {savingLifecycle ? 'Pausando…' : 'Confirmar pausa'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Reabrir cliente ─────────────────────────────────────────────── */}
      {showReabrirModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={e => e.target === e.currentTarget && setShowReabrirModal(false)}>
          <div style={{ background: C.card, border: `1px solid ${C.green}44`, borderRadius: 16, padding: 24, width: '100%', maxWidth: 460 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
              <PlayCircle size={18} style={{ color: C.green }} />
              <h2 style={{ color: C.text, fontSize: 16, fontWeight: 700, margin: 0 }}>Reactivar cliente: {seller.nombre}</h2>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>¿Cómo volvió?</label>
              <select value={lifecycleForm.como_volvio || ''} onChange={e => setLifecycleForm(f => ({ ...f, como_volvio: e.target.value }))}
                style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '7px 10px', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}>
                <option value="">— Seleccionar —</option>
                <option value="espontaneo">Regreso espontáneo</option>
                <option value="outreach">Nosotros lo contactamos</option>
                <option value="oferta">Con oferta comercial</option>
              </select>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>¿Qué cambió?</label>
              <input type="text" placeholder="Tarifa ajustada, nuevo contacto, resolución de problemas…" value={lifecycleForm.que_cambio || ''}
                onChange={e => setLifecycleForm(f => ({ ...f, que_cambio: e.target.value }))}
                style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '7px 10px', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>Nota (opcional)</label>
              <textarea rows={2} value={lifecycleForm.nota || ''} onChange={e => setLifecycleForm(f => ({ ...f, nota: e.target.value }))}
                placeholder="Contexto adicional…"
                style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '8px 10px', fontSize: 12, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowReabrirModal(false)}
                style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, padding: '8px 16px', fontSize: 12, cursor: 'pointer' }}>
                Cancelar
              </button>
              <button onClick={reabrir} disabled={savingLifecycle}
                style={{ background: C.green, border: 'none', color: '#fff', borderRadius: 8, padding: '8px 20px', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: savingLifecycle ? 0.5 : 1 }}>
                {savingLifecycle ? 'Reactivando…' : 'Confirmar reactivación'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: nuevo registro de gestión ──────────────────────────────────── */}
      {showGestionModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={e => e.target === e.currentTarget && setShowGestionModal(false)}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24, width: '100%', maxWidth: 520 }}>
            <h2 style={{ color: C.text, fontSize: 16, fontWeight: 700, marginBottom: 18 }}>Registrar gestión comercial</h2>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              {[
                ['fecha', 'Fecha', 'date'],
                ['recordatorio', 'Recordatorio (opcional)', 'date'],
              ].map(([key, label, type]) => (
                <div key={key}>
                  <label style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>{label}</label>
                  <input type={type} value={gestionForm[key]} onChange={e => setGestionForm(f => ({ ...f, [key]: e.target.value }))}
                    style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '7px 10px', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              {[
                ['tipo', 'Tipo de contacto', ['llamada', 'email', 'reunion', 'whatsapp', 'visita', 'interno', 'otro']],
                ['estado', 'Estado comercial', ['', 'en_gestion', 'activo', 'recuperado', 'perdido', 'en_pausa', 'seguimiento']],
                ['razon', 'Razón (si aplica)', ['', 'precios', 'servicio', 'cierre_negocio', 'estacional', 'geografico', 'comunicacion', 'otro']],
              ].map(([key, label, options]) => (
                <div key={key}>
                  <label style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>{label}</label>
                  <select value={gestionForm[key]} onChange={e => setGestionForm(f => ({ ...f, [key]: e.target.value }))}
                    style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '7px 10px', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}>
                    {options.map(o => <option key={o} value={o}>{o ? o.replace('_', ' ') : '—'}</option>)}
                  </select>
                </div>
              ))}
            </div>

            <div style={{ marginBottom: 18 }}>
              <label style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>Nota</label>
              <textarea rows={3} value={gestionForm.nota} onChange={e => setGestionForm(f => ({ ...f, nota: e.target.value }))}
                placeholder="Detalle del contacto, acuerdos, próximos pasos…"
                style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '8px 10px', fontSize: 12, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowGestionModal(false)}
                style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, padding: '8px 16px', fontSize: 12, cursor: 'pointer' }}>
                Cancelar
              </button>
              <button onClick={saveGestion} disabled={savingGestion}
                style={{ background: C.accent, border: 'none', color: '#fff', borderRadius: 8, padding: '8px 20px', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: savingGestion ? 0.7 : 1 }}>
                {savingGestion ? 'Guardando…' : 'Guardar registro'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
