import { useState, useEffect, useMemo, useRef } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import { FileText, Check, DollarSign, Loader2, AlertTriangle } from 'lucide-react'
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
  const [showFacturar, setShowFacturar] = useState(false)
  const [tab, setTab] = useState('facturacion')
  const [progress, setProgress] = useState(null)
  const [historialData, setHistorialData] = useState([])
  const [historialLoading, setHistorialLoading] = useState(false)
  const [historialAnio, setHistorialAnio] = useState(new Date().getFullYear())
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
    setSelected(new Set())
    api.get('/facturacion/tabla', { params: { mes, anio } })
      .then(res => { if (id === reqId.current) setData(res.data) })
      .catch(() => { if (id === reqId.current) toast.error('Error cargando facturación') })
      .finally(() => { if (id === reqId.current) setLoading(false) })
  }, [mes, anio])

  useEffect(() => {
    if (tab === 'historial') loadHistorial()
  }, [tab, historialAnio])

  const semanas = data?.semanas_disponibles || []
  const sellers = useMemo(() => {
    if (!data?.sellers) return []
    if (!filterText) return data.sellers
    const q = filterText.toLowerCase()
    return data.sellers.filter(s => s.seller_nombre.toLowerCase().includes(q))
  }, [data, filterText])

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
    try {
      await api.put(`/facturacion/pago-semana/${sellerId}`, { estado }, { params: { semana, mes, anio } })
      recargar()
    } catch { toast.error('Error actualizando estado') }
  }

  const startEdit = (sellerId, semana, currentMonto) => {
    setEditCell({ sellerId, semana })
    setEditValue(String(currentMonto || 0))
  }

  const saveEdit = async () => {
    if (!editCell) return
    try {
      await api.put(`/facturacion/pago-semana/${editCell.sellerId}`, {
        monto_override: parseInt(editValue) || 0,
      }, { params: { semana: editCell.semana, mes, anio } })
      toast.success('Monto actualizado')
      setEditCell(null)
      recargar()
    } catch { toast.error('Error guardando monto') }
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
    return sellers.reduce((acc, s) => ({
      neto: acc.neto + s.subtotal_neto,
      iva: acc.iva + s.iva,
      total: acc.total + s.total_con_iva,
    }), { neto: 0, iva: 0, total: 0 })
  }, [sellers])

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <FileText size={24} className="text-primary-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Facturación</h1>
            <p className="text-sm text-gray-500">Control de cobros semanales y facturación mensual a sellers</p>
          </div>
        </div>
      </div>

      <div className="flex gap-1 mb-4 border-b border-gray-200">
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
      <div className="card mb-4">
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
        <div className="card mb-4">
          <div className="flex flex-wrap items-center gap-4">
            <label className="text-sm font-medium text-gray-700">Año:</label>
            <select className="input w-28" value={historialAnio} onChange={e => setHistorialAnio(Number(e.target.value))}>
              {[2024, 2025, 2026, 2027].map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <button type="button" onClick={loadHistorial} className="btn btn-secondary text-sm">Actualizar</button>
          </div>
        </div>
      )}

      {sellers.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-4">
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
        </div>
      )}

      {tab === 'historial' ? (
        historialLoading ? (
          <div className="text-center py-12 text-gray-400">Cargando historial...</div>
        ) : historialData.length === 0 ? (
          <div className="card text-center py-12 text-gray-400">
            No hay facturas emitidas para el año {historialAnio}
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                  <th className="pb-2 font-medium">Vendedor</th>
                  <th className="pb-2 font-medium">Mes / Año</th>
                  <th className="pb-2 font-medium text-right">Total</th>
                  <th className="pb-2 font-medium text-center">Folio</th>
                  <th className="pb-2 font-medium">Emitida</th>
                </tr>
              </thead>
              <tbody>
                {historialData.map((f) => (
                  <tr key={`${f.seller_id}-${f.mes}-${f.anio}`} className="border-b border-gray-100">
                    <td className="py-2 font-medium text-gray-800">{f.seller_nombre}</td>
                    <td className="py-2">{MESES[f.mes]} {f.anio}</td>
                    <td className="py-2 text-right font-mono">{fmt(f.total)}</td>
                    <td className="py-2 text-center text-gray-600">{f.folio_haulmer || '—'}</td>
                    <td className="py-2 text-xs text-gray-500">{f.emitida_en ? new Date(f.emitida_en).toLocaleString('es-CL') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : loading && !data ? (
        <div className="text-center py-12 text-gray-400">Cargando...</div>
      ) : !data || sellers.length === 0 ? (
        <div className="card text-center py-12 text-gray-400">
          No hay datos de facturación para {MESES[mes]} {anio}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                {tab === 'facturacion' && (
                  <th className="pb-2 pr-2">
                    <input type="checkbox" checked={selected.size === sellers.length && sellers.length > 0}
                      onChange={toggleAll} className="rounded" />
                  </th>
                )}
                <th className="pb-2 font-medium">Vendedor</th>
                {semanas.map(s => <th key={s} className="pb-2 font-medium text-right">Sem {s}</th>)}
                <th className="pb-2 font-medium text-right">Subtotal</th>
                <th className="pb-2 font-medium text-right">Total + IVA</th>
                {tab === 'facturacion' && <th className="pb-2 font-medium text-center">Factura</th>}
              </tr>
            </thead>
            <tbody>
              {sellers.map(s => (
                <tr key={s.seller_id} className="border-b border-gray-100 hover:bg-gray-50">
                  {tab === 'facturacion' && (
                    <td className="py-2 pr-2">
                      <input type="checkbox" checked={selected.has(s.seller_id)}
                        onChange={() => toggleSelect(s.seller_id)} className="rounded" />
                    </td>
                  )}
                  <td className="py-2">
                    <span className="font-medium text-gray-800">{s.seller_nombre}</span>
                    {s.rut && <span className="text-xs text-gray-400 ml-2">{s.rut}</span>}
                  </td>
                  {semanas.map(sem => {
                    const semData = s.semanas[String(sem)] || { monto_neto: 0, estado: 'PENDIENTE', editable: false }
                    const isEditing = editCell?.sellerId === s.seller_id && editCell?.semana === sem
                    return (
                      <td key={sem} className="py-2 text-right">
                        {tab === 'pagos' ? (
                          <div className="flex flex-col items-end gap-1">
                            <span className="font-mono text-gray-700">{fmt(semData.monto_neto)}</span>
                            <select
                              className={`text-[10px] px-1.5 py-0.5 rounded border-0 cursor-pointer ${ESTADO_COLORS[semData.estado] || ESTADO_COLORS.PENDIENTE}`}
                              value={semData.estado}
                              onChange={e => updateEstado(s.seller_id, sem, e.target.value)}
                            >
                              <option value="PENDIENTE">Pendiente</option>
                              <option value="PAGADO">Pagado</option>
                              <option value="INCOMPLETO">Incompleto</option>
                            </select>
                          </div>
                        ) : isEditing ? (
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
                  <td className="py-2 text-right font-semibold text-gray-800 font-mono">{fmt(s.subtotal_neto)}</td>
                  <td className="py-2 text-right font-semibold text-green-700 font-mono">{fmt(s.total_con_iva)}</td>
                  {tab === 'facturacion' && (
                    <td className="py-2 text-center">
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
                    {semanas.map(s => (
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
    </div>
  )
}
