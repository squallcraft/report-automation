import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api'
import toast from 'react-hot-toast'
import { FileText, PenLine, CheckCircle, Clock, AlertCircle, Download, ShieldCheck } from 'lucide-react'

const fmtDate = (s) => {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const ESTADO_LABELS = {
  BORRADOR: { label: 'Pendiente de firma', color: 'bg-amber-100 text-amber-700', icon: Clock },
  EMITIDO:  { label: 'Pendiente de firma', color: 'bg-amber-100 text-amber-700', icon: Clock },
  FIRMADO:  { label: 'Firmado',            color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle },
}

function AnexoCard({ anexo, tieneFirma, signing, onVer, onFirmar }) {
  const meta = ESTADO_LABELS[anexo.estado] || { label: anexo.estado, color: 'bg-gray-100 text-gray-700', icon: FileText }
  const Icon = meta.icon
  const puedeF = anexo.requiere_firma_inquilino && anexo.estado !== 'FIRMADO'

  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 truncate">{anexo.titulo}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {anexo.tipo === 'RESERVA' ? 'Anexo de Reserva' : 'Contrato Principal'}
          </p>
          {anexo.firmado_at && (
            <p className="text-[11px] text-emerald-600 mt-1">Firmado el {fmtDate(anexo.firmado_at)}</p>
          )}
          {anexo.tipo === 'RESERVA' && anexo.estado !== 'FIRMADO' && !anexo.comprobante_reserva_aprobado && (
            <p className="text-[11px] text-amber-600 mt-1">
              {anexo.comprobante_reserva_path
                ? 'Comprobante de reserva en revisión'
                : 'Debes subir el comprobante de la transferencia de reserva'}
            </p>
          )}
        </div>
        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium flex-shrink-0 ${meta.color}`}>
          <Icon size={12} />
          {meta.label}
        </span>
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        <button
          onClick={onVer}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-lg border border-gray-200 transition-colors"
        >
          <Download size={12} /> Ver documento
        </button>
        {puedeF && (
          <button
            onClick={onFirmar}
            disabled={signing || !tieneFirma}
            title={!tieneFirma ? 'Registra tu firma en "Mi Firma" antes de firmar' : ''}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-900 hover:bg-blue-800 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            <PenLine size={12} />
            {signing ? 'Firmando…' : 'Firmar'}
          </button>
        )}
      </div>

      {puedeF && !tieneFirma && (
        <p className="text-[11px] text-amber-700 mt-2">
          Primero registra tu firma electrónica en "Mi Firma" para poder firmar este documento.
        </p>
      )}
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
      const { data: blob } = await api.get(`/inquilinos/portal/contratos/${c.id}/pdf`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }))
      window.open(url, '_blank')
    } catch {
      toast.error('Error al abrir el documento')
    }
  }

  const firmar = async (c) => {
    if (!perfil?.firma_base64) {
      toast.error('Primero registra tu firma electrónica en "Mi Firma"')
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-blue-900 border-t-transparent rounded-full" />
      </div>
    )
  }

  const tieneFirma = !!perfil?.firma_base64

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Contratos</h1>
        <p className="text-gray-500 mt-1">Tus contratos y documentos del servicio Tracking Tech</p>
      </div>

      {/* Aviso si no tiene firma registrada */}
      {!tieneFirma && contratos.some(c => c.estado !== 'FIRMADO' && c.requiere_firma_inquilino) && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <AlertCircle size={18} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-amber-800">
            Tienes documentos pendientes de firma.{' '}
            <button
              onClick={() => navigate('/inquilino/firma')}
              className="font-semibold underline hover:no-underline"
            >
              Registra tu firma electrónica
            </button>{' '}
            para poder firmarlos.
          </div>
        </div>
      )}

      {contratos.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No hay contratos disponibles aún</p>
          <p className="text-sm text-gray-400 mt-1">Tu ejecutivo de cuenta emitirá los documentos pronto</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck size={16} className="text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Documentos</h2>
          </div>
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
        </div>
      )}
    </div>
  )
}
