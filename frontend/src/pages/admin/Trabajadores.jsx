import { useState, useEffect, useMemo, useCallback } from 'react'
import api from '../../api'
import DataTable from '../../components/DataTable'
import Modal from '../../components/Modal'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, Users, DollarSign, Calendar, CalendarDays, Calculator, KeyRound, Briefcase } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import ContratacionPanel from './ContratacionPanel'

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
  telefono: '', whatsapp: '',
  fecha_nacimiento: '', nacionalidad: '', estado_civil: '',
  sueldo_liquido: 0, afp: '', sistema_salud: '',
  banco: '', tipo_cuenta: '', numero_cuenta: '',
  fecha_ingreso: '', activo: true,
  movilizacion: 0, colacion: 0, viaticos: 0,
  tipo_contrato: '', monto_cotizacion_salud: '',
  anios_servicio_previos: 0,
}

const ESTADOS_CIVILES = [
  { value: 'SOLTERO', label: 'Soltero/a' },
  { value: 'CASADO', label: 'Casado/a' },
  { value: 'CONVIVIENTE_CIVIL', label: 'Conviviente civil' },
  { value: 'DIVORCIADO', label: 'Divorciado/a' },
  { value: 'VIUDO', label: 'Viudo/a' },
]

function CalcPreview({ form }) {
  const [calc, setCalc] = useState(null)
  const liq = Number(form.sueldo_liquido) || 0

  const doCalc = useCallback(() => {
    if (liq <= 0 || !form.afp) { setCalc(null); return }
    const params = {
      sueldo_liquido: liq,
      afp: form.afp,
      sistema_salud: form.sistema_salud || 'FONASA',
      tipo_contrato: form.tipo_contrato || 'INDEFINIDO',
      movilizacion: Number(form.movilizacion) || 0,
      colacion: Number(form.colacion) || 0,
      viaticos: Number(form.viaticos) || 0,
    }
    if (form.monto_cotizacion_salud) params.monto_cotizacion_salud = form.monto_cotizacion_salud
    api.post('/trabajadores/simular-calculo', null, { params })
      .then(({ data }) => setCalc(data))
      .catch(() => setCalc(null))
  }, [liq, form.afp, form.sistema_salud, form.tipo_contrato, form.movilizacion, form.colacion, form.viaticos, form.monto_cotizacion_salud])

  useEffect(() => {
    const t = setTimeout(doCalc, 400)
    return () => clearTimeout(t)
  }, [doCalc])

  if (!calc) return null

  const tieneIUSC = (calc.iusc || 0) > 0
  const tieneAdicionalIsapre = (calc.adicional_isapre || 0) > 0

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-blue-800">
          <Calculator size={16} /> Cálculo automático
        </div>
        {calc.uf_usada && (
          <div className="flex items-center gap-3 text-xs text-blue-600">
            <span>UF {calc.uf_usada?.toLocaleString('es-CL', { minimumFractionDigits: 2 })}</span>
            <span>UTM {calc.utm_usada?.toLocaleString('es-CL')}</span>
            {calc.fuente && <span className="text-blue-400">· {calc.fuente}</span>}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div>
          <p className="text-blue-600 text-xs">Sueldo Base</p>
          <p className="font-semibold text-blue-900">{fmt(calc.sueldo_base)}</p>
        </div>
        <div>
          <p className="text-blue-600 text-xs">Gratificación</p>
          <p className="font-semibold text-blue-900">{fmt(calc.gratificacion)}</p>
        </div>
        <div>
          <p className="text-blue-600 text-xs">Imponible (Bruto)</p>
          <p className="font-bold text-blue-900">{fmt(calc.remuneracion_imponible)}</p>
        </div>
        <div>
          <p className="text-blue-600 text-xs">Líquido verificado</p>
          <p className={`font-bold ${Math.abs((calc.liquido_verificado || 0) - liq) <= 1 ? 'text-green-700' : 'text-amber-700'}`}>
            {fmt(calc.liquido_verificado)}
          </p>
        </div>
      </div>
      <div className={`grid gap-3 text-sm border-t border-blue-200 pt-2 ${tieneIUSC ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-4'}`}>
        <div>
          <p className="text-blue-600 text-xs">Desc. AFP</p>
          <p className="text-red-700 font-medium">-{fmt(calc.descuento_afp)}</p>
        </div>
        <div>
          <p className="text-blue-600 text-xs">{tieneAdicionalIsapre ? 'Salud 7% legal' : 'Desc. Salud'}</p>
          <p className="text-red-700 font-medium">-{fmt(calc.descuento_salud)}</p>
        </div>
        {tieneAdicionalIsapre && (
          <div>
            <p className="text-blue-600 text-xs">Adicional Isapre</p>
            <p className="text-red-700 font-medium">-{fmt(calc.adicional_isapre)}</p>
          </div>
        )}
        <div>
          <p className="text-blue-600 text-xs">Desc. Cesantía</p>
          <p className="text-red-700 font-medium">-{fmt(calc.descuento_cesantia)}</p>
        </div>
        {tieneIUSC && (
          <div>
            <p className="text-amber-600 text-xs font-semibold">Impuesto (IUSC)</p>
            <p className="text-amber-700 font-bold">-{fmt(calc.iusc)}</p>
          </div>
        )}
        <div>
          <p className="text-blue-600 text-xs">Costo empresa total</p>
          <p className="font-bold text-blue-900">{fmt(calc.costo_empresa_total)}</p>
        </div>
      </div>
    </div>
  )
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
      telefono: t.telefono || '',
      whatsapp: t.whatsapp || '',
      fecha_nacimiento: t.fecha_nacimiento || '',
      nacionalidad: t.nacionalidad || '',
      estado_civil: t.estado_civil || '',
      sueldo_liquido: t.sueldo_liquido || 0,
      afp: t.afp || '',
      sistema_salud: t.sistema_salud || '',
      banco: t.banco || '',
      tipo_cuenta: t.tipo_cuenta || '',
      numero_cuenta: t.numero_cuenta || '',
      fecha_ingreso: t.fecha_ingreso || '',
      activo: t.activo,
      movilizacion: t.movilizacion || 0,
      colacion: t.colacion || 0,
      viaticos: t.viaticos || 0,
      tipo_contrato: t.tipo_contrato || '',
      monto_cotizacion_salud: t.monto_cotizacion_salud || '',
      anios_servicio_previos: t.anios_servicio_previos || 0,
    })
    setShowModal(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const payload = {
      ...form,
      sueldo_liquido: Number(form.sueldo_liquido),
      movilizacion: Number(form.movilizacion),
      colacion: Number(form.colacion),
      viaticos: Number(form.viaticos),
      anios_servicio_previos: Number(form.anios_servicio_previos || 0),
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

  const [pwdModal, setPwdModal] = useState(null) // { id, nombre }
  const [contratacionFor, setContratacionFor] = useState(null)
  const [pwdValue, setPwdValue] = useState('')
  const [pwdLoading, setPwdLoading] = useState(false)

  const handleSetPassword = async () => {
    if (!pwdValue || pwdValue.length < 6) {
      toast.error('La contraseña debe tener al menos 6 caracteres')
      return
    }
    setPwdLoading(true)
    try {
      await api.put(`/trabajadores/${pwdModal.id}/password`, { password: pwdValue })
      toast.success(`Contraseña establecida para ${pwdModal.nombre}`)
      setPwdModal(null)
      setPwdValue('')
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Error al establecer contraseña')
    } finally {
      setPwdLoading(false)
    }
  }

  const filtered = trabajadores.filter(t =>
    t.nombre.toLowerCase().includes(filterText.toLowerCase()) ||
    (t.cargo || '').toLowerCase().includes(filterText.toLowerCase()) ||
    (t.rut || '').includes(filterText)
  )

  const activos = trabajadores.filter(t => t.activo)
  const totalLiquido = useMemo(() => activos.reduce((s, t) => s + (t.sueldo_liquido || 0), 0), [activos])
  const totalBruto   = useMemo(() => activos.reduce((s, t) => s + (t.sueldo_bruto || 0), 0), [activos])
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
    { key: 'sueldo_liquido', label: 'Líquido', align: 'right', render: (v) => fmt(v) },
    { key: 'sueldo_bruto', label: 'Bruto', align: 'right', render: (v) => v ? fmt(v) : '—' },
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
    { key: 'actions', label: '', render: (_, row) => (
      <div className="flex gap-1">
        <button onClick={() => openEdit(row)} className="p-1 rounded hover:bg-blue-100 text-blue-600" title="Editar"><Pencil size={14} /></button>
        <button
          onClick={() => setContratacionFor(row)}
          className="p-1 rounded hover:bg-indigo-100 text-indigo-600"
          title="Gestión contractual (versiones, anexos, contrato físico)"
        ><Briefcase size={14} /></button>
        <button
          onClick={() => { setPwdModal({ id: row.id, nombre: row.nombre }); setPwdValue('') }}
          className="p-1 rounded hover:bg-amber-100 text-amber-600"
          title="Establecer contraseña portal"
        ><KeyRound size={14} /></button>
        {row.activo && <button onClick={() => handleDelete(row)} className="p-1 rounded hover:bg-red-100 text-red-600" title="Desactivar"><Trash2 size={14} /></button>}
      </div>
    )},
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Trabajadores"
        subtitle="Gestión de personal contratado"
        icon={Users}
        accent="purple"
        actions={
          <button onClick={openNew} className="btn-primary flex items-center gap-2">
            <Plus size={16} /> Nuevo Trabajador
          </button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatsCard icon={Users}       label="Trabajadores activos" value={activos.length}    color="blue" />
        <StatsCard icon={DollarSign}  label="Costo total mensual"  value={fmt(totalCostoMes)} sub="Bruto + AFP + Salud" color="green" />
        <StatsCard icon={Calendar}    label="Líquido total / mes"  value={fmt(totalLiquido)}  sub={`${activos.length} contratos activos`} color="purple" />
        <StatsCard icon={CalendarDays} label="Bruto total / mes"   value={fmt(totalBruto)}    sub="Calculado automáticamente" color="amber" />
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
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Teléfono</label>
              <input value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} className="input-field" placeholder="+56 9 1234 5678" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp</label>
              <input value={form.whatsapp} onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))} className="input-field" placeholder="+56 9 1234 5678" />
              <p className="text-xs text-emerald-600 mt-0.5">Recibirá notificaciones del sistema</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de nacimiento</label>
              <input type="date" value={form.fecha_nacimiento} onChange={e => setForm(f => ({ ...f, fecha_nacimiento: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nacionalidad</label>
              <input value={form.nacionalidad} onChange={e => setForm(f => ({ ...f, nacionalidad: e.target.value }))} className="input-field" placeholder="Chilena" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Estado civil</label>
              <select value={form.estado_civil} onChange={e => setForm(f => ({ ...f, estado_civil: e.target.value }))} className="input-field">
                <option value="">Seleccionar...</option>
                {ESTADOS_CIVILES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <hr className="border-gray-200" />
          <p className="text-sm font-semibold text-gray-600">Remuneración</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sueldo líquido pactado *</label>
              <input type="number" value={form.sueldo_liquido} onChange={e => setForm(f => ({ ...f, sueldo_liquido: e.target.value }))} className="input-field" min={0} />
              <p className="text-xs text-green-600 mt-0.5">Lo que recibe el trabajador</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">AFP *</label>
              <select value={form.afp} onChange={e => setForm(f => ({ ...f, afp: e.target.value }))} className="input-field">
                <option value="">Seleccionar...</option>
                {AFPS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sistema de salud *</label>
              <select value={form.sistema_salud} onChange={e => setForm(f => ({ ...f, sistema_salud: e.target.value, monto_cotizacion_salud: e.target.value === 'FONASA' ? '' : f.monto_cotizacion_salud }))} className="input-field">
                <option value="">Seleccionar...</option>
                <option value="FONASA">Fonasa (7%)</option>
                <option value="ISAPRE">Isapre</option>
              </select>
            </div>
            {form.sistema_salud === 'ISAPRE' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Plan Isapre (UF)</label>
                <input value={form.monto_cotizacion_salud} onChange={e => setForm(f => ({ ...f, monto_cotizacion_salud: e.target.value }))} className="input-field" placeholder="2.714" />
                <p className="text-xs text-gray-400 mt-0.5">Monto mensual del plan en UF</p>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tipo contrato</label>
              <select value={form.tipo_contrato} onChange={e => setForm(f => ({ ...f, tipo_contrato: e.target.value }))} className="input-field">
                <option value="">Seleccionar...</option>
                <option value="INDEFINIDO">Indefinido</option>
                <option value="PLAZO_FIJO">Plazo Fijo</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fecha ingreso</label>
              <input type="date" value={form.fecha_ingreso} onChange={e => setForm(f => ({ ...f, fecha_ingreso: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Años servicio previos</label>
              <input
                type="number" min={0} max={10}
                value={form.anios_servicio_previos}
                onChange={e => setForm(f => ({ ...f, anios_servicio_previos: e.target.value }))}
                className="input-field"
              />
              <p className="text-xs text-gray-400 mt-0.5">Tope 10. Para feriado progresivo (Art. 68 CT)</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Movilización</label>
              <input type="number" value={form.movilizacion} onChange={e => setForm(f => ({ ...f, movilizacion: e.target.value }))} className="input-field" min={0} />
              <p className="text-xs text-gray-400 mt-0.5">No imponible</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Colación</label>
              <input type="number" value={form.colacion} onChange={e => setForm(f => ({ ...f, colacion: e.target.value }))} className="input-field" min={0} />
              <p className="text-xs text-gray-400 mt-0.5">No imponible</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Viáticos</label>
              <input type="number" value={form.viaticos} onChange={e => setForm(f => ({ ...f, viaticos: e.target.value }))} className="input-field" min={0} />
              <p className="text-xs text-gray-400 mt-0.5">No imponible</p>
            </div>
          </div>

          <CalcPreview form={form} />

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

      {/* Modal contraseña portal */}
      <Modal
        open={!!pwdModal}
        onClose={() => setPwdModal(null)}
        title={`Contraseña portal — ${pwdModal?.nombre}`}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Establece una contraseña para que <strong>{pwdModal?.nombre}</strong> pueda
            acceder al portal de trabajadores con su email.
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nueva contraseña</label>
            <input
              type="password"
              value={pwdValue}
              onChange={e => setPwdValue(e.target.value)}
              className="input-field"
              placeholder="Mínimo 6 caracteres"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleSetPassword()}
            />
          </div>
          <div className="flex gap-3 justify-end pt-1">
            <button type="button" onClick={() => setPwdModal(null)} className="btn-secondary">Cancelar</button>
            <button
              type="button"
              onClick={handleSetPassword}
              disabled={pwdLoading}
              className="btn-primary"
            >
              {pwdLoading ? 'Guardando...' : 'Establecer contraseña'}
            </button>
          </div>
        </div>
      </Modal>

      {contratacionFor && (
        <ContratacionPanel
          trabajador={contratacionFor}
          onClose={() => { setContratacionFor(null); load() }}
        />
      )}
    </div>
  )
}
