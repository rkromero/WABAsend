/**
 * Servicio de sincronización con WooCommerce
 * Autor: Turnio
 * Fecha: 2026-03-19
 * Dependencias: axios, openai, pg
 *
 * Modos de sync:
 *  - Full sync  : trae todos los productos (primera ejecución o sync manual forzada)
 *  - Delta sync : trae solo productos modificados desde la última sync exitosa
 *                 usando el parámetro `modified_after` de la API de WooCommerce
 *
 * La última sync se guarda en la tabla config con la clave WOOCOMMERCE_LAST_SYNC.
 * Vision solo se llama para productos nuevos o con imagen cambiada.
 */

import axios from 'axios';
import OpenAI from 'openai';
import { query } from '../db/index.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Devuelve un cliente axios preconfigurado para la API de WooCommerce.
 */
function getWooClient() {
  const url    = process.env.WOOCOMMERCE_URL;
  const key    = process.env.WOOCOMMERCE_KEY;
  const secret = process.env.WOOCOMMERCE_SECRET;

  if (!url || !key || !secret) {
    throw new Error('Faltan variables de entorno: WOOCOMMERCE_URL, WOOCOMMERCE_KEY, WOOCOMMERCE_SECRET');
  }

  return axios.create({
    baseURL: `${url.replace(/\/$/, '')}/wp-json/wc/v3`,
    auth: { username: key, password: secret },
    timeout: 30000,
  });
}

/**
 * Lee la fecha de la última sync exitosa desde la tabla config.
 * Devuelve null si nunca se sincronizó (dispara full sync).
 *
 * @returns {Promise<Date|null>}
 */
async function getLastSyncDate() {
  const result = await query(
    "SELECT value FROM config WHERE key = 'WOOCOMMERCE_LAST_SYNC'"
  );
  if (result.rows.length === 0) return null;
  const d = new Date(result.rows[0].value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Guarda la fecha de sync exitosa en la tabla config.
 *
 * @param {Date} date
 */
async function saveLastSyncDate(date) {
  await query(
    `INSERT INTO config (key, value, updated_at)
     VALUES ('WOOCOMMERCE_LAST_SYNC', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
    [date.toISOString()]
  );
}

/**
 * Trae productos de WooCommerce con paginación automática.
 * Si se pasa `modifiedAfter`, solo trae los modificados desde esa fecha (delta).
 * Si no, trae todos los publicados con stock (full sync).
 *
 * @param {Date|null} modifiedAfter - Fecha desde la cual buscar cambios (null = todo)
 * @returns {Promise<Array>}
 */
async function fetchProducts(modifiedAfter = null) {
  const client = getWooClient();
  const products = [];
  let page = 1;

  const baseParams = {
    status: 'publish',
    per_page: 100,
    // Ordenar por fecha de modificación descendente para delta eficiente
    orderby: 'modified',
    order: 'desc',
  };

  // En full sync filtramos solo los que tienen stock para no procesar lo que no vamos a vender
  if (!modifiedAfter) {
    baseParams.stock_status = 'instock';
  }

  // En delta, WooCommerce acepta modified_after en formato ISO 8601
  if (modifiedAfter) {
    baseParams.modified_after = modifiedAfter.toISOString();
  }

  while (true) {
    const response = await client.get('/products', {
      params: { ...baseParams, page },
    });

    const batch = response.data;
    if (!Array.isArray(batch) || batch.length === 0) break;

    products.push(...batch);
    if (batch.length < 100) break;
    page++;
  }

  const mode = modifiedAfter ? `delta (desde ${modifiedAfter.toISOString()})` : 'full';
  console.log(`[WooCommerce] Fetch ${mode} — ${products.length} producto(s) recibidos`);
  return products;
}

/**
 * Usa GPT-4o Vision para analizar la imagen principal del producto y generar
 * una descripción enriquecida en español con colores, materiales y detalles visuales.
 * Solo se llama para productos nuevos o con imagen cambiada.
 *
 * @param {string} imageUrl
 * @param {string} nombre
 * @param {string} categoria
 * @returns {Promise<string>}
 */
async function generateVisionDescription(imageUrl, nombre, categoria) {
  if (!imageUrl) {
    return `Producto: ${nombre}. Categoría: ${categoria || 'Sin categoría'}.`;
  }

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analizá esta imagen de producto de indumentaria/moda de la tienda online "${nombre}" (categoría: ${categoria || 'sin especificar'}).

Generá una descripción detallada en español con las siguientes características visibles:
- Tipo exacto de prenda
- Colores y tonos (sé específico: "azul marino", "verde menta", "blanco hueso")
- Material o textura visible (jean, lino, algodón, punto, etc.)
- Estilo (casual, formal, deportivo, elegante, bohemio, etc.)
- Detalles de diseño (tipo de manga, cuello, escote, estampado, bordado, etc.)
- Ocasión de uso sugerida

Escribí la descripción en una sola línea de texto fluido, con keywords que un cliente usaría para buscar este producto. No uses viñetas ni saltos de línea.`,
            },
            {
              type: 'image_url',
              image_url: { url: imageUrl, detail: 'low' }, // 'low' minimiza el costo
            },
          ],
        },
      ],
      max_tokens: 200,
    });

    return response.choices[0]?.message?.content?.trim() || `Producto: ${nombre}`;
  } catch (err) {
    console.warn(`[WooCommerce] Vision falló para "${nombre}": ${err.message}`);
    return `Producto: ${nombre}. Categoría: ${categoria || 'Sin categoría'}.`;
  }
}

