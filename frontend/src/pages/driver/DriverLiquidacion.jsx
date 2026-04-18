import { useState, useEffect } from 'react'
import { Users, FileText, Download, Wallet, Receipt, ChevronDown } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import LiquidacionDetalle from '../../components/LiquidacionDetalle'
import api from '../../api'

const now = new Date()
const DRIVER_MIN_PERIOD = { semana: 4, mes: 2, anio: 2026 }
const MESES = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const fmt = (n) => (n ?? 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })

function getInitialPeriod() {
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  if (y < 2026 || (y === 2026 && m < 2)) return DRIVER_MIN_PERIOD
  if (y === 2026 && m === 2) return { semana: 4, mes: 2, anio: 2026 }
  return { semana: 1, mes: m, anio: y }
}

function MiSueldoTab() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(null)

  useEffect(() => {
    api.get('/remuneraciones/portal/driver-link')
      .then(({ data }) => setData(data))
      .catch(() => setData({ vinculado: false }))
      .finally(() => setLoading(false))
  }, [])

  const handleDownload = async (liq) => {
    setDownloading(liq.id)
    try {
      const res = await api.get(`/remuneraciones/portal/driver-link/${liq.id}/pdf`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `liquidacion_${MESES[liq.mes]}_${liq.anio}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert('Error al descargar PDF')
    } finally {
      setDownloading(null)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-32">
      <div className="w-7 h-7 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
    </div>
  )

  if (!data?.vinculado) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
        <FileText size={36} className="text-gray-200 mx-auto mb-2" />
        <p className="text-sm text-gray-500 font-medium">Sin contrato de trabajo vinculado</p>
        <p className="text-xs text-gray-400 mt-1 leading-snug">
          No tienes un contrato vinculado a tu perfil de conductor. Consulta con administración si crees que esto es un error.
        </p>
      </div>
    )
  }

  const liqs = data.liquidaciones || []
  const totalLiquido = liqs.reduce((s, l) => s + (l.sueldo_liquido || 0), 0)

  return (
    <div className="space-y-3">
      {/* Trabajador chip */}
      <div className="bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-2xl p-4 flex items-center gap-3 shadow-sm">
        <div className="w-10 h-10 bg-white/15 rounded-full flex items-center justify-center flex-shrink-0">
          <Receipt size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold truncate">{data.trabajador?.nombre}</p>
          <p className="text-[11px] text-blue-100">{data.trabajador?.cargo || 'Trabajador'}</p>
        </div>
        {liqs.length > 0 && (
          <div className="text-right">
            <p className="text-[10px] text-blue-100 uppercase tracking-wide">Líquido total</p>
            <p className="text-sm font-bold">{fmt(totalLiquido)}</p>
          </div>
        )}
      </div>

      {liqs.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
          <FileText size={32} className="text-gray-200 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No hay liquidaciones emitidas aún.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {liqs.map((liq) => (
            <div key={liq.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="p-4">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <p className="text-sm font-bold text-gray-800 leading-tight">{MESES[liq.mes]} {liq.anio}</p>
                    <span className={`mt-1 inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${liq.estado === 'PAGADA' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>
                      {liq.estado}
                    </span>
                  </div>
                  <button
                    onClick={() => handleDownload(liq)}
                    disabled={downloading === liq.id}
                    className="flex items-center gap-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 px-3 py-2 rounded-xl transition-colors"
                    title="Descargar PDF"
                  >
                    {downloading === liq.id ? <span>…</span> : <><Download size={12} /> PDF</>}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-gray-50 rounded-xl p-2.5">
                    <p className="text-gray-400 text-[10px] uppercase tracking-wide">Imponible</p>
                    <p className="text-sm font-semibold text-gray-700 mt-0.5">{fmt(liq.remuneracion_imponible)}</p>
                  </div>
                  <div className="bg-red-50 rounded-xl p-2.5">
                    <p className="text-red-400 text-[10px] uppercase tracking-wide">Descuentos</p>
                    <p className="text-sm font-semibold text-red-600 mt-0.5">−{fmt(liq.total_descuentos)}</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-2.5">
                    <p className="text-gray-400 text-[10px] uppercase tracking-wide">AFP</p>
                    <p className="text-sm font-medium text-gray-700 mt-0.5">{fmt(liq.descuento_afp)}</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-2.5">
                    <p className="text-gray-400 text-[10px] uppercase tracking-wide">Salud</p>
                    <p className="text-sm font-medium text-gray-700 mt-0.5">{fmt(liq.descuento_salud_legal + (liq.adicional_isapre || 0))}</p>
                  </div>
                </div>
              </div>

              <div className="border-t border-gray-100 bg-emerald-50/40 px-4 py-3 flex items-center justify-between">
                <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">Líquido a cobrar</span>
                <span className="text-base font-bold text-emerald-600">{fmt(liq.sueldo_liquido)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function DriverLiquidacion() {
  const { user } = useAuth()
  const driverId = user?.entidad_id
  const [flota, setFlota] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [activeTab, setActiveTab] = useState('liquidacion')
  const [hasSueldo, setHasSueldo] = useState(false)

  useEffect(() => {
    if (!driverId) return
    const period = getInitialPeriod()
    api.get('/portal/driver/liquidacion', { params: period })
      .then(({ data }) => {
        if (data.es_jefe && data.subordinados?.length > 0) {
          setFlota({ es_jefe: true, subordinados: data.subordinados })
        }
      })
      .catch(() => {})

    api.get('/remuneraciones/portal/driver-link')
      .then(({ data }) => setHasSueldo(data?.vinculado === true))
      .catch(() => {})
  }, [driverId])

  if (!driverId) return (
    <div className="flex items-center justify-center h-64 text-gray-400">No se pudo identificar el conductor.</div>
  )

  const esJefe = flota?.es_jefe
  const subordinados = flota?.subordinados || []

  return (
    <div className="max-w-lg mx-auto px-4 py-5 space-y-4">

      {/* Hero */}
      <div className="rounded-2xl text-white p-5 relative overflow-hidden"
           style={{ background: 'linear-gradient(135deg, #003c72 0%, #1d4ed8 100%)' }}>
        <div className="absolute -top-8 -right-8 w-32 h-32 bg-white/5 rounded-full" />
        <div className="absolute -bottom-4 -left-4 w-20 h-20 bg-white/5 rounded-full" />

        <div className="relative flex items-center justify-between">
          <div>
            <p className="text-blue-200 text-xs font-medium uppercase tracking-wider">Mis liquidaciones</p>
            <h1 className="text-lg font-bold leading-tight mt-0.5">
              {hasSueldo ? 'Conductor + Trabajador' : 'Liquidación semanal'}
            </h1>
            <p className="text-blue-200 text-xs mt-0.5">
              Detalle por semana y, si aplica, por mes contractual
            </p>
          </div>
          <div className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0">
            <Wallet size={18} className="text-white" />
          </div>
        </div>
      </div>

      {/* Tabs */}
      {hasSueldo && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-1 grid grid-cols-2 gap-1">
          <button
            onClick={() => setActiveTab('liquidacion')}
            className={`flex items-center justify-center gap-1.5 text-xs font-semibold py-2.5 rounded-xl transition-colors ${
              activeTab === 'liquidacion'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Receipt size={13} /> Semanal
          </button>
          <button
            onClick={() => setActiveTab('sueldo')}
            className={`flex items-center justify-center gap-1.5 text-xs font-semibold py-2.5 rounded-xl transition-colors ${
              activeTab === 'sueldo'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <FileText size={13} /> Mi Sueldo
          </button>
        </div>
      )}

      {activeTab === 'liquidacion' && (
        <>
          {esJefe && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3">
              <div className="flex items-center gap-2 mb-2 px-1">
                <Users size={13} className="text-blue-500" />
                <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                  Ver liquidación de
                </p>
              </div>
              <div className="relative">
                <select
                  value={selectedId ?? ''}
                  onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full text-sm border border-gray-200 rounded-xl pl-3 pr-9 py-2.5 bg-white text-gray-700 appearance-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                >
                  <option value="">Mi liquidación (propia)</option>
                  {subordinados.map((s) => (
                    <option key={s.id} value={s.id}>{s.nombre}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <LiquidacionDetalle
              tipo="driver"
              entityId={driverId}
              initialPeriod={getInitialPeriod()}
              isPortal={true}
              subDriverId={selectedId}
            />
          </div>
        </>
      )}

      {activeTab === 'sueldo' && <MiSueldoTab />}
    </div>
  )
}
