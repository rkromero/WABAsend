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
 * Elimina etiquetas HTML y normaliza espacios.
 * Convierte tablas y listas en texto legible para que la IA pueda leerlo.
 *
 * @param {string} html
 * @returns {string}
 */
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')          // saltos de línea
    .replace(/<\/?(tr|li|p|div|h[1-6])[^>]*>/gi, '\n') // bloques → newline
    .replace(/<td[^>]*>/gi, ' | ')          // celdas de tabla → separador
    .replace(/<[^>]+>/g, '')                // resto de tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')             // máximo 2 newlines seguidos
    .trim();
}

/**
 * Para productos variables, obtiene las variantes con stock disponible.
 * WooCommerce guarda el stock por variante (talle/color), no en el producto padre.
 *
 * Devuelve:
 *  - stockTotal : suma de stock de todas las variantes disponibles
 *  - variantes  : string con los valores disponibles, ej: "L, M, XL"
 *
 * @param {number} productId - ID del producto padre en WooCommerce
 * @returns {Promise<{stockTotal: number, variantes: string}>}
 */
async function fetchVariations(productId) {
  try {
    const client = getWooClient();
    const response = await client.get(`/products/${productId}/variations`, {
      params: { per_page: 100, stock_status: 'instock' },
    });

    const variations = response.data || [];
    if (variations.length === 0) return { stockTotal: 0, variantes: '', imagenFallback: null };

    // Sumar stock de todas las variantes disponibles
    const stockTotal = variations.reduce((sum, v) => {
      return sum + (v.stock_quantity ?? (v.stock_status === 'instock' ? 1 : 0));
    }, 0);

    // Extraer los valores de atributos (talles, colores) de las variantes con stock
    // Cada variante tiene attributes: [{ name: 'Talle', option: 'L' }, ...]
    const valores = variations
      .filter((v) => v.stock_status === 'instock' || (v.stock_quantity ?? 0) > 0)
      .flatMap((v) => (v.attributes || []).map((a) => a.option))
      .filter(Boolean);

    // Eliminar duplicados y ordenar
    const unicos = [...new Set(valores)].join(', ');

    // Si alguna variante tiene imagen propia, la usamos como fallback para el padre
    // (algunos productos en WooCommerce tienen imágenes solo en las variantes)
    const imagenFallback = variations.find((v) => v.image?.src)?.image?.src || null;

    return { stockTotal, variantes: unicos, imagenFallback };
  } catch (err) {
    console.warn(`[WooCommerce] No se pudieron obtener variantes del producto ${productId}: ${err.message}`);
    return { stockTotal: 1, variantes: '', imagenFallback: null };
  }
}

/**
 * Detecta la categoría de prenda a partir del nombre y categorías del producto.
 * Usado para adaptar el prompt de Vision a los atributos relevantes de cada tipo.
 *
 * @param {string} nombre
 * @param {string} categorias
 * @returns {'parte_arriba'|'pantalon'|'vestido_falda'|'otro'}
 */
export function detectGarmentCategory(nombre, categorias) {
  const text = `${nombre} ${categorias}`.toLowerCase();
  if (/sweater|remera|blusa|camisa|top\b|camiseta|musculosa|body\b|cardigan|chaleco|túnica|tunica|chaqueta|campera|abrigo|blazer|tapado|saco\b/.test(text)) {
    return 'parte_arriba';
  }
  if (/pantalon|pantalón|jean|jeans|short\b|bermuda|capri/.test(text)) {
    return 'pantalon';
  }
  if (/vestido|falda|pollera/.test(text)) {
    return 'vestido_falda';
  }
  return 'otro';
}

/**
 * Construye el prompt de Vision adaptado a la categoría de la prenda.
 * Cada categoría extrae atributos específicos para mejorar la búsqueda por lenguaje natural.
 *
 * @param {string} nombre
 * @param {string} categorias
 * @param {'parte_arriba'|'pantalon'|'vestido_falda'|'otro'} category
 * @param {string} descripcionTexto
 * @returns {string}
 */
