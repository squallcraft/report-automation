import { useState, useEffect } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import { FileText, Download, PenLine, CheckCircle, Info, Clock, AlertCircle } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function TrabajadorAnexos() {
  const [anexos, setAnexos] = useState([])
  const [perfil, setPerfil] = useState(null)
  const [loading, setLoading] = useState(true)
  const [signing, setSigning] = useState(null)

  const cargar = async () => {
    setLoading(true)
    try {
      const [a, p] = await Promise.all([
        api.get('/contratos/portal/anexos'),
        api.get('/remuneraciones/portal/perfil'),
      ])
      setAnexos(a.data)
      setPerfil(p.data)
    } catch {
      toast.error('Error al cargar anexos')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { cargar() }, [])

  const verPdf = async (a) => {
    try {
      const { data } = await api.get(`/contratos/portal/anexos/${a.id}/pdf`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }))
      window.open(url, '_blank')
      // Refresh para marcar visto
      setTimeout(cargar, 500)
    } catch {
      toast.error('Error al abrir PDF')
    }
  }

  const firmar = async (a) => {
    if (!perfil?.tiene_firma) {
      toast.error('Primero registra tu firma en "Mi Firma"')
      return
    }
    setSigning(a.id)
    try {
      await api.post(`/contratos/portal/anexos/${a.id}/firmar`)
      toast.success('Anexo firmado correctamente')
      cargar()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al firmar')
    } finally {
      setSigning(null)
    }
  }

  const pendientes = anexos.filter(a => a.estado === 'EMITIDO' && a.requiere_firma_trabajador)
  const informativos = anexos.filter(a => a.estado === 'INFORMATIVO')
  const historial = anexos.filter(a => a.estado === 'FIRMADO')

  const estadoBadge = (e) => {
    const map = {
      EMITIDO: 'bg-amber-100 text-amber-800',
      INFORMATIVO: 'bg-blue-100 text-blue-800',
      FIRMADO: 'bg-emerald-100 text-emerald-800',
      RECHAZADO: 'bg-red-100 text-red-800',
    }
    return map[e] || 'bg-gray-200 text-gray-700'
  }

  return (
    <div className="px-4 py-5 max-w-3xl mx-auto space-y-5 pb-24">
      {/* Hero */}
      <div className="bg-gradient-to-br from-indigo-600 to-purple-700 rounded-2xl p-5 text-white">
        <div className="flex items-center gap-3 mb-3">
          <div className="bg-white/20 rounded-xl p-2">
            <FileText size={22} />
          </div>
          <div>
            <h1 className="text-lg font-bold">Mis Anexos</h1>
            <p className="text-xs text-indigo-100">Contrato y modificaciones</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center bg-white/10 rounded-xl p-3">
          <div>
            <div className="text-xl font-bold">{pendientes.length}</div>
            <div className="text-[10px] text-indigo-100 uppercase">Por firmar</div>
          </div>
          <div>
            <div className="text-xl font-bold">{informativos.length}</div>
            <div className="text-[10px] text-indigo-100 uppercase">Informativos</div>
          </div>
          <div>
            <div className="text-xl font-bold">{historial.length}</div>
            <div className="text-[10px] text-indigo-100 uppercase">Firmados</div>
          </div>
        </div>
      </div>

      {!perfil?.tiene_firma && pendientes.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle size={18} className="text-amber-600 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-900">Firma requerida</p>
            <p className="text-xs text-amber-800 mt-1">
              Para firmar tus anexos, primero registra tu firma digital en la sección <strong>"Mi Firma"</strong>.
            </p>
            <Link to="/trabajador/firma" className="inline-flex items-center gap-1 mt-2 text-xs font-semibold text-amber-700 hover:underline">
              <PenLine size={12} /> Ir a Mi Firma →
            </Link>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-500">Cargando…</div>
      ) : anexos.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <FileText size={32} className="mx-auto text-gray-300 mb-2" />
          <p className="text-gray-500 text-sm">Aún no tienes anexos contractuales registrados.</p>
        </div>
      ) : (
        <>
          {pendientes.length > 0 && (
            <Section title="Por firmar" subtitle="Lee y firma estos anexos">
              {pendientes.map(a => (
                <AnexoCard
                  key={a.id} a={a} estadoBadge={estadoBadge}
                  onVerPdf={() => verPdf(a)}
                  onFirmar={() => firmar(a)}
                  signing={signing === a.id}
                  canSign={!!perfil?.tiene_firma}
                />
              ))}
            </Section>
          )}

          {informativos.length > 0 && (
            <Section title="Notificaciones informativas" subtitle="Cambios legales o reajustes que no requieren firma">
              {informativos.map(a => (
                <AnexoCard key={a.id} a={a} estadoBadge={estadoBadge} onVerPdf={() => verPdf(a)} />
              ))}
            </Section>
          )}

          {historial.length > 0 && (
            <Section title="Historial firmado">
              {historial.map(a => (
                <AnexoCard key={a.id} a={a} estadoBadge={estadoBadge} onVerPdf={() => verPdf(a)} />
              ))}
            </Section>
          )}
        </>
      )}
    </div>
  )
}

function Section({ title, subtitle, children }) {
  return (
    <div>
      <h2 className="text-sm font-bold text-gray-900">{title}</h2>
      {subtitle && <p className="text-xs text-gray-500 mb-2">{subtitle}</p>}
      <div className="space-y-2 mt-2">{children}</div>
    </div>
  )
}

function AnexoCard({ a, estadoBadge, onVerPdf, onFirmar, signing, canSign }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${estadoBadge(a.estado)}`}>
          {a.estado === 'EMITIDO' ? 'Por firmar' : a.estado === 'INFORMATIVO' ? 'Informativo' : a.estado}
        </span>
        {a.firmado_at && (
          <span className="text-[10px] text-emerald-700 flex items-center gap-1">
            <CheckCircle size={11} /> {a.firmado_at.slice(0, 10)}
          </span>
        )}
      </div>
      <p className="text-sm font-semibold text-gray-900">{a.titulo}</p>
      <p className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1">
        <Clock size={10} /> {a.created_at?.slice(0, 16).replace('T', ' ')}
      </p>

      <div className="flex gap-2 mt-3">
        <button
          onClick={onVerPdf}
          className="flex-1 text-xs px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center justify-center gap-1 font-medium"
        >
          <Download size={12} /> Ver PDF
        </button>
        {onFirmar && (
          <button
            onClick={onFirmar}
            disabled={signing || !canSign}
            className="flex-1 text-xs px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-1 font-medium"
          >
            <PenLine size={12} /> {signing ? 'Firmando…' : 'Firmar'}
          </button>
        )}
      </div>

      {!a.requiere_firma_trabajador && a.estado === 'INFORMATIVO' && (
        <p className="text-[10px] text-blue-600 mt-2 flex items-center gap-1">
          <Info size={10} /> Notificación legal — no requiere tu firma
        </p>
      )}
    </div>
  )
}
