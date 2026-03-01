import { useState, useEffect } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import { UserCog, Plus, Edit2, Trash2 } from 'lucide-react'
import Modal from '../../components/Modal'

const ROL_LABELS = { ADMIN: 'Admin', ADMINISTRACION: 'Administración' }
const ROL_COLORS = {
  ADMIN: 'bg-red-100 text-red-700',
  ADMINISTRACION: 'bg-blue-100 text-blue-700',
}

export default function Usuarios() {
  const [usuarios, setUsuarios] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ username: '', nombre: '', password: '', rol: 'ADMINISTRACION' })

  const cargar = () => {
    api.get('/usuarios')
      .then(({ data }) => setUsuarios(data))
      .catch(() => toast.error('Error cargando usuarios'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { cargar() }, [])

  const openCreate = () => {
    setEditing(null)
    setForm({ username: '', nombre: '', password: '', rol: 'ADMINISTRACION' })
    setShowModal(true)
  }

  const openEdit = (u) => {
    setEditing(u)
    setForm({ username: u.username, nombre: u.nombre || '', password: '', rol: u.rol })
    setShowModal(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.username.trim()) return toast.error('El usuario es obligatorio')
    if (!editing && !form.password.trim()) return toast.error('La contraseña es obligatoria')

    try {
      if (editing) {
        const payload = { username: form.username, nombre: form.nombre, rol: form.rol }
        if (form.password.trim()) payload.password = form.password
        await api.put(`/usuarios/${editing.id}`, payload)
        toast.success('Usuario actualizado')
      } else {
        await api.post('/usuarios', form)
        toast.success('Usuario creado')
      }
      setShowModal(false)
      cargar()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error guardando usuario')
    }
  }

  const handleDelete = async (u) => {
    if (!window.confirm(`¿Desactivar usuario "${u.username}"?`)) return
    try {
      await api.delete(`/usuarios/${u.id}`)
      toast.success('Usuario desactivado')
      cargar()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error')
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <UserCog size={24} className="text-primary-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Usuarios del Sistema</h1>
            <p className="text-sm text-gray-500">Gestión de accesos administrativos</p>
          </div>
        </div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> Nuevo Usuario
        </button>
      </div>

      <div className="card mb-4 p-4 bg-blue-50 border-blue-200 text-sm text-blue-800">
        <strong>Admin:</strong> Control total del sistema.{' '}
        <strong>Administración:</strong> Puede ver todo, descargar PDFs, emitir facturas y gestionar pagos. No puede cargar ni modificar datos.
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Cargando...</div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Usuario</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Nombre</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">Rol</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">Estado</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map(u => (
                <tr key={u.id} className={`border-b border-gray-100 hover:bg-gray-50 ${!u.activo ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3 font-medium text-gray-800">{u.username}</td>
                  <td className="px-4 py-3 text-gray-600">{u.nombre || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${ROL_COLORS[u.rol] || 'bg-gray-100 text-gray-600'}`}>
                      {ROL_LABELS[u.rol] || u.rol}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded ${u.activo ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {u.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button onClick={() => openEdit(u)} className="text-blue-600 hover:text-blue-800" title="Editar">
                        <Edit2 size={15} />
                      </button>
                      {u.activo && (
                        <button onClick={() => handleDelete(u)} className="text-red-500 hover:text-red-700" title="Desactivar">
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!usuarios.length && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No hay usuarios</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={showModal} title={editing ? 'Editar Usuario' : 'Nuevo Usuario'} onClose={() => setShowModal(false)}>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Usuario</label>
              <input type="text" className="input-field" value={form.username}
                onChange={e => setForm({ ...form, username: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
              <input type="text" className="input-field" value={form.nombre}
                onChange={e => setForm({ ...form, nombre: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Contraseña {editing && <span className="text-xs text-gray-400">(dejar vacío para no cambiar)</span>}
              </label>
              <input type="password" className="input-field" value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rol</label>
              <select className="input-field" value={form.rol} onChange={e => setForm({ ...form, rol: e.target.value })}>
                <option value="ADMIN">Admin (control total)</option>
                <option value="ADMINISTRACION">Administración (solo lectura + pagos/facturas)</option>
              </select>
            </div>
            <div className="flex justify-end gap-3 pt-2 border-t border-gray-200">
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancelar</button>
              <button type="submit" className="btn-primary">{editing ? 'Guardar' : 'Crear'}</button>
            </div>
          </form>
        </Modal>
    </div>
  )
}
