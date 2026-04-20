import { useState, useEffect, useCallback, useMemo } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import PageHeader from '../../components/PageHeader'
import Modal from '../../components/Modal'
import { FileText, Plus, Eye, CheckCircle, XCircle, Pencil, Copy, AlertCircle } from 'lucide-react'

const TIPOS_CONTRATO = [
  { value: '', label: '— Cualquiera —' },
  { value: 'INDEFINIDO', label: 'Indefinido' },
  { value: 'PLAZO_FIJO', label: 'Plazo fijo' },
  { value: 'OBRA_FAENA', label: 'Obra o faena' },
  { value: 'PART_TIME', label: 'Part-time' },
]

const initialForm = {
  slug: '',
  nombre: '',
  descripcion: '',
  tipo_contrato: '',
  aplica_a_cargos: '',
  aplica_a_jornadas: '',
  contenido: '',
  notas_version: '',
}

function VariablesPanel({ variables, onInsert }) {
  const grupos = useMemo(() => {
    const g = {}
    for (const v of variables) {
      g[v.grupo] = g[v.grupo] || []
      g[v.grupo].push(v)
    }
    return g
  }, [variables])

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 max-h-[60vh] overflow-y-auto">
      <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Variables disponibles</p>
      {Object.entries(grupos).map(([grupo, items]) => (
        <div key={grupo} className="mb-3">
          <p className="text-xs font-medium text-gray-700 mb-1">{grupo}</p>
          <div className="flex flex-wrap gap-1">
            {items.map(v => (
              <button
                key={v.key}
                type="button"
                onClick={() => onInsert(v.key)}
                title={v.label}
                className="text-xs px-2 py-0.5 rounded border border-blue-200 bg-white text-blue-700 hover:bg-blue-50"
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="text-[11px] text-gray-400 mt-2">
        Insertar copia <code className="bg-gray-200 px-1 rounded">{'{{clave}}'}</code> en el editor.
      </p>
    </div>
  )
}

function PreviewModal({ plantilla, open, onClose }) {
  const [trabajadores, setTrabajadores] = useState([])
  const [trabId, setTrabId] = useState('')
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    api.get('/trabajadores?activo=true').then(({ data }) => setTrabajadores(data || []))
  }, [open])

  const generar = () => {
    if (!trabId) { toast.error('Selecciona un trabajador'); return }
    setLoading(true)
    api.post(`/plantillas-contrato/${plantilla.id}/preview`, { trabajador_id: Number(trabId) })
      .then(({ data }) => setPreview(data))
      .catch(() => toast.error('No se pudo generar la previsualización'))
      .finally(() => setLoading(false))
  }

  return (
    <Modal open={open} onClose={onClose} title={`Previsualizar — ${plantilla?.nombre}`} size="xl">
      <div className="space-y-4">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Trabajador para previsualizar</label>
            <select className="input-field" value={trabId} onChange={e => setTrabId(e.target.value)}>
              <option value="">Selecciona...</option>
              {trabajadores.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
          </div>
          <button onClick={generar} disabled={!trabId || loading} className="btn-primary">
            {loading ? 'Generando...' : 'Renderizar'}
          </button>
        </div>
        {preview && (
          <>
            {preview.faltantes?.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <div className="font-semibold flex items-center gap-1.5 mb-1">
                  <AlertCircle size={16} /> Faltan datos para completar el contrato:
                </div>
                <div className="flex flex-wrap gap-1">
                  {preview.faltantes.map(f => (
                    <code key={f} className="bg-amber-100 px-1.5 py-0.5 rounded text-amber-900">{f}</code>
                  ))}
                </div>
              </div>
            )}
            <div className="bg-white border border-gray-200 rounded-lg p-4 max-h-[60vh] overflow-y-auto">
              <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800">{preview.rendered}</pre>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

export default function PlantillasContrato() {
  const [items, setItems] = useState([])
  const [variables, setVariables] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState({ ...initialForm })
  const [filtroActivas, setFiltroActivas] = useState(false)
  const [previewItem, setPreviewItem] = useState(null)
  const [editorRef, setEditorRef] = useState(null)

  const fetchAll = useCallback(() => {
    const params = filtroActivas ? { activa: true } : {}
    api.get('/plantillas-contrato', { params }).then(({ data }) => setItems(data || []))
  }, [filtroActivas])

  useEffect(() => { fetchAll() }, [fetchAll])
  useEffect(() => {
    api.get('/plantillas-contrato/variables').then(({ data }) => setVariables(data || []))
  }, [])

  const openNew = () => {
    setEditId(null)
    setForm({ ...initialForm })
    setShowModal(true)
  }

  const openEdit = (p) => {
    setEditId(p.id)
    setForm({
      slug: p.slug,
      nombre: p.nombre,
      descripcion: p.descripcion || '',
      tipo_contrato: p.tipo_contrato || '',
      aplica_a_cargos: (p.aplica_a_cargos || []).join(', '),
      aplica_a_jornadas: (p.aplica_a_jornadas || []).join(', '),
      contenido: p.contenido || '',
      notas_version: p.notas_version || '',
    })
    setShowModal(true)
  }

  const submit = async (e) => {
    e.preventDefault()
    const payload = {
      slug: form.slug.trim(),
      nombre: form.nombre.trim(),
      descripcion: form.descripcion || null,
      tipo_contrato: form.tipo_contrato || null,
      aplica_a_cargos: form.aplica_a_cargos
        ? form.aplica_a_cargos.split(',').map(s => s.trim()).filter(Boolean)
        : null,
      aplica_a_jornadas: form.aplica_a_jornadas
        ? form.aplica_a_jornadas.split(',').map(s => parseInt(s.trim(), 10)).filter(Number.isFinite)
        : null,
      contenido: form.contenido,
      notas_version: form.notas_version || null,
    }
    try {
      if (editId) {
        await api.put(`/plantillas-contrato/${editId}`, payload)
        toast.success('Plantilla actualizada')
      } else {
        await api.post('/plantillas-contrato', payload)
        toast.success('Plantilla creada')
      }
      setShowModal(false)
      fetchAll()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al guardar')
    }
  }

  const insertVar = (key) => {
    const placeholder = `{{${key}}}`
    if (editorRef) {
      const start = editorRef.selectionStart
      const end = editorRef.selectionEnd
      const before = form.contenido.substring(0, start)
      const after = form.contenido.substring(end)
      const next = before + placeholder + after
      setForm(f => ({ ...f, contenido: next }))
      setTimeout(() => {
        editorRef.focus()
        editorRef.selectionStart = editorRef.selectionEnd = start + placeholder.length
      }, 0)
    } else {
      setForm(f => ({ ...f, contenido: f.contenido + placeholder }))
    }
  }

  const activar = (p) => api.post(`/plantillas-contrato/${p.id}/activar`).then(() => { toast.success('Activada'); fetchAll() })
  const desactivar = (p) => api.post(`/plantillas-contrato/${p.id}/desactivar`).then(() => { toast.success('Desactivada'); fetchAll() })
  const nuevaVersion = (p) => {
    setEditId(null)
    setForm({
      slug: p.slug,
      nombre: p.nombre,
      descripcion: p.descripcion || '',
      tipo_contrato: p.tipo_contrato || '',
      aplica_a_cargos: (p.aplica_a_cargos || []).join(', '),
      aplica_a_jornadas: (p.aplica_a_jornadas || []).join(', '),
      contenido: p.contenido || '',
      notas_version: '',
    })
    setShowModal(true)
  }

  return (
    <div>
      <PageHeader
        icon={FileText}
        title="Plantillas de Contrato"
        subtitle="Gestiona plantillas reusables para generar contratos digitales (Camino B)."
        actions={(
          <button onClick={openNew} className="btn-primary">
            <Plus size={16} /> Nueva plantilla
          </button>
        )}
      />

      <div className="mb-3">
        <label className="text-sm text-gray-600 inline-flex items-center gap-2">
          <input type="checkbox" checked={filtroActivas} onChange={e => setFiltroActivas(e.target.checked)} />
          Solo activas
        </label>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left px-3 py-2">Slug</th>
              <th className="text-left px-3 py-2">Nombre</th>
              <th className="text-left px-3 py-2">Tipo</th>
              <th className="text-center px-3 py-2">Versión</th>
              <th className="text-center px-3 py-2">Activa</th>
              <th className="text-right px-3 py-2">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {items.map(p => (
              <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2 font-mono text-xs">{p.slug}</td>
                <td className="px-3 py-2">
                  <div className="font-medium text-gray-900">{p.nombre}</div>
                  {p.descripcion && <div className="text-xs text-gray-500">{p.descripcion}</div>}
                </td>
                <td className="px-3 py-2 text-gray-600">{p.tipo_contrato || '—'}</td>
                <td className="px-3 py-2 text-center">v{p.version}</td>
                <td className="px-3 py-2 text-center">
                  {p.activa ? <CheckCircle className="inline text-emerald-600" size={16} /> : <XCircle className="inline text-gray-300" size={16} />}
                </td>
                <td className="px-3 py-2 text-right space-x-1">
                  <button onClick={() => setPreviewItem(p)} className="btn-ghost-sm" title="Previsualizar">
                    <Eye size={14} />
                  </button>
                  <button onClick={() => openEdit(p)} className="btn-ghost-sm" title="Editar">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => nuevaVersion(p)} className="btn-ghost-sm" title="Nueva versión">
                    <Copy size={14} />
                  </button>
                  {p.activa
                    ? <button onClick={() => desactivar(p)} className="btn-ghost-sm" title="Desactivar"><XCircle size={14} /></button>
                    : <button onClick={() => activar(p)} className="btn-ghost-sm" title="Activar"><CheckCircle size={14} /></button>}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={6} className="text-center text-gray-400 py-6">Sin plantillas todavía. Crea la primera con el botón superior.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editId ? 'Editar plantilla' : 'Nueva plantilla'} size="4xl">
        <form onSubmit={submit} className="grid grid-cols-12 gap-4">
          <div className="col-span-12 md:col-span-9 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Slug *</label>
                <input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} className="input-field font-mono" placeholder="indefinido_administrativo" required disabled={!!editId} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Nombre *</label>
                <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} className="input-field" placeholder="Indefinido — Administrativo" required />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Descripción</label>
              <input value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} className="input-field" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Tipo de contrato</label>
                <select value={form.tipo_contrato} onChange={e => setForm(f => ({ ...f, tipo_contrato: e.target.value }))} className="input-field">
                  {TIPOS_CONTRATO.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Aplica a cargos (csv)</label>
                <input value={form.aplica_a_cargos} onChange={e => setForm(f => ({ ...f, aplica_a_cargos: e.target.value }))} className="input-field" placeholder="administrativo, operador" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Jornadas (csv hrs)</label>
                <input value={form.aplica_a_jornadas} onChange={e => setForm(f => ({ ...f, aplica_a_jornadas: e.target.value }))} className="input-field" placeholder="44, 40, 30" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Contenido (markdown con {'{{placeholders}}'})</label>
              <textarea
                ref={setEditorRef}
                value={form.contenido}
                onChange={e => setForm(f => ({ ...f, contenido: e.target.value }))}
                className="input-field font-mono text-sm leading-relaxed"
                rows={28}
                placeholder={`# Contrato Individual de Trabajo

En Santiago de Chile, a {{fecha.hoy_largo}}, entre {{empresa.razon_social}}, RUT {{empresa.rut}}, ...`}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Notas de versión</label>
              <input value={form.notas_version} onChange={e => setForm(f => ({ ...f, notas_version: e.target.value }))} className="input-field" placeholder="Qué cambió respecto a la versión anterior" />
            </div>
          </div>
          <div className="col-span-12 md:col-span-3">
            <div className="sticky top-0">
              <VariablesPanel variables={variables} onInsert={insertVar} />
            </div>
          </div>
          <div className="col-span-12 flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancelar</button>
            <button type="submit" className="btn-primary">{editId ? 'Guardar cambios' : 'Crear plantilla'}</button>
          </div>
        </form>
      </Modal>

      {previewItem && (
        <PreviewModal plantilla={previewItem} open={true} onClose={() => setPreviewItem(null)} />
      )}
    </div>
  )
}
