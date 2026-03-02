import { useState, useRef, useEffect } from 'react'
import api from '../../api'
import { Bot, Send, User, Trash2, Loader2, Zap, ChevronDown } from 'lucide-react'

const SUGERENCIAS = [
  '¿Cuántos envíos hubo en febrero 2026?',
  '¿Qué driver tuvo más entregas en la semana 4 de febrero?',
  '¿Cuál es la rentabilidad por seller este mes?',
  'Dame el detalle de liquidación de Toyotomi, semana 4, febrero 2026',
  '¿Cómo está la facturación de febrero 2026?',
  'Muéstrame el ranking de drivers de febrero 2026',
]

function MarkdownText({ text }) {
  const html = text
    // bloques de código
    .replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre class="bg-gray-100 rounded p-3 my-2 text-xs overflow-x-auto font-mono">$1</pre>')
    // código inline
    .replace(/`([^`]+)`/g, '<code class="bg-gray-100 px-1 rounded text-xs font-mono">$1</code>')
    // negrita
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // encabezados
    .replace(/^### (.+)$/gm, '<h3 class="font-bold text-sm mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="font-bold text-base mt-3 mb-1">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="font-bold text-lg mt-3 mb-1">$1</h1>')
    // tablas markdown
    .replace(/\|(.+)\|/g, (match) => {
      const cells = match.split('|').filter(c => c.trim() && !c.match(/^[-:\s]+$/))
      if (!cells.length) return match
      return '<tr>' + cells.map(c =>
        `<td class="border border-gray-200 px-3 py-1.5 text-xs">${c.trim()}</td>`
      ).join('') + '</tr>'
    })
    // listas
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc text-sm">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 list-decimal text-sm">$2</li>')
    // saltos de línea
    .replace(/\n/g, '<br/>')

  // envolver filas de tabla
  const withTable = html.replace(
    /(<tr>.*?<\/tr>)+/gs,
    (match) =>
      `<div class="overflow-x-auto my-2"><table class="border-collapse border border-gray-200 text-xs w-full">${match}</table></div>`
  )

  return (
    <div
      className="prose-sm leading-relaxed"
      dangerouslySetInnerHTML={{ __html: withTable }}
    />
  )
}

function Burbuja({ msg }) {
  const esUsuario = msg.role === 'user'
  return (
    <div className={`flex gap-3 ${esUsuario ? 'flex-row-reverse' : ''}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
        esUsuario ? 'bg-primary-600' : 'bg-gradient-to-br from-purple-500 to-indigo-600'
      }`}>
        {esUsuario ? <User size={14} className="text-white" /> : <Bot size={14} className="text-white" />}
      </div>
      <div className={`max-w-[80%] ${esUsuario ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        <div className={`rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
          esUsuario
            ? 'bg-primary-600 text-white rounded-tr-sm'
            : 'bg-white border border-gray-200 text-gray-800 rounded-tl-sm'
        }`}>
          {esUsuario
            ? <p>{msg.content}</p>
            : <MarkdownText text={msg.content} />
          }
        </div>
        {msg.tools_usadas?.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {msg.tools_usadas.map(t => (
              <span key={t} className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                <Zap size={8} /> {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shrink-0">
        <Bot size={14} className="text-white" />
      </div>
      <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  )
}

export default function Asistente() {
  const [mensajes, setMensajes] = useState([
    {
      role: 'model',
      content: '¡Hola! Soy el Asistente IA de ECourier. Puedo consultarte datos reales del sistema: envíos, liquidaciones, facturación, ranking de drivers y más.\n\n¿Qué necesitas saber hoy?',
    },
  ])
  const [input, setInput] = useState('')
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(null)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensajes, cargando])

  const enviar = async (texto = input.trim()) => {
    if (!texto || cargando) return
    setError(null)
    setInput('')

    const nuevoUsuario = { role: 'user', content: texto }
    const historialActual = [...mensajes, nuevoUsuario]
    setMensajes(historialActual)
    setCargando(true)

    try {
      const historialApi = historialActual
        .slice(0, -1)
        .filter(m => m.role === 'user' || m.role === 'model')
        .map(m => ({ role: m.role, content: m.content }))

      const { data } = await api.post('/chat/mensaje', {
        mensaje: texto,
        historial: historialApi,
      })

      setMensajes(prev => [
        ...prev,
        { role: 'model', content: data.respuesta, tools_usadas: data.tools_usadas },
      ])
    } catch (err) {
      const msg = err.response?.data?.detail || 'Error al conectar con el asistente.'
      setError(msg)
      setMensajes(prev => [
        ...prev,
        { role: 'model', content: `⚠️ ${msg}` },
      ])
    } finally {
      setCargando(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  const limpiar = () => {
    setMensajes([{
      role: 'model',
      content: '¡Conversación reiniciada! ¿En qué puedo ayudarte?',
    }])
    setError(null)
    setInput('')
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      enviar()
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-md">
            <Bot size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Asistente IA</h1>
            <p className="text-xs text-gray-500">Powered by Gemini · Datos en tiempo real</p>
          </div>
        </div>
        <button
          onClick={limpiar}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-red-500 transition-colors"
        >
          <Trash2 size={14} /> Limpiar
        </button>
      </div>

      {/* Área de mensajes */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4 pr-1">
        {mensajes.map((m, i) => (
          <Burbuja key={i} msg={m} />
        ))}
        {cargando && <Skeleton />}
        <div ref={bottomRef} />
      </div>

      {/* Sugerencias (solo si no hay conversación) */}
      {mensajes.length === 1 && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          {SUGERENCIAS.map((s, i) => (
            <button
              key={i}
              onClick={() => enviar(s)}
              className="text-left text-xs bg-white border border-gray-200 rounded-xl px-3 py-2 text-gray-600 hover:border-primary-400 hover:text-primary-700 hover:bg-primary-50 transition-all"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-2 flex items-end gap-2">
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            e.target.style.height = 'auto'
            e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
          }}
          onKeyDown={handleKey}
          placeholder="Pregunta algo al asistente… (Enter para enviar)"
          className="flex-1 resize-none bg-transparent text-sm text-gray-800 placeholder-gray-400 focus:outline-none px-2 py-1.5"
          style={{ maxHeight: '120px' }}
          disabled={cargando}
        />
        <button
          onClick={() => enviar()}
          disabled={!input.trim() || cargando}
          className="w-9 h-9 rounded-xl bg-primary-600 flex items-center justify-center hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
        >
          {cargando
            ? <Loader2 size={16} className="text-white animate-spin" />
            : <Send size={16} className="text-white" />
          }
        </button>
      </div>
      <p className="text-center text-[10px] text-gray-400 mt-1.5">
        Solo usuarios Admin y Administración · Los datos provienen directamente de la BD
      </p>
    </div>
  )
}
