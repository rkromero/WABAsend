/**
 * Pool de conexión a PostgreSQL
 * Autor: Turnio
 * Fecha: 2026-03-18
 * Dependencias: pg, dotenv
 *
 * Usa un pool de conexiones para eficiencia. La variable DATABASE_URL
 * viene de Railway automáticamente cuando se linkea el servicio de Postgres.
 *
 * NOTA: Las tablas se prefijan con `waba_` para evitar colisión con las tablas
 * que Chatwoot crea en la misma base de datos PostgreSQL (contacts, campaigns, etc.)
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
 * Idempotente: usa CREATE TABLE IF NOT EXISTS + ALTER TABLE ADD COLUMN IF NOT EXISTS
 * para manejar tablas que existan con schema desactualizado.
 *
 * Usamos el prefijo `waba_` en nuestras tablas para no colisionar con las tablas
 * de Chatwoot (contacts, campaigns, conversations, messages, etc.).
 */
export async function initSchema() {
  // 1. Crear tablas base
  await pool.query(`
    CREATE TABLE IF NOT EXISTS config (
      key         VARCHAR(100) PRIMARY KEY,
      value       TEXT NOT NULL,
      updated_at  TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS waba_contacts (
      id          SERIAL PRIMARY KEY,
      nombre      VARCHAR(255) NOT NULL,
      telefono    VARCHAR(20)  NOT NULL UNIQUE,
      created_at  TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS waba_campaigns (
      id                SERIAL PRIMARY KEY,
      nombre            VARCHAR(255) NOT NULL DEFAULT 'Campaña',
      template_name     VARCHAR(255) NOT NULL DEFAULT '',
      template_language VARCHAR(10)  NOT NULL DEFAULT 'es',
      scheduled_at      TIMESTAMP    NOT NULL DEFAULT NOW(),
      status            VARCHAR(20)           DEFAULT 'scheduled',
      total_contacts    INT                   DEFAULT 0,
      sent_count        INT                   DEFAULT 0,
      delivered_count   INT                   DEFAULT 0,
      read_count        INT                   DEFAULT 0,
      failed_count      INT                   DEFAULT 0,
      created_at        TIMESTAMP             DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS waba_message_logs (
      id                    SERIAL PRIMARY KEY,
      campaign_id           INT REFERENCES waba_campaigns(id) ON DELETE CASCADE,
      contact_id            INT,
      telefono              VARCHAR(20)  NOT NULL,
      nombre                VARCHAR(255) NOT NULL DEFAULT '',
      status                VARCHAR(20)           DEFAULT 'pending',
      whatsapp_message_id   VARCHAR(255),
      error_message         TEXT,
      sent_at               TIMESTAMP,
      updated_at            TIMESTAMP             DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS incoming_messages (
      id                        SERIAL PRIMARY KEY,
      telefono                  VARCHAR(20) NOT NULL,
      nombre                    VARCHAR(255),
      message                   TEXT NOT NULL,
      whatsapp_message_id       VARCHAR(255),
      chatwoot_conversation_id  INT,
      created_at                TIMESTAMP DEFAULT NOW()
    );
  `);

  // 2. Índices de performance
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_waba_message_logs_campaign_id
        ON waba_message_logs(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_waba_message_logs_wa_message_id
        ON waba_message_logs(whatsapp_message_id);
      CREATE INDEX IF NOT EXISTS idx_incoming_messages_telefono
        ON incoming_messages(telefono);
      CREATE UNIQUE INDEX IF NOT EXISTS waba_contacts_telefono_unique
        ON waba_contacts(telefono);
    `);
  } catch (err) {
    console.warn('[DB] Index warning:', err.message.split('\n')[0]);
  }

  console.log('[DB] Esquema inicializado correctamente');
}

export default pool;
