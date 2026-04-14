import { useState, useEffect, useMemo } from 'react'
import api from '../../api'
import Modal from '../../components/Modal'
import toast from 'react-hot-toast'
import { Plus, Eye, XCircle, Check, Banknote } from 'lucide-react'
import PageHeader from '../../components/PageHeader'

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const fmt = (n) => `$${(n ?? 0).toLocaleString('es-CL')}`

const ESTADO_BADGE = {
  ACTIVO: 'bg-blue-100 text-blue-700',
  PAGADO: 'bg-green-100 text-green-700',
  CANCELADO: 'bg-gray-100 text-gray-500',
}

const initialForm = {
  tipo_beneficiario: 'TRABAJADOR',
  trabajador_id: '',
  driver_id: '',
  monto_total: '',
  monto_cuota: '',
  modalidad: 'cuota_fija',
  porcentaje: '',
  mes_inicio: new Date().getMonth() + 1,
  anio_inicio: new Date().getFullYear(),
  motivo: '',
}

export default function Prestamos() {
  const [prestamos, setPrestamos] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [detailModal, setDetailModal] = useState(null)
  const [form, setForm] = useState({ ...initialForm })
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

  const openNew = () => {
    setForm({ ...initialForm })
    setShowModal(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const payload = {
      tipo_beneficiario: form.tipo_beneficiario,
      trabajador_id: form.tipo_beneficiario === 'TRABAJADOR' ? Number(form.trabajador_id) : null,
      driver_id: form.tipo_beneficiario === 'DRIVER' ? Number(form.driver_id) : null,
      monto_total: Number(form.monto_total),
      monto_cuota: Number(form.monto_cuota),
      modalidad: form.modalidad,
      porcentaje: form.porcentaje ? Number(form.porcentaje) : null,
      mes_inicio: Number(form.mes_inicio),
      anio_inicio: Number(form.anio_inicio),
      motivo: form.motivo || null,
    }
    try {
      await api.post('/prestamos', payload)
      toast.success('Préstamo creado')
      setShowModal(false)
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al crear')
    }
  }

  const openDetail = async (p) => {
    try {
      const { data } = await api.get(`/prestamos/${p.id}`)
      setDetailModal(data)
    } catch {
      toast.error('Error cargando detalle')
    }
  }

  const pagarCuota = async (prestamoId, cuotaId) => {
    try {
      await api.post(`/prestamos/${prestamoId}/pagar-cuota?cuota_id=${cuotaId}`)
      toast.success('Cuota marcada como pagada')
      const { data } = await api.get(`/prestamos/${prestamoId}`)
      setDetailModal(data)
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error')
    }
  }

  const cancelar = async (prestamoId) => {
    if (!confirm('¿Cancelar este préstamo?')) return
    try {
      await api.post(`/prestamos/${prestamoId}/cancelar`)
      toast.success('Préstamo cancelado')
      setDetailModal(null)
      load()
    } catch {
      toast.error('Error al cancelar')
    }
  }

  const cuotasEstimadas = useMemo(() => {
    const total = Number(form.monto_total) || 0
    const cuota = Number(form.monto_cuota) || 0
    if (cuota <= 0 || total <= 0) return 0
    return Math.ceil(total / cuota)
  }, [form.monto_total, form.monto_cuota])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Préstamos"
        subtitle="Préstamos a trabajadores y conductores"
        icon={Banknote}
        accent="amber"
        actions={
          <button onClick={openNew} className="btn-primary flex items-center gap-2">
            <Plus size={16} /> Nuevo Préstamo
          </button>
        }
      />

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

      {loading ? (
        <div className="text-center py-12 text-gray-400">Cargando...</div>
      ) : prestamos.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No hay préstamos registrados</div>
      ) : (
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
                    {p.saldo_pendiente > 0
                      ? <span className="text-red-600">{fmt(p.saldo_pendiente)}</span>
                      : <span className="text-green-600">{fmt(0)}</span>}
                  </td>
                  <td className="py-3 px-4 text-center text-gray-600">{p.cuotas_pagadas}/{p.cuotas_total}</td>
                  <td className="py-3 px-4 text-center text-gray-500">{MESES[p.mes_inicio]?.substring(0, 3)} {p.anio_inicio}</td>
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
              {cuotasEstimadas > 0 && (
                <p className="text-xs text-gray-500 mt-1">{cuotasEstimadas} cuotas estimadas</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mes primer descuento *</label>
              <select value={form.mes_inicio} onChange={e => setForm(f => ({ ...f, mes_inicio: e.target.value }))} className="input-field">
                {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
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
              <div>
                <p className="text-xs text-gray-500">Beneficiario</p>
                <p className="font-medium text-gray-900">{detailModal.beneficiario_nombre}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Tipo</p>
                <p className="font-medium">{detailModal.tipo_beneficiario === 'DRIVER' ? 'Driver' : 'Trabajador'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Monto total</p>
                <p className="font-bold text-lg">{fmt(detailModal.monto_total)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Saldo pendiente</p>
                <p className={`font-bold text-lg ${detailModal.saldo_pendiente > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {fmt(detailModal.saldo_pendiente)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Cuota mensual</p>
                <p>{fmt(detailModal.monto_cuota)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Inicio descuentos</p>
                <p>{MESES[detailModal.mes_inicio]} {detailModal.anio_inicio}</p>
              </div>
              {detailModal.motivo && (
                <div className="col-span-2">
                  <p className="text-xs text-gray-500">Motivo</p>
                  <p className="text-gray-700">{detailModal.motivo}</p>
                </div>
              )}
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
                      <td className="py-2 pr-3">{MESES[c.mes]} {c.anio}</td>
                      <td className="py-2 pr-3 text-right">{fmt(c.monto)}</td>
                      <td className="py-2 pr-3 text-center">
                        {c.pagado
                          ? <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Pagada</span>
                          : <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Pendiente</span>}
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
