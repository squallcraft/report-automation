import React, { useState, useEffect, useCallback } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import {
  RefreshCw, FileText, TrendingUp, TrendingDown, AlertTriangle, CheckCircle,
} from 'lucide-react'
import PageHeader from '../../components/PageHeader'

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

function fmt(v) {
  if (v == null) return '$0'
  return `$${Number(v).toLocaleString('es-CL')}`
}

// ── Tarjeta de resumen ────────────────────────────────────────────────────────

function Card({ label, value, sub, color = 'gray', icon: Icon, small }) {
  const colorMap = {
    green:  'text-green-600 border-green-200 bg-green-50',
    red:    'text-red-600   border-red-200   bg-red-50',
    blue:   'text-blue-600  border-blue-200  bg-blue-50',
    amber:  'text-amber-600 border-amber-200 bg-amber-50',
    gray:   'text-gray-700  border-gray-200  bg-white',
  }
  const cls = colorMap[color] || colorMap.gray
  return (
    <div className={`rounded-xl border p-4 ${cls}`}>
      <div className="flex items-center gap-2 mb-1">
        {Icon && <Icon size={15} className="opacity-60" />}
        <p className="text-xs font-medium uppercase tracking-wider opacity-70">{label}</p>
      </div>
      <p className={`font-bold ${small ? 'text-xl' : 'text-2xl'}`}>{fmt(value)}</p>
      {sub && <p className="text-xs mt-1 opacity-70">{sub}</p>}
    </div>
  )
}

// ── Tabla genérica ────────────────────────────────────────────────────────────

