import { useAuth } from '../../context/AuthContext'
import LiquidacionDetalle from '../../components/LiquidacionDetalle'

const now = new Date()
const DRIVER_MIN_PERIOD = { semana: 4, mes: 2, anio: 2026 }

function getInitialPeriod() {
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  if (y < 2026 || (y === 2026 && m < 2)) return DRIVER_MIN_PERIOD
  if (y === 2026 && m === 2) return { semana: 4, mes: 2, anio: 2026 }
  return { semana: 1, mes: m, anio: y }
}

export default function DriverLiquidacion() {
  const { user } = useAuth()
  const driverId = user?.entidad_id

  if (!driverId) return (
    <div className="text-center py-12 text-gray-400">No se pudo identificar el conductor.</div>
  )

  return (
    <LiquidacionDetalle
      tipo="driver"
      entityId={driverId}
      initialPeriod={getInitialPeriod()}
      isPortal={true}
    />
  )
}
