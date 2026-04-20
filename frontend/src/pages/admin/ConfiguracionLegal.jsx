import { useState, useEffect } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import { Settings, Save, AlertTriangle, Clock, Plus, Pencil, Trash2 } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import Modal from '../../components/Modal'

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

      <JornadasSection />
    </div>
  )
}


// ── Gestión de jornadas horarias ─────────────────────────────────────────────

const JORNADA_EMPTY = { nombre: '', hora_entrada: '08:00', hora_salida: '17:00', minutos_colacion: 45, activa: true }

function JornadasSection() {
  const [jornadas, setJornadas] = useState([])
  const [modal, setModal] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(JORNADA_EMPTY)

  const cargar = () =>
    api.get('/jornadas-horarias', { params: { solo_activas: false } })
      .then(({ data }) => setJornadas(data || []))
      .catch(() => toast.error('Error al cargar jornadas'))

  useEffect(cargar, [])

  const abrirNueva = () => { setEditId(null); setForm(JORNADA_EMPTY); setModal(true) }
  const abrirEditar = (j) => { setEditId(j.id); setForm({ nombre: j.nombre, hora_entrada: j.hora_entrada, hora_salida: j.hora_salida, minutos_colacion: j.minutos_colacion, activa: j.activa }); setModal(true) }

  const guardar = (e) => {
    e.preventDefault()
    const payload = { ...form, minutos_colacion: Number(form.minutos_colacion) }
    const req = editId
      ? api.put(`/jornadas-horarias/${editId}`, payload)
      : api.post('/jornadas-horarias', payload)
    req.then(() => { toast.success(editId ? 'Jornada actualizada' : 'Jornada creada'); setModal(false); cargar() })
       .catch(err => toast.error(err.response?.data?.detail || 'Error al guardar'))
  }

  const eliminar = (j) => {
    if (!window.confirm(`¿Eliminar jornada "${j.nombre}"?`)) return
    api.delete(`/jornadas-horarias/${j.id}`)
      .then(() => { toast.success('Jornada eliminada'); cargar() })
      .catch(() => toast.error('Error al eliminar'))
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2"><Clock size={16} /> Jornadas horarias</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Define los horarios disponibles (entrada, salida, colación). Asigna una a cada trabajador en su perfil
            para que los contratos usen los valores correctos en <code className="bg-gray-100 px-1 rounded">{'{{jornada.hora_entrada}}'}</code>.
          </p>
        </div>
        <button onClick={abrirNueva} className="btn-primary flex items-center gap-1.5 text-sm">
          <Plus size={14} /> Nueva jornada
        </button>
      </div>

      {jornadas.length === 0
        ? <p className="text-sm text-gray-400 py-4 text-center">No hay jornadas definidas aún.</p>
        : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase text-gray-500 border-b border-gray-100">
                <th className="text-left py-2 font-medium">Nombre</th>
                <th className="text-center py-2 font-medium">Entrada</th>
                <th className="text-center py-2 font-medium">Salida</th>
                <th className="text-center py-2 font-medium">Colación</th>
                <th className="text-center py-2 font-medium">Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {jornadas.map(j => (
                <tr key={j.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 font-medium text-gray-800">{j.nombre}</td>
                  <td className="py-2 text-center text-gray-600">{j.hora_entrada}</td>
                  <td className="py-2 text-center text-gray-600">{j.hora_salida}</td>
                  <td className="py-2 text-center text-gray-500">{j.minutos_colacion} min</td>
                  <td className="py-2 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${j.activa ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {j.activa ? 'Activa' : 'Inactiva'}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    <button onClick={() => abrirEditar(j)} className="p-1 hover:text-blue-600 text-gray-400 rounded"><Pencil size={14} /></button>
                    <button onClick={() => eliminar(j)} className="p-1 hover:text-red-600 text-gray-400 rounded ml-1"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Editar jornada' : 'Nueva jornada horaria'}>
        <form onSubmit={guardar} className="space-y-4">
          <div>
            <label className="text-xs uppercase font-medium text-gray-600">Nombre</label>
            <input required className="input mt-1" placeholder="ej. Santiago 40hrs mañana"
              value={form.nombre} onChange={e => set('nombre', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs uppercase font-medium text-gray-600">Hora de entrada</label>
              <input required type="time" className="input mt-1"
                value={form.hora_entrada} onChange={e => set('hora_entrada', e.target.value)} />
            </div>
            <div>
              <label className="text-xs uppercase font-medium text-gray-600">Hora de salida</label>
              <input required type="time" className="input mt-1"
                value={form.hora_salida} onChange={e => set('hora_salida', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs uppercase font-medium text-gray-600">Minutos de colación</label>
            <input type="number" min={0} max={120} className="input mt-1"
              value={form.minutos_colacion} onChange={e => set('minutos_colacion', e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={form.activa} onChange={e => set('activa', e.target.checked)} />
            Jornada activa (disponible para asignar a trabajadores)
          </label>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={() => setModal(false)} className="btn-secondary">Cancelar</button>
            <button type="submit" className="btn-primary">{editId ? 'Guardar cambios' : 'Crear jornada'}</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
