import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api'
import PageHeader from '../../components/PageHeader'
import { TrendingUp, DollarSign, Clock, CheckCircle, AlertCircle, Users, ExternalLink, Wallet } from 'lucide-react'

const fmt = (n) => `$${(n || 0).toLocaleString('es-CL')}`
const now = new Date()

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

const ESTADO_CONFIG = {
  PAGADO:     { label: 'Pagado',     icon: CheckCircle,  cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  INCOMPLETO: { label: 'Incompleto', icon: AlertCircle,  cls: 'text-amber-700 bg-amber-50 border-amber-200' },
  PENDIENTE:  { label: 'Pendiente',  icon: Clock,        cls: 'text-gray-600 bg-gray-50 border-gray-200' },
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

export default function DriverGanancias() {
  const navigate = useNavigate()
  const [mes, setMes] = useState(now.getMonth() + 1)
  const [anio, setAnio] = useState(now.getFullYear())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.get('/portal/driver/ganancias', { params: { mes, anio } })
      .then(({ data: d }) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [mes, anio])

  const anios = [now.getFullYear(), now.getFullYear() - 1]

  // Agrupar semanas por semana (para jefe: filas por conductor bajo cada semana)
  const semanaGroups = {}
  if (data?.semanas) {
    data.semanas.forEach((s) => {
      if (!semanaGroups[s.semana]) semanaGroups[s.semana] = []
      semanaGroups[s.semana].push(s)
    })
  }

  const semanasOrdenadas = Object.keys(semanaGroups).map(Number).sort((a, b) => a - b)

  return (
    <div>
      <PageHeader
        title="Mis Ganancias"
        subtitle="Detalle de pagos por período"
        icon={Wallet}
        accent="green"
      />

      {/* Selector de período */}
      <div className="card mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Mes</label>
            <select
              className="input-field text-sm"
              value={mes}
              onChange={(e) => setMes(Number(e.target.value))}
            >
              {MESES.map((label, i) => (
                <option key={i + 1} value={i + 1}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Año</label>
            <select
              className="input-field text-sm"
              value={anio}
              onChange={(e) => setAnio(Number(e.target.value))}
            >
              {anios.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
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
          {/* Tarjetas resumen */}
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

          {/* Tabla semanal */}
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
                    {data.es_jefe && (
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Conductor</th>
                    )}
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Liquidado</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Pagado</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Progreso</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Estado</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600"></th>
                  </tr>
                </thead>
                <tbody>
                  {semanasOrdenadas.map((sem) => {
                    const filas = semanaGroups[sem]
                    return filas.map((fila, idx) => (
                      <tr
                        key={`${sem}-${fila.driver_id}`}
                        className={`border-b border-gray-100 hover:bg-gray-50 ${!fila.es_propio ? 'bg-blue-50/30' : ''}`}
                      >
                        {/* Celda semana solo en primera fila del grupo */}
                        {idx === 0 ? (
                          <td
                            className="px-4 py-3 font-semibold text-gray-800"
                            rowSpan={filas.length}
                          >
                            Sem {sem}
                          </td>
                        ) : null}

                        {data.es_jefe && (
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              {!fila.es_propio && (
                                <Users size={12} className="text-blue-500 flex-shrink-0" />
                              )}
                              <span className={`text-xs ${fila.es_propio ? 'font-medium text-gray-700' : 'text-blue-700'}`}>
                                {fila.es_propio ? `${fila.driver_nombre} (yo)` : fila.driver_nombre}
                              </span>
                            </div>
                          </td>
                        )}

                        <td className="px-4 py-3 text-right font-medium text-gray-800">
                          {fmt(fila.liquidado)}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-emerald-700">
                          {fila.pagado > 0 ? fmt(fila.pagado) : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-4 py-3 min-w-[100px]">
                          <ProgressBar pagado={fila.pagado} liquidado={fila.liquidado} />
                        </td>
                        <td className="px-4 py-3">
                          <EstadoBadge estado={fila.estado} />
                        </td>
                        <td className="px-4 py-3 text-center">
                          {fila.es_propio && (
                            <button
                              onClick={() => navigate(`/driver/liquidacion?semana=${sem}&mes=${mes}&anio=${anio}`)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                              title="Ver liquidación"
                            >
                              <ExternalLink size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Historial de pagos recibidos */}
          <div className="card p-0 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">
                Registro de pagos recibidos
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Transferencias individuales registradas por el administrador
              </p>
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
                      {data.es_jefe && (
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Conductor</th>
                      )}
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Semana</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Monto</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Origen</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Descripción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pagos.map((pago) => (
                      <tr
                        key={pago.id}
                        className={`border-b border-gray-100 hover:bg-gray-50 ${!pago.es_propio ? 'bg-blue-50/30' : ''}`}
                      >
                        <td className="px-4 py-3 text-gray-700">
                          {pago.fecha_pago
                            ? new Date(pago.fecha_pago + 'T12:00:00').toLocaleDateString('es-CL', {
                                day: '2-digit', month: 'short', year: 'numeric',
                              })
                            : <span className="text-gray-400">—</span>
                          }
                        </td>
                        {data.es_jefe && (
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              {!pago.es_propio && <Users size={12} className="text-blue-500" />}
                              <span className={`text-xs ${pago.es_propio ? 'font-medium text-gray-700' : 'text-blue-700'}`}>
                                {pago.es_propio ? `${pago.driver_nombre} (yo)` : pago.driver_nombre}
                              </span>
                            </div>
                          </td>
                        )}
                        <td className="px-4 py-3 text-gray-600">Sem {pago.semana}</td>
                        <td className="px-4 py-3 text-right font-semibold text-emerald-700">
                          {fmt(pago.monto)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            pago.fuente === 'cartola'
                              ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                              : 'bg-gray-100 text-gray-600 border border-gray-200'
                          }`}>
                            {pago.fuente === 'cartola' ? 'Planilla TEF' : 'Manual'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs max-w-[200px] truncate">
                          {pago.descripcion || <span className="text-gray-300">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 border-t-2 border-gray-200">
                      <td
                        className="px-4 py-3 font-semibold text-gray-700"
                        colSpan={data.es_jefe ? 3 : 2}
                      >
                        Total pagado
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-emerald-700">
                        {fmt(data.pagos.reduce((acc, p) => acc + p.monto, 0))}
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
