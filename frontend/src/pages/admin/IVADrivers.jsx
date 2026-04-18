import React, { useState, useEffect, useCallback } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import {
  Download, Upload, CheckCircle, Clock, AlertCircle,
  FileText, RefreshCw, X, Check,
} from 'lucide-react'
import PageHeader from '../../components/PageHeader'

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

function fmt(v) {
  if (v == null || v === '') return '$0'
  return `$${Math.abs(Number(v)).toLocaleString('es-CL')}`
}

const ESTADO_BADGE = {
  PENDIENTE: 'bg-amber-100 text-amber-800',
  PAGADO:    'bg-green-100 text-green-800',
  PARCIAL:   'bg-orange-100 text-orange-800',
}

const BANCOS_TEF_VALIDOS = new Set([
  'banco de chile', 'banco internacional', 'scotiabank', 'banco scotiabank', 'scotiabank chile',
  'banco bice', 'bice', 'banco estado', 'banco estado de chile', 'bancoestado',
  'bci', 'banco bci', 'banco de credito e inversiones',
  'itau', 'itaú', 'banco itau', 'itaucorpbanca', 'itau corpbanca', 'corpbanca',
  'security', 'banco security', 'santander', 'banco santander', 'santander chile',
  'consorcio', 'banco consorcio', 'falabella', 'banco falabella', 'ripley', 'banco ripley',
  'coopeuch', 'prepago los heroes', 'prepago los héroes', 'tenpo', 'copec pay',
  'mach', 'machbank', 'mercado pago', 'mercadopago',
])

// ── Modal TEF ──────────────────────────────────────────────────────────────

