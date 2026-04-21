import { useState, useEffect } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import {
  X, Briefcase, FileText, Plus, Upload, Calendar, AlertTriangle, Download,
  Clock, Pencil, FileSignature, Info, Send, CheckCircle, XCircle, Eye, Sparkles, Copy,
} from 'lucide-react'

const fmt = (v) => `$${Number(v || 0).toLocaleString('es-CL')}`

const MOTIVOS = [
  { id: 'CONTRATACION', label: 'Contratación inicial' },
  { id: 'AUMENTO_SUELDO', label: 'Aumento de sueldo' },
  { id: 'REDUCCION_JORNADA', label: 'Reducción de jornada (sube valor hora, sueldo igual)' },
  { id: 'ADECUACION_JORNADA_LEGAL', label: 'Adecuación a nueva jornada legal (Ley 21.561)' },
  { id: 'REAJUSTE_IMM', label: 'Reajuste por IMM (informativo, sin firma)' },
  { id: 'CAMBIO_CARGO', label: 'Cambio de cargo' },
  { id: 'CAMBIO_ASIGNACIONES', label: 'Cambio de movilización/colación' },
  { id: 'OTRO', label: 'Otro' },
]

const TIPO_CONTRATO = ['INDEFINIDO', 'PLAZO_FIJO', 'OBRA_FAENA', 'HONORARIOS']

export default function ContratacionPanel({ trabajador, onClose }) {
  const [versiones, setVersiones] = useState([])
  const [anexos, setAnexos] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('historial')

  // Forms
  const [showFormVersion, setShowFormVersion] = useState(false)
  const [showFormFisico, setShowFormFisico] = useState(false)
  const [showFormCaminoB, setShowFormCaminoB] = useState(false)

  const cargar = async () => {
    setLoading(true)
    try {
      const [v, a] = await Promise.all([
        api.get(`/contratos/trabajador/${trabajador.id}/versiones`),
        api.get(`/contratos/trabajador/${trabajador.id}/anexos`),
      ])
      setVersiones(v.data)
      setAnexos(a.data)
    } catch {
      toast.error('Error al cargar gestión contractual')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { cargar() }, [trabajador.id])

  const verAnexoPdf = async (a) => {
    try {
      const { data } = await api.get(`/contratos/anexos/${a.id}/pdf`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }))
      window.open(url, '_blank')
    } catch {
      toast.error('Error al abrir el PDF')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-stretch justify-end">
      <div className="bg-white w-full max-w-3xl h-full overflow-y-auto shadow-2xl">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <Briefcase size={18} className="text-indigo-600" />
              Contratación — {trabajador.nombre}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">RUT {trabajador.rut || '—'} · {trabajador.cargo || 'Sin cargo'}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-4 flex gap-1 border-b border-gray-200">
          {[
            { id: 'historial', label: 'Historial contractual', icon: Clock },
            { id: 'anexos', label: 'Anexos', icon: FileText },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                tab === t.id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <t.icon size={14} /> {t.label}
            </button>
          ))}
        </div>

        <div className="p-6 space-y-4">
          {loading ? (
            <div className="text-center py-12 text-gray-500">Cargando…</div>
          ) : tab === 'historial' ? (
            <Historial
              versiones={versiones}
              trabajador={trabajador}
              onNuevaVersion={() => setShowFormVersion(true)}
              onSubirFisico={() => setShowFormFisico(true)}
              onCaminoB={() => setShowFormCaminoB(true)}
            />
          ) : (
            <ListaAnexos anexos={anexos} onVerPdf={verAnexoPdf} onChange={cargar} />
          )}
        </div>

        {showFormVersion && (
          <FormNuevaVersion
            trabajador={trabajador}
            anterior={versiones[0]}
            onClose={() => setShowFormVersion(false)}
            onSaved={() => { setShowFormVersion(false); cargar() }}
          />
        )}

        {showFormFisico && (
          <FormSubirContratoFisico
            trabajador={trabajador}
            onClose={() => setShowFormFisico(false)}
            onSaved={() => { setShowFormFisico(false); cargar() }}
          />
        )}

        {showFormCaminoB && (
          <FormCaminoB
            trabajador={trabajador}
            onClose={() => setShowFormCaminoB(false)}
            onSaved={() => { setShowFormCaminoB(false); cargar() }}
          />
        )}
      </div>
    </div>
  )
}


