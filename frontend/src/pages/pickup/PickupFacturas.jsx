import { useState, useEffect, useRef } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import { Upload, FileText, CheckCircle, XCircle, Clock, AlertCircle, Download, RefreshCw } from 'lucide-react'
import { fmt, MESES } from '../../utils/format'

const now = new Date()

const ESTADO_CONFIG = {
  SIN_FACTURA: { label: 'Sin factura', icon: Clock, cls: 'text-gray-600 bg-gray-50 border-gray-200', desc: 'Sube tu factura para este período' },
  CARGADA: { label: 'En revisión', icon: AlertCircle, cls: 'text-blue-700 bg-blue-50 border-blue-200', desc: 'Tu factura está siendo revisada por el administrador' },
  APROBADA: { label: 'Aprobada', icon: CheckCircle, cls: 'text-emerald-700 bg-emerald-50 border-emerald-200', desc: 'Tu factura fue aprobada' },
  RECHAZADA: { label: 'Rechazada', icon: XCircle, cls: 'text-red-700 bg-red-50 border-red-200', desc: 'Tu factura fue rechazada — puedes volver a subirla' },
}

function EstadoBadge({ estado }) {
  const cfg = ESTADO_CONFIG[estado] || ESTADO_CONFIG.SIN_FACTURA
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${cfg.cls}`}>
      <Icon size={13} />
      {cfg.label}
    </span>
  )
}

export default function PickupFacturas() {
  const [mes, setMes] = useState(now.getMonth() + 1)
  const [anio, setAnio] = useState(now.getFullYear())
  const [facturas, setFacturas] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadMes, setUploadMes] = useState(now.getMonth() + 1)
  const [uploadAnio, setUploadAnio] = useState(now.getFullYear())
  const [nota, setNota] = useState('')
  const inputRef = useRef()

  const cargar = () => {
    setLoading(true)
    api.get('/cpp/portal/facturas')
      .then(({ data }) => setFacturas(data))
      .catch(() => setFacturas([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { cargar() }, [])

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
      return toast.error('Formato no permitido. Use PDF, JPG o PNG')
    }

    setUploading(true)
    try {
      const form = new FormData()
      form.append('archivo', file)
      await api.post('/cpp/portal/facturas/upload', form, {
        params: { mes: uploadMes, anio: uploadAnio, nota: nota || undefined },
      })
      toast.success('Factura subida correctamente')
      setNota('')
      cargar()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error subiendo factura')
    } finally {
      setUploading(false)
    }
  }

  const descargar = async (facturaId, nombre) => {
    try {
      const { data } = await api.get(`/cpp/portal/facturas/${facturaId}/descargar`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([data]))
      const a = document.createElement('a')
      a.href = url
      a.download = nombre || 'factura'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Error descargando factura')
    }
  }

  const facturaActual = facturas.find(f => f.mes === uploadMes && f.anio === uploadAnio)
  const puedeSubir = !facturaActual || facturaActual.estado === 'SIN_FACTURA' || facturaActual.estado === 'RECHAZADA'

  return (
    <div>
      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Mis Facturas</h1>
        <p className="text-xs sm:text-sm text-gray-500 mt-1">Sube tus facturas por período para recibir tus pagos</p>
      </div>

      {/* Formulario de carga */}
      <div className="card mb-4 sm:mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Subir factura</h2>
        <div className="flex flex-wrap items-end gap-3 sm:gap-4">
          <div>
            <label className="block text-[10px] sm:text-xs font-medium text-gray-500 mb-1">Mes</label>
            <select className="input-field text-xs sm:text-sm w-28 sm:w-auto" value={uploadMes}
              onChange={e => setUploadMes(+e.target.value)}>
              {MESES.map((label, i) => <option key={i + 1} value={i + 1}>{label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] sm:text-xs font-medium text-gray-500 mb-1">Año</label>
            <select className="input-field text-xs sm:text-sm w-20 sm:w-auto" value={uploadAnio}
              onChange={e => setUploadAnio(+e.target.value)}>
              {[now.getFullYear(), now.getFullYear() - 1].map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[150px]">
            <label className="block text-[10px] sm:text-xs font-medium text-gray-500 mb-1">Nota (opcional)</label>
            <input type="text" className="input-field text-xs sm:text-sm w-full" placeholder="Ej: Boleta de honorarios"
              value={nota} onChange={e => setNota(e.target.value)} />
          </div>
          <div>
            <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
              onChange={handleUpload} />
            {puedeSubir ? (
              <button onClick={() => inputRef.current?.click()} disabled={uploading}
                className="btn-primary text-xs sm:text-sm px-4 py-2 rounded-lg flex items-center gap-2 font-medium">
                {uploading ? (
                  <><RefreshCw size={14} className="animate-spin" /> Subiendo...</>
                ) : (
                  <><Upload size={14} /> {facturaActual?.estado === 'RECHAZADA' ? 'Resubir factura' : 'Subir factura'}</>
                )}
              </button>
            ) : (
              <span className="text-xs text-gray-400 py-2 block">
                {facturaActual?.estado === 'CARGADA' && 'Factura en revisión'}
                {facturaActual?.estado === 'APROBADA' && 'Factura ya aprobada'}
              </span>
            )}
          </div>
        </div>

        {facturaActual && (
          <div className={`mt-3 p-3 rounded-lg border ${
            ESTADO_CONFIG[facturaActual.estado]?.cls || 'bg-gray-50 border-gray-200'
          }`}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <EstadoBadge estado={facturaActual.estado} />
                <span className="text-xs text-gray-600">
                  {ESTADO_CONFIG[facturaActual.estado]?.desc}
                </span>
              </div>
              {facturaActual.archivo_nombre && (
                <button onClick={() => descargar(facturaActual.id, facturaActual.archivo_nombre)}
                  className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                  <Download size={12} /> {facturaActual.archivo_nombre}
                </button>
              )}
            </div>
            {facturaActual.nota_admin && (
              <p className="mt-2 text-xs text-red-600 bg-red-50 p-2 rounded">
                <strong>Observación:</strong> {facturaActual.nota_admin}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Historial de facturas */}
      <div className="card p-0 overflow-hidden">
        <div className="px-3 sm:px-5 py-3 sm:py-4 border-b border-gray-100">
          <h2 className="text-xs sm:text-sm font-semibold text-gray-700">Historial de facturas</h2>
        </div>

        {loading ? (
          <div className="px-5 py-10 text-center text-gray-400">Cargando...</div>
        ) : facturas.length === 0 ? (
          <div className="px-5 py-10 text-center text-gray-400 text-sm">
            No has subido facturas aún
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm min-w-[500px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-2 sm:px-4 py-2 sm:py-3 font-medium text-gray-600">Período</th>
                  <th className="text-left px-2 sm:px-4 py-2 sm:py-3 font-medium text-gray-600">Archivo</th>
                  <th className="text-right px-2 sm:px-4 py-2 sm:py-3 font-medium text-gray-600">Monto</th>
                  <th className="px-2 sm:px-4 py-2 sm:py-3 font-medium text-gray-600">Estado</th>
                  <th className="text-left px-2 sm:px-4 py-2 sm:py-3 font-medium text-gray-600 hidden sm:table-cell">Fecha carga</th>
                </tr>
              </thead>
              <tbody>
                {facturas.map(f => (
                  <tr key={f.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-2 sm:px-4 py-2 sm:py-3 font-medium whitespace-nowrap">
                      {MESES[f.mes - 1]} {f.anio}
                    </td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3">
                      {f.archivo_nombre ? (
                        <button onClick={() => descargar(f.id, f.archivo_nombre)}
                          className="text-blue-600 hover:underline flex items-center gap-1 text-xs">
                          <FileText size={12} /> {f.archivo_nombre}
                        </button>
                      ) : '—'}
                    </td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-right font-mono">{fmt(f.monto_neto)}</td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3">
                      <EstadoBadge estado={f.estado} />
                    </td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-gray-500 hidden sm:table-cell">
                      {f.created_at
                        ? new Date(f.created_at).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
