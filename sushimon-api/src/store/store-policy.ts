import { BadRequestException, HttpStatus } from '@nestjs/common';
import { codedException } from '../common/errors/coded-exception.js';
import { escapeLike, fold } from '../products/product-policy.js';

/** Reglas puras de los agregados públicos de la tienda (F17). Sin I/O ni reloj. Topes: ADR-0023 y spec 018 (P24). */

export const MAX_BOOTSTRAP_CATEGORIES = 30;
export const MAX_BOOTSTRAP_FEATURED = 8;
export const MAX_BOOTSTRAP_PROMOTIONS = 5;
export const MAX_BOOTSTRAP_BANNERS = 10;
export const MAX_DETAIL_PROMOTIONS = 3;
export const MENU_MAX_PAGE_SIZE = 100;
export const MENU_MAX_PAGE = 200;
export const SEARCH_MIN = 2;
export const SEARCH_MAX = 80;
export const SEARCH_MAX_PAGE = 20;
export const SEARCH_MAX_PAGE_SIZE = 50;
export const SEARCH_DEFAULT_PAGE_SIZE = 20;
export const SUMMARY_MAX = 160;
/** Tope de la caché compartida de los agregados (`s-maxage`, segundos): conserva la garantía de F13 (≤ 15 s). */
export const STORE_MAX_AGE_S = 15;
/** Caracteres leídos de la descripción para derivar el resumen (suficiente para 160 + corte por palabra). */
export const SUMMARY_SOURCE_CHARS = 400;

export const storeBranchNotFound = () =>
  codedException(HttpStatus.NOT_FOUND, 'BRANCH_NOT_FOUND', 'Sucursal no encontrada');

/** 503 reintentable con mensaje fijo: nunca detalles de la causa (el filtro solo deja pasar códigos de su lista blanca). */
export const storeBusy = () =>
  codedException(
    HttpStatus.SERVICE_UNAVAILABLE,
    'STORE_BUSY',
    'La tienda está ocupada; reintenta en unos segundos',
  );

const bad = (message: string): never => {
  throw new BadRequestException([message]);
};

/**
 * Cualquier carácter de control (C0/C1, incluido NUL, tabulador y salto de línea), de formato (bidi, ancho cero, guion
 * blando, BOM), sustituto suelto, de uso privado, sin asignar o separador de línea/párrafo. Se RECHAZA (400) en vez de
 * ignorarse: así dos entradas distintas no pueden producir la misma búsqueda ni ocultar texto al operador.
 */
const FORBIDDEN_IN_QUERY = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/u;

/**
 * Selectores de variación (VS1-16 y suplementarios), rellenos «invisibles» (Hangul filler U+115F/U+1160/U+3164/U+FFA0) y
 * el patrón braille vacío U+2800: se ven como nada pero no son espacio.
 */
// eslint-disable-next-line no-misleading-character-class -- los selectores de variación son justo lo que se rechaza
const INVISIBLE_FILLERS = /[\uFE00-\uFE0F\u115F\u1160\u3164\uFFA0\u2800\u{E0100}-\u{E01EF}]/u;
const ALNUM = /[\p{L}\p{N}]/u;

/** Texto de búsqueda normalizado: NFC, espacios colapsados y recortado; `2..80` caracteres; nada de control/bidi/invisibles. */
export function normalizeSearchText(raw: unknown): string {
  if (typeof raw !== 'string') return bad('q es obligatoria');
  const text = raw.normalize('NFC');
  if (FORBIDDEN_IN_QUERY.test(text) || INVISIBLE_FILLERS.test(text))
    return bad('q contiene caracteres no permitidos');
  const clean = text.replace(/\s+/gu, ' ').trim();
  if (!ALNUM.test(clean)) return bad('q debe contener al menos una letra o un dígito');
  const length = Array.from(clean).length;
  if (length < SEARCH_MIN) return bad(`q debe tener al menos ${SEARCH_MIN} caracteres`);
  if (length > SEARCH_MAX) return bad(`q no puede superar ${SEARCH_MAX} caracteres`);
  return clean;
}

export interface SearchPatterns {
  /** `%texto%` plegado, con `\ % _` escapados. */
  contains: string;
  /** `texto%` plegado y escapado. */
  prefix: string;
  /** Texto plegado SIN escapar (para comparar en memoria con nombres de categoría). */
  folded: string;
}

export function buildSearchPatterns(text: string): SearchPatterns {
  const folded = fold(text);
  const escaped = escapeLike(folded);
  return { contains: `%${escaped}%`, prefix: `${escaped}%`, folded };
}

/** Ids de las categorías visibles cuyo NOMBRE contiene el texto (mismo plegado que la consulta SQL). */
export function matchingCategoryIds(
  categories: Iterable<{ id: string; name: string }>,
  foldedText: string,
): string[] {
  const out: string[] = [];
  for (const c of categories) if (fold(c.name).includes(foldedText)) out.push(c.id);
  return out;
}

/**
 * Descripción corta (≤ 160): texto plano, espacios colapsados, recortado SIN partir palabras y con «…» si se acortó.
 * `null` si no hay descripción. Cuenta puntos de código (nunca parte un par sustituto).
 */
export function summarize(description: string | null): string | null {
  if (description === null) return null;
  const flat = description.replace(/\s+/gu, ' ').trim();
  if (flat === '') return null;
  const chars = Array.from(flat);
  if (chars.length <= SUMMARY_MAX) return flat;
  const room = SUMMARY_MAX - 1; // lugar para «…»
  let cut = chars.slice(0, room);
  const lastSpace = cut.lastIndexOf(' ');
  // Sin espacio útil (una sola palabra larguísima) se corta duro.
  if (lastSpace > 0 && chars[room] !== ' ') cut = cut.slice(0, lastSpace);
  return `${cut
    .join('')
    .trimEnd()
    .replace(/[,.;:!?\-–—]+$/u, '')}…`;
}

/** Mínimo no nulo de instantes ISO (o `null`). */
export function earliestIso(values: readonly (string | null | undefined)[]): string | null {
  let best: number | null = null;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    const ms = Date.parse(v);
    if (Number.isFinite(ms) && (best === null || ms < best)) best = ms;
  }
  return best === null ? null : new Date(best).toISOString();
}
