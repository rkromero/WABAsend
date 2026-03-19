/**
 * Rutas de productos sincronizados desde WooCommerce
 * Autor: Turnio
 * Fecha: 2026-03-19
 */

import { Router } from 'express';
import axios from 'axios';
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
    // Construimos dos where clauses separados:
    // - dataWhere: para la query principal ($1=limit, $2=offset, $3=search)
    // - countWhere: para el conteo ($1=search) — no lleva limit/offset
    let dataWhere  = 'WHERE activo = true';
    let countWhere = 'WHERE activo = true';
    const dataParams  = [limit, offset];
    const countParams = [];

    if (search) {
      dataWhere  += ` AND (nombre ILIKE $3 OR descripcion_vision ILIKE $3 OR categorias ILIKE $3)`;
      countWhere += ` AND (nombre ILIKE $1 OR descripcion_vision ILIKE $1 OR categorias ILIKE $1)`;
      dataParams.push(`%${search}%`);
      countParams.push(`%${search}%`);
    }

    const [dataResult, countResult] = await Promise.all([
      query(
        `SELECT id, woo_id, nombre, descripcion_vision, precio, precio_oferta,
                stock, variantes, categorias, imagen_url, permalink, vision_generado_at, updated_at
         FROM waba_products
         ${dataWhere}
         ORDER BY updated_at DESC
         LIMIT $1 OFFSET $2`,
        dataParams
      ),
      query(
        `SELECT COUNT(*) as total FROM waba_products ${countWhere}`,
        countParams
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

// GET /api/products/db-check — cuántos productos tienen imagen_url en la DB
router.get('/db-check', async (req, res) => {
  try {
    const result = await query(`
      SELECT
        COUNT(*)                                     AS total,
        COUNT(*) FILTER (WHERE imagen_url IS NOT NULL) AS con_imagen,
        COUNT(*) FILTER (WHERE imagen_url IS NULL)     AS sin_imagen,
        COUNT(*) FILTER (WHERE descripcion_vision IS NOT NULL) AS con_vision
      FROM waba_products WHERE activo = true
    `);
    // Mostrar también un ejemplo de producto con y sin imagen
    const ejemplo = await query(`
      SELECT woo_id, nombre, imagen_url, tipo
      FROM waba_products
      WHERE activo = true
      LIMIT 3
    `);
    res.json({ success: true, data: { stats: result.rows[0], ejemplos: ejemplo.rows } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/products/woo-debug — inspecciona la respuesta cruda de WooCommerce para 1 producto
// Útil para diagnosticar la estructura de campos image/images
router.get('/woo-debug', async (req, res) => {
  const url    = process.env.WOOCOMMERCE_URL;
  const key    = process.env.WOOCOMMERCE_KEY;
  const secret = process.env.WOOCOMMERCE_SECRET;

  if (!url || !key || !secret) {
    return res.status(400).json({ success: false, error: 'Variables de WooCommerce no configuradas' });
  }

  try {
    const client = axios.create({
      baseURL: `${url.replace(/\/$/, '')}/wp-json/wc/v3`,
      auth: { username: key, password: secret },
      timeout: 15000,
    });

    // Traer 1 producto de cada tipo para ver la estructura real
    const [simpleRes, variableRes] = await Promise.all([
      client.get('/products', { params: { status: 'publish', per_page: 1, type: 'simple' } }),
      client.get('/products', { params: { status: 'publish', per_page: 1, type: 'variable' } }),
    ]);

    const simple   = simpleRes.data?.[0];
    const variable = variableRes.data?.[0];

    // Extraer solo los campos relevantes para el diagnóstico
    const extract = (p) => p ? {
      id: p.id,
      name: p.name,
      type: p.type,
      images_count: p.images?.length ?? 'campo inexistente',
      images_0_src: p.images?.[0]?.src ?? null,
      image_src: p.image?.src ?? null,         // campo singular (variantes)
      stock_status: p.stock_status,
      stock_quantity: p.stock_quantity,
      catalog_visibility: p.catalog_visibility, // 'visible'|'catalog'|'search'|'hidden'
      status: p.status,
    } : null;

    res.json({
      success: true,
      data: {
        simple:   extract(simple),
        variable: extract(variable),
      },
    });
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
