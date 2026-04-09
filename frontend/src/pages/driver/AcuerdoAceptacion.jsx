import { useRef, useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api'
import { useAuth } from '../../context/AuthContext'

const ACUERDO_VERSION = '1.0'

function SignaturePad({ onChange }) {
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const [hasSignature, setHasSignature] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    const resize = () => {
      const ctx = canvas.getContext('2d')
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      canvas.width = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
      ctx.putImageData(imageData, 0, 0)
    }
    canvas.width = canvas.offsetWidth
    canvas.height = canvas.offsetHeight
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  const getPos = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const src = e.touches ? e.touches[0] : e
    return {
      x: (src.clientX - rect.left) * scaleX,
      y: (src.clientY - rect.top) * scaleY,
    }
  }

  const startDraw = (e) => {
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    const pos = getPos(e)
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
    drawing.current = true
  }

  const draw = useCallback((e) => {
    e.preventDefault()
    if (!drawing.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const pos = getPos(e)
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#111827'
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    if (!hasSignature) {
      setHasSignature(true)
      onChange(canvas.toDataURL('image/png'))
    } else {
      onChange(canvas.toDataURL('image/png'))
    }
  }, [hasSignature, onChange])

  const stopDraw = () => { drawing.current = false }

  const clear = () => {
    const canvas = canvasRef.current
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
    setHasSignature(false)
    onChange(null)
  }

  return (
    <div className="relative rounded-xl border-2 border-dashed border-gray-300 bg-white overflow-hidden" style={{ height: 160 }}>
      <canvas
        ref={canvasRef}
        className="w-full h-full touch-none cursor-crosshair"
        onMouseDown={startDraw}
        onMouseMove={draw}
        onMouseUp={stopDraw}
        onMouseLeave={stopDraw}
        onTouchStart={startDraw}
        onTouchMove={draw}
        onTouchEnd={stopDraw}
      />
      {!hasSignature && (
        <span className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm pointer-events-none select-none">
          Dibuja tu firma aquí con el dedo o el mouse
        </span>
      )}
      {hasSignature && (
        <button
          type="button"
          onClick={clear}
          className="absolute top-2 right-2 text-xs text-gray-400 hover:text-red-500 transition-colors bg-white/80 rounded px-2 py-1"
        >
          Borrar
        </button>
      )}
    </div>
  )
}

function formatRut(value) {
  const clean = value.replace(/[^0-9kK]/g, '').toUpperCase()
  if (clean.length <= 1) return clean
  const body = clean.slice(0, -1)
  const dv = clean.slice(-1)
  const formatted = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${formatted}-${dv}`
}

export default function AcuerdoAceptacion() {
  const navigate = useNavigate()
  const { user, updateUser } = useAuth()
  const [rut, setRut] = useState('')
  const [firma, setFirma] = useState(null)
  const [leido, setLeido] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const scrollRef = useRef(null)
  const [scrolledToBottom, setScrolledToBottom] = useState(false)

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 20) {
      setScrolledToBottom(true)
    }
  }

  const canSubmit = rut.length >= 9 && firma && leido && !loading

  const handleSubmit = async () => {
    if (!canSubmit) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.post('/drivers/me/acuerdo', {
        rut,
        firma_base64: firma,
        version: ACUERDO_VERSION,
      })
      localStorage.setItem('token', data.access_token)
      updateUser({ acuerdo_aceptado: true })
      navigate('/driver', { replace: true })
    } catch (e) {
      setError(e.response?.data?.detail || 'Error al registrar la aceptación. Inténtalo de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-8 px-4">
      <div className="w-full max-w-2xl">

        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gray-900 mb-4">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900">Acuerdo de Colaboración</h1>
          <p className="text-sm text-gray-500 mt-1">Lee el acuerdo completo antes de firmar</p>
        </div>

        {/* Contract */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-5">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="overflow-y-auto p-6 text-sm text-gray-700 leading-relaxed"
            style={{ maxHeight: 420 }}
          >
            <p className="text-center font-bold text-gray-900 text-base mb-1 uppercase tracking-wide">
              Acuerdo de Prestación de Servicios Independientes
            </p>
            <p className="text-center text-gray-500 mb-6">Ecourier — Prestador de Servicios · Versión {ACUERDO_VERSION} · Abril 2026</p>

            <p className="mb-4">
              <strong>LOGÍSTICA Y TRANSPORTE E-COURIER SPA</strong> y el Prestador identificado al momento de la aceptación
              celebran el siguiente acuerdo en conformidad con las normas del Código Civil y la legislación vigente aplicable
              a prestadores independientes.
            </p>

            <Clausula n="1" titulo="Objeto y Vigencia">
              El Prestador presta a Ecourier servicios de retiro y entrega de carga de manera <strong>autónoma e independiente</strong>,
              utilizando su propio vehículo y recursos. Cada encargo (ruta diaria) constituye una prestación de servicios independiente,
              coordinada previamente entre las partes. Este Acuerdo es de <strong>duración indefinida</strong> y puede ser terminado
              en cualquier momento por cualquiera de las partes.<br /><br />
              La plataforma digital de Ecourier es una herramienta de trazabilidad operativa, <strong>no un sistema de intermediación
              en tiempo real</strong>, y no determina la disponibilidad ni los ingresos del Prestador.
            </Clausula>

            <Clausula n="2" titulo="Naturaleza de la Relación">
              Las partes declaran expresamente que <strong>no existe vínculo de subordinación ni dependencia laboral</strong>.
              El Prestador no está sujeto a jornada laboral ni horario fijo impuesto por Ecourier. Puede declinar encargos
              sin penalización y puede prestar servicios simultáneos a otras empresas sin restricción ni exclusividad.
              El Prestador es responsable de su vehículo, permisos, seguros, documentación y combustible, y emite
              <strong> boleta de honorarios o factura</strong> por sus servicios, siendo responsable de sus cotizaciones
              previsionales y obligaciones tributarias. Ecourier no asume responsabilidad por daños a terceros causados
              por el Prestador.
            </Clausula>

            <Clausula n="3" titulo="Coordinación Operativa">
              La coordinación de encargos se basa en disponibilidad informada y acuerdo mutuo. Se valora que el Prestador
              informe con anticipación cuando no esté disponible: ausencias de un día con 12 horas de anticipación; varios días
              con 15 días; en períodos de alta demanda (Navidad, CyberDay, Black Friday, Fiestas Patrias y otros informados)
              con <strong>30 días de anticipación</strong>. Las emergencias siempre son consideradas. La falta de aviso no
              genera penalización, pero puede afectar la asignación de encargos futuros.
            </Clausula>

            <Clausula n="4" titulo="Uso de la Plataforma — Acceso Personal e Intransferible">
              El Prestador usa la app de Ecourier para registro fotográfico de entregas, actualización de estados e informe
              de incidencias. Las credenciales son <strong>estrictamente personales e intransferibles</strong>. Cederlas
              a terceros es causal de término inmediato.
            </Clausula>

            <Clausula n="5" titulo="Estándares de Calidad del Servicio">
              El Prestador se compromete a manipular la carga con cuidado y verificarla al recibirla; no abrir empaques;
              mantener trato respetuoso con clientes; cuidar la imagen de Ecourier; respetar normas de tránsito; mantener
              documentación del vehículo al día; usar canales oficiales de comunicación; y abstenerse de negociaciones
              paralelas con clientes o solicitar datos personales de destinatarios. El incumplimiento grave puede ser causal
              de término.
            </Clausula>

            <Clausula n="6" titulo="Protección de Datos Personales">
              En conformidad con la <strong>Ley N° 19.628</strong>, el Prestador usará los datos de destinatarios solo para
              fines de la entrega, no los almacenará fuera de la plataforma y no los compartirá con terceros.
            </Clausula>

            <Clausula n="7" titulo="Seguridad Personal">
              El Prestador prioriza su integridad física por sobre la carga. Se recomienda el uso de calzado de seguridad
              y chaleco reflectante. El Prestador es responsable de sus propios elementos de protección.
            </Clausula>

            <Clausula n="8" titulo="Protocolo en caso de Robo o Asalto">
              En caso de asalto: no oponer resistencia; comunicar a operaciones de inmediato; realizar denuncia en
              Carabineros dentro de 24 horas; enviar copia a Ecourier y completar formulario interno. Si el evento
              se determina como negligente del Prestador, puede ser causal de término.
            </Clausula>

            <Clausula n="9" titulo="Responsabilidad por la Carga">
              El Prestador es responsable de la carga desde su recepción hasta la entrega, salvo fuerza mayor o delito
              denunciado. En casos de negligencia comprobada, Ecourier notificará al Prestador por escrito, quien tendrá
              5 días hábiles para presentar descargos. El cobro, si procede, no excederá el valor declarado de la carga.
            </Clausula>

            <Clausula n="10" titulo="Responsabilidad por Infracciones de Tránsito">
              Toda multa o infracción de tránsito durante la prestación de servicios es de <strong>exclusiva responsabilidad
              del Prestador</strong>. Ecourier no asume ninguna responsabilidad en esta materia.
            </Clausula>

            <Clausula n="11" titulo="Tarifas y Condiciones Económicas">
              Las tarifas vigentes se consultan en el perfil del Prestador dentro de la plataforma. Ecourier podrá modificarlas
              con <strong>30 días de aviso previo</strong>. Los pagos se realizan contra boleta de honorarios o factura,
              en los plazos acordados operativamente.
            </Clausula>

            <Clausula n="12" titulo="Confidencialidad">
              El Prestador mantiene confidencialidad sobre datos de clientes, rutas, tarifas, procesos operativos y
              estrategias comerciales durante la colaboración y por <strong>24 meses después de su término</strong>.
              El incumplimiento puede derivar en acciones legales.
            </Clausula>

            <Clausula n="13" titulo="Término de la Colaboración">
              Cualquiera de las partes puede terminar en cualquier momento <strong>sin indemnización</strong>. Son causales
              de término inmediato: incumplimientos graves o reiterados, faltas de conducta con clientes, negligencia en
              la carga, falsificación de información, uso indebido de datos personales, manipulación indebida de paquetes
              o cesión de credenciales.
            </Clausula>

            <Clausula n="14" titulo="Ley Aplicable y Resolución de Disputas">
              Este Acuerdo se rige por las leyes de Chile. Las controversias se someten a los{' '}
              <strong>Tribunales Ordinarios de Justicia de Santiago</strong>.
            </Clausula>

            <Clausula n="15" titulo="Modificaciones al Acuerdo">
              Ecourier podrá modificar este Acuerdo con 30 días de aviso previo. Si el Prestador continúa prestando
              servicios tras el plazo, se entiende que acepta las modificaciones.
            </Clausula>

            <div className="mt-4 p-3 bg-gray-50 rounded-lg text-xs text-gray-500 text-center">
              Versión {ACUERDO_VERSION} · Vigente desde Abril 2026 · Logística y Transporte E-Courier SpA
            </div>
          </div>

          {!scrolledToBottom && (
            <div className="px-4 py-2 bg-amber-50 border-t border-amber-100 text-xs text-amber-700 flex items-center gap-2">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              Desplázate hacia abajo para leer el acuerdo completo
            </div>
          )}
        </div>

        {/* Form */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5">

          {/* Leido checkbox */}
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={leido}
              onChange={e => setLeido(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
            />
            <span className="text-sm text-gray-700">
              He leído y comprendido íntegramente el Acuerdo de Prestación de Servicios Independientes.
              Ante cualquier duda, me pondré en contacto con Ecourier antes de aceptar.
            </span>
          </label>

          {/* RUT */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tu RUT</label>
            <input
              type="text"
              value={rut}
              onChange={e => setRut(formatRut(e.target.value))}
              placeholder="12.345.678-9"
              maxLength={12}
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
          </div>

          {/* Signature */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tu firma</label>
            <SignaturePad onChange={setFirma} />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">{error}</p>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`w-full rounded-xl py-3 text-sm font-semibold transition-all ${
              canSubmit
                ? 'bg-gray-900 text-white hover:bg-gray-800 active:scale-95'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            {loading ? 'Registrando aceptación...' : 'Aceptar y acceder al portal'}
          </button>

          <p className="text-xs text-gray-400 text-center">
            Al aceptar, se registrará tu nombre, RUT, firma, fecha y dirección IP en conformidad con la Ley N° 19.799.
          </p>
        </div>

        {/* Logout link */}
        <div className="text-center mt-4">
          <button
            onClick={() => { localStorage.removeItem('token'); localStorage.removeItem('user'); window.location.href = '/login' }}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Cerrar sesión
          </button>
        </div>

      </div>
    </div>
  )
}

function Clausula({ n, titulo, children }) {
  return (
    <div className="mb-4">
      <p className="font-semibold text-gray-900 mb-1">{n}. {titulo}</p>
      <p className="text-gray-600">{children}</p>
    </div>
  )
}
