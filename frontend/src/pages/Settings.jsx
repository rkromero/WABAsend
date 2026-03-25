import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Save, Eye, EyeOff, CheckCircle, Copy, Ban, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../lib/api.js';

const FIELDS = [
  {
    key: 'WHATSAPP_TOKEN',
    label: 'Token de acceso de Meta',
    placeholder: 'EAAxxxxxxxx...',
    sensitive: true,
    help: 'Token permanente de la WhatsApp Business API. Generalo en Meta Business Suite.',
  },
  {
    key: 'PHONE_NUMBER_ID',
    label: 'Phone Number ID',
    placeholder: '123456789012345',
    sensitive: false,
    help: 'ID del número de teléfono en Meta. Lo encontrás en WhatsApp Manager → Números de teléfono.',
  },
  {
    key: 'WABA_ID',
    label: 'WhatsApp Business Account ID (WABA_ID)',
    placeholder: '987654321098765',
    sensitive: false,
    help: 'ID de tu cuenta de WhatsApp Business. Está en Configuración → Información de la empresa.',
  },
  {
    key: 'WEBHOOK_VERIFY_TOKEN',
    label: 'Token de verificación del webhook',
    placeholder: 'mi-token-secreto-aqui',
    sensitive: false,
    help: 'Cualquier string seguro. Usalo al configurar el webhook en Meta (debe coincidir exactamente).',
  },
];

