import { useRef, useState, useEffect, useCallback } from 'react'
import api from '../../api'
import PageHeader from '../../components/PageHeader'
import { PenLine, CheckCircle, RotateCcw, Save } from 'lucide-react'

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
      y: (src.clientY - rect.top)  * (canvas.height / rect.height),
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
    setHasSignature(true)
    onChange(canvas.toDataURL('image/png'))
  }, [onChange])

  const stopDraw = () => { drawing.current = false }

  const clear = () => {
    const canvas = canvasRef.current
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
    setHasSignature(false)
    onChange(null)
  }

  return (
    <div className="relative">
      <div
        className="relative rounded-xl border-2 border-dashed border-gray-300 bg-white overflow-hidden"
        style={{ height: 160 }}
      >
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
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-gray-300 text-sm select-none">Firma aquí</span>
          </div>
        )}
      </div>
      {hasSignature && (
        <button
          onClick={clear}
          className="absolute top-2 right-2 p-1.5 rounded-lg bg-white border border-gray-200 text-gray-500 hover:text-red-500 hover:border-red-300 transition-colors"
        >
          <RotateCcw size={14} />
        </button>
      )}
    </div>
  )
}

export default function TrabajadorFirma() {
  const [firma, setFirma] = useState(null)
  const [firmaActual, setFirmaActual] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [ok, setOk] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.get('/remuneraciones/portal/perfil')
      .then(r => {
        if (r.data.tiene_firma) setFirmaActual(true)
      })
      .catch(() => {})
  }, [])

  const handleGuardar = async () => {
    if (!firma) return
    setGuardando(true)
    setError(null)
    try {
      await api.put('/remuneraciones/portal/firma', { firma_base64: firma })
      setOk(true)
      setFirmaActual(true)
    } catch {
      setError('No se pudo guardar la firma. Intenta nuevamente.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-lg mx-auto">
      <PageHeader
        title="Mi Firma"
        subtitle="Tu firma digital se usará en tus liquidaciones de sueldo"
        icon={PenLine}
      />

      {firmaActual && !ok && (
        <div className="mb-5 flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700">
          <CheckCircle size={16} />
          Ya tienes una firma registrada. Dibuja una nueva para actualizarla.
        </div>
      )}

      {ok && (
        <div className="mb-5 flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700">
          <CheckCircle size={16} />
          ¡Firma guardada correctamente! Aparecerá en tus próximas liquidaciones.
        </div>
      )}

      {error && (
        <div className="mb-5 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <p className="text-sm text-gray-500 mb-4">
          Dibuja tu firma con el dedo o el mouse dentro del recuadro. Una vez lista, presiona <strong>Guardar firma</strong>.
        </p>

        <SignaturePad onChange={setFirma} />

        <button
          onClick={handleGuardar}
          disabled={!firma || guardando}
          className="mt-4 w-full flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-3 rounded-xl transition-colors"
        >
          <Save size={16} />
          {guardando ? 'Guardando…' : 'Guardar firma'}
        </button>
      </div>

      <p className="mt-4 text-xs text-gray-400 text-center">
        Tu firma se almacena de forma segura y se imprime en tus liquidaciones de sueldo como constancia de conformidad.
      </p>
    </div>
  )
}
