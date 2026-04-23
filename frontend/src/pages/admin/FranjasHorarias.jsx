import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api'
import toast from 'react-hot-toast'
import { Clock, Package, Truck, TrendingUp, Upload, CheckCircle2 } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import DateRangePicker, { toIsoLocal } from '../../components/DateRangePicker'

const now = new Date()
const _defInicio = new Date(now.getFullYear(), now.getMonth(), 1)
const _defFin = new Date(now.getFullYear(), now.getMonth() + 1, 0)

const FRANJAS_META = {
  am:        { label: 'AM (08–15 h)',        color: '#f59e0b', bg: 'bg-amber-400',   desc: 'Mañana / 2dos intentos' },
  pm_ideal:  { label: 'PM ideal (15–21 h)',  color: '#10b981', bg: 'bg-emerald-500', desc: 'Mejor rango horario' },
  pm_limite: { label: 'PM límite (21–22 h)', color: '#f97316', bg: 'bg-orange-500',  desc: 'Límite aceptable' },
  pm_tarde:  { label: 'PM tarde (22+ h)',    color: '#ef4444', bg: 'bg-red-500',     desc: 'A mejorar' },
  madrugada: { label: 'Madrugada (0–8 h)',   color: '#8b5cf6', bg: 'bg-violet-500',  desc: 'Fuera de horario' },
  sin_hora:  { label: 'Sin hora',            color: '#94a3b8', bg: 'bg-slate-400',   desc: 'Sin dato' },
}
const FRANJA_KEYS = ['am', 'pm_ideal', 'pm_limite', 'pm_tarde', 'madrugada', 'sin_hora']

const fmtN = (v) => v != null ? v.toLocaleString('es-CL') : '—'
const fmtPct = (v) => v != null ? `${v}%` : '—'

function BarFranja({ data }) {
  const total = FRANJA_KEYS.reduce((s, k) => s + (data?.[k] ?? 0), 0)
  if (!total) return null
  return (
    <div className="flex w-full h-5 rounded overflow-hidden gap-px">
      {FRANJA_KEYS.map(k => {
        const n = data?.[k] ?? 0
        if (!n) return null
        const pct = (n / total) * 100
        return (
          <div key={k} style={{ width: `${pct}%`, background: FRANJAS_META[k].color }}
            title={`${FRANJAS_META[k].label}: ${n} (${Math.round(pct)}%)`} />
        )
      })}
    </div>
  )
}

const AGR_OPTS = [
  { id: 'global',  label: 'Global' },
  { id: 'dia',     label: 'Por día' },
  { id: 'semana',  label: 'Por semana' },
  { id: 'mes',     label: 'Por mes' },
  { id: 'driver',  label: 'Por conductor' },
  { id: 'seller',  label: 'Por seller' },
  { id: 'ruta',    label: 'Por ruta' },
]

