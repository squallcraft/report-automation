import { useState, useEffect, useCallback } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import PageHeader from '../../components/PageHeader'
import Modal from '../../components/Modal'
import { Plus, Pencil, Trash2, Search, BookOpen, Tag } from 'lucide-react'

const CATEGORIAS = [
  { value: 'empresa', label: 'Empresa', color: 'bg-blue-100 text-blue-700' },
  { value: 'servicios', label: 'Servicios', color: 'bg-green-100 text-green-700' },
  { value: 'tarifas', label: 'Tarifas', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'cobertura', label: 'Cobertura', color: 'bg-purple-100 text-purple-700' },
  { value: 'integraciones', label: 'Integraciones', color: 'bg-indigo-100 text-indigo-700' },
  { value: 'faq', label: 'FAQ', color: 'bg-orange-100 text-orange-700' },
  { value: 'objeciones', label: 'Objeciones', color: 'bg-red-100 text-red-700' },
]

const CAT_MAP = Object.fromEntries(CATEGORIAS.map(c => [c.value, c]))

const emptyForm = { categoria: 'empresa', titulo: '', contenido: '', keywords: '', orden: 0 }

export default function LeadsKB() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [filterCat, setFilterCat] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(() => {
    const params = {}
    if (filterCat) params.categoria = filterCat
    api.get('/leads/kb/entries', { params }).then(r => {
      setEntries(r.data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [filterCat])

  useEffect(() => { load() }, [load])

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setShowModal(true)
  }

  const openEdit = (entry) => {
    setEditing(entry)
    setForm({
      categoria: entry.categoria,
      titulo: entry.titulo,
      contenido: entry.contenido,
      keywords: (entry.keywords || []).join(', '),
      orden: entry.orden || 0,
    })
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!form.titulo.trim() || !form.contenido.trim()) {
      toast.error('Título y contenido son requeridos')
      return
    }
    const payload = {
      categoria: form.categoria,
      titulo: form.titulo.trim(),
      contenido: form.contenido.trim(),
      keywords: form.keywords.split(',').map(k => k.trim()).filter(Boolean),
      orden: Number(form.orden) || 0,
    }
    try {
      if (editing) {
        await api.patch(`/leads/kb/entries/${editing.id}`, payload)
        toast.success('Entrada actualizada')
      } else {
        await api.post('/leads/kb/entries', payload)
        toast.success('Entrada creada')
      }
      setShowModal(false)
      load()
    } catch {
      toast.error('Error guardando')
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar esta entrada del conocimiento?')) return
    try {
      await api.delete(`/leads/kb/entries/${id}`)
      toast.success('Eliminada')
      load()
    } catch {
      toast.error('Error')
    }
  }

  const filtered = entries.filter(e => {
    if (search) {
      const s = search.toLowerCase()
      return e.titulo.toLowerCase().includes(s) || e.contenido.toLowerCase().includes(s)
    }
    return true
  })

  const grouped = CATEGORIAS.reduce((acc, cat) => {
    const items = filtered.filter(e => e.categoria === cat.value)
    if (items.length > 0) acc.push({ ...cat, items })
    return acc
  }, [])

  return (
    <div>
      <PageHeader
        title="Base de Conocimiento"
        subtitle={`${entries.length} entradas que alimentan al agente IA`}
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm font-medium"
        >
          <Plus size={16} /> Nueva entrada
        </button>

        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>

        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => setFilterCat('')}
            className={`px-3 py-1.5 rounded-full text-xs border ${!filterCat ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            Todas
          </button>
          {CATEGORIAS.map(c => (
            <button
              key={c.value}
              onClick={() => setFilterCat(filterCat === c.value ? '' : c.value)}
              className={`px-3 py-1.5 rounded-full text-xs border ${filterCat === c.value ? 'ring-2 ring-blue-400' : ''} ${c.color}`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-center text-gray-400 py-8">Cargando...</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <BookOpen size={48} className="mx-auto mb-3 text-gray-300" />
          <p className="text-gray-400 text-sm">Sin entradas en la base de conocimiento</p>
          <p className="text-gray-400 text-xs mt-1">El agente no podrá responder preguntas hasta que cargues contenido aquí</p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(group => (
            <div key={group.value}>
              <h3 className="text-sm font-semibold text-gray-600 mb-2 flex items-center gap-2">
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs ${group.color}`}>{group.label}</span>
                <span className="text-gray-400 font-normal">{group.items.length} entradas</span>
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {group.items.map(entry => (
                  <div key={entry.id} className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-sm transition-shadow">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-medium text-sm text-gray-900">{entry.titulo}</h4>
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => openEdit(entry)} className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => handleDelete(entry.id)} className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-500">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-2 line-clamp-4 whitespace-pre-wrap">{entry.contenido}</p>
                    {entry.keywords?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {entry.keywords.map((kw, i) => (
                          <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-500 rounded text-[10px]">
                            <Tag size={8} />{kw}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <Modal onClose={() => setShowModal(false)} title={editing ? 'Editar entrada' : 'Nueva entrada'}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Categoría</label>
              <select
                value={form.categoria}
                onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Título</label>
              <input
                type="text"
                value={form.titulo}
                onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="Ej: Tarifas de envío RM"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Contenido</label>
              <textarea
                value={form.contenido}
                onChange={e => setForm(f => ({ ...f, contenido: e.target.value }))}
                rows={6}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="Escribe aquí la información que el agente usará para responder..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Keywords (separadas por coma)</label>
              <input
                type="text"
                value={form.keywords}
                onChange={e => setForm(f => ({ ...f, keywords: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="tarifa, precio, costo, envío"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Orden (menor = más arriba)</label>
              <input
                type="number"
                value={form.orden}
                onChange={e => setForm(f => ({ ...f, orden: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                Cancelar
              </button>
              <button onClick={handleSave} className="px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-medium">
                {editing ? 'Guardar cambios' : 'Crear entrada'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
