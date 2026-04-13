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
import { searchRelevantProducts, detectGarmentCategory } from './woocommerce.js';
import { expandVariantes, getSizeRulesBlock } from './sizeNormalizer.js';

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
 * Genera todas las queries de búsqueda posibles aplicando sinónimos.
 *
 * En lugar de concatenar todos los sinónimos en una sola cadena (que rompe el FTS
 * con AND implícito), genera una query por cada sustitución posible. Así:
 *   "campera greek" + grupo [campera, chaqueta, jacket, abrigo]
 *   → ["campera greek", "chaqueta greek", "jacket greek", "abrigo greek"]
 *
 * Esto permite que `searchRelevantProducts` encuentre "chaqueta greek" aunque
 * el usuario haya buscado "campera greek".
 *
 * Formato de synonymsRaw: cada línea es un grupo, términos separados por coma.
 * Ejemplo:
 *   campera, chaqueta, jacket, abrigo
 *   remera, camiseta, polera
 *
 * @param {string} mensaje      - Mensaje original del usuario
 * @param {string} synonymsRaw  - Valor de BOT_SYNONYMS de la config
 * @returns {string[]} Array de queries (siempre incluye el mensaje original primero)
 */
function buildSynonymQueries(mensaje, synonymsRaw) {
  if (!synonymsRaw || !synonymsRaw.trim()) return [mensaje];

  // Parsear los grupos: cada línea es un grupo, términos separados por coma
  const groups = synonymsRaw
    .split('\n')
    .map((line) => line.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))
    .filter((g) => g.length > 1);

  if (groups.length === 0) return [mensaje];

  const mensajeLower = mensaje.toLowerCase();
  const queries = [mensaje]; // el original siempre va primero

  for (const group of groups) {
    // Verificar si algún término del grupo aparece en el mensaje como palabra completa
    const matchedTerm = group.find((term) =>
      new RegExp(`\\b${term}\\b`, 'i').test(mensajeLower)
    );

    if (matchedTerm) {
      // Generar una query por cada sinónimo reemplazando el término original
      // Ej: "campera greek" + matchedTerm="campera" + synonym="chaqueta" → "chaqueta greek"
      for (const synonym of group) {
        if (synonym === matchedTerm) continue;
        const replaced = mensaje.replace(new RegExp(`\\b${matchedTerm}\\b`, 'gi'), synonym);
        if (!queries.includes(replaced)) {
          queries.push(replaced);
        }
      }
      console.log(`[Bot] Sinónimos: "${mensaje.substring(0, 50)}" → ${queries.length} variantes`);
    }
  }

  return queries;
}

/**
 * Genera un bloque de texto con los grupos de sinónimos configurados para incluir
 * en el system prompt. Esto le enseña a GPT que ciertos términos son equivalentes,
 * para que cuando el cliente diga "campera" y el catálogo tenga "chaqueta", los conecte.
 *
 * @param {string} synonymsRaw - Valor de BOT_SYNONYMS de la config
 * @returns {string} Bloque de texto o string vacío si no hay sinónimos
 */
