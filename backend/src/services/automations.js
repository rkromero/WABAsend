/**
 * Servicio de automatizaciones basadas en eventos de WooCommerce
 * Autor: Turnio
 * Fecha: 2026-03-20
 * Dependencias: pg, whatsapp service
 *
 * Flujo:
 *   1. WooCommerce dispara un webhook (ej: order.completed)
 *   2. processWooEvent() busca automatizaciones activas para ese evento
 *   3. Encola un mensaje en waba_automation_queue con scheduled_for = ahora + N días
 *      Si el teléfono no se puede normalizar → status = 'invalid_phone' para corrección manual
 *   4. processAutomationQueue() (llamado por el scheduler) envía los que ya vencieron
 */

import { query } from '../db/index.js';
import { sendTemplateMessage, sleep } from './whatsapp.js';

/**
 * Normaliza un número de teléfono argentino al formato internacional 549XXXXXXXXXX
 * que requiere la API de WhatsApp Business.
 *
 * Cubre los formatos más comunes en WooCommerce Argentina:
 *   - Con formato correcto:      +5491134866718, 5491134866718
 *   - Sin prefijo país:          1134866718, 01134866718
 *   - Con prefijo 15 viejo CABA: 1115XXXXXXX, 011-15-XXXXXXX
 *   - Con prefijo 15 área 3dig:  221155703442, 0221-15-5703442
 *   - Con prefijo 15 área 4dig:  354115XXXXXX
 *
 * @param {string} raw - Número crudo del campo billing.phone de WooCommerce
 * @returns {string|null} - Número normalizado o null si no se puede procesar con certeza
 */
export function normalizarTelefono(raw) {
  if (!raw || typeof raw !== 'string') return null;

  // Limpiar todo excepto dígitos
  let tel = raw.replace(/[\s\-\(\)\+\.]/g, '');

  if (!tel) return null;

  // Ya tiene formato completo correcto: 549 + 10 dígitos
  if (/^549\d{10}$/.test(tel)) return tel;

  // Tiene 54 pero sin el 9 de celular: 5411XXXXXXXX → 54911XXXXXXXX
  if (/^54\d{10}$/.test(tel)) return `549${tel.slice(2)}`;

  // Tiene 0 adelante (formato local argentino: 011..., 0221...)
  if (tel.startsWith('0')) tel = tel.slice(1);

  // ── Detección del prefijo "15" (formato celular viejo) ──
  // En Argentina: 0[área][15][número] → 549[área][número]

  // 12 dígitos: área 3 dígitos + 15 + 7 dígitos  (ej: 221-15-5703442)
  if (tel.length === 12 && tel.slice(3, 5) === '15') {
    return `549${tel.slice(0, 3)}${tel.slice(5)}`;
  }

  // 11 dígitos con área 11 (CABA/GBA): 11 + 15 + 7 dígitos
  if (tel.length === 11 && tel.startsWith('11') && tel.slice(2, 4) === '15') {
    return `549${tel.slice(0, 2)}${tel.slice(4)}`;
  }

  // 12 dígitos: área 4 dígitos + 15 + 6 dígitos  (ciudades pequeñas)
  if (tel.length === 12 && tel.slice(4, 6) === '15') {
    return `549${tel.slice(0, 4)}${tel.slice(6)}`;
  }

  // 10 dígitos limpios (área + número sin prefijo 15): agregar 549
  if (/^\d{10}$/.test(tel)) return `549${tel}`;

  // No se pudo normalizar con certeza
  return null;
}

/**
 * Procesa un evento de WooCommerce y encola mensajes para automatizaciones activas.
 * Si el teléfono no se puede normalizar, lo guarda con status='invalid_phone'
 * para que el usuario pueda corregirlo manualmente desde la UI.
 *
 * @param {string} evento - Tipo de evento: 'order.completed', 'order.created', 'customer.created'
 * @param {Object} data   - Payload del webhook de WooCommerce
 */
