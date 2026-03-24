/**
 * Servicio de bot con IA — OpenAI GPT
 * Autor: Turnio
 * Fecha: 2026-03-19
 * Dependencias: openai, pg
 *
 * Lee la configuración del bot desde la tabla config en PostgreSQL.
 * Solo responde si el bot está habilitado y dentro del horario configurado.
 * Usa gpt-4o-mini para generar respuestas en lenguaje natural.
 *
 * Integración con WooCommerce:
 *  Antes de llamar a GPT, busca productos relevantes en waba_products según
 *  el mensaje del usuario e inyecta la lista en el system prompt.
 *  Esto permite que el bot recomiende productos reales y en stock.
 */

import OpenAI from 'openai';
import { query } from '../db/index.js';
import { searchRelevantProducts } from './woocommerce.js';

/**
 * Carga todos los artículos activos de la base de conocimiento y los formatea
 * como bloque de texto para inyectar en el system prompt del bot.
 *
 * @returns {Promise<string>} Bloque de texto o string vacío si no hay artículos
 */
async function getKnowledgeContext() {
  try {
    const result = await query(
      `SELECT titulo, tipo, contenido
       FROM waba_knowledge
       WHERE activo = true
       ORDER BY tipo ASC, titulo ASC`
    );
    if (result.rows.length === 0) return '';

    const lines = result.rows.map(
      (k) => `[${k.tipo.toUpperCase()}] ${k.titulo}:\n${k.contenido}`
    );
    return `\n\nINFORMACIÓN DE LA EMPRESA:\n${lines.join('\n\n')}`;
  } catch (err) {
    console.warn('[Bot] No se pudo cargar la base de conocimiento:', err.message);
    return '';
  }
}

// El cliente OpenAI toma la API key del entorno automáticamente (OPENAI_API_KEY)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Lee la configuración del bot desde la tabla config.
 * Devuelve valores por defecto seguros si alguna clave no existe.
 *
 * @returns {Promise<{
 *   enabled: boolean,
 *   prompt: string,
 *   scheduleEnabled: boolean,
 *   scheduleStart: string,
 *   scheduleEnd: string
 * }>}
 */
export async function getBotConfig() {
  const result = await query(
    `SELECT key, value FROM config
     WHERE key IN ('BOT_ENABLED', 'BOT_PROMPT', 'BOT_SCHEDULE_ENABLED', 'BOT_SCHEDULE_START', 'BOT_SCHEDULE_END')`
  );

  const raw = {};
  for (const row of result.rows) {
    raw[row.key] = row.value;
  }

  return {
    enabled: raw.BOT_ENABLED === 'true',
    prompt: raw.BOT_PROMPT || 'Sos un asistente virtual. Respondés preguntas de forma amable y profesional.',
    scheduleEnabled: raw.BOT_SCHEDULE_ENABLED === 'true',
    scheduleStart: raw.BOT_SCHEDULE_START || '08:00',
    scheduleEnd: raw.BOT_SCHEDULE_END || '20:00',
  };
}

/**
 * Verifica si la hora actual (Argentina UTC-3) está dentro del horario configurado.
 * El rango es inclusivo en el inicio y exclusivo en el fin.
 *
 * @param {string} start - Hora de inicio en formato HH:MM (ej: "08:00")
 * @param {string} end   - Hora de fin en formato HH:MM (ej: "20:00")
 * @returns {boolean}
 */
export function isWithinSchedule(start, end) {
  // Argentina es UTC-3 fijo (no tiene horario de verano actualmente)
  const now = new Date();
  const argOffset = -3 * 60; // minutos
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const argMinutes = ((utcMinutes + argOffset) % (24 * 60) + 24 * 60) % (24 * 60);

  const [startH, startM] = start.split(':').map(Number);
  const [endH, endM] = end.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  // Rango normal (ej: 08:00 a 20:00)
  if (startMinutes <= endMinutes) {
    return argMinutes >= startMinutes && argMinutes < endMinutes;
  }

  // Rango nocturno que cruza medianoche (ej: 22:00 a 06:00)
  return argMinutes >= startMinutes || argMinutes < endMinutes;
}

/**
 * Determina si el bot debe responder al mensaje entrante.
 * Condiciones:
 *   1. BOT_ENABLED debe ser true
 *   2. Si BOT_SCHEDULE_ENABLED es true, la hora actual debe estar dentro del horario
 *   3. La conversación con este teléfono no debe estar tomada por un agente humano
 *
 * @param {string} telefono - Número del remitente (para verificar takeover)
 * @returns {Promise<boolean>}
 */
export async function shouldBotRespond(telefono) {
  try {
    const config = await getBotConfig();

    if (!config.enabled) return false;

    if (config.scheduleEnabled) {
      if (!isWithinSchedule(config.scheduleStart, config.scheduleEnd)) return false;
    }

    // Verificar si un agente tomó el control de esta conversación.
    // Si bot_paused = true, el bot se silencia para este número específico.
    if (telefono) {
      const override = await query(
        'SELECT bot_paused FROM waba_conversation_overrides WHERE telefono = $1',
        [telefono]
      );
      if (override.rows[0]?.bot_paused === true) {
        console.log(`[Bot] Conversación con ${telefono} tomada por agente — bot silenciado`);
        return false;
      }
    }

    return true;
  } catch (err) {
    // Si falla la lectura de config, no respondemos — preferimos silencio a responder mal
    console.error('[Bot] Error al leer configuración:', err.message);
    return false;
  }
}

