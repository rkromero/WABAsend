/**
 * Rutas del webhook de Meta
 * Autor: Turnio
 * Fecha: 2026-03-18 (actualizado: 2026-03-19)
 *
 * Meta envía dos tipos de callbacks a este endpoint:
 * 1. Actualizaciones de estado de mensajes enviados (statuses): sent → delivered → read / failed
 * 2. Mensajes entrantes de usuarios (messages): texto recibido desde WhatsApp
 *
 * Los mensajes entrantes se sincronizan con Chatwoot para gestión en bandeja de entrada.
 */

import { Router } from 'express';
import { query } from '../db/index.js';
import {
  getOrCreateContact,
  getOrCreateConversation,
  sendMessageToConversation,
} from '../services/chatwoot.js';
import { shouldBotRespond, generateBotResponse } from '../services/bot.js';
import { sendFreeTextMessage } from '../services/whatsapp.js';

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

// POST /webhook — recibe actualizaciones de estado y mensajes entrantes
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

        const value = change.value || {};

        // --- Procesar actualizaciones de estado (mensajes enviados por nosotros) ---
        const statuses = value.statuses || [];
        for (const status of statuses) {
          await processStatusUpdate(status);
        }

        // --- Procesar mensajes entrantes (mensajes que nos envían los usuarios) ---
        const messages = value.messages || [];
        for (const msg of messages) {
          // Solo procesamos mensajes de texto; ignoramos imágenes, audio, etc. por ahora
          if (msg.type !== 'text') continue;

          const telefono = msg.from; // número del remitente en formato internacional
          const messageText = msg.text?.body || '';
          const waMessageId = msg.id;

          // El nombre del contacto viene en el array `contacts` del mismo payload
          const contactProfile = value.contacts?.find((c) => c.wa_id === telefono);
          const nombre = contactProfile?.profile?.name || telefono;

          await processIncomingMessage({ telefono, nombre, messageText, waMessageId });
        }
      }
    }
  } catch (err) {
    console.error('[Webhook] Error procesando callback:', err.message);
  }
});

/**
 * Procesa un mensaje de texto entrante de WhatsApp.
 * Guarda en DB local y sincroniza con Chatwoot.
 *
 * @param {Object} params
 * @param {string} params.telefono     - Número del remitente
 * @param {string} params.nombre       - Nombre del remitente
 * @param {string} params.messageText  - Texto del mensaje
 * @param {string} params.waMessageId  - ID del mensaje en WhatsApp
 */
async function processIncomingMessage({ telefono, nombre, messageText, waMessageId }) {
  let chatwootConversationId = null;

  // Intentar sincronizar con Chatwoot (falla silenciosamente si no está configurado)
  try {
    const contact = await getOrCreateContact(telefono, nombre);
    const conversation = await getOrCreateConversation(contact.id);
    chatwootConversationId = conversation.id;

    await sendMessageToConversation(conversation.id, messageText, 'incoming');
    console.log(`[Webhook] Mensaje entrante de ${telefono} sincronizado con Chatwoot (conv: ${conversation.id})`);
  } catch (err) {
    // No cortar el flujo si Chatwoot falla — igual guardamos el mensaje localmente
    console.warn('[Webhook] No se pudo sincronizar con Chatwoot:', err.message);
  }

  // Guardar en tabla local para trazabilidad
  try {
    await query(
      `INSERT INTO incoming_messages (telefono, nombre, message, whatsapp_message_id, chatwoot_conversation_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [telefono, nombre, messageText, waMessageId, chatwootConversationId]
    );
    console.log(`[Webhook] Mensaje entrante guardado — de: ${telefono}`);
  } catch (err) {
    console.error('[Webhook] Error guardando mensaje entrante en DB:', err.message);
  }

  // --- Bot de IA: responder automáticamente si está habilitado ---
  // Nota: solo respondemos a mensajes reales de usuarios, nunca en loop.
  // El flag `bot_reply` en incoming_messages evita que una respuesta del bot
  // vuelva a disparar el bot (las respuestas del bot no se envían al webhook).
  try {
    const botActive = await shouldBotRespond();
    if (botActive) {
      // Obtener historial reciente del mismo número para dar contexto al modelo
      const historyResult = await query(
        `SELECT message FROM incoming_messages
         WHERE telefono = $1
         ORDER BY created_at DESC
         LIMIT 10`,
        [telefono]
      );

      // Revertir para que estén en orden cronológico (más viejo primero)
      const conversationHistory = historyResult.rows
        .reverse()
        .map((r) => ({ role: 'user', content: r.message }));

      const botResponse = await generateBotResponse(messageText, conversationHistory);

      // Enviar respuesta por WhatsApp (solo funciona en ventana de 24h)
      const botMessageId = await sendFreeTextMessage(telefono, botResponse);
      console.log(`[Bot] Mensaje enviado a ${telefono} — WA ID: ${botMessageId}`);

      // Registrar la respuesta del bot en Chatwoot como mensaje saliente
      if (chatwootConversationId) {
        try {
          await sendMessageToConversation(chatwootConversationId, botResponse, 'outgoing');
        } catch (chatwootErr) {
          // No bloqueamos si Chatwoot falla; la respuesta ya fue enviada por WhatsApp
          console.warn('[Bot] No se pudo registrar respuesta en Chatwoot:', chatwootErr.message);
        }
      }
    }
  } catch (botErr) {
    // El bot falla silenciosamente — nunca debe cortar el flujo principal del webhook
    console.error('[Bot] Error al generar o enviar respuesta:', botErr.message);
  }
}

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
    'SELECT id, campaign_id, status FROM waba_message_logs WHERE whatsapp_message_id = $1',
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
    `UPDATE waba_message_logs
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
      `UPDATE waba_campaigns SET ${counterColumn} = ${counterColumn} + 1 WHERE id = $1`,
      [log.campaign_id]
    );
  }

  console.log(`[Webhook] Mensaje ${waMessageId}: ${log.status} → ${newStatus}`);
}

export default router;
