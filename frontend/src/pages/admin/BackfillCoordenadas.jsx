import { useState, useEffect, useRef, useCallback } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import {
  MapPin, UploadCloud, FileSpreadsheet, CheckCircle2, AlertTriangle,
  Loader2, RefreshCw, Map as MapIcon,
} from 'lucide-react'
import PageHeader from '../../components/PageHeader'

const POLL_MS = 1500

function fmt(n) { return (n ?? 0).toLocaleString('es-CL') }

export default function BackfillCoordenadas() {
  const [archivo, setArchivo] = useState(null)
  const [sobreescribir, setSobreescribir] = useState(false)
  const [taskId, setTaskId] = useState(null)
  const [progress, setProgress] = useState(null)
  const [cobertura, setCobertura] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)
  const pollRef = useRef(null)

  const cargarCobertura = useCallback(async () => {
    try {
      const r = await api.get('/envios/coordenadas/cobertura')
      setCobertura(r.data)
    } catch (e) {
      console.error('cobertura', e)
    }
  }, [])

  useEffect(() => { cargarCobertura() }, [cargarCobertura])

  // Polling de la task
  useEffect(() => {
    if (!taskId) return
    const tick = async () => {
      try {
        const r = await api.get(`/envios/coordenadas/backfill/progress/${taskId}`)
        setProgress(r.data)
        if (r.data.status === 'done' || r.data.status === 'error') {
          clearInterval(pollRef.current)
          pollRef.current = null
          if (r.data.status === 'done') {
            toast.success('Backfill completado')
            cargarCobertura()
          } else {
            toast.error(r.data.message || 'Error en backfill')
          }
        }
      } catch (e) {
        console.error('poll', e)
      }
    }
    tick()
    pollRef.current = setInterval(tick, POLL_MS)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [taskId, cargarCobertura])

  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) setArchivo(f)
  }

  const onSelect = (e) => {
    const f = e.target.files?.[0]
    if (f) setArchivo(f)
  }

  const subir = async () => {
    if (!archivo) { toast.error('Selecciona un archivo'); return }
    const fd = new FormData()
    fd.append('archivo', archivo)
    try {
      const r = await api.post(
        `/envios/coordenadas/backfill?sobreescribir=${sobreescribir}`,
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      setTaskId(r.data.task_id)
      setProgress({ status: 'running', total: r.data.filas_archivo, processed: 0, message: 'Iniciando…' })
      toast.success(`${fmt(r.data.filas_archivo)} filas en cola`)
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Error al subir archivo')
    }
  }

  const reset = () => {
    setArchivo(null)
    setTaskId(null)
    setProgress(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const stats = cobertura ? [
    { label: 'Envíos totales', value: fmt(cobertura.global.total) },
    { label: 'Con coords', value: fmt(cobertura.global.con_coordenadas) },
    { label: 'Cobertura', value: `${cobertura.global.cobertura_pct}%` },
  ] : []

  const pct = progress?.total
    ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
    : 0

  const corriendo = progress?.status === 'running' || progress?.status === 'pending'
  const resultado = progress?.result

  return (
    <div>
      <PageHeader
        title="Coordenadas de envíos"
        subtitle="Backfill geográfico desde Excel/CSV. Se usa para el mapa BI de entregas."
        icon={MapIcon}
        accent="teal"
        stats={stats}
      />

      {/* Cobertura por mes */}
      {cobertura?.por_mes?.length > 0 && (
        <div className="mb-6 bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <p className="text-sm font-semibold text-gray-700 mb-3">Cobertura mensual</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            {cobertura.por_mes.map((m) => (
              <div key={`${m.anio}-${m.mes}`} className="rounded-lg border border-gray-100 p-3">
                <p className="text-[10px] text-gray-400 uppercase tracking-wide">{m.mes}/{m.anio}</p>
                <p className="text-2xl font-black text-gray-700 mt-1">{m.cobertura_pct}%</p>
                <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${
                      m.cobertura_pct >= 80 ? 'bg-emerald-500' :
                      m.cobertura_pct >= 50 ? 'bg-amber-400' : 'bg-red-400'
                    }`}
                    style={{ width: `${m.cobertura_pct}%` }}
                  />
                </div>
                <p className="text-[10px] text-gray-400 mt-1.5">
                  {fmt(m.con_coordenadas)} / {fmt(m.total)} envíos
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Drop zone */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => !corriendo && inputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition ${
            dragOver
              ? 'border-emerald-400 bg-emerald-50/50'
              : 'border-gray-200 hover:border-emerald-300 hover:bg-emerald-50/30'
          } ${corriendo ? 'opacity-60 pointer-events-none' : ''}`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={onSelect}
            className="hidden"
          />
          {!archivo ? (
            <>
              <UploadCloud size={42} className="mx-auto text-gray-400 mb-3" />
              <p className="text-sm font-semibold text-gray-700">
                Arrastra el archivo aquí o haz click para seleccionar
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Excel (.xlsx) o CSV con columnas: <code>tracking_id</code>, <code>lat</code>, <code>lon</code>
              </p>
              <p className="text-[11px] text-gray-400 mt-2">
                Coordenadas en formato chileno aceptadas: <code>-33,4709</code> o <code>-33.4709</code>
              </p>
            </>
          ) : (
            <>
              <FileSpreadsheet size={42} className="mx-auto text-emerald-500 mb-3" />
              <p className="text-sm font-semibold text-gray-700">{archivo.name}</p>
              <p className="text-xs text-gray-500 mt-1">{(archivo.size / 1024).toFixed(1)} KB</p>
            </>
          )}
        </div>

        {/* Opciones + acción */}
        <div className="mt-5 flex items-center justify-between flex-wrap gap-3">
          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={sobreescribir}
              onChange={(e) => setSobreescribir(e.target.checked)}
              disabled={corriendo}
              className="rounded text-emerald-500 focus:ring-emerald-300"
            />
            <span>Sobreescribir coordenadas existentes</span>
            <span className="text-gray-400">(por defecto solo se rellenan envíos sin coords)</span>
          </label>
          <div className="flex items-center gap-2">
            {archivo && !corriendo && (
              <button
                onClick={reset}
                className="text-xs px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50"
              >
                Limpiar
              </button>
            )}
            <button
              onClick={subir}
              disabled={!archivo || corriendo}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-sm font-semibold shadow-sm hover:shadow disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {corriendo ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />}
              Subir y procesar
            </button>
          </div>
        </div>

        {/* Progreso */}
        {progress && (
          <div className="mt-6 rounded-xl border border-gray-100 bg-gray-50/50 p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                {progress.status === 'done' ? (
                  <CheckCircle2 size={16} className="text-emerald-500" />
                ) : progress.status === 'error' ? (
                  <AlertTriangle size={16} className="text-red-500" />
                ) : (
                  <Loader2 size={16} className="text-blue-500 animate-spin" />
                )}
                {progress.status === 'done' ? 'Completado' : progress.status === 'error' ? 'Error' : 'Procesando…'}
              </p>
              <p className="text-xs text-gray-500">
                {fmt(progress.processed)} / {fmt(progress.total)} ({pct}%)
              </p>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  progress.status === 'error' ? 'bg-red-500' :
                  progress.status === 'done' ? 'bg-emerald-500' :
                  'bg-blue-500'
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-2">{progress.message}</p>

            {resultado && (
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                <ResCard label="Filas archivo" value={resultado.total_filas} accent="slate" />
                <ResCard label="Matcheados" value={resultado.matcheados} accent="blue" />
                <ResCard label="Actualizados" value={resultado.actualizados} accent="emerald" />
                <ResCard label="Ya tenían" value={resultado.ya_tenian_coordenada} accent="amber" />
                <ResCard label="No encontrados" value={resultado.no_matcheados} accent="orange" />
                <ResCard label="Fuera de rango" value={resultado.fuera_rango_chile} accent="red" />
              </div>
            )}
          </div>
        )}

        {/* Refrescar cobertura */}
        <div className="mt-4 flex justify-end">
          <button
            onClick={cargarCobertura}
            className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
          >
            <RefreshCw size={12} /> Refrescar cobertura
          </button>
        </div>
      </div>
    </div>
  )
}

function ResCard({ label, value, accent = 'slate' }) {
  const map = {
    slate: 'text-slate-600 bg-slate-50',
    blue: 'text-blue-600 bg-blue-50',
    emerald: 'text-emerald-600 bg-emerald-50',
    amber: 'text-amber-600 bg-amber-50',
    orange: 'text-orange-600 bg-orange-50',
    red: 'text-red-600 bg-red-50',
  }
  return (
    <div className={`rounded-lg p-3 ${map[accent] || map.slate}`}>
      <p className="text-[10px] uppercase tracking-wide opacity-80">{label}</p>
      <p className="text-2xl font-black mt-1">{fmt(value)}</p>
    </div>
  )
}
