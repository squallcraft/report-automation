import { useState, useEffect } from 'react'
import { Users, FileText, DollarSign, ShieldCheck, Download } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import LiquidacionDetalle from '../../components/LiquidacionDetalle'
import api from '../../api'

const now = new Date()
const DRIVER_MIN_PERIOD = { semana: 4, mes: 2, anio: 2026 }
const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const fmt = (n) => (n ?? 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })

function getInitialPeriod() {
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  if (y < 2026 || (y === 2026 && m < 2)) return DRIVER_MIN_PERIOD
  if (y === 2026 && m === 2) return { semana: 4, mes: 2, anio: 2026 }
  return { semana: 1, mes: m, anio: y }
}

function MiSueldoTab({ driverId }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(null)

  useEffect(() => {
    api.get('/remuneraciones/portal/driver-link')
      .then(({ data }) => setData(data))
      .catch(() => setData({ vinculado: false }))
      .finally(() => setLoading(false))
  }, [driverId])

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

  if (loading) return <div className="flex items-center justify-center h-48 text-gray-400">Cargando...</div>

  if (!data?.vinculado) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
        <FileText size={40} className="opacity-30" />
        <p className="text-sm">No tienes un contrato de trabajo vinculado a tu perfil de conductor.</p>
        <p className="text-xs text-gray-300">Consulta con administración si crees que esto es un error.</p>
      </div>
    )
  }

  const liqs = data.liquidaciones || []

  return (
    <div className="space-y-4 p-4">
      {/* Header del trabajador */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center gap-3">
        <FileText size={18} className="text-blue-500" />
        <div>
          <p className="text-sm font-semibold text-blue-800">{data.trabajador?.nombre}</p>
          <p className="text-xs text-blue-600">{data.trabajador?.cargo || 'Trabajador'}</p>
        </div>
      </div>

      {liqs.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm">
          No hay liquidaciones emitidas aún.
        </div>
      ) : (
        <div className="space-y-3">
          {liqs.map((liq) => (
            <div key={liq.id} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-gray-700">
                  {MESES[liq.mes]} {liq.anio}
                </span>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${liq.estado === 'PAGADA' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                    {liq.estado}
                  </span>
                  <button
                    onClick={() => handleDownload(liq)}
                    disabled={downloading === liq.id}
                    className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 disabled:opacity-40"
                    title="Descargar PDF"
                  >
                    {downloading === liq.id ? <span className="text-xs">...</span> : <Download size={14} />}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-gray-400 text-xs block">Sueldo bruto</span>
                  <span className="font-medium">{fmt(liq.remuneracion_imponible)}</span>
                </div>
                <div>
                  <span className="text-gray-400 text-xs block">Total descuentos</span>
                  <span className="font-medium text-red-500">-{fmt(liq.total_descuentos)}</span>
                </div>
                <div>
                  <span className="text-gray-400 text-xs block">AFP</span>
                  <span className="font-medium">{fmt(liq.descuento_afp)}</span>
                </div>
                <div>
                  <span className="text-gray-400 text-xs block">Salud</span>
                  <span className="font-medium">{fmt(liq.descuento_salud_legal + (liq.adicional_isapre || 0))}</span>
                </div>
              </div>
              <div className="border-t pt-2 flex justify-between items-center">
                <span className="text-sm font-semibold text-gray-600">Líquido a cobrar</span>
                <span className="text-lg font-bold text-emerald-600">{fmt(liq.sueldo_liquido)}</span>
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

    // Check if driver has a linked trabajador_id
    api.get('/remuneraciones/portal/driver-link')
      .then(({ data }) => setHasSueldo(data?.vinculado === true))
      .catch(() => {})
  }, [driverId])

  if (!driverId) return (
    <div className="text-center py-12 text-gray-400">No se pudo identificar el conductor.</div>
  )

  const esJefe = flota?.es_jefe
  const subordinados = flota?.subordinados || []

  return (
    <div>
      {/* Tabs: Liquidación semanal | Mi Sueldo */}
      {hasSueldo && (
        <div className="flex border-b border-gray-200 mb-0 px-4 pt-4 gap-1">
          <button
            onClick={() => setActiveTab('liquidacion')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${activeTab === 'liquidacion' ? 'bg-white border border-b-white text-blue-600 border-gray-200' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Liquidación semanal
          </button>
          <button
            onClick={() => setActiveTab('sueldo')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg flex items-center gap-1.5 transition-colors ${activeTab === 'sueldo' ? 'bg-white border border-b-white text-blue-600 border-gray-200' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <FileText size={14} />
            Mi Sueldo
          </button>
        </div>
      )}

      {activeTab === 'liquidacion' && (
        <>
          {esJefe && (
            <div className="mb-4 px-4 pt-4">
              <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
                <Users size={18} className="text-blue-500 flex-shrink-0" />
                <span className="text-sm font-medium text-blue-800">Ver liquidación de:</span>
                <select
                  value={selectedId ?? ''}
                  onChange={e => setSelectedId(e.target.value ? Number(e.target.value) : null)}
                  className="flex-1 text-sm border border-blue-300 rounded-lg px-3 py-1.5 bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  <option value="">Mi liquidación (propia)</option>
                  {subordinados.map(s => (
                    <option key={s.id} value={s.id}>{s.nombre}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <LiquidacionDetalle
            tipo="driver"
            entityId={driverId}
            initialPeriod={getInitialPeriod()}
            isPortal={true}
            subDriverId={selectedId}
          />
        </>
      )}

      {activeTab === 'sueldo' && (
        <MiSueldoTab driverId={driverId} />
      )}
    </div>
  )
}
