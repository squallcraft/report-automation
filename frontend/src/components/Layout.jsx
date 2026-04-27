import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Menu } from 'lucide-react'
import Sidebar from './Sidebar'

export default function Layout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Barra móvil: menú hamburger + título */}
      <header className="fixed top-0 left-0 right-0 h-12 lg:hidden flex items-center gap-2 px-3 bg-primary-900 text-white z-30 border-b border-primary-800">
        <button
          type="button"
          onClick={() => setMobileMenuOpen(true)}
          className="p-2 -ml-1 rounded-lg hover:bg-primary-800 touch-manipulation"
          aria-label="Abrir menú"
        >
          <Menu size={22} />
        </button>
        <span className="font-semibold text-sm truncate flex-1">ECourier</span>
      </header>

      <Sidebar mobileOpen={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />

      {/* Overlay al abrir menú en móvil */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden
        />
      )}

      <main className="flex-1 min-w-0 overflow-hidden flex flex-col bg-gray-50 pt-12 lg:pt-0">
        <div className="flex-1 min-w-0 overflow-y-auto p-3 sm:p-4 lg:px-8 lg:pt-5 lg:pb-8 min-h-0">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
