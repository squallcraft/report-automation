import { useEffect, useState, useRef } from 'react'
import api from '../../api'
import { FileText, Download, PenTool, Upload, CheckCircle, Clock, AlertCircle, X } from 'lucide-react'

const ESTADOS = {
  BORRADOR: { label: 'Pendiente de firma', color: 'bg-amber-100 text-amber-700', icon: Clock },
  EMITIDO: { label: 'Emitido', color: 'bg-blue-100 text-blue-700', icon: Clock },
  FIRMADO: { label: 'Firmado', color: 'bg-green-100 text-green-700', icon: CheckCircle },
}

function FirmaModal({ anexo, onClose, onSigned }) {
  const canvasRef = useRef(null)
  const [drawing, setDrawing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const startDraw = (e) => {
    setDrawing(true)
    const ctx = canvasRef.current.getContext('2d')
    const rect = canvasRef.current.getBoundingClientRect()
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left
    const y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  const draw = (e) => {
    if (!drawing) return
    const ctx = canvasRef.current.getContext('2d')
    const rect = canvasRef.current.getBoundingClientRect()
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left
    const y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#1e3a5f'
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  const stopDraw = () => setDrawing(false)

  const clearCanvas = () => {
    const ctx = canvasRef.current.getContext('2d')
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
  }

  const handleSign = async () => {
    const firma = canvasRef.current.toDataURL('image/png')
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.post(`/inquilinos/portal/contratos/${anexo.id}/firmar`, { firma_base64: firma })
      onSigned(data)
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail || 'Error al firmar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h3 className="font-semibold text-gray-900">Firma digital</h3>
            <p className="text-sm text-gray-500">{anexo.titulo}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600">
            Dibuja tu firma en el recuadro de abajo. Al firmar, aceptas los términos y condiciones del contrato.
          </p>
          <div className="border-2 border-gray-200 rounded-xl overflow-hidden bg-gray-50">
            <canvas
              ref={canvasRef}
              width={480}
              height={160}
              className="w-full cursor-crosshair touch-none"
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={stopDraw}
              onMouseLeave={stopDraw}
              onTouchStart={startDraw}
              onTouchMove={draw}
              onTouchEnd={stopDraw}
            />
          </div>
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              {error}
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={clearCanvas} className="flex-1 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
              Limpiar
            </button>
            <button onClick={handleSign} disabled={loading}
              className="flex-1 py-2 text-sm font-semibold text-white bg-blue-900 rounded-lg hover:bg-blue-800 disabled:opacity-60 flex items-center justify-center gap-2">
              {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              <PenTool className="w-4 h-4" />
              Firmar documento
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function InquilinoContratos() {
  const [contratos, setContratos] = useState([])
  const [loading, setLoading] = useState(true)
  const [signing, setSigning] = useState(null)

  const fetchContratos = () => {
    api.get('/inquilinos/portal/contratos')
      .then(r => setContratos(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchContratos() }, [])

  const handleDownload = async (id, titulo) => {
    try {
      const { data } = await api.get(`/inquilinos/portal/contratos/${id}/pdf`)
      const link = document.createElement('a')
      link.href = `data:application/pdf;base64,${data.pdf_base64}`
      link.download = `${titulo || 'contrato'}.pdf`
      link.click()
    } catch {}
  }

  const handleSigned = (updated) => {
    setContratos(prev => prev.map(c => c.id === updated.id ? updated : c))
    fetchContratos()
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-2 border-blue-900 border-t-transparent rounded-full" />
    </div>
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Contratos</h1>
        <p className="text-gray-500 mt-1">Tus contratos y documentos del servicio Tracking Tech</p>
      </div>

      {contratos.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No hay contratos disponibles aún</p>
          <p className="text-sm text-gray-400 mt-1">Tu ejecutivo de cuenta emitirá los documentos pronto</p>
        </div>
      ) : (
        <div className="space-y-3">
          {contratos.map(c => {
            const estado = ESTADOS[c.estado] || ESTADOS.BORRADOR
            const EIcon = estado.icon
            return (
              <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                      <FileText className="w-5 h-5 text-blue-900" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{c.titulo}</h3>
                      <p className="text-sm text-gray-500 mt-0.5">
                        Tipo: {c.tipo === 'RESERVA' ? 'Anexo de Reserva' : 'Contrato Principal'}
                        {c.firmado_at && ` · Firmado ${new Date(c.firmado_at).toLocaleDateString('es-CL')}`}
                      </p>
                      {c.tipo === 'RESERVA' && c.estado === 'BORRADOR' && !c.comprobante_reserva_aprobado && (
                        <div className="mt-2 flex items-center gap-2">
                          <div className="px-2.5 py-1 bg-amber-100 text-amber-700 text-xs font-medium rounded-full flex items-center gap-1">
                            <Upload className="w-3 h-3" />
                            Comprobante pendiente
                          </div>
                          {!c.comprobante_reserva_path && (
                            <span className="text-xs text-gray-400">Sube el comprobante de la transferencia de reserva</span>
                          )}
                          {c.comprobante_reserva_path && !c.comprobante_reserva_aprobado && (
                            <span className="text-xs text-amber-600">En revisión por el administrador</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${estado.color}`}>
                      <EIcon className="w-3 h-3" />
                      {estado.label}
                    </span>
                    <button onClick={() => handleDownload(c.id, c.titulo)}
                      className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title="Descargar PDF">
                      <Download className="w-4 h-4 text-gray-500" />
                    </button>
                    {c.estado === 'BORRADOR' && c.requiere_firma_inquilino && (
                      <button onClick={() => setSigning(c)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-900 rounded-lg hover:bg-blue-800 transition-colors">
                        <PenTool className="w-3 h-3" />
                        Firmar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {signing && (
        <FirmaModal
          anexo={signing}
          onClose={() => setSigning(null)}
          onSigned={handleSigned}
        />
      )}
    </div>
  )
}
