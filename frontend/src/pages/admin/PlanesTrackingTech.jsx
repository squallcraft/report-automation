import { useState, useEffect, useCallback } from 'react'
import { Trash2, Plus, X } from 'lucide-react'
import api from '../../api'

const TIPO_CALCULO_OPTS = [
  { value: 'UMBRAL_FIJO', label: 'Umbral fijo', desc: 'Base + extra_por × unidades sobre el límite (ej: conductores)' },
  { value: 'BLOQUES',     label: 'Bloques',      desc: 'Base + extra_por × bloques enteros sobre el límite (ej: envíos cada 5.000)' },
  { value: 'BASE_UF',     label: 'Base en UF',   desc: 'Base en UF (último día del mes) + extra_por × unidades' },
  { value: 'PLANA',       label: 'Plana',        desc: 'Precio fijo sin variable' },
]

const CAMPOS_POR_TIPO = {
  UMBRAL_FIJO: [
    { key: 'base',          label: 'Base (CLP neto)',                tipo: 'int' },
    { key: 'max_incluidos', label: 'Unidades incluidas en la base',  tipo: 'int' },
    { key: 'extra_por',     label: 'Extra por unidad adicional (CLP neto)', tipo: 'int' },
    { key: 'variable',      label: 'Nombre variable (ej: conductores)', tipo: 'text' },
  ],
  BLOQUES: [
    { key: 'base',          label: 'Base (CLP neto)',                tipo: 'int' },
    { key: 'max_incluidos', label: 'Unidades incluidas en la base',  tipo: 'int' },
    { key: 'extra_por',     label: 'Extra por bloque (CLP neto)',    tipo: 'int' },
    { key: 'bloque',        label: 'Tamaño del bloque (unidades)',   tipo: 'int' },
    { key: 'variable',      label: 'Nombre variable (ej: envíos)',   tipo: 'text' },
  ],
  BASE_UF: [
    { key: 'base_uf',   label: 'Base en UF',                         tipo: 'float' },
    { key: 'extra_por', label: 'Extra por unidad adicional (CLP neto)', tipo: 'int' },
    { key: 'variable',  label: 'Nombre variable (ej: conductores)',  tipo: 'text' },
  ],
  PLANA: [
    { key: 'base',     label: 'Precio fijo (CLP neto)', tipo: 'int' },
    { key: 'variable', label: 'Etiqueta (opcional)',    tipo: 'text' },
  ],
}

function formatCLP(val) {
  if (val == null) return '—'
  return `$${Number(val).toLocaleString('es-CL')}`
}

function renderValorCampo(campo, params) {
  const val = params[campo.key]
  if (val == null) return '—'
  if (campo.tipo === 'float') return `${val} UF`
  if (campo.tipo === 'int') return campo.key === 'max_incluidos' || campo.key === 'bloque'
    ? Number(val).toLocaleString('es-CL')
    : formatCLP(val)
  return val
}

// ─── Formulario de campos dinámicos ──────────────────────────────────────────
function CamposDinamicos({ tipo, form, setForm }) {
  const campos = CAMPOS_POR_TIPO[tipo] || []
  return (
    <div className="space-y-3">
      {campos.map(c => (
        <div key={c.key}>
          <label className="block text-xs font-medium text-gray-600 mb-1">{c.label}</label>
          <input
            type={c.tipo === 'text' ? 'text' : 'number'}
            step={c.tipo === 'float' ? '0.1' : '1'}
            value={form[c.key] ?? ''}
            onChange={e => setForm(f => ({ ...f, [c.key]: e.target.value }))}
            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
            placeholder={c.tipo === 'text' ? 'conductores' : '0'}
          />
        </div>
      ))}
    </div>
  )
}

