/**
 * Rutas de la bandeja de entrada (inbox) — proxy hacia Chatwoot
 * Autor: Turnio
 * Fecha: 2026-03-19
 *
 * Expone una API simplificada al frontend para manejar conversaciones y
 * enviar respuestas. Las respuestas se envían simultáneamente a WhatsApp
 * y a Chatwoot para mantener la sincronía.
 */

import { Router } from 'express';
import { getConversations, getMessages, sendMessageToConversation, getConversation } from '../services/chatwoot.js';
import { getConfig } from '../services/whatsapp.js';
import axios from 'axios';

const router = Router();

const META_API_VERSION = 'v21.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

// GET /api/inbox/conversations?page=1 — lista de conversaciones
router.get('/conversations', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);

  try {
    const raw = await getConversations(page);
    // Chatwoot devuelve { data: { meta: {...}, payload: [...] } }
    // Normalizamos para que el frontend reciba { payload: [...], meta: {...} }
    const normalized = raw?.data || raw;
    res.json({ success: true, data: normalized });
  } catch (err) {
    console.error('[Inbox] GET conversations error:', err.response?.data || err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/inbox/conversations/:id/messages — mensajes de una conversación
router.get('/conversations/:id/messages', async (req, res) => {
  const conversationId = parseInt(req.params.id);
  if (isNaN(conversationId)) {
    return res.status(400).json({ success: false, error: 'ID de conversación inválido' });
  }

  try {
    const raw = await getMessages(conversationId);
    // Chatwoot devuelve { payload: [...messages...] }
    const normalized = raw?.payload ? raw : { payload: raw };
    res.json({ success: true, data: normalized });
  } catch (err) {
    console.error('[Inbox] GET messages error:', err.response?.data || err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/inbox/conversations/:id/messages — enviar respuesta al cliente
// Body: { message: string }
router.post('/conversations/:id/messages', async (req, res) => {
  const conversationId = parseInt(req.params.id);
  if (isNaN(conversationId)) {
    return res.status(400).json({ success: false, error: 'ID de conversación inválido' });
  }

  const { message } = req.body;
  if (!message || String(message).trim() === '') {
    return res.status(400).json({ success: false, error: 'El mensaje no puede estar vacío' });
  }

  const messageText = String(message).trim();

  try {
    // Obtener datos de la conversación para extraer el teléfono del contacto
    const conversation = await getConversation(conversationId);
    const telefono = conversation.meta?.sender?.phone_number?.replace(/^\+/, '');

    if (!telefono) {
      return res.status(400).json({
        success: false,
        error: 'No se pudo obtener el teléfono del contacto desde Chatwoot',
      });
    }

    // 1. Enviar por WhatsApp (mensaje de texto libre — solo funciona dentro de la ventana de 24h)
    let waMessageId = null;
    try {
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

      waMessageId = waRes.data?.messages?.[0]?.id;
      console.log(`[Inbox] Mensaje enviado por WhatsApp a ${telefono} (msgId: ${waMessageId})`);
    } catch (waErr) {
      // Si WhatsApp falla (ej: ventana de 24h cerrada), igual registramos en Chatwoot
      const waError = waErr.response?.data?.error?.message || waErr.message;
      console.warn(`[Inbox] WhatsApp send falló para ${telefono}: ${waError}`);
      // No cortamos el flujo: el mensaje se guarda en Chatwoot de todos modos
    }

    // 2. Registrar el mensaje como 'outgoing' en Chatwoot
    const chatwootMsg = await sendMessageToConversation(conversationId, messageText, 'outgoing');

    res.json({
      success: true,
      data: {
        chatwoot_message_id: chatwootMsg.id,
        whatsapp_message_id: waMessageId,
      },
    });
  } catch (err) {
    console.error('[Inbox] POST message error:', err.response?.data || err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