function Historial({ versiones, trabajador, onNuevaVersion, onSubirFisico, onCaminoB }) {
  if (versiones.length === 0) {
    return (
      <div className="space-y-3">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900 flex items-start gap-2">
          <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Sin contrato migrado</p>
            <p className="text-xs mt-1">
              Este trabajador no tiene contrato cargado en el sistema. Elige cómo migrarlo.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button onClick={onCaminoB} className="border-2 border-dashed border-emerald-300 rounded-lg p-6 text-center hover:bg-emerald-50 transition-colors">
            <Sparkles size={24} className="mx-auto text-emerald-500 mb-2" />
            <p className="font-medium text-gray-900">Generar contrato digital</p>
            <p className="text-xs text-gray-500 mt-1">Para trabajadores nuevos. Usa una plantilla y firma electrónica.</p>
          </button>
          <button onClick={onSubirFisico} className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:bg-gray-50 hover:border-indigo-400 transition-colors">
            <Upload size={24} className="mx-auto text-gray-400 mb-2" />
            <p className="font-medium text-gray-900">Subir contrato físico</p>
            <p className="text-xs text-gray-500 mt-1">Para trabajadores antiguos con PDF firmado en papel.</p>
          </button>
          <button onClick={onNuevaVersion} className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:bg-gray-50 hover:border-indigo-400 transition-colors">
            <Plus size={24} className="mx-auto text-gray-400 mb-2" />
            <p className="font-medium text-gray-900">Registrar manualmente</p>
            <p className="text-xs text-gray-500 mt-1">Solo registra los términos contractuales sin generar PDF.</p>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Versiones contractuales</h3>
        <div className="flex gap-2">
          <button onClick={onCaminoB} className="text-xs text-emerald-700 px-3 py-1.5 border border-emerald-300 rounded-md hover:bg-emerald-50 flex items-center gap-1">
            <Sparkles size={12} /> Generar digital
          </button>
          <button onClick={onSubirFisico} className="text-xs text-gray-700 px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50 flex items-center gap-1">
            <Upload size={12} /> Subir físico
          </button>
          <button onClick={onNuevaVersion} className="text-xs text-white px-3 py-1.5 bg-indigo-600 rounded-md hover:bg-indigo-700 flex items-center gap-1">
            <Plus size={12} /> Nuevo cambio
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {versiones.map((v, idx) => {
          const isVigente = !v.vigente_hasta
          return (
            <div key={v.id} className={`border rounded-lg p-3 ${isVigente ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 bg-white'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded ${isVigente ? 'bg-emerald-600 text-white' : 'bg-gray-300 text-gray-700'}`}>
                      {isVigente ? 'Vigente' : 'Histórico'}
                    </span>
                    <span className="text-xs text-gray-500">
                      {v.vigente_desde}{v.vigente_hasta ? ` → ${v.vigente_hasta}` : ' → presente'}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-gray-900">
                    {MOTIVOS.find(m => m.id === v.motivo)?.label || v.motivo}
                  </p>
                  <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div>
                      <div className="text-gray-500">Líquido</div>
                      <div className="font-bold text-gray-900">{fmt(v.sueldo_liquido)}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">Sueldo base</div>
                      <div className="font-medium text-gray-700">{fmt(v.sueldo_base)}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">Jornada</div>
                      <div className="font-medium text-gray-700">{v.jornada_semanal_horas} hrs ({v.tipo_jornada?.toLowerCase()})</div>
                    </div>
                    <div>
                      <div className="text-gray-500">Cargo</div>
                      <div className="font-medium text-gray-700">{v.cargo || '—'}</div>
                    </div>
                  </div>
                  {v.notas && (
                    <p className="text-xs text-gray-500 italic mt-2">"{v.notas}"</p>
                  )}
                  {v.creado_por && (
                    <p className="text-[11px] text-gray-400 mt-1">
                      Creada por {v.creado_por} · {v.created_at?.slice(0, 16).replace('T', ' ')}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}


function ListaAnexos({ anexos, onVerPdf, onChange }) {
  if (anexos.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 text-sm">
        <FileText size={32} className="mx-auto text-gray-300 mb-2" />
        Aún no se han generado anexos para este trabajador.
      </div>
    )
  }

  const estadoBadge = (e) => {
    const map = {
      BORRADOR: 'bg-gray-200 text-gray-700',
      EMITIDO: 'bg-amber-100 text-amber-800',
      INFORMATIVO: 'bg-blue-100 text-blue-800',
      FIRMADO: 'bg-emerald-100 text-emerald-800',
      RECHAZADO: 'bg-red-100 text-red-800',
    }
    return map[e] || 'bg-gray-200 text-gray-700'
  }

  const aprobar = async (a) => {
    try {
      await api.post(`/contratos/anexos/${a.id}/aprobar-emision`)
      toast.success('Aprobado y notificado al trabajador')
      onChange?.()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al aprobar')
    }
  }

  const descartar = async (a) => {
    if (!window.confirm('¿Descartar este borrador? No se podrá recuperar.')) return
    try {
      await api.post(`/contratos/anexos/${a.id}/rechazar-borrador`)
      toast.success('Borrador descartado')
      onChange?.()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al descartar')
    }
  }

  return (
    <div className="space-y-2">
      {anexos.map(a => (
        <div key={a.id} className="bg-white border border-gray-200 rounded-lg p-3 flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded ${estadoBadge(a.estado)}`}>
                {a.estado}
              </span>
              {!a.requiere_firma_trabajador && (
                <span className="text-[11px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded flex items-center gap-1">
                  <Info size={10} /> Sin firma
                </span>
              )}
              {a.plantilla_id && (
                <span className="text-[11px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded flex items-center gap-1">
                  <Sparkles size={10} /> Digital
                </span>
              )}
              {a.firmado_at && (
                <span className="text-[11px] text-emerald-700">
                  Firmado {a.firmado_at.slice(0, 10)}
                </span>
              )}
              {a.aprobado_at && a.estado === 'EMITIDO' && (
                <span className="text-[11px] text-amber-700">
                  Esperando firma · aprobado {a.aprobado_at.slice(0, 10)}
                </span>
              )}
            </div>
            <p className="text-sm font-medium text-gray-900 mt-1 truncate">{a.titulo}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {a.creado_por && <>Creado por {a.creado_por} · </>}
              {a.created_at?.slice(0, 16).replace('T', ' ')}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => onVerPdf(a)}
              className="text-xs px-2.5 py-1.5 border border-gray-300 rounded hover:bg-gray-50 flex items-center gap-1"
              title="Ver PDF"
            >
              <Eye size={12} /> PDF
            </button>
            {a.estado === 'BORRADOR' && (
              <>
                <button
                  onClick={() => aprobar(a)}
                  className="text-xs px-2.5 py-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 flex items-center gap-1"
                  title="Aprobar y notificar al trabajador para firma"
                >
                  <Send size={12} /> Aprobar
                </button>
                <button
                  onClick={() => descartar(a)}
                  className="text-xs px-2 py-1.5 border border-red-200 text-red-700 rounded hover:bg-red-50"
                  title="Descartar borrador"
                >
                  <XCircle size={12} />
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}


// ── Form: Nueva versión ─────────────────────────────────────────────────────
function FormNuevaVersion({ trabajador, anterior, onClose, onSaved }) {
  const [form, setForm] = useState({
    vigente_desde: new Date().toISOString().slice(0, 10),
    motivo: anterior ? 'AUMENTO_SUELDO' : 'CONTRATACION',
    sueldo_liquido: anterior?.sueldo_liquido || trabajador.sueldo_liquido || 0,
    movilizacion: anterior?.movilizacion ?? trabajador.movilizacion ?? 0,
    colacion: anterior?.colacion ?? trabajador.colacion ?? 0,
    viaticos: anterior?.viaticos ?? trabajador.viaticos ?? 0,
    jornada_semanal_horas: anterior?.jornada_semanal_horas || 44,
    cargo: anterior?.cargo || trabajador.cargo || '',
    tipo_contrato: anterior?.tipo_contrato || trabajador.tipo_contrato || 'INDEFINIDO',
    distribucion_jornada: anterior?.distribucion_jornada || 'LUNES_VIERNES',
    notas: '',
    generar_anexo: true,
  })
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const guardar = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.post(`/contratos/trabajador/${trabajador.id}/versiones`, {
        ...form,
        sueldo_liquido: Number(form.sueldo_liquido),
        movilizacion: Number(form.movilizacion) || 0,
        colacion: Number(form.colacion) || 0,
        viaticos: Number(form.viaticos) || 0,
        jornada_semanal_horas: Number(form.jornada_semanal_horas),
      })
      toast.success(form.generar_anexo ? 'Versión y anexo generados' : 'Versión creada')
      onSaved()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  // Sub-flujo "adecuación jornada legal" con dos opciones
  const isAdecuacion = form.motivo === 'ADECUACION_JORNADA_LEGAL'
  const [opcionAdec, setOpcionAdec] = useState('reducir_jornada')

  useEffect(() => {
    if (isAdecuacion && anterior) {
      if (opcionAdec === 'reducir_jornada') {
        set('sueldo_liquido', anterior.sueldo_liquido)
      } else if (opcionAdec === 'subir_sueldo') {
        set('jornada_semanal_horas', anterior.jornada_semanal_horas)
      }
    }
  }, [opcionAdec, isAdecuacion])

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <h3 className="text-base font-bold text-gray-900">Nuevo cambio contractual</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded"><X size={16} /></button>
        </div>

        <form onSubmit={guardar} className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-600 uppercase">Tipo de cambio</label>
            <select className="input mt-1" value={form.motivo} onChange={(e) => set('motivo', e.target.value)}>
              {MOTIVOS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>

          {isAdecuacion && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-amber-900 mb-2">Elige la fórmula de adecuación:</p>
              <div className="space-y-2">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio" name="opAdec" value="reducir_jornada"
                    checked={opcionAdec === 'reducir_jornada'}
                    onChange={() => setOpcionAdec('reducir_jornada')}
                  />
                  <span className="text-xs text-amber-900">
                    <strong>Reducir jornada, mantener sueldo</strong> (lo más común — Ley 21.561 prohíbe bajar el sueldo)
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio" name="opAdec" value="subir_sueldo"
                    checked={opcionAdec === 'subir_sueldo'}
                    onChange={() => setOpcionAdec('subir_sueldo')}
                  />
                  <span className="text-xs text-amber-900">
                    <strong>Mantener jornada, subir sueldo proporcional</strong>
                  </span>
                </label>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 uppercase">Vigente desde</label>
              <input type="date" className="input mt-1" value={form.vigente_desde} onChange={(e) => set('vigente_desde', e.target.value)} required />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 uppercase">Tipo contrato</label>
              <select className="input mt-1" value={form.tipo_contrato} onChange={(e) => set('tipo_contrato', e.target.value)}>
                {TIPO_CONTRATO.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 uppercase">Sueldo líquido</label>
              <input type="number" min="0" className="input mt-1" value={form.sueldo_liquido} onChange={(e) => set('sueldo_liquido', e.target.value)} required />
              {anterior && Number(form.sueldo_liquido) !== Number(anterior.sueldo_liquido) && (
                <p className="text-[11px] mt-1 text-blue-600">
                  Anterior: {fmt(anterior.sueldo_liquido)} → Δ {fmt(Number(form.sueldo_liquido) - Number(anterior.sueldo_liquido))}
                </p>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 uppercase">Jornada semanal (hrs)</label>
              <input type="number" min="1" max="60" className="input mt-1" value={form.jornada_semanal_horas} onChange={(e) => set('jornada_semanal_horas', e.target.value)} />
              {Number(form.jornada_semanal_horas) <= 30 && (
                <p className="text-[11px] mt-1 text-amber-600">⚠ Jornada parcial (Art. 40 bis): IMM se calcula proporcional</p>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 uppercase">Movilización</label>
              <input type="number" min="0" className="input mt-1" value={form.movilizacion} onChange={(e) => set('movilizacion', e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 uppercase">Colación</label>
              <input type="number" min="0" className="input mt-1" value={form.colacion} onChange={(e) => set('colacion', e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 uppercase">Viáticos</label>
              <input type="number" min="0" className="input mt-1" value={form.viaticos} onChange={(e) => set('viaticos', e.target.value)} />
              <p className="text-[11px] mt-1 text-gray-400">Asignación no imponible (Art. 41 CT)</p>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 uppercase">Cargo</label>
              <input type="text" className="input mt-1" value={form.cargo} onChange={(e) => set('cargo', e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 uppercase">Distribución jornada</label>
              <select className="input mt-1" value={form.distribucion_jornada} onChange={(e) => set('distribucion_jornada', e.target.value)}>
                <option value="LUNES_VIERNES">Lunes a Viernes</option>
                <option value="LUNES_SABADO">Lunes a Sábado</option>
                <option value="TURNOS">Sistema de turnos</option>
                <option value="OTRO">Otro</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 uppercase">Notas internas</label>
            <textarea className="input mt-1" rows={2} value={form.notas} onChange={(e) => set('notas', e.target.value)}
              placeholder="Detalles del acuerdo, fundamentos del cambio…" />
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.generar_anexo} onChange={(e) => set('generar_anexo', e.target.checked)} />
            <span>Generar PDF de anexo automáticamente
              {form.motivo === 'REAJUSTE_IMM' && (
                <span className="text-xs text-blue-600 ml-2">(será informativo, sin requerir firma)</span>
              )}
            </span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Guardando…' : 'Crear versión'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}


// ── Form: Subir contrato físico ─────────────────────────────────────────────
function FormSubirContratoFisico({ trabajador, onClose, onSaved }) {
  const [archivo, setArchivo] = useState(null)
  const [form, setForm] = useState({
    vigente_desde: trabajador.fecha_ingreso || new Date().toISOString().slice(0, 10),
    sueldo_liquido: trabajador.sueldo_liquido || 0,
    jornada_semanal_horas: 44,
    cargo: trabajador.cargo || '',
    tipo_contrato: trabajador.tipo_contrato || 'INDEFINIDO',
    notas: '',
  })
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const guardar = async (e) => {
    e.preventDefault()
    if (!archivo) return toast.error('Selecciona un PDF')
    setSaving(true)
    try {
      const fd = new FormData()
      fd.append('archivo', archivo)
      fd.append('vigente_desde', form.vigente_desde)
      fd.append('sueldo_liquido', String(form.sueldo_liquido))
      fd.append('jornada_semanal_horas', String(form.jornada_semanal_horas))
      if (form.cargo) fd.append('cargo', form.cargo)
      if (form.tipo_contrato) fd.append('tipo_contrato', form.tipo_contrato)
      if (form.notas) fd.append('notas', form.notas)
      await api.post(`/contratos/trabajador/${trabajador.id}/contrato-fisico`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      toast.success('Contrato físico migrado')
      onSaved()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al subir')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <h3 className="text-base font-bold text-gray-900">Subir contrato físico digitalizado</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded"><X size={16} /></button>
        </div>

        <form onSubmit={guardar} className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-600 uppercase">Archivo PDF *</label>
            <input
              type="file" accept="application/pdf"
              className="mt-1 block w-full text-sm border border-gray-300 rounded-lg p-2"
              onChange={(e) => setArchivo(e.target.files?.[0] || null)}
              required
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 uppercase">Vigente desde *</label>
              <input type="date" className="input mt-1" value={form.vigente_desde} onChange={(e) => set('vigente_desde', e.target.value)} required />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 uppercase">Sueldo líquido pactado *</label>
              <input type="number" min="0" className="input mt-1" value={form.sueldo_liquido} onChange={(e) => set('sueldo_liquido', e.target.value)} required />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 uppercase">Jornada semanal (hrs)</label>
              <input type="number" min="1" max="60" className="input mt-1" value={form.jornada_semanal_horas} onChange={(e) => set('jornada_semanal_horas', e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 uppercase">Tipo contrato</label>
              <select className="input mt-1" value={form.tipo_contrato} onChange={(e) => set('tipo_contrato', e.target.value)}>
                {TIPO_CONTRATO.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-gray-600 uppercase">Cargo</label>
              <input type="text" className="input mt-1" value={form.cargo} onChange={(e) => set('cargo', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 uppercase">Notas</label>
            <textarea className="input mt-1" rows={2} value={form.notas} onChange={(e) => set('notas', e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Subiendo…' : 'Subir contrato'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}


// ── Form: Camino B (contrato digital desde plantilla) ───────────────────────
function FormCaminoB({ trabajador, onClose, onSaved }) {
  const [step, setStep] = useState('plantilla') // plantilla -> datos -> preview -> emitido
  const [plantillas, setPlantillas] = useState([])
  const [contratosBase, setContratosBase] = useState([])
  const [plantillaId, setPlantillaId] = useState('')
  const [contratoBaseId, setContratoBaseId] = useState('')
  const [form, setForm] = useState({
    vigente_desde: new Date().toISOString().slice(0, 10),
    fecha_termino: '',
    sueldo_liquido: trabajador.sueldo_liquido || 0,
    movilizacion: trabajador.movilizacion || 0,
    colacion: trabajador.colacion || 0,
    viaticos: trabajador.viaticos || 0,
    jornada_semanal_horas: 44,
    tipo_jornada: 'COMPLETA',
    distribucion_jornada: 'LUNES_VIERNES',
    cargo: trabajador.cargo || '',
    tipo_contrato: trabajador.tipo_contrato || 'INDEFINIDO',
    clausulas_adicionales: '',
  })
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    api.get('/plantillas-contrato', { params: { activa: true } })
      .then(({ data }) => setPlantillas(data || []))
      .catch(() => toast.error('No se pudieron cargar las plantillas'))
    api.get('/contratos/contratos-base/disponibles')
      .then(({ data }) => setContratosBase(data || []))
      .catch(() => {})
  }, [])

  const usarComoBase = async () => {
    if (!contratoBaseId) return
    try {
      const { data } = await api.get(`/contratos/contratos-base/${contratoBaseId}/contenido`)
      if (data.plantilla_id) setPlantillaId(String(data.plantilla_id))
      toast.success(`Base cargada: ${data.titulo}`)
      setStep('datos')
    } catch {
      toast.error('No se pudo cargar la base')
    }
  }

  const generarPreview = async () => {
    if (!plantillaId) { toast.error('Elige una plantilla'); return }
    setLoading(true)
    try {
      const payload = {
        plantilla_id: Number(plantillaId),
        ...form,
        sueldo_liquido: Number(form.sueldo_liquido),
        movilizacion: Number(form.movilizacion) || 0,
        colacion: Number(form.colacion) || 0,
        viaticos: Number(form.viaticos) || 0,
        jornada_semanal_horas: Number(form.jornada_semanal_horas),
        fecha_termino: form.fecha_termino || null,
      }
      const { data } = await api.post(
        `/contratos/trabajador/${trabajador.id}/camino-b/preview`,
        payload,
      )
      setPreview(data)
      setStep('preview')
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al generar preview')
    } finally {
      setLoading(false)
    }
  }

  const emitir = async () => {
    if (!plantillaId) return
    setLoading(true)
    try {
      const payload = {
        plantilla_id: Number(plantillaId),
        ...form,
        sueldo_liquido: Number(form.sueldo_liquido),
        movilizacion: Number(form.movilizacion) || 0,
        colacion: Number(form.colacion) || 0,
        viaticos: Number(form.viaticos) || 0,
        jornada_semanal_horas: Number(form.jornada_semanal_horas),
        fecha_termino: form.fecha_termino || null,
      }
      await api.post(`/contratos/trabajador/${trabajador.id}/camino-b/emitir`, payload)
      toast.success('Contrato BORRADOR creado. Revísalo en "Anexos" y aprueba la emisión para notificar al trabajador.')
      onSaved()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al emitir')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <div>
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <Sparkles size={16} className="text-emerald-600" /> Generar contrato digital — {trabajador.nombre}
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Camino B: usa una plantilla, completa los datos, revisa el preview y emite el borrador.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded"><X size={16} /></button>
        </div>

        <div className="px-5 py-3 flex items-center gap-2 text-xs border-b">
          {['plantilla', 'datos', 'preview'].map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold ${
                step === s ? 'bg-emerald-600 text-white' : (['plantilla','datos','preview'].indexOf(step) > i ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500')
              }`}>{i + 1}</span>
              <span className={`${step === s ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>
                {s === 'plantilla' ? 'Plantilla' : s === 'datos' ? 'Datos' : 'Previsualizar'}
              </span>
              {i < 2 && <span className="text-gray-300">›</span>}
            </div>
          ))}
        </div>

        {step === 'plantilla' && (
          <div className="p-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Plantilla activa</label>
              <select className="input-field" value={plantillaId} onChange={e => setPlantillaId(e.target.value)}>
                <option value="">Seleccionar...</option>
                {plantillas.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} — v{p.version} {p.tipo_contrato ? `(${p.tipo_contrato})` : ''}
                  </option>
                ))}
              </select>
              {plantillas.length === 0 && (
                <p className="text-xs text-amber-700 mt-1 flex items-center gap-1">
                  <AlertTriangle size={12} /> No hay plantillas activas. Crea una en
                  <a href="/admin/plantillas-contrato" className="underline ml-1">Plantillas de Contrato</a>.
                </p>
              )}
            </div>

            {contratosBase.length > 0 && (
              <div className="border-t pt-4">
                <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                  <Copy size={14} /> O usa un contrato firmado de otro trabajador como base
                </label>
                <div className="flex gap-2">
                  <select className="input-field flex-1" value={contratoBaseId} onChange={e => setContratoBaseId(e.target.value)}>
                    <option value="">Seleccionar...</option>
                    {contratosBase.map(c => (
                      <option key={c.anexo_id} value={c.anexo_id}>
                        {c.trabajador_nombre} — {c.trabajador_cargo || 'Sin cargo'} ({c.tipo_contrato || 's/d'})
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={usarComoBase} disabled={!contratoBaseId} className="btn-secondary text-sm">
                    Usar como base
                  </button>
                </div>
                <p className="text-[11px] text-gray-500 mt-1">
                  Carga la plantilla con la que se generó ese contrato y precarga los datos del nuevo.
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
              <button type="button" onClick={() => plantillaId && setStep('datos')} disabled={!plantillaId} className="btn-primary">
                Siguiente
              </button>
            </div>
          </div>
        )}

        {step === 'datos' && (
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600 uppercase">Vigente desde *</label>
                <input type="date" className="input-field mt-1" value={form.vigente_desde} onChange={e => set('vigente_desde', e.target.value)} required />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 uppercase">Fecha término (plazo fijo)</label>
                <input type="date" className="input-field mt-1" value={form.fecha_termino} onChange={e => set('fecha_termino', e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 uppercase">Tipo contrato</label>
                <select className="input-field mt-1" value={form.tipo_contrato} onChange={e => set('tipo_contrato', e.target.value)}>
                  {['INDEFINIDO', 'PLAZO_FIJO', 'OBRA_FAENA', 'PART_TIME'].map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 uppercase">Cargo</label>
                <input className="input-field mt-1" value={form.cargo} onChange={e => set('cargo', e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 uppercase">Sueldo líquido pactado *</label>
                <input type="number" min="0" className="input-field mt-1" value={form.sueldo_liquido} onChange={e => set('sueldo_liquido', e.target.value)} required />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 uppercase">Jornada semanal (hrs)</label>
                <input type="number" min="1" max="48" className="input-field mt-1" value={form.jornada_semanal_horas} onChange={e => set('jornada_semanal_horas', e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 uppercase">Movilización</label>
                <input type="number" min="0" className="input-field mt-1" value={form.movilizacion} onChange={e => set('movilizacion', e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 uppercase">Colación</label>
                <input type="number" min="0" className="input-field mt-1" value={form.colacion} onChange={e => set('colacion', e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 uppercase">Viáticos</label>
                <input type="number" min="0" className="input-field mt-1" value={form.viaticos} onChange={e => set('viaticos', e.target.value)} />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 uppercase">Cláusulas adicionales (opcional)</label>
              <textarea className="input-field mt-1" rows={3} value={form.clausulas_adicionales} onChange={e => set('clausulas_adicionales', e.target.value)} placeholder="Texto que se agregará al final del contrato" />
            </div>
            <div className="flex justify-between gap-2 pt-2 border-t">
              <button type="button" onClick={() => setStep('plantilla')} className="btn-secondary">← Atrás</button>
              <button type="button" onClick={generarPreview} disabled={loading || !form.sueldo_liquido} className="btn-primary">
                {loading ? 'Generando...' : 'Previsualizar →'}
              </button>
            </div>
          </div>
        )}

        {step === 'preview' && preview && (
          <div className="p-5 space-y-3">
            {preview.faltantes?.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <div className="font-semibold flex items-center gap-1.5 mb-1">
                  <AlertTriangle size={16} /> Faltan datos en el perfil del trabajador o config legal:
                </div>
                <div className="flex flex-wrap gap-1">
                  {preview.faltantes.map(f => (
                    <code key={f} className="bg-amber-100 px-1.5 py-0.5 rounded text-amber-900">{f}</code>
                  ))}
                </div>
                <p className="text-xs text-amber-700 mt-2">
                  Puedes emitir igualmente, pero quedarán como <code>[[FALTA: ...]]</code> en el documento.
                </p>
              </div>
            )}
            <div className="bg-white border border-gray-200 rounded-lg p-4 max-h-[55vh] overflow-y-auto">
              <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800">{preview.rendered}</pre>
            </div>
            <div className="flex justify-between gap-2 pt-2 border-t">
              <button type="button" onClick={() => setStep('datos')} className="btn-secondary">← Atrás</button>
              <div className="flex gap-2">
                <button type="button" onClick={generarPreview} className="btn-secondary text-sm" disabled={loading}>
                  Regenerar
                </button>
                <button type="button" onClick={emitir} disabled={loading} className="btn-primary">
                  {loading ? 'Guardando...' : 'Emitir borrador'}
                </button>
              </div>
            </div>
            <p className="text-[11px] text-gray-500 text-center">
              El borrador queda guardado para revisión interna. En la pestaña <b>Anexos</b> podrás aprobar
              la emisión y notificar al trabajador para firma.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
