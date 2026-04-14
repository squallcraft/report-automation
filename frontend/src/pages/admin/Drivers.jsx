import { useState, useEffect } from 'react'
import api from '../../api'
import { useAuth } from '../../context/AuthContext'
import DataTable from '../../components/DataTable'
import Modal from '../../components/Modal'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, Download, Upload, FileText, CheckCircle, Clock, Truck } from 'lucide-react'
import PageHeader from '../../components/PageHeader'

const fmtClp = (n) => (n ?? 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP' })

function EstadoBadge({ activo }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${activo ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
      {activo ? 'Activo' : 'Inactivo'}
    </span>
  )
}

function AcuerdoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 bg-white">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900">{value}</span>
    </div>
  )
}

const BANCOS_OPCIONES = [
  { codigo: '001', nombre: 'Banco de Chile' },
  { codigo: '009', nombre: 'Banco Internacional' },
  { codigo: '012', nombre: 'Scotiabank Chile' },
  { codigo: '014', nombre: 'Banco BICE' },
  { codigo: '016', nombre: 'Banco Estado de Chile' },
  { codigo: '028', nombre: 'BCI' },
  { codigo: '031', nombre: 'Itaú CorpBanca' },
  { codigo: '034', nombre: 'Banco Security' },
  { codigo: '037', nombre: 'Banco Santander' },
  { codigo: '039', nombre: 'Banco Consorcio' },
  { codigo: '402', nombre: 'Banco Falabella' },
  { codigo: '403', nombre: 'Banco Ripley' },
  { codigo: '672', nombre: 'Coopeuch' },
  { codigo: '729', nombre: 'Prepago Los Héroes' },
  { codigo: '028-tenpo', nombre: 'Tenpo (BCI)' },
  { codigo: '028-mach', nombre: 'MACH (BCI)' },
  { codigo: '741', nombre: 'Copec Pay' },
  { codigo: '875', nombre: 'Mercado Pago' },
]

const TIPOS_CUENTA = [
  { valor: 'corriente', label: 'Cuenta Corriente' },
  { valor: 'vista', label: 'Cuenta Vista / Cuenta RUT' },
  { valor: 'ahorro', label: 'Cuenta de Ahorro' },
]

// Nombre canónico para el backend a partir del código selector
const bancoNombreCanonicoDesde = (codigo) => {
  const map = {
    '001': 'Banco de Chile', '009': 'Banco Internacional', '012': 'Scotiabank',
    '014': 'Banco BICE', '016': 'Banco Estado', '028': 'BCI', '031': 'Itaú CorpBanca',
    '034': 'Banco Security', '037': 'Banco Santander', '039': 'Banco Consorcio',
    '402': 'Banco Falabella', '403': 'Banco Ripley', '672': 'Coopeuch',
    '729': 'Prepago Los Héroes', '028-tenpo': 'Tenpo', '028-mach': 'MACH',
    '741': 'Copec Pay',
    '875': 'Mercado Pago',
  }
  return map[codigo] || codigo
}

// Inferir código selector desde el nombre almacenado en el driver
const bancoCodigoDesdeNombre = (nombre) => {
  if (!nombre) return ''
  const n = nombre.toLowerCase().trim()
  if (n.includes('tenpo')) return '028-tenpo'
  if (n.includes('mach')) return '028-mach'
  if (n.includes('copec')) return '741'
  if (n.includes('mercado pago') || n.includes('mercadopago')) return '875'
  if (n.includes('chile') && n.includes('banco')) return '001'
  if (n.includes('internacional')) return '009'
  if (n.includes('scotiabank')) return '012'
  if (n.includes('bice')) return '014'
  if (n.includes('estado')) return '016'
  if (n.includes('bci') || n.includes('credito e inversiones')) return '028'
  if (n.includes('itau') || n.includes('itaú') || n.includes('corpbanca')) return '031'
  if (n.includes('security')) return '034'
  if (n.includes('santander')) return '037'
  if (n.includes('consorcio')) return '039'
  if (n.includes('falabella')) return '402'
  if (n.includes('ripley')) return '403'
  if (n.includes('coopeuch')) return '672'
  if (n.includes('heroes') || n.includes('héroes')) return '729'
  return ''
}

const initialForm = {
  nombre: '',
  aliases: '',
  tarifa_ecourier: 1700,
  tarifa_oviedo: 1800,
  tarifa_tercerizado: 1500,
  tarifa_valparaiso: 0,
  tarifa_melipilla: 0,
  zona: '',
  tarifa_retiro_fija: 0,
  jefe_flota_id: '',
  contratado: false,
  email: '',
  password: '',
  rut: '',
  banco_codigo: '',
  tipo_cuenta: '',
  numero_cuenta: '',
}

