import { useState, useEffect, useCallback } from 'react'
import api from '../../api'

const PLAN_META = {
  TARIFA_A: {
    label: 'Tarifa A — Base conductores',
    color: 'blue',
    campos: [
      { key: 'base', label: 'Precio base (CLP neto)', tipo: 'int', ayuda: 'Hasta max_incluidos conductores' },
      { key: 'max_incluidos', label: 'Conductores incluidos en base', tipo: 'int' },
      { key: 'extra_por', label: 'Precio extra por conductor (CLP neto)', tipo: 'int', ayuda: 'Por cada conductor sobre el tope' },
    ],
  },
  TARIFA_B: {
    label: 'Tarifa B — Base envíos (plana)',
    color: 'purple',
    campos: [
      { key: 'base', label: 'Precio base (CLP neto)', tipo: 'int', ayuda: 'Hasta max_incluidos envíos mensuales' },
      { key: 'max_incluidos', label: 'Envíos incluidos en base', tipo: 'int' },
      { key: 'extra_por', label: 'Precio extra por bloque (CLP neto)', tipo: 'int' },
      { key: 'bloque', label: 'Tamaño del bloque de envíos', tipo: 'int', ayuda: 'Ej: 5000 → se cobra extra_por por cada 5.000 envíos adicionales' },
    ],
  },
  TARIFA_C: {
    label: 'Tarifa C — Base UF + por conductor',
    color: 'emerald',
    campos: [
      { key: 'base_uf', label: 'Base en UF (último valor del mes)', tipo: 'float', ayuda: 'Se convierte a CLP usando la UF del último día del mes de facturación' },
      { key: 'extra_por', label: 'Precio extra por conductor (CLP neto)', tipo: 'int' },
    ],
  },
}

const colorMap = {
  blue: { card: 'border-blue-200 bg-blue-50', badge: 'bg-blue-100 text-blue-700', btn: 'bg-blue-600 hover:bg-blue-700' },
  purple: { card: 'border-purple-200 bg-purple-50', badge: 'bg-purple-100 text-purple-700', btn: 'bg-purple-600 hover:bg-purple-700' },
  emerald: { card: 'border-emerald-200 bg-emerald-50', badge: 'bg-emerald-100 text-emerald-700', btn: 'bg-emerald-600 hover:bg-emerald-700' },
}

function formatCLP(val) {
  if (val == null) return '—'
  return `$${Number(val).toLocaleString('es-CL')}`
}

