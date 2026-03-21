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
 *   4. processAutomationQueue() (llamado por el scheduler) envía los que ya vencieron
 */

import { query } from '../db/index.js';
import { sendTemplateMessage, sleep } from './whatsapp.js';

/**
 * Normaliza un número de teléfono argentino al formato internacional 549XXXXXXXXXX
 * que requiere la API de WhatsApp Business.
 *
 * Ejemplos de entrada: "1123456789", "01123456789", "+5491123456789", "5491123456789"
 *
 * @param {string} raw - Número crudo del campo billing.phone de WooCommerce
 * @returns {string|null} - Número normalizado o null si no se puede procesar
 */
export function normalizarTelefono(raw) {
  if (!raw || typeof raw !== 'string') return null;

  // Limpiar espacios, guiones, paréntesis y el signo +
  let tel = raw.replace(/[\s\-\(\)\+]/g, '');

  // Ya tiene formato completo con prefijo 9 de celular argentino: 549XXXXXXXXXX
  if (/^549\d{10}$/.test(tel)) return tel;

  // Tiene 54 pero sin 9: 54XXXXXXXXXX → agregar 9
  if (/^54\d{10}$/.test(tel)) return `549${tel.slice(2)}`;

  // Tiene 0 adelante (formato local: 011...): quitar el 0
  if (tel.startsWith('0')) tel = tel.slice(1);

  // 10 dígitos (ej: 1123456789) — número de celular argentino sin prefijo país
  if (/^\d{10}$/.test(tel)) return `549${tel}`;

  // 8 o 9 dígitos (interior del país sin el 15)
  if (/^\d{8,9}$/.test(tel)) return `549${tel}`;

  return null;
}

/**
 * Procesa un evento de WooCommerce y encola mensajes para automatizaciones activas.
 * Usa UNIQUE constraint en (automation_id, woo_order_id) para evitar duplicados.
 *
 * @param {string} evento - Tipo de evento: 'order.completed', 'order.created', 'customer.created'
 * @param {Object} data   - Payload del webhook de WooCommerce
 */
export async function processWooEvent(evento, data) {
  // Buscar automatizaciones activas para este evento
  const automationResult = await query(
    `SELECT * FROM waba_automations WHERE evento = $1 AND activa = true`,
    [evento]
  );

  if (automationResult.rows.length === 0) {
    console.log(`[Automations] Sin automatizaciones activas para evento: ${evento}`);
    return;
  }

  // Extraer datos del cliente del payload de WooCommerce
  const billing    = data.billing || {};
  const rawPhone   = billing.phone || data.phone || '';
  const telefono   = normalizarTelefono(rawPhone);
  const nombre     = [billing.first_name, billing.last_name].filter(Boolean).join(' ').trim() || 'Cliente';
  const email      = billing.email || data.email || null;
  const wooOrderId = data.id ? String(data.id) : null;

  if (!telefono) {
    console.warn(
      `[Automations] Evento ${evento} sin teléfono válido (raw: "${rawPhone}"). Order ID: ${wooOrderId}`
    );
    return;
  }

  console.log(
    `[Automations] Procesando evento "${evento}" — cliente: ${nombre} (${telefono}), ` +
    `${automationResult.rows.length} automatización(es) activa(s)`
  );

  for (const automation of automationResult.rows) {
    // scheduled_for = ahora + N días
    const scheduledFor = new Date(Date.now() + automation.delay_dias * 24 * 60 * 60 * 1000);

    try {
      await query(
        `INSERT INTO waba_automation_queue
           (automation_id, telefono, nombre_cliente, email, woo_order_id, scheduled_for, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending')
         ON CONFLICT (automation_id, woo_order_id) DO NOTHING`,
        [automation.id, telefono, nombre, email, wooOrderId, scheduledFor]
      );

      console.log(
        `[Automations] ✓ Encolado: automation #${automation.id} "${automation.nombre}" ` +
        `para ${telefono} — programado: ${scheduledFor.toISOString()}`
      );
    } catch (err) {
      console.error(`[Automations] Error al encolar automation #${automation.id}:`, err.message);
    }
  }
}

/**
 * Procesa la cola de automatizaciones pendientes.
 * Envía los mensajes cuyo scheduled_for ya pasó.
 * Llamar periódicamente desde el scheduler (cada minuto).
 *
 * Toma hasta 50 mensajes por ciclo para no sobrecargar la API de Meta.
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

      console.log(
        `[Automations] ✓ Enviado "${item.automation_nombre}" → ${item.telefono} (msgId: ${messageId})`
      );
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

    // Rate limiting: 1 segundo entre mensajes para respetar límites de Meta
    await sleep(1000);
  }
}
