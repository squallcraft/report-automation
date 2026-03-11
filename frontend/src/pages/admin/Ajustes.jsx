import { useState, useEffect, useMemo } from 'react'
import api from '../../api'
import DataTable from '../../components/DataTable'
import Modal from '../../components/Modal'
import PeriodSelector from '../../components/PeriodSelector'
import toast from 'react-hot-toast'
import { Plus, Trash2, Settings } from 'lucide-react'

const fmt = (v) => `$${Number(v || 0).toLocaleString('es-CL')}`

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

const now = new Date()
const initialPeriod = {
  semana: 1,
  mes: now.getMonth() + 1,
  anio: now.getFullYear(),
}

const initialForm = {
  tipo: 'SELLER',
  entidad_id: '',
  semana: 1,
  mes: 1,
  anio: new Date().getFullYear(),
  monto: 0,
  motivo: '',
}

export default function Ajustes() {
  const [ajustes, setAjustes] = useState([])
  const [sellers, setSellers] = useState([])
  const [drivers, setDrivers] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [period, setPeriod] = useState(initialPeriod)
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [toDelete, setToDelete] = useState(null)

  const fetchAjustes = () => {
    setLoading(true)
    api.get('/ajustes', {
      params: { semana: period.semana, mes: period.mes, anio: period.anio },
    })
      .then(({ data }) => setAjustes(data))
      .catch(() => toast.error('Error al cargar ajustes'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchAjustes()
  }, [period])

  useEffect(() => {
    api.get('/sellers').then(({ data }) => setSellers(data)).catch(() => {})
    api.get('/drivers').then(({ data }) => setDrivers(data)).catch(() => {})
  }, [])

  const openCreate = () => {
    setForm({ ...initialForm, semana: period.semana, mes: period.mes, anio: period.anio })
    setModalOpen(true)
  }

  const handleDeleteClick = (e, row) => {
    e.stopPropagation()
    setToDelete(row)
    setDeleteModalOpen(true)
  }

  const confirmDelete = () => {
    if (!toDelete) return
    api.delete(`/ajustes/${toDelete.id}`)
      .then(() => {
        toast.success('Ajuste eliminado')
        fetchAjustes()
        setDeleteModalOpen(false)
        setToDelete(null)
      })
      .catch(() => toast.error('Error al eliminar'))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.entidad_id) {
      toast.error('Selecciona una entidad')
      return
    }
    setSaving(true)
    const payload = {
      tipo: form.tipo,
      entidad_id: Number(form.entidad_id),
      semana: Number(form.semana),
      mes: Number(form.mes),
      anio: Number(form.anio),
      monto: Number(form.monto) || 0,
      motivo: form.motivo.trim(),
    }

    api.post('/ajustes', payload)
      .then(() => {
        toast.success('Ajuste creado')
        setModalOpen(false)
        fetchAjustes()
      })
      .catch((err) => toast.error(err.response?.data?.detail || 'Error al guardar'))
      .finally(() => setSaving(false))
  }

  const sellersEnPeriodo = useMemo(() => {
    const ids = new Set(ajustes.filter(a => a.tipo === 'SELLER').map(a => a.entidad_id).filter(Boolean))
    return ids.size > 0 ? sellers.filter(s => ids.has(s.id)) : sellers
  }, [ajustes, sellers])

  const driversEnPeriodo = useMemo(() => {
    const ids = new Set(ajustes.filter(a => a.tipo === 'DRIVER').map(a => a.entidad_id).filter(Boolean))
    return ids.size > 0 ? drivers.filter(d => ids.has(d.id)) : drivers
  }, [ajustes, drivers])

  const entidades = form.tipo === 'SELLER' ? sellersEnPeriodo : driversEnPeriodo

  const columns = [
    {
      key: 'tipo',
      label: 'Tipo',
      render: (v) => (
        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${v === 'SELLER' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
          {v}
        </span>
      ),
    },
    { key: 'entidad_nombre', label: 'Entidad' },
    { key: 'semana', label: 'Semana', align: 'center' },
    { key: 'mes', label: 'Mes', align: 'center', render: (v) => MESES[(v || 1) - 1] },
    { key: 'anio', label: 'Año', align: 'center' },
    {
      key: 'monto',
      label: 'Monto',
      align: 'right',
      render: (v) => (
        <span className={Number(v || 0) >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
          {fmt(v)}
        </span>
      ),
    },
    { key: 'motivo', label: 'Motivo' },
    {
      key: 'acciones',
      label: '',
      align: 'right',
      render: (_, row) => (
        <button
          onClick={(e) => handleDeleteClick(e, row)}
          className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 transition-colors"
          title="Eliminar"
        >
          <Trash2 size={16} />
        </button>
      ),
    },
  ]

  if (loading && ajustes.length === 0) {
    return <div className="flex items-center justify-center h-64 text-gray-400">Cargando...</div>
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Settings size={28} className="text-primary-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Ajustes de Liquidación</h1>
            <p className="text-sm text-gray-500 mt-1">Gestiona los ajustes por periodo</p>
          </div>
        </div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2">
          <Plus size={18} />
          Nuevo Ajuste
        </button>
      </div>

      <div className="card mb-6">
        <h2 className="text-sm font-medium text-gray-700 mb-3">Filtrar por período</h2>
        <PeriodSelector
          semana={period.semana}
          mes={period.mes}
          anio={period.anio}
          onChange={setPeriod}
        />
      </div>

      <DataTable
        columns={columns}
        data={ajustes}
        emptyMessage="No hay ajustes para este periodo"
      />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nuevo Ajuste" wide>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
            <select
              className="input-field"
              value={form.tipo}
              onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value, entidad_id: '' }))}
            >
              <option value="SELLER">SELLER</option>
              <option value="DRIVER">DRIVER</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Entidad</label>
            <select
              className="input-field"
              value={form.entidad_id}
              onChange={(e) => setForm((f) => ({ ...f, entidad_id: e.target.value }))}
              required
            >
              <option value="">Seleccionar...</option>
              {entidades.map((e) => (
                <option key={e.id} value={e.id}>{e.nombre}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Semana (1-5)</label>
              <select
                className="input-field"
                value={form.semana}
                onChange={(e) => setForm((f) => ({ ...f, semana: Number(e.target.value) }))}
              >
                {[1, 2, 3, 4, 5].map((s) => (
                  <option key={s} value={s}>Semana {s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mes</label>
              <select
                className="input-field"
                value={form.mes}
                onChange={(e) => setForm((f) => ({ ...f, mes: Number(e.target.value) }))}
              >
                {MESES.map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Año</label>
              <input
                type="number"
                className="input-field"
                min={2020}
                max={2030}
                value={form.anio}
                onChange={(e) => setForm((f) => ({ ...f, anio: Number(e.target.value) }))}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Monto (CLP)</label>
            <input
              type="number"
              className="input-field"
              value={form.monto}
              onChange={(e) => setForm((f) => ({ ...f, monto: e.target.value }))}
              placeholder="Puede ser positivo o negativo"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Motivo</label>
            <textarea
              className="input-field min-h-[80px] resize-y"
              value={form.motivo}
              onChange={(e) => setForm((f) => ({ ...f, motivo: e.target.value }))}
              placeholder="Descripción del ajuste"
            />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Guardando...' : 'Crear Ajuste'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={deleteModalOpen} onClose={() => { setDeleteModalOpen(false); setToDelete(null) }} title="Eliminar Ajuste">
        {toDelete && (
          <div>
            <p className="text-gray-600 mb-4">
              ¿Eliminar el ajuste de {fmt(toDelete.monto)} para <strong>{toDelete.entidad_nombre}</strong>?
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
