/**
 * Servicio de integración con la WhatsApp Business API de Meta
 * Autor: Turnio
 * Fecha: 2026-03-18
 * Dependencias: axios, pg
 *
 * Este módulo encapsula toda comunicación con graph.facebook.com.
 * Los tokens y IDs se leen desde la tabla `config` en PostgreSQL,
 * no desde variables de entorno, para permitir actualización sin redeploy.
 */

import axios from 'axios';
import { query } from '../db/index.js';

const META_API_VERSION = 'v21.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

/**
 * Lee la configuración completa desde la tabla config.
 * Lanza error si faltan claves críticas.
 *
 * @returns {{ token: string, phoneNumberId: string, wabaId: string }}
 */
export async function getConfig() {
  const result = await query(
    "SELECT key, value FROM config WHERE key IN ('WHATSAPP_TOKEN', 'PHONE_NUMBER_ID', 'WABA_ID', 'WEBHOOK_VERIFY_TOKEN')"
  );

  const config = {};
  for (const row of result.rows) {
    config[row.key] = row.value;
  }

  if (!config.WHATSAPP_TOKEN || !config.PHONE_NUMBER_ID || !config.WABA_ID) {
    throw new Error('Configuración incompleta. Revisá la pantalla de Settings.');
  }

  return {
    token: config.WHATSAPP_TOKEN,
    phoneNumberId: config.PHONE_NUMBER_ID,
    wabaId: config.WABA_ID,
    webhookVerifyToken: config.WEBHOOK_VERIFY_TOKEN,
  };
}

/**
 * Obtiene las plantillas de la WABA desde la API de Meta.
 *
 * @returns {Array} Lista de plantillas con nombre, idioma, categoría y estado
 */
export async function fetchTemplates() {
  const { token, wabaId } = await getConfig();

  const response = await axios.get(
    `${META_BASE_URL}/${wabaId}/message_templates`,
    {
      params: { fields: 'name,language,category,status,components', limit: 100 },
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  return response.data.data || [];
}

/**
 * Crea una nueva plantilla en Meta.
 * La plantilla queda en estado PENDING hasta que Meta la apruebe.
 *
 * @param {Object} templateData - Datos de la plantilla
 */
export async function createTemplate(templateData) {
  const { token, wabaId } = await getConfig();

  const response = await axios.post(
    `${META_BASE_URL}/${wabaId}/message_templates`,
    templateData,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data;
}

/**
 * Envía un mensaje de plantilla a un número de teléfono.
 * Reemplaza {{1}} con el nombre del cliente.
 *
 * @param {string} telefono         - Número en formato internacional (ej: 5491112345678)
 * @param {string} templateName     - Nombre exacto de la plantilla aprobada
 * @param {string} templateLanguage - Código de idioma (ej: es_AR, en_US)
 * @param {string} nombreCliente    - Valor para reemplazar {{1}} en la plantilla
 *
 * @returns {{ messageId: string }} ID del mensaje asignado por Meta
 */
export async function sendTemplateMessage(telefono, templateName, templateLanguage, nombreCliente) {
  const { token, phoneNumberId } = await getConfig();

  const body = {
    messaging_product: 'whatsapp',
    to: telefono,
    type: 'template',
    template: {
      name: templateName,
      language: { code: templateLanguage },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: nombreCliente },
          ],
        },
      ],
    },
  };

  const response = await axios.post(
    `${META_BASE_URL}/${phoneNumberId}/messages`,
    body,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const messageId = response.data?.messages?.[0]?.id;
  if (!messageId) {
    throw new Error('Meta no devolvió un message ID en la respuesta');
  }

  return { messageId };
}

/**
 * Pausa la ejecución por N milisegundos.
 * Usado para rate limiting entre mensajes.
 *
 * @param {number} ms - Milisegundos a esperar
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
