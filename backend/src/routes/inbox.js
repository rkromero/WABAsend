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
import { getConversations, getMessages, sendMessageToConversation, sendAttachmentToConversation, getConversation, markConversationAsRead, resolveConversation, deleteConversation } from '../services/chatwoot.js';
import { toOggOpus, toM4a } from '../services/audio.js';
import { getConfig, uploadMediaToMeta, sendMediaMessage, fetchTemplates, sendTemplateMessage } from '../services/whatsapp.js';
import { query } from '../db/index.js';
import { clearConversationHistory } from '../services/conversationMemory.js';
import axios from 'axios';

// Multer en memoria — archivos de hasta 16 MB (límite de WhatsApp para video/audio)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 },
});

const router = Router();

/** Mensaje entendible para el vendedor a partir del error de Meta */
function whatsappErrorMessage(err) {
  const e = err.response?.data?.error;
  if (e?.code === 131047 || /re-engagement/i.test(e?.message || '')) {
    return 'La ventana de 24 h está cerrada: el cliente tiene que escribirte primero o usá una plantilla';
  }
  return `WhatsApp no aceptó el mensaje: ${e?.error_data?.details || e?.message || err.message}`;
}

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
      // Si WhatsApp lo rechaza (ej: ventana de 24 h cerrada) NO se registra como enviado:
      // se avisa al usuario para que no crea que el cliente lo recibió.
      console.warn(`[Inbox] WhatsApp send falló para ${telefono}:`, JSON.stringify(waErr.response?.data?.error || waErr.message));
      return res.status(502).json({ success: false, error: whatsappErrorMessage(waErr) });
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
      console.warn(`[Inbox] WhatsApp media send falló para ${telefono}:`, JSON.stringify(waErr.response?.data?.error || waErr.message));
      return res.status(502).json({ success: false, error: whatsappErrorMessage(waErr) });
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

