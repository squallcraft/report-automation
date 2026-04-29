import { useState, useEffect } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import { ShieldCheck, ChevronDown, ChevronRight, Upload } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import Modal from '../../components/Modal'

const TIPO_LABEL = {
  AFP: 'AFP',
  SALUD: 'Salud (FONASA/Isapre)',
  CARNET_FRONTAL: 'Cédula (frontal)',
  CARNET_TRASERO: 'Cédula (trasera)',
  DOMICILIO: 'Comprobante domicilio',
  ANTECEDENTES: 'Certificado antecedentes',
  LICENCIA_CONDUCIR: 'Licencia de conducir',
}

const ESTADO_BADGE = {
  APROBADO: 'bg-green-100 text-green-700 border border-green-200',
  RECHAZADO: 'bg-red-100 text-red-700 border border-red-200',
  CARGADO: 'bg-yellow-100 text-yellow-700 border border-yellow-200',
  PENDIENTE: 'bg-gray-100 text-gray-500 border border-gray-200',
}

function PorcentajeBadge({ pct }) {
  const color =
    pct === 100
      ? 'bg-green-100 text-green-700'
      : pct >= 50
      ? 'bg-yellow-100 text-yellow-700'
      : 'bg-red-100 text-red-700'
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${color}`}>
      {pct}%
    </span>
  )
}

export default function Certificados() {
  const [trabajadores, setTrabajadores] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandido, setExpandido] = useState(null)
  const [certs, setCerts] = useState({})
  const [completitud, setCompletitud] = useState({})
  const [certsLoading, setCertsLoading] = useState(null)
  const [revisarModal, setRevisarModal] = useState(null)
  const [subirModal, setSubirModal] = useState(null)

  useEffect(() => {
    setLoading(true)
    api.get('/trabajadores', { params: { activo: true } })
      .then(r => setTrabajadores(r.data || []))
      .catch(() => toast.error('No se pudieron cargar los trabajadores'))
      .finally(() => setLoading(false))
  }, [])

  const cargarCerts = async (id) => {
    setCertsLoading(id)
    try {
      const [certsRes, compRes] = await Promise.all([
        api.get(`/certificados/trabajador/${id}`),
        api.get(`/certificados/trabajador/${id}/completitud`),
      ])
      setCerts(prev => ({ ...prev, [id]: certsRes.data || [] }))
      setCompletitud(prev => ({ ...prev, [id]: compRes.data }))
    } catch {
      toast.error('No se pudieron cargar los certificados')
    } finally {
      setCertsLoading(null)
    }
  }

  const toggleRow = async (t) => {
    if (expandido === t.id) { setExpandido(null); return }
    setExpandido(t.id)
    if (!certs[t.id]) await cargarCerts(t.id)
  }

  const recargar = async (id) => {
    setCerts(prev => { const n = { ...prev }; delete n[id]; return n })
    await cargarCerts(id)
  }

  const stats = [
    { label: 'Trabajadores', value: trabajadores.length },
    {
      label: 'Completos',
      value: Object.values(completitud).filter(c => c.porcentaje === 100).length,
    },
    {
      label: 'Pendientes revisión',
      value: Object.values(certs).flat().filter(c => c.estado === 'CARGADO').length,
    },
  ]

  return (
    <div>
      <PageHeader
        title="Certificados"
        subtitle="Documentos y certificados requeridos por trabajador"
        icon={ShieldCheck}
        accent="purple"
        stats={stats}
      />

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Cargando…</div>
        ) : trabajadores.length === 0 ? (
          <div className="p-8 text-center text-gray-400">No hay trabajadores activos.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3">Trabajador</th>
                <th className="text-left px-4 py-3">Completitud</th>
                <th className="text-right px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {trabajadores.map(t => (
                <>
                  <tr
                    key={t.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => toggleRow(t)}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{t.nombre}</div>
                      {t.rut && <div className="text-xs text-gray-400">{t.rut}</div>}
                    </td>
                    <td className="px-4 py-3">
                      {completitud[t.id] ? (
                        <div className="flex items-center gap-2">
                          <PorcentajeBadge pct={completitud[t.id].porcentaje} />
                          <span className="text-xs text-gray-400">
                            {completitud[t.id].aprobados}/{completitud[t.id].total}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            setSubirModal({ trabajador_id: t.id, nombre: t.nombre })
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg transition"
                        >
                          <Upload size={13} />
                          Subir
                        </button>
                        {expandido === t.id
                          ? <ChevronDown size={16} className="text-gray-400" />
                          : <ChevronRight size={16} className="text-gray-400" />
                        }
                      </div>
                    </td>
                  </tr>

                  {expandido === t.id && (
                    <tr key={`${t.id}-detail`}>
                      <td colSpan={3} className="p-0 bg-gray-50">
                        {certsLoading === t.id ? (
                          <div className="px-8 py-4 text-sm text-gray-400">Cargando…</div>
                        ) : (
                          <CertificadosTabla
                            certs={certs[t.id] || []}
                            onRevisar={cert => setRevisarModal({ ...cert, _trabajador_id: t.id })}
                          />
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {revisarModal && (
        <RevisarModal
          cert={revisarModal}
          onClose={() => setRevisarModal(null)}
          onSuccess={() => {
            const tid = revisarModal._trabajador_id
            recargar(tid)
            setRevisarModal(null)
          }}
        />
      )}

      {subirModal && (
        <SubirModal
          trabajadorId={subirModal.trabajador_id}
          nombre={subirModal.nombre}
          onClose={() => setSubirModal(null)}
          onSuccess={() => {
            recargar(subirModal.trabajador_id)
            setSubirModal(null)
          }}
        />
      )}
    </div>
  )
}

function CertificadosTabla({ certs, onRevisar }) {
  if (!certs.length) {
    return (
      <div className="px-8 py-4 text-sm text-gray-400 italic">
        Sin certificados cargados aún.
      </div>
    )
  }

  return (
    <table className="w-full text-xs border-t border-gray-200">
      <thead>
        <tr className="text-gray-400 uppercase tracking-wider">
          <th className="text-left px-8 py-2">Tipo</th>
          <th className="text-left px-4 py-2">Estado</th>
          <th className="text-left px-4 py-2">Emisión</th>
          <th className="text-left px-4 py-2">Vencimiento</th>
          <th className="text-left px-4 py-2">Revisado por</th>
          <th className="text-right px-6 py-2">Acciones</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {certs.map(c => (
          <tr key={c.id} className="hover:bg-white">
            <td className="px-8 py-2 font-medium text-gray-700">
              {TIPO_LABEL[c.tipo] || c.tipo}
            </td>
            <td className="px-4 py-2">
              <span className={`px-2 py-0.5 rounded text-xs ${ESTADO_BADGE[c.estado] || ESTADO_BADGE.PENDIENTE}`}>
                {c.estado}
              </span>
            </td>
            <td className="px-4 py-2 text-gray-500">{c.fecha_emision || '—'}</td>
            <td className="px-4 py-2 text-gray-500">{c.fecha_vencimiento || '—'}</td>
            <td className="px-4 py-2 text-gray-400">{c.revisado_por || '—'}</td>
            <td className="px-6 py-2 text-right">
              {c.estado === 'CARGADO' && (
                <button
                  onClick={() => onRevisar(c)}
                  className="px-2.5 py-1 text-xs bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded transition"
                >
                  Revisar
                </button>
              )}
              {c.estado === 'RECHAZADO' && c.nota_admin && (
                <span className="text-xs text-red-400 italic" title={c.nota_admin}>
                  {c.nota_admin.slice(0, 40)}{c.nota_admin.length > 40 ? '…' : ''}
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function RevisarModal({ cert, onClose, onSuccess }) {
  const [estado, setEstado] = useState('APROBADO')
  const [nota, setNota] = useState('')
  const [vencimiento, setVencimiento] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    setLoading(true)
    try {
      await api.post(`/certificados/${cert.id}/revisar`, {
        estado,
        nota_admin: nota || null,
        fecha_vencimiento: vencimiento || null,
      })
      toast.success(`Certificado ${estado === 'APROBADO' ? 'aprobado' : 'rechazado'}`)
      onSuccess()
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Error al revisar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Revisar: ${TIPO_LABEL[cert.tipo] || cert.tipo}`} size="md">
      <div className="space-y-4">
        <div className="flex gap-3">
          {['APROBADO', 'RECHAZADO'].map(e => (
            <button
              key={e}
              onClick={() => setEstado(e)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium border transition ${
                estado === e
                  ? e === 'APROBADO'
                    ? 'bg-green-600 text-white border-green-600'
                    : 'bg-red-600 text-white border-red-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {e === 'APROBADO' ? '✓ Aprobar' : '✗ Rechazar'}
            </button>
          ))}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Fecha de vencimiento <span className="text-gray-400">(opcional)</span>
          </label>
          <input
            type="date"
            value={vencimiento}
            onChange={e => setVencimiento(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Nota <span className="text-gray-400">(opcional)</span>
          </label>
          <textarea
            rows={2}
            value={nota}
            onChange={e => setNota(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Motivo del rechazo o comentario…"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
          >
            Guardar
          </button>
        </div>
      </div>
    </Modal>
  )
}

function SubirModal({ trabajadorId, nombre, onClose, onSuccess }) {
  const [tipo, setTipo] = useState('AFP')
  const [archivo, setArchivo] = useState(null)
  const [fechaEmision, setFechaEmision] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (!archivo) { toast.error('Selecciona un archivo'); return }
    setLoading(true)
    try {
      const fd = new FormData()
      fd.append('tipo', tipo)
      fd.append('archivo', archivo)
      if (fechaEmision) fd.append('fecha_emision', fechaEmision)
      await api.post(`/certificados/trabajador/${trabajadorId}/subir`, fd)
      toast.success('Certificado subido correctamente')
      onSuccess()
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Error al subir')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Subir certificado — ${nombre}`} size="md">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Tipo de certificado</label>
          <select
            value={tipo}
            onChange={e => setTipo(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            {Object.entries(TIPO_LABEL).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Fecha de emisión <span className="text-gray-400">(opcional)</span>
          </label>
          <input
            type="date"
            value={fechaEmision}
            onChange={e => setFechaEmision(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Archivo</label>
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={e => setArchivo(e.target.files[0])}
            className="w-full text-sm text-gray-700 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-blue-50 file:text-blue-600 hover:file:bg-blue-100"
          />
          <p className="text-xs text-gray-400 mt-1">PDF, JPG o PNG</p>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
          >
            <Upload size={14} />
            Subir certificado
          </button>
        </div>
      </div>
    </Modal>
  )
}
