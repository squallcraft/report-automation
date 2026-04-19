import { useEffect, useMemo, useState } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import {
  Calendar, Plus, Search, Filter, FileText, CheckCircle, XCircle,
  Clock, History, Eye, AlertTriangle, PenLine, Send, Sparkles, RefreshCw,
} from 'lucide-react'
import SignaturePad from '../../components/SignaturePad'

const ESTADOS = [
  { id: 'SOLICITADA', label: 'Solicitadas', color: 'bg-amber-100 text-amber-800', icon: Clock },
  { id: 'APROBADA', label: 'Aprobadas', color: 'bg-emerald-100 text-emerald-800', icon: CheckCircle },
  { id: 'REGISTRO_HISTORICO', label: 'Históricas', color: 'bg-blue-100 text-blue-800', icon: History },
  { id: 'RECHAZADA', label: 'Rechazadas', color: 'bg-red-100 text-red-800', icon: XCircle },
]

const fmtFecha = (s) => s ? new Date(s + 'T00:00:00').toLocaleDateString('es-CL') : '—'
const fmtFechaCorta = (s) => s ? new Date(s + 'T00:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: 'short' }) : '—'

export default function Vacaciones() {
  const [tab, setTab] = useState('SOLICITADA')
  const [vacaciones, setVacaciones] = useState([])
  const [trabajadores, setTrabajadores] = useState([])
  const [loading, setLoading] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [showHistorico, setShowHistorico] = useState(false)
  const [detalle, setDetalle] = useState(null)
  const [aprobando, setAprobando] = useState(null)
  const [rechazando, setRechazando] = useState(null)

  const cargar = async () => {
    setLoading(true)
    try {
      const [vacRes, trabRes] = await Promise.all([
        api.get('/vacaciones', { params: { estado: tab } }),
        trabajadores.length === 0 ? api.get('/trabajadores') : Promise.resolve({ data: trabajadores }),
      ])
      setVacaciones(vacRes.data || [])
      if (trabajadores.length === 0) setTrabajadores(trabRes.data || [])
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al cargar vacaciones')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { cargar() }, [tab])

  const filtradas = useMemo(() => {
    if (!busqueda) return vacaciones
    const q = busqueda.toLowerCase()
    return vacaciones.filter(v =>
      (v.trabajador_nombre || '').toLowerCase().includes(q) ||
      v.fecha_inicio.includes(q) || v.fecha_fin.includes(q)
    )
  }, [vacaciones, busqueda])

  const conteos = useMemo(() => {
    const map = { SOLICITADA: 0, APROBADA: 0, REGISTRO_HISTORICO: 0, RECHAZADA: 0 }
    return map
  }, [])

  const verDetalle = (v) => setDetalle(v)
  const verPdf = async (v) => {
    try {
      const { data } = await api.get(`/vacaciones/${v.id}/pdf`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }))
      window.open(url, '_blank')
    } catch {
      toast.error('Error al abrir PDF')
    }
  }

  const solicitarFirma = async (v) => {
    try {
      await api.post(`/vacaciones/${v.id}/solicitar-firma`)
      toast.success('Notificación enviada al trabajador')
      cargar()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al solicitar firma')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Calendar size={22} className="text-indigo-600" /> Vacaciones
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Feriado legal (Art. 67 CT) y feriado progresivo (Art. 68 CT). Aprueba solicitudes,
            carga vacaciones tomadas en el pasado y solicita firmas a posteriori.
          </p>
        </div>
        <button
          onClick={() => setShowHistorico(true)}
          className="text-sm bg-indigo-600 text-white px-3 py-2 rounded-md hover:bg-indigo-700 flex items-center gap-2"
        >
          <History size={14} /> Cargar vacación histórica
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {ESTADOS.map(e => {
          const Icon = e.icon
          return (
            <button
              key={e.id}
              onClick={() => setTab(e.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 flex items-center gap-2 whitespace-nowrap ${
                tab === e.id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon size={14} /> {e.label}
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar trabajador o fecha..."
          className="w-full sm:max-w-sm pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm"
        />
      </div>

      {/* Lista */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Cargando...</div>
      ) : filtradas.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg border border-dashed border-gray-200">
          <Calendar size={32} className="mx-auto text-gray-300 mb-2" />
          <p className="text-sm text-gray-500">No hay vacaciones en este estado.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtradas.map(v => (
            <FilaVacacion
              key={v.id}
              v={v}
              onVer={() => verDetalle(v)}
              onPdf={() => verPdf(v)}
              onAprobar={() => setAprobando(v)}
              onRechazar={() => setRechazando(v)}
              onSolicitarFirma={() => solicitarFirma(v)}
            />
          ))}
        </div>
      )}

      {showHistorico && (
        <ModalHistorico
          trabajadores={trabajadores}
          onClose={() => setShowHistorico(false)}
          onSaved={() => { setShowHistorico(false); setTab('REGISTRO_HISTORICO'); cargar() }}
        />
      )}

      {detalle && (
        <ModalDetalle
          vacacion={detalle}
          onClose={() => setDetalle(null)}
          onChanged={() => { cargar() }}
        />
      )}

      {aprobando && (
        <ModalAprobar
          vacacion={aprobando}
          onClose={() => setAprobando(null)}
          onSaved={() => { setAprobando(null); cargar() }}
        />
      )}

      {rechazando && (
        <ModalRechazar
          vacacion={rechazando}
          onClose={() => setRechazando(null)}
          onSaved={() => { setRechazando(null); cargar() }}
        />
      )}
    </div>
  )
}


function FilaVacacion({ v, onVer, onPdf, onAprobar, onRechazar, onSolicitarFirma }) {
  const estadoCfg = ESTADOS.find(e => e.id === v.estado) || { color: 'bg-gray-100 text-gray-700', label: v.estado }

  const necesitaFirmaTrab = v.estado === 'REGISTRO_HISTORICO' && !v.firma_retroactiva_presente
  const firmaSolicitada = v.firma_retroactiva_solicitada

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 sm:p-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded ${estadoCfg.color}`}>
              {estadoCfg.label}
            </span>
            {v.es_retroactiva && (
              <span className="text-[11px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded flex items-center gap-1">
                <History size={10} /> Histórica
              </span>
            )}
            {v.firma_solicitud_presente && v.estado === 'SOLICITADA' && (
              <span className="text-[11px] bg-purple-50 text-purple-700 px-2 py-0.5 rounded flex items-center gap-1">
                <PenLine size={10} /> Firmada por trabajador
              </span>
            )}
            {firmaSolicitada && necesitaFirmaTrab && (
              <span className="text-[11px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded flex items-center gap-1">
                <Clock size={10} /> Firma pendiente del trabajador
              </span>
            )}
          </div>
          <p className="text-sm font-semibold text-gray-900 mt-1">
            {v.trabajador_nombre} <span className="text-gray-400 font-normal">·</span>{' '}
            <span className="text-gray-600 font-normal">
              {fmtFechaCorta(v.fecha_inicio)} → {fmtFechaCorta(v.fecha_fin)} · {v.dias_habiles} días hábiles
            </span>
          </p>
          {v.nota && <p className="text-xs text-gray-500 mt-1 italic line-clamp-2">"{v.nota}"</p>}
          {v.motivo_rechazo && (
            <p className="text-xs text-red-600 mt-1">Rechazo: {v.motivo_rechazo}</p>
          )}
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {v.estado === 'SOLICITADA' && (
            <>
              <button onClick={onAprobar} className="text-xs px-2.5 py-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 flex items-center gap-1">
                <CheckCircle size={12} /> Aprobar
              </button>
              <button onClick={onRechazar} className="text-xs px-2.5 py-1.5 border border-red-200 text-red-700 rounded hover:bg-red-50 flex items-center gap-1">
                <XCircle size={12} /> Rechazar
              </button>
            </>
          )}
          {necesitaFirmaTrab && !firmaSolicitada && (
            <button onClick={onSolicitarFirma} className="text-xs px-2.5 py-1.5 bg-amber-600 text-white rounded hover:bg-amber-700 flex items-center gap-1">
              <Send size={12} /> Solicitar firma
            </button>
          )}
          <button onClick={onVer} className="text-xs px-2.5 py-1.5 border border-gray-300 rounded hover:bg-gray-50 flex items-center gap-1">
            <Eye size={12} /> Ver
          </button>
          {v.tiene_pdf && (
            <button onClick={onPdf} className="text-xs px-2.5 py-1.5 border border-gray-300 rounded hover:bg-gray-50 flex items-center gap-1">
              <FileText size={12} /> PDF
            </button>
          )}
        </div>
      </div>
    </div>
  )
}


function ModalHistorico({ trabajadores, onClose, onSaved }) {
  const [form, setForm] = useState({
    trabajador_id: '',
    fecha_inicio: '',
    fecha_fin: '',
    dias_habiles: '',
    nota: '',
    solicitar_firma_trabajador: true,
  })
  const [saldo, setSaldo] = useState(null)
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!form.trabajador_id) { setSaldo(null); return }
    api.get(`/vacaciones/saldo/${form.trabajador_id}`).then(r => setSaldo(r.data)).catch(() => setSaldo(null))
  }, [form.trabajador_id])

  // Auto-cálculo días hábiles cuando fecha cambia
  useEffect(() => {
    if (form.fecha_inicio && form.fecha_fin && form.fecha_fin >= form.fecha_inicio) {
      const ini = new Date(form.fecha_inicio + 'T00:00:00')
      const fin = new Date(form.fecha_fin + 'T00:00:00')
      let n = 0
      const d = new Date(ini)
      while (d <= fin) {
        if (d.getDay() >= 1 && d.getDay() <= 5) n++
        d.setDate(d.getDate() + 1)
      }
      if (!form.dias_habiles || Number(form.dias_habiles) === 0) set('dias_habiles', n)
    }
  }, [form.fecha_inicio, form.fecha_fin])

  const guardar = async (e) => {
    e.preventDefault()
    if (!form.trabajador_id) { toast.error('Elige un trabajador'); return }
    setSaving(true)
    try {
      await api.post('/vacaciones/registro-historico', {
        ...form,
        trabajador_id: Number(form.trabajador_id),
        dias_habiles: form.dias_habiles ? Number(form.dias_habiles) : null,
      })
      toast.success('Vacación histórica registrada')
      onSaved()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b sticky top-0 bg-white flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <History size={16} className="text-blue-600" /> Cargar vacación histórica
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Vacaciones que el trabajador ya tomó antes de implementar el sistema digital.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded">
            <XCircle size={18} />
          </button>
        </div>

        <form onSubmit={guardar} className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-600 uppercase">Trabajador *</label>
            <select required className="input-field mt-1" value={form.trabajador_id} onChange={e => set('trabajador_id', e.target.value)}>
              <option value="">Seleccionar...</option>
              {trabajadores.map(t => (
                <option key={t.id} value={t.id}>{t.nombre} {t.rut ? `(${t.rut})` : ''}</option>
              ))}
            </select>
          </div>

          {saldo && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs">
              <p className="font-semibold text-blue-900 mb-1">Saldo actual del trabajador:</p>
              <div className="grid grid-cols-3 gap-2 text-blue-800">
                <div><b>{saldo.dias_acumulados}</b> días devengados</div>
                <div><b>{saldo.dias_tomados}</b> ya tomados</div>
                <div><b className={saldo.dias_disponibles < 0 ? 'text-red-700' : ''}>{saldo.dias_disponibles}</b> disponibles</div>
              </div>
              {saldo.dias_progresivo > 0 && (
                <p className="mt-1 text-blue-700">+ {saldo.dias_progresivo} días progresivos (Art. 68 CT)</p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 uppercase">Desde *</label>
              <input type="date" required className="input-field mt-1" value={form.fecha_inicio} onChange={e => set('fecha_inicio', e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 uppercase">Hasta *</label>
              <input type="date" required className="input-field mt-1" value={form.fecha_fin} onChange={e => set('fecha_fin', e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 uppercase">Días hábiles</label>
              <input type="number" min="1" className="input-field mt-1" value={form.dias_habiles} onChange={e => set('dias_habiles', e.target.value)} placeholder="Auto" />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 uppercase">Nota / observaciones</label>
            <textarea rows={2} className="input-field mt-1" value={form.nota} onChange={e => set('nota', e.target.value)} placeholder="Ej: comprobante en papel firmado el 12/03/2024" />
          </div>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.solicitar_firma_trabajador}
              onChange={e => set('solicitar_firma_trabajador', e.target.checked)}
            />
            <div>
              <p className="text-sm font-medium text-gray-900">Solicitar firma de conformidad al trabajador</p>
              <p className="text-xs text-gray-500">
                Le llegará una notificación in-app + WhatsApp para que firme la vacación cargada.
              </p>
            </div>
          </label>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={onClose} className="btn-secondary">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary flex items-center gap-1">
              {saving ? 'Guardando...' : (<><Plus size={14} /> Registrar</>)}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}


function ModalAprobar({ vacacion, onClose, onSaved }) {
  const [firma, setFirma] = useState(null)
  const [nota, setNota] = useState('')
  const [saving, setSaving] = useState(false)

  const aprobar = async () => {
    setSaving(true)
    try {
      await api.post(`/vacaciones/${vacacion.id}/aprobar`, {
        nota_aprobacion: nota || null,
        firma_aprobador_base64: firma,
      })
      toast.success('Vacación aprobada y trabajador notificado')
      onSaved()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al aprobar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <CheckCircle size={16} className="text-emerald-600" /> Aprobar vacaciones
          </h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded"><XCircle size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-gray-50 rounded-lg p-3 text-sm">
            <p className="font-medium text-gray-900">{vacacion.trabajador_nombre}</p>
            <p className="text-gray-600">
              {fmtFecha(vacacion.fecha_inicio)} → {fmtFecha(vacacion.fecha_fin)} · {vacacion.dias_habiles} días hábiles
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 uppercase">Tu firma (opcional)</label>
            <p className="text-[11px] text-gray-500 mb-2">
              Si firmas, queda en el comprobante. Si no, queda como aprobación digital con tu nombre.
            </p>
            <SignaturePad onChange={setFirma} height={140} placeholder="Firma de aprobación" />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 uppercase">Nota (opcional)</label>
            <textarea rows={2} className="input-field mt-1" value={nota} onChange={e => setNota(e.target.value)} />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button onClick={onClose} className="btn-secondary">Cancelar</button>
            <button onClick={aprobar} disabled={saving} className="btn-primary flex items-center gap-1">
              <CheckCircle size={14} /> {saving ? 'Aprobando...' : 'Aprobar y notificar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}


function ModalRechazar({ vacacion, onClose, onSaved }) {
  const [motivo, setMotivo] = useState('')
  const [saving, setSaving] = useState(false)

  const rechazar = async () => {
    if (!motivo.trim()) { toast.error('Debes indicar un motivo'); return }
    setSaving(true)
    try {
      await api.post(`/vacaciones/${vacacion.id}/rechazar`, { motivo })
      toast.success('Vacación rechazada y trabajador notificado')
      onSaved()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al rechazar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
            <XCircle size={16} className="text-red-600" /> Rechazar vacaciones
          </h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded"><XCircle size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-gray-50 rounded-lg p-3 text-sm">
            <p className="font-medium text-gray-900">{vacacion.trabajador_nombre}</p>
            <p className="text-gray-600">
              {fmtFecha(vacacion.fecha_inicio)} → {fmtFecha(vacacion.fecha_fin)} · {vacacion.dias_habiles} días hábiles
            </p>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 uppercase">Motivo del rechazo *</label>
            <textarea rows={3} required className="input-field mt-1" value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Se le explicará al trabajador" />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button onClick={onClose} className="btn-secondary">Cancelar</button>
            <button onClick={rechazar} disabled={saving || !motivo.trim()} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50">
              {saving ? 'Rechazando...' : 'Rechazar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}


function ModalDetalle({ vacacion, onClose, onChanged }) {
  const [pdfUrl, setPdfUrl] = useState(null)

  const cargarPdf = async () => {
    try {
      const { data } = await api.get(`/vacaciones/${vacacion.id}/pdf`, { responseType: 'blob' })
      setPdfUrl(URL.createObjectURL(new Blob([data], { type: 'application/pdf' })))
    } catch {/* ignore */}
  }

  useEffect(() => {
    if (vacacion?.tiene_pdf) cargarPdf()
    return () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl) }
  }, [vacacion?.id])

  const regenerarPdf = async () => {
    try {
      await api.post(`/vacaciones/${vacacion.id}/regenerar-pdf`)
      toast.success('PDF regenerado')
      cargarPdf()
      onChanged()
    } catch {
      toast.error('Error al regenerar')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-stretch justify-end">
      <div className="bg-white w-full max-w-3xl h-full overflow-y-auto shadow-2xl">
        <div className="px-5 py-4 border-b sticky top-0 bg-white flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-gray-900">Detalle vacación</h3>
            <p className="text-xs text-gray-500">{vacacion.trabajador_nombre}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded"><XCircle size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <div><div className="text-xs text-gray-500 uppercase">Estado</div><div className="font-medium">{vacacion.estado}</div></div>
            <div><div className="text-xs text-gray-500 uppercase">Días hábiles</div><div className="font-medium">{vacacion.dias_habiles}</div></div>
            <div><div className="text-xs text-gray-500 uppercase">Días corridos</div><div className="font-medium">{vacacion.dias_corridos || '—'}</div></div>
            <div><div className="text-xs text-gray-500 uppercase">Desde</div><div className="font-medium">{fmtFecha(vacacion.fecha_inicio)}</div></div>
            <div><div className="text-xs text-gray-500 uppercase">Hasta</div><div className="font-medium">{fmtFecha(vacacion.fecha_fin)}</div></div>
            <div><div className="text-xs text-gray-500 uppercase">Histórica</div><div className="font-medium">{vacacion.es_retroactiva ? 'Sí' : 'No'}</div></div>
          </div>

          {(vacacion.dias_derecho_snapshot != null) && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs">
              <p className="font-semibold text-blue-900 mb-1">Snapshot al momento del registro:</p>
              <div className="grid grid-cols-2 gap-1 text-blue-800">
                <div>Días devengados: <b>{vacacion.dias_derecho_snapshot}</b></div>
                <div>Saldo previo: <b>{vacacion.saldo_previo_snapshot}</b></div>
                <div>Días progresivo: <b>{vacacion.dias_progresivo_snapshot ?? 0}</b></div>
              </div>
            </div>
          )}

          <div className="space-y-2 text-sm">
            <FilaInfo label="Solicitada" value={vacacion.solicitada_at ? new Date(vacacion.solicitada_at).toLocaleString('es-CL') : '—'} sub={vacacion.firma_solicitud_presente ? 'Firmada por el trabajador' : null} />
            <FilaInfo label="Aprobada" value={vacacion.aprobada_at ? `${new Date(vacacion.aprobada_at).toLocaleString('es-CL')} por ${vacacion.aprobada_por}` : '—'} sub={vacacion.firma_aprobacion_presente ? 'Firma del aprobador presente' : null} />
            <FilaInfo label="Rechazada" value={vacacion.rechazada_at ? `${new Date(vacacion.rechazada_at).toLocaleString('es-CL')} por ${vacacion.rechazada_por}` : '—'} sub={vacacion.motivo_rechazo} />
            <FilaInfo label="Firma retroactiva" value={vacacion.firma_retroactiva_at ? new Date(vacacion.firma_retroactiva_at).toLocaleString('es-CL') : (vacacion.firma_retroactiva_solicitada ? 'Solicitada, esperando firma' : '—')} sub={vacacion.firma_retroactiva_presente ? 'Firmada por trabajador' : null} />
          </div>

          {vacacion.nota && (
            <div className="bg-gray-50 rounded p-3 text-sm">
              <div className="text-xs text-gray-500 uppercase mb-1">Nota</div>
              <p className="text-gray-800 whitespace-pre-wrap">{vacacion.nota}</p>
            </div>
          )}

          {pdfUrl && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-700 uppercase">Comprobante</p>
                <button onClick={regenerarPdf} className="text-xs text-indigo-600 hover:underline flex items-center gap-1">
                  <RefreshCw size={12} /> Regenerar
                </button>
              </div>
              <iframe src={pdfUrl} title="Comprobante" className="w-full border border-gray-200 rounded" style={{ height: '60vh' }} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function FilaInfo({ label, value, sub }) {
  return (
    <div className="flex items-start justify-between border-b pb-2">
      <div className="text-xs text-gray-500 uppercase">{label}</div>
      <div className="text-right">
        <div className="text-gray-900">{value}</div>
        {sub && <div className="text-xs text-gray-500">{sub}</div>}
      </div>
    </div>
  )
}
