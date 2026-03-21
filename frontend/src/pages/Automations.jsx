import React, { useState, useEffect } from 'react';
import {
  Zap, Plus, Trash2, ToggleLeft, ToggleRight, RefreshCw,
  Clock, CheckCircle, XCircle, AlertCircle, Copy,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../lib/api.js';

const EVENTOS = [
  { value: 'order.completed',  label: 'Pedido completado',      desc: 'Cuando un pedido pasa a estado "Completado"' },
  { value: 'order.created',    label: 'Pedido nuevo',           desc: 'Cuando se crea cualquier pedido nuevo' },
  { value: 'customer.created', label: 'Cliente nuevo',          desc: 'Cuando un cliente se registra por primera vez' },
];

const STATUS_COLORS = {
  pending: 'text-yellow-400 bg-yellow-400/10',
  sent:    'text-green-400  bg-green-400/10',
  failed:  'text-red-400    bg-red-400/10',
};

function EventoBadge({ evento }) {
  const found = EVENTOS.find((e) => e.value === evento);
  return (
    <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent/10 text-accent font-medium">
      {found?.label || evento}
    </span>
  );
}

function AutomationRow({ automation, onToggle, onDelete }) {
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);

  async function handleToggle() {
    setToggling(true);
    try {
      await onToggle(automation.id, !automation.activa);
    } finally {
      setToggling(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`¿Eliminar "${automation.nombre}"? También se eliminarán los mensajes pendientes.`)) return;
    setDeleting(true);
    try {
      await onDelete(automation.id);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className={`glass-card p-4 transition-all ${!automation.activa ? 'opacity-50' : ''}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-white">{automation.nombre}</p>
            <EventoBadge evento={automation.evento} />
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <Clock size={11} />
              {automation.delay_dias === 0
                ? 'Inmediato'
                : `${automation.delay_dias} día${automation.delay_dias !== 1 ? 's' : ''} después`}
            </span>
            <span>Plantilla: <span className="text-gray-400">{automation.template_name}</span></span>
          </div>
          {/* Contadores */}
          <div className="flex items-center gap-3 mt-2">
            <span className="text-[10px] text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded-full">
              {automation.pending_count || 0} pendientes
            </span>
            <span className="text-[10px] text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">
              {automation.sent_count || 0} enviados
            </span>
            {parseInt(automation.failed_count) > 0 && (
              <span className="text-[10px] text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full">
                {automation.failed_count} fallidos
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleToggle}
            disabled={toggling}
            title={automation.activa ? 'Desactivar' : 'Activar'}
            className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
          >
            {automation.activa
              ? <ToggleRight size={20} className="text-accent" />
              : <ToggleLeft size={20} className="text-gray-500" />}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="p-1.5 rounded-lg hover:bg-red-400/10 text-gray-500 hover:text-red-400 transition-colors"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function NewAutomationModal({ templates, onSave, onClose }) {
  const [form, setForm] = useState({
    nombre: '',
    evento: 'order.completed',
    delay_dias: 0,
    template_name: '',
    template_language: 'es_AR',
  });
  const [saving, setSaving] = useState(false);

  function update(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  // Cuando cambia la plantilla, sincronizar el idioma automáticamente
  function handleTemplateChange(name) {
    const found = templates.find((t) => t.name === name);
    update('template_name', name);
    if (found) update('template_language', found.language);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.nombre || !form.template_name) {
      toast.error('Nombre y plantilla son requeridos');
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  const eventoSeleccionado = EVENTOS.find((e) => e.value === form.evento);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-base-surface border border-base-border rounded-2xl p-6 w-full max-w-lg shadow-2xl">
        <h2 className="font-display font-bold text-white text-lg mb-5">Nueva automatización</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="form-label">NOMBRE</label>
            <input
              className="input-field"
              placeholder="ej: WhatsApp post-compra 7 días"
              value={form.nombre}
              onChange={(e) => update('nombre', e.target.value)}
            />
          </div>

          <div>
            <label className="form-label">EVENTO DISPARADOR</label>
            <select
              className="input-field"
              value={form.evento}
              onChange={(e) => update('evento', e.target.value)}
            >
              {EVENTOS.map((ev) => (
                <option key={ev.value} value={ev.value}>{ev.label}</option>
              ))}
            </select>
            {eventoSeleccionado && (
              <p className="text-[10px] text-gray-600 mt-1">{eventoSeleccionado.desc}</p>
            )}
          </div>

          <div>
            <label className="form-label">ENVIAR</label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min="0"
                max="365"
                className="input-field w-24 text-center"
                value={form.delay_dias}
                onChange={(e) => update('delay_dias', parseInt(e.target.value) || 0)}
              />
              <span className="text-sm text-gray-400">
                {form.delay_dias === 0
                  ? 'días después del evento (inmediato)'
                  : `día${form.delay_dias !== 1 ? 's' : ''} después del evento`}
              </span>
            </div>
          </div>

          <div>
            <label className="form-label">PLANTILLA DE WHATSAPP</label>
            {templates.length === 0 ? (
              <p className="text-xs text-yellow-400 mt-1">
                No hay plantillas aprobadas. Creá una en Plantillas primero.
              </p>
            ) : (
              <select
                className="input-field"
                value={form.template_name}
                onChange={(e) => handleTemplateChange(e.target.value)}
              >
                <option value="">Seleccioná una plantilla…</option>
                {templates.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name} ({t.language})
                  </option>
                ))}
              </select>
            )}
            <p className="text-[10px] text-gray-600 mt-1">
              Solo se muestran plantillas aprobadas por Meta.
            </p>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving || !form.template_name} className="btn-primary flex-1">
              {saving ? 'Guardando...' : 'Crear automatización'}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Automations() {
  const [automations, setAutomations] = useState([]);
  const [queue, setQueue]             = useState([]);
  const [templates, setTemplates]     = useState([]);
  const [loading, setLoading]         = useState(true);
  const [showModal, setShowModal]     = useState(false);
  const [backendUrl, setBackendUrl]   = useState('');

  async function fetchAll() {
    setLoading(true);
    try {
      const [autoRes, queueRes, tplRes] = await Promise.all([
        api.get('/automations'),
        api.get('/automations/queue?limit=30'),
        api.get('/templates').catch(() => ({ data: [] })),
      ]);
      setAutomations(autoRes.data);
      setQueue(queueRes.data);
      // Solo plantillas aprobadas
      setTemplates((tplRes.data || []).filter((t) => t.status === 'APPROVED'));
      // URL del backend para mostrar en la guía de configuración
      setBackendUrl(window.location.origin.replace('5173', '3001').replace('localhost:3000', 'localhost:3001'));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchAll(); }, []);

  async function handleCreate(form) {
    await api.post('/automations', form);
    toast.success('Automatización creada');
    fetchAll();
  }

  async function handleToggle(id, activa) {
    await api.put(`/automations/${id}`, { activa });
    toast.success(activa ? 'Automatización activada' : 'Automatización desactivada');
    fetchAll();
  }

  async function handleDelete(id) {
    await api.delete(`/automations/${id}`);
    toast.success('Automatización eliminada');
    fetchAll();
  }

  function copyUrl(url) {
    navigator.clipboard.writeText(url);
    toast.success('URL copiada al portapapeles');
  }

  const webhookUrl = `${backendUrl || 'https://tu-backend.railway.app'}/api/woo-webhook`;

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Automatizaciones</h1>
          <p className="text-sm text-gray-500 mt-1">
            Mensajes de WhatsApp automáticos basados en eventos de WooCommerce
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchAll} className="btn-secondary">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => setShowModal(true)} className="btn-primary">
            <Plus size={15} />
            Nueva automatización
          </button>
        </div>
      </div>

      {/* Guía de configuración WooCommerce */}
      <div className="glass-card p-4 border border-blue-500/20 bg-blue-500/5">
        <div className="flex items-start gap-3">
          <AlertCircle size={16} className="text-blue-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-blue-300 mb-2">
              Configuración requerida en WooCommerce
            </p>
            <p className="text-xs text-gray-400 mb-3">
              Para que las automatizaciones funcionen, configurá webhooks en tu WooCommerce:
              <br />
              <strong className="text-gray-300">WooCommerce → Ajustes → Avanzado → Webhooks → Añadir webhook</strong>
            </p>
            <div className="space-y-1 text-xs text-gray-400">
              <p>• Estado: <span className="text-green-400">Activo</span></p>
              <p>• Tema: <span className="text-gray-300">Pedido completado</span> (o el evento que corresponda)</p>
              <p>• URL de entrega:</p>
            </div>
            <div className="flex items-center gap-2 mt-2 bg-black/30 rounded-lg px-3 py-2">
              <code className="text-xs text-accent flex-1 break-all">{webhookUrl}</code>
              <button
                onClick={() => copyUrl(webhookUrl)}
                className="text-gray-500 hover:text-gray-300 shrink-0"
              >
                <Copy size={13} />
              </button>
            </div>
            <p className="text-[10px] text-gray-600 mt-2">
              Creá un webhook por cada evento que quieras monitorear (completado, nuevo, cliente nuevo).
            </p>
          </div>
        </div>
      </div>

      {/* Lista de automatizaciones */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton h-20 rounded-xl" />
          ))}
        </div>
      ) : automations.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Zap size={32} className="mx-auto mb-3 text-gray-600" />
          <p className="text-gray-500 text-sm">No hay automatizaciones configuradas.</p>
          <p className="text-gray-600 text-xs mt-1">
            Creá una para empezar a enviar WhatsApps automáticos.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {automations.map((a) => (
            <AutomationRow
              key={a.id}
              automation={a}
              onToggle={handleToggle}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Historial de la cola */}
      {queue.length > 0 && (
        <div>
          <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
            Actividad reciente
          </h2>
          <div className="glass-card overflow-hidden">
            <div className="divide-y divide-base-border">
              {queue.map((item) => (
                <div key={item.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="shrink-0">
                    {item.status === 'sent'    && <CheckCircle size={14} className="text-green-400" />}
                    {item.status === 'pending' && <Clock       size={14} className="text-yellow-400" />}
                    {item.status === 'failed'  && <XCircle     size={14} className="text-red-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-300 truncate">
                      {item.nombre_cliente || item.telefono}
                      <span className="text-gray-600 ml-2 text-xs">{item.telefono}</span>
                    </p>
                    <p className="text-[10px] text-gray-600">
                      {item.automation_nombre} ·{' '}
                      {item.status === 'pending'
                        ? `programado ${new Date(item.scheduled_for).toLocaleString('es-AR')}`
                        : item.sent_at
                        ? `enviado ${new Date(item.sent_at).toLocaleString('es-AR')}`
                        : item.error_message}
                    </p>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[item.status] || ''}`}>
                    {item.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <NewAutomationModal
          templates={templates}
          onSave={handleCreate}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
