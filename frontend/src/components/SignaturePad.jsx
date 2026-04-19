import { useRef, useState, useEffect, useCallback } from 'react'
import { RotateCcw } from 'lucide-react'

/**
 * Pad de firma reutilizable. Devuelve la firma como data URL PNG vía `onChange`.
 * Soporta mouse y touch; mantiene el contenido al redimensionar.
 *
 * Props:
 *  - onChange(dataUrl|null)  callback con la firma actual
 *  - height                   alto del canvas (default 160)
 *  - placeholder              texto cuando está vacío (default "Firma aquí")
 */
export default function SignaturePad({ onChange, height = 160, placeholder = 'Firma aquí' }) {
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const [hasSignature, setHasSignature] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
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
    onChange?.(canvas.toDataURL('image/png'))
  }, [onChange])

  const stopDraw = () => { drawing.current = false }

  const clear = () => {
    const canvas = canvasRef.current
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
    setHasSignature(false)
    onChange?.(null)
  }

  return (
    <div className="relative">
      <div
        className="relative rounded-xl border-2 border-dashed border-gray-300 bg-white overflow-hidden"
        style={{ height }}
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
            <span className="text-gray-300 text-sm select-none">{placeholder}</span>
          </div>
        )}
      </div>
      {hasSignature && (
        <button
          type="button"
          onClick={clear}
          className="absolute top-2 right-2 p-1.5 rounded-lg bg-white border border-gray-200 text-gray-500 hover:text-red-500 hover:border-red-300 transition-colors"
        >
          <RotateCcw size={14} />
        </button>
      )}
    </div>
  )
}