export async function processWooEvent(evento, data) {
  const automationResult = await query(
    `SELECT * FROM waba_automations WHERE evento = $1 AND activa = true`,
    [evento]
  );

  if (automationResult.rows.length === 0) {
    console.log(`[Automations] Sin automatizaciones activas para evento: ${evento}`);
    return;
  }

  const billing    = data.billing || {};
  const rawPhone   = billing.phone || data.phone || '';
  const telefono   = normalizarTelefono(rawPhone);
  const nombre     = [billing.first_name, billing.last_name].filter(Boolean).join(' ').trim() || 'Cliente';
  const email      = billing.email || data.email || null;
  const wooOrderId = data.id ? String(data.id) : null;

  const telefonoFinal = telefono || rawPhone || 'sin_telefono';
  const statusInicial = telefono ? 'pending' : 'invalid_phone';

  if (!telefono) {
    console.warn(
      `[Automations] Teléfono no normalizable (raw: "${rawPhone}") — guardando como invalid_phone. ` +
      `Cliente: ${nombre}, Order: ${wooOrderId}`
    );
  } else {
    console.log(
      `[Automations] Evento "${evento}" — ${nombre} (${telefono}), ` +
      `${automationResult.rows.length} automatización(es)`
    );
  }

  for (const automation of automationResult.rows) {
    const scheduledFor = new Date(Date.now() + automation.delay_dias * 24 * 60 * 60 * 1000);

    try {
      await query(
        `INSERT INTO waba_automation_queue
           (automation_id, telefono, nombre_cliente, email, woo_order_id, scheduled_for, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (automation_id, woo_order_id) DO NOTHING`,
        [automation.id, telefonoFinal, nombre, email, wooOrderId, scheduledFor, statusInicial]
      );

      console.log(
        `[Automations] ✓ Encolado (${statusInicial}): automation #${automation.id} ` +
        `"${automation.nombre}" para ${telefonoFinal}`
      );
    } catch (err) {
      console.error(`[Automations] Error al encolar automation #${automation.id}:`, err.message);
    }
  }
}

/**
 * Procesa la cola de automatizaciones pendientes.
 * Solo procesa entradas con status='pending' cuyo scheduled_for ya pasó.
 * Las entradas 'invalid_phone' se ignoran hasta que el usuario las corrija.
 */
export async function processAutomationQueue() {
  const pendingResult = await query(
    `SELECT q.*, a.template_name, a.template_language, a.nombre AS automation_nombre
     FROM waba_automation_queue q
     JOIN waba_automations a ON a.id = q.automation_id
     WHERE q.status = 'pending' AND q.scheduled_for <= NOW()
     ORDER BY q.scheduled_for ASC
     LIMIT 50`
  );

  if (pendingResult.rows.length === 0) return;

  console.log(`[Automations] Procesando ${pendingResult.rows.length} mensajes en cola`);

  for (const item of pendingResult.rows) {
    try {
      const { messageId } = await sendTemplateMessage(
        item.telefono,
        item.template_name,
        item.template_language,
        item.nombre_cliente || 'Cliente'
      );

      await query(
        `UPDATE waba_automation_queue
         SET status = 'sent', whatsapp_message_id = $1, sent_at = NOW()
         WHERE id = $2`,
        [messageId, item.id]
      );

      console.log(`[Automations] ✓ Enviado "${item.automation_nombre}" → ${item.telefono}`);
    } catch (err) {
      const errorMsg = err.response?.data?.error?.message || err.message;

      await query(
        `UPDATE waba_automation_queue
         SET status = 'failed', error_message = $1
         WHERE id = $2`,
        [errorMsg.substring(0, 500), item.id]
      );

      console.error(`[Automations] ✗ Falló envío a ${item.telefono}: ${errorMsg}`);
    }

    await sleep(1000);
  }
}
