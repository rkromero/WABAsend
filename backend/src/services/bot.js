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
     WHERE key IN ('BOT_ENABLED', 'BOT_PROMPT', 'BOT_SCHEDULE_ENABLED', 'BOT_SCHEDULE_START', 'BOT_SCHEDULE_END', 'BOT_SYNONYMS')`
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
    synonymsRaw: raw.BOT_SYNONYMS || '',
  };
}

/**
 * Expande un mensaje de búsqueda usando los grupos de sinónimos configurados.
 * Si el mensaje contiene un término que pertenece a un grupo, agrega sus equivalentes
 * al final de la query para que la búsqueda los considere también.
 *
 * Formato de synonymsRaw: cada línea es un grupo, términos separados por coma.
 * Ejemplo:
 *   campera, chaqueta, jacket, abrigo
 *   remera, camiseta, polera
 *
 * @param {string} mensaje      - Mensaje original del usuario
 * @param {string} synonymsRaw  - Valor de BOT_SYNONYMS de la config
 * @returns {string} Mensaje expandido con sinónimos adicionales
 */
function expandWithSynonyms(mensaje, synonymsRaw) {
  if (!synonymsRaw || !synonymsRaw.trim()) return mensaje;

  // Parsear los grupos: cada línea es un grupo, términos separados por coma
  const groups = synonymsRaw
    .split('\n')
    .map((line) => line.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))
    .filter((g) => g.length > 1);

  if (groups.length === 0) return mensaje;

  const mensajeLower = mensaje.toLowerCase();
  const additions = [];

  for (const group of groups) {
    // Verificar si algún término del grupo aparece en el mensaje
    const matchedTerm = group.find((term) => {
      // Buscar como palabra completa para evitar falsos positivos
      const regex = new RegExp(`\\b${term}\\b`, 'i');
      return regex.test(mensajeLower);
    });

    if (matchedTerm) {
      // Agregar los otros términos del grupo que no estén ya en el mensaje
      for (const synonym of group) {
        if (synonym !== matchedTerm && !new RegExp(`\\b${synonym}\\b`, 'i').test(mensajeLower)) {
          additions.push(synonym);
        }
      }
    }
  }

  if (additions.length === 0) return mensaje;

  const expanded = `${mensaje} ${additions.join(' ')}`;
  console.log(`[Bot] Sinónimos aplicados: "${mensaje.substring(0, 60)}" → "${expanded.substring(0, 80)}"`);
  return expanded;
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
 *  2. Armar el system prompt con las instrucciones + contexto de campaña (si aplica) + productos
 *  3. Llamar a GPT con el historial + mensaje actual
 *
 * @param {string} userMessage           - Mensaje actual del usuario
 * @param {Array<{role: string, content: string}>} conversationHistory - Últimos mensajes previos
 * @param {{ campaignNombre: string, templateBody: string }|null} campaignContext
 *   - Si la persona está respondiendo a una campaña reciente, este objeto contiene
 *     el nombre y el texto del mensaje de campaña que recibió.
 * @returns {Promise<string>} Texto de la respuesta generada
 */
export async function generateBotResponse(userMessage, conversationHistory = [], campaignContext = null) {
  const config = await getBotConfig();

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY no está definida en las variables de entorno');
  }

  // Detectar si el mensaje actual es demasiado corto o conversacional para buscar productos.
  // Mensajes como "dale", "si", "otro", "ok", "anchos" no tienen contexto suficiente.
  // En ese caso, combinamos con el último mensaje del usuario en el historial para
  // mantener el contexto de la búsqueda anterior.
  const MENSAJES_CORTOS = /^(dale|si|sí|ok|bueno|otro|otra|más|mas|show|ver|muéstrame|mostrame|cuál|cual|éste|este|porqué|porque|genial|perfecto|excelente|gracias|joya|bárbaro|barbaro|nada|ninguno|ninguna|listo)$/i;
  const esCorto = userMessage.trim().length <= 6 || MENSAJES_CORTOS.test(userMessage.trim());

  let searchQuery = userMessage;
  if (esCorto && conversationHistory.length > 0) {
    // Tomar el último mensaje del usuario en el historial para dar contexto a la búsqueda
    const lastUserMsg = [...conversationHistory]
      .reverse()
      .find((m) => m.role === 'user')?.content || '';
    if (lastUserMsg) {
      searchQuery = `${lastUserMsg} ${userMessage}`;
      console.log(`[Bot] Mensaje corto detectado — búsqueda con contexto: "${searchQuery.substring(0, 80)}"`);
    }
  }

  // Expandir la query con sinónimos configurados antes de buscar productos.
  // Ej: "campera greek" → "campera greek chaqueta jacket" si "campera, chaqueta, jacket" es un grupo.
  const expandedSearchQuery = expandWithSynonyms(searchQuery, config.synonymsRaw);

  // Buscar productos relevantes en el catálogo según el mensaje del usuario.
  // Siempre se busca en waba_products (BD local), independientemente de si WooCommerce está conectado.
  let productosContext = '';
  try {
    const products = await searchRelevantProducts(expandedSearchQuery, 6);
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

  // INSTRUCCIÓN ANTI-ALUCINACIÓN DE URLs:
  // El bot solo puede mencionar URLs de productos que estén explícitamente listados
  // en el bloque PRODUCTOS DISPONIBLES EN STOCK. Cualquier URL inventada será interceptada.
  const antiHallucinationRule = '\n\nREGLA IMPORTANTE: Solo podés incluir links/URLs de productos que aparezcan EXACTAMENTE en la lista de PRODUCTOS DISPONIBLES EN STOCK que se te proporcionó. Nunca inventes ni construyas URLs. Si no tenés el link del producto en la lista, describí el producto sin incluir link.';

  // Contexto de campaña: si la persona está respondiendo a un mensaje saliente,
  // le indicamos al bot de qué trataba ese mensaje para que responda en esa línea.
  const campaignBlock = campaignContext
    ? `\n\nCONTEXTO DE CAMPAÑA:\nEsta persona recibió recientemente la campaña "${campaignContext.campaignNombre}" con el siguiente mensaje:\n"${campaignContext.templateBody}"\n\nRespondé teniendo en cuenta ese contexto. Si era una campaña de reactivación, recibimiento o novedad, respondé con entusiasmo y continuá la conversación en esa línea antes de ofrecer productos.`
    : '';

  // System prompt = instrucciones del usuario + contexto de campaña + conocimiento + productos disponibles + regla anti-alucinación
  const systemPrompt = config.prompt + campaignBlock + knowledgeContext + productosContext + antiHallucinationRule;

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
      return 'Por ahora no tenemos productos que coincidan exactamente con esa búsqueda. ¿En qué más te puedo ayudar?';
    }
  } catch (err) {
    // Si falla la validación, pasamos la respuesta original — mejor enviar que silenciar
    console.error('[Bot] Error al validar URLs de la respuesta:', err.message);
  }

  return text;
}
