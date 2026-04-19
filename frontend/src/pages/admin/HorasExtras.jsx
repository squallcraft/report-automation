import { useState, useEffect, useMemo } from 'react'
import api from '../../api'
import Modal from '../../components/Modal'
import PeriodSelector from '../../components/PeriodSelector'
import toast from 'react-hot-toast'
import { Plus, Trash2, Clock, X, Calculator } from 'lucide-react'

const fmt = (v) => `$${Number(v || 0).toLocaleString('es-CL')}`
const MESES = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

const now = new Date()
const initialPeriod = { semana: 1, mes: now.getMonth() + 1, anio: now.getFullYear() }

export default function HorasExtras() {
  const [period, setPeriod] = useState(initialPeriod)
  const [filas, setFilas] = useState([])
  const [trabajadores, setTrabajadores] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [edit, setEdit] = useState(null)
  const [deleteId, setDeleteId] = useState(null)
  const [form, setForm] = useState({
    trabajador_id: '',
    cantidad_50: 0,
    cantidad_100: 0,
    nota: '',
  })
  const [preview, setPreview] = useState(null)
  const [saving, setSaving] = useState(false)

  const cargar = () => {
    setLoading(true)
    api.get('/horas-extras/', { params: { mes: period.mes, anio: period.anio } })
      .then(({ data }) => setFilas(data))
      .catch(() => toast.error('Error al cargar horas extras'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { cargar() }, [period])
  useEffect(() => {
    api.get('/trabajadores').then(({ data }) =>
      setTrabajadores((data || []).filter(t => t.activo)),
    ).catch(() => {})
  }, [])

  const openCreate = () => {
    setEdit(null)
    setPreview(null)
    setForm({ trabajador_id: '', cantidad_50: 0, cantidad_100: 0, nota: '' })
    setModalOpen(true)
  }

  const openEdit = (row) => {
    setEdit(row)
    setPreview(null)
    setForm({
      trabajador_id: row.trabajador_id,
      cantidad_50: Number(row.cantidad_50) || 0,
      cantidad_100: Number(row.cantidad_100) || 0,
      nota: row.nota || '',
    })
    setModalOpen(true)
  }

  // Pre-cálculo en vivo cuando cambian las cantidades
  useEffect(() => {
    if (!modalOpen || !form.trabajador_id) {
      setPreview(null)
      return
    }
    if ((Number(form.cantidad_50) || 0) === 0 && (Number(form.cantidad_100) || 0) === 0) {
      setPreview(null)
      return
    }
    const t = setTimeout(() => {
      api.get('/horas-extras/preview', {
        params: {
          trabajador_id: form.trabajador_id,
          mes: period.mes,
          anio: period.anio,
          cantidad_50: form.cantidad_50,
          cantidad_100: form.cantidad_100,
        },
      })
        .then(({ data }) => setPreview(data))
        .catch(() => setPreview(null))
    }, 300)
    return () => clearTimeout(t)
  }, [modalOpen, form, period.mes, period.anio])

  const guardar = (e) => {
    e?.preventDefault()
    if (!form.trabajador_id) return toast.error('Selecciona un trabajador')
    setSaving(true)
    api.post('/horas-extras/', {
      trabajador_id: Number(form.trabajador_id),
      mes: period.mes,
      anio: period.anio,
      cantidad_50: Number(form.cantidad_50) || 0,
      cantidad_100: Number(form.cantidad_100) || 0,
      nota: form.nota?.trim() || null,
    })
      .then(() => {
        toast.success(edit ? 'Horas extras actualizadas' : 'Horas extras registradas')
        setModalOpen(false)
        cargar()
      })
      .catch(err => toast.error(err.response?.data?.detail || 'Error al guardar'))
      .finally(() => setSaving(false))
  }

  const eliminar = () => {
    if (!deleteId) return
    api.delete(`/horas-extras/${deleteId}`)
      .then(() => { toast.success('Eliminado'); setDeleteId(null); cargar() })
      .catch(() => toast.error('Error al eliminar'))
  }

  const totalMes = useMemo(() => filas.reduce((s, f) => s + (f.monto_total || 0), 0), [filas])
  const totalHoras = useMemo(
    () => filas.reduce((s, f) => s + (Number(f.cantidad_50) || 0) + (Number(f.cantidad_100) || 0), 0),
    [filas],
  )

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PeriodSelector value={period} onChange={setPeriod} showSemana={false} />
        <button onClick={openCreate} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> Cargar horas extras
        </button>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs uppercase text-gray-500 font-medium">Trabajadores con HE</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{filas.length}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs uppercase text-gray-500 font-medium">Horas totales</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{totalHoras.toFixed(2)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs uppercase text-gray-500 font-medium">Monto total a pagar</div>
          <div className="text-2xl font-bold text-emerald-700 mt-1">{fmt(totalMes)}</div>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-6 text-center text-gray-500 text-sm">Cargando…</div>
        ) : filas.length === 0 ? (
          <div className="p-8 text-center">
            <Clock size={32} className="mx-auto text-gray-300 mb-2" />
            <p className="text-gray-500 text-sm">
              No hay horas extras registradas para {MESES[period.mes]} {period.anio}.
            </p>
            <button onClick={openCreate} className="mt-3 text-sm text-primary-700 font-medium hover:underline">
              + Cargar las primeras
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Trabajador</th>
                  <th className="text-right px-4 py-3 font-medium">HE 50%</th>
                  <th className="text-right px-4 py-3 font-medium">HE 100%</th>
                  <th className="text-right px-4 py-3 font-medium">Valor hora</th>
                  <th className="text-right px-4 py-3 font-medium">Monto total</th>
                  <th className="text-left px-4 py-3 font-medium">Nota</th>
                  <th className="px-2 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filas.map(f => (
                  <tr key={f.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => openEdit(f)}>
                    <td className="px-4 py-3 font-medium text-gray-900">{f.trabajador_nombre || `#${f.trabajador_id}`}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {Number(f.cantidad_50).toFixed(2)} hrs
                      <div className="text-xs text-gray-500">{fmt(f.monto_50)}</div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {Number(f.cantidad_100).toFixed(2)} hrs
                      <div className="text-xs text-gray-500">{fmt(f.monto_100)}</div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-600">{fmt(f.valor_hora_calculado)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-bold text-emerald-700">{fmt(f.monto_total)}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs max-w-[200px] truncate">{f.nota || '—'}</td>
                    <td className="px-2 py-3 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteId(f.id) }}
                        className="p-1.5 text-gray-400 hover:text-red-600 rounded"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal carga / edición */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={edit ? 'Editar horas extras' : 'Cargar horas extras'}>
        <form onSubmit={guardar} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-600 uppercase">Trabajador</label>
            <select
              className="input mt-1"
              value={form.trabajador_id}
              onChange={(e) => setForm(f => ({ ...f, trabajador_id: e.target.value }))}
              required
              disabled={!!edit}
            >
              <option value="">— Seleccionar —</option>
              {trabajadores.map(t => (
                <option key={t.id} value={t.id}>{t.nombre}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 uppercase">HE 50% (Art. 32)</label>
              <input
                type="number" min="0" step="0.5" className="input mt-1"
                value={form.cantidad_50}
                onChange={(e) => setForm(f => ({ ...f, cantidad_50: e.target.value }))}
              />
              <div className="text-[11px] text-gray-500 mt-1">Recargo 50% sobre valor hora</div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 uppercase">HE 100% (Art. 38)</label>
              <input
                type="number" min="0" step="0.5" className="input mt-1"
                value={form.cantidad_100}
                onChange={(e) => setForm(f => ({ ...f, cantidad_100: e.target.value }))}
              />
              <div className="text-[11px] text-gray-500 mt-1">Festivos / 7º día</div>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 uppercase">Nota</label>
            <textarea
              className="input mt-1" rows={2}
              placeholder="Ej. proyecto especial, cierre mes, etc."
              value={form.nota}
              onChange={(e) => setForm(f => ({ ...f, nota: e.target.value }))}
            />
          </div>

          {/* Preview */}
          {preview && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="flex items-center gap-2 text-blue-900 font-medium text-sm mb-2">
                <Calculator size={14} /> Cálculo (en vivo)
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-blue-800">
                <div>Sueldo base usado:</div><div className="text-right tabular-nums">{fmt(preview.sueldo_base_usado)}</div>
                <div>Jornada usada:</div><div className="text-right tabular-nums">{preview.jornada_usada} hrs</div>
                <div>Valor hora:</div><div className="text-right tabular-nums">{fmt(preview.valor_hora)}</div>
                <div>Monto HE 50%:</div><div className="text-right tabular-nums">{fmt(preview.monto_50)}</div>
                <div>Monto HE 100%:</div><div className="text-right tabular-nums">{fmt(preview.monto_100)}</div>
                <div className="font-bold pt-2 border-t border-blue-200 col-span-1">Total a pagar:</div>
                <div className="font-bold pt-2 border-t border-blue-200 text-right tabular-nums">{fmt(preview.monto_total)}</div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Confirmar eliminación */}
      <Modal open={!!deleteId} onClose={() => setDeleteId(null)} title="Eliminar horas extras">
        <p className="text-sm text-gray-600 mb-4">¿Seguro que deseas eliminar este registro?</p>
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={() => setDeleteId(null)}>Cancelar</button>
          <button className="btn-danger" onClick={eliminar}>Eliminar</button>
        </div>
      </Modal>
    </div>
  )
}
