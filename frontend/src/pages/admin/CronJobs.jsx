import { useEffect, useMemo, useState } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import { Clock, Play, RefreshCw, History, Save, Power, PowerOff, Settings as SettingsIcon } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import Modal from '../../components/Modal'

const ESTADO_BADGE = {
  ok: 'bg-green-100 text-green-700 border border-green-300',
  error: 'bg-red-100 text-red-700 border border-red-300',
  running: 'bg-blue-100 text-blue-700 border border-blue-300',
}

function fmtDateTime(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

function fmtDur(s) {
  if (s == null) return '—'
  const n = Number(s)
  if (Number.isNaN(n)) return '—'
  if (n < 60) return `${n.toFixed(1)}s`
  return `${Math.floor(n / 60)}m ${Math.round(n % 60)}s`
}

export default function CronJobs() {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [editJob, setEditJob] = useState(null)
  const [historyJob, setHistoryJob] = useState(null)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const cargar = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/cron-jobs')
      setJobs(data || [])
    } catch {
      toast.error('No se pudieron cargar los cron jobs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { cargar() }, [])

  const ejecutarAhora = async (job) => {
    try {
      await api.post(`/cron-jobs/${job.id}/run-now`)
      toast.success(`Ejecución manual encolada: ${job.nombre}`)
      setTimeout(cargar, 1500)
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'No se pudo ejecutar')
    }
  }

  const recargarScheduler = async () => {
    try {
      const { data } = await api.post('/cron-jobs/reload')
      toast.success(`Scheduler sincronizado: ${data.jobs_registrados} job(s) activos`)
      cargar()
    } catch {
      toast.error('No se pudo recargar el scheduler')
    }
  }

  const abrirHistorial = async (job) => {
    setHistoryJob(job)
    setHistory([])
    setHistoryLoading(true)
    try {
      const { data } = await api.get(`/cron-jobs/${job.id}/historial`, { params: { limite: 50 } })
      setHistory(data || [])
    } catch {
      toast.error('No se pudo cargar el historial')
    } finally {
      setHistoryLoading(false)
    }
  }

  const guardarEdicion = async (payload) => {
    if (!editJob) return
    setSaving(true)
    try {
      await api.patch(`/cron-jobs/${editJob.id}`, payload)
      toast.success('Cron job actualizado')
      setEditJob(null)
      cargar()
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const stats = useMemo(() => {
    const activos = jobs.filter(j => j.activo).length
    const conError = jobs.filter(j => j.ultima_ejecucion_estado === 'error').length
    return [
      { label: 'Cron jobs', value: jobs.length },
      { label: 'Activos', value: activos },
      ...(conError ? [{ label: 'Con error', value: conError }] : []),
    ]
  }, [jobs])

  return (
    <div>
      <PageHeader
        title="Cron Jobs"
        subtitle="Tareas programadas del sistema (ingestas, reconciliaciones, mantenimiento)"
        icon={Clock}
        accent="purple"
        stats={stats}
        actions={
          <button
            onClick={recargarScheduler}
            className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm font-medium transition"
          >
            <RefreshCw size={16} />
            Recargar scheduler
          </button>
        }
      />

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Cargando…</div>
        ) : jobs.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No hay cron jobs configurados.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-3">Nombre</th>
                  <th className="text-left px-4 py-3">Estado</th>
                  <th className="text-left px-4 py-3">Hora</th>
                  <th className="text-left px-4 py-3">Última ejecución</th>
                  <th className="text-left px-4 py-3">Resultado</th>
                  <th className="text-left px-4 py-3">Próxima</th>
                  <th className="text-right px-4 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {jobs.map(j => (
                  <tr key={j.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{j.nombre}</div>
                      {j.descripcion && (
                        <div className="text-xs text-gray-500 mt-0.5 max-w-md">{j.descripcion}</div>
                      )}
                      <div className="text-[10px] text-gray-400 mt-0.5 font-mono">{j.job_key}</div>
                    </td>
                    <td className="px-4 py-3">
                      {j.activo ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700 border border-green-300">
                          <Power size={10} /> Activo
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600 border border-gray-300">
                          <PowerOff size={10} /> Inactivo
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-700">{j.hora_ejecucion}</td>
                    <td className="px-4 py-3 text-gray-700">
                      <div>{fmtDateTime(j.ultima_ejecucion_at)}</div>
                      <div className="text-xs text-gray-500">{fmtDur(j.ultima_ejecucion_duracion_s)}</div>
                    </td>
                    <td className="px-4 py-3">
                      {j.ultima_ejecucion_estado ? (
                        <span className={`px-2 py-0.5 text-xs font-medium rounded ${ESTADO_BADGE[j.ultima_ejecucion_estado] || 'bg-gray-100 text-gray-700'}`}>
                          {j.ultima_ejecucion_estado}
                        </span>
                      ) : <span className="text-gray-400 text-xs">sin ejecuciones</span>}
                      {j.ultima_ejecucion_mensaje && (
                        <div className="text-xs text-gray-500 mt-1 max-w-xs truncate" title={j.ultima_ejecucion_mensaje}>
                          {j.ultima_ejecucion_mensaje}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{fmtDateTime(j.proxima_ejecucion_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => ejecutarAhora(j)}
                          title="Ejecutar ahora"
                          className="p-2 rounded-lg hover:bg-blue-50 text-blue-600"
                        >
                          <Play size={16} />
                        </button>
                        <button
                          onClick={() => abrirHistorial(j)}
                          title="Historial"
                          className="p-2 rounded-lg hover:bg-gray-100 text-gray-600"
                        >
                          <History size={16} />
                        </button>
                        <button
                          onClick={() => setEditJob(j)}
                          title="Editar"
                          className="p-2 rounded-lg hover:bg-amber-50 text-amber-600"
                        >
                          <SettingsIcon size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <EditarCronModal
        job={editJob}
        onClose={() => setEditJob(null)}
        onSave={guardarEdicion}
        saving={saving}
      />

      <HistorialModal
        job={historyJob}
        items={history}
        loading={historyLoading}
        onClose={() => { setHistoryJob(null); setHistory([]) }}
      />
    </div>
  )
}

function EditarCronModal({ job, onClose, onSave, saving }) {
  const [activo, setActivo] = useState(false)
  const [hora, setHora] = useState('03:00')
  const [descripcion, setDescripcion] = useState('')
  const [configText, setConfigText] = useState('{}')
  const [configError, setConfigError] = useState('')

  useEffect(() => {
    if (!job) return
    setActivo(!!job.activo)
    setHora(job.hora_ejecucion || '03:00')
    setDescripcion(job.descripcion || '')
    setConfigText(JSON.stringify(job.config || {}, null, 2))
    setConfigError('')
  }, [job])

  if (!job) return null

  const handleSave = () => {
    let cfg = null
    try {
      cfg = JSON.parse(configText || '{}')
      setConfigError('')
    } catch (e) {
      setConfigError('JSON inválido')
      return
    }
    onSave({
      activo,
      hora_ejecucion: hora,
      descripcion,
      config: cfg,
    })
  }

  return (
    <Modal open={!!job} onClose={onClose} title={`Editar: ${job.nombre}`} size="lg">
      <div className="space-y-4">
        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
          <div>
            <div className="font-medium text-gray-900">Activo</div>
            <div className="text-xs text-gray-500">El scheduler ejecutará este job en su horario</div>
          </div>
          <button
            type="button"
            onClick={() => setActivo(v => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${activo ? 'bg-green-600' : 'bg-gray-300'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${activo ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Hora de ejecución (24h)</label>
            <input
              type="time"
              value={hora}
              onChange={e => setHora(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="text-[11px] text-gray-500 mt-1">Zona: America/Santiago</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Job key</label>
            <input
              value={job.job_key}
              disabled
              className="w-full px-3 py-2 border border-gray-200 bg-gray-50 rounded-lg text-sm font-mono text-gray-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Descripción</label>
          <textarea
            value={descripcion}
            onChange={e => setDescripcion(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Configuración (JSON)</label>
          <textarea
            value={configText}
            onChange={e => setConfigText(e.target.value)}
            rows={8}
            className={`w-full px-3 py-2 border rounded-lg text-sm font-mono ${configError ? 'border-red-400' : 'border-gray-300'} focus:ring-2 focus:ring-blue-500`}
          />
          {configError && <p className="text-xs text-red-600 mt-1">{configError}</p>}
          <p className="text-[11px] text-gray-500 mt-1">
            Ej. para ingesta de rutas: <code className="font-mono">{'{ "dias_atras": 1, "rango_dias": 1, "lookback_extra": 0 }'}</code>
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition"
          >
            <Save size={16} />
            Guardar
          </button>
        </div>
      </div>
    </Modal>
  )
}

function HistorialModal({ job, items, loading, onClose }) {
  if (!job) return null
  return (
    <Modal open={!!job} onClose={onClose} title={`Historial: ${job.nombre}`} size="2xl">
      {loading ? (
        <div className="text-center py-8 text-gray-500">Cargando…</div>
      ) : items.length === 0 ? (
        <div className="text-center py-8 text-gray-500">Sin ejecuciones registradas.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600 uppercase tracking-wider">
              <tr>
                <th className="text-left px-3 py-2">Inicio</th>
                <th className="text-left px-3 py-2">Estado</th>
                <th className="text-left px-3 py-2">Duración</th>
                <th className="text-left px-3 py-2">Disparo</th>
                <th className="text-left px-3 py-2">Mensaje / Resultado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map(it => (
                <tr key={it.id}>
                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{fmtDateTime(it.iniciado_at)}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 text-xs rounded ${ESTADO_BADGE[it.estado] || 'bg-gray-100 text-gray-700'}`}>
                      {it.estado}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-700">{fmtDur(it.duracion_s)}</td>
                  <td className="px-3 py-2 text-gray-700">
                    {it.disparado_por}
                    {it.disparado_por_usuario && <div className="text-xs text-gray-500">{it.disparado_por_usuario}</div>}
                  </td>
                  <td className="px-3 py-2">
                    {it.mensaje && <div className="text-xs text-gray-700 mb-1">{it.mensaje}</div>}
                    {it.resultado && (
                      <details className="text-xs text-gray-500">
                        <summary className="cursor-pointer hover:text-gray-700">Resultado JSON</summary>
                        <pre className="mt-1 p-2 bg-gray-50 rounded overflow-x-auto text-[11px]">
                          {JSON.stringify(it.resultado, null, 2)}
                        </pre>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}
