import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  LayoutDashboard, Users, Truck, Upload, Calculator, Package,
  MapPin, Settings, MessageSquare, LogOut, FileText, ChevronLeft,
  ChevronRight, ChevronDown, DollarSign, ClipboardList, CalendarDays, Receipt, CreditCard, UserCog, Bot, X, TrendingUp, Store, Shield, ShieldCheck, Layers, Wallet, Briefcase, HandCoins, CircleDollarSign, BarChart3, Inbox, BookOpen, Kanban, User, PenLine, FileSignature, Bell, Calendar, Clock, Mail,
} from 'lucide-react'
import { useState, useEffect } from 'react'
import api from '../api'
import logoEcourier from '../assets/logo-ecourier.png'

const adminMenu = [
  { to: '/admin', icon: LayoutDashboard, label: 'Dashboard' },

  // ── Operaciones ──────────────────────────────────────────────────────────
  {
    group: 'Operaciones', icon: Package, children: [
      { to: '/admin/ingesta', icon: Upload, label: 'Ingesta', permiso: 'ingesta' },
      { to: '/admin/envios', icon: FileText, label: 'Envíos', permiso: 'envios' },
      { to: '/admin/retiros', icon: DollarSign, label: 'Retiros', permiso: 'retiros' },
      { to: '/admin/efectividad', icon: TrendingUp, label: 'Efectividad de Entregas', permiso: 'efectividad' },
      { to: '/admin/calendario', icon: CalendarDays, label: 'Calendario', permiso: 'calendario' },
    ],
  },

  // ── Conductores ──────────────────────────────────────────────────────────
  {
    group: 'Conductores', icon: Truck, children: [
      { to: '/admin/drivers', icon: Truck, label: 'Perfiles', permiso: 'drivers' },
      { to: '/admin/cpc', icon: CreditCard, label: 'CPC', permiso: 'cpc' },
      { to: '/admin/iva-drivers', icon: Receipt, label: 'IVA conductores', permiso: ['iva-drivers', 'cpc'] },
      { to: '/admin/ingresos-drivers', icon: DollarSign, label: 'Ingresos conductores', permiso: 'ingresos-drivers' },
      { to: '/admin/flota', icon: Truck, label: 'Flota', permiso: ['flota', 'drivers'] },
      { to: '/admin/rentabilidad', icon: TrendingUp, label: 'Rentabilidad', permiso: ['rentabilidad', 'drivers'] },
    ],
  },

  // ── Sellers ──────────────────────────────────────────────────────────────
  {
    group: 'Sellers', icon: Store, children: [
      { to: '/admin/sellers', icon: Users, label: 'Perfiles', permiso: 'sellers' },
      { to: '/admin/facturacion', icon: Receipt, label: 'CPS', permiso: 'facturacion' },
      { to: '/admin/reportes-sellers', icon: BarChart3, label: 'Reportes', permiso: 'reportes-sellers' },
      { to: '/admin/retencion', icon: TrendingUp, label: 'Retención comercial', permiso: 'retencion' },
    ],
  },

  // ── Pickups ──────────────────────────────────────────────────────────────
  {
    group: 'Pickups', icon: MapPin, children: [
      { to: '/admin/pickups', icon: Store, label: 'Puntos pickup', permiso: 'pickups' },
      { to: '/admin/cpp', icon: CreditCard, label: 'CPP', permiso: 'cpp' },
    ],
  },

  // ── Finanzas ─────────────────────────────────────────────────────────────
  {
    group: 'Finanzas', icon: Wallet, children: [
      { to: '/admin/finanzas', icon: Wallet, label: 'Estado ECourier', permiso: 'finanzas' },
      { to: '/admin/liquidacion', icon: Calculator, label: 'Liquidación', permiso: 'liquidacion' },
      { to: '/admin/ajustes', icon: CircleDollarSign, label: 'Ajustes / Préstamos', permiso: 'ajustes' },
    ],
  },

  // ── RR.HH. ───────────────────────────────────────────────────────────────
  {
    group: 'RR.HH.', icon: Briefcase, children: [
      { to: '/admin/trabajadores', icon: Users, label: 'Trabajadores', permiso: 'trabajadores' },
      { to: '/admin/pagos-trabajadores', icon: HandCoins, label: 'Pagos nómina', permiso: 'pagos-trabajadores' },
      { to: '/admin/vacaciones', icon: Calendar, label: 'Vacaciones', permiso: 'rrhh-vacaciones' },
      { to: '/admin/asistencia', icon: Clock, label: 'Control horario', permiso: 'asistencia' },
      { to: '/admin/plantillas-contrato', icon: FileSignature, label: 'Plantillas de contrato', permiso: 'plantillas-contrato' },
      { to: '/admin/configuracion-legal', icon: Shield, label: 'Configuración legal', permiso: 'configuracion-legal' },
    ],
  },

  // ── Comercial ────────────────────────────────────────────────────────────
  {
    group: 'Comercial', icon: Kanban, children: [
      { to: '/admin/leads', icon: Inbox, label: 'Leads WhatsApp', permiso: 'leads' },
      { to: '/admin/leads/pipeline', icon: Kanban, label: 'Pipeline CRM', permiso: 'crm' },
      { to: '/admin/leads/kb', icon: BookOpen, label: 'Base de conocimiento', permiso: 'kb' },
    ],
  },

  // ── Comunicaciones ───────────────────────────────────────────────────────
  {
    group: 'Comunicaciones', icon: MessageSquare, children: [
      { to: '/admin/whatsapp', icon: MessageSquare, label: 'WhatsApp Business', permiso: 'whatsapp' },
      { to: '/admin/email-campanas', icon: Mail, label: 'Email Campaigns', permiso: 'email-campanas' },
      { to: '/admin/consultas', icon: ClipboardList, label: 'Consultas', permiso: 'consultas' },
      { to: '/admin/bandeja', icon: Inbox, label: 'Bandeja de tareas', permiso: 'bandeja' },
    ],
  },

  // ── Análisis ─────────────────────────────────────────────────────────────
  {
    group: 'Análisis', icon: BarChart3, children: [
      { to: '/admin/bi', icon: BarChart3, label: 'Business Intelligence', permiso: ['bi', 'finanzas'] },
    ],
  },

  // ── Sistema ──────────────────────────────────────────────────────────────
  {
    group: 'Sistema', icon: Settings, children: [
      { to: '/admin/usuarios', icon: UserCog, label: 'Usuarios y permisos', permiso: 'usuarios' },
      { to: '/admin/colaboradores', icon: Users, label: 'Colaboradores', permiso: 'colaboradores' },
      { to: '/admin/planes-tarifarios', icon: Layers, label: 'Planes tarifarios', permiso: ['planes-tarifarios', 'comunas'] },
      { to: '/admin/comunas', icon: MapPin, label: 'Comunas', permiso: 'comunas' },
      { to: '/admin/productos', icon: Package, label: 'Productos extra', permiso: 'productos' },
      { to: '/admin/auditoria', icon: ShieldCheck, label: 'Auditoría', permiso: 'auditoria' },
      { to: '/admin/logs', icon: ClipboardList, label: 'Logs', permiso: 'logs' },
      { to: '/admin/asistente', icon: Bot, label: 'Asistente IA', permiso: 'asistente' },
    ],
  },
]

