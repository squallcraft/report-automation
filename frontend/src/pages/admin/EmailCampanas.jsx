import { useState, useEffect, useCallback } from 'react'
import {
  Mail, Send, Plus, Pencil, Trash2, Eye, RefreshCw,
  CheckCircle, Clock, AlertTriangle, Users, X, Loader2,
  BarChart2, ChevronRight, FileText, Tag,
} from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import SellerPicker from '../../components/SellerPicker'
import api from '../../api'

const SEGMENTOS = [
  { value: 'todos',          label: 'Todos los sellers activos (con email)' },
  { value: 'tier_epico',     label: 'Tier Épico (500+ envíos/día)' },
  { value: 'tier_clave',     label: 'Tier Clave (100–499 envíos/día)' },
  { value: 'tier_destacado', label: 'Tier Destacado (50–99 envíos/día)' },
  { value: 'tier_bueno',     label: 'Tier Bueno (20–49 envíos/día)' },
  { value: 'en_riesgo',      label: 'En riesgo / Validar estado' },
  { value: 'en_gestion',     label: 'En gestión / Seguimiento' },
  { value: 'sin_whatsapp',   label: 'Sin WhatsApp (solo contacto por email)' },
  { value: 'por_tags',       label: 'Por tags / etiquetas' },
  { value: 'manual',         label: 'Selección manual de sellers' },
  { value: 'solo_extras',    label: 'Solo correos extra (sin sellers)' },
]

const ESTADO_ENVIO = {
  pendiente:  { label: 'Pendiente',  color: '#94a3b8' },
  enviando:   { label: 'Enviando…',  color: '#d97706' },
  completado: { label: 'Completado', color: '#16a34a' },
  error:      { label: 'Error',      color: '#dc2626' },
}

const ESTADO_MSG = {
  pendiente: { label: 'Pendiente', color: '#94a3b8' },
  enviado:   { label: 'Enviado',   color: '#2563eb' },
  abierto:   { label: 'Abierto',   color: '#16a34a' },
  rebotado:  { label: 'Rebotado',  color: '#dc2626' },
  queja:     { label: 'Queja',     color: '#7c3aed' },
  error:     { label: 'Error',     color: '#dc2626' },
}

function fmt(n) { return n == null ? '—' : n.toLocaleString('es-CL') }
function pct(a, b) { if (!b) return '—'; return `${Math.round(a / b * 100)}%` }

function StatCard({ label, value, color }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-1">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-2xl font-bold" style={{ color: color || '#1e293b' }}>{fmt(value)}</span>
    </div>
  )
}

// ── Tab: Plantillas ────────────────────────────────────────────────────────────

