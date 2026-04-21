import { useEffect, useMemo, useState } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import { Inbox, RefreshCw, Link as LinkIcon, Search, Filter, CheckCircle2, XCircle, Clock, AlertCircle, DownloadCloud } from 'lucide-react'
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
  try {
    return new Date(iso).toLocaleDateString('es-CL')
  } catch {
    return iso
  }
}

function todayMinusDays(days) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

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
          params: {
            fecha_desde: filtros.fecha_desde,
            fecha_hasta: filtros.fecha_hasta,
          },
        }),
      ])
      setItems(list.data?.items || [])
      setTotal(list.data?.total || 0)
      setResumen(sum.data || null)
      setPage(p)
    } catch (e) {
      toast.error('No se pudieron cargar las asignaciones')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { cargar(1) }, [])

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
    try {
      const { data } = await api.post('/asignaciones-ruta/ingestar', null, {
        params: { fecha_inicio: filtros.fecha_desde, fecha_fin: filtros.fecha_hasta },
      })
      if (data.ok) {
        toast.success(
          `Creadas: ${data.asignaciones_creadas} · Actualizadas: ${data.asignaciones_actualizadas} · Con envío: ${data.enlazadas_a_envio} · Sin envío: ${data.sin_envio}`,
          { duration: 6000 }
        )
      } else {
        toast.error(data.mensaje || 'Ingesta sin datos')
      }
      cargar(1)
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Error en la ingesta')
    } finally {
      setIngesting(false)
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
            <label className="block text-xs font-medium text-gray-700 mb-1">Envío local</label>
            <select
              value={filtros.sin_envio}
              onChange={e => setFiltros(f => ({ ...f, sin_envio: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="">Todos</option>
              <option value="true">Sin envío local</option>
              <option value="false">Con envío local</option>
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
                  <th className="text-left px-3 py-2">Envío local</th>
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
                          <span className="inline-flex items-center gap-1 text-xs text-blue-700">
                            <LinkIcon size={11} /> #{it.envio_id}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">sin enlace</span>
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
