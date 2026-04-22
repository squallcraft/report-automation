/**
 * CalendarHeatmap — visualiza un set de días con KPI de % same-day.
 *
 * Layout: filas = semanas, columnas = días (Lun-Vie).
 * Cada celda muestra "same_day / a_ruta" y se colorea por % same-day.
 *
 * Props:
 *   - data: array de objetos `{ fecha: 'YYYY-MM-DD', a_ruta, same_day, pct_same_day }`.
 *           Acepta también la forma usada por driver drill-down: `{ fecha, label, a_ruta, same_day, pct_same_day }`.
 *   - emptyLabel: string a mostrar cuando data está vacío.
 */
import { useMemo } from 'react'

const colorClass = (v, isEmpty) => {
  if (isEmpty) return 'bg-gray-100 text-gray-300'
  if (v == null) return 'bg-gray-100 text-gray-300'
  if (v >= 90) return 'bg-emerald-600 text-white'
  if (v >= 75) return 'bg-emerald-500 text-white'
  if (v >= 60) return 'bg-emerald-400 text-white'
  if (v >= 45) return 'bg-amber-400 text-white'
  if (v >= 30) return 'bg-orange-400 text-white'
  return 'bg-red-400 text-white'
}

export default function CalendarHeatmap({ data = [], emptyLabel = 'Sin datos en el rango' }) {
  const weeks = useMemo(() => {
    if (!data?.length) return []
    const byKey = {}
    data.forEach(d => { byKey[d.fecha] = d })

    const fechas = data.map(d => new Date(d.fecha + 'T00:00:00')).sort((a, b) => a - b)
    const fmin = fechas[0]
    const fmax = fechas[fechas.length - 1]

    // Primer lunes <= fmin
    const start = new Date(fmin)
    while (start.getDay() !== 1) start.setDate(start.getDate() - 1)
    // Domingo final >= fmax
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
        week.push({
          fecha: dateStr,
          date: new Date(cursor),
          data: byKey[dateStr] || null,
        })
        cursor.setDate(cursor.getDate() + 1)
      }
      out.push(week)
    }
    return out
  }, [data])

  if (!weeks.length) {
    return <p className="text-center text-xs text-gray-400 py-8">{emptyLabel}</p>
  }

  // Solo Lun-Vie: índices 0..4 dentro de la semana (start = lunes).
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
                <th key={d} className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide pb-1 text-center min-w-[78px]">
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
                  const cls = colorClass(cell.data?.pct_same_day, isEmpty)
                  // Soporta tanto la forma del global (a_ruta, same_day) como
                  // la del driver (label = "X/Y", same_day, a_ruta).
                  const sd = cell.data?.same_day ?? 0
                  const ar = cell.data?.a_ruta ?? 0
                  return (
                    <td key={di} className="p-0">
                      <div
                        className={`h-14 w-full rounded-lg flex flex-col items-center justify-center transition-transform hover:scale-105 cursor-default ${cls}`}
                        title={isEmpty
                          ? `${cell.fecha} · sin actividad`
                          : `${cell.fecha} · ${sd} same-day de ${ar} a ruta (${cell.data.pct_same_day}%)`
                        }
                      >
                        {!isEmpty ? (
                          <>
                            <span className="text-[14px] font-black leading-none">
                              {sd}/{ar}
                            </span>
                            <span className="text-[10px] opacity-90 leading-none mt-1">{cell.data.pct_same_day}%</span>
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
        <span>Alto · Cada celda muestra <b>same-day / a-ruta</b></span>
      </div>
    </div>
  )
}
