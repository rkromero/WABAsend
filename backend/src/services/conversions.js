/**
 * Servicio de tracking de conversiones
 * Autor: Turnio
 * Fecha: 2026-03-19
 *
 * Cruza los emails de los destinatarios de una campaña contra las órdenes
 * de WooCommerce en una ventana de tiempo para detectar compras atribuibles.
 *
 * Usado tanto por el endpoint manual /:id/check-conversions
 * como por el cron nocturno que verifica todas las campañas activas.
 */

import { query } from '../db/index.js';
import { fetchOrdersByDateRange } from './woocommerce.js';

const DEFAULT_ATTRIBUTION_DAYS = 30;

/**
 * Verifica conversiones para UNA campaña específica.
 * Busca órdenes de WooCommerce en la ventana de atribución cuyos
 * billing_email coincidan con los destinatarios de la campaña.
 *
 * @param {number} campaignId
 * @param {number} attributionDays - Ventana en días desde el envío (default: 30)
 * @returns {Promise<{
 *   campaign_id: number,
 *   total_conversions: number,
 *   total_revenue: number,
 *   emails_with_data: number,
 *   conversion_rate: string,
 *   new_conversions: number
 * }>}
 */
export async function checkCampaignConversions(campaignId, attributionDays = DEFAULT_ATTRIBUTION_DAYS) {
  // 1. Obtener la campaña
  const campaignResult = await query(
    'SELECT id, nombre, scheduled_at, total_contacts FROM waba_campaigns WHERE id = $1',
    [campaignId]
  );
  if (campaignResult.rows.length === 0) {
    throw new Error(`Campaña ${campaignId} no encontrada`);
  }
  const campaign = campaignResult.rows[0];

  // 2. Obtener emails únicos de los destinatarios
  const logsResult = await query(
    `SELECT DISTINCT email FROM waba_message_logs
     WHERE campaign_id = $1 AND email IS NOT NULL AND email != ''`,
    [campaignId]
  );

  const campaignEmails = new Set(logsResult.rows.map((r) => r.email.toLowerCase()));

  if (campaignEmails.size === 0) {
    return {
      campaign_id:       campaignId,
      campaign_nombre:   campaign.nombre,
      total_conversions: 0,
      total_revenue:     0,
      emails_with_data:  0,
      conversion_rate:   '0.0',
      new_conversions:   0,
      skipped:           true,
      reason:            'Sin emails en los destinatarios',
    };
  }

  // 3. Rango de fechas: desde el envío hasta N días después
  const after  = new Date(campaign.scheduled_at);
  const before = new Date(after.getTime() + attributionDays * 24 * 60 * 60 * 1000);

  // No buscar en el futuro (evita llamadas innecesarias a WooCommerce)
  const now = new Date();
  if (after > now) {
    return {
      campaign_id:       campaignId,
      campaign_nombre:   campaign.nombre,
      total_conversions: 0,
      total_revenue:     0,
      emails_with_data:  campaignEmails.size,
      conversion_rate:   '0.0',
      new_conversions:   0,
      skipped:           true,
      reason:            'La campaña aún no fue enviada',
    };
  }

  const effectiveBefore = before > now ? now : before;

  console.log(`[Conversions] Campaña ${campaignId} "${campaign.nombre}" — emails: ${campaignEmails.size}, rango: ${after.toISOString().split('T')[0]} → ${effectiveBefore.toISOString().split('T')[0]}`);

  // 4. Traer órdenes del período desde WooCommerce
  const orders = await fetchOrdersByDateRange(after, effectiveBefore);

  // 5. Filtrar las que coincidan con emails de la campaña
  const matched = orders.filter((o) => campaignEmails.has(o.billing_email));

  // 6. Guardar las conversiones nuevas (ON CONFLICT DO NOTHING evita duplicados)
  let newConversions = 0;
  for (const order of matched) {
    const result = await query(
      `INSERT INTO waba_conversions (campaign_id, email, woo_order_id, order_amount, order_date)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (campaign_id, woo_order_id) DO NOTHING`,
      [campaignId, order.billing_email, order.id, order.total, new Date(order.date_created)]
    );
    if (result.rowCount > 0) newConversions++;
  }

  const totalRevenue = matched.reduce((sum, o) => sum + o.total, 0);
  const conversionRate = campaignEmails.size > 0
    ? ((matched.length / campaignEmails.size) * 100).toFixed(1)
    : '0.0';

  return {
    campaign_id:       campaignId,
    campaign_nombre:   campaign.nombre,
    total_conversions: matched.length,
    total_revenue:     totalRevenue,
    emails_with_data:  campaignEmails.size,
    total_contacts:    campaign.total_contacts,
    conversion_rate:   conversionRate,
    new_conversions:   newConversions,
    orders_in_period:  orders.length,
    skipped:           false,
  };
}

/**
 * Verifica conversiones para TODAS las campañas completadas
 * en los últimos `lookbackDays` días.
 * Llamado por el cron nocturno y por el botón "Verificar todas".
 *
 * @param {number} attributionDays - Ventana de atribución por campaña (default: 30)
 * @param {number} lookbackDays    - Cuántos días hacia atrás buscar campañas (default: 60)
 * @returns {Promise<Object>}
 */
export async function checkAllCampaignsConversions(attributionDays = DEFAULT_ATTRIBUTION_DAYS, lookbackDays = 60) {
  if (!process.env.WOOCOMMERCE_URL) {
    console.warn('[Conversions] WOOCOMMERCE_URL no definida — verificación omitida');
    return { skipped: true, reason: 'WooCommerce no configurado' };
  }

  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  // Traer campañas completadas o en ejecución recientes que tengan destinatarios con email
  const campaignsResult = await query(
    `SELECT DISTINCT c.id
     FROM waba_campaigns c
     JOIN waba_message_logs ml ON ml.campaign_id = c.id
     WHERE c.status IN ('completed', 'running')
       AND c.scheduled_at >= $1
       AND ml.email IS NOT NULL
     ORDER BY c.id`,
    [cutoff]
  );

  const campaignIds = campaignsResult.rows.map((r) => r.id);

  if (campaignIds.length === 0) {
    console.log('[Conversions] No hay campañas con emails para verificar');
    return { campaigns_checked: 0, total_new_conversions: 0 };
  }

  console.log(`[Conversions] Verificando ${campaignIds.length} campaña(s)...`);

  let totalNewConversions = 0;
  let totalRevenue = 0;
  const results = [];

  for (const id of campaignIds) {
    try {
      const result = await checkCampaignConversions(id, attributionDays);
      results.push(result);
      if (!result.skipped) {
        totalNewConversions += result.new_conversions;
        totalRevenue += result.total_revenue;
      }
    } catch (err) {
      console.error(`[Conversions] Error en campaña ${id}:`, err.message);
      results.push({ campaign_id: id, skipped: true, reason: err.message });
    }
  }

  console.log(`[Conversions] Check completo — ${totalNewConversions} conversiones nuevas, $${totalRevenue} revenue`);

  return {
    campaigns_checked:    campaignIds.length,
    total_new_conversions: totalNewConversions,
    total_revenue:        totalRevenue,
    results,
  };
}
