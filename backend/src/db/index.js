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
 * Idempotente: usa CREATE TABLE IF NOT EXISTS + ALTER TABLE ADD COLUMN IF NOT EXISTS
 * para manejar tablas que existan con schema desactualizado.
 */
export async function initSchema() {
  // 1. Crear tablas base
  await pool.query(`
    CREATE TABLE IF NOT EXISTS config (
      key         VARCHAR(100) PRIMARY KEY,
      value       TEXT NOT NULL,
      updated_at  TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id          SERIAL PRIMARY KEY,
      telefono    VARCHAR(20) NOT NULL UNIQUE,
      created_at  TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id          SERIAL PRIMARY KEY,
      created_at  TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS message_logs (
      id          SERIAL PRIMARY KEY,
      telefono    VARCHAR(20) NOT NULL,
      updated_at  TIMESTAMP DEFAULT NOW()
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

  // 2. Migración: agregar columnas faltantes si no existen
  // Esto maneja tablas creadas previamente con schema incompleto
  const migrations = [
    // contacts
    `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS nombre   VARCHAR(255) NOT NULL DEFAULT 'Sin nombre'`,
    `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS telefono VARCHAR(20)  UNIQUE`,

    // campaigns
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS nombre            VARCHAR(255) NOT NULL DEFAULT 'Campaña'`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS template_name     VARCHAR(255) NOT NULL DEFAULT ''`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS template_language VARCHAR(10)  NOT NULL DEFAULT 'es'`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS scheduled_at      TIMESTAMP    NOT NULL DEFAULT NOW()`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS status            VARCHAR(20)           DEFAULT 'scheduled'`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS total_contacts    INT                   DEFAULT 0`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS sent_count        INT                   DEFAULT 0`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS delivered_count   INT                   DEFAULT 0`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS read_count        INT                   DEFAULT 0`,
    `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS failed_count      INT                   DEFAULT 0`,

    // message_logs
    `ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS campaign_id         INT REFERENCES campaigns(id) ON DELETE CASCADE`,
    `ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS contact_id          INT`,
    `ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS nombre              VARCHAR(255) NOT NULL DEFAULT ''`,
    `ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS status              VARCHAR(20)  DEFAULT 'pending'`,
    `ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS whatsapp_message_id VARCHAR(255)`,
    `ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS error_message       TEXT`,
    `ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS sent_at             TIMESTAMP`,
  ];

  for (const migration of migrations) {
    try {
      await pool.query(migration);
    } catch (err) {
      // Ignorar errores de migración no críticos (ej: constraint ya existe)
      console.warn('[DB] Migration warning:', err.message.split('\n')[0]);
    }
  }

  // 3. Índices
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_message_logs_campaign_id
      ON message_logs(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_message_logs_wa_message_id
      ON message_logs(whatsapp_message_id);
    CREATE INDEX IF NOT EXISTS idx_incoming_messages_telefono
      ON incoming_messages(telefono);
  `);

  console.log('[DB] Esquema inicializado correctamente');
}

export default pool;
