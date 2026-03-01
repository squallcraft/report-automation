import { useState, useEffect, useMemo, useRef } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import { FileText, Check, DollarSign } from 'lucide-react'
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
  const reqId = useRef(0)

  const cargar = (silencioso = false) => {
    const id = ++reqId.current
    if (!silencioso) setLoading(true)
    api.get('/facturacion/tabla', { params: { mes, anio } })
      .then(res => {
        if (id !== reqId.current) return
        setData(res.data)
      })
      .catch(() => { if (id === reqId.current) toast.error('Error cargando facturación') })
      .finally(() => { if (id === reqId.current) setLoading(false) })
  }

  useEffect(() => {
    reqId.current++
    const id = reqId.current
    setLoading(true)
    setSelected(new Set())
    api.get('/facturacion/tabla', { params: { mes, anio } })
      .then(res => { if (id === reqId.current) setData(res.data) })
      .catch(() => { if (id === reqId.current) toast.error('Error cargando facturación') })
      .finally(() => { if (id === reqId.current) setLoading(false) })
  }, [mes, anio])

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
      cargar(true)
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
      cargar(true)
    } catch { toast.error('Error guardando monto') }
  }

  const generarFacturas = async () => {
    if (selected.size === 0) return toast.error('Selecciona al menos un seller')
    try {
      const res = await api.post('/facturacion/generar-facturas', [...selected], { params: { mes, anio } })
      toast.success(`${res.data.creadas} factura(s) generada(s)`)
      res.data.errores?.forEach(e => toast.error(e))
      setShowFacturar(false)
      cargar(true)
    } catch { toast.error('Error generando facturas') }
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
        {['facturacion', 'pagos'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'facturacion' ? 'Facturación Mensual' : 'Control de Pagos Semanal'}
          </button>
        ))}
      </div>

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
            <button onClick={() => setShowFacturar(true)} className="btn btn-primary flex items-center gap-2 ml-auto">
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

      {loading && !data ? (
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

      {showFacturar && (
        <Modal title="Confirmar Facturación" onClose={() => setShowFacturar(false)}>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Se generarán facturas para <strong>{selected.size}</strong> sellers del mes de <strong>{MESES[mes]} {anio}</strong>.
            </p>
            <div className="p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-800">
              Esto creará los registros de factura. La emisión real vía Haulmer se realizará cuando se configure la integración.
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setShowFacturar(false)} className="btn btn-secondary">Cancelar</button>
              <button onClick={generarFacturas} className="btn btn-primary">Confirmar y Generar</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
