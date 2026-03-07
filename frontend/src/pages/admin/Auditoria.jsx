import { useState, useEffect } from 'react'
import api from '../../api'
import { Shield, ChevronLeft, ChevronRight, FileText, Search } from 'lucide-react'

const fmt = (n) => `$${(n || 0).toLocaleString('es-CL')}`
const PAGE_SIZE = 50

const ACCION_LABELS = {
  ingesta_batch: 'Ingesta envíos',
  resolver_homologacion: 'Homologación',
  carga_cartola_driver: 'Cartola driver',
  carga_cartola_seller: 'Cartola seller',
  pago_manual_driver: 'Pago manual driver',
  pago_manual_seller: 'Pago manual seller',
  pago_batch_driver: 'Pago batch driver',
  pago_batch_seller: 'Pago batch seller',
  generar_tef: 'Generar TEF',
  generar_facturas: 'Generar facturas',
  cerrar_semana: 'Cerrar semana',
  crear_seller: 'Crear seller',
  editar_seller: 'Editar seller',
  eliminar_seller: 'Eliminar seller',
  crear_driver: 'Crear driver',
  editar_driver: 'Editar driver',
  eliminar_driver: 'Eliminar driver',
  crear_pickup: 'Crear pickup',
  editar_pickup: 'Editar pickup',
  eliminar_pickup: 'Eliminar pickup',
  editar_envio: 'Editar envío',
  importar_retiros: 'Importar retiros',
  importar_recepciones: 'Importar recepciones',
  crear_usuario: 'Crear usuario',
  editar_usuario: 'Editar usuario',
  editar_permisos: 'Editar permisos',
  desactivar_usuario: 'Desactivar usuario',
}

const ACCION_COLORS = {
  ingesta_batch: 'bg-blue-100 text-blue-700',
  carga_cartola_driver: 'bg-indigo-100 text-indigo-700',
  carga_cartola_seller: 'bg-indigo-100 text-indigo-700',
  pago_manual_driver: 'bg-emerald-100 text-emerald-700',
  pago_manual_seller: 'bg-emerald-100 text-emerald-700',
  generar_tef: 'bg-purple-100 text-purple-700',
  generar_facturas: 'bg-purple-100 text-purple-700',
  cerrar_semana: 'bg-amber-100 text-amber-700',
  editar_envio: 'bg-orange-100 text-orange-700',
}

function ChangesViewer({ cambios }) {
  if (!cambios || Object.keys(cambios).length === 0) return null
  return (
    <div className="mt-1 space-y-0.5">
      {Object.entries(cambios).map(([campo, vals]) => (
        <div key={campo} className="text-[10px] font-mono">
          <span className="text-gray-500">{campo}: </span>
          <span className="text-red-500 line-through">{JSON.stringify(vals.antes)}</span>
          <span className="text-gray-400"> → </span>
          <span className="text-emerald-600">{JSON.stringify(vals.despues)}</span>
        </div>
      ))}
    </div>
  )
}

function MetadataViewer({ metadata }) {
  if (!metadata || Object.keys(metadata).length === 0) return null
  return (
    <div className="mt-1 text-[10px] font-mono text-gray-500">
      {Object.entries(metadata).map(([k, v]) => (
        <span key={k} className="mr-3">{k}: <span className="text-gray-700">{JSON.stringify(v)}</span></span>
      ))}
    </div>
  )
}

