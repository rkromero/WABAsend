/**
 * Servicio de seguimiento de conversaciones (follow-up)
 * Autor: Turnio
 * Fecha: 2026-03-24
 *
 * Envía un mensaje de seguimiento a los usuarios cuya ventana de 24h de WhatsApp
 * está a punto de cerrarse (22h después del último mensaje entrante).
 *
 * Reglas:
 *  - Solo se envía si FOLLOWUP_ENABLED = 'true' en la tabla config
 *  - Solo se envía 1 vez cada FOLLOWUP_COOLDOWN_DIAS días por número
 *  - No se envía si el bot está pausado (agente tomó el control)
 *  - Usa mensaje de texto libre (dentro de ventana de 24h → no requiere template)
 */

import { query } from '../db/index.js';
import { sendFreeTextMessage } from './whatsapp.js';

const DEFAULT_MENSAJE =
  'Hola! 😊 Quería saber si pudiste ver los productos que te recomendé. ¿Necesitás ayuda para completar tu compra o tenés alguna consulta?';
const DEFAULT_COOLDOWN_DIAS = 3;

// Cuántas horas antes del cierre de la ventana enviamos el follow-up.
// 2 horas de margen = enviamos cuando el último mensaje tiene 22h de antigüedad.
const HORAS_ANTES_CIERRE = 2;
// Tolerancia ±30 minutos para el cron (que corre cada hora)
const TOLERANCIA_MIN = 30;

/**
 * Lee la configuración del follow-up desde la tabla config.
 */
export async function getFollowupConfig() {
  const result = await query(
    `SELECT key, value FROM config
     WHERE key IN ('FOLLOWUP_ENABLED', 'FOLLOWUP_MENSAJE', 'FOLLOWUP_COOLDOWN_DIAS')`
  );
  const raw = {};
  for (const row of result.rows) raw[row.key] = row.value;

  return {
    enabled:      raw.FOLLOWUP_ENABLED === 'true',
    mensaje:      raw.FOLLOWUP_MENSAJE || DEFAULT_MENSAJE,
    cooldownDias: parseInt(raw.FOLLOWUP_COOLDOWN_DIAS) || DEFAULT_COOLDOWN_DIAS,
  };
}

/**
 * Guarda (upsert) una o más claves de configuración del follow-up.
 *
 * @param {{ enabled?: boolean, mensaje?: string, cooldownDias?: number }} updates
 */
export async function saveFollowupConfig(updates) {
  const rows = [];
  if (updates.enabled !== undefined)
    rows.push(['FOLLOWUP_ENABLED', String(updates.enabled)]);
  if (updates.mensaje !== undefined)
    rows.push(['FOLLOWUP_MENSAJE', updates.mensaje]);
  if (updates.cooldownDias !== undefined)
    rows.push(['FOLLOWUP_COOLDOWN_DIAS', String(parseInt(updates.cooldownDias) || DEFAULT_COOLDOWN_DIAS)]);

  for (const [key, value] of rows) {
    await query(
      `INSERT INTO config (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, value]
    );
  }
}

/**
 * Procesa los seguimientos pendientes.
 * Se llama desde el scheduler cada hora.
 *
 * Lógica:
 *  1. Verificar que follow-up está habilitado
 *  2. Buscar números cuyo último mensaje entrante tiene entre 21.5h y 22.5h de antigüedad
 *  3. Excluir los que ya recibieron follow-up dentro del cooldown
 *  4. Excluir los que tienen el bot pausado por agente
 *  5. Enviar mensaje de texto libre y registrar en waba_conversation_followups
 */
export async function processFollowups() {
  let config;
  try {
    config = await getFollowupConfig();
  } catch (err) {
    console.error('[Followup] Error al leer config:', err.message);
    return;
  }

  if (!config.enabled) return;

  const windowHours = 24 - HORAS_ANTES_CIERRE; // 22
  const minHoras = windowHours - TOLERANCIA_MIN / 60; // 21.5
  const maxHoras = windowHours + TOLERANCIA_MIN / 60; // 22.5

  let candidatos;
  try {
    candidatos = await query(
      `SELECT m.telefono, MAX(m.created_at) AS last_message_at
       FROM incoming_messages m
       WHERE
         -- No tiene followup reciente (dentro del cooldown)
         NOT EXISTS (
           SELECT 1 FROM waba_conversation_followups f
           WHERE f.telefono = m.telefono
             AND f.sent_at > NOW() - ($1 || ' days')::INTERVAL
         )
         -- Bot no pausado por agente
         AND NOT EXISTS (
           SELECT 1 FROM waba_conversation_overrides o
           WHERE o.telefono = m.telefono AND o.bot_paused = true
         )
       GROUP BY m.telefono
       HAVING MAX(m.created_at) BETWEEN NOW() - ($2 || ' hours')::INTERVAL
                                    AND NOW() - ($3 || ' hours')::INTERVAL`,
      [config.cooldownDias, maxHoras, minHoras]
    );
  } catch (err) {
    console.error('[Followup] Error al buscar candidatos:', err.message);
    return;
  }

  if (candidatos.rows.length === 0) {
    console.debug('[Followup] No hay conversaciones para seguimiento en este ciclo');
    return;
  }

  console.log(`[Followup] ${candidatos.rows.length} conversación(es) para seguimiento`);

  for (const { telefono } of candidatos.rows) {
    try {
      await sendFreeTextMessage(telefono, config.mensaje);

      await query(
        `INSERT INTO waba_conversation_followups (telefono, status) VALUES ($1, 'sent')`,
        [telefono]
      );

      console.log(`[Followup] ✓ Follow-up enviado a ${telefono}`);
    } catch (err) {
      const errorMsg = err.response?.data?.error?.message || err.message;
      console.error(`[Followup] ✗ Error enviando a ${telefono}: ${errorMsg}`);

      // Registrar el fallo también para evitar reintentos en el mismo ciclo
      try {
        await query(
          `INSERT INTO waba_conversation_followups (telefono, status, error_message)
           VALUES ($1, 'failed', $2)`,
          [telefono, errorMsg.substring(0, 500)]
        );
      } catch {
        // Ignorar error al registrar el fallo
      }
    }
  }
}
