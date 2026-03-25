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
 *
 * @param {string}   telefono         - Número en formato internacional (ej: 5491112345678)
 * @param {string}   templateName     - Nombre exacto de la plantilla aprobada
 * @param {string}   templateLanguage - Código de idioma (ej: es_AR, en_US)
 * @param {string[]} parameterValues  - Valores para {{1}}, {{2}}, ... en orden.
 *                                     Array vacío = plantilla sin variables (no se envían components).
 *
 * @returns {{ messageId: string }} ID del mensaje asignado por Meta
 */
export async function sendTemplateMessage(telefono, templateName, templateLanguage, parameterValues = []) {
  const { token, phoneNumberId } = await getConfig();

  // Si hay variables, construir el array de parameters del body.
  // Meta devuelve error #132000 si se envían parameters a una plantilla sin variables.
  const templateComponents = parameterValues.length > 0
    ? [{ type: 'body', parameters: parameterValues.map((text) => ({ type: 'text', text: String(text ?? '') })) }]
    : [];

  const body = {
    messaging_product: 'whatsapp',
    to: telefono,
    type: 'template',
    template: {
      name: templateName,
      language: { code: templateLanguage },
      ...(templateComponents.length > 0 ? { components: templateComponents } : {}),
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
 * Envía un mensaje de texto libre (sesión abierta) a un número de teléfono.
 * Solo funciona dentro de la ventana de 24 horas desde el último mensaje del usuario.
 *
 * @param {string} telefono - Número en formato internacional (ej: 5491112345678)
 * @param {string} text     - Texto a enviar
 *
 * @returns {Promise<string>} ID del mensaje asignado por Meta
 */
export async function sendFreeTextMessage(telefono, text) {
  const { token, phoneNumberId } = await getConfig();

  const response = await axios.post(
    `${META_BASE_URL}/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      to: telefono,
      type: 'text',
      text: { body: text },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const messageId = response.data?.messages?.[0]?.id;
  if (!messageId) {
    throw new Error('Meta no devolvió un message ID para el mensaje de texto libre');
  }

  return messageId;
}

/**
 * Obtiene la URL de descarga de un archivo multimedia de Meta.
 * Las URLs son temporales (~5 minutos) y requieren el token para descargar.
 *
 * @param {string} mediaId - ID del media devuelto en el webhook de Meta
 * @returns {Promise<string|null>} URL temporal de descarga
 */
export async function getMediaUrl(mediaId) {
  const { token } = await getConfig();

  const response = await axios.get(
    `${META_BASE_URL}/${mediaId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return response.data?.url || null;
}

/**
 * Sube un archivo al servicio de media de Meta y devuelve el media_id.
 * El media_id se usa luego para enviar mensajes con ese adjunto.
 *
 * Usa el FormData nativo de Node.js 18+ (disponible globalmente).
 *
 * @param {Buffer} buffer    - Contenido binario del archivo
 * @param {string} mimeType  - MIME type (ej: 'image/jpeg', 'application/pdf')
 * @param {string} filename  - Nombre de archivo (ej: 'foto.jpg')
 * @returns {Promise<string>} media_id de Meta
 */
export async function uploadMediaToMeta(buffer, mimeType, filename) {
  const { token, phoneNumberId } = await getConfig();

  // Node.js 18+ expone FormData y Blob de forma global
  const formData = new FormData();
  formData.append('messaging_product', 'whatsapp');
  formData.append('type', mimeType);
  formData.append('file', new Blob([buffer], { type: mimeType }), filename);

  const response = await axios.post(
    `${META_BASE_URL}/${phoneNumberId}/media`,
    formData,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  const mediaId = response.data?.id;
  if (!mediaId) throw new Error('Meta no devolvió un media_id al subir el archivo');
  return mediaId;
}

/**
 * Envía un mensaje multimedia (imagen, documento, audio, video) por WhatsApp.
 * Requiere primero haber subido el archivo con uploadMediaToMeta() para obtener el media_id.
 *
 * @param {string} telefono  - Número en formato internacional
 * @param {string} mediaType - 'image' | 'document' | 'audio' | 'video'
 * @param {string} mediaId   - ID del media obtenido de Meta
 * @param {string} caption   - Texto opcional que acompaña al media
 * @param {string} filename  - Nombre del archivo (requerido solo para document)
 * @returns {Promise<string>} ID del mensaje de WhatsApp
 */
export async function sendMediaMessage(telefono, mediaType, mediaId, caption = '', filename = '') {
  const { token, phoneNumberId } = await getConfig();

  // El payload varía levemente según el tipo de media
  const mediaPayload = { id: mediaId };
  if (caption) mediaPayload.caption = caption;
  if (mediaType === 'document' && filename) mediaPayload.filename = filename;

  const response = await axios.post(
    `${META_BASE_URL}/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      to: telefono,
      type: mediaType,
      [mediaType]: mediaPayload,
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const messageId = response.data?.messages?.[0]?.id;
  if (!messageId) throw new Error('Meta no devolvió un message ID para el mensaje multimedia');
  return messageId;
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
