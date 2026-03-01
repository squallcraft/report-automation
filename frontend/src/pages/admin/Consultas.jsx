import { useState, useEffect } from 'react'
import api from '../../api'
import DataTable from '../../components/DataTable'
import Modal from '../../components/Modal'
import toast from 'react-hot-toast'
import { MessageSquare, Send, XCircle } from 'lucide-react'

const truncate = (str, len = 50) => {
  if (!str) return ''
  return str.length <= len ? str : str.slice(0, len) + '...'
}

const formatDate = (d) => {
  if (!d) return ''
  const date = new Date(d)
  return date.toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })
}

const EstadoBadge = ({ estado }) => {
  const styles = {
    PENDIENTE: 'bg-amber-100 text-amber-700',
    RESPONDIDA: 'bg-green-100 text-green-700',
    CERRADA: 'bg-gray-100 text-gray-600',
  }
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${styles[estado] || 'bg-gray-100 text-gray-600'}`}>
      {estado}
    </span>
  )
}

const TipoBadge = ({ tipo }) => (
  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${tipo === 'SELLER' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
    {tipo}
  </span>
)

export default function Consultas() {
  const [consultas, setConsultas] = useState([])
  const [loading, setLoading] = useState(true)
  const [detailModal, setDetailModal] = useState(null)
  const [respuesta, setRespuesta] = useState('')
  const [sending, setSending] = useState(false)

  const fetchConsultas = () => {
    api.get('/consultas')
      .then(({ data }) => setConsultas(data))
      .catch(() => toast.error('Error al cargar consultas'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchConsultas()
  }, [])

  const openDetail = (consulta) => {
    setDetailModal(consulta)
    setRespuesta(consulta.respuesta || '')
  }

  const handleRespond = (e) => {
    e.preventDefault()
    if (!detailModal || !respuesta.trim()) return
    setSending(true)
    api.put(`/consultas/${detailModal.id}/responder`, { respuesta: respuesta.trim() })
      .then(() => {
        toast.success('Respuesta enviada')
        fetchConsultas()
        setDetailModal((prev) => prev ? { ...prev, respuesta: respuesta.trim(), estado: 'RESPONDIDA' } : null)
      })
      .catch((err) => toast.error(err.response?.data?.detail || 'Error al responder'))
      .finally(() => setSending(false))
  }

  const handleCerrar = () => {
    if (!detailModal) return
    setSending(true)
    api.put(`/consultas/${detailModal.id}/cerrar`)
      .then(() => {
        toast.success('Consulta cerrada')
        fetchConsultas()
        setDetailModal(null)
      })
      .catch((err) => toast.error(err.response?.data?.detail || 'Error al cerrar'))
      .finally(() => setSending(false))
  }

  const columns = [
    { key: 'tipo', label: 'Tipo', render: (v) => <TipoBadge tipo={v} /> },
    { key: 'entidad_nombre', label: 'Entidad' },
    { key: 'estado', label: 'Estado', render: (v) => <EstadoBadge estado={v} /> },
    { key: 'mensaje', label: 'Mensaje', render: (v) => truncate(v) },
    { key: 'created_at', label: 'Fecha', render: (v) => formatDate(v) },
  ]

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-400">Cargando...</div>
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <MessageSquare size={28} className="text-primary-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Consultas del Portal</h1>
            <p className="text-sm text-gray-500 mt-1">Gestiona las consultas de sellers y drivers</p>
          </div>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={consultas}
        onRowClick={openDetail}
        emptyMessage="No hay consultas"
      />

      <Modal open={!!detailModal} onClose={() => setDetailModal(null)} title="Detalle de Consulta" wide>
        {detailModal && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <TipoBadge tipo={detailModal.tipo} />
              <EstadoBadge estado={detailModal.estado} />
              <span className="text-sm text-gray-500">{formatDate(detailModal.created_at)}</span>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700 mb-1">Entidad</p>
              <p className="text-gray-900">{detailModal.entidad_nombre}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700 mb-1">Mensaje</p>
              <div className="card bg-gray-50 p-4 text-gray-800 whitespace-pre-wrap">{detailModal.mensaje}</div>
            </div>
            {detailModal.respuesta && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-1">Respuesta</p>
                <div className="card bg-primary-50 border border-primary-200 p-4 text-gray-800 whitespace-pre-wrap">
                  {detailModal.respuesta}
                </div>
              </div>
            )}
            {detailModal.estado !== 'CERRADA' && (
              <form onSubmit={handleRespond} className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Responder</label>
                  <textarea
                    className="input-field min-h-[100px] resize-y"
                    value={respuesta}
                    onChange={(e) => setRespuesta(e.target.value)}
                    placeholder="Escribe tu respuesta..."
                    required
                  />
                </div>
                <div className="flex gap-3 justify-end">
                  <button
                    type="button"
                    onClick={handleCerrar}
                    disabled={sending}
                    className="btn-secondary flex items-center gap-2"
                  >
                    <XCircle size={16} />
                    Cerrar consulta
                  </button>
                  <button type="submit" disabled={sending} className="btn-primary flex items-center gap-2">
                    <Send size={16} />
                    {sending ? 'Enviando...' : 'Enviar respuesta'}
                  </button>
                </div>
              </form>
            )}
            {detailModal.estado === 'CERRADA' && (
              <div className="flex justify-end">
                <button type="button" onClick={() => setDetailModal(null)} className="btn-secondary">
                  Cerrar
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
