import { useEffect, useState } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import {
  FileText, Download, PenLine, CheckCircle, Clock, AlertCircle,
  Briefcase, Calendar, DollarSign, ShieldCheck,
} from 'lucide-react'

const fmtClp = (n) => (n ?? 0).toLocaleString('es-CL', { style: 'currency', currency: 'CLP' })
const fmtDate = (s) => {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const ESTADO_LABELS = {
  EMITIDO: { label: 'Pendiente de firma', color: 'bg-amber-100 text-amber-700', icon: Clock },
  INFORMATIVO: { label: 'Informativo', color: 'bg-blue-100 text-blue-700', icon: FileText },
  FIRMADO: { label: 'Firmado', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle },
  RECHAZADO: { label: 'Rechazado', color: 'bg-red-100 text-red-700', icon: AlertCircle },
}

export default function DriverMiContrato() {
  const [data, setData] = useState(null)
  const [anexos, setAnexos] = useState([])
  const [perfilFirma, setPerfilFirma] = useState(null)
  const [loading, setLoading] = useState(true)
  const [signing, setSigning] = useState(null)

  const cargar = async () => {
    setLoading(true)
    try {
      const [v, a] = await Promise.all([
        api.get('/contratos/portal/vigente'),
        api.get('/contratos/portal/anexos'),
      ])
      setData(v.data)
      setAnexos(a.data)
      try {
        const p = await api.get('/remuneraciones/portal/perfil')
        setPerfilFirma(p.data)
      } catch {
        setPerfilFirma(null)
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al cargar tu contrato')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { cargar() }, [])

  const verPdf = async (a) => {
    try {
      const { data: blob } = await api.get(`/contratos/portal/anexos/${a.id}/pdf`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }))
      window.open(url, '_blank')
      setTimeout(cargar, 500)
    } catch {
      toast.error('Error al abrir el PDF')
    }
  }

  const firmar = async (a) => {
    if (!perfilFirma?.tiene_firma) {
      toast.error('Primero registra tu firma electrónica antes de firmar el documento')
      return
    }
    setSigning(a.id)
    try {
      await api.post(`/contratos/portal/anexos/${a.id}/firmar`)
      toast.success('Documento firmado correctamente')
      await cargar()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Error al firmar el documento')
    } finally {
      setSigning(null)
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse text-sm text-gray-500">Cargando tu contrato…</div>
      </div>
    )
  }

  const v = data?.version_vigente
  const t = data?.trabajador
  const inicial = data?.contrato_inicial

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Mi Contrato</h1>
        <p className="text-sm text-gray-500 mt-1">Resumen de tu contrato vigente, anexos y documentos firmados</p>
      </div>

      {/* Datos personales */}
      {t && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Briefcase size={16} className="text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Mis datos</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-xs text-gray-500">Nombre</p>
              <p className="font-medium text-gray-900">{t.nombre || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">RUT</p>
              <p className="font-medium text-gray-900">{t.rut || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Cargo</p>
              <p className="font-medium text-gray-900">{v?.cargo || t.cargo || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Fecha de ingreso</p>
              <p className="font-medium text-gray-900">{fmtDate(t.fecha_ingreso)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">AFP</p>
              <p className="font-medium text-gray-900">{t.afp || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Sistema de salud</p>
              <p className="font-medium text-gray-900">{t.sistema_salud || '—'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Versión vigente */}
      {v ? (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <DollarSign size={16} className="text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Versión vigente</h2>
            </div>
            <span className="text-xs text-gray-500">Desde {fmtDate(v.vigente_desde)}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-gray-500">Tipo de contrato</p>
              <p className="font-medium text-gray-900">{v.tipo_contrato || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Jornada</p>
              <p className="font-medium text-gray-900">
                {v.jornada_semanal_horas ? `${v.jornada_semanal_horas} hrs/semana` : '—'}
                {v.distribucion_jornada ? ` · ${v.distribucion_jornada.replace(/_/g, ' ')}` : ''}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Sueldo base</p>
              <p className="font-bold text-gray-900">{fmtClp(v.sueldo_base)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Sueldo líquido proyectado</p>
              <p className="font-bold text-gray-900">{fmtClp(v.sueldo_liquido)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Movilización (no imponible)</p>
              <p className="font-medium text-gray-900">{fmtClp(v.movilizacion)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Colación (no imponible)</p>
              <p className="font-medium text-gray-900">{fmtClp(v.colacion)}</p>
            </div>
            {v.viaticos > 0 && (
              <div>
                <p className="text-xs text-gray-500">Viáticos (no imponible)</p>
                <p className="font-medium text-gray-900">{fmtClp(v.viaticos)}</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-start gap-3">
          <AlertCircle size={18} className="text-amber-600 mt-0.5" />
          <div className="text-sm text-amber-800">
            Aún no tienes una versión de contrato registrada. Contacta a RR.HH. si crees que es un error.
          </div>
        </div>
      )}

      {/* Contrato inicial destacado */}
      {inicial && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck size={16} className="text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Contrato individual</h2>
          </div>
          <AnexoCard
            anexo={inicial}
            firmaLista={!!perfilFirma?.tiene_firma}
            signing={signing === inicial.id}
            onVer={() => verPdf(inicial)}
            onFirmar={() => firmar(inicial)}
          />
        </div>
      )}

      {/* Anexos */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-3">
          <FileText size={16} className="text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Anexos y documentos</h2>
        </div>
        {anexos.filter(a => !inicial || a.id !== inicial.id).length === 0 ? (
          <p className="text-sm text-gray-500">No hay anexos adicionales por ahora.</p>
        ) : (
          <div className="space-y-3">
            {anexos.filter(a => !inicial || a.id !== inicial.id).map(a => (
              <AnexoCard
                key={a.id}
                anexo={a}
                firmaLista={!!perfilFirma?.tiene_firma}
                signing={signing === a.id}
                onVer={() => verPdf(a)}
                onFirmar={() => firmar(a)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Vacaciones — link rápido */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-50">
            <Calendar size={18} className="text-emerald-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Vacaciones</p>
            <p className="text-xs text-gray-500">Revisa tu saldo de feriado legal y solicita días libres</p>
          </div>
        </div>
        <a
          href="/driver/mis-vacaciones"
          className="text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          Ir a mis vacaciones →
        </a>
      </div>
    </div>
  )
}

function AnexoCard({ anexo, firmaLista, signing, onVer, onFirmar }) {
  const meta = ESTADO_LABELS[anexo.estado] || { label: anexo.estado, color: 'bg-gray-100 text-gray-700', icon: FileText }
  const Icon = meta.icon
  const requiereFirma = anexo.requiere_firma_trabajador && anexo.estado === 'EMITIDO'
  return (
    <div className="border border-gray-200 rounded-lg p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 truncate">{anexo.titulo}</p>
          <p className="text-xs text-gray-500 mt-0.5">{anexo.tipo}</p>
          {anexo.firmado_at && (
            <p className="text-[11px] text-emerald-600 mt-1">Firmado el {fmtDate(anexo.firmado_at)}</p>
          )}
        </div>
        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium ${meta.color}`}>
          <Icon size={12} />
          {meta.label}
        </span>
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        <button
          onClick={onVer}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-lg"
        >
          <Download size={12} /> Ver documento
        </button>
        {requiereFirma && (
          <button
            onClick={onFirmar}
            disabled={signing || !firmaLista}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 rounded-lg"
            title={!firmaLista ? 'Registra tu firma antes' : ''}
          >
            <PenLine size={12} /> {signing ? 'Firmando…' : 'Firmar'}
          </button>
        )}
      </div>
    </div>
  )
}
