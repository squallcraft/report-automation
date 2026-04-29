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
import PlanesTarifarios from './pages/admin/PlanesTarifarios'
import Ajustes from './pages/admin/Ajustes'
import Retiros from './pages/admin/Retiros'
import Consultas from './pages/admin/Consultas'
import Logs from './pages/admin/Logs'
import Calendario from './pages/admin/Calendario'
import Facturacion from './pages/admin/Facturacion'
import Finanzas from './pages/admin/Finanzas'
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
import DriverGanancias from './pages/driver/DriverGanancias'
import DriverFacturas from './pages/driver/DriverFacturas'
import AcuerdoAceptacion from './pages/driver/AcuerdoAceptacion'
import ContratoTrabajoAceptacion from './pages/driver/ContratoTrabajoAceptacion'
import DriverMiAcuerdo from './pages/driver/DriverMiAcuerdo'
import DriverMiContrato from './pages/driver/DriverMiContrato'
import SellerGanancias from './pages/seller/SellerGanancias'

import Trabajadores from './pages/admin/Trabajadores'
import ContratosListado from './pages/admin/ContratosListado'
import Prestamos from './pages/admin/Prestamos'
import PagosTrabajadores from './pages/admin/PagosTrabajadores'
import Auditoria from './pages/admin/Auditoria'
import BusinessIntelligence from './pages/admin/BusinessIntelligence'
import EfectividadEntregas from './pages/admin/EfectividadEntregas'
import EfectividadDriver from './pages/admin/EfectividadDriver'
import EfectividadSeller from './pages/admin/EfectividadSeller'
import IngresosDrivers from './pages/admin/IngresosDrivers'
import DriverIngresoPerfil from './pages/admin/DriverIngresoPerfil'
import Retencion from './pages/admin/Retencion'
import SellerPerfil from './pages/admin/SellerPerfil'
import ReportesSellers from './pages/admin/ReportesSellers'
import Bandeja from './pages/admin/Bandeja'
import WhatsApp from './pages/admin/WhatsApp'
import EmailCampanas from './pages/admin/EmailCampanas'
import Pickups from './pages/admin/Pickups'
import CPP from './pages/admin/CPP'
import LeadsInbox from './pages/admin/LeadsInbox'
import LeadsPipeline from './pages/admin/LeadsPipeline'
import LeadsKB from './pages/admin/LeadsKB'
import Colaboradores from './pages/admin/Colaboradores'
import IVADrivers from './pages/admin/IVADrivers'
import IVAF29 from './pages/admin/IVAF29'
import ConfiguracionLegal from './pages/admin/ConfiguracionLegal'
import PickupDashboard from './pages/pickup/PickupDashboard'
import PickupRecepciones from './pages/pickup/PickupRecepciones'
import PickupEnvios from './pages/pickup/PickupEnvios'
import PickupEntregas from './pages/pickup/PickupEntregas'
import PickupCalendario from './pages/pickup/PickupCalendario'
import PickupGanancias from './pages/pickup/PickupGanancias'
import PickupFacturas from './pages/pickup/PickupFacturas'

import ColaboradorDashboard from './pages/colaborador/ColaboradorDashboard'
import ColaboradorBoletas from './pages/colaborador/ColaboradorBoletas'
import ColaboradorPerfil from './pages/colaborador/ColaboradorPerfil'

import InquilinoLayout from './pages/inquilino/InquilinoLayout'
import CompletarPerfil from './pages/inquilino/CompletarPerfil'
import InquilinoDashboard from './pages/inquilino/InquilinoDashboard'
import InquilinoContratos from './pages/inquilino/InquilinoContratos'
import InquilinoCobros from './pages/inquilino/InquilinoCobros'

import Inquilinos from './pages/admin/Inquilinos'
import InquilinoDetalle from './pages/admin/InquilinoDetalle'
import PlanesTrackingTech from './pages/admin/PlanesTrackingTech'

import TrabajadorDashboard from './pages/trabajador/TrabajadorDashboard'
import TrabajadorLiquidaciones from './pages/trabajador/TrabajadorLiquidaciones'
import TrabajadorPagos from './pages/trabajador/TrabajadorPagos'
import TrabajadorImposiciones from './pages/trabajador/TrabajadorImposiciones'
import TrabajadorFirma from './pages/trabajador/TrabajadorFirma'
import TrabajadorAnexos from './pages/trabajador/TrabajadorAnexos'
import TrabajadorNotificaciones from './pages/trabajador/TrabajadorNotificaciones'
import TrabajadorVacaciones from './pages/trabajador/TrabajadorVacaciones'
import PlantillasContrato from './pages/admin/PlantillasContrato'
import Vacaciones from './pages/admin/Vacaciones'
import Asistencia from './pages/admin/Asistencia'
import Flota from './pages/admin/Flota'
import Rentabilidad from './pages/admin/Rentabilidad'
import CronJobs from './pages/admin/CronJobs'
import AsignacionesRuta from './pages/admin/AsignacionesRuta'
import BackfillCoordenadas from './pages/admin/BackfillCoordenadas'
import FranjasHorarias from './pages/admin/FranjasHorarias'

