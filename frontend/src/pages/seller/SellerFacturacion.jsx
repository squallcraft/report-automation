import { useState, useEffect } from 'react'
import api from '../../api'
import PageHeader from '../../components/PageHeader'
import toast from 'react-hot-toast'
import { Receipt, FileText } from 'lucide-react'

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

const ESTADO_COLORS = {
  PENDIENTE: 'bg-amber-100 text-amber-800',
  PAGADO: 'bg-green-100 text-green-800',
  INCOMPLETO: 'bg-red-100 text-red-800',
}

const fmt = (n) => `$${(n || 0).toLocaleString('es-CL')}`
const now = new Date()

export default function SellerFacturacion() {
  const [mes, setMes] = useState(now.getMonth() + 1)
  const [anio, setAnio] = useState(now.getFullYear())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [historial, setHistorial] = useState([])
  const [historialLoading, setHistorialLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    api.get('/portal/seller/facturacion', { params: { mes, anio } })
      .then(res => setData(res.data))
      .catch(() => toast.error('Error al cargar facturación'))
      .finally(() => setLoading(false))
  }, [mes, anio])

  useEffect(() => {
    setHistorialLoading(true)
    api.get('/portal/seller/facturas-historial', { params: { limite: 24 } })
      .then(res => setHistorial(Array.isArray(res.data) ? res.data : []))
      .catch(() => setHistorial([]))
      .finally(() => setHistorialLoading(false))
  }, [])

  const semanas = data?.semanas_disponibles || []

  return (
    <div>
      <PageHeader
        title="Mi Facturación"
        subtitle="Cobros y facturación mensual"
        icon={FileText}
        accent="blue"
      />

      <div className="card mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Mes:</label>
            <select className="input-field w-36" value={mes} onChange={e => setMes(Number(e.target.value))}>
              {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Año:</label>
            <select className="input-field w-24" value={anio} onChange={e => setAnio(Number(e.target.value))}>
              {[2025, 2026, 2027].map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Cargando...</div>
      ) : !data || data.subtotal_neto === 0 ? (
        <>
          <div className="card text-center py-12 text-gray-400">
            <Receipt size={40} className="mx-auto mb-3 opacity-30" />
            <p>No hay datos de facturación para {MESES[mes]} {anio}</p>
          </div>
          {!historialLoading && historial.length > 0 && (
            <div className="mt-6 card">
              <h2 className="text-sm font-semibold text-gray-800 mb-3">Facturas anteriores</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                      <th className="pb-2 font-medium">Mes / Año</th>
                      <th className="pb-2 font-medium text-right">Total</th>
                      <th className="pb-2 font-medium text-center">Folio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historial.map((f) => (
                      <tr key={`${f.mes}-${f.anio}`} className="border-b border-gray-100">
                        <td className="py-2 text-gray-700">{MESES[f.mes]} {f.anio}</td>
                        <td className="py-2 text-right font-mono">{fmt(f.total)}</td>
                        <td className="py-2 text-center text-gray-600">{f.folio_haulmer || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {/* Resumen totales */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="card bg-blue-50 border-blue-200 text-center">
              <p className="text-xs text-blue-600 font-medium">Subtotal Neto</p>
              <p className="text-lg font-bold text-blue-800">{fmt(data.subtotal_neto)}</p>
            </div>
            <div className="card bg-gray-50 border-gray-200 text-center">
              <p className="text-xs text-gray-600 font-medium">IVA (19%)</p>
              <p className="text-lg font-bold text-gray-800">{fmt(data.iva)}</p>
            </div>
            <div className="card bg-green-50 border-green-200 text-center">
              <p className="text-xs text-green-600 font-medium">Total con IVA</p>
              <p className="text-lg font-bold text-green-800">{fmt(data.total_con_iva)}</p>
            </div>
          </div>

          {/* Tabla por semana */}
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                  <th className="pb-2 font-medium">Semana</th>
                  <th className="pb-2 font-medium text-right">Monto Neto</th>
                  <th className="pb-2 font-medium text-center">Estado</th>
                </tr>
              </thead>
              <tbody>
                {semanas.map(sem => {
                  const semData = data.semanas?.[String(sem)] || { monto_neto: 0, estado: 'PENDIENTE' }
                  return (
                    <tr key={sem} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-3 font-medium text-gray-700">Semana {sem}</td>
                      <td className="py-3 text-right font-mono text-gray-800">
                        {semData.monto_neto > 0 ? fmt(semData.monto_neto) : '—'}
                      </td>
                      <td className="py-3 text-center">
                        {semData.monto_neto > 0 ? (
                          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${ESTADO_COLORS[semData.estado] || ESTADO_COLORS.PENDIENTE}`}>
                            {semData.estado === 'PENDIENTE' ? 'Pendiente' : semData.estado === 'PAGADO' ? 'Pagado' : 'Incompleto'}
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Estado factura */}
          {data.factura_estado && (
            <div className="mt-4 card bg-gray-50 border-gray-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Receipt size={16} className="text-gray-500" />
                  <span className="text-sm font-medium text-gray-700">Factura del mes</span>
                </div>
                <div className="flex items-center gap-3">
                  {data.factura_folio && (
                    <span className="text-xs text-gray-500">Folio: {data.factura_folio}</span>
                  )}
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                    data.factura_estado === 'EMITIDA' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {data.factura_estado === 'EMITIDA' ? 'Emitida' : 'Generada'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Facturas anteriores */}
          <div className="mt-6 card">
            <h2 className="text-sm font-semibold text-gray-800 mb-3">Facturas anteriores</h2>
            {historialLoading ? (
              <p className="text-sm text-gray-500">Cargando...</p>
            ) : historial.length === 0 ? (
              <p className="text-sm text-gray-500">No hay facturas emitidas anteriores</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                      <th className="pb-2 font-medium">Mes / Año</th>
                      <th className="pb-2 font-medium text-right">Total</th>
                      <th className="pb-2 font-medium text-center">Folio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historial.map((f) => (
                      <tr key={`${f.mes}-${f.anio}`} className="border-b border-gray-100">
                        <td className="py-2 text-gray-700">{MESES[f.mes]} {f.anio}</td>
                        <td className="py-2 text-right font-mono">{fmt(f.total)}</td>
                        <td className="py-2 text-center text-gray-600">{f.folio_haulmer || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
