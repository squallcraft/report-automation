import { useState, useEffect, useCallback } from 'react'
import api from '../../api'
import toast from 'react-hot-toast'
import { CalendarDays, RefreshCw, Pencil, Lock, ChevronDown } from 'lucide-react'
import Modal from '../../components/Modal'

const MESES = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso + 'T12:00:00')
  return `${DIAS[d.getDay()]} ${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`
}

function fmtDateFull(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T12:00:00')
  return d.toISOString().split('T')[0]
}

function isPast(isoDate) {
  return new Date(isoDate + 'T12:00:00') <= new Date()
}

export default function Calendario() {
  const [anio, setAnio] = useState(new Date().getFullYear())
  const [semanas, setSemanas] = useState([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [editModal, setEditModal] = useState(null)
  const [editForm, setEditForm] = useState({ fecha_inicio: '', fecha_fin: '' })
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState([])
  const [showPreview, setShowPreview] = useState(false)

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/calendario', { params: { anio } })
      setSemanas(res.data)
    } catch {
      toast.error('Error cargando calendario')
    } finally {
      setLoading(false)
    }
  }, [anio])

  useEffect(() => { cargar() }, [cargar])

  const generarCalendario = async () => {
    setGenerating(true)
    try {
      const res = await api.post('/calendario/generar', null, { params: { anio } })
      toast.success(res.data.message)
      cargar()
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Error generando calendario')
    } finally {
      setGenerating(false)
    }
  }

  const verPreview = async () => {
    try {
      const res = await api.get('/calendario/preview', { params: { anio } })
      setPreview(res.data)
      setShowPreview(true)
    } catch {
      toast.error('Error cargando preview')
    }
  }

  const openEdit = (semana) => {
    setEditForm({
      fecha_inicio: fmtDateFull(semana.fecha_inicio),
      fecha_fin: fmtDateFull(semana.fecha_fin),
    })
    setEditModal(semana)
  }

  const guardarEdicion = async () => {
    if (!editModal) return
    setSaving(true)
    try {
      await api.put(`/calendario/${editModal.id}`, editForm)
      toast.success('Semana actualizada')
      setEditModal(null)
      cargar()
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  // Agrupar por mes
  const porMes = semanas.reduce((acc, s) => {
    const key = s.mes
    if (!acc[key]) acc[key] = []
    acc[key].push(s)
    return acc
  }, {})

  const anioActual = new Date().getFullYear()

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <CalendarDays size={24} className="text-primary-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Calendario de Semanas</h1>
            <p className="text-sm text-gray-500">
              Define qué días pertenecen a cada semana de facturación.
              Regla: si algún Lun-Vie cae en el mes siguiente, toda la semana es Semana 1 de ese mes.
            </p>
          </div>
        </div>
      </div>

      {/* Controles */}
      <div className="card mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Año:</label>
            <select
              className="input w-28"
              value={anio}
              onChange={e => setAnio(Number(e.target.value))}
            >
              {[anioActual - 1, anioActual, anioActual + 1, anioActual + 2].map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          <button
            onClick={verPreview}
            className="btn btn-secondary flex items-center gap-2"
          >
            <ChevronDown size={16} />
            Ver cómo quedaría
          </button>

          <button
            onClick={generarCalendario}
            disabled={generating}
            className="btn btn-primary flex items-center gap-2"
          >
            <RefreshCw size={16} className={generating ? 'animate-spin' : ''} />
            {generating ? 'Generando...' : `Generar/Actualizar ${anio}`}
          </button>

          {semanas.length === 0 && !loading && (
            <p className="text-sm text-amber-600 font-medium">
              ⚠ No hay calendario para {anio}. Genera uno primero.
            </p>
          )}
        </div>

        <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
          <strong>Nota:</strong> Solo puedes editar semanas <strong>futuras</strong>.
          Las semanas pasadas están bloqueadas para preservar la integridad de la liquidación.
          Al generar, solo se sobreescriben semanas futuras.
        </div>
      </div>

      {/* Tabla por mes */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Cargando calendario...</div>
      ) : (
        Object.entries(porMes).sort(([a], [b]) => Number(a) - Number(b)).map(([mes, semanasDelMes]) => (
          <div key={mes} className="card mb-4">
            <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <span className="bg-primary-100 text-primary-800 text-xs font-bold px-2 py-1 rounded">
                {MESES[Number(mes)]}
              </span>
              <span className="text-sm text-gray-500 font-normal">
                {semanasDelMes.length} semana{semanasDelMes.length !== 1 ? 's' : ''}
              </span>
            </h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                  <th className="pb-2 font-medium">Semana</th>
                  <th className="pb-2 font-medium">Lunes (Inicio)</th>
                  <th className="pb-2 font-medium">Domingo (Fin)</th>
                  <th className="pb-2 font-medium">Días</th>
                  <th className="pb-2 font-medium">Origen</th>
                  <th className="pb-2 font-medium text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {semanasDelMes.map(s => {
                  const past = isPast(s.fecha_inicio)
                  const dias = Math.round(
                    (new Date(s.fecha_fin + 'T12:00:00') - new Date(s.fecha_inicio + 'T12:00:00'))
                    / (1000 * 60 * 60 * 24)
                  ) + 1
                  return (
                    <tr
                      key={s.id}
                      className={`border-b border-gray-100 last:border-0 ${past ? 'opacity-60' : 'hover:bg-gray-50'}`}
                    >
                      <td className="py-2.5">
                        <span className="font-semibold text-primary-700">Sem {s.semana}</span>
                      </td>
                      <td className="py-2.5 font-mono text-gray-700">{fmtDate(s.fecha_inicio)}</td>
                      <td className="py-2.5 font-mono text-gray-700">{fmtDate(s.fecha_fin)}</td>
                      <td className="py-2.5 text-gray-500">{dias} días</td>
                      <td className="py-2.5">
                        {s.generado_auto ? (
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">Auto</span>
                        ) : (
                          <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">Manual</span>
                        )}
                      </td>
                      <td className="py-2.5 text-right">
                        {past ? (
                          <span className="flex items-center justify-end gap-1 text-xs text-gray-400">
                            <Lock size={12} /> Bloqueada
                          </span>
                        ) : (
                          <button
                            onClick={() => openEdit(s)}
                            className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 ml-auto"
                          >
                            <Pencil size={12} /> Editar
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))
      )}

      {/* Modal edición */}
      {editModal && (
        <Modal title={`Editar Semana ${editModal.semana} — ${MESES[editModal.mes]} ${editModal.anio}`} onClose={() => setEditModal(null)}>
          <div className="space-y-4">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
              La fecha de inicio debe ser un <strong>lunes</strong>.
              Cambiar estas fechas afecta cómo se agrupan los envíos futuros.
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fecha inicio (Lunes)</label>
              <input
                type="date"
                className="input w-full"
                value={editForm.fecha_inicio}
                onChange={e => setEditForm(f => ({ ...f, fecha_inicio: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fecha fin (Domingo)</label>
              <input
                type="date"
                className="input w-full"
                value={editForm.fecha_fin}
                onChange={e => setEditForm(f => ({ ...f, fecha_fin: e.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setEditModal(null)} className="btn btn-secondary">Cancelar</button>
              <button onClick={guardarEdicion} disabled={saving} className="btn btn-primary">
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal preview */}
      {showPreview && (
        <Modal title={`Preview Calendario ${anio} (sin guardar)`} onClose={() => setShowPreview(false)}>
          <div className="max-h-[70vh] overflow-y-auto">
            <p className="text-sm text-gray-600 mb-3">
              Así quedaría el calendario si lo regeneras ahora.
              Las semanas pasadas no se sobreescriben.
            </p>
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                  <th className="pb-2 font-medium">Mes</th>
                  <th className="pb-2 font-medium">Semana</th>
                  <th className="pb-2 font-medium">Inicio (Lun)</th>
                  <th className="pb-2 font-medium">Fin (Dom)</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i} className={`border-b border-gray-100 ${!r.editable ? 'opacity-50' : ''}`}>
                    <td className="py-1.5 font-medium text-gray-700">{r.mes_nombre}</td>
                    <td className="py-1.5 text-primary-700 font-semibold">Sem {r.semana}</td>
                    <td className="py-1.5 font-mono text-gray-600">{fmtDate(r.fecha_inicio)}</td>
                    <td className="py-1.5 font-mono text-gray-600">{fmtDate(r.fecha_fin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t mt-4">
            <button onClick={() => setShowPreview(false)} className="btn btn-secondary">Cerrar</button>
            <button
              onClick={() => { setShowPreview(false); generarCalendario() }}
              className="btn btn-primary"
            >
              Confirmar y Generar
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
