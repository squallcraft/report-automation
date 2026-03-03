import { useState, useMemo } from 'react'
import api from '../../api'
import PeriodSelector from '../../components/PeriodSelector'
import DataTable from '../../components/DataTable'
import LiquidacionDetalle from '../../components/LiquidacionDetalle'
import toast from 'react-hot-toast'
import { Calculator, Download, RefreshCw, Search, X, FileArchive, CheckCircle } from 'lucide-react'

const fmt = (n) => `$${(n || 0).toLocaleString('es-CL')}`
const now = new Date()

export default function Liquidacion() {
  const [period, setPeriod] = useState({ semana: 1, mes: now.getMonth() + 1, anio: now.getFullYear() })
  const [tab, setTab] = useState('sellers')
  const [sellerData, setSellerData] = useState(null)
  const [driverData, setDriverData] = useState(null)
  const [rentData, setRentData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [recalculating, setRecalculating] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [filterUser, setFilterUser] = useState('')
  const [zipProgress, setZipProgress] = useState(null) // null | { pct: number, done: boolean, label: string }

  const [detailView, setDetailView] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const params = period
      const [s, d, r] = await Promise.all([
        api.get('/liquidacion/sellers', { params }),
        api.get('/liquidacion/drivers', { params }),
        api.get('/liquidacion/rentabilidad', { params }),
      ])
      setSellerData(s.data)
      setDriverData(d.data)
      setRentData(r.data)
      setSearchText('')
      setFilterUser('')
      toast.success('Liquidación cargada')
    } catch {
      toast.error('Error al cargar liquidación')
    } finally {
      setLoading(false)
    }
  }

  const recalcular = async () => {
    setRecalculating(true)
    try {
      await api.post('/liquidacion/recalcular', null, { params: period })
      await load()
      toast.success('Liquidación recalculada')
    } catch {
      toast.error('Error al recalcular')
    } finally {
      setRecalculating(false)
    }
  }

  const downloadPdf = async (type, id, nombre) => {
    try {
      const { data } = await api.get(`/liquidacion/pdf/${type}/${id}`, {
        params: period,
        responseType: 'blob',
      })
      const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `liquidacion_${type}_${nombre}_S${period.semana}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Error al generar PDF')
    }
  }

  const downloadZip = () => {
    const tipo = tab === 'drivers' ? 'drivers' : 'sellers'
    const label = tipo === 'drivers' ? 'Drivers' : 'Sellers'
    const params = new URLSearchParams({
      semana: period.semana,
      mes: period.mes,
      anio: period.anio,
    })
    const token = localStorage.getItem('token')
    const url = `/api/liquidacion/zip/${tipo}?${params}`

    setZipProgress({ pct: 0, done: false, label })

    const xhr = new XMLHttpRequest()
    xhr.open('GET', url)
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.responseType = 'blob'

    xhr.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100)
        setZipProgress({ pct, done: false, label })
      } else {
        // sin Content-Length: animación indeterminada
        setZipProgress(prev => prev ? { ...prev, pct: -1 } : null)
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setZipProgress({ pct: 100, done: true, label })
        const blobUrl = URL.createObjectURL(xhr.response)
        const a = document.createElement('a')
        a.href = blobUrl
        a.download = `liquidacion_${tipo}_S${period.semana}_M${period.mes}_${period.anio}.zip`
        a.click()
        URL.revokeObjectURL(blobUrl)
        setTimeout(() => setZipProgress(null), 2500)
      } else {
        toast.error('Error al generar ZIP')
        setZipProgress(null)
      }
    }

    xhr.onerror = () => {
      toast.error('Error de red al generar ZIP')
      setZipProgress(null)
    }

    xhr.send()
  }

  const allUserNombres = useMemo(() => {
    if (!sellerData) return []
    const set = new Set()
    sellerData.forEach((s) => (s.user_nombres || []).forEach((u) => set.add(u)))
    return [...set].sort()
  }, [sellerData])

  const applyFilters = (data, nameKey) => {
    if (!data) return []
    let filtered = data
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase()
      filtered = filtered.filter((row) => {
        const name = (row[nameKey] || '').toLowerCase()
        const empresa = (row.empresa || '').toLowerCase()
        return name.includes(q) || empresa.includes(q)
      })
    }
    if (filterUser && nameKey !== 'driver_nombre') {
      filtered = filtered.filter((row) =>
        (row.user_nombres || []).includes(filterUser)
      )
    }
    return filtered
  }

  const filteredSellers = useMemo(() => applyFilters(sellerData, 'seller_nombre'), [sellerData, searchText, filterUser])
  const filteredDrivers = useMemo(() => applyFilters(driverData, 'driver_nombre'), [driverData, searchText, filterUser])
  const filteredRent = useMemo(() => applyFilters(rentData, 'seller_nombre'), [rentData, searchText, filterUser])

  const openDetail = (tipo, id) => {
    setDetailView({ tipo, id })
  }

  if (detailView) {
    return (
      <LiquidacionDetalle
        tipo={detailView.tipo}
        entityId={detailView.id}
        initialPeriod={period}
        onBack={() => setDetailView(null)}
      />
    )
  }

  const sellerColumns = [
    { key: 'seller_nombre', label: 'Seller' },
    { key: 'empresa', label: 'Empresa', render: (v) => (
      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${v === 'ECOURIER' ? 'bg-blue-100 text-blue-700' : v === 'OVIEDO' ? 'bg-indigo-100 text-indigo-700' : 'bg-amber-100 text-amber-700'}`}>{v}</span>
    )},
    { key: 'user_nombres', label: 'User', render: (v) => (v || []).join(', ') || '—' },
    { key: 'cantidad_envios', label: 'Envíos', align: 'center' },
    { key: 'total_envios', label: 'Base', align: 'right', render: (v) => fmt(v) },
    { key: 'total_extras_producto', label: 'Ext. Prod.', align: 'right', render: (v) => fmt(v) },
    { key: 'total_extras_comuna', label: 'Ext. Com.', align: 'right', render: (v) => fmt(v) },
    { key: 'total_retiros', label: 'Retiros', align: 'right', render: (v) => fmt(v) },
    { key: 'total_ajustes', label: 'Ajustes', align: 'right', render: (v) => v !== 0 ? <span className={v > 0 ? 'text-green-600' : 'text-red-600'}>{fmt(v)}</span> : '—' },
    { key: 'iva', label: 'IVA', align: 'right', render: (v) => v > 0 ? fmt(v) : '—' },
    { key: 'total_con_iva', label: 'Total', align: 'right', render: (v) => <span className="font-bold">{fmt(v)}</span> },
    { key: 'actions', label: '', render: (_, row) => (
      <button onClick={(e) => { e.stopPropagation(); downloadPdf('seller', row.seller_id, row.seller_nombre) }} className="p-1.5 hover:bg-gray-100 rounded-lg" title="Descargar PDF">
        <Download size={16} className="text-gray-500" />
      </button>
    )},
  ]

  const driverColumns = [
    { key: 'driver_nombre', label: 'Driver' },
    { key: 'cantidad_envios', label: 'Entregas', align: 'center' },
    { key: 'total_envios', label: 'Base', align: 'right', render: (v) => fmt(v) },
    { key: 'total_extras_producto', label: 'Ext. Prod.', align: 'right', render: (v) => fmt(v) },
    { key: 'total_extras_comuna', label: 'Ext. Com.', align: 'right', render: (v) => fmt(v) },
    { key: 'total_retiros', label: 'Retiros', align: 'right', render: (v) => fmt(v) },
    { key: 'total_ajustes', label: 'Ajustes', align: 'right', render: (v) => v !== 0 ? <span className={v > 0 ? 'text-green-600' : 'text-red-600'}>{fmt(v)}</span> : '—' },
    { key: 'iva', label: 'IVA', align: 'right', render: (v) => v > 0 ? fmt(v) : '—' },
    { key: 'total', label: 'Total', align: 'right', render: (v) => <span className="font-bold">{fmt(v)}</span> },
    { key: 'actions', label: '', render: (_, row) => (
      <button onClick={(e) => { e.stopPropagation(); downloadPdf('driver', row.driver_id, row.driver_nombre) }} className="p-1.5 hover:bg-gray-100 rounded-lg" title="Descargar PDF">
        <Download size={16} className="text-gray-500" />
      </button>
    )},
  ]

  const rentColumns = [
    { key: 'seller_nombre', label: 'Seller' },
    { key: 'user_nombres', label: 'User', render: (v) => (v || []).join(', ') || '—' },
    { key: 'ingreso', label: 'Ingreso', align: 'right', render: (v) => fmt(v) },
    { key: 'costo_drivers', label: 'Costo Drivers', align: 'right', render: (v) => fmt(v) },
    { key: 'margen_bruto', label: 'Margen', align: 'right', render: (v) => <span className={v >= 0 ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>{fmt(v)}</span> },
    { key: 'margen_porcentaje', label: '%', align: 'right', render: (v) => <span className={v >= 0 ? 'text-green-600' : 'text-red-600'}>{v}%</span> },
  ]

  const tabs = [
    { id: 'sellers', label: 'Cobros a Sellers' },
    { id: 'drivers', label: 'Pagos a Drivers' },
    { id: 'rentabilidad', label: 'Rentabilidad' },
  ]

  const currentData = tab === 'sellers' ? filteredSellers : tab === 'drivers' ? filteredDrivers : filteredRent
  const totalLabel = tab === 'sellers'
    ? { text: 'Total Cobros (con IVA)', value: filteredSellers.reduce((a, s) => a + s.total_con_iva, 0), bg: 'bg-primary-50 border-primary-200', color: 'text-primary-900' }
    : tab === 'drivers'
    ? { text: 'Total Pagos (con IVA)', value: filteredDrivers.reduce((a, d) => a + d.total, 0), bg: 'bg-emerald-50 border-emerald-200', color: 'text-emerald-900' }
    : null

  return (
    <div className="flex flex-col h-full gap-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Liquidación</h1>
        <p className="text-sm text-gray-500 mt-1">Calcula cobros, pagos y rentabilidad por período</p>
      </div>

      <div className="card">
        <div className="flex flex-wrap items-end gap-4">
          <PeriodSelector {...period} onChange={setPeriod} />
          <button onClick={load} disabled={loading} className="btn-primary flex items-center gap-2">
            <Calculator size={16} />
            {loading ? 'Cargando...' : 'Ver Liquidación'}
          </button>
          <button onClick={recalcular} disabled={recalculating || loading} className="btn-secondary flex items-center gap-2">
            <RefreshCw size={16} className={recalculating ? 'animate-spin' : ''} />
            {recalculating ? 'Recalculando...' : 'Recalcular'}
          </button>
          {sellerData && (tab === 'sellers' || tab === 'drivers') && (
            <button onClick={downloadZip} disabled={!!zipProgress} className="btn-secondary flex items-center gap-2">
              <FileArchive size={16} />
              {zipProgress ? `Generando ${zipProgress.label}...` : `ZIP ${tab === 'drivers' ? 'Drivers' : 'Sellers'}`}
            </button>
          )}
        </div>
      </div>

      {sellerData && (
        <div className="flex flex-col flex-1 min-h-0 gap-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors
                    ${tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Buscar..."
                  className="input-field pl-9 pr-8 w-52"
                />
                {searchText && (
                  <button onClick={() => setSearchText('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    <X size={14} />
                  </button>
                )}
              </div>
              {tab !== 'drivers' && allUserNombres.length > 0 && (
                <select
                  value={filterUser}
                  onChange={(e) => setFilterUser(e.target.value)}
                  className="input-field w-48"
                >
                  <option value="">Todos los users</option>
                  {allUserNombres.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              )}
              {(searchText || filterUser) && (
                <span className="text-xs text-gray-500">{currentData.length} resultados</span>
              )}
            </div>
          </div>

          {tab === 'sellers' && (
            <div className="flex-1 min-h-0">
            <DataTable
              columns={sellerColumns}
              data={filteredSellers}
              emptyMessage="No hay envíos para este período"
              sortable
              onRowClick={(row) => openDetail('seller', row.seller_id)}
            />
            </div>
          )}
          {tab === 'drivers' && (
            <div className="flex-1 min-h-0">
            <DataTable
              columns={driverColumns}
              data={filteredDrivers}
              emptyMessage="No hay entregas para este período"
              sortable
              onRowClick={(row) => openDetail('driver', row.driver_id)}
            />
            </div>
          )}
          {tab === 'rentabilidad' && (
            <div className="flex-1 min-h-0">
            <DataTable
              columns={rentColumns}
              data={filteredRent}
              emptyMessage="No hay datos para este período"
              sortable
              onRowClick={(row) => openDetail('seller', row.seller_id)}
            />
            </div>
          )}

          {totalLabel && currentData.length > 0 && (
            <div className={`card ${totalLabel.bg}`}>
              <div className="flex justify-between items-center">
                <span className={`font-semibold ${totalLabel.color}`}>{totalLabel.text}</span>
                <span className={`text-2xl font-bold ${totalLabel.color}`}>
                  {fmt(totalLabel.value)}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
      {/* Overlay progreso ZIP */}
      {zipProgress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-8 w-80 flex flex-col items-center gap-5">
            {zipProgress.done ? (
              <CheckCircle size={48} className="text-green-500" />
            ) : (
              <FileArchive size={48} className="text-primary-500 animate-pulse" />
            )}
            <div className="text-center">
              <p className="font-semibold text-gray-800 text-lg">
                {zipProgress.done ? '¡ZIP listo!' : `Generando ZIP ${zipProgress.label}`}
              </p>
              <p className="text-sm text-gray-500 mt-1">
                {zipProgress.done
                  ? 'La descarga comenzará en un momento'
                  : zipProgress.pct >= 0
                    ? `Descargando archivo... ${zipProgress.pct}%`
                    : 'Generando PDFs y comprimiendo...'}
              </p>
            </div>
            {/* Barra de progreso */}
            <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
              {zipProgress.pct >= 0 ? (
                <div
                  className={`h-3 rounded-full transition-all duration-300 ${zipProgress.done ? 'bg-green-500' : 'bg-primary-500'}`}
                  style={{ width: `${zipProgress.pct}%` }}
                />
              ) : (
                <div className="h-3 rounded-full bg-primary-400 animate-[progress-indeterminate_1.4s_ease-in-out_infinite] w-1/3" />
              )}
            </div>
            {zipProgress.pct >= 0 && (
              <span className="text-2xl font-bold text-primary-600">
                {zipProgress.done ? '100%' : `${zipProgress.pct}%`}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
