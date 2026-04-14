import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import api from '../../api'
import PeriodSelector from '../../components/PeriodSelector'
import StatsCard from '../../components/StatsCard'
import PageHeader from '../../components/PageHeader'
import { Package, DollarSign, FileText, TrendingUp, LayoutDashboard } from 'lucide-react'

const fmt = (n) => `$${(n || 0).toLocaleString('es-CL')}`
const now = new Date()

export default function SellerDashboard() {
  const { user } = useAuth()
  const [period, setPeriod] = useState({ semana: 1, mes: now.getMonth() + 1, anio: now.getFullYear() })
  const [envios, setEnvios] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.get('/envios', { params: { ...period } })
      .then(({ data }) => setEnvios(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [period])

  const totalCobro = envios.reduce((acc, e) => acc + e.cobro_seller + e.extra_producto_seller + e.extra_comuna_seller, 0)

  return (
    <div>
      <PageHeader
        title={`Hola, ${user?.nombre}`}
        subtitle="Tu panel de control"
        icon={LayoutDashboard}
        accent="blue"
      />

      <div className="card mb-6">
        <PeriodSelector {...period} onChange={setPeriod} />
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Cargando...</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <StatsCard icon={Package} label="Envíos" value={envios.length} color="primary" />
          <StatsCard icon={DollarSign} label="Total Cobrado" value={fmt(totalCobro)} color="amber" />
          <StatsCard icon={TrendingUp} label="Promedio por Envío" value={envios.length > 0 ? fmt(Math.round(totalCobro / envios.length)) : '$0'} color="green" />
        </div>
      )}
    </div>
  )
}
