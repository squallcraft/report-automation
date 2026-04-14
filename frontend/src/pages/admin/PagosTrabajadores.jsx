import React, { useState, useEffect, useMemo, useRef } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import {
  Users, Download, Upload, FileText, X, Check, AlertCircle,
  DollarSign, Lock, Calendar, RotateCcw, CreditCard, PlusCircle,
} from 'lucide-react'
import PageHeader from '../../components/PageHeader'

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

const ESTADO_CONFIG = {
  PENDIENTE: { cls: 'bg-amber-100 text-amber-800', label: 'PENDIENTE' },
  PARCIAL:   { cls: 'bg-blue-100 text-blue-800',   label: 'PARCIAL'   },
  PAGADO:    { cls: 'bg-green-100 text-green-800',  label: 'PAGADO'    },
}

function fmt(v) {
  if (!v && v !== 0) return '$0'
  return `$${Math.abs(Number(v)).toLocaleString('es-CL')}`
}

function StatsCard({ icon: Icon, label, value, sub, color = 'blue' }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600', green: 'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600', amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
  }
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-start gap-3">
      <div className={`p-2 rounded-lg ${colors[color]}`}><Icon size={18} /></div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 font-medium">{label}</p>
        <p className="text-lg font-bold text-gray-900 truncate">{value}</p>
        {sub && <p className="text-xs text-gray-400 truncate">{sub}</p>}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Modal pago manual — soporta pagos parciales