function PlanCard({ planKey, config, onSaved }) {
  const meta = PLAN_META[planKey]
  const colors = colorMap[meta.color]
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [desc, setDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (config) {
      setForm({ ...config.params })
      setDesc(config.descripcion_contrato || '')
    }
  }, [config])

  const handleEdit = () => {
    setForm({ ...config.params })
    setDesc(config.descripcion_contrato || '')
    setError(null)
    setEditing(true)
  }

  const handleCancel = () => {
    setEditing(false)
    setError(null)
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const params = {}
      for (const campo of meta.campos) {
        const raw = form[campo.key]
        params[campo.key] = campo.tipo === 'float' ? parseFloat(raw) : parseInt(raw, 10)
        if (isNaN(params[campo.key])) throw new Error(`El campo "${campo.label}" debe ser un número válido`)
      }
      // Conservar variable original
      if (config.params.variable) params.variable = config.params.variable
      if (config.params.bloque && !params.bloque) params.bloque = config.params.bloque

      await api.put(`/inquilinos/config/planes/${planKey}`, { params, descripcion_contrato: desc })
      setEditing(false)
      onSaved()
    } catch (e) {
      setError(e.response?.data?.detail || e.message)
    } finally {
      setSaving(false)
    }
  }

  if (!config) return null

  return (
    <div className={`rounded-xl border-2 p-5 ${colors.card}`}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${colors.badge}`}>{planKey}</span>
          <h3 className="text-base font-semibold text-gray-800 mt-1">{meta.label}</h3>
          {config.updated_at && (
            <p className="text-xs text-gray-400 mt-0.5">
              Actualizado: {new Date(config.updated_at).toLocaleString('es-CL')}
            </p>
          )}
        </div>
        {!editing && (
          <button onClick={handleEdit} className="text-sm text-gray-600 hover:text-gray-900 underline">
            Editar
          </button>
        )}
      </div>

      {/* Campos */}
      <div className="space-y-3">
        {meta.campos.map(campo => (
          <div key={campo.key}>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              {campo.label}
              {campo.ayuda && <span className="text-gray-400 font-normal"> — {campo.ayuda}</span>}
            </label>
            {editing ? (
              <input
                type="number"
                step={campo.tipo === 'float' ? '0.1' : '1'}
                value={form[campo.key] ?? ''}
                onChange={e => setForm(f => ({ ...f, [campo.key]: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-400 bg-white"
              />
            ) : (
              <p className="text-sm font-semibold text-gray-800">
                {campo.tipo === 'float'
                  ? `${config.params[campo.key]} UF`
                  : campo.key.includes('max') || campo.key === 'bloque'
                    ? Number(config.params[campo.key]).toLocaleString('es-CL')
                    : formatCLP(config.params[campo.key])}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Descripción contrato */}
      <div className="mt-4">
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Descripción en contrato
        </label>
        {editing ? (
          <textarea
            rows={4}
            value={desc}
            onChange={e => setDesc(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 bg-white resize-y"
          />
        ) : (
          <p className="text-xs text-gray-600 bg-white/60 rounded-lg p-3 border border-gray-200">
            {config.descripcion_contrato || <span className="italic text-gray-400">Sin descripción</span>}
          </p>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {editing && (
        <div className="flex gap-2 mt-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className={`px-4 py-2 rounded-lg text-sm text-white font-medium ${colors.btn} disabled:opacity-50`}
          >
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
          <button
            onClick={handleCancel}
            className="px-4 py-2 rounded-lg text-sm border border-gray-300 text-gray-600 hover:bg-gray-100"
          >
            Cancelar
          </button>
        </div>
      )}
    </div>
  )
}

export default function PlanesTrackingTech() {
  const [planes, setPlanes] = useState([])
  const [loading, setLoading] = useState(true)
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
    if (!confirm('¿Restaurar todos los planes a los valores por defecto?')) return
    setResetting(true)
    try {
      const { data } = await api.post('/inquilinos/config/planes/reset')
      setPlanes(data)
    } catch (e) {
      alert(e.response?.data?.detail || 'Error al restaurar')
    } finally {
      setResetting(false)
    }
  }

  const byKey = Object.fromEntries(planes.map(p => [p.plan, p]))

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Planes Tracking Tech</h1>
          <p className="text-sm text-gray-500 mt-1">
            Configura los valores de cada tarifa. Los cambios aplican a los cobros generados a partir de este momento.
          </p>
        </div>
        <button
          onClick={handleReset}
          disabled={resetting}
          className="text-sm text-gray-500 hover:text-gray-800 underline"
        >
          {resetting ? 'Restaurando…' : 'Restaurar defaults'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="text-center text-gray-400 py-16">Cargando planes…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {Object.keys(PLAN_META).map(planKey => (
            <PlanCard
              key={planKey}
              planKey={planKey}
              config={byKey[planKey]}
              onSaved={cargar}
            />
          ))}
        </div>
      )}

      <div className="mt-8 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        <strong>Nota:</strong> Los valores mostrados son <em>netos (sin IVA)</em>. El 19% de IVA se agrega automáticamente al calcular cada cobro.
        La <strong>Tarifa C</strong> usa el último valor publicado de la UF para el mes de facturación, obtenido desde mindicador.cl.
      </div>
    </div>
  )
}
