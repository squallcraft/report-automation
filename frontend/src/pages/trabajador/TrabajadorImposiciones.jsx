import { useState, useEffect } from 'react'
import api from '../../api'
import {
  ShieldCheck, AlertCircle, TrendingDown,
  HeartPulse, Briefcase, Receipt, ChevronDown, ChevronUp,
} from 'lucide-react'

const MESES      = ['','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const MESES_FULL = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

function fmt(n) {
  if (!n && n !== 0) return '$0'
  return '$' + Math.round(n).toLocaleString('es-CL')
}

function MesCard({ m, expanded, onToggle }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
      >
        <div className="text-left">
          <p className="text-sm font-semibold text-gray-800">{MESES_FULL[m.mes]} {m.anio}</p>
          <p className="text-xs text-gray-400 mt-0.5">Imponible {fmt(m.remuneracion_imponible)}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide leading-none">Total descuentos</p>
            <p className="text-sm font-bold text-red-600 mt-0.5">{fmt(m.total_descuentos)}</p>
          </div>
          {expanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-50 px-4 py-3 space-y-2 bg-gray-50/50">
          {[
            ['AFP',          m.descuento_afp,         'text-blue-600',    Briefcase],
            ['Salud 7%',     m.descuento_salud_legal, 'text-emerald-600', HeartPulse],
            ['Adic. Isapre', m.adicional_isapre,      'text-emerald-500', HeartPulse],
            ['Cesantía',     m.descuento_cesantia,    'text-amber-600',   ShieldCheck],
            ['IUSC',         m.iusc,                  'text-red-500',     Receipt],
          ].filter(([,v]) => v > 0).map(([label, value, color, Icon]) => (
            <div key={label} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Icon size={13} className={color} />
                <span className="text-gray-600">{label}</span>
              </div>
              <span className={`font-medium ${color}`}>{fmt(value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function TrabajadorImposiciones() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expandedIdx, setExpandedIdx] = useState(0)

  useEffect(() => {
    api.get('/remuneraciones/portal/imposiciones')
      .then(({ data }) => setData(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
    </div>
  )
  if (!data) return (
    <div className="flex flex-col items-center justify-center py-24 text-gray-400 gap-2">
      <AlertCircle size={32} />
      <p className="text-sm">Error cargando datos</p>
    </div>
  )

  const { meses, totales_periodo } = data
  const totalGlobal = (totales_periodo.afp || 0) + (totales_periodo.salud || 0) + (totales_periodo.cesantia || 0) + (totales_periodo.iusc || 0)

  return (
    <div className="max-w-lg mx-auto px-4 py-5 space-y-4">

      {/* Hero */}
      <div className="rounded-2xl text-white p-5 relative overflow-hidden"
           style={{ background: 'linear-gradient(135deg, #5b21b6 0%, #7c3aed 100%)' }}>
        <div className="absolute -top-8 -right-8 w-32 h-32 bg-white/5 rounded-full" />
        <div className="absolute -bottom-4 -left-4 w-20 h-20 bg-white/5 rounded-full" />

        <div className="relative">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-purple-200 text-xs font-medium uppercase tracking-wider">Mis imposiciones</p>
              <h1 className="text-lg font-bold leading-tight mt-0.5">Descuentos previsionales</h1>
              <p className="text-purple-200 text-xs mt-0.5">AFP · Salud · Cesantía · IUSC</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0">
              <ShieldCheck size={18} className="text-white" />
            </div>
          </div>

          <div className="bg-white/10 rounded-xl p-3 mb-3">
            <p className="text-purple-200 text-[10px] uppercase tracking-wide mb-0.5">Total descontado período</p>
            <p className="text-white font-bold text-2xl leading-tight">{fmt(totalGlobal)}</p>
          </div>

          {meses.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-white/10 rounded-xl p-2.5">
                <p className="text-purple-200 text-[10px] uppercase tracking-wide leading-none mb-1">AFP acum.</p>
                <p className="text-white font-semibold text-sm leading-tight">{fmt(totales_periodo.afp)}</p>
              </div>
              <div className="bg-white/10 rounded-xl p-2.5">
                <p className="text-purple-200 text-[10px] uppercase tracking-wide leading-none mb-1">Salud acum.</p>
                <p className="text-white font-semibold text-sm leading-tight">{fmt(totales_periodo.salud)}</p>
              </div>
              <div className="bg-white/10 rounded-xl p-2.5">
                <p className="text-purple-200 text-[10px] uppercase tracking-wide leading-none mb-1">Cesantía acum.</p>
                <p className="text-white font-semibold text-sm leading-tight">{fmt(totales_periodo.cesantia)}</p>
              </div>
              <div className="bg-white/10 rounded-xl p-2.5">
                <p className="text-purple-200 text-[10px] uppercase tracking-wide leading-none mb-1">IUSC acum.</p>
                <p className="text-white font-semibold text-sm leading-tight">{totales_periodo.iusc > 0 ? fmt(totales_periodo.iusc) : '—'}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Detalle mensual */}
      {meses.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
          <ShieldCheck size={32} className="text-gray-200 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No hay liquidaciones con imposiciones registradas aún.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 px-1 pt-1">
            <TrendingDown size={14} className="text-purple-600" />
            <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Detalle mensual</h2>
          </div>

          <div className="space-y-2">
            {meses.map((m, i) => (
              <MesCard
                key={`${m.anio}-${m.mes}`}
                m={m}
                expanded={expandedIdx === i}
                onToggle={() => setExpandedIdx(expandedIdx === i ? -1 : i)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
