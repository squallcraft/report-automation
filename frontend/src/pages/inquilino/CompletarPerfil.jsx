import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import api from '../../api'
import { Building2, User, Phone, Loader2, CheckCircle } from 'lucide-react'

const Input = ({ label, ...props }) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
    <input
      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      {...props}
    />
  </div>
)

export default function CompletarPerfil() {
  const navigate = useNavigate()
  const { updateUser } = useAuth()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [form, setForm] = useState({
    razon_social: '', nombre_fantasia: '', rut_empresa: '',
    direccion_empresa: '', correo_empresa: '', giro_empresa: '',
    nombre_rep_legal: '', rut_rep_legal: '', direccion_rep_legal: '',
    correo_rep_legal: '', correo_contacto: '', whatsapp: '',
  })

  const handleChange = (e) => setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await api.post('/inquilinos/portal/completar-perfil', form)
      updateUser({ perfil_completado: true })
      navigate('/inquilino/contratos')
    } catch (err) {
      setError(err.response?.data?.detail || 'Error al guardar el perfil')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-blue-900 rounded-full mb-4">
            <Building2 className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Completa tu perfil</h1>
          <p className="text-gray-500 mt-1">Necesitamos estos datos para generar tus contratos y facturas</p>
        </div>

        {/* Steps */}
        <div className="flex items-center justify-center gap-4 mb-8">
          {[1, 2].map(s => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                step > s ? 'bg-green-500 text-white' : step === s ? 'bg-blue-900 text-white' : 'bg-gray-200 text-gray-500'
              }`}>
                {step > s ? <CheckCircle className="w-4 h-4" /> : s}
              </div>
              <span className={`text-sm ${step === s ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>
                {s === 1 ? 'Empresa' : 'Contacto'}
              </span>
              {s < 2 && <div className="w-12 h-0.5 bg-gray-200" />}
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            {step === 1 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-4">
                  <Building2 className="w-5 h-5 text-blue-900" />
                  <h2 className="font-semibold text-gray-900">Datos de la empresa</h2>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Input label="Razón Social *" name="razon_social" value={form.razon_social} onChange={handleChange} required placeholder="Empresa SPA" />
                  <Input label="Nombre de Fantasía" name="nombre_fantasia" value={form.nombre_fantasia} onChange={handleChange} placeholder="Mi Empresa" />
                  <Input label="RUT Empresa *" name="rut_empresa" value={form.rut_empresa} onChange={handleChange} required placeholder="12.345.678-9" />
                  <Input label="Correo Empresa *" name="correo_empresa" value={form.correo_empresa} onChange={handleChange} required type="email" placeholder="empresa@ejemplo.cl" />
                  <div className="col-span-2">
                    <Input label="Dirección Empresa *" name="direccion_empresa" value={form.direccion_empresa} onChange={handleChange} required placeholder="Av. Principal 123, Santiago" />
                  </div>
                  <div className="col-span-2">
                    <Input label="Giro" name="giro_empresa" value={form.giro_empresa} onChange={handleChange} placeholder="Transporte y logística" />
                  </div>
                </div>

                <div className="pt-2 border-t border-gray-100">
                  <div className="flex items-center gap-2 mb-4">
                    <User className="w-5 h-5 text-blue-900" />
                    <h3 className="font-semibold text-gray-900">Representante Legal</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Input label="Nombre completo *" name="nombre_rep_legal" value={form.nombre_rep_legal} onChange={handleChange} required placeholder="Juan Pérez González" />
                    <Input label="RUT *" name="rut_rep_legal" value={form.rut_rep_legal} onChange={handleChange} required placeholder="12.345.678-9" />
                    <Input label="Correo *" name="correo_rep_legal" value={form.correo_rep_legal} onChange={handleChange} required type="email" placeholder="representante@empresa.cl" />
                    <div className="col-span-2">
                      <Input label="Dirección *" name="direccion_rep_legal" value={form.direccion_rep_legal} onChange={handleChange} required placeholder="Av. Principal 123, Santiago" />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-4">
                  <Phone className="w-5 h-5 text-blue-900" />
                  <h2 className="font-semibold text-gray-900">Datos de contacto y comunicaciones</h2>
                </div>
                <p className="text-sm text-gray-500">Estos datos se usan para notificaciones de cobros y comunicaciones. No se incluyen en contratos.</p>
                <div className="grid grid-cols-2 gap-4 pt-2">
                  <Input label="Correo de contacto" name="correo_contacto" value={form.correo_contacto} onChange={handleChange} type="email" placeholder="cobros@empresa.cl" />
                  <Input label="WhatsApp" name="whatsapp" value={form.whatsapp} onChange={handleChange} placeholder="+56912345678" />
                </div>
              </div>
            )}

            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {error}
              </div>
            )}
          </div>

          <div className="flex justify-between mt-6">
            {step > 1 ? (
              <button type="button" onClick={() => setStep(s => s - 1)}
                className="px-5 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
                Anterior
              </button>
            ) : <div />}

            {step < 2 ? (
              <button type="button" onClick={() => setStep(2)}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-900 rounded-lg hover:bg-blue-800 transition-colors">
                Siguiente
              </button>
            ) : (
              <button type="submit" disabled={loading}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-900 rounded-lg hover:bg-blue-800 disabled:opacity-60 transition-colors">
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                Guardar perfil
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
