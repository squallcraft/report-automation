import { useState, useEffect } from 'react'
import api from '../../api'
import PageHeader from '../../components/PageHeader'
import { User } from 'lucide-react'

export default function ColaboradorPerfil() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/colaboradores/portal/perfil')
      .then(({ data }) => setData(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Cargando...</div>
  if (!data) return <div className="text-center text-gray-400 py-20">Error cargando datos</div>

  const fields = [
    { label: 'Nombre', value: data.nombre },
    { label: 'RUT', value: data.rut },
    { label: 'Email', value: data.email },
    { label: 'Teléfono', value: data.telefono },
    { label: 'Especialidad', value: data.especialidad },
    { label: 'Descripción servicio', value: data.descripcion_servicio },
    { label: 'Frecuencia de pago', value: data.frecuencia_pago },
    { label: 'Monto acordado', value: data.monto_acordado ? `$${data.monto_acordado.toLocaleString('es-CL')}` : 'Variable' },
    { label: 'Inicio contrato', value: data.fecha_inicio },
    { label: 'Fin contrato', value: data.fecha_fin || 'Indefinido' },
    { label: 'Banco', value: data.banco },
    { label: 'Tipo cuenta', value: data.tipo_cuenta },
    { label: 'N° cuenta', value: data.numero_cuenta },
  ]

  return (
    <div>
      <PageHeader title="Mi Perfil" subtitle="Datos de tu contrato y cuenta" icon={User} accent="teal" />

      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {fields.map((f, i) => (
            <div key={i}>
              <span className="text-xs text-gray-400 block mb-0.5">{f.label}</span>
              <span className="text-sm font-medium text-gray-800">{f.value || '—'}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-gray-400 mt-4 text-center">
        Para modificar tus datos, contacta al administrador.
      </p>
    </div>
  )
}
