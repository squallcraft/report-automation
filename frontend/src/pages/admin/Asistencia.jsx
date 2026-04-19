import { useEffect, useMemo, useState } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import {
  Clock, Settings, RefreshCw, Link2, AlertTriangle, CheckCircle2, XCircle,
  PlayCircle, PauseCircle, Eye, EyeOff, Wifi, WifiOff, Calendar, Users,
  ListChecks, FileSignature, ArrowRight, Save, Trash2, Search, Plus, Info,
} from 'lucide-react'

const TABS = [
  { id: 'jornadas', label: 'Jornadas', icon: Calendar },
  { id: 'marcas', label: 'Marcas', icon: ListChecks },
  { id: 'vinculacion', label: 'Vincular trabajadores', icon: Link2 },
  { id: 'configuracion', label: 'Configuración', icon: Settings },
]

const ESTADO_BADGE = {
  NORMAL: 'bg-emerald-100 text-emerald-800',
  ATRASO: 'bg-amber-100 text-amber-800',
  SALIDA_ANTICIPADA: 'bg-amber-100 text-amber-800',
  INCOMPLETA: 'bg-orange-100 text-orange-800',
  AUSENTE: 'bg-red-100 text-red-800',
  HORAS_EXTRAS: 'bg-indigo-100 text-indigo-800',
  REVISAR: 'bg-yellow-100 text-yellow-800',
  VACACIONES: 'bg-blue-100 text-blue-800',
  LICENCIA: 'bg-blue-100 text-blue-800',
  FERIADO_LEGAL: 'bg-slate-100 text-slate-700',
}

const fmtMin = (m) => {
  const x = Number(m || 0)
  const h = Math.floor(x / 60)
  const r = x % 60
  if (h === 0) return `${r}m`
  if (r === 0) return `${h}h`
  return `${h}h ${r}m`
}
const fmtFecha = (s) => s ? new Date(s + 'T00:00:00').toLocaleDateString('es-CL') : '—'
const fmtHora = (iso) => iso ? new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '—'

export default function Asistencia() {
  const [tab, setTab] = useState('jornadas')
  const [config, setConfig] = useState(null)
  const [loadingCfg, setLoadingCfg] = useState(true)

  const cargarConfig = async () => {
    setLoadingCfg(true)
    try {
      const { data } = await api.get('/asistencia/configuracion')
      setConfig(data)
    } catch (err) {
      toast.error('Error al cargar configuración')
    } finally {
      setLoadingCfg(false)
    }
  }

  useEffect(() => { cargarConfig() }, [])

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Clock className="text-indigo-600" /> Control horario digital
          </h1>
          <p className="text-sm text-gray-500">
            Integración legal con ZKBioTime — el reloj físico envía las marcas al
            software certificado por la DT y nosotros las consumimos vía API REST.
          </p>
        </div>
        <EstadoModulo config={config} />
      </div>

      <BannerLegal />

      <div className="border-b">
        <nav className="-mb-px flex flex-wrap gap-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-4 py-2 border-b-2 text-sm ${
                tab === id
                  ? 'border-indigo-600 text-indigo-700 font-medium'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'jornadas' && <JornadasTab config={config} />}
      {tab === 'marcas' && <MarcasTab config={config} />}
      {tab === 'vinculacion' && <VincularTab config={config} onChange={cargarConfig} />}
      {tab === 'configuracion' && (
        <ConfiguracionTab
          config={config}
          loading={loadingCfg}
          onUpdated={cargarConfig}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
function BannerLegal() {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 font-medium">
        <Info className="w-4 h-4" />
        ¿Por qué pasamos por ZKBioTime y no nos conectamos al reloj directo?
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-blue-900/90">
          <p>
            La Inspección del Trabajo en Chile sólo reconoce como medio probatorio las
            marcas registradas en un sistema con resolución DT. ZKBioTime cuenta con
            esa certificación; nuestro código no.
          </p>
          <p className="font-medium">Flujo legal:</p>
          <code className="block bg-white border border-blue-200 rounded p-2 text-xs">
            Reloj físico (SpeedFace‑V5L) → push → ZKBioTime (certificado DT) → API REST → E-Courier
          </code>
        </div>
      )}
    </div>
  )
}

