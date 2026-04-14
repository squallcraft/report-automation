import { useState, useEffect, useMemo } from 'react'
import api from '../../api'
import DataTable from '../../components/DataTable'
import Modal from '../../components/Modal'
import PeriodSelector from '../../components/PeriodSelector'
import toast from 'react-hot-toast'
import { Plus, Trash2, CircleDollarSign, Eye, XCircle, Check, Gift } from 'lucide-react'
import PageHeader from '../../components/PageHeader'

const fmt = (v) => `$${Number(v || 0).toLocaleString('es-CL')}`

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]
const MESES_IDX = ['', ...MESES]

const now = new Date()
const initialPeriod = {
  semana: 1,
  mes: now.getMonth() + 1,
  anio: now.getFullYear(),
}

// ─────────────────────────────────────────────────────────────────
// Tab: Ajustes de liquidación
// ─────────────────────────────────────────────────────────────────
function TabAjustes() {
  const [ajustes, setAjustes] = useState([])
  const [sellers, setSellers] = useState([])
  const [drivers, setDrivers] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [period, setPeriod] = useState(initialPeriod)
  const [form, setForm] = useState({ tipo: 'SELLER', entidad_id: '', semana: 1, mes: 1, anio: now.getFullYear(), monto: 0, motivo: '' })
  const [saving, setSaving] = useState(false)
  const [toDelete, setToDelete] = useState(null)

  const fetchAjustes = () => {
    setLoading(true)
    api.get('/ajustes', { params: { semana: period.semana, mes: period.mes, anio: period.anio } })
      .then(({ data }) => setAjustes(data))
      .catch(() => toast.error('Error al cargar ajustes'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchAjustes() }, [period])
  useEffect(() => {
    api.get('/sellers', { params: { activo: true } }).then(({ data }) => setSellers(data)).catch(() => {})
    api.get('/drivers').then(({ data }) => setDrivers(data)).catch(() => {})
  }, [])

  const openCreate = () => {
    setForm({ tipo: 'SELLER', entidad_id: '', semana: period.semana, mes: period.mes, anio: period.anio, monto: 0, motivo: '' })
    setModalOpen(true)
  }

  const confirmDelete = () => {
    if (!toDelete) return
    api.delete(`/ajustes/${toDelete.id}`)
      .then(() => { toast.success('Ajuste eliminado'); fetchAjustes(); setDeleteModalOpen(false); setToDelete(null) })
      .catch(() => toast.error('Error al eliminar'))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.entidad_id) return toast.error('Selecciona una entidad')
    setSaving(true)
    api.post('/ajustes', {
      tipo: form.tipo, entidad_id: Number(form.entidad_id),
      semana: Number(form.semana), mes: Number(form.mes), anio: Number(form.anio),
      monto: Number(form.monto) || 0, motivo: form.motivo.trim(),
    })
      .then(() => { toast.success('Ajuste creado'); setModalOpen(false); fetchAjustes() })
      .catch((err) => toast.error(err.response?.data?.detail || 'Error al guardar'))
      .finally(() => setSaving(false))
  }

  const entidades = form.tipo === 'SELLER' ? sellers : drivers

  const columns = [
    { key: 'tipo', label: 'Tipo', render: (v) => <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${v === 'SELLER' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>{v}</span> },
    { key: 'entidad_nombre', label: 'Entidad' },
    { key: 'semana', label: 'Semana', align: 'center' },
    { key: 'mes', label: 'Mes', align: 'center', render: (v) => MESES[(v || 1) - 1] },
    { key: 'anio', label: 'Año', align: 'center' },
    { key: 'monto', label: 'Monto', align: 'right', render: (v) => <span className={Number(v || 0) >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>{fmt(v)}</span> },
    { key: 'motivo', label: 'Motivo' },
    { key: 'acciones', label: '', align: 'right', render: (_, row) => (
      <button onClick={(e) => { e.stopPropagation(); setToDelete(row); setDeleteModalOpen(true) }} className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 transition-colors"><Trash2 size={16} /></button>
    )},
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">Ajustes de liquidación para sellers y drivers por período</p>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2"><Plus size={18} /> Nuevo Ajuste</button>
      </div>

      <div className="card mb-6">
        <h2 className="text-sm font-medium text-gray-700 mb-3">Filtrar por período</h2>
        <PeriodSelector semana={period.semana} mes={period.mes} anio={period.anio} onChange={setPeriod} />
      </div>

      <DataTable columns={columns} data={ajustes} emptyMessage="No hay ajustes para este periodo" />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Nuevo Ajuste" wide>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
            <select className="input-field" value={form.tipo} onChange={(e) => setForm(f => ({ ...f, tipo: e.target.value, entidad_id: '' }))}>
              <option value="SELLER">SELLER</option>
              <option value="DRIVER">DRIVER</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Entidad</label>
            <select className="input-field" value={form.entidad_id} onChange={(e) => setForm(f => ({ ...f, entidad_id: e.target.value }))} required>
              <option value="">Seleccionar...</option>
              {entidades.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Semana</label>
              <select className="input-field" value={form.semana} onChange={(e) => setForm(f => ({ ...f, semana: Number(e.target.value) }))}>
                {[1,2,3,4,5].map(s => <option key={s} value={s}>Semana {s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mes</label>
              <select className="input-field" value={form.mes} onChange={(e) => setForm(f => ({ ...f, mes: Number(e.target.value) }))}>
                {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Año</label>
              <input type="number" className="input-field" min={2020} max={2030} value={form.anio} onChange={(e) => setForm(f => ({ ...f, anio: Number(e.target.value) }))} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Monto (CLP)</label>
            <input type="number" className="input-field" value={form.monto} onChange={(e) => setForm(f => ({ ...f, monto: e.target.value }))} placeholder="Puede ser positivo o negativo" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Motivo</label>
            <textarea className="input-field min-h-[80px] resize-y" value={form.motivo} onChange={(e) => setForm(f => ({ ...f, motivo: e.target.value }))} placeholder="Descripción del ajuste" />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Guardando...' : 'Crear Ajuste'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={deleteModalOpen} onClose={() => { setDeleteModalOpen(false); setToDelete(null) }} title="Eliminar Ajuste">
        {toDelete && (
          <div>
            <p className="text-gray-600 mb-4">¿Eliminar el ajuste de {fmt(toDelete.monto)} para <strong>{toDelete.entidad_nombre}</strong>?</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => { setDeleteModalOpen(false); setToDelete(null) }} className="btn-secondary">Cancelar</button>
              <button onClick={confirmDelete} className="btn-danger">Eliminar</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Tab: Préstamos
// ─────────────────────────────────────────────────────────────────
const ESTADO_BADGE = {
  ACTIVO: 'bg-blue-100 text-blue-700',
  PAGADO: 'bg-green-100 text-green-700',
  CANCELADO: 'bg-gray-100 text-gray-500',
}

function TabPrestamos() {
  const [prestamos, setPrestamos] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [detailModal, setDetailModal] = useState(null)
  const [form, setForm] = useState({ tipo_beneficiario: 'TRABAJADOR', trabajador_id: '', driver_id: '', monto_total: '', monto_cuota: '', modalidad: 'cuota_fija', porcentaje: '', mes_inicio: now.getMonth() + 1, anio_inicio: now.getFullYear(), motivo: '' })
  const [trabajadores, setTrabajadores] = useState([])
  const [drivers, setDrivers] = useState([])
  const [filterEstado, setFilterEstado] = useState('')
  const [filterTipo, setFilterTipo] = useState('')

  const load = () => {
    setLoading(true)
    const params = {}
    if (filterEstado) params.estado = filterEstado
    if (filterTipo) params.tipo = filterTipo
    api.get('/prestamos', { params })
      .then(({ data }) => setPrestamos(data))
      .catch(() => toast.error('Error cargando préstamos'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [filterEstado, filterTipo])
  useEffect(() => {
    api.get('/trabajadores').then(({ data }) => setTrabajadores(data)).catch(() => {})
    api.get('/drivers').then(({ data }) => setDrivers(data)).catch(() => {})
  }, [])

  const cuotasEstimadas = useMemo(() => {
    const total = Number(form.monto_total) || 0
    const cuota = Number(form.monto_cuota) || 0
    if (cuota <= 0 || total <= 0) return 0
    return Math.ceil(total / cuota)
  }, [form.monto_total, form.monto_cuota])

  const handleSubmit = async (e) => {
    e.preventDefault()
    const payload = {
      tipo_beneficiario: form.tipo_beneficiario,
      trabajador_id: form.tipo_beneficiario === 'TRABAJADOR' ? Number(form.trabajador_id) : null,
      driver_id: form.tipo_beneficiario === 'DRIVER' ? Number(form.driver_id) : null,
      monto_total: Number(form.monto_total), monto_cuota: Number(form.monto_cuota),
      modalidad: form.modalidad, porcentaje: form.porcentaje ? Number(form.porcentaje) : null,
      mes_inicio: Number(form.mes_inicio), anio_inicio: Number(form.anio_inicio),
      motivo: form.motivo || null,
    }
    try {
      await api.post('/prestamos', payload)
      toast.success('Préstamo creado'); setShowModal(false); load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Error al crear') }
  }

  const openDetail = async (p) => {
    try { const { data } = await api.get(`/prestamos/${p.id}`); setDetailModal(data) }
    catch { toast.error('Error cargando detalle') }
  }

  const pagarCuota = async (prestamoId, cuotaId) => {
    try {
      await api.post(`/prestamos/${prestamoId}/pagar-cuota?cuota_id=${cuotaId}`)
      toast.success('Cuota marcada como pagada')
      const { data } = await api.get(`/prestamos/${prestamoId}`)
      setDetailModal(data); load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Error') }
  }

  const cancelar = async (prestamoId) => {
    if (!confirm('¿Cancelar este préstamo?')) return
    try { await api.post(`/prestamos/${prestamoId}/cancelar`); toast.success('Préstamo cancelado'); setDetailModal(null); load() }
    catch { toast.error('Error al cancelar') }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Préstamos a trabajadores y conductores</p>
        <button onClick={() => { setForm({ tipo_beneficiario: 'TRABAJADOR', trabajador_id: '', driver_id: '', monto_total: '', monto_cuota: '', modalidad: 'cuota_fija', porcentaje: '', mes_inicio: now.getMonth() + 1, anio_inicio: now.getFullYear(), motivo: '' }); setShowModal(true) }} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> Nuevo Préstamo
        </button>
      </div>

      <div className="flex items-center gap-3">
        <select value={filterEstado} onChange={e => setFilterEstado(e.target.value)} className="input w-40">
          <option value="">Todos los estados</option>
          <option value="ACTIVO">Activos</option>
          <option value="PAGADO">Pagados</option>
          <option value="CANCELADO">Cancelados</option>
        </select>
        <select value={filterTipo} onChange={e => setFilterTipo(e.target.value)} className="input w-40">
          <option value="">Todos los tipos</option>
          <option value="TRABAJADOR">Trabajadores</option>
          <option value="DRIVER">Drivers</option>
        </select>
      </div>

      {loading ? <div className="text-center py-12 text-gray-400">Cargando...</div>
      : prestamos.length === 0 ? <div className="text-center py-12 text-gray-400">No hay préstamos registrados</div>
      : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase border-b bg-gray-50">
                <th className="py-3 px-4">Beneficiario</th>
                <th className="py-3 px-4">Tipo</th>
                <th className="py-3 px-4 text-right">Monto Total</th>
                <th className="py-3 px-4 text-right">Cuota</th>
                <th className="py-3 px-4 text-right">Saldo</th>
                <th className="py-3 px-4 text-center">Cuotas</th>
                <th className="py-3 px-4 text-center">Inicio</th>
                <th className="py-3 px-4 text-center">Estado</th>
                <th className="py-3 px-4 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {prestamos.map(p => (
                <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-3 px-4 font-medium text-gray-900">{p.beneficiario_nombre}</td>
                  <td className="py-3 px-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${p.tipo_beneficiario === 'DRIVER' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                      {p.tipo_beneficiario === 'DRIVER' ? 'Driver' : 'Trabajador'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">{fmt(p.monto_total)}</td>
                  <td className="py-3 px-4 text-right">{fmt(p.monto_cuota)}</td>
                  <td className="py-3 px-4 text-right font-semibold">
                    {p.saldo_pendiente > 0 ? <span className="text-red-600">{fmt(p.saldo_pendiente)}</span> : <span className="text-green-600">{fmt(0)}</span>}
                  </td>
                  <td className="py-3 px-4 text-center text-gray-600">{p.cuotas_pagadas}/{p.cuotas_total}</td>
                  <td className="py-3 px-4 text-center text-gray-500">{MESES_IDX[p.mes_inicio]?.substring(0, 3)} {p.anio_inicio}</td>
                  <td className="py-3 px-4 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ESTADO_BADGE[p.estado] || 'bg-gray-100'}`}>{p.estado}</span>
                  </td>
                  <td className="py-3 px-4">
                    <button onClick={() => openDetail(p)} className="p-1 rounded hover:bg-blue-100 text-blue-600"><Eye size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Crear */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="Nuevo Préstamo" wide>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de beneficiario</label>
              <select value={form.tipo_beneficiario} onChange={e => setForm(f => ({ ...f, tipo_beneficiario: e.target.value, trabajador_id: '', driver_id: '' }))} className="input-field">
                <option value="TRABAJADOR">Trabajador</option>
                <option value="DRIVER">Driver</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Beneficiario *</label>
              {form.tipo_beneficiario === 'TRABAJADOR' ? (
                <select value={form.trabajador_id} onChange={e => setForm(f => ({ ...f, trabajador_id: e.target.value }))} className="input-field" required>
                  <option value="">Seleccionar...</option>
                  {trabajadores.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                </select>
              ) : (
                <select value={form.driver_id} onChange={e => setForm(f => ({ ...f, driver_id: e.target.value }))} className="input-field" required>
                  <option value="">Seleccionar...</option>
                  {drivers.map(d => <option key={d.id} value={d.id}>{d.nombre}</option>)}
                </select>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Monto total *</label>
              <input type="number" min="1" value={form.monto_total} onChange={e => setForm(f => ({ ...f, monto_total: e.target.value }))} className="input-field" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Monto cuota mensual *</label>
              <input type="number" min="1" value={form.monto_cuota} onChange={e => setForm(f => ({ ...f, monto_cuota: e.target.value }))} className="input-field" required />
              {cuotasEstimadas > 0 && <p className="text-xs text-gray-500 mt-1">{cuotasEstimadas} cuotas estimadas</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mes primer descuento *</label>
              <select value={form.mes_inicio} onChange={e => setForm(f => ({ ...f, mes_inicio: e.target.value }))} className="input-field">
                {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Año primer descuento *</label>
              <input type="number" value={form.anio_inicio} onChange={e => setForm(f => ({ ...f, anio_inicio: e.target.value }))} className="input-field" required />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Motivo</label>
            <textarea value={form.motivo} onChange={e => setForm(f => ({ ...f, motivo: e.target.value }))} className="input-field" rows={2} placeholder="Descripción del préstamo..." />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancelar</button>
            <button type="submit" className="btn-primary">Crear Préstamo</button>
          </div>
        </form>
      </Modal>

      {/* Modal Detalle */}
      <Modal open={!!detailModal} onClose={() => setDetailModal(null)} title="Detalle del Préstamo" wide>
        {detailModal && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-xs text-gray-500">Beneficiario</p><p className="font-medium text-gray-900">{detailModal.beneficiario_nombre}</p></div>
              <div><p className="text-xs text-gray-500">Tipo</p><p className="font-medium">{detailModal.tipo_beneficiario === 'DRIVER' ? 'Driver' : 'Trabajador'}</p></div>
              <div><p className="text-xs text-gray-500">Monto total</p><p className="font-bold text-lg">{fmt(detailModal.monto_total)}</p></div>
              <div><p className="text-xs text-gray-500">Saldo pendiente</p><p className={`font-bold text-lg ${detailModal.saldo_pendiente > 0 ? 'text-red-600' : 'text-green-600'}`}>{fmt(detailModal.saldo_pendiente)}</p></div>
              <div><p className="text-xs text-gray-500">Cuota mensual</p><p>{fmt(detailModal.monto_cuota)}</p></div>
              <div><p className="text-xs text-gray-500">Inicio descuentos</p><p>{MESES_IDX[detailModal.mes_inicio]} {detailModal.anio_inicio}</p></div>
              {detailModal.motivo && <div className="col-span-2"><p className="text-xs text-gray-500">Motivo</p><p className="text-gray-700">{detailModal.motivo}</p></div>}
            </div>
            <hr />
            <h4 className="text-sm font-semibold text-gray-700">Cuotas ({detailModal.cuotas_pagadas}/{detailModal.cuotas_total})</h4>
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase border-b">
                    <th className="py-2 pr-3">Período</th>
                    <th className="py-2 pr-3 text-right">Monto</th>
                    <th className="py-2 pr-3 text-center">Estado</th>
                    <th className="py-2 pr-3">Fecha pago</th>
                    <th className="py-2 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {(detailModal.cuotas || []).map(c => (
                    <tr key={c.id} className="border-b border-gray-50">
                      <td className="py-2 pr-3">{MESES_IDX[c.mes]} {c.anio}</td>
                      <td className="py-2 pr-3 text-right">{fmt(c.monto)}</td>
                      <td className="py-2 pr-3 text-center">
                        {c.pagado ? <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Pagada</span> : <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Pendiente</span>}
                      </td>
                      <td className="py-2 pr-3 text-gray-500">{c.fecha_pago || '—'}</td>
                      <td className="py-2">
                        {!c.pagado && detailModal.estado === 'ACTIVO' && (
                          <button onClick={() => pagarCuota(detailModal.id, c.id)} className="flex items-center gap-1 text-xs text-green-600 hover:text-green-800 font-medium">
                            <Check size={12} /> Pagar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {detailModal.estado === 'ACTIVO' && (
              <div className="flex justify-end pt-2">
                <button onClick={() => cancelar(detailModal.id)} className="flex items-center gap-1 text-sm text-red-600 hover:text-red-800 font-medium">
                  <XCircle size={14} /> Cancelar préstamo
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Tab: Bonificaciones (trabajadores únicamente)
// ─────────────────────────────────────────────────────────────────
function TabBonificaciones() {
  const [bonificaciones, setBonificaciones] = useState([])
  const [trabajadores, setTrabajadores] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [deleteId, setDeleteId] = useState(null)
  const [mes, setMes] = useState(now.getMonth() + 1)
  const [anio, setAnio] = useState(now.getFullYear())
  const [form, setForm] = useState({ trabajador_id: '', mes: now.getMonth() + 1, anio: now.getFullYear(), monto: '', motivo: '' })
  const [saving, setSaving] = useState(false)

  const anos = []
  for (let y = now.getFullYear() - 2; y <= now.getFullYear() + 1; y++) anos.push(y)

  const load = () => {
    setLoading(true)
    api.get('/ajustes/bonificaciones', { params: { mes, anio } })
      .then(({ data }) => setBonificaciones(data))
      .catch(() => toast.error('Error cargando bonificaciones'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [mes, anio])
  useEffect(() => {
    api.get('/trabajadores').then(({ data }) => setTrabajadores(data)).catch(() => {})
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.trabajador_id) return toast.error('Selecciona un trabajador')
    if (!form.monto || Number(form.monto) <= 0) return toast.error('El monto debe ser mayor a 0')
    setSaving(true)
    try {
      await api.post('/ajustes/bonificaciones', {
        trabajador_id: Number(form.trabajador_id),
        mes: Number(form.mes),
        anio: Number(form.anio),
        monto: Number(form.monto),
        motivo: form.motivo || null,
      })
      toast.success('Bonificación registrada')
      setShowModal(false)
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al guardar')
    } finally { setSaving(false) }
  }

  const eliminar = async () => {
    if (!deleteId) return
    try {
      await api.delete(`/ajustes/${deleteId}`)
      toast.success('Bonificación eliminada')
      setDeleteId(null)
      load()
    } catch { toast.error('Error al eliminar') }
  }

  const total = bonificaciones.reduce((s, b) => s + (b.monto || 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <select className="input w-36" value={mes} onChange={e => setMes(Number(e.target.value))}>
            {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
          <select className="input w-24" value={anio} onChange={e => setAnio(Number(e.target.value))}>
            {anos.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          {total > 0 && <span className="text-sm font-semibold text-green-700 bg-green-50 px-3 py-1 rounded-full">{fmt(total)} total</span>}
        </div>
        <button onClick={() => { setForm({ trabajador_id: '', mes, anio, monto: '', motivo: '' }); setShowModal(true) }} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> Nueva Bonificación
        </button>
      </div>

      {loading ? <div className="text-center py-12 text-gray-400">Cargando...</div>
      : bonificaciones.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Gift size={32} className="mx-auto mb-2 opacity-30" />
          <p>No hay bonificaciones para {MESES[mes - 1]} {anio}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase border-b bg-gray-50">
                <th className="py-3 px-4">Trabajador</th>
                <th className="py-3 px-4">Cargo</th>
                <th className="py-3 px-4 text-center">Período</th>
                <th className="py-3 px-4 text-right">Monto</th>
                <th className="py-3 px-4">Motivo</th>
                <th className="py-3 px-4">Registrado por</th>
                <th className="py-3 px-4 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {bonificaciones.map(b => (
                <tr key={b.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-3 px-4 font-medium text-gray-900">{b.trabajador_nombre}</td>
                  <td className="py-3 px-4 text-gray-500 text-xs">{b.cargo || '—'}</td>
                  <td className="py-3 px-4 text-center text-gray-600">{MESES[b.mes - 1]} {b.anio}</td>
                  <td className="py-3 px-4 text-right font-semibold text-green-600">{fmt(b.monto)}</td>
                  <td className="py-3 px-4 text-gray-600">{b.motivo || '—'}</td>
                  <td className="py-3 px-4 text-gray-400 text-xs">{b.creado_por || '—'}</td>
                  <td className="py-3 px-4">
                    <button onClick={() => setDeleteId(b.id)} className="p-1 rounded text-red-500 hover:bg-red-50"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Crear */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="Nueva Bonificación">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Trabajador *</label>
            <select className="input-field" value={form.trabajador_id} onChange={e => setForm(f => ({ ...f, trabajador_id: e.target.value }))} required>
              <option value="">Seleccionar...</option>
              {trabajadores.map(t => <option key={t.id} value={t.id}>{t.nombre}{t.cargo ? ` — ${t.cargo}` : ''}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mes</label>
              <select className="input-field" value={form.mes} onChange={e => setForm(f => ({ ...f, mes: Number(e.target.value) }))}>
                {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Año</label>
              <input type="number" className="input-field" value={form.anio} onChange={e => setForm(f => ({ ...f, anio: Number(e.target.value) }))} min={2020} max={2030} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Monto (CLP) *</label>
            <input type="number" className="input-field" min="1" value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))} placeholder="Ej: 100000" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Motivo</label>
            <textarea className="input-field" value={form.motivo} onChange={e => setForm(f => ({ ...f, motivo: e.target.value }))} rows={2} placeholder="Ej: Bono vacaciones, aguinaldo, desempeño..." />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Guardando...' : 'Registrar Bonificación'}</button>
          </div>
        </form>
      </Modal>

      {/* Modal Confirmar Eliminar */}
      <Modal open={!!deleteId} onClose={() => setDeleteId(null)} title="Eliminar Bonificación">
        <p className="text-gray-600 mb-4">¿Eliminar esta bonificación? Esta acción afectará el monto neto del trabajador en ese mes si aún no está pagado.</p>
        <div className="flex justify-end gap-3">
          <button onClick={() => setDeleteId(null)} className="btn-secondary">Cancelar</button>
          <button onClick={eliminar} className="btn-danger">Eliminar</button>
        </div>
      </Modal>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Página principal con tabs
// ─────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'ajustes', label: 'Ajustes' },
  { id: 'prestamos', label: 'Préstamos' },
  { id: 'bonificaciones', label: 'Bonificaciones' },
]

export default function Ajustes() {
  const [tab, setTab] = useState('ajustes')

  return (
    <div>
      <PageHeader
        title="Gestión Financiera"
        subtitle="Ajustes, préstamos y bonificaciones"
        icon={CircleDollarSign}
        accent="green"
      />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'ajustes' && <TabAjustes />}
      {tab === 'prestamos' && <TabPrestamos />}
      {tab === 'bonificaciones' && <TabBonificaciones />}
    </div>
  )
}
