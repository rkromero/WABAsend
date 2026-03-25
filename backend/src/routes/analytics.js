/**
 * Rutas de analytics avanzados
 * Autor: Turnio
 * Fecha: 2026-03-25
 *
 * Tres endpoints:
 * - GET /api/analytics/overview  → funnel global del período (enviados → compra)
 * - GET /api/analytics/campaigns → métricas por campaña, incluye "respondieron"
 * - GET /api/analytics/revenue   → revenue mensual de los últimos 6 meses
 *
 * "Respondieron" = al menos 1 mensaje entrante del contacto
 *   en las 48 horas siguientes al envío de la campaña.
 */

import { Router } from 'express';
import { query } from '../db/index.js';

const router = Router();

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Convierte un string de período en una cláusula WHERE sobre sent_at / scheduled_at */
function buildDateFilter(desde, hasta, column = 'c.scheduled_at') {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (desde) {
    conditions.push(`${column} >= $${idx++}`);
    params.push(new Date(desde));
  }
  if (hasta) {
    conditions.push(`${column} <= $${idx++}`);
    params.push(new Date(hasta));
  }

  return {
    where: conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '',
    params,
  };
}

/** Calcula porcentaje con 1 decimal, devuelve null si el denominador es 0 */
function pct(num, den) {
  if (!den || den === 0) return null;
  return parseFloat(((num / den) * 100).toFixed(1));
}

// ─── GET /api/analytics/overview ─────────────────────────────────────────────

/**
 * Funnel global del período.
 * Query params: desde (ISO date), hasta (ISO date)
 * Defaults: últimos 30 días si no se especifica rango.
 */
