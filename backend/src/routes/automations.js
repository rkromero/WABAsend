/**
 * Rutas CRUD de automatizaciones basadas en eventos WooCommerce
 * Autor: Turnio
 * Fecha: 2026-03-20
 */

import { Router } from 'express';
import { query } from '../db/index.js';
import { processAutomationQueue } from '../services/automations.js';

const router = Router();

const EVENTOS_VALIDOS = ['order.completed', 'order.created', 'customer.created'];

// GET /api/automations — lista todas con sus contadores de cola
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT
         a.*,
         COUNT(q.id) FILTER (WHERE q.status = 'pending') AS pending_count,
         COUNT(q.id) FILTER (WHERE q.status = 'sent')    AS sent_count,
         COUNT(q.id) FILTER (WHERE q.status = 'failed')  AS failed_count
       FROM waba_automations a
       LEFT JOIN waba_automation_queue q ON q.automation_id = a.id
       GROUP BY a.id
       ORDER BY a.created_at DESC`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[Automations] GET error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/automations — crear automatización
router.post('/', async (req, res) => {
  const { nombre, evento, delay_dias, template_name, template_language } = req.body;

  if (!nombre || !evento || !template_name) {
    return res.status(400).json({
      success: false,
      error: 'nombre, evento y template_name son requeridos',
    });
  }

  if (!EVENTOS_VALIDOS.includes(evento)) {
    return res.status(400).json({
      success: false,
      error: `Evento inválido. Válidos: ${EVENTOS_VALIDOS.join(', ')}`,
    });
  }

  try {
    const result = await query(
      `INSERT INTO waba_automations (nombre, evento, delay_dias, template_name, template_language)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [nombre, evento, parseInt(delay_dias) || 0, template_name, template_language || 'es_AR']
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[Automations] POST error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/automations/:id — actualizar (incluyendo toggle activa)
router.put('/:id', async (req, res) => {
  const { nombre, evento, delay_dias, template_name, template_language, activa } = req.body;

  if (evento && !EVENTOS_VALIDOS.includes(evento)) {
    return res.status(400).json({
      success: false,
      error: `Evento inválido. Válidos: ${EVENTOS_VALIDOS.join(', ')}`,
    });
  }

  try {
    const result = await query(
      `UPDATE waba_automations
       SET nombre            = COALESCE($1, nombre),
           evento            = COALESCE($2, evento),
           delay_dias        = COALESCE($3, delay_dias),
           template_name     = COALESCE($4, template_name),
           template_language = COALESCE($5, template_language),
           activa            = COALESCE($6, activa),
           updated_at        = NOW()
       WHERE id = $7
       RETURNING *`,
      [
        nombre || null,
        evento || null,
        delay_dias != null ? parseInt(delay_dias) : null,
        template_name || null,
        template_language || null,
        activa != null ? activa : null,
        req.params.id,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Automatización no encontrada' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[Automations] PUT error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/automations/:id
router.delete('/:id', async (req, res) => {
  try {
    await query('DELETE FROM waba_automations WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('[Automations] DELETE error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/automations/queue — historial de la cola (últimos N registros)
router.get('/queue', async (req, res) => {
  const limit = Math.min(200, parseInt(req.query.limit) || 50);
  try {
    const result = await query(
      `SELECT q.*, a.nombre AS automation_nombre, a.evento, a.template_name
       FROM waba_automation_queue q
       JOIN waba_automations a ON a.id = q.automation_id
       ORDER BY
         CASE WHEN q.status = 'invalid_phone' THEN 0 ELSE 1 END,
         q.created_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/automations/queue/:id — corregir teléfono de una entrada invalid_phone
// Al guardar el teléfono corregido, vuelve a status='pending' para que se envíe
router.put('/queue/:id', async (req, res) => {
  const { telefono } = req.body;

  if (!telefono || typeof telefono !== 'string') {
    return res.status(400).json({ success: false, error: 'telefono es requerido' });
  }

  // Validar que tenga formato correcto para WhatsApp (solo dígitos, 10-15 chars)
  const telLimpio = telefono.replace(/[\s\-\(\)\+]/g, '');
  if (!/^\d{10,15}$/.test(telLimpio)) {
    return res.status(400).json({
      success: false,
      error: 'Formato inválido. Ingresá el número completo (ej: 5491134866718)',
    });
  }

  try {
    const result = await query(
      `UPDATE waba_automation_queue
       SET telefono = $1, status = 'pending', error_message = NULL
       WHERE id = $2
       RETURNING *`,
      [telLimpio, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Entrada no encontrada' });
    }

    console.log(`[Automations] Teléfono corregido para queue #${req.params.id}: ${telLimpio}`);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[Automations] PUT queue error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/automations/process — forzar procesamiento de cola (útil para testing)
router.post('/process', async (req, res) => {
  try {
    await processAutomationQueue();
    res.json({ success: true, message: 'Cola procesada' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
