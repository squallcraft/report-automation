import { useState, useEffect } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import { UserCog, Plus, Edit2, Trash2, ShieldCheck, RotateCcw, KeyRound, UserCheck, UserX, Store, Truck } from 'lucide-react'
import Modal from '../../components/Modal'

const ROL_LABELS = { ADMIN: 'Admin', ADMINISTRACION: 'Administración' }
const ROL_COLORS = {
  ADMIN: 'bg-red-100 text-red-700',
  ADMINISTRACION: 'bg-blue-100 text-blue-700',
}

// Permisos disponibles agrupados por categoría (formato seccion:ver / seccion:editar)
const GRUPOS_PERMISOS = [
  {
    grupo: 'Configuración',
    items: [
      { slug: 'sellers', label: 'Sellers' },
      { slug: 'drivers', label: 'Drivers' },
      { slug: 'pickups', label: 'Pickups' },
      { slug: 'productos', label: 'Productos Extra' },
      { slug: 'comunas', label: 'Comunas / Tarifas' },
    ],
  },
  {
    grupo: 'Envíos',
    items: [
      { slug: 'ingesta', label: 'Ingesta' },
      { slug: 'envios', label: 'Envíos' },
      { slug: 'retiros', label: 'Retiros' },
    ],
  },
  {
    grupo: 'Finanzas',
    items: [
      { slug: 'finanzas', label: 'Estado ECourier' },
      { slug: 'liquidacion', label: 'Liquidación' },
      { slug: 'facturacion', label: 'CPS Sellers' },
      { slug: 'cpc', label: 'CPC Drivers' },
      { slug: 'cpp', label: 'CPP Pickups' },
      { slug: 'ajustes', label: 'Ajustes' },
    ],
  },
  {
    grupo: 'Otros',
    items: [
      { slug: 'consultas', label: 'Consultas' },
      { slug: 'logs', label: 'Logs' },
      { slug: 'calendario', label: 'Calendario' },
      { slug: 'asistente', label: 'Asistente IA' },
    ],
  },
]

const TODOS_LOS_SLUGS = GRUPOS_PERMISOS.flatMap(g =>
  g.items.flatMap(i => [`${i.slug}:ver`, `${i.slug}:editar`])
)
const TOTAL_SECCIONES = GRUPOS_PERMISOS.reduce((n, g) => n + g.items.length, 0)

