import { useState, useEffect } from 'react'
import api from '../../api'
import Modal from '../../components/Modal'
import toast from 'react-hot-toast'
import {
  MessageSquare, Plus, Send, Clock, CheckCircle, Archive, X,
} from 'lucide-react'

const ESTADO_CFG = {
  PENDIENTE:  { label: 'Pendiente',  cls: 'bg-amber-50 text-amber-700',     icon: Clock },
  RESPONDIDA: { label: 'Respondida', cls: 'bg-emerald-50 text-emerald-700', icon: CheckCircle },
  CERRADA:    { label: 'Cerrada',    cls: 'bg-gray-100 text-gray-500',      icon: Archive },
}

function EstadoChip({ estado }) {
  const cfg = ESTADO_CFG[estado] || ESTADO_CFG.PENDIENTE
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${cfg.cls}`}>
      <Icon size={10} /> {cfg.label}
    </span>
  )
}

function ConsultaCard({ c, onClick }) {
  const fechaTxt = c.created_at
    ? new Date(c.created_at).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—'
  return (
    <button onClick={onClick} className="w-full text-left bg-white rounded-2xl border border-gray-100 shadow-sm p-4 hover:bg-gray-50 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-[11px] text-gray-400">{fechaTxt}</p>
        <EstadoChip estado={c.estado} />
      </div>
      <p className="text-sm text-gray-700 line-clamp-2 leading-snug">
        {c.mensaje}
      </p>
      {c.respuesta && (
        <p className="text-[11px] text-emerald-700 mt-2 truncate">
          Respondido por admin →
        </p>
      )}
    </button>
  )
}

export default function DriverConsultas() {
  const [consultas, setConsultas] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [detail, setDetail] = useState(null)
  const [mensaje, setMensaje] = useState('')
  const [enviando, setEnviando] = useState(false)

  const load = () => {
    setLoading(true)
    api.get('/consultas')
      .then(({ data }) => setConsultas(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!mensaje.trim()) return
    setEnviando(true)
    try {
      await api.post('/consultas', { mensaje })
      toast.success('Consulta enviada')
      setShowNew(false)
      setMensaje('')
      load()
    } catch {
      toast.error('Error al enviar consulta')
    } finally { setEnviando(false) }
  }

  const totales = consultas.reduce((acc, c) => {
    if (c.estado === 'PENDIENTE')  acc.pendientes  += 1
    if (c.estado === 'RESPONDIDA') acc.respondidas += 1
    return acc
  }, { pendientes: 0, respondidas: 0 })

  return (
    <div className="max-w-lg mx-auto px-4 py-5 space-y-4">

      {/* Hero */}
      <div className="rounded-2xl text-white p-5 relative overflow-hidden"
           style={{ background: 'linear-gradient(135deg, #b45309 0%, #f59e0b 100%)' }}>
        <div className="absolute -top-8 -right-8 w-32 h-32 bg-white/5 rounded-full" />
        <div className="absolute -bottom-4 -left-4 w-20 h-20 bg-white/5 rounded-full" />

        <div className="relative">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-amber-100 text-xs font-medium uppercase tracking-wider">Mis consultas</p>
              <h1 className="text-lg font-bold leading-tight mt-0.5">Soporte y dudas</h1>
              <p className="text-amber-100 text-xs mt-0.5">Comunicación directa con administración</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0">
              <MessageSquare size={18} className="text-white" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white/10 rounded-xl p-2.5">
              <p className="text-amber-100 text-[10px] uppercase tracking-wide leading-none mb-1">Total</p>
              <p className="text-white font-bold text-base leading-tight">{consultas.length}</p>
            </div>
            <div className="bg-white/10 rounded-xl p-2.5">
              <p className="text-amber-100 text-[10px] uppercase tracking-wide leading-none mb-1">Pendientes</p>
              <p className="text-white font-bold text-base leading-tight">{totales.pendientes}</p>
            </div>
            <div className="bg-white/10 rounded-xl p-2.5">
              <p className="text-amber-100 text-[10px] uppercase tracking-wide leading-none mb-1">Respondidas</p>
              <p className="text-white font-bold text-base leading-tight">{totales.respondidas}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Botón nueva */}
      <button
        onClick={() => setShowNew(true)}
        className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold text-sm py-3 rounded-2xl shadow-sm transition-colors"
      >
        <Plus size={16} /> Nueva consulta
      </button>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center h-24">
          <div className="w-6 h-6 border-4 border-amber-200 border-t-amber-600 rounded-full animate-spin" />
        </div>
      ) : consultas.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
          <MessageSquare size={32} className="text-gray-200 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No tienes consultas aún.</p>
          <p className="text-xs text-gray-300 mt-1">Toca "Nueva consulta" para comunicarte con administración.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {consultas.map((c) => (
            <ConsultaCard key={c.id} c={c} onClick={() => setDetail(c)} />
          ))}
        </div>
      )}

      {/* Modal nueva consulta */}
      <Modal open={showNew} onClose={() => setShowNew(false)} title="Nueva consulta">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Mensaje</label>
            <textarea
              value={mensaje}
              onChange={(e) => setMensaje(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 h-32 focus:ring-2 focus:ring-amber-200 focus:border-amber-400 outline-none"
              placeholder="Describe tu consulta…"
              required
            />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowNew(false)}
              className="flex-1 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl py-2.5 transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={enviando}
              className="flex-1 flex items-center justify-center gap-2 text-sm font-semibold text-white bg-amber-500 hover:bg-amber-600 disabled:bg-gray-200 rounded-xl py-2.5 transition-colors">
              <Send size={14} /> {enviando ? 'Enviando…' : 'Enviar'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal detalle */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title="Detalle de consulta">
        {detail && (
          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Tu consulta</p>
              <p className="text-sm bg-gray-50 rounded-xl p-3 text-gray-700 leading-relaxed">{detail.mensaje}</p>
              <p className="text-[11px] text-gray-400 mt-1.5">
                {detail.created_at ? new Date(detail.created_at).toLocaleString('es-CL') : ''}
              </p>
            </div>
            {detail.respuesta && (
              <div>
                <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-1">Respuesta</p>
                <p className="text-sm bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-emerald-900 leading-relaxed">{detail.respuesta}</p>
              </div>
            )}
            <div className="pt-1">
              <EstadoChip estado={detail.estado} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
