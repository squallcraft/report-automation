import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { Building2, FileText, CreditCard, PenLine, LogOut, Menu, X } from 'lucide-react'

const navItems = [
  { to: '/inquilino',          label: 'Inicio',           icon: Building2, end: true },
  { to: '/inquilino/contratos',label: 'Contratos',        icon: FileText },
  { to: '/inquilino/cobros',   label: 'Cobros y Facturas',icon: CreditCard },
  { to: '/inquilino/firma',    label: 'Mi Firma',         icon: PenLine },
]

function SidebarContent({ user, onClose, onLogout }) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-5 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0">
            <Building2 className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">{user?.nombre}</p>
            <p className="text-xs text-blue-200">Tracking Tech</p>
          </div>
        </div>
        <button onClick={onClose} className="lg:hidden p-1.5 rounded-lg hover:bg-white/10 text-white/60">
          <X size={18} />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-0.5">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onClose}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-white/15 text-white'
                  : 'text-blue-100 hover:bg-white/10 hover:text-white'
              }`
            }
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-white/10">
        <button
          onClick={onLogout}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm text-blue-200 hover:text-white hover:bg-white/10 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}

export default function InquilinoLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)

  const handleLogout = () => { logout(); navigate('/login') }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile topbar */}
      <header className="fixed top-0 left-0 right-0 h-12 lg:hidden flex items-center gap-2 px-3 z-30"
              style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #1d4ed8 100%)' }}>
        <button onClick={() => setMobileOpen(true)}
          className="p-2 -ml-1 rounded-lg hover:bg-white/10 text-white touch-manipulation">
          <Menu size={22} />
        </button>
        <span className="font-semibold text-sm text-white truncate flex-1">Tracking Tech</span>
      </header>

      {/* Sidebar desktop */}
      <aside className="hidden lg:flex w-56 flex-col flex-shrink-0"
             style={{ background: 'linear-gradient(160deg, #1e3a5f 0%, #1d4ed8 100%)' }}>
        <SidebarContent user={user} onClose={() => {}} onLogout={handleLogout} />
      </aside>

      {/* Sidebar mobile (slide-in) */}
      {mobileOpen && (
        <>
          <div className="fixed inset-0 bg-black/50 z-20 lg:hidden" onClick={() => setMobileOpen(false)} />
          <aside className="fixed top-0 left-0 h-full w-64 z-30 lg:hidden flex flex-col"
                 style={{ background: 'linear-gradient(160deg, #1e3a5f 0%, #1d4ed8 100%)' }}>
            <SidebarContent user={user} onClose={() => setMobileOpen(false)} onLogout={handleLogout} />
          </aside>
        </>
      )}

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-hidden flex flex-col bg-gray-50 pt-12 lg:pt-0">
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
