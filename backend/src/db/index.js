/**
 * Pool de conexión a PostgreSQL
 * Autor: Turnio
 * Fecha: 2026-03-18
 * Dependencias: pg, dotenv
 *
 * Usa un pool de conexiones para eficiencia. La variable DATABASE_URL
 * viene de Railway automáticamente cuando se linkea el servicio de Postgres.
 */

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL no está definida en las variables de entorno');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway Postgres requiere SSL en producción
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
  max: 10,                // máximo de conexiones simultáneas
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('[DB] Error inesperado en cliente idle:', err.message);
});

/**
 * Ejecuta una query con parámetros preparados.
 * Nunca interpolar variables directamente en la query SQL.
 *
 * @param {string} text  - Query SQL con placeholders ($1, $2, ...)
 * @param {Array}  params - Valores para los placeholders
 */
export async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV !== 'production') {
      console.debug(`[DB] query(${duration}ms): ${text.substring(0, 80)}`);
    }
    return result;
  } catch (err) {
    console.error('[DB] Error en query:', err.message);
    console.error('[DB] Query:', text);
    throw err;
  }
}

/**
 * Inicializa el esquema de la base de datos si no existe.
 * Idempotente: usa CREATE TABLE IF NOT EXISTS.
 */
export async function initSchema() {
  const sql = `
    CREATE TABLE IF NOT EXISTS config (
      key         VARCHAR(100) PRIMARY KEY,
      value       TEXT NOT NULL,
      updated_at  TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id          SERIAL PRIMARY KEY,
      nombre      VARCHAR(255) NOT NULL,
      telefono    VARCHAR(20) NOT NULL UNIQUE,
      created_at  TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id                SERIAL PRIMARY KEY,
      nombre            VARCHAR(255) NOT NULL,
      template_name     VARCHAR(255) NOT NULL,
      template_language VARCHAR(10) NOT NULL,
      scheduled_at      TIMESTAMP NOT NULL,
      status            VARCHAR(20) DEFAULT 'scheduled',
      total_contacts    INT DEFAULT 0,
      sent_count        INT DEFAULT 0,
      delivered_count   INT DEFAULT 0,
      read_count        INT DEFAULT 0,
      failed_count      INT DEFAULT 0,
      created_at        TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS message_logs (
      id                  SERIAL PRIMARY KEY,
      campaign_id         INT REFERENCES campaigns(id) ON DELETE CASCADE,
      contact_id          INT REFERENCES contacts(id) ON DELETE SET NULL,
      telefono            VARCHAR(20) NOT NULL,
      nombre              VARCHAR(255) NOT NULL,
      status              VARCHAR(20) DEFAULT 'pending',
      whatsapp_message_id VARCHAR(255),
      error_message       TEXT,
      sent_at             TIMESTAMP,
      updated_at          TIMESTAMP DEFAULT NOW()
    );

    -- Índice para acelerar búsquedas de logs por campaign_id
    CREATE INDEX IF NOT EXISTS idx_message_logs_campaign_id
      ON message_logs(campaign_id);

    -- Índice para acelerar búsquedas de logs por whatsapp_message_id (webhook)
    CREATE INDEX IF NOT EXISTS idx_message_logs_wa_message_id
      ON message_logs(whatsapp_message_id);

    -- Mensajes entrantes de WhatsApp (para la bandeja de entrada Chatwoot)
    CREATE TABLE IF NOT EXISTS incoming_messages (
      id                        SERIAL PRIMARY KEY,
      telefono                  VARCHAR(20) NOT NULL,
      nombre                    VARCHAR(255),
      message                   TEXT NOT NULL,
      whatsapp_message_id       VARCHAR(255),
      chatwoot_conversation_id  INT,
      created_at                TIMESTAMP DEFAULT NOW()
    );

    -- Índice para buscar mensajes por teléfono (historial de conversación)
    CREATE INDEX IF NOT EXISTS idx_incoming_messages_telefono
      ON incoming_messages(telefono);
  `;

  await pool.query(sql);
  console.log('[DB] Esquema inicializado correctamente');
}

export default pool;
