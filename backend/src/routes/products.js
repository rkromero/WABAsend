/**
 * Rutas de productos sincronizados desde WooCommerce
 * Autor: Turnio
 * Fecha: 2026-03-19
 */

import { Router } from 'express';
import { query } from '../db/index.js';
import { syncProducts } from '../services/woocommerce.js';

const router = Router();

// GET /api/products — lista productos activos con stock
router.get('/', async (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const search = req.query.search ? String(req.query.search).trim() : '';
  const offset = (page - 1) * limit;

  try {
    let whereClause = 'WHERE activo = true';
    const params = [limit, offset];

    if (search) {
      whereClause += ` AND (nombre ILIKE $3 OR descripcion_vision ILIKE $3 OR categorias ILIKE $3)`;
      params.push(`%${search}%`);
    }

    const [dataResult, countResult] = await Promise.all([
      query(
        `SELECT id, woo_id, nombre, descripcion_vision, precio, precio_oferta,
                stock, categorias, imagen_url, permalink, vision_generado_at, updated_at
         FROM waba_products
         ${whereClause}
         ORDER BY updated_at DESC
         LIMIT $1 OFFSET $2`,
        params
      ),
      query(
        `SELECT COUNT(*) as total FROM waba_products ${whereClause}`,
        search ? [`%${search}%`] : []
      ),
    ]);

    res.json({
      success: true,
      data: {
        products: dataResult.rows,
        pagination: {
          page,
          limit,
          total: parseInt(countResult.rows[0].total),
          totalPages: Math.ceil(parseInt(countResult.rows[0].total) / limit),
        },
      },
    });
  } catch (err) {
    console.error('[Products] GET error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/products/stats — resumen del catálogo
router.get('/stats', async (req, res) => {
  try {
    const result = await query(`
      SELECT
        COUNT(*) FILTER (WHERE activo = true)             AS total_activos,
        COUNT(*) FILTER (WHERE activo = true AND stock > 0) AS con_stock,
        COUNT(*) FILTER (WHERE activo = true AND descripcion_vision IS NOT NULL) AS con_vision,
        COUNT(*) FILTER (WHERE activo = false)            AS inactivos
      FROM waba_products
    `);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/products/sync — forzar sync manual desde el panel
// Body opcional: { full: true } para ignorar el delta y sincronizar todo
router.post('/sync', async (req, res) => {
  if (!process.env.WOOCOMMERCE_URL) {
    return res.status(400).json({
      success: false,
      error: 'WOOCOMMERCE_URL no está configurada en las variables de entorno',
    });
  }

  const forceFullSync = req.body?.full === true;

  try {
    console.log(`[Products] Sync manual iniciada (${forceFullSync ? 'full' : 'delta'})`);
    const result = await syncProducts(forceFullSync);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[Products] Error en sync manual:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