// ─── Modal crear plan ─────────────────────────────────────────────────────────
function ModalCrear({ onClose, onCreated }) {
  const [nombre, setNombre] = useState('')
  const [tipo, setTipo] = useState('UMBRAL_FIJO')
  const [form, setForm] = useState({})
  const [desc, setDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const handleTipo = (t) => {
    setTipo(t)
    setForm({})
  }

  const handleSave = async () => {
    if (!nombre.trim()) return setError('El nombre del plan es obligatorio')
    setSaving(true)
    setError(null)
    try {
      const params = { tipo_calculo: tipo }
      for (const campo of (CAMPOS_POR_TIPO[tipo] || [])) {
        const raw = form[campo.key]
        if (campo.tipo === 'text') {
          params[campo.key] = raw || ''
        } else if (campo.tipo === 'float') {
          params[campo.key] = parseFloat(raw)
          if (isNaN(params[campo.key])) throw new Error(`"${campo.label}" debe ser un número`)
        } else {
          params[campo.key] = parseInt(raw, 10)
          if (isNaN(params[campo.key])) throw new Error(`"${campo.label}" debe ser un número`)
        }
      }
      await api.post('/inquilinos/config/planes', {
        plan: nombre.toUpperCase().replace(/\s+/g, '_'),
        params,
        descripcion_contrato: desc || null,
      })
      onCreated()
      onClose()
    } catch (e) {
      setError(e.response?.data?.detail || e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-lg font-bold text-gray-900">Nueva tarifa</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          {/* Nombre */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nombre del plan (clave única)</label>
            <input
              value={nombre}
              onChange={e => setNombre(e.target.value)}
              placeholder="Ej: TARIFA_D"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <p className="text-xs text-gray-400 mt-0.5">Se guardará en mayúsculas: {nombre.toUpperCase().replace(/\s+/g, '_') || '—'}</p>
          </div>

          {/* Tipo de cálculo */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Tipo de cálculo</label>
            <div className="grid grid-cols-2 gap-2">
              {TIPO_CALCULO_OPTS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => handleTipo(opt.value)}
                  className={`text-left p-3 rounded-lg border-2 text-xs transition-colors ${
                    tipo === opt.value
                      ? 'border-blue-500 bg-blue-50 text-blue-800'
                      : 'border-gray-200 hover:border-gray-300 text-gray-600'
                  }`}
                >
                  <div className="font-semibold">{opt.label}</div>
                  <div className="text-gray-500 mt-0.5 text-[10px]">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Campos dinámicos */}
          <CamposDinamicos tipo={tipo} form={form} setForm={setForm} />

          {/* Descripción */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Descripción en contrato (opcional)</label>
            <textarea
              rows={3}
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="Texto que aparecerá en el contrato del inquilino…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-y"
            />
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg p-2">{error}</p>}
        </div>
        <div className="flex gap-2 p-5 border-t">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 rounded-lg disabled:opacity-50"
          >
            {saving ? 'Guardando…' : 'Crear tarifa'}
          </button>
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Tarjeta de plan ──────────────────────────────────────────────────────────
function PlanCard({ config, esDefault, onSaved, onDeleted }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [desc, setDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState(null)

  const tipo = config.params?.tipo_calculo || 'UMBRAL_FIJO'
  const campos = CAMPOS_POR_TIPO[tipo] || []

  useEffect(() => {
    setForm({ ...config.params })
    setDesc(config.descripcion_contrato || '')
  }, [config])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const params = { tipo_calculo: tipo }
      for (const campo of campos) {
        const raw = form[campo.key]
        if (campo.tipo === 'text') {
          params[campo.key] = raw || ''
        } else if (campo.tipo === 'float') {
          params[campo.key] = parseFloat(raw)
          if (isNaN(params[campo.key])) throw new Error(`"${campo.label}" debe ser número`)
        } else {
          params[campo.key] = parseInt(raw, 10)
          if (isNaN(params[campo.key])) throw new Error(`"${campo.label}" debe ser número`)
        }
      }
      await api.put(`/inquilinos/config/planes/${config.plan}`, { params, descripcion_contrato: desc })
      setEditing(false)
      onSaved()
    } catch (e) {
      setError(e.response?.data?.detail || e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm(`¿Eliminar la tarifa "${config.plan}"? Esta acción no se puede deshacer.`)) return
    setDeleting(true)
    try {
      await api.delete(`/inquilinos/config/planes/${config.plan}`)
      onDeleted()
    } catch (e) {
      alert(e.response?.data?.detail || 'Error al eliminar')
      setDeleting(false)
    }
  }

  const tipoOpt = TIPO_CALCULO_OPTS.find(o => o.value === tipo)

  return (
    <div className="rounded-xl border-2 border-gray-200 bg-white p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{config.plan}</span>
          <p className="text-xs text-gray-500 mt-1">{tipoOpt?.label || tipo}</p>
          {config.updated_at && (
            <p className="text-xs text-gray-400">Actualizado: {new Date(config.updated_at).toLocaleString('es-CL')}</p>
          )}
        </div>
        <div className="flex gap-1">
          {!editing && (
            <button onClick={() => { setEditing(true); setError(null) }}
              className="text-xs text-gray-500 hover:text-gray-800 underline px-1">
              Editar
            </button>
          )}
          {!esDefault && (
            <button onClick={handleDelete} disabled={deleting}
              className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
              title="Eliminar plan">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Campos */}
      <div className="space-y-2">
        {campos.map(campo => (
          <div key={campo.key}>
            <label className="block text-xs font-medium text-gray-500 mb-0.5">{campo.label}</label>
            {editing ? (
              <input
                type={campo.tipo === 'text' ? 'text' : 'number'}
                step={campo.tipo === 'float' ? '0.1' : '1'}
                value={form[campo.key] ?? ''}
                onChange={e => setForm(f => ({ ...f, [campo.key]: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              />
            ) : (
              <p className="text-sm font-semibold text-gray-800">{renderValorCampo(campo, config.params)}</p>
            )}
          </div>
        ))}
      </div>

      {/* Descripción */}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-0.5">Descripción en contrato</label>
        {editing ? (
          <textarea rows={3} value={desc} onChange={e => setDesc(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs resize-y" />
        ) : (
          <p className="text-xs text-gray-500 bg-gray-50 rounded-lg p-2 border border-gray-100 line-clamp-3">
            {config.descripcion_contrato || <span className="italic">Sin descripción</span>}
          </p>
        )}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {editing && (
        <div className="flex gap-2">
          <button onClick={handleSave} disabled={saving}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 rounded-lg disabled:opacity-50">
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
          <button onClick={() => setEditing(false)}
            className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50">
            Cancelar
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Página principal ─────────────────────────────────────────────────────────
const DEFAULTS_KEYS = ['TARIFA_A', 'TARIFA_B', 'TARIFA_C']

export default function PlanesTrackingTech() {
  const [planes, setPlanes] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalCrear, setModalCrear] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState(null)

  const cargar = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.get('/inquilinos/config/planes')
      setPlanes(data)
    } catch (e) {
      setError(e.response?.data?.detail || 'Error al cargar planes')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const handleReset = async () => {
    if (!confirm('¿Restaurar los planes predeterminados (A, B, C) a sus valores originales?')) return
    setResetting(true)
    try {
      await api.post('/inquilinos/config/planes/reset')
      await cargar()
    } catch (e) {
      alert(e.response?.data?.detail || 'Error al restaurar')
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Planes y tarifas — Tracking Tech</h1>
          <p className="text-sm text-gray-500 mt-1">
            Crea, edita y elimina tarifas de arriendo. Los cambios aplican a los cobros generados desde este momento.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button onClick={handleReset} disabled={resetting}
            className="text-sm text-gray-400 hover:text-gray-700 underline">
            {resetting ? 'Restaurando…' : 'Restaurar defaults'}
          </button>
          <button onClick={() => setModalCrear(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg">
            <Plus size={16} /> Nueva tarifa
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="text-center text-gray-400 py-16">Cargando tarifas…</div>
      ) : planes.length === 0 ? (
        <div className="text-center text-gray-400 py-16">
          No hay tarifas configuradas.
          <button onClick={() => setModalCrear(true)} className="block mx-auto mt-3 text-blue-600 underline text-sm">
            Crear primera tarifa
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {planes.map(p => (
            <PlanCard
              key={p.plan}
              config={p}
              esDefault={DEFAULTS_KEYS.includes(p.plan)}
              onSaved={cargar}
              onDeleted={cargar}
            />
          ))}
        </div>
      )}

      <div className="mt-8 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        <strong>Nota:</strong> Todos los valores son <em>netos sin IVA</em>. El 19% de IVA se agrega automáticamente al calcular cada cobro.
        El tipo <strong>Base UF</strong> usa el último valor publicado de la UF del mes de facturación (mindicador.cl).
        Los planes predeterminados (TARIFA_A, B, C) no pueden eliminarse mientras tengan inquilinos activos.
      </div>

      {modalCrear && (
        <ModalCrear onClose={() => setModalCrear(false)} onCreated={cargar} />
      )}
    </div>
  )
}
