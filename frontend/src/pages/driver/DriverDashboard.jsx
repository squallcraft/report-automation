import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import api from '../../api'
import PeriodSelector from '../../components/PeriodSelector'
import StatsCard from '../../components/StatsCard'
import { Truck, DollarSign, TrendingUp, Users } from 'lucide-react'

const fmt = (n) => `$${(n || 0).toLocaleString('es-CL')}`
const now = new Date()

export default function DriverDashboard() {
  const { user } = useAuth()
  const [period, setPeriod] = useState({ semana: 1, mes: now.getMonth() + 1, anio: now.getFullYear() })
  const [envios, setEnvios] = useState([])
  const [flota, setFlota] = useState(null)
  const [filterDriver, setFilterDriver] = useState('todos')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/drivers/mi-flota/info')
      .then(({ data }) => setFlota(data))
      .catch(() => setFlota({ es_jefe_flota: false, subordinados: [] }))
  }, [])

  useEffect(() => {
    setLoading(true)
    api.get('/envios', { params: period })
      .then(({ data }) => setEnvios(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [period])

  const filtered = filterDriver === 'todos'
    ? envios
    : filterDriver === 'mis'
      ? envios.filter((e) => e.driver_id === user?.entidad_id)
      : envios.filter((e) => e.driver_id === parseInt(filterDriver, 10))

  const totalPago = filtered.reduce((acc, e) => acc + e.costo_driver + e.extra_producto_driver + e.extra_comuna_driver, 0)

  const esJefe = flota?.es_jefe_flota

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Hola, {user?.nombre}</h1>
        <p className="text-sm text-gray-500 mt-1">
          {esJefe ? 'Resumen de tu flota y entregas' : 'Resumen de tus entregas y pagos'}
        </p>
      </div>

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
            <StatsCard icon={Truck} label="Entregas" value={filtered.length} color="primary" />
            <StatsCard icon={DollarSign} label="Total a Recibir" value={fmt(totalPago)} color="green" />
            <StatsCard icon={TrendingUp} label="Promedio por Entrega" value={filtered.length > 0 ? fmt(Math.round(totalPago / filtered.length)) : '$0'} color="purple" />
            {esJefe && (
              <StatsCard icon={Users} label="Conductores" value={flota.subordinados.length + 1} color="amber" />
            )}
          </div>

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
                      const dTotal = dEnvios.reduce((acc, e) => acc + e.costo_driver + e.extra_producto_driver + e.extra_comuna_driver, 0)
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
