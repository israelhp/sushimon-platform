import type { Query } from '@/lib/data-access/types';

/**
 * F17 — Reglas COMPARTIDAS de los agregados públicos de la tienda (bootstrap, menú, búsqueda, ficha). Las usan el mock (para
 * emular al servidor con la misma semántica), los services (construcción canónica de la URL) y los hooks (límites, ventanas de
 * caché). La UI NO recalcula precios ni promociones: solo muestra lo que devuelve la respuesta.
 *
 * Fuente: `specs/018-store-aggregates/spec.md` y el contrato (`getStoreBootstrap`, `searchStoreProducts`, `getStoreBranchMenu`,
 * `getStoreProduct`). Todo lo marcado «simulado» emula a la API; no está verificado contra el servidor real.
 */

// ── Topes del contrato ─────────────────────────────────────────────────────────────────────────

export const STORE_MENU_PAGE_MAX = 200;
export const STORE_MENU_PAGE_SIZE_MAX = 100;
export const STORE_MENU_PAGE_SIZE_DEFAULT = 100;
export const STORE_SEARCH_PAGE_MAX = 20;
export const STORE_SEARCH_PAGE_SIZE_MAX = 50;
export const STORE_SEARCH_PAGE_SIZE_DEFAULT = 20;
export const STORE_SEARCH_MIN = 2;
export const STORE_SEARCH_MAX = 80;
export const STORE_SUMMARY_MAX = 160;
export const STORE_BOOTSTRAP_CATEGORIES_MAX = 30;
export const STORE_BOOTSTRAP_FEATURED_MAX = 8;
export const STORE_BOOTSTRAP_PROMOTIONS_MAX = 5;
export const STORE_PRODUCT_PROMOTIONS_MAX = 3;

// ── Ventanas de caché del cliente (≤ TTL de la API: respuestas públicas ≤ 15 s en CDN) ───────────

export const STORE_AGGREGATE_STALE_MS = 15_000;
/** Categorías raíz/árbol: el servidor las cachea 60 s. */
export const STORE_CATEGORIES_STALE_MS = 60_000;
/** Búsquedas: se descartan pronto (cada texto distinto es una clave nueva). */
export const STORE_SEARCH_GC_MS = 120_000;
/** Pausa de escritura antes de pedir la búsqueda. */
export const STORE_SEARCH_DEBOUNCE_MS = 300;

// ── Texto ──────────────────────────────────────────────────────────────────────────────────────

/** Plegado de mayúsculas y acentos (mismo criterio que el SQL `lower(translate(...))` de la API). */
export const foldText = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/** `q` tal como la interpreta el servidor: sin caracteres de control y recortada. */
export const normalizeSearchText = (raw: string): string => raw.replace(CONTROL_CHARS, '').trim();

/** `q` en la forma CANÓNICA que viaja en la URL (recortada y en minúsculas: la URL es la clave de la CDN). */
export const canonicalSearchText = (raw: string): string => normalizeSearchText(raw).toLowerCase();

/** ¿Se puede pedir al servidor? (2 a 80 caracteres tras recortar). */
export const isSearchable = (raw: string): boolean => {
  const length = normalizeSearchText(raw).length;
  return length >= STORE_SEARCH_MIN && length <= STORE_SEARCH_MAX;
};

