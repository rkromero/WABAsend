/**
 * Normalizador de talles de indumentaria
 * Autor: Turnio
 * Fecha: 2026-04-02
 *
 * Resuelve la inconsistencia entre los distintos sistemas de talles
 * que conviven en el catálogo (letras, escala numérica interna, talles de pantalón).
 *
 * Categorías soportadas:
 *   SUPERIOR  → remeras, sweaters, camisas, tops, vestidos, faldas
 *               Formatos: S/M/L/XL  ↔  1/2/3/4
 *               Talle único: UNIVERSAL (compatible con cualquier talle)
 *
 *   INFERIOR  → pantalones, jeans, shorts, bermudas
 *               Formatos: 36/38/40/42  ↔  1/2/3/4
 *               Talle único: no aplica (no se ofrece como universal)
 */

// ─── Tablas de equivalencia ──────────────────────────────────────────────────

/** Forma canónica para prendas superiores: siempre letras mayúsculas */
const SUPERIOR_MAP = {
  '1': 'S',
  '2': 'M',
  '3': 'L',
  '4': 'XL',
  's': 'S',
  'm': 'M',
  'l': 'L',
  'xl': 'XL',
  'xs': 'XS',
  'xxl': 'XXL',
  'S': 'S',
  'M': 'M',
  'L': 'L',
  'XL': 'XL',
  'XS': 'XS',
  'XXL': 'XXL',
};

/** Forma canónica para prendas inferiores: siempre número de indumentaria */
const INFERIOR_MAP = {
  '1': '36',
  '2': '38',
  '3': '40',
  '4': '42',
  '5': '44',
  '6': '46',
  '36': '36',
  '38': '38',
  '40': '40',
  '42': '42',
  '44': '44',
  '46': '46',
};

/** Tokens que representan "talle único" en cualquier grafía */
const TALLE_UNICO_TOKENS = new Set([
  'unico', 'único', 'u', 'tu', 'talle unico', 'talle único',
  'talleúnico', 'talleunico',
]);

// ─── Funciones públicas ───────────────────────────────────────────────────────

/**
 * Determina si un valor de talle representa "talle único".
 *
 * @param {string} size
 * @returns {boolean}
 */
export function isTalleUnico(size) {
  return TALLE_UNICO_TOKENS.has(size.toLowerCase().trim());
}

/**
 * Convierte un talle a su forma canónica según la categoría de prenda.
 *
 * Categorías que usan el sistema SUPERIOR: 'parte_arriba', 'vestido_falda'
 * Categorías que usan el sistema INFERIOR: 'pantalon'
 * Categoría desconocida ('otro'): devuelve el valor sin cambios
 *
 * @param {string} size             - Valor de talle crudo (ej: "2", "m", "40")
 * @param {string} garmentCategory  - Categoría detectada de la prenda
 * @returns {string} Forma canónica (ej: "M", "38") o el original si no hay mapeo
 */
export function normalizeSize(size, garmentCategory) {
  if (!size) return '';
  const s = size.trim();

  if (isTalleUnico(s)) return 'UNICO';

  if (garmentCategory === 'parte_arriba' || garmentCategory === 'vestido_falda') {
    return SUPERIOR_MAP[s] || SUPERIOR_MAP[s.toLowerCase()] || s.toUpperCase();
  }
  if (garmentCategory === 'pantalon') {
    return INFERIOR_MAP[s] || s;
  }
  return s;
}

/**
 * Toma el string de variantes de un producto (ej: "1, 2, XL, Talle Único")
 * y lo expande anotando las equivalencias canónicas de cada valor.
 *
 * Esto enriquece el contexto que recibe GPT para que pueda comparar correctamente
 * el talle solicitado por el cliente con los talles disponibles del producto.
 *
 * Ejemplos de salida:
 *   "1, 2, 3"         (parte_arriba) → "S(=1), M(=2), L(=3)"
 *   "1, 2, XL"        (parte_arriba) → "S(=1), M(=2), XL"
 *   "Talle Único"     (parte_arriba) → "Talle Único (compatible con S, M, L y XL)"
 *   "1, 2, 40"        (pantalon)     → "36(=1), 38(=2), 40"
 *
 * @param {string} variantesStr     - String de variantes del producto
 * @param {string} garmentCategory  - Categoría de la prenda
 * @returns {string} String expandido con equivalencias
 */
export function expandVariantes(variantesStr, garmentCategory) {
  if (!variantesStr || !variantesStr.trim()) return '';

  const parts = variantesStr.split(',').map((s) => s.trim()).filter(Boolean);

  const expanded = parts.map((part) => {
    // Caso especial: talle único
    if (isTalleUnico(part)) {
      if (garmentCategory === 'parte_arriba' || garmentCategory === 'vestido_falda') {
        // Universal en prendas superiores — compatible con cualquier talle
        return 'Talle Único (compatible con S, M, L y XL)';
      }
      return 'Talle Único';
    }

    const canon = normalizeSize(part, garmentCategory);

    // Si el canónico es diferente al original, anotar ambos para claridad
    if (canon && canon !== part && canon !== part.toUpperCase()) {
      return `${canon}(=${part})`;
    }
    return canon || part;
  });

  return expanded.join(', ');
}

/**
 * Genera el bloque de reglas de talles para incluir en el system prompt del bot.
 * Explica las equivalencias al modelo para que pueda matchear correctamente
 * el talle pedido por el cliente contra los talles del catálogo.
 *
 * @returns {string}
 */
export function getSizeRulesBlock() {
  return `

SISTEMA DE TALLES — REGLAS DE EQUIVALENCIA:
• Prendas superiores (remeras, sweaters, camisas, tops, vestidos, faldas):
  S=1, M=2, L=3, XL=4. Son exactamente lo mismo, solo distinto formato.
  Talle Único: es SIEMPRE compatible con cualquier talle solicitado (S, M, L o XL).
  Ofrecerlo como opción válida cuando no haya match exacto.
• Prendas inferiores (pantalones, jeans, shorts, bermudas):
  36=1, 38=2, 40=3, 42=4. Son exactamente lo mismo, solo distinto formato.
  Talle Único NO es universal en esta categoría.
• Cuando los talles del catálogo aparecen con anotaciones (ej: "M(=2)", "38(=1)"),
  son formas equivalentes del mismo talle.`;
}
