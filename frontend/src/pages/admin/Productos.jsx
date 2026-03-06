import { useState, useEffect } from 'react'
import api from '../../api'
import DataTable from '../../components/DataTable'
import Modal from '../../components/Modal'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, Package, Download, Upload } from 'lucide-react'

const fmtClp = (v) => `$${(v ?? 0).toLocaleString('es-CL')}`

function EstadoBadge({ activo }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${activo ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
      {activo ? 'Activo' : 'Inactivo'}
    </span>
  )
}

const initialForm = {
  codigo_mlc: '',
  descripcion: '',
  extra_seller: 0,
  extra_driver: 0,
  activo: true,
}

export default function Productos() {
  const [productos, setProductos] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [toDelete, setToDelete] = useState(null)

  const fetchProductos = () => {
    api.get('/productos')
      .then(({ data }) => setProductos(data))
      .catch(() => toast.error('Error al cargar productos'))
      .finally(() => setLoading(false))
  }

  const handleDownloadPlantilla = async () => {
    try {
      const { data } = await api.get('/productos/plantilla', { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a')
      a.href = url
      a.download = 'plantilla_productos_extra.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Error al descargar plantilla')
    }
  }

  const handleImport = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const formData = new FormData()
    formData.append('file', file)
    try {
      const { data } = await api.post('/productos/importar', formData, {
      })
      toast.success(`${data.creados} creados, ${data.actualizados} actualizados`)
      fetchProductos()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al importar')
    }
    e.target.value = ''
  }

  useEffect(() => {
    fetchProductos()
  }, [])

  const openCreate = () => {
    setEditing(null)
    setForm(initialForm)
    setModalOpen(true)
  }

  const openEdit = (producto) => {
    setEditing(producto)
    setForm({
      codigo_mlc: producto.codigo_mlc || '',
      descripcion: producto.descripcion || '',
      extra_seller: producto.extra_seller ?? 0,
      extra_driver: producto.extra_driver ?? 0,
      activo: producto.activo ?? true,
    })
    setModalOpen(true)
  }

  const handleRowClick = (row) => {
    openEdit(row)
  }

  const handleDeleteClick = (e, producto) => {
    e.stopPropagation()
    setToDelete(producto)
    setDeleteModalOpen(true)
  }

  const confirmDelete = () => {
    if (!toDelete) return
    api.delete(`/productos/${toDelete.id}`)
      .then(() => {
        toast.success('Producto eliminado')
        fetchProductos()
        setDeleteModalOpen(false)
        setToDelete(null)
      })
      .catch(() => toast.error('Error al eliminar'))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    setSaving(true)
    const payload = {
      codigo_mlc: form.codigo_mlc.trim(),
      descripcion: form.descripcion.trim(),
      extra_seller: parseInt(form.extra_seller, 10) || 0,
      extra_driver: parseInt(form.extra_driver, 10) || 0,
      activo: form.activo,
    }

    const promise = editing
      ? api.put(`/productos/${editing.id}`, payload)
      : api.post('/productos', payload)

    promise
      .then(() => {
        toast.success(editing ? 'Producto actualizado' : 'Producto creado')
        setModalOpen(false)
        fetchProductos()
      })
      .catch((err) => toast.error(err.response?.data?.detail || 'Error al guardar'))
      .finally(() => setSaving(false))
  }

  const columns = [
    { key: 'codigo_mlc', label: 'Código MLC' },
    { key: 'descripcion', label: 'Descripción' },
    { key: 'extra_seller', label: 'Extra Seller (CLP)', align: 'right', render: (v) => fmtClp(v) },
    { key: 'extra_driver', label: 'Extra Driver (CLP)', align: 'right', render: (v) => fmtClp(v) },
    { key: 'activo', label: 'Estado', align: 'center', render: (v) => <EstadoBadge activo={v} /> },
    {
      key: 'acciones',
      label: '',
      align: 'right',
      render: (_, row) => (
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
            title="Eliminar"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ),
    },
  ]

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-400">Cargando...</div>
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Package size={28} />
            Productos
          </h1>
          <p className="text-sm text-gray-500 mt-1">Gestiona los productos con extras (productos_con_extra)</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleDownloadPlantilla} className="btn-secondary flex items-center gap-2 text-sm">
            <Download size={16} /> Plantilla
          </button>
          <label className="btn-secondary flex items-center gap-2 text-sm cursor-pointer">
            <Upload size={16} /> Importar
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} />
          </label>
          <button onClick={openCreate} className="btn-primary flex items-center gap-2">
            <Plus size={18} />
            Nuevo Producto
          </button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={productos}
        onRowClick={handleRowClick}
        emptyMessage="No hay productos"
      />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Editar Producto' : 'Nuevo Producto'} wide>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Código MLC</label>
              <input
                type="text"
                className="input-field"
                value={form.codigo_mlc}
                onChange={(e) => setForm((f) => ({ ...f, codigo_mlc: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
              <input
                type="text"
                className="input-field"
                value={form.descripcion}
                onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))}
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Extra Seller (CLP)</label>
              <input
                type="number"
                className="input-field"
                min={0}
                value={form.extra_seller}
                onChange={(e) => setForm((f) => ({ ...f, extra_seller: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Extra Driver (CLP)</label>
              <input
                type="number"
                className="input-field"
                min={0}
                value={form.extra_driver}
                onChange={(e) => setForm((f) => ({ ...f, extra_driver: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="activo"
              checked={form.activo}
              onChange={(e) => setForm((f) => ({ ...f, activo: e.target.checked }))}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <label htmlFor="activo" className="text-sm font-medium text-gray-700">Activo</label>
          </div>
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

      <Modal open={deleteModalOpen} onClose={() => { setDeleteModalOpen(false); setToDelete(null) }} title="Eliminar Producto">
        {toDelete && (
          <div>
            <p className="text-gray-600 mb-4">
              ¿Eliminar el producto <strong>{toDelete.descripcion || toDelete.codigo_mlc}</strong>?
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => { setDeleteModalOpen(false); setToDelete(null) }} className="btn-secondary">
                Cancelar
              </button>
              <button onClick={confirmDelete} className="btn-danger">
                Eliminar
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
