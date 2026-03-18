/**
 * Rutas de campañas
 * Autor: Turnio
 * Fecha: 2026-03-18
 */

import { Router } from 'express';
import { query } from '../db/index.js';

const router = Router();

// GET /api/campaigns — lista todas las campañas ordenadas por fecha
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, nombre, template_name, template_language, scheduled_at, status,
              total_contacts, sent_count, delivered_count, read_count, failed_count, created_at
       FROM campaigns
       ORDER BY created_at DESC
       LIMIT 100`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[Campaigns] GET error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/campaigns/stats — métricas globales para el dashboard
router.get('/stats', async (req, res) => {
  try {
    const [campaignsStats, messagesStats] = await Promise.all([
      query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'scheduled')  AS scheduled,
           COUNT(*) FILTER (WHERE status = 'running')    AS running,
           COUNT(*) FILTER (WHERE status = 'completed')  AS completed,
           COUNT(*) FILTER (WHERE status = 'failed')     AS failed,
           COUNT(*) AS total
         FROM campaigns`
      ),
      query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'sent')      AS sent,
           COUNT(*) FILTER (WHERE status = 'delivered') AS delivered,
           COUNT(*) FILTER (WHERE status = 'read')      AS read,
           COUNT(*) FILTER (WHERE status = 'failed')    AS failed,
           COUNT(*) AS total
         FROM message_logs`
      ),
    ]);

    res.json({
      success: true,
      data: {
        campaigns: campaignsStats.rows[0],
        messages: messagesStats.rows[0],
      },
    });
  } catch (err) {
    console.error('[Campaigns] Stats error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/campaigns/:id — detalle de una campaña con sus logs
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'ID inválido' });

  try {
    const [campaignResult, logsResult] = await Promise.all([
      query('SELECT * FROM campaigns WHERE id = $1', [id]),
      query(
        `SELECT id, nombre, telefono, status, whatsapp_message_id, error_message, sent_at, updated_at
         FROM message_logs
         WHERE campaign_id = $1
         ORDER BY id ASC`,
        [id]
      ),
    ]);

    if (campaignResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Campaña no encontrada' });
    }

    res.json({
      success: true,
      data: {
        campaign: campaignResult.rows[0],
        logs: logsResult.rows,
      },
    });
  } catch (err) {
    console.error('[Campaigns] GET /:id error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/campaigns — crear una nueva campaña
// Body: { nombre, template_name, template_language, contact_ids, scheduled_at }
router.post('/', async (req, res) => {
  const { nombre, template_name, template_language, contact_ids, scheduled_at } = req.body;

  if (!nombre || !template_name || !template_language || !scheduled_at) {
    return res.status(400).json({
      success: false,
      error: 'Campos requeridos: nombre, template_name, template_language, scheduled_at',
    });
  }

  if (!Array.isArray(contact_ids) || contact_ids.length === 0) {
    return res.status(400).json({ success: false, error: 'Se requieren contactos para la campaña' });
  }

  const scheduledDate = new Date(scheduled_at);
  if (isNaN(scheduledDate.getTime())) {
    return res.status(400).json({ success: false, error: 'Fecha de programación inválida' });
  }

  try {
    // Obtener datos de los contactos seleccionados
    // Usamos placeholders dinámicos para la cláusula IN
    const placeholders = contact_ids.map((_, i) => `$${i + 1}`).join(',');
    const contactsResult = await query(
      `SELECT id, nombre, telefono FROM contacts WHERE id IN (${placeholders})`,
      contact_ids
    );

    if (contactsResult.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Ningún contacto encontrado con los IDs proporcionados' });
    }

    const contacts = contactsResult.rows;

    // Crear la campaña
    const campaignResult = await query(
      `INSERT INTO campaigns (nombre, template_name, template_language, scheduled_at, total_contacts)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [nombre.trim(), template_name, template_language, scheduledDate, contacts.length]
    );

    const campaign = campaignResult.rows[0];

    // Crear un message_log por cada contacto
    for (const contact of contacts) {
      await query(
        `INSERT INTO message_logs (campaign_id, contact_id, telefono, nombre, status)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [campaign.id, contact.id, contact.telefono, contact.nombre]
      );
    }

    res.status(201).json({ success: true, data: campaign });
  } catch (err) {
    console.error('[Campaigns] POST error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/campaigns/:id — eliminar una campaña (solo si no está en running)
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'ID inválido' });

  try {
    const check = await query("SELECT status FROM campaigns WHERE id = $1", [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Campaña no encontrada' });
    }
    if (check.rows[0].status === 'running') {
      return res.status(400).json({
        success: false,
        error: 'No se puede eliminar una campaña en ejecución',
      });
    }

    await query('DELETE FROM campaigns WHERE id = $1', [id]);
    res.json({ success: true, data: { deleted: id } });
  } catch (err) {
    console.error('[Campaigns] DELETE error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