function EstadoModulo({ config }) {
  if (!config) {
    return <span className="px-3 py-1.5 rounded-full bg-gray-100 text-gray-600 text-xs">Cargando…</span>
  }
  if (config.activo) {
    return (
      <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
        <Wifi className="w-3.5 h-3.5" /> Módulo activo
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium">
      <WifiOff className="w-3.5 h-3.5" /> En stand-by
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURACIÓN
// ─────────────────────────────────────────────────────────────────────────────
function ConfiguracionTab({ config, loading, onUpdated }) {
  const [form, setForm] = useState({})
  const [showPwd, setShowPwd] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (config) {
      setForm({
        zkbio_base_url: config.zkbio_base_url || '',
        zkbio_username: config.zkbio_username || '',
        zkbio_password: '',
        zkbio_version: config.zkbio_version || '',
        tolerancia_atraso_min: config.tolerancia_atraso_min,
        tolerancia_salida_anticipada_min: config.tolerancia_salida_anticipada_min,
        minutos_minimos_he: config.minutos_minimos_he,
        requiere_aprobacion_he: config.requiere_aprobacion_he,
        he_dia_recargo_50_max_diario: config.he_dia_recargo_50_max_diario,
        consolidar_he_a_liquidacion: config.consolidar_he_a_liquidacion,
      })
    }
  }, [config])

  const guardar = async () => {
    setBusy(true)
    try {
      const payload = { ...form }
      if (!payload.zkbio_password) delete payload.zkbio_password
      await api.put('/asistencia/configuracion', payload)
      toast.success('Configuración guardada')
      onUpdated()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al guardar')
    } finally {
      setBusy(false)
    }
  }

  const probar = async () => {
    setBusy(true)
    try {
      const { data } = await api.post('/asistencia/configuracion/probar')
      toast.success(
        data.tiene_empleados
          ? `Conexión OK — primer empleado: ${data.ejemplo?.nombre || '—'}`
          : 'Conexión OK pero no hay empleados visibles',
      )
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'No se pudo conectar')
    } finally {
      setBusy(false)
    }
  }

  const toggleActivo = async () => {
    setBusy(true)
    try {
      const path = config.activo ? '/asistencia/configuracion/desactivar' : '/asistencia/configuracion/activar'
      await api.post(path)
      toast.success(config.activo ? 'Módulo desactivado' : 'Módulo activado')
      onUpdated()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al cambiar estado')
    } finally {
      setBusy(false)
    }
  }

  if (loading || !config) return <div className="p-8 text-center text-gray-500">Cargando…</div>

  const set = (k) => (e) => setForm(prev => ({
    ...prev, [k]: e.target?.type === 'checkbox' ? e.target.checked : (e.target?.value ?? e),
  }))

  return (
    <div className="space-y-6 max-w-3xl">
      <section className="bg-white rounded-lg border p-4 space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <Settings className="w-4 h-4" /> Conexión a ZKBioTime
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <label className="block text-xs text-gray-600 mb-1">URL base de ZKBioTime</label>
            <input
              type="url"
              placeholder="https://bio.miempresa.cl"
              value={form.zkbio_base_url || ''}
              onChange={set('zkbio_base_url')}
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Usuario</label>
            <input value={form.zkbio_username || ''} onChange={set('zkbio_username')} className="w-full border rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">
              Contraseña {config.tiene_password && <span className="text-emerald-600">(guardada)</span>}
            </label>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                placeholder={config.tiene_password ? '•••••• (sin cambios)' : ''}
                value={form.zkbio_password || ''}
                onChange={set('zkbio_password')}
                className="w-full border rounded px-3 py-2 pr-10 text-sm"
              />
              <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute right-2 top-2 text-gray-400 hover:text-gray-600">
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Versión ZKBioTime (opcional)</label>
            <input placeholder="ZKBioTime 8.0" value={form.zkbio_version || ''} onChange={set('zkbio_version')} className="w-full border rounded px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <button onClick={guardar} disabled={busy} className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50">
            <Save className="w-4 h-4" /> Guardar
          </button>
          <button onClick={probar} disabled={busy} className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-indigo-300 text-indigo-700 rounded hover:bg-indigo-50">
            <RefreshCw className="w-4 h-4" /> Probar conexión
          </button>
          <button onClick={toggleActivo} disabled={busy} className={`inline-flex items-center gap-2 px-4 py-2 rounded ${
            config.activo ? 'bg-amber-100 text-amber-800 hover:bg-amber-200' : 'bg-emerald-600 text-white hover:bg-emerald-700'
          }`}>
            {config.activo ? <PauseCircle className="w-4 h-4" /> : <PlayCircle className="w-4 h-4" />}
            {config.activo ? 'Desactivar módulo' : 'Activar módulo'}
          </button>
        </div>
      </section>

      <section className="bg-white rounded-lg border p-4 space-y-4">
        <h2 className="font-semibold">Reglas de cálculo</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <NumInput label="Tolerancia atraso (min)" value={form.tolerancia_atraso_min} onChange={set('tolerancia_atraso_min')} />
          <NumInput label="Tolerancia salida anticipada (min)" value={form.tolerancia_salida_anticipada_min} onChange={set('tolerancia_salida_anticipada_min')} />
          <NumInput label="Mínimo para contar HE (min)" value={form.minutos_minimos_he} onChange={set('minutos_minimos_he')} />
          <NumInput label="Tope HE diario al 50% (h, Art. 31 CT)" value={form.he_dia_recargo_50_max_diario} onChange={set('he_dia_recargo_50_max_diario')} />
        </div>
        <div className="flex flex-col gap-2 pt-2">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!form.requiere_aprobacion_he} onChange={set('requiere_aprobacion_he')} />
            Las HE requieren aprobación explícita antes de pagarse
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!form.consolidar_he_a_liquidacion} onChange={set('consolidar_he_a_liquidacion')} />
            Consolidar automáticamente las HE aprobadas a la liquidación mensual
          </label>
        </div>
        <button onClick={guardar} disabled={busy} className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50">
          <Save className="w-4 h-4" /> Guardar reglas
        </button>
      </section>

      {config.ultima_sync_at && (
        <section className="bg-white rounded-lg border p-4 text-sm text-gray-700 space-y-1">
          <h2 className="font-semibold mb-2">Última sincronización</h2>
          <div>📅 {new Date(config.ultima_sync_at).toLocaleString('es-CL')}</div>
          <div>📥 {config.ultima_sync_marcas_nuevas ?? 0} marcas nuevas</div>
          {config.ultima_sync_error && (
            <div className="text-red-700">⚠️ Último error: {config.ultima_sync_error}</div>
          )}
        </section>
      )}
    </div>
  )
}

