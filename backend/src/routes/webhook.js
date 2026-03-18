/**
 * Rutas del webhook de Meta
 * Autor: Turnio
 * Fecha: 2026-03-18
 *
 * Meta envía callbacks de estado de mensajes a este endpoint.
 * Estados posibles: sent → delivered → read / failed
 */

import { Router } from 'express';
import { query } from '../db/index.js';

const router = Router();

// GET /webhook — verificación del webhook por Meta
// Meta llama a este endpoint cuando se registra el webhook en el panel
router.get('/', async (req, res) => {
  try {
    // Leer el token de verificación desde la base de datos
    const configResult = await query(
      "SELECT value FROM config WHERE key = 'WEBHOOK_VERIFY_TOKEN'"
    );

    const storedToken = configResult.rows[0]?.value;
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === storedToken) {
      console.log('[Webhook] Verificación exitosa');
      return res.status(200).send(challenge);
    }

    console.warn('[Webhook] Verificación fallida — token no coincide');
    res.status(403).json({ success: false, error: 'Forbidden' });
  } catch (err) {
    console.error('[Webhook] Error en verificación:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /webhook — recibe actualizaciones de estado de mensajes
router.post('/', async (req, res) => {
  // Meta espera un 200 rápido para no reintentar
  res.status(200).send('OK');

  try {
    const body = req.body;

    if (body.object !== 'whatsapp_business_account') {
      return; // No es un evento de WhatsApp
    }

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;

        const statuses = change.value?.statuses || [];
        for (const status of statuses) {
          await processStatusUpdate(status);
        }
      }
    }
  } catch (err) {
    console.error('[Webhook] Error procesando callback:', err.message);
  }
});

/**
 * Procesa una actualización de estado de un mensaje individual.
 * Actualiza message_logs y los contadores de la campaña.
 *
 * @param {Object} status - Objeto de estado de Meta
 */
async function processStatusUpdate(status) {
  const { id: waMessageId, status: newStatus, recipient_id } = status;

  // Estados que Meta puede enviar: sent, delivered, read, failed
  const validStatuses = ['sent', 'delivered', 'read', 'failed'];
  if (!validStatuses.includes(newStatus)) return;

  // Buscar el log por el ID de mensaje de WhatsApp
  const logResult = await query(
    'SELECT id, campaign_id, status FROM message_logs WHERE whatsapp_message_id = $1',
    [waMessageId]
  );

  if (logResult.rows.length === 0) {
    // Puede pasar si el mensaje fue enviado fuera de esta app
    console.debug(`[Webhook] Mensaje ${waMessageId} no encontrado en logs`);
    return;
  }

  const log = logResult.rows[0];

  // Evitar regresiones de estado: read no puede volver a delivered
  const statusOrder = { pending: 0, sent: 1, delivered: 2, read: 3, failed: -1 };
  const currentOrder = statusOrder[log.status] ?? 0;
  const newOrder = statusOrder[newStatus] ?? 0;

  if (newStatus !== 'failed' && newOrder <= currentOrder) {
    return; // No retroceder el estado
  }

  // Actualizar el log
  await query(
    `UPDATE message_logs
     SET status = $1, updated_at = NOW()
     WHERE id = $2`,
    [newStatus, log.id]
  );

  // Actualizar contadores en la campaña
  const counterColumn = {
    delivered: 'delivered_count',
    read: 'read_count',
    failed: 'failed_count',
  }[newStatus];

  if (counterColumn) {
    await query(
      `UPDATE campaigns SET ${counterColumn} = ${counterColumn} + 1 WHERE id = $1`,
      [log.campaign_id]
    );
  }

  console.log(`[Webhook] Mensaje ${waMessageId}: ${log.status} → ${newStatus}`);
}

export default router;
