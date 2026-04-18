import { useState, useEffect } from 'react'
import api from '../../api'
import PageHeader from '../../components/PageHeader'
import { FileText, Download, CheckCircle, Clock, AlertCircle } from 'lucide-react'
import { fmt } from '../../utils/format'

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

const EstadoBadge = ({ estado }) => {
  const map = {
    BORRADOR: { cls: 'bg-gray-100 text-gray-600', icon: AlertCircle, label: 'Borrador' },
    EMITIDA: { cls: 'bg-blue-100 text-blue-700', icon: Clock, label: 'Emitida' },
    PAGADA: { cls: 'bg-emerald-100 text-emerald-700', icon: CheckCircle, label: 'Pagada' },
  }
  const m = map[estado] || map.EMITIDA
  const Icon = m.icon
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${m.cls}`}>
      <Icon size={11} /> {m.label}
    </span>
  )
}

export default function TrabajadorLiquidaciones() {
  const [liquidaciones, setLiquidaciones] = useState([])
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(null)

  useEffect(() => {
    api.get('/remuneraciones/portal/liquidaciones')
      .then(({ data }) => setLiquidaciones(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleDownload = async (liq) => {
    setDownloading(liq.id)
    try {
      const res = await api.get(`/remuneraciones/portal/liquidaciones/${liq.id}/pdf`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `liquidacion_${MESES[liq.mes]}_${liq.anio}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert('Error descargando PDF')
    } finally {
      setDownloading(null)
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Cargando...</div>

  return (
    <div>
      <PageHeader
        title="Mis Liquidaciones"
        subtitle="Historial de liquidaciones de sueldo mensuales"
        icon={FileText}
        accent="blue"
      />

      {liquidaciones.length === 0 ? (
        <div className="card text-center py-12 text-gray-400">
          <FileText size={40} className="mx-auto mb-3 opacity-30" />
          <p>No tienes liquidaciones emitidas aún.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-gray-500 uppercase tracking-wide">
                <th className="text-left pb-3 pr-4">Período</th>
                <th className="text-right pb-3 pr-4">Imponible</th>
                <th className="text-right pb-3 pr-4">Descuentos</th>
                <th className="text-right pb-3 pr-4">AFP</th>
                <th className="text-right pb-3 pr-4">Salud</th>
                <th className="text-right pb-3 pr-4 text-emerald-600">Líquido</th>
                <th className="text-center pb-3 pr-4">Estado</th>
                <th className="text-center pb-3">PDF</th>
              </tr>
            </thead>
            <tbody>
              {liquidaciones.map((liq) => (
                <tr key={liq.id} className="border-b last:border-0 hover:bg-gray-50 transition-colors">
                  <td className="py-3 pr-4 font-medium text-gray-700">
                    {MESES[liq.mes]} {liq.anio}
                  </td>
                  <td className="py-3 pr-4 text-right text-gray-600">{fmt(liq.remuneracion_imponible)}</td>
                  <td className="py-3 pr-4 text-right text-red-500">-{fmt(liq.total_descuentos)}</td>
                  <td className="py-3 pr-4 text-right text-gray-500">{fmt(liq.descuento_afp)}</td>
                  <td className="py-3 pr-4 text-right text-gray-500">{fmt(liq.descuento_salud_legal + (liq.adicional_isapre || 0))}</td>
                  <td className="py-3 pr-4 text-right font-bold text-emerald-600">{fmt(liq.sueldo_liquido)}</td>
                  <td className="py-3 pr-4 text-center">
                    <EstadoBadge estado={liq.estado} />
                  </td>
                  <td className="py-3 text-center">
                    <button
                      onClick={() => handleDownload(liq)}
                      disabled={downloading === liq.id}
                      className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-40"
                      title="Descargar PDF"
                    >
                      {downloading === liq.id
                        ? <span className="text-xs">...</span>
                        : <Download size={15} />
                      }
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
