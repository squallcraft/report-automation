import { useState, useEffect, useRef } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import {
  CreditCard, CheckCircle, Clock, AlertCircle, FileText,
  Upload, ChevronRight, ChevronLeft, RefreshCw, XCircle, Receipt, ShieldCheck,
} from 'lucide-react'

const MESES = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const fmt = (n) => '$' + (n || 0).toLocaleString('es-CL')
const fmtDate = (s) => s ? new Date(s).toLocaleDateString('es-CL', { day:'2-digit', month:'2-digit', year:'numeric' }) : '—'

const ESTADO_META = {
  PENDIENTE: { label: 'Pendiente', cls: 'bg-amber-50 text-amber-700 border-amber-200',   bar: 'bg-amber-400',   icon: Clock },
  VENCIDO:   { label: 'Vencido',   cls: 'bg-red-50 text-red-700 border-red-200',         bar: 'bg-red-400',     icon: AlertCircle },
  PAGADO:    { label: 'Pagado',    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', bar: 'bg-emerald-400', icon: CheckCircle },
}

const PASOS = [
  { num: 1, label: 'Cobro' },
  { num: 2, label: 'Comprobante' },
]

function PasoIndicador({ paso }) {
  return (
    <div className="flex items-center justify-between mb-5">
      {PASOS.map((p, idx) => (
        <div key={p.num} className="flex items-center flex-1">
          <div className="flex flex-col items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
              paso > p.num  ? 'bg-emerald-500 text-white'
              : paso === p.num ? 'bg-blue-900 text-white shadow-md shadow-blue-200'
              : 'bg-gray-100 text-gray-400'
            }`}>
              {paso > p.num ? <CheckCircle size={16} /> : p.num}
            </div>
            <span className={`text-[10px] mt-1 font-medium ${
              paso === p.num ? 'text-blue-900' : paso > p.num ? 'text-emerald-600' : 'text-gray-400'
            }`}>{p.label}</span>
          </div>
          {idx < PASOS.length - 1 && (
            <div className={`flex-1 h-0.5 mx-2 mb-4 ${paso > p.num ? 'bg-emerald-400' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

// ── Tarjeta especial de Reserva ───────────────────────────────────────────────
function ReservaCard({ reserva, onRecargar }) {
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef()

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

  const handleSubir = async () => {
    if (!file || !reserva.anexo_id) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('archivo', file)
      await api.post(`/inquilinos/portal/contratos/${reserva.anexo_id}/subir-comprobante-reserva`, fd)
      toast.success('Comprobante de reserva enviado')
      setFile(null)
      onRecargar()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al subir el comprobante')
    } finally {
      setUploading(false)
    }
  }

  if (reserva.aprobado) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="h-1 bg-emerald-400" />
        <div className="p-4 sm:p-5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
            <ShieldCheck size={18} className="text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-900">Reserva</p>
            <p className="text-xs text-gray-400 mt-0.5">Pago confirmado por E-Courier</p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-base font-bold text-gray-900">{fmt(reserva.total)}</p>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-emerald-50 text-emerald-700 border-emerald-200">
              <CheckCircle size={11} /> Aprobado
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
      <div className="h-1 bg-amber-400" />
      <div className="p-4 sm:p-5 space-y-3">

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
              <ShieldCheck size={18} className="text-amber-500" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">Reserva de Garantía</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Neto {fmt(reserva.monto_neto)} · IVA {fmt(reserva.iva)}
              </p>
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-base font-bold text-gray-900">{fmt(reserva.total)}</p>
            {reserva.comprobante_path ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-amber-50 text-amber-700 border-amber-200">
                <Clock size={11} /> En revisión
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-amber-50 text-amber-700 border-amber-200">
                <Clock size={11} /> Pendiente
              </span>
            )}
          </div>
        </div>

        {/* Aviso */}
        {reserva.comprobante_path ? (
          <div className="flex items-start gap-2 p-3 bg-amber-50 rounded-xl">
            <Clock size={14} className="text-amber-500 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-amber-800">
              <p className="font-medium">Comprobante recibido — pendiente de revisión</p>
              <p className="text-amber-600 mt-0.5">El equipo de E-Courier confirmará el pago pronto.</p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2 p-3 bg-amber-50 rounded-xl">
            <AlertCircle size={14} className="text-amber-500 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-amber-800">
              Debes transferir {fmt(reserva.total)} a la cuenta de E-Courier y subir el comprobante para continuar.
            </p>
          </div>
        )}

        {/* Upload */}
        <div className="pt-1 border-t border-gray-50">
          <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" onChange={handleFile} />
          {file ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center flex-shrink-0">
                  <FileText size={14} className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-emerald-800 truncate">{file.name}</p>
                  <p className="text-[10px] text-emerald-600">{(file.size/1024).toFixed(0)} KB</p>
                </div>
                <button onClick={() => setFile(null)} className="text-emerald-400 hover:text-red-500 p-1 flex-shrink-0">
                  <XCircle size={16} />
                </button>
              </div>
              <button onClick={handleSubir} disabled={uploading}
                className="w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold text-white rounded-xl transition-colors disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#1e3a5f,#1d4ed8)' }}>
                {uploading
                  ? <><RefreshCw size={14} className="animate-spin" /> Subiendo…</>
                  : <><CheckCircle size={14} /> Confirmar y enviar</>}
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => inputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-xl border-2 border-dashed transition-colors"
              style={reserva.comprobante_path
                ? { borderColor: '#d97706', color: '#92400e', background: '#fffbeb' }
                : { borderColor: '#1d4ed8', color: '#1e3a5f', background: '#eff6ff' }}>
              <Upload size={14} />
              {reserva.comprobante_path ? 'Reemplazar comprobante' : 'Subir comprobante de reserva'}
            </button>
          )}
        </div>

      </div>
    </div>
  )
}

// ── Wizard comprobante mensual ─────────────────────────────────────────────────
function Paso1Cobro({ cobros, cobroId, onChange, onNext }) {
  const pendientes = cobros.filter(c => c.estado !== 'PAGADO')
  return (
    <div className="space-y-4">
      <p className="text-gray-500 text-sm text-center">¿A qué cobro corresponde este pago?</p>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {pendientes.length === 0 ? (
          <div className="text-center py-6 text-sm text-gray-400">No hay cobros pendientes</div>
        ) : pendientes.map(c => {
          const selected = cobroId === c.id
          return (
            <button key={c.id} type="button" onClick={() => onChange(c.id)}
              className={`w-full text-left flex items-center gap-4 p-4 rounded-2xl border-2 transition-all ${
                selected ? 'border-blue-500 bg-blue-50 shadow-sm' : 'border-gray-200 bg-white hover:border-blue-300'
              }`}>
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
                selected ? 'bg-blue-900 text-white' : 'bg-gray-100 text-gray-400'
              }`}>
                <CreditCard size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold ${selected ? 'text-blue-800' : 'text-gray-800'}`}>
                  {MESES[c.mes]} {c.anio} — {fmt(c.total)}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {c.estado === 'VENCIDO' ? '⚠ Vencido · ' : ''}Vence {fmtDate(c.fecha_vencimiento)}
                </p>
              </div>
              {selected && <CheckCircle size={20} className="text-blue-600 flex-shrink-0" />}
            </button>
          )
        })}
      </div>
      <button onClick={onNext} disabled={!cobroId}
        className="w-full flex items-center justify-center gap-2 bg-blue-900 hover:bg-blue-800 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold text-sm py-3.5 rounded-xl transition-colors">
        Continuar <ChevronRight size={16} />
      </button>
    </div>
  )
}

