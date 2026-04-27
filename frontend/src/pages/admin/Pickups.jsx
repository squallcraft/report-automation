import { useState, useEffect, useRef, useMemo } from 'react'
import api from '../../api'
import { useAuth } from '../../context/AuthContext'
import DataTable from '../../components/DataTable'
import Modal from '../../components/Modal'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, Upload, Download, AlertTriangle, Link, Search, Package, Store } from 'lucide-react'
import PageHeader from '../../components/PageHeader'

const fmtClp = (n) => (n ?? 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP' })
const now = new Date()

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
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importTab, setImportTab] = useState('api')
  const [importing, setImporting] = useState(false)
  const [ttLoading, setTtLoading] = useState(false)
  const [ttFechaInicio, setTtFechaInicio] = useState('')
  const [ttFechaFin, setTtFechaFin] = useState('')
  const [importResult, setImportResult] = useState(null)
  const [ttProgress, setTtProgress] = useState(null)
  const ttPollRef = useRef(null)
  const [pendientes, setPendientes] = useState([])
  const [resolveModal, setResolveModal] = useState(null)
  const [resolvePickupId, setResolvePickupId] = useState('')
  const [resolving, setResolving] = useState(false)
  const [mainTab, setMainTab] = useState('pickups')
  const [recepciones, setRecepciones] = useState([])
  const [recTotal, setRecTotal] = useState(0)
  const [recLoading, setRecLoading] = useState(false)
  const [recPage, setRecPage] = useState(0)
  const [recSearch, setRecSearch] = useState('')
  const [recFilterPickup, setRecFilterPickup] = useState('')
  const [recPeriod, setRecPeriod] = useState({ semana: '', mes: now.getMonth() + 1, anio: now.getFullYear() })

  const fetchData = () => {
    Promise.all([
      api.get('/pickups'),
      api.get('/sellers', { params: { activo: true } }),
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

  const loadPendientes = () => {
    api.get('/ingesta/pendientes')
      .then(({ data }) => setPendientes(data.filter(p => p.tipo === 'PICKUP')))
      .catch(() => {})
  }

  const pickupsEnPeriodo = useMemo(() => {
    const ids = new Set(recepciones.map(r => r.pickup_id).filter(Boolean))
    return ids.size > 0 ? pickups.filter(p => ids.has(p.id)) : pickups.filter(p => p.activo)
  }, [recepciones, pickups])

  const REC_LIMIT = 500
  const loadRecepciones = () => {
    setRecLoading(true)
    const params = {
      mes: recPeriod.mes,
      anio: recPeriod.anio,
      limit: REC_LIMIT,
      offset: recPage * REC_LIMIT,
    }
    if (recPeriod.semana) params.semana = recPeriod.semana
    if (recFilterPickup) params.pickup_id = recFilterPickup
    if (recSearch) params.search = recSearch
    api.get('/pickups/recepciones/all', { params })
      .then(({ data }) => {
        setRecepciones(data.data)
        setRecTotal(data.total)
      })
      .catch(() => {})
      .finally(() => setRecLoading(false))
  }

  useEffect(() => { fetchData(); loadPendientes() }, [])

  useEffect(() => {
    if (mainTab === 'recepciones') loadRecepciones()
  }, [mainTab, recPeriod, recFilterPickup, recSearch, recPage])

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

  const handleResolvePickup = async () => {
    if (!resolvePickupId) return toast.error('Selecciona un pickup')
    setResolving(true)
    try {
      const { data } = await api.post('/ingesta/resolver', {
        nombre_raw: resolveModal.nombre_raw,
        tipo: 'PICKUP',
        entidad_id: Number(resolvePickupId),
      })
      toast.success(data.message)
      setResolveModal(null)
      setResolvePickupId('')
      loadPendientes()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al resolver')
    } finally {
      setResolving(false)
    }
  }

  const handleImportExcel = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setImporting(true)
    setImportResult(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const { data } = await api.post('/pickups/recepciones/importar', formData)
      setImportResult({ ...data, fuente: 'excel' })
      if (data.creados > 0) toast.success(`${data.creados} recepciones importadas desde Excel`)
      if (data.sin_homologar?.length) toast.error(`${data.sin_homologar.length} pickups sin homologar`)
      loadPendientes()
    } catch (err) { toast.error(err.response?.data?.detail || 'Error al importar') }
    finally { setImporting(false); e.target.value = '' }
  }

  const handleImportTrackingTech = async () => {
    if (!ttFechaInicio || !ttFechaFin) return toast.error('Selecciona ambas fechas')
    setTtLoading(true)
    setImportResult(null)
    setTtProgress(null)
    try {
      const fi = ttFechaInicio.replace(/-/g, '')
      const ff = ttFechaFin.replace(/-/g, '')
      const { data } = await api.post(`/pickups/recepciones/importar-trackingtech?fecha_inicio=${fi}&fecha_fin=${ff}`)
      const taskId = data.task_id

      // Start polling progress
      ttPollRef.current = setInterval(async () => {
        try {
          const { data: prog } = await api.get(`/pickups/recepciones/importar-trackingtech/progress/${taskId}`)
          setTtProgress(prog)
          if (prog.status === 'done' || prog.status === 'error') {
            clearInterval(ttPollRef.current)
            ttPollRef.current = null
            setTtLoading(false)
            if (prog.status === 'done' && prog.result) {
              const r = prog.result
              setImportResult({ ...r, fuente: 'api' })
              if (r.creados > 0) toast.success(`${r.creados} recepciones importadas desde TrackingTech`)
              else if (r.duplicados > 0) toast(`${r.duplicados} registros ya existían, 0 nuevos`, { icon: 'ℹ️' })
              else toast('No se encontraron registros nuevos', { icon: 'ℹ️' })
              if (r.sin_homologar?.length) toast.error(`${r.sin_homologar.length} pickups sin homologar`)
              loadPendientes()
            } else if (prog.status === 'error') {
              toast.error(prog.message || 'Error en la importación')
            }
          }
        } catch {
          // keep polling on transient errors
        }
      }, 1000)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al iniciar importación desde TrackingTech')
      setTtLoading(false)
    }
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

  const recTotalPages = Math.ceil(recTotal / REC_LIMIT)
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('es-CL') : '—'

  return (
    <div className="flex flex-col h-full min-w-0 gap-4">
      <PageHeader
        title="Pickup Points"
        subtitle="Centros de recepción de paquetes — comisión configurable + IVA por paquete"
        icon={Store}
        accent="teal"
        actions={canEdit && mainTab === 'pickups' ? (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => { setImportResult(null); setImportModalOpen(true) }}
              className="btn-secondary flex items-center gap-1.5"
            >
              <Upload size={16} /> Importar Recepciones
            </button>
            <button onClick={openCreate} className="btn-primary flex items-center gap-2">
              <Plus size={18} /> Nuevo Pickup
            </button>
          </div>
        ) : null}
      />

      <div className="flex border-b border-gray-200 mb-1 overflow-x-auto">
        <button
          onClick={() => setMainTab('pickups')}
          className={`px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${mainTab === 'pickups' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          Pickup Points
        </button>
        <button
          onClick={() => setMainTab('recepciones')}
          className={`px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${mainTab === 'recepciones' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          <Package size={14} /> Recepciones
        </button>
      </div>

      {mainTab === 'pickups' && (
        <>
          <div className="flex-1 min-h-0">
            <DataTable
              columns={columns}
              data={pickups}
              onRowClick={openEdit}
              emptyMessage="No hay pickups registrados"
            />
          </div>

          {pendientes.length > 0 && (
            <div className="card border-amber-200 bg-amber-50/50">
              <h2 className="text-base font-semibold text-amber-800 flex items-center gap-2 mb-3">
                <AlertTriangle size={18} /> Pickups sin Homologar ({pendientes.length})
              </h2>
              <p className="text-xs text-amber-700 mb-3">
                Estos nombres llegaron desde las importaciones y no coinciden con ningún pickup registrado. Asígnalos para que sus recepciones se contabilicen correctamente.
              </p>
              <div className="space-y-2">
                {pendientes.map((p, i) => (
                  <div key={i} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-white rounded-lg border border-amber-200 px-3 sm:px-4 py-2.5">
                    <div className="min-w-0">
                      <span className="font-medium text-gray-800 break-words">{p.nombre_raw}</span>
                      <span className="ml-2 text-xs text-gray-400">{p.cantidad} recepciones</span>
                    </div>
                    <button
                      onClick={() => { setResolveModal(p); setResolvePickupId('') }}
                      className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1 shrink-0 self-end sm:self-auto"
                    >
                      <Link size={14} /> Asignar Pickup
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {mainTab === 'recepciones' && (
        <div className="flex flex-col gap-4 min-w-0">
          <div className="card">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:flex lg:flex-wrap items-end gap-3 sm:gap-4">
              <div>
                <label className="block text-[10px] sm:text-xs font-medium text-gray-500 mb-1">Semana</label>
                <select
                  value={recPeriod.semana}
                  onChange={(e) => { setRecPeriod(p => ({ ...p, semana: e.target.value ? Number(e.target.value) : '' })); setRecPage(0) }}
                  className="input-field w-full lg:w-28 text-sm"
                >
                  <option value="">Todas</option>
                  {[1,2,3,4,5].map(s => <option key={s} value={s}>Sem {s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] sm:text-xs font-medium text-gray-500 mb-1">Mes</label>
                <select
                  value={recPeriod.mes}
                  onChange={(e) => { setRecPeriod(p => ({ ...p, mes: Number(e.target.value) })); setRecPage(0) }}
                  className="input-field w-full lg:w-36 text-sm"
                >
                  {['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'].map((m,i) => (
                    <option key={i+1} value={i+1}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] sm:text-xs font-medium text-gray-500 mb-1">Año</label>
                <select
                  value={recPeriod.anio}
                  onChange={(e) => { setRecPeriod(p => ({ ...p, anio: Number(e.target.value) })); setRecPage(0) }}
                  className="input-field w-full lg:w-24 text-sm"
                >
                  {Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i).map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] sm:text-xs font-medium text-gray-500 mb-1">Pickup</label>
                <select
                  value={recFilterPickup}
                  onChange={(e) => { setRecFilterPickup(e.target.value); setRecPage(0) }}
                  className="input-field w-full lg:w-48 text-sm"
                >
                  <option value="">Todos</option>
                  {pickupsEnPeriodo.map(p => (
                    <option key={p.id} value={p.id}>{p.nombre}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2 sm:col-span-3 lg:col-span-1 lg:flex-1 lg:min-w-[200px]">
                <label className="block text-[10px] sm:text-xs font-medium text-gray-500 mb-1">Buscar</label>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Pedido, pickup..."
                    className="input-field pl-9 text-sm"
                    value={recSearch}
                    onChange={(e) => { setRecSearch(e.target.value); setRecPage(0) }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm min-w-[600px]">
                <thead>
                  <tr className="bg-[#1e3a5f]">
                    <th className="px-2 sm:px-4 py-2.5 text-left text-[10px] sm:text-[11px] font-semibold text-white uppercase tracking-wider">Fecha</th>
                    <th className="px-2 sm:px-4 py-2.5 text-left text-[10px] sm:text-[11px] font-semibold text-white uppercase tracking-wider">Pickup</th>
                    <th className="px-2 sm:px-4 py-2.5 text-left text-[10px] sm:text-[11px] font-semibold text-white uppercase tracking-wider">Pedido</th>
                    <th className="px-2 sm:px-4 py-2.5 text-left text-[10px] sm:text-[11px] font-semibold text-white uppercase tracking-wider">Tracking</th>
                    <th className="px-2 sm:px-4 py-2.5 text-left text-[10px] sm:text-[11px] font-semibold text-white uppercase tracking-wider">Seller</th>
                    <th className="px-2 sm:px-4 py-2.5 text-left text-[10px] sm:text-[11px] font-semibold text-white uppercase tracking-wider">Tipo</th>
                    <th className="px-2 sm:px-4 py-2.5 text-center text-[10px] sm:text-[11px] font-semibold text-white uppercase tracking-wider">Sem</th>
                    <th className="px-2 sm:px-4 py-2.5 text-right text-[10px] sm:text-[11px] font-semibold text-white uppercase tracking-wider">Comisión</th>
                  </tr>
                </thead>
                <tbody>
                  {recLoading ? (
                    <tr><td colSpan={8} className="text-center py-12 text-gray-400">Cargando...</td></tr>
                  ) : recepciones.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-12 text-gray-400">No hay recepciones para el período seleccionado</td></tr>
                  ) : recepciones.map((r, idx) => (
                    <tr key={r.id} className={idx % 2 === 0 ? 'bg-white hover:bg-gray-50' : 'bg-gray-50/50 hover:bg-gray-100'}>
                      <td className="px-2 sm:px-4 py-2 text-xs text-gray-700 whitespace-nowrap">{fmtDate(r.fecha_recepcion)}</td>
                      <td className="px-2 sm:px-4 py-2 text-xs font-medium text-gray-800">{r.pickup_nombre}</td>
                      <td className="px-2 sm:px-4 py-2 text-xs text-gray-700 font-mono">{r.pedido}</td>
                      <td className="px-2 sm:px-4 py-2 text-xs text-gray-500 font-mono">{r.tracking_id || '—'}</td>
                      <td className="px-2 sm:px-4 py-2 text-xs text-gray-700">{r.seller_nombre || '—'}</td>
                      <td className="px-2 sm:px-4 py-2 text-xs text-gray-500">{r.tipo || '—'}</td>
                      <td className="px-2 sm:px-4 py-2 text-xs text-center text-gray-700">{r.semana}</td>
                      <td className="px-2 sm:px-4 py-2 text-xs text-right font-medium text-gray-800">{fmtClp(r.comision)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {recTotal > 0 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-2 px-3 sm:px-4 py-2.5 sm:py-3 border-t border-gray-200 bg-gray-50">
                <span className="text-[10px] sm:text-xs text-gray-500">{recTotal.toLocaleString('es-CL')} recepciones</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setRecPage(p => Math.max(0, p - 1))}
                    disabled={recPage === 0}
                    className="btn-secondary text-[10px] sm:text-xs px-2 sm:px-3 py-1"
                  >
                    Anterior
                  </button>
                  <span className="text-[10px] sm:text-xs text-gray-600">{recPage + 1}/{recTotalPages || 1}</span>
                  <button
                    onClick={() => setRecPage(p => p + 1)}
                    disabled={recPage + 1 >= recTotalPages}
                    className="btn-secondary text-[10px] sm:text-xs px-2 sm:px-3 py-1"
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <Modal open={!!resolveModal} onClose={() => setResolveModal(null)} title="Asignar Pickup">
        {resolveModal && (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-sm text-gray-500">Nombre en importación:</p>
              <p className="font-semibold text-lg">{resolveModal.nombre_raw}</p>
              <p className="text-xs text-gray-400 mt-1">{resolveModal.cantidad} recepciones pendientes de asignar</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Asignar a Pickup:</label>
              <select
                value={resolvePickupId}
                onChange={(e) => setResolvePickupId(e.target.value)}
                className="input-field"
              >
                <option value="">Seleccionar pickup...</option>
                {pickups.filter(p => p.activo).map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                El nombre se guardará como alias del pickup para futuras importaciones.
              </p>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setResolveModal(null)} className="btn-secondary">Cancelar</button>
              <button onClick={handleResolvePickup} disabled={resolving || !resolvePickupId} className="btn-primary">
                {resolving ? 'Asignando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        )}
      </Modal>

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

      <Modal open={importModalOpen} onClose={() => setImportModalOpen(false)} title="Importar Recepciones" wide>
        <div className="space-y-4">
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => { setImportTab('api'); setImportResult(null) }}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${importTab === 'api' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              <span className="flex items-center gap-1.5"><Download size={14} /> API TrackingTech</span>
            </button>
            <button
              onClick={() => { setImportTab('excel'); setImportResult(null) }}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${importTab === 'excel' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              <span className="flex items-center gap-1.5"><Upload size={14} /> Archivo Excel</span>
            </button>
          </div>

          {importTab === 'api' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Importa los escaneos de pickup procesados en TrackingTech para el rango de fechas seleccionado. Solo se importan registros sin errores.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Fecha inicio</label>
                  <input type="date" className="input-field" value={ttFechaInicio} onChange={(e) => setTtFechaInicio(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Fecha fin</label>
                  <input type="date" className="input-field" value={ttFechaFin} onChange={(e) => setTtFechaFin(e.target.value)} />
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={handleImportTrackingTech}
                  disabled={ttLoading || !ttFechaInicio || !ttFechaFin}
                  className="btn-primary flex items-center gap-2"
                >
                  {ttLoading ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                      </svg>
                      Importando…
                    </>
                  ) : (
                    <>
                      <Download size={16} /> Importar desde API
                    </>
                  )}
                </button>
              </div>

              {ttLoading && ttProgress && (
                <div className="space-y-2 mt-2">
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>{ttProgress.message}</span>
                    {ttProgress.total > 0 && (
                      <span className="font-medium">{ttProgress.processed}/{ttProgress.total}</span>
                    )}
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-primary-600 h-2 rounded-full transition-all duration-500"
                      style={{ width: ttProgress.total > 0 ? `${Math.round((ttProgress.processed / ttProgress.total) * 100)}%` : '0%' }}
                    />
                  </div>
                  <div className="flex gap-4 text-xs">
                    <span className="text-green-700 font-medium">✓ {ttProgress.nuevos ?? 0} nuevos</span>
                    <span className="text-amber-600 font-medium">↩ {ttProgress.duplicados ?? 0} duplicados</span>
                    {ttProgress.errores > 0 && <span className="text-red-600 font-medium">✕ {ttProgress.errores} errores</span>}
                    {ttProgress.total > 0 && ttProgress.estimated_remaining_seconds > 0 && (
                      <span className="text-gray-400 ml-auto">~{Math.ceil(ttProgress.estimated_remaining_seconds)}s restantes</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {importTab === 'excel' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Sube un archivo Excel con las columnas: Fecha, Pickup, Pedido/Tracking, Tipo.
              </p>
              <label className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${importing ? 'border-gray-300 bg-gray-50' : 'border-gray-300 hover:border-primary-400 hover:bg-primary-50/30'}`}>
                <div className="flex flex-col items-center gap-2 text-gray-500">
                  <Upload size={24} />
                  <span className="text-sm font-medium">{importing ? 'Importando…' : 'Seleccionar archivo Excel'}</span>
                  <span className="text-xs text-gray-400">.xlsx o .xls</span>
                </div>
                <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportExcel} disabled={importing} />
              </label>
            </div>
          )}

          {importResult && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-1 text-sm">
              <p className="font-semibold text-gray-800">Resultado de importación</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
                {importResult.total_api != null && (
                  <>
                    <span className="text-gray-500">Total desde API:</span>
                    <span className="font-medium">{importResult.total_api}</span>
                  </>
                )}
                <span className="text-gray-500">Creados:</span>
                <span className="font-medium text-green-700">{importResult.creados}</span>
                {importResult.descartados != null && (
                  <>
                    <span className="text-gray-500">Descartados (con error):</span>
                    <span className="font-medium text-gray-500">{importResult.descartados}</span>
                  </>
                )}
                {importResult.duplicados != null && (
                  <>
                    <span className="text-gray-500">Duplicados omitidos:</span>
                    <span className="font-medium text-amber-600">{importResult.duplicados}</span>
                  </>
                )}
                <span className="text-gray-500">Vinculados a envíos:</span>
                <span className="font-medium text-blue-700">{importResult.vinculados}</span>
              </div>
              {importResult.sin_homologar?.length > 0 && (
                <div className="mt-2 p-2 bg-red-50 rounded text-red-700 text-xs">
                  <p className="font-medium">Pickups sin homologar:</p>
                  <p>{importResult.sin_homologar.join(', ')}</p>
                </div>
              )}
              {importResult.errores?.length > 0 && (
                <div className="mt-2 p-2 bg-red-50 rounded text-red-700 text-xs max-h-32 overflow-y-auto">
                  <p className="font-medium">{importResult.errores.length} errores:</p>
                  {importResult.errores.slice(0, 10).map((e, i) => <p key={i}>{e}</p>)}
                  {importResult.errores.length > 10 && <p>...y {importResult.errores.length - 10} más</p>}
                </div>
              )}
              {importResult.advertencia_api && (
                <div className="mt-2 p-2 bg-amber-50 rounded text-amber-700 text-xs">
                  {importResult.advertencia_api}
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
