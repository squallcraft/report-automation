import { useState, useEffect } from 'react'
import api from '../../api'

function fmtFecha(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-CL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function DriverMiAcuerdo() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get('/drivers/me/acuerdo-info')
      .then(({ data }) => setData(data))
      .catch(() => setError('No se pudo cargar la información del acuerdo.'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center py-24 text-gray-400 text-sm">Cargando...</div>
  )
  if (error) return (
    <div className="p-6 text-red-600 text-sm">{error}</div>
  )

  const vigente = data?.acuerdo_aceptado
  const pendiente = !vigente

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Mi Acuerdo de Colaboración</h1>
        <p className="text-sm text-gray-500 mt-1">Registro de tu aceptación digital del acuerdo con Ecourier</p>
      </div>

      {/* Estado badge */}
      {pendiente ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
          <svg className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-amber-800">Acuerdo pendiente de firma</p>
            <p className="text-xs text-amber-700 mt-1">
              {data?.acuerdo_version && data.acuerdo_version !== data.version_actual
                ? `Hay una nueva versión del acuerdo (v${data.version_actual}). Deberás aceptarla en tu próximo acceso.`
                : 'Aún no has firmado el acuerdo de colaboración.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 flex items-start gap-3">
          <svg className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-green-800">Acuerdo vigente y firmado</p>
            <p className="text-xs text-green-700 mt-1">Tu acuerdo está al día. Versión {data?.acuerdo_version}.</p>
          </div>
        </div>
      )}

      {/* Detalles del acuerdo */}
      {data?.acuerdo_fecha && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-100">
          <Row label="Nombre" value={data.nombre} />
          <Row label="RUT registrado" value={data.rut || '—'} />
          <Row label="Versión aceptada" value={data.acuerdo_version ? `v${data.acuerdo_version}` : '—'} />
          <Row label="Fecha y hora de firma" value={fmtFecha(data.acuerdo_fecha)} />
          <Row label="Versión vigente" value={`v${data.version_actual}`} />
        </div>
      )}

      {/* Firma */}
      {data?.acuerdo_firma && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Firma registrada</p>
          <div className="border border-gray-200 rounded-xl bg-gray-50 p-3 flex items-center justify-center" style={{ minHeight: 120 }}>
            <img
              src={data.acuerdo_firma}
              alt="Tu firma"
              className="max-h-32 object-contain"
            />
          </div>
          <p className="text-xs text-gray-400 mt-2 text-center">
            Esta imagen es el registro oficial de tu firma digital.
          </p>
        </div>
      )}

      {/* Nota legal */}
      <p className="text-xs text-gray-400 text-center">
        El registro de aceptación (nombre, RUT, firma, fecha y dirección IP) tiene validez legal
        conforme a la Ley N° 19.799 sobre Documentos Electrónicos y Firma Electrónica.
      </p>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value}</span>
    </div>
  )
}
