import { useState, useEffect } from 'react'
import api from '../../api'
import DataTable from '../../components/DataTable'
import Modal from '../../components/Modal'
import toast from 'react-hot-toast'
import { Plus, Send } from 'lucide-react'

const estadoBadge = {
  PENDIENTE: 'bg-amber-100 text-amber-700',
  RESPONDIDA: 'bg-green-100 text-green-700',
  CERRADA: 'bg-gray-100 text-gray-500',
}

export default function DriverConsultas() {
  const [consultas, setConsultas] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [detail, setDetail] = useState(null)
  const [mensaje, setMensaje] = useState('')

  useEffect(() => { load() }, [])

  const load = () => {
    setLoading(true)
    api.get('/consultas')
      .then(({ data }) => setConsultas(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    try {
      await api.post('/consultas', { mensaje })
      toast.success('Consulta enviada')
      setShowNew(false)
      setMensaje('')
      load()
    } catch { toast.error('Error al enviar consulta') }
  }

  const columns = [
    { key: 'estado', label: 'Estado', render: (v) => (
      <span className={`text-xs font-medium px-2 py-1 rounded-full ${estadoBadge[v] || ''}`}>{v}</span>
    )},
    { key: 'mensaje', label: 'Mensaje', render: (v) => <span className="truncate block max-w-xs">{v}</span> },
    { key: 'created_at', label: 'Fecha', render: (v) => v ? new Date(v).toLocaleDateString('es-CL') : '—' },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mis Consultas</h1>
          <p className="text-sm text-gray-500 mt-1">Consultas sobre entregas y pagos</p>
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> Nueva Consulta
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Cargando...</div>
      ) : (
        <DataTable columns={columns} data={consultas} onRowClick={setDetail} emptyMessage="No tienes consultas" />
      )}

      <Modal open={showNew} onClose={() => setShowNew(false)} title="Nueva Consulta">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mensaje</label>
            <textarea value={mensaje} onChange={(e) => setMensaje(e.target.value)} className="input-field h-32" placeholder="Describe tu consulta..." required />
          </div>
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={() => setShowNew(false)} className="btn-secondary">Cancelar</button>
            <button type="submit" className="btn-primary flex items-center gap-2"><Send size={14} /> Enviar</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!detail} onClose={() => setDetail(null)} title="Detalle de Consulta">
        {detail && (
          <div className="space-y-4">
            <div>
              <p className="text-xs text-gray-500 mb-1">Tu consulta:</p>
              <p className="text-sm bg-gray-50 rounded-lg p-3">{detail.mensaje}</p>
              <p className="text-xs text-gray-400 mt-1">{detail.created_at ? new Date(detail.created_at).toLocaleString('es-CL') : ''}</p>
            </div>
            {detail.respuesta && (
              <div>
                <p className="text-xs text-gray-500 mb-1">Respuesta:</p>
                <p className="text-sm bg-green-50 border border-green-200 rounded-lg p-3">{detail.respuesta}</p>
              </div>
            )}
            <span className={`inline-block text-xs font-medium px-2 py-1 rounded-full ${estadoBadge[detail.estado] || ''}`}>{detail.estado}</span>
          </div>
        )}
      </Modal>
    </div>
  )
}
