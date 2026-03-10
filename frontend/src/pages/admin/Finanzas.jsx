import React, { useState, useEffect, useMemo } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import {
  Plus, Trash2, Edit2, ChevronRight, ChevronDown,
  Copy, TrendingUp, TrendingDown, Minus, Check, X,
  FileText, Upload, Download, Paperclip, ArrowUpRight, ArrowDownRight,
  BookOpen, RefreshCw,
} from 'lucide-react'
import Modal from '../../components/Modal'

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

function fmt(v) {
  if (v == null) return '$0'
  const abs = Math.abs(v)
  return `${v < 0 ? '-' : ''}$${abs.toLocaleString('es-CL')}`
}

function pct(current, prev) {
  if (!prev) return null
  return ((current - prev) / Math.abs(prev)) * 100
}

const ESTADO_BADGE = {
  PENDIENTE: 'bg-amber-100 text-amber-800',
  PAGADO: 'bg-green-100 text-green-800',
  VENCIDO: 'bg-red-100 text-red-800',
}

const FUENTE_BADGE = {
  Manual: 'bg-blue-100 text-blue-700',
  Driver: 'bg-purple-100 text-purple-700',
  Seller: 'bg-emerald-100 text-emerald-700',
}

const initialForm = {
  categoria_id: '',
  nombre: '',
  descripcion: '',
  monto: '',
  moneda: 'CLP',
  fecha_vencimiento: '',
  fecha_pago: '',
  estado: 'PENDIENTE',
  recurrente: false,
  proveedor: '',
  notas: '',
}

// ── Summary Card ──

function SummaryCard({ label, value, prev, color, invertTrend = false, sub }) {
  const diff = pct(value, prev)
  const isPositive = invertTrend ? (diff != null && diff <= 0) : (diff != null && diff >= 0)

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color === 'green' ? 'text-green-600' : color === 'red' ? 'text-red-600' : 'text-gray-900'}`}>
        {fmt(value)}
      </p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      {diff !== null && (
        <div className={`flex items-center gap-1 mt-1.5 text-xs ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
          {isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          <span>{diff > 0 ? '+' : ''}{diff.toFixed(1)}% vs mes anterior</span>
        </div>
      )}
      {diff === null && <div className="flex items-center gap-1 mt-1.5 text-xs text-gray-400"><Minus size={12} /><span>Sin datos previos</span></div>}
    </div>
  )
}

// ── Chart (simple bar chart via CSS) ──

