import React, { useState, useEffect } from 'react';
import {
  FileText, Plus, RefreshCw, ChevronDown, ChevronUp,
  ExternalLink, Phone, CornerDownLeft, Trash2, PlusCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../lib/api.js';
import StatusBadge from '../components/StatusBadge.jsx';

const CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'];
const LANGUAGES  = ['es', 'es_AR', 'es_MX', 'en_US', 'pt_BR'];

// Meta permite 3 tipos de botones en plantillas
const BUTTON_TYPES = [
  { value: 'URL',          label: 'Link / URL',        icon: ExternalLink, hint: 'Abre una URL en el navegador' },
  { value: 'PHONE_NUMBER', label: 'Llamada',            icon: Phone,        hint: 'Llama a un número de teléfono' },
  { value: 'QUICK_REPLY',  label: 'Respuesta rápida',  icon: CornerDownLeft, hint: 'Respuesta de un toque sin campo extra' },
];

// ── Ícono por tipo de botón ────────────────────────────────────────────────────
function BtnIcon({ type, size = 11 }) {
  if (type === 'URL')          return <ExternalLink  size={size} />;
  if (type === 'PHONE_NUMBER') return <Phone         size={size} />;
  if (type === 'QUICK_REPLY')  return <CornerDownLeft size={size} />;
  return null;
}

// ── Tarjeta de plantilla existente ────────────────────────────────────────────
function TemplateCard({ template }) {
  const [expanded, setExpanded] = useState(false);
  const headerComp  = template.components?.find((c) => c.type === 'HEADER');
  const bodyComp    = template.components?.find((c) => c.type === 'BODY');
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
              {buttonsComp?.buttons?.length > 0 && (
                <span className="text-[10px] text-blue-400 bg-blue-400/8 border border-blue-400/20 px-2 py-0.5 rounded-full">
                  {buttonsComp.buttons.length} botón{buttonsComp.buttons.length > 1 ? 'es' : ''}
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
        <div className="px-5 pb-4 border-t border-base-border pt-4 space-y-3 animate-fade-in">
          {headerComp && (
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Header</p>
              <p className="text-xs text-gray-400">{headerComp.text || headerComp.format}</p>
            </div>
          )}

          {bodyComp && (
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Mensaje</p>
              <p className="text-sm text-gray-200 whitespace-pre-wrap">{bodyComp.text}</p>
            </div>
          )}

          {footerComp && (
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Footer</p>
              <p className="text-xs text-gray-500 italic">{footerComp.text}</p>
            </div>
          )}

          {buttonsComp?.buttons?.length > 0 && (
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Botones</p>
              <div className="flex flex-wrap gap-2">
                {buttonsComp.buttons.map((b, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-base-border bg-base-elevated text-xs text-gray-300"
                  >
                    <BtnIcon type={b.type} size={11} />
                    <span className="font-medium">{b.text}</span>
                    {b.url && (
                      <a
                        href={b.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-400 hover:underline truncate max-w-[160px]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {b.url}
                      </a>
                    )}
                    {b.phone_number && (
                      <span className="text-gray-500">{b.phone_number}</span>
                    )}
                    <span className="text-gray-600 ml-1 text-[10px]">
                      {BUTTON_TYPES.find((t) => t.value === b.type)?.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Fila de un botón en el formulario ─────────────────────────────────────────
function ButtonRow({ btn, index, onChange, onRemove, error }) {
  const TypeIcon = BUTTON_TYPES.find((t) => t.value === btn.type)?.icon || ExternalLink;

  return (
    <div className={`p-3 rounded-lg border space-y-2 ${error ? 'border-red-500/30 bg-red-500/5' : 'border-base-border bg-base-elevated'}`}>
      <div className="flex items-center gap-2">
        {/* Selector de tipo */}
        <div className="flex gap-1 flex-1 flex-wrap">
          {BUTTON_TYPES.map((t) => {
            const Icon = t.icon;
            const active = btn.type === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => onChange(index, 'type', t.value)}
                title={t.hint}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border transition-all ${
                  active
                    ? 'border-accent text-accent bg-accent/10'
                    : 'border-base-border text-gray-500 hover:border-white/20 hover:text-gray-300'
                }`}
              >
                <Icon size={11} />
                {t.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => onRemove(index)}
          className="text-gray-600 hover:text-red-400 transition-colors p-1"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Texto del botón */}
      <input
        className="input-field text-sm"
        placeholder="Texto del botón (máx. 25 caracteres)"
        maxLength={25}
        value={btn.text}
        onChange={(e) => onChange(index, 'text', e.target.value)}
      />

      {/* Campo adicional según tipo */}
      {btn.type === 'URL' && (
        <input
          className="input-field text-sm font-mono"
          placeholder="https://tutienda.com/promo"
          value={btn.url || ''}
          onChange={(e) => onChange(index, 'url', e.target.value)}
        />
      )}
      {btn.type === 'PHONE_NUMBER' && (
        <input
          className="input-field text-sm font-mono"
          placeholder="+5491112345678"
          value={btn.phone_number || ''}
          onChange={(e) => onChange(index, 'phone_number', e.target.value)}
        />
      )}
      {/* QUICK_REPLY no necesita campo extra */}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

// ── Formulario de nueva plantilla ─────────────────────────────────────────────
function NewTemplateForm({ onSuccess, onCancel }) {
  const [form, setForm] = useState({
    name: '', language: 'es_AR', category: 'MARKETING', bodyText: '',
    footerText: '',  // footer opcional
    useFooter: false,
  });
  const [buttons, setButtons]     = useState([]);
  const [useButtons, setUseButtons] = useState(false);
  const [btnErrors, setBtnErrors] = useState({});
  const [saving, setSaving]       = useState(false);

  function update(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  function addButton() {
    if (buttons.length >= 3) {
      toast.error('Meta permite un máximo de 3 botones por plantilla');
      return;
    }
    setButtons((prev) => [...prev, { type: 'URL', text: '', url: '' }]);
  }

  function removeButton(i) {
    setButtons((prev) => prev.filter((_, idx) => idx !== i));
    setBtnErrors((prev) => {
      const next = { ...prev };
      delete next[i];
      return next;
    });
  }

  function updateButton(i, field, value) {
    setButtons((prev) =>
      prev.map((b, idx) => idx === i ? { ...b, [field]: value } : b)
    );
  }

  function validateButtons() {
    const errors = {};
    buttons.forEach((b, i) => {
      if (!b.text.trim()) {
        errors[i] = 'El texto del botón es requerido';
      } else if (b.type === 'URL' && !b.url?.trim()) {
        errors[i] = 'La URL es requerida para botones de tipo Link';
      } else if (b.type === 'URL' && !/^https?:\/\/.+/.test(b.url.trim())) {
        errors[i] = 'La URL debe comenzar con http:// o https://';
      } else if (b.type === 'PHONE_NUMBER' && !b.phone_number?.trim()) {
        errors[i] = 'El número de teléfono es requerido';
      }
    });
    setBtnErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (!form.name || !form.bodyText) {
      toast.error('Nombre y texto del mensaje son requeridos');
      return;
    }

    if (useButtons && buttons.length > 0 && !validateButtons()) {
      toast.error('Revisá los errores en los botones');
      return;
    }

    // Construir componentes para Meta
    const components = [
      {
        type: 'BODY',
        text: form.bodyText,
        // Le indicamos a Meta que {{1}} se reemplazará con un nombre de ejemplo
        example: { body_text: [['Juan']] },
      },
    ];

    if (form.useFooter && form.footerText.trim()) {
      components.push({ type: 'FOOTER', text: form.footerText.trim() });
    }

    if (useButtons && buttons.length > 0) {
      const validButtons = buttons
        .filter((b) => b.text.trim())
        .map((b) => {
          if (b.type === 'URL') {
            return { type: 'URL', text: b.text.trim(), url: b.url.trim() };
          }
          if (b.type === 'PHONE_NUMBER') {
            return { type: 'PHONE_NUMBER', text: b.text.trim(), phone_number: b.phone_number.trim() };
          }
          // QUICK_REPLY
          return { type: 'QUICK_REPLY', text: b.text.trim() };
        });

      if (validButtons.length > 0) {
        components.push({ type: 'BUTTONS', buttons: validButtons });
      }
    }

    setSaving(true);
    try {
      await api.post('/templates', {
        name:       form.name.toLowerCase().replace(/\s+/g, '_'),
        language:   form.language,
        category:   form.category,
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

  // Preview visual de cómo quedará en WhatsApp
  const previewText = form.bodyText.replace(/\{\{1\}\}/g, 'Juan');

  return (
    <div className="glass-card p-5 animate-slide-up">
      <h3 className="font-display font-bold text-white mb-5">Nueva plantilla</h3>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">

        {/* ── Formulario ── */}
        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Nombre + idioma */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Nombre</label>
              <input
                className="input-field"
                placeholder="promo_mayo_2026"
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
              />
              <p className="text-xs text-gray-600 mt-1">Solo minúsculas, sin espacios</p>
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

          {/* Categoría */}
          <div>
            <label className="form-label">Categoría</label>
            <select
              className="input-field"
              value={form.category}
              onChange={(e) => update('category', e.target.value)}
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <p className="text-xs text-gray-600 mt-1">
              <strong className="text-gray-500">MARKETING</strong> → promos y campañas ·{' '}
              <strong className="text-gray-500">UTILITY</strong> → confirmaciones / recordatorios
            </p>
          </div>

          {/* Texto del cuerpo */}
          <div>
            <label className="form-label">
              Texto del mensaje
            </label>
            <textarea
              className="input-field min-h-[100px] resize-y"
              placeholder="Hola {{1}}, tenemos una promo especial para vos 🎉"
              value={form.bodyText}
              onChange={(e) => update('bodyText', e.target.value)}
            />
            <p className="text-xs text-gray-600 mt-1">
              <code className="text-accent/70">{'{{1}}'}</code> se reemplaza con el nombre del contacto al enviar.
              Podés usar <em>*negrita*</em> y _cursiva_.
            </p>
          </div>

          {/* Footer opcional */}
          <div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.useFooter}
                onChange={(e) => update('useFooter', e.target.checked)}
                className="accent-accent"
              />
              <span className="text-sm text-gray-400">Agregar texto de pie de página (footer)</span>
            </label>
            {form.useFooter && (
              <input
                className="input-field mt-2 text-sm"
                placeholder="Ej: Para darte de baja respondé STOP"
                value={form.footerText}
                maxLength={60}
                onChange={(e) => update('footerText', e.target.value)}
              />
            )}
          </div>

          {/* ── Botones CTA ── */}
          <div className="border border-base-border rounded-xl p-4 space-y-3">
            <label className="flex items-center justify-between cursor-pointer select-none">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={useButtons}
                  onChange={(e) => {
                    setUseButtons(e.target.checked);
                    if (!e.target.checked) { setButtons([]); setBtnErrors({}); }
                    else if (buttons.length === 0) addButton();
                  }}
                  className="accent-accent"
                />
                <span className="text-sm font-medium text-gray-300">Agregar botones interactivos</span>
              </div>
              {useButtons && (
                <span className="text-xs text-gray-600">{buttons.length}/3 botones</span>
              )}
            </label>

            {useButtons && (
              <div className="space-y-2">
                {buttons.map((btn, i) => (
                  <ButtonRow
                    key={i}
                    btn={btn}
                    index={i}
                    onChange={updateButton}
                    onRemove={removeButton}
                    error={btnErrors[i]}
                  />
                ))}

                {buttons.length < 3 && (
                  <button
                    type="button"
                    onClick={addButton}
                    className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-300 transition-colors py-1"
                  >
                    <PlusCircle size={13} />
                    Agregar otro botón
                  </button>
                )}

                <p className="text-xs text-gray-600">
                  Meta permite hasta 3 botones por plantilla. Los botones de tipo <em>Link</em> y <em>Llamada</em>
                  son CTA (call-to-action). Combiná tipos según tu necesidad.
                </p>
              </div>
            )}
          </div>

          {/* Acciones */}
          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Enviando a Meta...' : 'Enviar a Meta para aprobación'}
            </button>
            <button type="button" onClick={onCancel} className="btn-secondary">
              Cancelar
            </button>
          </div>
        </form>

        {/* ── Preview estilo WhatsApp ── */}
        <div className="hidden lg:block">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Preview</p>
          <div className="bg-[#0b141a] rounded-xl p-4 min-h-[200px]">
            {/* Burbuja del mensaje */}
            <div className="max-w-[240px] ml-auto">
              <div className="bg-[#202c33] rounded-tl-2xl rounded-tr-sm rounded-b-2xl p-3 shadow-md">
                {form.bodyText ? (
                  <p className="text-[#e9edef] text-sm whitespace-pre-wrap leading-relaxed">
                    {previewText}
                  </p>
                ) : (
                  <p className="text-[#8696a0] text-sm italic">El texto de tu mensaje aparecerá aquí…</p>
                )}

                {form.useFooter && form.footerText && (
                  <p className="text-[#8696a0] text-xs mt-2">{form.footerText}</p>
                )}

                <p className="text-[#8696a0] text-[10px] text-right mt-1.5">11:30 ✓✓</p>
              </div>

              {/* Botones en el preview */}
              {useButtons && buttons.filter((b) => b.text.trim()).length > 0 && (
                <div className="mt-1 space-y-1">
                  {buttons.filter((b) => b.text.trim()).map((b, i) => (
                    <div
                      key={i}
                      className="bg-[#202c33] rounded-xl px-3 py-2.5 flex items-center justify-center gap-2 text-[#00a884] text-sm font-medium"
                    >
                      <BtnIcon type={b.type} size={14} />
                      {b.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 space-y-1.5">
            <p className="text-[10px] text-gray-600 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-500/60 inline-block" />
              Meta revisa y aprueba cada plantilla (puede tardar minutos u horas)
            </p>
            <p className="text-[10px] text-gray-600 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-500/60 inline-block" />
              Los botones de Link abren el navegador del usuario
            </p>
            <p className="text-[10px] text-gray-600 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500/60 inline-block" />
              Plantillas MARKETING requieren categoría MARKETING en Meta
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Página principal ───────────────────────────────────────────────────────────
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
                Pendientes de aprobación ({pending.length})
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
