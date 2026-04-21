import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api'
import { useAuth } from '../../context/AuthContext'
import DataTable from '../../components/DataTable'
import Modal from '../../components/Modal'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, Download, Upload, BarChart2, PlayCircle, Mail, MessageCircle, Tag, X as XIcon, Users } from 'lucide-react'
import PageHeader from '../../components/PageHeader'

const EMPRESA_OPTIONS = ['ECOURIER', 'TERCERIZADO', 'OVIEDO', 'VALPARAISO', 'MELIPILLA']

const fmtClp = (n) => (n ?? 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP' })

function WhatsAppIcon({ size = 16, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}

function waStatus(telefono) {
  if (!telefono) return 'none'
  const clean = telefono.trim().replace(/[\s\-().]/g, '')
  if (/^\+\d{8,15}$/.test(clean)) return 'ok'
  if (/^9\d{8}$/.test(clean)) return 'ok'
  return 'error'
}

function WhatsAppBadge({ telefono }) {
  const status = waStatus(telefono)
  if (status === 'none') {
    return (
      <span title="Sin número WhatsApp registrado" className="inline-flex text-gray-300">
        <WhatsAppIcon size={17} />
      </span>
    )
  }
  if (status === 'ok') {
    return (
      <span title={`WhatsApp: ${telefono}`} className="inline-flex text-green-500">
        <WhatsAppIcon size={17} />
      </span>
    )
  }
  return (
    <span title={`Número con formato incorrecto: "${telefono}"`} className="inline-flex text-red-500">
      <WhatsAppIcon size={17} />
    </span>
  )
}

function EmpresaBadge({ empresa }) {
  const styles = {
    ECOURIER: 'bg-primary-100 text-primary-700',
    TERCERIZADO: 'bg-amber-100 text-amber-700',
    OVIEDO: 'bg-indigo-100 text-indigo-700',
    VALPARAISO: 'bg-teal-100 text-teal-700',
    MELIPILLA: 'bg-rose-100 text-rose-700',
  }
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${styles[empresa] || 'bg-gray-100 text-gray-700'}`}>
      {empresa}
    </span>
  )
}

function EstadoBadge({ activo }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${activo ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
      {activo ? 'Activo' : 'Inactivo'}
    </span>
  )
}

const initialForm = {
  nombre: '',
  aliases: '',
  zona: 'Santiago',
  empresa: 'ECOURIER',
  precio_base: 0,
  plan_tarifario: '',
  tiene_retiro: false,
  tarifa_retiro: 0,
  tarifa_retiro_driver: 0,
  min_paquetes_retiro_gratis: 0,
  usa_pickup: false,
  rut: '',
  giro: '',
  dir_fiscal: '',
  cmna_fiscal: '',
  correo_dte: '',
  correo_informativo: '',
  telefono_whatsapp: '',
  tags: [],
  email: '',
  password: '',
  tiene_sucursales: false,
  sucursales: [],
}

export default function Sellers() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const canEdit = user?.rol === 'ADMIN'
  const [sellers, setSellers] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [toDelete, setToDelete] = useState(null)
  const [tagInput, setTagInput] = useState('')

  const [importing, setImporting] = useState(false)
  const [importingRutGiro, setImportingRutGiro] = useState(false)
  const [sellerFacturas, setSellerFacturas] = useState([])
  const [sellerFacturasLoading, setSellerFacturasLoading] = useState(false)

  // Tabs de lifecycle
  const [tab, setTab] = useState('activos')
  const [noActivos, setNoActivos] = useState({ pausados: [], cerrados: [] })

  const fetchSellers = () => {
    api.get('/sellers')
      .then(({ data }) => setSellers(data))
      .catch(() => toast.error('Error al cargar sellers'))
      .finally(() => setLoading(false))
  }

  const fetchNoActivos = () => {
    api.get('/sellers/no-activos').then(({ data }) => setNoActivos(data)).catch(() => {})
  }

  const handleDownloadPlantilla = async () => {
    try {
      const { data } = await api.get('/sellers/plantilla/descargar', { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([data]))
      const a = document.createElement('a')
      a.href = url
      a.download = 'plantilla_sellers.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch { toast.error('Error al descargar plantilla') }
  }

  const handleImport = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setImporting(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const { data } = await api.post('/sellers/importar', formData)
      toast.success(`${data.creados} creados, ${data.actualizados} actualizados`)
      if (data.errores?.length) toast.error(`${data.errores.length} errores`)
      fetchSellers()
    } catch (err) { toast.error(err.response?.data?.detail || 'Error al importar') }
    finally { setImporting(false); e.target.value = '' }
  }

  const handleDownloadPlantillaRutGiro = async () => {
    try {
      const { data } = await api.get('/sellers/plantilla/rut-giro/descargar', { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([data]))
      const a = document.createElement('a')
      a.href = url
      a.download = 'plantilla_rut_giro_sellers.xlsx'
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Descarga lista. Completa RUT y Giro y vuelve a importar.')
    } catch { toast.error('Error al descargar plantilla RUT/Giro') }
  }

  const handleImportRutGiro = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setImportingRutGiro(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const { data } = await api.post('/sellers/importar/rut-giro', formData)
      toast.success(`${data.actualizados} seller(s) actualizados con RUT/Giro`)
      if (data.errores?.length) data.errores.forEach((err) => toast.error(err))
      fetchSellers()
    } catch (err) { toast.error(err.response?.data?.detail || 'Error al importar RUT/Giro') }
    finally { setImportingRutGiro(false); e.target.value = '' }
  }

  useEffect(() => {
    fetchSellers()
    fetchNoActivos()
  }, [])

  useEffect(() => {
    if (!editing?.id) {
      setSellerFacturas([])
      return
    }
    setSellerFacturasLoading(true)
    api.get('/facturacion/historial', { params: { seller_id: editing.id, limite: 24 } })
      .then(({ data }) => setSellerFacturas(Array.isArray(data) ? data : []))
      .catch(() => setSellerFacturas([]))
      .finally(() => setSellerFacturasLoading(false))
  }, [editing?.id])

  const openCreate = () => {
    setEditing(null)
    setForm(initialForm)
    setTagInput('')
    setModalOpen(true)
  }

  const openEdit = (seller) => {
    setEditing(seller)
    const sucs = (seller.sucursales || []).map((s) => ({
      id: s.id,
      nombre: s.nombre,
      tarifa_retiro: s.tarifa_retiro ?? 0,
      tarifa_retiro_driver: s.tarifa_retiro_driver ?? 0,
    }))
    setForm({
      nombre: seller.nombre,
      aliases: (seller.aliases || []).join(', '),
      zona: seller.zona || 'Santiago',
      empresa: seller.empresa || 'ECOURIER',
      precio_base: seller.precio_base ?? 0,
      plan_tarifario: seller.plan_tarifario || '',
      tiene_retiro: seller.tiene_retiro ?? false,
      tarifa_retiro: seller.tarifa_retiro ?? 0,
      tarifa_retiro_driver: seller.tarifa_retiro_driver ?? 0,
      min_paquetes_retiro_gratis: seller.min_paquetes_retiro_gratis ?? 0,
      usa_pickup: seller.usa_pickup ?? false,
      rut: seller.rut || '',
      giro: seller.giro || '',
      dir_fiscal: seller.dir_fiscal || '',
      cmna_fiscal: seller.cmna_fiscal || '',
      correo_dte: seller.correo_dte || '',
      correo_informativo: seller.correo_informativo || '',
      telefono_whatsapp: seller.telefono_whatsapp || '',
      tags: seller.tags || [],
      email: seller.email || '',
      password: '',
      tiene_sucursales: sucs.length > 0,
      sucursales: sucs,
    })
    setTagInput('')
    setModalOpen(true)
  }

  const handleRowClick = (row) => {
    openEdit(row)
  }

  const handleDeleteClick = (e, seller) => {
    e.stopPropagation()
    setToDelete(seller)
    setDeleteModalOpen(true)
  }

  const confirmDelete = () => {
    if (!toDelete) return
    api.delete(`/sellers/${toDelete.id}`)
      .then(() => {
        toast.success('Seller desactivado')
        fetchSellers()
        setDeleteModalOpen(false)
        setToDelete(null)
      })
      .catch(() => toast.error('Error al desactivar'))
  }

  const syncSucursales = async (sellerId, existingSucs) => {
    const wanted = form.tiene_sucursales ? form.sucursales : []
    const existingIds = new Set((existingSucs || []).map((s) => s.id))
    const wantedIds = new Set(wanted.filter((s) => s.id).map((s) => s.id))

    for (const ex of (existingSucs || [])) {
      if (!wantedIds.has(ex.id)) {
        await api.delete(`/sellers/${sellerId}/sucursales/${ex.id}`)
      }
    }
    for (const s of wanted) {
      const body = {
        nombre: s.nombre,
        tarifa_retiro: parseInt(s.tarifa_retiro, 10) || 0,
        tarifa_retiro_driver: parseInt(s.tarifa_retiro_driver, 10) || 0,
      }
      if (s.id && existingIds.has(s.id)) {
        await api.put(`/sellers/${sellerId}/sucursales/${s.id}`, body)
      } else {
        await api.post(`/sellers/${sellerId}/sucursales`, body)
      }
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    const payload = {
      ...form,
      aliases: form.aliases ? form.aliases.split(',').map((a) => a.trim()).filter(Boolean) : [],
      precio_base: parseInt(form.precio_base, 10) || 0,
      plan_tarifario: form.plan_tarifario || null,
      tarifa_retiro: parseInt(form.tarifa_retiro, 10) || 0,
      tarifa_retiro_driver: parseInt(form.tarifa_retiro_driver, 10) || 0,
      min_paquetes_retiro_gratis: parseInt(form.min_paquetes_retiro_gratis, 10) || 0,
      rut: (form.rut || '').trim() || null,
      giro: (form.giro || '').trim() || null,
      dir_fiscal: (form.dir_fiscal || '').trim() || null,
      cmna_fiscal: (form.cmna_fiscal || '').trim() || null,
      correo_dte: (form.correo_dte || '').trim() || null,
      correo_informativo: (form.correo_informativo || '').trim() || null,
      telefono_whatsapp: (form.telefono_whatsapp || '').trim() || null,
      tags: form.tags || [],
      email: (form.email || '').trim() || null,
    }
    if (!payload.password) delete payload.password
    delete payload.tiene_sucursales
    delete payload.sucursales

    try {
      let sellerId
      let existingSucs
      if (editing) {
        await api.put(`/sellers/${editing.id}`, payload)
        sellerId = editing.id
        existingSucs = editing.sucursales || []
      } else {
        const { data } = await api.post('/sellers', payload)
        sellerId = data.id
        existingSucs = []
      }
      await syncSucursales(sellerId, existingSucs)
      toast.success(editing ? 'Seller actualizado' : 'Seller creado')
      setModalOpen(false)
      fetchSellers()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const reactivarDesdeListado = async (sellerId) => {
    const nota = window.prompt('¿Cómo volvió este cliente? (opcional)')
    try {
      await api.post(`/sellers/${sellerId}/reabrir`, { nota: nota || undefined })
      toast.success('Cliente reactivado')
      fetchSellers()
      fetchNoActivos()
    } catch { toast.error('Error al reactivar') }
  }

  const columns = [
    { key: 'nombre', label: 'Nombre' },
    { key: 'rut', label: 'RUT', render: (v) => v ? <span className="text-sm font-mono">{v}</span> : <span className="text-gray-400">—</span> },
    { key: 'empresa', label: 'Empresa', render: (v) => <EmpresaBadge empresa={v} /> },
    { key: 'zona', label: 'Zona' },
    { key: 'plan_tarifario', label: 'Plan Tarifa', render: (v) => v || '—' },
    { key: 'precio_base', label: 'Precio Base', align: 'right', render: (v) => fmtClp(v) },
    { key: 'usa_pickup', label: 'Pickup', align: 'center', render: (v) => v ? <span className="text-blue-600 font-medium">Sí</span> : <span className="text-gray-400">No</span> },
    { key: 'telefono_whatsapp', label: 'WA', align: 'center', render: (v) => <WhatsAppBadge telefono={v} /> },
    { key: 'activo', label: 'Estado', align: 'center', render: (v) => <EstadoBadge activo={v} /> },
    {
      key: 'acciones',
      label: '',
      align: 'right',
      render: (_, row) => (
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); navigate(`/admin/sellers/${row.id}/perfil?mes=${new Date().getMonth() + 1}&anio=${new Date().getFullYear()}`) }}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
            title="Ver perfil analítico"
          >
            <BarChart2 size={16} />
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
        title="Sellers"
        subtitle="Gestiona los sellers del sistema"
        icon={Users}
        accent="green"
        stats={[{ value: sellers.length, label: 'Total sellers' }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && (
              <>
                <button onClick={handleDownloadPlantilla} className="btn-secondary flex items-center gap-2 text-sm">
                  <Download size={16} /> Plantilla
                </button>
                <label className={`btn-secondary flex items-center gap-2 text-sm cursor-pointer ${importing ? 'opacity-50' : ''}`}>
                  <Upload size={16} /> {importing ? 'Importando...' : 'Importar Excel'}
                  <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} disabled={importing} />
                </label>
              </>
            )}
            {canEdit && (
              <button onClick={openCreate} className="btn-primary flex items-center gap-2">
                <Plus size={18} /> Nuevo Seller
              </button>
            )}
          </div>
        }
      />

      <div className="flex-1 min-h-0">

        {/* Tabs: Activos | Pausados | Cerrados */}
        <div className="flex items-center gap-0 mb-4 border-b border-gray-200">
          {[
            { id: 'activos', label: 'Activos', count: sellers.filter(s => s.activo).length },
            { id: 'pausados', label: 'En pausa', count: noActivos.pausados.length },
            { id: 'cerrados', label: 'Cerrados', count: noActivos.cerrados.length },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t.id ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {t.label}
              {t.count > 0 && (
                <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full font-bold ${tab === t.id ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-500'}`}>{t.count}</span>
              )}
            </button>
          ))}
        </div>

        {tab === 'activos' && (
          <DataTable
            columns={columns}
            data={sellers.filter(s => s.activo)}
            onRowClick={handleRowClick}
            emptyMessage="No hay sellers activos"
          />
        )}

        {tab === 'pausados' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {['Nombre', 'Empresa', 'RUT', 'En pausa desde', 'Retorno estimado', 'Nota', 'Acciones'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {noActivos.pausados.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">No hay sellers en pausa</td></tr>
                )}
                {noActivos.pausados.map(s => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{s.nombre}</td>
                    <td className="px-4 py-3 text-gray-600">{s.empresa || '—'}</td>
                    <td className="px-4 py-3 font-mono text-gray-600 text-xs">{s.rut || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{s.fecha_cierre || '—'}</td>
                    <td className="px-4 py-3">
                      {s.fecha_pausa_fin
                        ? <span className="text-orange-600 font-medium">{s.fecha_pausa_fin}</span>
                        : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs max-w-xs truncate">{s.nota_cierre || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button onClick={() => navigate(`/admin/sellers/${s.id}/perfil?mes=${new Date().getMonth() + 1}&anio=${new Date().getFullYear()}`)}
                          className="p-1.5 rounded text-gray-500 hover:bg-indigo-50 hover:text-indigo-600 transition-colors" title="Ver perfil">
                          <BarChart2 size={15} />
                        </button>
                        {canEdit && (
                          <button onClick={() => reactivarDesdeListado(s.id)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold bg-green-50 text-green-700 hover:bg-green-100 transition-colors">
                            <PlayCircle size={12} /> Reactivar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'cerrados' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {['Nombre', 'Empresa', 'RUT', 'Cierre', 'Razones', 'Potencial', 'Destino', 'Acciones'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {noActivos.cerrados.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">No hay sellers cerrados</td></tr>
                )}
                {noActivos.cerrados.map(s => {
                  const POTENCIAL_COLOR = { alto: 'text-green-600 bg-green-50', medio: 'text-amber-600 bg-amber-50', bajo: 'text-gray-500 bg-gray-100', ninguno: 'text-red-400 bg-red-50' }
                  return (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{s.nombre}</td>
                      <td className="px-4 py-3 text-gray-600">{s.empresa || '—'}</td>
                      <td className="px-4 py-3 font-mono text-gray-600 text-xs">{s.rut || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{s.fecha_cierre || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {(s.razones_cierre || []).map(r => (
                            <span key={r} className="text-[10px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded font-medium">{r.replace(/_/g, ' ')}</span>
                          ))}
                          {!(s.razones_cierre?.length) && <span className="text-gray-400">—</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {s.potencial_recuperacion
                          ? <span className={`text-xs font-semibold px-2 py-0.5 rounded ${POTENCIAL_COLOR[s.potencial_recuperacion] || 'text-gray-500 bg-gray-100'}`}>{s.potencial_recuperacion}</span>
                          : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{s.destino_competencia || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button onClick={() => navigate(`/admin/sellers/${s.id}/perfil?mes=${new Date().getMonth() + 1}&anio=${new Date().getFullYear()}`)}
                            className="p-1.5 rounded text-gray-500 hover:bg-indigo-50 hover:text-indigo-600 transition-colors" title="Ver perfil">
                            <BarChart2 size={15} />
                          </button>
                          {canEdit && (
                            <button onClick={() => reactivarDesdeListado(s.id)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold bg-green-50 text-green-700 hover:bg-green-100 transition-colors">
                              <PlayCircle size={12} /> Reabrir
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Editar Seller' : 'Nuevo Seller'} wide>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Aliases (separados por coma)</label>
              <input
                type="text"
                className="input-field"
                placeholder="Alias 1, Alias 2"
                value={form.aliases}
                onChange={(e) => setForm((f) => ({ ...f, aliases: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-amber-50/50 p-3 rounded-lg border border-amber-200">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">RUT</label>
              <input
                type="text"
                className="input-field"
                placeholder="12345678-9"
                value={form.rut}
                onChange={(e) => setForm((f) => ({ ...f, rut: e.target.value }))}
              />
              <p className="text-xs text-gray-500 mt-1">Requerido para emitir facturas electrónicas</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Giro</label>
              <input
                type="text"
                className="input-field"
                placeholder="Ej: Comercio al por menor"
                value={form.giro}
                onChange={(e) => setForm((f) => ({ ...f, giro: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-amber-50/50 p-3 rounded-lg border border-amber-200">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Dirección fiscal</label>
              <input
                type="text"
                className="input-field"
                placeholder="Ej: Av. Apoquindo 4700"
                maxLength={70}
                value={form.dir_fiscal}
                onChange={(e) => setForm((f) => ({ ...f, dir_fiscal: e.target.value }))}
              />
              <p className="text-xs text-gray-500 mt-1">Aparece en la factura electrónica — máx. 70 caracteres</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Comuna fiscal</label>
              <input
                type="text"
                className="input-field"
                placeholder="Ej: Las Condes"
                maxLength={20}
                value={form.cmna_fiscal}
                onChange={(e) => setForm((f) => ({ ...f, cmna_fiscal: e.target.value }))}
              />
              <p className="text-xs text-gray-500 mt-1">Máx. 20 caracteres</p>
            </div>
          </div>
          <div className="bg-amber-50/50 p-3 rounded-lg border border-amber-200">
            <label className="block text-sm font-medium text-gray-700 mb-1">Correo DTE</label>
            <input
              type="email"
              className="input-field"
              placeholder="Ej: facturacion@empresa.cl"
              maxLength={80}
              value={form.correo_dte}
              onChange={(e) => setForm((f) => ({ ...f, correo_dte: e.target.value }))}
            />
            <p className="text-xs text-gray-500 mt-1">Haulmer enviará la factura electrónica a este correo — máx. 80 caracteres</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* WhatsApp */}
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1.5">
                <MessageCircle size={14} className="text-green-600" />
                <span className="text-green-700 font-semibold">WhatsApp</span>
                <span className="text-xs font-normal text-gray-400">(envíos masivos)</span>
              </label>
              <input
                type="tel"
                className="input-field border-green-300 focus:ring-green-400"
                placeholder="Ej: +56912345678"
                maxLength={20}
                value={form.telefono_whatsapp}
                onChange={(e) => setForm((f) => ({ ...f, telefono_whatsapp: e.target.value }))}
              />
              <p className="text-xs text-gray-500 mt-1">Formato internacional — campañas WhatsApp Business</p>
            </div>
            {/* Correo informativo (comunicación masiva) */}
            <div className="bg-sky-50 border border-sky-200 rounded-lg p-3">
              <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1.5">
                <Mail size={14} className="text-sky-600" />
                <span className="text-sky-700 font-semibold">Correo informativo</span>
                <span className="text-xs font-normal text-gray-400">(envíos masivos)</span>
              </label>
              <input
                type="email"
                className="input-field border-sky-300 focus:ring-sky-400"
                placeholder="Ej: contacto@empresa.cl"
                maxLength={120}
                value={form.correo_informativo}
                onChange={(e) => setForm((f) => ({ ...f, correo_informativo: e.target.value }))}
              />
              <p className="text-xs text-gray-500 mt-1">Campañas informativas / comunicación masiva — separado del DTE</p>
            </div>
          </div>
          {/* Tags (fila propia) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1.5">
              <Tag size={14} className="text-indigo-500" />
              Tags
            </label>
            <div className="flex flex-wrap gap-1 mb-1.5 min-h-[28px]">
              {(form.tags || []).map((t) => (
                <span
                  key={t}
                  className={`inline-flex items-center gap-0.5 text-xs px-2 py-0.5 rounded-full font-medium ${
                    t.startsWith('auto:')
                      ? 'bg-sky-100 text-sky-700 border border-sky-200'
                      : 'bg-indigo-100 text-indigo-700 border border-indigo-200'
                  }`}
                >
                  {t.startsWith('auto:') ? '⚡' : ''}{t}
                  {!t.startsWith('auto:') && (
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, tags: f.tags.filter((x) => x !== t) }))}
                      className="ml-0.5 hover:text-red-500"
                    >
                      <XIcon size={10} />
                    </button>
                  )}
                </span>
              ))}
            </div>
            <div className="flex gap-1">
              <input
                type="text"
                className="input-field text-sm py-1"
                placeholder="nuevo tag…"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
                    e.preventDefault()
                    const t = tagInput.trim().toLowerCase().replace(/\s+/g, '_')
                    if (!form.tags.includes(t) && !t.startsWith('auto:')) {
                      setForm((f) => ({ ...f, tags: [...(f.tags || []), t] }))
                    }
                    setTagInput('')
                  }
                }}
              />
              <button
                type="button"
                className="px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700"
                onClick={() => {
                  const t = tagInput.trim().toLowerCase().replace(/\s+/g, '_')
                  if (t && !form.tags.includes(t) && !t.startsWith('auto:')) {
                    setForm((f) => ({ ...f, tags: [...(f.tags || []), t] }))
                  }
                  setTagInput('')
                }}
              >
                <Plus size={12} />
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">Enter o coma para agregar · Los tags <span className="text-sky-600">⚡auto:</span> son automáticos</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Zona</label>
              <input
                type="text"
                className="input-field"
                value={form.zona}
                onChange={(e) => setForm((f) => ({ ...f, zona: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Empresa</label>
              <select
                className="input-field"
                value={form.empresa}
                onChange={(e) => setForm((f) => ({ ...f, empresa: e.target.value }))}
              >
                {EMPRESA_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Plan Tarifario</label>
              <input
                type="text"
                className="input-field"
                placeholder="Ej: V, 2800, Giorgio"
                value={form.plan_tarifario}
                onChange={(e) => setForm((f) => ({ ...f, plan_tarifario: e.target.value }))}
              />
              <p className="text-xs text-gray-400 mt-1">Nombre del plan en la matriz de tarifas</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Precio Base (CLP)</label>
              <input
                type="number"
                className="input-field"
                min={0}
                value={form.precio_base}
                onChange={(e) => setForm((f) => ({ ...f, precio_base: e.target.value }))}
              />
              <p className="text-xs text-gray-400 mt-1">Fallback si no hay plan o comuna</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tarifa Retiro (CLP)</label>
              <input
                type="number"
                className="input-field"
                min={0}
                value={form.tarifa_retiro}
                onChange={(e) => setForm((f) => ({ ...f, tarifa_retiro: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Pago Retiro Driver (CLP)</label>
              <input
                type="number"
                className="input-field"
                min={0}
                value={form.tarifa_retiro_driver}
                onChange={(e) => setForm((f) => ({ ...f, tarifa_retiro_driver: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Min. paquetes retiro gratis</label>
              <input
                type="number"
                className="input-field"
                min={0}
                value={form.min_paquetes_retiro_gratis}
                onChange={(e) => setForm((f) => ({ ...f, min_paquetes_retiro_gratis: e.target.value }))}
              />
              <p className="text-xs text-gray-400 mt-1">Si tiene más de X paquetes, el retiro es gratis. 0 = siempre cobra.</p>
            </div>
            <div className="flex items-center gap-3 pt-6">
              <input
                type="checkbox"
                id="tiene_retiro"
                checked={form.tiene_retiro}
                onChange={(e) => setForm((f) => ({ ...f, tiene_retiro: e.target.checked }))}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <label htmlFor="tiene_retiro" className="text-sm font-medium text-gray-700">Tiene retiro</label>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="usa_pickup"
                checked={form.usa_pickup}
                onChange={(e) => setForm((f) => ({ ...f, usa_pickup: e.target.checked }))}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <label htmlFor="usa_pickup" className="text-sm font-medium text-gray-700">Usa pickup</label>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="tiene_sucursales"
                checked={form.tiene_sucursales}
                onChange={(e) => {
                  const checked = e.target.checked
                  setForm((f) => ({
                    ...f,
                    tiene_sucursales: checked,
                    sucursales: checked ? (f.sucursales.length ? f.sucursales : [{ nombre: '', tarifa_retiro: 0, tarifa_retiro_driver: 0 }]) : f.sucursales,
                  }))
                }}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <label htmlFor="tiene_sucursales" className="text-sm font-medium text-gray-700">Tiene sucursales</label>
            </div>
          </div>
          {form.tiene_sucursales && (
            <div className="bg-teal-50/50 p-3 rounded-lg border border-teal-200 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-teal-800">Sucursales</p>
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, sucursales: [...f.sucursales, { nombre: '', tarifa_retiro: 0, tarifa_retiro_driver: 0 }] }))}
                  className="text-xs text-teal-700 hover:text-teal-900 flex items-center gap-1"
                >
                  <Plus size={14} /> Agregar
                </button>
              </div>
              {form.sucursales.map((suc, idx) => (
                <div key={suc.id || `new-${idx}`} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-end">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-0.5">Nombre</label>
                    <input
                      type="text"
                      className="input-field text-sm"
                      placeholder="Nombre sucursal"
                      value={suc.nombre}
                      onChange={(e) => {
                        const updated = [...form.sucursales]
                        updated[idx] = { ...updated[idx], nombre: e.target.value }
                        setForm((f) => ({ ...f, sucursales: updated }))
                      }}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-0.5">Cobro retiro</label>
                    <input
                      type="number"
                      className="input-field text-sm w-28"
                      min={0}
                      value={suc.tarifa_retiro}
                      onChange={(e) => {
                        const updated = [...form.sucursales]
                        updated[idx] = { ...updated[idx], tarifa_retiro: e.target.value }
                        setForm((f) => ({ ...f, sucursales: updated }))
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-0.5">Pago driver</label>
                    <input
                      type="number"
                      className="input-field text-sm w-28"
                      min={0}
                      value={suc.tarifa_retiro_driver}
                      onChange={(e) => {
                        const updated = [...form.sucursales]
                        updated[idx] = { ...updated[idx], tarifa_retiro_driver: e.target.value }
                        setForm((f) => ({ ...f, sucursales: updated }))
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, sucursales: f.sucursales.filter((_, i) => i !== idx) }))}
                    className="p-1.5 rounded text-red-500 hover:bg-red-50 mb-0.5"
                    title="Eliminar sucursal"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              {form.sucursales.length === 0 && (
                <p className="text-xs text-gray-500">Sin sucursales. Presiona "Agregar" para crear una.</p>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1.5">
                <Mail size={14} className="text-blue-500" />
                Email <span className="text-xs font-normal text-gray-400">(opcional)</span>
              </label>
              <input
                type="email"
                className="input-field"
                placeholder="Para acceso al portal seller"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
              <p className="text-xs text-gray-500 mt-1">Acceso al portal del seller</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {editing ? 'Contraseña (opcional, dejar vacío para no cambiar)' : 'Contraseña (opcional)'}
              </label>
              <input
                type="password"
                className="input-field"
                placeholder={editing ? '••••••••' : ''}
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              />
            </div>
          </div>
          {editing && (
            <div className="border-t border-gray-200 pt-4 mt-4">
              <p className="text-sm font-medium text-gray-700 mb-2">Facturas emitidas</p>
              {sellerFacturasLoading ? (
                <p className="text-xs text-gray-500">Cargando...</p>
              ) : sellerFacturas.length === 0 ? (
                <p className="text-xs text-gray-500">Sin facturas emitidas</p>
              ) : (
                <div className="max-h-40 overflow-y-auto rounded border border-gray-200">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-medium text-gray-600">Mes / Año</th>
                        <th className="px-2 py-1.5 text-right font-medium text-gray-600">Total</th>
                        <th className="px-2 py-1.5 text-center font-medium text-gray-600">Folio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sellerFacturas.map((f) => (
                        <tr key={`${f.mes}-${f.anio}`} className="border-t border-gray-100">
                          <td className="px-2 py-1.5 text-gray-700">{new Date(f.anio, f.mes - 1).toLocaleString('es-CL', { month: 'short', year: 'numeric' })}</td>
                          <td className="px-2 py-1.5 text-right font-mono">{fmtClp(f.total)}</td>
                          <td className="px-2 py-1.5 text-center text-gray-600">{f.folio_haulmer || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
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

      <Modal open={deleteModalOpen} onClose={() => { setDeleteModalOpen(false); setToDelete(null) }} title="Desactivar Seller">
        {toDelete && (
          <div>
            <p className="text-gray-600 mb-4">
              ¿Desactivar al seller <strong>{toDelete.nombre}</strong>? Esta acción es reversible.
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
