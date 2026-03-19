/**
 * Rutas de campañas
 * Autor: Turnio
 * Fecha: 2026-03-18
 *
 * Usa waba_campaigns y waba_message_logs para evitar colisión
 * con las tablas propias de Chatwoot en la misma base de datos.
 */

import { Router } from 'express';
import { query } from '../db/index.js';
import { fetchOrdersByDateRange } from '../services/woocommerce.js';

const router = Router();

// GET /api/campaigns — lista todas las campañas con sus conversiones
router.get('/', async (req, res) => {
  try {
    // JOIN con waba_conversions para incluir datos de conversión en el listado
    const result = await query(
      `SELECT c.id, c.nombre, c.template_name, c.template_language, c.scheduled_at, c.status,
              c.total_contacts, c.sent_count, c.delivered_count, c.read_count, c.failed_count,
              c.created_at,
              COALESCE(cv.conversions_count, 0)  AS conversions_count,
              COALESCE(cv.conversions_revenue, 0) AS conversions_revenue
       FROM waba_campaigns c
       LEFT JOIN (
         SELECT campaign_id,
                COUNT(*)          AS conversions_count,
                SUM(order_amount) AS conversions_revenue
         FROM waba_conversions
         GROUP BY campaign_id
       ) cv ON cv.campaign_id = c.id
       ORDER BY c.created_at DESC
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
    const [campaignsStats, messagesStats, conversionStats] = await Promise.all([
      query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'scheduled')  AS scheduled,
           COUNT(*) FILTER (WHERE status = 'running')    AS running,
           COUNT(*) FILTER (WHERE status = 'completed')  AS completed,
           COUNT(*) FILTER (WHERE status = 'failed')     AS failed,
           COUNT(*) AS total
         FROM waba_campaigns`
      ),
      query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'sent')      AS sent,
           COUNT(*) FILTER (WHERE status = 'delivered') AS delivered,
           COUNT(*) FILTER (WHERE status = 'read')      AS read,
           COUNT(*) FILTER (WHERE status = 'failed')    AS failed,
           COUNT(*) AS total
         FROM waba_message_logs`
      ),
      // Conversiones globales: % de emails únicos que compraron
      query(
        `SELECT
           COUNT(DISTINCT wc.email)                    AS total_conversions,
           COALESCE(SUM(wc.order_amount), 0)           AS total_revenue,
           COUNT(DISTINCT ml.email)
             FILTER (WHERE ml.email IS NOT NULL)       AS total_with_email
         FROM waba_message_logs ml
         LEFT JOIN waba_conversions wc ON wc.email = ml.email`
      ),
    ]);

    const cv = conversionStats.rows[0];
    const totalWithEmail   = parseInt(cv.total_with_email) || 0;
    const totalConversions = parseInt(cv.total_conversions) || 0;
    const conversionRate   = totalWithEmail > 0
      ? ((totalConversions / totalWithEmail) * 100).toFixed(1)
      : null; // null = aún no hay emails cargados

    res.json({
      success: true,
      data: {
        campaigns:  campaignsStats.rows[0],
        messages:   messagesStats.rows[0],
        conversions: {
          total_conversions: totalConversions,
          total_revenue:     parseFloat(cv.total_revenue),
          total_with_email:  totalWithEmail,
          conversion_rate:   conversionRate, // "12.5" o null
        },
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
      query('SELECT * FROM waba_campaigns WHERE id = $1', [id]),
      query(
        `SELECT id, nombre, telefono, status, whatsapp_message_id, error_message, sent_at, updated_at
         FROM waba_message_logs
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
      `SELECT id, nombre, telefono, email FROM waba_contacts WHERE id IN (${placeholders})`,
      contact_ids
    );

    if (contactsResult.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Ningún contacto encontrado con los IDs proporcionados' });
    }

    const contacts = contactsResult.rows;

    // Crear la campaña
    const campaignResult = await query(
      `INSERT INTO waba_campaigns (nombre, template_name, template_language, scheduled_at, total_contacts)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [nombre.trim(), template_name, template_language, scheduledDate, contacts.length]
    );

    const campaign = campaignResult.rows[0];

    // Crear un message_log por cada contacto
    for (const contact of contacts) {
      await query(
        `INSERT INTO waba_message_logs (campaign_id, contact_id, telefono, nombre, email, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')`,
        [campaign.id, contact.id, contact.telefono, contact.nombre, contact.email || null]
      );
    }

    res.status(201).json({ success: true, data: campaign });
  } catch (err) {
    console.error('[Campaigns] POST error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/campaigns/:id/conversions — obtener conversiones ya calculadas
router.get('/:id/conversions', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'ID inválido' });

  try {
    const [campaign, conversions] = await Promise.all([
      query('SELECT id, nombre, scheduled_at, total_contacts FROM waba_campaigns WHERE id = $1', [id]),
      query(
        `SELECT email, woo_order_id, order_amount, order_date
         FROM waba_conversions WHERE campaign_id = $1
         ORDER BY order_date DESC`,
        [id]
      ),
    ]);

    if (campaign.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Campaña no encontrada' });
    }

    const totalRevenue = conversions.rows.reduce((sum, r) => sum + parseFloat(r.order_amount || 0), 0);

    res.json({
      success: true,
      data: {
        campaign:          campaign.rows[0],
        conversions:       conversions.rows,
        total_conversions: conversions.rows.length,
        total_revenue:     totalRevenue,
      },
    });
  } catch (err) {
    console.error('[Campaigns] GET conversions error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/campaigns/:id/check-conversions — ejecutar matching de emails vs WooCommerce
// Query param: ?days=7 (ventana de atribución, default 30)
router.post('/:id/check-conversions', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'ID inválido' });

  if (!process.env.WOOCOMMERCE_URL) {
    return res.status(400).json({ success: false, error: 'WooCommerce no está configurado' });
  }

  const attributionDays = Math.min(90, Math.max(1, parseInt(req.query.days) || 30));

  try {
    // Obtener la campaña
    const campaignResult = await query(
      'SELECT id, nombre, scheduled_at, total_contacts FROM waba_campaigns WHERE id = $1',
      [id]
    );
    if (campaignResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Campaña no encontrada' });
    }
    const campaign = campaignResult.rows[0];

    // Obtener emails de los destinatarios (solo los que tienen email)
    const logsResult = await query(
      `SELECT DISTINCT email FROM waba_message_logs
       WHERE campaign_id = $1 AND email IS NOT NULL AND email != ''`,
      [id]
    );

    const campaignEmails = new Set(logsResult.rows.map((r) => r.email.toLowerCase()));

    if (campaignEmails.size === 0) {
      return res.json({
        success: true,
        data: {
          message:           'Ningún contacto de esta campaña tiene email registrado',
          total_conversions: 0,
          total_revenue:     0,
          attribution_days:  attributionDays,
        },
      });
    }

    // Rango de fechas: desde el envío hasta N días después
    const after  = new Date(campaign.scheduled_at);
    const before = new Date(after.getTime() + attributionDays * 24 * 60 * 60 * 1000);

    console.log(`[Campaigns] Buscando conversiones para campaña ${id} — emails: ${campaignEmails.size}, rango: ${after.toISOString()} → ${before.toISOString()}`);

    // Traer todas las órdenes del período y filtrar por email
    const orders = await fetchOrdersByDateRange(after, before);
    const matched = orders.filter((o) => campaignEmails.has(o.billing_email));

    // Guardar las conversiones nuevas (el UNIQUE evita duplicados)
    let saved = 0;
    for (const order of matched) {
      try {
        await query(
          `INSERT INTO waba_conversions (campaign_id, email, woo_order_id, order_amount, order_date)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (campaign_id, woo_order_id) DO NOTHING`,
          [id, order.billing_email, order.id, order.total, new Date(order.date_created)]
        );
        saved++;
      } catch {
        // Silencioso: el ON CONFLICT DO NOTHING ya maneja duplicados
      }
    }

    const totalRevenue = matched.reduce((sum, o) => sum + o.total, 0);

    console.log(`[Campaigns] Campaña ${id}: ${matched.length} conversiones encontradas, revenue: $${totalRevenue}`);

    res.json({
      success: true,
      data: {
        total_conversions:   matched.length,
        total_revenue:       totalRevenue,
        emails_with_data:    campaignEmails.size,
        total_contacts:      campaign.total_contacts,
        conversion_rate:     campaignEmails.size > 0
          ? ((matched.length / campaignEmails.size) * 100).toFixed(1)
          : '0.0',
        attribution_days:    attributionDays,
        orders_in_period:    orders.length,
        new_conversions:     saved,
      },
    });
  } catch (err) {
    console.error('[Campaigns] check-conversions error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/campaigns/:id — eliminar una campaña (solo si no está en running)
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ success: false, error: 'ID inválido' });

  try {
    const check = await query("SELECT status FROM waba_campaigns WHERE id = $1", [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Campaña no encontrada' });
    }
    if (check.rows[0].status === 'running') {
      return res.status(400).json({
        success: false,
        error: 'No se puede eliminar una campaña en ejecución',
      });
    }

    await query('DELETE FROM waba_campaigns WHERE id = $1', [id]);
    res.json({ success: true, data: { deleted: id } });
  } catch (err) {
    console.error('[Campaigns] DELETE error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
