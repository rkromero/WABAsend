/**
 * Servicio de sincronización con WooCommerce
 * Autor: Turnio
 * Fecha: 2026-03-19
 * Dependencias: axios, openai, pg
 *
 * Flujo:
 *  1. Llama a la API REST de WooCommerce y trae todos los productos en stock.
 *  2. Para cada producto nuevo o con imagen cambiada, usa GPT-4o Vision para
 *     generar una descripción enriquecida en español (color, material, estilo, etc.)
 *  3. Guarda / actualiza en la tabla waba_products.
 *
 * Solo se llama a Vision cuando el producto es nuevo o cambió su imagen,
 * para minimizar el costo de la API.
 */

import axios from 'axios';
import OpenAI from 'openai';
import { query } from '../db/index.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Devuelve un cliente axios preconfigurado para la API de WooCommerce.
 * Usa autenticación Basic (Consumer Key + Secret).
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
 * Trae todos los productos de WooCommerce con stock disponible (status=publish).
 * Maneja paginación automáticamente (WooCommerce devuelve máximo 100 por página).
 *
 * @returns {Promise<Array>} Lista completa de productos
 */
async function fetchAllProducts() {
  const client = getWooClient();
  const products = [];
  let page = 1;

  while (true) {
    const response = await client.get('/products', {
      params: {
        status: 'publish',
        per_page: 100,
        page,
        // Traer solo productos con stock (in_stock o managed)
        stock_status: 'instock',
      },
    });

    const batch = response.data;
    if (!Array.isArray(batch) || batch.length === 0) break;

    products.push(...batch);

    // Si devolvió menos de 100, llegamos al final
    if (batch.length < 100) break;
    page++;
  }

  console.log(`[WooCommerce] ${products.length} productos en stock encontrados`);
  return products;
}

/**
 * Usa GPT-4o Vision para analizar la imagen principal de un producto y generar
 * una descripción enriquecida con colores, materiales, estilo y detalles visuales.
 *
 * Esta descripción es la que el bot usa para buscar por keywords y responder consultas.
 *
 * @param {string} imageUrl   - URL de la imagen del producto
 * @param {string} nombre     - Nombre del producto (contexto adicional para Vision)
 * @param {string} categoria  - Categoría del producto
 * @returns {Promise<string>} Descripción generada por Vision
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
              image_url: { url: imageUrl, detail: 'low' }, // 'low' = menor costo
            },
          ],
        },
      ],
      max_tokens: 200,
    });

    return response.choices[0]?.message?.content?.trim() || `Producto: ${nombre}`;
  } catch (err) {
    // Si Vision falla (imagen inaccesible, etc.), usamos el nombre como fallback
    console.warn(`[WooCommerce] Vision falló para "${nombre}": ${err.message}`);
    return `Producto: ${nombre}. Categoría: ${categoria || 'Sin categoría'}.`;
  }
}

/**
 * Sincroniza los productos de WooCommerce con la tabla waba_products.
 *
 * Lógica de actualización:
 *  - Producto nuevo → INSERT + generar descripción Vision
 *  - Producto existente con imagen cambiada → UPDATE + regenerar descripción Vision
 *  - Producto existente sin cambios → UPDATE solo precio/stock (sin llamar Vision)
 *  - Producto que ya no está en WooCommerce → marcar como inactivo
 *
 * @returns {Promise<{inserted: number, updated: number, visionCalls: number}>}
 */