function buildVisionPrompt(nombre, categorias, category, descripcionTexto) {
  const textoContexto = descripcionTexto
    ? `\n\nInformación adicional (descripción de la tienda):\n${descripcionTexto.substring(0, 1200)}`
    : '';

  // Atributos comunes a todas las categorías
  const atributosGenerales = `
- Color principal y tono exacto (ej: "verde musgo", "azul marino", "bordo oscuro", "camel", "blanco hueso")
- Patrón: liso / rayas / cuadrillé / animal print / floral / tie-dye
- Ocasión de uso: trabajo / casual / salida nocturna / fiesta / playa / deporte
- Estilo general: clásico / romántico / sporty / boho / minimalista / urbano
- Combinaciones sugeridas con otras prendas o accesorios que se puedan inferir de la imagen`;

  let atributosEspecificos = '';
  if (category === 'parte_arriba') {
    atributosEspecificos = `
- Tipo de manga: larga / corta / sin manga / 3/4 / globo / campana
- Tipo de escote: V / redondo / cuadrado / halter / off-shoulder / polo / bote / asimétrico
- Largo de la prenda: corto / a la cadera / largo / oversize
- Ajuste al cuerpo: ajustado / suelto / entallado / oversize / crop
- Tela o textura: punto / gasa / algodón / lino / tejido grueso / seda / satén / crochet
- Detalles visuales: volados / botones / lazo / bordado / estampado / liso / flecos / encaje
- Temporada sugerida: verano / invierno / primavera-otoño / todo el año`;
  } else if (category === 'pantalon') {
    atributosEspecificos = `
- Corte y silueta: recto / wide leg / skinny / barrel / bootcut / mom / palazzo
- Tiro: alto / medio / bajo
- Largo: largo / capri / bermuda / corto
- Textura o lavado (si es jean): liso / desgastado / stone wash / oscuro / claro / negro
- Elasticidad: elastizado / rígido / semi-elastizado
- Detalles: rotos / costuras decorativas / bolsillos / cinturón incluido / botones decorativos`;
  } else if (category === 'vestido_falda') {
    atributosEspecificos = `
- Largo: mini / midi / maxi / hasta la rodilla
- Silueta: recto / evasé / envolvente / ajustado / amplio / asimétrico
- Tipo de escote: V / redondo / cuadrado / halter / off-shoulder / sin escote
- Tipo de manga: sin manga / manga corta / manga larga / tirantes / off-shoulder
- Tipo de tela: punto / gasa / lino / satén / algodón / encaje / crochet
- Ocasión específica: casual diurno / cóctel / trabajo / fiesta / playa / boda invitada`;
  }

  const instruccion = `Analizá ${descripcionTexto && !atributosEspecificos ? 'la siguiente información' : 'esta imagen'} del producto "${nombre}" (categoría: ${categorias || 'indumentaria'}).

Identificá con precisión los siguientes atributos:
ATRIBUTOS ESPECÍFICOS:${atributosEspecificos || '\n- Tipo de prenda y características principales'}

ATRIBUTOS GENERALES:${atributosGenerales}${textoContexto}

Escribí una descripción densa en texto fluido que incluya todos los atributos identificados con sus valores exactos. Usá vocabulario de búsqueda directo (ej: "manga corta", "escote en V", "tiro alto", "wide leg", "color bordo", "tela de punto"). La descripción debe permitir encontrar este producto con búsquedas en lenguaje natural. Sin viñetas, sin saltos de línea, todo en un párrafo continuo.`;

  return instruccion;
}

/**
 * Usa GPT-4o Vision para analizar la imagen del producto y extraer atributos estructurados.
 * Los atributos se adaptan según la categoría detectada (parte de arriba, pantalón, vestido/falda).
 * La descripción resultante queda indexada para búsqueda en lenguaje natural.
 *
 * @param {string} imageUrl
 * @param {string} nombre
 * @param {string} categoria
 * @param {string} descripcionTexto - Texto limpio (sin HTML) de descripción corta + larga
 * @returns {Promise<string>}
 */
