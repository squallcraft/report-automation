/**
 * CalendarHeatmap — visualiza un set de días con KPIs.
 *
 * Layout: filas = semanas, columnas = días (Lun-Vie).
 *
 * Props:
 *   - data: array de objetos `{ fecha, a_ruta, entregados, same_day, pct_same_day, pct_delivery_success }`.
 *   - valueKey: clave del campo numérico que determina el color (default: 'pct_same_day').
 *   - showSameDayDetail: bool — cuando true, muestra efectividad como métrica principal
 *     y agrega SD% debajo. Útil para el calendario global de EfectividadEntregas.
 *   - emptyLabel: string a mostrar cuando data está vacío.
 */
import { useMemo } from 'react'

const colorByEfectividad = (v, isEmpty) => {
  if (isEmpty || v == null) return 'bg-gray-100 text-gray-300'
  if (v >= 95) return 'bg-emerald-600 text-white'
  if (v >= 85) return 'bg-emerald-500 text-white'
  if (v >= 70) return 'bg-emerald-400 text-white'
  if (v >= 55) return 'bg-amber-400 text-white'
  if (v >= 40) return 'bg-orange-400 text-white'
  return 'bg-red-400 text-white'
}

const colorBySameDay = (v, isEmpty) => {
  if (isEmpty || v == null) return 'bg-gray-100 text-gray-300'
  if (v >= 90) return 'bg-emerald-600 text-white'
  if (v >= 75) return 'bg-emerald-500 text-white'
  if (v >= 60) return 'bg-emerald-400 text-white'
  if (v >= 45) return 'bg-amber-400 text-white'
  if (v >= 30) return 'bg-orange-400 text-white'
  return 'bg-red-400 text-white'
}

export default function CalendarHeatmap({
  data = [],
  emptyLabel = 'Sin datos en el rango',
  valueKey = 'pct_same_day',
  showSameDayDetail = false,
}) {
  const weeks = useMemo(() => {
    if (!data?.length) return []
    const byKey = {}
    data.forEach(d => { byKey[d.fecha] = d })

    const fechas = data.map(d => new Date(d.fecha + 'T00:00:00')).sort((a, b) => a - b)
    const fmin = fechas[0]
    const fmax = fechas[fechas.length - 1]

    const start = new Date(fmin)
    while (start.getDay() !== 1) start.setDate(start.getDate() - 1)
    const end = new Date(fmax)
    while (end.getDay() !== 0) end.setDate(end.getDate() + 1)

    const out = []
    const cursor = new Date(start)
    while (cursor <= end) {
      const week = []
      for (let i = 0; i < 7; i++) {
        const yyyy = cursor.getFullYear()
        const mm = String(cursor.getMonth() + 1).padStart(2, '0')
        const dd = String(cursor.getDate()).padStart(2, '0')
        const dateStr = `${yyyy}-${mm}-${dd}`
        week.push({ fecha: dateStr, date: new Date(cursor), data: byKey[dateStr] || null })
        cursor.setDate(cursor.getDate() + 1)
      }
      out.push(week)
    }
    return out
  }, [data])

  if (!weeks.length) {
    return <p className="text-center text-xs text-gray-400 py-8">{emptyLabel}</p>
  }

  const workdayIdx = [0, 1, 2, 3, 4]
  const dayLabels = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes']

  return (
    <div>
      <div className="overflow-x-auto pb-2">
        <table className="border-separate w-full" style={{ borderSpacing: '6px' }}>
          <thead>
            <tr>
              <th className="text-[10px] text-gray-400 font-semibold pr-3 text-right" style={{ width: '88px' }} />
              {dayLabels.map(d => (
                <th key={d} className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide pb-1 text-center min-w-[90px]">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, wi) => (
              <tr key={wi}>
                <td className="text-[11px] text-gray-500 font-semibold pr-3 text-right whitespace-nowrap">
                  Semana {wi + 1}
                </td>
                {workdayIdx.map(di => {
                  const cell = week[di]
                  if (!cell) return <td key={di} />
                  const isEmpty = !cell.data

                  if (showSameDayDetail) {
                    const ef  = cell.data?.pct_delivery_success ?? null
                    const sd  = cell.data?.pct_same_day ?? null
                    const ent = cell.data?.entregados ?? 0
                    const ar  = cell.data?.a_ruta ?? 0
                    const cls = colorByEfectividad(ef, isEmpty)
                    return (
                      <td key={di} className="p-0">
                        <div
                          className={`h-[72px] w-full rounded-lg flex flex-col items-center justify-center gap-0 transition-transform hover:scale-105 cursor-default px-1 ${cls}`}
                          title={isEmpty ? `${cell.fecha} · sin actividad` : `${cell.fecha} · Efectividad ${ef}% · Same-Day ${sd}%`}
                        >
                          {!isEmpty ? (
                            <>
                              <span className="text-[13px] font-black leading-tight tracking-tight">
                                {ent}/{ar}
                              </span>
                              <span className="text-[17px] font-black leading-tight">
                                {ef ?? '—'}%
                              </span>
                              <span className="text-[10px] font-semibold leading-tight opacity-75 mt-0.5">
                                SD&nbsp;{sd ?? '—'}%
                              </span>
                            </>
                          ) : (
                            <span className="text-[10px] text-gray-300">—</span>
                          )}
                        </div>
                      </td>
                    )
                  }

                  // Modo estándar (same-day o valueKey genérico)
                  const cls = colorBySameDay(cell.data?.[valueKey], isEmpty)
                  const sdN = cell.data?.same_day ?? cell.data?.entregados ?? 0
                  const ar  = cell.data?.a_ruta ?? 0
                  const pct = cell.data?.[valueKey] ?? 0
                  return (
                    <td key={di} className="p-0">
                      <div
                        className={`h-14 w-full rounded-lg flex flex-col items-center justify-center transition-transform hover:scale-105 cursor-default ${cls}`}
                        title={isEmpty ? `${cell.fecha} · sin actividad` : `${cell.fecha} · ${sdN}/${ar} (${pct}%)`}
                      >
                        {!isEmpty ? (
                          <>
                            <span className="text-[14px] font-black leading-none">{sdN}/{ar}</span>
                            <span className="text-[10px] opacity-90 leading-none mt-1">{pct}%</span>
                          </>
                        ) : (
                          <span className="text-[10px] text-gray-300">—</span>
                        )}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Leyenda */}
      <div className="mt-3 flex items-center justify-center gap-2 text-[10px] text-gray-500 flex-wrap">
        <span>Bajo</span>
        <div className="w-4 h-4 rounded-sm bg-red-400" />
        <div className="w-4 h-4 rounded-sm bg-orange-400" />
        <div className="w-4 h-4 rounded-sm bg-amber-400" />
        <div className="w-4 h-4 rounded-sm bg-emerald-400" />
        <div className="w-4 h-4 rounded-sm bg-emerald-500" />
        <div className="w-4 h-4 rounded-sm bg-emerald-600" />
        {showSameDayDetail
          ? <span>Alto · <b>Entregados / A ruta</b> · % efectividad · SD = same-day</span>
          : <span>Alto · Cada celda muestra <b>same-day / a-ruta</b></span>
        }
      </div>
    </div>
  )
}