// POST /api/inbox/conversations/:id/audio — nota de voz grabada desde el navegador
// Body: multipart/form-data con campo 'file' (webm/opus de Chrome, mp4/aac de Safari, etc.)
router.post('/conversations/:id/audio', upload.single('file'), async (req, res) => {
  const conversationId = parseInt(req.params.id);
  if (isNaN(conversationId)) {
    return res.status(400).json({ success: false, error: 'ID de conversación inválido' });
  }
  if (!req.file?.buffer?.length) {
    return res.status(400).json({ success: false, error: 'No se recibió el audio' });
  }

  try {
    const telefono = await getTelefonoFromConversation(conversationId);

    // 1. Convertir a ogg/opus (formato de nota de voz de WhatsApp) y enviar
    let ogg;
    try {
      ogg = await toOggOpus(req.file.buffer);
    } catch (convErr) {
      console.error('[Inbox] No se pudo convertir el audio:', convErr.message);
      return res.status(422).json({ success: false, error: 'No se pudo procesar el audio grabado' });
    }

    let waMessageId = null;
    try {
      const mediaId = await uploadMediaToMeta(ogg, 'audio/ogg; codecs=opus', 'nota_de_voz.ogg'); // Meta rechaza 'audio/ogg' base (131053)
      waMessageId = await sendMediaMessage(telefono, 'audio', mediaId);
      console.log(`[Inbox] Nota de voz enviada a ${telefono} (msgId: ${waMessageId})`);
    } catch (waErr) {
      console.warn(`[Inbox] WhatsApp audio send falló para ${telefono}:`, JSON.stringify(waErr.response?.data?.error || waErr.message));
      return res.status(502).json({ success: false, error: whatsappErrorMessage(waErr) });
    }

    // 2. Guardar en Chatwoot como adjunto reproducible (m4a), para poder escucharlo en la bandeja
    let audioForInbox = ogg;
    let mime = 'audio/ogg';
    let name = 'nota_de_voz.ogg';
    try {
      audioForInbox = await toM4a(req.file.buffer);
      mime = 'audio/mp4';
      name = 'nota_de_voz.m4a';
    } catch (convErr) {
      console.warn('[Inbox] No se pudo convertir a m4a, se guarda ogg:', convErr.message);
    }
    const chatwootMsg = await sendAttachmentToConversation(conversationId, audioForInbox, name, mime, 'outgoing');
    res.json({ success: true, data: { chatwoot_message_id: chatwootMsg?.id, whatsapp_message_id: waMessageId } });
  } catch (err) {
    console.error('[Inbox] POST audio error:', err.response?.data || err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Plantillas para reabrir la ventana de 24 h ─────────────────────────────

const VAR_RE = /\{\{\s*(\d+)\s*\}\}/g;
let templatesCache = { at: 0, data: null };

/**
 * Plantillas aprobadas que se pueden enviar desde el chat: solo variables en el
 * cuerpo (sin encabezado multimedia ni variables en encabezado/botones, que el
 * envío actual no soporta). Caché de 5 minutos para no consultar Meta en cada apertura.
 */
async function getUsableTemplates() {
  if (templatesCache.data && Date.now() - templatesCache.at < 5 * 60 * 1000) return templatesCache.data;
  const all = await fetchTemplates();
  const usable = [];
  for (const t of all) {
    if (t.status !== 'APPROVED') continue;
    const comps = t.components || [];
    const header = comps.find((c) => c.type === 'HEADER');
    const body = comps.find((c) => c.type === 'BODY');
    const footer = comps.find((c) => c.type === 'FOOTER');
    const buttons = comps.find((c) => c.type === 'BUTTONS')?.buttons || [];
    if (!body?.text) continue;
    if (header && (header.format !== 'TEXT' || VAR_RE.test(header.text || ''))) continue;
    VAR_RE.lastIndex = 0;
    if (buttons.some((b) => /\{\{/.test(b.url || ''))) continue;
    const vars = new Set([...body.text.matchAll(VAR_RE)].map((m) => Number(m[1])));
    usable.push({
      name: t.name,
      language: t.language,
      category: t.category,
      header: header?.text || '',
      body: body.text,
      footer: footer?.text || '',
      buttons: buttons.map((b) => b.text).filter(Boolean),
      varCount: vars.size ? Math.max(...vars) : 0,
    });
  }
  usable.sort((a, b) => a.name.localeCompare(b.name));
  templatesCache = { at: Date.now(), data: usable };
  return usable;
}

function renderTemplate(t, params) {
  const body = t.body.replace(VAR_RE, (_, n) => params[Number(n) - 1] ?? `{{${n}}}`);
  return [t.header ? `*${t.header}*` : '', body, t.footer ? `_${t.footer}_` : ''].filter(Boolean).join('\n\n');
}

// GET /api/inbox/templates — plantillas aprobadas por Meta utilizables en el chat
router.get('/templates', async (req, res) => {
  try {
    res.json({ success: true, data: await getUsableTemplates() });
  } catch (err) {
    console.error('[Inbox] GET templates error:', err.response?.data || err.message);
    res.status(502).json({ success: false, error: 'No se pudieron obtener las plantillas de Meta' });
  }
});

// POST /api/inbox/conversations/:id/template — enviar plantilla (reabre la conversación)
// Body: { name, language, params: string[] }
router.post('/conversations/:id/template', async (req, res) => {
  const conversationId = parseInt(req.params.id);
  if (isNaN(conversationId)) {
    return res.status(400).json({ success: false, error: 'ID de conversación inválido' });
  }
  const { name, language } = req.body || {};
  const params = Array.isArray(req.body?.params) ? req.body.params.map((p) => String(p ?? '').trim()) : [];

  try {
    const templates = await getUsableTemplates();
    const tpl = templates.find((t) => t.name === name && t.language === language);
    if (!tpl) return res.status(400).json({ success: false, error: 'Plantilla no disponible' });
    if (params.length !== tpl.varCount || params.some((p) => !p)) {
      return res.status(400).json({ success: false, error: 'Completá todas las variables de la plantilla' });
    }

    const telefono = await getTelefonoFromConversation(conversationId);
    let messageId;
    try {
      ({ messageId } = await sendTemplateMessage(telefono, tpl.name, tpl.language, params));
    } catch (waErr) {
      const msg = waErr.response?.data?.error?.message || waErr.message;
      console.warn(`[Inbox] Plantilla ${tpl.name} falló para ${telefono}: ${msg}`);
      return res.status(502).json({ success: false, error: `WhatsApp rechazó la plantilla: ${msg}` });
    }

    console.log(`[Inbox] Plantilla ${tpl.name} enviada a ${telefono} por ${req.user?.usuario} (msgId: ${messageId})`);
    const chatwootMsg = await sendMessageToConversation(conversationId, renderTemplate(tpl, params), 'outgoing');
    res.json({ success: true, data: { whatsapp_message_id: messageId, chatwoot_message_id: chatwootMsg?.id } });
  } catch (err) {
    console.error('[Inbox] POST template error:', err.response?.data || err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/inbox/conversations/:id — borrar conversación
// Resuelve en Chatwoot (desaparece del polling) y limpia datos locales asociados.
router.delete('/conversations/:id', async (req, res) => {
  const conversationId = parseInt(req.params.id);
  if (isNaN(conversationId)) {
    return res.status(400).json({ success: false, error: 'ID de conversación inválido' });
  }

  try {
    // Obtener el teléfono antes de resolver (necesario para limpiar tablas por telefono)
    let telefono = null;
    try {
      telefono = await getTelefonoFromConversation(conversationId);
    } catch {
      console.warn(`[Inbox] No se pudo obtener teléfono de Chatwoot para conversación ${conversationId} — usando fallback local`);
    }

    // Fallback: buscar el teléfono en la tabla local si Chatwoot no lo devolvió
    if (!telefono) {
      const localRow = await query(
        'SELECT telefono FROM incoming_messages WHERE chatwoot_conversation_id = $1 LIMIT 1',
        [conversationId]
      );
      if (localRow.rows.length > 0) {
        telefono = localRow.rows[0].telefono;
        console.log(`[Inbox] Teléfono obtenido del fallback local: ${telefono}`);
      }
    }

    console.log(`[Inbox] Eliminando conversación ${conversationId} (telefono: ${telefono || 'desconocido'})`);

    // 1. Eliminar de Chatwoot (DELETE permanente, fallback a resolve si no soportado)
    // Esto borra los mensajes de Chatwoot para que no reaparezcan al reabrir
    await deleteConversation(conversationId);

    // 2. Limpiar datos locales relacionados a esta conversación
    await query(
      'DELETE FROM waba_conversation_tags WHERE conversacion_chatwoot_id = $1',
      [conversationId]
    );

    if (telefono) {
      // Limpiar override de bot (takeover), followups e historial del bot del teléfono
      await query('DELETE FROM waba_conversation_overrides WHERE telefono = $1', [telefono]);
      await query('DELETE FROM waba_conversation_followups WHERE telefono = $1', [telefono]);
      await clearConversationHistory(telefono);
    }

    console.log(`[Inbox] Conversación ${conversationId} eliminada (telefono: ${telefono || 'desconocido'})`);
    res.json({ success: true });
  } catch (err) {
    console.error('[Inbox] DELETE conversation error:', err.response?.data || err.message);
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
