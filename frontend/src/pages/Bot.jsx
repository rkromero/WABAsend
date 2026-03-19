import React, { useState, useEffect } from 'react';
import { Bot as BotIcon, Save, Clock, Power, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../lib/api.js';

export default function Bot() {
  const [form, setForm] = useState({
    BOT_ENABLED:          false,
    BOT_PROMPT:           '',
    BOT_SCHEDULE_ENABLED: false,
    BOT_SCHEDULE_START:   '08:00',
    BOT_SCHEDULE_END:     '20:00',
  });
  const [loading, setLoading]  = useState(true);
  const [saving, setSaving]    = useState(false);

  useEffect(() => {
    api.get('/bot')
      .then((r) => {
        if (r?.data) setForm(r.data);
        setLoading(false);
      })
      .catch((err) => {
        toast.error(err.message);
        setLoading(false);
      });
  }, []);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.put('/bot', form);
      toast.success('Configuración del bot guardada');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Calcular el estado real del bot para mostrarlo en el badge
  const botEffectivelyActive =
    form.BOT_ENABLED &&
    (!form.BOT_SCHEDULE_ENABLED ||
      isWithinScheduleClientSide(form.BOT_SCHEDULE_START, form.BOT_SCHEDULE_END));

  return (
    <div className="space-y-8 animate-slide-up max-w-2xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Bot de IA</h1>
          <p className="text-sm text-gray-500 mt-1">
            Respuestas automáticas con OpenAI. El bot responde a mensajes entrantes en nombre de tu negocio.
          </p>
        </div>

        {/* Badge de estado */}
        {!loading && (
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${
              botEffectivelyActive
                ? 'bg-green-500/10 border-green-500/30 text-green-400'
                : 'bg-gray-500/10 border-gray-500/30 text-gray-400'
            }`}
          >
            <div
              className={`w-1.5 h-1.5 rounded-full ${
                botEffectivelyActive ? 'bg-green-400 animate-pulse' : 'bg-gray-500'
              }`}
            />
            {botEffectivelyActive ? 'Bot activo' : 'Bot inactivo'}
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton h-20 rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          {/* Sección 1: Estado del bot */}
          <div className="glass-card p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center">
                  <Power size={16} className="text-accent" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">Estado del bot</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {form.BOT_ENABLED ? 'El bot responderá mensajes entrantes' : 'El bot no responde actualmente'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => update('BOT_ENABLED', !form.BOT_ENABLED)}
                className={`relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none ${
                  form.BOT_ENABLED ? 'bg-accent' : 'bg-base-elevated border border-base-border'
                }`}
                aria-checked={form.BOT_ENABLED}
                role="switch"
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
                    form.BOT_ENABLED ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Sección 2: Prompt del sistema */}
          <div className="glass-card p-6 space-y-4">
            <div className="flex items-center gap-2">
              <BotIcon size={16} className="text-accent" />
              <h2 className="text-sm font-medium text-white">Prompt del sistema</h2>
            </div>

            <div>
              <label className="form-label">Instrucciones para el bot</label>
              <textarea
                className="input-field min-h-[160px] resize-y"
                placeholder="Ej: Sos el asistente virtual de [Tu Empresa]. Respondés preguntas sobre horarios, precios y servicios. Siempre respondés en español, con tono amable y profesional. Si no sabés algo, decís que un agente se va a comunicar pronto."
                value={form.BOT_PROMPT}
                onChange={(e) => update('BOT_PROMPT', e.target.value)}
              />
              <p className="text-xs text-gray-600 mt-1.5">
                Este prompt define cómo se comporta el bot. Sé específico sobre tu negocio: nombre, servicios, tono y límites de lo que puede responder.
              </p>
            </div>
          </div>

          {/* Sección 3: Horario de activación */}
          <div className="glass-card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock size={16} className="text-accent" />
                <h2 className="text-sm font-medium text-white">Horario de activación</h2>
              </div>
              <button
                type="button"
                onClick={() => update('BOT_SCHEDULE_ENABLED', !form.BOT_SCHEDULE_ENABLED)}
                className={`relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none ${
                  form.BOT_SCHEDULE_ENABLED ? 'bg-accent' : 'bg-base-elevated border border-base-border'
                }`}
                aria-checked={form.BOT_SCHEDULE_ENABLED}
                role="switch"
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
                    form.BOT_SCHEDULE_ENABLED ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {form.BOT_SCHEDULE_ENABLED ? (
              <div className="space-y-4">
                <p className="text-xs text-gray-500">
                  El bot solo responderá mensajes dentro del horario configurado (hora Argentina UTC-3).
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="form-label">Hora de inicio</label>
                    <input
                      type="time"
                      className="input-field"
                      value={form.BOT_SCHEDULE_START}
                      onChange={(e) => update('BOT_SCHEDULE_START', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="form-label">Hora de fin</label>
                    <input
                      type="time"
                      className="input-field"
                      value={form.BOT_SCHEDULE_END}
                      onChange={(e) => update('BOT_SCHEDULE_END', e.target.value)}
                    />
                  </div>
                </div>

                {/* Aviso de horario actual */}
                {form.BOT_ENABLED && (
                  <div
                    className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${
                      isWithinScheduleClientSide(form.BOT_SCHEDULE_START, form.BOT_SCHEDULE_END)
                        ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                        : 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-400'
                    }`}
                  >
                    <CheckCircle size={12} />
                    {isWithinScheduleClientSide(form.BOT_SCHEDULE_START, form.BOT_SCHEDULE_END)
                      ? `Ahora dentro del horario — el bot responde de ${form.BOT_SCHEDULE_START} a ${form.BOT_SCHEDULE_END}`
                      : `Fuera del horario — el bot solo responde de ${form.BOT_SCHEDULE_START} a ${form.BOT_SCHEDULE_END}`}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-500">
                Sin horario configurado, el bot responde las 24 horas si está habilitado.
              </p>
            )}
          </div>

          {/* Botón guardar */}
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary w-full justify-center"
          >
            <Save size={15} />
            {saving ? 'Guardando...' : 'Guardar configuración'}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Verifica si la hora actual del cliente está dentro del rango (Argentina UTC-3).
 * Réplica del helper del servidor, para mostrar el estado en tiempo real en la UI.
 *
 * @param {string} start - HH:MM
 * @param {string} end   - HH:MM
 * @returns {boolean}
 */
function isWithinScheduleClientSide(start, end) {
  const now = new Date();
  // Obtener la hora en Argentina (UTC-3)
  const argTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
  const argMinutes = argTime.getHours() * 60 + argTime.getMinutes();

  const [startH, startM] = start.split(':').map(Number);
  const [endH, endM]     = end.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes   = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    return argMinutes >= startMinutes && argMinutes < endMinutes;
  }
  return argMinutes >= startMinutes || argMinutes < endMinutes;
}