function Tabla({ title, rows, columns, totalRow, emptyMsg }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="bg-white rounded-xl border">
        <div className="px-4 py-3 border-b">
          <h3 className="font-semibold text-gray-700 text-sm">{title}</h3>
        </div>
        <p className="text-center text-gray-400 text-sm py-6">{emptyMsg || 'Sin datos'}</p>
      </div>
    )
  }
  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <div className="px-4 py-3 border-b">
        <h3 className="font-semibold text-gray-700 text-sm">{title}</h3>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b">
          <tr>
            {columns.map(c => (
              <th key={c.key} className={`px-4 py-2 font-medium text-gray-600 ${c.right ? 'text-right' : 'text-left'}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-gray-50">
              {columns.map(c => (
                <td key={c.key} className={`px-4 py-2 ${c.right ? 'text-right' : ''} ${c.bold ? 'font-semibold' : ''} text-gray-700`}>
                  {c.fmt ? c.fmt(row[c.key], row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totalRow && (
          <tfoot className="bg-gray-50 border-t font-semibold text-gray-800">
            <tr>
              {columns.map((c, i) => (
                <td key={c.key} className={`px-4 py-2 ${c.right ? 'text-right' : ''}`}>
                  {i === 0 ? 'Total' : (c.total != null ? fmt(c.total) : '')}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

// ── Sección Débito ────────────────────────────────────────────────────────────

function SeccionDebito({ data, loading }) {
  if (loading) return <div className="text-center text-gray-400 py-4">Cargando...</div>
  if (!data) return null
  const { provisional, documentado, gl } = data

  const colsProv = [
    { key: 'seller_nombre', label: 'Seller' },
    { key: 'base', label: 'Base', right: true, fmt: fmt },
    { key: 'iva',  label: 'IVA estimado', right: true, bold: true, fmt: fmt },
  ]
  const colsDoc = [
    { key: 'seller_nombre', label: 'Seller' },
    { key: 'folio',         label: 'Folio DTE' },
    { key: 'base',          label: 'Base', right: true, fmt: fmt },
    { key: 'iva',           label: 'IVA DTE', right: true, bold: true, fmt: fmt },
    { key: 'emitida_en',    label: 'Emisión' },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card label="IVA Débito Provisional" value={provisional?.iva_total} color="amber"
          sub={`Base: ${fmt(provisional?.base_total)}`} icon={TrendingUp} />
        <Card label="IVA Débito Documentado (DTE)" value={documentado?.iva_total} color="blue"
          sub={`${documentado?.count} factura(s) emitida(s)`} icon={FileText} />
        <Card label="IVA Débito GL (cta. 2.4)" value={gl} color="gray"
          sub="Asientos contables generados" small />
      </div>

      <Tabla
        title="Provisional — detalle por seller"
        rows={provisional?.detalle}
        columns={colsProv}
        totalRow
      />
      <Tabla
        title="Documentado — DTE emitidos"
        rows={documentado?.detalle}
        columns={colsDoc}
        totalRow
        emptyMsg="Sin facturas emitidas en el período"
      />
    </div>
  )
}

// ── Sección Crédito ───────────────────────────────────────────────────────────

function SeccionCredito({ data, loading }) {
  if (loading) return <div className="text-center text-gray-400 py-4">Cargando...</div>
  if (!data) return null
  const { drivers, compras, gl } = data

  const colsDrivers = [
    { key: 'driver_nombre', label: 'Conductor' },
    { key: 'estado',        label: 'Estado', fmt: v => (
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${v === 'PAGADO' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{v}</span>
    )},
    { key: 'monto_iva', label: 'IVA', right: true, bold: true, fmt: fmt },
  ]
  const colsCompras = [
    { key: 'nombre',       label: 'Concepto' },
    { key: 'proveedor',    label: 'Proveedor', fmt: v => v || '—' },
    { key: 'monto_compra', label: 'Monto total', right: true, fmt: fmt },
    { key: 'monto_iva',    label: 'IVA crédito', right: true, bold: true, fmt: fmt },
    { key: 'estado',       label: 'Estado' },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card label="IVA Crédito Drivers" value={drivers?.total} color="green"
          sub={`Pagado: ${fmt(drivers?.pagado)} | Pendiente: ${fmt(drivers?.pendiente)}`}
          icon={TrendingDown} />
        <Card label="IVA Crédito Compras" value={compras?.total} color="green"
          sub={`${compras?.count} movimiento(s) con IVA`} icon={FileText} />
        <Card label="IVA Crédito GL (cta. 1.3)" value={gl} color="gray"
          sub="Asientos contables generados" small />
      </div>

      <Tabla
        title="Crédito IVA — conductores"
        rows={drivers?.detalle}
        columns={colsDrivers}
        totalRow
        emptyMsg="Sin registros IVA drivers en el período"
      />
      <Tabla
        title="Crédito IVA — compras (MovimientoFinanciero)"
        rows={compras?.detalle}
        columns={colsCompras}
        totalRow
        emptyMsg="Sin facturas de compra con IVA registradas. Usa el campo 'IVA crédito fiscal' en Finanzas."
      />
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function IVAF29() {
  const hoy = new Date()
  const [mes, setMes] = useState(hoy.getMonth() + 1)
  const [anio, setAnio] = useState(hoy.getFullYear())
  const [tab, setTab] = useState('resumen')

  const [resumen, setResumen] = useState(null)
  const [detalleDebito, setDetalleDebito] = useState(null)
  const [detalleCredito, setDetalleCredito] = useState(null)
  const [loading, setLoading] = useState(false)
  const [loadingDetalle, setLoadingDetalle] = useState(false)

  const cargarResumen = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/iva-f29/resumen', { params: { mes, anio } })
      setResumen(data)
    } catch {
      toast.error('Error al cargar resumen F29')
    } finally {
      setLoading(false)
    }
  }, [mes, anio])

  const cargarDetalle = useCallback(async () => {
    if (tab === 'resumen') return
    setLoadingDetalle(true)
    try {
      const [debRes, creRes] = await Promise.all([
        api.get('/iva-f29/detalle-debito', { params: { mes, anio } }),
        api.get('/iva-f29/detalle-credito', { params: { mes, anio } }),
      ])
      setDetalleDebito(debRes.data)
      setDetalleCredito(creRes.data)
    } catch {
      toast.error('Error al cargar detalle F29')
    } finally {
      setLoadingDetalle(false)
    }
  }, [mes, anio, tab])

  useEffect(() => { cargarResumen() }, [cargarResumen])
  useEffect(() => { cargarDetalle() }, [cargarDetalle])

  const saldo = resumen?.saldo_orientativo
  const difProvDoc = resumen?.diferencia_prov_doc

  const TABS = [
    { id: 'resumen',  label: 'Resumen' },
    { id: 'debito',   label: 'IVA Débito (ventas)' },
    { id: 'credito',  label: 'IVA Crédito (compras)' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="F29 IVA"
        subtitle="Panel orientativo de IVA débito y crédito para apoyo al formulario F29"
        icon={FileText}
      />

      {/* Controles */}
      <div className="flex flex-wrap items-center gap-3">
        <select value={mes} onChange={e => setMes(Number(e.target.value))} className="border rounded-lg px-3 py-2 text-sm">
          {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
        </select>
        <input
          type="number"
          value={anio}
          onChange={e => setAnio(Number(e.target.value))}
          className="border rounded-lg px-3 py-2 text-sm w-24"
        />
        <button
          onClick={() => { cargarResumen(); cargarDetalle() }}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Actualizar
        </button>
        <div className="flex bg-gray-100 rounded-lg p-0.5 ml-auto gap-0.5">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${tab === t.id ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600 hover:text-gray-800'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab Resumen ── */}
      {tab === 'resumen' && (
        <div className="space-y-5">
          {loading && <p className="text-center text-gray-400">Cargando...</p>}
          {!loading && resumen && (
            <>
              {/* Alerta diferencia prov/doc */}
              {Math.abs(difProvDoc) > 1000 && (
                <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
                  <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-semibold mb-0.5">Diferencia provisional vs documentado: {fmt(Math.abs(difProvDoc))}</p>
                    <p>
                      {difProvDoc > 0
                        ? 'El IVA estimado supera el documentado — hay servicios prestados sin DTE emitido.'
                        : 'El IVA documentado supera el estimado — puede haber DTE de períodos anteriores.'}
                    </p>
                  </div>
                </div>
              )}

              {/* Cards principales */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Card label="Débito Provisional" value={resumen.debito.provisional} color="amber"
                  sub={`Base: ${fmt(resumen.debito.provisional_base)}`} icon={TrendingUp} />
                <Card label="Débito Documentado (DTE)" value={resumen.debito.documentado} color="blue"
                  sub={`${resumen.debito.documentado_count} factura(s)`} icon={FileText} />
                <Card label="Crédito Total" value={resumen.credito.total} color="green"
                  sub={`Drivers: ${fmt(resumen.credito.drivers_total)} | Compras: ${fmt(resumen.credito.compras)}`}
                  icon={TrendingDown} />
                <Card
                  label="Saldo F29 orientativo"
                  value={saldo}
                  color={saldo > 0 ? 'red' : 'green'}
                  sub={saldo > 0 ? 'Débito > Crédito → a pagar' : 'Crédito ≥ Débito → a favor'}
                  icon={saldo > 0 ? TrendingUp : CheckCircle}
                />
              </div>

              {/* GL cross-check */}
              <div className="grid grid-cols-2 sm:grid-cols-2 gap-4">
                <Card label="IVA Débito GL (cta. 2.4)" value={resumen.debito.gl} color="gray"
                  sub="Suma Haber asientos cartola sellers" small />
                <Card label="IVA Crédito GL (cta. 1.3)" value={resumen.credito.gl} color="gray"
                  sub="Suma Debe asientos pago IVA drivers" small />
              </div>

              {/* Desglose crédito */}
              <div className="bg-white rounded-xl border p-4">
                <h3 className="font-semibold text-gray-700 text-sm mb-3">Desglose crédito fiscal</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm text-gray-600">
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Drivers pagados</p>
                    <p className="font-semibold text-green-600">{fmt(resumen.credito.drivers_pagado)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Drivers pendientes</p>
                    <p className="font-semibold text-amber-600">{fmt(resumen.credito.drivers_pendiente)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">Compras ({resumen.credito.compras_count} mov.)</p>
                    <p className="font-semibold text-green-600">{fmt(resumen.credito.compras)}</p>
                  </div>
                </div>
              </div>

              {/* Nota */}
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-700 space-y-1">
                <p className="font-semibold mb-1">¿Cómo interpretar este panel?</p>
                <p><strong>Provisional:</strong> IVA estimado basado en pagos semanales ya validados × 19% (round SII).</p>
                <p><strong>Documentado:</strong> IVA real de los DTE emitidos a sellers — el que va al F29.</p>
                <p><strong>GL:</strong> Asientos contables generados — crece automáticamente al registrar cobros de cartola.</p>
                <p><strong>Saldo orientativo</strong> = Débito documentado − Crédito total. No incluye NC, PPM u otros. Siempre confirma con el contador.</p>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Tab Débito ── */}
      {tab === 'debito' && (
        <SeccionDebito data={detalleDebito} loading={loadingDetalle} />
      )}

      {/* ── Tab Crédito ── */}
      {tab === 'credito' && (
        <SeccionCredito data={detalleCredito} loading={loadingDetalle} />
      )}
    </div>
  )
}
