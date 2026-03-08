export const IVA_RATE = 0.19

export const fmt = (n) => `$${(n || 0).toLocaleString('es-CL')}`

export const fmtClp = (n) => (n ?? 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP' })

export const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

const now = new Date()

export const getYearOptions = (range = 5) =>
  Array.from({ length: range }, (_, i) => now.getFullYear() - 2 + i)

export const fmtDate = (d) => {
  if (!d) return '—'
  const date = new Date(d + 'T12:00:00')
  return date.toLocaleDateString('es-CL')
}

export const fmtDateLong = (d) => {
  if (!d) return '—'
  const date = new Date(d + 'T12:00:00')
  return date.toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short' })
}
