import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import api from '../../api'
import StatsCard from '../../components/StatsCard'
import { Package, DollarSign, TrendingUp, Truck, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react'

const fmt = (n) => `$${(n || 0).toLocaleString('es-CL')}`
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
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Hola, {user?.nombre}</h1>
          <p className="text-sm text-gray-500 mt-1">Resumen financiero del pickup</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="input-field text-sm py-1.5" value={mes} onChange={e => setMes(+e.target.value)}>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {new Date(2026, i).toLocaleString('es-CL', { month: 'long' })}
              </option>
            ))}
          </select>
          <select className="input-field text-sm py-1.5" value={anio} onChange={e => setAnio(+e.target.value)}>
            {[2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

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
          <div className="card mb-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Balance financiero — {mesNombre}</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between py-1.5">
                <span className="text-gray-600">Comisiones por recepción ({data.total_paquetes} paquetes)</span>
                <span className="font-medium text-emerald-700">+{fmt(data.total_comision_neto)}</span>
              </div>
              {data.auto_entregas > 0 && (
                <div className="flex justify-between py-1.5 text-gray-400">
                  <span>Auto-entregas (sin comisión)</span>
                  <span>{data.auto_entregas} paquetes</span>
                </div>
              )}
              {data.driver_id && data.ganancias_driver > 0 && (
                <div className="flex justify-between py-1.5">
                  <span className="text-gray-600">Ganancias por entregas ({data.cantidad_entregas} envíos)</span>
                  <span className="font-medium text-emerald-700">+{fmt(data.ganancias_driver)}</span>
                </div>
              )}
              {data.cargo_envios > 0 && (
                <>
                  <div className="border-t border-gray-100 pt-2 mt-2">
                    <div className="flex justify-between py-1.5">
                      <span className="text-gray-600">Cargos por envíos emitidos ({data.cantidad_envios_seller})</span>
                      <span className="font-medium text-red-600">-{fmt(data.cargo_envios)}</span>
                    </div>
                    {data.cargo_extras_producto > 0 && (
                      <div className="flex justify-between py-1 pl-4 text-xs text-gray-400">
                        <span>Extra producto</span><span>-{fmt(data.cargo_extras_producto)}</span>
                      </div>
                    )}
                    {data.cargo_extras_comuna > 0 && (
                      <div className="flex justify-between py-1 pl-4 text-xs text-gray-400">
                        <span>Extra comuna</span><span>-{fmt(data.cargo_extras_comuna)}</span>
                      </div>
                    )}
                    {data.cargo_extras_manual > 0 && (
                      <div className="flex justify-between py-1 pl-4 text-xs text-gray-400">
                        <span>Extra manual</span><span>-{fmt(data.cargo_extras_manual)}</span>
                      </div>
                    )}
                    {data.cargo_retiros_seller > 0 && (
                      <div className="flex justify-between py-1 pl-4 text-xs text-gray-400">
                        <span>Retiros seller</span><span>-{fmt(data.cargo_retiros_seller)}</span>
                      </div>
                    )}
                  </div>
                </>
              )}
              <div className="border-t-2 border-gray-200 pt-3 mt-3 flex justify-between">
                <span className="font-semibold text-gray-900">Balance neto</span>
                <span className={`text-lg font-bold ${data.balance_neto >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                  {fmt(data.balance_neto)}
                </span>
              </div>
              {data.total_comision_iva > 0 && (
                <div className="flex justify-between py-1 text-xs text-gray-400">
                  <span>IVA comisiones (referencial)</span>
                  <span>+{fmt(data.total_comision_iva)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Desglose semanal */}
          {data.semanas?.length > 0 && (
            <div className="card mb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Recepciones por semana — {mesNombre}</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Semana</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Paquetes</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Comisión neta</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">IVA</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.semanas.map((s) => {
                      const iva = Math.round(s.comision * 0.19)
                      return (
                        <tr key={s.semana} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium">Semana {s.semana}</td>
                          <td className="px-4 py-3 text-right">{s.paquetes}</td>
                          <td className="px-4 py-3 text-right">{fmt(s.comision)}</td>
                          <td className="px-4 py-3 text-right text-gray-500">{fmt(iva)}</td>
                          <td className="px-4 py-3 text-right font-semibold text-emerald-700">{fmt(s.comision + iva)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 font-semibold">
                      <td className="px-4 py-3">Total</td>
                      <td className="px-4 py-3 text-right">{data.total_paquetes}</td>
                      <td className="px-4 py-3 text-right">{fmt(data.total_comision_neto)}</td>
                      <td className="px-4 py-3 text-right text-gray-500">{fmt(data.total_comision_iva)}</td>
                      <td className="px-4 py-3 text-right text-emerald-700">{fmt(data.total_comision)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Historial de pagos */}
          {(data.pagos_recibidos?.length > 0 || data.pagos_emitidos?.length > 0) && (
            <div className="card">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Historial de pagos — {mesNombre}</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Fecha</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Tipo</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Descripción</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Fuente</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.pagos_recibidos, ...data.pagos_emitidos]
                      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
                      .map((p, i) => (
                        <tr key={`${p.tipo}-${p.id}`} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="px-4 py-3">{p.fecha || '—'}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                              p.tipo === 'recibido' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                            }`}>
                              {p.tipo === 'recibido' ? 'Pago recibido' : 'Cobro emitido'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-600">{p.descripcion || '—'}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs">{p.fuente}</td>
                          <td className={`px-4 py-3 text-right font-medium ${p.tipo === 'recibido' ? 'text-emerald-700' : 'text-red-600'}`}>
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
