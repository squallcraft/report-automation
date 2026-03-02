import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  LayoutDashboard, Users, Truck, Upload, Calculator, Package,
  MapPin, Settings, MessageSquare, LogOut, FileText, ChevronLeft,
  ChevronRight, DollarSign, ClipboardList, CalendarDays, Receipt, CreditCard, UserCog, Bot,
} from 'lucide-react'
import { useState } from 'react'

const adminLinks = [
  { to: '/admin', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/admin/sellers', icon: Users, label: 'Sellers' },
  { to: '/admin/drivers', icon: Truck, label: 'Drivers' },
  { to: '/admin/ingesta', icon: Upload, label: 'Ingesta' },
  { to: '/admin/envios', icon: FileText, label: 'Envíos' },
  { to: '/admin/liquidacion', icon: Calculator, label: 'Liquidación' },
  { to: '/admin/productos', icon: Package, label: 'Productos Extra' },
  { to: '/admin/comunas', icon: MapPin, label: 'Comunas' },
  { to: '/admin/ajustes', icon: Settings, label: 'Ajustes' },
  { to: '/admin/retiros', icon: DollarSign, label: 'Retiros' },
  { to: '/admin/consultas', icon: MessageSquare, label: 'Consultas' },
  { to: '/admin/facturacion', icon: Receipt, label: 'Facturación' },
  { to: '/admin/cpc', icon: CreditCard, label: 'CPC Drivers' },
  { to: '/admin/logs', icon: ClipboardList, label: 'Logs' },
  { to: '/admin/calendario', icon: CalendarDays, label: 'Calendario' },
  { to: '/admin/usuarios', icon: UserCog, label: 'Usuarios' },
  { to: '/admin/asistente', icon: Bot, label: 'Asistente IA' },
]

const administracionLinks = [
  { to: '/admin', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/admin/sellers', icon: Users, label: 'Sellers' },
  { to: '/admin/drivers', icon: Truck, label: 'Drivers' },
  { to: '/admin/envios', icon: FileText, label: 'Envíos' },
  { to: '/admin/liquidacion', icon: Calculator, label: 'Liquidación' },
  { to: '/admin/productos', icon: Package, label: 'Productos Extra' },
  { to: '/admin/comunas', icon: MapPin, label: 'Comunas' },
  { to: '/admin/ajustes', icon: Settings, label: 'Ajustes' },
  { to: '/admin/retiros', icon: DollarSign, label: 'Retiros' },
  { to: '/admin/consultas', icon: MessageSquare, label: 'Consultas' },
  { to: '/admin/facturacion', icon: Receipt, label: 'Facturación' },
  { to: '/admin/cpc', icon: CreditCard, label: 'CPC Drivers' },
  { to: '/admin/logs', icon: ClipboardList, label: 'Logs' },
  { to: '/admin/calendario', icon: CalendarDays, label: 'Calendario' },
  { to: '/admin/asistente', icon: Bot, label: 'Asistente IA' },
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

export default function Sidebar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)

  let links = adminLinks
  if (user?.rol === 'ADMINISTRACION') links = administracionLinks
  if (user?.rol === 'SELLER') links = sellerLinks
  if (user?.rol === 'DRIVER') links = driverLinks

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <aside className={`${collapsed ? 'w-16' : 'w-64'} flex flex-col bg-primary-900 text-white transition-all duration-200 ease-in-out`}>
      <div className="flex items-center justify-between px-4 py-5 border-b border-primary-800">
        {!collapsed && (
          <div>
            <h1 className="text-lg font-bold tracking-wide">ECourier</h1>
            <p className="text-xs text-primary-300">Sistema de Liquidación</p>
          </div>
        )}
        <button onClick={() => setCollapsed(!collapsed)} className="p-1 rounded hover:bg-primary-800 transition-colors">
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      <nav className="flex-1 py-4 space-y-1 overflow-y-auto">
        {links.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/admin' || to === '/seller' || to === '/driver'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 mx-2 rounded-lg text-sm font-medium transition-colors
              ${isActive ? 'bg-primary-700 text-white' : 'text-primary-200 hover:bg-primary-800 hover:text-white'}`
            }
          >
            <Icon size={18} className="shrink-0" />
            {!collapsed && <span>{label}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-primary-800 p-4">
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
