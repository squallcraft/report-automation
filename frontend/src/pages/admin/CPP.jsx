import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import { Store, Download, Upload, FileText, X, Check, AlertCircle, ChevronDown, Eye, CheckCircle, XCircle, Clock, TrendingUp, Banknote, Wallet, CalendarCheck, Hourglass } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import UltimaActividad from '../../components/UltimaActividad'

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const SEMANAS = [1, 2, 3, 4, 5]
const ESTADO_COLORS = {
  PENDIENTE: 'bg-amber-100 text-amber-800',
  PAGADO: 'bg-green-100 text-green-800',
  INCOMPLETO: 'bg-red-100 text-red-800',
}
const FACTURA_ESTADO_CONFIG = {
  SIN_FACTURA: { label: 'Sin factura', icon: Clock, cls: 'text-gray-500 bg-gray-100' },
  CARGADA: { label: 'Por revisar', icon: AlertCircle, cls: 'text-blue-700 bg-blue-100' },
  APROBADA: { label: 'Aprobada', icon: CheckCircle, cls: 'text-emerald-700 bg-emerald-100' },
  RECHAZADA: { label: 'Rechazada', icon: XCircle, cls: 'text-red-700 bg-red-100' },
}

function fmt(v) {
  if (!v && v !== 0) return '$0'
  return `$${Math.abs(Number(v)).toLocaleString('es-CL')}`
}

const BANCOS_TEF_VALIDOS = new Set([
  'banco de chile', 'banco internacional',
  'scotiabank', 'banco scotiabank', 'scotiabank chile',
  'banco bice', 'bice',
  'banco estado', 'banco estado de chile', 'bancoestado',
  'bci', 'banco bci', 'banco de credito e inversiones',
  'itau', 'itaú', 'banco itau', 'itaucorpbanca', 'itau corpbanca', 'corpbanca',
  'security', 'banco security',
  'santander', 'banco santander', 'santander chile',
  'consorcio', 'banco consorcio',
  'falabella', 'banco falabella',
  'ripley', 'banco ripley',
  'coopeuch', 'prepago los heroes', 'prepago los héroes',
  'tenpo', 'copec pay', 'mach', 'machbank', 'mercado pago', 'mercadopago',
])

