import { useState, useEffect } from 'react'
import api from '../../api'
import { useAuth } from '../../context/AuthContext'
import DataTable from '../../components/DataTable'
import Modal from '../../components/Modal'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, Download, Upload } from 'lucide-react'

const EMPRESA_OPTIONS = ['ECOURIER', 'TERCERIZADO', 'OVIEDO']

const fmtClp = (n) => (n ?? 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP' })

function EmpresaBadge({ empresa }) {
  const styles = {
    ECOURIER: 'bg-primary-100 text-primary-700',
    TERCERIZADO: 'bg-amber-100 text-amber-700',
    OVIEDO: 'bg-indigo-100 text-indigo-700',
  }
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${styles[empresa] || 'bg-gray-100 text-gray-700'}`}>
      {empresa}
    </span>
  )
}

function EstadoBadge({ activo }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${activo ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
      {activo ? 'Activo' : 'Inactivo'}
    </span>
  )
}

const initialForm = {
  nombre: '',
  aliases: '',
  zona: 'Santiago',
  empresa: 'ECOURIER',
  precio_base: 0,
  plan_tarifario: '',
  tiene_retiro: false,
  tarifa_retiro: 0,
  tarifa_retiro_driver: 0,
  min_paquetes_retiro_gratis: 0,
  usa_pickup: false,
  rut: '',
  giro: '',
  email: '',
  password: '',
}

export default function Sellers() {
  const { user } = useAuth()
  const canEdit = user?.rol === 'ADMIN'
  const [sellers, setSellers] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [toDelete, setToDelete] = useState(null)

  const [importing, setImporting] = useState(false)
  const [importingRutGiro, setImportingRutGiro] = useState(false)
  const [sellerFacturas, setSellerFacturas] = useState([])
  const [sellerFacturasLoading, setSellerFacturasLoading] = useState(false)

  const fetchSellers = () => {
    api.get('/sellers')
      .then(({ data }) => setSellers(data))
      .catch(() => toast.error('Error al cargar sellers'))
      .finally(() => setLoading(false))
  }

  const handleDownloadPlantilla = async () => {
    try {
      const { data } = await api.get('/sellers/plantilla/descargar', { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([data]))
      const a = document.createElement('a')
      a.href = url
      a.download = 'plantilla_sellers.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch { toast.error('Error al descargar plantilla') }
  }

  const handleImport = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setImporting(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const { data } = await api.post('/sellers/importar', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
      toast.success(`${data.creados} creados, ${data.actualizados} actualizados`)
      if (data.errores?.length) toast.error(`${data.errores.length} errores`)
      fetchSellers()
    } catch (err) { toast.error(err.response?.data?.detail || 'Error al importar') }
    finally { setImporting(false); e.target.value = '' }
  }

  const handleDownloadPlantillaRutGiro = async () => {
    try {
      const { data } = await api.get('/sellers/plantilla/rut-giro/descargar', { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([data]))
      const a = document.createElement('a')
      a.href = url
      a.download = 'plantilla_rut_giro_sellers.xlsx'
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Descarga lista. Completa RUT y Giro y vuelve a importar.')
    } catch { toast.error('Error al descargar plantilla RUT/Giro') }
  }

  const handleImportRutGiro = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setImportingRutGiro(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const { data } = await api.post('/sellers/importar/rut-giro', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
      toast.success(`${data.actualizados} seller(s) actualizados con RUT/Giro`)
      if (data.errores?.length) data.errores.forEach((err) => toast.error(err))
      fetchSellers()
    } catch (err) { toast.error(err.response?.data?.detail || 'Error al importar RUT/Giro') }
    finally { setImportingRutGiro(false); e.target.value = '' }
  }

  useEffect(() => {
    fetchSellers()
  }, [])

  useEffect(() => {
    if (!editing?.id) {
      setSellerFacturas([])
      return
    }
    setSellerFacturasLoading(true)
    api.get('/facturacion/historial', { params: { seller_id: editing.id, limite: 24 } })
      .then(({ data }) => setSellerFacturas(Array.isArray(data) ? data : []))
      .catch(() => setSellerFacturas([]))
      .finally(() => setSellerFacturasLoading(false))
  }, [editing?.id])

  const openCreate = () => {
    setEditing(null)
    setForm(initialForm)
    setModalOpen(true)
  }

  const openEdit = (seller) => {
    setEditing(seller)
    setForm({
      nombre: seller.nombre,
      aliases: (seller.aliases || []).join(', '),
      zona: seller.zona || 'Santiago',
      empresa: seller.empresa || 'ECOURIER',
      precio_base: seller.precio_base ?? 0,
      plan_tarifario: seller.plan_tarifario || '',
      tiene_retiro: seller.tiene_retiro ?? false,
      tarifa_retiro: seller.tarifa_retiro ?? 0,
      tarifa_retiro_driver: seller.tarifa_retiro_driver ?? 0,
      min_paquetes_retiro_gratis: seller.min_paquetes_retiro_gratis ?? 0,
      usa_pickup: seller.usa_pickup ?? false,
      rut: seller.rut || '',
      giro: seller.giro || '',
      email: seller.email || '',
      password: '',
    })
    setModalOpen(true)
  }

  const handleRowClick = (row) => {
    openEdit(row)
  }

  const handleDeleteClick = (e, seller) => {
    e.stopPropagation()
    setToDelete(seller)
    setDeleteModalOpen(true)
  }

  const confirmDelete = () => {
    if (!toDelete) return
    api.delete(`/sellers/${toDelete.id}`)
      .then(() => {
        toast.success('Seller desactivado')
        fetchSellers()
        setDeleteModalOpen(false)
        setToDelete(null)
      })
      .catch(() => toast.error('Error al desactivar'))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    setSaving(true)
    const payload = {
      ...form,
      aliases: form.aliases ? form.aliases.split(',').map((a) => a.trim()).filter(Boolean) : [],
      precio_base: parseInt(form.precio_base, 10) || 0,
      plan_tarifario: form.plan_tarifario || null,
      tarifa_retiro: parseInt(form.tarifa_retiro, 10) || 0,
      tarifa_retiro_driver: parseInt(form.tarifa_retiro_driver, 10) || 0,
      min_paquetes_retiro_gratis: parseInt(form.min_paquetes_retiro_gratis, 10) || 0,
      rut: (form.rut || '').trim() || null,
      giro: (form.giro || '').trim() || null,
    }
    if (!payload.password) delete payload.password

    const promise = editing
      ? api.put(`/sellers/${editing.id}`, payload)
      : api.post('/sellers', payload)

    promise
      .then(() => {
        toast.success(editing ? 'Seller actualizado' : 'Seller creado')
        setModalOpen(false)
        fetchSellers()
      })
      .catch((err) => toast.error(err.response?.data?.detail || 'Error al guardar'))
      .finally(() => setSaving(false))
  }

  const columns = [
    { key: 'nombre', label: 'Nombre' },
    { key: 'rut', label: 'RUT', render: (v) => v ? <span className="text-sm font-mono">{v}</span> : <span className="text-gray-400">—</span> },
    { key: 'empresa', label: 'Empresa', render: (v) => <EmpresaBadge empresa={v} /> },
    { key: 'zona', label: 'Zona' },
    { key: 'plan_tarifario', label: 'Plan Tarifa', render: (v) => v || '—' },
    { key: 'precio_base', label: 'Precio Base', align: 'right', render: (v) => fmtClp(v) },
    { key: 'usa_pickup', label: 'Pickup', align: 'center', render: (v) => v ? <span className="text-blue-600 font-medium">Sí</span> : <span className="text-gray-400">No</span> },
    { key: 'activo', label: 'Estado', align: 'center', render: (v) => <EstadoBadge activo={v} /> },
    {
      key: 'acciones',
      label: '',
      align: 'right',
      render: (_, row) => canEdit ? (
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); openEdit(row) }}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-primary-600 transition-colors"
            title="Editar"
          >
            <Pencil size={16} />
          </button>
          <button
            onClick={(e) => handleDeleteClick(e, row)}
            className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 transition-colors"
            title="Desactivar"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ) : null,
    },
  ]

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-400">Cargando...</div>
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sellers</h1>
          <p className="text-sm text-gray-500 mt-1">Gestiona los sellers del sistema</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <>
              <button onClick={handleDownloadPlantilla} className="btn-secondary flex items-center gap-2 text-sm">
                <Download size={16} /> Plantilla
              </button>
              <label className={`btn-secondary flex items-center gap-2 text-sm cursor-pointer ${importing ? 'opacity-50' : ''}`}>
                <Upload size={16} /> {importing ? 'Importando...' : 'Importar Excel'}
                <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} disabled={importing} />
              </label>
              <span className="text-gray-400 text-sm mx-1">|</span>
            </>
          )}
          {(canEdit || user?.rol === 'ADMINISTRACION') && (
            <>
              <button onClick={handleDownloadPlantillaRutGiro} className="btn-secondary flex items-center gap-2 text-sm" title="Descarga sellers actuales con columnas RUT y Giro (vacías) para completar y volver a subir">
                <Download size={16} /> Plantilla RUT/Giro
              </button>
              <label className={`btn-secondary flex items-center gap-2 text-sm cursor-pointer ${importingRutGiro ? 'opacity-50' : ''}`} title="Sube el Excel con RUT y Giro completados">
                <Upload size={16} /> {importingRutGiro ? 'Importando...' : 'Importar RUT/Giro'}
                <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportRutGiro} disabled={importingRutGiro} />
              </label>
            </>
          )}
          {canEdit && (
            <button onClick={openCreate} className="btn-primary flex items-center gap-2">
              <Plus size={18} /> Nuevo Seller
            </button>
          )}
        </div>
      </div>

      <DataTable
        columns={columns}
        data={sellers}
        onRowClick={handleRowClick}
        emptyMessage="No hay sellers"
      />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Editar Seller' : 'Nuevo Seller'} wide>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
              <input
                type="text"
                className="input-field"
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Aliases (separados por coma)</label>
              <input
                type="text"
                className="input-field"
                placeholder="Alias 1, Alias 2"
                value={form.aliases}
                onChange={(e) => setForm((f) => ({ ...f, aliases: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-amber-50/50 p-3 rounded-lg border border-amber-200">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">RUT</label>
              <input
                type="text"
                className="input-field"
                placeholder="12345678-9"
                value={form.rut}
                onChange={(e) => setForm((f) => ({ ...f, rut: e.target.value }))}
              />
              <p className="text-xs text-gray-500 mt-1">Requerido para emitir facturas electrónicas</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Giro</label>
              <input
                type="text"
                className="input-field"
                placeholder="Ej: Comercio al por menor"
                value={form.giro}
                onChange={(e) => setForm((f) => ({ ...f, giro: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Zona</label>
              <input
                type="text"
                className="input-field"
                value={form.zona}
                onChange={(e) => setForm((f) => ({ ...f, zona: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Empresa</label>
              <select
                className="input-field"
                value={form.empresa}
                onChange={(e) => setForm((f) => ({ ...f, empresa: e.target.value }))}
              >
                {EMPRESA_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Plan Tarifario</label>
              <input
                type="text"
                className="input-field"
                placeholder="Ej: V, 2800, Giorgio"
                value={form.plan_tarifario}
                onChange={(e) => setForm((f) => ({ ...f, plan_tarifario: e.target.value }))}
              />
              <p className="text-xs text-gray-400 mt-1">Nombre del plan en la matriz de tarifas</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Precio Base (CLP)</label>
              <input
                type="number"
                className="input-field"
                min={0}
                value={form.precio_base}
                onChange={(e) => setForm((f) => ({ ...f, precio_base: e.target.value }))}
              />
              <p className="text-xs text-gray-400 mt-1">Fallback si no hay plan o comuna</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tarifa Retiro (CLP)</label>
              <input
                type="number"
                className="input-field"
                min={0}
                value={form.tarifa_retiro}
                onChange={(e) => setForm((f) => ({ ...f, tarifa_retiro: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Pago Retiro Driver (CLP)</label>
              <input
                type="number"
                className="input-field"
                min={0}
                value={form.tarifa_retiro_driver}
                onChange={(e) => setForm((f) => ({ ...f, tarifa_retiro_driver: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Min. paquetes retiro gratis</label>
              <input
                type="number"
                className="input-field"
                min={0}
                value={form.min_paquetes_retiro_gratis}
                onChange={(e) => setForm((f) => ({ ...f, min_paquetes_retiro_gratis: e.target.value }))}
              />
              <p className="text-xs text-gray-400 mt-1">Si tiene más de X paquetes, el retiro es gratis. 0 = siempre cobra.</p>
            </div>
            <div className="flex items-center gap-3 pt-6">
              <input
                type="checkbox"
                id="tiene_retiro"
                checked={form.tiene_retiro}
                onChange={(e) => setForm((f) => ({ ...f, tiene_retiro: e.target.checked }))}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <label htmlFor="tiene_retiro" className="text-sm font-medium text-gray-700">Tiene retiro</label>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="usa_pickup"
                checked={form.usa_pickup}
                onChange={(e) => setForm((f) => ({ ...f, usa_pickup: e.target.checked }))}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <label htmlFor="usa_pickup" className="text-sm font-medium text-gray-700">Usa pickup</label>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                className="input-field"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {editing ? 'Contraseña (dejar vacío para no cambiar)' : 'Contraseña'}
              </label>
              <input
                type="password"
                className="input-field"
                placeholder={editing ? '••••••••' : ''}
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              />
            </div>
          </div>
          {editing && (
            <div className="border-t border-gray-200 pt-4 mt-4">
              <p className="text-sm font-medium text-gray-700 mb-2">Facturas emitidas</p>
              {sellerFacturasLoading ? (
                <p className="text-xs text-gray-500">Cargando...</p>
              ) : sellerFacturas.length === 0 ? (
                <p className="text-xs text-gray-500">Sin facturas emitidas</p>
              ) : (
                <div className="max-h-40 overflow-y-auto rounded border border-gray-200">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-medium text-gray-600">Mes / Año</th>
                        <th className="px-2 py-1.5 text-right font-medium text-gray-600">Total</th>
                        <th className="px-2 py-1.5 text-center font-medium text-gray-600">Folio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sellerFacturas.map((f) => (
                        <tr key={`${f.mes}-${f.anio}`} className="border-t border-gray-100">
                          <td className="px-2 py-1.5 text-gray-700">{new Date(f.anio, f.mes - 1).toLocaleString('es-CL', { month: 'short', year: 'numeric' })}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{fmtClp(f.total)}</td>
                          <td className="px-2 py-1.5 text-center text-gray-600">{f.folio_haulmer || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Guardando...' : editing ? 'Actualizar' : 'Crear'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={deleteModalOpen} onClose={() => { setDeleteModalOpen(false); setToDelete(null) }} title="Desactivar Seller">
        {toDelete && (
          <div>
            <p className="text-gray-600 mb-4">
              ¿Desactivar al seller <strong>{toDelete.nombre}</strong>? Esta acción es reversible.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => { setDeleteModalOpen(false); setToDelete(null) }} className="btn-secondary">
                Cancelar
              </button>
              <button onClick={confirmDelete} className="btn-danger">
                Desactivar
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
