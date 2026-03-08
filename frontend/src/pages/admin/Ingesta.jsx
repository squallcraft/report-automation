import { useState, useEffect, useRef, useCallback } from 'react'
import api from '../../api'
import FileUpload from '../../components/FileUpload'
import DataTable from '../../components/DataTable'
import Modal from '../../components/Modal'
import toast from 'react-hot-toast'
import { Upload, AlertTriangle, CheckCircle, Link, Download, RefreshCw, Clock, Loader2 } from 'lucide-react'

function formatTime(seconds) {
  if (!seconds || seconds <= 0) return '...'
  if (seconds < 60) return `${Math.ceil(seconds)}s`
  const mins = Math.floor(seconds / 60)
  const secs = Math.ceil(seconds % 60)
  return `${mins}m ${secs}s`
}

function formatNumber(n) {
  return n?.toLocaleString('es-CL') ?? '0'
}

function ProgressBar({ progress }) {
  if (!progress) return null

  const { status, total, processed, nuevos, duplicados, errores, message,
    elapsed_seconds, estimated_remaining_seconds, rate_per_second, archivo } = progress

  const pct = total > 0 ? Math.min(Math.round((processed / total) * 100), 100) : 0
  const isComplete = status === 'completed'
  const isError = status === 'error'

  return (
    <div className="card mb-6 border-l-4 border-l-primary-500">
      <div className="flex items-center gap-3 mb-3">
        {isComplete ? (
          <CheckCircle size={22} className="text-green-500 flex-shrink-0" />
        ) : isError ? (
          <AlertTriangle size={22} className="text-red-500 flex-shrink-0" />
        ) : (
          <Loader2 size={22} className="text-primary-500 animate-spin flex-shrink-0" />
        )}
        <div className="flex-1">
          <p className="text-sm font-semibold text-gray-800">
            {isComplete ? 'Procesamiento Completado' : isError ? 'Error en Procesamiento' : 'Procesando archivo...'}
          </p>
          {archivo && <p className="text-xs text-gray-400">{archivo}</p>}
        </div>
        {!isComplete && !isError && elapsed_seconds > 0 && (
          <div className="text-right flex-shrink-0">
            <p className="text-xs text-gray-500 flex items-center gap-1">
              <Clock size={12} />
              Transcurrido: {formatTime(elapsed_seconds)}
            </p>
            {estimated_remaining_seconds > 0 && (
              <p className="text-xs font-medium text-primary-600">
                Restante: ~{formatTime(estimated_remaining_seconds)}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="w-full bg-gray-200 rounded-full h-4 mb-2 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${
            isError ? 'bg-red-500' : isComplete ? 'bg-green-500' : 'bg-primary-500'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
        <span>{formatNumber(processed)} de {formatNumber(total)} filas ({pct}%)</span>
        {rate_per_second > 0 && !isComplete && (
          <span>{Math.round(rate_per_second)} filas/seg</span>
        )}
        {isComplete && elapsed_seconds > 0 && (
          <span>Tiempo total: {formatTime(elapsed_seconds)}</span>
        )}
      </div>

      {message && !isComplete && !isError && (
        <p className="text-xs text-gray-500 italic mb-2">{message}</p>
      )}
      {isError && (
        <p className="text-sm text-red-600 bg-red-50 rounded p-2">{message}</p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div className="bg-green-50 rounded-lg p-2.5 text-center">
          <p className="text-gray-500 text-xs">Nuevos</p>
          <p className="text-lg font-bold text-green-600">{formatNumber(nuevos)}</p>
        </div>
        <div className="bg-blue-50 rounded-lg p-2.5 text-center">
          <p className="text-gray-500 text-xs">Duplicados (omitidos)</p>
          <p className="text-lg font-bold text-blue-600">{formatNumber(duplicados)}</p>
        </div>
        <div className="bg-red-50 rounded-lg p-2.5 text-center">
          <p className="text-gray-500 text-xs">Errores</p>
          <p className="text-lg font-bold text-red-600">{formatNumber(errores)}</p>
        </div>
        <div className="bg-gray-50 rounded-lg p-2.5 text-center">
          <p className="text-gray-500 text-xs">Total filas</p>
          <p className="text-lg font-bold text-gray-700">{formatNumber(total)}</p>
        </div>
      </div>
    </div>
  )
}

export default function Ingesta() {
  const [processing, setProcessing] = useState(false)
  const [taskId, setTaskId] = useState(null)
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)
  const [pendientes, setPendientes] = useState([])
  const [sellers, setSellers] = useState([])
  const [drivers, setDrivers] = useState([])
  const [pickups, setPickups] = useState([])
  const [resolveModal, setResolveModal] = useState(null)
  const [selectedEntity, setSelectedEntity] = useState('')

  const [showReprocess, setShowReprocess] = useState(false)
  const [reprocessFile, setReprocessFile] = useState(null)
  const [periodos, setPeriodos] = useState([])
  const [selectedPeriodo, setSelectedPeriodo] = useState(null)

  const pollRef = useRef(null)

  useEffect(() => {
    loadPendientes()
    api.get('/sellers').then(({ data }) => setSellers(Array.isArray(data) ? data : [])).catch(() => {})
    api.get('/drivers').then(({ data }) => setDrivers(Array.isArray(data) ? data : [])).catch(() => {})
    api.get('/pickups').then(({ data }) => setPickups(Array.isArray(data) ? data : [])).catch(() => {})
  }, [])

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const loadPendientes = () => {
    api.get('/ingesta/pendientes').then(({ data }) => setPendientes(data)).catch(() => {})
  }

  const loadPeriodos = () => {
    api.get('/ingesta/periodos-disponibles').then(({ data }) => setPeriodos(data)).catch(() => {})
  }

  const startPolling = useCallback((tid) => {
    if (pollRef.current) clearInterval(pollRef.current)

    const poll = async () => {
      try {
        const { data } = await api.get(`/ingesta/progress/${tid}`)
        setProgress(data)

        if (data.status === 'completed' || data.status === 'error') {
          clearInterval(pollRef.current)
          pollRef.current = null
          setProcessing(false)
          setTaskId(null)

          if (data.status === 'completed') {
            if (data.result) setResult(data.result)
            loadPendientes()
            toast.success(`${formatNumber(data.nuevos)} envíos procesados`)
          } else {
            toast.error(data.message || 'Error en procesamiento')
          }
        }
      } catch {
        // keep polling
      }
    }

    poll()
    pollRef.current = setInterval(poll, 1500)
  }, [])

  const handleUpload = async (file) => {
    setProcessing(true)
    setResult(null)
    setProgress(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const { data } = await api.post('/ingesta/upload', formData)
      setTaskId(data.task_id)
      startPolling(data.task_id)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al iniciar procesamiento')
      setProcessing(false)
    }
  }

  const handleReprocess = async () => {
    if (!reprocessFile || !selectedPeriodo) {
      toast.error('Selecciona un archivo y un período')
      return
    }
    setShowReprocess(false)
    setProcessing(true)
    setResult(null)
    setProgress(null)
    try {
      const formData = new FormData()
      formData.append('file', reprocessFile)
      const params = new URLSearchParams({
        reprocesar_semana: selectedPeriodo.semana,
        reprocesar_mes: selectedPeriodo.mes,
        reprocesar_anio: selectedPeriodo.anio,
      })
      const { data } = await api.post(`/ingesta/upload?${params}`, formData)
      setTaskId(data.task_id)
      startPolling(data.task_id)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al iniciar reprocesamiento')
      setProcessing(false)
    }
  }

  const handleDownloadPlantilla = async () => {
    try {
      const { data } = await api.get('/ingesta/plantilla', { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a')
      a.href = url
      a.download = 'plantilla_reporte_ecourier.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Error al descargar plantilla')
    }
  }

  const handleResolve = async () => {
    if (!selectedEntity) return toast.error('Selecciona una entidad')
    try {
      const { data } = await api.post('/ingesta/resolver', {
        nombre_raw: resolveModal.nombre_raw,
        tipo: resolveModal.tipo,
        entidad_id: Number(selectedEntity),
      })
      toast.success(data.message)
      setResolveModal(null)
      setSelectedEntity('')
      loadPendientes()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al resolver')
    }
  }

  const openReprocessModal = () => {
    loadPeriodos()
    setSelectedPeriodo(null)
    setReprocessFile(null)
    setShowReprocess(true)
  }

  const tipoBadge = (v) => {
    const cls = v === 'SELLER' ? 'bg-blue-100 text-blue-700'
      : v === 'PICKUP' ? 'bg-purple-100 text-purple-700'
      : 'bg-green-100 text-green-700'
    return <span className={`text-xs font-medium px-2 py-1 rounded-full ${cls}`}>{v}</span>
  }

  const pendientesColumns = [
    { key: 'tipo', label: 'Tipo', render: tipoBadge },
    { key: 'nombre_raw', label: 'Nombre en Reporte' },
    { key: 'cantidad', label: 'Registros', align: 'center' },
  ]

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Ingesta de Reportes</h1>
        <p className="text-sm text-gray-500 mt-1">Sube el archivo Excel del software de gestión</p>
      </div>

      <div className="card mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Subir Reporte</h2>
          <div className="flex gap-2">
            <button onClick={openReprocessModal} className="btn-secondary flex items-center gap-2 text-sm">
              <RefreshCw size={16} /> Reprocesar Período
            </button>
            <button onClick={handleDownloadPlantilla} className="btn-secondary flex items-center gap-2 text-sm">
              <Download size={16} /> Plantilla
            </button>
          </div>
        </div>
        <FileUpload onUpload={handleUpload} loading={processing} />
        {processing && !progress && (
          <div className="mt-4 flex items-center gap-3 text-sm text-gray-500">
            <Loader2 size={18} className="animate-spin text-primary-500" />
            Iniciando procesamiento...
          </div>
        )}
      </div>

      {progress && <ProgressBar progress={progress} />}

      {result && progress?.status === 'completed' && (
        <div className="card mb-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <CheckCircle size={20} className="text-green-500" />
            Resumen Final
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-gray-500">Total Filas</p>
              <p className="text-xl font-bold">{formatNumber(result.total_filas)}</p>
            </div>
            <div className="bg-green-50 rounded-lg p-3">
              <p className="text-gray-500">Envíos Creados</p>
              <p className="text-xl font-bold text-green-600">{formatNumber(result.envios_creados)}</p>
            </div>
            <div className="bg-blue-50 rounded-lg p-3">
              <p className="text-gray-500">Duplicados Omitidos</p>
              <p className="text-xl font-bold text-blue-600">{formatNumber(result.duplicados_omitidos)}</p>
            </div>
            {result.eliminados_reproceso > 0 && (
              <div className="bg-amber-50 rounded-lg p-3">
                <p className="text-gray-500">Eliminados (Reproceso)</p>
                <p className="text-xl font-bold text-amber-600">{formatNumber(result.eliminados_reproceso)}</p>
              </div>
            )}
          </div>
          {result.sin_homologar_sellers?.length > 0 && (
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-sm font-medium text-amber-700">Sellers sin homologar ({result.sin_homologar_sellers.length}):</p>
              <p className="text-xs text-amber-600 mt-1">{result.sin_homologar_sellers.join(', ')}</p>
            </div>
          )}
          {result.sin_homologar_drivers?.length > 0 && (
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-sm font-medium text-amber-700">Drivers sin homologar ({result.sin_homologar_drivers.length}):</p>
              <p className="text-xs text-amber-600 mt-1">{result.sin_homologar_drivers.join(', ')}</p>
            </div>
          )}
          {result.errores?.length > 0 && (
            <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm font-medium text-red-700">Errores ({result.errores.length}):</p>
              <ul className="text-xs text-red-600 space-y-0.5 max-h-32 overflow-y-auto mt-1">
                {result.errores.slice(0, 50).map((e, i) => <li key={i}>{e}</li>)}
                {result.errores.length > 50 && (
                  <li className="font-medium">... y {result.errores.length - 50} errores más</li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}

      {pendientes.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <AlertTriangle size={20} className="text-amber-500" />
            Homologaciones Pendientes ({pendientes.length})
          </h2>
          <DataTable
            columns={[
              ...pendientesColumns,
              {
                key: 'actions', label: 'Acción', render: (_, row) => (
                  <button
                    onClick={(e) => { e.stopPropagation(); setResolveModal(row); setSelectedEntity('') }}
                    className="btn-primary text-xs py-1 px-3 flex items-center gap-1"
                  >
                    <Link size={14} /> Resolver
                  </button>
                ),
              },
            ]}
            data={pendientes}
          />
        </div>
      )}

      {/* Modal Resolver Homologación */}
      <Modal open={!!resolveModal} onClose={() => setResolveModal(null)} title="Resolver Homologación">
        {resolveModal && (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-sm text-gray-500">Nombre en reporte:</p>
              <p className="font-semibold">{resolveModal.nombre_raw}</p>
              <p className="text-xs text-gray-400 mt-1">
                Tipo: {resolveModal.tipo} — {resolveModal.cantidad} {resolveModal.tipo === 'PICKUP' ? 'recepciones' : 'envíos'}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Asignar a {resolveModal.tipo === 'SELLER' ? 'Seller' : resolveModal.tipo === 'PICKUP' ? 'Pickup' : 'Driver'}:
              </label>
              <select value={selectedEntity} onChange={(e) => setSelectedEntity(e.target.value)} className="input-field">
                <option value="">Seleccionar...</option>
                {(resolveModal.tipo === 'SELLER' ? sellers : resolveModal.tipo === 'PICKUP' ? pickups : drivers).map((e) => (
                  <option key={e.id} value={e.id}>{e.nombre}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setResolveModal(null)} className="btn-secondary">Cancelar</button>
              <button onClick={handleResolve} className="btn-primary">Resolver</button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal Reprocesar */}
      <Modal open={showReprocess} onClose={() => setShowReprocess(false)} title="Reprocesar Período">
        <div className="space-y-5">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="text-sm text-amber-800">
              Esta acción eliminará todos los envíos del período seleccionado y los volverá a procesar desde el archivo que subas. Las liquidaciones del período serán recalculadas.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">1. Selecciona el período a reprocesar:</label>
            {periodos.length === 0 ? (
              <p className="text-sm text-gray-400">No hay períodos con datos cargados.</p>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {periodos.map((p) => (
                  <label
                    key={`${p.semana}-${p.mes}-${p.anio}`}
                    className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedPeriodo?.semana === p.semana && selectedPeriodo?.mes === p.mes && selectedPeriodo?.anio === p.anio
                        ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="periodo"
                        className="accent-primary-500"
                        checked={selectedPeriodo?.semana === p.semana && selectedPeriodo?.mes === p.mes && selectedPeriodo?.anio === p.anio}
                        onChange={() => setSelectedPeriodo(p)}
                      />
                      <span className="text-sm font-medium">
                        Semana {p.semana} — {p.mes}/{p.anio}
                      </span>
                    </div>
                    <span className="text-xs text-gray-400">{formatNumber(p.total_envios)} envíos</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">2. Selecciona el archivo Excel:</label>
            <input
              type="file"
              accept=".xlsx,.xls"
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
              onChange={(e) => setReprocessFile(e.target.files[0])}
            />
          </div>

          {selectedPeriodo && reprocessFile && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm font-medium text-red-700">Confirmar reprocesamiento:</p>
              <p className="text-xs text-red-600 mt-1">
                Se eliminarán {formatNumber(selectedPeriodo.total_envios)} envíos de Semana {selectedPeriodo.semana},
                {' '}{selectedPeriodo.mes}/{selectedPeriodo.anio} y se volverán a procesar desde "{reprocessFile.name}".
              </p>
            </div>
          )}

          <div className="flex gap-3 justify-end">
            <button onClick={() => setShowReprocess(false)} className="btn-secondary">Cancelar</button>
            <button
              onClick={handleReprocess}
              disabled={!selectedPeriodo || !reprocessFile}
              className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw size={16} /> Reprocesar
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
