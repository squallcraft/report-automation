import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import api from '../../api'
import toast from 'react-hot-toast'
import {
  Package, Download, FileSpreadsheet, Calendar, MapPin, ChevronDown, ChevronUp,
} from 'lucide-react'

const fmt = (n) => `$${(n || 0).toLocaleString('es-CL')}`
const now = new Date()
const MESES_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const DRIVER_MIN_PERIOD = { semana: 4, mes: 2, anio: 2026 }

const EMPRESA_CFG = {
  ECOURIER: 'bg-blue-50 text-blue-700',
  OVIEDO:   'bg-indigo-50 text-indigo-700',
}

function EnvioCard({ envio, esJefe, expanded, onToggle }) {
  const total = (envio.costo_driver || 0) + (envio.extra_producto_driver || 0)
              + (envio.extra_comuna_driver || 0) + (envio.pago_extra_manual || 0)
  const tieneExtras = (envio.extra_producto_driver || 0) > 0
                   || (envio.extra_comuna_driver || 0) > 0
                   || (envio.pago_extra_manual || 0) > 0
  const fechaTxt = envio.fecha_entrega
    ? new Date(envio.fecha_entrega).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })
    : '—'
  const empresaCls = EMPRESA_CFG[envio.empresa] || 'bg-amber-50 text-amber-700'

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <button onClick={onToggle} className="w-full text-left p-4 flex items-start gap-3 hover:bg-gray-50">
        <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
          <Package size={18} className="text-blue-600" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-800 truncate">{envio.seller_nombre || 'Sin seller'}</p>
              <p className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                <span className="inline-flex items-center gap-0.5"><Calendar size={10}/> {fechaTxt}</span>
                {envio.empresa && (
                  <span className={`uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${empresaCls}`}>
                    {envio.empresa}
                  </span>
                )}
                {esJefe && envio.driver_nombre && (
                  <span className="text-gray-500">· {envio.driver_nombre}</span>
                )}
              </p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-sm font-bold text-emerald-600 leading-none">{fmt(total)}</p>
              {tieneExtras && (
                <p className="text-[10px] text-gray-400 mt-0.5">+ extras</p>
              )}
            </div>
          </div>
        </div>
        {tieneExtras && (
          expanded ? <ChevronUp size={14} className="text-gray-300 flex-shrink-0 mt-1"/> : <ChevronDown size={14} className="text-gray-300 flex-shrink-0 mt-1"/>
        )}
      </button>

      {expanded && tieneExtras && (
        <div className="border-t border-gray-50 bg-gray-50/40 px-4 py-3 space-y-1">
          {[
            ['Base',           envio.costo_driver],
            ['Extra producto', envio.extra_producto_driver],
            ['Extra comuna',   envio.extra_comuna_driver],
            ['Extra manual',   envio.pago_extra_manual],
          ].filter(([,v]) => v > 0).map(([label, value]) => (
            <div key={label} className="flex justify-between text-xs">
              <span className="text-gray-500">{label}</span>
              <span className="text-gray-700 font-medium">{fmt(value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function DriverEntregas() {
  const { user } = useAuth()
  const [envios, setEnvios] = useState([])
  const [flota, setFlota] = useState(null)
  const [filterDriver, setFilterDriver] = useState('todos')
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState(() => {
    const y = now.getFullYear()
    const m = now.getMonth() + 1
    if (y < 2026 || (y === 2026 && m < 2)) return DRIVER_MIN_PERIOD
    if (y === 2026 && m === 2) return { semana: 4, mes: 2, anio: 2026 }
    return { semana: 1, mes: m, anio: y }
  })
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const [downloadingXls, setDownloadingXls] = useState(false)
  const [expandedId, setExpandedId] = useState(null)

  useEffect(() => {
    api.get('/drivers/mi-flota/info')
      .then(({ data }) => setFlota(data))
      .catch(() => setFlota({ es_jefe_flota: false, subordinados: [] }))
  }, [])

  useEffect(() => {
    setLoading(true)
    api.get('/envios', { params: { ...period, limit: 5000 } })
      .then(({ data }) => setEnvios(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [period])

  const esJefe = flota?.es_jefe_flota

  const filtered = filterDriver === 'todos'
    ? envios
    : filterDriver === 'mis'
      ? envios.filter((e) => e.driver_id === user?.entidad_id)
      : envios.filter((e) => e.driver_id === parseInt(filterDriver, 10))

  const totalPeriodo = filtered.reduce(
    (acc, e) => acc + (e.costo_driver || 0) + (e.extra_producto_driver || 0)
                    + (e.extra_comuna_driver || 0) + (e.pago_extra_manual || 0),
    0,
  )

  const descargarExcel = async () => {
    setDownloadingXls(true)
    try {
      const res = await api.get('/portal/driver/excel', {
        params: { semana: period.semana, mes: period.mes, anio: period.anio },
        responseType: 'blob',
      })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `mis_entregas_S${period.semana}_${period.mes}_${period.anio}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('No hay entregas para este período')
    } finally {
      setDownloadingXls(false)
    }
  }

  const descargarPDF = async () => {
    setDownloadingPdf(true)
    try {
      const res = await api.get('/liquidacion/mi-pdf', {
        params: { semana: period.semana, mes: period.mes, anio: period.anio },
        responseType: 'blob',
      })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `mi_liquidacion_S${period.semana}_${period.mes}_${period.anio}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('No hay datos de liquidación para este período')
    } finally {
      setDownloadingPdf(false)
    }
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-5 space-y-4">

      {/* Hero */}
      <div className="rounded-2xl text-white p-5 relative overflow-hidden"
           style={{ background: 'linear-gradient(135deg, #003c72 0%, #1d4ed8 100%)' }}>
        <div className="absolute -top-8 -right-8 w-32 h-32 bg-white/5 rounded-full" />
        <div className="absolute -bottom-4 -left-4 w-20 h-20 bg-white/5 rounded-full" />

        <div className="relative">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-blue-200 text-xs font-medium uppercase tracking-wider">
                {esJefe ? 'Entregas flota' : 'Mis entregas'}
              </p>
              <h1 className="text-lg font-bold leading-tight mt-0.5">
                Semana {period.semana} · {MESES_FULL[period.mes - 1]}
              </h1>
              <p className="text-blue-200 text-xs mt-0.5">{period.anio}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0">
              <Package size={18} className="text-white" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white/10 rounded-xl p-3">
              <p className="text-blue-200 text-[10px] uppercase tracking-wide leading-none mb-1">Entregas</p>
              <p className="text-white font-bold text-base leading-tight">{filtered.length}</p>
            </div>
            <div className="bg-white/10 rounded-xl p-3">
              <p className="text-blue-200 text-[10px] uppercase tracking-wide leading-none mb-1">Total período</p>
              <p className="text-white font-bold text-base leading-tight">{fmt(totalPeriodo)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Selector + descargas */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 space-y-2">
        <div className="flex gap-2">
          <select value={period.semana}
            onChange={(e) => setPeriod({ ...period, semana: Number(e.target.value) })}
            className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-700">
            {[1, 2, 3, 4, 5].map((s) => <option key={s} value={s}>Semana {s}</option>)}
          </select>
          <select value={period.mes}
            onChange={(e) => setPeriod({ ...period, mes: Number(e.target.value) })}
            className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-700">
            {MESES_FULL.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
          <select value={period.anio}
            onChange={(e) => setPeriod({ ...period, anio: Number(e.target.value) })}
            className="w-20 text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-700">
            {[now.getFullYear(), now.getFullYear() - 1].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        {esJefe && (
          <select value={filterDriver}
            onChange={(e) => setFilterDriver(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-700">
            <option value="todos">Toda la flota</option>
            <option value="mis">Solo mis entregas</option>
            {flota.subordinados.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        )}

        <div className="grid grid-cols-2 gap-2 pt-1">
          <button onClick={descargarPDF} disabled={downloadingPdf}
            className="flex items-center justify-center gap-2 text-xs font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50 rounded-xl px-3 py-2.5 transition-colors">
            <Download size={13} /> {downloadingPdf ? 'Descargando…' : 'PDF Liquidación'}
          </button>
          <button onClick={descargarExcel} disabled={downloadingXls}
            className="flex items-center justify-center gap-2 text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 rounded-xl px-3 py-2.5 transition-colors">
            <FileSpreadsheet size={13} /> {downloadingXls ? 'Descargando…' : 'Excel'}
          </button>
        </div>
      </div>

      <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 leading-snug">
        Solo se muestra información desde la <strong>semana 4 de febrero 2026</strong>.
      </p>

      {/* Lista de envíos */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-7 h-7 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
          <Package size={32} className="text-gray-200 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No hay entregas para este período.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((e) => (
            <EnvioCard
              key={e.id}
              envio={e}
              esJefe={esJefe}
              expanded={expandedId === e.id}
              onToggle={() => setExpandedId(expandedId === e.id ? null : e.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
