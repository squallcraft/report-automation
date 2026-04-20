import { useState, useEffect, useRef } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import {
  Upload, FileText, CheckCircle, XCircle, Clock, AlertCircle,
  Download, RefreshCw, ChevronRight, ChevronLeft, Receipt, FileCheck,
} from 'lucide-react'
import { fmt, MESES } from '../../utils/format'

const now = new Date()

// ── Estado chips ──────────────────────────────────────────────────────────────

const ESTADO_CFG = {
  SIN_FACTURA: { label: 'Sin documento', icon: Clock,        cls: 'text-gray-600  bg-gray-50  border-gray-200' },
  CARGADA:     { label: 'En revisión',   icon: AlertCircle,  cls: 'text-blue-700  bg-blue-50  border-blue-200' },
  APROBADA:    { label: 'Aprobado',      icon: CheckCircle,  cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  RECHAZADA:   { label: 'Rechazado',     icon: XCircle,      cls: 'text-red-700   bg-red-50   border-red-200' },
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

// ── Indicador de pasos ────────────────────────────────────────────────────────

const PASOS = [
  { num: 1, label: 'Tipo de documento' },
  { num: 2, label: 'Período' },
  { num: 3, label: 'Archivo' },
]

function PasoIndicador({ paso }) {
  return (
    <div className="flex items-center justify-between mb-5">
      {PASOS.map((p, idx) => (
        <div key={p.num} className="flex items-center flex-1">
          <div className="flex flex-col items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
              paso > p.num
                ? 'bg-emerald-500 text-white'
                : paso === p.num
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200'
                  : 'bg-gray-100 text-gray-400'
            }`}>
              {paso > p.num ? <CheckCircle size={16} /> : p.num}
            </div>
            <span className={`text-[10px] mt-1 font-medium text-center leading-tight ${
              paso === p.num ? 'text-indigo-600' : paso > p.num ? 'text-emerald-600' : 'text-gray-400'
            }`}>{p.label}</span>
          </div>
          {idx < PASOS.length - 1 && (
            <div className={`flex-1 h-0.5 mx-2 mb-4 transition-colors ${paso > p.num ? 'bg-emerald-400' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

// ── Paso 1: Tipo de documento ─────────────────────────────────────────────────

function Paso1TipoDoc({ tipoDoc, onChange, onNext }) {
  const TIPOS = [
    {
      id: 'BOLETA',
      label: 'Boleta',
      desc: 'Emito boleta de honorarios por mis servicios',
      icon: Receipt,
    },
    {
      id: 'FACTURA',
      label: 'Factura',
      desc: 'Emito factura a través de mi empresa',
      icon: FileCheck,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="text-center mb-2">
        <p className="text-gray-500 text-sm">¿Qué tipo de documento emites para cobrar tus servicios?</p>
      </div>

      <div className="space-y-3">
        {TIPOS.map(({ id, label, desc, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={`w-full text-left flex items-center gap-4 p-4 rounded-2xl border-2 transition-all ${
              tipoDoc === id
                ? 'border-indigo-500 bg-indigo-50 shadow-sm'
                : 'border-gray-200 bg-white hover:border-indigo-300'
            }`}
          >
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
              tipoDoc === id ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-400'
            }`}>
              <Icon size={22} />
            </div>
            <div className="min-w-0 flex-1">
              <p className={`font-semibold ${tipoDoc === id ? 'text-indigo-700' : 'text-gray-800'}`}>{label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
            </div>
            {tipoDoc === id && <CheckCircle size={20} className="text-indigo-600 flex-shrink-0" />}
          </button>
        ))}
      </div>

      <button
        onClick={onNext}
        disabled={!tipoDoc}
        className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold text-sm py-3.5 rounded-xl transition-colors mt-2"
      >
        Continuar <ChevronRight size={16} />
      </button>
    </div>
  )
}

// ── Paso 2: Período ───────────────────────────────────────────────────────────

function Paso2Periodo({ semana, mes, anio, onChange, onNext, onBack }) {
  const [s, m, a] = [semana, mes, anio]

  return (
    <div className="space-y-4">
      <div className="text-center mb-2">
        <p className="text-gray-500 text-sm">¿A qué semana y mes corresponde este documento?</p>
      </div>

      {/* Semana */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Semana</label>
        <div className="grid grid-cols-5 gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onChange({ semana: n, mes: m, anio: a })}
              className={`py-3 rounded-xl text-sm font-bold transition-all ${
                s === n
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200'
                  : 'bg-gray-100 text-gray-600 hover:bg-indigo-100 hover:text-indigo-700'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 mt-1.5 text-center">Selecciona el número de semana del mes</p>
      </div>

      {/* Mes */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Mes</label>
        <div className="grid grid-cols-4 gap-1.5">
          {MESES.map((label, i) => (
            <button
              key={i + 1}
              type="button"
              onClick={() => onChange({ semana: s, mes: i + 1, anio: a })}
              className={`py-2 rounded-xl text-xs font-semibold transition-all ${
                m === i + 1
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200'
                  : 'bg-gray-100 text-gray-600 hover:bg-indigo-100 hover:text-indigo-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Año */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Año</label>
        <div className="grid grid-cols-2 gap-2">
          {[now.getFullYear(), now.getFullYear() - 1].map((yr) => (
            <button
              key={yr}
              type="button"
              onClick={() => onChange({ semana: s, mes: m, anio: yr })}
              className={`py-3 rounded-xl text-sm font-bold transition-all ${
                a === yr
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200'
                  : 'bg-gray-100 text-gray-600 hover:bg-indigo-100 hover:text-indigo-700'
              }`}
            >
              {yr}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={onBack}
          className="flex items-center justify-center gap-1 border border-gray-200 text-gray-600 font-semibold text-sm py-3.5 px-5 rounded-xl hover:bg-gray-50 transition-colors"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          onClick={onNext}
          className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm py-3.5 rounded-xl transition-colors"
        >
          Continuar <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}

// ── Paso 3: Archivo + Confirmar ───────────────────────────────────────────────

function Paso3Archivo({ tipoDoc, semana, mes, anio, onBack, onSuccess, facturaActual }) {
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef()

  const TIPO_LABELS = { BOLETA: 'Boleta', FACTURA: 'Factura' }
  const esResubida = facturaActual?.estado === 'RECHAZADA'

  const handleFile = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    e.target.value = ''
    const ext = f.name.split('.').pop()?.toLowerCase()
    if (!['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
      toast.error('Formato no permitido. Usa PDF, JPG o PNG')
      return
    }
    setFile(f)
  }

  const handleConfirm = async () => {
    if (!file) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('archivo', file)
      await api.post('/portal/driver/facturas/upload', form, {
        params: { semana, mes, anio, tipo_documento: tipoDoc },
      })
      toast.success(`${TIPO_LABELS[tipoDoc]} subida correctamente`)
      onSuccess()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error subiendo el documento')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-center mb-2">
        <p className="text-gray-500 text-sm">
          {esResubida ? 'Vuelve a subir tu documento corregido' : 'Selecciona el archivo de tu documento'}
        </p>
      </div>

      {/* Resumen del documento */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 space-y-2">
        <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">Resumen</p>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <p className="text-gray-400 text-[11px]">Tipo</p>
            <p className="font-semibold text-gray-800">{TIPO_LABELS[tipoDoc]}</p>
          </div>
          <div>
            <p className="text-gray-400 text-[11px]">Semana</p>
            <p className="font-semibold text-gray-800">Semana {semana}</p>
          </div>
          <div>
            <p className="text-gray-400 text-[11px]">Mes</p>
            <p className="font-semibold text-gray-800">{MESES[mes - 1]}</p>
          </div>
          <div>
            <p className="text-gray-400 text-[11px]">Año</p>
            <p className="font-semibold text-gray-800">{anio}</p>
          </div>
        </div>
      </div>

      {/* Área de selección de archivo */}
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp"
        className="hidden"
        onChange={handleFile}
      />

      {file ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <FileText size={18} className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-emerald-800 truncate">{file.name}</p>
            <p className="text-xs text-emerald-600">{(file.size / 1024).toFixed(0)} KB · listo para subir</p>
          </div>
          <button
            onClick={() => setFile(null)}
            className="text-emerald-500 hover:text-emerald-700 p-1 rounded-full flex-shrink-0"
          >
            <XCircle size={18} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full border-2 border-dashed border-indigo-300 bg-indigo-50 hover:bg-indigo-100 rounded-2xl p-6 flex flex-col items-center gap-2 transition-colors"
        >
          <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
            <Upload size={22} className="text-indigo-500" />
          </div>
          <p className="text-sm font-semibold text-indigo-700">Toca aquí para seleccionar</p>
          <p className="text-xs text-indigo-400">PDF, JPG o PNG · máx. 10 MB</p>
        </button>
      )}

      <div className="flex gap-2">
        <button
          onClick={onBack}
          disabled={uploading}
          className="flex items-center justify-center gap-1 border border-gray-200 text-gray-600 font-semibold text-sm py-3.5 px-5 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          onClick={handleConfirm}
          disabled={!file || uploading}
          className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold text-sm py-3.5 rounded-xl transition-colors"
        >
          {uploading
            ? <><RefreshCw size={14} className="animate-spin" /> Subiendo…</>
            : <><CheckCircle size={14} /> {esResubida ? 'Resubir documento' : 'Confirmar y enviar'}</>
          }
        </button>
      </div>
    </div>
  )
}

// ── Card historial ────────────────────────────────────────────────────────────

const TIPO_LABEL = { BOLETA: 'Boleta', FACTURA: 'Factura' }

function FacturaCard({ f, onDescargar }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-800 leading-tight">
              Sem {f.semana} · {MESES[f.mes - 1]} {f.anio}
            </p>
            {f.tipo_documento && (
              <span className="text-[10px] font-medium bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                {TIPO_LABEL[f.tipo_documento] || f.tipo_documento}
              </span>
            )}
          </div>
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
          <span className="text-gray-500">Monto</span>
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

// ── Página principal ──────────────────────────────────────────────────────────

export default function DriverFacturas() {
  const [facturas, setFacturas]   = useState([])
  const [loading, setLoading]     = useState(true)

  // Flujo de carga
  const [mostrarWizard, setMostrarWizard] = useState(false)
  const [paso, setPaso]           = useState(1)
  const [tipoDoc, setTipoDoc]     = useState('')
  const [periodo, setPeriodo]     = useState({
    semana: 1,
    mes: now.getMonth() + 1,
    anio: now.getFullYear(),
  })

  const cargar = () => {
    setLoading(true)
    api.get('/portal/driver/facturas')
      .then(({ data }) => setFacturas(data))
      .catch(() => setFacturas([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { cargar() }, [])

  const descargar = async (facturaId, nombre) => {
    try {
      const { data } = await api.get(`/portal/driver/facturas/${facturaId}/descargar`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([data]))
      const a = document.createElement('a')
      a.href = url; a.download = nombre || 'factura'; a.click()
      URL.revokeObjectURL(url)
    } catch { toast.error('Error descargando documento') }
  }

  const abrirWizard = (semanaInic, mesInic, anioInic) => {
    setTipoDoc('')
    setPaso(1)
    setPeriodo({ semana: semanaInic || 1, mes: mesInic || now.getMonth() + 1, anio: anioInic || now.getFullYear() })
    setMostrarWizard(true)
  }

  const cerrarWizard = () => { setMostrarWizard(false); setPaso(1) }

  const onUploadSuccess = () => { cerrarWizard(); cargar() }

  const facturaActualWizard = facturas.find(
    (f) => f.semana === periodo.semana && f.mes === periodo.mes && f.anio === periodo.anio
  )

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
              <p className="text-indigo-200 text-xs font-medium uppercase tracking-wider">Mis documentos</p>
              <h1 className="text-lg font-bold leading-tight mt-0.5">Gestión de cobros</h1>
              <p className="text-indigo-200 text-xs mt-0.5">Sube tus boletas y facturas semanales</p>
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
              <p className="text-indigo-200 text-[10px] uppercase tracking-wide leading-none mb-1">Aprobados</p>
              <p className="text-white font-bold text-base leading-tight">{totales.aprobadas}</p>
            </div>
            <div className="bg-white/10 rounded-xl p-2.5">
              <p className="text-indigo-200 text-[10px] uppercase tracking-wide leading-none mb-1">En revisión</p>
              <p className="text-white font-bold text-base leading-tight">{totales.revision}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Botón abrir wizard */}
      {!mostrarWizard && (
        <button
          onClick={() => abrirWizard()}
          className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm py-4 rounded-2xl shadow-md shadow-indigo-200 transition-colors"
        >
          <Upload size={16} /> Subir documento
        </button>
      )}

      {/* Wizard paso a paso */}
      {mostrarWizard && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-gray-700">Subir documento</h2>
            <button onClick={cerrarWizard} className="text-gray-400 hover:text-gray-600 text-xs">
              Cancelar
            </button>
          </div>

          <PasoIndicador paso={paso} />

          {paso === 1 && (
            <Paso1TipoDoc
              tipoDoc={tipoDoc}
              onChange={setTipoDoc}
              onNext={() => setPaso(2)}
            />
          )}

          {paso === 2 && (
            <Paso2Periodo
              {...periodo}
              onChange={setPeriodo}
              onNext={() => setPaso(3)}
              onBack={() => setPaso(1)}
            />
          )}

          {paso === 3 && (
            <Paso3Archivo
              tipoDoc={tipoDoc}
              semana={periodo.semana}
              mes={periodo.mes}
              anio={periodo.anio}
              onBack={() => setPaso(2)}
              onSuccess={onUploadSuccess}
              facturaActual={facturaActualWizard}
            />
          )}
        </div>
      )}

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
            <p className="text-sm text-gray-400">No has subido documentos aún.</p>
          </div>
        ) : (
          <div className="space-y-2 pt-1">
            {facturas.map((f) => (
              <div key={f.id}>
                <FacturaCard f={f} onDescargar={descargar} />
                {(f.estado === 'SIN_FACTURA' || f.estado === 'RECHAZADA') && (
                  <button
                    onClick={() => abrirWizard(f.semana, f.mes, f.anio)}
                    className="w-full mt-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 py-2 flex items-center justify-center gap-1"
                  >
                    <Upload size={12} />
                    {f.estado === 'RECHAZADA' ? 'Resubir documento' : 'Subir documento para esta semana'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
