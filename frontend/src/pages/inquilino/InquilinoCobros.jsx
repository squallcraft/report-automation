import { useEffect, useState } from 'react'
import api from '../../api'
import { CreditCard, Download, Upload, CheckCircle, Clock, AlertCircle, FileText } from 'lucide-react'

const ESTADOS = {
  PENDIENTE: { label: 'Pendiente de pago', color: 'bg-amber-100 text-amber-700', icon: Clock },
  VENCIDO: { label: 'Vencido', color: 'bg-red-100 text-red-700', icon: AlertCircle },
  PAGADO: { label: 'Pagado', color: 'bg-green-100 text-green-700', icon: CheckCircle },
}

const fmt = (n) => '$' + (n || 0).toLocaleString('es-CL')

export default function InquilinoCobros() {
  const [cobros, setCobros] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/inquilinos/portal/cobros')
      .then(r => setCobros(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleDownloadFactura = async (id, mes, anio) => {
    try {
      const { data } = await api.get(`/inquilinos/portal/cobros/${id}/factura`)
      const link = document.createElement('a')
      link.href = `data:application/pdf;base64,${data.pdf_base64}`
      link.download = `factura_${mes}_${anio}.pdf`
      link.click()
    } catch (err) {
      alert(err?.response?.data?.detail || 'Factura no disponible')
    }
  }

  const meses = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-2 border-blue-900 border-t-transparent rounded-full" />
    </div>
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Cobros y Facturas</h1>
        <p className="text-gray-500 mt-1">Historial de cobros mensuales del software Tracking Tech</p>
      </div>

      {cobros.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <CreditCard className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No hay cobros registrados aún</p>
        </div>
      ) : (
        <div className="space-y-3">
          {cobros.map(c => {
            const est = ESTADOS[c.estado] || ESTADOS.PENDIENTE
            const EIcon = est.icon
            const venc = c.fecha_vencimiento ? new Date(c.fecha_vencimiento).toLocaleDateString('es-CL') : '—'
            return (
              <div key={c.id} className={`bg-white rounded-xl border p-5 ${c.estado === 'VENCIDO' ? 'border-red-200' : 'border-gray-200'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${c.estado === 'PAGADO' ? 'bg-green-50' : c.estado === 'VENCIDO' ? 'bg-red-50' : 'bg-amber-50'}`}>
                      <CreditCard className={`w-5 h-5 ${c.estado === 'PAGADO' ? 'text-green-600' : c.estado === 'VENCIDO' ? 'text-red-600' : 'text-amber-600'}`} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{meses[c.mes]} {c.anio}</h3>
                      <p className="text-sm text-gray-500 mt-0.5">
                        {c.variable_nombre}: {c.variable_valor?.toLocaleString('es-CL')}
                        {c.folio_haulmer && ` · Folio ${c.folio_haulmer}`}
                      </p>
                      {c.reserva_descontada && (
                        <span className="inline-block mt-1 px-2 py-0.5 bg-green-50 text-green-700 text-xs rounded-full">
                          Reserva descontada
                        </span>
                      )}
                      {c.descuento_aplicado > 0 && (
                        <span className="inline-block mt-1 ml-1 px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full">
                          Descuento: {fmt(c.descuento_aplicado)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-right space-y-2">
                    <p className="text-lg font-bold text-gray-900">{fmt(c.total)}</p>
                    <p className="text-xs text-gray-400">Neto: {fmt(c.monto_neto)} + IVA: {fmt(c.iva)}</p>
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${est.color}`}>
                      <EIcon className="w-3 h-3" />
                      {est.label}
                    </span>
                    {c.fecha_vencimiento && c.estado !== 'PAGADO' && (
                      <p className="text-xs text-gray-400">Vence: {venc}</p>
                    )}
                  </div>
                </div>

                {/* Acciones */}
                <div className="flex items-center gap-3 mt-4 pt-4 border-t border-gray-100">
                  {c.pdf_factura_path || c.folio_haulmer ? (
                    <button onClick={() => handleDownloadFactura(c.id, c.mes, c.anio)}
                      className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                      <FileText className="w-3.5 h-3.5" />
                      Descargar factura
                    </button>
                  ) : null}

                  {c.estado !== 'PAGADO' && (
                    <button
                      onClick={() => alert('Función de subir comprobante — implementar con endpoint multipart')}
                      className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-white bg-blue-900 rounded-lg hover:bg-blue-800 transition-colors">
                      <Upload className="w-3.5 h-3.5" />
                      {c.comprobante_pago_path ? 'Reemplazar comprobante' : 'Subir comprobante'}
                    </button>
                  )}

                  {c.comprobante_pago_path && c.estado !== 'PAGADO' && (
                    <span className="text-xs text-amber-600 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Comprobante en revisión
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