function ModalTEF({ items, mes, anio, onClose }) {
  const [seleccion, setSeleccion] = useState(() =>
    items.map(it => ({ ...it, incluir: it.estado !== 'PAGADO' && it.saldo_pendiente > 0, monto: it.monto_iva }))
  )
  const [cargando, setCargando] = useState(false)

  const toggle = id => setSeleccion(prev => prev.map(it => it.id === id ? { ...it, incluir: !it.incluir } : it))
  const setMonto = (id, val) => setSeleccion(prev => prev.map(it => it.id === id ? { ...it, monto: Number(val) || 0 } : it))
  const seleccionados = seleccion.filter(it => it.incluir && it.monto > 0)
  const totalTEF = seleccionados.reduce((a, it) => a + it.monto, 0)

  const descargar = async () => {
    if (!seleccionados.length) return toast.error('Selecciona al menos un driver')
    const sinBanco = seleccionados.filter(it => !it.banco || !it.numero_cuenta)
    if (sinBanco.length) {
      return toast.error(`Sin datos bancarios: ${sinBanco.map(d => d.driver_nombre).join(', ')}`)
    }
    const bancoInvalido = seleccionados.filter(it => !BANCOS_TEF_VALIDOS.has((it.banco || '').toLowerCase().trim()))
    if (bancoInvalido.length) {
      return toast.error(`Banco no soportado: ${bancoInvalido.map(d => `${d.driver_nombre} (${d.banco})`).join(', ')}`)
    }
    setCargando(true)
    try {
      const res = await api.post('/iva-drivers/generar-tef', {
        mes, anio,
        items: seleccionados.map(it => ({
          pago_iva_id: it.id,
          driver_id: it.driver_id,
          monto: it.monto,
        })),
      }, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `TEF_IVA_Drivers_${mes}_${anio}.txt`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('TEF generado')
      onClose()
    } catch {
      toast.error('Error al generar TEF')
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-semibold text-gray-800">Generar TEF — IVA Conductores</h2>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {seleccion.map(it => (
            <div key={it.id} className={`flex items-center gap-3 p-3 rounded-lg border ${it.incluir ? 'border-blue-200 bg-blue-50' : 'border-gray-200'}`}>
              <input type="checkbox" checked={it.incluir} onChange={() => toggle(it.id)} className="w-4 h-4" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-gray-800 truncate">{it.driver_nombre}</p>
                <p className="text-xs text-gray-500">{it.banco} · {it.numero_cuenta}</p>
              </div>
              <input
                type="number"
                value={it.monto}
                onChange={e => setMonto(it.id, e.target.value)}
                className="w-32 text-right border rounded px-2 py-1 text-sm"
                min={0}
              />
            </div>
          ))}
        </div>
        <div className="border-t p-4 flex items-center justify-between">
          <div>
            <span className="text-sm text-gray-500">{seleccionados.length} driver(s) · </span>
            <span className="font-semibold text-gray-800">{fmt(totalTEF)}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancelar</button>
            <button
              onClick={descargar}
              disabled={cargando || !seleccionados.length}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              <Download size={15} />
              {cargando ? 'Generando...' : 'Descargar TEF'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Modal Cartola ──────────────────────────────────────────────────────────

function ModalCartola({ mes, anio, onClose, onConfirmado }) {
  const [fase, setFase] = useState('upload')   // upload | preview | confirmando
  const [archivo, setArchivo] = useState(null)
  const [preview, setPreview] = useState([])
  const [driversPendientes, setDriversPendientes] = useState([])
  const [cargando, setCargando] = useState(false)

  const subirCartola = async () => {
    if (!archivo) return toast.error('Selecciona un archivo')
    setCargando(true)
    const form = new FormData()
    form.append('archivo', archivo)
    try {
      const res = await api.post(`/iva-drivers/cartola/preview?mes=${mes}&anio=${anio}`, form,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      setPreview(res.data.items.map(it => ({ ...it, incluir: it.match_confiable && !it.ya_existe })))
      setDriversPendientes(res.data.drivers_pendientes || [])
      setFase('preview')
    } catch {
      toast.error('Error al procesar la cartola')
    } finally {
      setCargando(false)
    }
  }

  const toggle = idx => setPreview(prev => prev.map((it, i) => i === idx ? { ...it, incluir: !it.incluir } : it))
  const setDriver = (idx, driver_id) => setPreview(prev => prev.map((it, i) => {
    if (i !== idx) return it
    const d = driversPendientes.find(d => d.id === Number(driver_id))
    return { ...it, driver_id: d?.id || null, driver_nombre: d?.nombre || '', incluir: !!d }
  }))

  const confirmar = async () => {
    const seleccionados = preview.filter(it => it.incluir && it.driver_id)
    if (!seleccionados.length) return toast.error('Nada seleccionado')
    setCargando(true)
    try {
      const res = await api.post('/iva-drivers/cartola/confirmar', {
        mes, anio,
        items: seleccionados.map(it => ({
          driver_id: it.driver_id,
          monto: it.monto,
          fecha: it.fecha,
          descripcion: it.descripcion,
          nombre_extraido: it.nombre_extraido,
          fingerprint: it.fingerprint,
        })),
      })
      toast.success(`${res.data.grabados} pago(s) confirmado(s)`)
      onConfirmado()
      onClose()
    } catch {
      toast.error('Error al confirmar')
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-semibold text-gray-800">Importar Cartola IVA</h2>
          <button onClick={onClose}><X size={18} /></button>
        </div>

        {fase === 'upload' && (
          <div className="p-6 flex flex-col items-center gap-4">
            <p className="text-sm text-gray-500 text-center">
              Sube la cartola bancaria que contiene los traspasos de IVA de {MESES[mes]} {anio}.
              <br />
              <strong>Solo</strong> se cotejará contra pagos IVA pendientes — no afecta los pagos semanales.
            </p>
            <input
              type="file"
              accept=".xls,.xlsx"
              onChange={e => setArchivo(e.target.files[0])}
              className="block"
            />
            <button
              onClick={subirCartola}
              disabled={!archivo || cargando}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
            >
              <Upload size={15} />
              {cargando ? 'Procesando...' : 'Analizar Cartola'}
            </button>
          </div>
        )}

        {fase === 'preview' && (
          <>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {preview.length === 0 && (
                <p className="text-center text-gray-400 py-8">No se encontraron movimientos compatibles</p>
              )}
              {preview.map((it, idx) => (
                <div
                  key={idx}
                  className={`p-3 rounded-lg border text-sm transition-colors ${it.ya_existe ? 'bg-gray-50 opacity-60 border-gray-200' : it.incluir ? 'border-blue-200 bg-blue-50' : 'border-gray-200'}`}
                >
                  <div className="flex items-start gap-3">
                    {!it.ya_existe && (
                      <input type="checkbox" checked={it.incluir} onChange={() => toggle(idx)} className="mt-0.5 w-4 h-4" />
                    )}
                    {it.ya_existe && <span className="text-xs text-gray-400 mt-0.5">Ya importado</span>}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-800 truncate">{it.descripcion}</p>
                      <p className="text-xs text-gray-500">{it.fecha} · {fmt(it.monto)}</p>
                    </div>
                    <div className="shrink-0 min-w-[160px]">
                      <select
                        value={it.driver_id || ''}
                        onChange={e => setDriver(idx, e.target.value)}
                        disabled={it.ya_existe}
                        className="text-xs border rounded px-1 py-1 w-full"
                      >
                        <option value="">— Sin match —</option>
                        {driversPendientes.map(d => (
                          <option key={d.id} value={d.id}>{d.nombre} ({fmt(d.iva)})</option>
                        ))}
                      </select>
                      {it.score != null && (
                        <p className={`text-xs mt-0.5 ${it.match_confiable ? 'text-green-600' : 'text-amber-500'}`}>
                          Score {(it.score * 100).toFixed(0)}%
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t p-4 flex justify-between items-center">
              <p className="text-sm text-gray-500">
                {preview.filter(it => it.incluir).length} de {preview.length} seleccionados
              </p>
              <div className="flex gap-2">
                <button onClick={() => setFase('upload')} className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-50">Volver</button>
                <button
                  onClick={confirmar}
                  disabled={cargando || !preview.some(it => it.incluir && it.driver_id)}
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  <Check size={15} />
                  {cargando ? 'Guardando...' : 'Confirmar'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Modal Pago Manual ──────────────────────────────────────────────────────

function ModalPagoManual({ item, onClose, onConfirmado }) {
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10))
  const [nota, setNota] = useState('')
  const [cargando, setCargando] = useState(false)

  const confirmar = async () => {
    setCargando(true)
    try {
      await api.put(`/iva-drivers/${item.id}/marcar-pagado`, {
        fecha_pago: fecha,
        nota: nota || null,
      })
      toast.success(`IVA de ${item.driver_nombre} marcado como pagado`)
      onConfirmado()
      onClose()
    } catch {
      toast.error('Error al registrar el pago')
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-semibold text-gray-800">Registrar Pago Manual IVA</h2>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-gray-50 rounded-lg p-3 text-sm">
            <p className="font-medium text-gray-800">{item.driver_nombre}</p>
            <p className="text-gray-500">IVA a pagar: <span className="font-semibold text-gray-800">{fmt(item.monto_iva)}</span></p>
            <p className="text-gray-500">Período: {MESES[item.mes_origen]} {item.anio_origen}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de pago</label>
            <input
              type="date"
              value={fecha}
              onChange={e => setFecha(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nota (opcional)</label>
            <input
              type="text"
              value={nota}
              onChange={e => setNota(e.target.value)}
              placeholder="Ej: Transferido vía app banco"
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t">
          <button onClick={onClose} className="px-3 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancelar</button>
          <button
            onClick={confirmar}
            disabled={cargando}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            <CheckCircle size={15} />
            {cargando ? 'Guardando...' : 'Confirmar Pago'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Página principal ───────────────────────────────────────────────────────

export default function IVADrivers() {
  const hoy = new Date()
  const [mes, setMes] = useState(hoy.getMonth() + 1)
  const [anio, setAnio] = useState(hoy.getFullYear())
  const [items, setItems] = useState([])
  const [resumen, setResumen] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState('')

  const [modalTEF, setModalTEF] = useState(false)
  const [modalCartola, setModalCartola] = useState(false)
  const [modalManual, setModalManual] = useState(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const [tablaRes, resumenRes] = await Promise.all([
        api.get(`/iva-drivers/tabla?mes=${mes}&anio=${anio}${filtroEstado ? `&estado=${filtroEstado}` : ''}`),
        api.get(`/iva-drivers/resumen?mes=${mes}&anio=${anio}`),
      ])
      setItems(tablaRes.data.items || [])
      setResumen(resumenRes.data)
    } catch {
      toast.error('Error al cargar datos IVA')
    } finally {
      setCargando(false)
    }
  }, [mes, anio, filtroEstado])

  useEffect(() => { cargar() }, [cargar])

  const pendientes = items.filter(it => it.estado !== 'PAGADO')
  const totalPendienteVisible = pendientes.reduce((a, it) => a + (it.monto_iva || 0), 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="IVA Conductores"
        subtitle="Control de pagos de IVA a drivers que emiten facturas"
      />

      {/* Controles de período y acciones */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={mes}
          onChange={e => setMes(Number(e.target.value))}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          {MESES.slice(1).map((m, i) => (
            <option key={i + 1} value={i + 1}>{m}</option>
          ))}
        </select>
        <input
          type="number"
          value={anio}
          onChange={e => setAnio(Number(e.target.value))}
          className="border rounded-lg px-3 py-2 text-sm w-24"
        />
        <select
          value={filtroEstado}
          onChange={e => setFiltroEstado(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          <option value="">Todos</option>
          <option value="PENDIENTE">Pendiente</option>
          <option value="PARCIAL">Parcial</option>
          <option value="PAGADO">Pagado</option>
        </select>
        <button
          onClick={cargar}
          disabled={cargando}
          className="flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50"
        >
          <RefreshCw size={14} className={cargando ? 'animate-spin' : ''} />
          Actualizar
        </button>
        <div className="flex-1" />
        <button
          onClick={() => setModalCartola(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          <Upload size={14} />
          Importar Cartola
        </button>
        <button
          onClick={() => setModalTEF(true)}
          disabled={pendientes.length === 0}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          <Download size={14} />
          Generar TEF
        </button>
      </div>

      {/* Resumen */}
      {resumen && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'IVA Pendiente', value: resumen.total_pendiente, color: 'text-amber-600', count: resumen.count_pendiente },
            { label: 'IVA Pagado', value: resumen.total_pagado, color: 'text-green-600', count: resumen.count_pagado },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border p-4">
              <p className="text-xs text-gray-500 mb-1">{s.label}</p>
              <p className={`text-xl font-bold ${s.color}`}>{fmt(s.value)}</p>
              <p className="text-xs text-gray-400 mt-0.5">{s.count} driver(s)</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabla */}
      <div className="bg-white rounded-xl border overflow-hidden">
        {cargando ? (
          <div className="p-12 text-center text-gray-400">Cargando...</div>
        ) : items.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <FileText size={32} className="mx-auto mb-2 opacity-40" />
            <p>No hay registros de IVA para {MESES[mes]} {anio}</p>
            <p className="text-xs mt-1">Los registros se crean automáticamente al aprobar facturas de conductores</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Conductor</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Base Imponible</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">IVA (19%)</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Pagado</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Saldo</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600">Facturas</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600">Estado</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map(it => (
                <tr key={it.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-800">{it.driver_nombre}</p>
                    <p className="text-xs text-gray-400">{it.rut}</p>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">{fmt(it.base_imponible)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-800">{fmt(it.monto_iva)}</td>
                  <td className="px-4 py-3 text-right text-green-600">{fmt(it.monto_pagado)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-amber-600">
                    {it.saldo_pendiente > 0 ? fmt(it.saldo_pendiente) : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full">
                      {it.facturas_count}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ESTADO_BADGE[it.estado]}`}>
                      {it.estado}
                    </span>
                    {it.fecha_pago && (
                      <p className="text-xs text-gray-400 mt-0.5">{it.fecha_pago}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {it.estado !== 'PAGADO' && (
                      <button
                        onClick={() => setModalManual(it)}
                        className="flex items-center gap-1 px-2 py-1 text-xs bg-green-50 text-green-700 border border-green-200 rounded hover:bg-green-100 mx-auto"
                      >
                        <CheckCircle size={12} />
                        Pagar
                      </button>
                    )}
                    {it.estado === 'PAGADO' && (
                      <span className="text-green-500"><CheckCircle size={16} className="mx-auto" /></span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            {items.length > 0 && (
              <tfoot className="bg-gray-50 border-t font-semibold">
                <tr>
                  <td className="px-4 py-3 text-gray-700">Total</td>
                  <td className="px-4 py-3 text-right text-gray-700">
                    {fmt(items.reduce((a, it) => a + (it.base_imponible || 0), 0))}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-800">
                    {fmt(items.reduce((a, it) => a + (it.monto_iva || 0), 0))}
                  </td>
                  <td className="px-4 py-3 text-right text-green-600">
                    {fmt(items.reduce((a, it) => a + (it.monto_pagado || 0), 0))}
                  </td>
                  <td className="px-4 py-3 text-right text-amber-600">
                    {fmt(items.reduce((a, it) => a + (it.saldo_pendiente || 0), 0))}
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>

      {/* Nota informativa */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-700">
        <p className="font-medium mb-1">¿Cómo funciona?</p>
        <ul className="list-disc list-inside space-y-1 text-blue-600">
          <li>Los registros se crean <strong>automáticamente</strong> al aprobar una factura en CPC Drivers.</li>
          <li>La base imponible = total liquidado al conductor en el mes (envíos + retiros + ajustes).</li>
          <li>El IVA se calcula sobre ese total × 19%.</li>
          <li>Genera el TEF o sube la cartola en esta sección — <strong>no afecta los pagos semanales de CPC</strong>.</li>
        </ul>
      </div>

      {modalTEF && (
        <ModalTEF items={items} mes={mes} anio={anio} onClose={() => setModalTEF(false)} />
      )}
      {modalCartola && (
        <ModalCartola mes={mes} anio={anio} onClose={() => setModalCartola(false)} onConfirmado={cargar} />
      )}
      {modalManual && (
        <ModalPagoManual item={modalManual} onClose={() => setModalManual(null)} onConfirmado={cargar} />
      )}
    </div>
  )
}
