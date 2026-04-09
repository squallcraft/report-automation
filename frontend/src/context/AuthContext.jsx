import { createContext, useContext, useState, useEffect } from 'react'
import api from '../api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const stored = localStorage.getItem('user')
    if (stored) {
      try {
        setUser(JSON.parse(stored))
      } catch {
        localStorage.removeItem('user')
        localStorage.removeItem('token')
      }
    }
    setLoading(false)
  }, [])

  const login = async (username, password) => {
    const { data } = await api.post('/auth/login', { username, password })
    localStorage.setItem('token', data.access_token)
    const userData = {
      rol: data.rol,
      nombre: data.nombre,
      entidad_id: data.entidad_id,
      permisos: data.permisos || [],
      acuerdo_aceptado: data.acuerdo_aceptado ?? null,
    }
    localStorage.setItem('user', JSON.stringify(userData))
    setUser(userData)
    return userData
  }

  const updateUser = (patch) => {
    setUser(prev => {
      const updated = { ...prev, ...patch }
      localStorage.setItem('user', JSON.stringify(updated))
      return updated
    })
  }

  const logout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setUser(null)
  }

  const tienePermiso = (slug) => {
    if (!user) return false
    if (user.rol === 'ADMIN') return true
    return (user.permisos || []).includes(slug)
  }

  const puedeEditar = (seccion) => tienePermiso(`${seccion}:editar`)
  const puedeVer = (seccion) => tienePermiso(`${seccion}:ver`) || tienePermiso(`${seccion}:editar`)

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, tienePermiso, puedeEditar, puedeVer, updateUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}
