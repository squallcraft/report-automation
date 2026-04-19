import { useState, useEffect, useCallback } from "react";
import { Truck, Fuel, CreditCard, ArrowLeftRight, Plus, Trash2, Edit2, Save, X, ChevronDown, ChevronUp } from "lucide-react";

const API = import.meta.env.VITE_API_URL ?? "";
const token = () => localStorage.getItem("token");
const hdr = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${token()}` });

const clp = (n) => n != null ? `$${Number(n).toLocaleString("es-CL")}` : "—";
const fmtFecha = (s) => s ? new Date(s + "T12:00:00").toLocaleDateString("es-CL") : "—";

const TABS = [
  { id: "vehiculos", label: "Vehículos", icon: Truck },
  { id: "combustible", label: "Combustible", icon: Fuel },
  { id: "tag", label: "TAG / Peajes", icon: CreditCard },
  { id: "excepciones", label: "Cambios de vehículo", icon: ArrowLeftRight },
];

export default function Flota() {
  const [tab, setTab] = useState("vehiculos");

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
        <Truck size={24} /> Flota de Vehículos
      </h1>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === id
                ? "border-orange-500 text-orange-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {tab === "vehiculos" && <TabVehiculos />}
      {tab === "combustible" && <TabCombustible />}
      {tab === "tag" && <TabTag />}
      {tab === "excepciones" && <TabExcepciones />}
    </div>
  );
}

// ─── Tab Vehículos ───────────────────────────────────────────────────────────

function TabVehiculos() {
  const [vehiculos, setVehiculos] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [form, setForm] = useState(null); // null = cerrado
  const [editando, setEditando] = useState(null);
  const [loading, setLoading] = useState(false);

  const cargar = useCallback(async () => {
    const [v, d] = await Promise.all([
      fetch(`${API}/api/flota/vehiculos?solo_activos=false`, { headers: hdr() }).then(r => r.json()),
      fetch(`${API}/api/drivers`, { headers: hdr() }).then(r => r.json()),
    ]);
    setVehiculos(Array.isArray(v) ? v : []);
    setDrivers(Array.isArray(d) ? d : []);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const abrirNuevo = () => setForm({ patente: "", marca: "", modelo: "", anio: "", tipo: "furgon", color: "", notas: "", driver_id: "" });
  const cerrar = () => { setForm(null); setEditando(null); };

  const guardar = async () => {
    setLoading(true);
    try {
      const body = { ...form, anio: form.anio ? parseInt(form.anio) : null, driver_id: form.driver_id ? parseInt(form.driver_id) : null };
      const url = editando ? `${API}/api/flota/vehiculos/${editando}` : `${API}/api/flota/vehiculos`;
      const method = editando ? "PUT" : "POST";
      const r = await fetch(url, { method, headers: hdr(), body: JSON.stringify(body) });
      if (!r.ok) { const e = await r.json(); alert(e.detail || "Error"); return; }
      await cargar();
      cerrar();
    } finally { setLoading(false); }
  };

  const desactivar = async (patente) => {
    if (!confirm(`¿Desactivar vehículo ${patente}?`)) return;
    await fetch(`${API}/api/flota/vehiculos/${patente}`, { method: "DELETE", headers: hdr() });
    cargar();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={abrirNuevo} className="flex items-center gap-2 bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-orange-600">
          <Plus size={16} /> Agregar vehículo
        </button>
      </div>

      {/* Formulario */}
      {(form || editando) && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 space-y-3">
          <h3 className="font-semibold text-orange-800">{editando ? "Editar vehículo" : "Nuevo vehículo"}</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {!editando && (
              <div>
                <label className="text-xs text-gray-500">Patente *</label>
                <input className="input-field uppercase" value={form?.patente || ""} onChange={e => setForm(f => ({ ...f, patente: e.target.value.toUpperCase() }))} placeholder="BCDF-12" />
              </div>
            )}
            <div>
              <label className="text-xs text-gray-500">Marca</label>
              <input className="input-field" value={form?.marca || ""} onChange={e => setForm(f => ({ ...f, marca: e.target.value }))} placeholder="Toyota" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Modelo</label>
              <input className="input-field" value={form?.modelo || ""} onChange={e => setForm(f => ({ ...f, modelo: e.target.value }))} placeholder="Hiace" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Año</label>
              <input type="number" className="input-field" value={form?.anio || ""} onChange={e => setForm(f => ({ ...f, anio: e.target.value }))} placeholder="2022" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Tipo</label>
              <select className="input-field" value={form?.tipo || "furgon"} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}>
                {["furgon", "camioneta", "moto", "auto", "camion", "otro"].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500">Color</label>
              <input className="input-field" value={form?.color || ""} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} placeholder="Blanco" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Conductor asignado</label>
              <select className="input-field" value={form?.driver_id || ""} onChange={e => setForm(f => ({ ...f, driver_id: e.target.value }))}>
                <option value="">— Sin asignar —</option>
                {drivers.filter(d => d.activo).map(d => <option key={d.id} value={d.id}>{d.nombre}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-500">Notas</label>
              <input className="input-field" value={form?.notas || ""} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={cerrar} className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"><X size={14} /> Cancelar</button>
            <button onClick={guardar} disabled={loading} className="flex items-center gap-1 bg-orange-500 text-white px-4 py-1.5 text-sm rounded-lg hover:bg-orange-600 disabled:opacity-50">
              <Save size={14} /> Guardar
            </button>
          </div>
        </div>
      )}

      {/* Tabla */}
      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Patente</th>
              <th className="px-4 py-3 text-left">Vehículo</th>
              <th className="px-4 py-3 text-left">Tipo</th>
              <th className="px-4 py-3 text-left">Conductor asignado</th>
              <th className="px-4 py-3 text-center">Estado</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {vehiculos.map(v => (
              <tr key={v.patente} className={`hover:bg-gray-50 ${!v.activo ? "opacity-50" : ""}`}>
                <td className="px-4 py-3 font-mono font-semibold text-gray-800">{v.patente}</td>
                <td className="px-4 py-3 text-gray-700">{[v.marca, v.modelo, v.anio].filter(Boolean).join(" ")}</td>
                <td className="px-4 py-3 capitalize text-gray-500">{v.tipo}</td>
                <td className="px-4 py-3">
                  {v.driver_asignado
                    ? <span className="text-gray-800">{v.driver_asignado.nombre}</span>
                    : <span className="text-gray-400 italic">Sin asignar</span>}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${v.activo ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                    {v.activo ? "Activo" : "Inactivo"}
                  </span>
                </td>
                <td className="px-4 py-3 flex gap-2 justify-end">
                  <button onClick={() => { setForm({ ...v, driver_id: v.driver_asignado?.id || "" }); setEditando(v.patente); }} className="text-gray-400 hover:text-orange-500"><Edit2 size={15} /></button>
                  {v.activo && <button onClick={() => desactivar(v.patente)} className="text-gray-400 hover:text-red-500"><Trash2 size={15} /></button>}
                </td>
              </tr>
            ))}
            {vehiculos.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Sin vehículos registrados</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Tab Combustible ─────────────────────────────────────────────────────────

function TabCombustible() {
  const [registros, setRegistros] = useState([]);
  const [vehiculos, setVehiculos] = useState([]);
  const [form, setForm] = useState(null);
  const [filtros, setFiltros] = useState({ mes: new Date().getMonth() + 1, anio: new Date().getFullYear() });
  const [loading, setLoading] = useState(false);

  const cargar = useCallback(async () => {
    const params = new URLSearchParams({ mes: filtros.mes, anio: filtros.anio });
    const [r, v] = await Promise.all([
      fetch(`${API}/api/flota/combustible?${params}`, { headers: hdr() }).then(r => r.json()),
      fetch(`${API}/api/flota/vehiculos`, { headers: hdr() }).then(r => r.json()),
    ]);
    setRegistros(Array.isArray(r) ? r : []);
    setVehiculos(Array.isArray(v) ? v : []);
  }, [filtros]);

  useEffect(() => { cargar(); }, [cargar]);

  const guardar = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/flota/combustible`, {
        method: "POST", headers: hdr(),
        body: JSON.stringify({ ...form, monto_total: parseInt(form.monto_total || 0), litros: form.litros ? parseFloat(form.litros) : null }),
      });
      if (!r.ok) { const e = await r.json(); alert(e.detail || "Error"); return; }
      await cargar(); setForm(null);
    } finally { setLoading(false); }
  };

  const eliminar = async (id) => {
    if (!confirm("¿Eliminar registro?")) return;
    await fetch(`${API}/api/flota/combustible/${id}`, { method: "DELETE", headers: hdr() });
    cargar();
  };

  const total = registros.reduce((s, r) => s + r.monto_total, 0);

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <select className="input-field w-32" value={filtros.mes} onChange={e => setFiltros(f => ({ ...f, mes: parseInt(e.target.value) }))}>
          {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{new Date(2000, i).toLocaleString("es-CL", { month: "long" })}</option>)}
        </select>
        <input type="number" className="input-field w-24" value={filtros.anio} onChange={e => setFiltros(f => ({ ...f, anio: parseInt(e.target.value) }))} />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-gray-500">Total mes:</span>
          <span className="font-bold text-orange-600">{clp(total)}</span>
          <button onClick={() => setForm({ patente: "", fecha: new Date().toISOString().slice(0, 10), litros: "", monto_total: "", proveedor: "", notas: "" })} className="flex items-center gap-1 bg-orange-500 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-orange-600">
            <Plus size={15} /> Registrar
          </button>
        </div>
      </div>

      {/* Formulario */}
      {form && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 space-y-3">
          <h3 className="font-semibold text-orange-800">Nuevo registro de combustible</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-gray-500">Vehículo (patente) *</label>
              <select className="input-field" value={form.patente} onChange={e => setForm(f => ({ ...f, patente: e.target.value }))}>
                <option value="">Seleccionar…</option>
                {vehiculos.map(v => <option key={v.patente} value={v.patente}>{v.patente} — {v.driver_asignado?.nombre || "Sin conductor"}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500">Fecha *</label>
              <input type="date" className="input-field" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-500">Monto total ($) *</label>
              <input type="number" className="input-field" value={form.monto_total} onChange={e => setForm(f => ({ ...f, monto_total: e.target.value }))} placeholder="45000" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Litros</label>
              <input type="number" step="0.01" className="input-field" value={form.litros} onChange={e => setForm(f => ({ ...f, litros: e.target.value }))} placeholder="38.5" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Proveedor</label>
              <input className="input-field" value={form.proveedor} onChange={e => setForm(f => ({ ...f, proveedor: e.target.value }))} placeholder="Copec" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Notas</label>
              <input className="input-field" value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setForm(null)} className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"><X size={14} /> Cancelar</button>
            <button onClick={guardar} disabled={loading} className="flex items-center gap-1 bg-orange-500 text-white px-4 py-1.5 text-sm rounded-lg hover:bg-orange-600 disabled:opacity-50"><Save size={14} /> Guardar</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Fecha</th>
              <th className="px-4 py-3 text-left">Patente</th>
              <th className="px-4 py-3 text-left">Conductor</th>
              <th className="px-4 py-3 text-left">Proveedor</th>
              <th className="px-4 py-3 text-right">Litros</th>
              <th className="px-4 py-3 text-right">Monto</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {registros.map(r => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-4 py-2">{fmtFecha(r.fecha)}</td>
                <td className="px-4 py-2 font-mono text-gray-700">{r.patente}</td>
                <td className="px-4 py-2">{r.driver_nombre || <span className="text-gray-400 italic">No resuelto</span>}</td>
                <td className="px-4 py-2 text-gray-500">{r.proveedor || "—"}</td>
                <td className="px-4 py-2 text-right">{r.litros ? `${r.litros} L` : "—"}</td>
                <td className="px-4 py-2 text-right font-semibold">{clp(r.monto_total)}</td>
                <td className="px-4 py-2"><button onClick={() => eliminar(r.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={14} /></button></td>
              </tr>
            ))}
            {registros.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Sin registros</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Tab TAG ─────────────────────────────────────────────────────────────────

function TabTag() {
  const [registros, setRegistros] = useState([]);
  const [vehiculos, setVehiculos] = useState([]);
  const [form, setForm] = useState(null);
  const [expandido, setExpandido] = useState(null);
  const [loading, setLoading] = useState(false);

  const cargar = useCallback(async () => {
    const [r, v] = await Promise.all([
      fetch(`${API}/api/flota/tag`, { headers: hdr() }).then(r => r.json()),
      fetch(`${API}/api/flota/vehiculos`, { headers: hdr() }).then(r => r.json()),
    ]);
    setRegistros(Array.isArray(r) ? r : []);
    setVehiculos(Array.isArray(v) ? v : []);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const guardar = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/flota/tag`, {
        method: "POST", headers: hdr(),
        body: JSON.stringify({ ...form, monto_total: parseInt(form.monto_total || 0), numero_transacciones: form.numero_transacciones ? parseInt(form.numero_transacciones) : null }),
      });
      if (!r.ok) { const e = await r.json(); alert(e.detail || "Error"); return; }
      await cargar(); setForm(null);
    } finally { setLoading(false); }
  };

  const eliminar = async (id) => {
    if (!confirm("¿Eliminar registro TAG?")) return;
    await fetch(`${API}/api/flota/tag/${id}`, { method: "DELETE", headers: hdr() });
    cargar();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setForm({ patente: "", fecha_inicio_periodo: "", fecha_fin_periodo: "", monto_total: "", numero_transacciones: "", proveedor: "", notas: "" })} className="flex items-center gap-1 bg-orange-500 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-orange-600">
          <Plus size={15} /> Registrar TAG
        </button>
      </div>

      {form && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 space-y-3">
          <h3 className="font-semibold text-orange-800">Nuevo registro TAG</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-gray-500">Vehículo (patente) *</label>
              <select className="input-field" value={form.patente} onChange={e => setForm(f => ({ ...f, patente: e.target.value }))}>
                <option value="">Seleccionar…</option>
                {vehiculos.map(v => <option key={v.patente} value={v.patente}>{v.patente} — {v.driver_asignado?.nombre || "Sin conductor"}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500">Inicio período *</label>
              <input type="date" className="input-field" value={form.fecha_inicio_periodo} onChange={e => setForm(f => ({ ...f, fecha_inicio_periodo: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-500">Fin período *</label>
              <input type="date" className="input-field" value={form.fecha_fin_periodo} onChange={e => setForm(f => ({ ...f, fecha_fin_periodo: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-500">Monto total ($) *</label>
              <input type="number" className="input-field" value={form.monto_total} onChange={e => setForm(f => ({ ...f, monto_total: e.target.value }))} placeholder="42000" />
            </div>
            <div>
              <label className="text-xs text-gray-500">N° transacciones</label>
              <input type="number" className="input-field" value={form.numero_transacciones} onChange={e => setForm(f => ({ ...f, numero_transacciones: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-500">Proveedor autopista</label>
              <input className="input-field" value={form.proveedor} onChange={e => setForm(f => ({ ...f, proveedor: e.target.value }))} placeholder="Autopista Central" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-500">Notas</label>
              <input className="input-field" value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setForm(null)} className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"><X size={14} /> Cancelar</button>
            <button onClick={guardar} disabled={loading} className="flex items-center gap-1 bg-orange-500 text-white px-4 py-1.5 text-sm rounded-lg hover:bg-orange-600 disabled:opacity-50"><Save size={14} /> Guardar</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {registros.map(r => (
          <div key={r.id} className="bg-white rounded-xl shadow">
            <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={() => setExpandido(expandido === r.id ? null : r.id)}>
              <span className="font-mono font-bold text-gray-700 w-24">{r.patente}</span>
              <span className="text-gray-500 text-sm">{fmtFecha(r.fecha_inicio_periodo)} → {fmtFecha(r.fecha_fin_periodo)}</span>
              <span className="text-gray-500 text-sm">{r.proveedor || "—"}</span>
              <span className="ml-auto font-bold text-orange-600">{clp(r.monto_total)}</span>
              {r.numero_transacciones && <span className="text-xs text-gray-400">{r.numero_transacciones} tx</span>}
              {expandido === r.id ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
              <button onClick={e => { e.stopPropagation(); eliminar(r.id); }} className="text-gray-300 hover:text-red-500"><Trash2 size={14} /></button>
            </div>
            {expandido === r.id && r.atribucion && (
              <div className="border-t border-gray-100 px-4 py-3">
                <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Atribución por conductor</p>
                <div className="space-y-1">
                  {r.atribucion.map((a, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm">
                      <span className="w-40 text-gray-700">{a.driver_nombre}</span>
                      <span className="text-gray-500">{a.dias} día{a.dias !== 1 ? "s" : ""}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-2">
                        <div className="bg-orange-400 h-2 rounded-full" style={{ width: `${a.porcentaje}%` }} />
                      </div>
                      <span className="text-gray-500 text-xs">{a.porcentaje}%</span>
                      <span className="font-semibold w-24 text-right">{clp(a.monto_atribuido)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
        {registros.length === 0 && <div className="bg-white rounded-xl shadow px-4 py-8 text-center text-gray-400">Sin registros TAG</div>}
      </div>
    </div>
  );
}

// ─── Tab Excepciones ─────────────────────────────────────────────────────────

function TabExcepciones() {
  const [excepciones, setExcepciones] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [vehiculos, setVehiculos] = useState([]);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(false);

  const cargar = useCallback(async () => {
    const [e, d, v] = await Promise.all([
      fetch(`${API}/api/flota/excepciones`, { headers: hdr() }).then(r => r.json()),
      fetch(`${API}/api/drivers`, { headers: hdr() }).then(r => r.json()),
      fetch(`${API}/api/flota/vehiculos`, { headers: hdr() }).then(r => r.json()),
    ]);
    setExcepciones(Array.isArray(e) ? e : []);
    setDrivers(Array.isArray(d) ? d : []);
    setVehiculos(Array.isArray(v) ? v : []);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const guardar = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/flota/excepciones`, {
        method: "POST", headers: hdr(),
        body: JSON.stringify({ ...form, driver_id: parseInt(form.driver_id) }),
      });
      if (!r.ok) { const e = await r.json(); alert(e.detail || "Error"); return; }
      await cargar(); setForm(null);
    } finally { setLoading(false); }
  };

  const eliminar = async (id) => {
    if (!confirm("¿Eliminar excepción?")) return;
    await fetch(`${API}/api/flota/excepciones/${id}`, { method: "DELETE", headers: hdr() });
    cargar();
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">
        Registra aquí solo los días en que un conductor usó un vehículo distinto al asignado por defecto en su perfil. El sistema prorratea automáticamente los costos de combustible y TAG según esta información.
      </div>
      <div className="flex justify-end">
        <button onClick={() => setForm({ driver_id: "", patente: "", fecha: new Date().toISOString().slice(0, 10), motivo: "" })} className="flex items-center gap-1 bg-orange-500 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-orange-600">
          <Plus size={15} /> Registrar cambio
        </button>
      </div>

      {form && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 space-y-3">
          <h3 className="font-semibold text-orange-800">Cambio de vehículo puntual</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-gray-500">Conductor *</label>
              <select className="input-field" value={form.driver_id} onChange={e => setForm(f => ({ ...f, driver_id: e.target.value }))}>
                <option value="">Seleccionar…</option>
                {drivers.filter(d => d.activo).map(d => <option key={d.id} value={d.id}>{d.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500">Vehículo usado *</label>
              <select className="input-field" value={form.patente} onChange={e => setForm(f => ({ ...f, patente: e.target.value }))}>
                <option value="">Seleccionar…</option>
                {vehiculos.map(v => <option key={v.patente} value={v.patente}>{v.patente} — {v.driver_asignado?.nombre || "Sin conductor habitual"}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500">Fecha *</label>
              <input type="date" className="input-field" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-500">Motivo</label>
              <input className="input-field" value={form.motivo} onChange={e => setForm(f => ({ ...f, motivo: e.target.value }))} placeholder="Vehículo habitual en mantención" />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setForm(null)} className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"><X size={14} /> Cancelar</button>
            <button onClick={guardar} disabled={loading} className="flex items-center gap-1 bg-orange-500 text-white px-4 py-1.5 text-sm rounded-lg hover:bg-orange-600 disabled:opacity-50"><Save size={14} /> Guardar</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">Fecha</th>
              <th className="px-4 py-3 text-left">Conductor</th>
              <th className="px-4 py-3 text-left">Vehículo usado</th>
              <th className="px-4 py-3 text-left">Motivo</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {excepciones.map(e => (
              <tr key={e.id} className="hover:bg-gray-50">
                <td className="px-4 py-2">{fmtFecha(e.fecha)}</td>
                <td className="px-4 py-2 font-medium">{e.driver_nombre}</td>
                <td className="px-4 py-2 font-mono text-orange-600">{e.patente}</td>
                <td className="px-4 py-2 text-gray-500">{e.motivo || "—"}</td>
                <td className="px-4 py-2 text-right"><button onClick={() => eliminar(e.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={14} /></button></td>
              </tr>
            ))}
            {excepciones.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Sin cambios registrados</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
