import { useState, useEffect, useMemo } from 'react'
import api from '../../api'
import DataTable from '../../components/DataTable'
import Modal from '../../components/Modal'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, Users, DollarSign, Calendar, CalendarDays } from 'lucide-react'

const fmt = (n) => (n ?? 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP' })

function StatsCard({ icon: Icon, label, value, sub, color = 'blue' }) {
  const colors = {
    blue:   'bg-blue-50 text-blue-600 border-blue-100',
    green:  'bg-green-50 text-green-600 border-green-100',
    purple: 'bg-purple-50 text-purple-600 border-purple-100',
    amber:  'bg-amber-50 text-amber-600 border-amber-100',
  }
  return (
    <div className={`rounded-xl border p-4 flex items-start gap-4 ${colors[color]}`}>
      <div className="p-2 rounded-lg bg-white/60">
        <Icon size={20} />
      </div>
      <div>
        <p className="text-xs font-medium opacity-70 uppercase tracking-wide">{label}</p>
        <p className="text-xl font-bold mt-0.5">{value}</p>
        {sub && <p className="text-xs opacity-60 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

const BANCOS = [
  'Banco de Chile', 'Banco Estado', 'BCI', 'Banco Santander', 'Scotiabank',
  'Banco BICE', 'Banco Security', 'Itaú CorpBanca', 'Banco Consorcio',
  'Banco Falabella', 'Banco Ripley', 'Coopeuch', 'Mercado Pago', 'Tenpo',
]

const TIPOS_CUENTA = ['Cuenta Corriente', 'Cuenta Vista / Cuenta RUT', 'Cuenta de Ahorro']

const AFPS = ['Capital', 'Cuprum', 'Habitat', 'Modelo', 'PlanVital', 'ProVida', 'Uno']

const initialForm = {
  nombre: '', rut: '', email: '', direccion: '', cargo: '',
  sueldo_bruto: 0, afp: '', costo_afp: 0,
  sistema_salud: '', costo_salud: 0,
  banco: '', tipo_cuenta: '', numero_cuenta: '',
  fecha_ingreso: '', activo: true,
}

export default function Trabajadores() {
  const [trabajadores, setTrabajadores] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState({ ...initialForm })
  const [filterText, setFilterText] = useState('')
  const [showInactivos, setShowInactivos] = useState(false)

  const load = () => {
    setLoading(true)
    api.get('/trabajadores', { params: showInactivos ? {} : { activo: true } })
      .then(({ data }) => setTrabajadores(data))
      .catch(() => toast.error('Error cargando trabajadores'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [showInactivos])

  const openNew = () => {
    setEditId(null)
    setForm({ ...initialForm })
    setShowModal(true)
  }

  const openEdit = (t) => {
    setEditId(t.id)
    setForm({
      nombre: t.nombre || '',
      rut: t.rut || '',
      email: t.email || '',
      direccion: t.direccion || '',
      cargo: t.cargo || '',
      sueldo_bruto: t.sueldo_bruto || 0,
      afp: t.afp || '',
      costo_afp: t.costo_afp || 0,
      sistema_salud: t.sistema_salud || '',
      costo_salud: t.costo_salud || 0,
      banco: t.banco || '',
      tipo_cuenta: t.tipo_cuenta || '',
      numero_cuenta: t.numero_cuenta || '',
      fecha_ingreso: t.fecha_ingreso || '',
      activo: t.activo,
    })
    setShowModal(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const payload = {
      ...form,
      sueldo_bruto: Number(form.sueldo_bruto),
      costo_afp: Number(form.costo_afp),
      costo_salud: Number(form.costo_salud),
      fecha_ingreso: form.fecha_ingreso || null,
    }
    try {
      if (editId) {
        await api.put(`/trabajadores/${editId}`, payload)
        toast.success('Trabajador actualizado')
      } else {
        await api.post('/trabajadores', payload)
        toast.success('Trabajador creado')
      }
      setShowModal(false)
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al guardar')
    }
  }

  const handleDelete = async (t) => {
    if (!confirm(`¿Desactivar a ${t.nombre}?`)) return
    try {
      await api.delete(`/trabajadores/${t.id}`)
      toast.success('Trabajador desactivado')
      load()
    } catch {
      toast.error('Error al desactivar')
    }
  }

  const filtered = trabajadores.filter(t =>
    t.nombre.toLowerCase().includes(filterText.toLowerCase()) ||
    (t.cargo || '').toLowerCase().includes(filterText.toLowerCase()) ||
    (t.rut || '').includes(filterText)
  )

  const activos = trabajadores.filter(t => t.activo)
  const totalMensual = useMemo(() => activos.reduce((s, t) => s + (t.sueldo_bruto || 0), 0), [activos])
  const totalAnual   = totalMensual * 12
  const totalCostoMes = useMemo(() => activos.reduce((s, t) =>
    s + (t.sueldo_bruto || 0) + (t.costo_afp || 0) + (t.costo_salud || 0), 0), [activos])

  const columns = [
    { key: 'nombre', label: 'Nombre', render: (v, row) => (
      <div>
        <span className="font-medium text-gray-900">{row.nombre}</span>
        {!row.activo && <span className="ml-2 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">Inactivo</span>}
      </div>
    )},
    { key: 'rut', label: 'RUT', render: (v) => v || '—' },
    { key: 'cargo', label: 'Cargo', render: (v) => v || '—' },
    { key: 'sueldo_bruto', label: 'Sueldo Bruto', align: 'right', render: (v) => fmt(v) },
    { key: 'afp', label: 'AFP', render: (v, row) => row.afp ? `${row.afp} (${fmt(row.costo_afp)})` : '—' },
    { key: 'sistema_salud', label: 'Salud', render: (v, row) => row.sistema_salud ? `${row.sistema_salud} (${fmt(row.costo_salud)})` : '—' },
    { key: 'fecha_ingreso', label: 'Antigüedad', render: (v) => {
      if (!v) return '—'
      const ingreso = new Date(v + 'T12:00:00')
      const hoy = new Date()
      let anios = hoy.getFullYear() - ingreso.getFullYear()
      let meses = hoy.getMonth() - ingreso.getMonth()
      if (meses < 0) { anios--; meses += 12 }
      if (anios > 0 && meses > 0) return `${anios}a ${meses}m`
      if (anios > 0) return `${anios} año${anios > 1 ? 's' : ''}`
      if (meses > 0) return `${meses} mes${meses > 1 ? 'es' : ''}`
      return 'Reciente'
    }},
    { key: 'banco', label: 'Banco', render: (v) => v || '—' },
    { key: 'actions', label: '', render: (_, row) => (
      <div className="flex gap-1">
        <button onClick={() => openEdit(row)} className="p-1 rounded hover:bg-blue-100 text-blue-600"><Pencil size={14} /></button>
        {row.activo && <button onClick={() => handleDelete(row)} className="p-1 rounded hover:bg-red-100 text-red-600"><Trash2 size={14} /></button>}
      </div>
    )},
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Trabajadores</h1>
          <p className="text-sm text-gray-500">Gestión de personal contratado</p>
        </div>
        <button onClick={openNew} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> Nuevo Trabajador
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatsCard icon={Users}       label="Trabajadores activos" value={activos.length}    color="blue" />
        <StatsCard icon={DollarSign}  label="Costo total mensual"  value={fmt(totalCostoMes)} sub="Bruto + AFP + Salud" color="green" />
        <StatsCard icon={Calendar}    label="Sueldo bruto / mes"   value={fmt(totalMensual)}  sub={`${activos.length} contratos activos`} color="purple" />
        <StatsCard icon={CalendarDays} label="Sueldo bruto / año"  value={fmt(totalAnual)}    sub="Proyección 12 meses" color="amber" />
      </div>

      <div className="flex items-center gap-3">
        <input
          type="text" placeholder="Buscar por nombre, cargo o RUT..."
          value={filterText} onChange={(e) => setFilterText(e.target.value)}
          className="input flex-1"
        />
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input type="checkbox" checked={showInactivos} onChange={(e) => setShowInactivos(e.target.checked)} className="accent-primary-600" />
          Mostrar inactivos
        </label>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Cargando...</div>
      ) : (
        <DataTable columns={columns} data={filtered} emptyMessage="No hay trabajadores registrados" />
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editId ? 'Editar Trabajador' : 'Nuevo Trabajador'} wide>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre completo *</label>
              <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} className="input-field" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">RUT</label>
              <input value={form.rut} onChange={e => setForm(f => ({ ...f, rut: e.target.value }))} className="input-field" placeholder="12.345.678-9" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Correo electrónico</label>
              <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cargo</label>
              <input value={form.cargo} onChange={e => setForm(f => ({ ...f, cargo: e.target.value }))} className="input-field" placeholder="Ej: Operador bodega" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Dirección de residencia</label>
              <input value={form.direccion} onChange={e => setForm(f => ({ ...f, direccion: e.target.value }))} className="input-field" />
            </div>
          </div>

          <hr className="border-gray-200" />
          <p className="text-sm font-semibold text-gray-600">Remuneración</p>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sueldo bruto</label>
              <input type="number" value={form.sueldo_bruto} onChange={e => setForm(f => ({ ...f, sueldo_bruto: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">AFP</label>
              <select value={form.afp} onChange={e => setForm(f => ({ ...f, afp: e.target.value }))} className="input-field">
                <option value="">Seleccionar...</option>
                {AFPS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Costo AFP</label>
              <input type="number" value={form.costo_afp} onChange={e => setForm(f => ({ ...f, costo_afp: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sistema de salud</label>
              <input value={form.sistema_salud} onChange={e => setForm(f => ({ ...f, sistema_salud: e.target.value }))} className="input-field" placeholder="Fonasa / Isapre" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Costo plan salud</label>
              <input type="number" value={form.costo_salud} onChange={e => setForm(f => ({ ...f, costo_salud: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fecha ingreso</label>
              <input type="date" value={form.fecha_ingreso} onChange={e => setForm(f => ({ ...f, fecha_ingreso: e.target.value }))} className="input-field" />
            </div>
          </div>

          <hr className="border-gray-200" />
          <p className="text-sm font-semibold text-gray-600">Datos bancarios</p>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Banco</label>
              <select value={form.banco} onChange={e => setForm(f => ({ ...f, banco: e.target.value }))} className="input-field">
                <option value="">Seleccionar...</option>
                {BANCOS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de cuenta</label>
              <select value={form.tipo_cuenta} onChange={e => setForm(f => ({ ...f, tipo_cuenta: e.target.value }))} className="input-field">
                <option value="">Seleccionar...</option>
                {TIPOS_CUENTA.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">N° cuenta</label>
              <input value={form.numero_cuenta} onChange={e => setForm(f => ({ ...f, numero_cuenta: e.target.value }))} className="input-field" />
            </div>
          </div>

          {editId && (
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={form.activo} onChange={e => setForm(f => ({ ...f, activo: e.target.checked }))} className="accent-primary-600" />
              <label className="text-sm text-gray-700">Activo</label>
            </div>
          )}

          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancelar</button>
            <button type="submit" className="btn-primary">{editId ? 'Guardar' : 'Crear'}</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
