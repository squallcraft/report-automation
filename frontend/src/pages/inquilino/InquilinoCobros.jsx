import { useEffect, useState } from 'react'
import api from '../../api'
import { CreditCard, CheckCircle, Clock, AlertCircle, FileText, Upload, Receipt } from 'lucide-react'

const MESES = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const fmt = (n) => '$' + (n || 0).toLocaleString('es-CL')
const fmtDate = (s) => s ? new Date(s).toLocaleDateString('es-CL', { day:'2-digit', month:'2-digit', year:'numeric' }) : '—'

const ESTADO_META = {
  PENDIENTE: { label: 'Pendiente de pago', cls: 'bg-amber-50 text-amber-700',  bar: 'bg-amber-400',  icon: Clock },
  VENCIDO:   { label: 'Vencido',           cls: 'bg-red-50 text-red-700',      bar: 'bg-red-400',    icon: AlertCircle },
  PAGADO:    { label: 'Pagado',            cls: 'bg-emerald-50 text-emerald-700', bar: 'bg-emerald-400', icon: CheckCircle },
}

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

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full" />
    </div>
  )

  const pendientes = cobros.filter(c => c.estado !== 'PAGADO')
  const totalPendiente = pendientes.reduce((s, c) => s + (c.total || 0), 0)

  return (
    <div className="max-w-2xl mx-auto space-y-4">

      {/* Hero */}
      <div className="rounded-2xl text-white p-5 relative overflow-hidden"
           style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #1d4ed8 100%)' }}>
        <div className="absolute -top-6 -right-6 w-28 h-28 bg-white/5 rounded-full" />
        <div className="absolute -bottom-4 -left-4 w-20 h-20 bg-white/5 rounded-full" />
        <div className="relative flex items-center justify-between">
          <div>
            <p className="text-blue-200 text-xs font-medium uppercase tracking-wider">Portal</p>
            <h1 className="text-xl font-bold mt-0.5">Cobros y Facturas</h1>
            <p className="text-blue-200 text-xs mt-1">
              {cobros.length === 0
                ? 'Sin cobros aún'
                : pendientes.length > 0
                  ? `${pendientes.length} pendiente${pendientes.length > 1 ? 's' : ''} · ${fmt(totalPendiente)}`
                  : `${cobros.length} cobro${cobros.length > 1 ? 's' : ''} · Al día`}
            </p>
          </div>
          <div className="w-11 h-11 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0">
            <Receipt size={22} className="text-white" />
          </div>
        </div>
      </div>

      {cobros.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center">
          <div className="w-14 h-14 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <CreditCard size={28} className="text-gray-300" />
          </div>
          <p className="text-gray-600 font-medium">Sin cobros registrados</p>
          <p className="text-sm text-gray-400 mt-1">Aquí aparecerán tus cobros mensuales</p>
        </div>
      ) : (
        <div className="space-y-3">
          {cobros.map(c => {
            const meta = ESTADO_META[c.estado] || ESTADO_META.PENDIENTE
            const Icon = meta.icon
            return (
              <div key={c.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className={`h-1 ${meta.bar}`} />
                <div className="p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                        c.estado === 'PAGADO' ? 'bg-emerald-50' : c.estado === 'VENCIDO' ? 'bg-red-50' : 'bg-amber-50'
                      }`}>
                        <CreditCard size={17} className={
                          c.estado === 'PAGADO' ? 'text-emerald-600' : c.estado === 'VENCIDO' ? 'text-red-500' : 'text-amber-500'
                        } />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-gray-900">{MESES[c.mes]} {c.anio}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {c.variable_nombre}: {c.variable_valor?.toLocaleString('es-CL')}
                          {c.folio_haulmer && ` · Folio ${c.folio_haulmer}`}
                        </p>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-base font-bold text-gray-900">{fmt(c.total)}</p>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${meta.cls}`}>
                        <Icon size={11} /> {meta.label}
                      </span>
                    </div>
                  </div>

                  {/* Desglose */}
                  <div className="mt-3 flex items-center gap-3 text-xs text-gray-400">
                    <span>Neto {fmt(c.monto_neto)}</span>
                    <span>·</span>
                    <span>IVA {fmt(c.iva)}</span>
                    {c.fecha_vencimiento && c.estado !== 'PAGADO' && (
                      <>
                        <span>·</span>
                        <span className={c.estado === 'VENCIDO' ? 'text-red-500 font-medium' : ''}>
                          Vence {fmtDate(c.fecha_vencimiento)}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Badges descuento / reserva */}
                  {(c.reserva_descontada || c.descuento_aplicado > 0) && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {c.reserva_descontada && (
                        <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[11px] font-medium rounded-full">
                          Reserva descontada
                        </span>
                      )}
                      {c.descuento_aplicado > 0 && (
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-[11px] font-medium rounded-full">
                          Descuento {fmt(c.descuento_aplicado)}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Acciones */}
                  <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-gray-50">
                    {(c.pdf_factura_path || c.folio_haulmer) && (
                      <button onClick={() => handleDownloadFactura(c.id, c.mes, c.anio)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-xl border border-gray-200 transition-colors">
                        <FileText size={12} /> Factura
                      </button>
                    )}
                    {c.estado !== 'PAGADO' && (
                      <button
                        onClick={() => alert('Función de subir comprobante — próximamente')}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white rounded-xl transition-colors"
                        style={{ background: 'linear-gradient(135deg,#1e3a5f,#1d4ed8)' }}>
                        <Upload size={12} />
                        {c.comprobante_pago_path ? 'Reemplazar comprobante' : 'Subir comprobante'}
                      </button>
                    )}
                    {c.comprobante_pago_path && c.estado !== 'PAGADO' && (
                      <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
                        <Clock size={11} /> En revisión
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