function NumInput({ label, value, onChange }) {
  return (
    <div>
      <label className="block text-xs text-gray-600 mb-1">{label}</label>
      <input
        type="number"
        min="0"
        value={value ?? 0}
        onChange={(e) => onChange({ target: { value: Number(e.target.value) || 0 } })}
        className="w-full border rounded px-3 py-2 text-sm"
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// JORNADAS
// ─────────────────────────────────────────────────────────────────────────────
function JornadasTab({ config }) {
  const hoy = new Date().toISOString().slice(0, 10)
  const haceUnMes = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const [desde, setDesde] = useState(haceUnMes)
  const [hasta, setHasta] = useState(hoy)
  const [estado, setEstado] = useState('')
  const [trabajadorId, setTrabajadorId] = useState('')
  const [trabajadores, setTrabajadores] = useState([])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [aprobandoId, setAprobandoId] = useState(null)
  const [minutosAprobar, setMinutosAprobar] = useState(0)
  const moduloListo = config?.activo

  const cargar = async () => {
    setLoading(true)
    try {
      const params = { desde, hasta }
      if (estado) params.estado = estado
      if (trabajadorId) params.trabajador_id = trabajadorId
      const [{ data: js }, trab] = await Promise.all([
        api.get('/asistencia/jornadas', { params }),
        trabajadores.length ? Promise.resolve({ data: trabajadores }) : api.get('/trabajadores'),
      ])
      setRows(js)
      if (!trabajadores.length) setTrabajadores(trab.data || [])
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al cargar jornadas')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (moduloListo) cargar() /* eslint-disable-line */ }, [desde, hasta, estado, trabajadorId, moduloListo])

  const sincronizar = async () => {
    setBusy(true)
    try {
      const { data } = await api.post('/asistencia/sincronizar', {
        recalcular_jornadas: true,
      })
      toast.success(`Importadas ${data.marcas_nuevas} marcas nuevas; ${data.jornadas_recalculadas} jornadas recalculadas.`)
      cargar()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al sincronizar')
    } finally {
      setBusy(false)
    }
  }

  const recalcular = async () => {
    setBusy(true)
    try {
      const { data } = await api.post('/asistencia/jornadas/recalcular', {
        desde, hasta, trabajador_id: trabajadorId ? Number(trabajadorId) : null,
      })
      toast.success(`Recalculadas ${data.jornadas_actualizadas} jornadas.`)
      cargar()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al recalcular')
    } finally {
      setBusy(false)
    }
  }

  const consolidarMes = async () => {
    const ahora = new Date()
    const m = ahora.getMonth() + 1
    const a = ahora.getFullYear()
    if (!confirm(`¿Consolidar las HE aprobadas de ${String(m).padStart(2, '0')}/${a} a la liquidación?`)) return
    setBusy(true)
    try {
      const { data } = await api.post('/asistencia/jornadas/consolidar-mes', {
        mes: m, anio: a, trabajador_id: trabajadorId ? Number(trabajadorId) : null,
      })
      toast.success(`Consolidadas en ${data.horas_extras_consolidadas} trabajadores.`)
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al consolidar')
    } finally {
      setBusy(false)
    }
  }

  const aprobarHE = async (j) => {
    if (minutosAprobar < 0) return
    try {
      await api.post(`/asistencia/jornadas/${j.id}/aprobar-he`, { minutos: Number(minutosAprobar) })
      toast.success('HE aprobadas')
      setAprobandoId(null)
      setMinutosAprobar(0)
      cargar()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al aprobar')
    }
  }

  if (!moduloListo) return <ModuloApagado />

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-xs text-gray-600 mb-1">Desde</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Hasta</label>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Estado</label>
          <select value={estado} onChange={(e) => setEstado(e.target.value)} className="border rounded px-2 py-1 text-sm">
            <option value="">Todos</option>
            {Object.keys(ESTADO_BADGE).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Trabajador</label>
          <select value={trabajadorId} onChange={(e) => setTrabajadorId(e.target.value)} className="border rounded px-2 py-1 text-sm min-w-[200px]">
            <option value="">Todos</option>
            {trabajadores.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        </div>
        <div className="flex-1" />
        <button onClick={sincronizar} disabled={busy} className="inline-flex items-center gap-2 px-3 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 text-sm">
          <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} /> Sincronizar ZKBioTime
        </button>
        <button onClick={recalcular} disabled={busy} className="inline-flex items-center gap-2 px-3 py-2 bg-white border rounded hover:bg-gray-50 text-sm">
          <RefreshCw className="w-4 h-4" /> Recalcular jornadas
        </button>
        <button onClick={consolidarMes} disabled={busy} className="inline-flex items-center gap-2 px-3 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 text-sm">
          <ArrowRight className="w-4 h-4" /> Consolidar HE → Liquidación
        </button>
      </div>

      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-600">
              <tr>
                <th className="px-3 py-2 text-left">Fecha</th>
                <th className="px-3 py-2 text-left">Trabajador</th>
                <th className="px-3 py-2 text-left">Estado</th>
                <th className="px-3 py-2 text-right">Entrada</th>
                <th className="px-3 py-2 text-right">Salida</th>
                <th className="px-3 py-2 text-right">Trabajado</th>
                <th className="px-3 py-2 text-right">Atraso</th>
                <th className="px-3 py-2 text-right">HE est./aprob.</th>
                <th className="px-3 py-2 text-right">Acción</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-500">Cargando…</td></tr>}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-500">Sin jornadas en el rango.</td></tr>
              )}
              {rows.map(j => (
                <tr key={j.id} className="border-t hover:bg-gray-50">
                  <td className="px-3 py-2">{fmtFecha(j.fecha)}</td>
                  <td className="px-3 py-2">{j.trabajador_nombre || `#${j.trabajador_id}`}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ESTADO_BADGE[j.estado] || 'bg-gray-100 text-gray-700'}`}>
                      {j.estado}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">{fmtHora(j.primera_entrada)}</td>
                  <td className="px-3 py-2 text-right">{fmtHora(j.ultima_salida)}</td>
                  <td className="px-3 py-2 text-right">{fmtMin(j.minutos_trabajados)}</td>
                  <td className="px-3 py-2 text-right">{j.minutos_atraso ? fmtMin(j.minutos_atraso) : '—'}</td>
                  <td className="px-3 py-2 text-right">
                    {j.minutos_he_estimadas ? fmtMin(j.minutos_he_estimadas) : '—'}
                    {j.he_aprobadas_min ? <span className="ml-1 text-emerald-700">/ {fmtMin(j.he_aprobadas_min)}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {(j.minutos_he_estimadas > 0 || j.he_aprobadas_min > 0) && (
                      aprobandoId === j.id ? (
                        <div className="inline-flex items-center gap-1">
                          <input
                            type="number" min="0" max="600"
                            value={minutosAprobar}
                            onChange={(e) => setMinutosAprobar(Number(e.target.value))}
                            className="w-20 border rounded px-2 py-1 text-xs"
                          />
                          <button onClick={() => aprobarHE(j)} className="text-emerald-700 hover:underline text-xs">OK</button>
                          <button onClick={() => setAprobandoId(null)} className="text-gray-400 hover:underline text-xs">×</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setAprobandoId(j.id); setMinutosAprobar(j.he_aprobadas_min || j.minutos_he_estimadas) }}
                          className="text-indigo-700 hover:underline text-xs inline-flex items-center gap-1"
                        >
                          <FileSignature className="w-3 h-3" /> Aprobar HE
                        </button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MARCAS
// ─────────────────────────────────────────────────────────────────────────────
function MarcasTab({ config }) {
  const hoy = new Date().toISOString().slice(0, 10)
  const haceDosSemanas = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)
  const [desde, setDesde] = useState(haceDosSemanas)
  const [hasta, setHasta] = useState(hoy)
  const [soloHuerfanas, setSoloHuerfanas] = useState(false)
  const [incluirDescartadas, setIncluirDescartadas] = useState(false)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const moduloListo = config?.activo

  const cargar = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/asistencia/marcas', {
        params: {
          desde, hasta,
          solo_huerfanas: soloHuerfanas,
          incluir_descartadas: incluirDescartadas,
        },
      })
      setRows(data)
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (moduloListo) cargar() /* eslint-disable-line */ }, [desde, hasta, soloHuerfanas, incluirDescartadas, moduloListo])

  const descartar = async (m) => {
    const motivo = prompt('Motivo del descarte (mínimo 3 caracteres):')
    if (!motivo || motivo.length < 3) return
    try {
      await api.post(`/asistencia/marcas/${m.id}/descartar`, null, { params: { motivo } })
      toast.success('Marca descartada')
      cargar()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al descartar')
    }
  }

  if (!moduloListo) return <ModuloApagado />
  const huerfanas = rows.filter(r => !r.trabajador_id).length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-xs text-gray-600 mb-1">Desde</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Hasta</label>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        </div>
        <label className="inline-flex items-center gap-1 text-sm">
          <input type="checkbox" checked={soloHuerfanas} onChange={(e) => setSoloHuerfanas(e.target.checked)} />
          Solo sin trabajador vinculado
        </label>
        <label className="inline-flex items-center gap-1 text-sm">
          <input type="checkbox" checked={incluirDescartadas} onChange={(e) => setIncluirDescartadas(e.target.checked)} />
          Incluir descartadas
        </label>
      </div>

      {huerfanas > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          {huerfanas} marca(s) sin trabajador vinculado. Ve a la pestaña <b>Vincular trabajadores</b>.
        </div>
      )}

      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-600">
              <tr>
                <th className="px-3 py-2 text-left">Fecha/Hora</th>
                <th className="px-3 py-2 text-left">Trabajador</th>
                <th className="px-3 py-2 text-left">Tipo</th>
                <th className="px-3 py-2 text-left">Verificación</th>
                <th className="px-3 py-2 text-left">Reloj</th>
                <th className="px-3 py-2 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500">Cargando…</td></tr>}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-500">Sin marcas.</td></tr>
              )}
              {rows.map(m => (
                <tr key={m.id} className={`border-t ${m.descartada ? 'opacity-50 line-through' : ''}`}>
                  <td className="px-3 py-2">{m.timestamp ? new Date(m.timestamp).toLocaleString('es-CL') : '—'}</td>
                  <td className="px-3 py-2">
                    {m.trabajador_nombre || (
                      <span className="text-amber-700 text-xs">
                        sin vincular ({m.zkbio_employee_codigo || m.zkbio_employee_id})
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{m.tipo}</td>
                  <td className="px-3 py-2 text-xs">{m.verify_type || '—'}</td>
                  <td className="px-3 py-2 text-xs">{m.dispositivo_alias || m.dispositivo_sn || '—'}</td>
                  <td className="px-3 py-2 text-right">
                    {!m.descartada && (
                      <button onClick={() => descartar(m)} className="text-red-600 hover:underline text-xs inline-flex items-center gap-1">
                        <Trash2 className="w-3 h-3" /> Descartar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// VINCULACIÓN
// ─────────────────────────────────────────────────────────────────────────────
function VincularTab({ config, onChange }) {
  const [empleados, setEmpleados] = useState([])
  const [trabajadores, setTrabajadores] = useState([])
  const [loading, setLoading] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [editando, setEditando] = useState(null)
  const moduloListo = config?.activo

  const cargar = async () => {
    setLoading(true)
    try {
      const [emp, trab] = await Promise.all([
        api.get('/asistencia/empleados-zkbio'),
        api.get('/trabajadores'),
      ])
      setEmpleados(emp.data || [])
      setTrabajadores(trab.data || [])
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (moduloListo) cargar() /* eslint-disable-line */ }, [moduloListo])

  const guardar = async (trabajadorId, payload) => {
    try {
      const { data } = await api.put(`/asistencia/trabajadores/${trabajadorId}/vincular`, payload)
      toast.success(
        data.marcas_reasignadas
          ? `Vinculado. Reasignadas ${data.marcas_reasignadas} marcas previas.`
          : 'Vinculado.',
      )
      setEditando(null)
      cargar()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al vincular')
    }
  }

  if (!moduloListo) return <ModuloApagado />

  const filtrados = useMemo(() => {
    const q = busqueda.toLowerCase()
    return trabajadores.filter(t => !q || t.nombre.toLowerCase().includes(q))
  }, [trabajadores, busqueda])

  const empleadosIdx = useMemo(() => {
    const map = new Map()
    for (const e of empleados) map.set(e.zkbio_employee_id, e)
    return map
  }, [empleados])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
          <input
            placeholder="Buscar trabajador…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="w-full border rounded pl-9 pr-3 py-2 text-sm"
          />
        </div>
        <button onClick={cargar} className="inline-flex items-center gap-2 px-3 py-2 bg-white border rounded hover:bg-gray-50 text-sm">
          <RefreshCw className="w-4 h-4" /> Refrescar empleados ZKBio
        </button>
        <span className="text-xs text-gray-500">
          {empleados.length} empleados en ZKBioTime · {empleados.filter(e => e.vinculado_a).length} vinculados
        </span>
      </div>

      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-600">
              <tr>
                <th className="px-3 py-2 text-left">Trabajador</th>
                <th className="px-3 py-2 text-left">Vinculación ZKBio</th>
                <th className="px-3 py-2 text-left">Horario esperado</th>
                <th className="px-3 py-2 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-500">Cargando…</td></tr>}
              {!loading && filtrados.map(t => {
                const emp = t.zkbio_employee_id ? empleadosIdx.get(t.zkbio_employee_id) : null
                const editing = editando?.id === t.id
                return (
                  <tr key={t.id} className="border-t">
                    <td className="px-3 py-2">{t.nombre}</td>
                    <td className="px-3 py-2">
                      {editing ? (
                        <select
                          className="border rounded px-2 py-1 text-sm w-72"
                          value={editando.zkbio_employee_id || ''}
                          onChange={(e) => {
                            const sel = empleadosIdx.get(e.target.value)
                            setEditando({
                              ...editando,
                              zkbio_employee_id: e.target.value || null,
                              zkbio_employee_codigo: sel?.zkbio_employee_codigo || null,
                            })
                          }}
                        >
                          <option value="">— Sin vincular —</option>
                          {empleados.map(emp => (
                            <option key={emp.zkbio_employee_id} value={emp.zkbio_employee_id}>
                              {emp.nombre || '(sin nombre)'} · {emp.zkbio_employee_codigo || emp.zkbio_employee_id}
                              {emp.vinculado_a && emp.vinculado_a.trabajador_id !== t.id ? ` ← ya vinculado a ${emp.vinculado_a.nombre}` : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        t.zkbio_employee_id ? (
                          <span className="inline-flex items-center gap-2 text-xs">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            {emp?.nombre || '(empleado no encontrado en ZKBio)'} ·
                            <code className="bg-gray-100 rounded px-1">{t.zkbio_employee_codigo || t.zkbio_employee_id}</code>
                          </span>
                        ) : <span className="text-xs text-gray-400">Sin vincular</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {editing ? (
                        <div className="flex items-center gap-1">
                          <input type="time" value={editando.hora_entrada_esperada || ''} onChange={(e) => setEditando({ ...editando, hora_entrada_esperada: e.target.value })} className="border rounded px-2 py-1" />
                          <ArrowRight className="w-3 h-3 text-gray-400" />
                          <input type="time" value={editando.hora_salida_esperada || ''} onChange={(e) => setEditando({ ...editando, hora_salida_esperada: e.target.value })} className="border rounded px-2 py-1" />
                          <span className="ml-2">colación</span>
                          <input type="number" min="0" max="180" value={editando.minutos_colacion ?? 60} onChange={(e) => setEditando({ ...editando, minutos_colacion: Number(e.target.value) })} className="w-16 border rounded px-2 py-1" />
                          <span>min</span>
                        </div>
                      ) : (
                        t.hora_entrada_esperada
                          ? `${t.hora_entrada_esperada} → ${t.hora_salida_esperada || '—'} (col. ${t.minutos_colacion || 60}m)`
                          : <span className="text-gray-400">Por defecto (09:00 → 18:00)</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {editing ? (
                        <div className="inline-flex gap-1">
                          <button onClick={() => guardar(t.id, editando)} className="px-2 py-1 bg-indigo-600 text-white rounded text-xs">Guardar</button>
                          <button onClick={() => setEditando(null)} className="px-2 py-1 bg-white border rounded text-xs">Cancelar</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setEditando({
                            id: t.id,
                            zkbio_employee_id: t.zkbio_employee_id,
                            zkbio_employee_codigo: t.zkbio_employee_codigo,
                            hora_entrada_esperada: t.hora_entrada_esperada || '',
                            hora_salida_esperada: t.hora_salida_esperada || '',
                            minutos_colacion: t.minutos_colacion ?? 60,
                          })}
                          className="text-indigo-700 hover:underline text-xs inline-flex items-center gap-1"
                        >
                          <Link2 className="w-3 h-3" /> Editar
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
function ModuloApagado() {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-6 text-amber-900 flex items-start gap-3">
      <PauseCircle className="w-6 h-6 flex-shrink-0" />
      <div className="space-y-1">
        <p className="font-semibold">El módulo de control horario está apagado.</p>
        <p className="text-sm">
          Cuando instalemos físicamente el reloj <b>ZKTeco SpeedFace‑V5L</b> y configures
          la URL/credenciales de tu servidor ZKBioTime en la pestaña <b>Configuración</b>,
          podrás activarlo desde ahí. Mientras tanto, el resto de funciones (jornadas,
          marcas, vinculación) quedan en stand‑by.
        </p>
      </div>
    </div>
  )
}
