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

    CREATE TABLE IF NOT EXISTS waba_products (
      id                    SERIAL PRIMARY KEY,
      woo_id                INT NOT NULL UNIQUE,
      nombre                VARCHAR(500) NOT NULL,
      descripcion_original  TEXT,
      descripcion_vision    TEXT,
      precio                DECIMAL(12,2),
      precio_oferta         DECIMAL(12,2),
      stock                 INT DEFAULT 0,
      categorias            TEXT,
      imagen_url            TEXT,
      permalink             TEXT,
      activo                BOOLEAN DEFAULT true,
      vision_generado_at    TIMESTAMP,
      created_at            TIMESTAMP DEFAULT NOW(),
      updated_at            TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS waba_conversions (
      id            SERIAL PRIMARY KEY,
      campaign_id   INT REFERENCES waba_campaigns(id) ON DELETE CASCADE,
      email         VARCHAR(255) NOT NULL,
      woo_order_id  INT NOT NULL,
      order_amount  DECIMAL(12,2),
      order_date    TIMESTAMP,
      created_at    TIMESTAMP DEFAULT NOW(),
      UNIQUE(campaign_id, woo_order_id)
    );

    CREATE TABLE IF NOT EXISTS waba_conversation_overrides (
      telefono    VARCHAR(20)  PRIMARY KEY,
      bot_paused  BOOLEAN      NOT NULL DEFAULT false,
      paused_at   TIMESTAMP
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

  // 2. Migraciones: agregar columnas nuevas a tablas existentes
  const migrations = [
    `ALTER TABLE waba_contacts     ADD COLUMN IF NOT EXISTS email    VARCHAR(255)`,
    `ALTER TABLE waba_contacts     ADD COLUMN IF NOT EXISTS segmento VARCHAR(100)`,
    `ALTER TABLE waba_message_logs ADD COLUMN IF NOT EXISTS email    VARCHAR(255)`,
  ];
  for (const m of migrations) {
    try { await pool.query(m); } catch (err) {
      console.warn('[DB] Migration warning:', err.message.split('\n')[0]);
    }
  }

  // 3. Migración: columna variantes en productos
  try {
    await pool.query(`ALTER TABLE waba_products ADD COLUMN IF NOT EXISTS variantes TEXT`);
  } catch (err) {
    console.warn('[DB] variantes migration warning:', err.message.split('\n')[0]);
  }

  // 4. Índices originales de performance
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_waba_message_logs_campaign_id
        ON waba_message_logs(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_waba_message_logs_wa_message_id
        ON waba_message_logs(whatsapp_message_id);
      CREATE INDEX IF NOT EXISTS idx_incoming_messages_telefono
        ON incoming_messages(telefono);
      CREATE INDEX IF NOT EXISTS idx_waba_products_activo_stock
        ON waba_products(activo, stock);
      CREATE INDEX IF NOT EXISTS idx_waba_products_woo_id
        ON waba_products(woo_id);
      CREATE UNIQUE INDEX IF NOT EXISTS waba_contacts_telefono_unique
        ON waba_contacts(telefono);
    `);
  } catch (err) {
    console.warn('[DB] Index warning:', err.message.split('\n')[0]);
  }

  // 5. Índices de performance adicionales (2026-03-20)
  //    Cada índice corre por separado para que un fallo no bloquee al resto.

  // Scheduler: query que corre cada minuto — necesita index compuesto
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_waba_campaigns_status_scheduled
        ON waba_campaigns(status, scheduled_at)
    `);
    console.debug('[DB] idx_waba_campaigns_status_scheduled OK');
  } catch (err) {
    console.warn('[DB] idx_waba_campaigns_status_scheduled:', err.message.split('\n')[0]);
  }

  // Dashboard stats: campaigns por status
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_waba_campaigns_status
        ON waba_campaigns(status)
    `);
    console.debug('[DB] idx_waba_campaigns_status OK');
  } catch (err) {
    console.warn('[DB] idx_waba_campaigns_status:', err.message.split('\n')[0]);
  }

  // Conversiones: JOIN por campaign_id en listado de campañas
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_waba_conversions_campaign_id
        ON waba_conversions(campaign_id)
    `);
    console.debug('[DB] idx_waba_conversions_campaign_id OK');
  } catch (err) {
    console.warn('[DB] idx_waba_conversions_campaign_id:', err.message.split('\n')[0]);
  }

  // Conversiones: JOIN por email en stats del dashboard
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_waba_conversions_email
        ON waba_conversions(email)
    `);
    console.debug('[DB] idx_waba_conversions_email OK');
  } catch (err) {
    console.warn('[DB] idx_waba_conversions_email:', err.message.split('\n')[0]);
  }

  // Message logs: email para JOIN de conversiones — partial index (excluye NULLs)
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_waba_message_logs_email
        ON waba_message_logs(email)
        WHERE email IS NOT NULL
    `);
    console.debug('[DB] idx_waba_message_logs_email OK');
  } catch (err) {
    console.warn('[DB] idx_waba_message_logs_email:', err.message.split('\n')[0]);
  }

  // Message logs: compound index para el scheduler (campaign_id + status)
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_waba_message_logs_campaign_status
        ON waba_message_logs(campaign_id, status)
    `);
    console.debug('[DB] idx_waba_message_logs_campaign_status OK');
  } catch (err) {
    console.warn('[DB] idx_waba_message_logs_campaign_status:', err.message.split('\n')[0]);
  }

  // Contacts: segmento para el filtro de la bandeja y campañas — partial index
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_waba_contacts_segmento
        ON waba_contacts(segmento)
        WHERE segmento IS NOT NULL
    `);
    console.debug('[DB] idx_waba_contacts_segmento OK');
  } catch (err) {
    console.warn('[DB] idx_waba_contacts_segmento:', err.message.split('\n')[0]);
  }

  // Contacts: email para búsquedas y conversiones — partial index
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_waba_contacts_email
        ON waba_contacts(email)
        WHERE email IS NOT NULL
    `);
    console.debug('[DB] idx_waba_contacts_email OK');
  } catch (err) {
    console.warn('[DB] idx_waba_contacts_email:', err.message.split('\n')[0]);
  }

  // Products: updated_at para ORDER BY DESC de paginación
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_waba_products_updated_at
        ON waba_products(updated_at DESC)
    `);
    console.debug('[DB] idx_waba_products_updated_at OK');
  } catch (err) {
    console.warn('[DB] idx_waba_products_updated_at:', err.message.split('\n')[0]);
  }

  // Incoming messages: created_at para el historial del bot (ORDER BY DESC LIMIT 10)
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_incoming_messages_telefono_created
        ON incoming_messages(telefono, created_at DESC)
    `);
    console.debug('[DB] idx_incoming_messages_telefono_created OK');
  } catch (err) {
    console.warn('[DB] idx_incoming_messages_telefono_created:', err.message.split('\n')[0]);
  }

  // Búsqueda con ILIKE '%texto%': requiere extensión pg_trgm + índices GIN.
  // Si Railway no permite CREATE EXTENSION (permisos), este bloque falla silenciosamente
  // y las búsquedas siguen funcionando (solo sin aceleración trigrama).
  try {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_waba_contacts_nombre_trgm
        ON waba_contacts USING gin(nombre gin_trgm_ops);
      CREATE INDEX IF NOT EXISTS idx_waba_contacts_telefono_trgm
        ON waba_contacts USING gin(telefono gin_trgm_ops);
      CREATE INDEX IF NOT EXISTS idx_waba_products_nombre_trgm
        ON waba_products USING gin(nombre gin_trgm_ops);
    `);
    console.debug('[DB] Índices trigrama (pg_trgm) OK');
  } catch (err) {
    // No es crítico: las búsquedas funcionan igual, solo son más lentas sin este índice
    console.warn('[DB] pg_trgm (no crítico):', err.message.split('\n')[0]);
  }

  console.log('[DB] Esquema inicializado correctamente');
}

export default pool;
