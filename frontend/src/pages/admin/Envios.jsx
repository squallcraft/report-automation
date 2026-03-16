import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import api from '../../api'
import DataTable from '../../components/DataTable'
import Modal from '../../components/Modal'
import toast from 'react-hot-toast'
import { FileText, Search, PackagePlus, Pencil, X, Lock } from 'lucide-react'

const ESTADO_BADGE = {
  pendiente:     { label: 'Pendiente',  cls: 'bg-gray-100 text-gray-600' },
  liquidado:     { label: 'Liquidado',  cls: 'bg-blue-100 text-blue-700' },
  facturado:     { label: 'Facturado',  cls: 'bg-indigo-100 text-indigo-700' },
  pagado_driver: { label: 'Pagado',     cls: 'bg-amber-100 text-amber-700' },
  cerrado:       { label: 'Cerrado',    cls: 'bg-emerald-100 text-emerald-700' },
}

const fmtClp = (v) => `$${(v ?? 0).toLocaleString('es-CL')}`

const now = new Date()
const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

export default function Envios() {
  const [searchParams] = useSearchParams()

  const [envios, setEnvios] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [filters, setFilters] = useState({
    semana: searchParams.get('semana') || '',
    meses: searchParams.get('mes') ? [Number(searchParams.get('mes'))] : [now.getMonth() + 1],
    anio: searchParams.get('anio') || String(now.getFullYear()),
  })
  const [sellers, setSellers] = useState([])
  const [drivers, setDrivers] = useState([])
  const [sortBy, setSortBy] = useState('fecha_entrega')
  const [sortDir, setSortDir] = useState('desc')

  const [colFilters, setColFilters] = useState({
    seller_nombre: searchParams.get('seller_id') || '',
    driver_nombre: searchParams.get('driver_id') || '',
    comuna: '',
    empresa: searchParams.get('empresa') || '',
    tracking_id: '',
  })

  const [detailModal, setDetailModal] = useState(null)
  const [editModal, setEditModal] = useState(null)
  const [editForm, setEditForm] = useState({ cobro_extra_manual: 0, pago_extra_manual: 0 })
  const [saving, setSaving] = useState(false)

  const [productoModal, setProductoModal] = useState(null)
  const [productoForm, setProductoForm] = useState({ codigo_mlc: '', descripcion: '', extra_seller: 0, extra_driver: 0 })
  const [savingProducto, setSavingProducto] = useState(false)

  useEffect(() => {
    api.get('/sellers').then(({ data }) => {
      setSellers(Array.isArray(data) ? data : [])
    }).catch(() => {})
    api.get('/drivers').then(({ data }) => {
      setDrivers(Array.isArray(data) ? data : [])
    }).catch(() => {})
  }, [])

  const buildParams = useCallback(() => {
    const params = { limit: 100000, sort_by: sortBy, sort_dir: sortDir }
    if (search) params.search = search
    if (filters.semana) params.semana = filters.semana
    if (filters.meses && filters.meses.length === 1) {
      params.mes = filters.meses[0]
    } else if (filters.meses && filters.meses.length > 1) {
      params.meses = filters.meses.join(',')
    }
    if (filters.anio) params.anio = filters.anio
    if (colFilters.seller_nombre) params.seller_id = colFilters.seller_nombre
    if (colFilters.driver_nombre) params.driver_id = colFilters.driver_nombre
    if (colFilters.comuna) params.comuna = colFilters.comuna
    if (colFilters.empresa) params.empresa = colFilters.empresa
    if (colFilters.tracking_id) params.search = colFilters.tracking_id
    return params
  }, [search, filters, colFilters, sortBy, sortDir])

  const fetchEnvios = useCallback(() => {
    setLoading(true)
    const params = buildParams()
    api.get('/envios', { params })
      .then((envRes) => {
        const enriched = (envRes.data || []).map(e => ({
          ...e,
          extra_total_seller: (e.extra_producto_seller || 0) + (e.extra_comuna_seller || 0) + (e.cobro_extra_manual || 0),
          extra_total_driver: (e.extra_producto_driver || 0) + (e.extra_comuna_driver || 0) + (e.pago_extra_manual || 0),
        }))
        setEnvios(enriched)
      })
      .catch(() => toast.error('Error al cargar envíos'))
      .finally(() => setLoading(false))
  }, [buildParams])

  useEffect(() => {
    fetchEnvios()
  }, [fetchEnvios])

  const handleSearch = (e) => {
    e.preventDefault()
    setSearch(searchInput)
  }

  const clearFilters = () => {
    setSearch('')
    setSearchInput('')
    setFilters({ semana: '', meses: [now.getMonth() + 1], anio: String(now.getFullYear()) })
    setColFilters({ seller_nombre: '', driver_nombre: '', comuna: '', empresa: '', tracking_id: '' })
    setSortBy('fecha_entrega')
    setSortDir('desc')
  }

  const handleServerSort = (key, dir) => {
    setSortBy(key)
    setSortDir(dir)
  }

  const debounceRef = useRef(null)
  const handleColumnFilter = (key, value) => {
    const filterConfig = columnFiltersConfig[key]
    if (filterConfig?.type === 'text') {
      setColFilters((f) => ({ ...f, [key]: value }))
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {}, 500)
    } else {
      setColFilters((f) => ({ ...f, [key]: value }))
    }
  }

  const openEdit = (envio) => {
    setEditModal(envio)
    setEditForm({
      cobro_extra_manual: envio.cobro_extra_manual ?? 0,
      pago_extra_manual: envio.pago_extra_manual ?? 0,
    })
  }

  const handleSaveEdit = (e) => {
    e.preventDefault()
    setSaving(true)
    api.put(`/envios/${editModal.id}`, {
      cobro_extra_manual: parseInt(editForm.cobro_extra_manual, 10) || 0,
      pago_extra_manual: parseInt(editForm.pago_extra_manual, 10) || 0,
    })
      .then(() => {
        toast.success('Extras actualizados')
        setEditModal(null)
        fetchEnvios()
      })
      .catch((err) => toast.error(err.response?.data?.detail || 'Error al guardar'))
      .finally(() => setSaving(false))
  }

  const openProductoModal = (envio) => {
    setProductoModal(envio)
    setProductoForm({
      codigo_mlc: envio.codigo_producto || '',
      descripcion: envio.descripcion_producto || '',
      extra_seller: 0,
      extra_driver: 0,
    })
  }

  const handleSaveProducto = (e) => {
    e.preventDefault()
    setSavingProducto(true)
    api.post('/productos', {
      codigo_mlc: productoForm.codigo_mlc.trim(),
      descripcion: productoForm.descripcion.trim(),
      extra_seller: parseInt(productoForm.extra_seller, 10) || 0,
      extra_driver: parseInt(productoForm.extra_driver, 10) || 0,
      activo: true,
    })
      .then(() => {
        toast.success('Producto extra actualizado')
        setProductoModal(null)
        fetchEnvios()
      })
      .catch((err) => toast.error(err.response?.data?.detail || 'Error al crear producto'))
      .finally(() => setSavingProducto(false))
  }

  const hasFilters = search || filters.semana || (filters.meses && filters.meses.length !== 1) || filters.anio !== String(now.getFullYear())
    || colFilters.seller_nombre || colFilters.driver_nombre || colFilters.comuna || colFilters.empresa || colFilters.tracking_id

  const sellersEnPeriodo = useMemo(() => {
    const ids = new Set(envios.map(e => e.seller_id).filter(Boolean))
    return ids.size > 0 ? sellers.filter(s => ids.has(s.id)) : sellers
  }, [envios, sellers])

  const driversEnPeriodo = useMemo(() => {
    const ids = new Set(envios.map(e => e.driver_id).filter(Boolean))
    return ids.size > 0 ? drivers.filter(d => ids.has(d.id)) : drivers
  }, [envios, drivers])

  const empresaOptions = useMemo(() => [
    { value: 'ECOURIER', label: 'ECourier' },
    { value: 'OVIEDO', label: 'Oviedo' },
    { value: 'TERCERIZADO', label: 'Tercerizado' },
  ], [])

  const columnFiltersConfig = useMemo(() => ({
    seller_nombre: {
      type: 'select',
      options: sellersEnPeriodo.map((s) => ({ value: String(s.id), label: s.nombre })),
      value: colFilters.seller_nombre,
      placeholder: 'Todos',
    },
    driver_nombre: {
      type: 'select',
      options: driversEnPeriodo.map((d) => ({ value: String(d.id), label: d.nombre })),
      value: colFilters.driver_nombre,
      placeholder: 'Todos',
    },
    comuna: { type: 'text', value: colFilters.comuna, placeholder: 'Filtrar...' },
    empresa: { type: 'select', options: empresaOptions, value: colFilters.empresa, placeholder: 'Todas' },
    tracking_id: { type: 'text', value: colFilters.tracking_id, placeholder: 'Filtrar...' },
  }), [sellersEnPeriodo, driversEnPeriodo, colFilters, empresaOptions])

  const sm = 'text-[11px]'
  const columns = [
    { key: 'fecha_entrega', label: 'Fecha', className: sm, render: (v) => v ? new Date(v + 'T12:00:00').toLocaleDateString('es-CL') : '—' },
    { key: 'seller_nombre', label: 'Seller', render: (v) => v || '—' },
    { key: 'driver_nombre', label: 'Driver', className: sm, render: (v) => v || '—' },
    { key: 'comuna', label: 'Comuna', render: (v) => v || '—' },
    { key: 'seller_code', label: 'Seller ID', className: sm, render: (v) => v || '—' },
    { key: 'tracking_id', label: 'Tracking', className: sm, render: (v) => v || '—' },
    { key: 'bultos', label: 'Blt', align: 'center', className: sm },
    { key: 'descripcion_producto', label: 'Descripción', className: 'text-xs !whitespace-normal min-w-[250px]', render: (v) => v ? (
      <span className="line-clamp-2 block" title={v}>{v}</span>
    ) : '—' },
    { key: 'costo_orden', label: 'C.Orden', align: 'right', className: sm, render: (v) => v ? fmtClp(v) : '—' },
    { key: 'cobro_seller', label: 'Cobro', align: 'right', className: sm, render: (v) => fmtClp(v) },
    { key: 'costo_driver', label: 'P.Driver', align: 'right', className: sm, render: (v) => fmtClp(v) },
    { key: 'extra_total_seller', label: 'Ex.S', align: 'right', className: sm, render: (v) => v ? fmtClp(v) : '—' },
    { key: 'extra_total_driver', label: 'Ex.D', align: 'right', className: sm, render: (v) => v ? fmtClp(v) : '—' },
    { key: 'extra_comuna_seller', label: 'Com.S', align: 'right', className: sm, render: (v) => v ? fmtClp(v) : '—' },
    { key: 'extra_comuna_driver', label: 'Com.D', align: 'right', className: sm, render: (v) => v ? fmtClp(v) : '—' },
    { key: 'estado_financiero', label: 'Estado', align: 'center', className: sm, render: (v) => {
      const cfg = ESTADO_BADGE[v] || ESTADO_BADGE.pendiente
      return <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${cfg.cls}`}>{cfg.label}</span>
    }},
    {
      key: 'acciones', label: '', align: 'right', render: (_, row) => {
        const bloqueado = row.estado_financiero && row.estado_financiero !== 'pendiente'
        return (
          <div className="flex items-center justify-end gap-0">
            {bloqueado ? (
              <span className="p-1 text-gray-300" title={`Bloqueado (${row.estado_financiero})`}>
                <Lock size={12} />
              </span>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); openEdit(row) }}
                className="p-1 rounded text-gray-500 hover:bg-gray-100 hover:text-primary-600 transition-colors"
                title="Editar extras manuales"
              >
                <Pencil size={12} />
              </button>
            )}
            {row.codigo_producto && !bloqueado && (
              <button
                onClick={(e) => { e.stopPropagation(); openProductoModal(row) }}
                className="p-1 rounded text-gray-500 hover:bg-gray-100 hover:text-green-600 transition-colors"
                title="Crear producto extra"
              >
                <PackagePlus size={12} />
              </button>
            )}
          </div>
        )
      },
    },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FileText size={28} />
            Envíos
          </h1>
          <p className="text-sm text-gray-500 mt-1">{envios.length.toLocaleString()} envíos encontrados</p>
        </div>
      </div>

      <div className="card mb-4">
        <form onSubmit={handleSearch} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Buscar</label>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                className="input-field pl-9"
                placeholder="Tracking, seller, driver, producto, comuna..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
          </div>
          <div className="w-28">
            <label className="block text-xs font-medium text-gray-500 mb-1">Semana</label>
            <select className="input-field" value={filters.semana} onChange={(e) => setFilters((f) => ({ ...f, semana: e.target.value }))}>
              <option value="">Todas</option>
              {[1,2,3,4,5].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Mes</label>
            <div className="flex flex-wrap gap-1">
              {MESES.map((label, i) => {
                const m = i + 1
                const active = filters.meses.includes(m)
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setFilters(f => {
                        const next = active
                          ? f.meses.filter(x => x !== m)
                          : [...f.meses, m]
                        return { ...f, meses: next.length ? next : [m] }
                      })
                    }}
                    className={`px-2 py-1 text-xs rounded border transition-colors ${active ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-300 hover:border-primary-400'}`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="w-28">
            <label className="block text-xs font-medium text-gray-500 mb-1">Año</label>
            <input type="number" className="input-field" placeholder="2026" value={filters.anio} onChange={(e) => setFilters((f) => ({ ...f, anio: e.target.value }))} />
          </div>
          <button type="submit" className="btn-primary h-10">Buscar</button>
          {hasFilters && (
            <button type="button" onClick={clearFilters} className="btn-secondary h-10 flex items-center gap-1">
              <X size={14} /> Limpiar
            </button>
          )}
        </form>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-gray-400">Cargando...</div>
      ) : (
        <>
          <DataTable
            columns={columns}
            data={envios}
            onRowClick={(row) => setDetailModal(row)}
            emptyMessage="No hay envíos con esos filtros"
            sortable
            onSort={handleServerSort}
            externalSortKey={sortBy}
            externalSortDir={sortDir}
            columnFilters={columnFiltersConfig}
            onColumnFilterChange={handleColumnFilter}
            maxHeight="calc(100vh - 280px)"
          />
        </>
      )}

      <Modal open={!!detailModal} onClose={() => setDetailModal(null)} title="Detalle del Envío" wide>
        {detailModal && (
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div><span className="text-gray-500">Fecha Entrega:</span> <span className="font-medium">{detailModal.fecha_entrega}</span></div>
            <div><span className="text-gray-500">Fecha Carga:</span> <span className="font-medium">{detailModal.fecha_carga || '—'}</span></div>
            <div><span className="text-gray-500">Seller:</span> <span className="font-medium">{detailModal.seller_nombre || detailModal.seller_nombre_raw || '—'}</span></div>
            <div><span className="text-gray-500">Driver:</span> <span className="font-medium">{detailModal.driver_nombre || detailModal.driver_nombre_raw || '—'}</span></div>
            <div><span className="text-gray-500">Tracking:</span> <span className="font-medium">{detailModal.tracking_id || '—'}</span></div>
            <div><span className="text-gray-500">Seller Code:</span> <span className="font-medium">{detailModal.seller_code || '—'}</span></div>
            <div><span className="text-gray-500">Venta ID:</span> <span className="font-medium">{detailModal.venta_id || '—'}</span></div>
            <div><span className="text-gray-500">Comuna:</span> <span className="font-medium">{detailModal.comuna || '—'}</span></div>
            <div><span className="text-gray-500">Zona:</span> <span className="font-medium">{detailModal.zona || '—'}</span></div>
            <div><span className="text-gray-500">Empresa:</span> <span className="font-medium">{detailModal.empresa || '—'}</span></div>
            <div><span className="text-gray-500">Bultos:</span> <span className="font-medium">{detailModal.bultos}</span></div>
            <div><span className="text-gray-500">Costo Orden:</span> <span className="font-medium">{fmtClp(detailModal.costo_orden)}</span></div>
            <div className="col-span-2"><span className="text-gray-500">Dirección:</span> <span className="font-medium">{detailModal.direccion || '—'}</span></div>
            <div className="col-span-2"><span className="text-gray-500">Producto:</span> <span className="font-medium">{detailModal.descripcion_producto || '—'}</span></div>
            <div><span className="text-gray-500">Código Producto:</span> <span className="font-medium">{detailModal.codigo_producto || '—'}</span></div>
            <div><span className="text-gray-500">Ruta:</span> <span className="font-medium">{detailModal.ruta_nombre || '—'}</span></div>
            <hr className="col-span-2 border-gray-200" />
            <div><span className="text-gray-500">Cobro Seller:</span> <span className="font-medium">{fmtClp(detailModal.cobro_seller)}</span></div>
            <div><span className="text-gray-500">Pago Driver:</span> <span className="font-medium">{fmtClp(detailModal.costo_driver)}</span></div>
            <div><span className="text-gray-500">Extra Producto (S):</span> <span className="font-medium">{fmtClp(detailModal.extra_producto_seller)}</span></div>
            <div><span className="text-gray-500">Extra Producto (D):</span> <span className="font-medium">{fmtClp(detailModal.extra_producto_driver)}</span></div>
            <div><span className="text-gray-500">Extra Comuna (S):</span> <span className="font-medium">{fmtClp(detailModal.extra_comuna_seller)}</span></div>
            <div><span className="text-gray-500">Extra Comuna (D):</span> <span className="font-medium">{fmtClp(detailModal.extra_comuna_driver)}</span></div>
            <div><span className="text-gray-500">Extra Manual (S):</span> <span className="font-semibold text-blue-600">{fmtClp(detailModal.cobro_extra_manual)}</span></div>
            <div><span className="text-gray-500">Extra Manual (D):</span> <span className="font-semibold text-blue-600">{fmtClp(detailModal.pago_extra_manual)}</span></div>
          </div>
        )}
      </Modal>

      <Modal open={!!editModal} onClose={() => setEditModal(null)} title="Editar Extras Manuales">
        {editModal && (
          <form onSubmit={handleSaveEdit} className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-3 text-sm">
              <p><strong>{editModal.seller_nombre}</strong> → {editModal.driver_nombre}</p>
              <p className="text-gray-500">{editModal.tracking_id} | {editModal.fecha_entrega}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cobro Extra al Seller (CLP)</label>
              <input type="number" className="input-field" value={editForm.cobro_extra_manual} onChange={(e) => setEditForm((f) => ({ ...f, cobro_extra_manual: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Pago Extra al Driver (CLP)</label>
              <input type="number" className="input-field" value={editForm.pago_extra_manual} onChange={(e) => setEditForm((f) => ({ ...f, pago_extra_manual: e.target.value }))} />
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
              <button type="button" onClick={() => setEditModal(null)} className="btn-secondary">Cancelar</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Guardando...' : 'Guardar'}</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!productoModal} onClose={() => setProductoModal(null)} title="Crear Producto Extra">
        {productoModal && (
          <form onSubmit={handleSaveProducto} className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-3 text-sm">
              <p className="text-gray-500">Desde envío: {productoModal.tracking_id}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Código MLC</label>
              <input type="text" className="input-field" value={productoForm.codigo_mlc} onChange={(e) => setProductoForm((f) => ({ ...f, codigo_mlc: e.target.value }))} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
              <input type="text" className="input-field" value={productoForm.descripcion} onChange={(e) => setProductoForm((f) => ({ ...f, descripcion: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Extra Seller (CLP)</label>
                <input type="number" className="input-field" min={0} value={productoForm.extra_seller} onChange={(e) => setProductoForm((f) => ({ ...f, extra_seller: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Extra Driver (CLP)</label>
                <input type="number" className="input-field" min={0} value={productoForm.extra_driver} onChange={(e) => setProductoForm((f) => ({ ...f, extra_driver: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
              <button type="button" onClick={() => setProductoModal(null)} className="btn-secondary">Cancelar</button>
              <button type="submit" disabled={savingProducto} className="btn-primary">{savingProducto ? 'Guardando...' : 'Crear Producto'}</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}
