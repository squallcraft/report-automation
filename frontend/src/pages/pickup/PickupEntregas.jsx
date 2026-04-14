import PickupDataPage from '../../components/PickupDataPage'
import { Truck } from 'lucide-react'
import { fmt } from '../../utils/format'

const columns = [
  { key: 'fecha_entrega', label: 'Fecha', render: (v) => v ? new Date(v + 'T12:00:00').toLocaleDateString('es-CL') : '—' },
  { key: 'tracking_id', label: 'Tracking', render: (v) => v || '—' },
  { key: 'seller_nombre', label: 'Seller', render: (v) => v || '—' },
  { key: 'comuna', label: 'Comuna', render: (v) => v || '—' },
  { key: 'costo_driver', label: 'Pago', align: 'right', render: (v) => fmt(v) },
]

export default function PickupEntregas() {
  return (
    <PickupDataPage
      title="Mis Entregas"
      subtitle="Entregas realizadas con tu perfil de conductor"
      icon={Truck}
      accent="purple"
      endpoint="/pickups/portal/entregas"
      columns={columns}
      emptyMessage="No hay entregas en este período"
    />
  )
}
