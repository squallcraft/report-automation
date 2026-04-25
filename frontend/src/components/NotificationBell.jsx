import { useState, useEffect } from 'react'
import { Bell, X, ArrowRight, Inbox, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import api from '../api'

const SEV = {
  critico: { color: '#ef4444', bg: '#fef2f2', label: 'Crítico' },
  alerta:  { color: '#d97706', bg: '#fefce8', label: 'Alerta' },
  info:    { color: '#2563eb', bg: '#eff6ff', label: 'Info' },
}

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
  if (diff < 60)    return 'hace un momento'
  if (diff < 3600)  return `hace ${Math.floor(diff / 60)} min`
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`
  const d = new Date(dateStr)
  return d.toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })
}

// ── Botón campana para el Sidebar ──────────────────────────────────────────
export function NotificationBellButton({ onClick, totalBadge, hasCritical, collapsed }) {
  return (
    <button
      onClick={onClick}
      title="Notificaciones"
      className={`flex items-center gap-3 py-2 mx-1.5 sm:mx-2 rounded-lg text-sm font-medium transition-colors touch-manipulation w-full text-left
        ${collapsed ? 'justify-center px-2' : 'px-3 sm:px-4'}
        text-primary-200 hover:bg-primary-800 hover:text-white`}
    >
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <Bell size={18} />
        {totalBadge > 0 && (
          <span style={{
            position: 'absolute', top: -5, right: -5,
            background: hasCritical ? '#ef4444' : '#f59e0b',
            color: '#fff', borderRadius: 99, fontSize: 9, fontWeight: 700,
            padding: '1px 4px', minWidth: 14, textAlign: 'center', lineHeight: '14px',
          }}>{totalBadge > 99 ? '99+' : totalBadge}</span>
        )}
      </div>
      {!collapsed && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
          Notificaciones
          {totalBadge > 0 && (
            <span style={{
              background: hasCritical ? '#ef4444' : '#f59e0b',
              color: '#fff', borderRadius: 99, fontSize: 9, fontWeight: 700,
              padding: '1px 6px', marginLeft: 'auto',
            }}>{totalBadge > 99 ? '99+' : totalBadge}</span>
          )}
        </span>
      )}
    </button>
  )
}

// ── Drawer derecho (recibe open/onClose desde el padre) ────────────────────
export function NotificationDrawer({ open, onClose }) {
  const [tareas, setTareas] = useState([])
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    setLoading(true)
    api.get('/tareas')
      .then(r => setTareas(r.data.slice(0, 20)))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  const descartar = async (id, e) => {
    e.stopPropagation()
    await api.patch(`/tareas/${id}/descartar`).catch(() => {})
    setTareas(t => t.filter(x => x.id !== id))
  }

  return (
    <>
      {open && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.35)',
            zIndex: 1040,
            animation: 'ntf-fadeIn 0.18s ease',
          }}
        />
      )}

      <div
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 400, maxWidth: '100vw',
          background: '#fff',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
          zIndex: 1050,
          display: 'flex', flexDirection: 'column',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
        }}
        aria-hidden={!open}
      >
        {/* Header */}
        <div style={{
          padding: '18px 20px',
          borderBottom: '1px solid #f1f5f9',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: '#1e3a5f', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Bell size={17} color="#93c5fd" />
            <span style={{ fontWeight: 700, fontSize: 15, color: '#f1f5f9' }}>Notificaciones</span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.1)', border: 'none',
              borderRadius: 8, width: 30, height: 30,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: '#94a3b8', transition: 'background 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
          >
            <X size={15} />
          </button>
        </div>

        {/* Lista scrolleable */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
              Cargando…
            </div>
          ) : tareas.length === 0 ? (
            <div style={{ padding: '60px 20px', textAlign: 'center' }}>
              <Inbox size={40} color="#cbd5e1" style={{ margin: '0 auto 12px' }} />
              <p style={{ fontSize: 14, color: '#94a3b8', margin: 0, fontWeight: 500 }}>Sin notificaciones pendientes</p>
              <p style={{ fontSize: 12, color: '#cbd5e1', margin: '4px 0 0' }}>Estás al día ✓</p>
            </div>
          ) : (
            tareas.map(t => {
              const sev = SEV[t.severidad] || SEV.info
              return (
                <div
                  key={t.id}
                  onClick={() => { navigate('/admin/bandeja'); onClose() }}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 12,
                    padding: '14px 20px', borderBottom: '1px solid #f8fafc',
                    cursor: 'pointer', transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{
                    width: 9, height: 9, borderRadius: '50%',
                    background: sev.color, marginTop: 5, flexShrink: 0,
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 500, color: '#1e293b', margin: 0, lineHeight: 1.4 }}>
                      {t.titulo}
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: 10, fontWeight: 600, color: sev.color,
                        background: sev.bg, padding: '2px 7px', borderRadius: 99,
                      }}>{sev.label}</span>
                      {t.seller_nombre && (
                        <span style={{ fontSize: 11, color: '#64748b' }}>{t.seller_nombre}</span>
                      )}
                      <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto' }}>
                        {timeAgo(t.fecha_creacion)}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => descartar(t.id, e)}
                    title="Descartar"
                    style={{
                      padding: 4, borderRadius: 5, border: 'none',
                      background: 'transparent', cursor: 'pointer',
                      color: '#cbd5e1', flexShrink: 0,
                      display: 'flex', alignItems: 'center', transition: 'color 0.1s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                    onMouseLeave={e => e.currentTarget.style.color = '#cbd5e1'}
                  >
                    <X size={14} />
                  </button>
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div style={{ borderTop: '1px solid #f1f5f9', flexShrink: 0 }}>
          <div
            onClick={() => { navigate('/admin/bandeja'); onClose() }}
            style={{
              padding: '14px 20px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 6, fontSize: 13, fontWeight: 600, color: '#1e3a5f',
              cursor: 'pointer', background: '#fafafa',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
            onMouseLeave={e => e.currentTarget.style.background = '#fafafa'}
          >
            Ver todas en Bandeja de Tareas
            <ArrowRight size={14} />
          </div>
        </div>
      </div>

      <style>{`@keyframes ntf-fadeIn { from { opacity:0 } to { opacity:1 } }`}</style>
    </>
  )
}

// ── Hook de estado compartido (badge + open) ───────────────────────────────
export function useNotificationDrawer() {
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState({ total: 0, criticas: 0 })
  const [leadsCount, setLeadsCount] = useState(0)

  useEffect(() => {
    const fetch = () => {
      api.get('/tareas/count').then(r => setCount(r.data)).catch(() => {})
      api.get('/leads/notificaciones/count').then(r => setLeadsCount(r.data.no_leidas || 0)).catch(() => {})
    }
    fetch()
    const iv = setInterval(fetch, 60000)
    return () => clearInterval(iv)
  }, [])

  return {
    open, setOpen,
    totalBadge: count.total + leadsCount,
    hasCritical: count.criticas > 0 || leadsCount > 0,
  }
}

// ── Default export: componente combinado (usado en Layout) ─────────────────
export default function NotificationBell({ open, onClose }) {
  return <NotificationDrawer open={open} onClose={onClose} />
}