// ---------------------------------------------------------------------------
// Modal TEF para pickups
// ---------------------------------------------------------------------------
function ModalTEF({ semana, mes, anio, pickups, onClose }) {
  const [items, setItems] = useState(() =>
    pickups.map(p => ({
      pickup_id: p.pickup_id,
      pickup_nombre: p.pickup_nombre,
      rut: p.rut,
      banco: p.banco,
      numero_cuenta: p.numero_cuenta,
      liquidado: p.semanas?.[String(semana)]?.monto_neto || 0,
      monto: p.semanas?.[String(semana)]?.monto_neto || 0,
      incluir: (p.semanas?.[String(semana)]?.monto_neto || 0) > 0,
    }))
  )
  const [porcentaje, setPorcentaje] = useState('')
  const [cargando, setCargando] = useState(false)

  const aplicarPorcentaje = () => {
    const pct = parseFloat(porcentaje)
    if (isNaN(pct) || pct <= 0 || pct > 100) return
    setItems(prev => prev.map(it => ({ ...it, monto: Math.round(it.liquidado * pct / 100) })))
  }

  const toggle = (id) => setItems(prev => prev.map(it => it.pickup_id === id ? { ...it, incluir: !it.incluir } : it))
  const setMonto = (id, val) => setItems(prev => prev.map(it => it.pickup_id === id ? { ...it, monto: Number(val) || 0 } : it))
  const seleccionados = items.filter(it => it.incluir)
  const totalTEF = seleccionados.reduce((a, it) => a + it.monto, 0)
  const todosSeleccionados = items.length > 0 && items.every(it => it.incluir)

  const descargar = async () => {
    if (!seleccionados.length) return toast.error('Selecciona al menos un destinatario')
    const sinDatos = seleccionados.filter(it => !it.banco || !it.numero_cuenta)
    if (sinDatos.length) {
      toast.error(`Sin datos bancarios: ${sinDatos.map(d => d.pickup_nombre).join(', ')}`)
      return
    }
    setCargando(true)
    try {
      const { data } = await api.post('/cpp/generar-tef',
        { semana, mes, anio, items: seleccionados.map(it => ({ pickup_id: it.pickup_id, monto: it.monto })) },
        { responseType: 'blob' }
      )
      const url = URL.createObjectURL(new Blob([data], { type: 'text/plain' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `TEF_Pickups_${anio}${String(mes).padStart(2, '0')}_S${semana}.txt`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Archivo TEF descargado')
    } catch { toast.error('Error generando archivo TEF') }
    finally { setCargando(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Planilla de Pagos TEF — Pickups</h2>
            <p className="text-sm text-gray-500">Semana {semana} · {MESES[mes]} {anio}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
        </div>

        <div className="px-6 py-3 border-b border-gray-100 flex flex-wrap items-center gap-3">
          <span className="text-sm text-gray-600">Aplicar % a todos:</span>
          <input type="number" min="1" max="100" placeholder="ej: 50"
            className="input w-24 text-sm" value={porcentaje}
            onChange={e => setPorcentaje(e.target.value)} />
          <button onClick={aplicarPorcentaje} className="btn btn-secondary text-sm py-1.5">Aplicar</button>
          <button onClick={() => setItems(prev => prev.map(it => ({ ...it, monto: it.liquidado })))}
            className="btn btn-secondary text-sm py-1.5">Reset 100%</button>
          <span className="ml-auto text-sm font-semibold text-blue-700">Total: {fmt(totalTEF)}</span>
        </div>

        <div className="flex-1 overflow-auto px-6 py-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-200">
                <th className="py-2 w-8">
                  <input type="checkbox" checked={todosSeleccionados}
                    onChange={e => setItems(prev => prev.map(it => ({ ...it, incluir: e.target.checked })))}
                    className="w-3.5 h-3.5 accent-primary-600" />
                </th>
                <th className="py-2 text-left font-medium">Pickup</th>
                <th className="py-2 text-left font-medium">Banco</th>
                <th className="py-2 text-right font-medium">Liquidado</th>
                <th className="py-2 text-right font-medium w-36">Monto a pagar</th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.pickup_id} className={`border-b border-gray-100 ${!it.incluir ? 'opacity-40' : ''}`}>
                  <td className="py-2">
                    <input type="checkbox" checked={it.incluir} onChange={() => toggle(it.pickup_id)}
                      className="w-4 h-4 accent-primary-600" />
                  </td>
                  <td className="py-2">
                    <span className="font-medium">{it.pickup_nombre}</span>
                    {!it.banco && <span className="text-xs text-red-400 font-medium ml-2">sin datos bancarios</span>}
                  </td>
                  <td className="py-2 text-xs text-gray-500">
                    {it.banco ? `${it.banco} · ${it.numero_cuenta || '—'}` : '—'}
                  </td>
                  <td className="py-2 text-right font-mono text-gray-600">{fmt(it.liquidado)}</td>
                  <td className="py-2 text-right">
                    <input type="number" min="0" className="input text-right text-sm w-32 font-mono"
                      value={it.monto} disabled={!it.incluir}
                      onChange={e => setMonto(it.pickup_id, e.target.value)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button onClick={onClose} className="btn btn-secondary">Cancelar</button>
          <button onClick={descargar} disabled={cargando} className="btn btn-primary flex items-center gap-2">
            <Download size={16} /> {cargando ? 'Generando...' : 'Descargar TEF'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Modal cartola pickups
// ---------------------------------------------------------------------------
function ModalCartola({ mes, anio, onClose, onConfirmado }) {
  const [semana, setSemana] = useState(1)
  const [archivo, setArchivo] = useState(null)
  const [preview, setPreview] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [items, setItems] = useState([])
  const [todosPickups, setTodosPickups] = useState([])
  const inputRef = useRef()

  const cargarPreview = async () => {
    if (!archivo) return toast.error('Selecciona un archivo')
    setCargando(true)
    try {
      const form = new FormData()
      form.append('archivo', archivo)
      const { data } = await api.post('/cpp/cartola/preview', form, { params: { semana, mes, anio } })
      setPreview(data)
      setTodosPickups(data.pickups || [])
      setItems(data.items.map(it => ({
        ...it,
        incluir: it.pickup_id != null && !it.ya_existe,
        pickup_id_sel: it.pickup_id,
        pickup_nombre_sel: it.pickup_nombre,
      })))
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Error procesando cartola')
    } finally { setCargando(false) }
  }

  const toggleItem = (idx) =>
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, incluir: !it.incluir } : it))

  const cambiarPickup = (idx, pickupId) => {
    const p = todosPickups.find(x => x.id === Number(pickupId))
    setItems(prev => prev.map((it, i) => i === idx ? {
      ...it,
      pickup_id_sel: p ? p.id : null,
      pickup_nombre_sel: p ? p.nombre : null,
      incluir: p != null,
    } : it))
  }

  const confirmar = async () => {
    const seleccionados = items.filter(it => it.incluir && it.pickup_id_sel)
    if (!seleccionados.length) return toast.error('No hay items válidos')
    setConfirmando(true)
    try {
      await api.post('/cpp/cartola/confirmar', {
        semana, mes, anio,
        items: seleccionados.map(it => ({
          pickup_id: it.pickup_id_sel, monto: it.monto,
          fecha: it.fecha, descripcion: it.descripcion,
          nombre_extraido: it.nombre_extraido,
          fingerprint: it.fingerprint,
        })),
      })
      toast.success(`${seleccionados.length} pagos registrados`)
      onConfirmado()
      onClose()
    } catch { toast.error('Error confirmando pagos') }
    finally { setConfirmando(false) }
  }

  const totalConfirmar = items.filter(it => it.incluir && it.pickup_id_sel).reduce((a, it) => a + it.monto, 0)
  const totalItems = items.filter(it => it.incluir && it.pickup_id_sel).length

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Cargar Cartola — Pickups</h2>
            <p className="text-sm text-gray-500">{MESES[mes]} {anio}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
        </div>

        <div className="px-6 py-4 border-b border-gray-100 flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Semana</label>
            <select className="input w-32" value={semana} onChange={e => setSemana(Number(e.target.value))}>
              {SEMANAS.map(s => <option key={s} value={s}>Semana {s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Archivo (.xls / .xlsx)</label>
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
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-200">
                    <th className="py-2 w-8"></th>
                    <th className="py-2 text-left font-medium">Nombre en cartola</th>
                    <th className="py-2 text-left font-medium">Pickup asignado</th>
                    <th className="py-2 text-right font-medium">Monto</th>
                    <th className="py-2 text-right font-medium">Ya pagado</th>
                    <th className="py-2 text-right font-medium">Liquidado</th>
                    <th className="py-2 text-center font-medium w-24">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={idx} className={`border-b border-gray-100 text-xs ${!it.incluir ? 'opacity-40' : ''} ${it.ya_existe ? 'bg-red-50/60' : ''}`}>
                      <td className="py-1.5">
                        <input type="checkbox" checked={it.incluir} onChange={() => toggleItem(idx)}
                          className="w-3.5 h-3.5 accent-primary-600" />
                      </td>
                      <td className="py-1.5 max-w-[180px]">
                        <span className="truncate block font-medium text-gray-800" title={it.descripcion}>
                          {it.nombre_extraido}
                        </span>
                        <span className="text-gray-400 text-[10px]">{it.fecha}</span>
                      </td>
                      <td className="py-1.5 min-w-[200px]">
                        <div className="flex items-center gap-1.5">
                          {it.pickup_id_sel ? (
                            it.match_confiable && it.pickup_id_sel === it.pickup_id
                              ? <Check size={11} className="text-green-600 flex-shrink-0" />
                              : <AlertCircle size={11} className="text-amber-500 flex-shrink-0" />
                          ) : (
                            <AlertCircle size={11} className="text-red-400 flex-shrink-0" />
                          )}
                          <select className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white flex-1 min-w-0"
                            value={it.pickup_id_sel ?? ''} onChange={e => cambiarPickup(idx, e.target.value)}>
                            <option value="">— Sin asignar —</option>
                            {todosPickups.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                          </select>
                        </div>
                      </td>
                      <td className="py-1.5 text-right font-mono">{fmt(it.monto)}</td>
                      <td className="py-1.5 text-right font-mono text-blue-600">{it.ya_pagado > 0 ? fmt(it.ya_pagado) : '—'}</td>
                      <td className="py-1.5 text-right font-mono text-gray-600">{it.liquidado > 0 ? fmt(it.liquidado) : '—'}</td>
                      <td className="py-1.5 text-center">
                        {it.ya_existe
                          ? <span className="inline-flex items-center gap-1 text-[10px] font-medium text-red-600 bg-red-100 px-1.5 py-0.5 rounded-full">Ya procesado</span>
                          : <span className="inline-flex items-center gap-1 text-[10px] font-medium text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full">Nuevo</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
              <span className="text-sm text-gray-600">
                {totalItems} pagos · <span className="font-semibold text-gray-800">{fmt(totalConfirmar)}</span>
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

// ---------------------------------------------------------------------------
// Modal facturas pendientes de revisión
// ---------------------------------------------------------------------------
function ModalFacturas({ mes, anio, onClose, onActualizado }) {
  const [facturas, setFacturas] = useState([])
  const [loading, setLoading] = useState(true)
  const [rechazarId, setRechazarId] = useState(null)   // facturaId pendiente de rechazo
  const [notaRechazo, setNotaRechazo] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    setLoading(true)
    api.get('/cpp/facturas', { params: { mes, anio } })
      .then(({ data }) => setFacturas(data))
      .catch(() => toast.error('Error cargando facturas'))
      .finally(() => setLoading(false))
  }, [mes, anio])

  const aprobar = async (facturaId) => {
    try {
      await api.put(`/cpp/facturas/${facturaId}/revisar`, null, { params: { estado: 'APROBADA' } })
      toast.success('Factura aprobada')
      setFacturas(prev => prev.map(f => f.id === facturaId ? { ...f, estado: 'APROBADA' } : f))
      onActualizado()
    } catch { toast.error('Error al aprobar factura') }
  }

  const abrirRechazo = (facturaId) => {
    setRechazarId(facturaId)
    setNotaRechazo('')
  }

  const confirmarRechazo = async () => {
    if (!rechazarId) return
    setGuardando(true)
    try {
      await api.put(`/cpp/facturas/${rechazarId}/revisar`, null, {
        params: { estado: 'RECHAZADA', nota_admin: notaRechazo.trim() || undefined },
      })
      toast.success('Factura rechazada')
      setFacturas(prev => prev.map(f =>
        f.id === rechazarId
          ? { ...f, estado: 'RECHAZADA', nota_admin: notaRechazo.trim() || null }
          : f
      ))
      onActualizado()
      setRechazarId(null)
    } catch { toast.error('Error al rechazar factura') }
    finally { setGuardando(false) }
  }

  const descargar = async (facturaId, nombre) => {
    try {
      const { data } = await api.get(`/cpp/facturas/${facturaId}/descargar`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([data]))
      const a = document.createElement('a')
      a.href = url
      a.download = nombre || 'factura'
      a.click()
      URL.revokeObjectURL(url)
    } catch { toast.error('Error descargando factura') }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Facturas de Pickups</h2>
            <p className="text-sm text-gray-500">{MESES[mes]} {anio}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-4">
          {loading ? (
            <div className="text-center py-12 text-gray-400">Cargando...</div>
          ) : facturas.length === 0 ? (
            <div className="text-center py-12 text-gray-400">No hay facturas cargadas para este período</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-200">
                  <th className="py-2 text-left font-medium">Pickup</th>
                  <th className="py-2 text-left font-medium">Archivo</th>
                  <th className="py-2 text-right font-medium">Monto</th>
                  <th className="py-2 text-center font-medium">Estado</th>
                  <th className="py-2 text-left font-medium">Nota</th>
                  <th className="py-2 font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {facturas.map(f => {
                  const cfg = FACTURA_ESTADO_CONFIG[f.estado] || FACTURA_ESTADO_CONFIG.SIN_FACTURA
                  const Icon = cfg.icon
                  return (
                    <tr key={f.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 font-medium">{f.pickup_nombre}</td>
                      <td className="py-2">
                        <button onClick={() => descargar(f.id, f.archivo_nombre)}
                          className="text-blue-600 hover:underline text-xs flex items-center gap-1">
                          <Eye size={12} /> {f.archivo_nombre || 'Ver'}
                        </button>
                      </td>
                      <td className="py-2 text-right font-mono">{fmt(f.monto_neto)}</td>
                      <td className="py-2 text-center">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.cls}`}>
                          <Icon size={11} /> {cfg.label}
                        </span>
                      </td>
                      <td className="py-2 text-xs text-gray-500 max-w-[150px] truncate">{f.nota_pickup || '—'}</td>
                      <td className="py-2">
                        {f.estado === 'CARGADA' && (
                          <div className="flex gap-1.5">
                            <button onClick={() => aprobar(f.id)}
                              className="p-1 rounded hover:bg-emerald-100 text-emerald-600" title="Aprobar">
                              <CheckCircle size={16} />
                            </button>
                            <button onClick={() => abrirRechazo(f.id)}
                              className="p-1 rounded hover:bg-red-100 text-red-500" title="Rechazar">
                              <XCircle size={16} />
                            </button>
                          </div>
                        )}
                        {f.estado === 'RECHAZADA' && f.nota_admin && (
                          <span className="text-[10px] text-red-500">{f.nota_admin}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
          <button onClick={onClose} className="btn btn-secondary">Cerrar</button>
        </div>
      </div>

      {/* Mini-modal de rechazo */}
      {rechazarId && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <XCircle size={18} className="text-red-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900">Rechazar factura</h3>
                <p className="text-xs text-gray-500">El pickup verá este mensaje en su portal</p>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Motivo del rechazo <span className="text-gray-400">(opcional)</span>
              </label>
              <input
                type="text"
                className="input w-full text-sm"
                placeholder="Ej: Monto no coincide, adjunto incorrecto..."
                value={notaRechazo}
                onChange={e => setNotaRechazo(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && confirmarRechazo()}
                autoFocus
              />
            </div>
            <div className="flex gap-3 justify-end pt-1">
              <button onClick={() => setRechazarId(null)} className="btn btn-secondary text-sm">Cancelar</button>
              <button onClick={confirmarRechazo} disabled={guardando}
                className="btn flex items-center gap-1.5 bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 text-sm">
                <XCircle size={14} /> {guardando ? 'Rechazando...' : 'Confirmar rechazo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Fila de pickup en la tabla principal
// ---------------------------------------------------------------------------
function PickupRow({ p, semanas, pagados, onUpdateEstado }) {
  const pPagados = pagados[String(p.pickup_id)] || {}
  const facturaCfg = FACTURA_ESTADO_CONFIG[p.factura_estado] || FACTURA_ESTADO_CONFIG.SIN_FACTURA
  const FacturaIcon = facturaCfg.icon
  const subtotal = semanas.reduce((acc, sem) => acc + (p.semanas[String(sem)]?.monto_neto || 0), 0)

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50">
      <td className="py-2 px-4">
        <div>
          <span className="font-medium text-gray-800">{p.pickup_nombre}</span>
          {p.rut && <span className="text-xs text-gray-400 ml-2">{p.rut}</span>}
        </div>
      </td>
      <td className="py-2 px-4 text-center">
        {p.banco ? (
          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded"
            title={`${p.tipo_cuenta || ''} ${p.numero_cuenta || ''}`}>{p.banco}</span>
        ) : (
          <span className="text-xs text-gray-300">Sin datos</span>
        )}
      </td>
      <td className="py-2 px-2 text-center">
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${facturaCfg.cls}`}>
          <FacturaIcon size={10} /> {facturaCfg.label}
        </span>
      </td>
      {semanas.map(sem => {
        const semData = p.semanas[String(sem)] || { monto_neto: 0, estado: 'PENDIENTE' }
        const pagadoSem = pPagados[String(sem)] || 0
        const completo = pagadoSem > 0 && pagadoSem >= semData.monto_neto
        return (
          <React.Fragment key={`${p.pickup_id}-${sem}`}>
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
                    onChange={e => onUpdateEstado(p.pickup_id, sem, e.target.value)}
                  >
                    <option value="PENDIENTE">Pendiente</option>
                    <option value="PAGADO">Pagado</option>
                    <option value="INCOMPLETO">Incompleto</option>
                  </select>
                )}
              </div>
            </td>
            <td className="py-2 px-2 text-right">
              {pagadoSem > 0 ? (
                <span className={`font-mono text-xs font-semibold ${completo ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {fmt(pagadoSem)}
                </span>
              ) : (
                <span className="text-xs text-gray-300">—</span>
              )}
            </td>
          </React.Fragment>
        )
      })}
      <td className="py-2 px-4 text-right font-semibold text-gray-800 font-mono">{fmt(subtotal)}</td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Página principal CPP
// ---------------------------------------------------------------------------
export default function CPP() {
  const now = new Date()
  const [mes, setMes] = useState(now.getMonth() + 1)
  const [anio, setAnio] = useState(now.getFullYear())
  const [data, setData] = useState(null)
  const [pagados, setPagados] = useState({})
  const [loading, setLoading] = useState(true)
  const [filterText, setFilterText] = useState('')
  const [filterSemanas, setFilterSemanas] = useState(new Set())
  const [filterEstado, setFilterEstado] = useState('')
  const [sortMonto, setSortMonto] = useState(null)
  const [modalTEF, setModalTEF] = useState(null)
  const [modalCartola, setModalCartola] = useState(false)
  const [modalFacturas, setModalFacturas] = useState(false)

  const reqId = useRef(0)

  const cargar = useCallback((silencioso = false) => {
    const id = ++reqId.current
    if (!silencioso) setLoading(true)
    Promise.all([
      api.get('/cpp/tabla', { params: { mes, anio } }),
      api.get('/cpp/pagos-acumulados', { params: { mes, anio } }),
    ])
      .then(([tablaRes, pagadosRes]) => {
        if (id !== reqId.current) return
        setData(tablaRes.data)
        setPagados(pagadosRes.data || {})
      })
      .catch(() => { if (id === reqId.current) toast.error('Error cargando CPP') })
      .finally(() => { if (id === reqId.current) setLoading(false) })
  }, [mes, anio])

  useEffect(() => { cargar() }, [cargar])

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

  const pickups = useMemo(() => {
    if (!data?.pickups) return []
    const semanasAll = data.semanas_disponibles || []
    let result = data.pickups

    if (filterText) {
      const q = filterText.toLowerCase()
      result = result.filter(p => p.pickup_nombre.toLowerCase().includes(q))
    }

    if (filterEstado) {
      const semanasACheck = filterSemanas.size === 1 ? [...filterSemanas] : semanasAll
      result = result.filter(p =>
        semanasACheck.some(sem => {
          const semData = p.semanas[String(sem)]
          return semData && semData.monto_neto > 0 && semData.estado === filterEstado
        })
      )
    }

    if (sortMonto) {
      const semList = filterSemanas.size > 0 ? [...filterSemanas] : semanasAll
      result = [...result].sort((a, b) => {
        const subA = semList.reduce((acc, s) => acc + (a.semanas[String(s)]?.monto_neto || 0), 0)
        const subB = semList.reduce((acc, s) => acc + (b.semanas[String(s)]?.monto_neto || 0), 0)
        return sortMonto === 'desc' ? subB - subA : subA - subB
      })
    }

    return result
  }, [data, filterText, filterEstado, filterSemanas, sortMonto])

  const updateEstado = async (pickupId, semana, estado) => {
    setData(prev => {
      if (!prev) return prev
      return {
        ...prev,
        pickups: prev.pickups.map(p => {
          if (p.pickup_id !== pickupId) return p
          return {
            ...p,
            semanas: {
              ...p.semanas,
              [String(semana)]: { ...p.semanas[String(semana)], estado },
            },
          }
        }),
      }
    })
    try {
      await api.put(`/cpp/pago-semana/${pickupId}`, { estado }, { params: { semana, mes, anio } })
    } catch {
      toast.error('Error actualizando estado')
      cargar(true)
    }
  }

  const totalesGenerales = useMemo(() => {
    if (!pickups.length) return { neto: 0, pagado: 0 }
    const activas = filterSemanas.size > 0 ? filterSemanas : null
    return pickups.reduce((acc, p) => {
      let neto = 0, pagado = 0
      Object.entries(p.semanas || {}).forEach(([sem, s]) => {
        if (activas && !activas.has(Number(sem))) return
        neto += s.monto_neto || 0
        if (s.estado === 'PAGADO') pagado += s.monto_neto || 0
      })
      return { neto: acc.neto + neto, pagado: acc.pagado + pagado }
    }, { neto: 0, pagado: 0 })
  }, [pickups, filterSemanas])

  const estadoConteo = useMemo(() => {
    const counts = { PENDIENTE: 0, PAGADO: 0, INCOMPLETO: 0 }
    const activas = filterSemanas.size > 0 ? filterSemanas : null
    pickups.forEach(p => {
      semanas.forEach(sem => {
        if (activas && !activas.has(sem)) return
        const s = p.semanas[String(sem)]
        if (s && s.monto_neto > 0) counts[s.estado] = (counts[s.estado] || 0) + 1
      })
    })
    return counts
  }, [pickups, semanas, filterSemanas])

  const facturasPendientes = useMemo(() =>
    (data?.pickups || []).filter(p => p.factura_estado === 'CARGADA').length
  , [data])

  return (
    <div className="flex flex-col h-full gap-4">
      <PageHeader
        title="CPP — Control de Pagos a Pickups"
        subtitle="Seguimiento semanal de egresos a pickup partners"
        icon={Store}
        accent="teal"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setModalFacturas(true)}
              className="btn btn-secondary flex items-center gap-2 text-sm relative">
              <FileText size={15} /> Facturas
              {facturasPendientes > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-blue-600 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-bold">
                  {facturasPendientes}
                </span>
              )}
            </button>
            <button onClick={() => setModalCartola(true)} className="btn btn-secondary flex items-center gap-2 text-sm">
              <Upload size={15} /> Cargar Cartola
            </button>
            {semanas.length > 0 && (
              <div className="relative group">
                <button className="btn btn-primary flex items-center gap-2 text-sm">
                  <FileText size={15} /> Planilla TEF <ChevronDown size={14} />
                </button>
                <div className="absolute right-0 top-full mt-1 bg-white shadow-lg border border-gray-200 rounded-lg z-10 hidden group-hover:block min-w-[130px]">
                  {semanas.map(s => (
                    <button key={s} onClick={() => setModalTEF(s)}
                      className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-50">
                      Semana {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        }
      />

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
          <input type="text" placeholder="Buscar pickup..." className="input w-48"
            value={filterText} onChange={e => setFilterText(e.target.value)} />
          <div className="flex items-center gap-1">
            {[
              { value: '', label: 'Todos' },
              { value: 'PENDIENTE', label: 'Por pagar', active: 'bg-amber-100 text-amber-800 border-amber-400 font-semibold' },
              { value: 'PAGADO', label: 'Pagados', active: 'bg-green-100 text-green-800 border-green-400 font-semibold' },
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
            <div className="flex items-center gap-1.5 ml-auto">
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
        </div>
      </div>

      <div className="px-1">
        <UltimaActividad endpoint="/cpp/ultima-actividad" mes={mes} anio={anio} />
      </div>

      {pickups.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-2xl p-4 flex items-center gap-3 shadow-sm text-white" style={{background:'linear-gradient(135deg,#1e40af,#3b82f6)'}}>
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
              <TrendingUp size={18} className="text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] text-white/70 uppercase tracking-wider font-medium leading-none mb-1">Total Egresos</p>
              <p className="text-base font-bold leading-tight truncate">{fmt(totalesGenerales.neto)}</p>
            </div>
          </div>
          <div className="rounded-2xl p-4 flex items-center gap-3 shadow-sm text-white" style={{background:'linear-gradient(135deg,#065f46,#10b981)'}}>
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
              <Banknote size={18} className="text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] text-white/70 uppercase tracking-wider font-medium leading-none mb-1">Total Pagado</p>
              <p className="text-base font-bold leading-tight truncate">{fmt(totalesGenerales.pagado)}</p>
            </div>
          </div>
          <div className="rounded-2xl p-4 flex items-center gap-3 shadow-sm text-white" style={{background:'linear-gradient(135deg,#14532d,#22c55e)'}}>
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
              <CalendarCheck size={18} className="text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] text-white/70 uppercase tracking-wider font-medium leading-none mb-1">Sem. Pagadas</p>
              <p className="text-base font-bold leading-tight">{estadoConteo.PAGADO}</p>
            </div>
          </div>
          <div className="rounded-2xl p-4 flex items-center gap-3 shadow-sm text-white" style={{background:'linear-gradient(135deg,#78350f,#f59e0b)'}}>
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
              <Hourglass size={18} className="text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] text-white/70 uppercase tracking-wider font-medium leading-none mb-1">Pendientes</p>
              <p className="text-base font-bold leading-tight">{estadoConteo.PENDIENTE}</p>
            </div>
          </div>
        </div>
      )}

      {loading && !data ? (
        <div className="text-center py-12 text-gray-400">Cargando...</div>
      ) : !data || pickups.length === 0 ? (
        <div className="card text-center py-12 text-gray-400">
          No hay datos de pagos para {MESES[mes]} {anio}
        </div>
      ) : (
        <div className="card overflow-hidden p-0 flex-1 min-h-0">
          <div className="overflow-auto h-full">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50">
                <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                  <th className="pb-2 pt-3 px-4 font-medium">Pickup</th>
                  <th className="pb-2 pt-3 px-4 font-medium text-center">Banco</th>
                  <th className="pb-2 pt-3 px-2 font-medium text-center">Factura</th>
                  {semanasVisibles.map(s => (
                    <th key={s} className="pb-2 pt-3 px-2 font-medium text-right" colSpan={2}>
                      Sem {s}
                    </th>
                  ))}
                  <th className="pb-2 pt-3 px-4 font-medium text-right cursor-pointer select-none hover:text-primary-600"
                    onClick={() => setSortMonto(s => s === 'desc' ? 'asc' : s === 'asc' ? null : 'desc')}
                    title="Ordenar por monto">
                    Subtotal {sortMonto === 'desc' ? ' ↓' : sortMonto === 'asc' ? ' ↑' : ''}
                  </th>
                </tr>
                <tr className="text-[10px] text-gray-400 border-b border-gray-200 bg-gray-50">
                  <th /><th /><th />
                  {semanasVisibles.map(s => (
                    <React.Fragment key={`h2-${s}`}>
                      <th className="pb-1 px-2 text-right font-normal">Liq.</th>
                      <th className="pb-1 px-2 text-right font-normal text-emerald-600">Pagado</th>
                    </React.Fragment>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {pickups.map(p => (
                  <PickupRow key={p.pickup_id} p={p} semanas={semanasVisibles}
                    pagados={pagados} onUpdateEstado={updateEstado} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modalTEF && (
        <ModalTEF semana={modalTEF} mes={mes} anio={anio} pickups={pickups}
          onClose={() => setModalTEF(null)} />
      )}
      {modalCartola && (
        <ModalCartola mes={mes} anio={anio}
          onClose={() => setModalCartola(false)} onConfirmado={() => cargar(true)} />
      )}
      {modalFacturas && (
        <ModalFacturas mes={mes} anio={anio}
          onClose={() => setModalFacturas(false)} onActualizado={() => cargar(true)} />
      )}
    </div>
  )
}
