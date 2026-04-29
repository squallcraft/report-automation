import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../../api'
import {
  Building2, FileText, CreditCard, ArrowLeft, ChevronDown, ChevronUp,
  Plus, CheckCircle, Clock, AlertCircle, X, Loader2, Eye, Download,
  Calendar, Percent, Play
} from 'lucide-react'

const fmt = (n) => '$' + (n || 0).toLocaleString('es-CL')

// Carga planes una sola vez y los expone como hook liviano
let _planesCache = null
async function fetchPlanesMap() {
  if (_planesCache) return _planesCache
  try {
    const { data } = await api.get('/inquilinos/config/planes')
    _planesCache = Object.fromEntries(data.map(c => [c.plan, c]))
    return _planesCache
  } catch { return {} }
}

function labelDePlan(config) {
  if (!config) return '—'
  const p = config.params || {}
  const tipo = p.tipo_calculo
  const fmtN = n => n != null ? `$${Number(n).toLocaleString('es-CL')}` : '?'
  const variable = p.variable || 'unidades'
  if (tipo === 'UMBRAL_FIJO')
    return `${config.plan} — Base ${Number(p.max_incluidos).toLocaleString('es-CL')} ${variable} (${fmtN(p.base)} + IVA)`
  if (tipo === 'BLOQUES')
    return `${config.plan} — Base ${Number(p.max_incluidos).toLocaleString('es-CL')} ${variable} (${fmtN(p.base)} + IVA)`
  if (tipo === 'BASE_UF')
    return `${config.plan} — ${p.base_uf} UF base + ${fmtN(p.extra_por)}/${variable} + IVA`
  if (tipo === 'PLANA')
    return `${config.plan} — ${fmtN(p.base)} plana + IVA`
  return config.plan
}

