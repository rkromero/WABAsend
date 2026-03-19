/**
 * Webhook de Chatwoot — recibe eventos del agente para reenviar por WhatsApp
 * Autor: Turnio
 * Fecha: 2026-03-19
 *
 * Cuando un agente responde en la UI de Chatwoot, este endpoint recibe
 * el evento `message_created` con type `outgoing` y reenvía el mensaje
 * al número de WhatsApp del contacto.
 *
 * Configuración en Chatwoot: Settings → Integrations → Webhooks → Add new
 * URL: https://tu-backend.railway.app/api/chatwoot/webhook
 * Eventos: message_created
 */

import { Router } from 'express';
import { getConversation } from '../services/chatwoot.js';
import { getConfig } from '../services/whatsapp.js';
import axios from 'axios';

const router = Router();

const META_API_VERSION = 'v21.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

// POST /api/chatwoot/webhook — evento de Chatwoot
// Nota: el envío a WhatsApp se maneja exclusivamente desde inbox.js para evitar
// duplicados. Este endpoint solo recibe el evento y responde 200 a Chatwoot.
router.post('/webhook', (req, res) => {
  res.status(200).send('OK');
  // Los mensajes salientes ya fueron enviados por WhatsApp desde inbox.js
  // antes de ser registrados en Chatwoot. No hay nada que hacer acá.
});

export default router;