function TabPlantillas() {
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState(null) // null | 'new' | template-obj
  const [form, setForm] = useState({ nombre: '', asunto: '', cuerpo_html: '', cuerpo_texto: '', variables: '' })
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { const { data } = await api.get('/email-campaigns/templates'); setTemplates(data) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  function openNew() {
    setForm({ nombre: '', asunto: '', cuerpo_html: '', cuerpo_texto: '', variables: '' })
    setModal('new')
  }

  function openEdit(t) {
    setForm({
      nombre: t.nombre,
      asunto: t.asunto,
      cuerpo_html: t.cuerpo_html,
      cuerpo_texto: t.cuerpo_texto || '',
      variables: (t.variables || []).join(', '),
    })
    setModal(t)
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    const payload = {
      ...form,
      variables: form.variables ? form.variables.split(',').map(v => v.trim()).filter(Boolean) : [],
    }
    try {
      if (modal === 'new') {
        await api.post('/email-campaigns/templates', payload)
      } else {
        await api.patch(`/email-campaigns/templates/${modal.id}`, payload)
      }
      setModal(null)
      load()
    } catch { /* toast handled globally */ }
    finally { setSaving(false) }
  }

  async function handleDelete(id) {
    if (!confirm('¿Eliminar esta plantilla?')) return
    await api.delete(`/email-campaigns/templates/${id}`)
    load()
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-500">{templates.length} plantilla{templates.length !== 1 ? 's' : ''}</p>
        <button onClick={openNew} className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
          <Plus size={15} /> Nueva plantilla
        </button>
      </div>

      {loading ? (
        <div className="text-center text-gray-400 py-10">Cargando…</div>
      ) : templates.length === 0 ? (
        <div className="text-center text-gray-400 py-10">
          <FileText size={32} className="mx-auto mb-2 opacity-30" />
          <p>No hay plantillas. Crea la primera.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {templates.map(t => (
            <div key={t.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-medium text-gray-900">{t.nombre}</p>
                <p className="text-sm text-gray-500 mt-0.5 truncate">Asunto: {t.asunto}</p>
                {t.variables?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {t.variables.map(v => (
                      <span key={v} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-xs font-mono">{`{{${v}}}`}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => setPreview(t)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-blue-600 transition-colors" title="Vista previa HTML">
                  <Eye size={15} />
                </button>
                <button onClick={() => openEdit(t)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors">
                  <Pencil size={15} />
                </button>
                <button onClick={() => handleDelete(t.id)} className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal editar/crear */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b">
              <h3 className="font-semibold text-gray-900">{modal === 'new' ? 'Nueva plantilla' : 'Editar plantilla'}</h3>
              <button onClick={() => setModal(null)}><X size={18} /></button>
            </div>
            <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre interno</label>
                <input required className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Asunto del correo</label>
                <input required className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.asunto} onChange={e => setForm(f => ({ ...f, asunto: e.target.value }))}
                  placeholder="Ej: {{nombre}}, te tenemos una novedad" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cuerpo HTML</label>
                <textarea required rows={10}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.cuerpo_html} onChange={e => setForm(f => ({ ...f, cuerpo_html: e.target.value }))}
                  placeholder="<p>Hola {{nombre}},...</p>" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Texto plano (fallback, opcional)</label>
                <textarea rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.cuerpo_texto} onChange={e => setForm(f => ({ ...f, cuerpo_texto: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Variables (separadas por coma)</label>
                <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.variables} onChange={e => setForm(f => ({ ...f, variables: e.target.value }))}
                  placeholder="nombre, empresa, monto" />
                <p className="text-xs text-gray-400 mt-1">Usa <span className="font-mono">{'{{nombre}}'}</span> en el cuerpo. <span className="font-mono">{'{{nombre}}'}</span> y <span className="font-mono">{'{{empresa}}'}</span> se rellenan automáticamente desde el seller.</p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setModal(null)} className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">Cancelar</button>
                <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg text-sm bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                  {saving && <Loader2 size={14} className="animate-spin" />} Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Vista previa HTML */}
      {preview && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-gray-900">Vista previa — {preview.nombre}</h3>
              <button onClick={() => setPreview(null)}><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <div className="mb-2 text-sm text-gray-500">Asunto: <span className="font-medium text-gray-800">{preview.asunto}</span></div>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <iframe
                  srcDoc={preview.cuerpo_html}
                  title="Vista previa"
                  className="w-full"
                  style={{ minHeight: 400 }}
                  sandbox="allow-same-origin"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tab: Campañas ──────────────────────────────────────────────────────────────

function TabCampanas({ onVerDetalle }) {
  const [envios, setEnvios] = useState([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try { const { data } = await api.get('/email-campaigns/envios'); setEnvios(data) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
          <RefreshCw size={14} /> Actualizar
        </button>
      </div>

      {loading ? (
        <div className="text-center text-gray-400 py-10">Cargando…</div>
      ) : envios.length === 0 ? (
        <div className="text-center text-gray-400 py-10">
          <Send size={32} className="mx-auto mb-2 opacity-30" />
          <p>No hay campañas enviadas aún.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {envios.map(e => {
            const est = ESTADO_ENVIO[e.estado] || ESTADO_ENVIO.pendiente
            return (
              <div key={e.id} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{e.nombre_campana || `Campaña #${e.id}`}</span>
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: `${est.color}18`, color: est.color }}>{est.label}</span>
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5">Plantilla: {e.plantilla_nombre} · Segmento: {e.segmento}</p>
                    {e.fecha_inicio && (
                      <p className="text-xs text-gray-400 mt-0.5">{new Date(e.fecha_inicio).toLocaleString('es-CL')}</p>
                    )}
                  </div>
                  <button onClick={() => onVerDetalle(e)} className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-blue-600 transition-colors" title="Ver mensajes">
                    <ChevronRight size={16} />
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4">
                  <div className="text-center"><p className="text-xs text-gray-400">Total</p><p className="text-base font-semibold text-gray-800">{fmt(e.total)}</p></div>
                  <div className="text-center"><p className="text-xs text-gray-400">Enviados</p><p className="text-base font-semibold text-blue-600">{fmt(e.enviados)}</p></div>
                  <div className="text-center"><p className="text-xs text-gray-400">Abiertos</p><p className="text-base font-semibold text-green-600">{fmt(e.abiertos)} <span className="text-xs font-normal text-gray-400">({pct(e.abiertos, e.enviados)})</span></p></div>
                  <div className="text-center"><p className="text-xs text-gray-400">Rebotados</p><p className="text-base font-semibold text-red-500">{fmt(e.rebotados)}</p></div>
                  <div className="text-center"><p className="text-xs text-gray-400">Errores</p><p className="text-base font-semibold text-orange-500">{fmt(e.errores)}</p></div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Tab: Nueva campaña ─────────────────────────────────────────────────────────

function TabNuevaCampana({ onCreated }) {
  const [templates, setTemplates] = useState([])
  const [form, setForm] = useState({
    nombre_campana: '', plantilla_id: '', segmento: 'todos',
    variables_valores: '', emails_extra: '',
    seller_ids: [],
    tags_filtro: [], tags_modo: 'cualquiera',
  })
  const [availableTags, setAvailableTags] = useState([])
  const [preview, setPreview] = useState(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    api.get('/email-campaigns/templates').then(r => setTemplates(r.data))
    api.get('/sellers/tags').then(r => setAvailableTags(r.data)).catch(() => {})
  }, [])

  function parsearExtras(raw) {
    return (raw || '').split(/[\s,;]+/).map(e => e.trim().toLowerCase()).filter(Boolean)
  }

  async function cargarPreview() {
    if (!form.segmento) return
    setLoadingPreview(true)
    try {
      const extras = parsearExtras(form.emails_extra)
      const { data } = await api.get('/email-campaigns/preview-segmento', {
        params: {
          segmento: form.segmento,
          emails_extra: extras.join(','),
          tags_filtro: form.tags_filtro.join(','),
          tags_modo: form.tags_modo,
        },
      })
      setPreview(data)
    } catch { setPreview(null) }
    finally { setLoadingPreview(false) }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.plantilla_id) return alert('Selecciona una plantilla')
    const extras = parsearExtras(form.emails_extra)
    if (form.segmento === 'solo_extras' && extras.length === 0) return alert('Agrega al menos un correo extra')
    if (form.segmento === 'manual' && form.seller_ids.length === 0) return alert('Selecciona al menos un seller')
    if (form.segmento === 'por_tags' && form.tags_filtro.length === 0) return alert('Selecciona al menos un tag')
    setSending(true)
    try {
      let variables_valores = {}
      if (form.variables_valores.trim()) {
        form.variables_valores.split('\n').forEach(line => {
          const [k, ...rest] = line.split('=')
          if (k && rest.length) variables_valores[k.trim()] = rest.join('=').trim()
        })
      }
      await api.post('/email-campaigns/envios', {
        plantilla_id: parseInt(form.plantilla_id),
        segmento: form.segmento,
        seller_ids: form.seller_ids,
        emails_extra: extras,
        tags_filtro: form.tags_filtro,
        tags_modo: form.tags_modo,
        variables_valores,
        nombre_campana: form.nombre_campana || undefined,
      })
      onCreated()
    } catch (err) {
      alert(err.response?.data?.detail || 'Error al crear la campaña')
    } finally {
      setSending(false)
    }
  }

  const plantillaSelected = templates.find(t => t.id === parseInt(form.plantilla_id))

  return (
    <div className="max-w-2xl space-y-6">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Nombre de la campaña (opcional)</label>
          <input
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.nombre_campana} onChange={e => setForm(f => ({ ...f, nombre_campana: e.target.value }))}
            placeholder="Ej: Bienvenida mayo 2026"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Plantilla</label>
          <select required
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.plantilla_id} onChange={e => setForm(f => ({ ...f, plantilla_id: e.target.value }))}>
            <option value="">— Selecciona una plantilla —</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
          {plantillaSelected && (
            <p className="text-xs text-gray-400 mt-1">Asunto: <span className="font-medium">{plantillaSelected.asunto}</span></p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Segmento</label>
          <select
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.segmento} onChange={e => { setForm(f => ({ ...f, segmento: e.target.value, seller_ids: [], tags_filtro: [] })); setPreview(null) }}>
            {SEGMENTOS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        {/* Selector manual */}
        {form.segmento === 'manual' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sellers a incluir</label>
            <SellerPicker
              selected={form.seller_ids}
              onChange={ids => setForm(f => ({ ...f, seller_ids: ids }))}
              requireEmail
              color="#2563eb"
            />
          </div>
        )}

        {/* Selector por tags */}
        {form.segmento === 'por_tags' && (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">Tags a filtrar</label>
            {availableTags.length === 0
              ? <p className="text-xs text-gray-400">No hay tags registrados en sellers activos.</p>
              : (
                <div className="flex flex-wrap gap-1.5">
                  {availableTags.map(({ tag, count }) => {
                    const sel = form.tags_filtro.includes(tag)
                    return (
                      <button key={tag} type="button"
                        onClick={() => {
                          setForm(f => ({
                            ...f,
                            tags_filtro: sel ? f.tags_filtro.filter(t => t !== tag) : [...f.tags_filtro, tag],
                          }))
                          setPreview(null)
                        }}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors"
                        style={sel
                          ? { background: '#2563eb', color: '#fff' }
                          : { background: '#eff6ff', color: '#2563eb' }}>
                        <Tag size={10} /> {tag} <span className="opacity-60">({count})</span>
                      </button>
                    )
                  })}
                </div>
              )
            }
            {form.tags_filtro.length > 1 && (
              <div className="flex gap-3 text-xs mt-1">
                <span className="text-gray-500">Modo:</span>
                {['cualquiera', 'todos'].map(m => (
                  <label key={m} className="flex items-center gap-1 cursor-pointer">
                    <input type="radio" name="tags_modo" value={m}
                      checked={form.tags_modo === m}
                      onChange={() => setForm(f => ({ ...f, tags_modo: m }))} />
                    <span>{m === 'cualquiera' ? 'Cualquiera de los tags (OR)' : 'Todos los tags (AND)'}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Correos extra (opcional)
          </label>
          <textarea rows={3}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.emails_extra}
            onChange={e => { setForm(f => ({ ...f, emails_extra: e.target.value })); setPreview(null) }}
            placeholder={'o.guzman@grupoenix.com\na.fernandez@grupoenix.com'} />
          <p className="text-xs text-gray-400 mt-1">
            Uno por línea (también acepta separados por coma o punto y coma). Se enviarán además de los del segmento, sin duplicados. Para enviar <em>solo</em> a estos, elige el segmento "Solo correos extra".
          </p>
        </div>

        <div className="-mt-2">
          <div className="flex items-center gap-2">
            <button type="button" onClick={cargarPreview} disabled={loadingPreview}
              className="text-xs text-blue-600 hover:underline flex items-center gap-1 disabled:opacity-50">
              {loadingPreview ? <Loader2 size={11} className="animate-spin" /> : <Users size={11} />}
              Ver cuántos recibirán el correo
            </button>
            {preview && (
              <span className="text-xs text-gray-700 font-medium bg-blue-50 px-2 py-0.5 rounded-full">
                {preview.total} destinatarios
                {(preview.sellers != null || preview.extras != null) && ` (${preview.sellers || 0} sellers + ${preview.extras || 0} extras)`}
                {preview.emails?.length > 0 && ` · ej: ${preview.emails.slice(0, 2).join(', ')}`}
              </span>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Variables adicionales (opcional)</label>
          <textarea rows={3}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.variables_valores} onChange={e => setForm(f => ({ ...f, variables_valores: e.target.value }))}
            placeholder={`monto=1500\nfecha=15 de mayo`} />
          <p className="text-xs text-gray-400 mt-1">Una variable por línea en formato <span className="font-mono">clave=valor</span>. <span className="font-mono">{'{{nombre}}'}</span> y <span className="font-mono">{'{{empresa}}'}</span> se llenan automáticamente.</p>
        </div>

        <div className="pt-2">
          <button type="submit" disabled={sending}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            {sending ? 'Enviando…' : 'Enviar campaña'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── Modal detalle mensajes ─────────────────────────────────────────────────────

function ModalDetalle({ envio, onClose }) {
  const [mensajes, setMensajes] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get(`/email-campaigns/envios/${envio.id}/mensajes`)
      .then(r => setMensajes(r.data))
      .finally(() => setLoading(false))
  }, [envio.id])

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h3 className="font-semibold text-gray-900">{envio.nombre_campana || `Campaña #${envio.id}`}</h3>
            <p className="text-sm text-gray-500">{envio.plantilla_nombre} · {envio.segmento}</p>
          </div>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="grid grid-cols-4 gap-4 p-4 bg-gray-50 border-b text-center">
          <StatCard label="Enviados" value={envio.enviados} color="#2563eb" />
          <StatCard label="Abiertos" value={envio.abiertos} color="#16a34a" />
          <StatCard label="Rebotados" value={envio.rebotados} color="#dc2626" />
          <StatCard label="Errores" value={envio.errores} color="#d97706" />
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-center text-gray-400 py-10">Cargando…</div>
          ) : mensajes.length === 0 ? (
            <p className="text-center text-gray-400 py-10">Sin mensajes registrados</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-gray-500 text-xs">
                  <th className="text-left pb-2">Seller</th>
                  <th className="text-left pb-2">Email</th>
                  <th className="text-center pb-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {mensajes.map(m => {
                  const est = ESTADO_MSG[m.estado] || ESTADO_MSG.pendiente
                  return (
                    <tr key={m.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="py-2 pr-3 font-medium text-gray-800 truncate max-w-[140px]">{m.seller_nombre || '—'}</td>
                      <td className="py-2 pr-3 text-gray-600 truncate max-w-[180px]">{m.email}</td>
                      <td className="py-2 text-center">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: `${est.color}18`, color: est.color }}>{est.label}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Página principal ───────────────────────────────────────────────────────────

const TABS = ['Plantillas', 'Campañas', 'Nueva campaña']

export default function EmailCampanas() {
  const [tab, setTab] = useState('Campañas')
  const [detalle, setDetalle] = useState(null)

  function handleCreated() {
    setTab('Campañas')
  }

  return (
    <div className="flex flex-col h-full gap-4">
      <PageHeader
        title="Email Campaigns"
        subtitle="Envíos masivos de correo corporativo vía Amazon SES"
        icon={Mail}
        accent="blue"
      />

      <div className="bg-white border border-gray-200 rounded-2xl flex-1 flex flex-col overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-4 gap-1 pt-2">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
                tab === t
                  ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Contenido */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'Plantillas' && <TabPlantillas />}
          {tab === 'Campañas' && <TabCampanas onVerDetalle={setDetalle} />}
          {tab === 'Nueva campaña' && <TabNuevaCampana onCreated={handleCreated} />}
        </div>
      </div>

      {detalle && <ModalDetalle envio={detalle} onClose={() => setDetalle(null)} />}
    </div>
  )
}
