import { useState, useEffect } from 'react'
import api from '../api'
import PageHeader from './PageHeader'
import PeriodSelector from './PeriodSelector'
import DataTable from './DataTable'

const now = new Date()

export default function PickupDataPage({ title, subtitle, endpoint, columns, emptyMessage, icon, accent = 'blue' }) {
  const [period, setPeriod] = useState({ semana: 1, mes: now.getMonth() + 1, anio: now.getFullYear() })
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.get(endpoint, { params: period })
      .then(({ data }) => setData(data))
      .catch(() => setData([]))
      .finally(() => setLoading(false))
  }, [period, endpoint])

  return (
    <div className="flex flex-col h-full gap-4">
      <PageHeader title={title} subtitle={subtitle} icon={icon} accent={accent} />

      <div className="card">
        <PeriodSelector {...period} onChange={setPeriod} />
      </div>

      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="text-center py-12 text-gray-400">Cargando...</div>
        ) : (
          <DataTable
            columns={columns}
            data={data}
            emptyMessage={emptyMessage}
          />
        )}
      </div>
    </div>
  )
}
