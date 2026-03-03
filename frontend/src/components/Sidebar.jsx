import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  LayoutDashboard, Users, Truck, Upload, Calculator, Package,
  MapPin, Settings, MessageSquare, LogOut, FileText, ChevronLeft,
  ChevronRight, DollarSign, ClipboardList, CalendarDays, Receipt, CreditCard, UserCog, Bot, X,
} from 'lucide-react'
import { useState, useEffect } from 'react'

const adminLinks = [
  { to: '/admin', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/admin/sellers', icon: Users, label: 'Sellers', permiso: 'sellers' },
  { to: '/admin/drivers', icon: Truck, label: 'Drivers', permiso: 'drivers' },
  { to: '/admin/ingesta', icon: Upload, label: 'Ingesta', permiso: 'ingesta' },
  { to: '/admin/envios', icon: FileText, label: 'Envíos', permiso: 'envios' },
  { to: '/admin/liquidacion', icon: Calculator, label: 'Liquidación', permiso: 'liquidacion' },
  { to: '/admin/productos', icon: Package, label: 'Productos Extra', permiso: 'productos' },
  { to: '/admin/comunas', icon: MapPin, label: 'Comunas', permiso: 'comunas' },
  { to: '/admin/ajustes', icon: Settings, label: 'Ajustes', permiso: 'ajustes' },
  { to: '/admin/retiros', icon: DollarSign, label: 'Retiros', permiso: 'retiros' },
  { to: '/admin/consultas', icon: MessageSquare, label: 'Consultas', permiso: 'consultas' },
  { to: '/admin/facturacion', icon: Receipt, label: 'Facturación', permiso: 'facturacion' },
  { to: '/admin/cpc', icon: CreditCard, label: 'CPC Drivers', permiso: 'cpc' },
  { to: '/admin/logs', icon: ClipboardList, label: 'Logs', permiso: 'logs' },
  { to: '/admin/calendario', icon: CalendarDays, label: 'Calendario', permiso: 'calendario' },
  { to: '/admin/usuarios', icon: UserCog, label: 'Usuarios' },   // solo ADMIN (sin permiso slug)
  { to: '/admin/asistente', icon: Bot, label: 'Asistente IA', permiso: 'asistente' },
]

const sellerLinks = [
  { to: '/seller', icon: LayoutDashboard, label: 'Mi Panel' },
  { to: '/seller/envios', icon: FileText, label: 'Mis Envíos' },
  { to: '/seller/liquidacion', icon: Calculator, label: 'Mi Liquidación' },
  { to: '/seller/facturacion', icon: Receipt, label: 'Mi Facturación' },
  { to: '/seller/consultas', icon: MessageSquare, label: 'Consultas' },
]

const driverLinks = [
  { to: '/driver', icon: LayoutDashboard, label: 'Mi Panel' },
  { to: '/driver/entregas', icon: FileText, label: 'Mis Entregas' },
  { to: '/driver/liquidacion', icon: Calculator, label: 'Mi Liquidación' },
  { to: '/driver/consultas', icon: MessageSquare, label: 'Consultas' },
]

export default function Sidebar({ mobileOpen = false, onClose }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)

  // Cerrar drawer al cambiar de ruta (móvil)
  useEffect(() => {
    if (onClose && mobileOpen) onClose()
  }, [location.pathname])

  let links = adminLinks
  if (user?.rol === 'ADMINISTRACION') {
    const permisos = user?.permisos || []
    links = adminLinks.filter(l => {
      if (!l.permiso) return false          // sin slug = solo ADMIN (ej: Usuarios)
      return permisos.includes(l.permiso)
    })
    // Dashboard siempre visible para ADMINISTRACION
    if (!links.find(l => l.to === '/admin')) {
      links = [adminLinks[0], ...links]
    }
  }
  if (user?.rol === 'SELLER') links = sellerLinks
  if (user?.rol === 'DRIVER') links = driverLinks

  const handleLogout = () => {
    logout()
    navigate('/login')
    onClose?.()
  }

  return (
    <aside
      className={`
        fixed lg:relative inset-y-0 left-0 z-30 flex flex-col bg-primary-900 text-white
        w-64 transition-transform duration-200 ease-out
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        w-64 ${collapsed ? 'lg:w-16' : 'lg:w-64'}
      `}
    >
      <div className="flex items-center justify-between px-4 py-3 sm:py-5 border-b border-primary-800">
        {!collapsed && (
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-bold tracking-wide truncate">ECourier</h1>
            <p className="text-xs text-primary-300 hidden sm:block">Sistema de Liquidación</p>
          </div>
        )}
        {onClose ? (
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-primary-800 lg:hidden" aria-label="Cerrar menú">
            <X size={20} />
          </button>
        ) : (
          <button type="button" onClick={() => setCollapsed(!collapsed)} className="p-1 rounded hover:bg-primary-800 transition-colors hidden lg:block">
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        )}
      </div>

      <nav className="flex-1 py-2 sm:py-4 space-y-0.5 sm:space-y-1 overflow-y-auto">
        {links.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/admin' || to === '/seller' || to === '/driver'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-2.5 mx-1.5 sm:mx-2 rounded-lg text-sm font-medium transition-colors touch-manipulation
              ${isActive ? 'bg-primary-700 text-white' : 'text-primary-200 hover:bg-primary-800 hover:text-white'}`
            }
          >
            <Icon size={18} className="shrink-0" />
            {!collapsed && <span>{label}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-primary-800 p-3 sm:p-4">
        {!collapsed && (
          <p className="text-xs text-primary-300 mb-2 truncate">{user?.nombre}</p>
        )}
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 text-sm text-primary-300 hover:text-white transition-colors w-full"
        >
          <LogOut size={16} />
          {!collapsed && <span>Cerrar sesión</span>}
        </button>
      </div>
    </aside>
  )
}
