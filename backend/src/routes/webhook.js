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
import { shouldBotRespond, generateBotResponse, sanitizeBotResponse } from '../services/bot.js';
import { sendFreeTextMessage, getMediaUrl, downloadMediaBuffer, transcribeAudio } from '../services/whatsapp.js';
import { getConversationHistory, saveConversationTurn } from '../services/conversationMemory.js';
import { autoTagConversation } from '../services/autoTagger.js';
import { scheduleDebounce } from '../services/messageDebounce.js';

const router = Router();

// ── Cache del tiempo de debounce ──────────────────────────────────────────────
// Evita consultar la DB en cada mensaje entrante. Se refresca cada 10 segundos,
// lo que significa que un cambio de configuración tarda máximo 10s en aplicarse.
let _cachedDebounceMs = null;
let _debounceConfigFetchedAt = 0;
const DEBOUNCE_CONFIG_CACHE_TTL = 10_000; // 10 segundos

async function getDebounceWindowMs() {
  const now = Date.now();
  if (_cachedDebounceMs !== null && (now - _debounceConfigFetchedAt) < DEBOUNCE_CONFIG_CACHE_TTL) {
    return _cachedDebounceMs;
  }
  try {
    const r = await query("SELECT value FROM config WHERE key = 'BOT_DEBOUNCE_SECONDS'");
    const secs = parseInt(r.rows[0]?.value ?? '3', 10);
    // Clampear entre 0 y 30 segundos para evitar valores absurdos
    _cachedDebounceMs = Math.max(0, Math.min(30, secs)) * 1000;
  } catch {
    _cachedDebounceMs = 3000; // fallback seguro: 3 segundos
  }
  _debounceConfigFetchedAt = now;
  return _cachedDebounceMs;
}

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
          const telefono = msg.from;
          const waMessageId = msg.id;
          const contactProfile = value.contacts?.find((c) => c.wa_id === telefono);
          const nombre = contactProfile?.profile?.name || telefono;

          if (msg.type === 'text') {
            const messageText = msg.text?.body || '';
            await processIncomingMessage({ telefono, nombre, messageText, waMessageId });
          } else if (['image', 'video', 'document', 'audio'].includes(msg.type)) {
            await processIncomingMedia({ telefono, nombre, waMessageId, msg });
          }
          // ignorar reactions, location, contacts, stickers, etc.
        }
      }
    }
  } catch (err) {
    console.error('[Webhook] Error procesando callback:', err.message);
  }
});

// Palabras clave que indican que el usuario quiere darse de baja.
// Case-insensitive, se evalúan contra el texto completo del mensaje.
const OPTOUT_KEYWORDS = [
  'stop', 'baja', 'darme de baja', 'no quiero', 'no me mandes',
  'no me escribas', 'cancelar', 'desuscribir', 'unsuscribe', 'no gracias',
];

/**
 * Devuelve true si el texto contiene alguna palabra/frase de opt-out.
 * @param {string} text
 */
function isOptOutMessage(text) {
  const lower = text.toLowerCase().trim();
  return OPTOUT_KEYWORDS.some((kw) => lower === kw || lower.startsWith(kw + ' ') || lower.endsWith(' ' + kw) || lower.includes(' ' + kw + ' '));
}

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

    // Auto-etiquetado en background — fire-and-forget, nunca bloquea el webhook
    autoTagConversation(chatwootConversationId, messageText).catch(() => {});
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

  // --- Opt-out: detectar si el usuario quiere darse de baja ----------------
  // Si el mensaje contiene una palabra clave de baja, registramos el opt-out
  // y NO procesamos con el bot. El mensaje ya está guardado en DB para trazabilidad.
  if (isOptOutMessage(messageText)) {
    try {
      await query(
        `INSERT INTO waba_optouts (telefono, motivo)
         VALUES ($1, $2)
         ON CONFLICT (telefono) DO UPDATE SET motivo = EXCLUDED.motivo, created_at = NOW()`,
        [telefono, `Auto: "${messageText.substring(0, 200)}"`]
      );
      console.log(`[Webhook] Opt-out automático registrado para ${telefono}`);
    } catch (optErr) {
      console.warn('[Webhook] Error al registrar opt-out:', optErr.message);
    }
    return; // No pasar por el bot
  }

  // --- Bot de IA: encolar en el debounce para esperar mensajes adicionales ---
  // Si el usuario envía varios mensajes seguidos, el bot espera la ventana configurada
  // antes de responder, acumulando todos los textos en una sola respuesta.
  try {
    const windowMs = await getDebounceWindowMs();
    await scheduleDebounce({
      telefono,
      messageData: { telefono, nombre, messageText, chatwootConversationId },
      windowMs,
      onFlush: handleBotFlush,
    });
  } catch (debounceErr) {
    console.error('[Webhook] Error al encolar mensaje en debounce:', debounceErr.message);
  }
}

