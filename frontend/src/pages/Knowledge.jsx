import React, { useState, useEffect } from 'react';
import { BookOpen, Plus, Pencil, Trash2, X, Check, ChevronDown, ChevronUp } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../lib/api.js';

const TIPOS = [
  { value: 'faq',      label: 'FAQ',            color: 'text-blue-400 bg-blue-400/10 border-blue-400/20' },
  { value: 'politica', label: 'Política',        color: 'text-amber-400 bg-amber-400/10 border-amber-400/20' },
  { value: 'info',     label: 'Info general',    color: 'text-accent bg-accent/10 border-accent/20' },
  { value: 'otro',     label: 'Otro',            color: 'text-gray-400 bg-gray-400/10 border-gray-400/20' },
];

function tipoBadge(tipo) {
  const t = TIPOS.find((x) => x.value === tipo) || TIPOS[3];
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${t.color}`}>
      {t.label}
    </span>
  );
}

// ── Formulario de creación / edición ─────────────────────────────────────────
function KnowledgeForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState({
    titulo:    initial?.titulo    || '',
    tipo:      initial?.tipo      || 'faq',
    contenido: initial?.contenido || '',
  });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.titulo.trim() || !form.contenido.trim()) {
      toast.error('Título y contenido son requeridos');
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="glass-card p-5 space-y-4 animate-slide-up">
      <div className="grid grid-cols-[1fr_160px] gap-4">
        <div>
          <label className="form-label">TÍTULO</label>
          <input
            className="input-field"
            placeholder="ej: Política de devoluciones"
            value={form.titulo}
            onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))}
          />
        </div>
        <div>
          <label className="form-label">TIPO</label>
          <select
            className="input-field"
            value={form.tipo}
            onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value }))}
          >
            {TIPOS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="form-label">CONTENIDO</label>
        <textarea
          className="input-field min-h-[140px] resize-y"
          placeholder="Escribí la información tal como querés que el bot la use para responder..."
          value={form.contenido}
          onChange={(e) => setForm((f) => ({ ...f, contenido: e.target.value }))}
        />
        <p className="text-[10px] text-gray-600 mt-1">
          El bot usará este texto cuando un cliente pregunte sobre este tema.
        </p>
      </div>

      <div className="flex gap-3">
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? 'Guardando...' : initial ? 'Guardar cambios' : 'Agregar'}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary">
          Cancelar
        </button>
      </div>
    </form>
  );
}

// ── Tarjeta de artículo ───────────────────────────────────────────────────────
function KnowledgeCard({ item, onEdit, onDelete, onToggle }) {
  const [expanded, setExpanded] = useState(false);
  const preview = item.contenido.length > 120
    ? item.contenido.slice(0, 120) + '…'
    : item.contenido;

  return (
    <div className={`glass-card overflow-hidden transition-all ${!item.activo ? 'opacity-50' : ''}`}>
      <div className="flex items-start gap-3 px-5 py-4">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 text-left min-w-0"
        >
          <div className="flex items-center gap-2 mb-1">
            {tipoBadge(item.tipo)}
            <span className={`text-sm font-medium ${item.activo ? 'text-white' : 'text-gray-500'}`}>
              {item.titulo}
            </span>
          </div>
          {!expanded && (
            <p className="text-xs text-gray-500 leading-relaxed">{preview}</p>
          )}
          {expanded && (
            <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap mt-2">
              {item.contenido}
            </p>
          )}
        </button>

        <div className="flex items-center gap-1 shrink-0 ml-2">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button
            onClick={() => onToggle(item)}
            title={item.activo ? 'Desactivar' : 'Activar'}
            className={`p-1.5 transition-colors ${item.activo ? 'text-accent hover:text-accent/70' : 'text-gray-600 hover:text-gray-400'}`}
          >
            <Check size={14} />
          </button>
          <button
            onClick={() => onEdit(item)}
            className="p-1.5 text-gray-500 hover:text-blue-400 transition-colors"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={() => onDelete(item)}
            className="p-1.5 text-gray-500 hover:text-red-400 transition-colors"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function Knowledge() {
  const [items, setItems]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState(null); // item que se está editando

  async function fetchItems() {
    setLoading(true);
    try {
      const r = await api.get('/knowledge');
      setItems(r.data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchItems(); }, []);

  async function handleCreate(form) {
    await api.post('/knowledge', form);
    toast.success('Artículo agregado');
    setShowForm(false);
    fetchItems();
  }

  async function handleEdit(form) {
    await api.put(`/knowledge/${editing.id}`, form);
    toast.success('Artículo actualizado');
    setEditing(null);
    fetchItems();
  }

  async function handleToggle(item) {
    await api.put(`/knowledge/${item.id}`, { activo: !item.activo });
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, activo: !i.activo } : i))
    );
  }

  async function handleDelete(item) {
    if (!window.confirm(`¿Eliminar "${item.titulo}"?`)) return;
    await api.delete(`/knowledge/${item.id}`);
    toast.success('Artículo eliminado');
    setItems((prev) => prev.filter((i) => i.id !== item.id));
  }

  // Agrupar por tipo para mostrar en secciones
  const byTipo = TIPOS.map((t) => ({
    ...t,
    items: items.filter((i) => i.tipo === t.value),
  })).filter((t) => t.items.length > 0);

  const activeCount = items.filter((i) => i.activo).length;

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Conocimiento</h1>
          <p className="text-sm text-gray-500 mt-1">
            {activeCount} artículo(s) activo(s) · El bot usa esta información para responder
          </p>
        </div>
        <button
          onClick={() => { setShowForm((v) => !v); setEditing(null); }}
          className="btn-primary"
        >
          <Plus size={15} />
          Nuevo artículo
        </button>
      </div>

      {/* Formulario de creación */}
      {showForm && !editing && (
        <KnowledgeForm
          onSave={handleCreate}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Formulario de edición (reemplaza la tarjeta) */}
      {editing && (
        <KnowledgeForm
          initial={editing}
          onSave={handleEdit}
          onCancel={() => setEditing(null)}
        />
      )}

      {/* Lista */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton h-16 rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="glass-card p-12 text-center text-gray-500">
          <BookOpen size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Todavía no hay artículos de conocimiento.</p>
          <p className="text-xs mt-1 text-gray-600">
            Agregá políticas, FAQs o información de la empresa para que el bot las use.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {byTipo.map(({ value, label, items: grupo }) => (
            <div key={value}>
              <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
                {label} ({grupo.length})
              </h2>
              <div className="space-y-2">
                {grupo.map((item) =>
                  editing?.id === item.id ? null : (
                    <KnowledgeCard
                      key={item.id}
                      item={item}
                      onEdit={(i) => { setEditing(i); setShowForm(false); }}
                      onDelete={handleDelete}
                      onToggle={handleToggle}
                    />
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
