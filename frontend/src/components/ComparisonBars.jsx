/**
 * ComparisonBars — visualiza 3 métricas del conductor vs zona vs global.
 *
 * Props:
 *   - data: { driver, zona_kpis, global } — objetos con { efectividad, pct_pm_ideal, entregas_por_hora }
 *   - zona: string — nombre de la zona del conductor
 *   - loading: bool
 */
const METRICS = [
  {
    key: 'efectividad',
    label: '% Efectividad',
    unit: '%',
    max: 100,
    description: 'Paquetes entregados sobre paquetes a ruta',
    thresholds: { good: 90, mid: 75 },
  },
  {
    key: 'pct_pm_ideal',
    label: 'PM Ideal (16–21 h)',
    unit: '%',
    max: 100,
    description: '% entregas en franja óptima 15:00–21:00',
    thresholds: { good: 60, mid: 40 },
  },
  {
    key: 'entregas_por_hora',
    label: 'Entregas / hora',
    unit: '',
    max: null,
    description: 'Promedio de entregas por hora trabajada en ruta',
    thresholds: { good: 3.5, mid: 2.5 },
  },
]

function Bar({ value, max, color }) {
  const pct = max ? Math.min(100, (value / max) * 100) : Math.min(100, (value / 8) * 100)
  return (
    <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function colorForValue(value, thresholds) {
  if (value == null) return { bar: 'bg-gray-300', text: 'text-gray-400' }
  if (value >= thresholds.good) return { bar: 'bg-emerald-500', text: 'text-emerald-600' }
  if (value >= thresholds.mid)  return { bar: 'bg-amber-400',   text: 'text-amber-600' }
  return { bar: 'bg-red-400', text: 'text-red-600' }
}

export default function ComparisonBars({ data, zona, loading = false }) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
        <p className="text-sm font-semibold text-gray-700 mb-4">Comparación con zona y operación</p>
        <div className="space-y-5 animate-pulse">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-10 bg-gray-100 rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  if (!data) return null

  const rows = [
    { src: 'driver',    label: 'Conductor',        dot: 'bg-indigo-500' },
    { src: 'zona_kpis', label: zona || 'Zona',     dot: 'bg-blue-400' },
    { src: 'global',    label: 'Operación global', dot: 'bg-slate-400' },
  ]

  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
      <p className="text-sm font-semibold text-gray-700 mb-1">Comparación con zona y operación</p>
      <p className="text-[10px] text-gray-400 mb-4">Período seleccionado · {zona || 'Sin zona asignada'}</p>

      <div className="space-y-5">
        {METRICS.map(metric => {
          const vals = rows.map(r => ({ ...r, value: data[r.src]?.[metric.key] }))
          const maxVal = Math.max(...vals.map(v => v.value ?? 0)) || 1

          return (
            <div key={metric.key}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-700">{metric.label}</p>
                <p className="text-[10px] text-gray-400">{metric.description}</p>
              </div>
              <div className="space-y-2">
                {vals.map(({ src, label, dot, value }) => {
                  const cls = colorForValue(value, metric.thresholds)
                  const display = value != null
                    ? metric.unit === '%'
                      ? `${value}%`
                      : value.toFixed(1)
                    : '—'
                  return (
                    <div key={src} className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5 w-28 shrink-0">
                        <span className={`w-2 h-2 rounded-full ${dot}`} />
                        <span className="text-[11px] text-gray-500 font-medium truncate">{label}</span>
                      </div>
                      <Bar
                        value={value ?? 0}
                        max={metric.max ?? maxVal * 1.2}
                        color={cls.bar}
                      />
                      <span className={`text-xs font-black w-12 text-right ${cls.text}`}>
                        {display}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
