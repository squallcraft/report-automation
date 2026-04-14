import PickupDataPage from '../../components/PickupDataPage'
import { Send } from 'lucide-react'
import { fmt } from '../../utils/format'

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

export default function PickupEnvios() {
  return (
    <PickupDataPage
      title="Mis Envíos"
      subtitle="Envíos emitidos desde tu pickup"
      icon={Send}
      accent="blue"
      endpoint="/pickups/portal/envios-seller"
      columns={columns}
      emptyMessage="No hay envíos en este período"
    />
  )
}