function buildSynonymsBlock(synonymsRaw) {
  if (!synonymsRaw || !synonymsRaw.trim()) return '';

  const groups = synonymsRaw
    .split('\n')
    .map((line) => line.split(',').map((t) => t.trim()).filter(Boolean))
    .filter((g) => g.length > 1);

  if (groups.length === 0) return '';

  const lines = groups.map((g) => g.join(' = '));
  return `\n\nSINÓNIMOS DE PRODUCTOS (términos equivalentes configurados por la tienda):\n${lines.join('\n')}\nREGLA CRÍTICA: Si la clienta pide un producto usando cualquiera de estos términos, buscá en la lista de productos disponibles usando TODOS los sinónimos equivalentes. Por ejemplo: si pide "campera greek" y en el catálogo hay "chaqueta greek", ese ES el producto que está buscando — mostráselo. No digas que no tenés si hay un producto equivalente con otro nombre del grupo.`;
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

    // Detectar categoría de prenda para normalizar los talles correctamente
    // (superiores usan S/M/L/XL, inferiores usan 36/38/40/42)
    const garmentCategory = detectGarmentCategory(p.nombre || '', p.categorias || '');
    const variantesNormalizadas = expandVariantes(p.variantes, garmentCategory);

    // Para productos con talles/colores, mostrar las opciones disponibles (pueden ser talles, colores o ambos)
    const disponibilidad = p.variantes
      ? `Opciones disponibles (talles/colores): ${variantesNormalizadas}`
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

  // Detectar pedidos de combinación: "un jean para usar con esa campera" o
  // "me mostras un jean para combinar con X". La oración completa contamina
  // la búsqueda — el FTS encuentra "campera" y olvida el "jean" pedido.
  // También detectar consultas de precio: "quiero el precio del trench",
  // "cuánto sale el trench", etc. — el FTS falla porque requiere que el
  // documento contenga "precio" Y "trench" al mismo tiempo.
  // En todos los casos, extraemos solo el nombre del producto.
  if (!esCorto) {
    // Patrón 0: consultas de precio — "precio del/de la X", "cuánto sale/cuesta X"
    const precioMatch = searchQuery.match(
      /\bprecio\s+(?:del?\s+|de\s+(?:la\s+|los\s+|las\s+|un[ao]?\s+)?)([\w\s]{2,30}?)(?:\s*[?,.]|\s*$)/i
    ) || searchQuery.match(
      /\b(?:cuánto|cuanto)\s+(?:sale|cuesta|salen|cuestan|saldr[ií]a|costar[ií]a)\s+(?:el\s+|la\s+|los\s+|las\s+|un[ao]?\s+)?([\w\s]{2,30}?)(?:\s*[?,.]|\s*$)/i
    );
    if (precioMatch) {
      const producto = precioMatch[1].trim();
      if (producto.split(/\s+/).length <= 4) {
        console.log(`[Bot] Consulta de precio — buscando producto: "${producto}"`);
        searchQuery = producto;
      }
    } else {
      // Patrón 1: "un/una X para usar/combinar/llevar con..."
      const combinMatch = searchQuery.match(
        /\bun[ao]?\s+([\w\s]{2,30}?)\s+para\s+(?:usar|combinar|llevar|ponerse|combinarlo|combinarla)\b/i
      );
      if (combinMatch) {
        const producto = combinMatch[1].trim();
        console.log(`[Bot] Pedido de combinación — buscando producto: "${producto}"`);
        searchQuery = producto;
      } else {
        // Patrón 2: "me mostras/mostrame un/una X" (sin el contexto de combinación)
        const mostrameMatch = searchQuery.match(
          /(?:me\s+mostras|mostras|mostrás|mostrame)\s+(?:un[ao]?\s+)?([\w\s]{2,30}?)(?:\s+para\b|$)/i
        );
        if (mostrameMatch) {
          const producto = mostrameMatch[1].trim();
          if (producto.split(/\s+/).length <= 4) { // Máx 4 palabras = producto real, no frase
            console.log(`[Bot] Pedido directo — buscando producto: "${producto}"`);
            searchQuery = producto;
          }
        }
      }
    }
  }

  // Generar todas las variantes de búsqueda con sinónimos.
  // En lugar de concatenar sinónimos (que rompe el FTS con AND), genera una query
  // por sustitución: "campera greek" → ["campera greek", "chaqueta greek", "jacket greek"]
  const synonymQueries = buildSynonymQueries(searchQuery, config.synonymsRaw);

  // Buscar productos relevantes en el catálogo según el mensaje del usuario.
  // Si hay sinónimos, buscamos con cada query alternativa y mergeamos resultados
  // únicos (por nombre de producto) para maximizar la cobertura.
  let productosContext = '';
  try {
    // Búsqueda principal con la query original
    const primaryResults = await searchRelevantProducts(synonymQueries[0], 6);

    // Búsquedas con variantes de sinónimo — siempre se ejecutan.
    // Los resultados de sinónimos van PRIMERO porque son más específicos:
    // si el usuario pide "campera greek" y encontramos "chaqueta greek" vía sinónimo,
    // ese producto debe aparecer al tope de la lista para que GPT lo identifique
    // correctamente, antes que las camperas genéricas del resultado primario.
    const synonymResults = [];
    const synonymSeen = new Set();
    for (let i = 1; i < synonymQueries.length; i++) {
      const extra = await searchRelevantProducts(synonymQueries[i], 6);
      for (const p of extra) {
        if (!synonymSeen.has(p.nombre)) {
          synonymSeen.add(p.nombre);
          synonymResults.push(p);
        }
      }
    }

    // Mergear: sinónimos primero, luego primarios que no estén ya en sinónimos
    const merged = [...synonymResults];
    for (const p of primaryResults) {
      if (!synonymSeen.has(p.nombre)) merged.push(p);
    }

    // Limitar a 8 resultados para no sobrecargar el prompt de GPT.
    const finalProducts = merged.slice(0, 8);
    productosContext = formatProductsForPrompt(finalProducts);
    if (finalProducts.length > 0) {
      console.log(`[Bot] ${finalProducts.length} producto(s) relevante(s) inyectados en el prompt (${synonymQueries.length} variante(s) buscadas)`);
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

  // REGLAS DE COMPORTAMIENTO:
  // Punto 3: Cuando el cliente duda por talle o pide un talle no disponible,
  //   mencionar proactivamente que todas las compras tienen política de cambio.
  // Punto 5: Nunca cerrar la conversación derivando al equipo por mensajes confusos —
  //   pedir clarificación en cambio.
  const behaviorRules = `\n\nREGLAS DE COMPORTAMIENTO:
1. POLÍTICA DE CAMBIOS: Cuando una clienta duda si le va a quedar bien, pregunta por un talle que no está disponible, o menciona que no sabe qué talle elegir — siempre aclará que "todos los pedidos tienen cambio". No esperes a que lo pregunten: mencionarlo en ese momento convierte dudas en ventas.
2. MENSAJES CONFUSOS: Si recibís un mensaje que no entendés bien (dictado de voz mal transcripto, frase incompleta, contexto poco claro), NUNCA respondas con "comunicate con nuestro equipo" ni cerrés la conversación. En cambio, preguntá con amabilidad: "No entendí bien tu consulta, ¿me podés decir qué prenda te interesa?"
3. NUNCA derivés a "nuestro equipo" como respuesta a una duda de producto — esas consultas las resolvés vos. Solo derivar si es algo administrativo (cambio ya enviado, problema con un pago, etc.).`;

  // Contexto de campaña: si la persona está respondiendo a un mensaje saliente,
  // le indicamos al bot de qué trataba ese mensaje para que responda en esa línea.
  const campaignBlock = campaignContext
    ? `\n\nCONTEXTO DE CAMPAÑA:\nEsta persona recibió recientemente la campaña "${campaignContext.campaignNombre}" con el siguiente mensaje:\n"${campaignContext.templateBody}"\n\nRespondé teniendo en cuenta ese contexto. Si era una campaña de reactivación, recibimiento o novedad, respondé con entusiasmo y continuá la conversación en esa línea antes de ofrecer productos.`
    : '';

  // Reglas de equivalencia de talles: enseña al modelo que "2" = "M" (superiores)
  // y "2" = "38" (inferiores), y que el talle único es universal en prendas superiores.
  const sizeRules = getSizeRulesBlock();

  // Reglas de sinónimos: le enseña a GPT que ciertos términos son equivalentes
  // para que reconozca "chaqueta greek" aunque el cliente diga "campera greek".
  const synonymsBlock = buildSynonymsBlock(config.synonymsRaw);

  // System prompt = instrucciones del usuario + campaña + conocimiento + sinónimos + reglas de talles + productos + regla anti-alucinación + reglas de comportamiento
  const systemPrompt = config.prompt + campaignBlock + knowledgeContext + synonymsBlock + sizeRules + productosContext + antiHallucinationRule + behaviorRules;

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
 * Normaliza una URL para comparación: lowercase, sin trailing slash,
 * sin puntuación suelta al final.
 * Ej: "https://Vicca.com.ar/producto/greek/" → "https://vicca.com.ar/producto/greek"
 *
 * @param {string} url
 * @returns {string}
 */
function normalizeUrl(url) {
  return url.toLowerCase().replace(/[.,;:!?]+$/, '').replace(/\/+$/, '');
}

/**
 * Valida las URLs mencionadas en la respuesta del bot contra el catálogo real.
 *
 * Si el bot incluye URLs inválidas (alucinadas o con formato diferente al DB),
 * las STRIPEA del texto en lugar de descartar toda la respuesta.
 * Así el usuario recibe la información del producto correctamente aunque sin link.
 *
 * La comparación es normalizada (case-insensitive, trailing slash opcional) para
 * evitar falsos negativos por diferencias mínimas de formato.
 *
 * @param {string} text - Respuesta generada por el bot
 * @returns {Promise<string>} Respuesta original, con URLs inválidas removidas
 */
export async function sanitizeBotResponse(text) {
  // Extraer todas las URLs HTTP/HTTPS del texto
  const urlMatches = text.match(/https?:\/\/[^\s\)\]>,"']+/g);

  // Sin URLs → nada que validar
  if (!urlMatches || urlMatches.length === 0) return text;

  // Normalizar URLs extraídas
  const urls = urlMatches.map((u) => normalizeUrl(u));

  try {
    // Buscar en el DB usando LIKE para cubrir variantes con/sin trailing slash
    // y comparando en lowercase vía lower().
    const result = await query(
      `SELECT permalink FROM waba_products
       WHERE activo = true AND stock > 0
         AND lower(rtrim(permalink, '/')) = ANY($1::text[])`,
      [urls]
    );

    const existingNormalized = new Set(result.rows.map((r) => normalizeUrl(r.permalink)));
    const invalidUrls = urls.filter((u) => !existingNormalized.has(u));

    if (invalidUrls.length > 0) {
      console.warn(
        `[Bot] URL(s) inválida(s) en la respuesta: ${invalidUrls.join(', ')} — strippeando del texto`
      );
      // Stripear cada URL inválida del texto junto con posibles etiquetas Markdown
      // que la rodean: "| Link: https://..." o "[ver acá](https://...)"
      let sanitized = text;
      for (const invalidUrl of invalidUrls) {
        // Buscar la URL original (antes de normalizar) que corresponde a esta URL inválida
        const originalUrl = urlMatches.find((u) => normalizeUrl(u) === invalidUrl) || invalidUrl;
        // Remover patrones: "| Link: <url>", "[texto](url)", "Link: <url>", la URL sola
        sanitized = sanitized
          .replace(new RegExp(`\\|?\\s*Link:\\s*${escapeRegex(originalUrl)}[^\\s\\)\\]]*`, 'gi'), '')
          .replace(new RegExp(`\\[([^\\]]+)\\]\\(${escapeRegex(originalUrl)}[^)]*\\)`, 'gi'), '$1')
          .replace(new RegExp(`${escapeRegex(originalUrl)}\\S*`, 'gi'), '');
      }
      return sanitized.trim();
    }
  } catch (err) {
    // Si falla la validación, pasamos la respuesta original — mejor enviar que silenciar
    console.error('[Bot] Error al validar URLs de la respuesta:', err.message);
  }

  return text;
}

/**
 * Escapa caracteres especiales de regex en una cadena.
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