/**
 * Formatea la lista de productos para incluirla en el system prompt.
 * Convierte los datos de DB a texto legible para el modelo.
 *
 * @param {Array} products - Productos de waba_products
 * @returns {string} Bloque de texto con los productos
 */
function formatProductsForPrompt(products) {
  if (!products || products.length === 0) return '';

  const lines = products.map((p) => {
    const precio = p.precio_oferta
      ? `$${p.precio_oferta} (antes $${p.precio})`
      : `$${p.precio}`;
    // Para productos con talles/colores, mostrar los disponibles en lugar del número de stock
    const disponibilidad = p.variantes
      ? `Talles disponibles: ${p.variantes}`
      : `Stock: ${p.stock}`;
    const desc = p.descripcion_vision || p.nombre;
    const link = p.permalink ? ` | Link: ${p.permalink}` : '';
    return `• ${p.nombre} — ${desc} | Precio: ${precio} | ${disponibilidad}${link}`;
  });

  return `\n\nPRODUCTOS DISPONIBLES EN STOCK:\n${lines.join('\n')}`;
}

/**
 * Genera una respuesta usando OpenAI gpt-4o-mini.
 * Incluye el historial de conversación y productos relevantes del catálogo.
 *
 * Flujo:
 *  1. Buscar productos relevantes según el mensaje del usuario
 *  2. Armar el system prompt con las instrucciones + productos encontrados
 *  3. Llamar a GPT con el historial + mensaje actual
 *
 * @param {string} userMessage           - Mensaje actual del usuario
 * @param {Array<{role: string, content: string}>} conversationHistory - Últimos mensajes previos
 * @returns {Promise<string>} Texto de la respuesta generada
 */
export async function generateBotResponse(userMessage, conversationHistory = []) {
  const config = await getBotConfig();

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY no está definida en las variables de entorno');
  }

  // Buscar productos relevantes en el catálogo según el mensaje del usuario.
  // Siempre se busca en waba_products (BD local), independientemente de si WooCommerce está conectado.
  let productosContext = '';
  try {
    const products = await searchRelevantProducts(userMessage, 6);
    productosContext = formatProductsForPrompt(products);
    if (products.length > 0) {
      console.log(`[Bot] ${products.length} producto(s) relevante(s) inyectados en el prompt`);
    }
  } catch (err) {
    // No cortamos el bot si falla la búsqueda de productos
    console.warn('[Bot] No se pudieron buscar productos:', err.message);
  }

  // Cargar base de conocimiento (políticas, FAQs, info de la empresa)
  const knowledgeContext = await getKnowledgeContext();

  // System prompt = instrucciones del usuario + conocimiento + productos disponibles
  const systemPrompt = config.prompt + knowledgeContext + productosContext;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      // Últimos N mensajes para que el modelo tenga contexto de la conversación
      ...conversationHistory,
      { role: 'user', content: userMessage },
    ],
    max_tokens: 800,
    temperature: 0.7,
  });

  const text = response.choices[0]?.message?.content;
  if (!text) {
    throw new Error('OpenAI no devolvió contenido en la respuesta');
  }

  return text.trim();
}

/**
 * Valida que todas las URLs mencionadas en la respuesta del bot existan
 * como permalinks activos en el catálogo de productos (waba_products).
 *
 * Si el bot alucinó una URL que no está en el catálogo, intercepta la
 * respuesta completa y la reemplaza por un mensaje seguro.
 * Si no hay URLs en la respuesta, la devuelve sin cambios.
 *
 * @param {string} text - Respuesta generada por el bot
 * @returns {Promise<string>} Respuesta original o mensaje de fallback
 */
export async function sanitizeBotResponse(text) {
  // Extraer todas las URLs HTTP/HTTPS del texto
  const urlMatches = text.match(/https?:\/\/[^\s\)\]>,"']+/g);

  // Sin URLs → nada que validar
  if (!urlMatches || urlMatches.length === 0) return text;

  // Limpiar puntuación final que puede pegarse a la URL (punto, coma, etc.)
  const urls = urlMatches.map((u) => u.replace(/[.,;:!?]+$/, ''));

  try {
    const result = await query(
      'SELECT permalink FROM waba_products WHERE permalink = ANY($1::text[]) AND activo = true AND stock > 0',
      [urls]
    );

    const existingUrls = new Set(result.rows.map((r) => r.permalink));
    const invalidUrls = urls.filter((u) => !existingUrls.has(u));

    if (invalidUrls.length > 0) {
      console.warn(
        `[Bot] URL(s) no encontrada(s) en el catálogo: ${invalidUrls.join(', ')} — interceptando respuesta`
      );
      return 'Por ahora no tenemos productos que coincidan con esa búsqueda. ¿Querés que te muestre opciones similares?';
    }
  } catch (err) {
    // Si falla la validación, pasamos la respuesta original — mejor enviar que silenciar
    console.error('[Bot] Error al validar URLs de la respuesta:', err.message);
  }

  return text;
}
