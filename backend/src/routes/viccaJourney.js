/**
 * Endpoint para el Journey de Mailchimp (Operación 2ª compra de VICCA).
 *
 * Mailchimp, en los pasos "Webhook" del journey, hace un POST acá con el
 * teléfono, la plantilla y las variables. Este endpoint dispara el envío
 * del template por WhatsApp reusando el servicio sendTemplateMessage().
 *
 * Seguridad: requiere el header  X-Vicca-Secret  igual a la env VICCA_WEBHOOK_SECRET.
 *
 * Body esperado (JSON):
 * {
 *   "phone":    "+5491112345678",        // teléfono de la clienta (WAPHONE)
 *   "template": "vicca_dia12",           // nombre EXACTO de la plantilla aprobada
 *   "language": "es_AR",                 // opcional, default es_AR
 *   "params":   ["Ana", "V2-ENVIO-XXXX", "31/07/2026"]  // {{1}},{{2}},{{3}} en orden
 * }
 */

import express from 'express';
import { sendTemplateMessage } from '../services/whatsapp.js';

const router = express.Router();

router.post('/wa-send', async (req, res) => {
  // 1. Autenticación por secreto compartido
  const secret = req.headers['x-vicca-secret'];
  if (!process.env.VICCA_WEBHOOK_SECRET || secret !== process.env.VICCA_WEBHOOK_SECRET) {
    return res.status(401).json({ success: false, error: 'No autorizado' });
  }

  // 2. Validar payload
  const { phone, template, language = 'es_AR', params = [] } = req.body || {};
  if (!phone || !template) {
    return res.status(400).json({ success: false, error: 'Faltan phone o template' });
  }

  // Meta espera el número solo con dígitos (ej: 5491112345678). Sacamos +, espacios, etc.
  const telefono = String(phone).replace(/\D+/g, '');
  if (telefono.length < 8) {
    return res.status(400).json({ success: false, error: 'Teléfono inválido' });
  }

  // Meta necesita TODAS las variables de la plantilla, en orden.
  const parameterValues = Array.isArray(params) ? params.map((p) => String(p ?? '')) : [];

  // 3. Enviar la plantilla por WhatsApp
  try {
    const { messageId } = await sendTemplateMessage(telefono, template, language, parameterValues);
    return res.json({ success: true, data: { messageId } });
  } catch (err) {
    const metaErr = err.response?.data?.error?.message || err.message;
    console.error('[VICCA wa-send] Error al enviar:', metaErr);
    // 502: el fallo es del lado de Meta/WhatsApp, no del request de Mailchimp
    return res.status(502).json({ success: false, error: metaErr });
  }
});

export default router;
