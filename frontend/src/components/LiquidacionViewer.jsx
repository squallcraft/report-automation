import { useState, useEffect } from 'react'
import { X, Download, Loader2, FileText, CheckCircle, Clock, AlertCircle } from 'lucide-react'
import api from '../api'

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
               'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

function fmt(n) {
  if (!n && n !== 0) return '—'
  return '$' + Math.round(n).toLocaleString('es-CL')
}

function Badge({ estado }) {
  const map = {
    BORRADOR:  'bg-amber-100 text-amber-700 border-amber-300',
    EMITIDA:   'bg-blue-100 text-blue-700 border-blue-300',
    PAGADA:    'bg-green-100 text-green-700 border-green-300',
  }
  const icons = {
    BORRADOR: <Clock size={11} />,
    EMITIDA:  <FileText size={11} />,
    PAGADA:   <CheckCircle size={11} />,
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${map[estado] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
      {icons[estado]}
      {estado}
    </span>
  )
}

function SectionHeader({ label, colorClass }) {
  return (
    <div className={`flex items-center justify-between px-4 py-2.5 rounded-t-lg ${colorClass}`}>
      <span className="text-xs font-bold text-white uppercase tracking-wide">{label}</span>
      <span className="text-xs font-bold text-white opacity-70">MONTO</span>
    </div>
  )
}

function Row({ label, value, bold, colorClass, altBg }) {
  return (
    <div className={`flex items-center justify-between px-4 py-2 text-sm ${altBg ? 'bg-gray-50' : 'bg-white'} ${bold ? 'font-semibold' : ''}`}>
      <span className={colorClass || 'text-gray-700'}>{label}</span>
      <span className={`font-mono tabular-nums ${colorClass || 'text-gray-800'}`}>{value}</span>
    </div>
  )
}

function TotalRow({ label, value, bgClass, textClass }) {
  return (
    <div className={`flex items-center justify-between px-4 py-2.5 rounded-b-lg ${bgClass}`}>
      <span className={`text-sm font-bold ${textClass}`}>{label}</span>
      <span className={`text-sm font-bold font-mono tabular-nums ${textClass}`}>{value}</span>
    </div>
  )
}

export default function LiquidacionViewer({ liquidacionId, onClose }) {
  const [liq, setLiq] = useState(null)
  const [loading, setLoading] = useState(true)
  const [descargando, setDescargando] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
    api.get(`/remuneraciones/liquidaciones/${liquidacionId}`)
      .then(r => setLiq(r.data))
      .catch(() => setError('No se pudo cargar la liquidación'))
      .finally(() => setLoading(false))
  }, [liquidacionId])

  const handleDescargar = async () => {
    setDescargando(true)
    try {
      const res = await api.get(`/remuneraciones/liquidaciones/${liquidacionId}/pdf`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `liquidacion_${liq?.nombre_trabajador?.replace(/ /g, '_')}_${liq?.anio}_${String(liq?.mes).padStart(2, '0')}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // silent
    } finally {
      setDescargando(false)
    }
  }

  // Close on backdrop click
  const handleBackdrop = (e) => { if (e.target === e.currentTarget) onClose() }

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 md:p-6"
      onClick={handleBackdrop}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden">

        {/* ── Top bar ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0"
             style={{ background: '#003c72' }}>
          <div className="flex items-center gap-3">
            <FileText size={18} className="text-yellow-400" />
            <div>
              <p className="text-sm font-bold text-white leading-none">
                {loading ? 'Cargando…' : liq?.nombre_trabajador}
              </p>
              <p className="text-xs text-blue-200 mt-0.5">
                Liquidación {liq ? `${MESES[liq.mes]} ${liq.anio}` : '—'}
              </p>
            </div>
            {liq && <Badge estado={liq.estado} />}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDescargar}
              disabled={descargando || loading || !!error}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-400 hover:bg-yellow-300 disabled:bg-gray-300 text-gray-900 text-xs font-bold transition-colors"
            >
              {descargando ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              PDF
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
              <X size={18} className="text-white" />
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="overflow-y-auto flex-1 p-4 md:p-5 space-y-4 bg-gray-50">
          {loading && (
            <div className="flex justify-center py-16">
              <Loader2 size={28} className="animate-spin text-primary-500" />
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
              <AlertCircle size={16} /> {error}
            </div>
          )}

          {liq && !loading && (() => {
            const t = liq.trabajador || {}
            const noImp = (liq.movilizacion || 0) + (liq.colacion || 0) + (liq.viaticos || 0)
            const totalHaberes = (liq.remuneracion_imponible || 0) + noImp
            const hasAdicionales = liq.descuentos_adicionales?.length > 0

            const ufStr = liq.uf_usada ? `$${Number(liq.uf_usada).toFixed(2).replace('.', ',')}` : '—'
            const tipoContrato = (t.tipo_contrato || '—').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

            return (
              <>
                {/* Datos trabajador */}
                <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  <div className="grid grid-cols-2 gap-0">
                    {[
                      ['NOMBRE', t.nombre || liq.nombre_trabajador],
                      ['RUT', t.rut || '—'],
                      ['CARGO', t.cargo || '—'],
                      ['TIPO CONTRATO', tipoContrato],
                      ['AFP', t.afp || '—'],
                      ['SISTEMA SALUD', t.sistema_salud || 'FONASA'],
                    ].map(([label, value], i) => (
                      <div key={i} className={`px-4 py-2.5 ${i % 2 === 0 ? 'border-r border-gray-100' : ''} ${i < 4 ? 'border-b border-gray-100' : ''}`}>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">{label}</p>
                        <p className="text-sm text-gray-800 font-medium mt-0.5">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Haberes */}
                <div className="rounded-xl overflow-hidden border border-blue-100">
                  <SectionHeader label="Haberes" colorClass="bg-blue-700" />
                  <Row label="Sueldo Base" value={fmt(liq.sueldo_base)} />
                  <Row label="Gratificación Legal (Art. 50 CT)" value={fmt(liq.gratificacion)} altBg />
                  {!!liq.movilizacion && <Row label="Movilización (no imponible)" value={fmt(liq.movilizacion)} />}
                  {!!liq.colacion && <Row label="Colación (no imponible)" value={fmt(liq.colacion)} altBg />}
                  {!!liq.viaticos && <Row label="Viáticos (no imponible)" value={fmt(liq.viaticos)} />}
                  <TotalRow
                    label="TOTAL HABERES"
                    value={fmt(totalHaberes)}
                    bgClass="bg-blue-50 border-t border-blue-200"
                    textClass="text-blue-800"
                  />
                </div>

                {/* Descuentos legales */}
                <div className="rounded-xl overflow-hidden border border-red-100">
                  <SectionHeader label="Descuentos Legales" colorClass="bg-red-700" />
                  <Row label={`AFP ${t.afp || ''}`} value={fmt(liq.descuento_afp)} colorClass="text-red-800" />
                  <Row label="Salud Legal 7%" value={fmt(liq.descuento_salud_legal)} colorClass="text-red-800" altBg />
                  {!!liq.adicional_isapre && (
                    <Row label={`Adicional Isapre (${t.sistema_salud || ''})`} value={fmt(liq.adicional_isapre)} colorClass="text-red-800" />
                  )}
                  <Row
                    label={liq.descuento_cesantia ? 'Seguro de Cesantía (0,6%)' : 'Seguro de Cesantía (Plazo Fijo: 0%)'}
                    value={fmt(liq.descuento_cesantia || 0)}
                    colorClass="text-red-800"
                    altBg={!!liq.adicional_isapre}
                  />
                  {!!liq.iusc && (
                    <Row label="Imp. Único 2ª Categoría (IUSC)" value={fmt(liq.iusc)} colorClass="text-red-800" altBg />
                  )}
                  <TotalRow
                    label="TOTAL DESCUENTOS LEGALES"
                    value={fmt(liq.total_descuentos)}
                    bgClass="bg-red-50 border-t border-red-200"
                    textClass="text-red-800"
                  />
                </div>

                {/* Subtotal líquido legal si hay adicionales */}
                {hasAdicionales && (
                  <div className="flex items-center justify-between px-4 py-3 bg-green-50 border border-green-200 rounded-xl">
                    <span className="text-sm font-semibold text-green-800">Líquido legal (antes de descuentos empresa)</span>
                    <span className="text-sm font-bold font-mono text-green-800">{fmt(liq.sueldo_liquido)}</span>
                  </div>
                )}

                {/* Descuentos adicionales */}
                {hasAdicionales && (
                  <div className="rounded-xl overflow-hidden border border-purple-100">
                    <SectionHeader label="Descuentos Adicionales (Préstamos y Ajustes)" colorClass="bg-purple-700" />
                    {liq.descuentos_adicionales.map((d, i) => (
                      <Row key={i} label={d.concepto} value={fmt(d.monto)} colorClass="text-purple-800" altBg={i % 2 !== 0} />
                    ))}
                    <TotalRow
                      label="TOTAL DESCUENTOS ADICIONALES"
                      value={fmt(liq.total_descuentos_adicionales)}
                      bgClass="bg-purple-50 border-t border-purple-200"
                      textClass="text-purple-800"
                    />
                  </div>
                )}

                {/* Líquido final */}
                <div className="flex items-center justify-between px-5 py-4 rounded-xl text-white"
                     style={{ background: '#003c72' }}>
                  <span className="text-sm font-bold tracking-wide">
                    {hasAdicionales ? 'LÍQUIDO A DEPOSITAR' : 'LÍQUIDO A PAGAR'}
                  </span>
                  <span className="text-xl font-bold font-mono text-yellow-400">
                    {fmt(hasAdicionales ? liq.liquido_a_depositar : liq.sueldo_liquido)}
                  </span>
                </div>

                {/* Parámetros */}
                <p className="text-[11px] text-gray-400 text-center pb-1">
                  Parámetros {MESES[liq.mes]} {liq.anio}: UF {ufStr} · UTM {fmt(liq.utm_usado)} · IMM {fmt(liq.imm_usado)}
                </p>
              </>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
