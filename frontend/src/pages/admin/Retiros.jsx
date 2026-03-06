import { useState, useEffect } from 'react'
import api from '../../api'
import DataTable from '../../components/DataTable'
import Modal from '../../components/Modal'
import PeriodSelector from '../../components/PeriodSelector'
import toast from 'react-hot-toast'
import { Plus, Trash2, Download, Upload } from 'lucide-react'

const fmt = (n) => `$${(n || 0).toLocaleString('es-CL')}`

export default function Retiros() {
  const [retiros, setRetiros] = useState([])
  const [sellers, setSellers] = useState([])
  const [drivers, setDrivers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [deleteModal, setDeleteModal] = useState(false)
  const [toDelete, setToDelete] = useState(null)
  const [importing, setImporting] = useState(false)
  const [now] = useState(() => new Date())
  const [period, setPeriod] = useState(() => {
    const d = new Date()
    return { semana: 1, mes: d.getMonth() + 1, anio: d.getFullYear() }
  })
  const [form, setForm] = useState({ fecha: '', seller_id: '', driver_id: '', tarifa_seller: 0, tarifa_driver: 0 })

  useEffect(() => {
    api.get('/sellers').then(({ data }) => setSellers(data)).catch(() => toast.error('Error al cargar sellers'))
    api.get('/drivers').then(({ data }) => setDrivers(data)).catch(() => toast.error('Error al cargar drivers'))
  }, [])

  useEffect(() => { load() }, [period])

  const load = () => {
    setLoading(true)
    api.get('/retiros', { params: period })
      .then(({ data }) => setRetiros(data))
      .catch(() => toast.error('Error al cargar retiros'))
      .finally(() => setLoading(false))
  }

  const handleDownloadPlantilla = async () => {
    try {
      const { data } = await api.get('/retiros/plantilla/descargar', { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([data]))
      const a = document.createElement('a')
      a.href = url
      a.download = 'plantilla_retiros.xlsx'
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
      const { data } = await api.post('/retiros/importar', formData)
      let msg = `${data.creados} retiros creados`
      if (data.ignorados_pickup) msg += `, ${data.ignorados_pickup} ignorados (pickup)`
      toast.success(msg)
      if (data.sin_homologar?.length) toast.error(`${data.sin_homologar.length} nombres sin homologar`)
      if (data.errores?.length) toast.error(`${data.errores.length} errores`)
      load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Error al importar') }
    finally { setImporting(false); e.target.value = '' }
  }

  const handleSellerChange = (sellerId) => {
    const seller = sellers.find(s => s.id === Number(sellerId))
    setForm(f => ({
      ...f,
      seller_id: sellerId,
      tarifa_seller: seller?.tarifa_retiro || 0,
      tarifa_driver: seller?.tarifa_retiro_driver || 0,
    }))
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    try {
      await api.post('/retiros', {
        ...form,
        seller_id: Number(form.seller_id),
        driver_id: Number(form.driver_id),
        tarifa_seller: Number(form.tarifa_seller),
        tarifa_driver: Number(form.tarifa_driver),
        semana: period.semana,
        mes: period.mes,
        anio: period.anio,
      })
      toast.success('Retiro creado')
      setShowModal(false)
      setForm({ fecha: '', seller_id: '', driver_id: '', tarifa_seller: 0, tarifa_driver: 0 })
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error')
    }
  }

  const confirmDelete = () => {
    if (!toDelete) return
    api.delete(`/retiros/${toDelete.id}`)
      .then(() => { toast.success('Retiro eliminado'); load(); setDeleteModal(false); setToDelete(null) })
      .catch(() => toast.error('Error al eliminar'))
  }

  const columns = [
    { key: 'fecha', label: 'Fecha' },
    { key: 'seller_nombre', label: 'Seller' },
    { key: 'driver_nombre', label: 'Driver' },
    { key: 'tarifa_seller', label: 'Cobro Seller', align: 'right', render: (v) => fmt(v) },
    { key: 'tarifa_driver', label: 'Pago Driver', align: 'right', render: (v) => fmt(v) },
    { key: 'actions', label: '', render: (_, row) => (
      <button onClick={() => { setToDelete(row); setDeleteModal(true) }} className="p-1.5 hover:bg-red-50 rounded-lg">
        <Trash2 size={16} className="text-red-500" />
      </button>
    )},
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Retiros</h1>
          <p className="text-sm text-gray-500 mt-1">Gestión de retiros por seller/driver</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleDownloadPlantilla} className="btn-secondary flex items-center gap-2 text-sm">
            <Download size={16} /> Plantilla
          </button>
          <label className={`btn-secondary flex items-center gap-2 text-sm cursor-pointer ${importing ? 'opacity-50' : ''}`}>
            <Upload size={16} /> {importing ? 'Importando...' : 'Importar Excel'}
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} disabled={importing} />
          </label>
          <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2">
            <Plus size={16} /> Nuevo Retiro
          </button>
        </div>
      </div>

      <div className="card mb-6">
        <PeriodSelector {...period} onChange={setPeriod} />
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Cargando...</div>
      ) : (
        <DataTable columns={columns} data={retiros} emptyMessage="No hay retiros en este período" />
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Nuevo Retiro">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fecha</label>
            <input type="date" value={form.fecha} onChange={(e) => setForm(f => ({ ...f, fecha: e.target.value }))} className="input-field" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Seller</label>
            <select value={form.seller_id} onChange={(e) => handleSellerChange(e.target.value)} className="input-field" required>
              <option value="">Seleccionar...</option>
              {sellers.filter(s => !s.usa_pickup).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Driver</label>
            <select value={form.driver_id} onChange={(e) => setForm(f => ({ ...f, driver_id: e.target.value }))} className="input-field" required>
              <option value="">Seleccionar...</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cobro al Seller (CLP)</label>
              <input type="number" value={form.tarifa_seller} onChange={(e) => setForm(f => ({ ...f, tarifa_seller: e.target.value }))} className="input-field" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Pago al Driver (CLP)</label>
              <input type="number" value={form.tarifa_driver} onChange={(e) => setForm(f => ({ ...f, tarifa_driver: e.target.value }))} className="input-field" required />
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancelar</button>
            <button type="submit" className="btn-primary">Crear</button>
          </div>
        </form>
      </Modal>

      <Modal open={deleteModal} onClose={() => { setDeleteModal(false); setToDelete(null) }} title="Eliminar Retiro">
        {toDelete && (
          <div>
            <p className="text-gray-600 mb-4">
              ¿Eliminar el retiro de <strong>{toDelete.seller_nombre}</strong> por <strong>{toDelete.driver_nombre}</strong>?
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => { setDeleteModal(false); setToDelete(null) }} className="btn-secondary">Cancelar</button>
              <button onClick={confirmDelete} className="btn-danger">Eliminar</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