/**
 * Procesa la respuesta del bot para los mensajes acumulados durante la ventana de debounce.
 * Se llama automáticamente cuando vence el timer, con todos los textos del usuario juntos.
 *
 * @param {Array<{telefono: string, nombre: string, messageText: string, chatwootConversationId: number|null}>} messages
 */
async function handleBotFlush(messages) {
  const { telefono, chatwootConversationId } = messages[0];

  // Combinar todos los mensajes acumulados con saltos de línea.
  // Ej: ["Hola", "necesito info", "del jean negro"] → "Hola\nnecesito info\ndel jean negro"
  const combinedText = messages.map((m) => m.messageText).join('\n');

  if (messages.length > 1) {
    console.log(`[Bot] Debounce: ${messages.length} mensajes de ${telefono} combinados → "${combinedText.substring(0, 100)}"`);
  }

  try {
    const botActive = await shouldBotRespond(telefono);
    if (!botActive) return;

    // Recuperar historial completo (user + assistant) de los últimos 24h / 20 mensajes
    const conversationHistory = await getConversationHistory(telefono);

    // Verificar si la persona está respondiendo a una campaña saliente reciente.
    // Si existe una ventana activa (enviada en las últimas 48h), inyectamos el contexto
    // de esa campaña en el prompt para que el bot responda en la línea correcta.
    let campaignContext = null;
    try {
      const cwResult = await query(
        `SELECT campaign_nombre, template_body
         FROM waba_campaign_reply_window
         WHERE telefono = $1 AND expires_at > NOW()
         ORDER BY sent_at DESC
         LIMIT 1`,
        [telefono]
      );
      if (cwResult.rows.length > 0) {
        const row = cwResult.rows[0];
        campaignContext = { campaignNombre: row.campaign_nombre, templateBody: row.template_body };
        console.log(`[Bot] Contexto de campaña detectado para ${telefono}: "${row.campaign_nombre}"`);
      }
    } catch (cwErr) {
      // No crítico — el bot funciona sin contexto de campaña
      console.warn('[Bot] No se pudo consultar contexto de campaña:', cwErr.message);
    }

    const rawBotResponse = await generateBotResponse(combinedText, conversationHistory, campaignContext);

    // Validar que ninguna URL de la respuesta sea una alucinación
    const botResponse = await sanitizeBotResponse(rawBotResponse);

    // Enviar respuesta por WhatsApp (solo funciona en ventana de 24h)
    const botMessageId = await sendFreeTextMessage(telefono, botResponse);
    console.log(`[Bot] Respuesta enviada a ${telefono} — WA ID: ${botMessageId}`);

    // Persistir el turno (texto combinado + respuesta del bot) en la memoria de conversación
    await saveConversationTurn(telefono, combinedText, botResponse);

    // Registrar la respuesta del bot en Chatwoot como mensaje saliente
    if (chatwootConversationId) {
      try {
        await sendMessageToConversation(chatwootConversationId, botResponse, 'outgoing');
      } catch (chatwootErr) {
        console.warn('[Bot] No se pudo registrar respuesta en Chatwoot:', chatwootErr.message);
      }
    }
  } catch (botErr) {
    // El bot falla silenciosamente — nunca debe cortar el flujo principal del webhook
    console.error('[Bot] Error al generar o enviar respuesta:', botErr.message);
  }
}

