import { useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api'
import toast from 'react-hot-toast'
import { Truck, Mail, ArrowLeft } from 'lucide-react'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await api.post('/auth/request-password-reset', { email })
      setSent(true)
    } catch {
      // Siempre mostramos éxito para no filtrar si el email existe
      setSent(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-900 via-primary-800 to-primary-950 px-3 sm:px-4 py-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-5 sm:mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 sm:w-16 sm:h-16 bg-white/10 backdrop-blur rounded-xl sm:rounded-2xl mb-3 sm:mb-4">
            <Truck size={28} className="text-white sm:w-8 sm:h-8" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">ECourier</h1>
          <p className="text-primary-200 text-xs sm:text-sm mt-1">Restablecer contraseña</p>
        </div>

        <div className="bg-white rounded-xl sm:rounded-2xl shadow-2xl p-5 sm:p-8">
          {sent ? (
            <div className="text-center space-y-4">
              <div className="inline-flex items-center justify-center w-14 h-14 bg-green-100 rounded-full mx-auto">
                <Mail size={28} className="text-green-600" />
              </div>
              <h2 className="text-lg font-semibold text-gray-800">Revisa tu correo</h2>
              <p className="text-sm text-gray-600">
                Si el email está registrado en el sistema, recibirás un enlace para restablecer tu contraseña.
                El enlace es válido por <strong>1 hora</strong>.
              </p>
              <Link to="/login" className="btn-primary inline-flex items-center gap-2 mt-2">
                <ArrowLeft size={16} /> Volver al login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-gray-800 mb-1">¿Olvidaste tu contraseña?</h2>
                <p className="text-sm text-gray-500">
                  Ingresa tu email y te enviaremos un enlace para crear una nueva contraseña.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-field"
                  placeholder="tu@email.cl"
                  required
                  autoFocus
                />
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full py-2.5">
                {loading ? 'Enviando...' : 'Enviar enlace'}
              </button>
              <div className="text-center">
                <Link to="/login" className="text-sm text-primary-600 hover:text-primary-800 inline-flex items-center gap-1">
                  <ArrowLeft size={14} /> Volver al login
                </Link>
              </div>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-primary-300 mt-4 sm:mt-6">
          ECourier &copy; {new Date().getFullYear()} — Todos los derechos reservados
        </p>
      </div>
    </div>
  )
}
