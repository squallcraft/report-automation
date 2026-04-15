import { useRef, useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api'
import { useAuth } from '../../context/AuthContext'
import { Camera, X } from 'lucide-react'

const ACUERDO_VERSION = '2.0'

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

const fmtClp = (n) => (n ?? 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP' })

export default function AcuerdoAceptacion() {
  const navigate = useNavigate()
  const { user, updateUser } = useAuth()
  const [nombreCompleto, setNombreCompleto] = useState('')
  const [rut, setRut] = useState('')
  const [firma, setFirma] = useState(null)
  const [carnetFrontal, setCarnetFrontal] = useState(null)
  const [carnetTrasero, setCarnetTrasero] = useState(null)
  const [leido, setLeido] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [tarifas, setTarifas] = useState(null)
  const scrollRef = useRef(null)
  const [scrolledToBottom, setScrolledToBottom] = useState(false)

  useEffect(() => {
    api.get('/drivers/me/acuerdo-tarifas').then(r => setTarifas(r.data)).catch(() => {})
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
      const { data } = await api.post('/drivers/me/acuerdo', {
        nombre_completo: nombreCompleto.trim(),
        rut,
        firma_base64: firma,
        carnet_frontal: carnetFrontal,
        carnet_trasero: carnetTrasero,
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
          <h1 className="text-xl font-bold text-gray-900">Acuerdo de Prestación de Servicios</h1>
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
            <p className="text-center text-gray-500 mb-6">Ecourier — Prestador de Servicios · Versión {ACUERDO_VERSION}</p>

            <p className="mb-4">
              En Santiago, entre <strong>LOGÍSTICA Y TRANSPORTE E-COURIER SpA</strong>, RUT N° 77.512.163-7, con domicilio en
              Moneda N°1137, Oficina 56, comuna de Santiago, en adelante "Ecourier"; y el Prestador individualizado al momento de
              la aceptación digital del presente instrumento, en adelante el "Prestador", se ha convenido el siguiente Acuerdo de
              Prestación de Servicios Independientes:
            </p>

            <Clausula n="1" titulo="Naturaleza del Acuerdo">
              Las partes declaran expresa y categóricamente que el presente acuerdo tiene carácter <strong>estrictamente civil y
              comercial</strong>, rigiéndose por las disposiciones del Código Civil y demás normativa aplicable.
              No existe entre ellas vínculo de subordinación ni dependencia, ni relación laboral en los términos del Código del Trabajo,
              por cuanto el Prestador ejecuta sus servicios de manera autónoma, por cuenta propia, bajo su exclusivo riesgo y responsabilidad.
              El Prestador <strong>no forma parte de la estructura organizacional</strong> de Ecourier, no estando sujeto a jerarquía,
              dependencia ni integración funcional dentro de la empresa.
            </Clausula>

            <Clausula n="2" titulo="Objeto de los Servicios">
              El presente acuerdo tiene por objeto la prestación de servicios de retiro, transporte y entrega de mercancías por parte
              del Prestador, quien utilizará para ello sus propios medios materiales, incluyendo vehículo, combustible, dispositivos
              tecnológicos y demás herramientas necesarias. Cada servicio encomendado constituirá una prestación independiente, que deberá
              ser previamente aceptada por el Prestador en forma libre y voluntaria.
              <br /><br />
              Este Acuerdo es de <strong>duración indefinida</strong> y puede ser terminado en cualquier momento por cualquiera de las
              partes conforme a lo establecido en la cláusula de Terminación.
            </Clausula>

            <Clausula n="3" titulo="Autonomía, Libertad Operativa y Zona Geográfica">
              El Prestador gozará de plena autonomía en la organización y ejecución de sus servicios, pudiendo determinar libremente su
              disponibilidad, horarios, días de trabajo y forma de prestación. Podrá <strong>aceptar o rechazar cualquier servicio sin
              expresión de causa</strong>, sin que ello implique sanción, penalización ni afectación alguna. No existe cláusula de exclusividad;
              el Prestador puede prestar servicios a terceros sin restricción.
              <br /><br />
              El Prestador podrá ejecutar servicios en las zonas geográficas donde Ecourier mantenga operaciones. La sugerencia de zonas,
              rutas o áreas de operación tendrá carácter meramente referencial, no constituyendo una instrucción obligatoria.
              El Prestador es responsable de evaluar las condiciones de seguridad, distancia y conveniencia de cada servicio.
            </Clausula>

            <Clausula n="4" titulo="Uso de la Plataforma Digital — Acceso Personal e Intransferible">
              La plataforma digital de Ecourier constituye únicamente una herramienta tecnológica destinada a facilitar la coordinación,
              registro y trazabilidad de los servicios. Su utilización <strong>no implica el ejercicio de facultades de dirección, control
              laboral o supervisión jerárquica</strong> por parte de Ecourier. No es un sistema de intermediación en tiempo real y no
              determina la disponibilidad ni los ingresos del Prestador.
              <br /><br />
              Las credenciales de acceso son <strong>estrictamente personales e intransferibles</strong>. Queda prohibido cederlas, compartirlas
              o permitir su uso a terceros. Toda actividad registrada bajo las credenciales del Prestador es de su exclusiva responsabilidad.
              El incumplimiento es causal de término inmediato.
            </Clausula>

            <Clausula n="5" titulo="Coordinación Operativa">
              Las comunicaciones y coordinaciones tendrán carácter estrictamente colaborativo. Las sugerencias o recomendaciones de Ecourier
              tendrán naturaleza referencial y no obligatoria, no constituyendo instrucciones laborales.
              <br /><br />
              Se valora que el Prestador informe con anticipación cuando no esté disponible: ausencias de un día con 12 horas; varios
              días con 15 días; en períodos de alta demanda (Navidad, CyberDay, Black Friday, Fiestas Patrias) con <strong>30 días</strong>.
              Las emergencias siempre son consideradas. La falta de aviso no genera penalización, pero puede afectar la asignación futura.
            </Clausula>

            <Clausula n="6" titulo="Estándares de Calidad del Servicio">
              El Prestador ejecutará los servicios en forma diligente conforme a los estándares de calidad y buenas prácticas de la actividad.
              Se compromete a: manipular la carga con cuidado y verificarla al recibirla; no abrir ni alterar empaques; mantener trato
              respetuoso y profesional con los destinatarios; respetar normas de tránsito y mantener documentación del vehículo al día;
              usar canales oficiales de comunicación; y abstenerse de negociaciones paralelas con clientes o solicitar datos personales.
              <br /><br />
              El incumplimiento grave o reiterado puede ser causal de término de la colaboración conforme a la cláusula de Incumplimientos.
            </Clausula>

            <Clausula n="7" titulo="Régimen de Incumplimientos">
              <strong>Clasificación:</strong>
              <br />
              <strong>a)</strong> <em>Incumplimientos leves:</em> Aquellos que no afecten sustancialmente la ejecución del servicio (retrasos menores,
              omisiones formales, errores subsanables sin perjuicio económico relevante).
              <br />
              <strong>b)</strong> <em>Incumplimientos graves:</em> Aquellos que afecten la ejecución del servicio, la experiencia del cliente o la
              integridad de la carga, especialmente cuando generen perjuicio económico (entregas fallidas imputables, manipulación indebida,
              pérdida o daño de carga, infracciones relevantes).
              <br />
              <strong>c)</strong> <em>Incumplimientos reiterados:</em> Dos o más incumplimientos en un período de 30 días corridos. Constituyen
              causal suficiente para terminar el acuerdo.
              <br /><br />
              <strong>Medidas:</strong> Los leves generan amonestación escrita. Los graves, cuando generan perjuicio económico directo, obligan
              al Prestador a indemnizar el daño acreditado (dolo o culpa grave), pudiendo Ecourier compensar de pagos pendientes. Los reiterados
              facultan el término inmediato.
              <br /><br />
              <strong>Procedimiento:</strong> Previo a medidas económicas o término, Ecourier notificará al Prestador, otorgará 5 días hábiles
              para descargos y resolverá con decisión fundada. La responsabilidad económica se limita al daño directo con tope en el valor
              de la carga o servicio afectado, salvo dolo.
            </Clausula>

            <Clausula n="8" titulo="Responsabilidad y Riesgo">
              El Prestador actuará en todo momento por cuenta propia, respondiendo únicamente por daños consecuencia directa de su dolo o
              culpa grave debidamente acreditados. No responderá por caso fortuito, fuerza mayor o actos de terceros.
              <br /><br />
              La responsabilidad frente a Ecourier se limita a los daños directos ocasionados por incumplimientos graves, con tope en el valor
              del servicio o carga involucrada, salvo dolo. <strong>Ecourier no será responsable por los actos ejecutados por el Prestador
              en el ejercicio autónomo de su actividad.</strong>
            </Clausula>

            <Clausula n="9" titulo="Seguridad Personal y Protocolo de Robo">
              El Prestador prioriza en todo momento su <strong>integridad física</strong> por sobre la carga o cualquier otro objetivo.
              Se recomienda el uso de calzado de seguridad y chaleco reflectante.
              <br /><br />
              <strong>En caso de asalto o robo:</strong> no oponer resistencia; comunicar de inmediato a operaciones (ubicación, hora, detalles
              y estado); realizar denuncia en Carabineros dentro de 24 horas y enviar copia a Ecourier; completar formulario interno de incidente.
            </Clausula>

            <Clausula n="10" titulo="Responsabilidad por Infracciones de Tránsito">
              Toda multa, infracción o sanción de tránsito ocurrida durante la prestación de servicios es de <strong>exclusiva responsabilidad
              del Prestador</strong>, incluyendo aquellas derivadas del estado del vehículo, documentación vencida o conducta al volante.
              Ecourier no asume ninguna responsabilidad en esta materia.
            </Clausula>

            <Clausula n="11" titulo="Tarifas y Condiciones Económicas">
              Los servicios serán remunerados conforme a las tarifas vigentes al momento de la prestación.
              Ecourier podrá modificarlas con <strong>30 días de aviso previo</strong>; ante cualquier modificación
              se generará una nueva versión de este Acuerdo que el Prestador deberá aceptar para continuar operando.
              <br /><br />
              Las tarifas actualmente pactadas para el Prestador son las siguientes:

              {tarifas && Object.keys(tarifas).length > 0 ? (
                <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 overflow-hidden">
                  <div className="px-4 py-2 bg-blue-100 border-b border-blue-200">
                    <p className="text-xs font-semibold text-blue-800 uppercase tracking-wide">Tarifas vigentes — al momento de la firma</p>
                  </div>
                  <div className="divide-y divide-blue-100">
                    {Object.entries(tarifas).map(([concepto, valor]) => (
                      <div key={concepto} className="flex items-center justify-between px-4 py-2.5">
                        <span className="text-sm text-gray-700">{concepto}</span>
                        <span className="text-sm font-bold text-gray-900">{fmtClp(valor)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="px-4 py-2 bg-blue-50 border-t border-blue-100">
                    <p className="text-[11px] text-blue-600">Estos montos quedan registrados en este acuerdo al momento de su firma.</p>
                  </div>
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-400 text-center">
                  Cargando tarifas…
                </div>
              )}

              <br />
              No existe remuneración fija, continuidad asegurada ni garantía de ingresos mínimos. El Prestador deberá emitir
              <strong> boleta de honorarios o factura</strong> como requisito para el pago.
            </Clausula>

            {/* El bloque separado de tarifas ya no es necesario — está integrado en cláusula 11 */}

            <Clausula n="12" titulo="Protección de Datos Personales">
              En conformidad con la <strong>Ley N° 19.628</strong>, el Prestador usará los datos personales de destinatarios únicamente
              para fines de la entrega, no los almacenará fuera de la plataforma y no los compartirá con terceros.
              <br /><br />
              El Prestador autoriza expresamente a Ecourier para el tratamiento de sus datos personales (identificación, contacto, ubicación
              geográfica y registros operativos) con la finalidad de gestionar la relación contractual. El Prestador podrá ejercer sus
              derechos de acceso, rectificación, cancelación y oposición conforme a la normativa vigente.
            </Clausula>

            <Clausula n="13" titulo="Trazabilidad y Prueba">
              Las partes acuerdan que toda información relativa a la ejecución de los servicios, incluyendo registros en la plataforma,
              comunicaciones electrónicas y evidencia digital, constituirá <strong>medio válido de prueba</strong> para determinar el
              cumplimiento de las obligaciones.
            </Clausula>

            <Clausula n="14" titulo="Confidencialidad">
              El Prestador mantiene estricta confidencialidad sobre datos de clientes, rutas, tarifas, procesos operativos y estrategias
              comerciales durante la colaboración y por <strong>24 meses después de su término</strong>. Queda prohibido compartir esta
              información con terceros o utilizarla para beneficio propio o de competidores. El incumplimiento puede derivar en acciones legales.
            </Clausula>

            <Clausula n="15" titulo="Terminación">
              El presente acuerdo podrá ser terminado por cualquiera de las partes en cualquier momento, sin expresión de causa y
              <strong> sin derecho a indemnización</strong>, mediante comunicación simple por correo electrónico o canal oficial.
              <br /><br />
              Son causales de término inmediato por parte de Ecourier: incumplimientos graves o reiterados; faltas graves de conducta
              con clientes; pérdida de carga por negligencia; falsificación de información; uso indebido de datos personales;
              manipulación indebida de paquetes o cesión de credenciales a terceros.
            </Clausula>

            <Clausula n="16" titulo="Ley Aplicable y Resolución de Disputas">
              Este Acuerdo se rige por las leyes de la República de Chile. Las controversias serán sometidas a la jurisdicción de los
              <strong> Tribunales Ordinarios de Justicia de Santiago</strong>, renunciando las partes a cualquier otro fuero.
            </Clausula>

            <Clausula n="17" titulo="Modificaciones al Acuerdo">
              Ecourier podrá modificar los términos de este Acuerdo con <strong>30 días de aviso previo</strong>. Cualquier modificación,
              incluyendo cambios en las tarifas pactadas, generará una nueva versión del Acuerdo que el Prestador deberá aceptar
              expresamente para continuar prestando servicios.
            </Clausula>

            <Clausula n="18" titulo="Aceptación Digital">
              Este Acuerdo se acepta de forma electrónica a través de la plataforma de facturación de Ecourier, en conformidad con la
              <strong> Ley N° 19.799 sobre Documentos Electrónicos, Firma Electrónica y Servicios de Certificación</strong>.
              <br /><br />
              La aceptación se formaliza mediante el ingreso del <strong>nombre completo</strong>, <strong>RUT</strong>,
              <strong> firma dibujada digitalmente</strong> y <strong>fotografía de cédula de identidad</strong> (anverso y reverso) del
              Prestador, quedando registrados en el sistema junto con fecha, hora, versión del documento y dirección IP. Este registro
              tiene plena validez legal.
            </Clausula>

            <div className="mt-4 p-3 bg-gray-50 rounded-lg text-xs text-gray-500 text-center">
              Versión {ACUERDO_VERSION} · Logística y Transporte E-Courier SpA · RUT 77.512.163-7
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

          {/* Nombre completo */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nombre completo (tal como aparece en tu cédula)</label>
            <input
              type="text"
              value={nombreCompleto}
              onChange={e => setNombreCompleto(e.target.value)}
              placeholder="Ej: Juan Carlos Pérez González"
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            />
          </div>

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

          {/* Fotos carnet */}
          <div className="grid grid-cols-2 gap-4">
            <PhotoUpload label="Cédula — Anverso (frente)" value={carnetFrontal} onChange={setCarnetFrontal} />
            <PhotoUpload label="Cédula — Reverso (atrás)" value={carnetTrasero} onChange={setCarnetTrasero} />
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
            Al aceptar, se registrará tu nombre completo, RUT, firma, fotos de cédula, fecha y dirección IP
            en conformidad con la Ley N° 19.799.
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
      <div className="text-gray-600">{children}</div>
    </div>
  )
}
