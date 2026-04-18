import { useState, useEffect } from 'react'
import api from '../../api'
import PageHeader from '../../components/PageHeader'
import { DollarSign } from 'lucide-react'
import { fmt } from '../../utils/format'

const MESES = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

export default function TrabajadorPagos() {
  const [pagos, setPagos] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/remuneraciones/portal/pagos')
      .then(({ data }) => setPagos(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const total = pagos.reduce((s, p) => s + (p.monto || 0), 0)

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Cargando...</div>

  return (
    <div>
      <PageHeader
        title="Mis Pagos"
        subtitle="Historial de pagos de sueldo recibidos"
        icon={DollarSign}
        accent="emerald"
        stats={[
          { label: 'Total recibido', value: fmt(total) },
          { label: 'Registros', value: pagos.length },
        ]}
      />

      {pagos.length === 0 ? (
        <div className="card text-center py-12 text-gray-400">
          <DollarSign size={40} className="mx-auto mb-3 opacity-30" />
          <p>No hay pagos registrados aún.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-gray-500 uppercase tracking-wide">
                <th className="text-left pb-3 pr-4">Período</th>
                <th className="text-left pb-3 pr-4">Descripción</th>
                <th className="text-left pb-3 pr-4">Fuente</th>
                <th className="text-right pb-3 pr-4">Monto</th>
                <th className="text-right pb-3">Fecha pago</th>
              </tr>
            </thead>
            <tbody>
              {pagos.map((p) => (
                <tr key={p.id} className="border-b last:border-0 hover:bg-gray-50 transition-colors">
                  <td className="py-3 pr-4 font-medium text-gray-700">
                    {MESES[p.mes]} {p.anio}
                  </td>
                  <td className="py-3 pr-4 text-gray-500">{p.descripcion || '—'}</td>
                  <td className="py-3 pr-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${p.fuente === 'cartola' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-600'}`}>
                      {p.fuente}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-right font-semibold text-emerald-600">{fmt(p.monto)}</td>
                  <td className="py-3 text-right text-gray-500 text-xs">{p.fecha_pago || '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t">
                <td colSpan={3} className="pt-3 text-sm font-semibold text-gray-700">Total recibido</td>
                <td className="pt-3 text-right font-bold text-emerald-700">{fmt(total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
