/**
 * Rutas de configuración del bot de IA
 * Autor: Turnio
 * Fecha: 2026-03-19
 *
 * GET  /api/bot — devuelve la configuración actual del bot
 * PUT  /api/bot — guarda la configuración del bot (upsert en tabla config)
 */

import { Router } from 'express';
import { query } from '../db/index.js';

const router = Router();

const BOT_KEYS = [
  'BOT_ENABLED',
  'BOT_PROMPT',
  'BOT_SCHEDULE_ENABLED',
  'BOT_SCHEDULE_START',
  'BOT_SCHEDULE_END',
];

// GET /api/bot — devuelve la configuración actual del bot desde la tabla config
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT key, value FROM config WHERE key = ANY($1)`,
      [BOT_KEYS]
    );

    const config = {};
    for (const row of result.rows) {
      config[row.key] = row.value;
    }

    // Normalizar a tipos correctos para el frontend
    const data = {
      BOT_ENABLED:          config.BOT_ENABLED === 'true',
      BOT_PROMPT:           config.BOT_PROMPT || '',
      BOT_SCHEDULE_ENABLED: config.BOT_SCHEDULE_ENABLED === 'true',
      BOT_SCHEDULE_START:   config.BOT_SCHEDULE_START || '08:00',
      BOT_SCHEDULE_END:     config.BOT_SCHEDULE_END || '20:00',
    };

    res.json({ success: true, data });
  } catch (err) {
    console.error('[Bot] GET error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/bot — guarda la configuración del bot
// Body: { BOT_ENABLED, BOT_PROMPT, BOT_SCHEDULE_ENABLED, BOT_SCHEDULE_START, BOT_SCHEDULE_END }
router.put('/', async (req, res) => {
  const entries = Object.entries(req.body).filter(([k]) => BOT_KEYS.includes(k));

  if (entries.length === 0) {
    return res.status(400).json({ success: false, error: 'No se enviaron claves válidas' });
  }

  try {
    for (const [key, value] of entries) {
      // Convertir booleanos a string 'true'/'false' para almacenamiento consistente
      const storedValue = typeof value === 'boolean' ? String(value) : String(value ?? '').trim();

      await query(
        `INSERT INTO config (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, storedValue]
      );
    }

    res.json({ success: true, data: { message: 'Configuración del bot guardada correctamente' } });
  } catch (err) {
    console.error('[Bot] PUT error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
