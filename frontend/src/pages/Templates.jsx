import React, { useState, useEffect } from 'react';
import { FileText, Plus, RefreshCw, ChevronDown, ChevronUp, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../lib/api.js';
import StatusBadge from '../components/StatusBadge.jsx';

const CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'];
const LANGUAGES  = ['es', 'es_AR', 'es_MX', 'en_US', 'pt_BR'];

function TemplateCard({ template }) {
  const [expanded, setExpanded] = useState(false);
  const bodyComp    = template.components?.find((c) => c.type === 'BODY');
  const headerComp  = template.components?.find((c) => c.type === 'HEADER');
  const footerComp  = template.components?.find((c) => c.type === 'FOOTER');
  const buttonsComp = template.components?.find((c) => c.type === 'BUTTONS');

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
              {buttonsComp && (
                <span className="text-[10px] text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded-full">
                  {buttonsComp.buttons?.length} botón(es)
                </span>
              )}
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
            <div className="mb-2">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Body</p>
              <p className="text-sm text-gray-200 whitespace-pre-wrap">{bodyComp.text}</p>
            </div>
          )}
          {footerComp && (
            <div className="mb-2">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Footer</p>
              <p className="text-xs text-gray-500">{footerComp.text}</p>
            </div>
          )}
          {buttonsComp?.buttons?.length > 0 && (
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Botones</p>
              <div className="flex gap-2 flex-wrap">
                {buttonsComp.buttons.map((btn, i) => (
                  <span key={i} className="text-xs text-blue-400 border border-blue-400/30 px-2 py-1 rounded-lg">
                    🔗 {btn.text}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NewTemplateForm({ onSuccess, onCancel }) {
  const [form, setForm] = useState({
    name: '',
    language: 'es_AR',
    category: 'MARKETING',
    bodyText: '',
    useFooter: false,
    footerText: '',
    useButtons: false,
    buttons: [{ text: '', url: '' }],
  });
  const [saving, setSaving] = useState(false);

  function update(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  function updateButton(idx, field, val) {
    setForm((f) => {
      const buttons = [...f.buttons];
      buttons[idx] = { ...buttons[idx], [field]: val };
      return { ...f, buttons };
    });
  }

  function addButton() {
    if (form.buttons.length < 2) {
      setForm((f) => ({ ...f, buttons: [...f.buttons, { text: '', url: '' }] }));
    }
  }

  function removeButton(idx) {
    setForm((f) => ({ ...f, buttons: f.buttons.filter((_, i) => i !== idx) }));
  }

  // Preview: reemplaza {{1}} con "Juan" para mostrar cómo se ve
  const previewText = form.bodyText.replace(/\{\{1\}\}/g, 'Juan');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name || !form.bodyText) {
      toast.error('Nombre y texto del mensaje son requeridos');
      return;
    }

    const components = [
      {
        type: 'BODY',
        text: form.bodyText,
        example: { body_text: [['Juan']] },
      },
    ];

    if (form.useFooter && form.footerText.trim()) {
      components.push({ type: 'FOOTER', text: form.footerText.trim() });
    }

    if (form.useButtons) {
      const validButtons = form.buttons.filter((b) => b.text.trim() && b.url.trim());
      if (validButtons.length > 0) {
        components.push({
          type: 'BUTTONS',
          buttons: validButtons.map((b) => ({
            type: 'URL',
            text: b.text.trim(),
            url: b.url.trim(),
          })),
        });
      }
    }

    setSaving(true);
    try {
      await api.post('/templates', {
        name: form.name.toLowerCase().replace(/\s+/g, '_'),
        language: form.language,
        category: form.category,
        components,
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
      <h3 className="font-display font-bold text-white mb-5">Nueva plantilla</h3>

      <div className="grid grid-cols-[1fr_280px] gap-6 items-start">
        {/* ── Formulario ── */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">NOMBRE</label>
              <input
                className="input-field"
                placeholder="promo_mayo_2026"
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
              />
              <p className="text-[10px] text-gray-600 mt-1">Solo minúsculas, sin espacios</p>
            </div>
            <div>
              <label className="form-label">IDIOMA</label>
              <select className="input-field" value={form.language} onChange={(e) => update('language', e.target.value)}>
                {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="form-label">CATEGORÍA</label>
            <select className="input-field" value={form.category} onChange={(e) => update('category', e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <p className="text-[10px] text-gray-600 mt-1">
              MARKETING → promos y campañas · UTILITY → confirmaciones / recordatorios
            </p>
          </div>

          <div>
            <label className="form-label">TEXTO DEL MENSAJE</label>
            <textarea
              className="input-field min-h-[120px] resize-y"
              placeholder="Hola {{1}}, tenemos una promo especial para vos..."
              value={form.bodyText}
              onChange={(e) => update('bodyText', e.target.value)}
            />
            <p className="text-xs text-accent mt-1">
              {`{{1}}`} se reemplaza con el nombre del contacto al enviar. Podés usar *negrita* y _cursiva_.
            </p>
          </div>

          {/* Footer */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.useFooter}
              onChange={(e) => update('useFooter', e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-gray-300">Agregar texto de pie de página (footer)</span>
          </label>
          {form.useFooter && (
            <input
              className="input-field"
              placeholder="ej: Respondé STOP para no recibir más mensajes"
              value={form.footerText}
              onChange={(e) => update('footerText', e.target.value)}
            />
          )}

          {/* Botones CTA */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.useButtons}
              onChange={(e) => update('useButtons', e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-gray-300">Agregar botones interactivos (Link)</span>
          </label>

          {form.useButtons && (
            <div className="space-y-3 pl-4 border-l-2 border-accent/30">
              {form.buttons.map((btn, idx) => (
                <div key={idx} className="flex gap-2 items-start">
                  <div className="flex-1 space-y-2">
                    <input
                      className="input-field"
                      placeholder="Texto del botón (ej: Ver tienda)"
                      value={btn.text}
                      onChange={(e) => updateButton(idx, 'text', e.target.value)}
                    />
                    <input
                      className="input-field"
                      placeholder="URL destino (ej: https://tutienda.com)"
                      value={btn.url}
                      onChange={(e) => updateButton(idx, 'url', e.target.value)}
                    />
                  </div>
                  {form.buttons.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeButton(idx)}
                      className="mt-2 text-gray-500 hover:text-red-400 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
              {form.buttons.length < 2 && (
                <button
                  type="button"
                  onClick={addButton}
                  className="text-xs text-accent hover:underline"
                >
                  + Agregar segundo botón
                </button>
              )}
              <p className="text-[10px] text-gray-600">
                Máximo 2 botones. Los botones de Link abren el navegador del usuario.
              </p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Enviando...' : 'Enviar a Meta para aprobación'}
            </button>
            <button type="button" onClick={onCancel} className="btn-secondary">
              Cancelar
            </button>
          </div>
        </form>

        {/* ── Preview ── */}
        <div className="space-y-3">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider">PREVIEW</p>

          <div className="bg-[#0b141a] rounded-xl p-4 min-h-[200px]">
            <div className="max-w-[240px] ml-auto space-y-1">
              {/* Burbuja principal */}
              <div className="bg-[#202c33] rounded-tl-2xl rounded-tr-sm rounded-b-2xl p-3 shadow-md">
                {form.bodyText ? (
                  <p className="text-[#e9edef] text-sm whitespace-pre-wrap leading-relaxed">
                    {previewText}
                  </p>
                ) : (
                  <p className="text-[#8696a0] text-sm italic">
                    El texto de tu mensaje aparecerá aquí…
                  </p>
                )}
                {form.useFooter && form.footerText && (
                  <p className="text-[#8696a0] text-xs mt-2 pt-2 border-t border-white/10">
                    {form.footerText}
                  </p>
                )}
                <p className="text-[#8696a0] text-[10px] text-right mt-2">11:30 ✓✓</p>
              </div>

              {/* Botones debajo de la burbuja */}
              {form.useButtons &&
                form.buttons
                  .filter((b) => b.text)
                  .map((btn, idx) => (
                    <div
                      key={idx}
                      className="bg-[#202c33] rounded-xl px-3 py-2 text-center border border-white/5"
                    >
                      <span className="text-[#53bdeb] text-sm">🔗 {btn.text}</span>
                    </div>
                  ))}
            </div>
          </div>

          <div className="space-y-1 text-[10px] text-gray-600">
            <p>● Meta revisa y aprueba cada plantilla (puede tardar minutos u horas).</p>
            <p>● Los botones de Link abren el navegador del usuario.</p>
            {form.category === 'MARKETING' && (
              <p>● Plantillas MARKETING requieren categoría MARKETING en Meta.</p>
            )}
          </div>
        </div>
      </div>
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
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-16 rounded-xl" />
          ))}
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
                {approved.map((t) => (
                  <TemplateCard key={`${t.name}-${t.language}`} template={t} />
                ))}
              </div>
            </div>
          )}
          {pending.length > 0 && (
            <div>
              <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
                Pendientes ({pending.length})
              </h2>
              <div className="space-y-2">
                {pending.map((t) => (
                  <TemplateCard key={`${t.name}-${t.language}`} template={t} />
                ))}
              </div>
            </div>
          )}
          {rest.length > 0 && (
            <div>
              <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
                Otras ({rest.length})
              </h2>
              <div className="space-y-2">
                {rest.map((t) => (
                  <TemplateCard key={`${t.name}-${t.language}`} template={t} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
