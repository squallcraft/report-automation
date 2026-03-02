import { useState, useEffect } from 'react'
import api from '../../api'
import DataTable from '../../components/DataTable'
import PeriodSelector from '../../components/PeriodSelector'
import toast from 'react-hot-toast'
import { Download, FileSpreadsheet } from 'lucide-react'

const fmt = (n) => `$${(n || 0).toLocaleString('es-CL')}`
const now = new Date()

export default function SellerEnvios() {
  const [envios, setEnvios] = useState([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState({ semana: 1, mes: now.getMonth() + 1, anio: now.getFullYear() })
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const [downloadingXls, setDownloadingXls] = useState(false)

  useEffect(() => {
    setLoading(true)
    api.get('/envios', { params: period })
      .then(({ data }) => setEnvios(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [period])

  const descargarPDF = async () => {
    setDownloadingPdf(true)
    try {
      const res = await api.get('/portal/seller/pdf', { params: period, responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `mi_liquidacion_S${period.semana}_${period.mes}_${period.anio}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch { toast.error('No hay datos para este período') }
    finally { setDownloadingPdf(false) }
  }

  const descargarExcel = async () => {
    setDownloadingXls(true)
    try {
      const res = await api.get('/portal/seller/excel', { params: period, responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `mis_envios_S${period.semana}_${period.mes}_${period.anio}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch { toast.error('No hay envíos para este período') }
    finally { setDownloadingXls(false) }
  }

  const columns = [
    { key: 'fecha_entrega', label: 'Fecha', render: (v) => v ? new Date(v).toLocaleDateString('es-CL') : '—' },
    { key: 'tracking_id', label: 'Tracking' },
    { key: 'comuna', label: 'Comuna', render: (v) => v ? v.charAt(0).toUpperCase() + v.slice(1) : '—' },
    { key: 'cobro_seller', label: 'Base', align: 'right', render: (v) => fmt(v) },
    { key: 'extra_producto_seller', label: 'Ext. Prod.', align: 'right', render: (v) => v > 0 ? fmt(v) : '—' },
    { key: 'extra_comuna_seller', label: 'Ext. Com.', align: 'right', render: (v) => v > 0 ? fmt(v) : '—' },
    { key: 'cobro_extra_manual', label: 'Ext. Manual', align: 'right', render: (v) => v > 0 ? fmt(v) : '—' },
    { key: 'total', label: 'Total', align: 'right', render: (_, row) => (
      <span className="font-semibold">{fmt(row.cobro_seller + row.extra_producto_seller + row.extra_comuna_seller + (row.cobro_extra_manual || 0))}</span>
    )},
  ]

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Mis Envíos</h1>
        <p className="text-sm text-gray-500 mt-1">Detalle de envíos y cobros por período</p>
      </div>

      <div className="card mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <PeriodSelector {...period} onChange={setPeriod} />
          <button onClick={descargarPDF} disabled={downloadingPdf || envios.length === 0}
            className="btn-secondary flex items-center gap-2 ml-auto">
            <Download size={16} />
            {downloadingPdf ? 'Descargando...' : 'PDF'}
          </button>
          <button onClick={descargarExcel} disabled={downloadingXls || envios.length === 0}
            className="btn-secondary flex items-center gap-2">
            <FileSpreadsheet size={16} />
            {downloadingXls ? 'Descargando...' : 'Excel'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Cargando...</div>
      ) : (
        <>
          <DataTable columns={columns} data={envios} emptyMessage="No hay envíos para este período" />
          {envios.length > 0 && (
            <div className="mt-4 card bg-blue-50 border-blue-200">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-blue-900">Total del Período</span>
                <span className="text-xl font-bold text-blue-900">
                  {fmt(envios.reduce((acc, e) => acc + e.cobro_seller + e.extra_producto_seller + e.extra_comuna_seller + (e.cobro_extra_manual || 0), 0))}
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
