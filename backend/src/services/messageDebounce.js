/**
 * Servicio de debounce de mensajes entrantes
 * Autor: Turnio
 * Fecha: 2026-03-25
 * Dependencias: ioredis (opcional — fallback en Map en memoria)
 *
 * Cuando un usuario envía varios mensajes en rápida sucesión, este servicio
 * los acumula en un buffer y espera una ventana configurable antes de disparar
 * el procesamiento. Así el bot responde UNA sola vez con el contexto completo.
 *
 * Estrategia:
 *   - Buffer persistido en Redis si REDIS_URL está definida. TTL = ventana + 30s.
 *   - Fallback a Map en memoria si Redis no está disponible.
 *   - El timer de disparo siempre vive en memoria (setTimeout in-process).
 *   - Si el servidor se reinicia dentro de la ventana, los mensajes en Redis
 *     expiran solos sin procesarse — aceptable dado el TTL corto (máx. 60s).
 */

const DEBOUNCE_KEY_PREFIX = 'msg_debounce:';

/** Timers activos: telefono → handle de setTimeout */
const activeTimers = new Map();

/** Buffer en memoria (usado cuando Redis no está disponible) */
const inMemoryBuffer = new Map();

let redisClient = null;

async function getRedis() {
  if (!process.env.REDIS_URL) return null;
  if (redisClient) return redisClient;

  try {
    const { default: Redis } = await import('ioredis');
    redisClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
      enableOfflineQueue: false,
    });
    redisClient.on('error', (err) => {
      console.warn('[Debounce] Redis error (degradando a buffer en memoria):', err.message);
      redisClient = null;
    });
    return redisClient;
  } catch (err) {
    console.warn('[Debounce] ioredis no disponible, usando buffer en memoria:', err.message);
    return null;
  }
}

async function pushToBuffer(redis, telefono, messageData, ttlSeconds) {
  if (redis) {
    const key = `${DEBOUNCE_KEY_PREFIX}${telefono}`;
    const raw = await redis.get(key);
    const messages = raw ? JSON.parse(raw) : [];
    messages.push(messageData);
    // TTL = ventana + 30s de margen para que Redis no expire antes de que dispare el timer
    await redis.setex(key, ttlSeconds + 30, JSON.stringify(messages));
  } else {
    const messages = inMemoryBuffer.get(telefono) || [];
    messages.push(messageData);
    inMemoryBuffer.set(telefono, messages);
  }
}

async function flushBuffer(redis, telefono) {
  if (redis) {
    const key = `${DEBOUNCE_KEY_PREFIX}${telefono}`;
    const raw = await redis.get(key);
    await redis.del(key);
    return raw ? JSON.parse(raw) : [];
  } else {
    const messages = inMemoryBuffer.get(telefono) || [];
    inMemoryBuffer.delete(telefono);
    return messages;
  }
}

/**
 * Encola un mensaje para ser procesado después de la ventana de debounce.
 * Si ya existe un timer pendiente para este número, lo reinicia — cada nuevo
 * mensaje "posterga" la respuesta del bot hasta que el usuario deje de escribir.
 *
 * @param {Object}   params
 * @param {string}   params.telefono    - Número de teléfono del remitente
 * @param {Object}   params.messageData - Datos del mensaje a acumular
 * @param {number}   params.windowMs    - Ventana de espera en milisegundos
 * @param {Function} params.onFlush     - Callback(Array<messageData>) llamado al vencer el timer
 */
export async function scheduleDebounce({ telefono, messageData, windowMs, onFlush }) {
  const redis = await getRedis();
  const windowSeconds = Math.ceil(windowMs / 1000);

  // Acumular el mensaje en el buffer (Redis o memoria)
  await pushToBuffer(redis, telefono, messageData, windowSeconds);

  // Cancelar el timer anterior si existe — reiniciar la ventana de espera
  if (activeTimers.has(telefono)) {
    clearTimeout(activeTimers.get(telefono));
  }

  const timer = setTimeout(async () => {
    activeTimers.delete(telefono);
    // Re-obtener el cliente en el momento del flush por si reconectó entre tanto
    const redisNow = await getRedis();
    const messages = await flushBuffer(redisNow, telefono);
    if (messages.length > 0) {
      try {
        await onFlush(messages);
      } catch (err) {
        console.error(`[Debounce] Error en onFlush para ${telefono}:`, err.message);
      }
    }
  }, windowMs);

  activeTimers.set(telefono, timer);
}
