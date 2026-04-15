import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import api from '../../api'
import PeriodSelector from '../../components/PeriodSelector'
import StatsCard from '../../components/StatsCard'
import PageHeader from '../../components/PageHeader'
import { Truck, DollarSign, TrendingUp, Users, CheckCircle, LayoutDashboard, Receipt } from 'lucide-react'

const fmt = (n) => `$${(n || 0).toLocaleString('es-CL')}`
const now = new Date()
const ESTADO_COLORS = {
  PAGADO: 'text-emerald-700 bg-emerald-50',
  PENDIENTE: 'text-amber-700 bg-amber-50',
  INCOMPLETO: 'text-red-700 bg-red-50',
}

export default function DriverDashboard() {
  const { user } = useAuth()
  const [period, setPeriod] = useState({ semana: 1, mes: now.getMonth() + 1, anio: now.getFullYear() })
  const [envios, setEnvios] = useState([])
  const [liquidacion, setLiquidacion] = useState(null)
  const [pagosRecibidos, setPagosRecibidos] = useState(null)
  const [flota, setFlota] = useState(null)
  const [flotaGanancias, setFlotaGanancias] = useState(null)
  const [filterDriver, setFilterDriver] = useState('todos')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/drivers/mi-flota/info')
      .then(({ data }) => setFlota(data))
      .catch(() => setFlota({ es_jefe_flota: false, subordinados: [] }))
  }, [])

  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.get('/envios', { params: { ...period, limit: 5000 } }),
      api.get('/portal/driver/liquidacion', { params: period }).catch(() => null),
      api.get('/portal/driver/pagos-recibidos', { params: { mes: period.mes, anio: period.anio } }).catch(() => null),
      api.get('/portal/driver/ganancias-flota', { params: { mes: period.mes, anio: period.anio } }).catch(() => null),
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

  // Usar datos de liquidación cuando están disponibles (evita el límite de 100 de /envios)
  const usarLiquidacion = (filterDriver === 'todos' || filterDriver === 'mis') && liquidacion != null
  const semanaKey = String(period.semana)
  const semanaData = liquidacion?.weekly?.[semanaKey]

  // Conteo exacto de entregas desde liquidación (sin límite de 100)
  const totalEntregas = usarLiquidacion && semanaData != null
    ? semanaData.envios
    : filtered.length

  // Total a recibir calculado desde weekly (igual que LiquidacionDetalle)
  const totalPagoLiquidacion = semanaData != null
    ? (semanaData.normal_total || 0) + (semanaData.oviedo_total || 0) + (semanaData.tercerizado_total || 0)
      + (semanaData.comuna || 0) + (semanaData.bultos_extra || 0) + (semanaData.retiros || 0)
      + (semanaData.bonificaciones || 0) + (semanaData.descuentos || 0)
    : null

  const totalPago = usarLiquidacion && totalPagoLiquidacion != null
    ? totalPagoLiquidacion
    : filtered.reduce((acc, e) => acc + envioTotal(e), 0)

  const esJefe = flota?.es_jefe_flota

  return (
    <div>
      <PageHeader
        title={user?.nombre ? `Hola, ${user.nombre}` : 'Hola'}
        subtitle="Tu panel de control"
        icon={LayoutDashboard}
        accent="blue"
      />

      <div className="card mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <PeriodSelector {...period} onChange={setPeriod} />
          {esJefe && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Conductor</label>
              <select
                className="input-field text-sm"
                value={filterDriver}
                onChange={(e) => setFilterDriver(e.target.value)}
              >
                <option value="todos">Toda la flota</option>
                <option value="mis">Mis entregas</option>
                {flota.subordinados.map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Cargando...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <StatsCard icon={Truck} label="Entregas" value={totalEntregas} color="primary" />
            <StatsCard icon={DollarSign} label="Total a Recibir" value={fmt(totalPago)} color="green" />
            <StatsCard icon={TrendingUp} label="Promedio por Entrega" value={totalEntregas > 0 ? fmt(Math.round(totalPago / totalEntregas)) : '$0'} color="purple" />
            {esJefe && (
              <StatsCard icon={Users} label="Conductores" value={flota.subordinados.length + 1} color="amber" />
            )}
          </div>

          {/* Ganancia Total Flota - solo para jefes */}
          {flotaGanancias && (
            <div className="card mt-5 border-l-4 border-l-blue-500">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Receipt size={16} className="text-blue-500" />
                  Ganancia Total Flota — {new Date(flotaGanancias.anio, flotaGanancias.mes - 1).toLocaleString('es-CL', { month: 'long', year: 'numeric' })}
                </h2>
                <div className="text-right">
                  <span className="text-xs text-gray-500">Total liquidado del mes</span>
                  <p className="text-xl font-bold text-blue-700">{fmt(flotaGanancias.total_flota)}</p>
                </div>
              </div>
              <p className="text-xs text-gray-500 mb-3">Incluye {flotaGanancias.conductores} conductor{flotaGanancias.conductores > 1 ? 'es' : ''} · Usa este monto como referencia para tu factura</p>
              {flotaGanancias.detalle?.length > 0 && (
                <div className="space-y-1.5">
                  {flotaGanancias.detalle.map(d => {
                    const pct = flotaGanancias.total_flota > 0 ? Math.round((d.total / flotaGanancias.total_flota) * 100) : 0
                    return (
                      <div key={d.driver_id} className="flex items-center gap-3 text-sm">
                        <span className="w-32 truncate text-gray-700 font-medium">{d.nombre}</span>
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-400 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-24 text-right font-semibold text-gray-800">{fmt(d.total)}</span>
                        <span className="w-10 text-right text-xs text-gray-400">{pct}%</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Resumen de pagos recibidos del mes */}
          {!esJefe && pagosRecibidos?.semanas?.length > 0 && (
            <div className="card mt-2">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <CheckCircle size={15} className="text-emerald-500" />
                  Pagos recibidos — {new Date(pagosRecibidos.anio, pagosRecibidos.mes - 1).toLocaleString('es-CL', { month: 'long', year: 'numeric' })}
                </h2>
                <div className="text-right">
                  <span className="text-xs text-gray-500">Pagado / Liquidado</span>
                  <p className="text-sm font-bold text-emerald-700">
                    {fmt(pagosRecibidos.total_pagado)} <span className="text-gray-400 font-normal">/ {fmt(pagosRecibidos.total_liquidado)}</span>
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {pagosRecibidos.semanas.map(s => (
                  <div key={s.semana} className="flex-1 min-w-[110px] border border-gray-200 rounded-lg px-3 py-2 text-center">
                    <p className="text-xs text-gray-500 mb-1">Semana {s.semana}</p>
                    <p className="text-sm font-semibold text-gray-800">{fmt(s.liquidado)}</p>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded mt-1 inline-block ${ESTADO_COLORS[s.estado] || ESTADO_COLORS.PENDIENTE}`}>
                      {s.estado === 'PAGADO' ? 'Pagado' : s.estado === 'INCOMPLETO' ? 'Incompleto' : 'Pendiente'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {esJefe && filterDriver === 'todos' && (
            <div className="mt-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Resumen por Conductor</h2>
              <div className="card overflow-hidden p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Conductor</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Entregas</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[{ id: user?.entidad_id, nombre: `${user?.nombre} (yo)` }, ...(flota?.subordinados || [])].map((d) => {
                      const dEnvios = envios.filter((e) => e.driver_id === d.id)
                      const dTotal = dEnvios.reduce((acc, e) => acc + envioTotal(e), 0)
                      return (
                        <tr key={d.id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium">{d.nombre}</td>
                          <td className="px-4 py-3 text-right">{dEnvios.length}</td>
                          <td className="px-4 py-3 text-right font-semibold text-emerald-700">{fmt(dTotal)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
