import { useState, useEffect, useRef } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import {
  Upload, FileText, CheckCircle, XCircle, Clock, AlertCircle,
  Download, RefreshCw,
} from 'lucide-react'
import { fmt, MESES } from '../../utils/format'

const now = new Date()

const ESTADO_CFG = {
  SIN_FACTURA: { label: 'Sin factura', icon: Clock,        cls: 'text-gray-600  bg-gray-50  border-gray-200',  desc: 'Sube tu factura para esta semana' },
  CARGADA:     { label: 'En revisión', icon: AlertCircle,  cls: 'text-blue-700 bg-blue-50  border-blue-200',  desc: 'Tu factura está siendo revisada' },
  APROBADA:    { label: 'Aprobada',    icon: CheckCircle,  cls: 'text-emerald-700 bg-emerald-50 border-emerald-200', desc: 'Tu factura fue aprobada' },
  RECHAZADA:   { label: 'Rechazada',   icon: XCircle,      cls: 'text-red-700 bg-red-50 border-red-200',  desc: 'Puedes volver a subirla' },
}

function EstadoChip({ estado }) {
  const cfg = ESTADO_CFG[estado] || ESTADO_CFG.SIN_FACTURA
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${cfg.cls}`}>
      <Icon size={11} /> {cfg.label}
    </span>
  )
}

function FacturaCard({ f, onDescargar }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-800 leading-tight">
            Sem {f.semana} · {MESES[f.mes - 1]} {f.anio}
          </p>
          {f.created_at && (
            <p className="text-[11px] text-gray-400 mt-0.5">
              Subida {new Date(f.created_at).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })}
            </p>
          )}
        </div>
        <EstadoChip estado={f.estado} />
      </div>

      {f.monto_neto > 0 && (
        <div className="flex items-center justify-between text-sm border-t border-gray-50 pt-3">
          <span className="text-gray-500">Monto factura</span>
          <span className="font-semibold text-gray-800">{fmt(f.monto_neto)}</span>
        </div>
      )}

      {f.archivo_nombre && (
        <button
          onClick={() => onDescargar(f.id, f.archivo_nombre)}
          className="mt-3 w-full flex items-center justify-center gap-2 text-xs font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-xl px-3 py-2.5 transition-colors"
        >
          <Download size={13} />
          <span className="truncate max-w-[80%]">{f.archivo_nombre}</span>
        </button>
      )}

      {f.nota_admin && (
        <div className="mt-3 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
          <p className="text-[11px] font-semibold text-red-700 uppercase tracking-wide">Observación admin</p>
          <p className="text-xs text-red-700 mt-0.5">{f.nota_admin}</p>
        </div>
      )}
    </div>
  )
}

export default function DriverFacturas() {
  const [semana, setSemana] = useState(1)
  const [mes, setMes]       = useState(now.getMonth() + 1)
  const [anio, setAnio]     = useState(now.getFullYear())
  const [nota, setNota]     = useState('')
  const [facturas, setFacturas] = useState([])
  const [loading, setLoading]   = useState(true)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef()

  const cargar = () => {
    setLoading(true)
    api.get('/portal/driver/facturas')
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
      await api.post('/portal/driver/facturas/upload', form, {
        params: { semana, mes, anio, nota: nota || undefined },
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
      const { data } = await api.get(`/portal/driver/facturas/${facturaId}/descargar`, { responseType: 'blob' })
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

  const facturaActual = facturas.find((f) => f.semana === semana && f.mes === mes && f.anio === anio)
  const puedeSubir    = !facturaActual || facturaActual.estado === 'SIN_FACTURA' || facturaActual.estado === 'RECHAZADA'

  const totales = facturas.reduce((acc, f) => {
    if (f.estado === 'APROBADA') acc.aprobadas += 1
    if (f.estado === 'CARGADA')  acc.revision  += 1
    return acc
  }, { aprobadas: 0, revision: 0 })

  return (
    <div className="max-w-lg mx-auto px-4 py-5 space-y-4">

      {/* Hero */}
      <div className="rounded-2xl text-white p-5 relative overflow-hidden"
           style={{ background: 'linear-gradient(135deg, #312e81 0%, #6366f1 100%)' }}>
        <div className="absolute -top-8 -right-8 w-32 h-32 bg-white/5 rounded-full" />
        <div className="absolute -bottom-4 -left-4 w-20 h-20 bg-white/5 rounded-full" />

        <div className="relative">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-indigo-200 text-xs font-medium uppercase tracking-wider">Mis facturas</p>
              <h1 className="text-lg font-bold leading-tight mt-0.5">Gestión de facturas</h1>
              <p className="text-indigo-200 text-xs mt-0.5">Sube y consulta tus boletas mensuales</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0">
              <FileText size={18} className="text-white" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white/10 rounded-xl p-2.5">
              <p className="text-indigo-200 text-[10px] uppercase tracking-wide leading-none mb-1">Total</p>
              <p className="text-white font-bold text-base leading-tight">{facturas.length}</p>
            </div>
            <div className="bg-white/10 rounded-xl p-2.5">
              <p className="text-indigo-200 text-[10px] uppercase tracking-wide leading-none mb-1">Aprobadas</p>
              <p className="text-white font-bold text-base leading-tight">{totales.aprobadas}</p>
            </div>
            <div className="bg-white/10 rounded-xl p-2.5">
              <p className="text-indigo-200 text-[10px] uppercase tracking-wide leading-none mb-1">En revisión</p>
              <p className="text-white font-bold text-base leading-tight">{totales.revision}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Subir factura */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Upload size={14} className="text-indigo-500" />
          <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Subir factura</h2>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <select value={semana} onChange={(e) => setSemana(+e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-700">
            {[1, 2, 3, 4, 5].map((s) => <option key={s} value={s}>Sem {s}</option>)}
          </select>
          <select value={mes} onChange={(e) => setMes(+e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-700">
            {MESES.map((label, i) => <option key={i + 1} value={i + 1}>{label}</option>)}
          </select>
          <select value={anio} onChange={(e) => setAnio(+e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-700">
            {[now.getFullYear(), now.getFullYear() - 1].map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        <input
          type="text"
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 placeholder-gray-400"
          placeholder="Nota (opcional)"
          value={nota}
          onChange={(e) => setNota(e.target.value)}
        />

        <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
          onChange={handleUpload} />

        {puedeSubir ? (
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold text-sm py-3 rounded-xl transition-colors"
          >
            {uploading
              ? <><RefreshCw size={14} className="animate-spin" /> Subiendo…</>
              : <><Upload size={14} /> {facturaActual?.estado === 'RECHAZADA' ? 'Resubir factura' : 'Subir factura'}</>
            }
          </button>
        ) : (
          <div className={`rounded-xl px-3 py-2.5 border text-xs font-medium text-center ${ESTADO_CFG[facturaActual.estado].cls}`}>
            {ESTADO_CFG[facturaActual.estado].desc}
          </div>
        )}

        {facturaActual && facturaActual.estado !== 'SIN_FACTURA' && (
          <div className={`rounded-xl px-3 py-2.5 border ${ESTADO_CFG[facturaActual.estado].cls}`}>
            <div className="flex items-center justify-between gap-2">
              <EstadoChip estado={facturaActual.estado} />
              {facturaActual.archivo_nombre && (
                <button onClick={() => descargar(facturaActual.id, facturaActual.archivo_nombre)}
                  className="text-xs font-medium hover:underline flex items-center gap-1 truncate max-w-[55%]">
                  <Download size={11} />
                  <span className="truncate">{facturaActual.archivo_nombre}</span>
                </button>
              )}
            </div>
            {facturaActual.nota_admin && (
              <p className="mt-2 text-xs">
                <strong>Observación:</strong> {facturaActual.nota_admin}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Historial */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 px-1 pt-1">
          <FileText size={13} className="text-indigo-600" />
          <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Historial</h2>
        </div>
        {loading ? (
          <div className="flex items-center justify-center h-24">
            <div className="w-6 h-6 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
          </div>
        ) : facturas.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
            <FileText size={32} className="text-gray-200 mx-auto mb-2" />
            <p className="text-sm text-gray-400">No has subido facturas aún.</p>
          </div>
        ) : (
          <div className="space-y-2 pt-1">
            {facturas.map((f) => <FacturaCard key={f.id} f={f} onDescargar={descargar} />)}
          </div>
        )}
      </div>
    </div>
  )
}
