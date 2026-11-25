/**
 * Notificaciones push (Web Push) — llegan al celular aunque la app esté cerrada.
 *
 * - Claves VAPID: env VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, o se generan una vez
 *   y se guardan en `config` (_VAPID_PUBLIC / _VAPID_PRIVATE).
 * - Cada dispositivo suscripto se guarda en waba_push_subscriptions.
 * - notifyIncomingMessage() se llama desde el webhook al entrar un mensaje del cliente.
 */

import webpush from 'web-push';
import { query } from '../db/index.js';

let publicKey = null;
let ready = false;

async function getOrCreateKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  const res = await query(`SELECT key, value FROM config WHERE key IN ('_VAPID_PUBLIC', '_VAPID_PRIVATE')`);
  const map = Object.fromEntries(res.rows.map((r) => [r.key, r.value]));
  if (map._VAPID_PUBLIC && map._VAPID_PRIVATE) {
    return { publicKey: map._VAPID_PUBLIC, privateKey: map._VAPID_PRIVATE };
  }
  const keys = webpush.generateVAPIDKeys();
  await query(
    `INSERT INTO config (key, value) VALUES ('_VAPID_PUBLIC', $1), ('_VAPID_PRIVATE', $2)
     ON CONFLICT (key) DO NOTHING`,
    [keys.publicKey, keys.privateKey]
  );
  // Releer por si otra instancia las creó al mismo tiempo
  return getOrCreateKeys();
}

export async function initPush() {
  await query(`
    CREATE TABLE IF NOT EXISTS waba_push_subscriptions (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES waba_users(id) ON DELETE CASCADE,
      endpoint    TEXT NOT NULL UNIQUE,
      p256dh      TEXT NOT NULL,
      auth        TEXT NOT NULL,
      user_agent  TEXT,
      created_at  TIMESTAMP DEFAULT NOW(),
      last_ok_at  TIMESTAMP
    )
  `);

  const keys = await getOrCreateKeys();
  // web-push exige un contacto (mailto: o https:). Se usa la URL pública del panel.
  const subject = process.env.VAPID_SUBJECT ||
    (process.env.FRONTEND_URL?.startsWith('https://') ? process.env.FRONTEND_URL : 'https://localhost');
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
  publicKey = keys.publicKey;
  ready = true;
  console.log('[Push] Notificaciones push listas');
}

export function getPublicKey() {
  return publicKey;
}

export async function saveSubscription(userId, sub, userAgent) {
  const endpoint = String(sub?.endpoint || '');
  const p256dh = String(sub?.keys?.p256dh || '');
  const auth = String(sub?.keys?.auth || '');
  if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) throw new Error('Suscripción inválida');
  await query(
    `INSERT INTO waba_push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4, user_agent = $5`,
    [userId, endpoint, p256dh, auth, String(userAgent || '').slice(0, 300)]
  );
}

export async function deleteSubscription(userId, endpoint) {
  await query('DELETE FROM waba_push_subscriptions WHERE user_id = $1 AND endpoint = $2', [userId, String(endpoint || '')]);
}

/** Envía una notificación a todos los dispositivos de usuarios activos */
async function sendToAll(payload) {
  if (!ready) return;
  const res = await query(
    `SELECT s.id, s.endpoint, s.p256dh, s.auth
     FROM waba_push_subscriptions s
     JOIN waba_users u ON u.id = s.user_id
     WHERE u.activo = true`
  );
  const body = JSON.stringify(payload);
  await Promise.all(res.rows.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
        { TTL: 60 * 60 * 24, urgency: 'high', topic: payload.tag?.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) }
      );
      query('UPDATE waba_push_subscriptions SET last_ok_at = NOW() WHERE id = $1', [s.id]).catch(() => {});
    } catch (err) {
      // 404/410: el dispositivo se desuscribió o desinstaló la app → borrar
      if (err.statusCode === 404 || err.statusCode === 410) {
        await query('DELETE FROM waba_push_subscriptions WHERE id = $1', [s.id]).catch(() => {});
      } else {
        console.warn(`[Push] Error enviando a suscripción ${s.id}:`, err.statusCode || '', err.body || err.message);
      }
    }
  }));
}

/**
 * Notificación de mensaje entrante (fire-and-forget desde el webhook).
 * @param {{ nombre: string, telefono: string, texto: string, conversationId: number|null }} m
 */
export function notifyIncomingMessage({ nombre, telefono, texto, conversationId }) {
  const payload = {
    title: nombre || telefono,
    body: String(texto || 'Mensaje nuevo').slice(0, 180),
    tag: conversationId ? `conv-${conversationId}` : `tel-${telefono}`,
    url: conversationId ? `/chat/${conversationId}` : '/',
  };
  sendToAll(payload).catch((err) => console.warn('[Push] notifyIncomingMessage error:', err.message));
}
