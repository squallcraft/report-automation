import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import api from '../../api'
import { Building2, FileText, CreditCard, CheckCircle, Clock, AlertCircle, Calendar } from 'lucide-react'

export default function InquilinoDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [perfil, setPerfil] = useState(null)
  const [cobros, setCobros] = useState([])
  const [contratos, setContratos] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user?.perfil_completado) {
      navigate('/inquilino/completar-perfil')
      return
    }
    Promise.all([
      api.get('/inquilinos/portal/perfil'),
      api.get('/inquilinos/portal/cobros'),
      api.get('/inquilinos/portal/contratos'),
    ]).then(([p, c, ct]) => {
      setPerfil(p.data)
      setCobros(c.data)
      setContratos(ct.data)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [user])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-2 border-blue-900 border-t-transparent rounded-full" />
    </div>
  )

  const cobro_pendiente = cobros.find(c => c.estado === 'PENDIENTE' || c.estado === 'VENCIDO')
  const contrato_pendiente = contratos.find(c => c.estado === 'BORRADOR' && c.requiere_firma_inquilino)
  const contratos_firmados = contratos.filter(c => c.estado === 'FIRMADO').length

  const fmt = (n) => '$' + (n || 0).toLocaleString('es-CL')
  const PLANES = { TARIFA_A: 'Tarifa A — Base Conductores', TARIFA_B: 'Tarifa B — Base Envíos', TARIFA_C: 'Tarifa C — Por Conductor' }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          {perfil?.razon_social || perfil?.nombre_fantasia || 'Mi empresa'}
        </h1>
        <p className="text-gray-500 mt-1">Portal de cliente — Software Tracking Tech</p>
      </div>

      {/* Alertas */}
      {cobro_pendiente && cobro_pendiente.estado === 'VENCIDO' && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-700">Cobro vencido</p>
            <p className="text-sm text-red-600">Tienes un cobro vencido de {fmt(cobro_pendiente.total)}. Por favor sube tu comprobante de pago.</p>
          </div>
        </div>
      )}

      {contrato_pendiente && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <FileText className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-700">Contrato pendiente de firma</p>
            <p className="text-sm text-amber-600">Tienes un contrato pendiente de firma: <strong>{contrato_pendiente.titulo}</strong></p>
          </div>
        </div>
      )}

      {/* Cards resumen */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center">
              <Building2 className="w-5 h-5 text-blue-900" />
            </div>
            <span className="text-sm font-medium text-gray-500">Plan actual</span>
          </div>
          <p className="text-lg font-semibold text-gray-900">{PLANES[perfil?.plan] || perfil?.plan || '—'}</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${perfil?.contrato_firmado ? 'bg-green-50' : 'bg-amber-50'}`}>
              <FileText className={`w-5 h-5 ${perfil?.contrato_firmado ? 'text-green-600' : 'text-amber-600'}`} />
            </div>
            <span className="text-sm font-medium text-gray-500">Estado contrato</span>
          </div>
          <p className="text-lg font-semibold text-gray-900">
            {perfil?.contrato_firmado ? `${contratos_firmados} firmado(s)` : 'Pendiente de firma'}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${cobro_pendiente ? 'bg-amber-50' : 'bg-green-50'}`}>
              <CreditCard className={`w-5 h-5 ${cobro_pendiente ? 'text-amber-600' : 'text-green-600'}`} />
            </div>
            <span className="text-sm font-medium text-gray-500">Próximo cobro</span>
          </div>
          {cobro_pendiente ? (
            <p className="text-lg font-semibold text-gray-900">{fmt(cobro_pendiente.total)}</p>
          ) : (
            <p className="text-lg font-semibold text-gray-900">Al día</p>
          )}
        </div>
      </div>

      {/* Inicio servicio */}
      {perfil?.fecha_inicio_despliegue && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="w-5 h-5 text-blue-900" />
            <h2 className="font-semibold text-gray-900">Información del servicio</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-gray-500">Inicio del servicio</p>
              <p className="font-medium text-gray-900">{new Date(perfil.fecha_inicio_despliegue).toLocaleDateString('es-CL')}</p>
            </div>
            {perfil.fecha_inicio_facturacion && (
              <div>
                <p className="text-gray-500">Inicio facturación</p>
                <p className="font-medium text-gray-900">{new Date(perfil.fecha_inicio_facturacion).toLocaleDateString('es-CL')}</p>
              </div>
            )}
            {perfil.mes_gratis_confirmado && (
              <div>
                <p className="text-gray-500">Cortesía</p>
                <p className="font-medium text-green-600 flex items-center gap-1">
                  <CheckCircle className="w-4 h-4" /> Mes gratis incluido
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
