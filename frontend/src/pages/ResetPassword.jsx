import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import api from '../api'
import toast from 'react-hot-toast'
import { Truck, Eye, EyeOff, CheckCircle } from 'lucide-react'

export default function ResetPassword() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token') || ''

  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!token) {
      toast.error('Enlace inválido o expirado')
      navigate('/login', { replace: true })
    }
  }, [token, navigate])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (newPassword.length < 8) {
      toast.error('La contraseña debe tener al menos 8 caracteres')
      return
    }
    if (newPassword !== confirm) {
      toast.error('Las contraseñas no coinciden')
      return
    }
    setLoading(true)
    try {
      await api.post('/auth/reset-password', { token, new_password: newPassword })
      setDone(true)
    } catch (err) {
      const detail = err?.response?.data?.detail || 'Enlace inválido o expirado. Solicita uno nuevo.'
      toast.error(detail)
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
          <p className="text-primary-200 text-xs sm:text-sm mt-1">Nueva contraseña</p>
        </div>

        <div className="bg-white rounded-xl sm:rounded-2xl shadow-2xl p-5 sm:p-8">
          {done ? (
            <div className="text-center space-y-4">
              <div className="inline-flex items-center justify-center w-14 h-14 bg-green-100 rounded-full mx-auto">
                <CheckCircle size={28} className="text-green-600" />
              </div>
              <h2 className="text-lg font-semibold text-gray-800">¡Contraseña actualizada!</h2>
              <p className="text-sm text-gray-600">Ya puedes iniciar sesión con tu nueva contraseña.</p>
              <button onClick={() => navigate('/login', { replace: true })} className="btn-primary w-full py-2.5 mt-2">
                Ir al login
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-gray-800 mb-1">Crea tu nueva contraseña</h2>
                <p className="text-sm text-gray-500">Debe tener al menos 8 caracteres.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Nueva contraseña</label>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="input-field pr-10"
                    placeholder="••••••••"
                    required
                    minLength={8}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirmar contraseña</label>
                <input
                  type={showPass ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="input-field"
                  placeholder="••••••••"
                  required
                />
                {confirm && newPassword !== confirm && (
                  <p className="text-xs text-red-500 mt-1">Las contraseñas no coinciden</p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading || (!!confirm && newPassword !== confirm)}
                className="btn-primary w-full py-2.5"
              >
                {loading ? 'Guardando...' : 'Guardar contraseña'}
              </button>

              <div className="text-center">
                <Link to="/login" className="text-sm text-primary-600 hover:text-primary-800">
                  Volver al login
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
