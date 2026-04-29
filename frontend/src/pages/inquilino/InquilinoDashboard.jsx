import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import api from '../../api'
import {
  Building2, FileText, CreditCard, CheckCircle,
  AlertCircle, Calendar, ChevronRight, PenLine,
} from 'lucide-react'

const fmt = (n) => '$' + (n || 0).toLocaleString('es-CL')
const fmtDate = (s) => s ? new Date(s).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'

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
    <div className="flex items-center justify-center h-48">
      <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full" />
    </div>
  )

  const cobro_pendiente = cobros.find(c => c.estado === 'PENDIENTE' || c.estado === 'VENCIDO')
  const contrato_pendiente = contratos.find(c => c.estado !== 'FIRMADO' && c.requiere_firma_inquilino)
  const contratos_firmados = contratos.filter(c => c.estado === 'FIRMADO').length
  const tieneFirma = !!perfil?.firma_base64

  return (
    <div className="max-w-2xl mx-auto space-y-4">

      {/* Hero */}
      <div className="rounded-2xl text-white p-5 relative overflow-hidden"
           style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #1d4ed8 100%)' }}>
        <div className="absolute -top-8 -right-8 w-36 h-36 bg-white/5 rounded-full" />
        <div className="absolute -bottom-6 -left-6 w-24 h-24 bg-white/5 rounded-full" />
        <div className="relative">
          <p className="text-blue-200 text-xs font-medium uppercase tracking-wider">Portal cliente</p>
          <h1 className="text-xl font-bold mt-0.5 leading-tight">
            {perfil?.razon_social || perfil?.nombre_fantasia || user?.nombre}
          </h1>
          <p className="text-blue-200 text-xs mt-1">Software Tracking Tech · {perfil?.plan || '—'}</p>
        </div>
      </div>

      {/* Alertas */}
      {cobro_pendiente?.estado === 'VENCIDO' && (
        <button onClick={() => navigate('/inquilino/cobros')}
          className="w-full flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-2xl text-left">
          <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-red-700">Cobro vencido — {fmt(cobro_pendiente.total)}</p>
            <p className="text-xs text-red-500 mt-0.5">Sube tu comprobante de pago para regularizar</p>
          </div>
          <ChevronRight size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
        </button>
      )}

      {contrato_pendiente && (
        <button onClick={() => navigate('/inquilino/contratos')}
          className="w-full flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-2xl text-left">
          <FileText size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-700">Contrato pendiente de firma</p>
            <p className="text-xs text-amber-500 mt-0.5 truncate">{contrato_pendiente.titulo}</p>
          </div>
          <ChevronRight size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
        </button>
      )}

      {!tieneFirma && (
        <button onClick={() => navigate('/inquilino/firma')}
          className="w-full flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-2xl text-left">
          <PenLine size={18} className="text-blue-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-blue-700">Registra tu firma electrónica</p>
            <p className="text-xs text-blue-400 mt-0.5">La necesitas para firmar contratos y documentos</p>
          </div>
          <ChevronRight size={16} className="text-blue-400 flex-shrink-0 mt-0.5" />
        </button>
      )}

      {/* Cards resumen */}
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => navigate('/inquilino/contratos')}
          className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-left hover:border-blue-200 transition-colors">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${
            perfil?.contrato_firmado ? 'bg-emerald-50' : 'bg-amber-50'
          }`}>
            <FileText size={18} className={perfil?.contrato_firmado ? 'text-emerald-600' : 'text-amber-600'} />
          </div>
          <p className="text-xs text-gray-400 mb-0.5">Contratos</p>
          <p className="text-sm font-bold text-gray-900">
            {perfil?.contrato_firmado ? `${contratos_firmados} firmado${contratos_firmados !== 1 ? 's' : ''}` : 'Sin firmar'}
          </p>
        </button>

        <button onClick={() => navigate('/inquilino/cobros')}
          className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-left hover:border-blue-200 transition-colors">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${
            cobro_pendiente ? (cobro_pendiente.estado === 'VENCIDO' ? 'bg-red-50' : 'bg-amber-50') : 'bg-emerald-50'
          }`}>
            <CreditCard size={18} className={
              cobro_pendiente
                ? (cobro_pendiente.estado === 'VENCIDO' ? 'text-red-500' : 'text-amber-500')
                : 'text-emerald-600'
            } />
          </div>
          <p className="text-xs text-gray-400 mb-0.5">Cobros</p>
          <p className="text-sm font-bold text-gray-900">
            {cobro_pendiente ? fmt(cobro_pendiente.total) : 'Al día'}
          </p>
        </button>
      </div>

      {/* Información del servicio */}
      {perfil?.fecha_inicio_despliegue ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-4">
            <Calendar size={16} className="text-blue-600" />
            <p className="text-sm font-semibold text-gray-900">Información del servicio</p>
          </div>
          <div className="space-y-3">
            {[
              ['Inicio del servicio', fmtDate(perfil.fecha_inicio_despliegue)],
              perfil.fecha_inicio_facturacion ? ['Inicio facturación', fmtDate(perfil.fecha_inicio_facturacion)] : null,
            ].filter(Boolean).map(([label, val]) => (
              <div key={label} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <span className="text-xs text-gray-400 uppercase tracking-wide">{label}</span>
                <span className="text-sm font-medium text-gray-900">{val}</span>
              </div>
            ))}
            {perfil.mes_gratis_confirmado && (
              <div className="flex items-center gap-2 pt-1">
                <CheckCircle size={14} className="text-emerald-500" />
                <span className="text-xs text-emerald-600 font-medium">Mes de cortesía incluido</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center">
              <Building2 size={18} className="text-gray-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700">Servicio en configuración</p>
              <p className="text-xs text-gray-400 mt-0.5">Tu ejecutivo activará el servicio una vez firmado el contrato</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
