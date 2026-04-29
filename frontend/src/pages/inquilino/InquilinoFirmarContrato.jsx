import { useRef, useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../../api'
import { ChevronDown, CheckCircle } from 'lucide-react'

// ── Renderizador simple de markdown ──────────────────────────────────────────
function renderMd(text) {
  if (!text) return []
  return text.split('\n\n').map((block, i) => {
    const b = block.trim()
    if (!b || b.startsWith('<!--')) return null
    if (b.startsWith('### ')) return { type: 'h3', text: b.slice(4), key: i }
    if (b.startsWith('## '))  return { type: 'h2', text: b.slice(3), key: i }
    if (b.startsWith('# '))   return { type: 'h1', text: b.slice(2), key: i }
    return { type: 'p', text: b, key: i }
  }).filter(Boolean)
}

function InlineText({ text }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**')
          ? <strong key={i}>{p.slice(2, -2)}</strong>
          : <span key={i}>{p}</span>
      )}
    </>
  )
}

function ContratoContent({ markdown }) {
  const blocks = renderMd(markdown)
  return (
    <div className="text-sm text-gray-700 leading-relaxed space-y-3">
      {blocks.map(b => {
        if (b.type === 'h1') return (
          <p key={b.key} className="text-center font-bold text-gray-900 text-base uppercase tracking-wide mt-2">
            <InlineText text={b.text} />
          </p>
        )
        if (b.type === 'h2') return (
          <p key={b.key} className="font-semibold text-gray-900 mt-4 border-b border-gray-100 pb-1">
            <InlineText text={b.text} />
          </p>
        )
        if (b.type === 'h3') return (
          <p key={b.key} className="font-semibold text-gray-700 mt-3">
            <InlineText text={b.text} />
          </p>
        )
        return (
          <p key={b.key} className="text-gray-600">
            {b.text.split('\n').map((line, j) => (
              <span key={j}>{j > 0 && <br />}<InlineText text={line} /></span>
            ))}
          </p>
        )
      })}
    </div>
  )
}

// ── Pad de firma ──────────────────────────────────────────────────────────────
function SignaturePad({ onChange }) {
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const [hasSignature, setHasSignature] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    canvas.width = canvas.offsetWidth
    canvas.height = canvas.offsetHeight
    const resize = () => {
      const ctx = canvas.getContext('2d')
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
      canvas.width = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
      ctx.putImageData(data, 0, 0)
    }
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  const getPos = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const src = e.touches ? e.touches[0] : e
    return {
      x: (src.clientX - rect.left) * (canvas.width / rect.width),
      y: (src.clientY - rect.top) * (canvas.height / rect.height),
    }
  }

  const startDraw = (e) => {
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    const pos = getPos(e)
    ctx.beginPath(); ctx.moveTo(pos.x, pos.y)
    drawing.current = true
  }

  const draw = useCallback((e) => {
    e.preventDefault()
    if (!drawing.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const pos = getPos(e)
    ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.strokeStyle = '#111827'
    ctx.lineTo(pos.x, pos.y); ctx.stroke()
    setHasSignature(true)
    onChange(canvas.toDataURL('image/png'))
  }, [onChange])

  const stopDraw = () => { drawing.current = false }

  const clear = () => {
    canvasRef.current.getContext('2d').clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
    setHasSignature(false)
    onChange(null)
  }

  return (
    <div className="relative rounded-xl border-2 border-dashed border-gray-300 bg-white overflow-hidden" style={{ height: 160 }}>
      <canvas ref={canvasRef} className="w-full h-full touch-none cursor-crosshair"
        onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
        onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={stopDraw} />
      {!hasSignature && (
        <span className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm pointer-events-none select-none">
          Dibuja tu firma aquí con el dedo o el mouse
        </span>
      )}
      {hasSignature && (
        <button type="button" onClick={clear}
          className="absolute top-2 right-2 text-xs text-gray-400 hover:text-red-500 bg-white/80 rounded px-2 py-1">
          Borrar
        </button>
      )}
    </div>
  )
}