function Paso2Archivo({ cobro, onBack, onSuccess }) {
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef()

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
      await api.post(`/inquilinos/portal/cobros/${cobro.id}/subir-comprobante`, form)
      toast.success('Comprobante subido correctamente')
      onSuccess()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error subiendo el comprobante')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-gray-500 text-sm text-center">Sube el comprobante de tu transferencia</p>

      <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 space-y-2">
        <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider">Cobro seleccionado</p>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <p className="text-gray-400 text-[11px]">Período</p>
            <p className="font-semibold text-gray-800">{MESES[cobro.mes]} {cobro.anio}</p>
          </div>
          <div>
            <p className="text-gray-400 text-[11px]">Total</p>
            <p className="font-semibold text-gray-800">{fmt(cobro.total)}</p>
          </div>
          <div>
            <p className="text-gray-400 text-[11px]">Neto</p>
            <p className="font-semibold text-gray-800">{fmt(cobro.monto_neto)}</p>
          </div>
          <div>
            <p className="text-gray-400 text-[11px]">IVA</p>
            <p className="font-semibold text-gray-800">{fmt(cobro.iva)}</p>
          </div>
        </div>
      </div>

      <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" onChange={handleFile} />

      {file ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <FileText size={18} className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-emerald-800 truncate">{file.name}</p>
            <p className="text-xs text-emerald-600">{(file.size / 1024).toFixed(0)} KB · listo para enviar</p>
          </div>
          <button onClick={() => setFile(null)} className="text-emerald-500 hover:text-emerald-700 p-1 flex-shrink-0">
            <XCircle size={18} />
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()}
          className="w-full border-2 border-dashed border-blue-300 bg-blue-50 hover:bg-blue-100 rounded-2xl p-6 flex flex-col items-center gap-2 transition-colors">
          <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
            <Upload size={22} className="text-blue-500" />
          </div>
          <p className="text-sm font-semibold text-blue-700">Toca aquí para seleccionar</p>
          <p className="text-xs text-blue-400">PDF, JPG o PNG · máx. 10 MB</p>
        </button>
      )}

      <div className="flex gap-2">
        <button onClick={onBack} disabled={uploading}
          className="flex items-center justify-center border border-gray-200 text-gray-600 font-semibold text-sm py-3.5 px-5 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50">
          <ChevronLeft size={16} />
        </button>
        <button onClick={handleConfirm} disabled={!file || uploading}
          className="flex-1 flex items-center justify-center gap-2 bg-blue-900 hover:bg-blue-800 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold text-sm py-3.5 rounded-xl transition-colors">
          {uploading
            ? <><RefreshCw size={14} className="animate-spin" /> Subiendo…</>
            : <><CheckCircle size={14} /> Confirmar y enviar</>}
        </button>
      </div>
    </div>
  )
}

