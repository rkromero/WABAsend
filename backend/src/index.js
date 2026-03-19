/**
 * Servidor principal — WABA Sender
 * Autor: Turnio
 * Fecha: 2026-03-18
 * Dependencias: express, cors, helmet, dotenv, pg, node-cron
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';

import { initSchema } from './db/index.js';
import { startScheduler } from './services/scheduler.js';
import { syncProducts } from './services/woocommerce.js';

import configRouter from './routes/config.js';
import templatesRouter from './routes/templates.js';
import contactsRouter from './routes/contacts.js';
import campaignsRouter from './routes/campaigns.js';
import webhookRouter from './routes/webhook.js';
import inboxRouter from './routes/inbox.js';
import chatwootWebhookRouter from './routes/chatwootWebhook.js';
import botRouter from './routes/bot.js';
import productsRouter from './routes/products.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// --- Middlewares de seguridad y parsing ---
app.use(helmet());

// CORS: en producción solo permite el frontend de Railway
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5173', // Vite dev server
  'http://localhost:3000',
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Permitir requests sin origin (ej: Postman, curl) en desarrollo
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origen no permitido: ${origin}`));
      }
    },
    credentials: true,
  })
);

// El webhook de Meta requiere el body raw para procesar correctamente
app.use('/webhook', express.raw({ type: 'application/json' }), (req, res, next) => {
  // Parsear manualmente si es raw buffer
  if (Buffer.isBuffer(req.body)) {
    try {
      req.body = JSON.parse(req.body.toString());
    } catch {
      req.body = {};
    }
  }
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// --- Rutas ---
app.get('/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

app.use('/api/config', configRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/contacts', contactsRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/inbox', inboxRouter);
app.use('/api/chatwoot', chatwootWebhookRouter);
app.use('/api/bot', botRouter);
app.use('/api/products', productsRouter);
app.use('/webhook', webhookRouter);

// --- Manejo global de errores ---
app.use((err, req, res, _next) => {
  console.error('[Server] Error no capturado:', err.message);
  res.status(500).json({ success: false, error: 'Error interno del servidor' });
});

// --- Inicialización ---
async function start() {
  console.log('[Server] Iniciando WABA Sender...');

  try {
    await initSchema();
    console.log('[Server] Base de datos lista');
  } catch (err) {
    console.error('[Server] Error al inicializar la base de datos:', err.message);
    process.exit(1);
  }

  startScheduler();

  // Sync de productos WooCommerce: al arrancar y cada 30 minutos
  if (process.env.WOOCOMMERCE_URL) {
    const runSync = () => {
      syncProducts().catch((err) =>
        console.error('[Server] Error en sync WooCommerce:', err.message)
      );
    };
    runSync(); // sync inmediata al iniciar
    setInterval(runSync, 30 * 60 * 1000); // cada 30 minutos
    console.log('[Server] Sync WooCommerce iniciada (cada 30 min)');
  } else {
    console.warn('[Server] WOOCOMMERCE_URL no definida — sync de productos desactivada');
  }

  app.listen(PORT, () => {
    console.log(`[Server] Escuchando en puerto ${PORT}`);
    console.log(`[Server] Health check: http://localhost:${PORT}/health`);
  });
}

start();
