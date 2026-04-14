import { useState, useEffect, useCallback } from 'react'
import {
  MessageSquare, Send, Plus, Pencil, Trash2, Eye, RefreshCw,
  CheckCircle, Clock, AlertTriangle, Users, ChevronRight,
  X, Check, Loader2, MessageCircle,
} from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import api from '../../api'

const C = {
  bg: '#f8fafc', surface: '#f1f5f9', card: '#ffffff', border: '#e2e8f0',
  text: '#1e293b', muted: '#64748b', dimmed: '#94a3b8',
  green: '#16a34a', greenDim: 'rgba(22,163,74,0.1)',
  amber: '#d97706', amberDim: 'rgba(217,119,6,0.1)',
  red: '#dc2626', redDim: 'rgba(220,38,38,0.1)',
  blue: '#2563eb', blueDim: 'rgba(37,99,235,0.1)',
  purple: '#7c3aed', cardHover: '#f1f5f9',
  wa: '#25d366', waDim: 'rgba(37,211,102,0.1)',
}

const SEGMENTOS = [
  { value: 'todos',             label: 'Todos los sellers activos' },
  { value: 'tier_epico',        label: 'Tier Épico (500+ envíos/día)' },
  { value: 'tier_clave',        label: 'Tier Clave (100-499 envíos/día)' },
  { value: 'tier_bueno',        label: 'Tier Bueno (20-99 envíos/día)' },
  { value: 'en_riesgo',         label: 'En riesgo / Validar estado' },
  { value: 'en_gestion',        label: 'En gestión / Seguimiento' },
  { value: 'manual',            label: 'Selección manual de sellers' },
  { value: 'numeros_directos',  label: '📱 Números directos (prueba / equipo)' },
]

const ESTADO_MSG = {
  pendiente:   { label: 'Pendiente',  color: C.muted },
  enviado:     { label: 'Enviado',    color: C.blue  },
  entregado:   { label: 'Entregado',  color: C.amber },
  leido:       { label: 'Leído',      color: C.green },
  respondido:  { label: 'Respondió',  color: C.purple },
  error:       { label: 'Error',      color: C.red   },
}

const ESTADO_ENVIO = {
  pendiente:   { label: 'Pendiente',   color: C.muted },
  enviando:    { label: 'Enviando…',   color: C.amber },
  completado:  { label: 'Completado',  color: C.green },
  error:       { label: 'Error',       color: C.red   },
}

function fmt(n) {
  return n == null ? '—' : n.toLocaleString('es-CL')
}

function pct(a, b) {
  if (!b) return '—'
  return `${Math.round(a / b * 100)}%`
}

// ── Tab: Plantillas ───────────────────────────────────────────────────────────

