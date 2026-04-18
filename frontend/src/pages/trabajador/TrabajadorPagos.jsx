import { useState, useEffect } from 'react'
import api from '../../api'
import { DollarSign, AlertCircle, Banknote, FileText, ChevronRight } from 'lucide-react'

const MESES      = ['','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const MESES_FULL = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

function fmt(n) {
  if (!n && n !== 0) return '$0'
  return '$' + Math.round(n).toLocaleString('es-CL')
}

function PagoCard({ p }) {
  const fuenteCol = p.fuente === 'cartola'
    ? 'bg-blue-50 text-blue-700 border-blue-100'
    : 'bg-gray-100 text-gray-600 border-gray-200'

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
            <Banknote size={18} className="text-emerald-600" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold text-emerald-600 leading-none">{fmt(p.monto)}</p>
            <p className="text-xs text-gray-500 mt-1.5 leading-tight">
              Nómina <span className="font-medium text-gray-700">{MESES_FULL[p.mes]} {p.anio}</span>
            </p>
            {p.descripcion && (
              <p className="text-[11px] text-gray-400 mt-0.5 truncate" title={p.descripcion}>
                {p.descripcion}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <span className={`text-[10px] uppercase font-semibold tracking-wide px-2 py-0.5 rounded-full border ${fuenteCol}`}>
            {p.fuente}
          </span>
          {p.fecha_pago && (
            <span className="text-[11px] text-gray-400">{p.fecha_pago}</span>
          )}
        </div>
      </div>
    </div>
  )
}

export default function TrabajadorPagos() {
  const [pagos, setPagos] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/remuneraciones/portal/pagos')
      .then(({ data }) => setPagos(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const total = pagos.reduce((s, p) => s + (p.monto || 0), 0)

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-emerald-200 border-t-emerald-600 rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="max-w-lg mx-auto px-4 py-5 space-y-4">

      {/* Hero */}
      <div className="rounded-2xl text-white p-5 relative overflow-hidden"
           style={{ background: 'linear-gradient(135deg, #047857 0%, #10b981 100%)' }}>
        <div className="absolute -top-8 -right-8 w-32 h-32 bg-white/5 rounded-full" />
        <div className="absolute -bottom-4 -left-4 w-20 h-20 bg-white/5 rounded-full" />

        <div className="relative">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-emerald-100 text-xs font-medium uppercase tracking-wider">Mis pagos</p>
              <h1 className="text-lg font-bold leading-tight mt-0.5">Historial de transferencias</h1>
              <p className="text-emerald-100 text-xs mt-0.5">Pagos de sueldo recibidos</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0">
              <DollarSign size={18} className="text-white" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/10 rounded-xl p-3">
              <p className="text-emerald-100 text-[10px] uppercase tracking-wide leading-none mb-1">Total recibido</p>
              <p className="text-white font-bold text-base leading-tight">{fmt(total)}</p>
            </div>
            <div className="bg-white/10 rounded-xl p-3">
              <p className="text-emerald-100 text-[10px] uppercase tracking-wide leading-none mb-1">Registros</p>
              <p className="text-white font-bold text-base leading-tight">{pagos.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Lista de pagos */}
      {pagos.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
          <DollarSign size={32} className="text-gray-200 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No hay pagos registrados aún.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pagos.map((p) => <PagoCard key={p.id} p={p} />)}
        </div>
      )}
    </div>
  )
}
