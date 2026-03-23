import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api'
import PeriodSelector from './PeriodSelector'
import DataTable from './DataTable'
import toast from 'react-hot-toast'
import { ArrowLeft, Download, FileSpreadsheet, ExternalLink, ChevronDown } from 'lucide-react'

const fmt = (n) => `$${(n || 0).toLocaleString('es-CL')}`

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

export default function LiquidacionDetalle({ tipo, entityId, initialPeriod, onBack, isPortal = false, subDriverId = null }) {
  const navigate = useNavigate()
  const [period, setPeriod] = useState(initialPeriod)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showExcelMenu, setShowExcelMenu] = useState(false)
  const excelMenuRef = useRef(null)

  useEffect(() => {
    setLoading(true)
    const url = isPortal && tipo === 'driver'
      ? `/portal/driver/liquidacion`
      : `/liquidacion/detalle/${tipo}/${entityId}`
    const params = { ...period }
    if (isPortal && tipo === 'driver' && subDriverId) params.sub_driver_id = subDriverId
    api.get(url, { params })
      .then(({ data }) => setData(data))
      .catch(() => toast.error('Error al cargar detalle'))
      .finally(() => setLoading(false))
  }, [tipo, entityId, period, isPortal, subDriverId])

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (excelMenuRef.current && !excelMenuRef.current.contains(e.target)) {
        setShowExcelMenu(false)
      }
    }
    if (showExcelMenu) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showExcelMenu])

  const downloadPdf = () => {
    const pdfUrl = isPortal && tipo === 'driver'
      ? '/liquidacion/mi-pdf'
      : `/liquidacion/pdf/${tipo}/${entityId}`
    api.get(pdfUrl, { params: period, responseType: 'blob' })
      .then(({ data: blob }) => {
        const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }))
        const a = document.createElement('a')
        a.href = url
        a.download = `liquidacion_${tipo}_${entityId}_S${period.semana}.pdf`
        a.click()
        URL.revokeObjectURL(url)
      })
      .catch(() => toast.error('Error al generar PDF'))
  }

  const downloadExcel = (semana = null) => {
    setShowExcelMenu(false)
    if (isPortal && tipo === 'driver') {
      const params = { mes: period.mes, anio: period.anio }
      if (semana !== null) params.semana = semana
      const suffix = semana !== null ? `_S${semana}` : `_M${period.mes}`
      api.get('/portal/driver/excel', { params, responseType: 'blob' })
        .then(({ data: blob }) => {
          const url = URL.createObjectURL(new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
          const a = document.createElement('a')
          a.href = url
          a.download = `entregas_${entityId}${suffix}.xlsx`
          a.click()
          URL.revokeObjectURL(url)
        })
        .catch(() => toast.error('Error al exportar'))
      return
    }
    const params = { mes: period.mes, anio: period.anio }
    if (semana !== null) params.semana = semana
    if (tipo === 'seller') params.seller_id = entityId
    else params.driver_id = entityId
    const suffix = semana !== null ? `_S${semana}` : `_M${period.mes}`
    api.get('/liquidacion/exportar/envios', { params, responseType: 'blob' })
      .then(({ data: blob }) => {
        const url = URL.createObjectURL(new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
        const a = document.createElement('a')
        a.href = url
        a.download = `envios_${tipo}_${entityId}${suffix}.xlsx`
        a.click()
        URL.revokeObjectURL(url)
      })
      .catch(() => toast.error('Error al exportar'))
  }

  const goToEnvios = (semana, empresa = null) => {
    if (isPortal) return
    const params = new URLSearchParams()
    if (tipo === 'seller') params.set('seller_id', entityId)
    else params.set('driver_id', entityId)
    params.set('semana', semana)
    params.set('mes', period.mes)
    params.set('anio', period.anio)
    if (empresa) params.set('empresa', empresa)
    navigate(`/admin/envios?${params.toString()}`)
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Cargando detalle...</div>
  if (!data) return <div className="text-center py-12 text-gray-500">No se pudo cargar la información</div>

  const isSeller = tipo === 'seller'

  const weeklyRows = isSeller ? buildSellerRows(data) : buildDriverRows(data)
  const totalSemana = isSeller
    ? calcSellerTotal(data.weekly, period.semana)
    : calcDriverTotal(data.weekly, period.semana)

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          {!isPortal && onBack && (
            <button onClick={onBack} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
              <ArrowLeft size={20} />
            </button>
          )}
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{data.nombre}</h1>
            <p className="text-sm text-gray-500">
              {isSeller ? `Empresa: ${data.empresa}` : `Tarifas: ${[
                `EC ${fmt(data.tarifa_ecourier)}`,
                data.tarifa_oviedo ? `OV ${fmt(data.tarifa_oviedo)}` : null,
                data.tarifa_tercerizado ? `TC ${fmt(data.tarifa_tercerizado)}` : null,
                data.tarifa_valparaiso ? `VP ${fmt(data.tarifa_valparaiso)}` : null,
                data.tarifa_melipilla ? `ML ${fmt(data.tarifa_melipilla)}` : null,
              ].filter(Boolean).join(' | ')}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={downloadPdf} className="btn-primary flex items-center gap-2">
            <Download size={16} /> PDF
          </button>
          <div className="relative" ref={excelMenuRef}>
            <button
              onClick={() => setShowExcelMenu((v) => !v)}
              className="btn-secondary flex items-center gap-2"
            >
              <FileSpreadsheet size={16} /> Excel Envíos <ChevronDown size={14} />
            </button>
            {showExcelMenu && (
              <div className="absolute right-0 mt-1 w-52 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
                <button
                  onClick={() => downloadExcel(period.semana)}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-primary-50 hover:text-primary-700 transition-colors"
                >
                  <span className="font-medium">Semana {period.semana}</span>
                  <span className="block text-xs text-gray-400">Solo la semana actual</span>
                </button>
                <div className="border-t border-gray-100 my-1" />
                <button
                  onClick={() => downloadExcel(null)}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-primary-50 hover:text-primary-700 transition-colors"
                >
                  <span className="font-medium">Todo {MESES[period.mes]}</span>
                  <span className="block text-xs text-gray-400">Todas las semanas del mes</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card mb-6">
        <PeriodSelector {...period} onChange={setPeriod} />
      </div>

      <div className="card bg-amber-50 border-amber-200 mb-6">
        <div className="flex justify-between items-center">
          <span className="font-semibold text-amber-900">
            {isSeller ? 'Monto a cobrar Semana' : 'Monto a pagar Semana'} {period.semana} — {MESES[period.mes]} {period.anio}
          </span>
          <span className="text-2xl font-bold text-amber-900">{fmt(totalSemana)}</span>
        </div>
      </div>

      <div className="card overflow-hidden p-0 mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-800 text-white">
                <th className="px-4 py-3 text-left text-xs font-semibold">Item</th>
                {[1,2,3,4,5].map((s) => (
                  <th key={s} className={`px-4 py-3 text-right text-xs font-semibold ${s === period.semana ? 'bg-primary-700' : ''}`}>
                    Sem {s}
                  </th>
                ))}
                <th className="px-4 py-3 text-right text-xs font-semibold bg-gray-700">Subtotal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {weeklyRows.map((row, idx) => (
                <tr key={idx} className={row.bold ? 'bg-blue-50 font-semibold' : row.iva ? 'bg-gray-50' : idx % 2 === 0 ? '' : 'bg-gray-50/50'}>
                  <td className="px-4 py-2 text-left">{row.label}</td>
                  {[1,2,3,4,5].map((s) => (
                    <td key={s} className={`px-4 py-2 text-right ${s === period.semana ? 'bg-primary-50' : ''}`}>
                      {row.isCount && row.values[s] > 0 && !isPortal ? (
                        <button
                          onClick={() => goToEnvios(s, row.empresa)}
                          className="text-primary-600 hover:text-primary-800 hover:underline inline-flex items-center gap-1"
                        >
                          {row.values[s]} <ExternalLink size={12} />
                        </button>
                      ) : row.isMoney ? fmt(row.values[s]) : row.values[s]}
                    </td>
                  ))}
                  <td className="px-4 py-2 text-right bg-gray-50 font-semibold">
                    {row.isMoney ? fmt(row.subtotal) : row.subtotal}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {data.daily && data.daily.length > 0 && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Desglose Diario — Semana {period.semana}</h3>
          <DataTable
            columns={[
              { key: 'fecha', label: 'Día', render: (v) => v ? new Date(v + 'T12:00:00').toLocaleDateString('es-CL') : '—' },
              { key: 'envios', label: 'Envíos', align: 'center' },
              ...(!isSeller && data.contratado ? [] : [
                { key: 'bultos_extra', label: 'Bultos Extra', align: 'right', render: (v) => fmt(v) },
                { key: 'peso_extra', label: isSeller ? 'Peso Extra' : 'Comuna', align: 'right', render: (v) => fmt(v) },
              ]),
              ...(!isSeller ? [{ key: 'retiros', label: 'Retiros', align: 'right', render: (v) => v > 0 ? fmt(v) : '—' }] : []),
              { key: 'monto', label: isSeller ? 'Cobro' : 'Pago', align: 'right', render: (v) => fmt(v) },
            ]}
            data={data.daily}
            sortable
          />
        </div>
      )}

      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Productos con Extra — Semana {period.semana}</h3>
        {data.productos && data.productos.length > 0 ? (
          <DataTable
            columns={[
              { key: 'codigo_mlc', label: 'Código MLC' },
              { key: 'descripcion', label: 'Descripción', render: (v) => <span className="max-w-[240px] truncate block" title={v}>{v || '—'}</span> },
              { key: 'direccion', label: 'Dirección', render: (v) => <span className="max-w-[200px] truncate block" title={v}>{v || '—'}</span> },
              ...(!isSeller ? [] : [{ key: 'extra_seller', label: 'Extra Seller', align: 'right', render: (v) => fmt(v) }]),
              { key: 'extra_driver', label: 'Extra Driver', align: 'right', render: (v) => fmt(v) },
              { key: 'cantidad', label: 'Envíos', align: 'center' },
            ]}
            data={data.productos}
            sortable
          />
        ) : (
          <div className="card bg-gray-50 border-gray-200 text-center py-8">
            <p className="text-gray-500 text-sm">No tienes cobros extras en tus envíos este período de tiempo.</p>
          </div>
        )}
      </div>
    </div>
  )
}


function buildSellerRows(data) {
  const w = data.weekly
  const mkRow = (label, key, isMoney = true, isCount = false, bold = false, iva = false) => {
    const values = {}
    let subtotal = 0
    for (let s = 1; s <= 5; s++) {
      values[s] = w[s]?.[key] || 0
      subtotal += values[s]
    }
    return { label, values, subtotal, isMoney, isCount, bold, iva }
  }

  const rows = [
    mkRow('Monto', 'monto'),
    mkRow('Envíos', 'envios', false, true),
    mkRow('Bultos Extra', 'bultos_extra'),
    mkRow('Extra Manual', 'cobro_extra_manual'),
    mkRow('Retiros', 'retiros'),
    mkRow('Peso Extra', 'peso_extra'),
    mkRow('Ajustes', 'ajustes'),
  ]

  const subtotalValues = {}
  let subtotalSum = 0
  for (let s = 1; s <= 5; s++) {
    const ws = w[s] || {}
    subtotalValues[s] = (ws.monto || 0) + (ws.bultos_extra || 0) + (ws.cobro_extra_manual || 0) + (ws.retiros || 0) + (ws.peso_extra || 0) + (ws.ajustes || 0)
    subtotalSum += subtotalValues[s]
  }
  rows.push({ label: 'Subtotal', values: subtotalValues, subtotal: subtotalSum, isMoney: true, bold: true })

  const ivaValues = {}
  let ivaSum = 0
  for (let s = 1; s <= 5; s++) {
    ivaValues[s] = Math.round(subtotalValues[s] * 0.19)
    ivaSum += ivaValues[s]
  }
  rows.push({ label: 'IVA (19%)', values: ivaValues, subtotal: ivaSum, isMoney: true, iva: true })

  const totalValues = {}
  let totalSum = 0
  for (let s = 1; s <= 5; s++) {
    totalValues[s] = subtotalValues[s] + ivaValues[s]
    totalSum += totalValues[s]
  }
  rows.push({ label: 'Total', values: totalValues, subtotal: totalSum, isMoney: true, bold: true })

  return rows
}

function buildDriverRows(data) {
  const w = data.weekly
  const mkRow = (label, key, isMoney = true, isCount = false, bold = false, empresa = null) => {
    const values = {}
    let subtotal = 0
    for (let s = 1; s <= 5; s++) {
      values[s] = w[s]?.[key] || 0
      subtotal += values[s]
    }
    return { label, values, subtotal, isMoney, isCount, bold, empresa }
  }

  const hasData = (key) => [1,2,3,4,5].some(s => (w[s]?.[key] || 0) !== 0)

  const rows = [
    mkRow('General', 'normal_count', false, true, false, 'ECOURIER'),
    mkRow('Subtotal Normal', 'normal_total', true, false, true),
  ]

  if (data.tarifa_oviedo || hasData('oviedo_count')) {
    rows.push(mkRow(`Oviedo (${fmt(data.tarifa_oviedo)})`, 'oviedo_count', false, true, false, 'OVIEDO'))
    rows.push(mkRow('Subtotal Oviedo', 'oviedo_total', true, false, true))
  }
  if (data.tarifa_tercerizado || hasData('tercerizado_count')) {
    rows.push(mkRow(`Tercerizado (${fmt(data.tarifa_tercerizado)})`, 'tercerizado_count', false, true, false, 'TERCERIZADO'))
    rows.push(mkRow('Subtotal Tercerizado', 'tercerizado_total', true, false, true))
  }
  if (data.tarifa_valparaiso || hasData('valparaiso_count')) {
    rows.push(mkRow(`Valparaíso (${fmt(data.tarifa_valparaiso)})`, 'valparaiso_count', false, true, false, 'VALPARAISO'))
    rows.push(mkRow('Subtotal Valparaíso', 'valparaiso_total', true, false, true))
  }
  if (data.tarifa_melipilla || hasData('melipilla_count')) {
    rows.push(mkRow(`Melipilla (${fmt(data.tarifa_melipilla)})`, 'melipilla_count', false, true, false, 'MELIPILLA'))
    rows.push(mkRow('Subtotal Melipilla', 'melipilla_total', true, false, true))
  }
  if (!data.contratado && hasData('comuna'))
    rows.push(mkRow('Comuna', 'comuna'))
  if (!data.contratado && hasData('bultos_extra'))
    rows.push(mkRow('Bultos Extra', 'bultos_extra'))
  if (hasData('retiros'))
    rows.push(mkRow('Retiros', 'retiros'))
  if (hasData('bonificaciones'))
    rows.push(mkRow('Bonificaciones', 'bonificaciones'))
  if (hasData('descuentos'))
    rows.push(mkRow('Descuentos', 'descuentos'))

  const totalValues = {}
  let totalSum = 0
  for (let s = 1; s <= 5; s++) {
    const ws = w[s] || {}
    totalValues[s] = (ws.normal_total || 0) + (ws.oviedo_total || 0) + (ws.tercerizado_total || 0)
      + (ws.valparaiso_total || 0) + (ws.melipilla_total || 0)
      + (ws.comuna || 0) + (ws.bultos_extra || 0) + (ws.retiros || 0)
      + (ws.bonificaciones || 0) + (ws.descuentos || 0)
    totalSum += totalValues[s]
  }
  rows.push({ label: 'Total', values: totalValues, subtotal: totalSum, isMoney: true, bold: true })

  return rows
}

function calcSellerTotal(weekly, semana) {
  const w = weekly[semana] || {}
  const sub = (w.monto || 0) + (w.bultos_extra || 0) + (w.cobro_extra_manual || 0) + (w.retiros || 0) + (w.peso_extra || 0) + (w.ajustes || 0)
  return sub + Math.round(sub * 0.19)
}

function calcDriverTotal(weekly, semana) {
  const w = weekly[semana] || {}
  return (w.normal_total || 0) + (w.oviedo_total || 0) + (w.tercerizado_total || 0)
    + (w.valparaiso_total || 0) + (w.melipilla_total || 0)
    + (w.comuna || 0) + (w.bultos_extra || 0) + (w.retiros || 0)
    + (w.bonificaciones || 0) + (w.descuentos || 0)
}
