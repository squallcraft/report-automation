import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import api from '../../api'
import { FileText, CheckCircle, AlertCircle } from 'lucide-react'

function fmtFecha(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-CL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-xs text-gray-500 uppercase tracking-wide">{label}</span>
      <span className="text-sm font-medium text-gray-900 text-right">{value}</span>
    </div>
  )
}

export default function DriverMiAcuerdo() {
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  if (user?.contratado) return <Navigate to="/driver" replace />

  useEffect(() => {
    api.get('/drivers/me/acuerdo-info')
      .then(({ data }) => setData(data))
      .catch(() => setError('No se pudo cargar la información del acuerdo.'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
    </div>
  )
  if (error) return (
    <div className="max-w-lg mx-auto px-4 py-5">
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-2">
        <AlertCircle size={18} className="text-red-500 flex-shrink-0" />
        <p className="text-sm text-red-700">{error}</p>
      </div>
    </div>
  )

  const vigente = data?.acuerdo_aceptado
  const pendiente = !vigente
  const desactualizado = data?.acuerdo_version && data.acuerdo_version !== data.version_actual

  return (
    <div className="max-w-lg mx-auto px-4 py-5 space-y-4">

      {/* Hero */}
      <div className="rounded-2xl text-white p-5 relative overflow-hidden"
           style={{ background: 'linear-gradient(135deg, #003c72 0%, #1d4ed8 100%)' }}>
        <div className="absolute -top-8 -right-8 w-32 h-32 bg-white/5 rounded-full" />
        <div className="absolute -bottom-4 -left-4 w-20 h-20 bg-white/5 rounded-full" />

        <div className="relative flex items-center justify-between">
          <div>
            <p className="text-blue-200 text-xs font-medium uppercase tracking-wider">Mi acuerdo</p>
            <h1 className="text-lg font-bold leading-tight mt-0.5">Colaboración E-Courier</h1>
            <p className="text-blue-200 text-xs mt-0.5">Términos y condiciones del servicio</p>
          </div>
          <div className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0">
            <FileText size={18} className="text-white" />
          </div>
        </div>
      </div>

      {/* Estado */}
      {pendiente ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
          <AlertCircle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Acuerdo pendiente de firma</p>
            <p className="text-xs text-amber-700 mt-0.5 leading-snug">
              {desactualizado
                ? `Hay una nueva versión del acuerdo (v${data.version_actual}). Deberás aceptarla en tu próximo acceso.`
                : 'Aún no has firmado el acuerdo de colaboración.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 flex items-start gap-3">
          <CheckCircle size={18} className="text-emerald-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-emerald-800">Acuerdo vigente y firmado</p>
            <p className="text-xs text-emerald-700 mt-0.5">
              Tu acuerdo está al día. Versión {data?.acuerdo_version}.
            </p>
          </div>
        </div>
      )}

      {/* Detalles */}
      {data?.acuerdo_fecha && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50">
          <Row label="Nombre"            value={data.nombre} />
          <Row label="RUT registrado"    value={data.rut || '—'} />
          <Row label="Versión aceptada"  value={data.acuerdo_version ? `v${data.acuerdo_version}` : '—'} />
          <Row label="Fecha de firma"    value={fmtFecha(data.acuerdo_fecha)} />
          <Row label="Versión vigente"   value={`v${data.version_actual}`} />
        </div>
      )}

      {/* Firma */}
      {data?.acuerdo_firma && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Firma registrada</p>
          <div className="border border-gray-200 rounded-xl bg-gray-50 p-3 flex items-center justify-center" style={{ minHeight: 120 }}>
            <img src={data.acuerdo_firma} alt="Tu firma" className="max-h-32 object-contain" />
          </div>
          <p className="text-xs text-gray-400 mt-3 text-center leading-snug">
            Esta imagen es el registro oficial de tu firma digital.
          </p>
        </div>
      )}

      {/* Nota legal */}
      <p className="text-xs text-gray-400 text-center leading-relaxed px-2">
        El registro de aceptación (nombre, RUT, firma, fecha y dirección IP) tiene validez legal
        conforme a la Ley N° 19.799 sobre Documentos Electrónicos y Firma Electrónica.
      </p>
    </div>
  )
}
