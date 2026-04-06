import { useState, useEffect, useRef, useMemo } from 'react'
import api from '../../api'
import DataTable from '../../components/DataTable'
import Modal from '../../components/Modal'
import PeriodSelector from '../../components/PeriodSelector'
import toast from 'react-hot-toast'
import { Plus, Trash2, Download, Upload, Check, AlertCircle, X, FileText, Edit2, Lock } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'

const fmt = (n) => `$${(n || 0).toLocaleString('es-CL')}`

function ModalImportRetiros({ onClose, onConfirmado }) {
  const [archivo, setArchivo] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [preview, setPreview] = useState(null)
  const [items, setItems] = useState([])
  const [todosDrivers, setTodosDrivers] = useState([])
  const [todosSellers, setTodosSellers] = useState([])
  const [todosPickups, setTodosPickups] = useState([])
  const [todosSucursales, setTodosSucursales] = useState([])
  const inputRef = useRef()

  const analizar = async () => {
    if (!archivo) return toast.error('Selecciona un archivo')
    setCargando(true)
    try {
      const form = new FormData()
      form.append('file', archivo)
      const { data } = await api.post('/retiros/importar/preview', form)
      setPreview(data)
      setTodosDrivers(data.drivers || [])
      setTodosSellers(data.sellers || [])
      setTodosPickups(data.pickups || [])
      setTodosSucursales(data.sucursales || [])
      setItems(data.items.map(it => ({
        ...it,
        incluir: (it.driver_id != null) && (it.seller_id != null || it.pickup_id != null || it.sucursal_id != null),
        driver_id_sel: it.driver_id,
        driver_nombre_sel: it.driver_nombre,
        seller_id_sel: it.seller_id,
        seller_nombre_sel: it.seller_nombre,
        pickup_id_sel: it.pickup_id,
        pickup_nombre_sel: it.pickup_nombre,
        sucursal_id_sel: it.sucursal_id,
        sucursal_nombre_sel: it.sucursal_nombre,
      })))
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Error procesando archivo')
    } finally { setCargando(false) }
  }

  const toggleItem = (idx) =>
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, incluir: !it.incluir } : it))

  const cambiarDriver = (idx, driverId) => {
    const d = todosDrivers.find(x => x.id === Number(driverId))
    setItems(prev => prev.map((it, i) => i === idx ? {
      ...it,
      driver_id_sel: d ? d.id : null,
      driver_nombre_sel: d ? d.nombre : null,
      incluir: d != null && (it.seller_id_sel != null || it.pickup_id_sel != null || it.sucursal_id_sel != null),
    } : it))
  }

  const cambiarSeller = (idx, sellerId) => {
    const s = todosSellers.find(x => x.id === Number(sellerId))
    setItems(prev => prev.map((it, i) => i === idx ? {
      ...it,
      tipo: 'seller',
      seller_id_sel: s ? s.id : null,
      seller_nombre_sel: s ? s.nombre : null,
      pickup_id_sel: null,
      pickup_nombre_sel: null,
      sucursal_id_sel: null,
      sucursal_nombre_sel: null,
      incluir: s != null && it.driver_id_sel != null,
    } : it))
  }

  const cambiarPickup = (idx, pickupId) => {
    const p = todosPickups.find(x => x.id === Number(pickupId))
    setItems(prev => prev.map((it, i) => i === idx ? {
      ...it,
      tipo: 'pickup',
      pickup_id_sel: p ? p.id : null,
      pickup_nombre_sel: p ? p.nombre : null,
      seller_id_sel: null,
      seller_nombre_sel: null,
      sucursal_id_sel: null,
      sucursal_nombre_sel: null,
      incluir: p != null && it.driver_id_sel != null,
    } : it))
  }

  const cambiarSucursal = (idx, sucursalId) => {
    const suc = todosSucursales.find(x => x.id === Number(sucursalId))
    setItems(prev => prev.map((it, i) => i === idx ? {
      ...it,
      tipo: 'sucursal',
      sucursal_id_sel: suc ? suc.id : null,
      sucursal_nombre_sel: suc ? suc.nombre : null,
      seller_id_sel: suc ? suc.seller_id : null,
      seller_nombre_sel: null,
      pickup_id_sel: null,
      pickup_nombre_sel: null,
      incluir: suc != null && it.driver_id_sel != null,
    } : it))
  }

  const confirmar = async () => {
    const seleccionados = items.filter(it => it.incluir && it.driver_id_sel && (it.seller_id_sel || it.pickup_id_sel || it.sucursal_id_sel))
    if (!seleccionados.length) return toast.error('No hay items válidos para confirmar')
    setConfirmando(true)
    try {
      const { data } = await api.post('/retiros/importar/confirmar', {
        archivo: preview?.archivo,
        items: seleccionados.map(it => ({
          fila: it.fila,
          fecha: it.fecha,
          conductor_raw: it.conductor_raw,
          seller_raw: it.seller_raw,
          tipo: it.tipo,
          driver_id: it.driver_id_sel,
          seller_id: it.seller_id_sel,
          pickup_id: it.pickup_id_sel,
          sucursal_id: it.sucursal_id_sel,
        })),
      })
      const parts = []
      if (data.creados) parts.push(`${data.creados} sellers`)
      if (data.creados_pickup) parts.push(`${data.creados_pickup} pickups`)
      if (data.creados_sucursal) parts.push(`${data.creados_sucursal} sucursales`)
      toast.success(`${parts.join(' + ')} creados. Aliases guardados.`)
      onConfirmado()
      onClose()
    } catch { toast.error('Error confirmando retiros') }
    finally { setConfirmando(false) }
  }

  const totalValidos = items.filter(it => it.incluir && it.driver_id_sel && (it.seller_id_sel || it.pickup_id_sel || it.sucursal_id_sel)).length
  const sinMatch = items.filter(it => !it.driver_id_sel || (!it.seller_id_sel && !it.pickup_id_sel && !it.sucursal_id_sel)).length

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Importar Retiros</h2>
            <p className="text-sm text-gray-500">Sube un Excel, revisa la homologación y confirma</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
        </div>

        <div className="px-6 py-4 border-b border-gray-100 flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Archivo Excel (.xlsx / .xls)</label>
            <input ref={inputRef} type="file" accept=".xls,.xlsx" className="hidden"
              onChange={e => setArchivo(e.target.files[0])} />
            <button onClick={() => inputRef.current.click()} className="btn btn-secondary flex items-center gap-2 text-sm">
              <Upload size={14} /> {archivo ? archivo.name : 'Seleccionar archivo'}
            </button>
          </div>
          <button onClick={analizar} disabled={cargando || !archivo}
            className="btn btn-primary text-sm flex items-center gap-2">
            {cargando ? 'Procesando...' : <><FileText size={14} /> Analizar</>}
          </button>
        </div>

        {preview && (
          <>
            {preview.errores?.length > 0 && (
              <div className="mx-6 mt-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                {preview.errores.length} errores de lectura: {preview.errores.slice(0, 3).join(', ')}
                {preview.errores.length > 3 && '...'}
              </div>
            )}

            <div className="px-6 py-2 flex items-center gap-4 text-xs text-gray-500">
              <span className="inline-flex items-center gap-1 text-green-700"><Check size={12} /> Match (≥55%)</span>
              <span className="inline-flex items-center gap-1 text-amber-600"><AlertCircle size={12} /> Incierto — verifica</span>
              <span className="text-gray-400">· Al confirmar se guardan los aliases automáticamente</span>
            </div>

            {sinMatch > 0 && (
              <div className="mx-6 mb-1 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
                {sinMatch} filas sin match completo — asígnalas manualmente o desactívalas
              </div>
            )}

            <div className="flex-1 overflow-auto px-6 py-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-200">
                    <th className="py-2 w-8"></th>
                    <th className="py-2 text-left font-medium">Fecha</th>
                    <th className="py-2 text-left font-medium">Conductor (Excel)</th>
                    <th className="py-2 text-left font-medium">Driver asignado</th>
                    <th className="py-2 text-left font-medium">Seller/Pickup (Excel)</th>
                    <th className="py-2 text-left font-medium">Punto asignado</th>
                    <th className="py-2 text-center font-medium">Tipo</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => {
                    const driverOk = it.driver_id_sel != null
                    const puntoOk = it.seller_id_sel != null || it.pickup_id_sel != null || it.sucursal_id_sel != null
                    return (
                      <tr key={idx} className={`border-b border-gray-100 text-xs ${!it.incluir ? 'opacity-40' : ''}`}>
                        <td className="py-1.5">
                          <input type="checkbox" checked={it.incluir} onChange={() => toggleItem(idx)}
                            className="w-3.5 h-3.5 accent-primary-600" />
                        </td>
                        <td className="py-1.5 text-gray-600 whitespace-nowrap">{it.fecha}</td>
                        <td className="py-1.5">
                          <span className="font-medium text-gray-800">{it.conductor_raw}</span>
                          {it.driver_score > 0 && (
                            <span className="text-[10px] text-gray-400 ml-1">({Math.round(it.driver_score * 100)}%)</span>
                          )}
                        </td>
                        <td className="py-1.5 min-w-[180px]">
                          <div className="flex items-center gap-1.5">
                            {driverOk
                              ? (it.driver_score >= 0.55
                                ? <Check size={11} className="text-green-600 flex-shrink-0" />
                                : <AlertCircle size={11} className="text-amber-500 flex-shrink-0" />)
                              : <AlertCircle size={11} className="text-red-400 flex-shrink-0" />
                            }
                            <select
                              className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white flex-1 min-w-0"
                              value={it.driver_id_sel ?? ''}
                              onChange={e => cambiarDriver(idx, e.target.value)}
                            >
                              <option value="">— Sin asignar —</option>
                              {todosDrivers.map(d => <option key={d.id} value={d.id}>{d.nombre}</option>)}
                            </select>
                          </div>
                        </td>
                        <td className="py-1.5">
                          <span className="font-medium text-gray-800">{it.seller_raw}</span>
                        </td>
                        <td className="py-1.5 min-w-[180px]">
                          <div className="flex items-center gap-1.5">
                            {puntoOk
                              ? ((it.seller_score >= 0.55 || it.pickup_score >= 0.55 || it.sucursal_score >= 0.55)
                                ? <Check size={11} className="text-green-600 flex-shrink-0" />
                                : <AlertCircle size={11} className="text-amber-500 flex-shrink-0" />)
                              : <AlertCircle size={11} className="text-red-400 flex-shrink-0" />
                            }
                            <select
                              className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white flex-1 min-w-0"
                              value={
                                it.pickup_id_sel ? `p-${it.pickup_id_sel}`
                                : it.sucursal_id_sel ? `u-${it.sucursal_id_sel}`
                                : it.seller_id_sel ? `s-${it.seller_id_sel}`
                                : ''
                              }
                              onChange={e => {
                                const val = e.target.value
                                if (val.startsWith('p-')) cambiarPickup(idx, val.slice(2))
                                else if (val.startsWith('u-')) cambiarSucursal(idx, val.slice(2))
                                else if (val.startsWith('s-')) cambiarSeller(idx, val.slice(2))
                                else {
                                  setItems(prev => prev.map((x, i) => i === idx ? {
                                    ...x, seller_id_sel: null, seller_nombre_sel: null,
                                    pickup_id_sel: null, pickup_nombre_sel: null,
                                    sucursal_id_sel: null, sucursal_nombre_sel: null, incluir: false,
                                  } : x))
                                }
                              }}
                            >
                              <option value="">— Sin asignar —</option>
                              {todosPickups.length > 0 && (
                                <optgroup label="Pickups">
                                  {todosPickups.map(p => <option key={`p-${p.id}`} value={`p-${p.id}`}>{p.nombre}</option>)}
                                </optgroup>
                              )}
                              {todosSucursales.length > 0 && (
                                <optgroup label="Sucursales">
                                  {todosSucursales.map(su => (
                                    <option key={`u-${su.id}`} value={`u-${su.id}`}>{su.nombre} ({su.seller_nombre})</option>
                                  ))}
                                </optgroup>
                              )}
                              <optgroup label="Sellers">
                                {todosSellers.map(s => <option key={`s-${s.id}`} value={`s-${s.id}`}>{s.nombre}</option>)}
                              </optgroup>
                            </select>
                          </div>
                        </td>
                        <td className="py-1.5 text-center">
                          <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            it.pickup_id_sel ? 'bg-purple-100 text-purple-700'
                            : it.sucursal_id_sel ? 'bg-teal-100 text-teal-700'
                            : 'bg-blue-100 text-blue-700'
                          }`}>
                            {it.pickup_id_sel ? 'Pickup' : it.sucursal_id_sel ? 'Sucursal' : 'Seller'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
              <span className="text-sm text-gray-600">
                {totalValidos} retiros listos
                {sinMatch > 0 && <span className="text-amber-600 ml-2">· {sinMatch} sin asignar</span>}
                <span className="text-xs text-gray-400 ml-2">· Aliases se guardan al confirmar</span>
              </span>
              <div className="flex gap-3">
                <button onClick={onClose} className="btn btn-secondary">Cancelar</button>
                <button onClick={confirmar} disabled={confirmando || totalValidos === 0}
                  className="btn btn-primary flex items-center gap-2">
                  <Check size={16} /> {confirmando ? 'Guardando...' : `Confirmar ${totalValidos} retiros`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function Retiros() {
  const { puedeEditar } = useAuth()
  const canEdit = puedeEditar('retiros')

  const [retiros, setRetiros] = useState([])
  const [sellers, setSellers] = useState([])
  const [drivers, setDrivers] = useState([])
  const [pickups, setPickups] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [deleteModal, setDeleteModal] = useState(false)
  const [toDelete, setToDelete] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [editing, setEditing] = useState(null)
  const [editForm, setEditForm] = useState({ fecha: '', seller_id: '', pickup_id: '', driver_id: '', tarifa_seller: 0, tarifa_driver: 0 })
  const [semanasCerradas, setSemanasCerradas] = useState({ drivers: {}, sellers: {}, pickups: {} })
  const [period, setPeriod] = useState(() => {
    const d = new Date()
    return { semana: 1, mes: d.getMonth() + 1, anio: d.getFullYear() }
  })
  const [form, setForm] = useState({ fecha: '', seller_id: '', pickup_id: '', driver_id: '', tarifa_seller: 0, tarifa_driver: 0 })

  useEffect(() => {
    api.get('/sellers', { params: { activo: true } }).then(({ data }) => setSellers(data)).catch(() => toast.error('Error al cargar sellers'))
    api.get('/drivers').then(({ data }) => setDrivers(data)).catch(() => toast.error('Error al cargar drivers'))
    api.get('/pickups').then(({ data }) => setPickups(data)).catch(() => {})
  }, [])

  const sellersEnPeriodo = useMemo(() => {
    const ids = new Set(retiros.map(r => r.seller_id).filter(Boolean))
    return sellers.filter(s => ids.has(s.id))
  }, [retiros, sellers])

  const driversEnPeriodo = useMemo(() => {
    const ids = new Set(retiros.map(r => r.driver_id).filter(Boolean))
    return drivers.filter(d => ids.has(d.id))
  }, [retiros, drivers])

  const resumen = useMemo(() => ({
    cantidad: retiros.length,
    ingreso: retiros.reduce((acc, r) => acc + (r.tarifa_seller || 0), 0),
    costo: retiros.reduce((acc, r) => acc + (r.tarifa_driver || 0), 0),
    drivers: new Set(retiros.map(r => r.driver_id).filter(Boolean)).size,
  }), [retiros])

  useEffect(() => { load() }, [period])

  const load = () => {
    setLoading(true)
    setSelectedIds(new Set())
    Promise.all([
      api.get('/retiros', { params: period }),
      api.get('/retiros/semanas-cerradas', { params: { mes: period.mes, anio: period.anio } }),
    ])
      .then(([retirosRes, cerradasRes]) => {
        setRetiros(retirosRes.data)
        setSemanasCerradas(cerradasRes.data)
      })
      .catch(() => toast.error('Error al cargar retiros'))
      .finally(() => setLoading(false))
  }

  const esRetiroCerrado = (row) => {
    const sem = row.semana
    if (row.driver_id && semanasCerradas.drivers[String(row.driver_id)]?.includes(sem)) return true
    if (row.seller_id && semanasCerradas.sellers[String(row.seller_id)]?.includes(sem)) return true
    if (row.pickup_id && semanasCerradas.pickups[String(row.pickup_id)]?.includes(sem)) return true
    return false
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

  const handleOrigenChange = (val, target = 'form') => {
    let update = { seller_id: '', pickup_id: '', tarifa_seller: 0, tarifa_driver: 0 }
    if (val.startsWith('p-')) {
      const pickup = pickups.find(p => p.id === Number(val.slice(2)))
      if (pickup) update = { seller_id: '', pickup_id: pickup.id, tarifa_seller: 0, tarifa_driver: 0 }
    } else if (val) {
      const seller = sellers.find(s => s.id === Number(val))
      if (seller) update = { seller_id: seller.id, pickup_id: '', tarifa_seller: seller.tarifa_retiro || 0, tarifa_driver: seller.tarifa_retiro_driver || 0 }
    }
    if (target === 'edit') setEditForm(f => ({ ...f, ...update }))
    else setForm(f => ({ ...f, ...update }))
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    const payload = {
      fecha: form.fecha,
      driver_id: Number(form.driver_id),
      tarifa_seller: Number(form.tarifa_seller),
      tarifa_driver: Number(form.tarifa_driver),
    }
    if (form.pickup_id) payload.pickup_id = Number(form.pickup_id)
    else if (form.seller_id) payload.seller_id = Number(form.seller_id)
    try {
      await api.post('/retiros', payload)
      toast.success('Retiro creado')
      setShowModal(false)
      setForm({ fecha: '', seller_id: '', pickup_id: '', driver_id: '', tarifa_seller: 0, tarifa_driver: 0 })
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

  // --- Batch selection ---
  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    const editables = retiros.filter(r => !esRetiroCerrado(r)).map(r => r.id)
    if (selectedIds.size === editables.length && editables.length > 0) setSelectedIds(new Set())
    else setSelectedIds(new Set(editables))
  }

  const handleBatchDelete = async () => {
    if (!selectedIds.size) return
    if (!window.confirm(`¿Eliminar ${selectedIds.size} retiros seleccionados?`)) return
    setBatchDeleting(true)
    try {
      await api.delete('/retiros/batch', { data: [...selectedIds] })
      toast.success(`${selectedIds.size} retiros eliminados`)
      load()
    } catch { toast.error('Error al eliminar retiros') }
    finally { setBatchDeleting(false) }
  }

  // --- Edit ---
  const openEdit = (row) => {
    setEditing(row)
    setEditForm({
      fecha: row.fecha || '',
      seller_id: row.seller_id || '',
      driver_id: row.driver_id || '',
      tarifa_seller: row.tarifa_seller || 0,
      tarifa_driver: row.tarifa_driver || 0,
    })
  }

  const handleEdit = async (e) => {
    e.preventDefault()
    try {
      await api.put(`/retiros/${editing.id}`, {
        fecha: editForm.fecha || undefined,
        seller_id: editForm.seller_id ? Number(editForm.seller_id) : undefined,
        driver_id: editForm.driver_id ? Number(editForm.driver_id) : undefined,
        tarifa_seller: Number(editForm.tarifa_seller),
        tarifa_driver: Number(editForm.tarifa_driver),
      })
      toast.success('Retiro actualizado')
      setEditing(null)
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al actualizar')
    }
  }

  const columns = [
    ...(canEdit ? [{
      key: 'select',
      label: (
        <input
          type="checkbox"
          checked={retiros.filter(r => !esRetiroCerrado(r)).length > 0 && selectedIds.size === retiros.filter(r => !esRetiroCerrado(r)).length}
          ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < retiros.filter(r => !esRetiroCerrado(r)).length }}
          onChange={toggleSelectAll}
          className="w-4 h-4 rounded text-primary-600 cursor-pointer"
        />
      ),
      render: (_, row) => esRetiroCerrado(row) ? (
        <Lock size={13} className="text-gray-400 mx-auto" title="Semana cerrada" />
      ) : (
        <input
          type="checkbox"
          checked={selectedIds.has(row.id)}
          onChange={() => toggleSelect(row.id)}
          className="w-4 h-4 rounded text-primary-600 cursor-pointer"
        />
      ),
    }] : []),
    { key: 'fecha', label: 'Fecha' },
    { key: 'seller_nombre', label: 'Seller/Pickup' },
    { key: 'driver_nombre', label: 'Driver' },
    { key: 'tarifa_seller', label: 'Cobro Seller', align: 'right', render: (v) => fmt(v) },
    { key: 'tarifa_driver', label: 'Pago Driver', align: 'right', render: (v) => fmt(v) },
    { key: 'homologado', label: 'Estado', align: 'center', render: (v, row) => (
      esRetiroCerrado(row) ? (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500">
          <Lock size={10} /> Cerrado
        </span>
      ) : (
        <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${
          v ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
        }`}>
          {v ? 'OK' : 'Sin homologar'}
        </span>
      )
    )},
    ...(canEdit ? [{ key: 'actions', label: '', render: (_, row) => esRetiroCerrado(row) ? (
      <span className="text-[10px] text-gray-400 flex items-center gap-1 px-1.5">
        <Lock size={11} /> Bloqueado
      </span>
    ) : (
      <div className="flex items-center gap-1">
        <button onClick={() => openEdit(row)} className="p-1.5 hover:bg-blue-50 rounded-lg" title="Editar">
          <Edit2 size={15} className="text-blue-500" />
        </button>
        <button onClick={() => { setToDelete(row); setDeleteModal(true) }} className="p-1.5 hover:bg-red-50 rounded-lg" title="Eliminar">
          <Trash2 size={15} className="text-red-500" />
        </button>
      </div>
    )}] : []),
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Retiros</h1>
          <p className="text-sm text-gray-500 mt-1">Gestión de retiros por seller/driver</p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button onClick={handleDownloadPlantilla} className="btn-secondary flex items-center gap-2 text-sm">
              <Download size={16} /> Plantilla
            </button>
            <button onClick={() => setShowImport(true)} className="btn-secondary flex items-center gap-2 text-sm">
              <Upload size={16} /> Importar Excel
            </button>
            <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2">
              <Plus size={16} /> Nuevo Retiro
            </button>
          </div>
        )}
      </div>

      <div className="card mb-6">
        <PeriodSelector {...period} onChange={setPeriod} />
      </div>

      {/* Tarjetas resumen */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="card p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Cantidad de retiros</p>
          <p className="text-2xl font-bold text-gray-900">{resumen.cantidad}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Conductores con retiro</p>
          <p className="text-2xl font-bold text-gray-900">{resumen.drivers}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Ingreso por retiros</p>
          <p className="text-2xl font-bold text-green-600">{fmt(resumen.ingreso)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Costo de retiros</p>
          <p className="text-2xl font-bold text-red-600">{fmt(resumen.costo)}</p>
        </div>
      </div>

      {/* Barra de acciones batch */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-4 mb-4 px-4 py-3 bg-primary-50 border border-primary-200 rounded-lg">
          <span className="text-sm font-medium text-primary-800">
            {selectedIds.size} {selectedIds.size === 1 ? 'retiro seleccionado' : 'retiros seleccionados'}
          </span>
          <button
            onClick={handleBatchDelete}
            disabled={batchDeleting}
            className="flex items-center gap-1.5 text-sm text-red-600 hover:text-red-800 font-medium"
          >
            <Trash2 size={14} /> {batchDeleting ? 'Eliminando...' : 'Eliminar seleccionados'}
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-sm text-gray-500 hover:text-gray-700 ml-auto"
          >
            Deseleccionar
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-400">Cargando...</div>
      ) : (
        <DataTable columns={columns} data={retiros} emptyMessage="No hay retiros en este período" />
      )}

      {showImport && (
        <ModalImportRetiros
          onClose={() => setShowImport(false)}
          onConfirmado={() => load()}
        />
      )}

      {/* Modal crear retiro */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="Nuevo Retiro">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fecha</label>
            <input type="date" value={form.fecha} onChange={(e) => setForm(f => ({ ...f, fecha: e.target.value }))} className="input-field" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Origen (Seller / Pickup)</label>
            <select
              value={form.pickup_id ? `p-${form.pickup_id}` : form.seller_id || ''}
              onChange={(e) => handleOrigenChange(e.target.value)}
              className="input-field" required
            >
              <option value="">Seleccionar...</option>
              {pickups.length > 0 && (
                <optgroup label="Pickups">
                  {pickups.map(p => <option key={`p-${p.id}`} value={`p-${p.id}`}>{p.nombre}</option>)}
                </optgroup>
              )}
              <optgroup label="Sellers">
                {sellers.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </optgroup>
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

      {/* Modal editar retiro */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Editar Retiro">
        {editing && (
          <form onSubmit={handleEdit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fecha</label>
              <input type="date" value={editForm.fecha} onChange={(e) => setEditForm(f => ({ ...f, fecha: e.target.value }))} className="input-field" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Origen (Seller / Pickup)</label>
              <select
                value={editForm.pickup_id ? `p-${editForm.pickup_id}` : editForm.seller_id || ''}
                onChange={(e) => handleOrigenChange(e.target.value, 'edit')}
                className="input-field" required
              >
                <option value="">Seleccionar...</option>
                {pickups.length > 0 && (
                  <optgroup label="Pickups">
                    {pickups.map(p => <option key={`p-${p.id}`} value={`p-${p.id}`}>{p.nombre}</option>)}
                  </optgroup>
                )}
                <optgroup label="Sellers">
                  {sellers.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </optgroup>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Driver</label>
              <select value={editForm.driver_id} onChange={(e) => setEditForm(f => ({ ...f, driver_id: e.target.value }))} className="input-field" required>
                <option value="">Seleccionar...</option>
                {driversEnPeriodo.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cobro al Seller (CLP)</label>
                <input type="number" value={editForm.tarifa_seller} onChange={(e) => setEditForm(f => ({ ...f, tarifa_seller: e.target.value }))} className="input-field" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Pago al Driver (CLP)</label>
                <input type="number" value={editForm.tarifa_driver} onChange={(e) => setEditForm(f => ({ ...f, tarifa_driver: e.target.value }))} className="input-field" required />
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setEditing(null)} className="btn-secondary">Cancelar</button>
              <button type="submit" className="btn-primary">Guardar</button>
            </div>
          </form>
        )}
      </Modal>

      {/* Modal confirmar eliminar */}
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
