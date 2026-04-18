import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import api from '../../api'
import {
  Truck, DollarSign, TrendingUp, Users, CheckCircle, Clock, AlertCircle,
  Package, Receipt, FileText, Wallet, ChevronRight, MessageSquare, ChevronDown,
} from 'lucide-react'

const fmt = (n) => `$${(n || 0).toLocaleString('es-CL')}`
const now = new Date()
const MESES_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

const ESTADO_CFG = {
  PAGADO:     { cls: 'text-emerald-700 bg-emerald-50',  icon: CheckCircle, label: 'Pagado' },
  PENDIENTE:  { cls: 'text-amber-700 bg-amber-50',      icon: Clock,       label: 'Pendiente' },
  INCOMPLETO: { cls: 'text-red-700 bg-red-50',          icon: AlertCircle, label: 'Incompleto' },
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

export default function DriverDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [period, setPeriod]               = useState({ semana: 1, mes: now.getMonth() + 1, anio: now.getFullYear() })
  const [envios, setEnvios]               = useState([])
  const [liquidacion, setLiquidacion]     = useState(null)
  const [pagosRecibidos, setPagosRecibidos] = useState(null)
  const [flota, setFlota]                 = useState(null)
  const [flotaGanancias, setFlotaGanancias] = useState(null)
  const [filterDriver, setFilterDriver]   = useState('todos')
  const [loading, setLoading]             = useState(true)

  useEffect(() => {
    api.get('/drivers/mi-flota/info')
      .then(({ data }) => setFlota(data))
      .catch(() => setFlota({ es_jefe_flota: false, subordinados: [] }))
  }, [])

  useEffect(() => {
    setLoading(true)
    const mesCompleto  = period.semana === 0
    const enviosParams = mesCompleto
      ? { mes: period.mes, anio: period.anio, limit: 5000 }
      : { ...period, limit: 5000 }

    Promise.all([
      api.get('/envios', { params: enviosParams }),
      mesCompleto ? Promise.resolve(null) : api.get('/portal/driver/liquidacion', { params: period }).catch(() => null),
      api.get('/portal/driver/pagos-recibidos', { params: { mes: period.mes, anio: period.anio } }).catch(() => null),
      api.get('/portal/driver/ganancias-flota', { params: { mes: period.mes, anio: period.anio, semana: period.semana } }).catch(() => null),
    ])
      .then(([envRes, liqRes, pagosRes, flotaRes]) => {
        setEnvios(envRes.data || [])
        setLiquidacion(liqRes?.data || null)
        setPagosRecibidos(pagosRes?.data || null)
        setFlotaGanancias(flotaRes?.data?.es_jefe ? flotaRes.data : null)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [period])

  const filtered = filterDriver === 'todos'
    ? envios
    : filterDriver === 'mis'
      ? envios.filter((e) => e.driver_id === user?.entidad_id)
      : envios.filter((e) => e.driver_id === parseInt(filterDriver, 10))

  const envioTotal = (e) =>
    (e.costo_driver || 0) + (e.extra_producto_driver || 0) + (e.extra_comuna_driver || 0) + (e.pago_extra_manual || 0)

  const usarLiquidacion = (filterDriver === 'todos' || filterDriver === 'mis') && liquidacion != null
  const semanaKey       = String(period.semana)
  const semanaData      = liquidacion?.weekly?.[semanaKey]

  const totalEntregas = usarLiquidacion && semanaData != null
    ? semanaData.envios
    : filtered.length

  const totalPagoLiquidacion = semanaData != null
    ? (semanaData.normal_total || 0) + (semanaData.oviedo_total || 0) + (semanaData.tercerizado_total || 0)
      + (semanaData.comuna || 0) + (semanaData.bultos_extra || 0) + (semanaData.retiros || 0)
      + (semanaData.bonificaciones || 0) + (semanaData.descuentos || 0)
    : null

  const totalPago = usarLiquidacion && totalPagoLiquidacion != null
    ? totalPagoLiquidacion
    : filtered.reduce((acc, e) => acc + envioTotal(e), 0)

  const promedio = totalEntregas > 0 ? Math.round(totalPago / totalEntregas) : 0
  const esJefe   = flota?.es_jefe_flota
  const nombreCorto = (user?.nombre || '').split(' ').slice(0, 2).join(' ')

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
              <p className="text-blue-200 text-xs font-medium uppercase tracking-wider">
                {esJefe ? 'Jefe de flota' : 'Conductor'}
              </p>
              <h1 className="text-lg font-bold leading-tight mt-0.5">
                Hola, {nombreCorto || 'Conductor'}
              </h1>
              <p className="text-blue-200 text-xs mt-0.5">
                Semana {period.semana} · {MESES_FULL[period.mes - 1]} {period.anio}
              </p>
            </div>
            <div className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0">
              <Truck size={18} className="text-white" />
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white/10 rounded-xl p-2.5">
              <p className="text-blue-200 text-[10px] uppercase tracking-wide leading-none mb-1">Entregas</p>
              <p className="text-white font-bold text-base leading-tight">{totalEntregas}</p>
            </div>
            <div className="bg-white/10 rounded-xl p-2.5">
              <p className="text-blue-200 text-[10px] uppercase tracking-wide leading-none mb-1">A recibir</p>
              <p className="text-white font-bold text-sm leading-tight">{fmt(totalPago)}</p>
            </div>
            <div className="bg-white/10 rounded-xl p-2.5">
              <p className="text-blue-200 text-[10px] uppercase tracking-wide leading-none mb-1">Prom./entrega</p>
              <p className="text-white font-bold text-sm leading-tight">{fmt(promedio)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Selector de período */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2 px-1">Período</p>
        <div className="flex gap-2">
          <select
            value={period.semana}
            onChange={(e) => setPeriod({ ...period, semana: Number(e.target.value) })}
            className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-700"
          >
            {esJefe && <option value={0}>Mes completo</option>}
            {[1, 2, 3, 4, 5].map((s) => <option key={s} value={s}>Semana {s}</option>)}
          </select>
          <select
            value={period.mes}
            onChange={(e) => setPeriod({ ...period, mes: Number(e.target.value) })}
            className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-700"
          >
            {MESES_FULL.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
          <select
            value={period.anio}
            onChange={(e) => setPeriod({ ...period, anio: Number(e.target.value) })}
            className="w-20 text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-700"
          >
            {[now.getFullYear(), now.getFullYear() - 1].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        {esJefe && (
          <select
            value={filterDriver}
            onChange={(e) => setFilterDriver(e.target.value)}
            className="mt-2 w-full text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-700"
          >
            <option value="todos">Toda la flota</option>
            <option value="mis">Solo mis entregas</option>
            {flota?.subordinados?.map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-7 h-7 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Ganancia total flota - solo jefes */}
          {flotaGanancias && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="p-4 pb-3 border-b border-gray-50 flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <Receipt size={14} className="text-blue-500" />
                    <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Ganancia flota</h2>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {flotaGanancias.conductores} conductor{flotaGanancias.conductores > 1 ? 'es' : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide leading-none">{period.semana > 0 ? `Sem ${period.semana}` : 'Mes completo'}</p>
                  <p className="text-base font-bold text-blue-700 mt-0.5">{fmt(flotaGanancias.total_flota)}</p>
                </div>
              </div>
              {flotaGanancias.detalle?.length > 0 && (
                <div className="p-4 space-y-2.5">
                  {flotaGanancias.detalle.map((d) => {
                    const pct = flotaGanancias.total_flota > 0 ? Math.round((d.total / flotaGanancias.total_flota) * 100) : 0
                    return (
                      <div key={d.driver_id}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-gray-700 font-medium truncate max-w-[60%]">{d.nombre}</span>
                          <span className="text-gray-700 font-semibold">{fmt(d.total)} <span className="text-gray-400 font-normal">· {pct}%</span></span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-400 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Pagos recibidos del mes - no jefes */}
          {!esJefe && pagosRecibidos?.semanas?.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="p-4 pb-3 border-b border-gray-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle size={14} className="text-emerald-500" />
                  <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                    Pagos · {MESES_FULL[pagosRecibidos.mes - 1]} {pagosRecibidos.anio}
                  </h2>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide leading-none">Pagado/Liquidado</p>
                  <p className="text-xs font-bold text-emerald-700 mt-0.5">
                    {fmt(pagosRecibidos.total_pagado)}<span className="text-gray-400 font-normal"> / {fmt(pagosRecibidos.total_liquidado)}</span>
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 p-3">
                {pagosRecibidos.semanas.map((s) => (
                  <div key={s.semana} className="border border-gray-100 rounded-xl p-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide">Sem {s.semana}</p>
                      <EstadoChip estado={s.estado} />
                    </div>
                    <p className="text-sm font-semibold text-gray-800">{fmt(s.liquidado)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Resumen por conductor (jefes, todos) */}
          {esJefe && filterDriver === 'todos' && (() => {
            const flotaMap = {}
            if (flotaGanancias?.detalle) for (const d of flotaGanancias.detalle) flotaMap[d.driver_id] = d.total
            const allDrivers = [{ id: user?.entidad_id, nombre: `${user?.nombre} (yo)` }, ...(flota?.subordinados || [])]
            return (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="p-4 pb-3 border-b border-gray-50 flex items-center gap-2">
                  <Users size={14} className="text-purple-500" />
                  <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Resumen por conductor</h2>
                </div>
                <div className="divide-y divide-gray-50">
                  {allDrivers.map((d) => {
                    const dEnvios = envios.filter((e) => e.driver_id === d.id)
                    const dTotal  = flotaMap[d.id] ?? dEnvios.reduce((acc, e) => acc + envioTotal(e), 0)
                    return (
                      <div key={d.id} className="flex items-center justify-between px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-700 truncate">{d.nombre}</p>
                          <p className="text-[11px] text-gray-400">{dEnvios.length} entregas</p>
                        </div>
                        <p className="text-sm font-bold text-emerald-700 ml-3">{fmt(dTotal)}</p>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}
        </>
      )}

      {/* Accesos rápidos */}
      <div className="grid grid-cols-2 gap-3 pt-1">
        {[
          { label: 'Mis Entregas',    icon: Package,        color: 'text-blue-600',    bg: 'bg-blue-50',    to: '/driver/entregas' },
          { label: 'Mis Ganancias',   icon: Wallet,         color: 'text-emerald-600', bg: 'bg-emerald-50', to: '/driver/ganancias' },
          { label: 'Mis Facturas',    icon: FileText,       color: 'text-indigo-600',  bg: 'bg-indigo-50',  to: '/driver/facturas' },
          { label: 'Mis Consultas',   icon: MessageSquare,  color: 'text-amber-600',   bg: 'bg-amber-50',   to: '/driver/consultas' },
        ].map(({ label, icon: Icon, color, bg, to }) => (
          <button
            key={to}
            onClick={() => navigate(to)}
            className="flex items-center gap-3 bg-white border border-gray-100 shadow-sm rounded-2xl p-4 hover:border-gray-200 transition-colors text-left"
          >
            <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center flex-shrink-0`}>
              <Icon size={16} className={color} />
            </div>
            <span className="text-sm font-medium text-gray-700 leading-tight flex-1">{label}</span>
            <ChevronRight size={14} className="text-gray-300" />
          </button>
        ))}
      </div>
    </div>
  )
}
