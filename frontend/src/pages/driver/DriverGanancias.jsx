import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api'
import {
  TrendingUp, DollarSign, Clock, CheckCircle, AlertCircle,
  Users, ExternalLink, Wallet, Calendar, ChevronDown, ChevronUp,
  Banknote, AlertTriangle,
} from 'lucide-react'

const fmt = (n) => `$${(n || 0).toLocaleString('es-CL')}`
const now = new Date()

const MESES_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const MESES_SHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

const ESTADO_CFG = {
  PAGADO:     { label: 'Pagado',     icon: CheckCircle,  cls: 'text-emerald-700 bg-emerald-50' },
  INCOMPLETO: { label: 'Incompleto', icon: AlertCircle,  cls: 'text-amber-700 bg-amber-50' },
  PENDIENTE:  { label: 'Pendiente',  icon: Clock,        cls: 'text-gray-600 bg-gray-100' },
}

function EstadoChip({ estado }) {
  const cfg = ESTADO_CFG[estado] || ESTADO_CFG.PENDIENTE
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${cfg.cls}`}>
      <Icon size={10} /> {cfg.label}
    </span>
  )
}

function ProgressBar({ pct }) {
  return (
    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-amber-400' : 'bg-gray-300'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function SemanaCard({ sem, filas, esJefe, mes, anio, navigate, expanded, onToggle }) {
  const liqTotal    = filas.reduce((s, f) => s + (f.liquidado || 0), 0)
  const pagTotal    = filas.reduce((s, f) => s + (f.pagado || 0), 0)
  const pct         = liqTotal > 0 ? Math.min(100, Math.round((pagTotal / liqTotal) * 100)) : 0
  const filaPropia  = filas.find((f) => f.es_propio)
  const estadoMain  = filaPropia?.estado || filas[0]?.estado

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <button onClick={onToggle} className="w-full p-4 text-left hover:bg-gray-50">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-sm font-bold text-gray-800">Semana {sem}</p>
              <EstadoChip estado={estadoMain} />
            </div>
            <p className="text-[11px] text-gray-400">
              Liquidado <span className="text-gray-700 font-medium">{fmt(liqTotal)}</span>
              <span className="mx-1">·</span>
              Pagado <span className="text-emerald-700 font-medium">{fmt(pagTotal)}</span>
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {filaPropia && (
              <button
                onClick={(e) => { e.stopPropagation(); navigate(`/driver/liquidacion?semana=${sem}&mes=${mes}&anio=${anio}`) }}
                className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50"
                title="Ver liquidación"
              >
                <ExternalLink size={14} />
              </button>
            )}
            {esJefe && (expanded ? <ChevronUp size={14} className="text-gray-300"/> : <ChevronDown size={14} className="text-gray-300"/>)}
          </div>
        </div>
        <div className="mt-3">
          <ProgressBar pct={pct} />
        </div>
      </button>

      {expanded && esJefe && filas.length > 1 && (
        <div className="border-t border-gray-50 bg-gray-50/40 px-4 py-3 space-y-2">
          {filas.map((f) => (
            <div key={f.driver_id} className="flex items-center justify-between text-xs">
              <div className="min-w-0 flex-1">
                <p className={`truncate ${f.es_propio ? 'text-gray-700 font-medium' : 'text-blue-700'}`}>
                  {!f.es_propio && <Users size={10} className="inline mr-1 text-blue-400"/>}
                  {f.es_propio ? `${f.driver_nombre} (yo)` : f.driver_nombre}
                </p>
                <p className="text-gray-400 mt-0.5">Liq {fmt(f.liquidado)}</p>
              </div>
              <p className="text-emerald-700 font-semibold">{f.pagado > 0 ? fmt(f.pagado) : '—'}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PagoCard({ pago }) {
  const fechaTxt = pago.fecha_pago
    ? new Date(pago.fecha_pago + 'T12:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—'
  const fuenteCls = pago.fuente === 'cartola'
    ? 'bg-indigo-50 text-indigo-700 border-indigo-100'
    : 'bg-gray-100 text-gray-600 border-gray-200'

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
          <Banknote size={18} className="text-emerald-600" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2 mb-1">
            <p className="text-base font-bold text-emerald-600 leading-none">{fmt(pago.monto)}</p>
            <span className={`text-[10px] uppercase font-semibold tracking-wide px-2 py-0.5 rounded-full border ${fuenteCls}`}>
              {pago.fuente === 'cartola' ? 'Planilla' : 'Manual'}
            </span>
          </div>
          <p className="text-[11px] text-gray-500 mt-1.5">
            Sem {pago.semana} · {fechaTxt}
            {pago.driver_nombre && !pago.es_propio && (
              <span className="text-blue-700"> · {pago.driver_nombre}</span>
            )}
          </p>
          {pago.descripcion && (
            <p className="text-[11px] text-gray-400 truncate mt-0.5" title={pago.descripcion}>
              {pago.descripcion}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export default function DriverGanancias() {
  const navigate = useNavigate()
  const [mes, setMes] = useState(now.getMonth() + 1)
  const [anio, setAnio] = useState(now.getFullYear())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expandedSem, setExpandedSem] = useState(null)

  useEffect(() => {
    setLoading(true)
    api.get('/portal/driver/ganancias', { params: { mes, anio } })
      .then(({ data: d }) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [mes, anio])

  const semanaGroups = {}
  if (data?.semanas) {
    for (const s of data.semanas) {
      if (!semanaGroups[s.semana]) semanaGroups[s.semana] = []
      semanaGroups[s.semana].push(s)
    }
  }
  const semanasOrdenadas = Object.keys(semanaGroups).map(Number).sort((a, b) => a - b)

  const totalLiq = data?.resumen?.total_liquidado || 0
  const totalPag = data?.resumen?.total_pagado    || 0
  const pendiente= data?.resumen?.pendiente       || 0

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
              <p className="text-emerald-100 text-xs font-medium uppercase tracking-wider">Mis ganancias</p>
              <h1 className="text-lg font-bold leading-tight mt-0.5">{MESES_FULL[mes - 1]} {anio}</h1>
              <p className="text-emerald-100 text-xs mt-0.5">Detalle de pagos por período</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0">
              <Wallet size={18} className="text-white" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white/10 rounded-xl p-2.5">
              <p className="text-emerald-100 text-[10px] uppercase tracking-wide leading-none mb-1">Liquidado</p>
              <p className="text-white font-bold text-sm leading-tight">{fmt(totalLiq)}</p>
            </div>
            <div className="bg-white/10 rounded-xl p-2.5">
              <p className="text-emerald-100 text-[10px] uppercase tracking-wide leading-none mb-1">Pagado</p>
              <p className="text-white font-bold text-sm leading-tight">{fmt(totalPag)}</p>
            </div>
            <div className="bg-white/10 rounded-xl p-2.5">
              <p className="text-emerald-100 text-[10px] uppercase tracking-wide leading-none mb-1">Pendiente</p>
              <p className="text-white font-bold text-sm leading-tight">{fmt(pendiente)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Selector */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3">
        <div className="flex gap-2">
          <select value={mes} onChange={(e) => setMes(Number(e.target.value))}
            className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-700">
            {MESES_FULL.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
          <select value={anio} onChange={(e) => setAnio(Number(e.target.value))}
            className="w-24 text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-700">
            {[now.getFullYear(), now.getFullYear() - 1].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-7 h-7 border-4 border-emerald-200 border-t-emerald-600 rounded-full animate-spin" />
        </div>
      ) : !data || !data.semanas || data.semanas.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
          <Wallet size={32} className="text-gray-200 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No hay datos para {MESES_FULL[mes - 1]} {anio}</p>
        </div>
      ) : (
        <>
          {/* Desglose semanal */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 px-1 pt-1">
              <Calendar size={13} className="text-emerald-600" />
              <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Desglose semanal</h2>
            </div>
            <div className="space-y-2 pt-1">
              {semanasOrdenadas.map((sem) => (
                <SemanaCard
                  key={sem}
                  sem={sem}
                  filas={semanaGroups[sem]}
                  esJefe={data.es_jefe}
                  mes={mes}
                  anio={anio}
                  navigate={navigate}
                  expanded={expandedSem === sem}
                  onToggle={() => setExpandedSem(expandedSem === sem ? null : sem)}
                />
              ))}
            </div>
          </div>

          {/* Pagos */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 px-1 pt-3">
              <Banknote size={13} className="text-emerald-600" />
              <h2 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Pagos recibidos</h2>
            </div>
            {data.pagos.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-center">
                <p className="text-sm text-gray-400">No hay pagos registrados para este período</p>
              </div>
            ) : (
              <div className="space-y-2 pt-1">
                {data.pagos.map((p) => <PagoCard key={p.id} pago={p} />)}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
