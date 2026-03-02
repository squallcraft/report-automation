import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import api from '../../api'
import DataTable from '../../components/DataTable'
import PeriodSelector from '../../components/PeriodSelector'
import toast from 'react-hot-toast'
import { Download, FileSpreadsheet } from 'lucide-react'

const fmt = (n) => `$${(n || 0).toLocaleString('es-CL')}`
const now = new Date()
// Drivers solo ven datos desde semana 4 de febrero 2026
const DRIVER_MIN_PERIOD = { semana: 4, mes: 2, anio: 2026 }

export default function DriverEntregas() {
  const { user } = useAuth()
  const [envios, setEnvios] = useState([])
  const [flota, setFlota] = useState(null)
  const [filterDriver, setFilterDriver] = useState('todos')
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState(() => {
    const y = now.getFullYear()
    const m = now.getMonth() + 1
    if (y < 2026 || (y === 2026 && m < 2)) return DRIVER_MIN_PERIOD
    if (y === 2026 && m === 2) return { semana: 4, mes: 2, anio: 2026 }
    return { semana: 1, mes: m, anio: y }
  })
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const [downloadingXls, setDownloadingXls] = useState(false)

  useEffect(() => {
    api.get('/drivers/mi-flota/info')
      .then(({ data }) => setFlota(data))
      .catch(() => setFlota({ es_jefe_flota: false, subordinados: [] }))
  }, [])

  useEffect(() => {
    setLoading(true)
    api.get('/envios', { params: period })
      .then(({ data }) => setEnvios(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [period])

  const esJefe = flota?.es_jefe_flota

  const filtered = filterDriver === 'todos'
    ? envios
    : filterDriver === 'mis'
      ? envios.filter((e) => e.driver_id === user?.entidad_id)
      : envios.filter((e) => e.driver_id === parseInt(filterDriver, 10))

  const descargarExcel = async () => {
    setDownloadingXls(true)
    try {
      const res = await api.get('/portal/driver/excel', { params: { semana: period.semana, mes: period.mes, anio: period.anio }, responseType: 'blob' })
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

  const descargarPDF = async () => {
    setDownloadingPdf(true)
    try {
      const res = await api.get('/liquidacion/mi-pdf', {
        params: { semana: period.semana, mes: period.mes, anio: period.anio },
        responseType: 'blob',
      })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `mi_liquidacion_S${period.semana}_${period.mes}_${period.anio}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('No hay datos de liquidación para este período')
    } finally {
      setDownloadingPdf(false)
    }
  }

  const columns = [
    { key: 'fecha_entrega', label: 'Fecha', render: (v) => v ? new Date(v).toLocaleDateString('es-CL') : '—' },
    ...(esJefe ? [{ key: 'driver_nombre', label: 'Conductor' }] : []),
    { key: 'seller_nombre', label: 'Seller' },
    { key: 'empresa', label: 'Empresa', render: (v) => (
      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${v === 'ECOURIER' ? 'bg-blue-100 text-blue-700' : v === 'OVIEDO' ? 'bg-indigo-100 text-indigo-700' : 'bg-amber-100 text-amber-700'}`}>{v || '—'}</span>
    )},
    { key: 'costo_driver', label: 'Base', align: 'right', render: (v) => fmt(v) },
    { key: 'extra_producto_driver', label: 'Ext. Prod.', align: 'right', render: (v) => v > 0 ? fmt(v) : '—' },
    { key: 'extra_comuna_driver', label: 'Ext. Com.', align: 'right', render: (v) => v > 0 ? fmt(v) : '—' },
    { key: 'pago_extra_manual', label: 'Ext. Manual', align: 'right', render: (v) => v > 0 ? fmt(v) : '—' },
    { key: 'total', label: 'Total', align: 'right', render: (_, row) => (
      <span className="font-semibold">{fmt(row.costo_driver + row.extra_producto_driver + row.extra_comuna_driver + (row.pago_extra_manual || 0))}</span>
    )},
  ]

  return (
    <div>
      <div className="mb-6">
        <p className="text-xs text-amber-600 mb-1">Solo se muestra información desde la semana 4 de febrero 2026.</p>
        <h1 className="text-2xl font-bold text-gray-900">
          {esJefe ? 'Entregas de la Flota' : 'Mis Entregas'}
        </h1>
        <p className="text-sm text-gray-500 mt-1">Detalle de entregas y pagos por período</p>
      </div>

      <div className="card mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <PeriodSelector {...period} onChange={setPeriod} />
          {esJefe && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Conductor</label>
              <select
                className="input-field text-sm"
                value={filterDriver}
                onChange={(e) => setFilterDriver(e.target.value)}
              >
                <option value="todos">Toda la flota</option>
                <option value="mis">Mis entregas</option>
                {flota.subordinados.map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <button onClick={descargarPDF} disabled={downloadingPdf}
              className="btn-secondary flex items-center gap-2">
              <Download size={16} />
              {downloadingPdf ? 'Descargando...' : 'PDF'}
            </button>
            <button onClick={descargarExcel} disabled={downloadingXls}
              className="btn-secondary flex items-center gap-2">
              <FileSpreadsheet size={16} />
              {downloadingXls ? 'Descargando...' : 'Excel'}
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Cargando...</div>
      ) : (
        <>
          <DataTable columns={columns} data={filtered} emptyMessage="No hay entregas para este período" />
          {filtered.length > 0 && (
            <div className="mt-4 card bg-emerald-50 border-emerald-200">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-emerald-900">Total del Período</span>
                <span className="text-xl font-bold text-emerald-900">
                  {fmt(filtered.reduce((acc, e) => acc + e.costo_driver + e.extra_producto_driver + e.extra_comuna_driver + (e.pago_extra_manual || 0), 0))}
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
