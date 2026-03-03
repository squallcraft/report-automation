import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'

import Dashboard from './pages/admin/Dashboard'
import Sellers from './pages/admin/Sellers'
import Drivers from './pages/admin/Drivers'
import Ingesta from './pages/admin/Ingesta'
import Envios from './pages/admin/Envios'
import Liquidacion from './pages/admin/Liquidacion'
import Productos from './pages/admin/Productos'
import Comunas from './pages/admin/Comunas'
import Ajustes from './pages/admin/Ajustes'
import Retiros from './pages/admin/Retiros'
import Consultas from './pages/admin/Consultas'
import Logs from './pages/admin/Logs'
import Calendario from './pages/admin/Calendario'
import Facturacion from './pages/admin/Facturacion'
import CPC from './pages/admin/CPC'
import Usuarios from './pages/admin/Usuarios'
import Asistente from './pages/admin/Asistente'

import SellerDashboard from './pages/seller/SellerDashboard'
import SellerEnvios from './pages/seller/SellerEnvios'
import SellerLiquidacion from './pages/seller/SellerLiquidacion'
import SellerFacturacion from './pages/seller/SellerFacturacion'
import SellerConsultas from './pages/seller/SellerConsultas'

import DriverDashboard from './pages/driver/DriverDashboard'
import DriverEntregas from './pages/driver/DriverEntregas'
import DriverLiquidacion from './pages/driver/DriverLiquidacion'
import DriverConsultas from './pages/driver/DriverConsultas'

function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen text-gray-400">Cargando...</div>
  if (!user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(user.rol)) return <Navigate to="/login" replace />
  return children
}

function getDefaultRoute(rol) {
  if (rol === 'ADMIN' || rol === 'ADMINISTRACION') return '/admin'
  if (rol === 'SELLER') return '/seller'
  if (rol === 'DRIVER') return '/driver'
  return '/login'
}

export default function App() {
  const { user, loading } = useAuth()

  if (loading) return <div className="flex items-center justify-center h-screen text-gray-400">Cargando...</div>

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={getDefaultRoute(user.rol)} /> : <Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route path="/admin" element={<ProtectedRoute roles={['ADMIN', 'ADMINISTRACION']}><Layout /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="sellers" element={<Sellers />} />
        <Route path="drivers" element={<Drivers />} />
        <Route path="ingesta" element={<Ingesta />} />
        <Route path="envios" element={<Envios />} />
        <Route path="liquidacion" element={<Liquidacion />} />
        <Route path="productos" element={<Productos />} />
        <Route path="comunas" element={<Comunas />} />
        <Route path="ajustes" element={<Ajustes />} />
        <Route path="retiros" element={<Retiros />} />
        <Route path="consultas" element={<Consultas />} />
        <Route path="logs" element={<Logs />} />
        <Route path="calendario" element={<Calendario />} />
        <Route path="facturacion" element={<Facturacion />} />
        <Route path="cpc" element={<CPC />} />
        <Route path="usuarios" element={<Usuarios />} />
        <Route path="asistente" element={<Asistente />} />
      </Route>

      <Route path="/seller" element={<ProtectedRoute roles={['SELLER']}><Layout /></ProtectedRoute>}>
        <Route index element={<SellerDashboard />} />
        <Route path="envios" element={<SellerEnvios />} />
        <Route path="liquidacion" element={<SellerLiquidacion />} />
        <Route path="facturacion" element={<SellerFacturacion />} />
        <Route path="consultas" element={<SellerConsultas />} />
      </Route>

      <Route path="/driver" element={<ProtectedRoute roles={['DRIVER']}><Layout /></ProtectedRoute>}>
        <Route index element={<DriverDashboard />} />
        <Route path="entregas" element={<DriverEntregas />} />
        <Route path="liquidacion" element={<DriverLiquidacion />} />
        <Route path="consultas" element={<DriverConsultas />} />
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
