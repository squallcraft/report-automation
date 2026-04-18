import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import api from '../../api'
import PageHeader from '../../components/PageHeader'
import { LayoutDashboard, FileText, DollarSign, CreditCard, TrendingUp, Calendar } from 'lucide-react'
import { fmt } from '../../utils/format'

const MESES = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const MESES_FULL = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

export default function TrabajadorDashboard() {
  const { user } = useAuth()
  const [perfil, setPerfil] = useState(null)
  const [liquidaciones, setLiquidaciones] = useState([])
  const [pagos, setPagos] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.get('/remuneraciones/portal/perfil'),
      api.get('/remuneraciones/portal/liquidaciones'),
      api.get('/remuneraciones/portal/pagos'),
    ])
      .then(([r1, r2, r3]) => {
        setPerfil(r1.data)
        setLiquidaciones(r2.data)
        setPagos(r3.data)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Cargando...</div>
  if (!perfil) return <div className="text-center text-gray-400 py-20">Error cargando datos</div>

  const ultimaLiq = liquidaciones[0]
  const ultimosPagos = pagos.slice(0, 3)
  const totalRecibido = pagos.reduce((s, p) => s + (p.monto || 0), 0)

  const stats = []
  if (perfil.sueldo_liquido) stats.push({ label: 'Sueldo líquido', value: fmt(perfil.sueldo_liquido) })
  stats.push({ label: 'Liquidaciones emitidas', value: liquidaciones.length })
  stats.push({ label: 'Total recibido', value: fmt(totalRecibido) })

  return (
    <div>
      <PageHeader
        title="Mi Portal"
        subtitle={`${perfil.cargo || 'Trabajador'} · ${(perfil.tipo_contrato || '').replace('_', ' ')}`}
        icon={LayoutDashboard}
        accent="blue"
        stats={stats}
      />

      {/* Datos personales */}
      <div className="card mb-6">
        <div className="flex items-center gap-2 mb-3">
          <CreditCard size={16} className="text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-700">Mis datos</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-gray-400 text-xs block">RUT</span>
            <span className="font-medium">{perfil.rut || '—'}</span>
          </div>
          <div>
            <span className="text-gray-400 text-xs block">AFP</span>
            <span className="font-medium">{perfil.afp || '—'}</span>
          </div>
          <div>
            <span className="text-gray-400 text-xs block">Sistema salud</span>
            <span className="font-medium">{perfil.sistema_salud || 'FONASA'}</span>
          </div>
          <div>
            <span className="text-gray-400 text-xs block">Fecha ingreso</span>
            <span className="font-medium">{perfil.fecha_ingreso || '—'}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Última liquidación */}
        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <FileText size={16} className="text-blue-500" />
            <h2 className="text-sm font-semibold text-gray-700">Última liquidación</h2>
          </div>
          {ultimaLiq ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Período</span>
                <span className="font-medium">{MESES_FULL[ultimaLiq.mes]} {ultimaLiq.anio}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Sueldo base</span>
                <span>{fmt(ultimaLiq.sueldo_base)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Gratificación</span>
                <span>{fmt(ultimaLiq.gratificacion)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Total descuentos</span>
                <span className="text-red-600">-{fmt(ultimaLiq.total_descuentos)}</span>
              </div>
              <div className="flex justify-between border-t pt-2 mt-2">
                <span className="font-semibold text-gray-700">Líquido a cobrar</span>
                <span className="font-bold text-emerald-600 text-base">{fmt(ultimaLiq.sueldo_liquido)}</span>
              </div>
              <div className="pt-2">
                <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${ultimaLiq.estado === 'PAGADA' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                  {ultimaLiq.estado}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400">Sin liquidaciones emitidas aún.</p>
          )}
        </div>

        {/* Últimos pagos */}
        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <DollarSign size={16} className="text-emerald-500" />
            <h2 className="text-sm font-semibold text-gray-700">Últimos pagos recibidos</h2>
          </div>
          {ultimosPagos.length > 0 ? (
            <div className="space-y-2">
              {ultimosPagos.map((p) => (
                <div key={p.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-medium">{fmt(p.monto)}</span>
                    <span className="text-gray-400 ml-2 text-xs">
                      {MESES[p.mes]} {p.anio}
                    </span>
                  </div>
                  <span className="text-gray-400 text-xs">{p.fecha_pago || '—'}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400">Sin pagos registrados aún.</p>
          )}
        </div>
      </div>
    </div>
  )
}
