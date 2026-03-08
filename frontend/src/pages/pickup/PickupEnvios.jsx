import { useState, useEffect } from 'react'
import api from '../../api'
import PeriodSelector from '../../components/PeriodSelector'
import DataTable from '../../components/DataTable'

const fmt = (n) => `$${(n || 0).toLocaleString('es-CL')}`
const now = new Date()

export default function PickupEnvios() {
  const [period, setPeriod] = useState({ semana: 1, mes: now.getMonth() + 1, anio: now.getFullYear() })
  const [envios, setEnvios] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.get('/pickups/portal/envios-seller', { params: period })
      .then(({ data }) => setEnvios(data))
      .catch(() => setEnvios([]))
      .finally(() => setLoading(false))
  }, [period])

  const columns = [
    { key: 'fecha_entrega', label: 'Fecha', render: (v) => v ? new Date(v + 'T12:00:00').toLocaleDateString('es-CL') : '—' },
    { key: 'tracking_id', label: 'Tracking', render: (v) => v || '—' },
    { key: 'comuna', label: 'Comuna', render: (v) => v || '—' },
    { key: 'cobro_seller', label: 'Tarifa base', align: 'right', render: (v) => fmt(v) },
    { key: 'extra_producto_seller', label: 'Extra producto', align: 'right', render: (v) => v ? fmt(v) : '—' },
    { key: 'extra_comuna_seller', label: 'Extra comuna', align: 'right', render: (v) => v ? fmt(v) : '—' },
    { key: 'cobro_extra_manual', label: 'Extra manual', align: 'right', render: (v) => v ? fmt(v) : '—' },
    { key: '_total', label: 'Total', align: 'right', render: (_, row) =>
      fmt((row.cobro_seller || 0) + (row.extra_producto_seller || 0) + (row.extra_comuna_seller || 0) + (row.cobro_extra_manual || 0))
    },
  ]

  return (
    <div className="flex flex-col h-full gap-4">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Mis Envíos</h1>
        <p className="text-xs sm:text-sm text-gray-500 mt-1">Envíos emitidos desde tu pickup</p>
      </div>

      <div className="card">
        <PeriodSelector {...period} onChange={setPeriod} />
      </div>

      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="text-center py-12 text-gray-400">Cargando...</div>
        ) : (
          <DataTable
            columns={columns}
            data={envios}
            emptyMessage="No hay envíos en este período"
          />
        )}
      </div>
    </div>
  )
}
