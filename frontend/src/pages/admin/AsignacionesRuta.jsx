import { useEffect, useMemo, useRef, useState } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import {
  Inbox, RefreshCw, Link as LinkIcon, Search, Filter, CheckCircle2,
  XCircle, Clock, AlertCircle, DownloadCloud, Loader2, AlertTriangle,
  HelpCircle, CheckCircle,
} from 'lucide-react'
import PageHeader from '../../components/PageHeader'

const ESTADOS = [
  { value: '', label: 'Todos' },
  { value: 'sin_entrega', label: 'Sin entrega' },
  { value: 'entregado', label: 'Entregado' },
  { value: 'cancelado', label: 'Cancelado' },
]

const ESTADO_STYLES = {
  entregado: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-300', icon: CheckCircle2 },
  cancelado: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300', icon: XCircle },
  sin_entrega: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-300', icon: Clock },
}

function fmtDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('es-CL') } catch { return iso }
}

function fmtNumber(n) {
  return (n ?? 0).toLocaleString('es-CL')
}

function fmtTime(seconds) {
  if (!seconds || seconds <= 0) return '...'
  if (seconds < 60) return `${Math.ceil(seconds)}s`
  const mins = Math.floor(seconds / 60)
  const secs = Math.ceil(seconds % 60)
  return `${mins}m ${secs}s`
}

function todayMinusDays(days) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

