import { useRef, useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api'
import { useAuth } from '../../context/AuthContext'
import { Camera, X } from 'lucide-react'

const CONTRATO_VERSION = '1.0'

const fmtClp = (n) => (n ?? 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP' })

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

function PhotoUpload({ label, value, onChange }) {
  const inputRef = useRef(null)

  const handleFile = (e) => {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { alert('La imagen no debe superar 5 MB'); return }
    const reader = new FileReader()
    reader.onload = (ev) => onChange(ev.target.result)
    reader.readAsDataURL(file)
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {value ? (
        <div className="relative rounded-xl border border-gray-200 overflow-hidden bg-gray-50">
          <img src={value} alt={label} className="w-full h-40 object-contain" />
          <button
            type="button"
            onClick={() => { onChange(null); if (inputRef.current) inputRef.current.value = '' }}
            className="absolute top-2 right-2 p-1 bg-white/90 rounded-full hover:bg-red-50 text-gray-400 hover:text-red-500"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full rounded-xl border-2 border-dashed border-gray-300 bg-white h-32 flex flex-col items-center justify-center gap-2 text-gray-400 hover:border-gray-400 hover:text-gray-500 transition-colors"
        >
          <Camera size={24} />
          <span className="text-xs">Toca para tomar foto o seleccionar</span>
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/*" capture="environment" onChange={handleFile} className="hidden" />
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

function tipoContratoLabel(tipo) {
  if (tipo === 'INDEFINIDO') return 'Indefinido'
  if (tipo === 'PLAZO_FIJO') return 'Plazo Fijo'
  return tipo || '—'
}

function distribucionLabel(d) {
  if (d === 'LUNES_VIERNES') return 'de lunes a viernes'
  if (d === 'LUNES_SABADO') return 'de lunes a sábado'
  if (d === 'TURNOS') return 'según sistema de turnos'
  if (d === 'OTRO') return 'según acuerdo de las partes'
  return d || ''
}

export default function ContratoTrabajoAceptacion() {
  const navigate = useNavigate()
  const { updateUser } = useAuth()
  const [nombreCompleto, setNombreCompleto] = useState('')
  const [rut, setRut] = useState('')
  const [firma, setFirma] = useState(null)
  const [carnetFrontal, setCarnetFrontal] = useState(null)
  const [carnetTrasero, setCarnetTrasero] = useState(null)
  const [leido, setLeido] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [info, setInfo] = useState(null)
  const scrollRef = useRef(null)
  const [scrolledToBottom, setScrolledToBottom] = useState(false)

  useEffect(() => {
    api.get('/drivers/me/contrato-trabajo-info').then(r => {
      // La API retorna { trabajador: {...}, driver_nombre, ... }
      // Aplanamos para que el template acceda directo desde `info.*`
      const d = r.data
      setInfo({ ...d, ...(d.trabajador || {}) })
    }).catch(() => {})
  }, [])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 20) {
      setScrolledToBottom(true)
    }
  }

  const canSubmit = nombreCompleto.trim().length >= 5 && rut.length >= 9 && firma && carnetFrontal && carnetTrasero && leido && !loading

  const handleSubmit = async () => {
    if (!canSubmit) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.post('/drivers/me/contrato-trabajo', {
        nombre_completo: nombreCompleto.trim(),
        rut,
        firma_base64: firma,
        carnet_frontal: carnetFrontal,
        carnet_trasero: carnetTrasero,
        version: CONTRATO_VERSION,
      })
      localStorage.setItem('token', data.access_token)
      updateUser({ contrato_trabajo_aceptado: true })
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

        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-orange-600 mb-4">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900">Contrato de Trabajo</h1>
          <p className="text-sm text-gray-500 mt-1">Lee el contrato completo antes de firmar</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-5">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="overflow-y-auto p-6 text-sm text-gray-700 leading-relaxed"
            style={{ maxHeight: 420 }}
          >
            <p className="text-center font-bold text-gray-900 text-base mb-1 uppercase tracking-wide">
              Contrato de Trabajo
            </p>
            <p className="text-center text-gray-500 mb-6">Logística y Transporte E-Courier SpA · Versión {CONTRATO_VERSION}</p>

            <p className="mb-4">
              En Santiago, entre <strong>LOGÍSTICA Y TRANSPORTE E-COURIER SpA</strong>, RUT N° 77.512.163-7, con domicilio en
              Moneda N° 1137, Oficina 56, comuna de Santiago, en adelante el "Empleador"; y{' '}
              <strong>{info?.nombre_completo || '[nombre del trabajador]'}</strong>, RUT{' '}
              <strong>{info?.rut || '[RUT del trabajador]'}</strong>, en adelante el "Trabajador",
              se ha convenido el siguiente Contrato de Trabajo:
            </p>

            <Clausula n="1" titulo="Objeto">
              El Trabajador se desempeñará como <strong>transportista dependiente</strong> del Empleador,
              realizando labores de retiro, transporte y entrega de mercancías según las instrucciones
              y programación que el Empleador determine.
            </Clausula>

            <Clausula n="2" titulo="Remuneración">
              El Empleador pagará al Trabajador la siguiente remuneración mensual:
              <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 overflow-hidden">
                <div className="px-4 py-2 bg-blue-100 border-b border-blue-200">
                  <p className="text-xs font-semibold text-blue-800 uppercase tracking-wide">Detalle de remuneración</p>
                </div>
                <div className="divide-y divide-blue-100">
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-sm text-gray-700">Sueldo base</span>
                    <span className="text-sm font-bold text-gray-900">{info ? fmtClp(info.sueldo_base || info.sueldo_bruto) : '—'}</span>
                  </div>
                  {info?.gratificacion > 0 && (
                    <div className="flex items-center justify-between px-4 py-2.5">
                      <span className="text-sm text-gray-700">Gratificación (Art. 50 CT)</span>
                      <span className="text-sm font-bold text-gray-900">{fmtClp(info.gratificacion)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-sm text-gray-700">Movilización (no imponible)</span>
                    <span className="text-sm font-bold text-gray-900">{info ? fmtClp(info.movilizacion) : '—'}</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-sm text-gray-700">Colación (no imponible)</span>
                    <span className="text-sm font-bold text-gray-900">{info ? fmtClp(info.colacion) : '—'}</span>
                  </div>
                  {info?.viaticos > 0 && (
                    <div className="flex items-center justify-between px-4 py-2.5">
                      <span className="text-sm text-gray-700">Viáticos (no imponible)</span>
                      <span className="text-sm font-bold text-gray-900">{fmtClp(info.viaticos)}</span>
                    </div>
                  )}
                </div>
              </div>
            </Clausula>

            <Clausula n="3" titulo="Gratificación">
              El Empleador pagará al Trabajador una gratificación equivalente al <strong>25% del sueldo base mensual</strong>,
              con tope de 4,75 ingresos mínimos mensuales, conforme al artículo 50 del Código del Trabajo.
            </Clausula>

            <Clausula n="4" titulo="Previsión">
              Las cotizaciones previsionales se descontarán conforme a la ley:
              <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 overflow-hidden">
                <div className="divide-y divide-gray-100">
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-sm text-gray-700">AFP</span>
                    <span className="text-sm font-bold text-gray-900">{info?.afp || '—'}</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-sm text-gray-700">Sistema de salud</span>
                    <span className="text-sm font-bold text-gray-900">{info?.sistema_salud || '—'}</span>
                  </div>
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-sm text-gray-700">Cotización de salud</span>
                    <span className="text-sm font-bold text-gray-900">{info?.monto_cotizacion_salud || '7%'}</span>
                  </div>
                </div>
              </div>
            </Clausula>

            <Clausula n="5" titulo="Jornada de Trabajo">
              La jornada ordinaria de trabajo será de <strong>{info?.jornada_semanal_horas || '—'} horas semanales</strong>
              {info?.distribucion_jornada && (
                <>, distribuidas <strong>{distribucionLabel(info.distribucion_jornada)}</strong></>
              )}
              , con posibilidad de promediarse en ciclos de hasta cuatro semanas conforme al artículo 22 bis
              del Código del Trabajo.
            </Clausula>

            <Clausula n="6" titulo="Tipo de Contrato">
              El presente contrato es de tipo <strong>{info ? tipoContratoLabel(info.tipo_contrato) : '—'}</strong>.
              {info?.tipo_contrato === 'PLAZO_FIJO' && (
                <span> El plazo y condiciones de renovación se regirán por las disposiciones del Código del Trabajo.</span>
              )}
            </Clausula>

            <Clausula n="7" titulo="Vigencia">
              El presente contrato rige a partir del <strong>{info?.fecha_ingreso || '[fecha de ingreso]'}</strong>.
            </Clausula>

            <Clausula n="8" titulo="Obligaciones del Trabajador">
              El Trabajador se compromete a cumplir las instrucciones del Empleador, respetar las normas de tránsito,
              mantener la documentación del vehículo al día, manipular la carga con cuidado, y mantener trato respetuoso
              y profesional con los destinatarios. Deberá guardar confidencialidad sobre datos de clientes, rutas,
              tarifas, procesos operativos y estrategias comerciales.
            </Clausula>

            <Clausula n="9" titulo="Terminación">
              El contrato podrá terminar por las causales establecidas en el Código del Trabajo, incluyendo:
              renuncia voluntaria, mutuo acuerdo, necesidades de la empresa, caso fortuito o fuerza mayor,
              o incumplimiento grave de las obligaciones contractuales.
            </Clausula>

            <Clausula n="10" titulo="Ley Aplicable">
              Este contrato se rige por las disposiciones del <strong>Código del Trabajo</strong> y demás
              normativa laboral vigente en la República de Chile. Las controversias serán sometidas a la
              jurisdicción de los Tribunales del Trabajo competentes.
            </Clausula>

            <Clausula n="11" titulo="Aceptación Digital">
              Este contrato se acepta de forma electrónica a través de la plataforma de Ecourier, en conformidad con la
              <strong> Ley N° 19.799 sobre Documentos Electrónicos, Firma Electrónica y Servicios de Certificación</strong>.
              <br /><br />
              La aceptación se formaliza mediante el ingreso del <strong>nombre completo</strong>, <strong>RUT</strong>,
              <strong> firma dibujada digitalmente</strong> y <strong>fotografía de cédula de identidad</strong> (anverso y reverso) del
              Trabajador, quedando registrados en el sistema junto con fecha, hora, versión del documento y dirección IP.
            </Clausula>

            <div className="mt-4 p-3 bg-gray-50 rounded-lg text-xs text-gray-500 text-center">
              Versión {CONTRATO_VERSION} · Logística y Transporte E-Courier SpA · RUT 77.512.163-7
            </div>
          </div>

          {!scrolledToBottom && (
            <div className="px-4 py-2 bg-amber-50 border-t border-amber-100 text-xs text-amber-700 flex items-center gap-2">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              Desplázate hacia abajo para leer el contrato completo
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5">

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={leido}
              onChange={e => setLeido(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-600"
            />
            <span className="text-sm text-gray-700">
              He leído y comprendido íntegramente el Contrato de Trabajo.
              Ante cualquier duda, me pondré en contacto con Ecourier antes de aceptar.
            </span>
          </label>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nombre completo (tal como aparece en tu cédula)</label>
            <input
              type="text"
              value={nombreCompleto}
              onChange={e => setNombreCompleto(e.target.value)}
              placeholder="Ej: Juan Carlos Pérez González"
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-600 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tu RUT</label>
            <input
              type="text"
              value={rut}
              onChange={e => setRut(formatRut(e.target.value))}
              placeholder="12.345.678-9"
              maxLength={12}
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-600 focus:border-transparent"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <PhotoUpload label="Cédula — Anverso (frente)" value={carnetFrontal} onChange={setCarnetFrontal} />
            <PhotoUpload label="Cédula — Reverso (atrás)" value={carnetTrasero} onChange={setCarnetTrasero} />
          </div>

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
                ? 'bg-orange-600 text-white hover:bg-orange-700 active:scale-95'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            {loading ? 'Registrando aceptación...' : 'Aceptar y acceder al portal'}
          </button>

          <p className="text-xs text-gray-400 text-center">
            Al aceptar, se registrará tu nombre completo, RUT, firma, fotos de cédula, fecha y dirección IP
            en conformidad con la Ley N° 19.799.
          </p>
        </div>

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
      <div className="text-gray-600">{children}</div>
    </div>
  )
}
