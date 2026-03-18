/**
 * Rutas de configuración de la WABA
 * Autor: Turnio
 * Fecha: 2026-03-18
 */

import { Router } from 'express';
import { query } from '../db/index.js';

const router = Router();

// GET /api/config — devuelve la config actual (sin exponer el token completo)
router.get('/', async (req, res) => {
  try {
    const result = await query('SELECT key, value FROM config');
    const config = {};
    for (const row of result.rows) {
      // Ocultar parte del token por seguridad en la UI
      if (row.key === 'WHATSAPP_TOKEN' && row.value) {
        config[row.key] = row.value.substring(0, 8) + '...' + row.value.slice(-4);
      } else {
        config[row.key] = row.value;
      }
    }
    res.json({ success: true, data: config });
  } catch (err) {
    console.error('[Config] GET error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/config — guarda o actualiza claves de configuración
// Body: { WHATSAPP_TOKEN, PHONE_NUMBER_ID, WABA_ID, WEBHOOK_VERIFY_TOKEN }
router.post('/', async (req, res) => {
  const allowedKeys = ['WHATSAPP_TOKEN', 'PHONE_NUMBER_ID', 'WABA_ID', 'WEBHOOK_VERIFY_TOKEN'];
  const entries = Object.entries(req.body).filter(([k]) => allowedKeys.includes(k));

  if (entries.length === 0) {
    return res.status(400).json({ success: false, error: 'No se enviaron claves válidas' });
  }

  try {
    for (const [key, value] of entries) {
      if (!value || String(value).trim() === '') continue;
      // UPSERT: inserta o actualiza si ya existe
      await query(
        `INSERT INTO config (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, String(value).trim()]
      );
    }

    res.json({ success: true, data: { message: 'Configuración guardada correctamente' } });
  } catch (err) {
    console.error('[Config] POST error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
