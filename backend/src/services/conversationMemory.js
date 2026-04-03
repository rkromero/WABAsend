/**
 * Servicio de memoria de conversación para el bot
 * Autor: Turnio
 * Fecha: 2026-03-23
 *
 * Almacena el historial de mensajes (usuario + asistente) por número de teléfono.
 * Ventana: últimos 20 mensajes dentro de las últimas 24 horas.
 *
 * Drivers:
 *   - Redis (primary):     si REDIS_URL está definida. TTL = 86400s por clave.
 *                          La ventana de 24h se gestiona automáticamente por Redis.
 *   - PostgreSQL (fallback): tabla waba_bot_history. Sin limpieza activa — se filtra
 *                            por timestamp al leer. Las filas viejas son inocuas.
 */

import { query } from '../db/index.js';

const MAX_MESSAGES = 20;
const TTL_SECONDS  = 86400; // 24 horas
const REDIS_KEY_PREFIX = 'conv_history:';

// ── Inicialización de Redis (lazy, solo si REDIS_URL está definida) ───────────

let redisClient = null;

async function getRedis() {
  if (!process.env.REDIS_URL) return null;
  if (redisClient) return redisClient;

  try {
    // Importación dinámica para no fallar si ioredis no está instalado
    const { default: Redis } = await import('ioredis');
    redisClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
      enableOfflineQueue: false,
    });

    redisClient.on('error', (err) => {
      // Log pero no lanzar — degradamos a PostgreSQL automáticamente
      console.warn('[Memory] Redis error (usando fallback PostgreSQL):', err.message);
      redisClient = null; // forzar reconexión en el próximo intento
    });

    console.log('[Memory] Conectado a Redis para historial de conversaciones');
    return redisClient;
  } catch (err) {
    console.warn('[Memory] No se pudo conectar a Redis:', err.message);
    return null;
  }
}

// ── Driver Redis ──────────────────────────────────────────────────────────────

async function redisGetHistory(redis, telefono) {
  const raw = await redis.get(`${REDIS_KEY_PREFIX}${telefono}`);
  if (!raw) return [];
  return JSON.parse(raw);
}

async function redisSaveMessages(redis, telefono, userMessage, assistantMessage) {
  const key = `${REDIS_KEY_PREFIX}${telefono}`;
  const existing = await redisGetHistory(redis, telefono);

  const updated = [
    ...existing,
    { role: 'user',      content: userMessage      },
    { role: 'assistant', content: assistantMessage },
  ].slice(-MAX_MESSAGES); // mantener solo los últimos MAX_MESSAGES

  // SETEX resetea el TTL en cada mensaje → ventana deslizante de 24h
  await redis.setex(key, TTL_SECONDS, JSON.stringify(updated));
}

// ── Driver PostgreSQL ─────────────────────────────────────────────────────────

async function pgGetHistory(telefono) {
  // Trae los últimos MAX_MESSAGES mensajes de las últimas 24h, en orden cronológico
  const result = await query(
    `SELECT role, content FROM (
       SELECT role, content, created_at
       FROM waba_bot_history
       WHERE telefono = $1
         AND created_at > NOW() - INTERVAL '24 hours'
       ORDER BY created_at DESC
       LIMIT $2
     ) sub
     ORDER BY created_at ASC`,
    [telefono, MAX_MESSAGES]
  );
  return result.rows;
}

async function pgSaveMessages(telefono, userMessage, assistantMessage) {
  // Insertar los dos mensajes en una sola query para atomicidad
  await query(
    `INSERT INTO waba_bot_history (telefono, role, content)
     VALUES ($1, 'user', $2), ($1, 'assistant', $3)`,
    [telefono, userMessage, assistantMessage]
  );
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Recupera el historial de conversación para un número de teléfono.
 * Devuelve los últimos MAX_MESSAGES mensajes dentro de la ventana de 24h,
 * en orden cronológico (más viejo primero), listos para pasarle a OpenAI.
 *
 * @param {string} telefono
 * @returns {Promise<Array<{role: 'user'|'assistant', content: string}>>}
 */
export async function getConversationHistory(telefono) {
  try {
    const redis = await getRedis();
    if (redis) {
      return await redisGetHistory(redis, telefono);
    }
    return await pgGetHistory(telefono);
  } catch (err) {
    console.error('[Memory] Error al leer historial:', err.message);
    return []; // degradar gracefully — el bot responde sin contexto
  }
}

/**
 * Elimina todo el historial de conversación de un número de teléfono.
 * Se llama al borrar una conversación para que la siguiente sesión empiece limpia.
 *
 * @param {string} telefono
 */
export async function clearConversationHistory(telefono) {
  try {
    const redis = await getRedis();
    if (redis) {
      await redis.del(`${REDIS_KEY_PREFIX}${telefono}`);
    }
    // Siempre limpiar PostgreSQL también (puede haber datos previos a Redis)
    await query('DELETE FROM waba_bot_history WHERE telefono = $1', [telefono]);
    console.log(`[Memory] Historial eliminado para ${telefono}`);
  } catch (err) {
    console.error('[Memory] Error al limpiar historial:', err.message);
  }
}

/**
 * Persiste el par user/assistant en el historial de la conversación.
 * Debe llamarse después de que el LLM generó su respuesta.
 *
 * @param {string} telefono
 * @param {string} userMessage       - Mensaje que envió el usuario
 * @param {string} assistantMessage  - Respuesta que generó el bot
 */
export async function saveConversationTurn(telefono, userMessage, assistantMessage) {
  try {
    const redis = await getRedis();
    if (redis) {
      await redisSaveMessages(redis, telefono, userMessage, assistantMessage);
    } else {
      await pgSaveMessages(telefono, userMessage, assistantMessage);
    }
  } catch (err) {
    console.error('[Memory] Error al guardar historial:', err.message);
    // No lanzar — el mensaje ya fue enviado; perder el historial es aceptable
  }
}
