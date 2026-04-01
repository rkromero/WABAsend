/**
 * Scheduler de campañas con node-cron
 * Autor: Turnio
 * Fecha: 2026-03-18
 * Dependencias: node-cron, pg
 *
 * Chequea cada minuto si hay campañas programadas listas para ejecutar.
 * Rate limiting: 1 segundo de delay entre cada mensaje para respetar límites de Meta.
 *
 * ⚠️ Este módulo ejecuta envíos reales a números de WhatsApp.
 *    Cualquier bug aquí puede resultar en mensajes duplicados o no enviados.
 */

import cron from 'node-cron';
import { query } from '../db/index.js';
import { sendTemplateMessage, fetchTemplates, sleep } from './whatsapp.js';
import { processAutomationQueue } from './automations.js';
import { processFollowups } from './followup.js';
import { getContactOrderStats } from './woocommerce.js';
import { getOrCreateContact, getOrCreateConversation, sendMessageToConversation } from './chatwoot.js';

// Previene ejecuciones concurrentes del mismo scheduler
let isRunning = false;

/**
 * Reemplaza los placeholders {{1}}, {{2}}, ... en el texto de una plantilla
 * con los valores reales enviados, para mostrar el mensaje renderizado en Chatwoot.
 *
 * @param {string}   bodyText        - Texto de la plantilla con {{N}}
 * @param {string[]} parameterValues - Valores de las variables en orden
 * @returns {string} Texto con variables sustituidas
 */
function renderTemplateText(bodyText, parameterValues) {
  if (!bodyText) return '';
  if (!parameterValues || parameterValues.length === 0) return bodyText;
  return parameterValues.reduce(
    (text, value, index) => text.replace(new RegExp(`\\{\\{${index + 1}\\}\\}`, 'g'), value),
    bodyText
  );
}

/**
 * Construye el array de valores de variables para un contacto dado,
 * usando el variable_mapping de la campaña.
 *
 * variable_mapping = { "1": { source: "nombre" }, "2": { source: "fixed", value: "PROMO20" } }
 * Fuentes disponibles: "nombre", "telefono", "email", "fixed", "cantidad_pedidos", "fecha_ultimo_pedido"
 * Fallback si no hay mapping: [nombre] para mantener compatibilidad con plantillas legacy.
 *
 * @param {Object} variableMapping - Mapping de la campaña
 * @param {Object} log             - Fila de waba_message_logs con nombre, telefono, email
 * @param {Map}    wooCache        - Cache de stats WooCommerce por teléfono (compartido por campaña)
 * @returns {Promise<string[]>} Array de valores en orden numérico de variable
 */
async function buildParameterValues(variableMapping, log, wooCache) {
  const keys = Object.keys(variableMapping || {});
  if (keys.length === 0) {
    // Legacy: plantilla con {{1}} pero sin mapping configurado → usar nombre
    return [log.nombre || 'Cliente'];
  }

  const values = await Promise.all(
    keys
      .sort((a, b) => parseInt(a) - parseInt(b))
      .map(async (key) => {
        const m = variableMapping[key];
        if (m.source === 'nombre')   return log.nombre   || 'Cliente';
        if (m.source === 'telefono') return log.telefono || '';
        if (m.source === 'email')    return log.email    || '';
        if (m.source === 'fixed')    return m.value      || '';

        // Fuentes WooCommerce — se resuelven con cache para no hacer N llamadas por campaña
        if (m.source === 'cantidad_pedidos' || m.source === 'fecha_ultimo_pedido') {
          const cacheKey = log.telefono || log.email;
          let stats = wooCache.get(cacheKey);
          if (!stats) {
            stats = await getContactOrderStats(log.email || null, log.telefono || null);
            wooCache.set(cacheKey, stats);
          }

          if (m.source === 'cantidad_pedidos') {
            return String(stats.cantidadPedidos);
          }
          if (m.source === 'fecha_ultimo_pedido') {
            if (!stats.fechaUltimoPedido) return 'sin pedidos';
            return stats.fechaUltimoPedido.toLocaleDateString('es-AR', {
              day: '2-digit', month: '2-digit', year: 'numeric',
            });
          }
        }

        return '';
      })
  );

  return values;
}

/**
 * Ejecuta una campaña: envía mensajes a todos sus contactos.
 * Actualiza el estado de cada mensaje en waba_message_logs y los contadores en waba_campaigns.
 *
 * @param {Object} campaign - Fila de la tabla waba_campaigns
 */
