import { useState, useEffect, useRef, useCallback } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import PageHeader from '../../components/PageHeader'
import {
  MessageSquare, Send, User, Bot, Phone, ArrowLeft, Search,
  Filter, ThermometerSun, Clock, ExternalLink, RefreshCw,
} from 'lucide-react'

const ETAPA_COLORS = {
  nuevo: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Nuevo' },
  ia_gestionando: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'IA Gestionando' },
  calificado: { bg: 'bg-green-100', text: 'text-green-700', label: 'Calificado' },
  requiere_humano: { bg: 'bg-red-100', text: 'text-red-700', label: 'Requiere Humano' },
  contactado: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Contactado' },
  propuesta: { bg: 'bg-indigo-100', text: 'text-indigo-700', label: 'Propuesta' },
  ganado: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Ganado' },
  perdido: { bg: 'bg-gray-100', text: 'text-gray-500', label: 'Perdido' },
}

const TEMP_COLORS = {
  frio: { icon: '❄️', label: 'Frío' },
  tibio: { icon: '🌤️', label: 'Tibio' },
  caliente: { icon: '🔥', label: 'Caliente' },
}

function EtapaBadge({ etapa }) {
  const c = ETAPA_COLORS[etapa] || ETAPA_COLORS.nuevo
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${c.bg} ${c.text}`}>{c.label}</span>
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'ahora'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  return `${days}d`
}

function LeadRow({ lead, selected, onClick }) {
  const temp = TEMP_COLORS[lead.temperatura] || TEMP_COLORS.frio
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${selected ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-gray-900 truncate">
              {lead.nombre || lead.phone}
            </span>
            <span className="text-xs">{temp.icon}</span>
          </div>
          {lead.nombre && (
            <p className="text-xs text-gray-400 mt-0.5">{lead.phone}</p>
          )}
          <p className="text-xs text-gray-500 mt-1 truncate">
            {lead.ultimo_mensaje_preview || 'Sin mensajes'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-[10px] text-gray-400">{timeAgo(lead.ultimo_mensaje_lead)}</span>
          <EtapaBadge etapa={lead.etapa} />
        </div>
      </div>
    </button>
  )
}

function ChatBubble({ msg }) {
  const isLead = msg.direccion === 'inbound'
  const authorLabel = msg.autor === 'ia' ? 'IA' : msg.autor === 'humano' ? 'Ejecutivo' : null
  return (
    <div className={`flex ${isLead ? 'justify-start' : 'justify-end'} mb-2`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
          isLead
            ? 'bg-white border border-gray-200 text-gray-800 rounded-bl-md'
            : msg.autor === 'ia'
            ? 'bg-purple-100 text-purple-900 rounded-br-md'
            : 'bg-blue-500 text-white rounded-br-md'
        }`}
      >
        {!isLead && authorLabel && (
          <div className={`text-[10px] font-semibold mb-1 ${msg.autor === 'ia' ? 'text-purple-500' : 'text-blue-100'}`}>
            {msg.autor === 'ia' ? <><Bot size={10} className="inline mr-1" />IA</> : <><User size={10} className="inline mr-1" />Ejecutivo</>}
          </div>
        )}
        <p className="whitespace-pre-wrap">{msg.contenido}</p>
        <p className={`text-[10px] mt-1 ${isLead ? 'text-gray-400' : msg.autor === 'ia' ? 'text-purple-400' : 'text-blue-200'}`}>
          {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : ''}
        </p>
      </div>
    </div>
  )
}

