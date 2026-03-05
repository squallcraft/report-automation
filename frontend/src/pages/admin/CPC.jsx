import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import { Truck, Download, Upload, FileText, X, Check, AlertCircle, ChevronDown, ChevronRight, Users } from 'lucide-react'

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

// ---------------------------------------------------------------------------
// Modal generador TEF — Opción A: jefes de flota consolidan su flota
// ---------------------------------------------------------------------------
function ModalTEF({ semana, mes, anio, drivers, onClose }) {
  // Construir items: jefes con monto consolidado, independientes con monto individual
  const [items, setItems] = useState(() =>
    drivers.map(d => ({
      driver_id: d.driver_id,
      driver_nombre: d.driver_nombre,
      rut: d.rut,
      banco: d.banco,
      numero_cuenta: d.numero_cuenta,
      es_jefe: d.es_jefe_flota,
      subordinados: d.subordinados || [],
      liquidado: d.semanas?.[String(semana)]?.monto_neto || 0,
      monto: d.semanas?.[String(semana)]?.monto_neto || 0,
      incluir: (d.semanas?.[String(semana)]?.monto_neto || 0) > 0,
    }))
  )
  const [porcentaje, setPorcentaje] = useState('')
  const [cargando, setCargando] = useState(false)

  const aplicarPorcentaje = () => {
    const pct = parseFloat(porcentaje)
    if (isNaN(pct) || pct <= 0 || pct > 100) return
    setItems(prev => prev.map(it => ({ ...it, monto: Math.round(it.liquidado * pct / 100) })))
  }

  const toggle = (id) => setItems(prev => prev.map(it => it.driver_id === id ? { ...it, incluir: !it.incluir } : it))
  const setMonto = (id, val) => setItems(prev => prev.map(it => it.driver_id === id ? { ...it, monto: Number(val) || 0 } : it))

  const seleccionados = items.filter(it => it.incluir)
  const totalTEF = seleccionados.reduce((a, it) => a + it.monto, 0)

  const descargar = async () => {
    if (!seleccionados.length) return toast.error('Selecciona al menos un destinatario')
    const sinDatos = seleccionados.filter(it => !it.banco || !it.numero_cuenta)
    if (sinDatos.length) {
      toast.error(`Sin datos bancarios: ${sinDatos.map(d => d.driver_nombre).join(', ')}`)
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
          <button onClick={() => setItems(prev => prev.map(it => ({ ...it, monto: it.liquidado })))}
            className="btn btn-secondary text-sm py-1.5">Reset 100%</button>
          <span className="ml-auto text-sm font-semibold text-blue-700">Total: {fmt(totalTEF)}</span>
        </div>

        <div className="flex-1 overflow-auto px-6 py-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-200">
                <th className="py-2 w-8"></th>
                <th className="py-2 text-left font-medium">Destinatario</th>
                <th className="py-2 text-left font-medium">Banco</th>
                <th className="py-2 text-right font-medium">Liquidado</th>
                <th className="py-2 text-right font-medium w-36">Monto a pagar</th>
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
                  </td>
                  <td className="py-2 text-xs text-gray-500">
                    {it.banco ? `${it.banco} · ${it.numero_cuenta || '—'}` : '—'}
                  </td>
                  <td className="py-2 text-right font-mono text-gray-600">{fmt(it.liquidado)}</td>
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
  const inputRef = useRef()

  const cargarPreview = async () => {
    if (!archivo) return toast.error('Selecciona un archivo')
    setCargando(true)
    try {
      const form = new FormData()
      form.append('archivo', archivo)
      const { data } = await api.post('/cpc/cartola/preview', form, {
        params: { semana, mes, anio },
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setPreview(data)
      setItems(data.items.map(it => ({ ...it, incluir: it.match_confiable && it.driver_id != null })))
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Error procesando cartola')
    } finally { setCargando(false) }
  }

  const toggleItem = (idx) => setItems(prev => prev.map((it, i) => i === idx ? { ...it, incluir: !it.incluir } : it))

  const confirmar = async () => {
    const seleccionados = items.filter(it => it.incluir && it.driver_id)
    if (!seleccionados.length) return toast.error('No hay items válidos para confirmar')
    setConfirmando(true)
    try {
      await api.post('/cpc/cartola/confirmar', {
        semana, mes, anio,
        items: seleccionados.map(it => ({
          driver_id: it.driver_id,
          monto: it.monto,
          fecha: it.fecha,
          descripcion: it.descripcion,
        })),
      })
      toast.success(`${seleccionados.length} pagos registrados`)
      onConfirmado()
      onClose()
    } catch { toast.error('Error confirmando pagos') }
    finally { setConfirmando(false) }
  }

  const totalConfirmar = items.filter(it => it.incluir && it.driver_id).reduce((a, it) => a + it.monto, 0)

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
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
              <div className="mb-2 flex items-center gap-3 text-xs text-gray-500">
                <span className="inline-flex items-center gap-1 text-green-700"><Check size={12} /> Match confiable</span>
                <span className="inline-flex items-center gap-1 text-amber-600"><AlertCircle size={12} /> Match incierto — revisa</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-200">
                    <th className="py-2 w-8"></th>
                    <th className="py-2 text-left font-medium">Descripción cartola</th>
                    <th className="py-2 text-left font-medium">Conductor matched</th>
                    <th className="py-2 text-right font-medium">Monto</th>
                    <th className="py-2 text-right font-medium">Ya pagado</th>
                    <th className="py-2 text-right font-medium">Liquidado</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={idx} className={`border-b border-gray-100 text-xs ${!it.incluir ? 'opacity-40' : ''}`}>
                      <td className="py-1.5">
                        <input type="checkbox" checked={it.incluir} onChange={() => toggleItem(idx)}
                          disabled={!it.driver_id} className="w-3.5 h-3.5 accent-primary-600" />
                      </td>
                      <td className="py-1.5 max-w-[200px]">
                        <span className="truncate block" title={it.descripcion}>{it.nombre_extraido}</span>
                        <span className="text-gray-400 text-[10px]">{it.fecha}</span>
                      </td>
                      <td className="py-1.5">
                        {it.driver_nombre ? (
                          <span className={`inline-flex items-center gap-1 ${it.match_confiable ? 'text-green-700' : 'text-amber-600'}`}>
                            {it.match_confiable ? <Check size={11} /> : <AlertCircle size={11} />}
                            {it.driver_nombre}
                            <span className="text-gray-400 text-[10px]">({Math.round(it.score * 100)}%)</span>
                          </span>
                        ) : (
                          <span className="text-red-400">Sin match</span>
                        )}
                      </td>
                      <td className="py-1.5 text-right font-mono">{fmt(it.monto)}</td>
                      <td className="py-1.5 text-right font-mono text-blue-600">{it.ya_pagado > 0 ? fmt(it.ya_pagado) : '—'}</td>
                      <td className="py-1.5 text-right font-mono text-gray-600">{it.liquidado > 0 ? fmt(it.liquidado) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
              <span className="text-sm text-gray-600">
                {items.filter(it => it.incluir && it.driver_id).length} pagos · <span className="font-semibold text-gray-800">{fmt(totalConfirmar)}</span>
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
// Fila de conductor en la tabla
// ---------------------------------------------------------------------------
function DriverRow({ d, semanas, pagados, onUpdateEstado }) {
  const [expandido, setExpandido] = useState(false)
  const dPagados = pagados[String(d.driver_id)] || {}
  const esJefe = d.es_jefe_flota

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
            <>
              <td key={`${sem}-liq`} className="py-2 px-2 text-right">
                <div className="flex flex-col items-end gap-1">
                  <span className="font-mono text-gray-700">{fmt(semData.monto_neto)}</span>
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
                </div>
              </td>
              <td key={`${sem}-pag`} className="py-2 px-2 text-right">
                {pagadoSem > 0 ? (
                  <span className={`font-mono text-xs font-semibold ${completo ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {fmt(pagadoSem)}
                  </span>
                ) : (
                  <span className="text-xs text-gray-300">—</span>
                )}
              </td>
            </>
          )
        })}
        <td className="py-2 px-4 text-right font-semibold text-gray-800 font-mono">{fmt(d.subtotal_neto)}</td>
      </tr>

      {/* Detalle de subordinados del jefe (colapsable) */}
      {esJefe && expandido && d.subordinados?.map(sub => (
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
              <>
                <td key={`${sem}-liq`} className="py-1.5 px-2 text-right">
                  <span className="font-mono text-xs text-gray-500">{semData.monto_neto > 0 ? fmt(semData.monto_neto) : '—'}</span>
                </td>
                <td key={`${sem}-pag`} />
              </>
            )
          })}
          <td className="py-1.5 px-4 text-right font-mono text-xs text-gray-500">{fmt(sub.subtotal_neto)}</td>
        </tr>
      ))}
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
  const [modalTEF, setModalTEF] = useState(null)
  const [modalCartola, setModalCartola] = useState(false)
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
  const drivers = useMemo(() => {
    if (!data?.drivers) return []
    if (!filterText) return data.drivers
    const q = filterText.toLowerCase()
    return data.drivers.filter(d =>
      d.driver_nombre.toLowerCase().includes(q) ||
      d.subordinados?.some(s => s.driver_nombre.toLowerCase().includes(q))
    )
  }, [data, filterText])

  const updateEstado = async (driverId, semana, estado) => {
    // Actualizar optimistamente en local antes de esperar la API
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
              [String(semana)]: { ...d.semanas[String(semana)], estado },
            },
          }
        }),
      }
    })
    try {
      await api.put(`/cpc/pago-semana/${driverId}`, { estado }, { params: { semana, mes, anio } })
    } catch {
      toast.error('Error actualizando estado')
      cargar(true) // revertir si falla
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

  const totalesGenerales = useMemo(() => {
    if (!drivers.length) return { neto: 0, pagado: 0 }
    return drivers.reduce((acc, d) => {
      // Total pagado = suma de montos de semanas marcadas como PAGADO
      const pagadoDriver = Object.values(d.semanas || {}).reduce((a, s) => {
        if (s.estado === 'PAGADO') return a + (s.monto_neto || 0)
        return a
      }, 0)
      return { neto: acc.neto + d.subtotal_neto, pagado: acc.pagado + pagadoDriver }
    }, { neto: 0, pagado: 0 })
  }, [drivers])

  const estadoConteo = useMemo(() => {
    const counts = { PENDIENTE: 0, PAGADO: 0, INCOMPLETO: 0 }
    drivers.forEach(d => {
      semanas.forEach(sem => {
        const s = d.semanas[String(sem)]
        if (s && s.monto_neto > 0) counts[s.estado] = (counts[s.estado] || 0) + 1
      })
    })
    return counts
  }, [drivers, semanas])

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Truck size={24} className="text-primary-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">CPC — Control de Pagos a Conductores</h1>
            <p className="text-sm text-gray-500">Seguimiento semanal de egresos a drivers</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={descargarPlantilla} className="btn btn-secondary flex items-center gap-2 text-sm">
            <Download size={15} /> Plantilla Bancaria
          </button>
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
      </div>

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
        </div>
      </div>

      {drivers.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="card bg-blue-50 border-blue-200 text-center">
            <p className="text-xs text-blue-600 font-medium">Total Egresos</p>
            <p className="text-lg font-bold text-blue-800">{fmt(totalesGenerales.neto)}</p>
          </div>
          <div className="card bg-emerald-50 border-emerald-200 text-center">
            <p className="text-xs text-emerald-600 font-medium">Total Pagado</p>
            <p className="text-lg font-bold text-emerald-800">{fmt(totalesGenerales.pagado)}</p>
          </div>
          <div className="card bg-green-50 border-green-200 text-center">
            <p className="text-xs text-green-600 font-medium">Semanas Pagadas</p>
            <p className="text-lg font-bold text-green-800">{estadoConteo.PAGADO}</p>
          </div>
          <div className="card bg-amber-50 border-amber-200 text-center">
            <p className="text-xs text-amber-600 font-medium">Pendientes</p>
            <p className="text-lg font-bold text-amber-800">{estadoConteo.PENDIENTE}</p>
          </div>
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
                  {semanas.map(s => (
                    <th key={s} className="pb-2 pt-3 px-2 font-medium text-right" colSpan={2}>
                      Sem {s}
                    </th>
                  ))}
                  <th className="pb-2 pt-3 px-4 font-medium text-right">Subtotal</th>
                </tr>
                <tr className="text-[10px] text-gray-400 border-b border-gray-200 bg-gray-50">
                  <th /><th />
                  {semanas.map(s => (
                    <>
                      <th key={`${s}-liq`} className="pb-1 px-2 text-right font-normal">Liq.</th>
                      <th key={`${s}-pag`} className="pb-1 px-2 text-right font-normal text-emerald-600">Pagado</th>
                    </>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {drivers.map(d => (
                  <DriverRow
                    key={d.driver_id}
                    d={d}
                    semanas={semanas}
                    pagados={pagados}
                    onUpdateEstado={updateEstado}
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
    </div>
  )
}