export default function Auditoria() {
  const [tab, setTab] = useState('logs')
  const [logs, setLogs] = useState({ items: [], total: 0 })
  const [cargas, setCargas] = useState({ items: [], total: 0 })
  const [acciones, setAcciones] = useState([])
  const [filters, setFilters] = useState({ accion: '', usuario_nombre: '', entidad: '', entidad_id: '', search: '' })
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/auditoria/acciones').then(({ data }) => setAcciones(data)).catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    if (tab === 'logs') {
      const params = { limit: PAGE_SIZE, offset: page * PAGE_SIZE }
      if (filters.accion) params.accion = filters.accion
      if (filters.usuario_nombre) params.usuario_nombre = filters.usuario_nombre
      if (filters.entidad) params.entidad = filters.entidad
      if (filters.entidad_id) params.entidad_id = filters.entidad_id
      if (filters.search) params.search = filters.search
      api.get('/auditoria/logs', { params })
        .then(({ data }) => setLogs(data))
        .catch(() => setLogs({ items: [], total: 0 }))
        .finally(() => setLoading(false))
    } else {
      api.get('/auditoria/cargas', { params: { limit: PAGE_SIZE, offset: page * PAGE_SIZE } })
        .then(({ data }) => setCargas(data))
        .catch(() => setCargas({ items: [], total: 0 }))
        .finally(() => setLoading(false))
    }
  }, [tab, page, filters])

  const totalPages = Math.ceil((tab === 'logs' ? logs.total : cargas.total) / PAGE_SIZE)

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary-50">
            <Shield size={22} className="text-primary-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Auditoría</h1>
            <p className="text-sm text-gray-500">Registro de acciones del sistema</p>
          </div>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          <button
            onClick={() => { setTab('logs'); setPage(0) }}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${tab === 'logs' ? 'bg-white shadow text-gray-900 font-medium' : 'text-gray-500'}`}
          >
            Timeline
          </button>
          <button
            onClick={() => { setTab('cargas'); setPage(0) }}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${tab === 'cargas' ? 'bg-white shadow text-gray-900 font-medium' : 'text-gray-500'}`}
          >
            Cargas de cartola
          </button>
        </div>
      </div>

      {tab === 'logs' && (
        <>
          <div className="card mb-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Acción</label>
                <select className="input-field text-sm" value={filters.accion}
                  onChange={e => { setFilters(f => ({ ...f, accion: e.target.value })); setPage(0) }}>
                  <option value="">Todas</option>
                  {acciones.map(a => <option key={a} value={a}>{ACCION_LABELS[a] || a}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Usuario</label>
                <input className="input-field text-sm" placeholder="Buscar..." value={filters.usuario_nombre}
                  onChange={e => { setFilters(f => ({ ...f, usuario_nombre: e.target.value })); setPage(0) }} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Entidad</label>
                <input className="input-field text-sm w-24" placeholder="envio, driver..." value={filters.entidad}
                  onChange={e => { setFilters(f => ({ ...f, entidad: e.target.value })); setPage(0) }} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">ID</label>
                <input className="input-field text-sm w-20" type="number" placeholder="#" value={filters.entidad_id}
                  onChange={e => { setFilters(f => ({ ...f, entidad_id: e.target.value })); setPage(0) }} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Buscar nombre</label>
                <input className="input-field text-sm" placeholder="Alejandro, Repuestos..."
                  value={filters.search}
                  onChange={e => { setFilters(f => ({ ...f, search: e.target.value })); setPage(0) }} />
              </div>
            </div>
          </div>

          <div className="card p-0 overflow-hidden">
            {loading ? (
              <div className="text-center py-16 text-gray-400">Cargando...</div>
            ) : logs.items.length === 0 ? (
              <div className="text-center py-16 text-gray-400">No hay registros de auditoría</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 font-medium text-gray-600 w-36">Fecha</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Usuario</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Acción</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Entidad</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Detalle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.items.map(log => {
                      const colorCls = ACCION_COLORS[log.accion] || 'bg-gray-100 text-gray-600'
                      return (
                        <tr key={log.id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                            {log.timestamp ? new Date(log.timestamp).toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-xs font-medium text-gray-700">{log.usuario_nombre || '—'}</div>
                            <div className="text-[10px] text-gray-400">{log.usuario_rol} {log.ip_address ? `· ${log.ip_address}` : ''}</div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium ${colorCls}`}>
                              {ACCION_LABELS[log.accion] || log.accion}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-600">
                            <span className="font-medium">{log.entidad || '—'}</span>
                            {log.entidad_id ? <span className="text-gray-400"> #{log.entidad_id}</span> : ''}
                            {log.metadata?.nombre && (
                              <div className="text-[10px] text-gray-500 truncate max-w-[180px]" title={log.metadata.nombre}>
                                {log.metadata.nombre}
                              </div>
                            )}
                            {log.metadata?.tracking && (
                              <div className="text-[10px] text-gray-400 font-mono">{log.metadata.tracking}</div>
                            )}
                          </td>
                          <td className="px-4 py-3 max-w-[350px]">
                            <ChangesViewer cambios={log.cambios} />
                            <MetadataViewer metadata={log.metadata} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                <span className="text-xs text-gray-500">{logs.total} registros</span>
                <div className="flex items-center gap-2">
                  <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
                    className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"><ChevronLeft size={16} /></button>
                  <span className="text-xs text-gray-600">Pág {page + 1} / {totalPages}</span>
                  <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
                    className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"><ChevronRight size={16} /></button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'cargas' && (
        <div className="card p-0 overflow-hidden">
          {loading ? (
            <div className="text-center py-16 text-gray-400">Cargando...</div>
          ) : cargas.items.length === 0 ? (
            <div className="text-center py-16 text-gray-400">No hay cargas de cartola registradas</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Fecha</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Tipo</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Archivo</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Usuario</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Período</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Transacciones</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Matcheadas</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Monto total</th>
                  </tr>
                </thead>
                <tbody>
                  {cargas.items.map(c => (
                    <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {c.fecha_carga ? new Date(c.fecha_carga).toLocaleString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium ${
                          c.tipo === 'driver' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                        }`}>
                          {c.tipo === 'driver' ? 'Driver' : 'Seller'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">{c.archivo_nombre || '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-700">{c.usuario_nombre || '—'}</td>
                      <td className="px-4 py-3 text-xs text-gray-600">{c.mes}/{c.anio}</td>
                      <td className="px-4 py-3 text-right text-xs">{c.total_transacciones}</td>
                      <td className="px-4 py-3 text-right text-xs">
                        <span className="text-emerald-700">{c.matcheadas}</span>
                        {c.no_matcheadas > 0 && <span className="text-red-500 ml-1">({c.no_matcheadas} sin match)</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-xs font-medium">{fmt(c.monto_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {Math.ceil(cargas.total / PAGE_SIZE) > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <span className="text-xs text-gray-500">{cargas.total} cargas</span>
              <div className="flex items-center gap-2">
                <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
                  className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"><ChevronLeft size={16} /></button>
                <span className="text-xs text-gray-600">Pág {page + 1} / {Math.ceil(cargas.total / PAGE_SIZE)}</span>
                <button disabled={page >= Math.ceil(cargas.total / PAGE_SIZE) - 1} onClick={() => setPage(p => p + 1)}
                  className="p-1 rounded hover:bg-gray-100 disabled:opacity-30"><ChevronRight size={16} /></button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
