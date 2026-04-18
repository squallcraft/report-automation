import { useState, useEffect } from 'react'
import api from '../../api'
import { FileText, Download, CheckCircle, Clock, AlertCircle } from 'lucide-react'

const MESES_FULL = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

function fmt(n) {
  if (!n && n !== 0) return '$0'
  return '$' + Math.round(n).toLocaleString('es-CL')
}

function EstadoPill({ estado }) {
  const map = {
    BORRADOR: { cls: 'bg-gray-100 text-gray-600',     icon: AlertCircle, label: 'Borrador' },
    EMITIDA:  { cls: 'bg-blue-50 text-blue-700',      icon: Clock,       label: 'Emitida'  },
    PAGADA:   { cls: 'bg-emerald-50 text-emerald-700',icon: CheckCircle, label: 'Pagada'   },
  }
  const m = map[estado] || map.EMITIDA
  const Icon = m.icon
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${m.cls}`}>
      <Icon size={10} /> {m.label}
    </span>
  )
}

function LiquidacionCard({ liq, onDownload, downloading }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="p-4 pb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
            <FileText size={18} className="text-blue-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-800 leading-tight">
              {MESES_FULL[liq.mes]} {liq.anio}
            </p>
            <div className="mt-1.5">
              <EstadoPill estado={liq.estado} />
            </div>
          </div>
        </div>
        <button
          onClick={() => onDownload(liq)}
          disabled={downloading === liq.id}
          className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-40 px-3 py-2 rounded-lg hover:bg-blue-50 transition-colors flex-shrink-0"
        >
          {downloading === liq.id
            ? <span className="w-3.5 h-3.5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin"/>
            : <Download size={13}/>}
          PDF
        </button>
      </div>

      {/* Cuerpo */}
      <div className="px-4 pb-4 space-y-1.5">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Imponible</span>
          <span className="text-gray-800 font-medium">{fmt(liq.remuneracion_imponible)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">AFP</span>
          <span className="text-gray-700">{fmt(liq.descuento_afp)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Salud</span>
          <span className="text-gray-700">{fmt((liq.descuento_salud_legal || 0) + (liq.adicional_isapre || 0))}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Total descuentos</span>
          <span className="text-red-600 font-medium">-{fmt(liq.total_descuentos)}</span>
        </div>
        <div className="flex justify-between border-t border-gray-100 pt-2 mt-2">
          <span className="text-sm font-semibold text-gray-700">Líquido a cobrar</span>
          <span className="text-base font-bold text-emerald-600">{fmt(liq.sueldo_liquido)}</span>
        </div>
      </div>
    </div>
  )
}

export default function TrabajadorLiquidaciones() {
  const [liquidaciones, setLiquidaciones] = useState([])
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(null)

  useEffect(() => {
    api.get('/remuneraciones/portal/liquidaciones')
      .then(({ data }) => setLiquidaciones(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleDownload = async (liq) => {
    setDownloading(liq.id)
    try {
      const res = await api.get(`/remuneraciones/portal/liquidaciones/${liq.id}/pdf`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `liquidacion_${MESES_FULL[liq.mes]}_${liq.anio}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert('Error descargando PDF')
    } finally {
      setDownloading(null)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"/>
    </div>
  )

  const liquidoTotal = liquidaciones.reduce((s, l) => s + (l.sueldo_liquido || 0), 0)

  return (
    <div className="max-w-lg mx-auto px-4 py-5 space-y-4">

      {/* Hero */}
      <div className="rounded-2xl text-white p-5 relative overflow-hidden"
           style={{ background: 'linear-gradient(135deg, #003c72 0%, #1d4ed8 100%)' }}>
        <div className="absolute -top-8 -right-8 w-32 h-32 bg-white/5 rounded-full" />
        <div className="absolute -bottom-4 -left-4 w-20 h-20 bg-white/5 rounded-full" />

        <div className="relative">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-blue-200 text-xs font-medium uppercase tracking-wider">Mis liquidaciones</p>
              <h1 className="text-lg font-bold leading-tight mt-0.5">Sueldos mensuales</h1>
              <p className="text-blue-200 text-xs mt-0.5">Historial de liquidaciones emitidas</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0">
              <FileText size={18} className="text-white"/>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/10 rounded-xl p-3">
              <p className="text-blue-200 text-[10px] uppercase tracking-wide leading-none mb-1">Emitidas</p>
              <p className="text-white font-bold text-base leading-tight">{liquidaciones.length}</p>
            </div>
            <div className="bg-white/10 rounded-xl p-3">
              <p className="text-blue-200 text-[10px] uppercase tracking-wide leading-none mb-1">Líquido total</p>
              <p className="text-white font-bold text-base leading-tight">{fmt(liquidoTotal)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Lista */}
      {liquidaciones.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
          <FileText size={32} className="text-gray-200 mx-auto mb-2"/>
          <p className="text-sm text-gray-400">No tienes liquidaciones emitidas aún.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {liquidaciones.map((liq) => (
            <LiquidacionCard
              key={liq.id}
              liq={liq}
              onDownload={handleDownload}
              downloading={downloading}
            />
          ))}
        </div>
      )}
    </div>
  )
}
