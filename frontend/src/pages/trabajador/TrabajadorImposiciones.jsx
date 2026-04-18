import { useState, useEffect } from 'react'
import api from '../../api'
import PageHeader from '../../components/PageHeader'
import { ShieldCheck, TrendingUp } from 'lucide-react'
import { fmt } from '../../utils/format'

const MESES = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

export default function TrabajadorImposiciones() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/remuneraciones/portal/imposiciones')
      .then(({ data }) => setData(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Cargando...</div>
  if (!data) return <div className="text-center text-gray-400 py-20">Error cargando datos</div>

  const { meses, totales_periodo } = data
  const totalImponible = meses.reduce((s, m) => s + (m.remuneracion_imponible || 0), 0)

  return (
    <div>
      <PageHeader
        title="Mis Imposiciones"
        subtitle="Descuentos previsionales mensuales (AFP, Salud, Cesantía, IUSC)"
        icon={ShieldCheck}
        accent="purple"
        stats={[
          { label: 'AFP acumulado', value: fmt(totales_periodo.afp) },
          { label: 'Salud acumulado', value: fmt(totales_periodo.salud) },
          { label: 'Cesantía acumulado', value: fmt(totales_periodo.cesantia) },
          ...(totales_periodo.iusc > 0 ? [{ label: 'IUSC acumulado', value: fmt(totales_periodo.iusc) }] : []),
        ]}
      />

      {meses.length === 0 ? (
        <div className="card text-center py-12 text-gray-400">
          <ShieldCheck size={40} className="mx-auto mb-3 opacity-30" />
          <p>No hay liquidaciones con imposiciones registradas aún.</p>
        </div>
      ) : (
        <>
          {/* Totales acumulados */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Total AFP', value: totales_periodo.afp, color: 'bg-blue-50 text-blue-700' },
              { label: 'Total Salud', value: totales_periodo.salud, color: 'bg-emerald-50 text-emerald-700' },
              { label: 'Total Cesantía', value: totales_periodo.cesantia, color: 'bg-amber-50 text-amber-700' },
              { label: 'Total IUSC', value: totales_periodo.iusc, color: 'bg-red-50 text-red-700' },
            ].map((c) => (
              <div key={c.label} className={`rounded-xl p-4 ${c.color}`}>
                <p className="text-xs opacity-70 mb-1">{c.label}</p>
                <p className="font-bold text-lg">{fmt(c.value)}</p>
              </div>
            ))}
          </div>

          {/* Detalle mensual */}
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-gray-500 uppercase tracking-wide">
                  <th className="text-left pb-3 pr-4">Período</th>
                  <th className="text-right pb-3 pr-4">Imponible</th>
                  <th className="text-right pb-3 pr-4 text-blue-600">AFP</th>
                  <th className="text-right pb-3 pr-4 text-emerald-600">Salud 7%</th>
                  <th className="text-right pb-3 pr-4 text-emerald-500">Adic. Isapre</th>
                  <th className="text-right pb-3 pr-4 text-amber-600">Cesantía</th>
                  <th className="text-right pb-3 pr-4 text-red-500">IUSC</th>
                  <th className="text-right pb-3">Total desc.</th>
                </tr>
              </thead>
              <tbody>
                {meses.map((m, i) => (
                  <tr key={i} className="border-b last:border-0 hover:bg-gray-50 transition-colors">
                    <td className="py-3 pr-4 font-medium text-gray-700">
                      {MESES[m.mes]} {m.anio}
                    </td>
                    <td className="py-3 pr-4 text-right text-gray-600">{fmt(m.remuneracion_imponible)}</td>
                    <td className="py-3 pr-4 text-right text-blue-600">{fmt(m.descuento_afp)}</td>
                    <td className="py-3 pr-4 text-right text-emerald-600">{fmt(m.descuento_salud_legal)}</td>
                    <td className="py-3 pr-4 text-right text-emerald-500">{fmt(m.adicional_isapre)}</td>
                    <td className="py-3 pr-4 text-right text-amber-600">{fmt(m.descuento_cesantia)}</td>
                    <td className="py-3 pr-4 text-right text-red-500">{m.iusc > 0 ? fmt(m.iusc) : '—'}</td>
                    <td className="py-3 text-right font-semibold text-gray-700">{fmt(m.total_descuentos)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-gray-50">
                  <td className="pt-3 pb-2 font-bold text-gray-700 text-xs uppercase pl-0">Totales</td>
                  <td className="pt-3 pb-2 text-right font-semibold text-gray-700">{fmt(totalImponible)}</td>
                  <td className="pt-3 pb-2 text-right font-bold text-blue-600">{fmt(totales_periodo.afp)}</td>
                  <td className="pt-3 pb-2 text-right font-bold text-emerald-600">{fmt(meses.reduce((s, m) => s + m.descuento_salud_legal, 0))}</td>
                  <td className="pt-3 pb-2 text-right font-bold text-emerald-500">{fmt(meses.reduce((s, m) => s + m.adicional_isapre, 0))}</td>
                  <td className="pt-3 pb-2 text-right font-bold text-amber-600">{fmt(totales_periodo.cesantia)}</td>
                  <td className="pt-3 pb-2 text-right font-bold text-red-500">{totales_periodo.iusc > 0 ? fmt(totales_periodo.iusc) : '—'}</td>
                  <td className="pt-3 pb-2 text-right font-bold text-gray-800">{fmt(meses.reduce((s, m) => s + m.total_descuentos, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