function TabPlantillas() {
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editando, setEditando] = useState(null)
  const [form, setForm] = useState({ nombre: '', categoria: 'marketing', idioma: 'es_CL', cuerpo: '', variables: '', wa_template_name: '' })

  const cargar = useCallback(() => {
    setLoading(true)
    api.get('/whatsapp/templates').then(r => setTemplates(r.data)).finally(() => setLoading(false))
  }, [])

  useEffect(cargar, [cargar])

  const abrirNueva = () => {
    setEditando(null)
    setForm({ nombre: '', categoria: 'marketing', idioma: 'es_CL', cuerpo: '', variables: '', wa_template_name: '' })
    setShowForm(true)
  }

  const abrirEditar = (t) => {
    setEditando(t.id)
    setForm({ nombre: t.nombre, categoria: t.categoria, idioma: t.idioma, cuerpo: t.cuerpo, variables: (t.variables || []).join(', '), wa_template_name: t.wa_template_name || '' })
    setShowForm(true)
  }

  const guardar = async () => {
    const payload = { ...form, variables: form.variables.split(',').map(v => v.trim()).filter(Boolean), wa_template_name: form.wa_template_name || null }
    if (editando) await api.patch(`/whatsapp/templates/${editando}`, payload)
    else await api.post('/whatsapp/templates', payload)
    setShowForm(false)
    cargar()
  }

  const eliminar = async (id) => {
    if (!confirm('¿Eliminar esta plantilla?')) return
    await api.delete(`/whatsapp/templates/${id}`)
    cargar()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ color: C.muted, fontSize: 12 }}>
          Las plantillas de texto libre funcionan dentro de la ventana de 24h. Para envíos masivos sin restricción necesitas plantillas aprobadas por Meta.
        </div>
        <button onClick={abrirNueva}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.wa, border: 'none', color: '#fff', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
          <Plus size={14} /> Nueva plantilla
        </button>
      </div>

      {loading ? <div style={{ color: C.muted, textAlign: 'center', padding: 40 }}>Cargando…</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {templates.map(t => (
            <div key={t.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{t.nombre}</span>
                  <span style={{ fontSize: 9, color: C.muted, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: '1px 6px' }}>{t.categoria}</span>
                  {t.aprobada
                    ? <span style={{ fontSize: 9, color: C.green, background: C.greenDim, border: `1px solid ${C.green}33`, borderRadius: 4, padding: '1px 6px', fontWeight: 700 }}>✓ Aprobada Meta</span>
                    : <span style={{ fontSize: 9, color: C.amber, background: C.amberDim, border: `1px solid ${C.amber}33`, borderRadius: 4, padding: '1px 6px' }}>Pendiente aprobación</span>
                  }
                </div>
                <p style={{ fontSize: 12, color: C.muted, margin: '0 0 4px', lineHeight: 1.5, maxWidth: 600 }}>{t.cuerpo}</p>
                {t.variables?.length > 0 && (
                  <div style={{ fontSize: 10, color: C.dimmed }}>Variables: {t.variables.map((v, i) => `{{${i+1}}} = ${v}`).join(' · ')}</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, marginLeft: 12 }}>
                <button onClick={() => abrirEditar(t)} style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, padding: '5px 8px', cursor: 'pointer' }}><Pencil size={12} /></button>
                <button onClick={() => eliminar(t.id)} style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.red, borderRadius: 6, padding: '5px 8px', cursor: 'pointer' }}><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
          {templates.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: C.dimmed }}>No hay plantillas creadas aún</div>}
        </div>
      )}

      {/* Modal plantilla */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24, width: 520 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>{editando ? 'Editar plantilla' : 'Nueva plantilla'}</h3>
            {[
              { label: 'Nombre', field: 'nombre', placeholder: 'Ej: Aviso jornada sin retiro' },
              { label: 'Nombre en Meta (solo si está aprobada)', field: 'wa_template_name', placeholder: 'aviso_sin_retiro (snake_case)' },
              { label: 'Variables (separadas por coma)', field: 'variables', placeholder: 'nombre_seller, fecha, motivo' },
            ].map(f => (
              <div key={f.field} style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: C.muted, display: 'block', marginBottom: 4 }}>{f.label}</label>
                <input value={form[f.field]} onChange={e => setForm(p => ({ ...p, [f.field]: e.target.value }))}
                  placeholder={f.placeholder}
                  style={{ width: '100%', background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: '8px 10px', fontSize: 12, boxSizing: 'border-box' }} />
              </div>
            ))}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: C.muted, display: 'block', marginBottom: 4 }}>Categoría</label>
              <select value={form.categoria} onChange={e => setForm(p => ({ ...p, categoria: e.target.value }))}
                style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: '8px 10px', fontSize: 12, width: '100%' }}>
                <option value="marketing">Marketing</option>
                <option value="utility">Utilidad</option>
                <option value="authentication">Autenticación</option>
              </select>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, color: C.muted, display: 'block', marginBottom: 4 }}>
                Cuerpo del mensaje <span style={{ color: C.dimmed }}>(usa {'{{1}}'}, {'{{2}}'} para variables)</span>
              </label>
              <textarea value={form.cuerpo} onChange={e => setForm(p => ({ ...p, cuerpo: e.target.value }))}
                rows={5} placeholder="Hola {{1}}, te informamos que el día {{2}} no habrá retiro por {{3}}..."
                style={{ width: '100%', background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: '8px 10px', fontSize: 12, resize: 'vertical', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={guardar} disabled={!form.nombre || !form.cuerpo}
                style={{ flex: 1, background: C.wa, border: 'none', color: '#fff', borderRadius: 8, padding: '9px', fontSize: 13, cursor: 'pointer', opacity: form.nombre && form.cuerpo ? 1 : 0.5, fontWeight: 600 }}>
                Guardar
              </button>
              <button onClick={() => setShowForm(false)}
                style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, padding: '9px 16px', fontSize: 13, cursor: 'pointer' }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tab: Nuevo Envío ──────────────────────────────────────────────────────────

function TabNuevoEnvio({ onEnviado }) {
  const [step, setStep] = useState(1) // 1=plantilla, 2=segmento, 3=variables, 4=preview
  const [templates, setTemplates] = useState([])
  const [form, setForm] = useState({ template_id: null, segmento: 'todos', seller_ids: [], variables_valores: {}, nombre_campaña: '' })
  const [preview, setPreview] = useState(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    api.get('/whatsapp/templates').then(r => setTemplates(r.data))
  }, [])

  const plantillaSeleccionada = templates.find(t => t.id === form.template_id)

  const cargarPreview = async () => {
    setLoadingPreview(true)
    try {
      const r = await api.post('/whatsapp/segmento/preview', form)
      setPreview(r.data)
    } finally {
      setLoadingPreview(false)
    }
  }

  const enviar = async () => {
    setEnviando(true)
    try {
      const payload = { ...form }
      if (form.segmento === 'numeros_directos') {
        payload.numeros_directos = (form.numeros_directos_texto || '')
          .split(/[\n,]/).map(n => n.trim()).filter(Boolean)
      }
      await api.post('/whatsapp/envios', payload)
      onEnviado()
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      {/* Stepper */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 24 }}>
        {['Plantilla', 'Segmento', 'Variables', 'Confirmar'].map((s, i) => (
          <div key={s} style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 24, height: 24, borderRadius: 99, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700,
                background: step > i + 1 ? C.wa : step === i + 1 ? C.wa : C.surface,
                color: step >= i + 1 ? '#fff' : C.dimmed,
                border: `1px solid ${step >= i + 1 ? C.wa : C.border}`,
              }}>
                {step > i + 1 ? <Check size={11} /> : i + 1}
              </div>
              <span style={{ fontSize: 11, color: step === i + 1 ? C.text : C.dimmed, fontWeight: step === i + 1 ? 600 : 400 }}>{s}</span>
            </div>
            {i < 3 && <div style={{ flex: 1, height: 1, background: C.border, margin: '0 8px' }} />}
          </div>
        ))}
      </div>

      {/* Step 1: Plantilla */}
      {step === 1 && (
        <div>
          <p style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>Elige la plantilla que quieres enviar:</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {templates.map(t => (
              <button key={t.id}
                onClick={() => setForm(p => ({ ...p, template_id: t.id }))}
                style={{
                  background: form.template_id === t.id ? C.waDim : C.card,
                  border: `1px solid ${form.template_id === t.id ? C.wa : C.border}`,
                  borderRadius: 10, padding: '12px 14px', cursor: 'pointer', textAlign: 'left',
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{t.nombre}</span>
                  {t.aprobada && <span style={{ fontSize: 9, color: C.green, fontWeight: 700 }}>✓ Meta</span>}
                </div>
                <p style={{ fontSize: 11, color: C.muted, margin: 0, lineHeight: 1.4 }}>{t.cuerpo.slice(0, 100)}{t.cuerpo.length > 100 ? '…' : ''}</p>
              </button>
            ))}
          </div>
          <button onClick={() => setStep(2)} disabled={!form.template_id}
            style={{ marginTop: 16, background: C.wa, border: 'none', color: '#fff', borderRadius: 8, padding: '10px 20px', fontSize: 13, cursor: form.template_id ? 'pointer' : 'not-allowed', opacity: form.template_id ? 1 : 0.5, fontWeight: 600 }}>
            Siguiente →
          </button>
        </div>
      )}

      {/* Step 2: Segmento */}
      {step === 2 && (
        <div>
          <p style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>¿A quiénes quieres enviar este mensaje?</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {SEGMENTOS.map(seg => (
              <button key={seg.value}
                onClick={() => setForm(p => ({ ...p, segmento: seg.value }))}
                style={{
                  background: form.segmento === seg.value ? C.waDim : C.card,
                  border: `1px solid ${form.segmento === seg.value ? C.wa : C.border}`,
                  borderRadius: 8, padding: '10px 14px', cursor: 'pointer', textAlign: 'left',
                  color: C.text, fontSize: 13,
                }}>
                {seg.label}
              </button>
            ))}
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, color: C.muted, display: 'block', marginBottom: 4 }}>Nombre de la campaña (opcional)</label>
            <input value={form.nombre_campaña} onChange={e => setForm(p => ({ ...p, nombre_campaña: e.target.value }))}
              placeholder="Ej: Aviso feriado 18 septiembre"
              style={{ width: '100%', background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: '8px 10px', fontSize: 12, boxSizing: 'border-box' }} />
          </div>

          {/* Campo de números directos */}
          {form.segmento === 'numeros_directos' && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, color: C.muted, display: 'block', marginBottom: 4 }}>
                Números de teléfono — uno por línea o separados por coma (formato +569XXXXXXXX)
              </label>
              <textarea
                rows={4}
                value={form.numeros_directos_texto || ''}
                onChange={e => setForm(p => ({ ...p, numeros_directos_texto: e.target.value }))}
                placeholder={"+56912345678\n+56987654321\n+56911111111"}
                style={{ width: '100%', background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: '8px 10px', fontSize: 12, boxSizing: 'border-box', resize: 'vertical' }}
              />
              <p style={{ fontSize: 10, color: C.muted, margin: '4px 0 0' }}>
                {(form.numeros_directos_texto || '').split(/[\n,]/).filter(n => n.trim()).length} número(s) ingresado(s)
              </p>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setStep(1)} style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, padding: '10px 16px', fontSize: 13, cursor: 'pointer' }}>← Volver</button>
            <button onClick={() => setStep(3)} style={{ background: C.wa, border: 'none', color: '#fff', borderRadius: 8, padding: '10px 20px', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>Siguiente →</button>
          </div>
        </div>
      )}

      {/* Step 3: Variables */}
      {step === 3 && (
        <div>
          <p style={{ fontSize: 13, color: C.muted, marginBottom: 4 }}>Completa las variables del mensaje:</p>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, marginBottom: 16 }}>
            <p style={{ fontSize: 11, color: C.muted, margin: '0 0 6px', fontWeight: 600 }}>Vista previa:</p>
            <p style={{ fontSize: 13, color: C.text, margin: 0, lineHeight: 1.6 }}>
              {(() => {
                let txt = plantillaSeleccionada?.cuerpo || ''
                Object.entries(form.variables_valores).forEach((_, i) => {
                  txt = txt.replace(`{{${i + 1}}}`, `[${plantillaSeleccionada?.variables?.[i] || `var${i+1}`}]`)
                })
                return txt
              })()}
            </p>
          </div>
          {(plantillaSeleccionada?.variables || []).length === 0 ? (
            <p style={{ color: C.muted, fontSize: 12 }}>Esta plantilla no tiene variables. Puedes continuar.</p>
          ) : (
            plantillaSeleccionada.variables.map((v, i) => (
              <div key={i} style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: C.muted, display: 'block', marginBottom: 4 }}>
                  {`{{${i + 1}}}`} — {v}
                </label>
                <input
                  value={form.variables_valores[String(i + 1)] || ''}
                  onChange={e => setForm(p => ({ ...p, variables_valores: { ...p.variables_valores, [String(i + 1)]: e.target.value } }))}
                  placeholder={`Valor para ${v}`}
                  style={{ width: '100%', background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 7, padding: '8px 10px', fontSize: 12, boxSizing: 'border-box' }} />
              </div>
            ))
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={() => setStep(2)} style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, padding: '10px 16px', fontSize: 13, cursor: 'pointer' }}>← Volver</button>
            <button onClick={async () => {
                if (form.segmento === 'numeros_directos') { setStep(4); return }
                await cargarPreview(); setStep(4)
              }}
              disabled={loadingPreview}
              style={{ background: C.wa, border: 'none', color: '#fff', borderRadius: 8, padding: '10px 20px', fontSize: 13, cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
              {loadingPreview ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Cargando…</> : 'Ver preview →'}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Confirmar */}
      {step === 4 && form.segmento === 'numeros_directos' && (
        <div>
          <div style={{ background: C.waDim, border: `1px solid ${C.wa}33`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: C.wa }}>
              {(form.numeros_directos_texto || '').split(/[\n,]/).filter(n => n.trim()).length}
            </div>
            <div style={{ fontSize: 12, color: C.muted }}>números recibirán este mensaje</div>
          </div>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, marginBottom: 16 }}>
            <p style={{ fontSize: 11, color: C.muted, margin: '0 0 8px', fontWeight: 600 }}>Números a enviar:</p>
            {(form.numeros_directos_texto || '').split(/[\n,]/).filter(n => n.trim()).map((n, i) => (
              <div key={i} style={{ padding: '3px 0', borderBottom: `1px solid ${C.border}`, fontSize: 12, color: C.text }}>{n.trim()}</div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setStep(2)} style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, padding: '10px 16px', fontSize: 13, cursor: 'pointer' }}>← Volver</button>
            <button onClick={enviar} disabled={enviando}
              style={{ flex: 1, background: C.wa, border: 'none', color: '#fff', borderRadius: 8, padding: '10px', fontSize: 13, cursor: enviando ? 'not-allowed' : 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: enviando ? 0.7 : 1 }}>
              {enviando ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Enviando…</> : <><Send size={13} /> Enviar ahora</>}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Confirmar (sellers) */}
      {step === 4 && form.segmento !== 'numeros_directos' && preview && (
        <div>
          <div style={{ background: C.waDim, border: `1px solid ${C.wa}33`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: C.wa }}>{preview.total}</div>
            <div style={{ fontSize: 12, color: C.muted }}>sellers recibirán este mensaje</div>
            {preview.sin_numero > 0 && (
              <div style={{ fontSize: 11, color: C.amber, marginTop: 4 }}>⚠ {preview.sin_numero} no tienen número de WhatsApp registrado y serán omitidos</div>
            )}
          </div>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, marginBottom: 16, maxHeight: 200, overflowY: 'auto' }}>
            <p style={{ fontSize: 11, color: C.muted, margin: '0 0 8px', fontWeight: 600 }}>Primeros {Math.min(preview.sellers.length, 20)} del segmento:</p>
            {preview.sellers.map(s => (
              <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: `1px solid ${C.border}`, fontSize: 11 }}>
                <span style={{ color: C.text }}>{s.nombre}</span>
                <span style={{ color: s.tiene_numero ? C.green : C.red }}>{s.telefono || 'Sin número'}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setStep(3)} style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, padding: '10px 16px', fontSize: 13, cursor: 'pointer' }}>← Volver</button>
            <button onClick={enviar} disabled={enviando}
              style={{ flex: 1, background: C.wa, border: 'none', color: '#fff', borderRadius: 8, padding: '10px', fontSize: 13, cursor: enviando ? 'not-allowed' : 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: enviando ? 0.7 : 1 }}>
              {enviando ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Enviando…</> : <><Send size={13} /> Enviar a {preview.total} sellers</>}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tab: Historial ────────────────────────────────────────────────────────────