// ──────────────────────────────────────────────────────────────────────────────
// Tarjeta de progreso (mismo patrón que Ingesta y Pickups → TrackingTech)
// ──────────────────────────────────────────────────────────────────────────────
function ProgressBar({ progress }) {
  if (!progress) return null
  const {
    status, total, processed, nuevos, duplicados, errores, message,
    elapsed_seconds, estimated_remaining_seconds, rate_per_second, archivo,
  } = progress
  const isDone = status === 'done'
  const isError = status === 'error'
  const pct = total > 0 ? Math.min(Math.round((processed / total) * 100), 100) : (isDone ? 100 : 0)

  return (
    <div className="bg-white rounded-xl border-l-4 border-l-purple-500 border border-gray-200 p-4 mb-4 shadow-sm">
      <div className="flex items-center gap-3 mb-3">
        {isDone ? (
          <CheckCircle size={22} className="text-green-500 flex-shrink-0" />
        ) : isError ? (
          <AlertTriangle size={22} className="text-red-500 flex-shrink-0" />
        ) : (
          <Loader2 size={22} className="text-purple-500 animate-spin flex-shrink-0" />
        )}
        <div className="flex-1">
          <p className="text-sm font-semibold text-gray-800">
            {isDone ? 'Ingesta completada' : isError ? 'Error en la ingesta' : 'Procesando ingesta…'}
          </p>
          {archivo && <p className="text-xs text-gray-500">{archivo}</p>}
        </div>
        {!isDone && !isError && elapsed_seconds > 0 && (
          <div className="text-right flex-shrink-0">
            <p className="text-xs text-gray-500 flex items-center gap-1 justify-end">
              <Clock size={12} /> Transcurrido: {fmtTime(elapsed_seconds)}
            </p>
            {estimated_remaining_seconds > 0 && (
              <p className="text-xs font-medium text-purple-600">
                Restante: ~{fmtTime(estimated_remaining_seconds)}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="w-full bg-gray-200 rounded-full h-3 mb-2 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            isError ? 'bg-red-500' : isDone ? 'bg-green-500' : 'bg-purple-500'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
        <span>{fmtNumber(processed)} de {fmtNumber(total)} registros ({pct}%)</span>
        {rate_per_second > 0 && !isDone && <span>{Math.round(rate_per_second)} reg/s</span>}
        {isDone && elapsed_seconds > 0 && <span>Tiempo total: {fmtTime(elapsed_seconds)}</span>}
      </div>

      {message && !isError && (
        <p className="text-xs text-gray-600 italic mb-2">{message}</p>
      )}
      {isError && (
        <p className="text-sm text-red-600 bg-red-50 rounded p-2">{message}</p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div className="bg-green-50 rounded-lg p-2.5 text-center">
          <p className="text-gray-500 text-xs">Nuevas</p>
          <p className="text-lg font-bold text-green-600">{fmtNumber(nuevos)}</p>
        </div>
        <div className="bg-blue-50 rounded-lg p-2.5 text-center">
          <p className="text-gray-500 text-xs">Actualizadas</p>
          <p className="text-lg font-bold text-blue-600">{fmtNumber(duplicados)}</p>
        </div>
        <div className="bg-red-50 rounded-lg p-2.5 text-center">
          <p className="text-gray-500 text-xs">Errores</p>
          <p className="text-lg font-bold text-red-600">{fmtNumber(errores)}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-2.5 text-center">
          <p className="text-gray-500 text-xs">Total</p>
          <p className="text-lg font-bold text-gray-700">{fmtNumber(total)}</p>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
export default function AsignacionesRuta() {
  const [filtros, setFiltros] = useState({
    fecha_desde: todayMinusDays(7),
    fecha_hasta: todayMinusDays(0),
    estado: 'sin_entrega',
    sin_envio: '',
    q: '',
  })
  const [page, setPage] = useState(1)
  const [pageSize] = useState(50)
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [resumen, setResumen] = useState(null)
  const [loading, setLoading] = useState(false)
  const [reconciling, setReconciling] = useState(false)
  const [ingesting, setIngesting] = useState(false)
  const [progress, setProgress] = useState(null)
  const [showHelp, setShowHelp] = useState(false)
  const pollRef = useRef(null)

  const cargar = async (p = page) => {
    setLoading(true)
    try {
      const params = {
        ...filtros,
        sin_envio: filtros.sin_envio === '' ? undefined : filtros.sin_envio === 'true',
        estado: filtros.estado || undefined,
        q: filtros.q || undefined,
        page: p,
        page_size: pageSize,
      }
      const [list, sum] = await Promise.all([
        api.get('/asignaciones-ruta', { params }),
        api.get('/asignaciones-ruta/resumen', {
          params: { fecha_desde: filtros.fecha_desde, fecha_hasta: filtros.fecha_hasta },
        }),
      ])
      setItems(list.data?.items || [])
      setTotal(list.data?.total || 0)
      setResumen(sum.data || null)
      setPage(p)
    } catch {
      toast.error('No se pudieron cargar las asignaciones')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { cargar(1) }, [])
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const aplicarFiltros = () => cargar(1)

  const reconciliarUno = async (asig) => {
    try {
      await api.post(`/asignaciones-ruta/${asig.id}/reconciliar`)
      toast.success('Reconciliación intentada')
      cargar(page)
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Error')
    }
  }

  const ingestarRango = async () => {
    if (ingesting) return
    if (!filtros.fecha_desde || !filtros.fecha_hasta) {
      toast.error('Define rango Desde/Hasta')
      return
    }
    if (!confirm(`Ejecutar ingesta del courier para ${filtros.fecha_desde} → ${filtros.fecha_hasta}?`)) return

    setIngesting(true)
    setProgress(null)

    try {
      const { data } = await api.post('/asignaciones-ruta/ingestar', null, {
        params: { fecha_inicio: filtros.fecha_desde, fecha_fin: filtros.fecha_hasta },
      })
      const taskId = data.task_id

      const poll = async () => {
        try {
          const { data: prog } = await api.get(`/asignaciones-ruta/ingestar/progress/${taskId}`)
          setProgress(prog)
          if (prog.status === 'done' || prog.status === 'error') {
            clearInterval(pollRef.current)
            pollRef.current = null
            setIngesting(false)
            if (prog.status === 'done') {
              const r = prog.result || {}
              toast.success(
                `Creadas: ${fmtNumber(r.asignaciones_creadas)} · Actualizadas: ${fmtNumber(r.asignaciones_actualizadas)} · Con envío: ${fmtNumber(r.enlazadas_a_envio)} · Sin envío: ${fmtNumber(r.sin_envio)}`,
                { duration: 7000 }
              )
              cargar(1)
            } else {
              toast.error(prog.message || 'Error en la ingesta')
            }
          }
        } catch {
          // sigue polleando
        }
      }
      poll()
      pollRef.current = setInterval(poll, 1500)
    } catch (e) {
      setIngesting(false)
      toast.error(e?.response?.data?.detail || 'No se pudo iniciar la ingesta')
    }
  }

  const reconciliarTodos = async () => {
    if (reconciling) return
    if (!confirm('Reintentar reconciliación masiva sobre las pendientes del rango actual?')) return
    setReconciling(true)
    try {
      const { data } = await api.post('/asignaciones-ruta/reconciliar-pendientes', null, {
        params: { fecha_desde: filtros.fecha_desde, limite: 5000 },
      })
      toast.success(`Revisadas: ${data.revisadas} · Enlazadas: ${data.enlazadas_nuevas} · A entregado: ${data.cambiaron_a_entregado}`)
      cargar(1)
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Error en reconciliación')
    } finally {
      setReconciling(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const stats = useMemo(() => {
    if (!resumen) return []
    const denom = Math.max(1, resumen.total - resumen.cancelados)
    const tasa = resumen.total ? `${Math.round((resumen.entregados / denom) * 100)}%` : '—'
    return [
      { label: 'Total asignados', value: resumen.total },
      { label: 'Entregados', value: resumen.entregados },
      { label: 'Cancelados', value: resumen.cancelados },
      { label: 'Sin entrega', value: resumen.sin_entrega },
      { label: 'Tasa', value: tasa },
    ]
  }, [resumen])

  return (
    <div>
      <PageHeader
        title="Asignaciones de Ruta"
        subtitle="Paquetes que salieron a ruta (denominador para efectividad). Cancelados no afectan la tasa."
        icon={Inbox}
        accent="teal"
        stats={stats}
      />

      {/* Card de ayuda */}
      <div className="mb-4">
        <button
          onClick={() => setShowHelp(s => !s)}
          className="flex items-center gap-2 text-xs text-gray-600 hover:text-gray-900"
        >
          <HelpCircle size={14} />
          {showHelp ? 'Ocultar' : '¿Qué significa esto?'}
        </button>
        {showHelp && (
          <div className="mt-2 bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-gray-700 space-y-1.5">
            <p><b>Asignación de ruta:</b> cada paquete que salió a ruta del courier (TrackingTech). Es lo que vamos a usar como <b>denominador</b> para medir efectividad.</p>
            <p><b>Envío local:</b> es la fila correspondiente en nuestra tabla <code className="font-mono bg-white px-1 rounded">envios</code>, la que llega cuando se sube el reporte CSV/Excel desde Operaciones → Ingesta. Una asignación se considera <b>conciliada</b> cuando tiene un envío local enlazado por <code className="font-mono">tracking_id</code>.</p>
            <p><b>Estados:</b></p>
            <ul className="list-disc pl-5 space-y-0.5">
              <li><b>Entregado</b>: la asignación tiene envío local y el envío tiene <code className="font-mono">fecha_entrega</code>.</li>
              <li><b>Cancelado</b>: el courier marcó la asignación como cancelada en su sistema. <i>No afecta la tasa de efectividad.</i></li>
              <li><b>Sin entrega</b>: la asignación todavía no se pudo cerrar (puede estar esperando que la ingesta CSV traiga la entrega o ser una entrega no realizada).</li>
            </ul>
          </div>
        )}
      </div>

      {/* Barra de progreso */}
      <ProgressBar progress={progress} />

      {/* Filtros */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Desde</label>
            <input
              type="date"
              value={filtros.fecha_desde}
              onChange={e => setFiltros(f => ({ ...f, fecha_desde: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Hasta</label>
            <input
              type="date"
              value={filtros.fecha_hasta}
              onChange={e => setFiltros(f => ({ ...f, fecha_hasta: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Estado</label>
            <select
              value={filtros.estado}
              onChange={e => setFiltros(f => ({ ...f, estado: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              {ESTADOS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1" title="Filtra por si la asignación está conciliada con la fila local en envios">
              Conciliado
            </label>
            <select
              value={filtros.sin_envio}
              onChange={e => setFiltros(f => ({ ...f, sin_envio: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="">Todos</option>
              <option value="false">Conciliados (con envío local)</option>
              <option value="true">Sin conciliar (sin envío local)</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-1">Buscar</label>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
              <input
                value={filtros.q}
                onChange={e => setFiltros(f => ({ ...f, q: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') aplicarFiltros() }}
                placeholder="Tracking, ruta o conductor"
                className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 mt-3 flex-wrap">
          <button
            onClick={ingestarRango}
            disabled={ingesting}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg disabled:opacity-50"
            title="Llama al endpoint del courier para el rango Desde/Hasta y guarda las asignaciones"
          >
            <DownloadCloud size={14} className={ingesting ? 'animate-pulse' : ''} />
            Ingestar rango ahora
          </button>
          <button
            onClick={reconciliarTodos}
            disabled={reconciling}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg disabled:opacity-50"
          >
            <RefreshCw size={14} className={reconciling ? 'animate-spin' : ''} />
            Reconciliar pendientes
          </button>
          <button
            onClick={aplicarFiltros}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
          >
            <Filter size={14} />
            Aplicar filtros
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Cargando…</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <AlertCircle className="mx-auto mb-2 text-gray-300" size={36} />
            No hay asignaciones para los filtros aplicados.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-600 uppercase tracking-wider">
                <tr>
                  <th className="text-left px-3 py-2">Tracking</th>
                  <th className="text-left px-3 py-2">Retiro</th>
                  <th className="text-left px-3 py-2">Ruta</th>
                  <th className="text-left px-3 py-2">Conductor</th>
                  <th className="text-left px-3 py-2" title="Fila correspondiente en la tabla envios (CSV)">Envío local</th>
                  <th className="text-left px-3 py-2">Entrega</th>
                  <th className="text-left px-3 py-2">Estado</th>
                  <th className="text-right px-3 py-2">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map(it => {
                  const sty = ESTADO_STYLES[it.estado_calculado] || ESTADO_STYLES.sin_entrega
                  const Icon = sty.icon
                  return (
                    <tr key={it.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-gray-800">{it.tracking_id}</td>
                      <td className="px-3 py-2 text-gray-700">{fmtDate(it.withdrawal_date)}</td>
                      <td className="px-3 py-2 text-gray-700">
                        {it.route_name || <span className="text-gray-400">—</span>}
                        {it.route_id != null && <div className="text-[10px] text-gray-400">#{it.route_id}</div>}
                      </td>
                      <td className="px-3 py-2 text-gray-700">
                        {it.driver_local_nombre || it.driver_name || <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {it.envio_id ? (
                          <span className="inline-flex items-center gap-1 text-xs text-blue-700" title="Está conciliado con la fila correspondiente en envios">
                            <LinkIcon size={11} /> #{it.envio_id}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400" title="Aún no llegó la fila por CSV o el tracking no coincide">sin enlace</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-700">{fmtDate(it.envio_fecha_entrega)}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border ${sty.bg} ${sty.text} ${sty.border}`}>
                          <Icon size={11} /> {it.estado_calculado.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => reconciliarUno(it)}
                          title="Reintentar reconciliación"
                          className="p-1.5 rounded hover:bg-blue-50 text-blue-600"
                        >
                          <RefreshCw size={14} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {total > pageSize && (
          <div className="flex items-center justify-between p-3 border-t border-gray-100 text-sm text-gray-600">
            <div>Mostrando {items.length} de {total}</div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => cargar(page - 1)}
                disabled={page <= 1 || loading}
                className="px-3 py-1 border border-gray-300 rounded disabled:opacity-50"
              >
                Anterior
              </button>
              <span>Página {page} / {totalPages}</span>
              <button
                onClick={() => cargar(page + 1)}
                disabled={page >= totalPages || loading}
                className="px-3 py-1 border border-gray-300 rounded disabled:opacity-50"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
