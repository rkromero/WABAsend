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
import multer from 'multer';
import { getConversations, getMessages, sendMessageToConversation, getConversation, markConversationAsRead } from '../services/chatwoot.js';
import { getConfig, uploadMediaToMeta, sendMediaMessage } from '../services/whatsapp.js';
import { query } from '../db/index.js';
import axios from 'axios';

// Multer en memoria — archivos de hasta 16 MB (límite de WhatsApp para video/audio)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 },
});

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

// POST /api/inbox/conversations/:id/media — enviar imagen o documento al cliente
// Body: multipart/form-data con campo 'file' (archivo) y 'caption' (texto opcional)
router.post('/conversations/:id/media', upload.single('file'), async (req, res) => {
  const conversationId = parseInt(req.params.id);
  if (isNaN(conversationId)) {
    return res.status(400).json({ success: false, error: 'ID de conversación inválido' });
  }

  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No se recibió ningún archivo' });
  }

  const { buffer, mimetype, originalname, size } = req.file;
  const caption = String(req.body.caption || '').trim();

  // Determinar el tipo de media que Meta espera según el MIME type
  const mediaType = mimetype.startsWith('image/')
    ? 'image'
    : mimetype.startsWith('video/')
    ? 'video'
    : mimetype.startsWith('audio/')
    ? 'audio'
    : 'document';

  try {
    // Obtener teléfono del contacto en la conversación
    const conversation = await getConversation(conversationId);
    const telefono = conversation.meta?.sender?.phone_number?.replace(/^\+/, '');

    if (!telefono) {
      return res.status(400).json({
        success: false,
        error: 'No se pudo obtener el teléfono del contacto desde Chatwoot',
      });
    }

    // 1. Subir el archivo a la API de media de Meta → obtener media_id
    const mediaId = await uploadMediaToMeta(buffer, mimetype, originalname);
    console.log(`[Inbox] Archivo subido a Meta — mediaId: ${mediaId} (${originalname}, ${size} bytes)`);

    // 2. Enviar el mensaje multimedia por WhatsApp
    let waMessageId = null;
    try {
      waMessageId = await sendMediaMessage(telefono, mediaType, mediaId, caption, originalname);
      console.log(`[Inbox] Media enviado por WhatsApp a ${telefono} (msgId: ${waMessageId})`);
    } catch (waErr) {
      const waError = waErr.response?.data?.error?.message || waErr.message;
      console.warn(`[Inbox] WhatsApp media send falló para ${telefono}: ${waError}`);
      // No cortamos el flujo: registramos en Chatwoot de todos modos
    }

    // 3. Registrar en Chatwoot como mensaje saliente (texto descriptivo + caption si hay)
    const typeLabel = { image: 'Imagen', video: 'Video', audio: 'Audio', document: 'Documento' }[mediaType];
    const chatwootText = caption
      ? `[${typeLabel}: ${originalname}] ${caption}`
      : `[${typeLabel} enviado: ${originalname}]`;
    const chatwootMsg = await sendMessageToConversation(conversationId, chatwootText, 'outgoing');

    res.json({
      success: true,
      data: {
        chatwoot_message_id: chatwootMsg.id,
        whatsapp_message_id: waMessageId,
        media_id: mediaId,
        media_type: mediaType,
      },
    });
  } catch (err) {
    console.error('[Inbox] POST media error:', err.response?.data || err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Etiquetas de conversación ──────────────────────────────────────────────

// GET /api/inbox/tags — todos los tags de todas las conversaciones, agrupados por convId
// Permite al frontend cargar el mapa completo en una sola request al inicio.
router.get('/tags', async (req, res) => {
  try {
    const result = await query(
      'SELECT conversacion_chatwoot_id, tag FROM waba_conversation_tags ORDER BY created_at ASC'
    );
    const grouped = {};
    for (const row of result.rows) {
      const cid = row.conversacion_chatwoot_id;
      if (!grouped[cid]) grouped[cid] = [];
      grouped[cid].push(row.tag);
    }
    res.json({ success: true, data: grouped });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/inbox/conversations/:id/tags — agregar un tag a una conversación
// Body: { tag: string }
router.post('/conversations/:id/tags', async (req, res) => {
  const conversationId = parseInt(req.params.id);
  if (isNaN(conversationId)) {
    return res.status(400).json({ success: false, error: 'ID inválido' });
  }

  const rawTag = req.body?.tag;
  if (!rawTag?.trim()) {
    return res.status(400).json({ success: false, error: 'tag es requerido' });
  }

  // Normalizar: minúsculas, espacios → guion bajo, máx 50 chars
  const tag = rawTag.trim().toLowerCase().replace(/\s+/g, '_').substring(0, 50);

  try {
    await query(
      `INSERT INTO waba_conversation_tags (conversacion_chatwoot_id, tag)
       VALUES ($1, $2)
       ON CONFLICT (conversacion_chatwoot_id, tag) DO NOTHING`,
      [conversationId, tag]
    );
    res.json({ success: true, data: { tag } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/inbox/conversations/:id/tags/:tag — eliminar un tag
router.delete('/conversations/:id/tags/:tag', async (req, res) => {
  const conversationId = parseInt(req.params.id);
  const tag = req.params.tag;
  if (isNaN(conversationId) || !tag) {
    return res.status(400).json({ success: false, error: 'Parámetros inválidos' });
  }

  try {
    await query(
      'DELETE FROM waba_conversation_tags WHERE conversacion_chatwoot_id = $1 AND tag = $2',
      [conversationId, tag]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Mensajes rápidos ──────────────────────────────────────────────────────

// GET /api/inbox/quick-replies
router.get('/quick-replies', async (req, res) => {
  try {
    const result = await query(
      'SELECT id, titulo, mensaje, created_at FROM waba_quick_replies ORDER BY titulo ASC'
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/inbox/quick-replies
router.post('/quick-replies', async (req, res) => {
  const { titulo, mensaje } = req.body;
  if (!titulo?.trim() || !mensaje?.trim()) {
    return res.status(400).json({ success: false, error: 'titulo y mensaje son requeridos' });
  }
  try {
    const result = await query(
      `INSERT INTO waba_quick_replies (titulo, mensaje) VALUES ($1, $2) RETURNING *`,
      [titulo.trim(), mensaje.trim()]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/inbox/quick-replies/:id
router.put('/quick-replies/:id', async (req, res) => {
  const { titulo, mensaje } = req.body;
  if (!titulo?.trim() || !mensaje?.trim()) {
    return res.status(400).json({ success: false, error: 'titulo y mensaje son requeridos' });
  }
  try {
    const result = await query(
      `UPDATE waba_quick_replies SET titulo = $1, mensaje = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [titulo.trim(), mensaje.trim(), req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'No encontrado' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/inbox/quick-replies/:id
router.delete('/quick-replies/:id', async (req, res) => {
  try {
    await query('DELETE FROM waba_quick_replies WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