async function generateVisionDescription(imageUrl, nombre, categoria, descripcionTexto) {
  const garmentCategory = detectGarmentCategory(nombre, categoria);
  const promptText = buildVisionPrompt(nombre, categoria, garmentCategory, descripcionTexto);

  // Sin imagen: generar descripción solo con el texto disponible
  if (!imageUrl) {
    if (!descripcionTexto) {
      return `Producto: ${nombre}. Categoría: ${categoria || 'Sin categoría'}.`;
    }
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: promptText }],
        max_tokens: 400,
        temperature: 0.3,
      });
      return response.choices[0]?.message?.content?.trim() || `Producto: ${nombre}`;
    } catch {
      return `Producto: ${nombre}. Categoría: ${categoria || 'Sin categoría'}.`;
    }
  }

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: promptText },
          { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
        ],
      }],
      max_tokens: 400,
      // Temperatura baja para extracción consistente de atributos (menos creatividad, más precisión)
      temperature: 0.3,
    });

    return response.choices[0]?.message?.content?.trim() || `Producto: ${nombre}`;
  } catch (err) {
    console.warn(`[WooCommerce] Vision falló para "${nombre}": ${err.message}`);
    return `Producto: ${nombre}.${descripcionTexto ? ' ' + descripcionTexto.substring(0, 200) : ''}`;
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
    const categorias   = (woo.categories || []).map((c) => c.name).join(', ');
    const permalink    = woo.permalink || null;

    // Imagen: intentar múltiples fuentes en orden de preferencia
    // woo.images  → array de imágenes del producto padre (galería)
    // woo.image   → imagen singular (usada en variantes de WooCommerce)
    let imagenUrl = woo.images?.[0]?.src || woo.image?.src || null;

    // Limpiar HTML de ambas descripciones y combinarlas para dar contexto a Vision.
    // La descripción larga suele tener tablas de talles, materiales, guía de cuidado, etc.
    const descCorta = stripHtml(woo.short_description);
    const descLarga = stripHtml(woo.description);
    const descripcionTexto = [descCorta, descLarga].filter(Boolean).join('\n\n');

    // --- Manejo de stock según tipo de producto ---
    // Productos "variable" (con talles/colores) guardan el stock en cada variante,
    // no en el producto padre. stock_quantity del padre suele ser null o 0.
    // Hay que consultar las variantes para obtener el stock real y los talles disponibles.
    let stock     = 0;
    let variantes = '';

    if (woo.type === 'variable') {
      const varData = await fetchVariations(woo.id);
      stock     = varData.stockTotal;
      variantes = varData.variantes;

      // Si el producto padre no tiene imagen, usar la primera imagen de sus variantes
      if (!imagenUrl && varData.imagenFallback) {
        imagenUrl = varData.imagenFallback;
        console.log(`[WooCommerce] Imagen de variante usada como fallback para "${nombre}"`);
      }
    } else {
      // Producto simple: el stock está directamente en el padre
      stock = woo.stock_quantity ?? (woo.stock_status === 'instock' ? 1 : 0);
    }

    // Un producto está activo si cumple TODAS las condiciones:
    // 1. Está publicado en WooCommerce
    // 2. Tiene stock real > 0
    // 3. Es visible en el catálogo (no 'hidden')
    // 4. Tiene imagen — sin imagen no se puede recomendar visualmente
    //
    // ⚠️ Para productos variables (con talles/colores), WooCommerce NO actualiza
    // el stock_status del producto padre cuando se agotan todas las variantes.
    // El padre puede seguir mostrando stock_status='instock' aunque stock=0.
    // Por eso para variables usamos SOLO el stock calculado desde las variantes.
    // Para productos simples, mantenemos el fallback a stock_status por compatibilidad
    // con tiendas que no gestionan stock por cantidad (manage_stock=false).
    const catalogVisible = ['visible', 'catalog'].includes(woo.catalog_visibility);
    const tieneStock = woo.type === 'variable'
      ? stock > 0
      : (woo.stock_status === 'instock' || stock > 0);
    const activo = woo.status === 'publish' && tieneStock && catalogVisible && !!imagenUrl;

    // Ver si el producto ya existe en nuestra DB
    const existing = await query(
      'SELECT id, imagen_url, descripcion_vision, sync_excluded FROM waba_products WHERE woo_id = $1',
      [woo.id]
    );

    const isNew          = existing.rows.length === 0;
    const imageChanged   = !isNew && existing.rows[0].imagen_url !== imagenUrl;

    // Si el producto fue excluido manualmente, respetar esa decisión.
    // La sync no puede re-activarlo aunque WooCommerce diga que tiene stock.
    if (!isNew && existing.rows[0].sync_excluded === true) {
      console.log(`[WooCommerce] Producto "${nombre}" excluido manualmente — saltando`);
      continue;
    }
    // Vision solo si el producto tiene stock — no procesamos imágenes de productos agotados
    const needsVision    = (isNew || imageChanged) && imagenUrl && activo;

    // Llamar a Vision solo si es necesario
    let descripcionVision = existing.rows[0]?.descripcion_vision || null;
    if (needsVision) {
      console.log(`[WooCommerce] Vision → "${nombre}"`);
      descripcionVision = await generateVisionDescription(imagenUrl, nombre, categorias, descripcionTexto);
      visionCalls++;
      // Delay mínimo entre llamadas a Vision para respetar rate limits de OpenAI
      await new Promise((r) => setTimeout(r, 300));
    }

    if (isNew) {
      await query(
        `INSERT INTO waba_products
           (woo_id, nombre, descripcion_original, descripcion_vision,
            precio, precio_oferta, stock, variantes, categorias, imagen_url, permalink,
            activo, vision_generado_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          woo.id, nombre, descripcionTexto, descripcionVision,
          precio, precioOferta, stock, variantes || null, categorias, imagenUrl, permalink,
          activo, descripcionVision ? new Date() : null,
        ]
      );
      inserted++;
    } else {
      await query(
        `UPDATE waba_products
         SET nombre               = $1,
             descripcion_original = $2,
             descripcion_vision   = COALESCE($3, descripcion_vision),
             precio               = $4,
             precio_oferta        = $5,
             stock                = $6,
             variantes            = $7,
             categorias           = $8,
             imagen_url           = $9,
             permalink            = $10,
             activo               = $11,
             vision_generado_at   = CASE WHEN $3 IS NOT NULL THEN NOW() ELSE vision_generado_at END,
             updated_at           = NOW()
         WHERE woo_id = $12`,
        [
          nombre, descripcionTexto, descripcionVision,
          precio, precioOferta, stock, variantes || null, categorias, imagenUrl, permalink,
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

  const PRODUCT_FIELDS = `nombre, descripcion_vision, precio, precio_oferta, stock, variantes, categorias, permalink, imagen_url`;

  try {
    // Intento 1: full-text search con diccionario español.
    // plainto_tsquery convierte el mensaje en una query de texto completo con AND implícito,
    // lo que maneja sinónimos, stopwords y variaciones morfológicas mejor que ILIKE.
    // La columna de búsqueda combina nombre (peso A, más relevante) y descripcion_vision (peso B).
    const ftsResult = await query(
      `SELECT ${PRODUCT_FIELDS},
              ts_rank(
                setweight(to_tsvector('spanish', coalesce(nombre, '')), 'A') ||
                setweight(to_tsvector('spanish', coalesce(descripcion_vision, '')), 'B') ||
                setweight(to_tsvector('spanish', coalesce(categorias, '')), 'C'),
                plainto_tsquery('spanish', $2)
              ) AS rank
       FROM waba_products
       WHERE activo = true AND stock > 0
         AND (
           setweight(to_tsvector('spanish', coalesce(nombre, '')), 'A') ||
           setweight(to_tsvector('spanish', coalesce(descripcion_vision, '')), 'B') ||
           setweight(to_tsvector('spanish', coalesce(categorias, '')), 'C')
         ) @@ plainto_tsquery('spanish', $2)
       ORDER BY created_at DESC, rank DESC
       LIMIT $1`,
      [limit, mensaje]
    );

    if (ftsResult.rows.length > 0) {
      // Verificar si el FTS omitió palabras importantes del query (ej: "greek", marcas en inglés).
      // El diccionario español descarta palabras no reconocidas; si el query era "campera greek"
      // el FTS puede devolver camperas genéricas y nunca encontrar "Chaqueta Greek".
      // Solución: si hay palabras del query que no aparecen en ningún nombre de resultado,
      // buscarlas por ILIKE y mergear — son palabras específicas que el FTS ignoró.
      const queryWords = mensaje
        .toLowerCase()
        .replace(/[^a-záéíóúüñ\s]/gi, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 3);

      const resultNamesLower = ftsResult.rows.map((r) => (r.nombre || '').toLowerCase());
      const missingWords = queryWords.filter(
        (w) => !resultNamesLower.some((name) => name.includes(w))
      );

      if (missingWords.length > 0) {
        // Hay palabras que el FTS ignoró — buscarlas por ILIKE SOLO EN NOMBRE.
        // No buscar en descripcion_vision porque palabras como "combine", "mostrar",
        // "quiero" aparecen en las descripciones de muchos productos con sentido
        // estilístico (ej: "se combina con..."), generando falsos positivos que
        // desplazan a los productos reales (ej: buscar "jean" devuelve cardigans
        // cuya descripción dice "combiná con un jean").
        const missingConds = missingWords.map(
          (_, i) => `(nombre ILIKE $${i + 2} OR categorias ILIKE $${i + 2})`
        );
        try {
          const ilikeExtra = await query(
            `SELECT ${PRODUCT_FIELDS} FROM waba_products
             WHERE activo = true AND stock > 0 AND (${missingConds.join(' OR ')})
             ORDER BY created_at DESC LIMIT $1`,
            [limit, ...missingWords.map((w) => `%${w}%`)]
          );
          if (ilikeExtra.rows.length > 0) {
            // Poner los resultados de la palabra faltante primero (más específicos y más nuevos)
            const seenNames = new Set(ftsResult.rows.map((r) => r.nombre));
            const augmented = [...ilikeExtra.rows];
            for (const r of ftsResult.rows) {
              if (!seenNames.has(r.nombre)) augmented.push(r);
            }
            return augmented.slice(0, limit);
          }
        } catch {
          // Si falla la búsqueda complementaria, devolver los resultados FTS originales
        }
      }

      return ftsResult.rows;
    }

    // Palabras funcionales españolas que no son identificadores de productos.
    // Buscarlas por ILIKE genera falsos positivos masivos: "para" aparece en la
    // descripción de prácticamente TODOS los productos ("ideal para...", "perfecta para..."),
    // "usar" en muchas también, con lo que el ILIKE devuelve los 6 más nuevos al azar.
    const SEARCH_STOPWORDS = new Set([
      'para', 'usar', 'usarlo', 'usarla', 'mostras', 'mostrar', 'mostrame',
      'quiero', 'podes', 'puedo', 'tenes', 'tiene', 'algo', 'otro', 'otra',
      'este', 'esta', 'esos', 'esas', 'cual', 'como', 'desde', 'hasta',
      'llevo', 'llevar', 'lleva', 'combina', 'combinar', 'combiná', 'combino',
      'seria', 'tengo', 'busco', 'ponerse', 'ponme', 'ponerte',
    ]);

    // Extraer palabras de búsqueda útiles (> 3 chars, sin puntuación, sin funcionales)
    const words = mensaje
      .toLowerCase()
      .replace(/[^a-záéíóúüñ\s]/gi, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !SEARCH_STOPWORDS.has(w));

    // Extraer talles/tallas del mensaje original — pueden ser 1-2 chars (L, M, XL, XS, S, 42, etc.)
    // y quedan filtrados por el criterio de longitud anterior.
    // Los buscamos aparte solo en el campo variantes para no generar falsos positivos.
    const tallesMatch = mensaje.match(/\b(XXL|XL|XS|[SML]{1,2}|\d{1,2})\b/gi) || [];
    const talles = [...new Set(tallesMatch.map((t) => t.toUpperCase()))];

    if (words.length === 0) {
      // Sin keywords útiles → productos más nuevos como sugerencia
      const fallback = await query(
        `SELECT ${PRODUCT_FIELDS} FROM waba_products
         WHERE activo = true AND stock > 0
         ORDER BY created_at DESC LIMIT $1`,
        [limit]
      );
      return fallback.rows;
    }

    // Intento 2: FTS con OR entre los términos.
    // Cuando el AND es demasiado estricto (ej: "remera manga corta" requiere las 3 palabras),
    // el OR permite encontrar productos donde al menos uno de los términos esté presente.
    // Los resultados se ordenan por más nuevos primero; rank como tiebreaker dentro del mismo día.
    // Esto es crítico para búsquedas de atributos como "manga corta" o "tiro alto".
    try {
      // Combinar palabras + talles para el OR query (FTS no aplica a talles cortos,
      // pero los incluimos por si el diccionario los reconoce)
      const allTerms = [...words, ...talles];
      const orTsQuery = allTerms.join(' | ');
      const ftsorResult = await query(
        `SELECT ${PRODUCT_FIELDS},
                ts_rank(
                  setweight(to_tsvector('spanish', coalesce(nombre, '')), 'A') ||
                  setweight(to_tsvector('spanish', coalesce(descripcion_vision, '')), 'B') ||
                  setweight(to_tsvector('spanish', coalesce(categorias, '')), 'C'),
                  to_tsquery('spanish', $2)
                ) AS rank
         FROM waba_products
         WHERE activo = true AND stock > 0
           AND (
             setweight(to_tsvector('spanish', coalesce(nombre, '')), 'A') ||
             setweight(to_tsvector('spanish', coalesce(descripcion_vision, '')), 'B') ||
             setweight(to_tsvector('spanish', coalesce(categorias, '')), 'C')
           ) @@ to_tsquery('spanish', $2)
         ORDER BY created_at DESC, rank DESC
         LIMIT $1`,
        [limit, orTsQuery]
      );

      if (ftsorResult.rows.length > 0) {
        // Mismo check de palabras faltantes que en intento 1:
        // El FTS OR puede devolver resultados que matchean palabras genéricas del mensaje
        // (ej: "combinar" para "jean que combine"), ignorando el término de producto real ("jean").
        // Si alguna palabra del query no aparece en los nombres de los resultados, la buscamos
        // por ILIKE y mergeamos para no perder el producto específico que el usuario pidió.
        const orResultNamesLower = ftsorResult.rows.map((r) => (r.nombre || '').toLowerCase());
        const orMissingWords = words.filter(
          (w) => !orResultNamesLower.some((name) => name.includes(w))
        );

        if (orMissingWords.length > 0) {
          // Solo nombre y categorias, igual que en intento 1.
          // descripcion_vision produce falsos positivos: un cardigan con descripción
          // "combiná con un jean" aparece antes que los jeans reales.
          const orMissingConds = orMissingWords.map(
            (_, i) => `(nombre ILIKE $${i + 2} OR categorias ILIKE $${i + 2})`
          );
          try {
            const orIlikeExtra = await query(
              `SELECT ${PRODUCT_FIELDS} FROM waba_products
               WHERE activo = true AND stock > 0 AND (${orMissingConds.join(' OR ')})
               ORDER BY created_at DESC LIMIT $1`,
              [limit, ...orMissingWords.map((w) => `%${w}%`)]
            );
            if (orIlikeExtra.rows.length > 0) {
              const orSeen = new Set(ftsorResult.rows.map((r) => r.nombre));
              const orAugmented = [...orIlikeExtra.rows];
              for (const r of ftsorResult.rows) {
                if (!orSeen.has(r.nombre)) orAugmented.push(r);
              }
              return orAugmented.slice(0, limit);
            }
          } catch {
            // Si falla la búsqueda complementaria, devolver los resultados FTS OR originales
          }
        }

        return ftsorResult.rows;
      }
    } catch {
      // Si el OR query falla (ej: palabras inválidas para el diccionario), continuar al ILIKE
    }

    // Intento 3: fallback con ILIKE — máxima compatibilidad para términos no cubiertos por FTS.
    // Las condiciones se unen con OR: cualquier palabra del mensaje que aparezca en cualquier
    // campo devuelve el producto. Ordenado por match en el nombre (más probable).
    // Los talles detectados (L, M, XL, 1, 2, etc.) se buscan solo en variantes para evitar
    // falsos positivos con palabras cortas en nombre o descripción.
    // NO se busca en descripcion_vision: palabras como "jean" aparecen en descripciones de
    // otras prendas que "se combinan con jean", generando falsos positivos antes que los jeans reales.
    const wordConditions = words.length > 0
      ? words.map((_, i) => `(nombre ILIKE $${i + 2} OR categorias ILIKE $${i + 2} OR variantes ILIKE $${i + 2})`)
      : [];

    const talleOffset = 2 + words.length;
    const talleConditions = talles.map((_, i) =>
      `variantes ILIKE $${talleOffset + i}`
    );

    const allConditions = [...wordConditions, ...talleConditions];

    if (allConditions.length === 0) return [];

    const combined = allConditions.join(' OR ');
    const params = [
      limit,
      ...words.map((w) => `%${w}%`),
      ...talles.map((t) => `%${t}%`),
    ];

    const ilikeResult = await query(
      `SELECT ${PRODUCT_FIELDS} FROM waba_products
       WHERE activo = true AND stock > 0 AND (${combined})
       ORDER BY created_at DESC, (nombre ILIKE $2) DESC
       LIMIT $1`,
      params
    );

    return ilikeResult.rows;
  } catch (err) {
    console.error('[WooCommerce] Error en búsqueda de productos:', err.message);
    return [];
  }
}

/**
 * Devuelve estadísticas de pedidos WooCommerce para un contacto.
 * Busca primero por email (más confiable); si no hay resultados, por teléfono.
 * Los pedidos considerados: completed, processing, on-hold.
 *
 * @param {string|null} email    - Email del contacto
 * @param {string|null} telefono - Teléfono del contacto (se normaliza a últimos 10 dígitos)
 * @returns {Promise<{cantidadPedidos: number, fechaUltimoPedido: Date|null}>}
 */
export async function getContactOrderStats(email, telefono) {
  try {
    const client = getWooClient();
    let orders = [];

    // Buscar por email (parámetro nativo de WooCommerce, más preciso)
    if (email) {
      const res = await client.get('/orders', {
        params: {
          billing_email: email,
          per_page: 100,
          orderby: 'date',
          order: 'desc',
          status: 'completed,processing,on-hold',
        },
      });
      orders = res.data || [];
    }

    // Si no hay resultados por email, buscar por teléfono (búsqueda general)
    if (orders.length === 0 && telefono) {
      const phoneClean = String(telefono).replace(/\D/g, '').slice(-10);
      const res = await client.get('/orders', {
        params: {
          search: phoneClean,
          per_page: 100,
          orderby: 'date',
          order: 'desc',
          status: 'completed,processing,on-hold',
        },
      });
      orders = res.data || [];
    }

    if (orders.length === 0) {
      return { cantidadPedidos: 0, fechaUltimoPedido: null };
    }

    // La API devuelve en orden descendente por fecha → el primero es el más reciente
    const fechaUltimoPedido = orders[0].date_created ? new Date(orders[0].date_created) : null;
    return { cantidadPedidos: orders.length, fechaUltimoPedido };
  } catch (err) {
    console.warn('[WooCommerce] No se pudieron obtener stats de pedidos:', err.message);
    return { cantidadPedidos: 0, fechaUltimoPedido: null };
  }
}

/**
 * Trae órdenes de WooCommerce dentro de un rango de fechas.
 * Se usa para el tracking de conversiones: comparamos los emails
 * de los destinatarios de una campaña contra los compradores del período.
 *
 * @param {Date} after  - Fecha de inicio (inclusive)
 * @param {Date} before - Fecha de fin (inclusive)
 * @returns {Promise<Array<{id, billing_email, total, date_created}>>}
 */
export async function fetchOrdersByDateRange(after, before) {
  const client = getWooClient();
  const orders = [];
  let page = 1;

  // WooCommerce pagina las órdenes — recorremos hasta que no haya más
  while (true) {
    const res = await client.get('/orders', {
      params: {
        after:    after.toISOString(),
        before:   before.toISOString(),
        per_page: 100,
        page,
        // Solo órdenes confirmadas o en proceso — excluimos canceladas, pendientes, etc.
        status:   'completed,processing',
      },
    });

    const batch = res.data || [];
    if (batch.length === 0) break;

    for (const order of batch) {
      if (order.billing?.email) {
        orders.push({
          id:            order.id,
          billing_email: order.billing.email.toLowerCase().trim(),
          total:         parseFloat(order.total) || 0,
          date_created:  order.date_created,
        });
      }
    }

    // Si trajo menos de 100, no hay más páginas
    if (batch.length < 100) break;
    page++;
  }

  console.log(`[WooCommerce] Órdenes en rango: ${orders.length}`);
  return orders;
}

/**
 * Regenera las descripciones Vision de productos activos usando el nuevo prompt estructurado.
 * Útil para aplicar el formato de atributos a productos que ya estaban en la DB sin tener
 * que esperar a que cambien sus imágenes.
 *
 * Procesa en batches con delay entre llamadas para respetar rate limits de OpenAI.
 *
 * @param {number} limit - Máximo de productos a procesar en esta ejecución
 * @returns {Promise<{processed: number, failed: number}>}
 */
export async function regenerateVisionDescriptions(limit = 100) {
  console.log(`[WooCommerce] Iniciando regeneración Vision para hasta ${limit} productos`);

  const result = await query(
    `SELECT id, nombre, categorias, imagen_url, descripcion_original
     FROM waba_products
     WHERE activo = true AND imagen_url IS NOT NULL
     ORDER BY vision_generado_at ASC NULLS FIRST
     LIMIT $1`,
    [limit]
  );

  const productos = result.rows;
  console.log(`[WooCommerce] Regeneración Vision: ${productos.length} productos a procesar`);

  let processed = 0;
  let failed = 0;

  for (const p of productos) {
    try {
      const nuevaDesc = await generateVisionDescription(
        p.imagen_url,
        p.nombre,
        p.categorias || '',
        p.descripcion_original || ''
      );

      await query(
        `UPDATE waba_products
         SET descripcion_vision = $1, vision_generado_at = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [nuevaDesc, p.id]
      );

      processed++;
      console.log(`[WooCommerce] Vision regenerada → "${p.nombre}"`);
    } catch (err) {
      failed++;
      console.warn(`[WooCommerce] Vision regeneration falló para "${p.nombre}": ${err.message}`);
    }

    // Delay entre llamadas para no saturar la API de OpenAI
    await new Promise((r) => setTimeout(r, 400));
  }

  console.log(`[WooCommerce] Regeneración Vision completada — Procesados: ${processed}, Fallidos: ${failed}`);
  return { processed, failed };
}
