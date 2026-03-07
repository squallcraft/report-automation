import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import api from '../../api'
import PeriodSelector from '../../components/PeriodSelector'
import DataTable from '../../components/DataTable'

const fmt = (n) => `$${(n || 0).toLocaleString('es-CL')}`
const now = new Date()

export default function PickupRecepciones() {
  const { user } = useAuth()
  const [period, setPeriod] = useState({ semana: 1, mes: now.getMonth() + 1, anio: now.getFullYear() })
  const [recepciones, setRecepciones] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.get('/pickups/portal/recepciones', { params: period })
      .then(({ data }) => setRecepciones(data))
      .catch(() => setRecepciones([]))
      .finally(() => setLoading(false))
  }, [period])

  const totalComision = recepciones.reduce((acc, r) => acc + (r.comision || 0), 0)
  const totalIva = Math.round(totalComision * 0.19)

  const columns = [
    { key: 'fecha_recepcion', label: 'Fecha', render: (v) => v ? new Date(v + 'T12:00:00').toLocaleDateString('es-CL') : '—' },
    { key: 'pedido', label: 'Pedido / Tracking' },
    { key: 'tipo', label: 'Tipo', render: (v) => v || '—' },
    { key: 'comision', label: 'Comisión', align: 'right', render: (v) => fmt(v) },
    {
      key: 'envio_id', label: 'Vinculado', align: 'center',
      render: (v) => v ? (
        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Sí</span>
      ) : (
        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">No</span>
      ),
    },
    {
      key: 'procesado', label: 'Estado', align: 'center',
      render: (v) => v ? (
        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Procesado</span>
      ) : (
        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">Pendiente</span>
      ),
    },
  ]

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mis Recepciones</h1>
          <p className="text-sm text-gray-500 mt-1">Paquetes recepcionados en tu punto de pickup</p>
        </div>
      </div>

      <div className="card">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <PeriodSelector {...period} onChange={setPeriod} />
          <div className="text-right">
            <p className="text-xs text-gray-500">{recepciones.length} paquetes</p>
            <p className="text-lg font-bold text-emerald-700">{fmt(totalComision + totalIva)}</p>
            <p className="text-xs text-gray-400">({fmt(totalComision)} + IVA {fmt(totalIva)})</p>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="text-center py-12 text-gray-400">Cargando...</div>
        ) : (
          <DataTable
            columns={columns}
            data={recepciones}
            emptyMessage="No hay recepciones en este período"
          />
        )}
      </div>
    </div>
  )
}