function TabHistorial() {
  const [envios, setEnvios] = useState([])
  const [loading, setLoading] = useState(true)
  const [detalle, setDetalle] = useState(null)
  const [mensajes, setMensajes] = useState([])
  const [loadingMsgs, setLoadingMsgs] = useState(false)

  const cargar = useCallback(() => {
    setLoading(true)
    api.get('/whatsapp/envios').then(r => setEnvios(r.data)).finally(() => setLoading(false))
  }, [])

  useEffect(cargar, [cargar])

  const verDetalle = async (e) => {
    setDetalle(e)
    setLoadingMsgs(true)
    const r = await api.get(`/whatsapp/envios/${e.id}/mensajes`)
    setMensajes(r.data)
    setLoadingMsgs(false)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button onClick={cargar} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 7, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
          <RefreshCw size={12} /> Actualizar
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>Cargando…</div>
      ) : envios.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: C.dimmed }}>No hay envíos registrados aún</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {envios.map(e => {
            const cfg = ESTADO_ENVIO[e.estado] || ESTADO_ENVIO.pendiente
            return (
              <div key={e.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{e.nombre_campaña || e.template_nombre}</span>
                      <span style={{ fontSize: 10, color: cfg.color, fontWeight: 700 }}>{cfg.label}</span>
                    </div>
                    <div style={{ fontSize: 11, color: C.muted }}>
                      {SEGMENTOS.find(s => s.value === e.segmento)?.label || e.segmento} · {e.fecha_inicio?.slice(0, 10)}
                    </div>
                  </div>
                  <button onClick={() => verDetalle(e)}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 7, padding: '5px 10px', fontSize: 11, cursor: 'pointer' }}>
                    <Eye size={11} /> Ver detalle
                  </button>
                </div>

                {/* Métricas */}
                <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
                  {[
                    { label: 'Total',      val: fmt(e.total),       color: C.muted  },
                    { label: 'Enviados',   val: fmt(e.enviados),    color: C.blue   },
                    { label: 'Leídos',     val: `${fmt(e.leidos)} (${pct(e.leidos, e.enviados)})`, color: C.green },
                    { label: 'Respondieron', val: `${fmt(e.respondidos)} (${pct(e.respondidos, e.enviados)})`, color: C.purple },
                    { label: 'Errores',    val: fmt(e.errores),     color: e.errores > 0 ? C.red : C.muted },
                  ].map(m => (
                    <div key={m.label} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: m.color }}>{m.val}</div>
                      <div style={{ fontSize: 10, color: C.dimmed }}>{m.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal detalle mensajes */}
      {detalle && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24, width: 640, maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 15 }}>{detalle.nombre_campaña || detalle.template_nombre}</h3>
              <button onClick={() => setDetalle(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted }}><X size={18} /></button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {loadingMsgs ? (
                <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>Cargando mensajes…</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                      {['Seller', 'Número', 'Estado', 'Respuesta'].map(h => (
                        <th key={h} style={{ padding: '6px 8px', color: C.muted, fontWeight: 600, textAlign: 'left', fontSize: 10, textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mensajes.map(m => {
                      const cfg = ESTADO_MSG[m.estado] || ESTADO_MSG.pendiente
                      return (
                        <tr key={m.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                          <td style={{ padding: '7px 8px', color: C.text }}>{m.seller_nombre || '—'}</td>
                          <td style={{ padding: '7px 8px', color: C.muted, fontFamily: 'monospace' }}>{m.numero}</td>
                          <td style={{ padding: '7px 8px' }}>
                            <span style={{ color: cfg.color, fontWeight: 600 }}>{cfg.label}</span>
                          </td>
                          <td style={{ padding: '7px 8px', color: C.muted, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {m.respuesta || (m.error ? <span style={{ color: C.red, fontSize: 10 }}>{m.error}</span> : '—')}
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
      )}
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function WhatsApp() {
  const [tab, setTab] = useState('plantillas')
  const [refreshHistorial, setRefreshHistorial] = useState(0)

  const TABS = [
    { id: 'plantillas', label: 'Plantillas', icon: MessageSquare },
    { id: 'nuevo',      label: 'Nuevo envío', icon: Send },
    { id: 'historial',  label: 'Historial', icon: Clock },
  ]

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '24px 28px', color: C.text }}>
      <PageHeader
        title="WhatsApp Business"
        subtitle="Envío de mensajes y gestión de plantillas"
        icon={MessageCircle}
        accent="green"
      />

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, background: C.surface, borderRadius: 10, padding: 4, marginBottom: 24, width: 'fit-content' }}>
        {TABS.map(t => {
          const Icon = t.icon
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: tab === t.id ? C.card : 'transparent',
                border: tab === t.id ? `1px solid ${C.border}` : '1px solid transparent',
                color: tab === t.id ? C.text : C.muted,
                borderRadius: 8, padding: '7px 14px', fontSize: 12, cursor: 'pointer', fontWeight: tab === t.id ? 600 : 400,
                transition: 'all 0.15s',
              }}>
              <Icon size={13} />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Content */}
      {tab === 'plantillas' && <TabPlantillas />}
      {tab === 'nuevo' && (
        <TabNuevoEnvio onEnviado={() => { setTab('historial'); setRefreshHistorial(r => r + 1) }} />
      )}
      {tab === 'historial' && <TabHistorial key={refreshHistorial} />}
    </div>
  )
}
