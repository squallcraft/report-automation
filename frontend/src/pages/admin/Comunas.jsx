import { useState, useEffect } from 'react'
import api from '../../api'
import DataTable from '../../components/DataTable'
import Modal from '../../components/Modal'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, MapPin } from 'lucide-react'

const fmt = (v) => `$${Number(v || 0).toLocaleString('es-CL')}`

const initialForm = {
  comuna: '',
  extra_seller: 0,
  extra_driver: 0,
}

export default function Comunas() {
  const [comunas, setComunas] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [toDelete, setToDelete] = useState(null)

  const fetchComunas = () => {
    api.get('/comunas')
      .then(({ data }) => setComunas(data))
      .catch(() => toast.error('Error al cargar comunas'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchComunas()
  }, [])

  const openCreate = () => {
    setEditing(null)
    setForm(initialForm)
    setModalOpen(true)
  }

  const openEdit = (comuna) => {
    setEditing(comuna)
    setForm({
      comuna: comuna.comuna || '',
      extra_seller: comuna.extra_seller ?? 0,
      extra_driver: comuna.extra_driver ?? 0,
    })
    setModalOpen(true)
  }

  const handleRowClick = (row) => {
    openEdit(row)
  }

  const handleDeleteClick = (e, row) => {
    e.stopPropagation()
    setToDelete(row)
    setDeleteModalOpen(true)
  }

  const confirmDelete = () => {
    if (!toDelete) return
    api.delete(`/comunas/${toDelete.id}`)
      .then(() => {
        toast.success('Comuna eliminada')
        fetchComunas()
        setDeleteModalOpen(false)
        setToDelete(null)
      })
      .catch(() => toast.error('Error al eliminar'))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    setSaving(true)
    const payload = {
      comuna: form.comuna.trim().toLowerCase(),
      extra_seller: Number(form.extra_seller) || 0,
      extra_driver: Number(form.extra_driver) || 0,
    }

    const promise = editing
      ? api.put(`/comunas/${editing.id}`, payload)
      : api.post('/comunas', payload)

    promise
      .then(() => {
        toast.success(editing ? 'Comuna actualizada' : 'Comuna creada')
        setModalOpen(false)
        fetchComunas()
      })
      .catch((err) => toast.error(err.response?.data?.detail || 'Error al guardar'))
      .finally(() => setSaving(false))
  }

  const columns = [
    { key: 'comuna', label: 'Comuna', render: (v) => v?.charAt(0)?.toUpperCase() + (v?.slice(1) || '') },
    { key: 'extra_seller', label: 'Extra Seller (CLP)', align: 'right', render: (v) => fmt(v) },
    { key: 'extra_driver', label: 'Extra Driver (CLP)', align: 'right', render: (v) => fmt(v) },
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
        <div className="flex items-center gap-2">
          <MapPin size={28} className="text-primary-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Tarifas por Comuna</h1>
            <p className="text-sm text-gray-500 mt-1">Gestiona los extras de tarifa por comuna</p>
          </div>
        </div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2">
          <Plus size={18} />
          Nueva Comuna
        </button>
      </div>

      <DataTable
        columns={columns}
        data={comunas}
        onRowClick={handleRowClick}
        emptyMessage="No hay comunas configuradas"
      />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Editar Comuna' : 'Nueva Comuna'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Comuna</label>
            <input
              type="text"
              className="input-field"
              value={form.comuna}
              onChange={(e) => setForm((f) => ({ ...f, comuna: e.target.value }))}
              placeholder="Ej: providencia"
              required
            />
          </div>
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

      <Modal open={deleteModalOpen} onClose={() => { setDeleteModalOpen(false); setToDelete(null) }} title="Eliminar Comuna">
        {toDelete && (
          <div>
            <p className="text-gray-600 mb-4">
              ¿Eliminar la comuna <strong>{toDelete.comuna}</strong>? Esta acción no se puede deshacer.
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