function LeadDetail({ lead, onBack, onUpdate }) {
  const [msgs, setMsgs] = useState([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [editEtapa, setEditEtapa] = useState(false)
  const chatEnd = useRef(null)

  const loadMsgs = useCallback(() => {
    if (!lead) return
    api.get(`/leads/${lead.id}/mensajes`).then(r => setMsgs(r.data)).catch(() => {})
  }, [lead?.id])

  useEffect(() => {
    loadMsgs()
    const iv = setInterval(loadMsgs, 8000)
    return () => clearInterval(iv)
  }, [loadMsgs])

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs.length])

  const handleSend = async () => {
    if (!text.trim() || sending) return
    setSending(true)
    try {
      await api.post(`/leads/${lead.id}/mensajes`, { contenido: text.trim() })
      setText('')
      loadMsgs()
      toast.success('Mensaje enviado')
    } catch {
      toast.error('Error enviando mensaje')
    }
    setSending(false)
  }

  const handleEtapaChange = async (newEtapa) => {
    try {
      await api.patch(`/leads/${lead.id}`, { etapa: newEtapa })
      onUpdate?.()
      setEditEtapa(false)
      toast.success('Etapa actualizada')
    } catch {
      toast.error('Error')
    }
  }

  const handleNotasChange = async (notas) => {
    try { await api.patch(`/leads/${lead.id}`, { notas_humano: notas }) } catch {}
  }

  if (!lead) return null
  const temp = TEMP_COLORS[lead.temperatura] || TEMP_COLORS.frio

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="lg:hidden p-1 hover:bg-gray-100 rounded">
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-gray-900 truncate">{lead.nombre || lead.phone}</h3>
              <span className="text-sm">{temp.icon}</span>
              <EtapaBadge etapa={lead.etapa} />
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-400 mt-0.5">
              <span className="flex items-center gap-1"><Phone size={10} />{lead.phone}</span>
              {lead.gestionado_por && <span>Gestión: {lead.gestionado_por}</span>}
              <span>{lead.interacciones_ia || 0} interacciones IA</span>
            </div>
          </div>
          <a
            href={`https://wa.me/${(lead.phone || '').replace('+', '')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 hover:bg-gray-100 rounded-lg text-green-600"
            title="Abrir en WhatsApp"
          >
            <ExternalLink size={16} />
          </a>
        </div>

        {/* Info cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
          {lead.negocio && <div className="bg-gray-50 rounded-lg px-3 py-1.5 text-xs"><span className="text-gray-400">Negocio</span><p className="font-medium text-gray-700 truncate">{lead.negocio}</p></div>}
          {lead.canal_venta && <div className="bg-gray-50 rounded-lg px-3 py-1.5 text-xs"><span className="text-gray-400">Canal</span><p className="font-medium text-gray-700 truncate">{lead.canal_venta}</p></div>}
          {lead.volumen_estimado && <div className="bg-gray-50 rounded-lg px-3 py-1.5 text-xs"><span className="text-gray-400">Volumen</span><p className="font-medium text-gray-700 truncate">{lead.volumen_estimado}</p></div>}
          {lead.ubicacion && <div className="bg-gray-50 rounded-lg px-3 py-1.5 text-xs"><span className="text-gray-400">Ubicación</span><p className="font-medium text-gray-700 truncate">{lead.ubicacion}</p></div>}
        </div>

        {/* Etapa quick switch */}
        {editEtapa ? (
          <div className="flex flex-wrap gap-1 mt-2">
            {Object.entries(ETAPA_COLORS).map(([key, val]) => (
              <button key={key} onClick={() => handleEtapaChange(key)}
                className={`px-2 py-1 text-xs rounded-full border ${lead.etapa === key ? 'ring-2 ring-blue-400' : ''} ${val.bg} ${val.text}`}>
                {val.label}
              </button>
            ))}
            <button onClick={() => setEditEtapa(false)} className="px-2 py-1 text-xs text-gray-400 hover:text-gray-600">Cancelar</button>
          </div>
        ) : (
          <button onClick={() => setEditEtapa(true)} className="text-xs text-blue-500 hover:text-blue-700 mt-2">Cambiar etapa</button>
        )}
      </div>

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 bg-gray-50 min-h-0" style={{ backgroundImage: 'radial-gradient(circle, #e5e7eb 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
        {msgs.length === 0 && (
          <div className="text-center text-gray-400 text-sm py-8">Sin mensajes aún</div>
        )}
        {msgs.map(m => <ChatBubble key={m.id} msg={m} />)}
        <div ref={chatEnd} />
      </div>

      {/* Input */}
      <div className="bg-white border-t border-gray-200 px-4 py-3 shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder="Escribe como ejecutivo..."
            rows={1}
            className="flex-1 resize-none border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
            style={{ maxHeight: 120, minHeight: 40 }}
          />
          <button
            onClick={handleSend}
            disabled={!text.trim() || sending}
            className="p-2.5 bg-blue-500 text-white rounded-xl hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}

export default function LeadsInbox() {
  const [leads, setLeads] = useState([])
  const [total, setTotal] = useState(0)
  const [selected, setSelected] = useState(null)
  const [search, setSearch] = useState('')
  const [filterEtapa, setFilterEtapa] = useState('')
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({})

  const loadLeads = useCallback(() => {
    const params = { limit: 100, sort_by: 'ultimo_mensaje_lead', sort_dir: 'desc' }
    if (search) params.search = search
    if (filterEtapa) params.etapa = filterEtapa
    api.get('/leads', { params }).then(r => {
      setLeads(r.data.leads)
      setTotal(r.data.total)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [search, filterEtapa])

  const loadStats = useCallback(() => {
    api.get('/leads/stats').then(r => setStats(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    loadLeads()
    loadStats()
    const iv = setInterval(loadLeads, 15000)
    return () => clearInterval(iv)
  }, [loadLeads, loadStats])

  const handleSelectLead = (lead) => {
    api.get(`/leads/${lead.id}`).then(r => setSelected(r.data)).catch(() => setSelected(lead))
  }

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col">
      <PageHeader title="Leads WhatsApp" subtitle={`${total} leads en total`} />

      {/* Stats bar */}
      <div className="flex gap-2 flex-wrap mb-3 px-1">
        {Object.entries(stats.por_etapa || {}).map(([etapa, count]) => {
          const c = ETAPA_COLORS[etapa] || ETAPA_COLORS.nuevo
          return (
            <button
              key={etapa}
              onClick={() => setFilterEtapa(filterEtapa === etapa ? '' : etapa)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                filterEtapa === etapa ? 'ring-2 ring-blue-400 shadow-sm' : ''
              } ${c.bg} ${c.text}`}
            >
              {c.label}: {count}
            </button>
          )
        })}
        {filterEtapa && (
          <button onClick={() => setFilterEtapa('')} className="px-3 py-1.5 rounded-full text-xs text-gray-500 hover:text-gray-700 border border-gray-200">
            Limpiar filtro
          </button>
        )}
      </div>

      {/* Main layout */}
      <div className="flex-1 flex border border-gray-200 rounded-xl overflow-hidden bg-white min-h-0">
        {/* Lead list */}
        <div className={`w-full lg:w-96 border-r border-gray-200 flex flex-col shrink-0 ${selected ? 'hidden lg:flex' : ''}`}>
          <div className="px-3 py-2 border-b border-gray-100">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar lead..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading && <p className="text-center text-gray-400 text-sm py-8">Cargando...</p>}
            {!loading && leads.length === 0 && <p className="text-center text-gray-400 text-sm py-8">No hay leads</p>}
            {leads.map(l => (
              <LeadRow
                key={l.id}
                lead={l}
                selected={selected?.id === l.id}
                onClick={() => handleSelectLead(l)}
              />
            ))}
          </div>
        </div>

        {/* Chat panel */}
        <div className={`flex-1 flex flex-col min-w-0 ${!selected ? 'hidden lg:flex' : ''}`}>
          {selected ? (
            <LeadDetail
              lead={selected}
              onBack={() => setSelected(null)}
              onUpdate={() => {
                loadLeads()
                loadStats()
                handleSelectLead(selected)
              }}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <MessageSquare size={48} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">Selecciona un lead para ver la conversación</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
