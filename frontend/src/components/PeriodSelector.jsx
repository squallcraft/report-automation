const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

export default function PeriodSelector({ semana, mes, anio, onChange }) {
  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i)

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Semana</label>
        <select
          value={semana}
          onChange={(e) => onChange({ semana: Number(e.target.value), mes, anio })}
          className="input-field w-24"
        >
          {[1, 2, 3, 4, 5].map((s) => (
            <option key={s} value={s}>Sem {s}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Mes</label>
        <select
          value={mes}
          onChange={(e) => onChange({ semana, mes: Number(e.target.value), anio })}
          className="input-field w-40"
        >
          {MESES.map((m, i) => (
            <option key={i + 1} value={i + 1}>{m}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Año</label>
        <select
          value={anio}
          onChange={(e) => onChange({ semana, mes, anio: Number(e.target.value) })}
          className="input-field w-28"
        >
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
