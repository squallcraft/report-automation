import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api from '../../api'
import toast from 'react-hot-toast'
import { Bell, BellRing, CheckCheck, FileSignature, FileText, DollarSign, ShieldCheck, AlertTriangle, Calendar } from 'lucide-react'

const ICONS = {
  ANEXO_PARA_FIRMA: FileSignature,
  ANEXO_INFORMATIVO: FileText,
  LIQUIDACION_DISPONIBLE: FileText,
  PAGO_REALIZADO: DollarSign,
  VACACIONES_APROBADAS: Calendar,
  VACACIONES_RECHAZADAS: Calendar,
  LICENCIA_REGISTRADA: ShieldCheck,
  DOCUMENTO_POR_VENCER: AlertTriangle,
  GENERICA: Bell,
}

const COLORS = {
  ANEXO_PARA_FIRMA: 'text-amber-700 bg-amber-50 border-amber-200',
  ANEXO_INFORMATIVO: 'text-blue-700 bg-blue-50 border-blue-200',
  LIQUIDACION_DISPONIBLE: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  PAGO_REALIZADO: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  VACACIONES_APROBADAS: 'text-purple-700 bg-purple-50 border-purple-200',
  VACACIONES_RECHAZADAS: 'text-rose-700 bg-rose-50 border-rose-200',
  LICENCIA_REGISTRADA: 'text-indigo-700 bg-indigo-50 border-indigo-200',
  DOCUMENTO_POR_VENCER: 'text-rose-700 bg-rose-50 border-rose-200',
  GENERICA: 'text-gray-700 bg-gray-50 border-gray-200',
}

function formatRelative(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return 'hace un momento'
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`
  if (diff < 604800) return `hace ${Math.floor(diff / 86400)} d`
  return d.toLocaleDateString('es-CL')
}

export default function TrabajadorNotificaciones() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  const fetchAll = useCallback(() => {
    setLoading(true)
    api.get('/notificaciones-trabajador?limit=100')
      .then(({ data }) => setItems(data || []))
      .catch(() => toast.error('No se pudieron cargar las notificaciones'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const handleClick = async (n) => {
    if (!n.leida) {
      try {
        await api.post(`/notificaciones-trabajador/${n.id}/leer`)
        setItems(prev => prev.map(x => x.id === n.id ? { ...x, leida: true } : x))
      } catch { /* silencioso */ }
    }
    if (n.url_accion) navigate(n.url_accion)
  }

  const marcarTodas = async () => {
    try {
      await api.post('/notificaciones-trabajador/leer-todas')
      setItems(prev => prev.map(x => ({ ...x, leida: true })))
      toast.success('Todas marcadas como leídas')
    } catch {
      toast.error('No se pudo actualizar')
    }
  }

  const noLeidas = items.filter(n => !n.leida).length

  return (
    <div className="max-w-3xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BellRing className="text-amber-600" size={24} />
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Notificaciones</h1>
          {noLeidas > 0 && (
            <span className="ml-1 inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full text-xs font-bold bg-rose-500 text-white">
              {noLeidas}
            </span>
          )}
        </div>
        {noLeidas > 0 && (
          <button
            onClick={marcarTodas}
            className="inline-flex items-center gap-1.5 text-sm text-emerald-700 hover:text-emerald-800 font-medium"
          >
            <CheckCheck size={16} /> Marcar todo
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center text-gray-400 py-10">Cargando...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-2xl border border-gray-100">
          <Bell className="mx-auto text-gray-300" size={40} />
          <p className="text-gray-500 mt-3">No tienes notificaciones todavía.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map(n => {
            const Icon = ICONS[n.tipo] || Bell
            const colorCls = COLORS[n.tipo] || COLORS.GENERICA
            return (
              <li key={n.id}>
                <button
                  onClick={() => handleClick(n)}
                  className={`w-full text-left flex items-start gap-3 p-3 sm:p-4 rounded-xl border transition
                    ${n.leida ? 'bg-white border-gray-100 hover:bg-gray-50' : 'bg-amber-50/40 border-amber-200 hover:bg-amber-50'}`}
                >
                  <div className={`shrink-0 p-2 rounded-lg border ${colorCls}`}>
                    <Icon size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-sm sm:text-base ${n.leida ? 'font-medium text-gray-700' : 'font-semibold text-gray-900'}`}>
                        {n.titulo}
                      </p>
                      <span className="shrink-0 text-[11px] sm:text-xs text-gray-400">
                        {formatRelative(n.created_at)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 mt-0.5 whitespace-pre-line">
                      {n.mensaje}
                    </p>
                    {n.url_accion && (
                      <p className="mt-1 text-xs text-blue-600 font-medium">Toca para ver detalle →</p>
                    )}
                  </div>
                  {!n.leida && (
                    <span className="shrink-0 w-2 h-2 rounded-full bg-rose-500 mt-2" aria-label="No leído" />
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
