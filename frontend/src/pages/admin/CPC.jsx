import { useState, useEffect, useMemo, useRef } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import { Truck, Download } from 'lucide-react'

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const ESTADO_COLORS = {
  PENDIENTE: 'bg-amber-100 text-amber-800',
  PAGADO: 'bg-green-100 text-green-800',
  INCOMPLETO: 'bg-red-100 text-red-800',
}

function fmt(v) {
  if (!v) return '$0'
  return `$${Math.abs(v).toLocaleString('es-CL')}`
}

export default function CPC() {
  const now = new Date()
  const [mes, setMes] = useState(now.getMonth() + 1)
  const [anio, setAnio] = useState(now.getFullYear())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [filterText, setFilterText] = useState('')
  const reqId = useRef(0)

  const cargar = (silencioso = false) => {
    const id = ++reqId.current
    if (!silencioso) setLoading(true)
    api.get('/cpc/tabla', { params: { mes, anio } })
      .then(res => { if (id === reqId.current) setData(res.data) })
      .catch(() => { if (id === reqId.current) toast.error('Error cargando CPC') })
      .finally(() => { if (id === reqId.current) setLoading(false) })
  }

  useEffect(() => {
    reqId.current++
    const id = reqId.current
    setLoading(true)
    api.get('/cpc/tabla', { params: { mes, anio } })
      .then(res => { if (id === reqId.current) setData(res.data) })
      .catch(() => { if (id === reqId.current) toast.error('Error cargando CPC') })
      .finally(() => { if (id === reqId.current) setLoading(false) })
  }, [mes, anio])

  const semanas = data?.semanas_disponibles || []
  const drivers = useMemo(() => {
    if (!data?.drivers) return []
    if (!filterText) return data.drivers
    const q = filterText.toLowerCase()
    return data.drivers.filter(d => d.driver_nombre.toLowerCase().includes(q))
  }, [data, filterText])

  const updateEstado = async (driverId, semana, estado) => {
    try {
      await api.put(`/cpc/pago-semana/${driverId}`, { estado }, { params: { semana, mes, anio } })
      cargar(true)
    } catch { toast.error('Error actualizando estado') }
  }

  const descargarPlantilla = () => {
    window.open(`${api.defaults.baseURL}/drivers/plantilla/bancaria/descargar`, '_blank')
  }

  const totalesGenerales = useMemo(() => {
    if (!drivers.length) return { neto: 0 }
    return drivers.reduce((acc, d) => ({ neto: acc.neto + d.subtotal_neto }), { neto: 0 })
  }, [drivers])

  const estadoConteo = useMemo(() => {
    const counts = { PENDIENTE: 0, PAGADO: 0, INCOMPLETO: 0 }
    drivers.forEach(d => {
      semanas.forEach(sem => {
        const s = d.semanas[String(sem)]
        if (s && s.monto_neto > 0) counts[s.estado] = (counts[s.estado] || 0) + 1
      })
    })
    return counts
  }, [drivers, semanas])

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Truck size={24} className="text-primary-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">CPC — Control de Pagos a Conductores</h1>
            <p className="text-sm text-gray-500">Seguimiento semanal de egresos a drivers</p>
          </div>
        </div>
        <button onClick={descargarPlantilla} className="btn btn-secondary flex items-center gap-2">
          <Download size={16} /> Plantilla Bancaria
        </button>
      </div>

      <div className="card mb-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Mes:</label>
            <select className="input w-36" value={mes} onChange={e => setMes(Number(e.target.value))}>
              {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Año:</label>
            <select className="input w-24" value={anio} onChange={e => setAnio(Number(e.target.value))}>
              {[2025, 2026, 2027].map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <input type="text" placeholder="Buscar conductor..." className="input w-48"
            value={filterText} onChange={e => setFilterText(e.target.value)} />
        </div>
      </div>

      {drivers.length > 0 && (
        <div className="grid grid-cols-4 gap-4 mb-4">
          <div className="card bg-blue-50 border-blue-200 text-center">
            <p className="text-xs text-blue-600 font-medium">Total Egresos Neto</p>
            <p className="text-lg font-bold text-blue-800">{fmt(totalesGenerales.neto)}</p>
          </div>
          <div className="card bg-green-50 border-green-200 text-center">
            <p className="text-xs text-green-600 font-medium">Pagados</p>
            <p className="text-lg font-bold text-green-800">{estadoConteo.PAGADO}</p>
          </div>
          <div className="card bg-amber-50 border-amber-200 text-center">
            <p className="text-xs text-amber-600 font-medium">Pendientes</p>
            <p className="text-lg font-bold text-amber-800">{estadoConteo.PENDIENTE}</p>
          </div>
          <div className="card bg-red-50 border-red-200 text-center">
            <p className="text-xs text-red-600 font-medium">Incompletos</p>
            <p className="text-lg font-bold text-red-800">{estadoConteo.INCOMPLETO}</p>
          </div>
        </div>
      )}

      {loading && !data ? (
        <div className="text-center py-12 text-gray-400">Cargando...</div>
      ) : !data || drivers.length === 0 ? (
        <div className="card text-center py-12 text-gray-400">
          No hay datos de pagos para {MESES[mes]} {anio}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                <th className="pb-2 font-medium">Conductor</th>
                <th className="pb-2 font-medium text-center">Banco</th>
                {semanas.map(s => <th key={s} className="pb-2 font-medium text-right">Sem {s}</th>)}
                <th className="pb-2 font-medium text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {drivers.map(d => (
                <tr key={d.driver_id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2">
                    <span className="font-medium text-gray-800">{d.driver_nombre}</span>
                    {d.rut && <span className="text-xs text-gray-400 ml-2">{d.rut}</span>}
                  </td>
                  <td className="py-2 text-center">
                    {d.banco ? (
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded"
                        title={`${d.tipo_cuenta || ''} ${d.numero_cuenta || ''}`}>{d.banco}</span>
                    ) : (
                      <span className="text-xs text-gray-300">Sin datos</span>
                    )}
                  </td>
                  {semanas.map(sem => {
                    const semData = d.semanas[String(sem)] || { monto_neto: 0, estado: 'PENDIENTE' }
                    return (
                      <td key={sem} className="py-2 text-right">
                        <div className="flex flex-col items-end gap-1">
                          <span className="font-mono text-gray-700">{fmt(semData.monto_neto)}</span>
                          {semData.monto_neto > 0 && (
                            <select
                              className={`text-[10px] px-1.5 py-0.5 rounded border-0 cursor-pointer ${ESTADO_COLORS[semData.estado] || ESTADO_COLORS.PENDIENTE}`}
                              value={semData.estado}
                              onChange={e => updateEstado(d.driver_id, sem, e.target.value)}
                            >
                              <option value="PENDIENTE">Pendiente</option>
                              <option value="PAGADO">Pagado</option>
                              <option value="INCOMPLETO">Incompleto</option>
                            </select>
                          )}
                        </div>
                      </td>
                    )
                  })}
                  <td className="py-2 text-right font-semibold text-gray-800 font-mono">{fmt(d.subtotal_neto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
