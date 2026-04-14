import { useState, useEffect } from 'react'
import api from '../../api'
import PageHeader from '../../components/PageHeader'
import { ChevronLeft, ChevronRight, Package, DollarSign, CalendarDays } from 'lucide-react'
import { fmt, MESES } from '../../utils/format'

const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

// Día de la semana del 1ro del mes (0=Lun … 6=Dom)
function primerDiaSemana(anio, mes) {
  const d = new Date(anio, mes - 1, 1).getDay() // 0=Dom
  return d === 0 ? 6 : d - 1
}

function DiaDot({ comision }) {
  if (comision <= 0) return null
  return <span className="block w-1.5 h-1.5 rounded-full bg-emerald-400 mx-auto mt-0.5" />
}

export default function PickupCalendario() {
  const hoy = new Date()
  const [mes, setMes] = useState(hoy.getMonth() + 1)
  const [anio, setAnio] = useState(hoy.getFullYear())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [diaSeleccionado, setDiaSeleccionado] = useState(null)

  useEffect(() => {
    setLoading(true)
    setDiaSeleccionado(null)
    api.get('/pickups/portal/calendario', { params: { mes, anio } })
      .then(({ data: d }) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [mes, anio])

  function navMes(delta) {
    let m = mes + delta
    let a = anio
    if (m < 1) { m = 12; a-- }
    if (m > 12) { m = 1; a++ }
    // Retroactivo desde ene 2026
    if (a < 2026 || (a === 2026 && m < 1)) return
    setMes(m)
    setAnio(a)
  }

  const diasMap = {}
  if (data?.dias) {
    data.dias.forEach(d => { diasMap[d.fecha] = d })
  }

  const offsetInicio = data ? primerDiaSemana(anio, mes) : 0
  const totalDias = data?.dias?.length || 0
  const celdas = offsetInicio + totalDias
  const filas = Math.ceil(celdas / 7)

  const diaInfo = diaSeleccionado ? diasMap[diaSeleccionado] : null

  return (
    <div>
      <PageHeader
        title="Mi Calendario"
        subtitle="Calendario de recepciones"
        icon={CalendarDays}
        accent="blue"
      />

      {/* Navegación mes */}
      <div className="card mb-4 sm:mb-6">
        <div className="flex items-center justify-between">
          <button
            onClick={() => navMes(-1)}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="text-center">
            <p className="text-base sm:text-lg font-bold text-gray-900">
              {MESES[mes - 1]} {anio}
            </p>
            {data && (
              <p className="text-xs text-gray-500">
                {data.resumen.total_paquetes} paquetes · {fmt(data.resumen.total_comision)} comisión
              </p>
            )}
          </div>
          <button
            onClick={() => navMes(1)}
            disabled={anio === hoy.getFullYear() && mes === hoy.getMonth() + 1}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-600 transition-colors disabled:opacity-30"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </div>

      {/* Resumen del mes */}
      {data && (
        <div className="grid grid-cols-2 gap-3 mb-4 sm:mb-6">
          <div className="card flex items-center gap-3 p-3 sm:p-4">
            <div className="p-2 rounded-xl bg-blue-50 hidden sm:block">
              <Package size={18} className="text-blue-600" />
            </div>
            <div>
              <p className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-wide">Paquetes recibidos</p>
              <p className="text-lg sm:text-2xl font-bold text-gray-900">{data.resumen.total_paquetes}</p>
            </div>
          </div>
          <div className="card flex items-center gap-3 p-3 sm:p-4">
            <div className="p-2 rounded-xl bg-emerald-50 hidden sm:block">
              <DollarSign size={18} className="text-emerald-600" />
            </div>
            <div>
              <p className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-wide">Comisión del mes</p>
              <p className="text-lg sm:text-2xl font-bold text-emerald-700">{fmt(data.resumen.total_comision)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Calendario */}
      {loading ? (
        <div className="card text-center py-16 text-gray-400">Cargando...</div>
      ) : !data ? (
        <div className="card text-center py-16 text-gray-400">No hay datos disponibles</div>
      ) : (
        <div className="card p-3 sm:p-5">
          {/* Cabecera días */}
          <div className="grid grid-cols-7 mb-2">
            {DIAS_SEMANA.map(d => (
              <div key={d} className="text-center text-[10px] sm:text-xs font-semibold text-gray-400 uppercase py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Celdas */}
          <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
            {Array.from({ length: filas * 7 }).map((_, i) => {
              const diaNum = i - offsetInicio + 1
              if (diaNum < 1 || diaNum > totalDias) {
                return <div key={i} className="aspect-square" />
              }
              const fechaStr = `${anio}-${String(mes).padStart(2, '0')}-${String(diaNum).padStart(2, '0')}`
              const info = diasMap[fechaStr]
              const tieneData = info && info.paquetes > 0
              const esHoy = fechaStr === hoy.toISOString().slice(0, 10)
              const seleccionado = fechaStr === diaSeleccionado

              return (
                <button
                  key={i}
                  onClick={() => setDiaSeleccionado(seleccionado ? null : fechaStr)}
                  className={`
                    aspect-square rounded-lg flex flex-col items-center justify-center p-0.5 transition-all text-center
                    ${tieneData ? 'cursor-pointer hover:scale-105' : 'cursor-default'}
                    ${seleccionado ? 'ring-2 ring-emerald-500 bg-emerald-50' : tieneData ? 'bg-emerald-50 hover:bg-emerald-100' : 'bg-gray-50'}
                    ${esHoy && !seleccionado ? 'ring-2 ring-blue-400' : ''}
                  `}
                >
                  <span className={`text-xs sm:text-sm font-semibold leading-tight ${tieneData ? 'text-emerald-800' : 'text-gray-400'}`}>
                    {diaNum}
                  </span>
                  {tieneData && (
                    <>
                      <span className="text-[8px] sm:text-[10px] font-bold text-emerald-700 leading-tight">
                        {info.paquetes} pkg
                      </span>
                      <DiaDot comision={info.comision} />
                    </>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Panel detalle día seleccionado */}
      {diaInfo && (
        <div className="card mt-4 p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">
                {new Date(diaSeleccionado + 'T12:00:00').toLocaleDateString('es-CL', {
                  weekday: 'long', day: 'numeric', month: 'long',
                })}
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {diaInfo.paquetes} paquete{diaInfo.paquetes !== 1 ? 's' : ''} · {fmt(diaInfo.comision)} comisión
              </p>
            </div>
            <button onClick={() => setDiaSeleccionado(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
          </div>
          {diaInfo.detalle.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-400">Sin recepciones este día</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-4 py-2 font-medium text-gray-600">Pedido</th>
                    <th className="text-left px-4 py-2 font-medium text-gray-600 hidden sm:table-cell">Tipo</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-600">Comisión</th>
                  </tr>
                </thead>
                <tbody>
                  {diaInfo.detalle.map((r, idx) => (
                    <tr key={idx} className={`border-b border-gray-50 ${r.excluido ? 'opacity-40' : ''}`}>
                      <td className="px-4 py-2 font-mono text-xs">{r.pedido}</td>
                      <td className="px-4 py-2 text-gray-500 hidden sm:table-cell">{r.tipo || '—'}</td>
                      <td className="px-4 py-2 text-right">
                        {r.excluido
                          ? <span className="text-gray-400 text-[10px]">excluido</span>
                          : <span className="text-emerald-700 font-medium">{fmt(r.comision)}</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 border-t-2 border-gray-200 font-semibold">
                    <td className="px-4 py-2" colSpan={2}>Total</td>
                    <td className="px-4 py-2 text-right text-emerald-700">{fmt(diaInfo.comision)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