function formatRut(v) {
  const c = v.replace(/[^0-9kK]/g, '').toUpperCase()
  if (c.length <= 1) return c
  const body = c.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${body}-${c.slice(-1)}`
}
const normRut = (v) => String(v || '').replace(/[^0-9kK]/g, '').toUpperCase()
const normNombre = (v) => String(v || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

// ── Página principal ──────────────────────────────────────────────────────────
export default function InquilinoFirmarContrato() {
  const { anexoId } = useParams()
  const navigate = useNavigate()

  const [contrato, setContrato] = useState(null)
  const [loadingData, setLoadingData] = useState(true)
  const [errorData, setErrorData] = useState(null)

  const [leido, setLeido] = useState(false)
  const [scrolledToBottom, setScrolledToBottom] = useState(false)
  const [nombre, setNombre] = useState('')
  const [rut, setRut] = useState('')
  const [firma, setFirma] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const scrollRef = useRef(null)

  useEffect(() => {
    api.get(`/inquilinos/portal/contratos/${anexoId}/contenido`)
      .then(r => setContrato(r.data))
      .catch(err => setErrorData(err?.response?.data?.detail || 'No se pudo cargar el documento'))
      .finally(() => setLoadingData(false))
  }, [anexoId])

  const handleScroll = () => {
    const el = scrollRef.current
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 30) setScrolledToBottom(true)
  }

  const nombreContrato = contrato?.inquilino?.nombre_rep_legal || ''
  const rutContrato = contrato?.inquilino?.rut_rep_legal || ''
  const coincideNombre = nombreContrato && nombre.trim()
    ? normNombre(nombre) === normNombre(nombreContrato) : false
  const coincideRut = rutContrato && rut
    ? normRut(rut) === normRut(rutContrato) : false

  const yaFirmado = contrato?.estado === 'FIRMADO'
  const canSubmit = !yaFirmado && leido && coincideNombre && coincideRut && !!firma && !loading

  const handleFirmar = async () => {
    if (!canSubmit) return
    setLoading(true)
    setError(null)
    try {
      await api.post(`/inquilinos/portal/contratos/${anexoId}/firmar`, { firma_base64: firma })
      navigate('/inquilino/contratos', { replace: true })
    } catch (e) {
      setError(e?.response?.data?.detail || 'Error al firmar el documento')
    } finally {
      setLoading(false)
    }
  }

  if (loadingData) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full" />
    </div>
  )

  if (errorData) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-red-50 border border-red-200 rounded-2xl p-6 max-w-md text-center">
        <p className="text-red-700 font-semibold">Error al cargar el documento</p>
        <p className="text-sm text-red-500 mt-1">{errorData}</p>
        <button onClick={() => navigate('/inquilino/contratos')}
          className="mt-4 text-sm text-blue-600 underline">Volver a Contratos</button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-8 px-4">
      <div className="w-full max-w-2xl">

        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
               style={{ background: 'linear-gradient(135deg,#1e3a5f,#1d4ed8)' }}>
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900">
            {contrato?.tipo === 'RESERVA' ? 'Anexo de Reserva' : 'Contrato de Licencia de Software'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {yaFirmado ? '✓ Documento firmado' : 'Lee el documento completo antes de firmar'}
          </p>
        </div>

        {/* Contenido del contrato */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-5">
          <div ref={scrollRef} onScroll={handleScroll}
            className="overflow-y-auto p-6" style={{ maxHeight: 440 }}>
            <ContratoContent markdown={contrato?.contenido_renderizado} />
          </div>

          {!scrolledToBottom && !yaFirmado && (
            <div className="px-4 py-2.5 bg-amber-50 border-t border-amber-100 text-xs text-amber-700 flex items-center gap-2">
              <ChevronDown size={15} className="flex-shrink-0" />
              Desplázate hacia abajo para leer el documento completo
            </div>
          )}
        </div>

        {/* Formulario de firma */}
        {!yaFirmado ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5">

            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={leido} onChange={e => setLeido(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-900 focus:ring-blue-800" />
              <span className="text-sm text-gray-700">
                He leído y comprendido íntegramente el {contrato?.tipo === 'RESERVA' ? 'Anexo de Reserva' : 'Contrato de Licencia de Software'}.
                Ante cualquier duda me pondré en contacto con E-Courier antes de aceptar.
              </span>
            </label>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Nombre del Representante Legal (tal como aparece en el contrato)
              </label>
              <input type="text" value={nombre} onChange={e => setNombre(e.target.value)}
                placeholder={nombreContrato || 'Nombre completo'}
                className={`w-full rounded-xl border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:border-transparent ${
                  !nombre.trim() ? 'border-gray-200 focus:ring-blue-500'
                  : coincideNombre ? 'border-emerald-400 focus:ring-emerald-500 bg-emerald-50/40'
                  : 'border-red-400 focus:ring-red-500 bg-red-50/40'
                }`} />
              {nombre.trim() && !coincideNombre && nombreContrato && (
                <p className="text-xs text-red-600 mt-1">No coincide con el nombre registrado en el contrato</p>
              )}
              {coincideNombre && <p className="text-xs text-emerald-600 mt-1">✓ Coincide con el contrato</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">RUT del Representante Legal</label>
              <input type="text" value={rut} onChange={e => setRut(formatRut(e.target.value))}
                placeholder={rutContrato || '12.345.678-9'} maxLength={12}
                className={`w-full rounded-xl border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:border-transparent ${
                  !rut ? 'border-gray-200 focus:ring-blue-500'
                  : coincideRut ? 'border-emerald-400 focus:ring-emerald-500 bg-emerald-50/40'
                  : 'border-red-400 focus:ring-red-500 bg-red-50/40'
                }`} />
              {rut && !coincideRut && rutContrato && (
                <p className="text-xs text-red-600 mt-1">No coincide con el RUT registrado en el contrato</p>
              )}
              {coincideRut && <p className="text-xs text-emerald-600 mt-1">✓ Coincide con el contrato</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Firma del Representante Legal</label>
              <SignaturePad onChange={setFirma} />
            </div>

            {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">{error}</p>}

            <button type="button" onClick={handleFirmar} disabled={!canSubmit}
              className={`w-full rounded-xl py-3.5 text-sm font-semibold transition-all ${
                canSubmit
                  ? 'text-white active:scale-95'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
              style={canSubmit ? { background: 'linear-gradient(135deg,#1e3a5f,#1d4ed8)' } : {}}>
              {loading ? 'Registrando firma…' : 'Firmar y aceptar el documento'}
            </button>

            <p className="text-xs text-gray-400 text-center">
              Al firmar se registrará tu nombre, RUT, firma, fecha y dirección IP en conformidad con la
              Ley N° 19.799 sobre Documentos Electrónicos y Firma Electrónica.
            </p>
          </div>
        ) : (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center">
            <CheckCircle size={40} className="text-emerald-500 mx-auto mb-2" />
            <p className="font-semibold text-emerald-800">Documento firmado</p>
            <p className="text-sm text-emerald-600 mt-1">
              Firmado el {contrato?.firmado_at
                ? new Date(contrato.firmado_at).toLocaleDateString('es-CL', { day:'2-digit', month:'long', year:'numeric' })
                : '—'}
            </p>
          </div>
        )}

        <div className="text-center mt-5">
          <button onClick={() => navigate('/inquilino/contratos')}
            className="text-sm text-gray-400 hover:text-gray-600">
            ← Volver a Contratos
          </button>
        </div>

      </div>
    </div>
  )
}
