import React, { useState, useEffect, useMemo, useRef } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import {
  Users, Download, Upload, FileText, X, Check, AlertCircle,
  DollarSign, Lock, Calendar,
} from 'lucide-react'

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

const ESTADO_COLORS = {
  PENDIENTE: 'bg-amber-100 text-amber-800',
  PAGADO: 'bg-green-100 text-green-800',
}

function fmt(v) {
  if (!v && v !== 0) return '$0'
  return `$${Math.abs(Number(v)).toLocaleString('es-CL')}`
}

function StatsCard({ icon: Icon, label, value, sub, color = 'blue' }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
  }
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-start gap-3">
      <div className={`p-2 rounded-lg ${colors[color]}`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 font-medium">{label}</p>
        <p className="text-lg font-bold text-gray-900 truncate">{value}</p>
        {sub && <p className="text-xs text-gray-400 truncate">{sub}</p>}
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
      const { data } = await api.post('/trabajadores/cartola-trabajadores/preview', form, {
        params: { mes, anio },
      })
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

  const toggleItem = (idx) =>
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, incluir: !it.incluir } : it))

  const cambiarTrabajador = (idx, tid) => {
    const t = todosTrabajadores.find(x => x.id === Number(tid))
    setItems(prev => prev.map((it, i) => i === idx ? {
      ...it,
      trabajador_id_sel: t ? t.id : null,
      trabajador_nombre_sel: t ? t.nombre : null,
      incluir: t != null,
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
          trabajador_id: it.trabajador_id_sel,
          monto: it.monto,
          fecha: it.fecha,
          descripcion: it.descripcion,
          nombre_extraido: it.nombre_extraido,
        })),
      })
      toast.success(`${seleccionados.length} pagos registrados`)
      onConfirmado()
      onClose()
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
            <p className="text-sm text-gray-500">{MESES[mes]} {anio}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
        </div>

        <div className="px-6 py-4 border-b border-gray-100 flex flex-wrap items-end gap-4">
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
                <span className="inline-flex items-center gap-1 text-amber-600"><AlertCircle size={12} /> Match incierto</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-200">
                    <th className="py-2 w-8"></th>
                    <th className="py-2 text-left font-medium">Nombre en cartola</th>
                    <th className="py-2 text-left font-medium">Trabajador asignado</th>
                    <th className="py-2 text-right font-medium pr-4">Monto</th>
                    <th className="py-2 text-right font-medium pr-4">Ya pagado</th>
                    <th className="py-2 text-right font-medium pr-4">Líquido</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={idx} className={`border-b border-gray-100 text-xs ${!it.incluir ? 'opacity-40' : ''}`}>
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
                          {it.trabajador_id_sel ? (
                            it.match_confiable && it.trabajador_id_sel === it.trabajador_id
                              ? <Check size={11} className="text-green-600 flex-shrink-0" />
                              : <AlertCircle size={11} className="text-amber-500 flex-shrink-0" />
                          ) : (
                            <AlertCircle size={11} className="text-red-400 flex-shrink-0" />
                          )}
                          <select
                            className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white flex-1 min-w-0"
                            value={it.trabajador_id_sel ?? ''}
                            onChange={e => cambiarTrabajador(idx, e.target.value)}
                          >
                            <option value="">— Sin asignar —</option>
                            {todosTrabajadores.map(t => (
                              <option key={t.id} value={t.id}>{t.nombre}</option>
                            ))}
                          </select>
                          {it.trabajador_id_sel === it.trabajador_id && it.score > 0 && (
                            <span className="text-[10px] text-gray-400 flex-shrink-0">
                              ({Math.round(it.score * 100)}%)
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-1.5 text-right font-mono pr-4">{fmt(it.monto)}</td>
                      <td className="py-1.5 text-right font-mono text-blue-600 pr-4">{it.ya_pagado > 0 ? fmt(it.ya_pagado) : '—'}</td>
                      <td className="py-1.5 text-right font-mono text-gray-600 pr-4">{it.liquidado > 0 ? fmt(it.liquidado) : '—'}</td>
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
function TrabajadorRow({ t, mes, anio, onReload }) {
  const [actualizando, setActualizando] = useState(false)
  const isPagado = t.estado === 'PAGADO'

  const updateEstado = async (estado) => {
    const fechaPago = estado === 'PAGADO' ? new Date().toISOString().split('T')[0] : null
    setActualizando(true)
    try {
      await api.put(`/trabajadores/pago-mes/${t.id}`,
        { estado, fecha_pago: fechaPago },
        { params: { mes, anio } }
      )
      onReload()
    } catch {
      toast.error('Error actualizando estado')
      onReload()
    } finally { setActualizando(false) }
  }

  const updateFechaPago = async (fecha) => {
    if (!fecha || !t.pago_id) return
    try {
      await api.put(`/trabajadores/pago-mes/${t.id}`,
        { estado: 'PAGADO', fecha_pago: fecha },
        { params: { mes, anio } }
      )
      onReload()
    } catch { toast.error('Error actualizando fecha') }
  }

  return (
    <tr className={`border-b border-gray-100 text-sm ${isPagado ? 'bg-green-50/40' : ''}`}>
      <td className="py-2 px-3 font-medium text-gray-900">{t.nombre}</td>
      <td className="py-2 px-3 text-gray-500 text-xs">{t.cargo || '—'}</td>
      <td className="py-2 px-3 text-right font-mono">{fmt(t.sueldo_bruto)}</td>
      <td className="py-2 px-3 text-right font-mono text-red-600">
        {t.descuento_cuotas > 0 ? `-${fmt(t.descuento_cuotas)}` : '—'}
      </td>
      <td className="py-2 px-3 text-right font-mono text-amber-600">
        {t.descuento_ajustes > 0 ? `-${fmt(t.descuento_ajustes)}` : '—'}
      </td>
      <td className="py-2 px-3 text-right font-mono font-semibold text-gray-900">{fmt(t.monto_neto)}</td>
      <td className="py-2 px-3">
        {isPagado ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
            <Lock size={10} /> PAGADO
          </span>
        ) : (
          <button
            onClick={() => updateEstado('PAGADO')}
            disabled={actualizando}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 hover:bg-amber-200 transition-colors"
          >
            {actualizando ? '...' : 'PENDIENTE'}
          </button>
        )}
      </td>
      <td className="py-2 px-3 text-xs text-gray-500">
        {isPagado ? (
          <input
            type="date"
            defaultValue={t.fecha_pago || ''}
            className="text-xs border border-gray-200 rounded px-1.5 py-0.5 w-32"
            onBlur={e => updateFechaPago(e.target.value)}
          />
        ) : '—'}
      </td>
      <td className="py-2 px-3 text-xs text-gray-400">
        {t.banco ? `${t.banco} · ${t.numero_cuenta || '—'}` : '—'}
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

  const cargar = async () => {
    setCargando(true)
    try {
      const { data: res } = await api.get('/trabajadores/pagos-mes', { params: { mes, anio } })
      setData(res.items || [])
    } catch {
      toast.error('Error cargando pagos')
    } finally { setCargando(false) }
  }

  useEffect(() => { cargar() }, [mes, anio])

  const descargarPlantilla = async () => {
    try {
      const res = await api.get('/trabajadores/plantilla-bancaria-trabajadores',
        { params: { mes, anio }, responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `nomina_${mes}_${anio}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch { toast.error('Error descargando plantilla') }
  }

  const resumen = useMemo(() => {
    const activos = data.length
    const pagados = data.filter(t => t.estado === 'PAGADO').length
    const totalBruto = data.reduce((s, t) => s + (t.sueldo_bruto || 0), 0)
    const totalLiquido = data.reduce((s, t) => s + (t.monto_neto || 0), 0)
    const totalPendiente = data.filter(t => t.estado !== 'PAGADO').reduce((s, t) => s + (t.monto_neto || 0), 0)
    return { activos, pagados, totalBruto, totalLiquido, totalPendiente }
  }, [data])

  const anos = []
  for (let y = hoy.getFullYear() - 2; y <= hoy.getFullYear() + 1; y++) anos.push(y)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-100 rounded-xl">
            <Users size={22} className="text-indigo-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Pagos Trabajadores</h1>
            <p className="text-sm text-gray-500">Nómina mensual</p>
          </div>
        </div>

        {/* Selector de período */}
        <div className="flex items-center gap-2 flex-wrap">
          <select className="input w-36" value={mes} onChange={e => setMes(Number(e.target.value))}>
            {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
          <select className="input w-24" value={anio} onChange={e => setAnio(Number(e.target.value))}>
            {anos.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={descargarPlantilla} className="btn btn-secondary flex items-center gap-2 text-sm">
            <Download size={14} /> Plantilla
          </button>
          <button onClick={() => setModalCartola(true)} className="btn btn-secondary flex items-center gap-2 text-sm">
            <Upload size={14} /> Cargar Cartola
          </button>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatsCard icon={Users} label="Trabajadores" value={`${resumen.pagados}/${resumen.activos} pagados`} color="blue" />
        <StatsCard icon={DollarSign} label="Costo bruto total" value={fmt(resumen.totalBruto)} sub={MESES[mes]} color="purple" />
        <StatsCard icon={DollarSign} label="Líquido total" value={fmt(resumen.totalLiquido)} sub="Después de descuentos" color="green" />
        <StatsCard icon={Calendar} label="Pendiente de pago" value={fmt(resumen.totalPendiente)} sub="Trabajadores no pagados" color="amber" />
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-800">
            {MESES[mes]} {anio}
          </span>
          <span className="text-xs text-gray-400">{data.length} trabajadores</span>
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
                  <th className="py-2 px-3 text-right font-medium">Sueldo Bruto</th>
                  <th className="py-2 px-3 text-right font-medium">Cuotas Préstamo</th>
                  <th className="py-2 px-3 text-right font-medium">Ajustes</th>
                  <th className="py-2 px-3 text-right font-medium">Líquido</th>
                  <th className="py-2 px-3 text-left font-medium">Estado</th>
                  <th className="py-2 px-3 text-left font-medium">Fecha Pago</th>
                  <th className="py-2 px-3 text-left font-medium">Cuenta</th>
                </tr>
              </thead>
              <tbody>
                {data.map(t => (
                  <TrabajadorRow
                    key={t.id}
                    t={t}
                    mes={mes}
                    anio={anio}
                    onReload={cargar}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 border-t-2 border-gray-200 text-sm font-semibold text-gray-800">
                  <td className="py-2 px-3 text-xs text-gray-500" colSpan={2}>Total</td>
                  <td className="py-2 px-3 text-right font-mono">{fmt(resumen.totalBruto)}</td>
                  <td className="py-2 px-3 text-right font-mono text-red-600">
                    {fmt(data.reduce((s, t) => s + (t.descuento_cuotas || 0), 0))}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-amber-600">
                    {fmt(data.reduce((s, t) => s + (t.descuento_ajustes || 0), 0))}
                  </td>
                  <td className="py-2 px-3 text-right font-mono">{fmt(resumen.totalLiquido)}</td>
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Modal cartola */}
      {modalCartola && (
        <ModalCartola
          mes={mes}
          anio={anio}
          onClose={() => setModalCartola(false)}
          onConfirmado={cargar}
        />
      )}
    </div>
  )
}