function CobroCard({ cobro, onSubir }) {
  const meta = ESTADO_META[cobro.estado] || ESTADO_META.PENDIENTE
  const Icon = meta.icon
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className={`h-1 ${meta.bar}`} />
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
              cobro.estado === 'PAGADO' ? 'bg-emerald-50' : cobro.estado === 'VENCIDO' ? 'bg-red-50' : 'bg-amber-50'
            }`}>
              <CreditCard size={17} className={
                cobro.estado === 'PAGADO' ? 'text-emerald-600' : cobro.estado === 'VENCIDO' ? 'text-red-500' : 'text-amber-500'
              } />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-gray-900">{MESES[cobro.mes]} {cobro.anio}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {cobro.variable_nombre}: {cobro.variable_valor?.toLocaleString('es-CL')}
                {cobro.folio_haulmer && ` · Folio ${cobro.folio_haulmer}`}
              </p>
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-base font-bold text-gray-900">{fmt(cobro.total)}</p>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${meta.cls}`}>
              <Icon size={11} /> {meta.label}
            </span>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-400">
          <span>Neto {fmt(cobro.monto_neto)}</span>
          <span>·</span>
          <span>IVA {fmt(cobro.iva)}</span>
          {cobro.fecha_vencimiento && cobro.estado !== 'PAGADO' && (
            <>
              <span>·</span>
              <span className={cobro.estado === 'VENCIDO' ? 'text-red-500 font-medium' : ''}>
                Vence {fmtDate(cobro.fecha_vencimiento)}
              </span>
            </>
          )}
        </div>

        {(cobro.reserva_descontada || cobro.descuento_aplicado > 0) && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {cobro.reserva_descontada && (
              <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[11px] font-medium rounded-full">Reserva descontada</span>
            )}
            {cobro.descuento_aplicado > 0 && (
              <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-[11px] font-medium rounded-full">Descuento {fmt(cobro.descuento_aplicado)}</span>
            )}
          </div>
        )}

        {cobro.estado !== 'PAGADO' && (
          <div className="mt-3 pt-3 border-t border-gray-50">
            {cobro.comprobante_pago_path ? (
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs text-amber-600 font-medium">
                  <Clock size={12} /> Comprobante en revisión
                </span>
                <button onClick={onSubir} className="text-xs text-gray-400 hover:text-gray-600 underline">Reemplazar</button>
              </div>
            ) : (
              <button onClick={onSubir}
                className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-white rounded-xl transition-colors"
                style={{ background: 'linear-gradient(135deg,#1e3a5f,#1d4ed8)' }}>
                <Upload size={14} /> Subir comprobante de pago
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function InquilinoCobros() {
  const [cobros, setCobros] = useState([])
  const [reserva, setReserva] = useState(null)
  const [loading, setLoading] = useState(true)
  const [wizard, setWizard] = useState(false)
  const [paso, setPaso] = useState(1)
  const [cobroId, setCobroId] = useState(null)

  const cargar = async () => {
    setLoading(true)
    try {
      const [rc, rr] = await Promise.all([
        api.get('/inquilinos/portal/cobros'),
        api.get('/inquilinos/portal/reserva'),
      ])
      setCobros(rc.data)
      setReserva(rr.data?.tiene_reserva ? rr.data : null)
    } catch {
      // silencioso
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { cargar() }, [])

  const abrirWizard = (id = null) => {
    setCobroId(id)
    setPaso(id ? 2 : 1)
    setWizard(true)
  }

  const cerrarWizard = () => { setWizard(false); setPaso(1); setCobroId(null) }
  const onSuccess = () => { cerrarWizard(); cargar() }

  const cobroSeleccionado = cobros.find(c => c.id === cobroId)
  const pendientes = cobros.filter(c => c.estado !== 'PAGADO')
  const totalPendiente = pendientes.reduce((s, c) => s + (c.total || 0), 0)

  const reservaPendiente = reserva && !reserva.aprobado
  const totalConReserva = totalPendiente + (reservaPendiente ? (reserva?.total || 0) : 0)
  const cantPendientes = pendientes.length + (reservaPendiente ? 1 : 0)

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full" />
    </div>
  )

  return (
    <div className="max-w-2xl mx-auto space-y-4">

      {/* Hero */}
      <div className="rounded-2xl text-white p-5 relative overflow-hidden"
           style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #1d4ed8 100%)' }}>
        <div className="absolute -top-6 -right-6 w-28 h-28 bg-white/5 rounded-full" />
        <div className="absolute -bottom-4 -left-4 w-20 h-20 bg-white/5 rounded-full" />
        <div className="relative flex items-center justify-between">
          <div>
            <p className="text-blue-200 text-xs font-medium uppercase tracking-wider">Portal</p>
            <h1 className="text-xl font-bold mt-0.5">Cobros y Facturas</h1>
            <p className="text-blue-200 text-xs mt-1">
              {cantPendientes > 0
                ? `${cantPendientes} pendiente${cantPendientes > 1 ? 's' : ''} · ${fmt(totalConReserva)}`
                : cobros.length > 0 ? `${cobros.length} cobro${cobros.length > 1 ? 's' : ''} · Al día`
                : 'Sin cobros aún'}
            </p>
          </div>
          <div className="w-11 h-11 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0">
            <Receipt size={22} className="text-white" />
          </div>
        </div>
      </div>

      {/* Tarjeta Reserva (siempre visible si tiene reserva) */}
      {reserva && <ReservaCard reserva={reserva} onRecargar={cargar} />}

      {/* Botón subir comprobante mensual */}
      {!wizard && pendientes.length > 0 && (
        <button onClick={() => abrirWizard()}
          className="w-full flex items-center justify-center gap-2 text-white font-semibold text-sm py-4 rounded-2xl shadow-md transition-colors"
          style={{ background: 'linear-gradient(135deg,#1e3a5f,#1d4ed8)', boxShadow: '0 4px 14px rgba(29,78,216,.35)' }}>
          <Upload size={16} /> Subir comprobante de pago mensual
        </button>
      )}

      {/* Wizard cobro mensual */}
      {wizard && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-gray-700">Subir comprobante</h2>
            <button onClick={cerrarWizard} className="text-xs text-gray-400 hover:text-gray-600">Cancelar</button>
          </div>
          <PasoIndicador paso={paso} />
          {paso === 1 && (
            <Paso1Cobro cobros={cobros} cobroId={cobroId}
              onChange={setCobroId} onNext={() => setPaso(2)} />
          )}
          {paso === 2 && cobroSeleccionado && (
            <Paso2Archivo cobro={cobroSeleccionado}
              onBack={() => { if (cobros.filter(c => c.estado !== 'PAGADO').length > 1) setPaso(1); else cerrarWizard() }}
              onSuccess={onSuccess} />
          )}
        </div>
      )}

      {/* Historial cobros mensuales */}
      {cobros.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-1 pt-1">Cobros mensuales</p>
          <div className="space-y-2 pt-1">
            {cobros.map(c => (
              <CobroCard key={c.id} cobro={c} onSubir={() => abrirWizard(c.id)} />
            ))}
          </div>
        </div>
      )}

      {cobros.length === 0 && !reserva && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center">
          <div className="w-14 h-14 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <CreditCard size={28} className="text-gray-300" />
          </div>
          <p className="text-gray-600 font-medium">Sin cobros registrados</p>
          <p className="text-sm text-gray-400 mt-1">Aquí aparecerán tus cobros mensuales</p>
        </div>
      )}
    </div>
  )
}
