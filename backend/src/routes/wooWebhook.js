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

      await processWooEvent(eventoNormalizado, req.body);
    } catch (err) {
      console.error('[WooWebhook] Error procesando evento:', err.message);
    }
  });
});

export default router;
