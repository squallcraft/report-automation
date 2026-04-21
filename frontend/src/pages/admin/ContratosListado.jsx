import { useEffect, useMemo, useState } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { FileSignature, Search, Filter, AlertCircle, Clock, CheckCircle, FileText } from 'lucide-react'

const ESTADO_META = {
  SIN_CONTRATO: { label: 'Sin contrato', color: 'bg-gray-100 text-gray-600' },
  BORRADOR: { label: 'Borrador (pendiente aprobación)', color: 'bg-orange-100 text-orange-700' },
  EMITIDO: { label: 'Emitido (esperando firma)', color: 'bg-amber-100 text-amber-700' },
  INFORMATIVO: { label: 'Informativo', color: 'bg-blue-100 text-blue-700' },
  FIRMADO: { label: 'Firmado', color: 'bg-emerald-100 text-emerald-700' },
  RECHAZADO: { label: 'Rechazado', color: 'bg-red-100 text-red-700' },
}

const fmtDate = (s) => {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const fmtClp = (n) => (n ?? 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })

export default function ContratosListado() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [estadoFiltro, setEstadoFiltro] = useState('')
  const [busqueda, setBusqueda] = useState('')

  const cargar = async () => {
    setLoading(true)
    try {
      const params = estadoFiltro ? { estado: estadoFiltro } : {}
      const { data } = await api.get('/contratos/admin/listado', { params })
      setRows(data)
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al cargar contratos')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { cargar() }, [estadoFiltro])

  const filtered = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r =>
      (r.nombre || '').toLowerCase().includes(q) ||
      (r.rut || '').toLowerCase().includes(q) ||
      (r.cargo || '').toLowerCase().includes(q),
    )
  }, [rows, busqueda])

  const resumen = useMemo(() => {
    const acc = { total: rows.length, sin: 0, borrador: 0, emitido: 0, firmado: 0 }
    rows.forEach(r => {
      if (r.estado_contrato === 'SIN_CONTRATO') acc.sin++
      else if (r.estado_contrato === 'BORRADOR') acc.borrador++
      else if (r.estado_contrato === 'EMITIDO') acc.emitido++
      else if (r.estado_contrato === 'FIRMADO') acc.firmado++
    })
    return acc
  }, [rows])

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
          <FileSignature size={22} /> Contratos de trabajadores
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Vista general del estado contractual de toda la plantilla.
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <KpiCard label="Total" value={resumen.total} color="bg-gray-50 text-gray-700" />
        <KpiCard label="Sin contrato" value={resumen.sin} color="bg-gray-100 text-gray-700" icon={AlertCircle} />
        <KpiCard label="Borradores" value={resumen.borrador} color="bg-orange-50 text-orange-700" icon={FileText} />
        <KpiCard label="Pendientes firma" value={resumen.emitido} color="bg-amber-50 text-amber-700" icon={Clock} />
        <KpiCard label="Firmados" value={resumen.firmado} color="bg-emerald-50 text-emerald-700" icon={CheckCircle} />
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            placeholder="Buscar por nombre, RUT o cargo…"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="relative">
          <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <select
            value={estadoFiltro}
            onChange={e => setEstadoFiltro(e.target.value)}
            className="pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">Todos los estados</option>
            <option value="SIN_CONTRATO">Sin contrato</option>
            <option value="BORRADOR">Borrador (pendiente aprobación)</option>
            <option value="EMITIDO">Emitido (esperando firma)</option>
            <option value="INFORMATIVO">Informativo</option>
            <option value="FIRMADO">Firmado</option>
            <option value="RECHAZADO">Rechazado</option>
          </select>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-500">Cargando contratos…</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">No hay trabajadores que coincidan con el filtro.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Trabajador</th>
                  <th className="text-left px-4 py-3 font-medium">Cargo</th>
                  <th className="text-left px-4 py-3 font-medium">Estado contrato</th>
                  <th className="text-left px-4 py-3 font-medium">Versión vigente</th>
                  <th className="text-left px-4 py-3 font-medium">Firma</th>
                  <th className="text-right px-4 py-3 font-medium">Anexos</th>
                  <th className="text-right px-4 py-3 font-medium">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(r => {
                  const meta = ESTADO_META[r.estado_contrato] || { label: r.estado_contrato, color: 'bg-gray-100 text-gray-700' }
                  return (
                    <tr key={r.trabajador_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{r.nombre}</div>
                        <div className="text-xs text-gray-500">{r.rut}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{r.cargo || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${meta.color}`}>
                          {meta.label}
                        </span>
                        {r.estado_contrato === 'SIN_CONTRATO' && (
                          <div className="text-[11px] text-gray-400 mt-1">Ingreso: {fmtDate(r.fecha_ingreso)}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {r.version_vigente ? (
                          <div>
                            <div className="text-xs">{r.version_vigente.tipo_contrato || '—'}</div>
                            <div className="text-[11px] text-gray-500">
                              {fmtClp(r.version_vigente.sueldo_base)} base
                              {r.version_vigente.jornada_semanal_horas ? ` · ${r.version_vigente.jornada_semanal_horas}h` : ''}
                            </div>
                          </div>
                        ) : <span className="text-xs text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {r.contrato_inicial?.firmado_at
                          ? `Firmado ${fmtDate(r.contrato_inicial.firmado_at)}`
                          : r.contrato_inicial?.aprobado_at
                            ? `Emitido ${fmtDate(r.contrato_inicial.aprobado_at)}`
                            : r.contrato_inicial
                              ? `Creado ${fmtDate(r.contrato_inicial.created_at)}`
                              : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="text-xs text-gray-700">
                          {r.anexos_pendientes > 0 && (
                            <span className="inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 mr-1">
                              {r.anexos_pendientes} pend.
                            </span>
                          )}
                          {r.anexos_borrador > 0 && (
                            <span className="inline-block px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">
                              {r.anexos_borrador} borr.
                            </span>
                          )}
                          {r.anexos_pendientes === 0 && r.anexos_borrador === 0 && (
                            <span className="text-gray-400">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          to={`/admin/trabajadores?tab=contratos&t=${r.trabajador_id}`}
                          className="text-xs font-medium text-blue-600 hover:text-blue-700"
                        >
                          Gestionar →
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function KpiCard({ label, value, color, icon: Icon }) {
  return (
    <div className={`rounded-xl p-3 ${color}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide font-medium opacity-70">{label}</span>
        {Icon && <Icon size={14} className="opacity-60" />}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  )
}
