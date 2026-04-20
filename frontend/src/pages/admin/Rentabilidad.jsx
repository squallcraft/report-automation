import { useState, useEffect, useCallback } from "react";
import { TrendingUp, TrendingDown, Minus, Users, UserCheck, ChevronDown, ChevronUp, X } from "lucide-react";
import api from "../../api";

const clp = (n) => n != null ? `$${Number(n).toLocaleString("es-CL")}` : "—";

const now = new Date();
const MESES_LABELS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const MESES_NOMBRES = ["","Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

// ─── Filtro de período ────────────────────────────────────────────────────────

function FiltroPeriodo({ filters, onChange }) {
  const { semana, mes, anio } = filters;
  const hasCustom = semana || mes !== now.getMonth() + 1 || anio !== String(now.getFullYear());

  return (
    <div className="flex flex-wrap items-end gap-3 p-4 bg-white border border-gray-200 rounded-xl shadow-sm mb-4">
      <div className="w-28">
        <label className="block text-xs font-medium text-gray-500 mb-1">Semana</label>
        <select
          className="input-field"
          value={semana}
          onChange={(e) => onChange({ ...filters, semana: e.target.value })}
        >
          <option value="">Todas</option>
          {[1,2,3,4,5].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Mes</label>
        <div className="flex flex-wrap gap-1">
          {MESES_LABELS.map((label, i) => {
            const m = i + 1;
            const active = mes === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => onChange({ ...filters, mes: m })}
                className={`px-2 py-1 text-xs rounded border transition-colors ${
                  active
                    ? "bg-orange-500 text-white border-orange-500"
                    : "bg-white text-gray-600 border-gray-300 hover:border-orange-400"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="w-28">
        <label className="block text-xs font-medium text-gray-500 mb-1">Año</label>
        <input
          type="number"
          className="input-field"
          placeholder="2026"
          value={anio}
          onChange={(e) => onChange({ ...filters, anio: e.target.value })}
        />
      </div>

      {hasCustom && (
        <button
          type="button"
          onClick={() => onChange({ semana: "", mes: now.getMonth() + 1, anio: String(now.getFullYear()) })}
          className="btn-secondary h-10 flex items-center gap-1 text-sm"
        >
          <X size={14} /> Limpiar
        </button>
      )}
    </div>
  );
}

function EtiquetaPeriodo({ semana, mes, anio }) {
  return (
    <span className="text-sm text-gray-500 font-normal">
      {semana ? `Semana ${semana} — ` : ""}{MESES_NOMBRES[mes]} {anio}
    </span>
  );
}

function EstadoBadge({ estado }) {
  const map = { verde: "bg-green-100 text-green-700", amarillo: "bg-yellow-100 text-yellow-700", rojo: "bg-red-100 text-red-700" };
  const labels = { verde: "Rentable", amarillo: "Ajustado", rojo: "Pérdida" };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[estado] || "bg-gray-100 text-gray-500"}`}>{labels[estado] || estado}</span>;
}

function Flecha({ valor }) {
  if (valor > 0) return <TrendingUp size={16} className="text-green-500" />;
  if (valor < 0) return <TrendingDown size={16} className="text-red-500" />;
  return <Minus size={16} className="text-gray-400" />;
}

// ─── Vista General ────────────────────────────────────────────────────────────

function VistaGeneral({ filters }) {
  const { semana, mes, anio } = filters;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const cargar = useCallback(async () => {
    if (!mes || !anio) return;
    setLoading(true);
    try {
      const params = { mes, anio };
      if (semana) params.semana = semana;
      const { data: d } = await api.get("/rentabilidad/general", { params });
      setData(d);
    } catch { setData(null); }
    finally { setLoading(false); }
  }, [semana, mes, anio]);

  useEffect(() => { cargar(); }, [cargar]);

  return (
    <div className="space-y-4">
      {loading && <div className="text-center text-gray-400 py-8">Calculando…</div>}
      {data && !loading && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Paquetes totales", valor: data.totales.paquetes, isMoney: false },
              { label: "Ingresos generados", valor: data.totales.ingresos_generados, isMoney: true },
              { label: "Costo CPC pagado", valor: data.totales.costo_cpc, isMoney: true },
              { label: "Margen bruto", valor: data.totales.margen_bruto, isMoney: true, highlight: true },
            ].map(({ label, valor, isMoney, highlight }) => (
              <div key={label} className={`rounded-xl p-4 ${highlight ? "bg-orange-50 border border-orange-200" : "bg-white shadow"}`}>
                <p className="text-xs text-gray-500">{label}</p>
                <p className={`text-xl font-bold mt-1 ${highlight ? "text-orange-600" : "text-gray-800"}`}>
                  {isMoney ? clp(valor) : valor.toLocaleString("es-CL")}
                </p>
              </div>
            ))}
          </div>
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Conductor</th>
                  <th className="px-4 py-3 text-left">Zona</th>
                  <th className="px-4 py-3 text-left">Tipo</th>
                  <th className="px-4 py-3 text-right">Paquetes</th>
                  <th className="px-4 py-3 text-right">Ingresos</th>
                  <th className="px-4 py-3 text-right">Costo CPC</th>
                  <th className="px-4 py-3 text-right">Margen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.drivers.map(d => (
                  <tr key={d.driver_id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-gray-800">{d.driver_nombre}</td>
                    <td className="px-4 py-2 text-gray-500 capitalize">{d.zona || "—"}</td>
                    <td className="px-4 py-2">
                      {d.contratado
                        ? <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs">Contratado</span>
                        : <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-xs">Independiente</span>}
                    </td>
                    <td className="px-4 py-2 text-right">{d.paquetes.toLocaleString("es-CL")}</td>
                    <td className="px-4 py-2 text-right">{clp(d.ingresos_generados)}</td>
                    <td className="px-4 py-2 text-right text-red-600">{clp(d.costo_cpc)}</td>
                    <td className="px-4 py-2 text-right">
                      <span className={`font-semibold ${d.margen_bruto >= 0 ? "text-green-600" : "text-red-600"}`}>{clp(d.margen_bruto)}</span>
                    </td>
                  </tr>
                ))}
                {data.drivers.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Sin actividad en el período</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      {!data && !loading && <div className="text-center text-gray-400 py-8">Sin datos para el período seleccionado</div>}
    </div>
  );
}

// ─── Vista Contratados ────────────────────────────────────────────────────────

function VistaContratados({ filters }) {
  const { semana, mes, anio } = filters;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expandido, setExpandido] = useState(null);
  const [detalle, setDetalle] = useState({});

  const cargar = useCallback(async () => {
    if (!mes || !anio) return;
    setLoading(true);
    setExpandido(null);
    setDetalle({});
    try {
      const params = { mes, anio };
      if (semana) params.semana = semana;
      const { data: d } = await api.get("/rentabilidad/contratados", { params });
      setData(d);
    } catch { setData(null); }
    finally { setLoading(false); }
  }, [semana, mes, anio]);

  useEffect(() => { cargar(); }, [cargar]);

  const verDetalleMes = async (driverId) => {
    if (detalle[driverId]) { setExpandido(expandido === driverId ? null : driverId); return; }
    try {
      const { data: d } = await api.get(`/rentabilidad/contratados/${driverId}`, { params: { mes, anio } });
      setDetalle(prev => ({ ...prev, [driverId]: d }));
      setExpandido(driverId);
    } catch { /* silencioso */ }
  };

  const labelPeriodo = semana ? "semana" : "mes";

  return (
    <div className="space-y-4">
      {loading && <div className="text-center text-gray-400 py-8">Calculando…</div>}
      {data && !loading && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Ingresos entregas", valor: data.totales.ingresos_entregas },
              { label: "Valor retiros", valor: data.totales.retiros_valor },
              { label: `Nómina ${labelPeriodo}`, valor: -data.totales.nomina_semana, red: true },
              { label: "Combustible", valor: -data.totales.combustible_semana, red: true },
              { label: "TAG", valor: -data.totales.tag_semana, red: true },
              { label: "Resultado neto", valor: data.totales.resultado_neto, highlight: true },
              { label: semana ? "Proyección mes" : "Total mes", valor: data.totales.proyeccion_mensual, highlight: true },
            ].map(({ label, valor, highlight, red }) => (
              <div key={label} className={`rounded-xl p-4 ${highlight ? "bg-orange-50 border border-orange-200" : "bg-white shadow"}`}>
                <p className="text-xs text-gray-500">{label}</p>
                <p className={`text-lg font-bold mt-1 ${highlight ? "text-orange-600" : red ? "text-red-600" : "text-gray-800"}`}>{clp(Math.abs(valor))}</p>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            {data.drivers.map(d => (
              <div key={d.driver_id} className="bg-white rounded-xl shadow overflow-hidden">
                <div className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-800">{d.driver_nombre}</span>
                      <EstadoBadge estado={d.estado} />
                      {d.vehiculo_patente && (
                        <span className="font-mono text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">{d.vehiculo_patente}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {d.zona || "Zona no definida"} · {d.paquetes_diarios_promedio} paq/día prom · Meta: {d.meta_semana} paq/{semana ? "sem" : "mes"} {d.cumple_meta ? "✅" : "⚠️"}
                    </p>
                  </div>

                  <div className="flex items-center gap-6 text-sm">
                    <div className="text-center">
                      <p className="text-xs text-gray-400">Ingresos</p>
                      <p className="font-semibold text-green-600">{clp(d.total_ingresos)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-gray-400">Costos</p>
                      <p className="font-semibold text-red-500">{clp(d.total_costos)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-gray-400">Neto</p>
                      <p className={`font-bold text-lg flex items-center gap-1 ${d.resultado_neto >= 0 ? "text-green-600" : "text-red-600"}`}>
                        <Flecha valor={d.resultado_neto} /> {clp(d.resultado_neto)}
                      </p>
                    </div>
                    {semana && (
                      <div className="text-center">
                        <p className="text-xs text-gray-400">Proyección mes</p>
                        <p className={`font-semibold ${d.proyeccion_mensual >= 0 ? "text-gray-700" : "text-red-500"}`}>{clp(d.proyeccion_mensual)}</p>
                      </div>
                    )}
                  </div>

                  <button onClick={() => verDetalleMes(d.driver_id)} className="text-gray-400 hover:text-orange-500 flex items-center gap-1 text-xs">
                    Ver mes {expandido === d.driver_id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                </div>

                <div className="bg-gray-50 px-5 py-3 grid grid-cols-3 md:grid-cols-6 gap-2 text-xs">
                  {[
                    { label: "Entregas", valor: d.ingresos_entregas, green: true },
                    { label: "Retiros", valor: d.retiros_valor, green: true, suffix: ` (${d.retiros_cantidad})` },
                    { label: "Nómina", valor: d.nomina_semana, red: true },
                    { label: "Combustible", valor: d.combustible_semana, red: true },
                    { label: "TAG", valor: d.tag_semana, red: true },
                    { label: "Paquetes", valor: d.paquetes, isMoney: false },
                  ].map(({ label, valor, green, red, isMoney = true, suffix = "" }) => (
                    <div key={label}>
                      <p className="text-gray-400">{label}</p>
                      <p className={`font-semibold ${green ? "text-green-600" : red ? "text-red-500" : "text-gray-700"}`}>
                        {isMoney ? clp(valor) : valor.toLocaleString("es-CL")}{suffix}
                      </p>
                    </div>
                  ))}
                </div>

                {expandido === d.driver_id && detalle[d.driver_id] && (
                  <div className="border-t border-gray-100 px-5 py-4">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                      Serie del mes — {MESES_NOMBRES[detalle[d.driver_id].mes]} {detalle[d.driver_id].anio}
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-400 border-b">
                            <th className="py-1 text-left">Semana</th>
                            <th className="py-1 text-right">Paq.</th>
                            <th className="py-1 text-right">Entregas</th>
                            <th className="py-1 text-right">Retiros</th>
                            <th className="py-1 text-right">Nómina</th>
                            <th className="py-1 text-right">Comb.</th>
                            <th className="py-1 text-right">TAG</th>
                            <th className="py-1 text-right font-semibold">Neto</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {detalle[d.driver_id].serie_semanal.map(s => (
                            <tr key={s.semana} className="hover:bg-gray-50">
                              <td className="py-1.5">Sem. {s.semana} <span className="text-gray-400">({new Date(s.fecha_inicio + "T12:00:00").toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit" })})</span></td>
                              <td className="py-1.5 text-right">{s.paquetes}</td>
                              <td className="py-1.5 text-right text-green-600">{clp(s.ingresos_entregas)}</td>
                              <td className="py-1.5 text-right text-green-500">{clp(s.retiros_valor)}</td>
                              <td className="py-1.5 text-right text-red-500">{clp(s.nomina_semana)}</td>
                              <td className="py-1.5 text-right text-red-400">{clp(s.combustible_semana)}</td>
                              <td className="py-1.5 text-right text-red-400">{clp(s.tag_semana)}</td>
                              <td className={`py-1.5 text-right font-bold ${s.resultado_neto >= 0 ? "text-green-600" : "text-red-600"}`}>{clp(s.resultado_neto)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="border-t-2 border-gray-200 font-semibold">
                          <tr>
                            <td className="py-2">Total mes</td>
                            <td className="py-2 text-right">{detalle[d.driver_id].totales_mes.paquetes}</td>
                            <td className="py-2 text-right text-green-600">{clp(detalle[d.driver_id].totales_mes.ingresos_entregas)}</td>
                            <td className="py-2 text-right text-green-500">{clp(detalle[d.driver_id].totales_mes.retiros_valor)}</td>
                            <td className="py-2 text-right text-red-500">{clp(detalle[d.driver_id].totales_mes.nomina_mes)}</td>
                            <td className="py-2 text-right text-red-400">{clp(detalle[d.driver_id].totales_mes.combustible_mes)}</td>
                            <td className="py-2 text-right text-red-400">{clp(detalle[d.driver_id].totales_mes.tag_mes)}</td>
                            <td className={`py-2 text-right font-bold text-base ${detalle[d.driver_id].totales_mes.resultado_neto_mes >= 0 ? "text-green-600" : "text-red-600"}`}>
                              {clp(detalle[d.driver_id].totales_mes.resultado_neto_mes)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {data.drivers.length === 0 && (
              <div className="bg-white rounded-xl shadow px-4 py-8 text-center text-gray-400">
                No hay conductores contratados activos
              </div>
            )}
          </div>
        </>
      )}
      {!data && !loading && <div className="text-center text-gray-400 py-8">Sin datos para el período seleccionado</div>}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

const TABS = [
  { id: "general", label: "Vista General", icon: Users },
  { id: "contratados", label: "Contratados", icon: UserCheck },
];

export default function Rentabilidad() {
  const [tab, setTab] = useState("contratados");
  const [filters, setFilters] = useState({
    semana: "",
    mes: now.getMonth() + 1,
    anio: String(now.getFullYear()),
  });

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
        <TrendingUp size={24} /> Rentabilidad de Conductores
        <EtiquetaPeriodo semana={filters.semana} mes={filters.mes} anio={filters.anio} />
      </h1>

      <div className="flex gap-2 border-b border-gray-200">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === id ? "border-orange-500 text-orange-600" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      <FiltroPeriodo filters={filters} onChange={setFilters} />

      {tab === "general" && <VistaGeneral filters={filters} />}
      {tab === "contratados" && <VistaContratados filters={filters} />}
    </div>
  );
}
