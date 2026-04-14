import { useState, useEffect } from 'react'
import api from '../../api'
import Modal from '../../components/Modal'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, Layers, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import PageHeader from '../../components/PageHeader'

const fmt = (v) => `$${Number(v || 0).toLocaleString('es-CL')}`
const capitalize = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : ''

export default function PlanesTarifarios() {
  const [planes, setPlanes] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState({})

  const [newPlanModal, setNewPlanModal] = useState(false)
  const [newPlanForm, setNewPlanForm] = useState({ plan: '', comuna: '', precio: 0 })
  const [saving, setSaving] = useState(false)

  const [comunaModal, setComunaModal] = useState(false)
  const [comunaForm, setComunaForm] = useState({ comuna: '', precio: 0 })
  const [editingComuna, setEditingComuna] = useState(null)
  const [activePlan, setActivePlan] = useState(null)

  const [deleteModal, setDeleteModal] = useState(false)
  const [toDelete, setToDelete] = useState(null)

  const [deletePlanModal, setDeletePlanModal] = useState(false)
  const [planToDelete, setPlanToDelete] = useState(null)

  const [recalculating, setRecalculating] = useState(null)

  const fetchPlanes = () => {
    api.get('/planes-tarifarios')
      .then(({ data }) => setPlanes(data))
      .catch(() => toast.error('Error al cargar planes tarifarios'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchPlanes() }, [])

  const toggleExpand = (plan) => {
    setExpanded((prev) => ({ ...prev, [plan]: !prev[plan] }))
  }

  const recalcular = async (planName) => {
    setRecalculating(planName)
    try {
      const { data } = await api.put(`/planes-tarifarios/${planName}/recalcular`)
      if (data.actualizados > 0) {
        toast.success(`${data.actualizados} envío(s) recalculado(s)`)
      } else {
        toast.success('Sin envíos pendientes que actualizar')
      }
    } catch {
      toast.error('Error al recalcular')
    } finally {
      setRecalculating(null)
    }
  }

  const handleCreatePlan = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.post('/planes-tarifarios', {
        plan: newPlanForm.plan.trim(),
        comunas: [{ comuna: newPlanForm.comuna.trim(), precio: Number(newPlanForm.precio) || 0 }],
      })
      toast.success('Plan creado')
      setNewPlanModal(false)
      setNewPlanForm({ plan: '', comuna: '', precio: 0 })
      fetchPlanes()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al crear plan')
    } finally {
      setSaving(false)
    }
  }

  const openAddComuna = (planName) => {
    setActivePlan(planName)
    setEditingComuna(null)
    setComunaForm({ comuna: '', precio: 0 })
    setComunaModal(true)
  }

  const openEditComuna = (planName, comuna) => {
    setActivePlan(planName)
    setEditingComuna(comuna)
    setComunaForm({ comuna: comuna.comuna, precio: comuna.precio })
    setComunaModal(true)
  }

  const handleComunaSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.put(`/planes-tarifarios/${activePlan}/comuna`, {
        comuna: comunaForm.comuna.trim(),
        precio: Number(comunaForm.precio) || 0,
      })
      toast.success(editingComuna ? 'Comuna actualizada' : 'Comuna agregada')
      setComunaModal(false)
      fetchPlanes()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const openDeleteComuna = (planName, comuna) => {
    setActivePlan(planName)
    setToDelete(comuna)
    setDeleteModal(true)
  }

  const confirmDeleteComuna = async () => {
    if (!toDelete || !activePlan) return
    try {
      await api.delete(`/planes-tarifarios/${activePlan}/comuna/${toDelete.id}`)
      toast.success('Comuna eliminada')
      setDeleteModal(false)
      setToDelete(null)
      fetchPlanes()
    } catch {
      toast.error('Error al eliminar')
    }
  }

  const openDeletePlan = (planName) => {
    setPlanToDelete(planName)
    setDeletePlanModal(true)
  }

  const confirmDeletePlan = async () => {
    if (!planToDelete) return
    try {
      await api.delete(`/planes-tarifarios/${planToDelete}`)
      toast.success('Plan eliminado')
      setDeletePlanModal(false)
      setPlanToDelete(null)
      fetchPlanes()
    } catch {
      toast.error('Error al eliminar plan')
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-400">Cargando...</div>
  }

  return (
    <div>
      <PageHeader
        title="Planes Tarifarios"
        subtitle="Tarifas por comuna para grupos de sellers"
        icon={Layers}
        accent="blue"
        actions={
          <button onClick={() => setNewPlanModal(true)} className="btn-primary flex items-center gap-2">
            <Plus size={18} /> Nuevo Plan
          </button>
        }
      />

      {planes.length === 0 && (
        <div className="text-center text-gray-400 py-16">No hay planes tarifarios configurados</div>
      )}

      <div className="space-y-4">
        {planes.map((p) => (
          <div key={p.plan} className="card border border-gray-200 rounded-xl overflow-hidden">
            <div
              className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={() => toggleExpand(p.plan)}
            >
              <div className="flex items-center gap-3 min-w-0">
                {expanded[p.plan] ? <ChevronDown size={18} className="text-gray-400 shrink-0" /> : <ChevronRight size={18} className="text-gray-400 shrink-0" />}
                <div className="min-w-0">
                  <h3 className="font-semibold text-gray-900">{p.plan}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {p.comunas.length} comuna{p.comunas.length !== 1 ? 's' : ''}
                  </p>
                </div>
                {p.sellers.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 ml-3">
                    {p.sellers.map((s) => (
                      <span key={s.id} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-700">
                        {s.nombre}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-4">
                <button
                  onClick={(e) => { e.stopPropagation(); openDeletePlan(p.plan) }}
                  className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 transition-colors"
                  title="Eliminar plan"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            {expanded[p.plan] && (
              <div className="border-t border-gray-200 px-5 py-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-100">
                        <th className="pb-2 font-medium">Comuna</th>
                        <th className="pb-2 font-medium text-right">Precio</th>
                        <th className="pb-2 w-20"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.comunas.map((c) => (
                        <tr key={c.id} className="border-b border-gray-50 last:border-0">
                          <td className="py-2.5">{capitalize(c.comuna)}</td>
                          <td className="py-2.5 text-right font-medium">{fmt(c.precio)}</td>
                          <td className="py-2.5">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => openEditComuna(p.plan, c)}
                                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-primary-600 transition-colors"
                                title="Editar"
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                onClick={() => openDeleteComuna(p.plan, c)}
                                className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 transition-colors"
                                title="Eliminar"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center gap-3 mt-4 pt-3 border-t border-gray-100">
                  <button
                    onClick={() => openAddComuna(p.plan)}
                    className="btn-secondary flex items-center gap-1.5 text-sm"
                  >
                    <Plus size={15} />
                    Agregar Comuna
                  </button>
                  <button
                    onClick={() => recalcular(p.plan)}
                    disabled={recalculating === p.plan}
                    className="btn-primary flex items-center gap-1.5 text-sm"
                  >
                    <RefreshCw size={15} className={recalculating === p.plan ? 'animate-spin' : ''} />
                    {recalculating === p.plan ? 'Recalculando...' : 'Recalcular'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* New Plan Modal */}
      <Modal open={newPlanModal} onClose={() => setNewPlanModal(false)} title="Nuevo Plan Tarifario">
        <form onSubmit={handleCreatePlan} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del Plan</label>
            <input
              type="text"
              className="input-field"
              value={newPlanForm.plan}
              onChange={(e) => setNewPlanForm((f) => ({ ...f, plan: e.target.value }))}
              placeholder="Ej: plan_premium"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Primera Comuna</label>
            <input
              type="text"
              className="input-field"
              value={newPlanForm.comuna}
              onChange={(e) => setNewPlanForm((f) => ({ ...f, comuna: e.target.value }))}
              placeholder="Ej: providencia"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Precio (CLP)</label>
            <input
              type="number"
              className="input-field"
              min={0}
              value={newPlanForm.precio}
              onChange={(e) => setNewPlanForm((f) => ({ ...f, precio: e.target.value }))}
              required
            />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <button type="button" onClick={() => setNewPlanModal(false)} className="btn-secondary">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Creando...' : 'Crear Plan'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Add/Edit Comuna Modal */}
      <Modal open={comunaModal} onClose={() => setComunaModal(false)} title={editingComuna ? 'Editar Comuna' : 'Agregar Comuna'}>
        <form onSubmit={handleComunaSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Comuna</label>
            <input
              type="text"
              className="input-field"
              value={comunaForm.comuna}
              onChange={(e) => setComunaForm((f) => ({ ...f, comuna: e.target.value }))}
              placeholder="Ej: las condes"
              required
              readOnly={!!editingComuna}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Precio (CLP)</label>
            <input
              type="number"
              className="input-field"
              min={0}
              value={comunaForm.precio}
              onChange={(e) => setComunaForm((f) => ({ ...f, precio: e.target.value }))}
              required
            />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <button type="button" onClick={() => setComunaModal(false)} className="btn-secondary">
              Cancelar
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Guardando...' : editingComuna ? 'Actualizar' : 'Agregar'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Comuna Modal */}
      <Modal open={deleteModal} onClose={() => { setDeleteModal(false); setToDelete(null) }} title="Eliminar Comuna">
        {toDelete && (
          <div>
            <p className="text-gray-600 mb-4">
              ¿Eliminar <strong>{capitalize(toDelete.comuna)}</strong> del plan <strong>{activePlan}</strong>?
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => { setDeleteModal(false); setToDelete(null) }} className="btn-secondary">
                Cancelar
              </button>
              <button onClick={confirmDeleteComuna} className="btn-danger">
                Eliminar
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete Plan Modal */}
      <Modal open={deletePlanModal} onClose={() => { setDeletePlanModal(false); setPlanToDelete(null) }} title="Eliminar Plan">
        {planToDelete && (
          <div>
            <p className="text-gray-600 mb-4">
              ¿Eliminar el plan <strong>{planToDelete}</strong> y todas sus comunas? Esta acción no se puede deshacer.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => { setDeletePlanModal(false); setPlanToDelete(null) }} className="btn-secondary">
                Cancelar
              </button>
              <button onClick={confirmDeletePlan} className="btn-danger">
                Eliminar Plan
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
