/**
 * Webhook receiver para eventos de WooCommerce
 * Autor: Turnio
 * Fecha: 2026-03-20
 *
 * Cómo configurar en WooCommerce:
 *   WooCommerce > Ajustes > Avanzado > Webhooks > Añadir webhook
 *   - Nombre: cualquiera (ej: "WABA - Pedido completado")
 *   - Estado: Activo
 *   - Tema: Pedido completado (o el evento que corresponda)
 *   - URL de entrega: https://TU-BACKEND.railway.app/api/woo-webhook
 *   - Versión API: v3
 *   - Secreto: (guardar el mismo valor en config como WOO_WEBHOOK_SECRET)
 *
 * Eventos soportados:
 *   - order.completed   → pedido completado/pagado
 *   - order.created     → cualquier pedido nuevo
 *   - customer.created  → nuevo cliente registrado
 */

import { Router } from 'express';
import crypto from 'crypto';
import { query } from '../db/index.js';
import { processWooEvent } from '../services/automations.js';

/**
 * Ventana de atribución de follow-up → conversión: 3 días.
 * Si el usuario recibió un follow-up y compra dentro de este plazo,
 * la orden se atribuye al follow-up.
 */
const FOLLOWUP_ATTRIBUTION_DAYS = 3;

/**
 * Normaliza un número de teléfono a sus últimos 10 dígitos.
 * Permite comparar formatos distintos (ej: "011-4866-7180" vs "5491134866718").
 *
 * @param {string} phone - Teléfono en cualquier formato
 * @returns {string|null} Últimos 10 dígitos, o null si tiene menos de 8 dígitos
 */
function normalizePhoneSuffix(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 8 ? digits.slice(-10) : null;
}

/**
 * Verifica si el teléfono de la orden pertenece a alguien que recibió
 * un follow-up en los últimos FOLLOWUP_ATTRIBUTION_DAYS días.
 * Si hay match, registra la conversión en waba_followup_conversions.
 *
 * @param {Object} order - Body de la orden de WooCommerce
 */
async function trackFollowupConversion(order) {
  const billingPhone = order?.billing?.phone;
  const suffix = normalizePhoneSuffix(billingPhone);
  if (!suffix) return;

  const orderId     = order.id;
  const orderAmount = parseFloat(order.total) || 0;

  try {
    // Buscar follow-up enviado recientemente cuyo teléfono termina en los mismos 10 dígitos
    const followupResult = await query(
      `SELECT id, telefono
       FROM waba_conversation_followups
       WHERE status = 'sent'
         AND sent_at > NOW() - ($1 || ' days')::INTERVAL
         AND RIGHT(telefono, 10) = $2
       ORDER BY sent_at DESC
       LIMIT 1`,
      [FOLLOWUP_ATTRIBUTION_DAYS, suffix]
    );

    if (followupResult.rows.length === 0) return; // No hay follow-up atribuible

    const followup = followupResult.rows[0];

    // Insertar conversión (ON CONFLICT NO-OP si el mismo pedido ya fue registrado)
    await query(
      `INSERT INTO waba_followup_conversions (followup_id, telefono, woo_order_id, order_amount)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (woo_order_id) DO NOTHING`,
      [followup.id, followup.telefono, orderId, orderAmount]
    );

    console.log(
      `[WooWebhook] Conversión follow-up atribuida: orden #${orderId} ($${orderAmount}) → ${followup.telefono}`
    );
  } catch (err) {
    // No interrumpir el flujo si falla el tracking
    console.error('[WooWebhook] Error al registrar conversión follow-up:', err.message);
  }
}

const router = Router();

/**
 * Verifica la firma HMAC-SHA256 del webhook de WooCommerce.
 * WooCommerce envía el header X-WC-Webhook-Signature con el body firmado.
 * Si no hay secreto configurado en la DB, se acepta sin verificar.
 *
 * @param {import('express').Request} req
 * @returns {Promise<boolean>}
 */
async function verificarFirma(req) {
  const signature = req.headers['x-wc-webhook-signature'];
  if (!signature) return true; // Sin firma = aceptar (webhook sin secreto)

  try {
    const secretResult = await query(
      "SELECT value FROM config WHERE key = 'WOO_WEBHOOK_SECRET'"
    );
    if (secretResult.rows.length === 0) return true; // Sin secreto configurado = aceptar

    const secret  = secretResult.rows[0].value;
    const rawBody = JSON.stringify(req.body);
    const hmac    = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');

    return hmac === signature;
  } catch {
    // Si falla la verificación, aceptar y loguear para no bloquear el flujo
    console.warn('[WooWebhook] Error al verificar firma — aceptando igualmente');
    return true;
  }
}

// POST /api/woo-webhook — recibe todos los eventos de WooCommerce
router.post('/', async (req, res) => {
  const topic  = req.headers['x-wc-webhook-topic'];
  const source = req.headers['x-wc-webhook-source'] || 'desconocido';

  console.log(`[WooWebhook] Evento recibido: "${topic}" desde ${source}`);

  // ⚠️ Responder 200 inmediatamente para que WooCommerce no marque el webhook como fallido.
  // WooCommerce reintenta si no recibe respuesta en pocos segundos.
  res.json({ success: true });

  // Procesar en background sin bloquear la respuesta HTTP
  setImmediate(async () => {
    try {
      const valida = await verificarFirma(req);
      if (!valida) {
        console.warn('[WooWebhook] Firma inválida — evento ignorado');
        return;
      }

      // WooCommerce no tiene "order.completed" como tema separado.
      // Usa "order.updated" para todos los cambios de estado.
      // Cuando el status del pedido es "completed", lo mapeamos a order.completed.
      let eventoNormalizado = topic;
      if (topic === 'order.updated' && req.body?.status === 'completed') {
        eventoNormalizado = 'order.completed';
        console.log(`[WooWebhook] order.updated con status=completed → mapeado a order.completed`);
      }

      const EVENTOS_SOPORTADOS = ['order.completed', 'order.created', 'customer.created'];
      if (!EVENTOS_SOPORTADOS.includes(eventoNormalizado)) {
        console.log(`[WooWebhook] Evento "${topic}" (status: ${req.body?.status}) sin automatizaciones`);
        return;
      }

      // Atribuir conversiones a follow-ups cuando llega cualquier pedido nuevo
      if (eventoNormalizado === 'order.created' || eventoNormalizado === 'order.completed') {
        await trackFollowupConversion(req.body);
      }

      await processWooEvent(eventoNormalizado, req.body);
    } catch (err) {
      console.error('[WooWebhook] Error procesando evento:', err.message);
    }
  });
});

export default router;