export default function FranjasHorarias() {
  const navigate = useNavigate()
  const [range, setRange] = useState({ inicio: _defInicio, fin: _defFin })
  const [agr, setAgr] = useState('driver')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  // Backfill
  const [backfillFile, setBackfillFile] = useState(null)
  const [backfillTask, setBackfillTask] = useState(null)
  const [backfillProg, setBackfillProg] = useState(null)
  const [uploading, setUploading] = useState(false)

  const fechaInicioIso = useMemo(() => range.inicio ? toIsoLocal(range.inicio) : null, [range.inicio])
  const fechaFinIso = useMemo(() => range.fin ? toIsoLocal(range.fin) : null, [range.fin])

  const load = useCallback(async () => {
    if (!fechaInicioIso || !fechaFinIso) return
    setLoading(true)
    try {
      const { data: d } = await api.get('/dashboard/franjas-horarias', {
        params: { fecha_inicio: fechaInicioIso, fecha_fin: fechaFinIso, agrupacion: agr },
      })
      setData(d)
    } catch {
      toast.error('Error cargando franjas horarias')
    } finally {
      setLoading(false)
    }
  }, [fechaInicioIso, fechaFinIso, agr])
  useEffect(() => { load() }, [load])

  // Polling del task de backfill
  useEffect(() => {
    if (!backfillTask) return
    let active = true
    const poll = async () => {
      try {
        const { data: t } = await api.get(`/envios/hora/backfill/progress/${backfillTask}`)
        if (active) setBackfillProg(t)
        if (t.estado === 'ok' || t.estado === 'error') {
          if (t.estado === 'ok') { toast.success(`Backfill completado: ${t.resultado?.actualizados} actualizados`); load() }
          else toast.error(`Error en backfill: ${t.mensaje}`)
          setBackfillTask(null)
        } else {
          setTimeout(poll, 2000)
        }
      } catch { if (active) setTimeout(poll, 3000) }
    }
    poll()
    return () => { active = false }
  }, [backfillTask, load])

  const submitBackfill = async () => {
    if (!backfillFile) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('archivo', backfillFile)
      const { data: r } = await api.post('/envios/hora/backfill', fd)
      setBackfillTask(r.task_id)
      toast.success('Backfill iniciado')
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Error subiendo archivo')
    } finally {
      setUploading(false)
    }
  }

  const rows = useMemo(() => {
    if (!data?.rows) return []
    return data.rows.filter(r =>
      !search || (r.label || '').toLowerCase().includes(search.toLowerCase())
    )
  }, [data, search])

  const g = data?.global

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        title="Franjas Horarias de Entrega"
        subtitle="Distribución de entregas por rango horario — AM · PM · Límite · Tarde"
        icon={Clock}
        accent="amber"
        actions={
          <div className="flex items-center gap-3 flex-wrap">
            <DateRangePicker value={range} onChange={setRange} />
          </div>
        }
      />

      {/* Selector de agrupación */}
      <div className="flex items-center gap-2 flex-wrap">
        {AGR_OPTS.map(o => (
          <button
            key={o.id}
            type="button"
            onClick={() => setAgr(o.id)}
            className={`text-xs px-3 py-1.5 rounded-full border font-semibold transition ${
              agr === o.id
                ? 'bg-amber-500 text-white border-amber-500'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50 bg-white'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {/* Backfill panel */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <div className="flex items-center gap-2 mb-3">
          <Upload size={14} className="text-slate-400" />
          <p className="text-sm font-semibold text-gray-700">Backfill de hora de entrega</p>
          <span className="text-[10px] text-gray-400">Excel/CSV con columnas: Tracking ID · Hora Entrega (HH:MM:SS)</span>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <input type="file" accept=".xlsx,.xls,.csv"
            onChange={e => setBackfillFile(e.target.files?.[0] || null)}
            className="text-xs text-gray-600 border border-gray-200 rounded-lg px-2 py-1.5 w-72"
          />
          <button
            type="button"
            onClick={submitBackfill}
            disabled={!backfillFile || uploading || !!backfillTask}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-amber-500 text-white font-semibold disabled:opacity-40 hover:bg-amber-600 transition"
          >
            <Upload size={13} />
            {uploading ? 'Subiendo…' : backfillTask ? 'Procesando…' : 'Subir y procesar'}
          </button>
          {backfillProg && (
            <div className="flex items-center gap-2 text-xs text-gray-600">
              {backfillProg.estado === 'ok'
                ? <CheckCircle2 size={13} className="text-emerald-500" />
                : <span className="animate-pulse">⏳</span>
              }
              <span>{backfillProg.mensaje}</span>
              {backfillProg.resultado && (
                <span className="text-emerald-600 font-semibold">
                  {backfillProg.resultado.actualizados} actualizados
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400 text-sm">Cargando…</div>
      ) : !g ? (
        <div className="text-center py-16 text-gray-400 text-sm">Sin datos</div>
      ) : (
        <>
          {/* KPIs globales por franja */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {FRANJA_KEYS.map(k => {
              const m = FRANJAS_META[k]
              const n = g[k] ?? 0
              const pct = g[`pct_${k}`] ?? 0
              return (
                <div key={k} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 border-l-4"
                  style={{ borderLeftColor: m.color }}>
                  <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">{m.label}</p>
                  <p className="text-3xl font-black mt-1" style={{ color: m.color }}>{fmtPct(pct)}</p>
                  <p className="text-xs text-gray-400 mt-1">{fmtN(n)} envíos</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{m.desc}</p>
                </div>
              )
            })}
          </div>

          {/* Barra resumen */}
          <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-gray-700">Distribución global · {fmtN(g.total)} entregas</p>
              <div className="flex items-center gap-3 flex-wrap">
                {FRANJA_KEYS.filter(k => (g[k] ?? 0) > 0).map(k => (
                  <div key={k} className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full" style={{ background: FRANJAS_META[k].color }} />
                    <span className="text-[10px] text-gray-500">{FRANJAS_META[k].label}</span>
                  </div>
                ))}
              </div>
            </div>
            <BarFranja data={g} />
          </div>

          {/* Tabla detalle */}
          {rows.length > 0 && agr !== 'global' && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  {agr === 'driver' ? <Truck size={14} className="text-slate-400" /> : <Package size={14} className="text-slate-400" />}
                  <p className="text-sm font-semibold text-gray-700">
                    {AGR_OPTS.find(o => o.id === agr)?.label}
                  </p>
                  <span className="text-[10px] text-gray-400">{rows.length} filas</span>
                </div>
                {(agr === 'driver' || agr === 'seller' || agr === 'ruta') && (
                  <input
                    type="text"
                    placeholder="Buscar…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="border border-gray-200 rounded-lg pl-3 pr-3 py-1.5 text-xs w-44 focus:outline-none focus:ring-1 focus:ring-amber-300"
                  />
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] text-gray-400 uppercase tracking-wide bg-gray-50 border-b border-gray-100">
                      <th className="px-4 py-2 text-left font-semibold">{AGR_OPTS.find(o => o.id === agr)?.label}</th>
                      <th className="px-3 py-2 text-center font-semibold">Total</th>
                      {FRANJA_KEYS.map(k => (
                        <th key={k} className="px-3 py-2 text-center font-semibold" style={{ color: FRANJAS_META[k].color }}>
                          {FRANJAS_META[k].label.split(' ')[0]}<br />
                          <span className="text-[9px] text-gray-400 font-normal">{FRANJAS_META[k].label.match(/\(.*?\)/)?.[0]}</span>
                        </th>
                      ))}
                      <th className="px-4 py-2 text-center font-semibold">Distribución</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {rows.map((row) => (
                      <tr key={row.key}
                        onClick={() => agr === 'driver' && row.key !== 'sin_driver' && navigate(`/admin/efectividad/driver/${row.key}?fecha_inicio=${fechaInicioIso}&fecha_fin=${fechaFinIso}`)}
                        className={`text-gray-700 transition-colors ${agr === 'driver' && row.key !== 'sin_driver' ? 'hover:bg-amber-50/40 cursor-pointer' : ''}`}
                      >
                        <td className="px-4 py-2.5 font-medium max-w-[200px] truncate">{row.label}</td>
                        <td className="px-3 py-2.5 text-center text-gray-500 font-semibold">{fmtN(row.total)}</td>
                        {FRANJA_KEYS.map(k => (
                          <td key={k} className="px-3 py-2.5 text-center">
                            <div className="text-[11px] font-bold" style={{ color: FRANJAS_META[k].color }}>{fmtPct(row[`pct_${k}`])}</div>
                            <div className="text-[9px] text-gray-400">{fmtN(row[k])}</div>
                          </td>
                        ))}
                        <td className="px-4 py-2.5 w-32">
                          <BarFranja data={row} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {agr === 'global' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {FRANJA_KEYS.filter(k => (g[k] ?? 0) > 0).map(k => {
                const m = FRANJAS_META[k]
                return (
                  <div key={k} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: m.color + '20' }}>
                      <TrendingUp size={20} style={{ color: m.color }} />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-bold text-gray-700">{m.label}</p>
                      <p className="text-[10px] text-gray-400">{m.desc}</p>
                      <div className="flex items-baseline gap-3 mt-1">
                        <span className="text-2xl font-black" style={{ color: m.color }}>
                          {fmtPct(g[`pct_${k}`])}
                        </span>
                        <span className="text-xs text-gray-400">{fmtN(g[k])} entregas</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <p className="text-[10px] text-gray-400 text-center">
            Rango: {data.rango.inicio} → {data.rango.fin} · Hora en tiempo local de Chile
          </p>
        </>
      )}
    </div>
  )
}