// ── Modal Generar Cobro ──────────────────────────────────────────────────────
function GenerarCobroModal({ inquilino, planesMap, onClose, onCreated }) {
  const [variableValor, setVariableValor] = useState('')
  const [preview, setPreview] = useState(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const planConfig = planesMap[inquilino.plan]
  const label = planConfig?.params?.variable
    ? `Número de ${planConfig.params.variable}`
    : 'Variable'

  const handlePreview = async () => {
    if (!variableValor) return
    setLoadingPreview(true)
    try {
      const { data } = await api.post(`/inquilinos/admin/${inquilino.id}/preview-cobro`, { variable_valor: parseInt(variableValor) })
      setPreview(data)
    } catch (err) {
      setError(err.response?.data?.detail || 'Error calculando')
    } finally {
      setLoadingPreview(false)
    }
  }

  const handleGenerar = async () => {
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.post(`/inquilinos/admin/${inquilino.id}/generar-cobro`, { variable_valor: parseInt(variableValor) })
      onCreated(data)
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail || 'Error generando cobro')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h3 className="font-semibold text-gray-900">Generar cobro mensual</h3>
            <p className="text-sm text-gray-500">{inquilino.razon_social || inquilino.email}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{label} *</label>
            <div className="flex gap-2">
              <input
                value={variableValor}
                onChange={e => { setVariableValor(e.target.value); setPreview(null) }}
                type="number" min="0"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={inquilino.plan === 'TARIFA_B' ? 'Ej: 18000' : 'Ej: 30'} />
              <button onClick={handlePreview} disabled={!variableValor || loadingPreview}
                className="px-4 py-2 text-sm font-medium text-blue-900 border border-blue-200 rounded-lg hover:bg-blue-50 disabled:opacity-50 flex items-center gap-2">
                {loadingPreview ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                Calcular
              </button>
            </div>
          </div>

          {preview && (
            <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
              <h4 className="font-semibold text-gray-900 mb-3">Desglose del cobro</h4>
              <div className="flex justify-between">
                <span className="text-gray-500">Monto neto base</span>
                <span className="font-medium">{fmt(preview.monto_neto_base)}</span>
              </div>
              {preview.descuento_aplicado > 0 && (
                <div className="flex justify-between text-green-700">
                  <span>Descuento aplicado</span>
                  <span className="font-medium">-{fmt(preview.descuento_aplicado)}</span>
                </div>
              )}
              {preview.reserva_a_descontar > 0 && (
                <div className="flex justify-between text-green-700">
                  <span>Reserva descontada</span>
                  <span className="font-medium">-{fmt(preview.reserva_a_descontar)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-gray-200 pt-2">
                <span className="text-gray-500">Neto a facturar</span>
                <span className="font-medium">{fmt(preview.neto_final)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">IVA (19%)</span>
                <span className="font-medium">{fmt(preview.iva)}</span>
              </div>
              <div className="flex justify-between text-base font-bold text-blue-900 border-t border-gray-200 pt-2">
                <span>TOTAL</span>
                <span>{fmt(preview.total)}</span>
              </div>
            </div>
          )}

          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancelar</button>
            <button onClick={handleGenerar} disabled={!preview || loading}
              className="flex-1 py-2.5 text-sm font-semibold text-white bg-blue-900 rounded-lg hover:bg-blue-800 disabled:opacity-60 flex items-center justify-center gap-2">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Generar y notificar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Modal Emitir Contrato ─────────────────────────────────────────────────────
function EmitirContratoModal({ inquilino, onClose, onCreated }) {
  const [plantillaId, setPlantillaId] = useState('')
  const [plantillas, setPlantillas] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get('/plantillas-contrato').then(r => setPlantillas(r.data || [])).catch(() => {})
  }, [])

  const handleEmitir = async () => {
    if (!plantillaId) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.post(`/inquilinos/admin/${inquilino.id}/contratos/emitir`, { plantilla_id: parseInt(plantillaId) })
      onCreated(data)
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail || 'Error emitiendo contrato')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b">
          <h3 className="font-semibold text-gray-900">Emitir contrato</h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Plantilla *</label>
            <select value={plantillaId} onChange={e => setPlantillaId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Seleccionar plantilla...</option>
              {plantillas.map(p => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
          </div>
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancelar</button>
            <button onClick={handleEmitir} disabled={!plantillaId || loading}
              className="flex-1 py-2.5 text-sm font-semibold text-white bg-blue-900 rounded-lg hover:bg-blue-800 disabled:opacity-60 flex items-center justify-center gap-2">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Emitir contrato
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Modal Registrar Despliegue ────────────────────────────────────────────────
function DespliegueModal({ inquilino, onClose, onSaved }) {
  const [form, setForm] = useState({ fecha_inicio_despliegue: '', mes_gratis_confirmado: false })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.post(`/inquilinos/admin/${inquilino.id}/registrar-despliegue`, {
        fecha_inicio_despliegue: form.fecha_inicio_despliegue,
        mes_gratis_confirmado: form.mes_gratis_confirmado,
      })
      onSaved(data)
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail || 'Error guardando despliegue')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h3 className="font-semibold text-gray-900">Registrar inicio de despliegue</h3>
            <p className="text-sm text-gray-500">Se notificará al inquilino automáticamente</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fecha inicio del servicio *</label>
            <input type="date" value={form.fecha_inicio_despliegue} required
              onChange={e => setForm(p => ({...p, fecha_inicio_despliegue: e.target.value}))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex items-center gap-3">
            <input id="mes_gratis_confirmado" type="checkbox" checked={form.mes_gratis_confirmado}
              onChange={e => setForm(p => ({...p, mes_gratis_confirmado: e.target.checked}))}
              className="w-4 h-4 text-blue-900 rounded" />
            <label htmlFor="mes_gratis_confirmado" className="text-sm text-gray-700">
              Confirmar mes gratis (la facturación iniciará un mes después)
            </label>
          </div>
          <div className="p-3 bg-blue-50 rounded-lg text-xs text-blue-800">
            <strong>Nota:</strong> Al guardar se enviará una notificación al inquilino por email y WhatsApp con la información del servicio activado.
          </div>
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={loading}
              className="flex-1 py-2.5 text-sm font-semibold text-white bg-blue-900 rounded-lg hover:bg-blue-800 disabled:opacity-60 flex items-center justify-center gap-2">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Confirmar despliegue
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Modal Agregar Descuento ───────────────────────────────────────────────────
function DescuentoModal({ inquilino, onClose, onCreated }) {
  const [form, setForm] = useState({ monto: '', motivo: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.post(`/inquilinos/admin/${inquilino.id}/descuento`, { monto: parseInt(form.monto), motivo: form.motivo })
      onCreated(data)
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail || 'Error guardando descuento')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b">
          <h3 className="font-semibold text-gray-900">Agregar descuento</h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Monto (neto) *</label>
            <input type="number" min="1" required value={form.monto} onChange={e => setForm(p => ({...p, monto: e.target.value}))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="50000" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Motivo *</label>
            <input type="text" required value={form.motivo} onChange={e => setForm(p => ({...p, motivo: e.target.value}))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Cortesía primer mes, corrección de cobro, etc." />
          </div>
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={loading}
              className="flex-1 py-2.5 text-sm font-semibold text-white bg-green-700 rounded-lg hover:bg-green-600 disabled:opacity-60 flex items-center justify-center gap-2">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Agregar descuento
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function InquilinoDetalle() {
  const { inquilinoId } = useParams()
  const navigate = useNavigate()
  const [inq, setInq] = useState(null)
  const [cobros, setCobros] = useState([])
  const [contratos, setContratos] = useState([])
  const [descuentos, setDescuentos] = useState([])
  const [planesMap, setPlanesMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [tab, setTab] = useState('contratos')

  const fetchAll = () => {
    Promise.all([
      api.get(`/inquilinos/admin/${inquilinoId}`),
      api.get(`/inquilinos/admin/${inquilinoId}/cobros`),
      api.get(`/inquilinos/admin/${inquilinoId}/contratos`),
      api.get(`/inquilinos/admin/${inquilinoId}/descuentos`),
      fetchPlanesMap(),
    ]).then(([i, c, ct, d, pm]) => {
      setInq(i.data)
      setCobros(c.data)
      setContratos(ct.data)
      setDescuentos(d.data)
      setPlanesMap(pm)
    }).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => { fetchAll() }, [inquilinoId])

  const handleAprobarPago = async (cobro) => {
    try {
      await api.post(`/inquilinos/admin/${inquilinoId}/cobros/${cobro.id}/aprobar-pago`)
      fetchAll()
    } catch (err) {
      alert(err.response?.data?.detail || 'Error aprobando pago')
    }
  }

  const handleAprobarReserva = async (anexoId) => {
    try {
      await api.post(`/inquilinos/admin/${inquilinoId}/contratos/${anexoId}/aprobar-reserva`)
      fetchAll()
    } catch (err) {
      alert(err.response?.data?.detail || 'Error aprobando reserva')
    }
  }

  const handleDownload = async (id, titulo) => {
    try {
      const { data } = await api.get(`/inquilinos/admin/${inquilinoId}/contratos/${id}/pdf`)
      const link = document.createElement('a')
      link.href = `data:application/pdf;base64,${data.pdf_base64}`
      link.download = `${titulo || 'contrato'}.pdf`
      link.click()
    } catch {}
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-2 border-blue-900 border-t-transparent rounded-full" />
    </div>
  )

  if (!inq) return <div className="text-gray-500">Inquilino no encontrado</div>

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/admin/inquilinos')}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {inq.razon_social || inq.nombre_fantasia || inq.email}
            </h1>
            <p className="text-gray-500 text-sm mt-0.5">{inq.email} · {labelDePlan(planesMap[inq.plan]) || inq.plan}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!inq.fecha_inicio_despliegue && inq.contrato_firmado && (
            <button onClick={() => setModal('despliegue')}
              className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-white bg-green-700 rounded-lg hover:bg-green-600 transition-colors">
              <Play className="w-4 h-4" />
              Registrar despliegue
            </button>
          )}
          <button onClick={() => setModal('cobro')}
            className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-white bg-blue-900 rounded-lg hover:bg-blue-800 transition-colors">
            <Plus className="w-4 h-4" />
            Generar cobro
          </button>
        </div>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Perfil</p>
          <p className={`text-sm font-semibold ${inq.perfil_completado ? 'text-green-700' : 'text-amber-600'}`}>
            {inq.perfil_completado ? '✓ Completo' : 'Pendiente'}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Contrato</p>
          <p className={`text-sm font-semibold ${inq.contrato_firmado ? 'text-green-700' : 'text-amber-600'}`}>
            {inq.contrato_firmado ? '✓ Firmado' : 'Sin firmar'}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Inicio servicio</p>
          <p className="text-sm font-semibold text-gray-900">
            {inq.fecha_inicio_despliegue ? new Date(inq.fecha_inicio_despliegue).toLocaleDateString('es-CL') : '—'}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-1">Inicio facturación</p>
          <p className="text-sm font-semibold text-gray-900">
            {inq.fecha_inicio_facturacion ? new Date(inq.fecha_inicio_facturacion).toLocaleDateString('es-CL') : '—'}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 gap-1">
        {[
          { id: 'contratos', label: `Contratos (${contratos.length})`, icon: FileText },
          { id: 'cobros', label: `Cobros (${cobros.length})`, icon: CreditCard },
          { id: 'descuentos', label: `Descuentos (${descuentos.filter(d => !d.aplicado).length})`, icon: Percent },
          { id: 'perfil', label: 'Perfil', icon: Building2 },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id ? 'border-blue-900 text-blue-900' : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}>
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab: Contratos */}
      {tab === 'contratos' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setModal('contrato')}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-blue-900 border border-blue-200 rounded-lg hover:bg-blue-50">
              <Plus className="w-4 h-4" />
              Emitir contrato
            </button>
          </div>
          {contratos.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
              <FileText className="w-10 h-10 mx-auto mb-2 text-gray-300" />
              No hay contratos emitidos
            </div>
          ) : (
            <div className="space-y-3">
              {contratos.map(c => (
                <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium text-gray-900">{c.titulo}</p>
                    <p className="text-xs text-gray-500">
                      {c.tipo === 'RESERVA' ? 'Anexo Reserva' : 'Contrato Principal'}
                      {' · '}{c.estado}
                      {c.firmado_at && ` · Firmado ${new Date(c.firmado_at).toLocaleDateString('es-CL')}`}
                    </p>
                    {c.tipo === 'RESERVA' && c.comprobante_reserva_path && !c.comprobante_reserva_aprobado && (
                      <div className="mt-1">
                        <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                          Comprobante en revisión
                        </span>
                        <button onClick={() => handleAprobarReserva(c.id)}
                          className="ml-2 text-xs font-medium text-green-700 hover:underline">
                          Aprobar
                        </button>
                      </div>
                    )}
                  </div>
                  <button onClick={() => handleDownload(c.id, c.titulo)}
                    className="p-2 hover:bg-gray-100 rounded-lg flex-shrink-0">
                    <Download className="w-4 h-4 text-gray-500" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Cobros */}
      {tab === 'cobros' && (
        <div className="space-y-3">
          {cobros.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
              <CreditCard className="w-10 h-10 mx-auto mb-2 text-gray-300" />
              No hay cobros aún
            </div>
          ) : cobros.map(c => {
            const meses = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
            const venc = c.fecha_vencimiento ? new Date(c.fecha_vencimiento).toLocaleDateString('es-CL') : '—'
            const COLORES = { PENDIENTE: 'text-amber-600', VENCIDO: 'text-red-600', PAGADO: 'text-green-700' }
            return (
              <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium text-gray-900">{meses[c.mes]} {c.anio}</p>
                  <p className="text-xs text-gray-500">{c.variable_nombre}: {c.variable_valor?.toLocaleString()} · Vence: {venc}</p>
                  {c.folio_haulmer && <p className="text-xs text-gray-400">Folio: {c.folio_haulmer}</p>}
                </div>
                <div className="text-right">
                  <p className="font-bold text-gray-900">{fmt(c.total)}</p>
                  <p className={`text-xs font-medium ${COLORES[c.estado] || 'text-gray-500'}`}>{c.estado}</p>
                  {(c.estado === 'PENDIENTE' || c.estado === 'VENCIDO') && c.comprobante_pago_path && (
                    <button onClick={() => handleAprobarPago(c)}
                      className="mt-2 text-xs font-semibold text-green-700 bg-green-50 px-2.5 py-1 rounded-lg hover:bg-green-100 transition-colors">
                      Aprobar pago
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Tab: Descuentos */}
      {tab === 'descuentos' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setModal('descuento')}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-green-700 border border-green-200 rounded-lg hover:bg-green-50">
              <Plus className="w-4 h-4" />
              Agregar descuento
            </button>
          </div>
          {descuentos.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
              <Percent className="w-10 h-10 mx-auto mb-2 text-gray-300" />
              No hay descuentos registrados
            </div>
          ) : (
            <div className="space-y-2">
              {descuentos.map(d => (
                <div key={d.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{fmt(d.monto)}</p>
                    <p className="text-xs text-gray-500">{d.motivo}</p>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${d.aplicado ? 'bg-gray-100 text-gray-500' : 'bg-green-100 text-green-700'}`}>
                    {d.aplicado ? 'Aplicado' : 'Pendiente'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Perfil */}
      {tab === 'perfil' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm">
            {[
              ['Razón Social', inq.razon_social],
              ['Nombre Fantasía', inq.nombre_fantasia],
              ['RUT Empresa', inq.rut_empresa],
              ['Dirección', inq.direccion_empresa],
              ['Correo empresa', inq.correo_empresa],
              ['Giro', inq.giro_empresa],
              ['Rep. Legal', inq.nombre_rep_legal],
              ['RUT Rep. Legal', inq.rut_rep_legal],
              ['Correo Rep. Legal', inq.correo_rep_legal],
              ['Dirección Rep. Legal', inq.direccion_rep_legal],
              ['WhatsApp', inq.whatsapp],
              ['Correo contacto', inq.correo_contacto],
              ['Reserva', inq.tiene_reserva ? `Sí — ${fmt(inq.monto_reserva)}` : 'No'],
              ['Mes gratis', inq.mes_gratis ? 'Sí' : 'No'],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-gray-400 text-xs">{label}</p>
                <p className="font-medium text-gray-900">{value || '—'}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modales */}
      {modal === 'cobro' && (
        <GenerarCobroModal inquilino={inq} planesMap={planesMap} onClose={() => setModal(null)}
          onCreated={() => { fetchAll(); setModal(null) }} />
      )}
      {modal === 'contrato' && (
        <EmitirContratoModal inquilino={inq} onClose={() => setModal(null)}
          onCreated={() => { fetchAll(); setModal(null) }} />
      )}
      {modal === 'despliegue' && (
        <DespliegueModal inquilino={inq} onClose={() => setModal(null)}
          onSaved={(updated) => { setInq(updated); setModal(null) }} />
      )}
      {modal === 'descuento' && (
        <DescuentoModal inquilino={inq} onClose={() => setModal(null)}
          onCreated={() => { fetchAll(); setModal(null) }} />
      )}
    </div>
  )
}