/** Etiquetas legibles para cada tipo de media */
const MEDIA_LABELS = {
  image: 'Imagen',
  video: 'Video',
  document: 'Documento',
  audio: 'Audio',
};

/**
 * Procesa un mensaje multimedia entrante (imagen, video, documento, audio).
 * Obtiene la URL temporal del archivo desde Meta, guarda en DB y sincroniza
 * con Chatwoot como texto descriptivo.
 *
 * ⚠️ Las URLs de media de Meta expiran en ~5 minutos. Se almacenan como
 *    referencia pero pueden no ser accesibles tiempo después.
 *
 * @param {Object} params
 * @param {string} params.telefono    - Número del remitente
 * @param {string} params.nombre      - Nombre del remitente
 * @param {string} params.waMessageId - ID del mensaje de WhatsApp
 * @param {Object} params.msg         - Objeto del mensaje de Meta
 */
async function processIncomingMedia({ telefono, nombre, waMessageId, msg }) {
  const mediaType = msg.type;
  const mediaData = msg[mediaType] || {};
  const mediaId   = mediaData.id;
  const caption   = mediaData.caption || '';
  const filename  = mediaData.filename || '';

  // Intentar obtener la URL temporal de descarga desde Meta
  let mediaUrl = null;
  if (mediaId) {
    try {
      mediaUrl = await getMediaUrl(mediaId);
    } catch (err) {
      console.warn(`[Webhook] No se pudo obtener URL del media ${mediaId}:`, err.message);
    }
  }

  // ⚠️ Para audio: descargar el buffer INMEDIATAMENTE antes de que la URL expire.
  // Meta expira los enlaces de descarga en ~5 minutos. Las operaciones de Chatwoot y DB
  // que siguen pueden demorar, así que descargamos ahora mientras la URL es fresca.
  let audioBuffer = null;
  if (mediaType === 'audio' && mediaUrl) {
    try {
      audioBuffer = await downloadMediaBuffer(mediaUrl);
      console.log(`[Webhook] Buffer de audio descargado — ${audioBuffer.length} bytes de ${telefono}`);
    } catch (err) {
      console.warn(`[Webhook] No se pudo descargar buffer de audio para ${telefono}:`, err.message);
    }
  }

  // Texto descriptivo para Chatwoot y trazabilidad
  const label = MEDIA_LABELS[mediaType] || mediaType;
  let messageText = caption ? `[${label}] ${caption}` : `[${label} recibido]`;
  if (filename) messageText += ` — ${filename}`;

  // Sincronizar con Chatwoot (como mensaje de texto descriptivo)
  let chatwootConversationId = null;
  try {
    const contact      = await getOrCreateContact(telefono, nombre);
    const conversation = await getOrCreateConversation(contact.id);
    chatwootConversationId = conversation.id;
    await sendMessageToConversation(conversation.id, messageText, 'incoming');
    console.log(`[Webhook] Media entrante de ${telefono} (${mediaType}) sincronizado con Chatwoot`);

    // Auto-etiquetado para imágenes/documentos con caption — fire-and-forget
    if (caption) autoTagConversation(chatwootConversationId, caption).catch(() => {});
  } catch (err) {
    console.warn('[Webhook] No se pudo sincronizar media con Chatwoot:', err.message);
  }

  // Guardar en DB local con tipo y URL del media
  try {
    await query(
      `INSERT INTO incoming_messages
         (telefono, nombre, message, whatsapp_message_id, chatwoot_conversation_id, media_type, media_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [telefono, nombre, messageText, waMessageId, chatwootConversationId, mediaType, mediaUrl]
    );
    console.log(`[Webhook] Media entrante guardado — de: ${telefono} tipo: ${mediaType}`);
  } catch (err) {
    console.error('[Webhook] Error guardando media entrante en DB:', err.message);
  }

  // --- Bot: responder al media si está activo ---
  // Audio: transcribir con Whisper → responder con IA al texto transcripto.
  // Imagen con caption: responder con IA al caption.
  // Resto (video, documento, imagen sin texto): acuse de recibo fijo.
  try {
    const botActive = await shouldBotRespond(telefono);
    if (!botActive) return;

    let botResponse;
    let userText = null; // texto que se guardará en la memoria de conversación

    if (mediaType === 'audio') {
      // Flujo Whisper: buffer ya descargado al inicio → transcribir → responder con IA
      // Fallback al acuse de recibo fijo si algo falla
      try {
        if (!audioBuffer) throw new Error('Buffer de audio no disponible (URL expirada o error de descarga)');

        const mimeType = mediaData.mime_type || 'audio/ogg';
        const transcripcion = await transcribeAudio(audioBuffer, mimeType);

        if (!transcripcion) throw new Error('Transcripción vacía o en silencio');

        console.log(`[Whisper] Transcripción de ${telefono}: "${transcripcion}"`);

        // Auto-etiquetado basado en el texto transcripto — fire-and-forget
        if (chatwootConversationId) autoTagConversation(chatwootConversationId, transcripcion).catch(() => {});

        const conversationHistory = await getConversationHistory(telefono);
        const rawBotResponse = await generateBotResponse(transcripcion, conversationHistory, null);
        botResponse = await sanitizeBotResponse(rawBotResponse);
        userText = transcripcion; // guardar el texto real en la memoria

        // Mostrar en Chatwoot la transcripción para que el agente humano la vea
        if (chatwootConversationId) {
          try {
            await sendMessageToConversation(
              chatwootConversationId,
              `🎙️ [Transcripción de audio] "${transcripcion}"`,
              'incoming'
            );
          } catch { /* no crítico */ }
        }
      } catch (whisperErr) {
        // Fallback: el audio no se pudo transcribir — responder con acuse de recibo
        console.warn(`[Whisper] Transcripción fallida para ${telefono}: ${whisperErr.message} — usando acuse de recibo`);
        botResponse = 'Recibí tu mensaje de voz, pero no pude escucharlo correctamente. ¿Me podés escribir tu consulta?';
      }

    } else if (mediaType === 'image' && caption) {
      // Imagen con texto: responder con IA al caption
      const conversationHistory = await getConversationHistory(telefono);
      const rawBotResponse = await generateBotResponse(caption, conversationHistory, null);
      botResponse = await sanitizeBotResponse(rawBotResponse);
      userText = caption;

    } else {
      // Video, documento, o imagen sin caption: acuse de recibo fijo
      const acks = {
        image:    'Recibí tu imagen. ¿En qué te puedo ayudar?',
        video:    'Recibí tu video. ¿En qué te puedo ayudar?',
        document: 'Recibí tu documento. ¿En qué te puedo ayudar?',
      };
      botResponse = acks[mediaType] || 'Recibí tu mensaje. ¿En qué te puedo ayudar?';
    }

    // Guardar el turno en la memoria si tenemos texto real (no para acuses de recibo fijos)
    if (userText) {
      await saveConversationTurn(telefono, userText, botResponse);
    }

    const botMessageId = await sendFreeTextMessage(telefono, botResponse);
    console.log(`[Bot] Respuesta enviada a ${telefono} — WA ID: ${botMessageId}`);

    if (chatwootConversationId) {
      try {
        await sendMessageToConversation(chatwootConversationId, botResponse, 'outgoing');
      } catch (cwErr) {
        console.warn('[Bot] No se pudo registrar respuesta en Chatwoot:', cwErr.message);
      }
    }
  } catch (botErr) {
    console.error('[Bot] Error al responder media:', botErr.message);
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
