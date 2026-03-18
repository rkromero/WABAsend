import React, { useState, useEffect } from 'react';
import { FileText, Plus, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../lib/api.js';
import StatusBadge from '../components/StatusBadge.jsx';

const CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'];
const LANGUAGES  = ['es', 'es_AR', 'es_MX', 'en_US', 'pt_BR'];

function TemplateCard({ template }) {
  const [expanded, setExpanded] = useState(false);
  const bodyComp = template.components?.find((c) => c.type === 'BODY');
  const headerComp = template.components?.find((c) => c.type === 'HEADER');

  return (
    <div className="glass-card overflow-hidden transition-all duration-200">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-base-elevated border border-base-border flex items-center justify-center shrink-0">
            <FileText size={14} className="text-gray-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">{template.name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-gray-500 bg-base-elevated px-2 py-0.5 rounded-full">
                {template.language}
              </span>
              <span className="text-[10px] text-gray-500">{template.category}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <StatusBadge status={template.status} size="sm" />
          {expanded ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-4 border-t border-base-border pt-3 animate-fade-in">
          {headerComp && (
            <div className="mb-2">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Header</p>
              <p className="text-xs text-gray-400">{headerComp.text || headerComp.format}</p>
            </div>
          )}
          {bodyComp && (
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Body</p>
              <p className="text-sm text-gray-200 whitespace-pre-wrap">{bodyComp.text}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NewTemplateForm({ onSuccess, onCancel }) {
  const [form, setForm] = useState({
    name: '', language: 'es_AR', category: 'MARKETING', bodyText: '',
  });
  const [saving, setSaving] = useState(false);

  function update(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name || !form.bodyText) {
      toast.error('Nombre y texto del mensaje son requeridos');
      return;
    }

    setSaving(true);
    try {
      await api.post('/templates', {
        name: form.name.toLowerCase().replace(/\s+/g, '_'),
        language: form.language,
        category: form.category,
        components: [
          {
            type: 'BODY',
            text: form.bodyText,
            example: { body_text: [['Juan']] },
          },
        ],
      });
      toast.success('Plantilla enviada a Meta para aprobación');
      onSuccess?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="glass-card p-5 animate-slide-up">
      <h3 className="font-display font-bold text-white mb-4">Nueva plantilla</h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="form-label">Nombre (en snake_case)</label>
            <input
              className="input-field"
              placeholder="promo_mayo_2026"
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
            />
          </div>
          <div>
            <label className="form-label">Idioma</label>
            <select
              className="input-field"
              value={form.language}
              onChange={(e) => update('language', e.target.value)}
            >
              {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="form-label">Categoría</label>
          <select
            className="input-field"
            value={form.category}
            onChange={(e) => update('category', e.target.value)}
          >
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div>
          <label className="form-label">
            Texto del mensaje — usá {'{{'}<span>1</span>{'}}'}  para el nombre del cliente
          </label>
          <textarea
            className="input-field min-h-[100px] resize-y"
            placeholder="Hola {{1}}, tenemos una promo especial para vos..."
            value={form.bodyText}
            onChange={(e) => update('bodyText', e.target.value)}
          />
          <p className="text-xs text-gray-600 mt-1">
            {`{{1}}`} se reemplazará con el nombre del contacto al enviar.
          </p>
        </div>

        <div className="flex gap-3">
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Enviando...' : 'Enviar a Meta'}
          </button>
          <button type="button" onClick={onCancel} className="btn-secondary">
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}

export default function Templates() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);

  async function fetchTemplates() {
    setLoading(true);
    try {
      const r = await api.get('/templates');
      setTemplates(r.data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchTemplates(); }, []);

  const approved = templates.filter((t) => t.status === 'APPROVED');
  const pending  = templates.filter((t) => t.status === 'PENDING');
  const rest     = templates.filter((t) => !['APPROVED', 'PENDING'].includes(t.status));

  return (
    <div className="space-y-6 animate-slide-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Plantillas</h1>
          <p className="text-sm text-gray-500 mt-1">{templates.length} plantilla(s) en tu WABA</p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchTemplates} className="btn-secondary">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Actualizar
          </button>
          <button onClick={() => setShowForm((v) => !v)} className="btn-primary">
            <Plus size={15} />
            Nueva plantilla
          </button>
        </div>
      </div>

      {showForm && (
        <NewTemplateForm
          onSuccess={() => { setShowForm(false); fetchTemplates(); }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-16 rounded-xl" />)}
        </div>
      ) : templates.length === 0 ? (
        <div className="glass-card p-12 text-center text-gray-500">
          <FileText size={32} className="mx-auto mb-3 opacity-30" />
          <p>No se encontraron plantillas. Verificá tu configuración de WABA.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {approved.length > 0 && (
            <div>
              <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
                Aprobadas ({approved.length})
              </h2>
              <div className="space-y-2">
                {approved.map((t) => <TemplateCard key={`${t.name}-${t.language}`} template={t} />)}
              </div>
            </div>
          )}
          {pending.length > 0 && (
            <div>
              <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
                Pendientes ({pending.length})
              </h2>
              <div className="space-y-2">
                {pending.map((t) => <TemplateCard key={`${t.name}-${t.language}`} template={t} />)}
              </div>
            </div>
          )}
          {rest.length > 0 && (
            <div>
              <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
                Otras ({rest.length})
              </h2>
              <div className="space-y-2">
                {rest.map((t) => <TemplateCard key={`${t.name}-${t.language}`} template={t} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
