import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import api from '../../api'
import toast from 'react-hot-toast'
import {
  Calendar, Plus, FileText, CheckCircle, XCircle, Clock, History,
  AlertTriangle, Sparkles, PenLine, Send,
} from 'lucide-react'
import SignaturePad from '../../components/SignaturePad'

const fmtFecha = (s) => s ? new Date(s + 'T00:00:00').toLocaleDateString('es-CL') : '—'

const ESTADO_LABEL = {
  SOLICITADA: { label: 'Esperando aprobación', color: 'bg-amber-100 text-amber-800', icon: Clock },
  APROBADA: { label: 'Aprobada', color: 'bg-emerald-100 text-emerald-800', icon: CheckCircle },
  RECHAZADA: { label: 'Rechazada', color: 'bg-red-100 text-red-800', icon: XCircle },
  REGISTRO_HISTORICO: { label: 'Registro histórico', color: 'bg-blue-100 text-blue-800', icon: History },
}

export default function TrabajadorVacaciones() {
  const { vacId } = useParams()
  const [saldo, setSaldo] = useState(null)
  const [vacaciones, setVacaciones] = useState([])
  const [loading, setLoading] = useState(true)
  const [showSolicitar, setShowSolicitar] = useState(false)
  const [firmando, setFirmando] = useState(null)

  const cargar = async () => {
    setLoading(true)
    try {
      const [s, v] = await Promise.all([
        api.get('/portal/vacaciones/saldo'),
        api.get('/portal/vacaciones'),
      ])
      setSaldo(s.data)
      setVacaciones(v.data || [])
    } catch (err) {
      toast.error('Error al cargar tus vacaciones')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { cargar() }, [])

  // Si llega con :vacId y es histórica pendiente de firma, abrir el modal
  useEffect(() => {
    if (!vacId || vacaciones.length === 0) return
    const v = vacaciones.find(x => String(x.id) === String(vacId))
    if (v && v.estado === 'REGISTRO_HISTORICO' && !v.firma_retroactiva_presente) {
      setFirmando(v)
    }
  }, [vacId, vacaciones])

  const pendientesFirma = useMemo(
    () => vacaciones.filter(v => v.estado === 'REGISTRO_HISTORICO' && !v.firma_retroactiva_presente),
    [vacaciones]
  )

  const verPdf = async (v) => {
    try {
      const { data } = await api.get(`/vacaciones/${v.id}/pdf`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }))
      window.open(url, '_blank')
    } catch {
      toast.error('Error al abrir PDF')
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Calendar size={22} className="text-indigo-600" /> Mis Vacaciones
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Solicita y revisa tu feriado legal.</p>
        </div>
        <button
          onClick={() => setShowSolicitar(true)}
          disabled={!saldo || saldo.dias_disponibles <= 0}
          className="text-sm bg-indigo-600 text-white px-3 py-2 rounded-md hover:bg-indigo-700 flex items-center gap-2 disabled:opacity-50"
        >
          <Plus size={14} /> Solicitar vacaciones
        </button>
      </div>

      {/* Saldo */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Cargando...</div>
      ) : saldo ? (
        <SaldoCard saldo={saldo} />
      ) : null}

      {/* Pendientes de firma */}
      {pendientesFirma.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle size={18} className="text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-amber-900">
                Tienes {pendientesFirma.length} vacación(es) por confirmar con tu firma
              </p>
              <p className="text-sm text-amber-800 mt-1">
                RRHH cargó vacaciones que tomaste antes del sistema digital. Por favor revisa y firma tu conformidad.
              </p>
              <div className="mt-3 space-y-2">
                {pendientesFirma.map(v => (
                  <button
                    key={v.id}
                    onClick={() => setFirmando(v)}
                    className="w-full text-left bg-white border border-amber-300 rounded-lg p-3 hover:bg-amber-50 flex items-center justify-between gap-2"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {fmtFecha(v.fecha_inicio)} → {fmtFecha(v.fecha_fin)}
                      </p>
                      <p className="text-xs text-gray-600">{v.dias_habiles} días hábiles</p>
                    </div>
                    <span className="text-xs bg-amber-600 text-white px-3 py-1.5 rounded flex items-center gap-1">
                      <PenLine size={12} /> Firmar
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Listado completo */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">Historial</h2>
        {vacaciones.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-lg border border-dashed border-gray-200">
            <Calendar size={32} className="mx-auto text-gray-300 mb-2" />
            <p className="text-sm text-gray-500">Aún no tienes vacaciones registradas.</p>
          </div>
        ) : (
          vacaciones.map(v => {
            const cfg = ESTADO_LABEL[v.estado] || { label: v.estado, color: 'bg-gray-100 text-gray-700' }
            const Icon = cfg.icon
            return (
              <div key={v.id} className="bg-white border border-gray-200 rounded-lg p-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded flex items-center gap-1 ${cfg.color}`}>
                        {Icon && <Icon size={10} />} {cfg.label}
                      </span>
                      {v.es_retroactiva && !v.firma_retroactiva_presente && v.firma_retroactiva_solicitada && (
                        <span className="text-[11px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded">
                          Pendiente tu firma
                        </span>
                      )}
                      {v.firma_retroactiva_presente && (
                        <span className="text-[11px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded">
                          Firmada
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-gray-900 mt-1">
                      {fmtFecha(v.fecha_inicio)} → {fmtFecha(v.fecha_fin)} · {v.dias_habiles} días hábiles
                    </p>
                    {v.nota && <p className="text-xs text-gray-500 italic mt-0.5">"{v.nota}"</p>}
                    {v.motivo_rechazo && <p className="text-xs text-red-600 mt-0.5">Motivo: {v.motivo_rechazo}</p>}
                  </div>
                  <div className="flex gap-1">
                    {v.estado === 'REGISTRO_HISTORICO' && !v.firma_retroactiva_presente && (
                      <button onClick={() => setFirmando(v)} className="text-xs px-2.5 py-1.5 bg-amber-600 text-white rounded hover:bg-amber-700 flex items-center gap-1">
                        <PenLine size={12} /> Firmar
                      </button>
                    )}
                    {v.tiene_pdf && (
                      <button onClick={() => verPdf(v)} className="text-xs px-2.5 py-1.5 border border-gray-300 rounded hover:bg-gray-50 flex items-center gap-1">
                        <FileText size={12} /> PDF
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {showSolicitar && saldo && (
        <ModalSolicitar
          saldo={saldo}
          onClose={() => setShowSolicitar(false)}
          onSaved={() => { setShowSolicitar(false); cargar() }}
        />
      )}

      {firmando && (
        <ModalFirmaRetroactiva
          vacacion={firmando}
          onClose={() => setFirmando(null)}
          onSaved={() => { setFirmando(null); cargar() }}
        />
      )}
    </div>
  )
}


function SaldoCard({ saldo }) {
  const sinAccesoIngreso = !saldo.fecha_ingreso

  return (
    <div className="bg-gradient-to-br from-indigo-600 to-blue-600 text-white rounded-xl p-4 sm:p-5 shadow-lg">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs uppercase font-medium text-blue-100">Días disponibles</p>
          <p className="text-4xl font-bold mt-1">{saldo.dias_disponibles}</p>
          <p className="text-xs text-blue-100 mt-0.5">días hábiles de feriado legal</p>
        </div>
        <div className="text-right text-sm space-y-0.5">
          <div className="opacity-90">Devengados: <b>{saldo.dias_acumulados}</b></div>
          <div className="opacity-90">Tomados: <b>{saldo.dias_tomados}</b></div>
          {saldo.dias_solicitados_pendientes > 0 && (
            <div className="opacity-90">Por aprobar: <b>{saldo.dias_solicitados_pendientes}</b></div>
          )}
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-blue-400 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div>
          <div className="opacity-75">Días por año</div>
          <div className="font-semibold">{saldo.dias_por_anio} ({saldo.dias_base_anuales} base{saldo.dias_progresivo > 0 ? ` + ${saldo.dias_progresivo} progresivo` : ''})</div>
        </div>
        <div>
          <div className="opacity-75">Antigüedad</div>
          <div className="font-semibold">{saldo.anios_actuales} años, {saldo.meses_trabajados % 12} meses</div>
        </div>
        <div>
          <div className="opacity-75">Años totales (con previos)</div>
          <div className="font-semibold">{saldo.anios_totales}</div>
        </div>
        {saldo.proximo_dia_extra && (
          <div>
            <div className="opacity-75">Próximo día extra</div>
            <div className="font-semibold flex items-center gap-1">
              <Sparkles size={11} /> {new Date(saldo.proximo_dia_extra.fecha_aproximada + 'T00:00:00').toLocaleDateString('es-CL', { month: 'short', year: 'numeric' })}
            </div>
          </div>
        )}
      </div>

      {sinAccesoIngreso && (
        <p className="text-xs mt-3 bg-amber-500/30 rounded p-2">
          ⚠️ No tenemos registrada tu fecha de ingreso. Pide a RRHH que la actualice para calcular bien tu saldo.
        </p>
      )}
    </div>
  )
}


function ModalSolicitar({ saldo, onClose, onSaved }) {
  const [form, setForm] = useState({ fecha_inicio: '', fecha_fin: '', nota: '' })
  const [firma, setFirma] = useState(null)
  const [tieneFirmaPerfil, setTieneFirmaPerfil] = useState(null)
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    api.get('/remuneraciones/portal/perfil').then(r => setTieneFirmaPerfil(r.data?.tiene_firma)).catch(() => setTieneFirmaPerfil(false))
  }, [])

  const diasCalc = useMemo(() => {
    if (!form.fecha_inicio || !form.fecha_fin || form.fecha_fin < form.fecha_inicio) return 0
    const ini = new Date(form.fecha_inicio + 'T00:00:00')
    const fin = new Date(form.fecha_fin + 'T00:00:00')
    let n = 0
    const d = new Date(ini)
    while (d <= fin) {
      if (d.getDay() >= 1 && d.getDay() <= 5) n++
      d.setDate(d.getDate() + 1)
    }
    return n
  }, [form.fecha_inicio, form.fecha_fin])

  const minDate = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return d.toISOString().slice(0, 10)
  }, [])

  const guardar = async (e) => {
    e.preventDefault()
    if (!firma && !tieneFirmaPerfil) {
      toast.error('Por favor firma para enviar la solicitud')
      return
    }
    setSaving(true)
    try {
      await api.post('/portal/vacaciones/solicitar', {
        fecha_inicio: form.fecha_inicio,
        fecha_fin: form.fecha_fin,
        nota: form.nota || null,
        firma_base64: firma,
      })
      toast.success('Solicitud enviada. RRHH te notificará cuando la apruebe.')
      onSaved()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al solicitar')
    } finally {
      setSaving(false)
    }
  }

  const sinSaldo = diasCalc > saldo.dias_disponibles

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b sticky top-0 bg-white flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <Calendar size={16} className="text-indigo-600" /> Solicitar vacaciones
          </h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded"><XCircle size={18} /></button>
        </div>
        <form onSubmit={guardar} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 uppercase">Desde *</label>
              <input type="date" required min={minDate} className="input-field mt-1" value={form.fecha_inicio} onChange={e => set('fecha_inicio', e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 uppercase">Hasta *</label>
              <input type="date" required min={form.fecha_inicio || minDate} className="input-field mt-1" value={form.fecha_fin} onChange={e => set('fecha_fin', e.target.value)} />
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm">
            <p>Días hábiles a tomar: <b>{diasCalc}</b></p>
            <p>Tu saldo disponible: <b>{saldo.dias_disponibles}</b></p>
            {sinSaldo && (
              <p className="text-red-700 mt-1 flex items-center gap-1">
                <AlertTriangle size={12} /> Excedes tu saldo disponible
              </p>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 uppercase">Motivo / nota (opcional)</label>
            <textarea rows={2} className="input-field mt-1" value={form.nota} onChange={e => set('nota', e.target.value)} />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 uppercase">Firma {tieneFirmaPerfil ? '(usaremos la del perfil si no firmas aquí)' : '*'}</label>
            <SignaturePad onChange={setFirma} placeholder="Firma para confirmar" />
            {tieneFirmaPerfil && !firma && (
              <p className="text-xs text-emerald-700 mt-1">Tienes firma registrada en tu perfil. Si no firmas aquí, usaremos esa.</p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={saving || sinSaldo || diasCalc <= 0} className="btn-primary flex items-center gap-1">
              <Send size={14} /> {saving ? 'Enviando...' : 'Enviar solicitud'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}


function ModalFirmaRetroactiva({ vacacion, onClose, onSaved }) {
  const [firma, setFirma] = useState(null)
  const [tieneFirmaPerfil, setTieneFirmaPerfil] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.get('/remuneraciones/portal/perfil').then(r => setTieneFirmaPerfil(r.data?.tiene_firma)).catch(() => setTieneFirmaPerfil(false))
  }, [])

  const firmar = async () => {
    if (!firma && !tieneFirmaPerfil) {
      toast.error('Necesitas firmar para confirmar')
      return
    }
    setSaving(true)
    try {
      await api.post(`/portal/vacaciones/${vacacion.id}/firmar-retroactiva`, {
        firma_base64: firma,
      })
      toast.success('Vacación confirmada con tu firma')
      onSaved()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al firmar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <PenLine size={16} className="text-amber-600" /> Confirmar vacación pasada
          </h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded"><XCircle size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-700">
            RRHH cargó la siguiente vacación que tomaste con anterioridad. Por favor revisa los datos
            y firma tu conformidad.
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="font-semibold text-amber-900">
              {fmtFecha(vacacion.fecha_inicio)} → {fmtFecha(vacacion.fecha_fin)}
            </p>
            <p className="text-sm text-amber-800">{vacacion.dias_habiles} días hábiles</p>
            {vacacion.nota && <p className="text-xs text-amber-700 italic mt-1">"{vacacion.nota}"</p>}
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 uppercase">Tu firma</label>
            <SignaturePad onChange={setFirma} placeholder="Firma para confirmar" />
            {tieneFirmaPerfil && !firma && (
              <p className="text-xs text-emerald-700 mt-1">Si no firmas aquí, usaremos la del perfil.</p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button onClick={onClose} className="btn-secondary">Cancelar</button>
            <button onClick={firmar} disabled={saving} className="btn-primary flex items-center gap-1">
              <CheckCircle size={14} /> {saving ? 'Firmando...' : 'Confirmar y firmar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