export default function Settings() {
  const [form, setForm]       = useState({});
  const [current, setCurrent] = useState({});
  const [visible, setVisible] = useState({});
  const [saving, setSaving]   = useState(false);
  const [loading, setLoading] = useState(true);

  // ── Opt-outs ──────────────────────────────────────────────────────────────
  const [optouts, setOptouts]           = useState([]);
  const [loadingOptouts, setLoadingOptouts] = useState(true);
  const [newOptout, setNewOptout]       = useState('');
  const [savingOptout, setSavingOptout] = useState(false);

  useEffect(() => {
    api.get('/config')
      .then((r) => {
        setCurrent(r?.data || {});
        setLoading(false);
      })
      .catch((err) => {
        toast.error(err.message);
        setLoading(false);
      });

    api.get('/optouts')
      .then((r) => setOptouts(r.data?.data || []))
      .catch(() => {})
      .finally(() => setLoadingOptouts(false));
  }, []);

  async function handleAddOptout() {
    const tel = newOptout.trim();
    if (!tel) return;
    setSavingOptout(true);
    try {
      await api.post('/optouts', { telefono: tel, motivo: 'manual' });
      setOptouts((prev) => [{ telefono: tel, motivo: 'manual', created_at: new Date().toISOString() }, ...prev]);
      setNewOptout('');
      toast.success('Opt-out registrado');
    } catch (err) {
      toast.error(err.message || 'Error al registrar');
    } finally {
      setSavingOptout(false);
    }
  }

  async function handleRemoveOptout(telefono) {
    if (!window.confirm(`¿Reactivar a ${telefono}?`)) return;
    try {
      await api.delete(`/optouts/${telefono}`);
      setOptouts((prev) => prev.filter((o) => o.telefono !== telefono));
      toast.success('Contacto reactivado');
    } catch (err) {
      toast.error(err.message || 'Error al reactivar');
    }
  }

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    const payload = Object.fromEntries(
      Object.entries(form).filter(([, v]) => v.trim() !== '')
    );

    if (Object.keys(payload).length === 0) {
      toast.error('No hay cambios para guardar');
      return;
    }

    setSaving(true);
    try {
      await api.post('/config', payload);
      toast.success('Configuración guardada');

      // Actualizar current con los nuevos valores (sin mostrar el token completo)
      setCurrent((prev) => ({
        ...prev,
        ...Object.fromEntries(
          Object.entries(payload).map(([k, v]) =>
            k === 'WHATSAPP_TOKEN'
              ? [k, v.substring(0, 8) + '...' + v.slice(-4)]
              : [k, v]
          )
        ),
      }));
      setForm({});
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  // URL del webhook para copiar
  const webhookUrl = import.meta.env.VITE_API_URL
    ? `${import.meta.env.VITE_API_URL}/webhook`
    : `${window.location.origin.replace('5173', '3001')}/webhook`;

  function copyWebhook() {
    navigator.clipboard.writeText(webhookUrl);
    toast.success('URL copiada');
  }

  return (
    <div className="space-y-8 animate-slide-up max-w-2xl">
      <div>
        <h1 className="font-display text-2xl font-bold text-white">Configuración</h1>
        <p className="text-sm text-gray-500 mt-1">
          Credenciales de la WhatsApp Business API. Se guardan en la base de datos.
        </p>
      </div>

      {/* Formulario */}
      <div className="glass-card p-6 space-y-5">
        <div className="flex items-center gap-2 mb-1">
          <SettingsIcon size={16} className="text-accent" />
          <h2 className="text-sm font-medium text-white">Credenciales Meta API</h2>
        </div>

        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-16 rounded-lg" />)}
          </div>
        ) : (
          FIELDS.map(({ key, label, placeholder, sensitive, help }) => (
            <div key={key}>
              <label className="form-label">{label}</label>
              <div className="relative">
                <input
                  type={sensitive && !visible[key] ? 'password' : 'text'}
                  className="input-field pr-10"
                  placeholder={current[key] ? `Actual: ${current[key]}` : placeholder}
                  value={form[key] || ''}
                  onChange={(e) => update(key, e.target.value)}
                />
                {sensitive && (
                  <button
                    type="button"
                    onClick={() => setVisible((v) => ({ ...v, [key]: !v[key] }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                  >
                    {visible[key] ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-600 mt-1">{help}</p>
              {current[key] && !form[key] && (
                <p className="text-xs text-accent/70 mt-0.5 flex items-center gap-1">
                  <CheckCircle size={10} /> Configurado
                </p>
              )}
            </div>
          ))
        )}

        <button
          onClick={handleSave}
          disabled={saving || loading}
          className="btn-primary w-full justify-center mt-2"
        >
          <Save size={15} />
          {saving ? 'Guardando...' : 'Guardar configuración'}
        </button>
      </div>

      {/* Info del webhook */}
      <div className="glass-card p-6 space-y-4">
        <h2 className="text-sm font-medium text-white">Configuración del Webhook en Meta</h2>
        <p className="text-xs text-gray-400">
          Para recibir actualizaciones de estado de mensajes (entregado, leído, fallido),
          configurá el webhook en tu panel de Meta Business Suite:
        </p>

        <div>
          <p className="text-xs text-gray-500 mb-1.5">URL del callback</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-base-elevated border border-base-border rounded-lg px-3 py-2 text-accent/80 font-mono truncate">
              {webhookUrl}
            </code>
            <button onClick={copyWebhook} className="btn-secondary py-2 px-3 shrink-0">
              <Copy size={13} />
            </button>
          </div>
        </div>

        <div>
          <p className="text-xs text-gray-500 mb-1.5">Token de verificación</p>
          <code className="text-xs bg-base-elevated border border-base-border rounded-lg px-3 py-2 text-gray-300 font-mono block">
            {current['WEBHOOK_VERIFY_TOKEN'] || '(no configurado)'}
          </code>
        </div>

        <div className="text-xs text-gray-600 space-y-1 border-t border-base-border pt-3">
          <p className="font-medium text-gray-500">Pasos para configurar el webhook en Meta:</p>
          <ol className="list-decimal list-inside space-y-0.5 pl-1">
            <li>Andá a Meta Business Suite → WhatsApp → Configuración</li>
            <li>En "Webhooks", hacé clic en "Configurar"</li>
            <li>Pegá la URL del callback y el token de verificación</li>
            <li>Suscribite al evento <code>messages</code></li>
          </ol>
        </div>
      </div>

      {/* ── Opt-outs ──────────────────────────────────────────────────────── */}
      <div className="glass-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Ban size={15} className="text-red-400" />
          <h2 className="text-sm font-medium text-white">Bajas (opt-outs)</h2>
          {optouts.length > 0 && (
            <span className="ml-auto text-[10px] bg-red-500/10 border border-red-500/20 text-red-400 rounded-full px-2 py-0.5">
              {optouts.length} {optouts.length === 1 ? 'contacto' : 'contactos'}
            </span>
          )}
        </div>

        <p className="text-xs text-gray-500">
          Estos números están excluidos de campañas, follow-ups y automatizaciones.
          Se agregan automáticamente cuando alguien escribe <span className="text-gray-300">STOP</span>, <span className="text-gray-300">baja</span> u otras palabras de baja.
        </p>

        {/* Agregar manualmente */}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Ej: 5491134866718"
            value={newOptout}
            onChange={(e) => setNewOptout(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddOptout()}
            className="input-field flex-1"
          />
          <button
            onClick={handleAddOptout}
            disabled={savingOptout || !newOptout.trim()}
            className="btn-secondary shrink-0 disabled:opacity-40"
          >
            <Ban size={13} />
            Agregar
          </button>
        </div>

        {/* Lista */}
        {loadingOptouts ? (
          <div className="space-y-2">
            {[1, 2].map((i) => <div key={i} className="skeleton h-10 rounded-lg" />)}
          </div>
        ) : optouts.length === 0 ? (
          <p className="text-xs text-gray-600 text-center py-4">
            No hay contactos dados de baja.
          </p>
        ) : (
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {optouts.map((o) => (
              <div
                key={o.telefono}
                className="flex items-center gap-3 px-3 py-2 bg-base-elevated border border-base-border rounded-lg"
              >
                <Ban size={12} className="text-red-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-200 font-mono">{o.telefono}</p>
                  <p className="text-[10px] text-gray-600 truncate">{o.motivo || '—'}</p>
                </div>
                <span className="text-[10px] text-gray-600 shrink-0">
                  {new Date(o.created_at).toLocaleDateString('es-AR')}
                </span>
                <button
                  onClick={() => handleRemoveOptout(o.telefono)}
                  title="Reactivar contacto"
                  className="p-1 text-gray-600 hover:text-accent transition-colors shrink-0"
                >
                  <RotateCcw size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