const sellerLinks = [
  { to: '/seller', icon: LayoutDashboard, label: 'Mi Panel' },
  { to: '/seller/envios', icon: FileText, label: 'Mis Envíos' },
  { to: '/seller/liquidacion', icon: Calculator, label: 'Mi Liquidación' },
  { to: '/seller/facturacion', icon: Receipt, label: 'Mi Facturación' },
  { to: '/seller/mis-pagos', icon: TrendingUp, label: 'Mis Pagos' },
  { to: '/seller/consultas', icon: MessageSquare, label: 'Consultas' },
]

function getDriverLinks(user) {
  const links = [
    { to: '/driver', icon: LayoutDashboard, label: 'Mi Panel' },
    { to: '/driver/entregas', icon: FileText, label: 'Mis Entregas' },
    { to: '/driver/liquidacion', icon: Calculator, label: 'Mi Liquidación' },
    { to: '/driver/ganancias', icon: TrendingUp, label: 'Mis Ganancias' },
    { to: '/driver/facturas', icon: Receipt, label: 'Mis Facturas' },
    { to: '/driver/consultas', icon: MessageSquare, label: 'Consultas' },
  ]
  if (!user?.contratado) {
    links.push({ to: '/driver/acuerdo-info', icon: ClipboardList, label: 'Mi Acuerdo' })
  }
  return links
}