function SimpleChart({ data }) {
  if (!data || data.length === 0) return null
  const maxVal = Math.max(...data.flatMap(d => [d.ingresos, d.egresos]), 1)

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Ingresos vs Egresos por Semana</h3>
      <div className="flex items-end gap-3 h-40">
        {data.map(d => (
          <div key={d.semana} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full flex gap-1 items-end h-32">
              <div className="flex-1 bg-green-200 rounded-t" style={{ height: `${(d.ingresos / maxVal) * 100}%` }} title={`Ingresos: ${fmt(d.ingresos)}`} />
              <div className="flex-1 bg-red-200 rounded-t" style={{ height: `${(d.egresos / maxVal) * 100}%` }} title={`Egresos: ${fmt(d.egresos)}`} />
            </div>
            <span className="text-xs text-gray-500">S{d.semana}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-4 mt-3 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-200 rounded" /> Ingresos</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-200 rounded" /> Egresos</span>
      </div>
    </div>
  )
}

// ── Recursive category tree ──

function CategoriaNode({ node, level = 0, movimientos, onAdd, onEdit, onDelete, expanded, toggleExpand }) {
  const isOpen = expanded[node.id] !== false
  const hasChildren = node.hijos && node.hijos.length > 0
  const isLeaf = !hasChildren
  const myMovs = movimientos.filter(m => m.categoria_id === node.id)
  const allIds = getAllDescendantIds(node)
  const descendantMovs = movimientos.filter(m => allIds.includes(m.categoria_id))
  const totalMovs = isLeaf ? myMovs : descendantMovs
  const total = totalMovs.reduce((s, m) => s + m.monto, 0)

  return (
    <div className={level > 0 ? 'ml-4 border-l border-gray-200 pl-3' : ''}>
      <div className={`flex items-center gap-2 py-2 px-3 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors ${level === 0 ? 'bg-gray-50 font-semibold text-gray-900' : ''}`} onClick={() => toggleExpand(node.id)}>
        {hasChildren ? (isOpen ? <ChevronDown size={16} className="text-gray-400 flex-shrink-0" /> : <ChevronRight size={16} className="text-gray-400 flex-shrink-0" />) : <div className="w-4" />}
        <span className={`flex-1 ${level === 0 ? 'text-sm uppercase tracking-wider' : level === 1 ? 'font-medium text-gray-800' : 'text-gray-700'}`}>{node.nombre}</span>
        {totalMovs.length > 0 && <span className={`text-sm font-medium ${node.tipo === 'INGRESO' ? 'text-green-600' : 'text-red-600'}`}>{fmt(total)}</span>}
        {isLeaf && <button onClick={e => { e.stopPropagation(); onAdd(node) }} className="p-1 rounded hover:bg-blue-100 text-blue-600 transition-colors" title="Agregar"><Plus size={14} /></button>}
      </div>
      {isOpen && hasChildren && node.hijos.map(h => <CategoriaNode key={h.id} node={h} level={level + 1} movimientos={movimientos} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} expanded={expanded} toggleExpand={toggleExpand} />)}
      {isOpen && isLeaf && myMovs.length > 0 && (
        <div className="ml-8 mb-2">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 text-xs uppercase">
              <th className="py-1 pr-2">Nombre</th><th className="py-1 pr-2">Proveedor</th><th className="py-1 pr-2 text-right">Monto</th><th className="py-1 pr-2 text-center">Estado</th><th className="py-1 pr-2">Vencimiento</th><th className="py-1 pr-2 text-center">Rec.</th><th className="py-1 pr-2 text-center">Doc.</th><th className="py-1 w-16"></th>
            </tr></thead>
            <tbody>
              {myMovs.map(m => (
                <tr key={m.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="py-1.5 pr-2 font-medium text-gray-900">{m.nombre}</td>
                  <td className="py-1.5 pr-2 text-gray-500">{m.proveedor || '—'}</td>
                  <td className="py-1.5 pr-2 text-right font-medium">{fmt(m.monto)}</td>
                  <td className="py-1.5 pr-2 text-center"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ESTADO_BADGE[m.estado] || 'bg-gray-100'}`}>{m.estado}</span></td>
                  <td className="py-1.5 pr-2 text-gray-500">{m.fecha_vencimiento || '—'}</td>
                  <td className="py-1.5 pr-2 text-center">{m.recurrente ? <Check size={14} className="text-blue-500 mx-auto" /> : '—'}</td>
                  <td className="py-1.5 pr-2 text-center">{m.tiene_documento ? <Paperclip size={14} className="text-gray-500 mx-auto" /> : '—'}</td>
                  <td className="py-1.5 flex gap-1 justify-end">
                    <button onClick={() => onEdit(m)} className="p-1 rounded hover:bg-blue-100 text-blue-600"><Edit2 size={14} /></button>
                    <button onClick={() => onDelete(m.id)} className="p-1 rounded hover:bg-red-100 text-red-600"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function getAllDescendantIds(node) {
  let ids = [node.id]
  if (node.hijos) for (const h of node.hijos) ids = ids.concat(getAllDescendantIds(h))
  return ids
}

function flattenLeaves(nodes) {
  let leaves = []
  for (const n of nodes) {
    if (!n.hijos || n.hijos.length === 0) leaves.push(n)
    else leaves = leaves.concat(flattenLeaves(n.hijos))
  }
  return leaves
}

// ── Main Page ──

export default function Finanzas() {
  const now = new Date()
  const [period, setPeriod] = useState({ mes: now.getMonth() + 1, anio: now.getFullYear() })
  const [tab, setTab] = useState('dashboard')
  const [loading, setLoading] = useState(false)

  // Dashboard state
  const [dashData, setDashData] = useState(null)
  const [flujoCaja, setFlujoCaja] = useState(null)
  const [transacciones, setTransacciones] = useState([])

  // Detalle state
  const [categorias, setCategorias] = useState([])
  const [movimientos, setMovimientos] = useState([])
  const [expanded, setExpanded] = useState({})
  const [copiando, setCopiando] = useState(false)

  // Contabilidad GL state
  const [libroDiario, setLibroDiario] = useState(null)
  const [balanceComp, setBalanceComp] = useState(null)
  const [backfilling, setBackfilling] = useState(false)

  // Modal state
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState({ ...initialForm })
  const [docFile, setDocFile] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const requests = [
        api.get('/finanzas/dashboard', { params: period }),
        api.get('/finanzas/flujo-caja', { params: period }),
        api.get('/finanzas/transacciones', { params: period }),
        api.get('/finanzas/categorias'),
        api.get('/finanzas/movimientos', { params: period }),
        api.get('/finanzas/contabilidad/libro-diario', { params: { ...period, limit: 100, offset: 0 } }),
        api.get('/finanzas/contabilidad/balance-comprobacion', { params: period }),
      ]
      const [dashRes, flujoRes, txnRes, catRes, movRes, libroRes, balRes] = await Promise.all(requests)
      setDashData(dashRes.data)
      setFlujoCaja(flujoRes.data)
      setTransacciones(txnRes.data)
      setCategorias(catRes.data)
      setMovimientos(movRes.data)
      setLibroDiario(libroRes.data)
      setBalanceComp(balRes.data)
    } catch {
      toast.error('Error al cargar datos financieros')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [period.mes, period.anio])

  const toggleExpand = (id) => setExpanded(prev => ({ ...prev, [id]: prev[id] === false }))

  const openAdd = (cat) => {
    setEditId(null)
    setForm({ ...initialForm, categoria_id: cat.id })
    setDocFile(null)
    setShowModal(true)
  }

  const openEdit = (mov) => {
    setEditId(mov.id)
    setForm({
      categoria_id: mov.categoria_id,
      nombre: mov.nombre,
      descripcion: mov.descripcion || '',
      monto: mov.monto,
      moneda: mov.moneda || 'CLP',
      fecha_vencimiento: mov.fecha_vencimiento || '',
      fecha_pago: mov.fecha_pago || '',
      estado: mov.estado,
      recurrente: mov.recurrente,
      proveedor: mov.proveedor || '',
      notas: mov.notas || '',
    })
    setDocFile(null)
    setShowModal(true)
  }

  const openNew = () => {
    setEditId(null)
    setForm({ ...initialForm })
    setDocFile(null)
    setShowModal(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const payload = {
      ...form,
      monto: Number(form.monto),
      mes: period.mes,
      anio: period.anio,
      categoria_id: Number(form.categoria_id),
      fecha_vencimiento: form.fecha_vencimiento || null,
      fecha_pago: form.fecha_pago || null,
    }
    try {
      let movId = editId
      if (editId) {
        await api.put(`/finanzas/movimientos/${editId}`, payload)
      } else {
        const { data } = await api.post('/finanzas/movimientos', payload)
        movId = data.id
      }
      if (docFile && movId) {
        const fd = new FormData()
        fd.append('archivo', docFile)
        await api.post(`/finanzas/movimientos/${movId}/documento`, fd)
      }
      toast.success(editId ? 'Movimiento actualizado' : 'Movimiento creado')
      setShowModal(false)
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error')
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar este movimiento?')) return
    try {
      await api.delete(`/finanzas/movimientos/${id}`)
      toast.success('Eliminado')
      load()
    } catch { toast.error('Error al eliminar') }
  }

  const copiarRecurrentes = async () => {
    setCopiando(true)
    try {
      const { data } = await api.post('/finanzas/movimientos/copiar-recurrentes', null, { params: period })
      toast.success(`${data.creados} copiados a ${MESES[data.mes_destino]} ${data.anio_destino}`)
    } catch { toast.error('Error al copiar') }
    finally { setCopiando(false) }
  }

  const downloadDoc = async (movId) => {
    try {
      const { data } = await api.get(`/finanzas/movimientos/${movId}/documento`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([data]))
      const a = document.createElement('a')
      a.href = url; a.download = 'documento'; a.click()
    } catch { toast.error('Error al descargar') }
  }

  const leaves = useMemo(() => flattenLeaves(categorias), [categorias])
  const ingresosTree = categorias.filter(c => c.tipo === 'INGRESO')
  const egresosTree = categorias.filter(c => c.tipo === 'EGRESO')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Finanzas</h1>
          <p className="text-sm text-gray-500">Panorama financiero consolidado</p>
        </div>
        <button onClick={openNew} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> Nueva Transacción
        </button>
      </div>

      {/* Period + Tabs */}
      <div className="flex flex-wrap items-center gap-3">
        <select value={period.mes} onChange={e => setPeriod(p => ({ ...p, mes: Number(e.target.value) }))} className="input w-32">
          {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
        </select>
        <input type="number" value={period.anio} onChange={e => setPeriod(p => ({ ...p, anio: Number(e.target.value) }))} className="input w-24" />

        <div className="flex bg-gray-100 rounded-lg p-0.5 ml-auto">
          <button onClick={() => setTab('dashboard')} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === 'dashboard' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>Dashboard</button>
          <button onClick={() => setTab('detalle')} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === 'detalle' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>Detalle</button>
          <button onClick={() => setTab('contabilidad')} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === 'contabilidad' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>Contabilidad</button>
        </div>
      </div>

      {loading ? <div className="text-center py-12 text-gray-400">Cargando...</div> : tab === 'dashboard' ? (
        <DashboardTab dashData={dashData} flujoCaja={flujoCaja} transacciones={transacciones} onDownloadDoc={downloadDoc} />
      ) : tab === 'contabilidad' ? (
        <ContabilidadTab libroDiario={libroDiario} balanceComp={balanceComp} backfilling={backfilling}
          onBackfill={async () => {
            if (!confirm('¿Ejecutar backfill de asientos contables históricos? Este proceso es seguro e idempotente.')) return
            setBackfilling(true)
            try {
              const { data } = await api.post('/finanzas/contabilidad/backfill')
              toast.success(`Backfill completado: ${Object.entries(data).filter(([k]) => k !== 'verificacion' && k !== 'errores').map(([k, v]) => `${k}: ${v}`).join(', ')}`)
              if (data.verificacion && !data.verificacion.balanceado) toast.error('¡Balance no cuadra! Revisar.')
              load()
            } catch { toast.error('Error en backfill') }
            finally { setBackfilling(false) }
          }}
        />
      ) : (
        <DetalleTab
          ingresosTree={ingresosTree} egresosTree={egresosTree} movimientos={movimientos}
          expanded={expanded} toggleExpand={toggleExpand}
          onAdd={openAdd} onEdit={openEdit} onDelete={handleDelete}
          copiando={copiando} copiarRecurrentes={copiarRecurrentes}
        />
      )}

      {/* Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editId ? 'Editar Transacción' : 'Nueva Transacción'} wide>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Categoría</label>
              <select value={form.categoria_id} onChange={e => setForm(f => ({ ...f, categoria_id: e.target.value }))} className="input-field" required>
                <option value="">Seleccionar...</option>
                <optgroup label="Ingresos">
                  {leaves.filter(l => l.tipo === 'INGRESO').map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                </optgroup>
                <optgroup label="Egresos">
                  {leaves.filter(l => l.tipo === 'EGRESO').map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                </optgroup>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
              <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} className="input-field" required placeholder="Ej: DigitalOcean, AFP Habitat" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Monto</label>
              <input type="number" value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))} className="input-field" required min="0" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Moneda</label>
              <select value={form.moneda} onChange={e => setForm(f => ({ ...f, moneda: e.target.value }))} className="input-field">
                <option value="CLP">CLP</option><option value="USD">USD</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
              <select value={form.estado} onChange={e => setForm(f => ({ ...f, estado: e.target.value }))} className="input-field">
                <option value="PENDIENTE">Pendiente</option><option value="PAGADO">Pagado</option><option value="VENCIDO">Vencido</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Proveedor</label>
              <input value={form.proveedor} onChange={e => setForm(f => ({ ...f, proveedor: e.target.value }))} className="input-field" placeholder="Opcional" />
            </div>
            <div className="flex items-end gap-4 pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.recurrente} onChange={e => setForm(f => ({ ...f, recurrente: e.target.checked }))} className="rounded border-gray-300" />
                <span className="text-sm text-gray-700">Recurrente (mensual)</span>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fecha vencimiento</label>
              <input type="date" value={form.fecha_vencimiento} onChange={e => setForm(f => ({ ...f, fecha_vencimiento: e.target.value }))} className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fecha pago</label>
              <input type="date" value={form.fecha_pago} onChange={e => setForm(f => ({ ...f, fecha_pago: e.target.value }))} className="input-field" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Documento de respaldo</label>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 cursor-pointer">
                <Upload size={14} />
                <span>{docFile ? docFile.name : 'Seleccionar archivo'}</span>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" onChange={e => setDocFile(e.target.files?.[0] || null)} />
              </label>
              {docFile && <button type="button" onClick={() => setDocFile(null)} className="text-gray-400 hover:text-red-500"><X size={16} /></button>}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notas</label>
            <textarea value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} className="input-field" rows={2} placeholder="Opcional" />
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancelar</button>
            <button type="submit" className="btn-primary">{editId ? 'Guardar' : 'Crear'}</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

// ── Dashboard Tab ──

function DashboardTab({ dashData, flujoCaja, transacciones, onDownloadDoc }) {
  if (!dashData) return <div className="text-center py-12 text-gray-400">Sin datos</div>

  return (
    <div className="space-y-6">
      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <SummaryCard label="Total Ingresos" value={dashData.total_ingresos} prev={dashData.total_ingresos_anterior} color="green"
          sub={`Sellers: ${fmt(dashData.ingreso_operacional)} | Otros: ${fmt(dashData.ingreso_no_operacional)}`} />
        <SummaryCard label="Total Egresos" value={dashData.total_egresos} prev={dashData.total_egresos_anterior} color="red" invertTrend
          sub={`Drivers+Pickups: ${fmt(dashData.costo_operacional)} | Gastos op.: ${fmt(dashData.gasto_operacional)}`} />
        <SummaryCard label="Margen Neto" value={dashData.margen_neto} prev={dashData.margen_neto_anterior}
          color={dashData.margen_neto >= 0 ? 'green' : 'red'} />
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Estado</p>
          <div className="flex gap-6 mt-2">
            <div><span className="text-2xl font-bold text-amber-600">{dashData.pendientes}</span><span className="text-xs text-gray-500 ml-1">pendientes</span></div>
            <div><span className="text-2xl font-bold text-red-600">{dashData.vencidos}</span><span className="text-xs text-gray-500 ml-1">vencidos</span></div>
          </div>
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Flujo de Caja Real</p>
            <p className={`text-lg font-bold ${dashData.flujo_caja.neto >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(dashData.flujo_caja.neto)}</p>
            <p className="text-xs text-gray-400">Entradas: {fmt(dashData.flujo_caja.entradas)} | Salidas: {fmt(dashData.flujo_caja.salidas)}</p>
          </div>
        </div>
      </div>

      {/* Chart */}
      <SimpleChart data={dashData.chart} />

      {/* Flujo de Caja Proyectado */}
      {flujoCaja && flujoCaja.semanas && flujoCaja.semanas.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Flujo de Caja Proyectado</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-gray-500 text-xs uppercase border-b">
                <th className="py-2 pr-4">Semana</th><th className="py-2 pr-4 text-right">Ingresos</th><th className="py-2 pr-4 text-right">Egresos</th><th className="py-2 pr-4 text-right">Neto</th><th className="py-2 text-right">Saldo Acum.</th>
              </tr></thead>
              <tbody>
                {flujoCaja.semanas.map((s, i) => (
                  <tr key={i} className={`border-b border-gray-50 ${s.es_proyeccion ? 'bg-blue-50/50 italic' : ''}`}>
                    <td className="py-2 pr-4 font-medium">{typeof s.semana === 'number' ? `Semana ${s.semana}` : s.semana}</td>
                    <td className="py-2 pr-4 text-right text-green-600">{fmt(s.ingresos)}</td>
                    <td className="py-2 pr-4 text-right text-red-600">{fmt(s.egresos)}</td>
                    <td className={`py-2 pr-4 text-right font-medium ${s.neto >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(s.neto)}</td>
                    <td className={`py-2 text-right font-bold ${s.saldo_acumulado >= 0 ? 'text-green-700' : 'text-red-700'}`}>{fmt(s.saldo_acumulado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Transacciones recientes */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Transacciones Recientes</h3>
        {transacciones.length === 0 ? <p className="text-gray-400 text-sm">Sin transacciones este período</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-gray-500 text-xs uppercase border-b">
                <th className="py-2 pr-3">Fecha</th><th className="py-2 pr-3">Descripción</th><th className="py-2 pr-3">Fuente</th><th className="py-2 pr-3 text-right">Monto</th><th className="py-2 pr-3 text-center">Estado</th><th className="py-2 w-10"></th>
              </tr></thead>
              <tbody>
                {transacciones.map(t => (
                  <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 pr-3 text-gray-500">{t.fecha || '—'}</td>
                    <td className="py-2 pr-3 font-medium text-gray-900">{t.descripcion}</td>
                    <td className="py-2 pr-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${FUENTE_BADGE[t.fuente] || 'bg-gray-100 text-gray-700'}`}>{t.fuente}</span></td>
                    <td className={`py-2 pr-3 text-right font-medium ${t.tipo === 'INGRESO' ? 'text-green-600' : 'text-red-600'}`}>
                      <span className="inline-flex items-center gap-1">
                        {t.tipo === 'INGRESO' ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{fmt(t.monto)}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-center"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ESTADO_BADGE[t.estado] || 'bg-gray-100'}`}>{t.estado}</span></td>
                    <td className="py-2">{t.tiene_documento && <button onClick={() => onDownloadDoc(t.id.replace('mov-', ''))} className="p-1 rounded hover:bg-blue-100 text-blue-600"><Download size={14} /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Detalle Tab ──

function DetalleTab({ ingresosTree, egresosTree, movimientos, expanded, toggleExpand, onAdd, onEdit, onDelete, copiando, copiarRecurrentes }) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={copiarRecurrentes} disabled={copiando} className="btn-secondary flex items-center gap-2 text-sm">
          <Copy size={14} />{copiando ? 'Copiando...' : 'Copiar recurrentes al mes siguiente'}
        </button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-green-700 uppercase tracking-wider mb-3 flex items-center gap-2"><TrendingUp size={16} /> Ingresos</h2>
          {ingresosTree.map(node => <CategoriaNode key={node.id} node={node} movimientos={movimientos} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} expanded={expanded} toggleExpand={toggleExpand} />)}
          {ingresosTree.length === 0 && <p className="text-gray-400 text-sm">Sin categorías de ingreso</p>}
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-red-700 uppercase tracking-wider mb-3 flex items-center gap-2"><TrendingDown size={16} /> Egresos</h2>
          {egresosTree.map(node => <CategoriaNode key={node.id} node={node} movimientos={movimientos} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} expanded={expanded} toggleExpand={toggleExpand} />)}
          {egresosTree.length === 0 && <p className="text-gray-400 text-sm">Sin categorías de egreso</p>}
        </div>
      </div>
    </div>
  )
}

// ── Contabilidad Tab ──

const TIPO_COLOR = {
  ACTIVO: 'text-blue-700 bg-blue-50',
  PASIVO: 'text-orange-700 bg-orange-50',
  PATRIMONIO: 'text-purple-700 bg-purple-50',
  INGRESO: 'text-green-700 bg-green-50',
  GASTO: 'text-red-700 bg-red-50',
}

function ContabilidadTab({ libroDiario, balanceComp, backfilling, onBackfill }) {
  const [glTab, setGlTab] = useState('balance')

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          <button onClick={() => setGlTab('balance')} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${glTab === 'balance' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>Balance Comprobación</button>
          <button onClick={() => setGlTab('diario')} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${glTab === 'diario' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>Libro Diario</button>
        </div>
        <button onClick={onBackfill} disabled={backfilling} className="ml-auto btn-secondary flex items-center gap-2 text-sm">
          <RefreshCw size={14} className={backfilling ? 'animate-spin' : ''} />
          {backfilling ? 'Procesando...' : 'Backfill Histórico'}
        </button>
      </div>

      {glTab === 'balance' ? (
        <BalanceComprobacion data={balanceComp} />
      ) : (
        <LibroDiario data={libroDiario} />
      )}
    </div>
  )
}

function BalanceComprobacion({ data }) {
  if (!data || !data.cuentas) return <div className="text-center py-12 text-gray-400">Sin datos contables para este período</div>

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2"><BookOpen size={16} /> Balance de Comprobación</h3>
        <span className={`text-xs px-3 py-1 rounded-full font-medium ${data.balanceado ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {data.balanceado ? 'Balanceado' : 'Desbalanceado'}
        </span>
      </div>

      {data.cuentas.length === 0 ? (
        <p className="text-gray-400 text-sm py-8 text-center">No hay asientos contables para este período. Usa el botón "Backfill Histórico" para generar los asientos desde las operaciones existentes.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase border-b">
                <th className="py-2 pr-3">Código</th>
                <th className="py-2 pr-3">Cuenta</th>
                <th className="py-2 pr-3 text-center">Tipo</th>
                <th className="py-2 pr-3 text-right">Debe</th>
                <th className="py-2 pr-3 text-right">Haber</th>
                <th className="py-2 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {data.cuentas.map(c => (
                <tr key={c.cuenta_id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 pr-3 font-mono text-gray-500">{c.codigo}</td>
                  <td className="py-2 pr-3 font-medium text-gray-900">{c.nombre}</td>
                  <td className="py-2 pr-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TIPO_COLOR[c.tipo] || 'bg-gray-100'}`}>{c.tipo}</span>
                  </td>
                  <td className="py-2 pr-3 text-right font-medium">{fmt(c.debe)}</td>
                  <td className="py-2 pr-3 text-right font-medium">{fmt(c.haber)}</td>
                  <td className={`py-2 text-right font-bold ${c.saldo >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(c.saldo)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300 font-bold">
                <td className="py-3" colSpan={3}>TOTALES</td>
                <td className="py-3 text-right">{fmt(data.total_debe)}</td>
                <td className="py-3 text-right">{fmt(data.total_haber)}</td>
                <td className="py-3 text-right">{fmt(data.total_debe - data.total_haber)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

function LibroDiario({ data }) {
  if (!data || !data.asientos) return <div className="text-center py-12 text-gray-400">Sin datos</div>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2"><BookOpen size={16} /> Libro Diario</h3>
        <span className="text-xs text-gray-400">{data.total} asientos en este período</span>
      </div>

      {data.asientos.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center text-gray-400 text-sm">
          No hay asientos contables para este período.
        </div>
      ) : data.asientos.map(a => (
        <div key={a.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <span className="text-sm font-medium text-gray-900">{a.descripcion}</span>
              <span className="ml-2 text-xs text-gray-400">#{a.id}</span>
              {a.es_backfill && <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">backfill</span>}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400">{a.fecha}</span>
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{a.ref_tipo}</span>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase border-b">
                <th className="py-1.5 pr-3">Cuenta</th>
                <th className="py-1.5 pr-3 text-right">Debe</th>
                <th className="py-1.5 text-right">Haber</th>
              </tr>
            </thead>
            <tbody>
              {a.lineas.map((l, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-1.5 pr-3">
                    <span className="font-mono text-gray-500 text-xs mr-2">{l.cuenta_codigo}</span>
                    <span className="text-gray-900">{l.cuenta_nombre}</span>
                  </td>
                  <td className="py-1.5 pr-3 text-right font-medium">{l.debe > 0 ? fmt(l.debe) : ''}</td>
                  <td className="py-1.5 text-right font-medium">{l.haber > 0 ? fmt(l.haber) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
