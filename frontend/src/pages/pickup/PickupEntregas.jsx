import { useState, useEffect } from 'react'
import api from '../../api'
import PeriodSelector from '../../components/PeriodSelector'
import DataTable from '../../components/DataTable'

const fmt = (n) => `$${(n || 0).toLocaleString('es-CL')}`
const now = new Date()

export default function PickupEntregas() {
  const [period, setPeriod] = useState({ semana: 1, mes: now.getMonth() + 1, anio: now.getFullYear() })
  const [entregas, setEntregas] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.get('/pickups/portal/entregas', { params: period })
      .then(({ data }) => setEntregas(data))
      .catch(() => setEntregas([]))
      .finally(() => setLoading(false))
  }, [period])

  const columns = [
    { key: 'fecha_entrega', label: 'Fecha', render: (v) => v ? new Date(v + 'T12:00:00').toLocaleDateString('es-CL') : '—' },
    { key: 'tracking_id', label: 'Tracking', render: (v) => v || '—' },
    { key: 'seller_nombre', label: 'Seller', render: (v) => v || '—' },
    { key: 'comuna', label: 'Comuna', render: (v) => v || '—' },
    { key: 'costo_driver', label: 'Pago', align: 'right', render: (v) => fmt(v) },
  ]

  return (
    <div className="flex flex-col h-full gap-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Mis Entregas</h1>
        <p className="text-sm text-gray-500 mt-1">Entregas realizadas con tu perfil de conductor</p>
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
            data={entregas}
            emptyMessage="No hay entregas en este período"
          />
        )}
      </div>
    </div>
  )
}