function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen text-gray-400">Cargando...</div>
  if (!user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(user.rol)) return <Navigate to="/login" replace />
  return children
}

const ACUERDO_ACTIVO = true

function DriverRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen text-gray-400">Cargando...</div>
  if (!user) return <Navigate to="/login" replace />
  if (user.rol !== 'DRIVER') return <Navigate to="/login" replace />
  if (user.contratado && !user.contrato_trabajo_aceptado) return <Navigate to="/driver/contrato-trabajo" replace />
  if (ACUERDO_ACTIVO && !user.contratado && !user.acuerdo_aceptado) return <Navigate to="/driver/acuerdo" replace />
  return children
}

function getDefaultRoute(rol) {
  if (rol === 'ADMIN' || rol === 'ADMINISTRACION') return '/admin'
  if (rol === 'SELLER') return '/seller'
  if (rol === 'DRIVER') return '/driver'
  if (rol === 'PICKUP') return '/pickup'
  if (rol === 'COLABORADOR') return '/colaborador'
  if (rol === 'TRABAJADOR') return '/trabajador'
  if (rol === 'INQUILINO') return '/inquilino'
  return '/login'
}

function TrabajadorRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen text-gray-400">Cargando...</div>
  if (!user) return <Navigate to="/login" replace />
  if (user.rol !== 'TRABAJADOR') return <Navigate to="/login" replace />
  return children
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
        <Route path="planes-tarifarios" element={<PlanesTarifarios />} />
        <Route path="ajustes" element={<Ajustes />} />
        <Route path="retiros" element={<Retiros />} />
        <Route path="consultas" element={<Consultas />} />
        <Route path="logs" element={<Logs />} />
        <Route path="calendario" element={<Calendario />} />
        <Route path="facturacion" element={<Facturacion />} />
        <Route path="finanzas" element={<Finanzas />} />
        <Route path="cpc" element={<CPC />} />
        <Route path="usuarios" element={<Usuarios />} />
        <Route path="configuracion-legal" element={<ConfiguracionLegal />} />
        <Route path="plantillas-contrato" element={<PlantillasContrato />} />
        <Route path="vacaciones" element={<Vacaciones />} />
        <Route path="asistencia" element={<Asistencia />} />
        <Route path="flota" element={<Flota />} />
        <Route path="rentabilidad" element={<Rentabilidad />} />
        <Route path="asistente" element={<Asistente />} />
        <Route path="pickups" element={<Pickups />} />
        <Route path="cpp" element={<CPP />} />
        <Route path="trabajadores" element={<Trabajadores />} />
        <Route path="contratos" element={<ContratosListado />} />
        <Route path="prestamos" element={<Prestamos />} />
        <Route path="pagos-trabajadores" element={<PagosTrabajadores />} />
        <Route path="auditoria" element={<Auditoria />} />
        <Route path="bi" element={<BusinessIntelligence />} />
        <Route path="efectividad" element={<EfectividadEntregas />} />
        <Route path="efectividad/driver/:driverId" element={<EfectividadDriver />} />
        <Route path="efectividad/seller/:sellerId" element={<EfectividadSeller />} />
        <Route path="cron-jobs" element={<CronJobs />} />
        <Route path="asignaciones-ruta" element={<AsignacionesRuta />} />
        <Route path="coordenadas" element={<BackfillCoordenadas />} />
        <Route path="franjas-horarias" element={<FranjasHorarias />} />
        <Route path="ingresos-drivers" element={<IngresosDrivers />} />
        <Route path="ingresos-drivers/:driverId/perfil" element={<DriverIngresoPerfil />} />
        <Route path="retencion" element={<Retencion />} />
        <Route path="reportes-sellers" element={<ReportesSellers />} />
        <Route path="bandeja" element={<Bandeja />} />
        <Route path="whatsapp" element={<WhatsApp />} />
        <Route path="email-campanas" element={<EmailCampanas />} />
        <Route path="sellers/:sellerId/perfil" element={<SellerPerfil />} />
        <Route path="sellers/grupo/:grupoName/perfil" element={<SellerPerfil />} />
        <Route path="leads" element={<LeadsInbox />} />
        <Route path="leads/pipeline" element={<LeadsPipeline />} />
        <Route path="leads/kb" element={<LeadsKB />} />
        <Route path="colaboradores" element={<Colaboradores />} />
        <Route path="iva-drivers" element={<IVADrivers />} />
        <Route path="iva-f29" element={<IVAF29 />} />
        <Route path="inquilinos" element={<Inquilinos />} />
        <Route path="inquilinos/:inquilinoId" element={<InquilinoDetalle />} />
        <Route path="tracking-tech/planes" element={<PlanesTrackingTech />} />
      </Route>

      <Route path="/seller" element={<ProtectedRoute roles={['SELLER']}><Layout /></ProtectedRoute>}>
        <Route index element={<SellerDashboard />} />
        <Route path="envios" element={<SellerEnvios />} />
        <Route path="liquidacion" element={<SellerLiquidacion />} />
        <Route path="facturacion" element={<SellerFacturacion />} />
        <Route path="mis-pagos" element={<SellerGanancias />} />
        <Route path="consultas" element={<SellerConsultas />} />
      </Route>

      <Route path="/pickup" element={<ProtectedRoute roles={['PICKUP']}><Layout /></ProtectedRoute>}>
        <Route index element={<PickupDashboard />} />
        <Route path="recepciones" element={<PickupRecepciones />} />
        <Route path="envios" element={<PickupEnvios />} />
        <Route path="entregas" element={<PickupEntregas />} />
        <Route path="calendario" element={<PickupCalendario />} />
        <Route path="ganancias" element={<PickupGanancias />} />
        <Route path="facturas" element={<PickupFacturas />} />
      </Route>

      <Route path="/driver/acuerdo" element={<ProtectedRoute roles={['DRIVER']}><AcuerdoAceptacion /></ProtectedRoute>} />
      <Route path="/driver/contrato-trabajo" element={<ProtectedRoute roles={['DRIVER']}><ContratoTrabajoAceptacion /></ProtectedRoute>} />

      <Route path="/colaborador" element={<ProtectedRoute roles={['COLABORADOR']}><Layout /></ProtectedRoute>}>
        <Route index element={<ColaboradorDashboard />} />
        <Route path="boletas" element={<ColaboradorBoletas />} />
        <Route path="perfil" element={<ColaboradorPerfil />} />
      </Route>

      {/* Portal Inquilinos */}
      <Route path="/inquilino/completar-perfil" element={<ProtectedRoute roles={['INQUILINO']}><CompletarPerfil /></ProtectedRoute>} />
      <Route path="/inquilino" element={<ProtectedRoute roles={['INQUILINO']}><InquilinoLayout /></ProtectedRoute>}>
        <Route index element={<InquilinoDashboard />} />
        <Route path="contratos" element={<InquilinoContratos />} />
        <Route path="cobros" element={<InquilinoCobros />} />
      </Route>

      {/* Rutas admin inquilinos */}
      <Route path="/admin/inquilinos" element={<ProtectedRoute roles={['ADMIN', 'ADMINISTRACION']}><Layout /></ProtectedRoute>}>
        <Route index element={<Inquilinos />} />
        <Route path=":inquilinoId" element={<InquilinoDetalle />} />
      </Route>

      <Route path="/trabajador" element={<TrabajadorRoute><Layout /></TrabajadorRoute>}>
        <Route index element={<TrabajadorDashboard />} />
        <Route path="liquidaciones" element={<TrabajadorLiquidaciones />} />
        <Route path="pagos" element={<TrabajadorPagos />} />
        <Route path="imposiciones" element={<TrabajadorImposiciones />} />
        <Route path="firma" element={<TrabajadorFirma />} />
        <Route path="anexos" element={<TrabajadorAnexos />} />
        <Route path="anexos/:anexoId" element={<TrabajadorAnexos />} />
        <Route path="notificaciones" element={<TrabajadorNotificaciones />} />
        <Route path="vacaciones" element={<TrabajadorVacaciones />} />
        <Route path="vacaciones/:vacId" element={<TrabajadorVacaciones />} />
      </Route>

      <Route path="/driver" element={<DriverRoute><Layout /></DriverRoute>}>
        <Route index element={<DriverDashboard />} />
        <Route path="entregas" element={<DriverEntregas />} />
        <Route path="liquidacion" element={<DriverLiquidacion />} />
        <Route path="ganancias" element={<DriverGanancias />} />
        <Route path="facturas" element={<DriverFacturas />} />
        <Route path="consultas" element={<DriverConsultas />} />
        <Route path="acuerdo-info" element={<DriverMiAcuerdo />} />
        <Route path="mi-contrato" element={<DriverMiContrato />} />
        <Route path="mis-vacaciones" element={<TrabajadorVacaciones />} />
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