router.get('/overview', async (req, res) => {
  try {
    const desde = req.query.desde || null;
    const hasta = req.query.hasta || null;

    // Si no hay rango, tomar los últimos 30 días
    const defaultDesde = desde
      ? new Date(desde)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const defaultHasta = hasta ? new Date(hasta) : new Date();

    const [funnelRes, convRes] = await Promise.all([
      // Funnel: filtrar por c.scheduled_at (nunca NULL) en lugar de ml.sent_at (puede ser NULL).
      // Para la ventana de 48h del "respondieron" usamos COALESCE(ml.sent_at, c.scheduled_at).
      query(
        `SELECT
           COUNT(*)                                          AS enviados,
           COUNT(*) FILTER (WHERE ml.status = 'delivered')  AS entregados,
           COUNT(*) FILTER (WHERE ml.status = 'read')       AS leidos,
           COUNT(DISTINCT im.telefono)                      AS respondieron
         FROM waba_campaigns c
         JOIN waba_message_logs ml ON ml.campaign_id = c.id
         LEFT JOIN incoming_messages im
           ON im.telefono = ml.telefono
          AND im.created_at >= COALESCE(ml.sent_at, c.scheduled_at)
          AND im.created_at <= COALESCE(ml.sent_at, c.scheduled_at) + INTERVAL '48 hours'
         WHERE c.scheduled_at >= $1 AND c.scheduled_at <= $2
           AND ml.status != 'failed'`,
        [defaultDesde, defaultHasta]
      ),
      // Conversiones del mismo período (por fecha del pedido)
      query(
        `SELECT
           COUNT(*)          AS conversiones,
           COALESCE(SUM(order_amount), 0) AS revenue
         FROM waba_conversions
         WHERE order_date >= $1 AND order_date <= $2`,
        [defaultDesde, defaultHasta]
      ),
    ]);

    const f = funnelRes.rows[0];
    const c = convRes.rows[0];

    const enviados     = parseInt(f.enviados) || 0;
    const entregados   = parseInt(f.entregados) || 0;
    const leidos       = parseInt(f.leidos) || 0;
    const respondieron = parseInt(f.respondieron) || 0;
    const conversiones = parseInt(c.conversiones) || 0;
    const revenue      = parseFloat(c.revenue) || 0;

    res.json({
      success: true,
      data: {
        enviados,
        entregados,
        leidos,
        respondieron,
        conversiones,
        revenue,
        tasa_entrega:    pct(entregados, enviados),
        tasa_lectura:    pct(leidos, enviados),
        tasa_respuesta:  pct(respondieron, enviados),
        tasa_conversion: pct(conversiones, enviados),
        desde: defaultDesde.toISOString(),
        hasta: defaultHasta.toISOString(),
      },
    });
  } catch (err) {
    console.error('[Analytics] Overview error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/analytics/campaigns ────────────────────────────────────────────

/**
 * Lista de campañas con métricas detalladas, incluyendo cuántos respondieron.
 * Query params: limit (default 50)
 */
router.get('/campaigns', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    const result = await query(
      `SELECT
         c.id,
         c.nombre,
         c.template_name,
         c.scheduled_at,
         c.status,
         c.total_contacts,
         c.sent_count,
         c.delivered_count,
         c.read_count,
         c.failed_count,
         COUNT(DISTINCT im.telefono)                      AS replied_count,
         COALESCE(cv.conversions_count, 0)                AS conversions_count,
         COALESCE(cv.conversions_revenue, 0.0)            AS conversions_revenue
       FROM waba_campaigns c
       LEFT JOIN waba_message_logs ml
         ON ml.campaign_id = c.id
       LEFT JOIN incoming_messages im
         ON im.telefono = ml.telefono
        AND im.created_at >= COALESCE(ml.sent_at, c.scheduled_at)
        AND im.created_at <= COALESCE(ml.sent_at, c.scheduled_at) + INTERVAL '48 hours'
       LEFT JOIN (
         SELECT campaign_id,
                COUNT(*)          AS conversions_count,
                SUM(order_amount) AS conversions_revenue
           FROM waba_conversions
          GROUP BY campaign_id
       ) cv ON cv.campaign_id = c.id
       GROUP BY c.id, c.nombre, c.template_name, c.scheduled_at, c.status,
                c.total_contacts, c.sent_count, c.delivered_count, c.read_count,
                c.failed_count, cv.conversions_count, cv.conversions_revenue
       ORDER BY c.scheduled_at DESC
       LIMIT $1`,
      [limit]
    );

    // Calcular tasas por fila
    const rows = result.rows.map((row) => {
      const sent = parseInt(row.sent_count) || 0;
      return {
        ...row,
        sent_count:          sent,
        delivered_count:     parseInt(row.delivered_count) || 0,
        read_count:          parseInt(row.read_count) || 0,
        failed_count:        parseInt(row.failed_count) || 0,
        replied_count:       parseInt(row.replied_count) || 0,
        conversions_count:   parseInt(row.conversions_count) || 0,
        conversions_revenue: parseFloat(row.conversions_revenue) || 0,
        tasa_lectura:        pct(parseInt(row.read_count), sent),
        tasa_respuesta:      pct(parseInt(row.replied_count), sent),
        tasa_conversion:     pct(parseInt(row.conversions_count), sent),
      };
    });

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[Analytics] Campaigns error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/analytics/revenue ──────────────────────────────────────────────

/**
 * Revenue mensual de los últimos 6 meses, agrupado por mes.
 * Fuente: waba_conversions.order_date + order_amount
 */
router.get('/revenue', async (req, res) => {
  try {
    const result = await query(
      `SELECT
         TO_CHAR(DATE_TRUNC('month', order_date), 'YYYY-MM')  AS mes,
         COUNT(*)                                              AS conversiones,
         COALESCE(SUM(order_amount), 0)                        AS revenue
       FROM waba_conversions
       WHERE order_date >= NOW() - INTERVAL '6 months'
       GROUP BY DATE_TRUNC('month', order_date)
       ORDER BY DATE_TRUNC('month', order_date) ASC`
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[Analytics] Revenue error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
