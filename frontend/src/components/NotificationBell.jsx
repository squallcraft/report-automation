import { useState, useEffect, useRef } from 'react'
import { Bell, X, ArrowRight, Inbox } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import api from '../api'

const SEV = {
  critico: { color: '#ef4444', bg: '#fef2f2', label: 'Crítico' },
  alerta:  { color: '#d97706', bg: '#fefce8', label: 'Alerta' },
  info:    { color: '#2563eb', bg: '#eff6ff', label: 'Info' },
}

const TIPO_LABEL = {
  validar_perdido:  'Validar pérdida',
  contactar_riesgo: 'En riesgo',
  seguimiento_crm:  'Seguimiento CRM',
  tier_cambio:      'Cambio de tier',
  manual:           'Manual',
}

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
  if (diff < 60)   return 'hace un momento'
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`
  const d = new Date(dateStr)
  return d.toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })
}

export default function NotificationBell() {
  const [open, setOpen]     = useState(false)
  const [tareas, setTareas] = useState([])
  const [count, setCount]   = useState({ total: 0, criticas: 0 })
  const [loading, setLoading] = useState(false)
  const panelRef = useRef(null)
  const navigate = useNavigate()

  // Polling del badge cada 60s
  useEffect(() => {
    api.get('/tareas/count').then(r => setCount(r.data)).catch(() => {})
    const iv = setInterval(() => {
      api.get('/tareas/count').then(r => setCount(r.data)).catch(() => {})
    }, 60000)
    return () => clearInterval(iv)
  }, [])

  // Cargar lista al abrir
  useEffect(() => {
    if (!open) return
    setLoading(true)
    api.get('/tareas')
      .then(r => setTareas(r.data.slice(0, 10)))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open])

  // Cerrar al click fuera
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const descartar = async (id, e) => {
    e.stopPropagation()
    await api.patch(`/tareas/${id}/descartar`).catch(() => {})
    setTareas(t => t.filter(x => x.id !== id))
    setCount(c => ({ ...c, total: Math.max(0, c.total - 1) }))
  }

  const hasCritical = count.criticas > 0

  return (
    <div ref={panelRef} style={{ position: 'relative' }}>
      {/* Botón campana */}
      <button
        onClick={() => setOpen(v => !v)}
        title="Notificaciones"
        style={{
          position: 'relative',
          width: 36,
          height: 36,
          borderRadius: 9,
          border: open ? '1px solid #e2e8f0' : '1px solid transparent',
          background: open ? '#f8fafc' : 'transparent',
          cursor: 'pointer',
          color: hasCritical ? '#ef4444' : '#64748b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.15s',
        }}
      >
        <Bell size={18} />
        {count.total > 0 && (
          <span style={{
            position: 'absolute',
            top: 4,
            right: 4,
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: hasCritical ? '#ef4444' : '#f59e0b',
            border: '1.5px solid #fff',
          }} />
        )}
      </button>

      {/* Panel desplegable */}
      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          right: 0,
          width: 360,
          maxWidth: 'calc(100vw - 24px)',
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 14,
          boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
          zIndex: 1000,
          overflow: 'hidden',
        }}>
          {/* Cabecera */}
          <div style={{
            padding: '14px 16px',
            borderBottom: '1px solid #f1f5f9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Bell size={15} color="#1e293b" />
              <span style={{ fontWeight: 700, fontSize: 14, color: '#1e293b' }}>Notificaciones</span>
            </div>
            {count.total > 0 ? (
              <span style={{
                background: hasCritical ? '#fef2f2' : '#fefce8',
                color: hasCritical ? '#ef4444' : '#d97706',
                fontSize: 11,
                fontWeight: 600,
                padding: '3px 9px',
                borderRadius: 99,
                border: `1px solid ${hasCritical ? '#fecaca' : '#fde68a'}`,
              }}>
                {count.total} pendiente{count.total !== 1 ? 's' : ''}
              </span>
            ) : (
              <span style={{ fontSize: 11, color: '#94a3b8' }}>Al día ✓</span>
            )}
          </div>

          {/* Lista */}
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: '28px 16px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                Cargando…
              </div>
            ) : tareas.length === 0 ? (
              <div style={{ padding: '36px 16px', textAlign: 'center' }}>
                <Inbox size={32} color="#cbd5e1" style={{ margin: '0 auto 8px' }} />
                <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>No hay notificaciones pendientes</p>
              </div>
            ) : (
              tareas.map(t => {
                const sev = SEV[t.severidad] || SEV.info
                return (
                  <div
                    key={t.id}
                    onClick={() => { navigate('/admin/bandeja'); setOpen(false) }}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '11px 14px',
                      borderBottom: '1px solid #f8fafc',
                      cursor: 'pointer',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    {/* Dot de severidad */}
                    <div style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: sev.color,
                      marginTop: 5,
                      flexShrink: 0,
                    }} />

                    {/* Contenido */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 500, color: '#1e293b', margin: 0, lineHeight: 1.4 }}>
                        {t.titulo}
                      </p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                        <span style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: sev.color,
                          background: sev.bg,
                          padding: '1px 6px',
                          borderRadius: 99,
                        }}>
                          {sev.label}
                        </span>
                        {t.seller_nombre && (
                          <span style={{ fontSize: 11, color: '#64748b' }}>{t.seller_nombre}</span>
                        )}
                        <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto' }}>
                          {timeAgo(t.fecha_creacion)}
                        </span>
                      </div>
                    </div>

                    {/* Botón descartar */}
                    <button
                      onClick={(e) => descartar(t.id, e)}
                      title="Descartar"
                      style={{
                        padding: '3px',
                        borderRadius: 5,
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        color: '#cbd5e1',
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        transition: 'color 0.1s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                      onMouseLeave={e => e.currentTarget.style.color = '#cbd5e1'}
                    >
                      <X size={13} />
                    </button>
                  </div>
                )
              })
            )}
          </div>

          {/* Footer */}
          <div
            onClick={() => { navigate('/admin/bandeja'); setOpen(false) }}
            style={{
              padding: '11px 16px',
              borderTop: '1px solid #f1f5f9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              fontSize: 12,
              fontWeight: 600,
              color: '#1e3a5f',
              cursor: 'pointer',
              background: '#fafafa',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
            onMouseLeave={e => e.currentTarget.style.background = '#fafafa'}
          >
            Ver todas en Bandeja de Tareas
            <ArrowRight size={13} />
          </div>
        </div>
      )}
    </div>
  )
}
