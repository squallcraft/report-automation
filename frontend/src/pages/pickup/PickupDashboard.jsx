import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import api from '../../api'
import StatsCard from '../../components/StatsCard'
import PageHeader from '../../components/PageHeader'
import { Package, DollarSign, TrendingUp, Truck, ArrowUpRight, ArrowDownRight, Minus, LayoutDashboard } from 'lucide-react'
import { fmt } from '../../utils/format'

const now = new Date()

function TrendBadge({ value }) {
  if (value === null || value === undefined) return null
  const isUp = value > 0
  const isZero = value === 0
  const Icon = isZero ? Minus : isUp ? ArrowUpRight : ArrowDownRight
  const color = isZero ? 'text-gray-400' : isUp ? 'text-emerald-600' : 'text-red-500'
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${color}`}>
      <Icon size={12} />
      {Math.abs(value)}%
    </span>
  )
}

export default function PickupDashboard() {
  const { user } = useAuth()
  const [mes, setMes] = useState(now.getMonth() + 1)
  const [anio, setAnio] = useState(now.getFullYear())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.get('/pickups/portal/dashboard', { params: { mes, anio } })
      .then(({ data }) => setData(data))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [mes, anio])

  if (loading) return <div className="text-center py-12 text-gray-400">Cargando...</div>

  const mesNombre = data ? new Date(data.anio, data.mes - 1).toLocaleString('es-CL', { month: 'long', year: 'numeric' }) : ''
  const cmp = data?.comparacion || {}

  return (
    <div>
      <PageHeader
        title={`Hola, ${user?.nombre}`}
        subtitle="Tu panel de control"
        icon={LayoutDashboard}
        accent="teal"
        actions={(
          <div className="flex items-center gap-2">
            <select className="input-field text-xs sm:text-sm py-1.5 w-28 sm:w-auto" value={mes} onChange={e => setMes(+e.target.value)}>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {new Date(anio, i).toLocaleString('es-CL', { month: 'long' })}
                </option>
              ))}
            </select>
            <select className="input-field text-xs sm:text-sm py-1.5 w-20 sm:w-auto" value={anio} onChange={e => setAnio(+e.target.value)}>
              {[2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        )}
      />

      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
            <StatsCard
              icon={Package}
              label="Paquetes recibidos"
              value={data.total_paquetes}
              color="primary"
              extra={<TrendBadge value={cmp.paquetes} />}
            />
            <StatsCard
              icon={DollarSign}
              label="Comisiones netas"
              value={fmt(data.total_comision_neto)}
              color="green"
              extra={<TrendBadge value={cmp.comision} />}
            />
            {data.driver_id && (
              <StatsCard
                icon={Truck}
                label={`Entregas (${data.cantidad_entregas})`}
                value={fmt(data.ganancias_driver)}
                color="purple"
                extra={<TrendBadge value={cmp.entregas} />}
              />
            )}
            <StatsCard
              icon={TrendingUp}
              label="Balance neto"
              value={fmt(data.balance_neto)}
              color={data.balance_neto >= 0 ? 'green' : 'red'}
              extra={<TrendBadge value={cmp.balance} />}
            />
          </div>

          {/* Balance financiero completo */}
          <div className="card mb-4 sm:mb-6">
            <h2 className="text-xs sm:text-sm font-semibold text-gray-700 mb-3 sm:mb-4">Balance financiero — {mesNombre}</h2>
            <div className="space-y-1.5 sm:space-y-2 text-xs sm:text-sm">
              <div className="flex justify-between gap-2 py-1.5">
                <span className="text-gray-600 min-w-0">Comisiones ({data.total_paquetes} paq.)</span>
                <span className="font-medium text-emerald-700 shrink-0">+{fmt(data.total_comision_neto)}</span>
              </div>
              {data.auto_entregas > 0 && (
                <div className="flex justify-between gap-2 py-1.5 text-gray-400">
                  <span className="min-w-0">Auto-entregas (sin comisión)</span>
                  <span className="shrink-0">{data.auto_entregas} paq.</span>
                </div>
              )}
              {data.driver_id && data.ganancias_driver > 0 && (
                <div className="flex justify-between gap-2 py-1.5">
                  <span className="text-gray-600 min-w-0">Entregas ({data.cantidad_entregas} envíos)</span>
                  <span className="font-medium text-emerald-700 shrink-0">+{fmt(data.ganancias_driver)}</span>
                </div>
              )}
              {data.cargo_envios > 0 && (
                <>
                  <div className="border-t border-gray-100 pt-2 mt-2">
                    <div className="flex justify-between gap-2 py-1.5">
                      <span className="text-gray-600 min-w-0">Cargos envíos ({data.cantidad_envios_seller})</span>
                      <span className="font-medium text-red-600 shrink-0">-{fmt(data.cargo_envios)}</span>
                    </div>
                    {data.cargo_extras_producto > 0 && (
                      <div className="flex justify-between gap-2 py-1 pl-3 sm:pl-4 text-[10px] sm:text-xs text-gray-400">
                        <span>Extra producto</span><span className="shrink-0">-{fmt(data.cargo_extras_producto)}</span>
                      </div>
                    )}
                    {data.cargo_extras_comuna > 0 && (
                      <div className="flex justify-between gap-2 py-1 pl-3 sm:pl-4 text-[10px] sm:text-xs text-gray-400">
                        <span>Extra comuna</span><span className="shrink-0">-{fmt(data.cargo_extras_comuna)}</span>
                      </div>
                    )}
                    {data.cargo_extras_manual > 0 && (
                      <div className="flex justify-between gap-2 py-1 pl-3 sm:pl-4 text-[10px] sm:text-xs text-gray-400">
                        <span>Extra manual</span><span className="shrink-0">-{fmt(data.cargo_extras_manual)}</span>
                      </div>
                    )}
                    {data.cargo_retiros_seller > 0 && (
                      <div className="flex justify-between gap-2 py-1 pl-3 sm:pl-4 text-[10px] sm:text-xs text-gray-400">
                        <span>Retiros seller</span><span className="shrink-0">-{fmt(data.cargo_retiros_seller)}</span>
                      </div>
                    )}
                  </div>
                </>
              )}
              <div className="border-t-2 border-gray-200 pt-3 mt-3 flex justify-between gap-2">
                <span className="font-semibold text-gray-900">Balance neto</span>
                <span className={`text-base sm:text-lg font-bold shrink-0 ${data.balance_neto >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                  {fmt(data.balance_neto)}
                </span>
              </div>
              {data.total_comision_iva > 0 && (
                <div className="flex justify-between gap-2 py-1 text-[10px] sm:text-xs text-gray-400">
                  <span>IVA comisiones (referencial)</span>
                  <span className="shrink-0">+{fmt(data.total_comision_iva)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Desglose semanal */}
          {data.semanas?.length > 0 && (
            <div className="card mb-4 sm:mb-6">
              <h2 className="text-sm sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">Recepciones por semana — {mesNombre}</h2>
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <table className="w-full text-xs sm:text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-3 sm:px-4 py-2 sm:py-3 font-medium text-gray-600">Semana</th>
                      <th className="text-right px-2 sm:px-4 py-2 sm:py-3 font-medium text-gray-600">Paq</th>
                      <th className="text-right px-2 sm:px-4 py-2 sm:py-3 font-medium text-gray-600">Neta</th>
                      <th className="text-right px-2 sm:px-4 py-2 sm:py-3 font-medium text-gray-600">IVA</th>
                      <th className="text-right px-2 sm:px-4 py-2 sm:py-3 font-medium text-gray-600">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.semanas.map((s) => {
                      const iva = Math.round(s.comision * 0.19)
                      return (
                        <tr key={s.semana} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="px-3 sm:px-4 py-2 sm:py-3 font-medium whitespace-nowrap">Sem {s.semana}</td>
                          <td className="px-2 sm:px-4 py-2 sm:py-3 text-right">{s.paquetes}</td>
                          <td className="px-2 sm:px-4 py-2 sm:py-3 text-right">{fmt(s.comision)}</td>
                          <td className="px-2 sm:px-4 py-2 sm:py-3 text-right text-gray-500">{fmt(iva)}</td>
                          <td className="px-2 sm:px-4 py-2 sm:py-3 text-right font-semibold text-emerald-700">{fmt(s.comision + iva)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 font-semibold">
                      <td className="px-3 sm:px-4 py-2 sm:py-3">Total</td>
                      <td className="px-2 sm:px-4 py-2 sm:py-3 text-right">{data.total_paquetes}</td>
                      <td className="px-2 sm:px-4 py-2 sm:py-3 text-right">{fmt(data.total_comision_neto)}</td>
                      <td className="px-2 sm:px-4 py-2 sm:py-3 text-right text-gray-500">{fmt(data.total_comision_iva)}</td>
                      <td className="px-2 sm:px-4 py-2 sm:py-3 text-right text-emerald-700">{fmt(data.total_comision)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Historial de pagos */}
          {(data.pagos_recibidos?.length > 0 || data.pagos_emitidos?.length > 0) && (
            <div className="card">
              <h2 className="text-sm sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">Historial de pagos — {mesNombre}</h2>
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <table className="w-full text-xs sm:text-sm min-w-[480px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-3 sm:px-4 py-2 sm:py-3 font-medium text-gray-600">Fecha</th>
                      <th className="text-left px-2 sm:px-4 py-2 sm:py-3 font-medium text-gray-600">Tipo</th>
                      <th className="text-left px-2 sm:px-4 py-2 sm:py-3 font-medium text-gray-600 hidden sm:table-cell">Descripción</th>
                      <th className="text-left px-2 sm:px-4 py-2 sm:py-3 font-medium text-gray-600 hidden sm:table-cell">Fuente</th>
                      <th className="text-right px-3 sm:px-4 py-2 sm:py-3 font-medium text-gray-600">Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...(data.pagos_recibidos || []), ...(data.pagos_emitidos || [])]
                      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
                      .map((p, i) => (
                        <tr key={`${p.tipo}-${p.id}`} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="px-3 sm:px-4 py-2 sm:py-3 whitespace-nowrap">{p.fecha || '—'}</td>
                          <td className="px-2 sm:px-4 py-2 sm:py-3">
                            <span className={`inline-flex px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-medium ${
                              p.tipo === 'recibido' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                            }`}>
                              {p.tipo === 'recibido' ? 'Recibido' : 'Cobro'}
                            </span>
                          </td>
                          <td className="px-2 sm:px-4 py-2 sm:py-3 text-gray-600 hidden sm:table-cell">{p.descripcion || '—'}</td>
                          <td className="px-2 sm:px-4 py-2 sm:py-3 text-gray-500 text-xs hidden sm:table-cell">{p.fuente}</td>
                          <td className={`px-3 sm:px-4 py-2 sm:py-3 text-right font-medium whitespace-nowrap ${p.tipo === 'recibido' ? 'text-emerald-700' : 'text-red-600'}`}>
                            {p.tipo === 'recibido' ? '+' : '-'}{fmt(p.monto)}
                          </td>
                        </tr>
                      ))}
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