/**
 * Sincroniza productos de WooCommerce con la tabla waba_products.
 *
 * Lógica delta:
 *  - Si existe WOOCOMMERCE_LAST_SYNC en config → fetch solo modificados desde esa fecha
 *  - Si no existe (primera vez) → fetch completo
 *  - Vision solo se llama para productos nuevos o con imagen cambiada
 *  - Al finalizar exitosamente, guarda la fecha de inicio del proceso como nuevo checkpoint
 *
 * @param {boolean} forceFullSync - Si true, ignora el delta y hace sync completa
 * @returns {Promise<{inserted: number, updated: number, visionCalls: number, mode: string}>}
 */
export async function syncProducts(forceFullSync = false) {
  // Guardamos la fecha de INICIO del proceso como próximo checkpoint.
  // Así no perdemos productos que se modifiquen durante la ejecución.
  const syncStartedAt = new Date();

  const lastSync = forceFullSync ? null : await getLastSyncDate();
  const mode = lastSync ? 'delta' : 'full';

  console.log(`[WooCommerce] Iniciando sync ${mode}${lastSync ? ` (desde ${lastSync.toISOString()})` : ''}`);

  let inserted = 0;
  let updated  = 0;
  let visionCalls = 0;

  // 1. Traer productos de WooCommerce (todos o solo los modificados)
  const wooProducts = await fetchProducts(lastSync);

  if (wooProducts.length === 0) {
    console.log('[WooCommerce] Sin cambios desde la última sync — nada que hacer');
    await saveLastSyncDate(syncStartedAt);
    return { inserted: 0, updated: 0, visionCalls: 0, mode };
  }

  // 2. En full sync: marcar como inactivos los que ya no están en WooCommerce
  //    En delta: no tocamos los no incluidos (pueden ser simplemente no modificados)
  if (!lastSync) {
    const wooIds = wooProducts.map((p) => p.id);
    await query(
      `UPDATE waba_products SET activo = false, updated_at = NOW()
       WHERE woo_id != ALL($1::int[]) AND activo = true`,
      [wooIds]
    );
  }

  // 3. Procesar cada producto del batch
  for (const woo of wooProducts) {
    const nombre       = woo.name || 'Sin nombre';
    const precio       = parseFloat(woo.price) || 0;
    const precioOferta = woo.sale_price ? parseFloat(woo.sale_price) : null;
    const stock        = woo.stock_quantity ?? (woo.in_stock ? 1 : 0);
    const categorias   = (woo.categories || []).map((c) => c.name).join(', ');
    const imagenUrl    = woo.images?.[0]?.src || null;
    const permalink    = woo.permalink || null;
    // En delta pueden venir productos sin stock (recién agotados) → los marcamos inactivos
    const activo       = woo.status === 'publish' && (woo.stock_status === 'instock' || stock > 0);

    // Ver si el producto ya existe en nuestra DB
    const existing = await query(
      'SELECT id, imagen_url, descripcion_vision FROM waba_products WHERE woo_id = $1',
      [woo.id]
    );

    const isNew          = existing.rows.length === 0;
    const imageChanged   = !isNew && existing.rows[0].imagen_url !== imagenUrl;
    // Vision solo si el producto tiene stock — no procesamos imágenes de productos agotados
    const needsVision    = (isNew || imageChanged) && imagenUrl && activo;

    // Llamar a Vision solo si es necesario
    let descripcionVision = existing.rows[0]?.descripcion_vision || null;
    if (needsVision) {
      console.log(`[WooCommerce] Vision → "${nombre}"`);
      descripcionVision = await generateVisionDescription(imagenUrl, nombre, categorias);
      visionCalls++;
      // Delay mínimo entre llamadas a Vision para respetar rate limits de OpenAI
      await new Promise((r) => setTimeout(r, 300));
    }

    if (isNew) {
      await query(
        `INSERT INTO waba_products
           (woo_id, nombre, descripcion_original, descripcion_vision,
            precio, precio_oferta, stock, categorias, imagen_url, permalink,
            activo, vision_generado_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          woo.id, nombre, woo.description || '', descripcionVision,
          precio, precioOferta, stock, categorias, imagenUrl, permalink,
          activo, descripcionVision ? new Date() : null,
        ]
      );
      inserted++;
    } else {
      await query(
        `UPDATE waba_products
         SET nombre             = $1,
             descripcion_original = $2,
             descripcion_vision = COALESCE($3, descripcion_vision),
             precio             = $4,
             precio_oferta      = $5,
             stock              = $6,
             categorias         = $7,
             imagen_url         = $8,
             permalink          = $9,
             activo             = $10,
             vision_generado_at = CASE WHEN $3 IS NOT NULL THEN NOW() ELSE vision_generado_at END,
             updated_at         = NOW()
         WHERE woo_id = $11`,
        [
          nombre, woo.description || '', descripcionVision,
          precio, precioOferta, stock, categorias, imagenUrl, permalink,
          activo, woo.id,
        ]
      );
      updated++;
    }
  }

  // 4. Guardar checkpoint de sync exitosa
  await saveLastSyncDate(syncStartedAt);

  console.log(
    `[WooCommerce] Sync ${mode} completada — Nuevos: ${inserted}, Actualizados: ${updated}, Vision: ${visionCalls}`
  );

  return { inserted, updated, visionCalls, mode };
}

/**
 * Busca productos relevantes en waba_products según las keywords del mensaje del usuario.
 * Busca en nombre, descripcion_vision y categorias.
 *
 * @param {string} mensaje - Mensaje del usuario
 * @param {number} limit   - Máximo de productos a devolver
 * @returns {Promise<Array>}
 */
export async function searchRelevantProducts(mensaje, limit = 6) {
  if (!mensaje || mensaje.trim().length === 0) return [];

  try {
    const words = mensaje
      .toLowerCase()
      .replace(/[^a-záéíóúüñ\s]/gi, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3);

    if (words.length === 0) {
      // Sin keywords útiles → devolver productos recientes como sugerencia
      const fallback = await query(
        `SELECT nombre, descripcion_vision, precio, precio_oferta, stock, categorias, permalink, imagen_url
         FROM waba_products
         WHERE activo = true AND stock > 0
         ORDER BY updated_at DESC
         LIMIT $1`,
        [limit]
      );
      return fallback.rows;
    }

    const conditions = words.map((_, i) => `
      (nombre            ILIKE $${i + 2}
    OR descripcion_vision ILIKE $${i + 2}
    OR categorias        ILIKE $${i + 2})
    `).join(' OR ');

    const params = [limit, ...words.map((w) => `%${w}%`)];

    const result = await query(
      `SELECT nombre, descripcion_vision, precio, precio_oferta, stock, categorias, permalink, imagen_url
       FROM waba_products
       WHERE activo = true AND stock > 0 AND (${conditions})
       ORDER BY (nombre ILIKE $2) DESC, updated_at DESC
       LIMIT $1`,
      params
    );

    return result.rows;
  } catch (err) {
    console.error('[WooCommerce] Error en búsqueda de productos:', err.message);
    return [];
  }
}
