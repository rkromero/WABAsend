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
import { sendTemplateMessage, sleep } from './whatsapp.js';

// Previene ejecuciones concurrentes del mismo scheduler
let isRunning = false;

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

  // Obtener todos los mensajes pendientes de esta campaña
  const logsResult = await query(
    "SELECT * FROM waba_message_logs WHERE campaign_id = $1 AND status = 'pending'",
    [campaign.id]
  );

  const logs = logsResult.rows;
  console.log(`[Scheduler] Campaña #${campaign.id}: ${logs.length} mensajes pendientes`);

  let sentCount = 0;
  let failedCount = 0;

  for (const log of logs) {
    try {
      const { messageId } = await sendTemplateMessage(
        log.telefono,
        campaign.template_name,
        campaign.template_language,
        log.nombre
      );

      // Actualizar log con el ID de WhatsApp y estado sent
      await query(
        `UPDATE waba_message_logs
         SET status = 'sent', whatsapp_message_id = $1, sent_at = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [messageId, log.id]
      );

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

  // Expresión cron: cada minuto
  cron.schedule('* * * * *', () => {
    checkAndRunScheduledCampaigns().catch((err) => {
      console.error('[Scheduler] Error no capturado:', err.message);
    });
  });
}
