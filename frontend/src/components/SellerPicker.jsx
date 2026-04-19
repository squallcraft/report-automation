/**
 * SellerPicker — selector multi-seller con buscador y filtro por tag.
 * Props:
 *   selected: number[]   — IDs seleccionados
 *   onChange(ids): void  — callback cuando cambia la selección
 *   color: string        — color de acento (default '#2563eb')
 *   requireEmail: bool   — si true, solo muestra sellers con email
 *   requireWa: bool      — si true, solo muestra sellers con teléfono WA
 */
import { useState, useEffect, useMemo } from 'react'
import { Search, Check, X, Users } from 'lucide-react'
import api from '../api'

export default function SellerPicker({ selected = [], onChange, color = '#2563eb', requireEmail = false, requireWa = false }) {
  const [sellers, setSellers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [tagFilter, setTagFilter] = useState(null)

  useEffect(() => {
    setLoading(true)
    api.get('/sellers', { params: { activo: true } })
      .then(r => setSellers(r.data))
      .finally(() => setLoading(false))
  }, [])

  const allTags = useMemo(() => {
    const seen = new Set()
    sellers.forEach(s => (s.tags || []).forEach(t => t && seen.add(t.trim().toLowerCase())))
    return [...seen].sort()
  }, [sellers])

  const visible = useMemo(() => {
    return sellers.filter(s => {
      if (requireEmail && !s.email) return false
      if (requireWa && !s.telefono_whatsapp) return false
      if (tagFilter && !(s.tags || []).includes(tagFilter)) return false
      if (search) {
        const q = search.toLowerCase()
        return (s.nombre || '').toLowerCase().includes(q) ||
               (s.empresa || '').toLowerCase().includes(q) ||
               (s.email || '').toLowerCase().includes(q)
      }
      return true
    })
  }, [sellers, search, tagFilter, requireEmail, requireWa])

  const selSet = new Set(selected)

  function toggle(id) {
    if (selSet.has(id)) onChange(selected.filter(x => x !== id))
    else onChange([...selected, id])
  }

  function selectAll() { onChange([...new Set([...selected, ...visible.map(s => s.id)])]) }
  function clearAll()  { const vis = new Set(visible.map(s => s.id)); onChange(selected.filter(id => !vis.has(id))) }

  const colorDim = `${color}18`

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {/* Barra de búsqueda */}
      <div className="p-3 border-b border-gray-100 bg-gray-50 space-y-2">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre, empresa o email…"
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 bg-white"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={13} />
            </button>
          )}
        </div>
        {/* Tags */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {allTags.map(t => (
              <button key={t} onClick={() => setTagFilter(tagFilter === t ? null : t)}
                className="px-2 py-0.5 rounded-full text-xs font-medium transition-colors"
                style={tagFilter === t
                  ? { background: color, color: '#fff' }
                  : { background: colorDim, color: color }}>
                {t}
              </button>
            ))}
          </div>
        )}
        {/* Acciones masivas */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-500">
            {loading ? 'Cargando…' : `${visible.length} sellers${tagFilter ? ` con tag "${tagFilter}"` : ''}`}
          </span>
          <div className="flex gap-3">
            <button onClick={selectAll} className="text-blue-600 hover:underline">Seleccionar visibles</button>
            <button onClick={clearAll} className="text-gray-500 hover:underline">Quitar visibles</button>
          </div>
        </div>
      </div>

      {/* Lista */}
      <div className="max-h-60 overflow-y-auto divide-y divide-gray-50">
        {loading ? (
          <div className="text-center text-sm text-gray-400 py-8">Cargando sellers…</div>
        ) : visible.length === 0 ? (
          <div className="text-center text-sm text-gray-400 py-8">Sin resultados</div>
        ) : visible.map(s => {
          const sel = selSet.has(s.id)
          return (
            <button key={s.id} onClick={() => toggle(s.id)}
              className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
              style={sel ? { background: colorDim } : {}}>
              <div className="flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center"
                style={sel ? { background: color, borderColor: color } : { borderColor: '#d1d5db' }}>
                {sel && <Check size={10} color="#fff" strokeWidth={3} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900 truncate">{s.nombre}</p>
                {s.empresa && <p className="text-xs text-gray-500 truncate">{s.empresa}</p>}
              </div>
              {(s.tags || []).filter(t => !t.startsWith('auto:')).slice(0, 2).map(t => (
                <span key={t} className="shrink-0 px-1.5 py-0.5 rounded text-xs"
                  style={{ background: colorDim, color: color }}>{t}</span>
              ))}
            </button>
          )
        })}
      </div>

      {/* Footer contador */}
      {selected.length > 0 && (
        <div className="px-3 py-2 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
          <span className="text-xs text-gray-600 flex items-center gap-1">
            <Users size={11} />
            <strong>{selected.length}</strong> seller{selected.length !== 1 ? 's' : ''} seleccionado{selected.length !== 1 ? 's' : ''}
          </span>
          <button onClick={() => onChange([])} className="text-xs text-red-400 hover:text-red-600">Limpiar todo</button>
        </div>
      )}
    </div>
  )
}
