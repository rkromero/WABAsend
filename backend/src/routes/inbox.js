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
import { getConversations, getMessages, sendMessageToConversation, getConversation, markConversationAsRead } from '../services/chatwoot.js';
import { getConfig } from '../services/whatsapp.js';
import { query } from '../db/index.js';
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

// POST /api/inbox/conversations/:id/read — marcar conversación como leída
// Resetea unread_count a 0 en Chatwoot para que desaparezca el badge
router.post('/conversations/:id/read', async (req, res) => {
  const conversationId = parseInt(req.params.id);
  if (isNaN(conversationId)) {
    return res.status(400).json({ success: false, error: 'ID de conversación inválido' });
  }

  try {
    await markConversationAsRead(conversationId);
    res.json({ success: true });
  } catch (err) {
    // Aunque falle, devolvemos 200 — el frontend no debe bloquear por esto
    console.error('[Inbox] read error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

/**
 * Obtiene el teléfono del contacto de una conversación.
 * Helper reutilizado por takeover y release.
 */
async function getTelefonoFromConversation(conversationId) {
  const conversation = await getConversation(conversationId);
  const telefono = conversation.meta?.sender?.phone_number?.replace(/^\+/, '');
  if (!telefono) throw new Error('No se pudo obtener el teléfono del contacto');
  return telefono;
}

// GET /api/inbox/conversations/:id/bot-status — estado del bot para esta conversación
router.get('/conversations/:id/bot-status', async (req, res) => {
  const conversationId = parseInt(req.params.id);
  if (isNaN(conversationId)) {
    return res.status(400).json({ success: false, error: 'ID inválido' });
  }

  try {
    const telefono = await getTelefonoFromConversation(conversationId);
    const result = await query(
      'SELECT bot_paused FROM waba_conversation_overrides WHERE telefono = $1',
      [telefono]
    );
    const botPaused = result.rows[0]?.bot_paused ?? false;
    res.json({ success: true, data: { bot_paused: botPaused, telefono } });
  } catch (err) {
    console.error('[Inbox] bot-status error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/inbox/conversations/:id/takeover — agente toma el control, bot se silencia
router.post('/conversations/:id/takeover', async (req, res) => {
  const conversationId = parseInt(req.params.id);
  if (isNaN(conversationId)) {
    return res.status(400).json({ success: false, error: 'ID inválido' });
  }

  try {
    const telefono = await getTelefonoFromConversation(conversationId);

    // UPSERT: si ya existe el registro lo actualiza, si no lo crea
    await query(
      `INSERT INTO waba_conversation_overrides (telefono, bot_paused, paused_at)
       VALUES ($1, true, NOW())
       ON CONFLICT (telefono) DO UPDATE SET bot_paused = true, paused_at = NOW()`,
      [telefono]
    );

    console.log(`[Inbox] Agente tomó conversación con ${telefono} — bot pausado`);
    res.json({ success: true, data: { bot_paused: true, telefono } });
  } catch (err) {
    console.error('[Inbox] takeover error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/inbox/conversations/:id/release — agente devuelve la conversación al bot
router.post('/conversations/:id/release', async (req, res) => {
  const conversationId = parseInt(req.params.id);
  if (isNaN(conversationId)) {
    return res.status(400).json({ success: false, error: 'ID inválido' });
  }

  try {
    const telefono = await getTelefonoFromConversation(conversationId);

    await query(
      `INSERT INTO waba_conversation_overrides (telefono, bot_paused, paused_at)
       VALUES ($1, false, NULL)
       ON CONFLICT (telefono) DO UPDATE SET bot_paused = false, paused_at = NULL`,
      [telefono]
    );

    console.log(`[Inbox] Conversación con ${telefono} devuelta al bot`);
    res.json({ success: true, data: { bot_paused: false, telefono } });
  } catch (err) {
    console.error('[Inbox] release error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
