import { useState, useEffect } from 'react'
import api from '../../api'
import PeriodSelector from '../../components/PeriodSelector'

const fmt = (n) => `$${(n || 0).toLocaleString('es-CL')}`
const now = new Date()

export default function PickupRecepciones() {
  const [period, setPeriod] = useState({ semana: 1, mes: now.getMonth() + 1, anio: now.getFullYear() })
  const [dias, setDias] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.get('/pickups/portal/recepciones', { params: period })
      .then(({ data }) => setDias(Array.isArray(data) ? data : []))
      .catch(() => setDias([]))
      .finally(() => setLoading(false))
  }, [period])

  const totalPaquetes = dias.reduce((acc, d) => acc + (d.paquetes || 0), 0)
  const totalComision = dias.reduce((acc, d) => acc + (d.comision || 0), 0)
  const totalIva = Math.round(totalComision * 0.19)

  const fmtDate = (d) => {
    if (!d) return '—'
    const date = new Date(d + 'T12:00:00')
    return date.toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short' })
  }

  return (
    <div className="flex flex-col h-full gap-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Mis Recepciones</h1>
        <p className="text-sm text-gray-500 mt-1">Resumen diario de paquetes recepcionados</p>
      </div>

      <div className="card">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <PeriodSelector {...period} onChange={setPeriod} />
          <div className="text-right">
            <p className="text-xs text-gray-500">{totalPaquetes} paquetes</p>
            <p className="text-lg font-bold text-emerald-700">{fmt(totalComision + totalIva)}</p>
            <p className="text-xs text-gray-400">({fmt(totalComision)} + IVA {fmt(totalIva)})</p>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        {loading ? (
          <div className="text-center py-12 text-gray-400">Cargando...</div>
        ) : dias.length === 0 ? (
          <div className="text-center py-12 text-gray-400">No hay recepciones en este período</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#1e3a5f]">
                <th className="px-5 py-3 text-left text-[11px] font-semibold text-white uppercase tracking-wider">Día</th>
                <th className="px-5 py-3 text-center text-[11px] font-semibold text-white uppercase tracking-wider">Paquetes</th>
                <th className="px-5 py-3 text-right text-[11px] font-semibold text-white uppercase tracking-wider">Comisión Neta</th>
                <th className="px-5 py-3 text-right text-[11px] font-semibold text-white uppercase tracking-wider">IVA</th>
                <th className="px-5 py-3 text-right text-[11px] font-semibold text-white uppercase tracking-wider">Total</th>
              </tr>
            </thead>
            <tbody>
              {dias.map((d, idx) => {
                const iva = Math.round((d.comision || 0) * 0.19)
                return (
                  <tr key={d.fecha || idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                    <td className="px-5 py-3 text-sm text-gray-800 font-medium">{fmtDate(d.fecha)}</td>
                    <td className="px-5 py-3 text-sm text-center text-gray-700">{d.paquetes || 0}</td>
                    <td className="px-5 py-3 text-sm text-right text-gray-700">{fmt(d.comision)}</td>
                    <td className="px-5 py-3 text-sm text-right text-gray-500">{fmt(iva)}</td>
                    <td className="px-5 py-3 text-sm text-right font-semibold text-gray-800">{fmt((d.comision || 0) + iva)}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[#1e3a5f] bg-gray-50 font-semibold">
                <td className="px-5 py-3 text-sm text-gray-800">Total</td>
                <td className="px-5 py-3 text-sm text-center text-gray-800">{totalPaquetes}</td>
                <td className="px-5 py-3 text-sm text-right text-gray-800">{fmt(totalComision)}</td>
                <td className="px-5 py-3 text-sm text-right text-gray-600">{fmt(totalIva)}</td>
                <td className="px-5 py-3 text-sm text-right text-emerald-700">{fmt(totalComision + totalIva)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  )
}
