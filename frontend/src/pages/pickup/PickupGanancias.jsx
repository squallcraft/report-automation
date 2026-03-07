import { useState, useEffect } from 'react'
import api from '../../api'
import { TrendingUp, DollarSign, Clock, CheckCircle, AlertCircle } from 'lucide-react'

const fmt = (n) => `$${(n || 0).toLocaleString('es-CL')}`
const now = new Date()

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

const ESTADO_CONFIG = {
  PAGADO:     { label: 'Pagado',     icon: CheckCircle, cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  INCOMPLETO: { label: 'Incompleto', icon: AlertCircle, cls: 'text-amber-700 bg-amber-50 border-amber-200' },
  PENDIENTE:  { label: 'Pendiente',  icon: Clock,       cls: 'text-gray-600 bg-gray-50 border-gray-200' },
}

function EstadoBadge({ estado }) {
  const cfg = ESTADO_CONFIG[estado] || ESTADO_CONFIG.PENDIENTE
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.cls}`}>
      <Icon size={11} />
      {cfg.label}
    </span>
  )
}

function ProgressBar({ pagado, liquidado }) {
  const pct = liquidado > 0 ? Math.min(100, Math.round((pagado / liquidado) * 100)) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-amber-400' : 'bg-gray-300'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-gray-500 w-8 text-right">{pct}%</span>
    </div>
  )
}

export default function PickupGanancias() {
  const [mes, setMes] = useState(now.getMonth() + 1)
  const [anio, setAnio] = useState(now.getFullYear())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.get('/pickups/portal/ganancias', { params: { mes, anio } })
      .then(({ data: d }) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [mes, anio])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Mis Ganancias</h1>
        <p className="text-sm text-gray-500 mt-1">Resumen de lo liquidado y pagado por período</p>
      </div>

      <div className="card mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Mes</label>
            <select className="input-field text-sm" value={mes} onChange={e => setMes(+e.target.value)}>
              {MESES.map((label, i) => <option key={i + 1} value={i + 1}>{label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Año</label>
            <select className="input-field text-sm" value={anio} onChange={e => setAnio(+e.target.value)}>
              {[now.getFullYear(), now.getFullYear() - 1].map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400">Cargando...</div>
      ) : !data || !data.semanas || data.semanas.length === 0 ? (
        <div className="card text-center py-16 text-gray-400">
          No hay datos para {MESES[mes - 1]} {anio}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="card flex items-center gap-4">
              <div className="p-3 rounded-xl bg-blue-50">
                <TrendingUp size={20} className="text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Liquidado</p>
                <p className="text-xl font-bold text-gray-900">{fmt(data.resumen.total_liquidado)}</p>
              </div>
            </div>
            <div className="card flex items-center gap-4">
              <div className="p-3 rounded-xl bg-emerald-50">
                <DollarSign size={20} className="text-emerald-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Pagado</p>
                <p className="text-xl font-bold text-emerald-700">{fmt(data.resumen.total_pagado)}</p>
              </div>
            </div>
            <div className="card flex items-center gap-4">
              <div className="p-3 rounded-xl bg-amber-50">
                <Clock size={20} className="text-amber-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Pendiente</p>
                <p className="text-xl font-bold text-amber-700">{fmt(data.resumen.pendiente)}</p>
              </div>
            </div>
          </div>

          <div className="card mb-6 p-0 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">
                Desglose semanal — {MESES[mes - 1]} {anio}
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Semana</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Comisión</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Entregas</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Cargo envíos</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Liquidado</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Pagado</th>
                    <th className="px-4 py-3 font-medium text-gray-600">Progreso</th>
                    <th className="px-4 py-3 font-medium text-gray-600">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.semanas.map(s => (
                    <tr key={s.semana} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 font-semibold">Sem {s.semana}</td>
                      <td className="px-4 py-3 text-right text-emerald-700">{fmt(s.comision)}</td>
                      <td className="px-4 py-3 text-right">{s.ganancias_driver > 0 ? fmt(s.ganancias_driver) : '—'}</td>
                      <td className="px-4 py-3 text-right text-red-600">{s.cargo_seller > 0 ? `-${fmt(s.cargo_seller)}` : '—'}</td>
                      <td className="px-4 py-3 text-right font-medium">{fmt(s.liquidado)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-emerald-700">
                        {s.pagado > 0 ? fmt(s.pagado) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3 min-w-[100px]">
                        <ProgressBar pagado={s.pagado} liquidado={s.liquidado} />
                      </td>
                      <td className="px-4 py-3">
                        <EstadoBadge estado={s.estado} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 border-t-2 border-gray-200 font-semibold">
                    <td className="px-4 py-3">Total</td>
                    <td className="px-4 py-3 text-right text-emerald-700">
                      {fmt(data.semanas.reduce((a, s) => a + s.comision, 0))}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {fmt(data.semanas.reduce((a, s) => a + s.ganancias_driver, 0))}
                    </td>
                    <td className="px-4 py-3 text-right text-red-600">
                      {data.semanas.reduce((a, s) => a + s.cargo_seller, 0) > 0
                        ? `-${fmt(data.semanas.reduce((a, s) => a + s.cargo_seller, 0))}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">{fmt(data.resumen.total_liquidado)}</td>
                    <td className="px-4 py-3 text-right text-emerald-700">{fmt(data.resumen.total_pagado)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="card p-0 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">Registro de pagos recibidos</h2>
              <p className="text-xs text-gray-400 mt-0.5">Transferencias registradas por el administrador</p>
            </div>
            {data.pagos.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-gray-400">
                No hay pagos registrados para este período
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Fecha</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Semana</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Monto</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Origen</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Descripción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pagos.map(p => (
                      <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3">
                          {p.fecha_pago
                            ? new Date(p.fecha_pago + 'T12:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })
                            : '—'}
                        </td>
                        <td className="px-4 py-3">Sem {p.semana}</td>
                        <td className="px-4 py-3 text-right font-semibold text-emerald-700">{fmt(p.monto)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                            p.fuente === 'cartola'
                              ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                              : 'bg-gray-100 text-gray-600 border border-gray-200'
                          }`}>
                            {p.fuente === 'cartola' ? 'Planilla TEF' : 'Manual'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs max-w-[200px] truncate">
                          {p.descripcion || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 border-t-2 border-gray-200">
                      <td className="px-4 py-3 font-semibold text-gray-700" colSpan={2}>Total pagado</td>
                      <td className="px-4 py-3 text-right font-bold text-emerald-700">
                        {fmt(data.pagos.reduce((a, p) => a + p.monto, 0))}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
