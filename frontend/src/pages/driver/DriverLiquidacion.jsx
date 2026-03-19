import { useState, useEffect } from 'react'
import { Users } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import LiquidacionDetalle from '../../components/LiquidacionDetalle'
import api from '../../api'

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
  const [flota, setFlota] = useState(null)   // { es_jefe, subordinados }
  const [selectedId, setSelectedId] = useState(null)

  // Hacer una llamada inicial para saber si el driver es jefe y obtener su flota
  useEffect(() => {
    if (!driverId) return
    const period = getInitialPeriod()
    api.get('/portal/driver/liquidacion', { params: period })
      .then(({ data }) => {
        if (data.es_jefe && data.subordinados?.length > 0) {
          setFlota({ es_jefe: true, subordinados: data.subordinados })
        }
      })
      .catch(() => {})
  }, [driverId])

  if (!driverId) return (
    <div className="text-center py-12 text-gray-400">No se pudo identificar el conductor.</div>
  )

  const esJefe = flota?.es_jefe
  const subordinados = flota?.subordinados || []

  return (
    <div>
      {esJefe && (
        <div className="mb-4 px-4 pt-4">
          <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
            <Users size={18} className="text-blue-500 flex-shrink-0" />
            <span className="text-sm font-medium text-blue-800">Ver liquidación de:</span>
            <select
              value={selectedId ?? ''}
              onChange={e => setSelectedId(e.target.value ? Number(e.target.value) : null)}
              className="flex-1 text-sm border border-blue-300 rounded-lg px-3 py-1.5 bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="">Mi liquidación (propia)</option>
              {subordinados.map(s => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <LiquidacionDetalle
        tipo="driver"
        entityId={driverId}
        initialPeriod={getInitialPeriod()}
        isPortal={true}
        subDriverId={selectedId}
      />
    </div>
  )
}
