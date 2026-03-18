import React, { useState, useEffect } from 'react';
import { Check, ChevronRight, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../lib/api.js';

const STEPS = ['Datos', 'Plantilla', 'Contactos', 'Programación', 'Confirmación'];

// ── Paso 1: Nombre de la campaña ──────────────────────────────────────────────
function Step1({ data, onChange }) {
  return (
    <div className="space-y-4">
      <div>
        <label className="form-label">Nombre de la campaña</label>
        <input
          className="input-field"
          placeholder="Ej: Promo Mayo 2026"
          value={data.nombre}
          onChange={(e) => onChange({ nombre: e.target.value })}
        />
      </div>
    </div>
  );
}

// ── Paso 2: Selección de plantilla ────────────────────────────────────────────
function Step2({ data, onChange }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    api.get('/templates')
      .then((r) => setTemplates(r.data.filter((t) => t.status === 'APPROVED')))
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Extraer el texto del body de la plantilla para el preview
  function getBodyText(template) {
    const body = template.components?.find((c) => c.type === 'BODY');
    return body?.text || 'Sin preview disponible';
  }

  if (loading) {
    return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-16 rounded-lg" />)}</div>;
  }

  if (templates.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 text-sm">
        No hay plantillas aprobadas. Creá una en la sección Plantillas.
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
      {templates.map((t) => {
        const isSelected = data.template_name === t.name && data.template_language === t.language;
        return (
          <button
            key={`${t.name}-${t.language}`}
            onClick={() => onChange({ template_name: t.name, template_language: t.language })}
            className={`w-full text-left p-4 rounded-lg border transition-all duration-150 ${
              isSelected
                ? 'border-accent bg-accent/8 text-white'
                : 'border-base-border bg-base-elevated hover:border-white/20 text-gray-300'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium text-sm">{t.name}</p>
                <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                  {getBodyText(t)}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="text-[10px] text-gray-500 bg-base-surface px-2 py-0.5 rounded-full">
                  {t.language}
                </span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── Paso 3: Selección de contactos ────────────────────────────────────────────
function Step3({ data, onChange }) {
  const [contacts, setContacts]   = useState([]);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [selectAll, setSelectAll] = useState(data.selectAll ?? true);

  useEffect(() => {
    api.get('/contacts', { params: { limit: 200, search } })
      .then((r) => {
        setContacts(r.data.contacts);
        setTotal(r.data.pagination.total);
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, [search]);

  function toggleSelectAll(val) {
    setSelectAll(val);
    if (val) {
      onChange({ selectAll: true, contact_ids: contacts.map((c) => c.id) });
    } else {
      onChange({ selectAll: false, contact_ids: [] });
    }
  }

  function toggleContact(id) {
    const ids = data.contact_ids || [];
    const newIds = ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id];
    onChange({ selectAll: false, contact_ids: newIds });
  }

  const selectedIds = data.contact_ids || [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="form-label mb-0">Contactos ({total} total)</label>
        <button
          onClick={() => toggleSelectAll(!selectAll)}
          className={`text-xs px-3 py-1 rounded-full border transition-all ${
            selectAll
              ? 'border-accent text-accent bg-accent/10'
              : 'border-base-border text-gray-400 hover:border-white/20'
          }`}
        >
          {selectAll ? `Todos seleccionados (${total})` : `${selectedIds.length} seleccionados`}
        </button>
      </div>

      <input
        className="input-field"
        placeholder="Buscar por nombre o teléfono..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="max-h-60 overflow-y-auto space-y-1 pr-1">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-9 rounded-lg" />)
        ) : (
          contacts.map((c) => {
            const isChecked = selectAll || selectedIds.includes(c.id);
            return (
              <label
                key={c.id}
                className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/[0.03] cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleContact(c.id)}
                  className="accent-accent w-3.5 h-3.5"
                />
                <span className="text-sm text-gray-200">{c.nombre}</span>
                <span className="text-xs text-gray-500 font-mono ml-auto">{c.telefono}</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Paso 4: Programación ──────────────────────────────────────────────────────
function Step4({ data, onChange }) {
  // Valor mínimo: ahora + 2 minutos
  const minDate = new Date(Date.now() + 2 * 60 * 1000).toISOString().slice(0, 16);

  return (
    <div className="space-y-4">
      <div>
        <label className="form-label">Fecha y hora de envío</label>
        <input
          type="datetime-local"
          className="input-field"
          min={minDate}
          value={data.scheduled_at}
          onChange={(e) => onChange({ scheduled_at: e.target.value })}
        />
        <p className="text-xs text-gray-500 mt-1.5">
          El envío comenzará en el momento programado. Hora local del servidor.
        </p>
      </div>
    </div>
  );
}

// ── Paso 5: Confirmación ──────────────────────────────────────────────────────
function Step5({ data }) {
  const contactCount = data.selectAll
    ? 'Todos los contactos'
    : `${data.contact_ids?.length || 0} contactos seleccionados`;

  const scheduledDate = data.scheduled_at
    ? new Date(data.scheduled_at).toLocaleString('es-AR')
    : '—';

  const rows = [
    { label: 'Nombre', value: data.nombre || '—' },
    { label: 'Plantilla', value: data.template_name || '—' },
    { label: 'Idioma', value: data.template_language || '—' },
    { label: 'Contactos', value: contactCount },
    { label: 'Fecha programada', value: scheduledDate },
  ];

  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-400 mb-3">Revisá el resumen antes de confirmar:</p>
      {rows.map(({ label, value }) => (
        <div key={label} className="flex justify-between py-2 border-b border-base-border last:border-0">
          <span className="text-xs text-gray-500 uppercase tracking-wider">{label}</span>
          <span className="text-sm text-gray-200 font-medium">{value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
const INITIAL_DATA = {
  nombre: '',
  template_name: '',
  template_language: '',
  selectAll: true,
  contact_ids: [],
  scheduled_at: '',
};

export default function CampaignStepper({ onSuccess, onCancel }) {
  const [step, setStep]   = useState(0);
  const [data, setData]   = useState(INITIAL_DATA);
  const [saving, setSaving] = useState(false);

  function update(partial) {
    setData((prev) => ({ ...prev, ...partial }));
  }

  function canAdvance() {
    if (step === 0) return data.nombre.trim().length >= 3;
    if (step === 1) return data.template_name && data.template_language;
    if (step === 2) return (data.selectAll && data.contact_ids.length > 0) || data.contact_ids.length > 0;
    if (step === 3) return data.scheduled_at;
    return true;
  }

  async function handleSubmit() {
    setSaving(true);
    try {
      // Obtener IDs finales de contactos
      let contact_ids = data.contact_ids;
      if (data.selectAll) {
        const r = await api.get('/contacts', { params: { limit: 10000 } });
        contact_ids = r.data.contacts.map((c) => c.id);
      }

      if (contact_ids.length === 0) {
        toast.error('No hay contactos para enviar');
        return;
      }

      await api.post('/campaigns', {
        nombre: data.nombre.trim(),
        template_name: data.template_name,
        template_language: data.template_language,
        contact_ids,
        scheduled_at: new Date(data.scheduled_at).toISOString(),
      });

      toast.success('Campaña creada y programada');
      onSuccess?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  const stepComponents = [
    <Step1 data={data} onChange={update} />,
    <Step2 data={data} onChange={update} />,
    <Step3 data={data} onChange={update} />,
    <Step4 data={data} onChange={update} />,
    <Step5 data={data} />,
  ];

  return (
    <div className="glass-card overflow-hidden w-full max-w-lg mx-auto">
      {/* Progress steps */}
      <div className="px-6 pt-6">
        <div className="flex items-center gap-1">
          {STEPS.map((label, i) => (
            <React.Fragment key={i}>
              <div className="flex flex-col items-center">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                    i < step
                      ? 'bg-accent text-black'
                      : i === step
                      ? 'bg-accent/20 text-accent border border-accent'
                      : 'bg-base-elevated text-gray-600 border border-base-border'
                  }`}
                >
                  {i < step ? <Check size={12} /> : i + 1}
                </div>
                <span className={`text-[10px] mt-1 ${i === step ? 'text-accent' : 'text-gray-600'}`}>
                  {label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-px mb-4 ${i < step ? 'bg-accent/40' : 'bg-base-border'}`} />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Contenido del paso */}
      <div className="px-6 py-5 min-h-[260px] animate-fade-in" key={step}>
        {stepComponents[step]}
      </div>

      {/* Navegación */}
      <div className="px-6 pb-6 flex justify-between gap-3 border-t border-base-border pt-4">
        <button
          onClick={step === 0 ? onCancel : () => setStep((s) => s - 1)}
          className="btn-secondary"
        >
          {step === 0 ? 'Cancelar' : 'Atrás'}
        </button>

        {step < STEPS.length - 1 ? (
          <button
            onClick={() => setStep((s) => s + 1)}
            disabled={!canAdvance()}
            className="btn-primary"
          >
            Siguiente <ChevronRight size={15} />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="btn-primary"
          >
            <Send size={15} />
            {saving ? 'Creando...' : 'Crear campaña'}
          </button>
        )}
      </div>
    </div>
  );
}