function tieneAcceso(permisos, slugs) {
  const arr = Array.isArray(slugs) ? slugs : [slugs]
  return arr.some(slug => permisos.includes(`${slug}:ver`) || permisos.includes(`${slug}:editar`))
}

function filterMenu(menu, permisos) {
  return menu.reduce((acc, item) => {
    if (item.group) {
      const filtered = item.children.filter(c => !c.permiso || tieneAcceso(permisos, c.permiso))
      if (filtered.length > 0) acc.push({ ...item, children: filtered })
    } else {
      if (!item.permiso || tieneAcceso(permisos, item.permiso)) acc.push(item)
    }
    return acc
  }, [])
}

function SidebarLink({ to, icon: Icon, label, collapsed, end = false, badge = 0, badgeCritical = false }) {
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        `flex items-center gap-3 py-2 mx-1.5 sm:mx-2 rounded-lg text-sm font-medium transition-colors touch-manipulation
        ${collapsed ? 'justify-center px-2' : 'px-3 sm:px-4'}
        ${isActive ? 'bg-primary-700 text-white' : 'text-primary-200 hover:bg-primary-800 hover:text-white'}`
      }
    >
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <Icon size={18} />
        {badge > 0 && collapsed && (
          <span style={{
            position: 'absolute', top: -5, right: -5,
            background: badgeCritical ? '#ef4444' : '#f59e0b',
            color: '#fff', borderRadius: 99, fontSize: 9, fontWeight: 700,
            padding: '1px 4px', minWidth: 14, textAlign: 'center', lineHeight: '14px',
          }}>{badge > 99 ? '99+' : badge}</span>
        )}
      </div>
      {!collapsed && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
          {label}
          {badge > 0 && (
            <span style={{
              background: badgeCritical ? '#ef4444' : '#f59e0b',
              color: '#fff', borderRadius: 99, fontSize: 9, fontWeight: 700,
              padding: '1px 6px', marginLeft: 'auto',
            }}>{badge > 99 ? '99+' : badge}</span>
          )}
        </span>
      )}
    </NavLink>
  )
}

