import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import api from '../../api'
import {
  FileText, DollarSign, ChevronRight, User,
  TrendingUp, CheckCircle, Clock, AlertCircle,
} from 'lucide-react'

const MESES     = ['','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const MESES_FULL= ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

function fmt(n) {
  if (!n && n !== 0) return '$0'
  return '$' + Math.round(n).toLocaleString('es-CL')
}

function EstadoBadge({ estado }) {
  if (estado === 'PAGADA')  return <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600"><CheckCircle size={11}/>Pagada</span>
  if (estado === 'EMITIDA') return <span className="flex items-center gap-1 text-xs font-semibold text-blue-600"><FileText size={11}/>Emitida</span>
  return <span className="flex items-center gap-1 text-xs font-semibold text-amber-600"><Clock size={11}/>Borrador</span>
}

export default function TrabajadorDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [perfil, setPerfil] = useState(null)
  const [liquidaciones, setLiquidaciones] = useState([])
  const [pagos, setPagos] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.get('/remuneraciones/portal/perfil'),
      api.get('/remuneraciones/portal/liquidaciones'),
      api.get('/remuneraciones/portal/pagos'),
    ])
      .then(([r1, r2, r3]) => {
        setPerfil(r1.data)
        setLiquidaciones(r2.data)
        setPagos(r3.data)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
    </div>
  )
  if (!perfil) return (
    <div className="flex flex-col items-center justify-center py-24 text-gray-400 gap-2">
      <AlertCircle size={32} />
      <p className="text-sm">Error cargando datos</p>
    </div>
  )

  const ultimaLiq   = liquidaciones[0] || null
  const totalRecibido = pagos.reduce((s, p) => s + (p.monto || 0), 0)
  const tipoContrato  = (perfil.tipo_contrato || '').replace(/_/g, ' ').toLowerCase()
                        .replace(/\b\w/g, c => c.toUpperCase())

  return (
    <div className="max-w-lg mx-auto px-4 py-5 space-y-4">

      {/* ── Hero card ── */}
      <div className="rounded-2xl text-white p-5 relative overflow-hidden"
           style={{ background: 'linear-gradient(135deg, #003c72 0%, #1d4ed8 100%)' }}>
        {/* decoración */}
        <div className="absolute -top-8 -right-8 w-32 h-32 bg-white/5 rounded-full" />
        <div className="absolute -bottom-4 -left-4 w-20 h-20 bg-white/5 rounded-full" />

        <div className="relative">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-blue-200 text-xs font-medium uppercase tracking-wider">Mi portal</p>
              <h1 className="text-lg font-bold leading-tight mt-0.5">
                {perfil.nombre?.split(' ').slice(0, 2).join(' ')}
              </h1>
              <p className="text-blue-200 text-xs mt-0.5">
                {perfil.cargo || 'Trabajador'}
                {tipoContrato ? ` · ${tipoContrato}` : ''}
              </p>
            </div>
            <div className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0">
              <User size={18} className="text-white" />
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 mt-2">
            <div className="bg-white/10 rounded-xl p-3">
              <p className="text-blue-200 text-[10px] uppercase tracking-wide leading-none mb-1">Sueldo líquido</p>
              <p className="text-white font-bold text-sm leading-tight">{fmt(perfil.sueldo_liquido || 0)}</p>
            </div>
            <div className="bg-white/10 rounded-xl p-3">
              <p className="text-blue-200 text-[10px] uppercase tracking-wide leading-none mb-1">Liquidaciones</p>
              <p className="text-white font-bold text-sm leading-tight">{liquidaciones.length}</p>
            </div>
            <div className="bg-white/10 rounded-xl p-3">
              <p className="text-blue-200 text-[10px] uppercase tracking-wide leading-none mb-1">Total recibido</p>
              <p className="text-white font-bold text-sm leading-tight">{fmt(totalRecibido)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Mis datos ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center gap-2 mb-3">
          <User size={15} className="text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-700">Mis datos</h2>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          {[
            ['RUT',           perfil.rut],
            ['AFP',           perfil.afp],
            ['Sistema salud', perfil.sistema_salud || 'FONASA'],
            ['Fecha ingreso', perfil.fecha_ingreso],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
              <p className="text-sm font-medium text-gray-800 mt-0.5">{value || '—'}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Última liquidación ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-50">
          <div className="flex items-center gap-2">
            <FileText size={15} className="text-blue-500" />
            <h2 className="text-sm font-semibold text-gray-700">Última liquidación</h2>
          </div>
          <button
            onClick={() => navigate('/trabajador/liquidaciones')}
            className="text-xs text-primary-600 font-medium flex items-center gap-0.5 hover:underline"
          >
            Ver todas <ChevronRight size={12} />
          </button>
        </div>

        {ultimaLiq ? (
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-gray-800">
                {MESES_FULL[ultimaLiq.mes]} {ultimaLiq.anio}
              </p>
              <EstadoBadge estado={ultimaLiq.estado} />
            </div>
            <div className="space-y-2">
              {[
                ['Sueldo Base',       ultimaLiq.sueldo_base,       null],
                ['Gratificación',     ultimaLiq.gratificacion,     null],
                ['Total descuentos',  ultimaLiq.total_descuentos,  'red'],
              ].map(([label, value, color]) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-gray-500">{label}</span>
                  <span className={color === 'red' ? 'text-red-600 font-medium' : 'text-gray-800'}>
                    {color === 'red' ? '-' : ''}{fmt(value)}
                  </span>
                </div>
              ))}
              <div className="flex justify-between text-sm border-t border-gray-100 pt-2 mt-1">
                <span className="font-semibold text-gray-700">Líquido a cobrar</span>
                <span className="font-bold text-emerald-600 text-base">{fmt(ultimaLiq.sueldo_liquido)}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="px-4 py-6 text-center text-sm text-gray-400">
            Sin liquidaciones emitidas aún.
          </div>
        )}
      </div>

      {/* ── Últimos pagos ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-50">
          <div className="flex items-center gap-2">
            <DollarSign size={15} className="text-emerald-500" />
            <h2 className="text-sm font-semibold text-gray-700">Últimos pagos recibidos</h2>
          </div>
          <button
            onClick={() => navigate('/trabajador/pagos')}
            className="text-xs text-primary-600 font-medium flex items-center gap-0.5 hover:underline"
          >
            Ver todos <ChevronRight size={12} />
          </button>
        </div>

        {pagos.length > 0 ? (
          <div className="divide-y divide-gray-50">
            {pagos.slice(0, 4).map((p) => (
              <div key={p.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0">
                    <DollarSign size={14} className="text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{fmt(p.monto)}</p>
                    <p className="text-xs text-gray-400">{MESES[p.mes]} {p.anio}</p>
                  </div>
                </div>
                <p className="text-xs text-gray-400">{p.fecha_pago || '—'}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-6 text-center text-sm text-gray-400">
            Sin pagos registrados aún.
          </div>
        )}
      </div>

      {/* ── Accesos rápidos ── */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Mis Liquidaciones', icon: FileText,  color: 'text-blue-600',    bg: 'bg-blue-50',    to: '/trabajador/liquidaciones' },
          { label: 'Mis Pagos',         icon: DollarSign, color: 'text-emerald-600', bg: 'bg-emerald-50', to: '/trabajador/pagos' },
          { label: 'Imposiciones',      icon: TrendingUp, color: 'text-purple-600',  bg: 'bg-purple-50',  to: '/trabajador/imposiciones' },
          { label: 'Mis Anexos',        icon: FileText,   color: 'text-indigo-600',  bg: 'bg-indigo-50',  to: '/trabajador/anexos' },
          { label: 'Mi Firma',          icon: CheckCircle,color: 'text-amber-600',   bg: 'bg-amber-50',   to: '/trabajador/firma' },
        ].map(({ label, icon: Icon, color, bg, to }) => (
          <button
            key={to}
            onClick={() => navigate(to)}
            className="flex items-center gap-3 bg-white border border-gray-100 shadow-sm rounded-2xl p-4 hover:border-gray-200 transition-colors text-left"
          >
            <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center flex-shrink-0`}>
              <Icon size={16} className={color} />
            </div>
            <span className="text-sm font-medium text-gray-700 leading-tight">{label}</span>
          </button>
        ))}
      </div>

    </div>
  )
}
