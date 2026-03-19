/**
 * Servicio de integración con Chatwoot
 * Autor: Turnio
 * Fecha: 2026-03-19
 * Dependencias: axios, dotenv
 *
 * Centraliza todas las llamadas a la API de Chatwoot para mantener
 * conversaciones sincronizadas con los mensajes de WhatsApp.
 */

import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const CHATWOOT_URL = process.env.CHATWOOT_URL;
const CHATWOOT_TOKEN = process.env.CHATWOOT_TOKEN;
const CHATWOOT_ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID;
const CHATWOOT_INBOX_ID = process.env.CHATWOOT_INBOX_ID;

if (!CHATWOOT_URL || !CHATWOOT_TOKEN || !CHATWOOT_ACCOUNT_ID || !CHATWOOT_INBOX_ID) {
  console.warn('[Chatwoot] Variables de entorno incompletas — integración deshabilitada');
}

// Cliente axios preconfigurado para Chatwoot
const chatwootClient = axios.create({
  baseURL: `${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}`,
  headers: {
    'api_access_token': CHATWOOT_TOKEN,
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

/**
 * Busca un contacto en Chatwoot por teléfono. Si no existe, lo crea.
 *
 * @param {string} telefono - Número de teléfono en formato internacional (ej: 5491112345678)
 * @param {string} nombre   - Nombre del contacto
 * @returns {Promise<Object>} Contacto de Chatwoot
 */
export async function getOrCreateContact(telefono, nombre) {
  try {
    // Buscar por número de teléfono
    const searchRes = await chatwootClient.get('/contacts/search', {
      params: { q: telefono, include_contacts: true },
    });

    const existing = searchRes.data?.payload?.find(
      (c) => c.phone_number === `+${telefono}` || c.phone_number === telefono
    );

    if (existing) {
      console.debug(`[Chatwoot] Contacto encontrado: ${existing.id} (${telefono})`);
      return existing;
    }

    // Crear si no existe
    const createRes = await chatwootClient.post('/contacts', {
      name: nombre || telefono,
      phone_number: `+${telefono}`,
      identifier: telefono,
    });

    const created = createRes.data;
    console.log(`[Chatwoot] Contacto creado: ${created.id} (${telefono})`);
    return created;
  } catch (err) {
    console.error('[Chatwoot] Error en getOrCreateContact:', err.response?.data || err.message);
    throw err;
  }
}

/**
 * Busca una conversación abierta para un contacto en el inbox dado.
 * Si no existe, crea una nueva.
 *
 * @param {number} contactId - ID del contacto en Chatwoot
 * @param {number} inboxId   - ID del inbox de Chatwoot
 * @returns {Promise<Object>} Conversación de Chatwoot
 */
export async function getOrCreateConversation(contactId, inboxId = CHATWOOT_INBOX_ID) {
  try {
    // Listar conversaciones del contacto y buscar una abierta en este inbox
    const convRes = await chatwootClient.get(`/contacts/${contactId}/conversations`);
    const conversations = convRes.data?.payload || [];

    const openConv = conversations.find(
      (c) => c.status === 'open' && String(c.inbox_id) === String(inboxId)
    );

    if (openConv) {
      console.debug(`[Chatwoot] Conversación existente: ${openConv.id} (contacto: ${contactId})`);
      return openConv;
    }

    // Crear nueva conversación
    const createRes = await chatwootClient.post('/conversations', {
      inbox_id: parseInt(inboxId),
      contact_id: contactId,
      status: 'open',
    });

    const created = createRes.data;
    console.log(`[Chatwoot] Conversación creada: ${created.id} (contacto: ${contactId})`);
    return created;
  } catch (err) {
    console.error('[Chatwoot] Error en getOrCreateConversation:', err.response?.data || err.message);
    throw err;
  }
}

/**
 * Envía un mensaje a una conversación de Chatwoot.
 *
 * @param {number} conversationId - ID de la conversación
 * @param {string} message        - Texto del mensaje
 * @param {string} messageType    - 'incoming' (del cliente) o 'outgoing' (del agente)
 * @returns {Promise<Object>} Mensaje creado en Chatwoot
 */
export async function sendMessageToConversation(conversationId, message, messageType = 'incoming') {
  try {
    const res = await chatwootClient.post(`/conversations/${conversationId}/messages`, {
      content: message,
      message_type: messageType,
      // private: false para que sea visible en la conversación
      private: false,
    });

    console.debug(`[Chatwoot] Mensaje enviado a conversación ${conversationId} (type: ${messageType})`);
    return res.data;
  } catch (err) {
    console.error('[Chatwoot] Error en sendMessageToConversation:', err.response?.data || err.message);
    throw err;
  }
}

/**
 * Lista las conversaciones del account con paginación.
 *
 * @param {number} page - Número de página (default: 1)
 * @returns {Promise<Object>} Lista de conversaciones con metadata
 */
export async function getConversations(page = 1) {
  try {
    const res = await chatwootClient.get('/conversations', {
      params: { page, assignee_type: 'all', status: 'open' },
    });
    return res.data;
  } catch (err) {
    console.error('[Chatwoot] Error en getConversations:', err.response?.data || err.message);
    throw err;
  }
}

/**
 * Obtiene los mensajes de una conversación.
 *
 * @param {number} conversationId - ID de la conversación
 * @returns {Promise<Object>} Lista de mensajes
 */
export async function getMessages(conversationId) {
  try {
    const res = await chatwootClient.get(`/conversations/${conversationId}/messages`);
    return res.data;
  } catch (err) {
    console.error('[Chatwoot] Error en getMessages:', err.response?.data || err.message);
    throw err;
  }
}

/**
 * Obtiene los datos completos de una conversación (incluye contacto y metadatos).
 *
 * @param {number} conversationId - ID de la conversación
 * @returns {Promise<Object>} Datos de la conversación
 */
export async function getConversation(conversationId) {
  try {
    const res = await chatwootClient.get(`/conversations/${conversationId}`);
    return res.data;
  } catch (err) {
    console.error('[Chatwoot] Error en getConversation:', err.response?.data || err.message);
    throw err;
  }
}