export async function syncProducts() {
  console.log('[WooCommerce] Iniciando sincronización de productos...');

  let inserted = 0;
  let updated = 0;
  let visionCalls = 0;

  // 1. Traer productos de WooCommerce
  const wooProducts = await fetchAllProducts();
  const wooIds = wooProducts.map((p) => p.id);

  // 2. Marcar como inactivos los productos que ya no están en WooCommerce
  if (wooIds.length > 0) {
    await query(
      `UPDATE waba_products SET activo = false, updated_at = NOW()
       WHERE woo_id != ALL($1::int[]) AND activo = true`,
      [wooIds]
    );
  }

  // 3. Procesar cada producto
  for (const woo of wooProducts) {
    const nombre     = woo.name || 'Sin nombre';
    const precio     = parseFloat(woo.price) || 0;
    const precioOferta = woo.sale_price ? parseFloat(woo.sale_price) : null;
    const stock      = woo.stock_quantity ?? (woo.in_stock ? 1 : 0);
    const categorias = (woo.categories || []).map((c) => c.name).join(', ');
    const imagenUrl  = woo.images?.[0]?.src || null;
    const permalink  = woo.permalink || null;

    // Ver si el producto ya existe en nuestra DB
    const existing = await query(
      'SELECT id, imagen_url, vision_generado_at FROM waba_products WHERE woo_id = $1',
      [woo.id]
    );

    const imageChanged = existing.rows.length > 0 &&
      existing.rows[0].imagen_url !== imagenUrl;

    const isNew = existing.rows.length === 0;

    // Llamar a Vision solo para productos nuevos o con imagen cambiada
    let descripcionVision = existing.rows[0]?.descripcion_vision || null;
    if ((isNew || imageChanged) && imagenUrl) {
      console.log(`[WooCommerce] Generando descripción Vision para: "${nombre}"`);
      descripcionVision = await generateVisionDescription(imagenUrl, nombre, categorias);
      visionCalls++;

      // Pequeño delay para no saturar la API de OpenAI
      await new Promise((r) => setTimeout(r, 300));
    }

    if (isNew) {
      await query(
        `INSERT INTO waba_products
           (woo_id, nombre, descripcion_original, descripcion_vision,
            precio, precio_oferta, stock, categorias, imagen_url, permalink,
            activo, vision_generado_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, true, $11)`,
        [
          woo.id, nombre, woo.description || '', descripcionVision,
          precio, precioOferta, stock, categorias, imagenUrl, permalink,
          descripcionVision ? new Date() : null,
        ]
      );
      inserted++;
    } else {
      await query(
        `UPDATE waba_products
         SET nombre = $1,
             descripcion_original = $2,
             descripcion_vision = COALESCE($3, descripcion_vision),
             precio = $4,
             precio_oferta = $5,
             stock = $6,
             categorias = $7,
             imagen_url = $8,
             permalink = $9,
             activo = true,
             vision_generado_at = CASE WHEN $3 IS NOT NULL THEN NOW() ELSE vision_generado_at END,
             updated_at = NOW()
         WHERE woo_id = $10`,
        [
          nombre, woo.description || '', descripcionVision,
          precio, precioOferta, stock, categorias, imagenUrl, permalink,
          woo.id,
        ]
      );
      updated++;
    }
  }

  console.log(
    `[WooCommerce] Sync completada — Nuevos: ${inserted}, Actualizados: ${updated}, Llamadas Vision: ${visionCalls}`
  );

  return { inserted, updated, visionCalls };
}

/**
 * Busca productos relevantes en waba_products según las keywords del mensaje del usuario.
 * Usa búsqueda full-text en nombre, descripcion_vision y categorias.
 *
 * @param {string} mensaje - Mensaje del usuario
 * @param {number} limit   - Máximo de productos a devolver (default: 6)
 * @returns {Promise<Array>} Lista de productos relevantes
 */
export async function searchRelevantProducts(mensaje, limit = 6) {
  if (!mensaje || mensaje.trim().length === 0) return [];

  try {
    // Búsqueda con ILIKE en múltiples campos.
    // Dividimos el mensaje en palabras y buscamos cada una.
    // Palabras de más de 3 letras para evitar ruido ("de", "la", "un", etc.)
    const words = mensaje
      .toLowerCase()
      .replace(/[^a-záéíóúüñ\s]/gi, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3);

    if (words.length === 0) {
      // Si no hay keywords útiles, devolver productos destacados
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

    // Construir condición OR para cada palabra en cada columna
    const conditions = words.map((_, i) => `
      (nombre           ILIKE $${i + 2}
    OR descripcion_vision ILIKE $${i + 2}
    OR categorias       ILIKE $${i + 2})
    `).join(' OR ');

    const params = [limit, ...words.map((w) => `%${w}%`)];

    const result = await query(
      `SELECT nombre, descripcion_vision, precio, precio_oferta, stock, categorias, permalink, imagen_url
       FROM waba_products
       WHERE activo = true AND stock > 0 AND (${conditions})
       ORDER BY
         -- Priorizar coincidencias en el nombre
         (nombre ILIKE $2) DESC,
         updated_at DESC
       LIMIT $1`,
      params
    );

    return result.rows;
  } catch (err) {
    console.error('[WooCommerce] Error en búsqueda de productos:', err.message);
    return [];
  }
}
