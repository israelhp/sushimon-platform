import {
  CATEGORY_SLUG_MAX,
  CATEGORY_SLUG_PATTERN,
  hasControlChars,
  normalizeCategoryName,
  slugifyCategoryName,
  uniqueSlug,
} from '@/lib/category-tree';

/**
 * F11 — Reglas puras de productos (spec 012). Las usa el adaptador mock para emular al servidor y la UI para validar antes de
 * enviar; la autoridad es siempre la API (CHECK de BD + DTO). Los importes son CADENAS decimales (`"85.00"`) y se calculan en
 * céntimos enteros: nunca con coma flotante.
 */
export const PRODUCT_NAME_MAX = 120;
export const PRODUCT_DESCRIPTION_MAX = 2000;
export const PRODUCT_SLUG_MAX = CATEGORY_SLUG_MAX;
export const PRODUCT_SKU_MAX = 40;
export const PRODUCT_MEDIA_MAX = 8;
export const PRODUCT_MEDIA_URL_MAX = 2048;
export const PRODUCT_ALT_MAX = 200;
export const PRODUCT_SEARCH_MAX = 80;
export const PRODUCT_PAGE_SIZE_MAX = 100;
export const PRODUCT_PAGE_MAX = 200;
/** Precio máximo en céntimos (999 999.99). */
export const PRODUCT_PRICE_MAX_CENTS = 99_999_999;

export const PRODUCT_SLUG_PATTERN = CATEGORY_SLUG_PATTERN;
/** Forma de entrada del SKU (el servidor lo guarda en MAYÚSCULAS). */
export const PRODUCT_SKU_INPUT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** `ProductPrice` del contrato. */
export const PRODUCT_PRICE_PATTERN = /^[0-9]{1,6}\.[0-9]{2}$/;

/** Controles no permitidos en un texto plano multilínea (se admiten salto de línea, retorno y tabulador). */
export const hasDisallowedControlChars = (value: string): boolean =>
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value);

export { hasControlChars, normalizeCategoryName as normalizeProductName, uniqueSlug };

/** Slug base desde un nombre (minúsculas, sin acentos, kebab, ≤ 80). Vacío si no queda nada utilizable. */
export const slugifyProductName = slugifyCategoryName;

/** SKU como lo guarda el servidor (recortado y en mayúsculas); `null` si queda vacío. */
export const normalizeSku = (value: string): string | null => value.trim().toUpperCase() || null;

export const isValidSku = (value: string): boolean =>
  value.length >= 1 && value.length <= PRODUCT_SKU_MAX && PRODUCT_SKU_INPUT_PATTERN.test(value);

// ── Precio ──────────────────────────────────────────────────────────────────────────────────

/** Céntimos de un `ProductPrice` válido (`"85.00"` → 8500) o `null` si no cumple forma y rango del contrato. */
export function priceToCents(price: string): number | null {
  if (!PRODUCT_PRICE_PATTERN.test(price)) return null;
  const [whole, fraction] = price.split('.') as [string, string];
  const cents = Number(whole) * 100 + Number(fraction);
  return cents > 0 && cents <= PRODUCT_PRICE_MAX_CENTS ? cents : null;
}

export const centsToPrice = (cents: number): string =>
  `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

/**
 * Texto del campo de precio del formulario → `ProductPrice`. Admite coma o punto y de 0 a 2 decimales (`85`, `85.5`,
 * `85,50`); `null` si no es un importe mayor a 0 y ≤ 999 999.99.
 */
export function parsePriceInput(text: string): string | null {
  const m = /^(\d{1,6})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
  return cents > 0 && cents <= PRODUCT_PRICE_MAX_CENTS ? centsToPrice(cents) : null;
}

/** Valor numérico SOLO para mostrar/sumar en la UI (`"85.00"` → 85). El importe canónico sigue siendo la cadena. */
export const priceToNumber = (price: string): number => {
  const cents = priceToCents(price);
  return cents === null ? Number.NaN : cents / 100;
};

// ── Imágenes ────────────────────────────────────────────────────────────────────────────────

/**
 * URL `https` absoluta ≤ 2048, sin espacios, controles ni credenciales, con host con nombre de dominio (con punto): se
 * rechazan IP literales (v4/v6), `localhost` y hosts sin punto. No valida el contenido remoto.
 */
export function isValidMediaUrl(url: string): boolean {
  if (url.length === 0 || url.length > PRODUCT_MEDIA_URL_MAX) return false;
  if (/\s/.test(url) || hasControlChars(url)) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost')) return false;
    if (host.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /^[\d.]+$/.test(host)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** URL apta para `<img src>` (solo `https`) o `null`: nunca se renderiza otro esquema aunque llegue en un dato. */
export const safeMediaUrl = (url: string | null | undefined): string | null =>
  url && isValidMediaUrl(url) ? url : null;
