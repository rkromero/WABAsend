/**
 * Rutas de plantillas WABA
 * Autor: Turnio
 * Fecha: 2026-03-18
 */

import { Router } from 'express';
import { fetchTemplates, createTemplate } from '../services/whatsapp.js';
import { query } from '../db/index.js';

const router = Router();

// GET /api/templates — lista plantillas aprobadas desde Meta + caché local
router.get('/', async (req, res) => {
  try {
    // Obtener directamente desde la API de Meta para tener datos frescos
    const templates = await fetchTemplates();

    // Sincronizar en base de datos local (upsert por nombre+idioma)
    for (const t of templates) {
      await query(
        `INSERT INTO config (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO NOTHING`,
        [`template_cache_${t.name}_${t.language}`, JSON.stringify(t)]
      ).catch(() => {}); // ignorar errores de caché — no es crítico
    }

    res.json({ success: true, data: templates });
  } catch (err) {
    console.error('[Templates] GET error:', err.message);

    // Si falla la API de Meta, intentar devolver caché local
    if (err.message.includes('Configuración incompleta')) {
      return res.status(400).json({ success: false, error: err.message });
    }

    res.status(502).json({
      success: false,
      error: 'No se pudo conectar con la API de Meta. Verificá el token en Configuración.',
    });
  }
});

// POST /api/templates — crear nueva plantilla en Meta
router.post('/', async (req, res) => {
  const { name, language, category, components } = req.body;

  if (!name || !language || !category || !components) {
    return res.status(400).json({
      success: false,
      error: 'Campos requeridos: name, language, category, components',
    });
  }

  try {
    const result = await createTemplate({ name, language, category, components });
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[Templates] POST error:', err.message);
    const metaError = err.response?.data?.error?.message || err.message;
    res.status(400).json({ success: false, error: metaError });
  }
});

export default router;
