import { useState, useEffect } from 'react'
import api from '../../api'
import { ClipboardList, ChevronDown, ChevronUp, AlertCircle, CheckCircle } from 'lucide-react'

export default function Logs() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)

  useEffect(() => {
    api.get('/ingesta/logs').then(({ data }) => setLogs(data)).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const toggle = (id) => setExpanded(expanded === id ? null : id)

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Cargando...</div>

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ClipboardList size={24} /> Logs de Ingesta
        </h1>
        <p className="text-sm text-gray-500 mt-1">Historial de cargas de archivos y errores</p>
      </div>

      {logs.length === 0 ? (
        <div className="card text-center py-12 text-gray-500">No hay logs registrados</div>
      ) : (
        <div className="space-y-3">
          {logs.map((log) => (
            <div key={log.id} className="card">
              <button onClick={() => toggle(log.id)} className="w-full flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {log.errores_count > 0 ? (
                    <AlertCircle size={20} className="text-amber-500" />
                  ) : (
                    <CheckCircle size={20} className="text-green-500" />
                  )}
                  <div className="text-left">
                    <p className="font-medium text-gray-900">{log.archivo || 'Ingesta'}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(log.created_at).toLocaleString('es-CL')}
                      {log.usuario && <span className="ml-2 text-gray-400">por <span className="font-medium text-gray-600">{log.usuario}</span></span>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-gray-600">{log.procesados}/{log.total_filas} procesados</span>
                  {log.errores_count > 0 && (
                    <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs font-medium">{log.errores_count} errores</span>
                  )}
                  {(log.sin_homologar_sellers?.length > 0 || log.sin_homologar_drivers?.length > 0) && (
                    <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded text-xs font-medium">Sin homologar</span>
                  )}
                  {expanded === log.id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </div>
              </button>

              {expanded === log.id && (
                <div className="mt-4 border-t pt-4 space-y-3 text-sm">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div><span className="text-gray-500">ID Ingesta:</span> <span className="font-mono text-xs">{log.ingesta_id}</span></div>
                    <div><span className="text-gray-500">Tipo:</span> {log.tipo}</div>
                    <div><span className="text-gray-500">Total filas:</span> {log.total_filas}</div>
                    <div><span className="text-gray-500">Procesados:</span> {log.procesados}</div>
                  </div>

                  {log.sin_homologar_sellers?.length > 0 && (
                    <div>
                      <p className="font-medium text-amber-700 mb-1">Sellers sin homologar:</p>
                      <div className="flex flex-wrap gap-1">
                        {log.sin_homologar_sellers.map((s, i) => (
                          <span key={i} className="bg-amber-50 text-amber-800 px-2 py-0.5 rounded text-xs">{s}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {log.sin_homologar_drivers?.length > 0 && (
                    <div>
                      <p className="font-medium text-amber-700 mb-1">Drivers sin homologar:</p>
                      <div className="flex flex-wrap gap-1">
                        {log.sin_homologar_drivers.map((s, i) => (
                          <span key={i} className="bg-amber-50 text-amber-800 px-2 py-0.5 rounded text-xs">{s}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {log.errores?.length > 0 && (
                    <div>
                      <p className="font-medium text-red-700 mb-1">Errores ({log.errores.length}):</p>
                      <div className="bg-red-50 rounded p-3 max-h-48 overflow-y-auto">
                        {log.errores.map((e, i) => (
                          <p key={i} className="text-xs text-red-800 font-mono">{e}</p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