export default function Drivers() {
  const { user } = useAuth()
  const canEdit = user?.rol === 'ADMIN'
  const [drivers, setDrivers] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [toDelete, setToDelete] = useState(null)

  const [importingHomolog, setImportingHomolog] = useState(false)
  const [importingTarifas, setImportingTarifas] = useState(false)
  const [acuerdoModal, setAcuerdoModal] = useState(false)
  const [acuerdoData, setAcuerdoData] = useState(null)
  const [loadingAcuerdo, setLoadingAcuerdo] = useState(false)

  const fetchDrivers = () => {
    api.get('/drivers')
      .then(({ data }) => setDrivers(data))
      .catch(() => toast.error('Error al cargar drivers'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchDrivers()
  }, [])

  const downloadFile = async (url, filename) => {
    try {
      const { data } = await api.get(url, { responseType: 'blob' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([data]))
      a.download = filename
      a.click()
      URL.revokeObjectURL(a.href)
    } catch { toast.error('Error al descargar plantilla') }
  }

  const handleImportHomologacion = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setImportingHomolog(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const { data } = await api.post('/drivers/importar/homologacion', formData)
      toast.success(`${data.aliases_agregados} aliases agregados, ${data.drivers_creados} drivers creados`)
      if (data.errores?.length) toast.error(`${data.errores.length} errores`)
      fetchDrivers()
    } catch (err) { toast.error(err.response?.data?.detail || 'Error al importar') }
    finally { setImportingHomolog(false); e.target.value = '' }
  }

  const handleImportTarifas = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setImportingTarifas(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const { data } = await api.post('/drivers/importar/tarifas', formData)
      toast.success(`${data.creados} creados, ${data.actualizados} actualizados`)
      if (data.errores?.length) toast.error(`${data.errores.length} errores`)
      fetchDrivers()
    } catch (err) { toast.error(err.response?.data?.detail || 'Error al importar') }
    finally { setImportingTarifas(false); e.target.value = '' }
  }

  const openCreate = () => {
    setEditing(null)
    setForm(initialForm)
    setModalOpen(true)
  }

  const openEdit = (driver) => {
    setEditing(driver)
    setForm({
      nombre: driver.nombre,
      aliases: (driver.aliases || []).join(', '),
      tarifa_ecourier: driver.tarifa_ecourier ?? 1700,
      tarifa_oviedo: driver.tarifa_oviedo ?? 1800,
      tarifa_tercerizado: driver.tarifa_tercerizado ?? 1500,
      tarifa_valparaiso: driver.tarifa_valparaiso ?? 0,
      tarifa_melipilla: driver.tarifa_melipilla ?? 0,
      zona: driver.zona || '',
      tarifa_retiro_fija: driver.tarifa_retiro_fija ?? 0,
      jefe_flota_id: driver.jefe_flota_id ?? '',
      contratado: driver.contratado ?? false,
      email: driver.email || '',
      password: '',
      rut: driver.rut || '',
      banco_codigo: bancoCodigoDesdeNombre(driver.banco),
      tipo_cuenta: driver.tipo_cuenta || '',
      numero_cuenta: driver.numero_cuenta || '',
    })
    setModalOpen(true)
  }

  const handleRowClick = (row) => {
    openEdit(row)
  }

  const handleDeleteClick = (e, driver) => {
    e.stopPropagation()
    setToDelete(driver)
    setDeleteModalOpen(true)
  }

  const confirmDelete = () => {
    if (!toDelete) return
    api.delete(`/drivers/${toDelete.id}`)
      .then(() => {
        toast.success('Driver desactivado')
        fetchDrivers()
        setDeleteModalOpen(false)
        setToDelete(null)
      })
      .catch(() => toast.error('Error al desactivar'))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    setSaving(true)
    const payload = {
      ...form,
      aliases: form.aliases ? form.aliases.split(',').map((a) => a.trim()).filter(Boolean) : [],
      tarifa_ecourier: parseInt(form.tarifa_ecourier, 10) || 1700,
      tarifa_oviedo: parseInt(form.tarifa_oviedo, 10) || 1800,
      tarifa_tercerizado: parseInt(form.tarifa_tercerizado, 10) || 1500,
      tarifa_valparaiso: parseInt(form.tarifa_valparaiso, 10) || 0,
      tarifa_melipilla: parseInt(form.tarifa_melipilla, 10) || 0,
      zona: form.zona || null,
      tarifa_retiro_fija: parseInt(form.tarifa_retiro_fija, 10) || 0,
      jefe_flota_id: form.jefe_flota_id ? parseInt(form.jefe_flota_id, 10) : null,
      email: form.email?.trim() || null,
      rut: form.rut?.trim() || null,
      banco: form.banco_codigo ? bancoNombreCanonicoDesde(form.banco_codigo) : null,
      tipo_cuenta: form.tipo_cuenta || null,
      numero_cuenta: form.numero_cuenta?.trim() || null,
    }
    delete payload.banco_codigo
    if (!payload.password) delete payload.password

    const promise = editing
      ? api.put(`/drivers/${editing.id}`, payload)
      : api.post('/drivers', payload)

    promise
      .then(() => {
        toast.success(editing ? 'Driver actualizado' : 'Driver creado')
        setModalOpen(false)
        fetchDrivers()
      })
      .catch((err) => toast.error(err.response?.data?.detail || 'Error al guardar'))
      .finally(() => setSaving(false))
  }

  const verAcuerdo = async (e, row) => {
    e.stopPropagation()
    setAcuerdoData(null)
    setAcuerdoModal(true)
    setLoadingAcuerdo(true)
    try {
      const { data } = await api.get(`/drivers/${row.id}/acuerdo`)
      setAcuerdoData(data)
    } catch {
      toast.error('No se pudo cargar el acuerdo')
      setAcuerdoModal(false)
    } finally {
      setLoadingAcuerdo(false)
    }
  }

  const columns = [
    { key: 'nombre', label: 'Nombre', render: (v, row) => (
      <div className="flex items-center gap-1.5 flex-wrap">
        <span>{v}</span>
        {row.subordinados_count > 0 && (
          <span className="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-purple-100 text-purple-700">
            Jefe ({row.subordinados_count})
          </span>
        )}
        {row.contratado && (
          <span className="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-orange-100 text-orange-700">
            Contratado
          </span>
        )}
      </div>
    )},
    { key: 'jefe_flota_nombre', label: 'Jefe de Flota', render: (v) => v || '—' },
    { key: 'zona', label: 'Zona', render: (v) => v || '—' },
    { key: 'tarifa_ecourier', label: 'T. ECourier', align: 'right', render: (v) => fmtClp(v) },
    { key: 'tarifa_oviedo', label: 'T. Oviedo', align: 'right', render: (v) => fmtClp(v) },
    { key: 'tarifa_tercerizado', label: 'T. Tercerizado', align: 'right', render: (v) => fmtClp(v) },
    { key: 'tarifa_valparaiso', label: 'T. Valparaíso', align: 'right', render: (v) => v ? fmtClp(v) : '—' },
    { key: 'tarifa_melipilla', label: 'T. Melipilla', align: 'right', render: (v) => v ? fmtClp(v) : '—' },
    { key: 'activo', label: 'Estado', align: 'center', render: (v) => <EstadoBadge activo={v} /> },
    {
      key: 'acuerdo_aceptado',
      label: 'Acuerdo',
      align: 'center',
      render: (v, row) => v ? (
        <div className="flex flex-col items-center gap-0.5">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
            <CheckCircle size={11} /> Firmado
          </span>
          {row.acuerdo_fecha && (
            <span className="text-[10px] text-gray-400">
              {new Date(row.acuerdo_fecha).toLocaleDateString('es-CL')}
            </span>
          )}
        </div>
      ) : (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
          <Clock size={11} /> Pendiente
        </span>
      ),
    },
    {
      key: 'acciones',
      label: '',
      align: 'right',
      render: (_, row) => (
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={(e) => verAcuerdo(e, row)}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-blue-50 hover:text-blue-600 transition-colors"
            title="Ver acuerdo"
          >
            <FileText size={16} />
          </button>
          {canEdit && (
            <>
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
                title="Desactivar"
              >
                <Trash2 size={16} />
              </button>
            </>
          )}
        </div>
      ),
    },
  ]

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-400">Cargando...</div>
  }

  return (
    <div className="flex flex-col h-full gap-4">
      <PageHeader
        title="Drivers"
        subtitle="Gestiona los conductores del sistema"
        icon={Truck}
        accent="amber"
        actions={canEdit ? (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 border border-gray-200/20 rounded-lg p-1 bg-white/5">
              <button onClick={() => downloadFile('/drivers/plantilla/homologacion/descargar', 'plantilla_homologacion_drivers.xlsx')} className="btn-secondary flex items-center gap-1.5 text-xs py-1.5 px-2.5" title="Descargar plantilla de homologación">
                <Download size={14} /> Homologar
              </button>
              <label className={`btn-secondary flex items-center gap-1.5 text-xs py-1.5 px-2.5 cursor-pointer ${importingHomolog ? 'opacity-50' : ''}`} title="Importar plantilla de homologación">
                <Upload size={14} /> {importingHomolog ? 'Importando…' : 'Importar'}
                <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportHomologacion} disabled={importingHomolog} />
              </label>
            </div>
            <div className="flex items-center gap-1 border border-gray-200/20 rounded-lg p-1 bg-white/5">
              <button onClick={() => downloadFile('/drivers/plantilla/tarifas/descargar', 'plantilla_tarifas_drivers.xlsx')} className="btn-secondary flex items-center gap-1.5 text-xs py-1.5 px-2.5" title="Descargar plantilla de tarifas">
                <Download size={14} /> Tarifas
              </button>
              <label className={`btn-secondary flex items-center gap-1.5 text-xs py-1.5 px-2.5 cursor-pointer ${importingTarifas ? 'opacity-50' : ''}`} title="Importar plantilla de tarifas">
                <Upload size={14} /> {importingTarifas ? 'Importando…' : 'Importar'}
                <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportTarifas} disabled={importingTarifas} />
              </label>
            </div>
            <button onClick={openCreate} className="btn-primary flex items-center gap-2">
              <Plus size={18} /> Nuevo Driver
            </button>
          </div>
        ) : null}
      />

      <div className="flex-1 min-h-0">
      <DataTable
        columns={columns}
        data={drivers}
        onRowClick={handleRowClick}
        emptyMessage="No hay drivers"
      />
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Editar Driver' : 'Nuevo Driver'} wide>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
              <input
                type="text"
                className="input-field"
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                className="input-field"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Aliases (separados por coma)</label>
            <textarea
              className="input-field min-h-[80px] resize-y"
              placeholder="Alias 1, Alias 2, Alias 3"
              value={form.aliases}
              onChange={(e) => setForm((f) => ({ ...f, aliases: e.target.value }))}
              rows={3}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tarifa ECourier (CLP)</label>
              <input
                type="number"
                className="input-field"
                min={0}
                value={form.tarifa_ecourier}
                onChange={(e) => setForm((f) => ({ ...f, tarifa_ecourier: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tarifa Oviedo (CLP)</label>
              <input
                type="number"
                className="input-field"
                min={0}
                value={form.tarifa_oviedo}
                onChange={(e) => setForm((f) => ({ ...f, tarifa_oviedo: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tarifa Tercerizado (CLP)</label>
              <input
                type="number"
                className="input-field"
                min={0}
                value={form.tarifa_tercerizado}
                onChange={(e) => setForm((f) => ({ ...f, tarifa_tercerizado: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tarifa Valparaíso (CLP)</label>
              <input
                type="number"
                className="input-field"
                min={0}
                value={form.tarifa_valparaiso}
                onChange={(e) => setForm((f) => ({ ...f, tarifa_valparaiso: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tarifa Melipilla (CLP)</label>
              <input
                type="number"
                className="input-field"
                min={0}
                value={form.tarifa_melipilla}
                onChange={(e) => setForm((f) => ({ ...f, tarifa_melipilla: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Zona</label>
              <select
                className="input-field"
                value={form.zona}
                onChange={(e) => setForm((f) => ({ ...f, zona: e.target.value }))}
              >
                <option value="">Sin zona</option>
                <option value="SANTIAGO">Santiago</option>
                <option value="VALPARAISO">Valparaíso</option>
                <option value="MELIPILLA">Melipilla</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tarifa fija retiro/día (CLP)</label>
              <input
                type="number"
                className="input-field"
                min={0}
                value={form.tarifa_retiro_fija}
                onChange={(e) => setForm((f) => ({ ...f, tarifa_retiro_fija: e.target.value }))}
              />
              <p className="text-xs text-gray-500 mt-1">Si &gt; 0, cobra este monto por cada día con retiros</p>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Jefe de Flota</label>
            <select
              className="input-field"
              value={form.jefe_flota_id}
              onChange={(e) => setForm((f) => ({ ...f, jefe_flota_id: e.target.value }))}
            >
              <option value="">Sin jefe de flota</option>
              {drivers
                .filter((d) => d.activo && (!editing || d.id !== editing.id))
                .map((d) => (
                  <option key={d.id} value={d.id}>{d.nombre}</option>
                ))}
            </select>
          </div>
          <div className="flex items-start gap-3 p-3 rounded-lg bg-orange-50 border border-orange-200">
            <input
              id="contratado"
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
              checked={form.contratado}
              onChange={(e) => setForm((f) => ({ ...f, contratado: e.target.checked }))}
            />
            <div>
              <label htmlFor="contratado" className="text-sm font-medium text-orange-800 cursor-pointer">
                Conductor Contratado
              </label>
              <p className="text-xs text-orange-600 mt-0.5">
                No recibe pago por extras de bultos (producto) ni por extras de comuna.
              </p>
            </div>
          </div>
          {/* ── Datos bancarios ── */}
          <div className="border border-gray-200 rounded-lg p-4 space-y-3 bg-gray-50">
            <p className="text-sm font-semibold text-gray-700">Datos Bancarios</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">RUT</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="12.345.678-9"
                  value={form.rut}
                  onChange={(e) => setForm((f) => ({ ...f, rut: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Banco</label>
                <select
                  className="input-field"
                  value={form.banco_codigo}
                  onChange={(e) => setForm((f) => ({ ...f, banco_codigo: e.target.value }))}
                >
                  <option value="">— Seleccionar banco —</option>
                  {BANCOS_OPCIONES.map((b) => (
                    <option key={b.codigo} value={b.codigo}>{b.nombre}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de Cuenta</label>
                <select
                  className="input-field"
                  value={form.tipo_cuenta}
                  onChange={(e) => setForm((f) => ({ ...f, tipo_cuenta: e.target.value }))}
                >
                  <option value="">— Seleccionar tipo —</option>
                  {TIPOS_CUENTA.map((t) => (
                    <option key={t.valor} value={t.valor}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Número de Cuenta</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="0000000000"
                  value={form.numero_cuenta}
                  onChange={(e) => setForm((f) => ({ ...f, numero_cuenta: e.target.value }))}
                />
                {form.banco_codigo === '016' && form.tipo_cuenta === 'vista' && (
                  <p className="text-xs text-blue-600 mt-1">
                    Cuenta RUT Banco Estado: ingresa el RUT completo con dígito verificador (ej. 123456789).
                  </p>
                )}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {editing ? 'Contraseña (dejar vacío para no cambiar)' : 'Contraseña'}
            </label>
            <input
              type="password"
              className="input-field"
              placeholder={editing ? '••••••••' : ''}
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
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

      <Modal open={deleteModalOpen} onClose={() => { setDeleteModalOpen(false); setToDelete(null) }} title="Desactivar Driver">
        {toDelete && (
          <div>
            <p className="text-gray-600 mb-4">
              ¿Desactivar al driver <strong>{toDelete.nombre}</strong>? Esta acción es reversible.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => { setDeleteModalOpen(false); setToDelete(null) }} className="btn-secondary">
                Cancelar
              </button>
              <button onClick={confirmDelete} className="btn-danger">
                Desactivar
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={acuerdoModal} onClose={() => { setAcuerdoModal(false); setAcuerdoData(null) }} title="Acuerdo de Colaboración">
        {loadingAcuerdo && (
          <div className="py-10 text-center text-sm text-gray-400">Cargando...</div>
        )}
        {acuerdoData && !loadingAcuerdo && (
          <div className="space-y-4">
            {acuerdoData.acuerdo_aceptado ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 text-green-700 text-sm font-medium">
                <CheckCircle size={16} /> Acuerdo vigente — versión {acuerdoData.acuerdo_version}
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 text-amber-700 text-sm font-medium">
                <Clock size={16} />
                {acuerdoData.acuerdo_version && acuerdoData.acuerdo_version !== acuerdoData.version_actual
                  ? `Versión anterior firmada (v${acuerdoData.acuerdo_version}). Versión actual: v${acuerdoData.version_actual}`
                  : 'Acuerdo pendiente de firma'}
              </div>
            )}
            <div className="divide-y divide-gray-100 rounded-xl border border-gray-100 overflow-hidden text-sm">
              <AcuerdoRow label="Conductor" value={acuerdoData.nombre} />
              <AcuerdoRow label="RUT firmante" value={acuerdoData.rut || '—'} />
              <AcuerdoRow label="Versión firmada" value={acuerdoData.acuerdo_version ? `v${acuerdoData.acuerdo_version}` : '—'} />
              <AcuerdoRow label="Fecha y hora" value={acuerdoData.acuerdo_fecha
                ? new Date(acuerdoData.acuerdo_fecha).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                : '—'} />
              <AcuerdoRow label="IP de origen" value={acuerdoData.acuerdo_ip || '—'} />
            </div>
            {acuerdoData.acuerdo_firma ? (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Firma registrada</p>
                <div className="border border-gray-200 rounded-xl bg-gray-50 p-3 flex items-center justify-center" style={{ minHeight: 100 }}>
                  <img src={acuerdoData.acuerdo_firma} alt="Firma" className="max-h-28 object-contain" />
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-4">Sin firma registrada</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
