import { useState, useEffect, useRef, useMemo } from 'react'
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * DateRangePicker custom (sin libs externas).
 *
 * Props:
 *   value:    { inicio: Date, fin: Date }
 *   onChange: (range: { inicio: Date, fin: Date }) => void
 *   minDate?: Date (default: hace 2 años)
 *   maxDate?: Date (default: hoy)
 *
 * Permite presets (Hoy, Ayer, 7d, 30d, mes en curso, mes anterior) y
 * selección de rango con calendario visual de 2 meses lado a lado.
 */

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const MESES_CORTOS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
const DIAS = ['L','M','M','J','V','S','D']

const startOfDay = (d) => {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
const sameDay = (a, b) => a && b && startOfDay(a).getTime() === startOfDay(b).getTime()
const fmt = (d) => `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getFullYear()}`
const isoLocal = (d) => `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`

export const toIsoLocal = isoLocal

function buildPresets(today = new Date()) {
  const t = startOfDay(today)
  const ayer = new Date(t); ayer.setDate(t.getDate() - 1)
  const hace7 = new Date(t); hace7.setDate(t.getDate() - 6)
  const hace30 = new Date(t); hace30.setDate(t.getDate() - 29)
  const inicioMes = new Date(t.getFullYear(), t.getMonth(), 1)
  const finMes = new Date(t.getFullYear(), t.getMonth() + 1, 0)
  const inicioMesPrev = new Date(t.getFullYear(), t.getMonth() - 1, 1)
  const finMesPrev = new Date(t.getFullYear(), t.getMonth(), 0)
  return [
    { id: 'hoy',     label: 'Hoy',           inicio: t,    fin: t },
    { id: 'ayer',    label: 'Ayer',          inicio: ayer, fin: ayer },
    { id: '7d',      label: 'Últimos 7 días', inicio: hace7,  fin: t },
    { id: '30d',     label: 'Últimos 30 días',inicio: hace30, fin: t },
    { id: 'mes',     label: 'Este mes',      inicio: inicioMes, fin: t },
    { id: 'mes_full',label: 'Mes en curso',  inicio: inicioMes, fin: finMes },
    { id: 'mes_prev',label: 'Mes anterior',  inicio: inicioMesPrev, fin: finMesPrev },
  ]
}

function MonthGrid({ year, month, hover, onHover, onClick, range, minDate, maxDate }) {
  const first = new Date(year, month, 1)
  const last = new Date(year, month + 1, 0)
  const startDow = (first.getDay() + 6) % 7
  const cells = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let d = 1; d <= last.getDate(); d++) cells.push(new Date(year, month, d))
  while (cells.length % 7) cells.push(null)

  const inHoverRange = (d) => {
    if (!range.inicio || range.fin || !hover) return false
    const a = startOfDay(range.inicio).getTime()
    const b = startOfDay(hover).getTime()
    const t = startOfDay(d).getTime()
    return (t >= Math.min(a, b) && t <= Math.max(a, b))
  }
  const inFinalRange = (d) => {
    if (!range.inicio || !range.fin) return false
    const a = startOfDay(range.inicio).getTime()
    const b = startOfDay(range.fin).getTime()
    const t = startOfDay(d).getTime()
    return t >= a && t <= b
  }
  const isDisabled = (d) => {
    if (minDate && d < startOfDay(minDate)) return true
    if (maxDate && d > startOfDay(maxDate)) return true
    return false
  }

  return (
    <div className="select-none">
      <p className="text-xs font-bold text-gray-700 text-center mb-2">{MESES[month]} {year}</p>
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {DIAS.map((d, i) => (
          <div key={i} className="text-[10px] text-gray-400 text-center font-semibold">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d, i) => {
          if (!d) return <div key={i} className="h-7" />
          const disabled = isDisabled(d)
          const isStart = sameDay(d, range.inicio)
          const isEnd = sameDay(d, range.fin)
          const inFinal = inFinalRange(d)
          const inHover = inHoverRange(d)
          const inAny = inFinal || inHover
          let cls = 'h-7 text-[11px] flex items-center justify-center rounded transition-colors '
          if (disabled) cls += 'text-gray-300 cursor-not-allowed '
          else if (isStart || isEnd) cls += 'bg-blue-600 text-white font-bold cursor-pointer '
          else if (inAny) cls += 'bg-blue-100 text-blue-700 cursor-pointer '
          else cls += 'text-gray-600 hover:bg-gray-100 cursor-pointer '
          return (
            <div
              key={i}
              className={cls}
              onMouseEnter={() => !disabled && onHover(d)}
              onClick={() => !disabled && onClick(d)}
            >
              {d.getDate()}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function DateRangePicker({ value, onChange, minDate, maxDate }) {
  const today = useMemo(() => startOfDay(new Date()), [])
  const max = maxDate || today
  const min = minDate || (() => { const d = new Date(today); d.setFullYear(d.getFullYear() - 2); return d })()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({ inicio: value?.inicio || null, fin: value?.fin || null })
  const [hover, setHover] = useState(null)
  const initRef = value?.inicio || today
  const [view, setView] = useState({ year: initRef.getFullYear(), month: initRef.getMonth() })
  const wrapRef = useRef(null)

  useEffect(() => {
    setDraft({ inicio: value?.inicio || null, fin: value?.fin || null })
  }, [value])

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const presets = useMemo(() => buildPresets(today), [today])

  const handleClickDay = (d) => {
    if (!draft.inicio || (draft.inicio && draft.fin)) {
      setDraft({ inicio: d, fin: null })
      setHover(null)
    } else {
      const a = draft.inicio
      const b = d
      const inicio = a <= b ? a : b
      const fin = a <= b ? b : a
      const newRange = { inicio, fin }
      setDraft(newRange)
      setHover(null)
      onChange?.(newRange)
      setOpen(false)
    }
  }

  const handlePreset = (p) => {
    const newRange = { inicio: p.inicio, fin: p.fin }
    setDraft(newRange)
    onChange?.(newRange)
    setOpen(false)
  }

  const prevMonth = () => {
    const m = view.month - 1
    if (m < 0) setView({ year: view.year - 1, month: 11 })
    else setView({ ...view, month: m })
  }
  const nextMonth = () => {
    const m = view.month + 1
    if (m > 11) setView({ year: view.year + 1, month: 0 })
    else setView({ ...view, month: m })
  }

  const rightView = useMemo(() => {
    const m = view.month + 1
    return m > 11 ? { year: view.year + 1, month: 0 } : { year: view.year, month: m }
  }, [view])

  const label = value?.inicio && value?.fin
    ? sameDay(value.inicio, value.fin)
      ? fmt(value.inicio)
      : `${fmt(value.inicio)} → ${fmt(value.fin)}`
    : 'Seleccionar rango'

  const matchedPreset = presets.find(p => sameDay(p.inicio, value?.inicio) && sameDay(p.fin, value?.fin))

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 border border-slate-600 rounded-lg px-3 py-1.5 text-xs bg-slate-800 text-slate-200 hover:bg-slate-700 transition-colors"
      >
        <Calendar size={13} />
        <span>{matchedPreset?.label || label}</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 z-50 bg-white rounded-xl shadow-2xl border border-gray-200 flex text-gray-700"
             style={{ width: 'min(720px, 95vw)' }}>
          <div className="border-r border-gray-100 p-2 w-32 flex-shrink-0">
            {presets.map(p => {
              const active = sameDay(p.inicio, draft.inicio) && sameDay(p.fin, draft.fin)
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handlePreset(p)}
                  className={`w-full text-left text-[11px] px-2 py-1.5 rounded mb-0.5 transition-colors ${
                    active ? 'bg-blue-50 text-blue-700 font-semibold' : 'hover:bg-gray-50 text-gray-600'
                  }`}
                >
                  {p.label}
                </button>
              )
            })}
          </div>
          <div className="p-3 flex-1">
            <div className="flex items-center justify-between mb-2">
              <button type="button" onClick={prevMonth} className="p-1 hover:bg-gray-100 rounded">
                <ChevronLeft size={14} className="text-gray-500" />
              </button>
              <div className="text-[10px] text-gray-400">
                {draft.inicio ? `Inicio: ${fmt(draft.inicio)}` : 'Selecciona inicio'}
                {draft.fin ? ` · Fin: ${fmt(draft.fin)}` : draft.inicio ? ' · selecciona fin' : ''}
              </div>
              <button type="button" onClick={nextMonth} className="p-1 hover:bg-gray-100 rounded">
                <ChevronRight size={14} className="text-gray-500" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <MonthGrid
                year={view.year} month={view.month}
                hover={hover} onHover={setHover}
                onClick={handleClickDay}
                range={draft} minDate={min} maxDate={max}
              />
              <MonthGrid
                year={rightView.year} month={rightView.month}
                hover={hover} onHover={setHover}
                onClick={handleClickDay}
                range={draft} minDate={min} maxDate={max}
              />
            </div>
            <div className="flex items-center justify-end gap-2 mt-3 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => { setDraft({ inicio: null, fin: null }); setHover(null) }}
                className="text-[11px] text-gray-500 px-2 py-1 hover:bg-gray-50 rounded"
              >
                Limpiar
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-[11px] text-gray-600 px-3 py-1 border border-gray-200 rounded hover:bg-gray-50"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
