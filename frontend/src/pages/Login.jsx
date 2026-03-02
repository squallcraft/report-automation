import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import toast from 'react-hot-toast'
import { Truck } from 'lucide-react'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const user = await login(username, password)
      toast.success(`Bienvenido, ${user.nombre}`)
      if (user.rol === 'ADMIN') navigate('/admin')
      else if (user.rol === 'SELLER') navigate('/seller')
      else if (user.rol === 'DRIVER') navigate('/driver')
    } catch {
      toast.error('Credenciales incorrectas')
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
          <p className="text-primary-200 text-xs sm:text-sm mt-1">Sistema de Liquidación Logística</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-xl sm:rounded-2xl shadow-2xl p-5 sm:p-8 space-y-4 sm:space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Usuario o Email</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input-field"
              placeholder="admin / email@ecourier.cl"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
              placeholder="••••••••"
              required
            />
          </div>
          <button type="submit" disabled={loading} className="btn-primary w-full py-2.5">
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>

        <p className="text-center text-xs text-primary-300 mt-4 sm:mt-6">
          ECourier &copy; {new Date().getFullYear()} — Todos los derechos reservados
        </p>
      </div>
    </div>
  )
}
