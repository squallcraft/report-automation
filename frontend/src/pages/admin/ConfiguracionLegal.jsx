import { useState, useEffect } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import { Settings, Save, AlertTriangle, Calendar } from 'lucide-react'
import PageHeader from '../../components/PageHeader'

export default function ConfiguracionLegal() {
  const [cfg, setCfg] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const cargar = () => {
    setLoading(true)
    api.get('/contratos/configuracion-legal')
      .then(({ data }) => setCfg(data))
      .catch(() => toast.error('Error al cargar configuración'))
      .finally(() => setLoading(false))
  }
  useEffect(cargar, [])

  const guardar = (e) => {
    e?.preventDefault()
    setSaving(true)
    api.put('/contratos/configuracion-legal', {
      jornada_legal_vigente: Number(cfg.jornada_legal_vigente),
      jornada_legal_proxima: cfg.jornada_legal_proxima ? Number(cfg.jornada_legal_proxima) : null,
      jornada_legal_proxima_desde: cfg.jornada_legal_proxima_desde || null,
      rep_legal_nombre: cfg.rep_legal_nombre || null,
      rep_legal_rut: cfg.rep_legal_rut || null,
      rep_legal_ci: cfg.rep_legal_ci || null,
      rep_legal_cargo: cfg.rep_legal_cargo || null,
      empresa_razon_social: cfg.empresa_razon_social || null,
      empresa_rut: cfg.empresa_rut || null,
      empresa_direccion: cfg.empresa_direccion || null,
      empresa_ciudad_comuna: cfg.empresa_ciudad_comuna || null,
      empresa_giro: cfg.empresa_giro || null,
      canal_portal_url: cfg.canal_portal_url || null,
    })
      .then(({ data }) => { setCfg(data); toast.success('Configuración guardada') })
      .catch(err => toast.error(err.response?.data?.detail || 'Error al guardar'))
      .finally(() => setSaving(false))
  }

  if (loading || !cfg) return <div className="p-8 text-center text-gray-500">Cargando…</div>

  const set = (k, v) => setCfg(c => ({ ...c, [k]: v }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configuración Legal"
        subtitle="Parámetros institucionales y jornada legal vigente"
        icon={Settings}
        accent="indigo"
      />

      <form onSubmit={guardar} className="space-y-6 max-w-3xl">
        {/* Jornada legal */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Jornada legal</h2>
          <p className="text-xs text-gray-500 mb-4">
            La jornada legal vigente se usa para calcular el IMM proporcional de jornadas parciales
            y para validar contratos. La jornada próxima permite anticipar reformas (ej. Ley 21.561).
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-xs uppercase font-medium text-gray-600">Jornada legal vigente</label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="number" min="1" max="60" className="input"
                  value={cfg.jornada_legal_vigente}
                  onChange={(e) => set('jornada_legal_vigente', e.target.value)}
                />
                <span className="text-sm text-gray-500">hrs/sem</span>
              </div>
            </div>
            <div>
              <label className="text-xs uppercase font-medium text-gray-600">Próxima jornada</label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="number" min="1" max="60" className="input"
                  placeholder="42 / 40"
                  value={cfg.jornada_legal_proxima || ''}
                  onChange={(e) => set('jornada_legal_proxima', e.target.value || null)}
                />
                <span className="text-sm text-gray-500">hrs/sem</span>
              </div>
            </div>
            <div>
              <label className="text-xs uppercase font-medium text-gray-600">Vigente desde</label>
              <input
                type="date" className="input mt-1"
                value={cfg.jornada_legal_proxima_desde || ''}
                onChange={(e) => set('jornada_legal_proxima_desde', e.target.value || null)}
              />
            </div>
          </div>

          {cfg.jornada_legal_proxima && cfg.jornada_legal_proxima_desde && (
            <div className="mt-4 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
              <div className="text-xs text-amber-800">
                <strong>Reforma programada:</strong> a partir de {cfg.jornada_legal_proxima_desde},
                la jornada legal pasará a {cfg.jornada_legal_proxima} hrs/sem. Al activarse, el sistema
                generará banner de adecuación masiva en la pantalla de generar liquidaciones.
              </div>
            </div>
          )}
        </div>

        {/* Representante legal */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Representante legal</h2>
          <p className="text-xs text-gray-500 mb-4">
            Datos que aparecen en el bloque de firmas de liquidaciones y anexos contractuales.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs uppercase font-medium text-gray-600">Nombre</label>
              <input
                type="text" className="input mt-1"
                value={cfg.rep_legal_nombre || ''}
                onChange={(e) => set('rep_legal_nombre', e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs uppercase font-medium text-gray-600">RUT</label>
              <input
                type="text" className="input mt-1"
                value={cfg.rep_legal_rut || ''}
                onChange={(e) => set('rep_legal_rut', e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs uppercase font-medium text-gray-600">Cédula de identidad</label>
              <input
                type="text" className="input mt-1"
                placeholder="ej. 12.345.678-9"
                value={cfg.rep_legal_ci || ''}
                onChange={(e) => set('rep_legal_ci', e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs uppercase font-medium text-gray-600">Cargo</label>
              <input
                type="text" className="input mt-1"
                placeholder="ej. Gerente General"
                value={cfg.rep_legal_cargo || ''}
                onChange={(e) => set('rep_legal_cargo', e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Empresa */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Datos de la empresa</h2>
          <p className="text-xs text-gray-500 mb-4">
            Aparecen en el encabezado de los anexos contractuales y como sociedad empleadora.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs uppercase font-medium text-gray-600">Razón social</label>
              <input
                type="text" className="input mt-1"
                value={cfg.empresa_razon_social || ''}
                onChange={(e) => set('empresa_razon_social', e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs uppercase font-medium text-gray-600">RUT empresa</label>
              <input
                type="text" className="input mt-1"
                value={cfg.empresa_rut || ''}
                onChange={(e) => set('empresa_rut', e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs uppercase font-medium text-gray-600">Dirección</label>
              <input
                type="text" className="input mt-1"
                value={cfg.empresa_direccion || ''}
                onChange={(e) => set('empresa_direccion', e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs uppercase font-medium text-gray-600">Ciudad / Comuna</label>
              <input
                type="text" className="input mt-1"
                placeholder="ej. Santiago, Las Condes"
                value={cfg.empresa_ciudad_comuna || ''}
                onChange={(e) => set('empresa_ciudad_comuna', e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs uppercase font-medium text-gray-600">Giro</label>
              <input
                type="text" className="input mt-1"
                placeholder="ej. Transporte de carga"
                value={cfg.empresa_giro || ''}
                onChange={(e) => set('empresa_giro', e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs uppercase font-medium text-gray-600">URL Portal de consultas</label>
              <input
                type="text" className="input mt-1"
                placeholder="ej. https://trabajadores.e-courier.cl"
                value={cfg.canal_portal_url || ''}
                onChange={(e) => set('canal_portal_url', e.target.value)}
              />
              <p className="text-xs text-gray-400 mt-0.5">Aparece en los contratos como canal de consultas del trabajador</p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <div className="text-xs text-gray-500">
            {cfg.actualizado_por && (
              <>Última actualización por <strong>{cfg.actualizado_por}</strong> · {cfg.updated_at?.slice(0, 16).replace('T', ' ')}</>
            )}
          </div>
          <button type="submit" className="btn-primary flex items-center gap-2" disabled={saving}>
            <Save size={16} /> {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </div>
  )
}
