import { useState, useEffect } from 'react'
import api from '../../api'
import PageHeader from '../../components/PageHeader'
import toast from 'react-hot-toast'
import { Users, Plus, Edit2, X, CheckCircle, XCircle, Clock, Download, DollarSign, AlertCircle, Eye } from 'lucide-react'
import { fmt, MESES } from '../../utils/format'

const now = new Date()

const ESTADO_BOLETA = {
  PENDIENTE: { label: 'Pendiente', icon: Clock, cls: 'text-blue-700 bg-blue-50 border-blue-200' },
  APROBADA: { label: 'Aprobada', icon: CheckCircle, cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  RECHAZADA: { label: 'Rechazada', icon: XCircle, cls: 'text-red-700 bg-red-50 border-red-200' },
  PAGADA: { label: 'Pagada', icon: DollarSign, cls: 'text-purple-700 bg-purple-50 border-purple-200' },
}

function Badge({ estado }) {
  const cfg = ESTADO_BOLETA[estado] || ESTADO_BOLETA.PENDIENTE
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cfg.cls}`}>
      <Icon size={11} /> {cfg.label}
    </span>
  )
}

export default function Colaboradores() {
  const [tab, setTab] = useState('lista')
  const [colaboradores, setColaboradores] = useState([])
  const [cuentas, setCuentas] = useState([])
  const [categorias, setCategorias] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState({})

  // Boletas tab
  const [mes, setMes] = useState(now.getMonth() + 1)
  const [anio, setAnio] = useState(now.getFullYear())
  const [boletas, setBoletas] = useState([])
  const [loadingBoletas, setLoadingBoletas] = useState(false)
  const [notaRechazo, setNotaRechazo] = useState('')
  const [rechazandoId, setRechazandoId] = useState(null)

  const cargarColaboradores = () => {
    setLoading(true)
    api.get('/colaboradores/')
      .then(({ data }) => setColaboradores(data))
      .catch(() => setColaboradores([]))
      .finally(() => setLoading(false))
  }

  const cargarBoletas = () => {
    setLoadingBoletas(true)
    api.get('/colaboradores/admin/boletas', { params: { mes, anio } })
      .then(({ data }) => setBoletas(data))
      .catch(() => setBoletas([]))
      .finally(() => setLoadingBoletas(false))
  }

  useEffect(() => {
    cargarColaboradores()
    api.get('/finanzas/contabilidad/plan-cuentas').then(({ data }) => setCuentas(data)).catch(() => {})
    api.get('/finanzas/categorias').then(({ data }) => setCategorias(data)).catch(() => {})
  }, [])

  useEffect(() => {
    if (tab === 'boletas') cargarBoletas()
  }, [tab, mes, anio])

  const openCreate = () => {
    setEditId(null)
    setForm({ nombre: '', email: '', especialidad: '', frecuencia_pago: 'mensual', activo: true })
    setShowForm(true)
  }

  const openEdit = (c) => {
    setEditId(c.id)
    setForm({ ...c, password: '' })
    setShowForm(true)
  }

  const guardar = async () => {
    try {
      const payload = { ...form }
      if (!payload.password) delete payload.password
      if (editId) {
        await api.put(`/colaboradores/${editId}`, payload)
        toast.success('Colaborador actualizado')
      } else {
        await api.post('/colaboradores/', payload)
        toast.success('Colaborador creado')
      }
      setShowForm(false)
      cargarColaboradores()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error guardando')
    }
  }

  const aprobar = async (id) => {
    try {
      await api.put(`/colaboradores/admin/boletas/${id}/revisar?accion=aprobar`)
      toast.success('Boleta aprobada')
      cargarBoletas()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error')
    }
  }

  const rechazar = async (id) => {
    try {
      await api.put(`/colaboradores/admin/boletas/${id}/revisar?accion=rechazar&nota=${encodeURIComponent(notaRechazo)}`)
      toast.success('Boleta rechazada')
      setRechazandoId(null)
      setNotaRechazo('')
      cargarBoletas()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error')
    }
  }

  const pagar = async (id) => {
    if (!confirm('¿Confirmar pago? Se generará asiento contable.')) return
    try {
      await api.put(`/colaboradores/admin/boletas/${id}/pagar`)
      toast.success('Pago registrado + asiento contable generado')
      cargarBoletas()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error')
    }
  }

  const descargar = async (id, nombre) => {
    try {
      const { data } = await api.get(`/colaboradores/admin/boletas/${id}/descargar`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([data]))
      const a = document.createElement('a')
      a.href = url
      a.download = nombre || 'boleta'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Error descargando')
    }
  }

  const flatCuentas = (cuentas || []).map(c => ({ id: c.id, label: `${c.codigo} — ${c.nombre}` }))

  const flatCategorias = []
  const flattenCats = (items, depth = 0) => {
    if (!items) return
    for (const c of (Array.isArray(items) ? items : [])) {
      flatCategorias.push({ id: c.id, label: `${'  '.repeat(depth)}${c.nombre}` })
      if (c.hijos) flattenCats(c.hijos, depth + 1)
    }
  }
  flattenCats(categorias)

  return (
    <div>
      <PageHeader title="Colaboradores" subtitle="Gestión de colaboradores externos" icon={Users} accent="purple" />

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
        {[
          { key: 'lista', label: 'Colaboradores' },
          { key: 'boletas', label: 'Boletas' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-colors ${tab === t.key ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Lista ── */}
      {tab === 'lista' && (
        <>
          <div className="flex justify-end mb-3">
            <button onClick={openCreate} className="btn-primary text-xs px-4 py-2 rounded-lg flex items-center gap-2">
              <Plus size={14} /> Nuevo colaborador
            </button>
          </div>

          <div className="card p-0 overflow-hidden">
            {loading ? (
              <div className="py-10 text-center text-gray-400">Cargando...</div>
            ) : colaboradores.length === 0 ? (
              <div className="py-10 text-center text-gray-400 text-sm">No hay colaboradores registrados</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs sm:text-sm min-w-[700px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Nombre</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Especialidad</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Monto</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Cuenta GL</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">Estado</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {colaboradores.map(c => (
                      <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium">{c.nombre}</td>
                        <td className="px-4 py-3 text-gray-600">{c.especialidad || '—'}</td>
                        <td className="px-4 py-3 text-gray-500">{c.email || '—'}</td>
                        <td className="px-4 py-3 text-right font-mono">{c.monto_acordado ? fmt(c.monto_acordado) : '—'}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{c.cuenta_contable_nombre || '—'}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-block w-2 h-2 rounded-full ${c.activo ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                        </td>
                        <td className="px-4 py-3">
                          <button onClick={() => openEdit(c)} className="text-blue-600 hover:text-blue-800">
                            <Edit2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Tab: Boletas ── */}
      {tab === 'boletas' && (
        <>
          <div className="flex gap-3 mb-4 items-end">
            <div>
              <label className="block text-[10px] font-medium text-gray-500 mb-1">Mes</label>
              <select className="input-field text-xs w-28" value={mes} onChange={e => setMes(+e.target.value)}>
                {MESES.map((l, i) => <option key={i + 1} value={i + 1}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-medium text-gray-500 mb-1">Año</label>
              <select className="input-field text-xs w-20" value={anio} onChange={e => setAnio(+e.target.value)}>
                {[now.getFullYear(), now.getFullYear() - 1].map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>

          <div className="card p-0 overflow-hidden">
            {loadingBoletas ? (
              <div className="py-10 text-center text-gray-400">Cargando...</div>
            ) : boletas.length === 0 ? (
              <div className="py-10 text-center text-gray-400 text-sm">Sin boletas para este período</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs sm:text-sm min-w-[700px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Colaborador</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Concepto</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">N° Boleta</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Monto</th>
                      <th className="px-4 py-3 font-medium text-gray-600">Estado</th>
                      <th className="px-4 py-3 font-medium text-gray-600">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {boletas.map(b => (
                      <tr key={b.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="font-medium">{b.colaborador_nombre}</div>
                          <div className="text-[10px] text-gray-400">{b.especialidad || ''}</div>
                        </td>
                        <td className="px-4 py-3 text-gray-700 max-w-[200px] truncate" title={b.concepto}>
                          {b.concepto || '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{b.numero_boleta || '—'}</td>
                        <td className="px-4 py-3 text-right font-mono">{fmt(b.monto)}</td>
                        <td className="px-4 py-3"><Badge estado={b.estado} /></td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {b.archivo_nombre && (
                              <button onClick={() => descargar(b.id, b.archivo_nombre)} title="Descargar"
                                className="text-blue-600 hover:text-blue-800"><Download size={14} /></button>
                            )}
                            {b.estado === 'PENDIENTE' && (
                              <>
                                <button onClick={() => aprobar(b.id)} title="Aprobar"
                                  className="text-emerald-600 hover:text-emerald-800"><CheckCircle size={14} /></button>
                                <button onClick={() => { setRechazandoId(b.id); setNotaRechazo('') }} title="Rechazar"
                                  className="text-red-600 hover:text-red-800"><XCircle size={14} /></button>
                              </>
                            )}
                            {b.estado === 'APROBADA' && (
                              <button onClick={() => pagar(b.id)} title="Registrar pago"
                                className="text-purple-600 hover:text-purple-800 flex items-center gap-1 text-xs font-medium">
                                <DollarSign size={14} /> Pagar
                              </button>
                            )}
                          </div>
                          {rechazandoId === b.id && (
                            <div className="mt-2 flex gap-2 items-center">
                              <input className="input-field text-xs flex-1" placeholder="Motivo rechazo..."
                                value={notaRechazo} onChange={e => setNotaRechazo(e.target.value)} />
                              <button onClick={() => rechazar(b.id)}
                                className="text-xs bg-red-600 text-white px-3 py-1 rounded">Rechazar</button>
                              <button onClick={() => setRechazandoId(null)} className="text-xs text-gray-400">Cancelar</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Modal Form ── */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-sm font-semibold">{editId ? 'Editar colaborador' : 'Nuevo colaborador'}</h2>
              <button onClick={() => setShowForm(false)}><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Nombre *</label>
                  <input className="input-field text-sm w-full" value={form.nombre || ''}
                    onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Especialidad</label>
                  <input className="input-field text-sm w-full" placeholder="Ej: Electricista, Desarrollador"
                    value={form.especialidad || ''} onChange={e => setForm(f => ({ ...f, especialidad: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Email (login)</label>
                  <input type="email" className="input-field text-sm w-full" value={form.email || ''}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Contraseña {editId ? '(dejar vacío para mantener)' : ''}</label>
                  <input type="password" className="input-field text-sm w-full" value={form.password || ''}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">RUT</label>
                  <input className="input-field text-sm w-full" value={form.rut || ''}
                    onChange={e => setForm(f => ({ ...f, rut: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Teléfono</label>
                  <input className="input-field text-sm w-full" value={form.telefono || ''}
                    onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} />
                </div>
              </div>

              <div className="border-t pt-4">
                <h3 className="text-xs font-semibold text-gray-600 mb-3">Contrato</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Descripción del servicio</label>
                    <input className="input-field text-sm w-full" value={form.descripcion_servicio || ''}
                      onChange={e => setForm(f => ({ ...f, descripcion_servicio: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Monto acordado (CLP)</label>
                    <input type="number" className="input-field text-sm w-full" value={form.monto_acordado || ''}
                      onChange={e => setForm(f => ({ ...f, monto_acordado: e.target.value ? parseInt(e.target.value) : null }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Frecuencia de pago</label>
                    <select className="input-field text-sm w-full" value={form.frecuencia_pago || 'mensual'}
                      onChange={e => setForm(f => ({ ...f, frecuencia_pago: e.target.value }))}>
                      <option value="mensual">Mensual</option>
                      <option value="semanal">Semanal</option>
                      <option value="por_servicio">Por servicio</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Fecha inicio</label>
                    <input type="date" className="input-field text-sm w-full" value={form.fecha_inicio || ''}
                      onChange={e => setForm(f => ({ ...f, fecha_inicio: e.target.value || null }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Fecha fin</label>
                    <input type="date" className="input-field text-sm w-full" value={form.fecha_fin || ''}
                      onChange={e => setForm(f => ({ ...f, fecha_fin: e.target.value || null }))} />
                  </div>
                </div>
              </div>

              <div className="border-t pt-4">
                <h3 className="text-xs font-semibold text-gray-600 mb-3">Datos bancarios</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Banco</label>
                    <input className="input-field text-sm w-full" value={form.banco || ''}
                      onChange={e => setForm(f => ({ ...f, banco: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Tipo cuenta</label>
                    <input className="input-field text-sm w-full" placeholder="Corriente / Vista" value={form.tipo_cuenta || ''}
                      onChange={e => setForm(f => ({ ...f, tipo_cuenta: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">N° cuenta</label>
                    <input className="input-field text-sm w-full" value={form.numero_cuenta || ''}
                      onChange={e => setForm(f => ({ ...f, numero_cuenta: e.target.value }))} />
                  </div>
                </div>
              </div>

              <div className="border-t pt-4">
                <h3 className="text-xs font-semibold text-gray-600 mb-3">Asignación contable</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Cuenta contable (GL)</label>
                    <select className="input-field text-sm w-full" value={form.cuenta_contable_id || ''}
                      onChange={e => setForm(f => ({ ...f, cuenta_contable_id: e.target.value ? parseInt(e.target.value) : null }))}>
                      <option value="">— Sin asignar (usa Freelancers) —</option>
                      {flatCuentas.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Categoría financiera</label>
                    <select className="input-field text-sm w-full" value={form.categoria_financiera_id || ''}
                      onChange={e => setForm(f => ({ ...f, categoria_financiera_id: e.target.value ? parseInt(e.target.value) : null }))}>
                      <option value="">— Sin asignar —</option>
                      {flatCategorias.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.activo ?? true}
                    onChange={e => setForm(f => ({ ...f, activo: e.target.checked }))} />
                  Activo
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t">
              <button onClick={() => setShowForm(false)} className="text-xs text-gray-500 px-4 py-2">Cancelar</button>
              <button onClick={guardar} className="btn-primary text-xs px-6 py-2 rounded-lg">{editId ? 'Guardar' : 'Crear'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