async function executeCampaign(campaign) {
  console.log(`[Scheduler] Iniciando campaña #${campaign.id}: "${campaign.nombre}"`);

  // Marcar campaña como running
  await query(
    "UPDATE waba_campaigns SET status = 'running' WHERE id = $1",
    [campaign.id]
  );

  // Obtener mensajes pendientes de esta campaña, excluyendo opt-outs.
  // Un opt-out se marca como 'failed' con motivo explicativo para trazabilidad.
  const logsResult = await query(
    `SELECT l.*
     FROM waba_message_logs l
     WHERE l.campaign_id = $1
       AND l.status = 'pending'
       AND NOT EXISTS (
         SELECT 1 FROM waba_optouts o WHERE o.telefono = l.telefono
       )`,
    [campaign.id]
  );

  // Marcar como 'skipped' los mensajes de contactos en opt-out
  await query(
    `UPDATE waba_message_logs
     SET status = 'failed', error_message = 'Opt-out: contacto solicitó no recibir mensajes', updated_at = NOW()
     WHERE campaign_id = $1
       AND status = 'pending'
       AND EXISTS (SELECT 1 FROM waba_optouts o WHERE o.telefono = waba_message_logs.telefono)`,
    [campaign.id]
  );

  const logs = logsResult.rows;
  console.log(`[Scheduler] Campaña #${campaign.id}: ${logs.length} mensajes pendientes (opt-outs excluidos)`);

  // Detectar si la plantilla tiene variables ({{1}}) para no mandar parameters de más.
  // Meta devuelve error #132000 si se envían parameters a una plantilla sin variables.
  let hasVariables = true;
  let templateBodyText = ''; // Texto del cuerpo de la plantilla para contexto del bot
  try {
    const allTemplates = await fetchTemplates();
    const tpl = allTemplates.find(
      (t) => t.name === campaign.template_name && t.language === campaign.template_language
    );
    const bodyComp = tpl?.components?.find((c) => c.type === 'BODY');
    hasVariables = bodyComp ? /\{\{\d+\}\}/.test(bodyComp.text || '') : false;
    templateBodyText = bodyComp?.text || campaign.template_name;
    console.log(`[Scheduler] Plantilla "${campaign.template_name}" hasVariables=${hasVariables}`);
  } catch (err) {
    // Si no se puede verificar, asumir false para evitar el error #132000
    hasVariables = false;
    templateBodyText = campaign.template_name;
    console.warn(`[Scheduler] No se pudo verificar variables de plantilla: ${err.message}. Asumiendo sin variables.`);
  }

  let sentCount = 0;
  let failedCount = 0;

  // Cache de stats WooCommerce por teléfono para evitar N llamadas a la API.
  // Se crea por ejecución de campaña y se descarta al terminar.
  const wooStatsCache = new Map();

  for (const log of logs) {
    try {
      // Construir parámetros de variables según el mapping de la campaña.
      // Si no tiene variables, pasar array vacío para que Meta no reciba components.
      const parameterValues = hasVariables
        ? await buildParameterValues(campaign.variable_mapping || {}, log, wooStatsCache)
        : [];

      const { messageId } = await sendTemplateMessage(
        log.telefono,
        campaign.template_name,
        campaign.template_language,
        parameterValues
      );

      // Actualizar log con el ID de WhatsApp y estado sent
      await query(
        `UPDATE waba_message_logs
         SET status = 'sent', whatsapp_message_id = $1, sent_at = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [messageId, log.id]
      );

      // Registrar el mensaje saliente en Chatwoot para que sea visible en la bandeja.
      // Se hace en un try/catch separado: si Chatwoot falla, no interrumpimos el envío masivo.
      try {
        const renderedText = renderTemplateText(templateBodyText, parameterValues);
        const contact = await getOrCreateContact(log.telefono, log.nombre || log.telefono);
        const conversation = await getOrCreateConversation(contact.id);
        await sendMessageToConversation(
          conversation.id,
          renderedText || `[Campaña: ${campaign.nombre}] Plantilla: ${campaign.template_name}`,
          'outgoing'
        );
      } catch (chatwootErr) {
        console.warn(`[Scheduler] No se pudo registrar en Chatwoot para ${log.telefono}: ${chatwootErr.message}`);
      }

      // Guardar ventana de contexto de campaña para que el bot pueda responder
      // en el contexto correcto si la persona responde dentro de las 48h.
      // ON CONFLICT: si la misma campaña ya tiene una ventana para este teléfono, no duplicar.
      try {
        await query(
          `INSERT INTO waba_campaign_reply_window
             (telefono, campaign_id, campaign_nombre, template_name, template_body, expires_at)
           VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '48 hours')
           ON CONFLICT DO NOTHING`,
          [log.telefono, campaign.id, campaign.nombre, campaign.template_name, templateBodyText]
        );
      } catch (winErr) {
        // No crítico — el bot funcionará sin contexto de campaña si falla
        console.warn(`[Scheduler] No se pudo guardar ventana de campaña para ${log.telefono}: ${winErr.message}`);
      }

      sentCount++;
      console.log(`[Scheduler] ✓ Enviado a ${log.telefono} (msgId: ${messageId})`);
    } catch (err) {
      // Capturar error sin detener el resto de la campaña
      const errorMsg = err.response?.data?.error?.message || err.message;

      await query(
        `UPDATE waba_message_logs
         SET status = 'failed', error_message = $1, updated_at = NOW()
         WHERE id = $2`,
        [errorMsg.substring(0, 500), log.id]
      );

      failedCount++;
      console.error(`[Scheduler] ✗ Falló envío a ${log.telefono}: ${errorMsg}`);
    }

    // Rate limiting: 1 segundo entre mensajes para respetar límites de Meta
    await sleep(1000);
  }

  // Actualizar contadores y marcar campaña como completed
  await query(
    `UPDATE waba_campaigns
     SET status = 'completed',
         sent_count = sent_count + $1,
         failed_count = failed_count + $2
     WHERE id = $3`,
    [sentCount, failedCount, campaign.id]
  );

  console.log(
    `[Scheduler] Campaña #${campaign.id} completada. Enviados: ${sentCount}, Fallidos: ${failedCount}`
  );
}

/**
 * Chequea si hay campañas con status='scheduled' y scheduled_at <= NOW().
 * Ejecuta cada una secuencialmente para evitar sobrecarga de la API.
 */
async function checkAndRunScheduledCampaigns() {
  if (isRunning) {
    console.debug('[Scheduler] Ya hay un ciclo en ejecución, saltando...');
    return;
  }

  isRunning = true;
  try {
    const result = await query(
      `SELECT * FROM waba_campaigns
       WHERE status = 'scheduled' AND scheduled_at <= NOW()
       ORDER BY scheduled_at ASC`
    );

    if (result.rows.length === 0) {
      return; // Nada que hacer
    }

    console.log(`[Scheduler] ${result.rows.length} campaña(s) lista(s) para ejecutar`);

    for (const campaign of result.rows) {
      try {
        await executeCampaign(campaign);
      } catch (err) {
        // Si falla la campaña entera, marcarla como failed
        console.error(`[Scheduler] Error crítico en campaña #${campaign.id}:`, err.message);
        await query(
          "UPDATE waba_campaigns SET status = 'failed' WHERE id = $1",
          [campaign.id]
        );
      }
    }
  } catch (err) {
    console.error('[Scheduler] Error al consultar campañas:', err.message);
  } finally {
    isRunning = false;
  }
}

/**
 * Inicia el scheduler. Corre cada minuto.
 * Llamar una sola vez al arrancar el servidor.
 */
export function startScheduler() {
  console.log('[Scheduler] Iniciado — chequeando cada minuto');

  // Campañas programadas: cada minuto
  cron.schedule('* * * * *', () => {
    checkAndRunScheduledCampaigns().catch((err) => {
      console.error('[Scheduler] Error no capturado:', err.message);
    });
  });

  // Cola de automatizaciones WooCommerce: cada minuto
  cron.schedule('* * * * *', () => {
    processAutomationQueue().catch((err) => {
      console.error('[Automations Queue] Error no capturado:', err.message);
    });
  });

  // Follow-up de conversaciones: cada hora en punto
  // Busca conversaciones cuya ventana de 24h está a punto de cerrarse (±30 min)
  cron.schedule('0 * * * *', () => {
    processFollowups().catch((err) => {
      console.error('[Followup] Error no capturado:', err.message);
    });
  });

  console.log('[Scheduler] Follow-up de conversaciones activado — cada hora');
}