/** Descripción corta: texto plano ≤ 160, recortada sin partir palabras; `null` si no hay descripción. */
export function summarize(description: string | null | undefined): string | null {
  const plain = (description ?? '').replace(/\s+/g, ' ').trim();
  if (!plain) return null;
  if (plain.length <= STORE_SUMMARY_MAX) return plain;
  const cut = plain.slice(0, STORE_SUMMARY_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  const head = lastSpace > 0 && plain[STORE_SUMMARY_MAX] !== ' ' ? cut.slice(0, lastSpace) : cut;
  return head.trimEnd();
}

/**
 * Grupo de relevancia de la búsqueda: 0 = el nombre EMPIEZA por `q`; 1 = el nombre la contiene; 2 = solo la descripción o el nombre
 * de la categoría; `null` = no coincide. `needle` ya plegado.
 */
export function searchGroup(
  product: { name: string; description: string | null },
  categoryName: string,
  needle: string,
): 0 | 1 | 2 | null {
  const name = foldText(product.name);
  if (name.startsWith(needle)) return 0;
  if (name.includes(needle)) return 1;
  if (foldText(product.description ?? '').includes(needle)) return 2;
  if (foldText(categoryName).includes(needle)) return 2;
  return null;
}

// ── Tiempo ─────────────────────────────────────────────────────────────────────────────────────

/** El menor instante no nulo (ISO) de la lista; `null` si no hay. */
export function earliestInstant(values: readonly (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const value of values) {
    if (!value) continue;
    if (best === null || Date.parse(value) < Date.parse(best)) best = value;
  }
  return best;
}

// ── Construcción CANÓNICA de la solicitud (orden fijo, sin valores por defecto) ────────────────

export type StoreMenuSort = 'menu' | 'name' | 'price';
export type StoreMenuOrder = 'asc' | 'desc';

export interface StoreMenuParams {
  /** `null`/`undefined` = sin sucursal (precios base, `available=null`). */
  branchId?: string | null;
  /** Slug de una categoría visible (incluye descendientes visibles). */
  categorySlug?: string;
  /** `true` = solo disponibles (exige sucursal). `false`/ausente = todos. */
  available?: boolean;
  sort?: StoreMenuSort;
  order?: StoreMenuOrder;
  page?: number;
  pageSize?: number;
}

/**
 * Query del menú: orden fijo de claves; omite lo que es el valor por defecto del servidor (`sort=menu`, `order=asc`, `page=1`,
 * `pageSize=100`, `available=false`) para que dos solicitudes equivalentes tengan LA MISMA URL (clave de CDN). `order` solo aplica
 * con `name`/`price`.
 */
export function storeMenuQuery(params: StoreMenuParams): Query {
  const sort = params.sort ?? 'menu';
  const order = sort === 'menu' ? 'asc' : (params.order ?? 'asc');
  const pageSize = params.pageSize ?? STORE_MENU_PAGE_SIZE_DEFAULT;
  return {
    branchId: params.branchId ?? undefined,
    categorySlug: params.categorySlug || undefined,
    available: params.available ? true : undefined,
    sort: sort === 'menu' ? undefined : sort,
    order: order === 'asc' ? undefined : order,
    page: params.page && params.page > 1 ? params.page : undefined,
    pageSize: pageSize === STORE_MENU_PAGE_SIZE_DEFAULT ? undefined : pageSize,
  };
}

export interface StoreSearchParams {
  q: string;
  branchId?: string | null;
  categorySlug?: string;
  available?: boolean;
  page?: number;
  pageSize?: number;
}

/** Query de la búsqueda: `q` canónica, orden fijo y sin valores por defecto (`page=1`, `pageSize=20`). */
export function storeSearchQuery(params: StoreSearchParams): Query {
  const pageSize = params.pageSize ?? STORE_SEARCH_PAGE_SIZE_DEFAULT;
  return {
    q: canonicalSearchText(params.q),
    branchId: params.branchId ?? undefined,
    categorySlug: params.categorySlug || undefined,
    available: params.available ? true : undefined,
    page: params.page && params.page > 1 ? params.page : undefined,
    pageSize: pageSize === STORE_SEARCH_PAGE_SIZE_DEFAULT ? undefined : pageSize,
  };
}

/** Siguiente página de una búsqueda («Ver más»); `undefined` al llegar al final o al tope de páginas. */
export function nextSearchPage(page: { page: number; pageSize: number; total: number }) {
  return page.page * page.pageSize < page.total && page.page < STORE_SEARCH_PAGE_MAX
    ? page.page + 1
    : undefined;
}
