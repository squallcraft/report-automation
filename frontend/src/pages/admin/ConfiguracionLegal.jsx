import { useState, useEffect } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import { Settings, Save, AlertTriangle, Clock, Plus, Pencil, Trash2, Building2, UserCheck, Scale } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import Modal from '../../components/Modal'

// ── Helpers ───────────────────────────────────────────────────────────────────

function SectionCard({ icon: Icon, title, description, color = 'indigo', children }) {
  const colors = {
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-100',
    blue:   'bg-blue-50 text-blue-600 border-blue-100',
    emerald:'bg-emerald-50 text-emerald-600 border-emerald-100',
    violet: 'bg-violet-50 text-violet-600 border-violet-100',
  }
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 bg-gray-50/50">
        <div className={`p-2 rounded-lg border ${colors[color]}`}>
          <Icon size={16} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
        </div>
      </div>
      <div className="p-6">{children}</div>
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────

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
    // Mandamos los campos string como cadena (incluso vacía "") para que el backend
    // pueda BORRAR un valor previo. Solo los numéricos / fechas usan null cuando vacío.
    api.put('/contratos/configuracion-legal', {
      jornada_legal_vigente: Number(cfg.jornada_legal_vigente),
      jornada_legal_proxima: cfg.jornada_legal_proxima ? Number(cfg.jornada_legal_proxima) : null,
      jornada_legal_proxima_desde: cfg.jornada_legal_proxima_desde || null,
      rep_legal_nombre: cfg.rep_legal_nombre ?? '',
      rep_legal_rut: cfg.rep_legal_rut ?? '',
      rep_legal_ci: cfg.rep_legal_ci ?? '',
      rep_legal_cargo: cfg.rep_legal_cargo ?? '',
      empresa_razon_social: cfg.empresa_razon_social ?? '',
      empresa_rut: cfg.empresa_rut ?? '',
      empresa_direccion: cfg.empresa_direccion ?? '',
      empresa_ciudad_comuna: cfg.empresa_ciudad_comuna ?? '',
      empresa_giro: cfg.empresa_giro ?? '',
      canal_portal_url: cfg.canal_portal_url ?? '',
    })
      .then(({ data }) => { setCfg(data); toast.success('Configuración guardada') })
      .catch(err => toast.error(err.response?.data?.detail || 'Error al guardar'))
      .finally(() => setSaving(false))
  }

  if (loading || !cfg) return (
    <div className="flex items-center justify-center h-64 text-gray-400">
      <div className="text-center space-y-2">
        <div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin mx-auto" />
        <p className="text-sm">Cargando configuración…</p>
      </div>
    </div>
  )

  const set = (k, v) => setCfg(c => ({ ...c, [k]: v }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configuración Legal"
        subtitle="Parámetros institucionales y jornada legal vigente"
        icon={Settings}
        accent="indigo"
      />

      <form onSubmit={guardar} className="space-y-5 max-w-3xl">

        {/* Jornada legal */}
        <SectionCard icon={Scale} title="Jornada legal" color="indigo"
          description="Jornada vigente para cálculo de IMM proporcional y validación de contratos.">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Jornada legal vigente">
              <div className="flex items-center gap-2">
                <input
                  type="number" min="1" max="60"
                  className="input-field"
                  value={cfg.jornada_legal_vigente}
                  onChange={(e) => set('jornada_legal_vigente', e.target.value)}
                />
                <span className="text-sm text-gray-500 whitespace-nowrap">hrs/sem</span>
              </div>
            </Field>
            <Field label="Próxima jornada">
              <div className="flex items-center gap-2">
                <input
                  type="number" min="1" max="60"
                  className="input-field"
                  placeholder="42 / 40"
                  value={cfg.jornada_legal_proxima || ''}
                  onChange={(e) => set('jornada_legal_proxima', e.target.value || null)}
                />
                <span className="text-sm text-gray-500 whitespace-nowrap">hrs/sem</span>
              </div>
            </Field>
            <Field label="Vigente desde">
              <input
                type="date"
                className="input-field"
                value={cfg.jornada_legal_proxima_desde || ''}
                onChange={(e) => set('jornada_legal_proxima_desde', e.target.value || null)}
              />
            </Field>
          </div>

          {cfg.jornada_legal_proxima && cfg.jornada_legal_proxima_desde && (
            <div className="mt-4 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <AlertTriangle size={15} className="text-amber-600 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-800">
                <strong>Reforma programada:</strong> a partir de {cfg.jornada_legal_proxima_desde},
                la jornada legal pasará a <strong>{cfg.jornada_legal_proxima} hrs/sem</strong>.
              </p>
            </div>
          )}
        </SectionCard>

        {/* Representante legal */}
        <SectionCard icon={UserCheck} title="Representante legal" color="blue"
          description="Aparece en el bloque de firmas de liquidaciones y anexos contractuales.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Nombre completo">
              <input type="text" className="input-field"
                placeholder="ej. Juan Pérez González"
                value={cfg.rep_legal_nombre || ''}
                onChange={(e) => set('rep_legal_nombre', e.target.value)} />
            </Field>
            <Field label="RUT">
              <input type="text" className="input-field"
                placeholder="ej. 12.345.678-9"
                value={cfg.rep_legal_rut || ''}
                onChange={(e) => set('rep_legal_rut', e.target.value)} />
            </Field>
            <Field label="Cédula de identidad">
              <input type="text" className="input-field"
                placeholder="ej. 12.345.678-9"
                value={cfg.rep_legal_ci || ''}
                onChange={(e) => set('rep_legal_ci', e.target.value)} />
            </Field>
            <Field label="Cargo">
              <input type="text" className="input-field"
                placeholder="ej. Gerente General"
                value={cfg.rep_legal_cargo || ''}
                onChange={(e) => set('rep_legal_cargo', e.target.value)} />
            </Field>
          </div>
        </SectionCard>

        {/* Empresa */}
        <SectionCard icon={Building2} title="Datos de la empresa" color="emerald"
          description="Sociedad empleadora en encabezados de contratos y anexos.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Razón social">
              <input type="text" className="input-field"
                placeholder="ej. Logística y Transporte SpA"
                value={cfg.empresa_razon_social || ''}
                onChange={(e) => set('empresa_razon_social', e.target.value)} />
            </Field>
            <Field label="RUT empresa">
              <input type="text" className="input-field"
                placeholder="ej. 77.512.163-7"
                value={cfg.empresa_rut || ''}
                onChange={(e) => set('empresa_rut', e.target.value)} />
            </Field>
            <Field label="Dirección" >
              <input type="text" className="input-field"
                placeholder="ej. Moneda 1137, of. 56"
                value={cfg.empresa_direccion || ''}
                onChange={(e) => set('empresa_direccion', e.target.value)} />
            </Field>
            <Field label="Ciudad / Comuna">
              <input type="text" className="input-field"
                placeholder="ej. Santiago"
                value={cfg.empresa_ciudad_comuna || ''}
                onChange={(e) => set('empresa_ciudad_comuna', e.target.value)} />
            </Field>
            <Field label="Giro">
              <input type="text" className="input-field"
                placeholder="ej. Actividades de mensajería"
                value={cfg.empresa_giro || ''}
                onChange={(e) => set('empresa_giro', e.target.value)} />
            </Field>
            <Field label="URL Portal de consultas" hint="Aparece en contratos como canal del trabajador">
              <input type="text" className="input-field"
                placeholder="ej. https://trabajadores.e-courier.cl"
                value={cfg.canal_portal_url || ''}
                onChange={(e) => set('canal_portal_url', e.target.value)} />
            </Field>
          </div>
        </SectionCard>

        <div className="flex items-center justify-between py-2">
          <p className="text-xs text-gray-400">
            {cfg.actualizado_por
              ? <>Última actualización por <strong className="text-gray-600">{cfg.actualizado_por}</strong> · {cfg.updated_at?.slice(0, 16).replace('T', ' ')}</>
              : 'Sin cambios registrados'}
          </p>
          <button type="submit" className="btn-primary flex items-center gap-2" disabled={saving}>
            <Save size={15} /> {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>

      <div className="max-w-3xl">
        <JornadasSection />
      </div>
    </div>
  )
}


// ── Gestión de jornadas horarias ──────────────────────────────────────────────

const JORNADA_EMPTY = { nombre: '', hora_entrada: '08:00', hora_salida: '17:00', minutos_colacion: 45, horas_semana: 40, activa: true }

function calcularSalida(hora_entrada, horas_semana, minutos_colacion) {
  const [h, m] = (hora_entrada || '08:00').split(':').map(Number)
  const minsDia = Math.round((Number(horas_semana) / 5) * 60)
  const total = h * 60 + m + minsDia + Number(minutos_colacion)
  const hh = Math.floor(total / 60) % 24
  const mm = total % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

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
  const abrirEditar = (j) => {
    setEditId(j.id)
    setForm({
      nombre: j.nombre,
      hora_entrada: j.hora_entrada,
      hora_salida: j.hora_salida,
      minutos_colacion: j.minutos_colacion,
      horas_semana: 40,
      activa: j.activa,
    })
    setModal(true)
  }

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
    <SectionCard icon={Clock} title="Jornadas horarias" color="violet"
      description="Horarios disponibles para asignar a trabajadores. Se usan en {{jornada.hora_entrada}} del contrato.">

      <div className="flex justify-end mb-4 -mt-1">
        <button onClick={abrirNueva} className="btn-primary flex items-center gap-1.5 text-sm">
          <Plus size={14} /> Nueva jornada
        </button>
      </div>

      {jornadas.length === 0 ? (
        <div className="text-center py-8 text-gray-400 border border-dashed border-gray-200 rounded-lg">
          <Clock size={28} className="mx-auto mb-2 opacity-40" />
          <p className="text-sm">No hay jornadas definidas aún.</p>
          <p className="text-xs mt-0.5">Crea una para asignarla a los trabajadores.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">Nombre</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">Entrada</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">Salida</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">Colación</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">Estado</th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {jornadas.map(j => (
                <tr key={j.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-800">{j.nombre}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="font-mono text-sm bg-gray-100 px-2 py-0.5 rounded text-gray-700">{j.hora_entrada}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="font-mono text-sm bg-gray-100 px-2 py-0.5 rounded text-gray-700">{j.hora_salida}</span>
                  </td>
                  <td className="px-4 py-3 text-center text-gray-500 text-sm">{j.minutos_colacion} min</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${j.activa ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                      {j.activa ? 'Activa' : 'Inactiva'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => abrirEditar(j)} className="p-1.5 hover:bg-blue-50 hover:text-blue-600 text-gray-400 rounded-md transition-colors"><Pencil size={14} /></button>
                      <button onClick={() => eliminar(j)} className="p-1.5 hover:bg-red-50 hover:text-red-600 text-gray-400 rounded-md transition-colors"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Editar jornada' : 'Nueva jornada horaria'}>
        <form onSubmit={guardar} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
            <input required className="input-field" placeholder="ej. Santiago 40hrs mañana"
              value={form.nombre} onChange={e => set('nombre', e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Horas semanales</label>
              <div className="flex items-center gap-2">
                <input
                  required type="number" min={1} max={60}
                  className="input-field"
                  value={form.horas_semana}
                  onChange={e => {
                    const v = e.target.value
                    set('horas_semana', v)
                    set('hora_salida', calcularSalida(form.hora_entrada, v, form.minutos_colacion))
                  }}
                />
                <span className="text-sm text-gray-500 whitespace-nowrap">hrs/sem</span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">{Math.round((Number(form.horas_semana) / 5) * 10) / 10} hrs/día</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Minutos de colación</label>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={0} max={120}
                  className="input-field"
                  value={form.minutos_colacion}
                  onChange={e => {
                    const v = e.target.value
                    set('minutos_colacion', v)
                    set('hora_salida', calcularSalida(form.hora_entrada, form.horas_semana, v))
                  }}
                />
                <span className="text-sm text-gray-500 whitespace-nowrap">min</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Hora de ingreso</label>
              <input
                required type="time" className="input-field"
                value={form.hora_entrada}
                onChange={e => {
                  const v = e.target.value
                  set('hora_entrada', v)
                  set('hora_salida', calcularSalida(v, form.horas_semana, form.minutos_colacion))
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Hora de salida
                <span className="ml-1.5 text-xs font-normal text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded">calculada</span>
              </label>
              <input
                type="time" className="input-field bg-gray-50 text-gray-700 font-mono"
                value={form.hora_salida}
                onChange={e => set('hora_salida', e.target.value)}
              />
              <p className="text-xs text-gray-400 mt-0.5">Puedes ajustarla manualmente si es necesario</p>
            </div>
          </div>

          <div className="rounded-lg bg-indigo-50 border border-indigo-100 px-4 py-3 text-sm text-indigo-800 flex items-center justify-between">
            <span>Jornada diaria</span>
            <span className="font-semibold font-mono">{form.hora_entrada} → {form.hora_salida}</span>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
            <input type="checkbox" className="rounded" checked={form.activa} onChange={e => set('activa', e.target.checked)} />
            Jornada activa (disponible para asignar a trabajadores)
          </label>
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <button type="button" onClick={() => setModal(false)} className="btn-secondary">Cancelar</button>
            <button type="submit" className="btn-primary">{editId ? 'Guardar cambios' : 'Crear jornada'}</button>
          </div>
        </form>
      </Modal>
    </SectionCard>
  )
}
