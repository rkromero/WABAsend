/**
 * Webhook de Chatwoot — recibe eventos del agente para reenviar por WhatsApp
 * Autor: Turnio
 * Fecha: 2026-03-19
 *
 * Cuando un agente responde en la UI de Chatwoot, este endpoint recibe
 * el evento `message_created` con type `outgoing` y reenvía el mensaje
 * al número de WhatsApp del contacto.
 *
 * Configuración en Chatwoot: Settings → Integrations → Webhooks → Add new
 * URL: https://tu-backend.railway.app/api/chatwoot/webhook
 * Eventos: message_created
 */

import { Router } from 'express';
import { getConversation } from '../services/chatwoot.js';
import { getConfig } from '../services/whatsapp.js';
import axios from 'axios';

const router = Router();

const META_API_VERSION = 'v21.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

// POST /api/chatwoot/webhook — evento de Chatwoot
router.post('/webhook', async (req, res) => {
  // Responder 200 inmediatamente para que Chatwoot no reintente
  res.status(200).send('OK');

  try {
    const event = req.body;

    // Solo procesar mensajes nuevos de tipo 'outgoing' (respuestas del agente)
    // message_type: 0 = incoming, 1 = outgoing, 2 = activity
    const isMessageCreated = event.event === 'message_created';
    const isOutgoing = event.message_type === 'outgoing' || event.message_type === 1;

    // Ignorar mensajes privados (notas internas del equipo)
    const isPrivate = event.private === true;

    if (!isMessageCreated || !isOutgoing || isPrivate) {
      return;
    }

    const conversationId = event.conversation?.id;
    const messageText = event.content;

    if (!conversationId || !messageText) {
      console.warn('[ChatwootWebhook] Evento sin conversation_id o content, ignorando');
      return;
    }

    // Obtener el teléfono del contacto desde la conversación
    const conversation = await getConversation(conversationId);
    const telefono = conversation.meta?.sender?.phone_number?.replace(/^\+/, '');

    if (!telefono) {
      console.warn(`[ChatwootWebhook] No se encontró teléfono para conversación ${conversationId}`);
      return;
    }

    // Enviar por WhatsApp usando la API de Meta (mensaje de texto libre)
    const { token, phoneNumberId } = await getConfig();

    const waRes = await axios.post(
      `${META_BASE_URL}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: telefono,
        type: 'text',
        text: { body: messageText },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    const waMessageId = waRes.data?.messages?.[0]?.id;
    console.log(
      `[ChatwootWebhook] Mensaje del agente reenviado a WhatsApp — para: ${telefono}, msgId: ${waMessageId}`
    );
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.message;
    console.error('[ChatwootWebhook] Error procesando evento:', detail);
  }
});

export default router;
