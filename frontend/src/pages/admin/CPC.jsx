import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import { Truck, Download, Upload, FileText, X, Check, AlertCircle, ChevronDown, ChevronRight, Users, CheckCircle, XCircle, Clock } from 'lucide-react'
import PageHeader from '../../components/PageHeader'

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const SEMANAS = [1, 2, 3, 4, 5]
const ESTADO_COLORS = {
  PENDIENTE: 'bg-amber-100 text-amber-800',
  PAGADO: 'bg-green-100 text-green-800',
  INCOMPLETO: 'bg-red-100 text-red-800',
}

function fmt(v) {
  if (!v && v !== 0) return '$0'
  return `$${Math.abs(Number(v)).toLocaleString('es-CL')}`
}

// Bancos aceptados por Banco de Chile para TEF masivo
const BANCOS_TEF_VALIDOS = new Set([
  // Bancos tradicionales
  'banco de chile',
  'banco internacional',
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
  // Fintech / billeteras
  'coopeuch',
  'prepago los heroes', 'prepago los héroes',
  'tenpo',
  'copec pay',
  'mach', 'machbank',
  'mercado pago', 'mercadopago',
])

// ---------------------------------------------------------------------------
// Modal generador TEF — Opción A: jefes de flota consolidan su flota
// ---------------------------------------------------------------------------
function ModalTEF({ semana, mes, anio, drivers, pagados = {}, onClose }) {
  const [items, setItems] = useState(() =>
    drivers.map(d => {
      const liquidado = d.semanas?.[String(semana)]?.monto_neto || 0
      const ya_pagado = pagados[String(d.driver_id)]?.[String(semana)] || 0
      const saldo = Math.max(0, liquidado - ya_pagado)
      return {
        driver_id: d.driver_id,
        driver_nombre: d.driver_nombre,
        rut: d.rut,
        banco: d.banco,
        numero_cuenta: d.numero_cuenta,
        es_jefe: d.es_jefe_flota,
        subordinados: d.subordinados || [],
        liquidado,
        ya_pagado,
        saldo,
        monto: saldo,
        incluir: saldo > 0,
      }
    })
  )
  const [porcentaje, setPorcentaje] = useState('')
  const [cargando, setCargando] = useState(false)

  const aplicarPorcentaje = () => {
    const pct = parseFloat(porcentaje)
    if (isNaN(pct) || pct <= 0 || pct > 100) return
    setItems(prev => prev.map(it => ({ ...it, monto: Math.round(it.saldo * pct / 100) })))
  }

  const toggle = (id) => setItems(prev => prev.map(it => it.driver_id === id ? { ...it, incluir: !it.incluir } : it))
  const setMonto = (id, val) => setItems(prev => prev.map(it => it.driver_id === id ? { ...it, monto: Number(val) || 0 } : it))
  const seleccionarTodos = () => setItems(prev => prev.map(it => ({ ...it, incluir: true })))
  const deseleccionarTodos = () => setItems(prev => prev.map(it => ({ ...it, incluir: false })))
  const todosSeleccionados = items.length > 0 && items.every(it => it.incluir)

  const seleccionados = items.filter(it => it.incluir)
  const totalTEF = seleccionados.reduce((a, it) => a + it.monto, 0)

  const descargar = async () => {
    if (!seleccionados.length) return toast.error('Selecciona al menos un destinatario')
    const sinDatos = seleccionados.filter(it => !it.banco || !it.numero_cuenta)
    if (sinDatos.length) {
      toast.error(`Sin datos bancarios: ${sinDatos.map(d => d.driver_nombre).join(', ')}`)
      return
    }
    const bancoInvalido = seleccionados.filter(it => it.banco && !BANCOS_TEF_VALIDOS.has(it.banco.toLowerCase().trim()))
    if (bancoInvalido.length) {
      toast.error(`Banco no soportado en TEF: ${bancoInvalido.map(d => `${d.driver_nombre} (${d.banco})`).join(', ')}`)
      return
    }
    setCargando(true)
    try {
      const { data } = await api.post('/cpc/generar-tef',
        { semana, mes, anio, items: seleccionados.map(it => ({ driver_id: it.driver_id, monto: it.monto })) },
        { responseType: 'blob' }
      )
      const url = URL.createObjectURL(new Blob([data], { type: 'text/plain' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `TEF_ECourier_${anio}${String(mes).padStart(2, '0')}_S${semana}.txt`
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
            <h2 className="text-lg font-bold text-gray-900">Planilla de Pagos TEF</h2>
            <p className="text-sm text-gray-500">Semana {semana} · {MESES[mes]} {anio}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
        </div>

        <div className="px-6 py-3 border-b border-gray-100 bg-blue-50">
          <p className="text-xs text-blue-700">
            <strong>Jefes de flota:</strong> reciben 1 pago consolidado por toda su flota. Los conductores de su flota no aparecen como líneas separadas.
          </p>
        </div>

        <div className="px-6 py-3 border-b border-gray-100 flex flex-wrap items-center gap-3">
          <span className="text-sm text-gray-600">Aplicar % a todos:</span>
          <input type="number" min="1" max="100" placeholder="ej: 50"
            className="input w-24 text-sm" value={porcentaje}
            onChange={e => setPorcentaje(e.target.value)} />
          <button onClick={aplicarPorcentaje} className="btn btn-secondary text-sm py-1.5">Aplicar</button>
          <button onClick={() => setItems(prev => prev.map(it => ({ ...it, monto: it.saldo })))}
            className="btn btn-secondary text-sm py-1.5">Reset 100%</button>
          <span className="ml-auto text-sm font-semibold text-blue-700">Total: {fmt(totalTEF)}</span>
        </div>

        <div className="flex-1 overflow-auto px-6 py-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-200">
                <th className="py-2 w-8">
                  <input
                    type="checkbox"
                    checked={todosSeleccionados}
                    onChange={e => e.target.checked ? seleccionarTodos() : deseleccionarTodos()}
                    className="w-3.5 h-3.5 accent-primary-600"
                    title={todosSeleccionados ? 'Deseleccionar todo' : 'Seleccionar todo'}
                  />
                </th>
                <th className="py-2 text-left font-medium">Destinatario</th>
                <th className="py-2 text-left font-medium">Banco</th>
                <th className="py-2 pr-5 text-right font-medium">Liquidado</th>
                <th className="py-2 pr-5 text-right font-medium">Pagado</th>
                <th className="py-2 pr-5 text-right font-medium">Saldo</th>
                <th className="py-2 text-right font-medium w-36">A pagar</th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.driver_id} className={`border-b border-gray-100 ${!it.incluir ? 'opacity-40' : ''}`}>
                  <td className="py-2">
                    <input type="checkbox" checked={it.incluir} onChange={() => toggle(it.driver_id)}
                      className="w-4 h-4 accent-primary-600" />
                  </td>
                  <td className="py-2">
                    <div className="flex items-center gap-1.5">
                      {it.es_jefe && <Users size={13} className="text-primary-500 shrink-0" />}
                      <span className="font-medium">{it.driver_nombre}</span>
                      {it.es_jefe && it.subordinados.length > 0 && (
                        <span className="text-xs text-gray-400">({it.subordinados.length} conductores)</span>
                      )}
                    </div>
                    {!it.banco && <span className="text-xs text-red-400 font-medium">sin datos bancarios</span>}
                    {it.banco && !BANCOS_TEF_VALIDOS.has(it.banco.toLowerCase().trim()) && (
                      <span className="text-xs text-amber-500 font-medium" title="Este banco no es compatible con TEF Banco de Chile">⚠ banco no soportado en TEF</span>
                    )}
                  </td>
                  <td className="py-2 text-xs text-gray-500">
                    {it.banco ? `${it.banco} · ${it.numero_cuenta || '—'}` : '—'}
                  </td>
                  <td className="py-2 pr-5 text-right font-mono text-gray-600">{fmt(it.liquidado)}</td>
                  <td className="py-2 pr-5 text-right font-mono">
                    {it.ya_pagado > 0
                      ? <span className="text-green-600">{fmt(it.ya_pagado)}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="py-2 pr-5 text-right font-mono">
                    {it.saldo > 0
                      ? <span className="font-semibold text-gray-800">{fmt(it.saldo)}</span>
                      : <span className="text-green-600 text-xs font-medium">completo</span>}
                  </td>
                  <td className="py-2 text-right">
                    <input type="number" min="0"
                      className="input text-right text-sm w-32 font-mono"
                      value={it.monto} disabled={!it.incluir}
                      onChange={e => setMonto(it.driver_id, e.target.value)} />
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
// Modal carga de cartola
// ---------------------------------------------------------------------------
function ModalCartola({ mes, anio, onClose, onConfirmado }) {
  const [semana, setSemana] = useState(1)
  const [archivo, setArchivo] = useState(null)
  const [preview, setPreview] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [items, setItems] = useState([])
  const [todosDrivers, setTodosDrivers] = useState([])
  const inputRef = useRef()

  const cargarPreview = async () => {
    if (!archivo) return toast.error('Selecciona un archivo')
    setCargando(true)
    try {
      const form = new FormData()
      form.append('archivo', archivo)
      const { data } = await api.post('/cpc/cartola/preview', form, {
        params: { semana, mes, anio },
      })
      setPreview(data)
      setTodosDrivers(data.drivers || [])
      // Todos los items empiezan con checkbox activo si tienen driver asignado
      setItems(data.items.map(it => ({
        ...it,
        incluir: it.driver_id != null && !it.ya_existe,
        driver_id_sel: it.driver_id,
        driver_nombre_sel: it.driver_nombre,
      })))
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Error procesando cartola')
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
      incluir: d != null,  // activar checkbox automáticamente al asignar
    } : it))
  }

  const confirmar = async () => {
    const seleccionados = items.filter(it => it.incluir && it.driver_id_sel)
    if (!seleccionados.length) return toast.error('No hay items válidos para confirmar')
    setConfirmando(true)
    try {
      await api.post('/cpc/cartola/confirmar', {
        semana, mes, anio,
        items: seleccionados.map(it => ({
          driver_id: it.driver_id_sel,
          monto: it.monto,
          fecha: it.fecha,
          descripcion: it.descripcion,
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

  const totalConfirmar = items.filter(it => it.incluir && it.driver_id_sel).reduce((a, it) => a + it.monto, 0)
  const totalItems = items.filter(it => it.incluir && it.driver_id_sel).length

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Cargar Cartola Bancaria</h2>
            <p className="text-sm text-gray-500">{MESES[mes]} {anio}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
        </div>

        <div className="px-6 py-4 border-b border-gray-100 flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Semana que corresponden los pagos</label>
            <select className="input w-32" value={semana} onChange={e => setSemana(Number(e.target.value))}>
              {SEMANAS.map(s => <option key={s} value={s}>Semana {s}</option>)}
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
                <span className="inline-flex items-center gap-1 text-green-700"><Check size={12} /> Match confiable (≥55%)</span>
                <span className="inline-flex items-center gap-1 text-amber-600"><AlertCircle size={12} /> Match incierto — verifica o cambia</span>
                <span className="text-gray-400">· Haz clic en el conductor para cambiarlo. Al confirmar se guarda la homologación.</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-200">
                    <th className="py-2 w-8"></th>
                    <th className="py-2 text-left font-medium">Nombre en cartola</th>
                    <th className="py-2 text-left font-medium">Conductor asignado</th>
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
                          {/* Indicador de confianza */}
                          {it.driver_id_sel ? (
                            it.match_confiable && it.driver_id_sel === it.driver_id
                              ? <Check size={11} className="text-green-600 flex-shrink-0" />
                              : <AlertCircle size={11} className="text-amber-500 flex-shrink-0" />
                          ) : (
                            <AlertCircle size={11} className="text-red-400 flex-shrink-0" />
                          )}
                          {/* Dropdown selector */}
                          <select
                            className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white flex-1 min-w-0"
                            value={it.driver_id_sel ?? ''}
                            onChange={e => cambiarDriver(idx, e.target.value)}
                          >
                            <option value="">— Sin asignar —</option>
                            {todosDrivers.map(d => (
                              <option key={d.id} value={d.id}>{d.nombre}</option>
                            ))}
                          </select>
                          {/* Score solo si es match automático */}
                          {it.driver_id_sel === it.driver_id && it.score > 0 && (
                            <span className="text-[10px] text-gray-400 flex-shrink-0">
                              ({Math.round(it.score * 100)}%)
                            </span>
                          )}
                          {/* Indicador de edición manual */}
                          {it.driver_id_sel !== it.driver_id && it.driver_id_sel && (
                            <span className="text-[10px] text-blue-500 flex-shrink-0">editado</span>
                          )}
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
                <span className="text-xs text-gray-400 ml-2">· Las homologaciones se guardarán automáticamente</span>
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
// Badge de estado de factura (por semana)
// ---------------------------------------------------------------------------
const FACTURA_BADGE = {
  CARGADA:  { label: 'Factura pendiente', cls: 'bg-amber-100 text-amber-700 border-amber-300', icon: AlertCircle },
  APROBADA: { label: 'Factura aprobada',  cls: 'bg-emerald-100 text-emerald-700 border-emerald-300', icon: CheckCircle },
  RECHAZADA:{ label: 'Factura rechazada', cls: 'bg-red-100 text-red-600 border-red-300', icon: XCircle },
}

function FacturaBadge({ estado, onClick }) {
  if (!estado || estado === 'SIN_FACTURA') return null
  const cfg = FACTURA_BADGE[estado]
  if (!cfg) return null
  const Icon = cfg.icon
  return (
    <button
      onClick={onClick}
      title={cfg.label}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium cursor-pointer hover:opacity-80 transition-opacity ${cfg.cls}`}
    >
      <Icon size={10} />
      Factura
    </button>
  )
}

// ---------------------------------------------------------------------------
// Modal revisión de factura de driver
// ---------------------------------------------------------------------------
function ModalFacturaDriver({ facturaId, driverNombre, semana, mes, anio, monto, onClose, onRevisada }) {
  const [factura, setFactura] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notaAdmin, setNotaAdmin] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [tipoDocumento, setTipoDocumento] = useState('FACTURA')

  useEffect(() => {
    api.get('/cpc/facturas-drivers', { params: { mes, anio } })
      .then(({ data }) => {
        const f = data.find(x => x.id === facturaId)
        setFactura(f || null)
        setNotaAdmin(f?.nota_admin || '')
        setTipoDocumento(f?.tipo_documento || 'FACTURA')
      })
      .catch(() => setFactura(null))
      .finally(() => setLoading(false))
  }, [facturaId, mes, anio])

  const descargar = async () => {
    try {
      const { data } = await api.get(`/cpc/facturas-drivers/${facturaId}/descargar`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([data]))
      const a = document.createElement('a')
      a.href = url
      a.download = factura?.archivo_nombre || 'factura'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Error descargando factura')
    }
  }

  const revisar = async (estado) => {
    setGuardando(true)
    try {
      await api.put(`/cpc/facturas-drivers/${facturaId}/revisar`, null, {
        params: { estado, nota_admin: notaAdmin || undefined, tipo_documento: tipoDocumento },
      })
      toast.success(estado === 'APROBADA' ? 'Factura aprobada' : 'Factura rechazada')
      onRevisada()
      onClose()
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Error revisando factura')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-base font-bold text-gray-900">Factura — {driverNombre}</h2>
            <p className="text-sm text-gray-500">Semana {semana} · {MESES[mes]} {anio}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
        </div>

        <div className="px-6 py-5 flex-1">
          {loading ? (
            <p className="text-center text-gray-400 py-6">Cargando...</p>
          ) : !factura ? (
            <p className="text-center text-gray-400 py-6">No se encontró la factura</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                <div>
                  <p className="text-xs text-gray-500">Monto liquidado (CPC)</p>
                  <p className="text-lg font-bold text-gray-800">{fmt(monto)}</p>
                </div>
                {factura.archivo_nombre && (
                  <button onClick={descargar}
                    className="flex items-center gap-1.5 text-blue-600 hover:underline text-sm font-medium">
                    <Download size={14} /> {factura.archivo_nombre}
                  </button>
                )}
              </div>

              {factura.nota_driver && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-xs font-medium text-blue-700 mb-0.5">Nota del conductor</p>
                  <p className="text-sm text-blue-800">{factura.nota_driver}</p>
                </div>
              )}

              {factura.estado !== 'APROBADA' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Tipo de documento
                  </label>
                  <div className="flex gap-2">
                    {[
                      { value: 'FACTURA', label: 'Factura (con IVA)' },
                      { value: 'BOLETA',  label: 'Boleta de honorarios' },
                    ].map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setTipoDocumento(value)}
                        className={`flex-1 text-xs font-medium py-1.5 px-3 rounded-lg border transition-colors ${
                          tipoDocumento === value
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {factura.estado !== 'APROBADA' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Nota de rechazo (opcional)
                  </label>
                  <input
                    type="text"
                    className="input w-full text-sm"
                    placeholder="Motivo del rechazo..."
                    value={notaAdmin}
                    onChange={e => setNotaAdmin(e.target.value)}
                  />
                </div>
              )}

              {factura.estado === 'APROBADA' && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-center gap-2">
                  <CheckCircle size={16} className="text-emerald-600 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-emerald-800">Factura aprobada</p>
                    <p className="text-xs text-emerald-600">
                      Tipo: {factura.tipo_documento === 'BOLETA' ? 'Boleta de honorarios' : 'Factura (con IVA)'}
                      {factura.revisado_por && ` · por ${factura.revisado_por}`}
                    </p>
                  </div>
                </div>
              )}

              {factura.estado === 'RECHAZADA' && factura.nota_admin && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-xs font-medium text-red-700 mb-0.5">Observación anterior</p>
                  <p className="text-sm text-red-800">{factura.nota_admin}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {factura && factura.estado !== 'APROBADA' && (
          <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
            <button onClick={onClose} className="btn btn-secondary">Cancelar</button>
            <button
              onClick={() => revisar('RECHAZADA')}
              disabled={guardando}
              className="btn flex items-center gap-2 bg-red-50 text-red-700 border border-red-200 hover:bg-red-100"
            >
              <XCircle size={15} /> Rechazar
            </button>
            <button
              onClick={() => revisar('APROBADA')}
              disabled={guardando}
              className="btn btn-primary flex items-center gap-2"
            >
              <CheckCircle size={15} /> Aprobar
            </button>
          </div>
        )}
        {factura && factura.estado === 'APROBADA' && (
          <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
            <button onClick={onClose} className="btn btn-secondary">Cerrar</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Fila de conductor en la tabla
// ---------------------------------------------------------------------------
function DriverRow({ d, semanas, pagados, onUpdateEstado, onUpdateFechaPago, onVerFactura }) {
  const [expandido, setExpandido] = useState(false)
  const dPagados = pagados[String(d.driver_id)] || {}
  const esJefe = d.es_jefe_flota
  const subtotal = semanas.reduce((acc, sem) => acc + (d.semanas[String(sem)]?.monto_neto || 0), 0)

  return (
    <>
      <tr className={`border-b border-gray-100 hover:bg-gray-50 ${esJefe ? 'bg-blue-50/40' : ''}`}>
        <td className="py-2 px-4">
          <div className="flex items-center gap-2">
            {esJefe && d.subordinados?.length > 0 && (
              <button onClick={() => setExpandido(v => !v)}
                className="text-gray-400 hover:text-gray-600 p-0.5 rounded">
                {expandido ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            )}
            {!esJefe && <span className="w-5" />}
            <div>
              <span className={`font-medium text-gray-800 ${esJefe ? 'text-primary-700' : ''}`}>
                {d.driver_nombre}
              </span>
              {esJefe && (
                <span className="ml-2 inline-flex items-center gap-1 text-[10px] bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded">
                  <Users size={9} /> Jefe · {d.subordinados?.length || 0} conductores
                </span>
              )}
              {d.rut && <span className="text-xs text-gray-400 ml-2">{d.rut}</span>}
            </div>
          </div>
        </td>
        <td className="py-2 px-4 text-center">
          {d.banco ? (
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded"
              title={`${d.tipo_cuenta || ''} ${d.numero_cuenta || ''}`}>{d.banco}</span>
          ) : (
            <span className="text-xs text-gray-300">{esJefe ? 'Configurar' : 'Sin datos'}</span>
          )}
        </td>
        {semanas.map(sem => {
          const semData = d.semanas[String(sem)] || { monto_neto: 0, estado: 'PENDIENTE' }
          const pagadoSem = dPagados[String(sem)] || 0
          const completo = pagadoSem > 0 && pagadoSem >= semData.monto_neto
          return (
            <React.Fragment key={`${d.driver_id}-${sem}`}>
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
                      onChange={e => onUpdateEstado(d.driver_id, sem, e.target.value)}
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
                      onChange={e => onUpdateFechaPago(semData.pago_id, e.target.value)}
                    />
                  )}
                  {semData.factura_estado && (
                    <FacturaBadge
                      estado={semData.factura_estado}
                      onClick={() => onVerFactura(semData.factura_id, d.driver_id, d.driver_nombre, sem, semData.monto_neto)}
                    />
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

      {esJefe && expandido && d.subordinados?.map(sub => {
        const subSubtotal = semanas.reduce((acc, sem) => acc + (sub.semanas[String(sem)]?.monto_neto || 0), 0)
        return (
          <tr key={sub.driver_id} className="border-b border-gray-100 bg-gray-50/80">
            <td className="py-1.5 px-4">
              <div className="pl-10 flex items-center gap-1.5 text-xs text-gray-600">
                <span className="text-gray-400">↳</span>
                <span>{sub.driver_nombre}</span>
              </div>
            </td>
            <td />
            {semanas.map(sem => {
              const semData = sub.semanas[String(sem)] || { monto_neto: 0 }
              return (
                <React.Fragment key={`sub-${sub.driver_id}-${sem}`}>
                  <td className="py-1.5 px-2 text-right">
                    <span className="font-mono text-xs text-gray-500">{semData.monto_neto > 0 ? fmt(semData.monto_neto) : '—'}</span>
                  </td>
                  <td />
                </React.Fragment>
              )
            })}
            <td className="py-1.5 px-4 text-right font-mono text-xs text-gray-500">{fmt(subSubtotal)}</td>
          </tr>
        )
      })}
    </>
  )
}

// ---------------------------------------------------------------------------
// Página principal CPC
// ---------------------------------------------------------------------------
export default function CPC() {
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
  const [modalFactura, setModalFactura] = useState(null)
  const reqId = useRef(0)

  const cargar = useCallback((silencioso = false) => {
    const id = ++reqId.current
    if (!silencioso) setLoading(true)
    Promise.all([
      api.get('/cpc/tabla', { params: { mes, anio } }),
      api.get('/cpc/pagos-acumulados', { params: { mes, anio } }),
    ])
      .then(([tablaRes, pagadosRes]) => {
        if (id !== reqId.current) return
        setData(tablaRes.data)
        setPagados(pagadosRes.data || {})
      })
      .catch(() => { if (id === reqId.current) toast.error('Error cargando CPC') })
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

  const drivers = useMemo(() => {
    if (!data?.drivers) return []
    const semanasAll = data.semanas_disponibles || []
    let result = data.drivers

    if (filterText) {
      const q = filterText.toLowerCase()
      result = result.filter(d =>
        d.driver_nombre.toLowerCase().includes(q) ||
        d.subordinados?.some(s => s.driver_nombre.toLowerCase().includes(q))
      )
    }

    if (filterEstado) {
      const semanasACheck = filterSemanas.size === 1 ? [...filterSemanas] : semanasAll
      result = result.filter(d =>
        semanasACheck.some(sem => {
          const semData = d.semanas[String(sem)]
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

  const updateEstado = async (driverId, semana, estado) => {
    const fechaPago = estado === 'PAGADO' ? new Date().toISOString().split('T')[0] : null
    setData(prev => {
      if (!prev) return prev
      return {
        ...prev,
        drivers: prev.drivers.map(d => {
          if (d.driver_id !== driverId) return d
          return {
            ...d,
            semanas: {
              ...d.semanas,
              [String(semana)]: { ...d.semanas[String(semana)], estado, fecha_pago: fechaPago },
            },
          }
        }),
      }
    })
    try {
      await api.put(`/cpc/pago-semana/${driverId}`, { estado, fecha_pago: fechaPago }, { params: { semana, mes, anio } })
      cargar(true)
    } catch {
      toast.error('Error actualizando estado')
      cargar(true)
    }
  }

  const updateFechaPago = async (pagoId, fecha) => {
    if (!pagoId || !fecha) return
    try {
      await api.patch(`/cpc/pago-semana/${pagoId}/fecha-pago`, { fecha_pago: fecha })
      cargar(true)
    } catch {
      toast.error('Error actualizando fecha de pago')
    }
  }

  const descargarPlantilla = async () => {
    try {
      const { data: blob } = await api.get('/drivers/plantilla/bancaria/descargar', { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([blob]))
      const a = document.createElement('a')
      a.href = url
      a.download = 'plantilla_bancaria_drivers.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch { toast.error('Error al descargar plantilla') }
  }

  const importarPlantilla = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    try {
      const form = new FormData()
      form.append('file', file)
      const { data } = await api.post('/drivers/importar/bancaria', form)
      toast.success(`${data.actualizados} conductores actualizados`)
      if (data.errores?.length) toast.error(`${data.errores.length} errores: ${data.errores[0]}`)
      cargar(true)
    } catch { toast.error('Error al importar plantilla') }
  }

  const totalesGenerales = useMemo(() => {
    if (!drivers.length) return { neto: 0, pagado: 0, porPagar: 0 }
    const activas = filterSemanas.size > 0 ? filterSemanas : null
    const sums = drivers.reduce((acc, d) => {
      let neto = 0, pagado = 0
      const dPagados = pagados[String(d.driver_id)] || {}
      Object.entries(d.semanas || {}).forEach(([sem, s]) => {
        if (activas && !activas.has(Number(sem))) return
        neto += s.monto_neto || 0
        pagado += dPagados[sem] || 0
      })
      return { neto: acc.neto + neto, pagado: acc.pagado + pagado }
    }, { neto: 0, pagado: 0 })
    return { ...sums, porPagar: sums.neto - sums.pagado }
  }, [drivers, filterSemanas, pagados])

  const estadoConteo = useMemo(() => {
    const counts = { PENDIENTE: 0, PAGADO: 0, INCOMPLETO: 0, FACTURAS_CARGADAS: 0 }
    const activas = filterSemanas.size > 0 ? filterSemanas : null
    drivers.forEach(d => {
      semanas.forEach(sem => {
        if (activas && !activas.has(sem)) return
        const s = d.semanas[String(sem)]
        if (s && s.monto_neto > 0) counts[s.estado] = (counts[s.estado] || 0) + 1
        if (s?.factura_estado === 'CARGADA') counts.FACTURAS_CARGADAS += 1
      })
    })
    return counts
  }, [drivers, semanas, filterSemanas])

  return (
    <div className="flex flex-col h-full gap-4">
      <PageHeader
        title="CPC — Control de Pagos a Conductores"
        subtitle="Seguimiento semanal de egresos a drivers"
        icon={Truck}
        accent="amber"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={descargarPlantilla} className="btn btn-secondary flex items-center gap-2 text-sm">
              <Download size={15} /> Plantilla Bancaria
            </button>
            <label className="btn btn-secondary flex items-center gap-2 text-sm cursor-pointer">
              <Upload size={15} /> Cargar Bancaria
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={importarPlantilla} />
            </label>
            <button onClick={() => setModalCartola(true)} className="btn btn-secondary flex items-center gap-2 text-sm">
              <Upload size={15} /> Cargar Cartola
            </button>
            {semanas.length > 0 && (
              <div className="relative group">
                <button className="btn btn-primary flex items-center gap-2 text-sm">
                  <FileText size={15} /> Planilla de Pagos <ChevronDown size={14} />
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
          <input type="text" placeholder="Buscar conductor..." className="input w-48"
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

      {drivers.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
          <div className="card bg-blue-50 border-blue-200 text-center">
            <p className="text-xs text-blue-600 font-medium">Total Egresos</p>
            <p className="text-lg font-bold text-blue-800">{fmt(totalesGenerales.neto)}</p>
          </div>
          <div className="card bg-emerald-50 border-emerald-200 text-center">
            <p className="text-xs text-emerald-600 font-medium">Total Pagado</p>
            <p className="text-lg font-bold text-emerald-800">{fmt(totalesGenerales.pagado)}</p>
          </div>
          <div className="card bg-violet-50 border-violet-200 text-center">
            <p className="text-xs text-violet-600 font-medium">Por pagar</p>
            <p className="text-lg font-bold text-violet-800">{fmt(totalesGenerales.porPagar)}</p>
          </div>
          <div className="card bg-green-50 border-green-200 text-center">
            <p className="text-xs text-green-600 font-medium">Semanas Pagadas</p>
            <p className="text-lg font-bold text-green-800">{estadoConteo.PAGADO}</p>
          </div>
          <div className="card bg-amber-50 border-amber-200 text-center">
            <p className="text-xs text-amber-600 font-medium">Pendientes</p>
            <p className="text-lg font-bold text-amber-800">{estadoConteo.PENDIENTE}</p>
          </div>
          {estadoConteo.FACTURAS_CARGADAS > 0 && (
            <div className="card bg-orange-50 border-orange-300 text-center col-span-2 sm:col-span-1">
              <p className="text-xs text-orange-600 font-medium">Facturas por revisar</p>
              <p className="text-lg font-bold text-orange-700">{estadoConteo.FACTURAS_CARGADAS}</p>
            </div>
          )}
        </div>
      )}

      {loading && !data ? (
        <div className="text-center py-12 text-gray-400">Cargando...</div>
      ) : !data || drivers.length === 0 ? (
        <div className="card text-center py-12 text-gray-400">
          No hay datos de pagos para {MESES[mes]} {anio}
        </div>
      ) : (
        <div className="card overflow-hidden p-0 flex-1 min-h-0">
          <div className="overflow-auto h-full">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-gray-50">
              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                <th className="pb-2 pt-3 px-4 font-medium">Conductor</th>
                <th className="pb-2 pt-3 px-4 font-medium text-center">Banco</th>
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
                  <th /><th />
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
              {drivers.map(d => (
                  <DriverRow
                    key={d.driver_id}
                    d={d}
                    semanas={semanasVisibles}
                    pagados={pagados}
                    onUpdateEstado={updateEstado}
                    onUpdateFechaPago={updateFechaPago}
                    onVerFactura={(facturaId, driverId, driverNombre, semana, monto) =>
                      setModalFactura({ facturaId, driverId, driverNombre, semana, monto })
                    }
                  />
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {modalTEF && (
        <ModalTEF
          semana={modalTEF}
          mes={mes}
          anio={anio}
          drivers={drivers}
          pagados={pagados}
          onClose={() => setModalTEF(null)}
        />
      )}
      {modalCartola && (
        <ModalCartola
          mes={mes}
          anio={anio}
          onClose={() => setModalCartola(false)}
          onConfirmado={() => cargar(true)}
        />
      )}
      {modalFactura && (
        <ModalFacturaDriver
          facturaId={modalFactura.facturaId}
          driverNombre={modalFactura.driverNombre}
          semana={modalFactura.semana}
          mes={mes}
          anio={anio}
          monto={modalFactura.monto}
          onClose={() => setModalFactura(null)}
          onRevisada={() => cargar(true)}
        />
      )}
    </div>
  )
}
