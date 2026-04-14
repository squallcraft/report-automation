import { useState, useEffect } from 'react'
import api from '../../api'
import PageHeader from '../../components/PageHeader'
import PeriodSelector from '../../components/PeriodSelector'
import { Package } from 'lucide-react'
import { fmt, fmtDateLong, IVA_RATE } from '../../utils/format'

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
  const totalIva = Math.round(totalComision * IVA_RATE)

  return (
    <div className="flex flex-col h-full gap-3 sm:gap-4">
      <PageHeader
        title="Mis Recepciones"
        subtitle="Historial de recepciones por período"
        icon={Package}
        accent="teal"
      />

      <div className="card">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <PeriodSelector {...period} onChange={setPeriod} />
          <div className="text-right">
            <p className="text-xs text-gray-500">{totalPaquetes} paquetes</p>
            <p className="text-base sm:text-lg font-bold text-emerald-700">{fmt(totalComision + totalIva)}</p>
            <p className="text-[10px] sm:text-xs text-gray-400">({fmt(totalComision)} + IVA {fmt(totalIva)})</p>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        {loading ? (
          <div className="text-center py-12 text-gray-400">Cargando...</div>
        ) : dias.length === 0 ? (
          <div className="text-center py-12 text-gray-400">No hay recepciones en este período</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="bg-[#1e3a5f]">
                  <th className="px-3 sm:px-5 py-2.5 sm:py-3 text-left text-[10px] sm:text-[11px] font-semibold text-white uppercase tracking-wider">Día</th>
                  <th className="px-2 sm:px-5 py-2.5 sm:py-3 text-center text-[10px] sm:text-[11px] font-semibold text-white uppercase tracking-wider">Paq</th>
                  <th className="px-2 sm:px-5 py-2.5 sm:py-3 text-right text-[10px] sm:text-[11px] font-semibold text-white uppercase tracking-wider">Neta</th>
                  <th className="px-2 sm:px-5 py-2.5 sm:py-3 text-right text-[10px] sm:text-[11px] font-semibold text-white uppercase tracking-wider">IVA</th>
                  <th className="px-2 sm:px-5 py-2.5 sm:py-3 text-right text-[10px] sm:text-[11px] font-semibold text-white uppercase tracking-wider">Total</th>
                </tr>
              </thead>
              <tbody>
                {dias.map((d, idx) => {
                  const iva = Math.round((d.comision || 0) * IVA_RATE)
                  return (
                    <tr key={d.fecha || idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                      <td className="px-3 sm:px-5 py-2 sm:py-3 text-gray-800 font-medium whitespace-nowrap">{fmtDateLong(d.fecha)}</td>
                      <td className="px-2 sm:px-5 py-2 sm:py-3 text-center text-gray-700">{d.paquetes || 0}</td>
                      <td className="px-2 sm:px-5 py-2 sm:py-3 text-right text-gray-700">{fmt(d.comision)}</td>
                      <td className="px-2 sm:px-5 py-2 sm:py-3 text-right text-gray-500">{fmt(iva)}</td>
                      <td className="px-2 sm:px-5 py-2 sm:py-3 text-right font-semibold text-gray-800">{fmt((d.comision || 0) + iva)}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[#1e3a5f] bg-gray-50 font-semibold">
                  <td className="px-3 sm:px-5 py-2 sm:py-3 text-gray-800">Total</td>
                  <td className="px-2 sm:px-5 py-2 sm:py-3 text-center text-gray-800">{totalPaquetes}</td>
                  <td className="px-2 sm:px-5 py-2 sm:py-3 text-right text-gray-800">{fmt(totalComision)}</td>
                  <td className="px-2 sm:px-5 py-2 sm:py-3 text-right text-gray-600">{fmt(totalIva)}</td>
                  <td className="px-2 sm:px-5 py-2 sm:py-3 text-right text-emerald-700">{fmt(totalComision + totalIva)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
