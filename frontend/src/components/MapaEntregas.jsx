import { useState, useEffect, useMemo, useRef } from 'react'
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import { Map as MapIcon, Loader2, MapPin, AlertTriangle } from 'lucide-react'
import api from '../api'

// Centro por defecto: Santiago, Chile
const DEFAULT_CENTER = [-33.4489, -70.6693]
const DEFAULT_ZOOM = 11

const STATE_META = {
  1: { color: '#10b981', label: 'Same-Day', glow: 'rgba(16,185,129,0.6)' },
  2: { color: '#f59e0b', label: 'Entregado (>0d)', glow: 'rgba(245,158,11,0.6)' },
  0: { color: '#94a3b8', label: 'Sin entrega', glow: 'rgba(148,163,184,0.6)' },
  3: { color: '#ef4444', label: 'Cancelado', glow: 'rgba(239,68,68,0.6)' },
}

/** Cluster icon coloreado por % same-day del cluster. */
function buildClusterIcon(cluster) {
  const markers = cluster.getAllChildMarkers()
  let same = 0, otros = 0
  markers.forEach(m => {
    const s = m.options?.estado
    if (s === 1) same++
    else if (s != null) otros++
  })
  const total = same + otros
  const pct = total > 0 ? Math.round((same / total) * 100) : 0
  let bg = '#94a3b8'
  if (total > 0) {
    if (pct >= 80) bg = '#10b981'
    else if (pct >= 60) bg = '#34d399'
    else if (pct >= 40) bg = '#f59e0b'
    else if (pct >= 20) bg = '#f97316'
    else bg = '#ef4444'
  }
  const size = Math.min(64, 28 + Math.log10(total + 1) * 14)
  return L.divIcon({
    html: `
      <div style="
        background:${bg};
        color:white;
        width:${size}px;height:${size}px;
        border-radius:50%;
        display:flex;align-items:center;justify-content:center;
        flex-direction:column;
        box-shadow: 0 4px 12px rgba(0,0,0,0.25), 0 0 0 4px rgba(255,255,255,0.8);
        font-weight:800;
        font-family:system-ui,sans-serif;
      ">
        <div style="font-size:${size > 40 ? 13 : 11}px;line-height:1">${total}</div>
        <div style="font-size:9px;opacity:0.95;margin-top:1px">${pct}% SD</div>
      </div>
    `,
    className: 'mapa-cluster-icon',
    iconSize: L.point(size, size, true),
  })
}

function FitBoundsOnData({ puntos }) {
  const map = useMap()
  const fittedRef = useRef(false)
  useEffect(() => {
    if (fittedRef.current) return
    if (!puntos?.length) return
    try {
      const bounds = L.latLngBounds(puntos.map(p => [p.la, p.lo]))
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 })
      fittedRef.current = true
    } catch {}
  }, [puntos, map])
  return null
}

