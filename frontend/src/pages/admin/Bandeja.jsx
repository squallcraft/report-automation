import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle, CheckCircle, XCircle, Clock, RefreshCw,
  User, MessageSquare, TrendingDown, Star, Plus, ChevronRight,
} from 'lucide-react'
import api from '../../api'

const C = {
  bg: '#0f1117', surface: '#1a1d27', card: '#1e2130', border: '#2a2d3e',
  text: '#e2e8f0', muted: '#94a3b8', dimmed: '#64748b',
  green: '#22c55e', greenDim: 'rgba(34,197,94,0.08)',
  amber: '#f59e0b', amberDim: 'rgba(245,158,11,0.08)',
  red: '#ef4444', redDim: 'rgba(239,68,68,0.1)',
  blue: '#60a5fa', blueDim: 'rgba(96,165,250,0.08)',
  purple: '#a78bfa', cardHover: '#252840',
}

const TIPO_CFG = {
  validar_perdido:  { label: 'Validar estado',    icon: AlertTriangle, color: C.red,   bg: C.redDim },
  contactar_riesgo: { label: 'Contactar riesgo',  icon: TrendingDown,  color: C.amber, bg: C.amberDim },
  seguimiento_crm:  { label: 'Seguimiento CRM',   icon: MessageSquare, color: C.blue,  bg: C.blueDim },
  factura_vencida:  { label: 'Factura vencida',   icon: AlertTriangle, color: C.red,   bg: C.redDim },
  tier_cambio:      { label: 'Cambio de tier',    icon: Star,          color: C.purple, bg: 'rgba(167,139,250,0.08)' },
  manual:           { label: 'Manual',            icon: User,          color: C.muted,  bg: 'transparent' },
}

const SEV_CFG = {
  critico: { label: 'Crítico', color: C.red,   bg: C.redDim   },
  alerta:  { label: 'Alerta',  color: C.amber, bg: C.amberDim },
  info:    { label: 'Info',    color: C.blue,  bg: C.blueDim  },
}

function SevBadge({ sev }) {
  const cfg = SEV_CFG[sev] || SEV_CFG.info
  return (
    <span style={{
      background: cfg.bg, color: cfg.color,
      border: `1px solid ${cfg.color}33`, borderRadius: 5,
      padding: '1px 7px', fontSize: 10, fontWeight: 700,
    }}>{cfg.label}</span>
  )
}

function TipoIcon({ tipo }) {
  const cfg = TIPO_CFG[tipo] || TIPO_CFG.manual
  const Icon = cfg.icon
  return <Icon size={15} color={cfg.color} />
}

function dias(fecha) {
  if (!fecha) return ''
  const diff = Math.floor((Date.now() - new Date(fecha).getTime()) / 86400000)
  if (diff === 0) return 'hoy'
  if (diff === 1) return 'ayer'
  return `hace ${diff}d`
}

