import { useState, useEffect } from 'react'
import api from '../../api'
import PeriodSelector from '../../components/PeriodSelector'
import toast from 'react-hot-toast'
import { Download, FileSpreadsheet, Truck } from 'lucide-react'

const fmt = (n) => `$${(n || 0).toLocaleString('es-CL')}`
const now = new Date()
// Drivers solo ven datos desde semana 4 de febrero 2026
const DRIVER_MIN_PERIOD = { semana: 4, mes: 2, anio: 2026 }

export default function DriverLiquidacion() {
  const [period, setPeriod] = useState(() => {
    const y = now.getFullYear()
    const m = now.getMonth() + 1
    if (y < 2026 || (y === 2026 && m < 2)) return DRIVER_MIN_PERIOD
    if (y === 2026 && m === 2) return { semana: 4, mes: 2, anio: 2026 }
    return { semana: 1, mes: m, anio: y }
  })
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const [downloadingXls, setDownloadingXls] = useState(false)

  const cargar = async () => {
    setLoading(true)
    try {
      const res = await api.get('/portal/driver/liquidacion', { params: period })
      setData(res.data)
    } catch (err) {
      const msg = err.response?.data?.detail || 'Error al cargar liquidación'
      toast.error(typeof msg === 'string' ? msg : 'Error al cargar liquidación')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { cargar() }, [period])

  const descargarPDF = async () => {
    setDownloadingPdf(true)
    try {
      const res = await api.get('/liquidacion/mi-pdf', { params: period, responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `mi_liquidacion_S${period.semana}_${period.mes}_${period.anio}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('No hay datos para este período')
    } finally {
      setDownloadingPdf(false)
    }
  }

  const descargarExcel = async () => {
    setDownloadingXls(true)
    try {
      const res = await api.get('/portal/driver/excel', { params: period, responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `mis_entregas_S${period.semana}_${period.mes}_${period.anio}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('No hay entregas para este período')
    } finally {
      setDownloadingXls(false)
    }
  }

  const rows = [
    { label: 'Entregas', key: 'cantidad_envios', isMoney: false },
    { label: 'Pago base', key: 'total_envios', isMoney: true },
    { label: 'Extra producto', key: 'total_extras_producto', isMoney: true },
    { label: 'Extra comuna', key: 'total_extras_comuna', isMoney: true },
    { label: 'Retiros', key: 'total_retiros', isMoney: true },
    { label: 'Ajustes', key: 'total_ajustes', isMoney: true },
  ]

  const sinDatos = !data || data.cantidad_envios === 0

  return (
    <div>
      <div className="mb-4 sm:mb-6">
        <h1 className="page-title">Mi Liquidación</h1>
        <p className="page-subtitle">Resumen de pagos por período</p>
        <p className="text-xs text-amber-600 mt-0.5">Solo se muestra información desde la semana 4 de febrero 2026.</p>
      </div>

      <div className="card mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <PeriodSelector {...period} onChange={setPeriod} />
          <button onClick={descargarPDF} disabled={downloadingPdf || sinDatos}
            className="btn-secondary flex items-center gap-2">
            <Download size={16} />
            {downloadingPdf ? 'Descargando...' : 'PDF Liquidación'}
          </button>
          <button onClick={descargarExcel} disabled={downloadingXls || sinDatos}
            className="btn-secondary flex items-center gap-2">
            <FileSpreadsheet size={16} />
            {downloadingXls ? 'Descargando...' : 'Excel Entregas'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Cargando...</div>
      ) : sinDatos ? (
        <div className="card text-center py-12 text-gray-400">
          <Truck size={40} className="mx-auto mb-3 opacity-30" />
          <p>No hay entregas para este período</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Desglose */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Desglose del Período</h2>
            <div className="space-y-2">
              {rows.map(({ label, key, isMoney }) => {
                const val = data[key] || 0
                if (val === 0) return null
                return (
                  <div key={key} className="flex justify-between items-center py-2 border-b border-gray-50">
                    <span className="text-sm text-gray-600">{label}</span>
                    <span className="text-sm font-medium text-gray-800">
                      {isMoney ? fmt(val) : val.toLocaleString('es-CL')}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Totales */}
          <div className="space-y-4">
            <div className="card bg-emerald-50 border-emerald-200">
              <p className="text-xs text-emerald-600 font-medium mb-1">Subtotal</p>
              <p className="text-2xl font-bold text-emerald-800">{fmt(data.subtotal)}</p>
            </div>
            {data.iva > 0 && (
              <div className="card bg-gray-50 border-gray-200">
                <p className="text-xs text-gray-600 font-medium mb-1">IVA (19%)</p>
                <p className="text-2xl font-bold text-gray-800">{fmt(data.iva)}</p>
              </div>
            )}
            <div className="card bg-green-50 border-green-200">
              <p className="text-xs text-green-600 font-medium mb-1">Total a Pagar</p>
              <p className="text-3xl font-bold text-green-800">{fmt(data.total)}</p>
            </div>
            <div className="card bg-gray-50 border-gray-200 text-center">
              <p className="text-xs text-gray-500 mb-1">Promedio por Entrega</p>
              <p className="text-lg font-bold text-gray-700">
                {data.cantidad_envios > 0 ? fmt(Math.round(data.subtotal / data.cantidad_envios)) : '$0'}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