export default function Usuarios() {
  const [tab, setTab] = useState('admin') // 'admin' | 'sellers' | 'drivers'
  const [usuarios, setUsuarios] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showPermisos, setShowPermisos] = useState(false)
  const [editing, setEditing] = useState(null)
  const [editingPermisos, setEditingPermisos] = useState(null)
  const [form, setForm] = useState({ username: '', nombre: '', password: '', rol: 'ADMINISTRACION' })
  const [permisosSel, setPermisosSel] = useState([])

  // Accesos portal
  const [accesos, setAccesos] = useState([])
  const [loadingAccesos, setLoadingAccesos] = useState(false)
  const [showAccesoModal, setShowAccesoModal] = useState(false)
  const [accesoForm, setAccesoForm] = useState({ email: '', password: '' })
  const [editingAcceso, setEditingAcceso] = useState(null) // { tipo: 'sellers'|'drivers', item }
  const [accesoSearch, setAccesoSearch] = useState('')

  const cargar = () => {
    api.get('/usuarios')
      .then(({ data }) => setUsuarios(data))
      .catch(() => toast.error('Error cargando usuarios'))
      .finally(() => setLoading(false))
  }

  const cargarAccesos = (tipo) => {
    setLoadingAccesos(true)
    api.get(`/usuarios/accesos/${tipo}`)
      .then(({ data }) => setAccesos(data))
      .catch(() => toast.error('Error cargando accesos'))
      .finally(() => setLoadingAccesos(false))
  }

  useEffect(() => { cargar() }, [])

  useEffect(() => {
    if (tab === 'sellers' || tab === 'drivers') {
      setAccesoSearch('')
      cargarAccesos(tab)
    }
  }, [tab])

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

  const openPermisos = (u) => {
    setEditingPermisos(u)
    setPermisosSel(u.permisos_efectivos || [])
    setShowPermisos(true)
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

  const handleSavePermisos = async () => {
    try {
      await api.put(`/usuarios/${editingPermisos.id}/permisos`, { permisos: permisosSel })
      toast.success('Permisos actualizados')
      setShowPermisos(false)
      cargar()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error guardando permisos')
    }
  }

  const handleResetPermisos = async () => {
    if (!window.confirm('¿Restaurar los permisos por defecto para este usuario?')) return
    try {
      await api.delete(`/usuarios/${editingPermisos.id}/permisos`)
      toast.success('Permisos restaurados al default')
      setShowPermisos(false)
      cargar()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error')
    }
  }

  const togglePermiso = (slug, nivel) => {
    const key = `${slug}:${nivel}`
    setPermisosSel(prev => {
      if (prev.includes(key)) {
        if (nivel === 'ver') return prev.filter(p => p !== `${slug}:ver` && p !== `${slug}:editar`)
        return prev.filter(p => p !== key)
      }
      if (nivel === 'editar') return [...new Set([...prev, `${slug}:ver`, `${slug}:editar`])]
      return [...prev, key]
    })
  }

  const toggleGrupoNivel = (items, nivel) => {
    const keys = items.map(i => `${i.slug}:${nivel}`)
    const todosActivos = keys.every(k => permisosSel.includes(k))
    setPermisosSel(prev => {
      if (todosActivos) {
        if (nivel === 'ver') {
          const editarKeys = items.map(i => `${i.slug}:editar`)
          return prev.filter(p => !keys.includes(p) && !editarKeys.includes(p))
        }
        return prev.filter(p => !keys.includes(p))
      }
      if (nivel === 'editar') {
        const verKeys = items.map(i => `${i.slug}:ver`)
        return [...new Set([...prev, ...keys, ...verKeys])]
      }
      return [...new Set([...prev, ...keys])]
    })
  }

  const selectAll = () => setPermisosSel([...TODOS_LOS_SLUGS])
  const selectAllVer = () => {
    const verSlugs = GRUPOS_PERMISOS.flatMap(g => g.items.map(i => `${i.slug}:ver`))
    setPermisosSel([...verSlugs])
  }
  const clearAll = () => setPermisosSel([])

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

  const openAccesoModal = (tipo, item) => {
    setEditingAcceso({ tipo, item })
    setAccesoForm({ email: item.email || '', password: '' })
    setShowAccesoModal(true)
  }

  const handleSaveAcceso = async (e) => {
    e.preventDefault()
    if (!accesoForm.email.trim()) return toast.error('El email es obligatorio')
    if (!editingAcceso.item.tiene_acceso && !accesoForm.password.trim()) {
      return toast.error('La contraseña es obligatoria al crear acceso')
    }
    try {
      const payload = { email: accesoForm.email }
      if (accesoForm.password.trim()) payload.password = accesoForm.password
      await api.put(`/usuarios/accesos/${editingAcceso.tipo}/${editingAcceso.item.id}`, payload)
      toast.success('Acceso guardado')
      setShowAccesoModal(false)
      cargarAccesos(editingAcceso.tipo)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error guardando acceso')
    }
  }

  const handleRevocarAcceso = async (tipo, item) => {
    if (!window.confirm(`¿Revocar acceso portal de "${item.nombre}"? Esta persona no podrá iniciar sesión.`)) return
    try {
      await api.delete(`/usuarios/accesos/${tipo}/${item.id}`)
      toast.success('Acceso revocado')
      cargarAccesos(tipo)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error')
    }
  }

  const accedosFiltrados = accesos.filter(a =>
    a.nombre.toLowerCase().includes(accesoSearch.toLowerCase()) ||
    (a.email || '').toLowerCase().includes(accesoSearch.toLowerCase())
  )

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <UserCog size={24} className="text-primary-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Usuarios del Sistema</h1>
            <p className="text-sm text-gray-500">Gestión de accesos y permisos</p>
          </div>
        </div>
        {tab === 'admin' && (
          <button onClick={openCreate} className="btn-primary flex items-center gap-2">
            <Plus size={16} /> Nuevo Usuario
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {[
          { key: 'admin', label: 'Administradores', Icon: UserCog },
          { key: 'sellers', label: 'Acceso Sellers', Icon: Store },
          { key: 'drivers', label: 'Acceso Drivers', Icon: Truck },
        ].map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === key
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {/* Tab: Administradores */}
      {tab === 'admin' && (
        <>
          <div className="card p-4 bg-blue-50 border-blue-200 text-sm text-blue-800">
            <strong>Admin:</strong> Control total del sistema.{' '}
            <strong>Administración:</strong> Acceso personalizable por sección. Usa el botón{' '}
            <ShieldCheck size={13} className="inline" /> para editar sus permisos.
          </div>

          {loading ? (
            <div className="text-center py-12 text-gray-400">Cargando...</div>
          ) : (
            <div className="card overflow-hidden p-0 flex-1 min-h-0">
              <div className="overflow-auto h-full">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-gray-50">
                  <tr className="border-b border-gray-200">
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Usuario</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Nombre</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">Rol</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Permisos activos</th>
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
                      <td className="px-4 py-3">
                        {u.rol === 'ADMIN' ? (
                          <span className="text-xs text-gray-400 italic">Acceso total</span>
                        ) : (() => {
                          const perms = u.permisos_efectivos || []
                          const bases = [...new Set(perms.map(p => p.split(':')[0]))]
                          return (
                            <div className="flex flex-wrap gap-1 max-w-sm">
                              {bases.slice(0, 6).map(b => {
                                const hasEditar = perms.includes(`${b}:editar`)
                                return (
                                  <span
                                    key={b}
                                    className={`text-[10px] px-1.5 py-0.5 rounded border ${
                                      hasEditar
                                        ? 'bg-primary-50 text-primary-700 border-primary-100'
                                        : 'bg-gray-50 text-gray-500 border-gray-200 italic'
                                    }`}
                                    title={hasEditar ? 'Lectura y edición' : 'Solo lectura'}
                                  >
                                    {b}
                                  </span>
                                )
                              })}
                              {bases.length > 6 && (
                                <span className="text-[10px] text-gray-400">+{bases.length - 6}</span>
                              )}
                            </div>
                          )
                        })()}
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
                          {u.rol === 'ADMINISTRACION' && u.activo && (
                            <button onClick={() => openPermisos(u)} className="text-primary-600 hover:text-primary-800" title="Editar permisos">
                              <ShieldCheck size={15} />
                            </button>
                          )}
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
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No hay usuarios</td></tr>
                  )}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Tab: Accesos Sellers o Drivers */}
      {(tab === 'sellers' || tab === 'drivers') && (
        <>
          <div className="card p-4 bg-amber-50 border-amber-200 text-sm text-amber-800">
            {tab === 'sellers'
              ? 'Asigna email y contraseña a los sellers para que puedan acceder al portal de seguimiento.'
              : 'Asigna email y contraseña a los conductores para que puedan acceder al portal de liquidaciones.'}
          </div>

          <div className="flex gap-3">
            <input
              type="text"
              placeholder={`Buscar ${tab === 'sellers' ? 'seller' : 'driver'}...`}
              className="input-field flex-1 max-w-xs"
              value={accesoSearch}
              onChange={e => setAccesoSearch(e.target.value)}
            />
          </div>

          {loadingAccesos ? (
            <div className="text-center py-12 text-gray-400">Cargando...</div>
          ) : (
            <div className="card overflow-hidden p-0 flex-1 min-h-0">
              <div className="overflow-auto h-full">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-gray-50">
                    <tr className="border-b border-gray-200">
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Nombre</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Email de acceso</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">Portal</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">Estado</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accedosFiltrados.map(item => (
                      <tr key={item.id} className={`border-b border-gray-100 hover:bg-gray-50 ${!item.activo ? 'opacity-50' : ''}`}>
                        <td className="px-4 py-3 font-medium text-gray-800">{item.nombre}</td>
                        <td className="px-4 py-3 text-gray-600">{item.email || <span className="text-gray-300 italic">Sin email</span>}</td>
                        <td className="px-4 py-3 text-center">
                          {item.tiene_acceso ? (
                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">
                              <UserCheck size={12} /> Activo
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500">
                              <UserX size={12} /> Sin acceso
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded ${item.activo ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {item.activo ? 'Activo' : 'Inactivo'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => openAccesoModal(tab, item)}
                              className="text-blue-600 hover:text-blue-800"
                              title={item.tiene_acceso ? 'Editar acceso' : 'Crear acceso'}
                            >
                              <KeyRound size={15} />
                            </button>
                            {item.tiene_acceso && (
                              <button
                                onClick={() => handleRevocarAcceso(tab, item)}
                                className="text-red-500 hover:text-red-700"
                                title="Revocar acceso"
                              >
                                <UserX size={15} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {accedosFiltrados.length === 0 && (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No hay resultados</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal crear/editar usuario */}
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
              <option value="ADMINISTRACION">Administración (permisos configurables)</option>
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t border-gray-200">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancelar</button>
            <button type="submit" className="btn-primary">{editing ? 'Guardar' : 'Crear'}</button>
          </div>
        </form>
      </Modal>

      {/* Modal de permisos */}
      <Modal
        open={showPermisos}
        title={`Permisos — ${editingPermisos?.username || ''}`}
        onClose={() => setShowPermisos(false)}
        wide
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Configura el nivel de acceso por sección: <strong>Lectura</strong> permite visualizar los datos, <strong>Edición</strong> permite crear, modificar y eliminar.
          </p>

          {/* Acciones rápidas */}
          <div className="flex items-center gap-2 pb-2 border-b border-gray-100">
            <button type="button" onClick={selectAll} className="text-xs text-primary-600 hover:text-primary-800 font-medium">
              Acceso total
            </button>
            <span className="text-gray-300">|</span>
            <button type="button" onClick={selectAllVer} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
              Solo lectura
            </button>
            <span className="text-gray-300">|</span>
            <button type="button" onClick={clearAll} className="text-xs text-gray-500 hover:text-gray-700">
              Quitar todo
            </button>
            <span className="ml-auto text-xs text-gray-400">
              {permisosSel.filter(p => p.endsWith(':ver')).length} lectura · {permisosSel.filter(p => p.endsWith(':editar')).length} edición
            </span>
          </div>

          {/* Headers */}
          <div className="grid grid-cols-[1fr_3.5rem_3.5rem] gap-1 px-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
            <span />
            <span className="text-center">Leer</span>
            <span className="text-center">Editar</span>
          </div>

          {/* Checkboxes agrupados */}
          <div className="space-y-3 max-h-[26rem] overflow-y-auto pr-1">
            {GRUPOS_PERMISOS.map(({ grupo, items }) => {
              const verKeys = items.map(i => `${i.slug}:ver`)
              const editarKeys = items.map(i => `${i.slug}:editar`)
              const todosVer = verKeys.every(k => permisosSel.includes(k))
              const algunoVer = verKeys.some(k => permisosSel.includes(k))
              const todosEditar = editarKeys.every(k => permisosSel.includes(k))
              const algunoEditar = editarKeys.some(k => permisosSel.includes(k))
              return (
                <div key={grupo}>
                  {/* Group header */}
                  <div className="grid grid-cols-[1fr_3.5rem_3.5rem] gap-1 items-center mb-1.5">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{grupo}</span>
                    <div className="flex justify-center">
                      <button type="button" onClick={() => toggleGrupoNivel(items, 'ver')}>
                        <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors
                          ${todosVer ? 'bg-blue-500 border-blue-500' : algunoVer ? 'bg-blue-100 border-blue-400' : 'border-gray-300'}`}>
                          {todosVer && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 10 8"><path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                          {algunoVer && !todosVer && <div className="w-2 h-0.5 bg-blue-400 rounded" />}
                        </div>
                      </button>
                    </div>
                    <div className="flex justify-center">
                      <button type="button" onClick={() => toggleGrupoNivel(items, 'editar')}>
                        <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors
                          ${todosEditar ? 'bg-amber-500 border-amber-500' : algunoEditar ? 'bg-amber-100 border-amber-400' : 'border-gray-300'}`}>
                          {todosEditar && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 10 8"><path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                          {algunoEditar && !todosEditar && <div className="w-2 h-0.5 bg-amber-400 rounded" />}
                        </div>
                      </button>
                    </div>
                  </div>
                  {/* Items */}
                  {items.map(({ slug, label }) => (
                    <div key={slug} className="grid grid-cols-[1fr_3.5rem_3.5rem] gap-1 items-center py-1 ml-5">
                      <span className="text-sm text-gray-700">{label}</span>
                      <div className="flex justify-center">
                        <input
                          type="checkbox"
                          checked={permisosSel.includes(`${slug}:ver`)}
                          onChange={() => togglePermiso(slug, 'ver')}
                          className="rounded text-blue-500 focus:ring-blue-400 w-4 h-4 cursor-pointer"
                        />
                      </div>
                      <div className="flex justify-center">
                        <input
                          type="checkbox"
                          checked={permisosSel.includes(`${slug}:editar`)}
                          onChange={() => togglePermiso(slug, 'editar')}
                          className="rounded text-amber-500 focus:ring-amber-400 w-4 h-4 cursor-pointer"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-gray-200">
            <button
              type="button"
              onClick={handleResetPermisos}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
              title="Restaurar permisos por defecto del rol"
            >
              <RotateCcw size={14} /> Restaurar defaults
            </button>
            <div className="flex gap-3">
              <button type="button" onClick={() => setShowPermisos(false)} className="btn-secondary">Cancelar</button>
              <button type="button" onClick={handleSavePermisos} className="btn-primary">Guardar permisos</button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Modal crear/editar acceso portal seller/driver */}
      <Modal
        open={showAccesoModal}
        title={`${editingAcceso?.item?.tiene_acceso ? 'Editar' : 'Crear'} acceso — ${editingAcceso?.item?.nombre || ''}`}
        onClose={() => setShowAccesoModal(false)}
      >
        <form onSubmit={handleSaveAcceso} className="space-y-4">
          <p className="text-sm text-gray-500">
            {editingAcceso?.tipo === 'sellers'
              ? 'El seller usará este email y contraseña para acceder al portal de seguimiento.'
              : 'El conductor usará este email y contraseña para acceder al portal de liquidaciones.'}
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              className="input-field"
              value={accesoForm.email}
              onChange={e => setAccesoForm({ ...accesoForm, email: e.target.value })}
              placeholder="correo@ejemplo.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Contraseña{' '}
              {editingAcceso?.item?.tiene_acceso && (
                <span className="text-xs text-gray-400">(dejar vacío para no cambiar)</span>
              )}
            </label>
            <input
              type="password"
              className="input-field"
              value={accesoForm.password}
              onChange={e => setAccesoForm({ ...accesoForm, password: e.target.value })}
              placeholder={editingAcceso?.item?.tiene_acceso ? '••••••••' : 'Mínimo 6 caracteres'}
            />
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t border-gray-200">
            <button type="button" onClick={() => setShowAccesoModal(false)} className="btn-secondary">Cancelar</button>
            <button type="submit" className="btn-primary">
              {editingAcceso?.item?.tiene_acceso ? 'Actualizar acceso' : 'Crear acceso'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