export default function Bandeja() {
  const navigate = useNavigate()
  const [tareas, setTareas] = useState([])
  const [loading, setLoading] = useState(true)
  const [generando, setGenerando] = useState(false)
  const [filterTipo, setFilterTipo] = useState('todos')
  const [filterSev, setFilterSev] = useState('todos')
  const [showResueltas, setShowResueltas] = useState(false)
  const [resolviendo, setResolviendo] = useState(null)
  const [accionTexto, setAccionTexto] = useState('')
  const [showNueva, setShowNueva] = useState(false)
  const [nueva, setNueva] = useState({ titulo: '', descripcion: '', seller_id: '', severidad: 'alerta' })

  const cargar = useCallback(() => {
    setLoading(true)
    api.get('/tareas', { params: showResueltas ? { estado: 'resuelta' } : {} })
      .then(r => setTareas(r.data))
      .finally(() => setLoading(false))
  }, [showResueltas])

  useEffect(cargar, [cargar])

  const generarAuto = async () => {
    setGenerando(true)
    try {
      await api.post('/tareas/generar-auto')
      cargar()
    } finally {
      setGenerando(false)
    }
  }

  const resolver = async (id) => {
    await api.patch(`/tareas/${id}/resolver`, { accion: accionTexto })
    setResolviendo(null)
    setAccionTexto('')
    cargar()
  }

  const descartar = async (id) => {
    await api.patch(`/tareas/${id}/descartar`)
    cargar()
  }

  const crearManual = async () => {
    await api.post('/tareas', { ...nueva, tipo: 'manual', seller_id: nueva.seller_id ? parseInt(nueva.seller_id) : null })
    setShowNueva(false)
    setNueva({ titulo: '', descripcion: '', seller_id: '', severidad: 'alerta' })
    cargar()
  }

  const tareasFiltradas = tareas.filter(t => {
    if (filterTipo !== 'todos' && t.tipo !== filterTipo) return false
    if (filterSev !== 'todos' && t.severidad !== filterSev) return false
    return true
  })

  const criticas = tareas.filter(t => t.severidad === 'critico').length
  const alertas  = tareas.filter(t => t.severidad === 'alerta').length

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '24px 28px', color: C.text }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Bandeja de Tareas</h1>
          <p style={{ color: C.muted, fontSize: 13, margin: '4px 0 0' }}>
            Señales detectadas que requieren tu atención
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowNueva(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}>
            <Plus size={14} /> Nueva tarea
          </button>
          <button onClick={generarAuto} disabled={generando}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#1a6db8', border: 'none', color: '#fff', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer', opacity: generando ? 0.6 : 1 }}>
            <RefreshCw size={14} style={{ animation: generando ? 'spin 1s linear infinite' : 'none' }} />
            {generando ? 'Generando…' : 'Detectar señales'}
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Críticas', val: criticas, color: C.red, bg: C.redDim },
          { label: 'Alertas', val: alertas, color: C.amber, bg: C.amberDim },
          { label: 'Total pendientes', val: tareas.length, color: C.blue, bg: C.blueDim },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, border: `1px solid ${k.color}22`, borderRadius: 10, padding: '10px 20px', minWidth: 110 }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: k.color }}>{k.val}</div>
            <div style={{ fontSize: 11, color: C.muted }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={filterTipo} onChange={e => setFilterTipo(e.target.value)}
          style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: '6px 10px', fontSize: 12 }}>
          <option value="todos">Todos los tipos</option>
          {Object.entries(TIPO_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={filterSev} onChange={e => setFilterSev(e.target.value)}
          style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: '6px 10px', fontSize: 12 }}>
          <option value="todos">Toda severidad</option>
          {Object.entries(SEV_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button onClick={() => setShowResueltas(s => !s)}
          style={{ background: showResueltas ? C.surface : 'transparent', border: `1px solid ${C.border}`, color: showResueltas ? C.text : C.muted, borderRadius: 7, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
          {showResueltas ? '← Pendientes' : 'Ver resueltas'}
        </button>
      </div>

      {/* Lista */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: C.muted }}>Cargando tareas…</div>
      ) : tareasFiltradas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: C.dimmed }}>
          <CheckCircle size={36} color={C.green} style={{ margin: '0 auto 12px', display: 'block' }} />
          <div style={{ fontSize: 15, fontWeight: 600, color: C.muted }}>Todo al día</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>No hay tareas pendientes con estos filtros</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tareasFiltradas.map(t => {
            const tcfg = TIPO_CFG[t.tipo] || TIPO_CFG.manual
            const isResolviendo = resolviendo === t.id
            return (
              <div key={t.id} style={{
                background: C.card, border: `1px solid ${C.border}`,
                borderLeft: `3px solid ${SEV_CFG[t.severidad]?.color || C.border}`,
                borderRadius: 10, padding: '14px 16px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <TipoIcon tipo={t.tipo} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{t.titulo}</span>
                      <SevBadge sev={t.severidad} />
                      <span style={{ fontSize: 10, color: C.dimmed, marginLeft: 'auto' }}>{dias(t.fecha_creacion)}</span>
                    </div>
                    {t.descripcion && (
                      <p style={{ fontSize: 12, color: C.muted, margin: '4px 0 0 23px', lineHeight: 1.5 }}>{t.descripcion}</p>
                    )}
                    {t.seller_nombre && (
                      <button onClick={() => navigate(`/admin/sellers/${t.seller_id}/perfil`)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, color: C.blue, fontSize: 11, marginTop: 6, marginLeft: 23, padding: 0 }}>
                        <User size={11} /> {t.seller_nombre} <ChevronRight size={11} />
                      </button>
                    )}
                  </div>
                  {!showResueltas && (
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button onClick={() => setResolviendo(isResolviendo ? null : t.id)}
                        style={{ background: C.greenDim, border: `1px solid ${C.green}33`, color: C.green, borderRadius: 6, padding: '5px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                        ✓ Resolver
                      </button>
                      <button onClick={() => descartar(t.id)}
                        style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.dimmed, borderRadius: 6, padding: '5px 10px', fontSize: 11, cursor: 'pointer' }}>
                        Descartar
                      </button>
                    </div>
                  )}
                </div>
                {isResolviendo && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                    <input
                      placeholder="¿Qué hiciste? (opcional)"
                      value={accionTexto}
                      onChange={e => setAccionTexto(e.target.value)}
                      style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: '7px 10px', fontSize: 12, marginBottom: 8, boxSizing: 'border-box' }}
                    />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => resolver(t.id)}
                        style={{ background: '#1a6db8', border: 'none', color: '#fff', borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
                        Confirmar
                      </button>
                      <button onClick={() => setResolviendo(null)}
                        style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}>
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Modal nueva tarea */}
      {showNueva && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24, width: 420 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>Nueva tarea manual</h3>
            {[
              { label: 'Título', field: 'titulo', placeholder: 'Ej: Llamar a Servinmed esta semana' },
              { label: 'Descripción', field: 'descripcion', placeholder: 'Contexto adicional (opcional)' },
              { label: 'Seller ID (opcional)', field: 'seller_id', placeholder: 'ID numérico del seller' },
            ].map(f => (
              <div key={f.field} style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: C.muted, display: 'block', marginBottom: 4 }}>{f.label}</label>
                <input value={nueva[f.field]} onChange={e => setNueva(p => ({ ...p, [f.field]: e.target.value }))}
                  placeholder={f.placeholder}
                  style={{ width: '100%', background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: '8px 10px', fontSize: 12, boxSizing: 'border-box' }} />
              </div>
            ))}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, color: C.muted, display: 'block', marginBottom: 4 }}>Severidad</label>
              <select value={nueva.severidad} onChange={e => setNueva(p => ({ ...p, severidad: e.target.value }))}
                style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: '8px 10px', fontSize: 12, width: '100%' }}>
                <option value="critico">Crítico</option>
                <option value="alerta">Alerta</option>
                <option value="info">Info</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={crearManual} disabled={!nueva.titulo}
                style={{ flex: 1, background: '#1a6db8', border: 'none', color: '#fff', borderRadius: 8, padding: '9px', fontSize: 13, cursor: 'pointer', opacity: nueva.titulo ? 1 : 0.5 }}>
                Crear tarea
              </button>
              <button onClick={() => setShowNueva(false)}
                style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, padding: '9px 16px', fontSize: 13, cursor: 'pointer' }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