// ─────────────────────────────────────────────────────────────────
function ModalPagoManual({ trabajador, mesNomina, anioNomina, onClose, onConfirmado }) {
  const hoy = new Date().toISOString().split('T')[0]

  // Cuotas activas del mes (pueden estar o no seleccionadas para este pago)
  const cuotasDisponibles = trabajador.cuotas_detalle || []
  const [cuotasSeleccionadas, setCuotasSeleccionadas] = useState(
    () => new Set(cuotasDisponibles.map(c => c.id))  // por defecto todas seleccionadas
  )

  // Recalcular descuento y líquido según cuotas seleccionadas
  const descuentoCuotasElegido = cuotasDisponibles
    .filter(c => cuotasSeleccionadas.has(c.id))
    .reduce((s, c) => s + c.monto, 0)

  const montoNetoConCuotas = Math.max(
    0,
    (trabajador.monto_bruto || 0)
    + (trabajador.bonificaciones || 0)
    - descuentoCuotasElegido
    - (trabajador.descuento_ajustes || 0)
  )

  const yaEsParcial = trabajador.estado === 'PARCIAL'
  const montoYaPagado = trabajador.monto_pagado || 0
  const saldoPendiente = Math.max(0, montoNetoConCuotas - montoYaPagado)

  const [fecha, setFecha] = useState(hoy)
  const [monto, setMonto] = useState(saldoPendiente)
  const [nota, setNota] = useState('')
  const [forzarCierre, setForzarCierre] = useState(false)
  const [guardando, setGuardando] = useState(false)

  // Recalcular monto sugerido cuando cambian las cuotas
  useEffect(() => {
    setMonto(saldoPendiente)
  }, [saldoPendiente])

  const montoNum = Number(monto) || 0
  const quedaSaldo = saldoPendiente - montoNum
  const seraCompleto = montoNum >= saldoPendiente || forzarCierre

  const toggleCuota = (id) => {
    setCuotasSeleccionadas(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  const confirmar = async (e) => {
    e.preventDefault()
    if (!fecha) return toast.error('Ingresa la fecha de pago')
    if (montoNum <= 0) return toast.error('El monto debe ser mayor a 0')
    setGuardando(true)
    try {
      await api.post(
        `/trabajadores/pago-manual`,
        {
          trabajador_id: trabajador.id,
          monto: montoNum,
          fecha_pago: fecha,
          nota: nota || null,
          forzar_cierre: forzarCierre,
          cuotas_a_pagar: cuotasDisponibles.length > 0 ? [...cuotasSeleccionadas] : null,
        },
        { params: { mes: mesNomina, anio: anioNomina } }
      )
      toast.success(seraCompleto ? `Nómina completada — ${trabajador.nombre}` : `Pago parcial registrado — ${trabajador.nombre}`)
      onConfirmado()
      onClose()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error registrando pago')
    } finally { setGuardando(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-base font-bold text-gray-900">
              {yaEsParcial ? 'Agregar Pago Parcial' : 'Registrar Pago'}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Nómina <span className="font-semibold text-gray-700">{MESES[mesNomina]} {anioNomina}</span>
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={18} /></button>
        </div>

        <form onSubmit={confirmar} className="px-6 py-5 space-y-4">
          {/* Resumen liquidación */}
          <div className="bg-gray-50 rounded-lg p-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Trabajador</span>
              <span className="font-semibold text-gray-900">{trabajador.nombre}</span>
            </div>
            {trabajador.cargo && (
              <div className="flex justify-between">
                <span className="text-gray-500">Cargo</span>
                <span className="text-gray-700">{trabajador.cargo}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-500">Sueldo bruto</span>
              <span className="text-gray-700">{fmt(trabajador.monto_bruto || trabajador.sueldo_bruto)}</span>
            </div>
            {(trabajador.bonificaciones || 0) > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-500">Bonificaciones</span>
                <span className="text-green-600">+{fmt(trabajador.bonificaciones)}</span>
              </div>
            )}
            {(trabajador.descuento_ajustes || 0) > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-500">Ajustes</span>
                <span className="text-amber-600">-{fmt(trabajador.descuento_ajustes)}</span>
              </div>
            )}

            {/* Cuotas de préstamo — checkbox por cuota */}
            {cuotasDisponibles.length > 0 && (
              <div className="border-t border-gray-200 pt-2 space-y-1.5">
                <p className="text-xs font-medium text-gray-600 mb-1">Cuotas de préstamo</p>
                {cuotasDisponibles.map(c => (
                  <label key={c.id} className="flex items-center justify-between gap-2 cursor-pointer group">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={cuotasSeleccionadas.has(c.id)}
                        onChange={() => toggleCuota(c.id)}
                        className="w-3.5 h-3.5 accent-red-500"
                      />
                      <span className={`text-xs ${cuotasSeleccionadas.has(c.id) ? 'text-red-700' : 'text-gray-400 line-through'}`}>
                        {c.motivo || `Préstamo #${c.prestamo_id}`}
                        {c.saldo_prestamo != null && (
                          <span className="ml-1 text-gray-400">(saldo {fmt(c.saldo_prestamo)})</span>
                        )}
                      </span>
                    </div>
                    <span className={`text-xs font-mono font-semibold ${cuotasSeleccionadas.has(c.id) ? 'text-red-600' : 'text-gray-300'}`}>
                      {cuotasSeleccionadas.has(c.id) ? `-${fmt(c.monto)}` : fmt(c.monto)}
                    </span>
                  </label>
                ))}
              </div>
            )}

            <div className="flex justify-between border-t border-gray-200 pt-2 font-semibold">
              <span className="text-gray-700">Total líquido</span>
              <span className="text-gray-900">{fmt(montoNetoConCuotas)}</span>
            </div>
            {yaEsParcial && (
              <div className="flex justify-between text-blue-700 font-semibold">
                <span>Ya pagado</span>
                <span>{fmt(montoYaPagado)}</span>
              </div>
            )}
            <div className="flex justify-between text-indigo-700 font-semibold">
              <span>Saldo pendiente</span>
              <span>{fmt(saldoPendiente)}</span>
            </div>
            {trabajador.banco && (
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>Cuenta</span>
                <span>{trabajador.banco} · {trabajador.numero_cuenta || '—'}</span>
              </div>
            )}
          </div>

          {/* Monto a pagar ahora */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Monto a pagar ahora
            </label>
            <input
              type="number"
              className="input-field w-full"
              value={monto}
              onChange={e => setMonto(e.target.value)}
              min={1}
              required
            />
            {montoNum > 0 && montoNum < saldoPendiente && (
              <p className="text-xs text-blue-600 mt-1">
                Quedará saldo de {fmt(quedaSaldo)} → estado <strong>PARCIAL</strong>
              </p>
            )}
            {montoNum >= saldoPendiente && saldoPendiente > 0 && (
              <p className="text-xs text-green-600 mt-1">Nómina quedará completamente <strong>PAGADA</strong></p>
            )}
          </div>

          {/* Fecha real del pago */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Fecha real del pago
              <span className="ml-1 text-xs font-normal text-gray-400">(puede ser mes siguiente al de la nómina)</span>
            </label>
            <input type="date" className="input-field w-full" value={fecha} onChange={e => setFecha(e.target.value)} required />
          </div>

          {/* Forzar cierre si el monto es menor pero se quiere marcar pagado */}
          {montoNum > 0 && montoNum < saldoPendiente && (
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={forzarCierre} onChange={e => setForzarCierre(e.target.checked)} className="w-4 h-4 accent-primary-600" />
              Marcar como PAGADO de todas formas (diferencia aceptada)
            </label>
          )}

          {/* Nota */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nota <span className="text-gray-400 font-normal">(opcional)</span></label>
            <input type="text" className="input-field w-full" value={nota} onChange={e => setNota(e.target.value)} placeholder="Ej: Transferencia Banco Chile" />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
            <button type="submit" disabled={guardando} className="btn-primary flex-1 flex items-center justify-center gap-2">
              <Check size={16} /> {guardando ? 'Guardando...' : seraCompleto ? 'Confirmar pago' : 'Registrar parcial'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Modal cartola
// ─────────────────────────────────────────────────────────────────
function ModalCartola({ mes, anio, onClose, onConfirmado }) {
  const [archivo, setArchivo] = useState(null)
  const [preview, setPreview] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [items, setItems] = useState([])
  const [todosTrabajadores, setTodosTrabajadores] = useState([])
  const inputRef = useRef()

  const cargarPreview = async () => {
    if (!archivo) return toast.error('Selecciona un archivo')
    setCargando(true)
    try {
      const form = new FormData()
      form.append('archivo', archivo)
      const { data } = await api.post('/trabajadores/cartola-trabajadores/preview', form, { params: { mes, anio } })
      setPreview(data)
      setTodosTrabajadores(data.trabajadores || [])
      setItems(data.items.map(it => ({
        ...it,
        incluir: it.trabajador_id != null,
        trabajador_id_sel: it.trabajador_id,
        trabajador_nombre_sel: it.trabajador_nombre,
      })))
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Error procesando cartola')
    } finally { setCargando(false) }
  }

  const toggleItem = (idx) => setItems(prev => prev.map((it, i) => i === idx ? { ...it, incluir: !it.incluir } : it))

  const cambiarTrabajador = (idx, tid) => {
    const t = todosTrabajadores.find(x => x.id === Number(tid))
    setItems(prev => prev.map((it, i) => i === idx ? {
      ...it, trabajador_id_sel: t ? t.id : null, trabajador_nombre_sel: t ? t.nombre : null, incluir: t != null,
    } : it))
  }

  const confirmar = async () => {
    const seleccionados = items.filter(it => it.incluir && it.trabajador_id_sel)
    if (!seleccionados.length) return toast.error('No hay ítems válidos para confirmar')
    setConfirmando(true)
    try {
      await api.post('/trabajadores/cartola-trabajadores/confirmar', {
        mes, anio,
        items: seleccionados.map(it => ({
          trabajador_id: it.trabajador_id_sel, monto: it.monto,
          fecha: it.fecha, descripcion: it.descripcion, nombre_extraido: it.nombre_extraido,
        })),
      })
      toast.success(`${seleccionados.length} pagos registrados`)
      onConfirmado(); onClose()
    } catch { toast.error('Error confirmando pagos') }
    finally { setConfirmando(false) }
  }

  const totalConfirmar = items.filter(it => it.incluir && it.trabajador_id_sel).reduce((a, it) => a + it.monto, 0)
  const totalItems = items.filter(it => it.incluir && it.trabajador_id_sel).length

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Cargar Cartola — Nómina Trabajadores</h2>
            <p className="text-sm text-gray-500">
              Nómina de <span className="font-semibold">{MESES[mes]} {anio}</span>
              <span className="ml-2 text-gray-400">· La fecha del pago se tomará de la cartola</span>
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
        </div>

        <div className="px-6 py-4 border-b border-gray-100 flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Archivo cartola (.xls / .xlsx)</label>
            <input ref={inputRef} type="file" accept=".xls,.xlsx" className="hidden" onChange={e => setArchivo(e.target.files[0])} />
            <button onClick={() => inputRef.current.click()} className="btn btn-secondary flex items-center gap-2 text-sm">
              <Upload size={14} /> {archivo ? archivo.name : 'Seleccionar archivo'}
            </button>
          </div>
          <button onClick={cargarPreview} disabled={cargando || !archivo} className="btn btn-primary text-sm flex items-center gap-2">
            {cargando ? 'Procesando...' : <><FileText size={14} /> Analizar</>}
          </button>
        </div>

        {preview && (
          <>
            <div className="flex-1 overflow-auto px-6 py-2">
              <div className="mb-2 flex items-center gap-4 text-xs text-gray-500">
                <span className="inline-flex items-center gap-1 text-green-700"><Check size={12} /> Match confiable (≥55%)</span>
                <span className="inline-flex items-center gap-1 text-amber-600"><AlertCircle size={12} /> Match incierto</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-200">
                    <th className="py-2 w-8"></th>
                    <th className="py-2 text-left font-medium">Nombre en cartola</th>
                    <th className="py-2 text-left font-medium">Trabajador asignado</th>
                    <th className="py-2 text-right font-medium pr-3">Monto</th>
                    <th className="py-2 text-right font-medium pr-3">Ya pagado</th>
                    <th className="py-2 text-right font-medium pr-3">Saldo</th>
                    <th className="py-2 text-right font-medium pr-3">Líquido total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={idx} className={`border-b border-gray-100 text-xs ${!it.incluir ? 'opacity-40' : ''}`}>
                      <td className="py-1.5">
                        <input type="checkbox" checked={it.incluir} onChange={() => toggleItem(idx)} className="w-3.5 h-3.5 accent-primary-600" />
                      </td>
                      <td className="py-1.5 max-w-[180px]">
                        <span className="truncate block font-medium text-gray-800" title={it.descripcion}>{it.nombre_extraido}</span>
                        <span className="text-gray-400 text-[10px]">{it.fecha}</span>
                      </td>
                      <td className="py-1.5 min-w-[200px]">
                        <div className="flex items-center gap-1.5">
                          {it.trabajador_id_sel ? (
                            it.match_confiable && it.trabajador_id_sel === it.trabajador_id
                              ? <Check size={11} className="text-green-600 flex-shrink-0" />
                              : <AlertCircle size={11} className="text-amber-500 flex-shrink-0" />
                          ) : <AlertCircle size={11} className="text-red-400 flex-shrink-0" />}
                          <select
                            className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white flex-1 min-w-0"
                            value={it.trabajador_id_sel ?? ''}
                            onChange={e => cambiarTrabajador(idx, e.target.value)}
                          >
                            <option value="">— Sin asignar —</option>
                            {todosTrabajadores.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                          </select>
                          {it.trabajador_id_sel === it.trabajador_id && it.score > 0 && (
                            <span className="text-[10px] text-gray-400 flex-shrink-0">({Math.round(it.score * 100)}%)</span>
                          )}
                        </div>
                      </td>
                      <td className="py-1.5 text-right font-mono pr-3">{fmt(it.monto)}</td>
                      <td className="py-1.5 text-right font-mono text-blue-600 pr-3">{it.ya_pagado > 0 ? fmt(it.ya_pagado) : '—'}</td>
                      <td className="py-1.5 text-right font-mono text-indigo-600 pr-3">{it.saldo > 0 ? fmt(it.saldo) : <span className="text-green-600">✓</span>}</td>
                      <td className="py-1.5 text-right font-mono text-gray-500 pr-3">{it.liquidado > 0 ? fmt(it.liquidado) : '—'}</td>
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

// ─────────────────────────────────────────────────────────────────
// Fila de trabajador
// ─────────────────────────────────────────────────────────────────
function TrabajadorRow({ t, mes, anio, onPagoManual, onReload }) {
  const [revirtiendo, setRevirtiendo] = useState(false)
  const isPagado = t.estado === 'PAGADO'
  const isParcial = t.estado === 'PARCIAL'
  const estadoCfg = ESTADO_CONFIG[t.estado] || ESTADO_CONFIG.PENDIENTE

  const revertir = async () => {
    if (!confirm(`¿Revertir TODOS los pagos de ${t.nombre} para ${MESES[mes]} ${anio}? Se reabrirá el mes.`)) return
    setRevirtiendo(true)
    try {
      await api.put(`/trabajadores/pago-mes/${t.id}`, { estado: 'PENDIENTE' }, { params: { mes, anio } })
      onReload()
    } catch {
      toast.error('Error revirtiendo pago'); onReload()
    } finally { setRevirtiendo(false) }
  }

  const updateFechaPago = async (fecha) => {
    if (!fecha || !t.pago_id) return
    try {
      await api.put(`/trabajadores/pago-mes/${t.id}`, { estado: 'PAGADO', fecha_pago: fecha }, { params: { mes, anio } })
      onReload()
    } catch { toast.error('Error actualizando fecha') }
  }

  return (
    <tr className={`border-b border-gray-100 text-sm ${isPagado ? 'bg-green-50/40' : isParcial ? 'bg-blue-50/30' : ''}`}>
      <td className="py-2 px-3 font-medium text-gray-900">{t.nombre}</td>
      <td className="py-2 px-3 text-gray-500 text-xs">{t.cargo || '—'}</td>
      <td className="py-2 px-3 text-right font-mono">{fmt(t.sueldo_bruto)}</td>
      <td className="py-2 px-3 text-right font-mono text-green-600">
        {(t.bonificaciones || 0) > 0 ? `+${fmt(t.bonificaciones)}` : '—'}
      </td>
      <td className="py-2 px-3 text-right font-mono text-red-600">
        {(t.descuento_cuotas || 0) > 0 ? `-${fmt(t.descuento_cuotas)}` : '—'}
      </td>
      <td className="py-2 px-3 text-right font-mono text-amber-600">
        {(t.descuento_ajustes || 0) > 0 ? `-${fmt(t.descuento_ajustes)}` : '—'}
      </td>
      <td className="py-2 px-3 text-right font-mono font-semibold text-gray-900">{fmt(t.monto_neto)}</td>
      {/* Ya pagado */}
      <td className="py-2 px-3 text-right font-mono text-blue-600">
        {(t.monto_pagado || 0) > 0 ? fmt(t.monto_pagado) : '—'}
      </td>
      {/* Saldo */}
      <td className="py-2 px-3 text-right font-mono">
        {isPagado
          ? <span className="text-green-600 text-xs">✓</span>
          : <span className={isParcial ? 'text-indigo-600 font-semibold' : 'text-gray-500'}>{fmt(t.saldo)}</span>
        }
      </td>
      {/* Estado */}
      <td className="py-2 px-3">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${estadoCfg.cls}`}>
          {isPagado && <Lock size={9} />}
          {estadoCfg.label}
        </span>
      </td>
      {/* Acciones */}
      <td className="py-2 px-3">
        {!isPagado && (
          <button
            onClick={() => onPagoManual(t)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800 hover:bg-indigo-200 transition-colors"
          >
            <CreditCard size={10} /> {isParcial ? 'Agregar pago' : 'Pagar'}
          </button>
        )}
      </td>
      {/* Fecha pago */}
      <td className="py-2 px-3 text-xs text-gray-500">
        {isPagado ? (
          <input
            type="date"
            defaultValue={t.fecha_pago || ''}
            key={t.fecha_pago}
            className="text-xs border border-gray-200 rounded px-1.5 py-0.5 w-32"
            onBlur={e => updateFechaPago(e.target.value)}
          />
        ) : '—'}
      </td>
      {/* Cuenta */}
      <td className="py-2 px-3 text-xs text-gray-400">
        {t.banco ? `${t.banco} · ${t.numero_cuenta || '—'}` : '—'}
      </td>
      {/* Revertir */}
      <td className="py-2 px-3">
        {(isPagado || isParcial) && (
          <button onClick={revertir} disabled={revirtiendo} title="Revertir todos los pagos"
            className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
            <RotateCcw size={13} />
          </button>
        )}
      </td>
    </tr>
  )
}

// ─────────────────────────────────────────────────────────────────
// Página principal
// ─────────────────────────────────────────────────────────────────
export default function PagosTrabajadores() {
  const hoy = new Date()
  const [mes, setMes] = useState(hoy.getMonth() + 1)
  const [anio, setAnio] = useState(hoy.getFullYear())
  const [data, setData] = useState([])
  const [cargando, setCargando] = useState(false)
  const [modalCartola, setModalCartola] = useState(false)
  const [modalPago, setModalPago] = useState(null)
  const [filterText, setFilterText] = useState('')
  const [filterEstado, setFilterEstado] = useState('')
  const [sortMonto, setSortMonto] = useState(null)

  const cargar = async () => {
    setCargando(true)
    try {
      const { data: res } = await api.get('/trabajadores/pagos-mes', { params: { mes, anio } })
      setData(res.items || [])
    } catch { toast.error('Error cargando pagos') }
    finally { setCargando(false) }
  }

  useEffect(() => { cargar() }, [mes, anio])

  const descargarPlantilla = async () => {
    try {
      const res = await api.get('/trabajadores/plantilla-bancaria-trabajadores',
        { params: { mes, anio }, responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a'); a.href = url
      a.download = `nomina_${mes}_${anio}.xlsx`; a.click()
      URL.revokeObjectURL(url)
    } catch { toast.error('Error descargando plantilla') }
  }

  const resumen = useMemo(() => {
    const activos = data.length
    const pagados = data.filter(t => t.estado === 'PAGADO').length
    const parciales = data.filter(t => t.estado === 'PARCIAL').length
    const totalBruto = data.reduce((s, t) => s + (t.sueldo_bruto || 0), 0)
    const totalLiquido = data.reduce((s, t) => s + (t.monto_neto || 0), 0)
    const totalSaldo = data.filter(t => t.estado !== 'PAGADO').reduce((s, t) => s + (t.saldo || 0), 0)
    return { activos, pagados, parciales, totalBruto, totalLiquido, totalSaldo }
  }, [data])

  const anos = []
  for (let y = hoy.getFullYear() - 2; y <= hoy.getFullYear() + 1; y++) anos.push(y)

  const trabajadores = useMemo(() => {
    let result = data
    if (filterText) {
      const q = filterText.toLowerCase()
      result = result.filter(t => t.nombre.toLowerCase().includes(q))
    }
    if (filterEstado) {
      result = result.filter(t => t.estado === filterEstado)
    }
    if (sortMonto) {
      result = [...result].sort((a, b) =>
        sortMonto === 'desc' ? (b.monto_neto || 0) - (a.monto_neto || 0) : (a.monto_neto || 0) - (b.monto_neto || 0)
      )
    }
    return result
  }, [data, filterText, filterEstado, sortMonto])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pagos Trabajadores"
        subtitle="Nómina mensual · El período indica a qué mes corresponde la nómina"
        icon={Users}
        accent="purple"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <select className="input w-36" value={mes} onChange={e => setMes(Number(e.target.value))}>
                {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
              <select className="input w-24" value={anio} onChange={e => setAnio(Number(e.target.value))}>
                {anos.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <button onClick={descargarPlantilla} className="btn btn-secondary flex items-center gap-2 text-sm">
              <Download size={14} /> Plantilla
            </button>
            <button onClick={() => setModalCartola(true)} className="btn btn-secondary flex items-center gap-2 text-sm">
              <Upload size={14} /> Cargar Cartola
            </button>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatsCard icon={Users} label="Estado pagos"
          value={`${resumen.pagados} pagados`}
          sub={`${resumen.parciales} parciales · ${resumen.activos - resumen.pagados - resumen.parciales} pendientes`}
          color="blue" />
        <StatsCard icon={DollarSign} label="Costo bruto total" value={fmt(resumen.totalBruto)} sub={MESES[mes]} color="purple" />
        <StatsCard icon={DollarSign} label="Líquido total" value={fmt(resumen.totalLiquido)} sub="Después de descuentos" color="green" />
        <StatsCard icon={Calendar} label="Saldo por pagar" value={fmt(resumen.totalSaldo)} sub="Pendientes + parciales" color="amber" />
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
          <div>
            <span className="text-sm font-semibold text-gray-800">Nómina {MESES[mes]} {anio}</span>
            <span className="ml-2 text-xs text-gray-400">· Pago físico puede ocurrir en {MESES[mes === 12 ? 1 : mes + 1] || 'mes siguiente'}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input type="text" placeholder="Buscar trabajador..." className="input w-44 text-sm"
              value={filterText} onChange={e => setFilterText(e.target.value)} />
            <div className="flex items-center gap-1">
              {[
                { value: '', label: 'Todos' },
                { value: 'PENDIENTE', label: 'Pendientes', active: 'bg-amber-100 text-amber-800 border-amber-400 font-semibold' },
                { value: 'PARCIAL', label: 'Parciales', active: 'bg-blue-100 text-blue-800 border-blue-400 font-semibold' },
                { value: 'PAGADO', label: 'Pagados', active: 'bg-green-100 text-green-800 border-green-400 font-semibold' },
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
            <span className="text-xs text-gray-400">{trabajadores.length} trabajadores</span>
          </div>
        </div>

        {cargando ? (
          <div className="py-12 text-center text-gray-400 text-sm">Cargando...</div>
        ) : data.length === 0 ? (
          <div className="py-12 text-center text-gray-400 text-sm">No hay trabajadores activos</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-200 bg-gray-50">
                  <th className="py-2 px-3 text-left font-medium">Nombre</th>
                  <th className="py-2 px-3 text-left font-medium">Cargo</th>
                  <th className="py-2 px-3 text-right font-medium">Bruto</th>
                  <th className="py-2 px-3 text-right font-medium text-green-600">Bonif.</th>
                  <th className="py-2 px-3 text-right font-medium text-red-500">Cuotas</th>
                  <th className="py-2 px-3 text-right font-medium text-amber-500">Ajustes</th>
                  <th className="py-2 px-3 text-right font-medium cursor-pointer select-none hover:text-primary-600"
                    onClick={() => setSortMonto(s => s === 'desc' ? 'asc' : s === 'asc' ? null : 'desc')}
                    title="Ordenar por líquido">
                    Líquido {sortMonto === 'desc' ? ' ↓' : sortMonto === 'asc' ? ' ↑' : ''}
                  </th>
                  <th className="py-2 px-3 text-right font-medium text-blue-600">Ya pagado</th>
                  <th className="py-2 px-3 text-right font-medium text-indigo-600">Saldo</th>
                  <th className="py-2 px-3 text-left font-medium">Estado</th>
                  <th className="py-2 px-3 text-left font-medium">Acción</th>
                  <th className="py-2 px-3 text-left font-medium">Fecha Pago Real</th>
                  <th className="py-2 px-3 text-left font-medium">Cuenta</th>
                  <th className="py-2 px-3 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {trabajadores.map(t => (
                  <TrabajadorRow key={t.id} t={t} mes={mes} anio={anio} onPagoManual={setModalPago} onReload={cargar} />
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 border-t-2 border-gray-200 text-sm font-semibold text-gray-800">
                  <td className="py-2 px-3 text-xs text-gray-500" colSpan={2}>Total</td>
                  <td className="py-2 px-3 text-right font-mono">{fmt(trabajadores.reduce((s, t) => s + (t.sueldo_bruto || 0), 0))}</td>
                  <td className="py-2 px-3 text-right font-mono text-green-600">
                    {fmt(trabajadores.reduce((s, t) => s + (t.bonificaciones || 0), 0))}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-red-600">
                    {fmt(trabajadores.reduce((s, t) => s + (t.descuento_cuotas || 0), 0))}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-amber-600">
                    {fmt(trabajadores.reduce((s, t) => s + (t.descuento_ajustes || 0), 0))}
                  </td>
                  <td className="py-2 px-3 text-right font-mono">{fmt(trabajadores.reduce((s, t) => s + (t.monto_neto || 0), 0))}</td>
                  <td className="py-2 px-3 text-right font-mono text-blue-600">
                    {fmt(trabajadores.reduce((s, t) => s + (t.monto_pagado || 0), 0))}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-indigo-600">{fmt(trabajadores.filter(t => t.estado !== 'PAGADO').reduce((s, t) => s + (t.saldo || 0), 0))}</td>
                  <td colSpan={5}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {modalPago && (
        <ModalPagoManual
          trabajador={modalPago}
          mesNomina={mes}
          anioNomina={anio}
          onClose={() => setModalPago(null)}
          onConfirmado={cargar}
        />
      )}

      {modalCartola && (
        <ModalCartola mes={mes} anio={anio} onClose={() => setModalCartola(false)} onConfirmado={cargar} />
      )}
    </div>
  )
}