function SidebarGroup({ group, icon: Icon, children, collapsed, openGroups, toggleGroup }) {
  const isOpen = openGroups[group] !== false
  const location = useLocation()
  const hasActive = children.some(c => location.pathname === c.to)

  return (
    <div>
      <button
        onClick={() => !collapsed && toggleGroup(group)}
        title={collapsed ? group : undefined}
        className={`flex items-center gap-3 py-2 mx-1.5 sm:mx-2 rounded-lg text-sm font-medium transition-colors w-full text-left touch-manipulation
          ${collapsed ? 'justify-center px-2' : 'px-3 sm:px-4'}
          ${hasActive ? 'text-white' : 'text-primary-300 hover:bg-primary-800 hover:text-white'}`}
      >
        <Icon size={18} className="shrink-0" />
        {!collapsed && (
          <>
            <span className="flex-1">{group}</span>
            <ChevronDown size={14} className={`transition-transform duration-200 ${isOpen ? '' : '-rotate-90'}`} />
          </>
        )}
      </button>
      {isOpen && !collapsed && (
        <div className="ml-3 border-l border-primary-700 pl-1 mt-0.5 mb-1">
          {children.map(child => (
            <SidebarLink key={child.to} {...child} collapsed={collapsed} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function Sidebar({ mobileOpen = false, onClose }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const [pickupProfile, setPickupProfile] = useState(null)
  const [openGroups, setOpenGroups] = useState({
    Operaciones: true,
    Conductores: false,
    Sellers: false,
    Pickups: false,
    Finanzas: false,
    'RR.HH.': false,
    Comercial: false,
    Comunicaciones: false,
    'Análisis': false,
    Sistema: false,
  })
  const [tareasCount, setTareasCount] = useState({ total: 0, criticas: 0 })
  const [notifTrabCount, setNotifTrabCount] = useState(0)

  const toggleGroup = (name) => setOpenGroups(prev => ({ ...prev, [name]: !prev[name] }))

  useEffect(() => {
    if (user?.rol === 'ADMIN' || user?.rol === 'ADMINISTRACION') {
      api.get('/tareas/count').then(r => setTareasCount(r.data)).catch(() => {})
      const iv = setInterval(() => {
        api.get('/tareas/count').then(r => setTareasCount(r.data)).catch(() => {})
      }, 60000)
      return () => clearInterval(iv)
    }
  }, [user?.rol])

  useEffect(() => {
    if (user?.rol !== 'TRABAJADOR') return
    const fetchN = () => api.get('/notificaciones-trabajador/no-leidas')
      .then(r => setNotifTrabCount(r.data?.count || 0))
      .catch(() => {})
    fetchN()
    const iv = setInterval(fetchN, 60000)
    return () => clearInterval(iv)
  }, [user?.rol])

  useEffect(() => {
    if (user?.rol === 'PICKUP') {
      api.get('/pickups/portal/dashboard')
        .then(({ data }) => setPickupProfile(data))
        .catch(() => {})
    }
  }, [user?.rol])

  useEffect(() => {
    if (onClose && mobileOpen) onClose()
  }, [location.pathname])

  const pickupLinks = [
    { to: '/pickup', icon: LayoutDashboard, label: 'Mi Panel' },
    { to: '/pickup/recepciones', icon: Package, label: 'Mis Recepciones' },
    ...(pickupProfile?.seller_id ? [{ to: '/pickup/envios', icon: FileText, label: 'Mis Envíos' }] : []),
    ...(pickupProfile?.driver_id ? [{ to: '/pickup/entregas', icon: Truck, label: 'Mis Entregas' }] : []),
    { to: '/pickup/calendario', icon: CalendarDays, label: 'Mi Calendario' },
    { to: '/pickup/ganancias', icon: TrendingUp, label: 'Mis Ganancias' },
    { to: '/pickup/facturas', icon: Receipt, label: 'Mis Facturas' },
  ]

  let menu = adminMenu
  let isFlat = false
  if (user?.rol === 'ADMINISTRACION') {
    const permisos = user?.permisos || []
    menu = filterMenu(adminMenu, permisos)
    if (!menu.find(m => m.to === '/admin')) {
      menu = [adminMenu[0], ...menu]
    }
  }
  if (user?.rol === 'SELLER') { menu = sellerLinks; isFlat = true }
  if (user?.rol === 'DRIVER') { menu = getDriverLinks(user); isFlat = true }
  if (user?.rol === 'PICKUP') { menu = pickupLinks; isFlat = true }
  if (user?.rol === 'COLABORADOR') {
    menu = [
      { to: '/colaborador', icon: LayoutDashboard, label: 'Mi Portal' },
      { to: '/colaborador/boletas', icon: Receipt, label: 'Mis Boletas' },
      { to: '/colaborador/perfil', icon: User, label: 'Mi Perfil' },
    ]
    isFlat = true
  }

  if (user?.rol === 'TRABAJADOR') {
    menu = [
      { to: '/trabajador', icon: LayoutDashboard, label: 'Mi Portal' },
      { to: '/trabajador/notificaciones', icon: Bell, label: 'Notificaciones' },
      { to: '/trabajador/liquidaciones', icon: FileText, label: 'Mis Liquidaciones' },
      { to: '/trabajador/pagos', icon: DollarSign, label: 'Mis Pagos' },
      { to: '/trabajador/imposiciones', icon: ShieldCheck, label: 'Imposiciones' },
      { to: '/trabajador/vacaciones', icon: Calendar, label: 'Mis Vacaciones' },
      { to: '/trabajador/anexos', icon: FileSignature, label: 'Mis Anexos' },
      { to: '/trabajador/firma', icon: PenLine, label: 'Mi Firma' },
    ]
    isFlat = true
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
    onClose?.()
  }

  return (
    <aside
      className={`
        fixed lg:relative inset-y-0 left-0 z-30 flex flex-col bg-primary-900 text-white
        transition-all duration-200 ease-out overflow-hidden
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        ${collapsed ? 'lg:w-16' : 'w-64'}
      `}
    >
      <div className={`flex items-center py-3 sm:py-4 border-b border-primary-800 px-3 ${collapsed ? 'justify-center' : 'justify-between px-4'}`}>
        {!collapsed && (
          <img
            src={logoEcourier}
            alt="eCourier"
            className="h-12 w-auto object-contain"
          />
        )}
        {collapsed && (
          <img
            src={logoEcourier}
            alt="eCourier"
            className="h-10 w-10 object-contain"
            style={{ objectPosition: 'center' }}
          />
        )}
        {/* Botón cerrar en móvil */}
        {onClose && (
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-primary-800 lg:hidden" aria-label="Cerrar menú">
            <X size={20} />
          </button>
        )}
        {/* Botón colapsar en desktop */}
        <button
          type="button"
          onClick={() => setCollapsed(v => !v)}
          className="p-1.5 rounded-lg hover:bg-primary-800 transition-colors hidden lg:flex items-center justify-center shrink-0"
          aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <nav className="flex-1 py-2 sm:py-4 space-y-0.5 overflow-y-auto">
        {menu.map((item) =>
          item.group ? (
            <SidebarGroup
              key={item.group}
              {...item}
              collapsed={collapsed}
              openGroups={openGroups}
              toggleGroup={toggleGroup}
            />
          ) : (
            <SidebarLink
              key={item.to}
              {...item}
              collapsed={collapsed}
              end={item.to === '/admin' || item.to === '/seller' || item.to === '/driver' || item.to === '/pickup' || item.to === '/colaborador'}
              badge={
                item.to === '/admin/bandeja' ? tareasCount.total :
                item.to === '/trabajador/notificaciones' ? notifTrabCount :
                0
              }
              badgeCritical={
                item.to === '/admin/bandeja' ? tareasCount.criticas > 0 :
                item.to === '/trabajador/notificaciones' ? notifTrabCount > 0 :
                false
              }
            />
          )
        )}
      </nav>

      <div className={`border-t border-primary-800 p-3 sm:p-4 ${collapsed ? 'flex justify-center' : ''}`}>
        {!collapsed && (
          <p className="text-xs text-primary-300 mb-2 truncate">{user?.nombre}</p>
        )}
        <button
          onClick={handleLogout}
          title={collapsed ? 'Cerrar sesión' : undefined}
          className={`flex items-center gap-2 text-sm text-primary-300 hover:text-white transition-colors w-full ${collapsed ? 'justify-center' : ''}`}
        >
          <LogOut size={16} />
          {!collapsed && <span>Cerrar sesión</span>}
        </button>
      </div>
    </aside>
  )
}
