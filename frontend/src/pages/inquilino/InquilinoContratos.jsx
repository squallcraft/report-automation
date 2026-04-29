import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api'
import toast from 'react-hot-toast'
import { FileText, PenLine, CheckCircle, Clock, AlertCircle, Eye, ShieldCheck } from 'lucide-react'

const fmtDate = (s) => {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const ESTADO_META = {
  BORRADOR: { label: 'Pendiente de firma', cls: 'bg-amber-50 text-amber-700',   icon: Clock },
  EMITIDO:  { label: 'Pendiente de firma', cls: 'bg-amber-50 text-amber-700',   icon: Clock },
  FIRMADO:  { label: 'Firmado',            cls: 'bg-emerald-50 text-emerald-700',icon: CheckCircle },
}

function openPdf(blob, filename) {
  const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

function AnexoCard({ anexo, tieneFirma, signing, onVer, onFirmar }) {
  const meta = ESTADO_META[anexo.estado] || ESTADO_META.BORRADOR
  const Icon = meta.icon
  const pendienteFirma = anexo.requiere_firma_inquilino && anexo.estado !== 'FIRMADO'

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Color bar */}
      <div className={`h-1 ${anexo.estado === 'FIRMADO' ? 'bg-emerald-400' : 'bg-amber-400'}`} />

      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
              anexo.estado === 'FIRMADO' ? 'bg-emerald-50' : 'bg-amber-50'
            }`}>
              <FileText size={18} className={anexo.estado === 'FIRMADO' ? 'text-emerald-600' : 'text-amber-600'} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 leading-tight">{anexo.titulo}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {anexo.tipo === 'RESERVA' ? 'Anexo de Reserva' : 'Contrato Principal'}
              </p>
              {anexo.firmado_at && (
                <p className="text-[11px] text-emerald-600 mt-1 font-medium">
                  ✓ Firmado el {fmtDate(anexo.firmado_at)}
                </p>
              )}
            </div>
          </div>
          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold flex-shrink-0 ${meta.cls}`}>
            <Icon size={11} />
            {meta.label}
          </span>
        </div>

        {anexo.tipo === 'RESERVA' && anexo.estado !== 'FIRMADO' && (
          <div className="mt-3 flex items-start gap-2 p-3 bg-amber-50 rounded-xl">
            <AlertCircle size={14} className="text-amber-500 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-amber-700">
              {anexo.comprobante_reserva_path && !anexo.comprobante_reserva_aprobado
                ? 'Comprobante de reserva en revisión por el administrador'
                : 'Debes subir el comprobante de la transferencia de reserva'}
            </p>
          </div>
        )}

        <div className="flex gap-2 mt-4">
          <button onClick={onVer}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-xl border border-gray-200 transition-colors">
            <Eye size={13} /> Ver documento
          </button>
          {pendienteFirma && (
            <button onClick={onFirmar} disabled={signing || !tieneFirma}
              title={!tieneFirma ? 'Registra tu firma en "Mi Firma" primero' : ''}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-white rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: !tieneFirma ? undefined : 'linear-gradient(135deg,#1e3a5f,#1d4ed8)' }}>
              <PenLine size={13} />
              {signing ? 'Firmando…' : 'Firmar'}
            </button>
          )}
        </div>

        {pendienteFirma && !tieneFirma && (
          <p className="text-[11px] text-amber-600 mt-2 text-center">
            Ve a <strong>Mi Firma</strong> para registrar tu firma antes de firmar
          </p>
        )}
      </div>
    </div>
  )
}

export default function InquilinoContratos() {
  const navigate = useNavigate()
  const [contratos, setContratos] = useState([])
  const [perfil, setPerfil] = useState(null)
  const [loading, setLoading] = useState(true)
  const [signing, setSigning] = useState(null)

  const cargar = async () => {
    setLoading(true)
    try {
      const [ct, pf] = await Promise.all([
        api.get('/inquilinos/portal/contratos'),
        api.get('/inquilinos/portal/perfil'),
      ])
      setContratos(ct.data)
      setPerfil(pf.data)
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al cargar contratos')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { cargar() }, [])

  const verPdf = async (c) => {
    try {
      const resp = await api.get(`/inquilinos/portal/contratos/${c.id}/pdf`, { responseType: 'blob' })
      openPdf(resp.data, c.titulo || 'contrato')
    } catch {
      toast.error('Error al abrir el documento')
    }
  }

  const firmar = async (c) => {
    if (!perfil?.firma_base64) {
      toast.error('Primero registra tu firma en "Mi Firma"')
      navigate('/inquilino/firma')
      return
    }
    setSigning(c.id)
    try {
      await api.post(`/inquilinos/portal/contratos/${c.id}/firmar`)
      toast.success('Documento firmado correctamente')
      await cargar()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al firmar el documento')
    } finally {
      setSigning(null)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full" />
    </div>
  )

  const tieneFirma = !!perfil?.firma_base64
  const hayPendientes = contratos.some(c => c.estado !== 'FIRMADO' && c.requiere_firma_inquilino)

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
            <h1 className="text-xl font-bold mt-0.5">Contratos</h1>
            <p className="text-blue-200 text-xs mt-0.5">
              {contratos.length === 0
                ? 'Sin documentos emitidos aún'
                : `${contratos.length} documento${contratos.length > 1 ? 's' : ''} · ${contratos.filter(c => c.estado === 'FIRMADO').length} firmado${contratos.filter(c => c.estado === 'FIRMADO').length !== 1 ? 's' : ''}`}
            </p>
          </div>
          <div className="w-11 h-11 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0">
            <ShieldCheck size={22} className="text-white" />
          </div>
        </div>
      </div>

      {/* Aviso firma pendiente */}
      {!tieneFirma && hayPendientes && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-2xl">
          <AlertCircle size={18} className="text-amber-500 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-amber-800">
            Tienes documentos pendientes de firma.{' '}
            <button onClick={() => navigate('/inquilino/firma')}
              className="font-semibold underline hover:no-underline">
              Registra tu firma electrónica
            </button>{' '}para poder firmarlos.
          </div>
        </div>
      )}

      {contratos.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center">
          <div className="w-14 h-14 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <FileText size={28} className="text-gray-300" />
          </div>
          <p className="text-gray-600 font-medium">Sin contratos aún</p>
          <p className="text-sm text-gray-400 mt-1">Tu ejecutivo emitirá los documentos pronto</p>
        </div>
      ) : (
        <div className="space-y-3">
          {contratos.map(c => (
            <AnexoCard
              key={c.id}
              anexo={c}
              tieneFirma={tieneFirma}
              signing={signing === c.id}
              onVer={() => verPdf(c)}
              onFirmar={() => firmar(c)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
