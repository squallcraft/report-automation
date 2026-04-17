import { useState, useEffect } from 'react'
import api from '../../api'
import PageHeader from '../../components/PageHeader'
import { LayoutDashboard, FileText, CheckCircle, Clock, DollarSign, AlertCircle } from 'lucide-react'
import { fmt } from '../../utils/format'

export default function ColaboradorDashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/colaboradores/portal/dashboard')
      .then(({ data }) => setData(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Cargando...</div>
  if (!data) return <div className="text-center text-gray-400 py-20">Error cargando datos</div>

  const cards = [
    { label: 'Boletas pendientes', value: data.boletas_pendientes, icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50' },
    { label: 'Boletas aprobadas', value: data.boletas_aprobadas, icon: CheckCircle, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Boletas pagadas', value: data.boletas_pagadas, icon: DollarSign, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Total recibido', value: fmt(data.total_pagado), icon: DollarSign, color: 'text-emerald-700', bg: 'bg-emerald-50' },
  ]

  return (
    <div>
      <PageHeader
        title="Mi Portal"
        subtitle={`${data.especialidad || 'Colaborador'} · ${data.frecuencia_pago === 'mensual' ? 'Pago mensual' : data.frecuencia_pago}`}
        icon={LayoutDashboard}
        accent="purple"
        stats={data.monto_acordado ? [{ label: 'Monto acordado', value: fmt(data.monto_acordado) }] : undefined}
      />

      {/* Contrato vigente */}
      <div className="card mb-6">
        <div className="flex items-center gap-2 mb-3">
          <FileText size={16} className="text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-700">Mi contrato</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-gray-400 text-xs block">Inicio</span>
            <span className="font-medium">{data.fecha_inicio || '—'}</span>
          </div>
          <div>
            <span className="text-gray-400 text-xs block">Fin</span>
            <span className="font-medium">{data.fecha_fin || 'Indefinido'}</span>
          </div>
          <div>
            <span className="text-gray-400 text-xs block">Frecuencia</span>
            <span className="font-medium capitalize">{data.frecuencia_pago}</span>
          </div>
          <div>
            <span className="text-gray-400 text-xs block">Monto acordado</span>
            <span className="font-medium">{data.monto_acordado ? fmt(data.monto_acordado) : 'Variable'}</span>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c, i) => (
          <div key={i} className="card flex items-center gap-4">
            <div className={`w-10 h-10 rounded-xl ${c.bg} flex items-center justify-center`}>
              <c.icon size={18} className={c.color} />
            </div>
            <div>
              <p className="text-lg font-bold text-gray-800">{c.value}</p>
              <p className="text-xs text-gray-500">{c.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Next steps */}
      {data.boletas_pendientes === 0 && data.boletas_aprobadas === 0 && data.boletas_pagadas === 0 && (
        <div className="mt-6 p-6 rounded-xl border-2 border-dashed border-gray-200 text-center">
          <AlertCircle size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm text-gray-500">No has subido boletas aún. Ve a <strong>Mis Boletas</strong> para subir tu primera boleta.</p>
        </div>
      )}
    </div>
  )
}
