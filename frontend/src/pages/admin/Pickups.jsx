import { useState, useEffect } from 'react'
import api from '../../api'
import { useAuth } from '../../context/AuthContext'
import DataTable from '../../components/DataTable'
import Modal from '../../components/Modal'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, Upload } from 'lucide-react'

const fmtClp = (n) => (n ?? 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP' })

function EstadoBadge({ activo }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${activo ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
      {activo ? 'Activo' : 'Inactivo'}
    </span>
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

const bancoNombreCanonicoDesde = (codigo) => {
  const map = {
    '001': 'Banco de Chile', '009': 'Banco Internacional', '012': 'Scotiabank',
    '014': 'Banco BICE', '016': 'Banco Estado', '028': 'BCI', '031': 'Itaú CorpBanca',
    '034': 'Banco Security', '037': 'Banco Santander', '039': 'Banco Consorcio',
    '402': 'Banco Falabella', '403': 'Banco Ripley', '672': 'Coopeuch',
    '729': 'Prepago Los Héroes', '028-tenpo': 'Tenpo', '028-mach': 'MACH',
    '741': 'Copec Pay', '875': 'Mercado Pago',
  }
  return map[codigo] || codigo
}

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
  tarifa_driver: 0,
  comision_paquete: 200,
  seller_id: '',
  driver_id: '',
  email: '',
  password: '',
  rut: '',
  banco_codigo: '',
  tipo_cuenta: '',
  numero_cuenta: '',
}

export default function Pickups() {
  const { user } = useAuth()
  const canEdit = user?.rol === 'ADMIN'
  const [pickups, setPickups] = useState([])
  const [sellers, setSellers] = useState([])
  const [drivers, setDrivers] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [toDelete, setToDelete] = useState(null)
  const [importing, setImporting] = useState(false)

  const fetchData = () => {
    Promise.all([
      api.get('/pickups'),
      api.get('/sellers'),
      api.get('/drivers'),
    ])
      .then(([pRes, sRes, dRes]) => {
        setPickups(pRes.data)
        setSellers(sRes.data)
        setDrivers(dRes.data)
      })
      .catch(() => toast.error('Error al cargar datos'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchData() }, [])

  const openCreate = () => {
    setEditing(null)
    setForm(initialForm)
    setModalOpen(true)
  }

  const openEdit = (pickup) => {
    setEditing(pickup)
    setForm({
      nombre: pickup.nombre,
      aliases: (pickup.aliases || []).join(', '),
      tarifa_driver: pickup.tarifa_driver ?? 0,
      comision_paquete: pickup.comision_paquete ?? 200,
      seller_id: pickup.seller_id ?? '',
      driver_id: pickup.driver_id ?? '',
      email: pickup.email || '',
      password: '',
      rut: pickup.rut || '',
      banco_codigo: bancoCodigoDesdeNombre(pickup.banco),
      tipo_cuenta: pickup.tipo_cuenta || '',
      numero_cuenta: pickup.numero_cuenta || '',
    })
    setModalOpen(true)
  }

  const handleDeleteClick = (e, pickup) => {
    e.stopPropagation()
    setToDelete(pickup)
    setDeleteModalOpen(true)
  }

  const confirmDelete = () => {
    if (!toDelete) return
    api.delete(`/pickups/${toDelete.id}`)
      .then(() => {
        toast.success('Pickup desactivado')
        fetchData()
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
      tarifa_driver: parseInt(form.tarifa_driver, 10) || 0,
      comision_paquete: parseInt(form.comision_paquete, 10) || 200,
      seller_id: form.seller_id ? parseInt(form.seller_id, 10) : null,
      driver_id: form.driver_id ? parseInt(form.driver_id, 10) : null,
      email: form.email?.trim() || null,
      rut: form.rut?.trim() || null,
      banco: form.banco_codigo ? bancoNombreCanonicoDesde(form.banco_codigo) : null,
      tipo_cuenta: form.tipo_cuenta || null,
      numero_cuenta: form.numero_cuenta?.trim() || null,
    }
    delete payload.banco_codigo
    if (!payload.password) delete payload.password

    const promise = editing
      ? api.put(`/pickups/${editing.id}`, payload)
      : api.post('/pickups', payload)

    promise
      .then(() => {
        toast.success(editing ? 'Pickup actualizado' : 'Pickup creado')
        setModalOpen(false)
        fetchData()
      })
      .catch((err) => toast.error(err.response?.data?.detail || 'Error al guardar'))
      .finally(() => setSaving(false))
  }

  const handleImportRecepciones = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setImporting(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const { data } = await api.post('/pickups/recepciones/importar', formData)
      let msg = `${data.creados} recepciones creadas`
      if (data.vinculados) msg += `, ${data.vinculados} vinculadas a envíos`
      toast.success(msg)
      if (data.sin_homologar?.length) toast.error(`${data.sin_homologar.length} pickups sin homologar: ${data.sin_homologar.join(', ')}`)
      if (data.errores?.length) toast.error(`${data.errores.length} errores`)
    } catch (err) { toast.error(err.response?.data?.detail || 'Error al importar') }
    finally { setImporting(false); e.target.value = '' }
  }

  const columns = [
    { key: 'nombre', label: 'Nombre', render: (v, row) => (
      <div className="flex items-center gap-1.5 flex-wrap">
        <span>{v}</span>
        {row.seller_nombre && (
          <span className="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-700">
            Seller: {row.seller_nombre}
          </span>
        )}
        {row.driver_nombre && (
          <span className="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-purple-100 text-purple-700">
            Driver: {row.driver_nombre}
          </span>
        )}
      </div>
    )},
    { key: 'tarifa_driver', label: 'Tarifa Driver', align: 'right', render: (v) => fmtClp(v) },
    { key: 'comision_paquete', label: 'Comisión/paquete', align: 'right', render: (v) => fmtClp(v ?? 200) },
    { key: 'aliases', label: 'Aliases', render: (v) => (v || []).length > 0 ? v.join(', ') : '—' },
    { key: 'activo', label: 'Estado', align: 'center', render: (v) => <EstadoBadge activo={v} /> },
    {
      key: 'acciones',
      label: '',
      align: 'right',
      render: (_, row) => canEdit ? (
        <div className="flex items-center justify-end gap-1">
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
        </div>
      ) : null,
    },
  ]

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-400">Cargando...</div>
  }

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pickup Points</h1>
          <p className="text-sm text-gray-500 mt-1">Centros de recepción de paquetes — comisión configurable + IVA por paquete</p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2 flex-wrap">
            <label className={`btn-secondary flex items-center gap-1.5 text-xs py-1.5 px-2.5 cursor-pointer ${importing ? 'opacity-50' : ''}`} title="Importar recepciones desde Excel">
              <Upload size={14} /> {importing ? 'Importando…' : 'Importar Recepciones'}
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportRecepciones} disabled={importing} />
            </label>
            <button onClick={openCreate} className="btn-primary flex items-center gap-2">
              <Plus size={18} /> Nuevo Pickup
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0">
        <DataTable
          columns={columns}
          data={pickups}
          onRowClick={openEdit}
          emptyMessage="No hay pickups registrados"
        />
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Editar Pickup' : 'Nuevo Pickup'} wide>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
              <label className="block text-sm font-medium text-gray-700 mb-1">RUT (facturación)</label>
              <input
                type="text"
                className="input-field"
                placeholder="12.345.678-9"
                value={form.rut}
                onChange={(e) => setForm((f) => ({ ...f, rut: e.target.value }))}
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
              className="input-field min-h-[60px] resize-y"
              placeholder="Pickup Riel, PU Riel, ..."
              value={form.aliases}
              onChange={(e) => setForm((f) => ({ ...f, aliases: e.target.value }))}
              rows={2}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tarifa Driver (CLP)</label>
              <input
                type="number"
                className="input-field"
                min={0}
                value={form.tarifa_driver}
                onChange={(e) => setForm((f) => ({ ...f, tarifa_driver: e.target.value }))}
              />
              <p className="text-xs text-gray-500 mt-1">Monto fijo que cobra el conductor por visita</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Comisión por paquete (CLP)</label>
              <input
                type="number"
                className="input-field"
                min={0}
                value={form.comision_paquete}
                onChange={(e) => setForm((f) => ({ ...f, comision_paquete: e.target.value }))}
              />
              <p className="text-xs text-gray-500 mt-1">Comisión neta por paquete recibido</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Seller vinculado</label>
              <select
                className="input-field"
                value={form.seller_id}
                onChange={(e) => setForm((f) => ({ ...f, seller_id: e.target.value }))}
              >
                <option value="">— No emite envíos —</option>
                {sellers.filter(s => s.activo).map((s) => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">Si también emite envíos</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Driver vinculado</label>
              <select
                className="input-field"
                value={form.driver_id}
                onChange={(e) => setForm((f) => ({ ...f, driver_id: e.target.value }))}
              >
                <option value="">— No entrega —</option>
                {drivers.filter(d => d.activo).map((d) => (
                  <option key={d.id} value={d.id}>{d.nombre}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">Si también entrega como conductor</p>
            </div>
          </div>

          <div className="border border-gray-200 rounded-lg p-4 space-y-3 bg-gray-50">
            <p className="text-sm font-semibold text-gray-700">Datos Bancarios</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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

      <Modal open={deleteModalOpen} onClose={() => { setDeleteModalOpen(false); setToDelete(null) }} title="Desactivar Pickup">
        {toDelete && (
          <div>
            <p className="text-gray-600 mb-4">
              ¿Desactivar el pickup <strong>{toDelete.nombre}</strong>? Esta acción es reversible.
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
    </div>
  )
}
