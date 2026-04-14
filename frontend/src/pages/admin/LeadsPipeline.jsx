import { useState, useEffect, useCallback } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import PageHeader from '../../components/PageHeader'
import { Phone, ArrowRight, ThermometerSun, MessageSquare, User } from 'lucide-react'

const ETAPAS = [
  { key: 'nuevo', label: 'Nuevo', color: 'border-blue-400', bg: 'bg-blue-50', dot: 'bg-blue-400' },
  { key: 'ia_gestionando', label: 'IA Gestionando', color: 'border-purple-400', bg: 'bg-purple-50', dot: 'bg-purple-400' },
  { key: 'calificado', label: 'Calificado', color: 'border-green-400', bg: 'bg-green-50', dot: 'bg-green-400' },
  { key: 'requiere_humano', label: 'Requiere Humano', color: 'border-red-400', bg: 'bg-red-50', dot: 'bg-red-400' },
  { key: 'contactado', label: 'Contactado', color: 'border-yellow-400', bg: 'bg-yellow-50', dot: 'bg-yellow-400' },
  { key: 'propuesta', label: 'Propuesta', color: 'border-indigo-400', bg: 'bg-indigo-50', dot: 'bg-indigo-400' },
  { key: 'ganado', label: 'Ganado', color: 'border-emerald-400', bg: 'bg-emerald-50', dot: 'bg-emerald-400' },
  { key: 'perdido', label: 'Perdido', color: 'border-gray-300', bg: 'bg-gray-50', dot: 'bg-gray-400' },
]

const TEMP_ICONS = { frio: '❄️', tibio: '🌤️', caliente: '🔥' }

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'ahora'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

function LeadCard({ lead, onMove }) {
  const [showMove, setShowMove] = useState(false)

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3 mb-2 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm text-gray-900 truncate">{lead.nombre || lead.phone}</p>
          {lead.nombre && <p className="text-xs text-gray-400 truncate">{lead.phone}</p>}
        </div>
        <span className="text-xs shrink-0">{TEMP_ICONS[lead.temperatura] || '❄️'}</span>
      </div>

      <div className="mt-2 space-y-1">
        {lead.negocio && <p className="text-xs text-gray-500 truncate">🏪 {lead.negocio}</p>}
        {lead.canal_venta && <p className="text-xs text-gray-500 truncate">📦 {lead.canal_venta}</p>}
        {lead.volumen_estimado && <p className="text-xs text-gray-500 truncate">📊 {lead.volumen_estimado}</p>}
      </div>

      <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
        <span className="text-[10px] text-gray-400 flex items-center gap-1">
          <MessageSquare size={10} /> {lead.interacciones_ia || 0} · {lead.gestionado_por || 'ia'}
        </span>
        <span className="text-[10px] text-gray-400">{timeAgo(lead.ultimo_mensaje_lead)}</span>
      </div>

      <div className="flex items-center gap-1 mt-2">
        <a
          href={`https://wa.me/${(lead.phone || '').replace('+', '')}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] px-2 py-1 rounded bg-green-50 text-green-600 hover:bg-green-100"
        >
          WhatsApp
        </a>
        <button
          onClick={() => setShowMove(!showMove)}
          className="text-[10px] px-2 py-1 rounded bg-gray-50 text-gray-500 hover:bg-gray-100 flex items-center gap-1"
        >
          <ArrowRight size={10} /> Mover
        </button>
      </div>

      {showMove && (
        <div className="flex flex-wrap gap-1 mt-2 p-2 bg-gray-50 rounded-lg">
          {ETAPAS.filter(e => e.key !== lead.etapa).map(e => (
            <button
              key={e.key}
              onClick={() => { onMove(lead.id, e.key); setShowMove(false) }}
              className={`text-[10px] px-2 py-1 rounded-full border ${e.bg} hover:opacity-80`}
            >
              {e.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function LeadsPipeline() {
  const [pipeline, setPipeline] = useState({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    api.get('/leads/pipeline').then(r => {
      setPipeline(r.data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
    const iv = setInterval(load, 20000)
    return () => clearInterval(iv)
  }, [load])

  const handleMove = async (leadId, newEtapa) => {
    try {
      await api.patch(`/leads/${leadId}`, { etapa: newEtapa })
      toast.success('Lead movido')
      load()
    } catch {
      toast.error('Error moviendo lead')
    }
  }

  const totalLeads = Object.values(pipeline).reduce((sum, arr) => sum + (arr?.length || 0), 0)

  return (
    <div>
      <PageHeader title="Pipeline de Leads" subtitle={`${totalLeads} leads activos`} />

      {loading ? (
        <p className="text-center text-gray-400 py-8">Cargando pipeline...</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: 'calc(100vh - 220px)' }}>
          {ETAPAS.map(etapa => {
            const items = pipeline[etapa.key] || []
            return (
              <div key={etapa.key} className="flex-shrink-0 w-72">
                <div className={`rounded-t-lg border-t-4 ${etapa.color} bg-white p-3 sticky top-0`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${etapa.dot}`} />
                      <h3 className="font-semibold text-sm text-gray-700">{etapa.label}</h3>
                    </div>
                    <span className="text-xs font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                      {items.length}
                    </span>
                  </div>
                </div>
                <div className={`${etapa.bg} bg-opacity-30 rounded-b-lg p-2 min-h-[200px]`}>
                  {items.length === 0 && (
                    <p className="text-xs text-gray-300 text-center py-8">Sin leads</p>
                  )}
                  {items.map(lead => (
                    <LeadCard key={lead.id} lead={lead} onMove={handleMove} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
