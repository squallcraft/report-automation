import React, { useState, useEffect, useMemo, useRef } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import { FileText, Check, DollarSign, Loader2, AlertTriangle, Upload, AlertCircle, X, RotateCcw } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import Modal from '../../components/Modal'

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const ESTADO_COLORS = {
  PENDIENTE: 'bg-amber-100 text-amber-800',
  PAGADO: 'bg-green-100 text-green-800',
  INCOMPLETO: 'bg-red-100 text-red-800',
}

function fmt(v) {
  if (!v) return '$0'
  return `$${Math.abs(v).toLocaleString('es-CL')}`
}

// ---------------------------------------------------------------------------
// Modal Revertir Pagos Seller
// ---------------------------------------------------------------------------

function ModalRevertirPagos({ seller, mes, anio, semanasConPago, onClose, onRevertido }) {
  const MESES_LABEL = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
  const [semanas, setSemanas] = useState(semanasConPago.map(s => s.semana))
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)

  const toggleSemana = (sem) => {
    setSemanas(prev => prev.includes(sem) ? prev.filter(s => s !== sem) : [...prev, sem])
  }

  const confirmar = async () => {
    if (!semanas.length) return toast.error('Selecciona al menos una semana')
    if (!motivo.trim()) return toast.error('El motivo es obligatorio')
    setGuardando(true)
    try {
      await api.post('/facturacion/revertir-pagos-seller', {
        seller_id: seller.seller_id,
        semanas,
        mes,
        anio,
        motivo: motivo.trim(),
      })
      toast.success(`Pagos revertidos para ${seller.seller_nombre}`)
      onRevertido()
      onClose()
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Error al revertir pagos')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <RotateCcw size={18} className="text-orange-500" />
            <h2 className="font-semibold text-gray-900">Revertir pagos</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="px-6 py-4 space-y-5">
          <div>
            <p className="text-sm text-gray-600">Seller: <span className="font-medium text-gray-900">{seller.seller_nombre}</span></p>
            <p className="text-xs text-gray-400">{MESES_LABEL[mes]} {anio}</p>
          </div>

          {/* Selección de semanas */}
          <div>
            <p className="text-xs font-medium text-gray-700 mb-2">Semanas a revertir</p>
            <div className="flex flex-wrap gap-2">
              {semanasConPago.map(({ semana, monto }) => (
                <label key={semana} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm transition-colors ${semanas.includes(semana) ? 'border-orange-400 bg-orange-50 text-orange-800' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  <input
                    type="checkbox"
                    checked={semanas.includes(semana)}
                    onChange={() => toggleSemana(semana)}
                    className="accent-orange-500"
                  />
                  <span>Sem {semana}</span>
                  <span className="font-mono text-xs">{fmt(monto)}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Motivo */}
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">
              Motivo <span className="text-red-500">*</span>
              <span className="text-gray-400 font-normal ml-1">(quedará registrado en auditoría)</span>
            </label>
            <textarea
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-400"
              rows={3}
              placeholder="Ej: Monto cargado a semana incorrecta, se debe dividir entre sem 1 y sem 2"
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
            />
          </div>

          {/* Aviso */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex gap-2 text-xs text-amber-800">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>Se eliminarán los registros de pago de las semanas seleccionadas y su estado volverá a <strong>Pendiente</strong>. Podrás volver a cargar la cartola correctamente.</span>
          </div>
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="btn btn-secondary">Cancelar</button>
          <button
            onClick={confirmar}
            disabled={guardando || !semanas.length || !motivo.trim()}
            className="btn btn-primary bg-orange-500 hover:bg-orange-600 border-orange-500 flex items-center gap-2"
          >
            {guardando ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            {guardando ? 'Revirtiendo...' : 'Confirmar reversión'}
          </button>
        </div>
      </div>
    </div>
  )
}


// ---------------------------------------------------------------------------
// Modal Cartola Sellers
// ---------------------------------------------------------------------------
const SEMANAS_LIST = [1, 2, 3, 4, 5]

function ModalCartolaSeller({ mes, anio, onClose, onConfirmado }) {
  const [semana, setSemana] = useState(1)
  const [archivo, setArchivo] = useState(null)
  const [preview, setPreview] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [items, setItems] = useState([])
  const [todosSellers, setTodosSellers] = useState([])
  const inputRef = useRef()

  const cargarPreview = async () => {
    if (!archivo) return toast.error('Selecciona un archivo')
    setCargando(true)
    try {
      const form = new FormData()
      form.append('archivo', archivo)
      const { data } = await api.post('/facturacion/cartola/preview', form, {
        params: { semana, mes, anio },
      })
      setPreview(data)
      setTodosSellers(data.sellers || [])
      setItems(data.items.map((it, i) => ({
        ...it,
        _key: `orig-${i}`,
        _origMonto: it.monto,
        incluir: it.seller_id != null && !it.ya_existe,
        seller_id_sel: it.seller_id,
        seller_nombre_sel: it.seller_nombre,
        semana_sel: semana,
      })))
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Error procesando cartola')
    } finally { setCargando(false) }
  }

  const toggleItem = (key) =>
    setItems(prev => prev.map(it => it._key === key ? { ...it, incluir: !it.incluir } : it))

  const cambiarSeller = (key, sellerId) => {
    const s = todosSellers.find(x => x.id === Number(sellerId))
    setItems(prev => prev.map(it => it._key === key ? {
      ...it,
      seller_id_sel: s ? s.id : null,
      seller_nombre_sel: s ? s.nombre : null,
      incluir: s != null,
    } : it))
  }

  const cambiarSemana = (key, val) =>
    setItems(prev => prev.map(it => it._key === key ? { ...it, semana_sel: Number(val) } : it))

  const cambiarMonto = (key, val) =>
    setItems(prev => prev.map(it => it._key === key ? { ...it, monto: Number(val) || 0 } : it))

  const splitRow = (key) => {
    setItems(prev => {
      const idx = prev.findIndex(it => it._key === key)
      if (idx === -1) return prev
      const orig = prev[idx]
      const half = Math.floor(orig.monto / 2)
      const rest = orig.monto - half
      const newItems = [...prev]
      newItems[idx] = { ...orig, monto: half }
      const splitItem = {
        ...orig,
        _key: `split-${Date.now()}-${Math.random()}`,
        monto: rest,
        seller_id_sel: null,
        seller_nombre_sel: null,
        incluir: false,
      }
      newItems.splice(idx + 1, 0, splitItem)
      return newItems
    })
  }

  const removeRow = (key) => {
    setItems(prev => {
      const item = prev.find(it => it._key === key)
      if (!item || !item._key.startsWith('split-')) return prev
      return prev.filter(it => it._key !== key)
    })
  }

  const confirmar = async () => {
    const seleccionados = items.filter(it => it.incluir && it.seller_id_sel)
    if (!seleccionados.length) return toast.error('No hay items válidos para confirmar')
    setConfirmando(true)
    try {
      const payload = seleccionados.map(it => ({
        seller_id: it.seller_id_sel,
        monto: it.monto,
        semana: it.semana_sel,
        fecha: it.fecha,
        descripcion: it.descripcion,
        nombre_extraido: it.nombre_extraido,
        fingerprint: it.fingerprint,
      }))
      // #region agent log
      fetch('http://127.0.0.1:7440/ingest/c19a5885-6f1f-48b3-88b9-27818b7778d7',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'adbcb9'},body:JSON.stringify({sessionId:'adbcb9',location:'Facturacion.jsx:confirmar',message:'CONFIRM_PAYLOAD',data:{count:payload.length,items:payload.map(i=>({seller_id:i.seller_id,monto:i.monto,semana:i.semana,fingerprint:i.fingerprint,_isSplit:String(seleccionados.find(s=>s.seller_id_sel===i.seller_id&&s.monto===i.monto)?._key||'').startsWith('split-')}))},timestamp:Date.now(),hypothesisId:'A-B-D'})}).catch(()=>{})
      // #endregion
      await api.post('/facturacion/cartola/confirmar', {
        semana, mes, anio,
        items: payload,
      })
      toast.success(`${seleccionados.length} pagos registrados`)
      onConfirmado()
      onClose()
    } catch { toast.error('Error confirmando pagos') }
    finally { setConfirmando(false) }
  }

  const totalConfirmar = items.filter(it => it.incluir && it.seller_id_sel).reduce((a, it) => a + it.monto, 0)

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Cargar Cartola — Pagos Sellers</h2>
            <p className="text-sm text-gray-500">{MESES[mes]} {anio} · Registra abonos recibidos de sellers</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
        </div>

        <div className="px-6 py-4 border-b border-gray-100 flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Semana por defecto</label>
            <select className="input-field text-sm w-32" value={semana} onChange={e => setSemana(Number(e.target.value))}>
              {SEMANAS_LIST.map(s => <option key={s} value={s}>Semana {s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Archivo cartola (.xls / .xlsx)</label>
            <input ref={inputRef} type="file" accept=".xls,.xlsx" className="hidden"
              onChange={e => setArchivo(e.target.files[0])} />
            <button onClick={() => inputRef.current.click()} className="btn btn-secondary flex items-center gap-2 text-sm">
              <Upload size={14} /> {archivo ? archivo.name : 'Seleccionar archivo'}
            </button>
          </div>
          <button onClick={cargarPreview} disabled={cargando || !archivo}
            className="btn btn-primary text-sm flex items-center gap-2">
            {cargando ? 'Procesando...' : <><FileText size={14} /> Analizar</>}
          </button>
        </div>

        {preview && (
          <>
            <div className="flex-1 overflow-auto px-6 py-2">
              <div className="mb-2 flex items-center gap-4 text-xs text-gray-500">
                <span className="inline-flex items-center gap-1 text-green-700"><Check size={12} /> Match confiable</span>
                <span className="inline-flex items-center gap-1 text-amber-600"><AlertCircle size={12} /> Match incierto</span>
                <span className="text-gray-400">· Usa "Dividir" para separar un pago en múltiples sellers o semanas.</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-200">
                    <th className="py-2 w-8"></th>
                    <th className="py-2 text-left font-medium">Nombre en cartola</th>
                    <th className="py-2 text-left font-medium">Seller asignado</th>
                    <th className="py-2 text-center font-medium w-20">Semana</th>
                    <th className="py-2 text-right font-medium w-28">Monto</th>
                    <th className="py-2 text-right font-medium">Ya cobrado</th>
                    <th className="py-2 text-right font-medium">Liquidado</th>
                    <th className="py-2 text-center font-medium w-24">Estado</th>
                    <th className="py-2 w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(it => {
                    const isSplit = it._key.startsWith('split-')
                    return (
                      <tr key={it._key} className={`border-b border-gray-100 text-xs ${!it.incluir ? 'opacity-40' : ''} ${isSplit ? 'bg-blue-50/50' : ''} ${it.ya_existe ? 'bg-red-50/60' : ''}`}>
                        <td className="py-1.5">
                          <input type="checkbox" checked={it.incluir} onChange={() => toggleItem(it._key)}
                            className="w-3.5 h-3.5 accent-primary-600" />
                        </td>
                        <td className="py-1.5 max-w-[160px]">
                          <span className="truncate block font-medium text-gray-800" title={it.descripcion}>
                            {isSplit ? '↳ (dividido)' : it.nombre_extraido}
                          </span>
                          <span className="text-gray-400 text-[10px]">{it.fecha}</span>
                        </td>
                        <td className="py-1.5 min-w-[180px]">
                          <div className="flex items-center gap-1.5">
                            {it.seller_id_sel
                              ? (it.match_confiable && it.seller_id_sel === it.seller_id
                                ? <Check size={11} className="text-green-600 flex-shrink-0" />
                                : <AlertCircle size={11} className="text-amber-500 flex-shrink-0" />)
                              : <AlertCircle size={11} className="text-red-400 flex-shrink-0" />
                            }
                            <select
                              className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white flex-1 min-w-0"
                              value={it.seller_id_sel ?? ''}
                              onChange={e => cambiarSeller(it._key, e.target.value)}
                            >
                              <option value="">— Sin asignar —</option>
                              {todosSellers.map(s => (
                                <option key={s.id} value={s.id}>{s.nombre}</option>
                              ))}
                            </select>
                            {!isSplit && it.seller_id_sel === it.seller_id && it.score > 0 && (
                              <span className="text-[10px] text-gray-400 flex-shrink-0">({Math.round(it.score * 100)}%)</span>
                            )}
                          </div>
                        </td>
                        <td className="py-1.5 text-center">
                          <select className="text-xs border border-gray-200 rounded px-1 py-0.5 bg-white w-16"
                            value={it.semana_sel} onChange={e => cambiarSemana(it._key, e.target.value)}>
                            {SEMANAS_LIST.map(s => <option key={s} value={s}>S{s}</option>)}
                          </select>
                        </td>
                        <td className="py-1.5 text-right">
                          <input type="number" className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white w-24 text-right font-mono"
                            value={it.monto} onChange={e => cambiarMonto(it._key, e.target.value)} min="0" />
                        </td>
                        <td className="py-1.5 text-right font-mono text-blue-600">{it.ya_cobrado > 0 ? fmt(it.ya_cobrado) : '—'}</td>
                        <td className="py-1.5 text-right font-mono text-gray-600">{it.liquidado > 0 ? fmt(it.liquidado) : '—'}</td>
                        <td className="py-1.5 text-center">
                          {!isSplit && (it.ya_existe
                            ? <span className="inline-flex items-center gap-1 text-[10px] font-medium text-red-600 bg-red-100 px-1.5 py-0.5 rounded-full">Ya procesado</span>
                            : <span className="inline-flex items-center gap-1 text-[10px] font-medium text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full">Nuevo</span>
                          )}
                        </td>
                        <td className="py-1.5 text-center">
                          {!isSplit ? (
                            <button onClick={() => splitRow(it._key)} className="text-[10px] text-blue-600 hover:text-blue-800 font-medium" title="Dividir en 2 filas">Dividir</button>
                          ) : (
                            <button onClick={() => removeRow(it._key)} className="text-[10px] text-red-500 hover:text-red-700 font-medium" title="Eliminar fila dividida">Quitar</button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
              <span className="text-sm text-gray-600">
                {items.filter(it => it.incluir && it.seller_id_sel).length} pagos · <span className="font-semibold text-gray-800">{fmt(totalConfirmar)}</span>
                <span className="text-xs text-gray-400 ml-2">· Homologaciones se guardan automáticamente</span>
              </span>
              <div className="flex gap-3">
                <button onClick={onClose} className="btn btn-secondary">Cancelar</button>
                <button onClick={confirmar} disabled={confirmando} className="btn btn-primary flex items-center gap-2">
                  <Check size={16} /> {confirmando ? 'Guardando...' : 'Confirmar pagos'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function Facturacion() {
  const now = new Date()
  const [mes, setMes] = useState(now.getMonth() + 1)
  const [anio, setAnio] = useState(now.getFullYear())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(new Set())
  const [editCell, setEditCell] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [filterText, setFilterText] = useState('')
  const [filterSemanas, setFilterSemanas] = useState(new Set())
  const [filterEstado, setFilterEstado] = useState('')
  const [sortMonto, setSortMonto] = useState(null)
  const [showFacturar, setShowFacturar] = useState(false)
  const [tab, setTab] = useState('facturacion')
  const [progress, setProgress] = useState(null)
  const [historialData, setHistorialData] = useState([])
  const [historialLoading, setHistorialLoading] = useState(false)
  const [historialAnio, setHistorialAnio] = useState(new Date().getFullYear())
  const [modalCartola, setModalCartola] = useState(false)
  const [grupoPagoModal, setGrupoPagoModal] = useState(null)
  const [pagosAcumulados, setPagosAcumulados] = useState({})
  const [modalRevertir, setModalRevertir] = useState(null) // { seller, semanasConPago }
  const [historialMes, setHistorialMes] = useState(0)       // 0 = todos los meses
  const [historialSearch, setHistorialSearch] = useState('')
  const [facturarSemana, setFacturarSemana] = useState('mes')   // 'mes' | '1'..'5'
  const [yaEmitidas, setYaEmitidas] = useState([])              // sellers ya facturados
  const [forzar, setForzar] = useState(false)
  const reqId = useRef(0)

  // Recarga silenciosa después de un save — sin reqId para no cancelar respuestas válidas
  const recargar = async () => {
    try {
      const res = await api.get('/facturacion/tabla', { params: { mes, anio } })
      setData(res.data)
    } catch {
      toast.error('Error cargando facturación')
    }
  }

  // Carga inicial y al cambiar mes/anio — usa reqId para cancelar requests obsoletos
  useEffect(() => {
    const id = ++reqId.current
    setLoading(true)
    setData(null)   // limpiar datos anteriores para mostrar spinner inmediatamente
    setSelected(new Set())
    api.get('/facturacion/tabla', { params: { mes, anio } })
      .then(res => { if (id === reqId.current) setData(res.data) })
      .catch(() => { if (id === reqId.current) toast.error('Error cargando facturación') })
      .finally(() => { if (id === reqId.current) setLoading(false) })
    api.get('/facturacion/pagos-acumulados', { params: { mes, anio } })
      .then(res => setPagosAcumulados(res.data || {}))
      .catch(() => {})
  }, [mes, anio])

  useEffect(() => {
    if (tab === 'historial') loadHistorial()
  }, [tab, historialAnio])

  const semanas = data?.semanas_disponibles || []
  const semanasVisibles = filterSemanas.size > 0
    ? semanas.filter(s => filterSemanas.has(s))
    : semanas

  const toggleSemana = (s) => {
    setFilterSemanas(prev => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  const sellers = useMemo(() => {
    if (!data?.sellers) return []
    const semanasAll = data.semanas_disponibles || []
    let result = data.sellers

    if (filterText) {
      const q = filterText.toLowerCase()
      result = result.filter(s => s.seller_nombre.toLowerCase().includes(q))
    }

    if (filterEstado) {
      const semanasACheck = filterSemanas.size === 1 ? [...filterSemanas] : semanasAll
      result = result.filter(s =>
        semanasACheck.some(sem => {
          const semData = s.semanas?.[String(sem)]
          return semData && (semData.subtotal_neto || semData.monto_neto || 0) > 0 && semData.estado === filterEstado
        })
      )
    }

    if (sortMonto) {
      const semList = filterSemanas.size > 0 ? [...filterSemanas] : semanasAll
      result = [...result].sort((a, b) => {
        const subA = semList.reduce((acc, s) => acc + (a.semanas?.[String(s)]?.subtotal_neto || a.semanas?.[String(s)]?.monto_neto || 0), 0)
        const subB = semList.reduce((acc, s) => acc + (b.semanas?.[String(s)]?.subtotal_neto || b.semanas?.[String(s)]?.monto_neto || 0), 0)
        return sortMonto === 'desc' ? subB - subA : subA - subB
      })
    }

    return result
  }, [data, filterText, filterEstado, filterSemanas, sortMonto])

  const historialFiltrado = useMemo(() => {
    let items = historialData
    if (historialMes > 0) items = items.filter(f => f.mes === historialMes)
    if (historialSearch.trim()) {
      const q = historialSearch.trim().toLowerCase()
      items = items.filter(f =>
        f.seller_nombre?.toLowerCase().includes(q) ||
        String(f.folio_haulmer || '').includes(q) ||
        `${MESES[f.mes]} ${f.anio}`.toLowerCase().includes(q) ||
        String(f.total || '').includes(q)
      )
    }
    return items
  }, [historialData, historialMes, historialSearch])

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === sellers.length) setSelected(new Set())
    else setSelected(new Set(sellers.map(s => s.seller_id)))
  }

  const updateEstado = async (sellerId, semana, estado) => {
    const fechaPago = estado === 'PAGADO' ? new Date().toISOString().split('T')[0] : null
    setData(prev => {
      if (!prev) return prev
      return {
        ...prev,
        sellers: prev.sellers.map(s => {
          if (s.seller_id !== sellerId) return s
          return {
            ...s,
            semanas: {
              ...s.semanas,
              [String(semana)]: { ...s.semanas[String(semana)], estado, fecha_pago: fechaPago },
            },
          }
        }),
      }
    })
    try {
      await api.put(`/facturacion/pago-semana/${sellerId}`, { estado, fecha_pago: fechaPago }, { params: { semana, mes, anio } })
      recargar()
    } catch {
      toast.error('Error actualizando estado')
      recargar()
    }
  }

  const updateFechaPago = async (pagoId, fecha) => {
    if (!pagoId || !fecha) return
    try {
      await api.patch(`/facturacion/pago-semana-seller/${pagoId}/fecha-pago`, { fecha_pago: fecha })
      recargar()
    } catch {
      toast.error('Error actualizando fecha de pago')
    }
  }

  const handleEstadoChange = (sellerId, sellerNombre, semana, nuevoEstado) => {
    if (nuevoEstado !== 'PAGADO') {
      updateEstado(sellerId, semana, nuevoEstado)
      return
    }
    const otrosSellers = (data?.sellers || [])
      .filter(s => s.seller_id !== sellerId)
      .filter(s => {
        const sd = s.semanas[String(semana)]
        return sd && sd.estado === 'PENDIENTE' && sd.monto_neto > 0
      })
      .map(s => ({
        seller_id: s.seller_id,
        seller_nombre: s.seller_nombre,
        monto: s.semanas[String(semana)].monto_neto,
        checked: false,
      }))
    if (otrosSellers.length === 0) {
      updateEstado(sellerId, semana, 'PAGADO')
      return
    }
    setGrupoPagoModal({ sellerId, sellerNombre, semana, otrosSellers })
  }

  const startEdit = (sellerId, semana, currentMonto) => {
    setEditCell({ sellerId, semana })
    setEditValue(String(currentMonto || 0))
  }

  const saveEdit = async () => {
    if (!editCell) return
    const { sellerId, semana } = editCell
    const nuevoMonto = parseInt(editValue) || 0
    setData(prev => {
      if (!prev) return prev
      return {
        ...prev,
        sellers: prev.sellers.map(s => {
          if (s.seller_id !== sellerId) return s
          return {
            ...s,
            semanas: {
              ...s.semanas,
              [String(semana)]: { ...s.semanas[String(semana)], monto_neto: nuevoMonto },
            },
          }
        }),
      }
    })
    setEditCell(null)
    try {
      await api.put(`/facturacion/pago-semana/${sellerId}`, {
        monto_override: nuevoMonto,
      }, { params: { semana, mes, anio } })
      toast.success('Monto actualizado')
    } catch {
      toast.error('Error guardando monto')
      recargar()
    }
  }

  const abrirModalFacturar = async () => {
    setFacturarSemana('mes')
    setForzar(false)
    setYaEmitidas([])
    if (selected.size > 0) {
      try {
        const ids = [...selected].join(',')
        const { data: emitidas } = await api.get('/facturacion/verificar-emitidas', { params: { mes, anio, seller_ids: ids } })
        setYaEmitidas(emitidas || [])
      } catch { /* silencioso */ }
    }
    setShowFacturar(true)
  }

  const generarFacturas = async () => {
    if (selected.size === 0) return toast.error('Selecciona al menos un seller')
    const ids = [...selected]
    setProgress({ current: 0, total: ids.length, seller_nombre: '' })
    const token = localStorage.getItem('token')
    const base = api.defaults.baseURL || '/api'
    const semanaParam = facturarSemana !== 'mes' ? `&semana=${facturarSemana}` : ''
    const forzarParam = forzar ? '&forzar=true' : ''
    const url = `${base}/facturacion/generar-facturas-stream?mes=${mes}&anio=${anio}${semanaParam}${forzarParam}`
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(ids),
      })
      if (!res.ok) throw new Error(res.statusText)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let lastEvent = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() || ''
        for (const block of blocks) {
          const lines = block.split('\n')
          for (const line of lines) {
            if (line.startsWith('event: ')) lastEvent = line.slice(7).trim()
            else if (line.startsWith('data: ')) {
              const dataStr = line.slice(6).trim()
              if (!dataStr) continue
              try {
                const data = JSON.parse(dataStr)
                if (lastEvent === 'progress') {
                  setProgress({ current: data.current, total: data.total, seller_nombre: data.seller_nombre || '' })
                } else if (lastEvent === 'done') {
                  setProgress(null)
                  setShowFacturar(false)
                  toast.success(`${data.creadas} factura(s) procesada(s)`)
                  data.errores?.forEach(e => toast.error(e, { duration: 6000 }))
                  data.advertencias?.forEach(a => toast(a, { icon: '⚠️', duration: 6000 }))
                  recargar()
                  if (tab === 'historial') loadHistorial()
                  return
                } else if (lastEvent === 'error') {
                  setProgress(null)
                  toast.error(data.detail || 'Error')
                  return
                }
              } catch (_) {}
            }
          }
        }
      }
      setProgress(null)
      recargar()
      if (tab === 'historial') loadHistorial()
    } catch (e) {
      setProgress(null)
      toast.error(e.message || 'Error generando facturas')
    }
  }

  const loadHistorial = () => {
    setHistorialLoading(true)
    api.get('/facturacion/historial', { params: { desde_mes: 1, desde_anio: historialAnio, hasta_mes: 12, hasta_anio: historialAnio } })
      .then(({ data }) => setHistorialData(Array.isArray(data) ? data : []))
      .catch(() => toast.error('Error cargando historial'))
      .finally(() => setHistorialLoading(false))
  }

  const totalesGenerales = useMemo(() => {
    if (!sellers.length) return { neto: 0, iva: 0, total: 0 }
    const activas = filterSemanas.size > 0 ? filterSemanas : null
    return sellers.reduce((acc, s) => {
      let neto
      if (activas) {
        neto = Object.entries(s.semanas || {}).reduce((a, [sem, sd]) =>
          activas.has(Number(sem)) ? a + (sd.monto_neto || 0) : a, 0)
      } else {
        neto = s.subtotal_neto
      }
      const iva = Math.round(neto * 0.19)
      return { neto: acc.neto + neto, iva: acc.iva + iva, total: acc.total + neto + iva }
    }, { neto: 0, iva: 0, total: 0 })
  }, [sellers, filterSemanas])

  /** Suma recibida en cartola (misma vista: sellers filtrados × semanas visibles) — solo CPS / tab pagos */
  const totalRecibidoCartola = useMemo(() => {
    if (!sellers.length) return 0
    let total = 0
    for (const s of sellers) {
      for (const sem of semanasVisibles) {
        total += pagosAcumulados[String(s.seller_id)]?.[String(sem)] || 0
      }
    }
    return total
  }, [sellers, semanasVisibles, pagosAcumulados])

  const porIngresar = useMemo(() => {
    const neto = totalesGenerales.neto - totalRecibidoCartola
    const conIva = neto + Math.round(neto * 0.19)
    return { neto, conIva }
  }, [totalesGenerales.neto, totalRecibidoCartola])

  return (
    <div className="flex flex-col h-full gap-4">
      <PageHeader
        title="Facturación"
        subtitle="Control de cobros semanales y facturación mensual a sellers"
        icon={FileText}
        accent="blue"
      />

      <div className="flex gap-1 border-b border-gray-200">
        {[
          ['facturacion', 'Facturación Mensual'],
          ['pagos', 'Control de Pagos Semanal'],
          ['historial', 'Historial emitidas'],
        ].map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab !== 'historial' && (
      <div className="card">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Mes:</label>
            <select className="input w-36" value={mes} onChange={e => setMes(Number(e.target.value))}>
              {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Año:</label>
            <select className="input w-24" value={anio} onChange={e => setAnio(Number(e.target.value))}>
              {[2025, 2026, 2027].map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <input type="text" placeholder="Buscar seller..." className="input w-48"
            value={filterText} onChange={e => setFilterText(e.target.value)} />
          <div className="flex items-center gap-1">
            {[
              { value: '', label: 'Todos' },
              { value: 'PENDIENTE', label: 'Por cobrar', active: 'bg-amber-100 text-amber-800 border-amber-400 font-semibold' },
              { value: 'PAGADO', label: 'Cobrados', active: 'bg-green-100 text-green-800 border-green-400 font-semibold' },
              { value: 'INCOMPLETO', label: 'Incompletos', active: 'bg-red-100 text-red-800 border-red-400 font-semibold' },
            ].map(opt => (
              <button key={opt.value} onClick={() => setFilterEstado(opt.value)}
                className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                  filterEstado === opt.value
                    ? (opt.active || 'bg-primary-100 text-primary-800 border-primary-400 font-semibold')
                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                }`}>
                {opt.label}
              </button>
            ))}
          </div>
          {semanas.length > 0 && (
            <div className="flex items-center gap-1.5">
              <label className="text-sm font-medium text-gray-700">Semana:</label>
              {semanas.map(s => (
                <button
                  key={s}
                  onClick={() => toggleSemana(s)}
                  className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                    filterSemanas.has(s)
                      ? 'bg-primary-600 text-white border-primary-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-primary-400'
                  }`}
                >
                  S{s}
                </button>
              ))}
              {filterSemanas.size > 0 && (
                <button
                  onClick={() => setFilterSemanas(new Set())}
                  className="text-xs text-gray-500 hover:text-gray-700 underline ml-1"
                >
                  Todas
                </button>
              )}
            </div>
          )}
          {tab === 'pagos' && (
            <button onClick={() => setModalCartola(true)} className="btn btn-secondary flex items-center gap-2 text-sm">
              <Upload size={15} /> Cargar Cartola
            </button>
          )}
          {tab === 'facturacion' && selected.size > 0 && (
            <button onClick={abrirModalFacturar} className="btn btn-primary flex items-center gap-2 ml-auto">
              <DollarSign size={16} /> Facturar ({selected.size})
            </button>
          )}
        </div>
        {mes === 2 && anio === 2026 && (
          <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            <strong>Febrero 2026 (transición):</strong> Las semanas 1, 2 y 3 son editables manualmente.
            Haz clic en un monto para modificarlo. La semana 4+ se calcula automáticamente.
          </div>
        )}
      </div>
      )}

      {tab === 'historial' && (
        <div className="card">
          <div className="flex flex-wrap items-center gap-4">
            <label className="text-sm font-medium text-gray-700">Año:</label>
            <select className="input w-28" value={historialAnio} onChange={e => setHistorialAnio(Number(e.target.value))}>
              {[2024, 2025, 2026, 2027].map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <label className="text-sm font-medium text-gray-700">Mes:</label>
            <select className="input w-36" value={historialMes} onChange={e => setHistorialMes(Number(e.target.value))}>
              <option value={0}>Todos</option>
              {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
            <input
              type="text"
              placeholder="Buscar vendedor, folio, total..."
              className="input flex-1 min-w-[200px]"
              value={historialSearch}
              onChange={e => setHistorialSearch(e.target.value)}
            />
            <button type="button" onClick={loadHistorial} className="btn btn-secondary text-sm">Actualizar</button>
          </div>
        </div>
      )}

      {sellers.length > 0 && (
        <div className={`grid gap-4 ${tab === 'pagos' ? 'grid-cols-2 sm:grid-cols-2 lg:grid-cols-4' : 'grid-cols-3'}`}>
          <div className="card bg-blue-50 border-blue-200 text-center">
            <p className="text-xs text-blue-600 font-medium">Subtotal Neto</p>
            <p className="text-lg font-bold text-blue-800">{fmt(totalesGenerales.neto)}</p>
          </div>
          <div className="card bg-gray-50 border-gray-200 text-center">
            <p className="text-xs text-gray-600 font-medium">IVA (19%)</p>
            <p className="text-lg font-bold text-gray-800">{fmt(totalesGenerales.iva)}</p>
          </div>
          <div className="card bg-green-50 border-green-200 text-center">
            <p className="text-xs text-green-600 font-medium">Total con IVA</p>
            <p className="text-lg font-bold text-green-800">{fmt(totalesGenerales.total)}</p>
          </div>
          {tab === 'pagos' && (
            <div className="card bg-violet-50 border-violet-200 text-center">
              <p className="text-xs text-violet-600 font-medium">Por ingresar</p>
              <p className="text-lg font-bold text-violet-800">{fmt(porIngresar.neto)}</p>
              <p className="text-[11px] text-violet-600/90 mt-1 font-mono">Con IVA: {fmt(porIngresar.conIva)}</p>
            </div>
          )}
        </div>
      )}

      {tab === 'historial' ? (
        historialLoading ? (
          <div className="text-center py-12 text-gray-400">Cargando historial...</div>
        ) : historialFiltrado.length === 0 ? (
          <div className="card text-center py-12 text-gray-400">
            {historialData.length === 0
              ? `No hay facturas emitidas para el año ${historialAnio}`
              : 'No hay resultados con los filtros aplicados'}
          </div>
        ) : (
          <div className="card overflow-hidden p-0 flex-1 min-h-0">
            <div className="overflow-auto h-full">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50">
                <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                  <th className="pb-2 pt-3 px-4 font-medium">Vendedor</th>
                  <th className="pb-2 pt-3 px-4 font-medium">Mes / Año</th>
                  <th className="pb-2 pt-3 px-4 font-medium text-right">Total</th>
                  <th className="pb-2 pt-3 px-4 font-medium text-center">Folio</th>
                  <th className="pb-2 pt-3 px-4 font-medium">Emitida</th>
                </tr>
              </thead>
              <tbody>
                {historialFiltrado.map((f) => (
                  <tr key={`${f.seller_id}-${f.mes}-${f.anio}`} className="border-b border-gray-100">
                    <td className="py-2 px-4 font-medium text-gray-800">{f.seller_nombre}</td>
                    <td className="py-2 px-4">{MESES[f.mes]} {f.anio}</td>
                    <td className="py-2 px-4 text-right font-mono">{fmt(f.total)}</td>
                    <td className="py-2 px-4 text-center text-gray-600">{f.folio_haulmer || '—'}</td>
                    <td className="py-2 px-4 text-xs text-gray-500">{f.emitida_en ? new Date(f.emitida_en).toLocaleString('es-CL') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )
      ) : loading ? (
        <div className="card text-center py-12 text-gray-400">
          <Loader2 size={28} className="mx-auto mb-3 animate-spin opacity-40" />
          <p>Cargando {MESES[mes]} {anio}...</p>
        </div>
      ) : !data || sellers.length === 0 ? (
        <div className="card text-center py-12 text-gray-400">
          No hay datos de facturación para {MESES[mes]} {anio}
        </div>
      ) : (
        <div className="card overflow-hidden p-0 flex-1 min-h-0">
          <div className="overflow-auto h-full">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-gray-50">
              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                {tab === 'facturacion' && (
                  <th className="pb-2 pt-3 px-3 pr-2">
                    <input type="checkbox" checked={selected.size === sellers.length && sellers.length > 0}
                      onChange={toggleAll} className="rounded" />
                  </th>
                )}
                <th className="pb-2 pt-3 px-3 font-medium">Vendedor</th>
                {semanasVisibles.map(s => tab === 'pagos' ? (
                  <React.Fragment key={`h-${s}`}>
                    <th className="pb-2 pt-3 px-2 font-medium text-right text-gray-700">Sem {s}</th>
                    <th className="pb-2 pt-3 px-2 font-medium text-right text-blue-600">Recibido</th>
                  </React.Fragment>
                ) : (
                  <th key={s} className="pb-2 pt-3 px-3 font-medium text-right">Sem {s}</th>
                ))}
                <th className="pb-2 pt-3 px-3 font-medium text-right cursor-pointer select-none hover:text-primary-600"
                  onClick={() => setSortMonto(s => s === 'desc' ? 'asc' : s === 'asc' ? null : 'desc')}
                  title="Ordenar por monto">
                  Subtotal {sortMonto === 'desc' ? ' ↓' : sortMonto === 'asc' ? ' ↑' : ''}
                </th>
                <th className="pb-2 pt-3 px-3 font-medium text-right">Total + IVA</th>
                {tab === 'facturacion' && <th className="pb-2 pt-3 px-3 font-medium text-center">Factura</th>}
              </tr>
            </thead>
            <tbody>
              {sellers.map(s => (
                <tr key={s.seller_id} className="border-b border-gray-100 hover:bg-gray-50">
                  {tab === 'facturacion' && (
                    <td className="py-2 px-3 pr-2">
                      <input type="checkbox" checked={selected.has(s.seller_id)}
                        onChange={() => toggleSelect(s.seller_id)} className="rounded" />
                    </td>
                  )}
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-2">
                      <div>
                        <span className="font-medium text-gray-800">{s.seller_nombre}</span>
                        {s.rut && <span className="text-xs text-gray-400 ml-2">{s.rut}</span>}
                      </div>
                      {tab === 'pagos' && (() => {
                        const semanasConPago = semanasVisibles
                          .filter(sem => (pagosAcumulados[String(s.seller_id)]?.[String(sem)] || 0) > 0)
                          .map(sem => ({ semana: sem, monto: pagosAcumulados[String(s.seller_id)]?.[String(sem)] || 0 }))
                        if (!semanasConPago.length) return null
                        return (
                          <button
                            title="Revertir pagos"
                            onClick={() => setModalRevertir({ seller: s, semanasConPago })}
                            className="text-gray-300 hover:text-orange-500 transition-colors ml-1"
                          >
                            <RotateCcw size={13} />
                          </button>
                        )
                      })()}
                    </div>
                  </td>
                  {semanasVisibles.map(sem => {
                    const semData = s.semanas[String(sem)] || { monto_neto: 0, estado: 'PENDIENTE', editable: false }
                    const isEditing = editCell?.sellerId === s.seller_id && editCell?.semana === sem
                    const cobradoSem = pagosAcumulados[String(s.seller_id)]?.[String(sem)] || 0
                    const completo = cobradoSem > 0 && semData.monto_neto > 0 && cobradoSem >= semData.monto_neto
                    return tab === 'pagos' ? (
                      <React.Fragment key={`${s.seller_id}-${sem}`}>
                        <td className="py-2 px-2 text-right">
                          <div className="flex flex-col items-end gap-1">
                            <span className="font-mono text-gray-700">{fmt(semData.monto_neto)}</span>
                            {semData.monto_neto > 0 && (
                              <span className="font-mono text-[10px] text-gray-400">{fmt(Math.round(semData.monto_neto * 1.19))} <span className="text-gray-300">+IVA</span></span>
                            )}
                            {semData.monto_neto > 0 && (
                              <select
                                className={`text-[10px] px-1.5 py-0.5 rounded border-0 cursor-pointer ${ESTADO_COLORS[semData.estado] || ESTADO_COLORS.PENDIENTE}`}
                                value={semData.estado}
                                onChange={e => handleEstadoChange(s.seller_id, s.seller_nombre, sem, e.target.value)}
                              >
                                <option value="PENDIENTE">Pendiente</option>
                                <option value="PAGADO">Pagado</option>
                                <option value="INCOMPLETO">Incompleto</option>
                              </select>
                            )}
                            {semData.estado === 'PAGADO' && (
                              <input
                                type="date"
                                className="text-[10px] px-1 py-0.5 border border-gray-200 rounded w-[105px] text-gray-600"
                                value={semData.fecha_pago || ''}
                                onChange={e => updateFechaPago(semData.pago_id, e.target.value)}
                              />
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-2 text-right">
                          {cobradoSem > 0 ? (
                            <span className={`font-mono text-xs font-semibold ${completo ? 'text-emerald-600' : 'text-amber-600'}`}>
                              {fmt(cobradoSem)}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </td>
                      </React.Fragment>
                    ) : (
                      <td key={sem} className="py-2 px-3 text-right">
                        {isEditing ? (
                          <div className="flex items-center gap-1 justify-end">
                            <span className="text-xs text-gray-400">$</span>
                            <input type="number" className="input w-24 text-right text-sm py-0.5"
                              value={editValue} onChange={e => setEditValue(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditCell(null) }}
                              autoFocus />
                            <button onClick={saveEdit} className="text-green-600 hover:text-green-800"><Check size={14} /></button>
                          </div>
                        ) : (
                          <span
                            className={`font-mono text-gray-700 ${semData.editable ? 'cursor-pointer hover:text-primary-600 hover:underline' : ''}`}
                            onClick={() => semData.editable && startEdit(s.seller_id, sem, semData.monto_neto)}
                            title={semData.editable ? 'Clic para editar' : ''}
                          >
                            {fmt(semData.monto_neto)}
                          </span>
                        )}
                      </td>
                    )
                  })}
                  {(() => {
                    const neto = filterSemanas.size > 0
                      ? semanasVisibles.reduce((a, sem) => a + (s.semanas[String(sem)]?.monto_neto || 0), 0)
                      : s.subtotal_neto
                    const total = filterSemanas.size > 0 ? neto + Math.round(neto * 0.19) : s.total_con_iva
                    return (
                      <>
                        <td className="py-2 px-3 text-right font-semibold text-gray-800 font-mono">{fmt(neto)}</td>
                        <td className="py-2 px-3 text-right font-semibold text-green-700 font-mono">{fmt(total)}</td>
                      </>
                    )
                  })()}
                  {tab === 'facturacion' && (
                    <td className="py-2 px-3 text-center">
                      {s.factura_estado === 'EMITIDA' ? (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">Folio: {s.factura_folio || '—'}</span>
                      ) : s.factura_estado === 'PENDIENTE' ? (
                        <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">Generada</span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      <Modal open={showFacturar} title="Confirmar Facturación" onClose={() => !progress && setShowFacturar(false)}>
          <div className="space-y-4">
            {progress ? (
              <>
                <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <Loader2 className="w-6 h-6 text-blue-600 animate-spin flex-shrink-0" />
                  <div>
                    <p className="font-medium text-blue-900">Procesando facturas</p>
                    <p className="text-sm text-blue-700">{progress.current} / {progress.total} — {progress.seller_nombre || '...'}</p>
                  </div>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-primary-600 h-2 rounded-full transition-all duration-300" style={{ width: `${progress.total ? (100 * progress.current / progress.total) : 0}%` }} />
                </div>
              </>
            ) : (
              <>
                {/* Selector de período */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Período a facturar</label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setFacturarSemana('mes')}
                      className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${facturarSemana === 'mes' ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-700 border-gray-300 hover:border-primary-400'}`}
                    >
                      Todo {MESES[mes]}
                    </button>
                    {(semanas.length > 0 ? semanas : [1, 2, 3, 4, 5]).map(s => (
                      <button
                        key={s}
                        onClick={() => setFacturarSemana(String(s))}
                        className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${facturarSemana === String(s) ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-700 border-gray-300 hover:border-primary-400'}`}
                      >
                        Semana {s}
                      </button>
                    ))}
                  </div>
                </div>

                <p className="text-sm text-gray-600">
                  Se generarán facturas para <strong>{selected.size}</strong> seller(s) —{' '}
                  {facturarSemana === 'mes'
                    ? <><strong>todo el mes</strong> de <strong>{MESES[mes]} {anio}</strong></>
                    : <><strong>Semana {facturarSemana}</strong> de <strong>{MESES[mes]} {anio}</strong></>
                  }.
                </p>

                {/* Alerta de ya emitidas */}
                {yaEmitidas.length > 0 && (
                  <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg">
                    <div className="flex items-start gap-2 mb-2">
                      <AlertTriangle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
                      <p className="text-sm font-medium text-amber-800">
                        {yaEmitidas.length} seller(s) ya tienen factura emitida este mes:
                      </p>
                    </div>
                    <ul className="text-xs text-amber-700 space-y-0.5 ml-6">
                      {yaEmitidas.map(e => (
                        <li key={e.seller_id}>• {e.seller_nombre} {e.folio_haulmer ? `(Folio: ${e.folio_haulmer})` : ''}</li>
                      ))}
                    </ul>
                    <label className="flex items-center gap-2 mt-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={forzar}
                        onChange={e => setForzar(e.target.checked)}
                        className="rounded"
                      />
                      <span className="text-sm text-amber-800 font-medium">Igualmente re-emitir estas facturas</span>
                    </label>
                  </div>
                )}

                <div className="p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-800">
                  Se crearán los registros y se emitirán en Haulmer (los que tengan RUT). Verás el avance en tiempo real.
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setShowFacturar(false)} className="btn btn-secondary">Cancelar</button>
                  <button
                    onClick={generarFacturas}
                    disabled={yaEmitidas.length > 0 && !forzar && selected.size === yaEmitidas.length}
                    className="btn btn-primary disabled:opacity-50"
                  >
                    Confirmar y Generar
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      <Modal open={!!grupoPagoModal} title="Marcar como Pagado" onClose={() => setGrupoPagoModal(null)}>
        {grupoPagoModal && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              <strong>{grupoPagoModal.sellerNombre}</strong> será marcado como pagado para la <strong>Semana {grupoPagoModal.semana}</strong>.
            </p>
            <p className="text-sm text-gray-700 font-medium">¿Este pago también cubre a otros sellers?</p>
            <div className="max-h-60 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
              {grupoPagoModal.otrosSellers.map((os, idx) => (
                <label key={os.seller_id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={os.checked}
                    onChange={() => {
                      setGrupoPagoModal(prev => ({
                        ...prev,
                        otrosSellers: prev.otrosSellers.map((o, i) =>
                          i === idx ? { ...o, checked: !o.checked } : o
                        ),
                      }))
                    }}
                    className="w-4 h-4 rounded accent-primary-600"
                  />
                  <span className="text-sm text-gray-800 flex-1">{os.seller_nombre}</span>
                  <span className="text-sm font-mono text-gray-500">{fmt(os.monto)}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => {
                  updateEstado(grupoPagoModal.sellerId, grupoPagoModal.semana, 'PAGADO')
                  setGrupoPagoModal(null)
                }}
                className="btn-secondary text-sm"
              >
                Solo este seller
              </button>
              <button
                onClick={async () => {
                  const { sellerId, semana, otrosSellers } = grupoPagoModal
                  setGrupoPagoModal(null)
                  updateEstado(sellerId, semana, 'PAGADO')
                  for (const os of otrosSellers.filter(o => o.checked)) {
                    await updateEstado(os.seller_id, semana, 'PAGADO')
                  }
                }}
                className="btn-primary text-sm"
              >
                Confirmar selección
              </button>
            </div>
          </div>
        )}
      </Modal>
      {modalCartola && (
        <ModalCartolaSeller
          mes={mes} anio={anio}
          onClose={() => setModalCartola(false)}
          onConfirmado={() => {
            // Recargar tabla de sellers (estados) Y pagos acumulados (montos recibidos)
            recargar()
            api.get('/facturacion/pagos-acumulados', { params: { mes, anio } })
              .then(res => setPagosAcumulados(res.data || {}))
              .catch(() => {})
          }}
        />
      )}
      {modalRevertir && (
        <ModalRevertirPagos
          seller={modalRevertir.seller}
          mes={mes}
          anio={anio}
          semanasConPago={modalRevertir.semanasConPago}
          onClose={() => setModalRevertir(null)}
          onRevertido={() => {
            recargar()
            api.get('/facturacion/pagos-acumulados', { params: { mes, anio } })
              .then(res => setPagosAcumulados(res.data || {}))
              .catch(() => {})
          }}
        />
      )}
    </div>
  )
}