export default function MapaEntregas({ mes, anio, driverId, sellerId, height = 480 }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [filtroEstado, setFiltroEstado] = useState('todos')

  useEffect(() => {
    let cancelado = false
    const fetchPuntos = async () => {
      setLoading(true); setError(null)
      try {
        const params = { limite: 8000 }
        if (mes != null) params.mes = mes
        if (anio != null) params.anio = anio
        if (driverId != null) params.driver_id = driverId
        if (sellerId != null) params.seller_id = sellerId
        const r = await api.get('/dashboard/efectividad-v2/mapa', { params })
        if (cancelado) return
        setData(r.data)
      } catch (e) {
        if (cancelado) return
        setError(e?.response?.data?.detail || e.message || 'Error al cargar mapa')
      } finally {
        if (!cancelado) setLoading(false)
      }
    }
    fetchPuntos()
    return () => { cancelado = true }
  }, [mes, anio, driverId, sellerId])

  const puntosFiltrados = useMemo(() => {
    if (!data?.puntos) return []
    if (filtroEstado === 'todos') return data.puntos
    const codigo = { same_day: 1, entregado_no_sd: 2, sin_entrega: 0, cancelado: 3 }[filtroEstado]
    return data.puntos.filter(p => p.s === codigo)
  }, [data, filtroEstado])

  const cobertura = data
    ? data.total_asignaciones_periodo > 0
      ? Math.round((data.puntos_count / data.total_asignaciones_periodo) * 1000) / 10
      : 0
    : null

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
            <MapIcon size={16} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-700">Mapa de entregas</p>
            <p className="text-[10px] text-gray-400">
              {data
                ? `${data.puntos_count.toLocaleString('es-CL')} envíos con coordenadas · cobertura ${cobertura}%`
                : 'Cargando…'}
              {data?.truncado && ' · resultado truncado'}
            </p>
          </div>
        </div>
        {/* Filtros de estado */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {[
            { key: 'todos', label: 'Todos', color: '#6366f1' },
            { key: 'same_day', label: 'Same-Day', color: STATE_META[1].color },
            { key: 'entregado_no_sd', label: 'Entregado >0d', color: STATE_META[2].color },
            { key: 'sin_entrega', label: 'Sin entrega', color: STATE_META[0].color },
            { key: 'cancelado', label: 'Cancelado', color: STATE_META[3].color },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setFiltroEstado(f.key)}
              className={`text-[11px] px-2.5 py-1 rounded-full font-semibold border transition ${
                filtroEstado === f.key
                  ? 'text-white border-transparent shadow-sm'
                  : 'text-gray-600 border-gray-200 bg-white hover:bg-gray-50'
              }`}
              style={filtroEstado === f.key ? { backgroundColor: f.color } : {}}
            >
              {f.label}
              {data?.resumen && f.key !== 'todos' && (
                <span className="ml-1 opacity-80">
                  {filtroEstado === f.key ? '' : `(${(data.resumen[f.key] ?? 0).toLocaleString('es-CL')})`}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Cuerpo: mapa */}
      <div className="relative" style={{ height }}>
        {loading && (
          <div className="absolute inset-0 z-[400] bg-white/70 backdrop-blur-sm flex items-center justify-center">
            <div className="flex items-center gap-2 text-gray-600">
              <Loader2 size={18} className="animate-spin" />
              <span className="text-sm">Cargando puntos…</span>
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 z-[400] bg-red-50 flex items-center justify-center text-red-600 text-sm">
            <AlertTriangle size={16} className="mr-2" /> {error}
          </div>
        )}
        {!loading && data && data.puntos_count === 0 && (
          <div className="absolute inset-0 z-[400] flex items-center justify-center text-gray-400">
            <div className="text-center">
              <MapPin size={32} className="mx-auto mb-2 opacity-40" />
              <p className="text-sm">No hay envíos con coordenadas en el período seleccionado.</p>
              <p className="text-[11px] mt-1">Sube el archivo de coordenadas en <code>/admin/coordenadas</code> para enriquecer.</p>
            </div>
          </div>
        )}

        <MapContainer
          center={DEFAULT_CENTER}
          zoom={DEFAULT_ZOOM}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom
          preferCanvas
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitBoundsOnData puntos={puntosFiltrados} />
          <MarkerClusterGroup
            chunkedLoading
            maxClusterRadius={55}
            iconCreateFunction={buildClusterIcon}
            spiderfyOnMaxZoom
          >
            {puntosFiltrados.map((p, idx) => {
              const meta = STATE_META[p.s] || STATE_META[0]
              return (
                <CircleMarker
                  key={`${p.t}-${idx}`}
                  center={[p.la, p.lo]}
                  radius={6}
                  pathOptions={{
                    color: meta.color,
                    fillColor: meta.color,
                    fillOpacity: 0.85,
                    weight: 1,
                  }}
                  estado={p.s}
                >
                  <Tooltip direction="top" offset={[0, -5]} opacity={0.95}>
                    <div className="text-xs leading-snug">
                      <div className="font-bold text-gray-700">{p.t}</div>
                      <div className="mt-0.5 flex items-center gap-1">
                        <span
                          className="inline-block w-2 h-2 rounded-full"
                          style={{ background: meta.color }}
                        />
                        <span className="text-gray-600">{meta.label}</span>
                      </div>
                      {p.r && <div className="text-gray-500">Ruta: {p.r}</div>}
                      {p.co && <div className="text-gray-500">Comuna: {p.co}</div>}
                      {p.fr && <div className="text-gray-400">Retiro: {p.fr}</div>}
                      {p.fe && <div className="text-gray-400">Entrega: {p.fe}</div>}
                    </div>
                  </Tooltip>
                </CircleMarker>
              )
            })}
          </MarkerClusterGroup>
        </MapContainer>

        {/* Leyenda flotante */}
        <div className="absolute bottom-3 left-3 z-[400] bg-white/95 backdrop-blur rounded-lg shadow-lg border border-gray-100 px-3 py-2 text-[11px] space-y-1">
          <div className="font-semibold text-gray-700 mb-1">Estados</div>
          {[1, 2, 0, 3].map(k => (
            <div key={k} className="flex items-center gap-2">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ background: STATE_META[k].color }}
              />
              <span className="text-gray-600">{STATE_META[k].label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
