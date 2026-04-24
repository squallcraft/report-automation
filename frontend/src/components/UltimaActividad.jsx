import { useState, useEffect } from 'react'
import { Clock, ChevronDown, ChevronUp, CheckCircle, Upload } from 'lucide-react'
import api from '../api'

const ACCION_LABELS = {
  pago_manual_driver: 'Pago marcado',
  pago_manual_seller: 'Cobro marcado',
  pago_manual_pickup: 'Pago marcado',
  carga_cartola_driver: 'Cartola cargada',
  carga_cartola_seller: 'Cartola cargada',
  carga_cartola_pickup: 'Cartola cargada',
  importar_bancaria_driver: 'Bancaria importada',
}

function fmt(iso) {
  if (!iso) return '—'
  // Backend returns timestamps without timezone suffix — treat as UTC
  const utcIso = iso.includes('Z') || iso.includes('+') ? iso : iso + 'Z'
  const d = new Date(utcIso)
  const parts = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${p.day}/${p.month} ${p.hour}:${p.minute}`
}

export default function UltimaActividad({ endpoint, mes, anio }) {
  const [logs, setLogs] = useState(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!mes || !anio) return
    setLogs(null)
    setLoading(true)
    api.get(`${endpoint}?mes=${mes}&anio=${anio}`)
      .then(r => setLogs(r.data))
      .catch(() => setLogs([]))
      .finally(() => setLoading(false))
  }, [endpoint, mes, anio])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400 py-1.5">
        <Clock size={13} className="animate-pulse" />
        <span>Cargando actividad...</span>
      </div>
    )
  }

  if (!logs || logs.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400 py-1.5">
        <Clock size={13} />
        <span>Sin actividad registrada para este período</span>
      </div>
    )
  }

  const last = logs[0]

  return (
    <div className="text-xs">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-gray-500 hover:text-gray-700 transition-colors py-1"
      >
        <Clock size={13} className="text-gray-400 flex-shrink-0" />
        <span>
          Última actualización:{' '}
          <span className="font-medium text-gray-700">{fmt(last.timestamp)}</span>
          {' — '}por <span className="font-semibold text-indigo-600">{last.usuario || '—'}</span>
          {last.nombre && (
            <>
              {' — '}
              <span className="text-gray-600">{ACCION_LABELS[last.accion] || last.accion}: </span>
              <span className="font-medium">{last.nombre}</span>
              {last.semana && <span className="text-gray-400"> (Sem {last.semana})</span>}
            </>
          )}
        </span>
        {logs.length > 1 && (
          open ? <ChevronUp size={13} /> : <ChevronDown size={13} />
        )}
      </button>

      {open && logs.length > 1 && (
        <ul className="mt-1 ml-5 space-y-0.5 border-l-2 border-gray-100 pl-3">
          {logs.map(log => (
            <li key={log.id} className="flex items-center gap-2 text-gray-500">
              {log.estado === 'PAGADO' ? (
                <CheckCircle size={11} className="text-green-500 flex-shrink-0" />
              ) : (
                <Upload size={11} className="text-blue-400 flex-shrink-0" />
              )}
              <span className="text-gray-400">{fmt(log.timestamp)}</span>
              <span className="font-medium text-indigo-600">{log.usuario || '—'}</span>
              <span>{ACCION_LABELS[log.accion] || log.accion}</span>
              {log.nombre && <span className="font-medium text-gray-700">{log.nombre}</span>}
              {log.semana && <span className="text-gray-400">Sem {log.semana}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
