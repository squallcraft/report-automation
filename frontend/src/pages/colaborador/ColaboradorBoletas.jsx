import { useState, useEffect, useRef } from 'react'
import api from '../../api'
import PageHeader from '../../components/PageHeader'
import toast from 'react-hot-toast'
import { Upload, FileText, CheckCircle, XCircle, Clock, AlertCircle, Download, RefreshCw, DollarSign } from 'lucide-react'
import { fmt, MESES } from '../../utils/format'

const now = new Date()

const ESTADO_CONFIG = {
  PENDIENTE: { label: 'En revisión', icon: AlertCircle, cls: 'text-blue-700 bg-blue-50 border-blue-200' },
  APROBADA: { label: 'Aprobada', icon: CheckCircle, cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  RECHAZADA: { label: 'Rechazada', icon: XCircle, cls: 'text-red-700 bg-red-50 border-red-200' },
  PAGADA: { label: 'Pagada', icon: DollarSign, cls: 'text-purple-700 bg-purple-50 border-purple-200' },
}

function EstadoBadge({ estado }) {
  const cfg = ESTADO_CONFIG[estado] || ESTADO_CONFIG.PENDIENTE
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${cfg.cls}`}>
      <Icon size={13} />
      {cfg.label}
    </span>
  )
}

export default function ColaboradorBoletas() {
  const [mes, setMes] = useState(now.getMonth() + 1)
  const [anio, setAnio] = useState(now.getFullYear())
  const [monto, setMonto] = useState('')
  const [numeroBoleta, setNumeroBoleta] = useState('')
  const [nota, setNota] = useState('')
  const [boletas, setBoletas] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef()

  const cargar = () => {
    setLoading(true)
    api.get('/colaboradores/portal/boletas')
      .then(({ data }) => setBoletas(data))
      .catch(() => setBoletas([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { cargar() }, [])

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    if (!monto || parseInt(monto) <= 0) {
      return toast.error('Ingresa el monto de la boleta')
    }

    const ext = file.name.split('.').pop()?.toLowerCase()
    if (!['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
      return toast.error('Formato no permitido. Use PDF, JPG o PNG')
    }

    setUploading(true)
    try {
      const form = new FormData()
      form.append('archivo', file)
      await api.post('/colaboradores/portal/boletas/upload', form, {
        params: { mes, anio, monto: parseInt(monto), numero_boleta: numeroBoleta || undefined, nota: nota || undefined },
      })
      toast.success('Boleta subida correctamente')
      setMonto('')
      setNumeroBoleta('')
      setNota('')
      cargar()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error subiendo boleta')
    } finally {
      setUploading(false)
    }
  }

  const descargar = async (boletaId, nombre) => {
    try {
      const { data } = await api.get(`/colaboradores/portal/boletas/${boletaId}/descargar`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([data]))
      const a = document.createElement('a')
      a.href = url
      a.download = nombre || 'boleta'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Error descargando boleta')
    }
  }

  const boletaActual = boletas.find(b => b.mes === mes && b.anio === anio)
  const puedeSubir = !boletaActual || boletaActual.estado === 'RECHAZADA'

  return (
    <div>
      <PageHeader title="Mis Boletas" subtitle="Sube tus boletas de honorarios" icon={FileText} accent="blue" />

      {/* Formulario de carga */}
      <div className="card mb-4 sm:mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Subir boleta</h2>
        <div className="flex flex-wrap items-end gap-3 sm:gap-4">
          <div>
            <label className="block text-[10px] sm:text-xs font-medium text-gray-500 mb-1">Mes</label>
            <select className="input-field text-xs sm:text-sm w-28 sm:w-auto" value={mes}
              onChange={e => setMes(+e.target.value)}>
              {MESES.map((label, i) => <option key={i + 1} value={i + 1}>{label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] sm:text-xs font-medium text-gray-500 mb-1">Año</label>
            <select className="input-field text-xs sm:text-sm w-20 sm:w-auto" value={anio}
              onChange={e => setAnio(+e.target.value)}>
              {[now.getFullYear(), now.getFullYear() - 1].map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="w-32">
            <label className="block text-[10px] sm:text-xs font-medium text-gray-500 mb-1">Monto *</label>
            <input type="number" className="input-field text-xs sm:text-sm w-full" placeholder="500000"
              value={monto} onChange={e => setMonto(e.target.value)} />
          </div>
          <div className="w-32">
            <label className="block text-[10px] sm:text-xs font-medium text-gray-500 mb-1">N° Boleta</label>
            <input type="text" className="input-field text-xs sm:text-sm w-full" placeholder="Opcional"
              value={numeroBoleta} onChange={e => setNumeroBoleta(e.target.value)} />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="block text-[10px] sm:text-xs font-medium text-gray-500 mb-1">Nota (opcional)</label>
            <input type="text" className="input-field text-xs sm:text-sm w-full" placeholder="Ej: Servicio abril"
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
                  <><Upload size={14} /> {boletaActual?.estado === 'RECHAZADA' ? 'Resubir boleta' : 'Subir boleta'}</>
                )}
              </button>
            ) : (
              <span className="text-xs text-gray-400 py-2 block">
                {boletaActual?.estado === 'PENDIENTE' && 'Boleta en revisión'}
                {boletaActual?.estado === 'APROBADA' && 'Boleta aprobada'}
                {boletaActual?.estado === 'PAGADA' && 'Boleta pagada'}
              </span>
            )}
          </div>
        </div>

        {boletaActual && (
          <div className={`mt-3 p-3 rounded-lg border ${ESTADO_CONFIG[boletaActual.estado]?.cls || 'bg-gray-50 border-gray-200'}`}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <EstadoBadge estado={boletaActual.estado} />
                <span className="text-xs text-gray-600">
                  {boletaActual.estado === 'PENDIENTE' && 'Tu boleta está siendo revisada'}
                  {boletaActual.estado === 'APROBADA' && 'Boleta aprobada, pendiente de pago'}
                  {boletaActual.estado === 'RECHAZADA' && 'Boleta rechazada — puedes volver a subirla'}
                  {boletaActual.estado === 'PAGADA' && 'Pago realizado'}
                </span>
              </div>
              {boletaActual.archivo_nombre && (
                <button onClick={() => descargar(boletaActual.id, boletaActual.archivo_nombre)}
                  className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                  <Download size={12} /> {boletaActual.archivo_nombre}
                </button>
              )}
            </div>
            {boletaActual.nota_admin && (
              <p className="mt-2 text-xs text-red-600 bg-red-50 p-2 rounded">
                <strong>Observación:</strong> {boletaActual.nota_admin}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Historial */}
      <div className="card p-0 overflow-hidden">
        <div className="px-3 sm:px-5 py-3 sm:py-4 border-b border-gray-100">
          <h2 className="text-xs sm:text-sm font-semibold text-gray-700">Historial de boletas</h2>
        </div>

        {loading ? (
          <div className="px-5 py-10 text-center text-gray-400">Cargando...</div>
        ) : boletas.length === 0 ? (
          <div className="px-5 py-10 text-center text-gray-400 text-sm">
            No has subido boletas aún
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm min-w-[540px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-2 sm:px-4 py-2 sm:py-3 font-medium text-gray-600">Período</th>
                  <th className="text-left px-2 sm:px-4 py-2 sm:py-3 font-medium text-gray-600">N° Boleta</th>
                  <th className="text-left px-2 sm:px-4 py-2 sm:py-3 font-medium text-gray-600">Archivo</th>
                  <th className="text-right px-2 sm:px-4 py-2 sm:py-3 font-medium text-gray-600">Monto</th>
                  <th className="px-2 sm:px-4 py-2 sm:py-3 font-medium text-gray-600">Estado</th>
                  <th className="text-left px-2 sm:px-4 py-2 sm:py-3 font-medium text-gray-600 hidden sm:table-cell">Fecha carga</th>
                </tr>
              </thead>
              <tbody>
                {boletas.map(b => (
                  <tr key={b.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-2 sm:px-4 py-2 sm:py-3 font-medium whitespace-nowrap">
                      {MESES[b.mes - 1]} {b.anio}
                    </td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-gray-600">
                      {b.numero_boleta || '—'}
                    </td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3">
                      {b.archivo_nombre ? (
                        <button onClick={() => descargar(b.id, b.archivo_nombre)}
                          className="text-blue-600 hover:underline flex items-center gap-1 text-xs">
                          <FileText size={12} /> {b.archivo_nombre}
                        </button>
                      ) : '—'}
                    </td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-right font-mono">{fmt(b.monto)}</td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3">
                      <div className="flex flex-col gap-1">
                        <EstadoBadge estado={b.estado} />
                        {b.nota_admin && (
                          <span className="text-[10px] text-red-500 max-w-[160px] truncate" title={b.nota_admin}>
                            {b.nota_admin}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 sm:px-4 py-2 sm:py-3 text-gray-500 hidden sm:table-cell">
                      {b.created_at
                        ? new Date(b.created_at).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })
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
