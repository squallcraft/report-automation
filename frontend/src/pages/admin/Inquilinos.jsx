import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api'
import { Building2, Plus, Search, ChevronRight, CheckCircle, Clock, AlertCircle, X, Loader2 } from 'lucide-react'

const PLANES = {
  TARIFA_A: 'Tarifa A',
  TARIFA_B: 'Tarifa B',
  TARIFA_C: 'Tarifa C',
}

function NuevoInquilinoModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ email: '', plan: 'TARIFA_A', tiene_reserva: false, monto_reserva: '', mes_gratis: false, password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const payload = {
        ...form,
        monto_reserva: form.tiene_reserva && form.monto_reserva ? parseInt(form.monto_reserva) : null,
      }
      const { data } = await api.post('/inquilinos/admin', payload)
      onCreated(data)
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail || 'Error al crear inquilino')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b">
          <h3 className="font-semibold text-gray-900">Nuevo inquilino</h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email de acceso *</label>
            <input value={form.email} onChange={e => setForm(p => ({...p, email: e.target.value}))} required type="email"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="contacto@empresa.cl" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contraseña inicial</label>
            <input value={form.password} onChange={e => setForm(p => ({...p, password: e.target.value}))}
              type="password" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Dejar en blanco para que el usuario lo configure" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Plan *</label>
            <select value={form.plan} onChange={e => setForm(p => ({...p, plan: e.target.value}))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="TARIFA_A">Tarifa A — Base 24 conductores ($300.000 + IVA)</option>
              <option value="TARIFA_B">Tarifa B — Base 25.000 envíos ($1.000.000 + IVA)</option>
              <option value="TARIFA_C">Tarifa C — Base $100.000 + por conductor</option>
            </select>
          </div>
          <div className="flex items-center gap-3">
            <input id="mes_gratis" type="checkbox" checked={form.mes_gratis} onChange={e => setForm(p => ({...p, mes_gratis: e.target.checked}))}
              className="w-4 h-4 text-blue-900 rounded" />
            <label htmlFor="mes_gratis" className="text-sm text-gray-700">Incluye mes gratis al inicio</label>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <input id="tiene_reserva" type="checkbox" checked={form.tiene_reserva} onChange={e => setForm(p => ({...p, tiene_reserva: e.target.checked}))}
                className="w-4 h-4 text-blue-900 rounded" />
              <label htmlFor="tiene_reserva" className="text-sm text-gray-700">Solicitar reserva</label>
            </div>
            {form.tiene_reserva && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Monto reserva (neto, sin IVA)</label>
                <input value={form.monto_reserva} onChange={e => setForm(p => ({...p, monto_reserva: e.target.value}))}
                  type="number" min="0" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="300000" />
              </div>
            )}
          </div>
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={loading}
              className="flex-1 py-2.5 text-sm font-semibold text-white bg-blue-900 rounded-lg hover:bg-blue-800 disabled:opacity-60 flex items-center justify-center gap-2">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Crear inquilino
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Inquilinos() {
  const navigate = useNavigate()
  const [inquilinos, setInquilinos] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)

  useEffect(() => {
    api.get('/inquilinos/admin')
      .then(r => setInquilinos(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filtered = inquilinos.filter(i =>
    (i.razon_social || i.nombre_fantasia || i.email || '').toLowerCase().includes(search.toLowerCase())
  )

  const handleCreated = (inq) => setInquilinos(prev => [inq, ...prev])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inquilinos</h1>
          <p className="text-gray-500 mt-1">Empresas con arriendo del sistema Tracking Tech</p>
        </div>
        <button onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-900 rounded-lg hover:bg-blue-800 transition-colors">
          <Plus className="w-4 h-4" />
          Nuevo inquilino
        </button>
      </div>

      {/* Búsqueda */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por empresa o email..."
          className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin w-8 h-8 border-2 border-blue-900 border-t-transparent rounded-full" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No hay inquilinos aún</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Empresa</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Plan</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Estado</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Perfil</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(inq => (
                <tr key={inq.id} className="hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => navigate(`/admin/inquilinos/${inq.id}`)}>
                  <td className="px-5 py-3.5">
                    <p className="font-medium text-gray-900">{inq.razon_social || inq.nombre_fantasia || inq.email}</p>
                    <p className="text-xs text-gray-500">{inq.email}</p>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-medium rounded-full">
                      {PLANES[inq.plan] || inq.plan || '—'}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    {inq.contrato_firmado ? (
                      <span className="flex items-center gap-1 text-green-700 text-xs font-medium">
                        <CheckCircle className="w-3.5 h-3.5" /> Firmado
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-amber-600 text-xs font-medium">
                        <Clock className="w-3.5 h-3.5" /> Sin firmar
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    {inq.perfil_completado ? (
                      <span className="flex items-center gap-1 text-green-700 text-xs">
                        <CheckCircle className="w-3.5 h-3.5" /> Completo
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-gray-400 text-xs">
                        <Clock className="w-3.5 h-3.5" /> Pendiente
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3.5">
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <NuevoInquilinoModal onClose={() => setShowModal(false)} onCreated={handleCreated} />
      )}
    </div>
  )
}
