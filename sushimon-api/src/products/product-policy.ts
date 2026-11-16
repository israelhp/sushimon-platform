import { BadRequestException, HttpStatus } from '@nestjs/common';
import type { AuditValues } from '../audit/audit.service.js';
import type { PublicCategoryView } from '../categories/categories.types.js';
import { codedException } from '../common/errors/coded-exception.js';
import { SLUG_MAX, SLUG_PATTERN, slugifyText, uniqueSlug } from '../common/text/slug.js';
import type {
  AdminProductCategoryView,
  AdminProductView,
  CategoryRef,
  MediaInput,
  MediaRow,
  ProductRow,
  PublicProductDetailView,
  PublicProductView,
} from './products.types.js';

/** Reglas de dominio de productos: funciones puras, sin I/O (spec F11 D1-D7). */

export const NAME_MAX = 120;
export const DESCRIPTION_MAX = 2000;
export const SKU_MAX = 40;
export const SKU_PATTERN = /^[A-Z0-9][A-Z0-9._-]*$/;
export const MEDIA_MAX = 8;
export const MEDIA_URL_MAX = 2048;
export const MEDIA_ALT_MAX = 200;
export const SEARCH_MAX = 80;
export const PRICE_PATTERN = /^[0-9]{1,6}\.[0-9]{2}$/;
const MAX_CENTS = 99_999_999; // 999999.99
export { SLUG_MAX, SLUG_PATTERN, uniqueSlug };

const fail = (message: string): never => {
  throw new BadRequestException([message]);
};

export const slugTaken = () =>
  codedException(HttpStatus.CONFLICT, 'PRODUCT_SLUG_TAKEN', 'Ya existe un producto con ese slug');
export const skuTaken = () =>
  codedException(HttpStatus.CONFLICT, 'PRODUCT_SKU_TAKEN', 'Ya existe un producto con ese SKU');
export const categoryInvalid = (message: string) =>
  codedException(HttpStatus.UNPROCESSABLE_ENTITY, 'PRODUCT_CATEGORY_INVALID', message);
export const notFound = () =>
  codedException(HttpStatus.NOT_FOUND, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');

const mediaInvalid = (path: string, message: string) =>
  codedException(HttpStatus.UNPROCESSABLE_ENTITY, 'PRODUCT_MEDIA_INVALID', message, [
    { path, code: 'PRODUCT_MEDIA_INVALID', message },
  ]);

// ---------- normalización ----------

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

export function normalizeName(raw: string): string {
  const name = raw.normalize('NFC').replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
  if (name === '') return fail('name no puede estar vacío');
  if (name.length > NAME_MAX) return fail(`name no puede superar ${NAME_MAX} caracteres`);
  return name;
}

/** Texto plano. Vacío/null = sin descripción. Conserva saltos de línea; quita el resto de caracteres de control. */
export function normalizeDescription(raw: string | null): string | null {
  if (raw === null) return null;
  const text = raw
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, '')
    .trim();
  if (text === '') return null;
  if (text.length > DESCRIPTION_MAX)
    return fail(`description no puede superar ${DESCRIPTION_MAX} caracteres`);
  return text;
}

export function normalizeSlug(raw: string): string {
  const slug = raw.trim().toLowerCase();
  if (slug === '' || slug.length > SLUG_MAX)
    return fail(`slug debe tener entre 1 y ${SLUG_MAX} caracteres`);
  if (!SLUG_PATTERN.test(slug))
    return fail('slug solo admite minúsculas, números y guiones simples entre grupos');
  return slug;
}

/** Slug base desde el nombre (sin caracteres útiles => `producto`). */
export const slugify = (name: string): string => slugifyText(name, 'producto');

/** Prefijo común de todos los candidatos de `uniqueSlug(base, …)`: sirve para leer los slugs ocupados en una consulta. */
export const slugSearchPrefix = (base: string): string =>
  base.slice(0, SLUG_MAX - 8).replace(/-+$/g, '') || base.slice(0, 1);

/** `null` borra el SKU. Se guarda en mayúsculas. */
export function normalizeSku(raw: string | null): string | null {
  if (raw === null) return null;
  const sku = raw.trim().toUpperCase();
  if (sku === '' || sku.length > SKU_MAX)
    return fail(`sku debe tener entre 1 y ${SKU_MAX} caracteres`);
  if (!SKU_PATTERN.test(sku))
    return fail('sku solo admite letras, números, punto, guion y guion bajo');
  return sku;
}

// ---------- precio (aritmética entera sobre centavos; nunca Number decimal) ----------

export function parsePriceCents(raw: unknown): number {
  if (typeof raw !== 'string' || !PRICE_PATTERN.test(raw))
    return fail('basePrice debe ser un importe decimal con 2 decimales, p. ej. "85.00"');
  const [whole = '0', frac = '00'] = raw.split('.');
  const cents = Number(whole) * 100 + Number(frac);
  if (cents <= 0 || cents > MAX_CENTS)
    return fail('basePrice debe ser mayor que 0 y como máximo 999999.99');
  return cents;
}

export const formatCents = (cents: number): string =>
  `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

/** Forma canónica `"85.00"` (sin ceros a la izquierda). */
export const normalizePrice = (raw: unknown): string => formatCents(parsePriceCents(raw));

// ---------- imágenes ----------

// eslint-disable-next-line no-control-regex
const MEDIA_URL_RE = /^https:\/\/[^\s\u0000-\u001F\u007F-\u009F]+$/;

/** `localhost` o cualquier `*.localhost`. */
const isLocalhost = (host: string): boolean => host === 'localhost' || host.endsWith('.localhost');

/** Host con forma de IPv4 (el parser WHATWG ya normaliza `0x7f.1`, enteros, etc. a punto decimal) o IPv6 (`[..]`). */
const isIpLiteral = (host: string): boolean => host.startsWith('[') || /^[0-9.]+$/.test(host);

/** Lista de hosts permitidos: `cdn.x.com` = exacto; `.x.com` = subdominios. Vacía = cualquiera (público). */
export function hostAllowed(host: string, allowed: readonly string[]): boolean {
  if (allowed.length === 0) return true;
  return allowed.some((entry) =>
    entry.startsWith('.') ? host.endsWith(entry) && host.length > entry.length : host === entry,
  );
}

function normalizeMediaItem(
  item: { url: unknown; altText?: unknown },
  index: number,
  allowedHosts: readonly string[],
): MediaInput {
  const at = `media[${index}]`;
  const raw = item.url;
  if (typeof raw !== 'string' || raw.length > MEDIA_URL_MAX || !MEDIA_URL_RE.test(raw))
    throw mediaInvalid(
      `${at}.url`,
      'La URL debe ser https, sin espacios y de hasta 2048 caracteres',
    );
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw mediaInvalid(`${at}.url`, 'La URL no es válida');
  }
  if (parsed.protocol !== 'https:' || parsed.hostname === '' || parsed.username || parsed.password)
    throw mediaInvalid(`${at}.url`, 'La URL debe ser https absoluta y sin credenciales');
  const host = parsed.hostname.toLowerCase();
  if (isIpLiteral(host) || isLocalhost(host) || !host.includes('.'))
    throw mediaInvalid(`${at}.url`, 'El host de la URL debe ser un nombre de dominio público');
  if (!hostAllowed(host, allowedHosts))
    throw mediaInvalid(`${at}.url`, 'El host de la URL no está permitido');
  // Se guarda la forma normalizada (href) y se vuelve a exigir el tope tras normalizar.
  const url = parsed.href;
  if (url.length > MEDIA_URL_MAX || !MEDIA_URL_RE.test(url))
    throw mediaInvalid(
      `${at}.url`,
      'La URL debe ser https, sin espacios y de hasta 2048 caracteres',
    );
  let altText: string | null = null;
  if (item.altText !== undefined && item.altText !== null) {
    if (typeof item.altText !== 'string') throw mediaInvalid(`${at}.altText`, 'altText inválido');
    const alt = item.altText
      .normalize('NFC')
      .replace(CONTROL_CHARS, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (alt.length > MEDIA_ALT_MAX)
      throw mediaInvalid(`${at}.altText`, `altText no puede superar ${MEDIA_ALT_MAX} caracteres`);
    altText = alt === '' ? null : alt;
  }
  return { url, altText };
}

/**
 * Lista ordenada (el orden define `sortOrder`). Más de 8, un elemento inválido o un host fuera de `allowedHosts`
 * (cuando se define) => 422 `PRODUCT_MEDIA_INVALID`. IP literales, `localhost` y hostnames sin punto se rechazan siempre.
 */
export function normalizeMedia(
  list: readonly { url: unknown; altText?: unknown }[],
  allowedHosts: readonly string[] = [],
): MediaInput[] {
  if (list.length > MEDIA_MAX)
    throw mediaInvalid('media', `Un producto admite como máximo ${MEDIA_MAX} imágenes`);
  return list.map((item, index) => normalizeMediaItem(item, index, allowedHosts));
}

// ---------- búsqueda ----------

/** Minúsculas y sin diacríticos (misma regla que la expresión SQL: ver `SQL_ACCENTS_FROM/TO`). */
export const fold = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Pares usados por `translate()` en SQL: deben coincidir con `fold` para los caracteres latinos habituales. */
export const SQL_ACCENTS_FROM = 'ÁÀÄÂÃÅáàäâãåÉÈËÊéèëêÍÌÏÎíìïîÓÒÖÔÕóòöôõÚÙÜÛúùüûÑñÇç';
export const SQL_ACCENTS_TO = 'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuNnCc';

/** Escapa `\`, `%` y `_` para que valgan como texto literal en `LIKE ... ESCAPE '\'`. */
export const escapeLike = (text: string): string => text.replace(/[\\%_]/g, '\\$&');

/**
 * Patrón `LIKE` (contiene, sin mayúsculas ni acentos, comodines literales) o `null` si `q` está vacío.
 * Quita caracteres de control (PostgreSQL rechaza NUL en texto) y recorta; > 80 caracteres => 400.
 */
export function buildSearchPattern(q: string | undefined): string | null {
  if (q === undefined) return null;
  const text = q.replace(CONTROL_CHARS, ' ').trim();
  if (text === '') return null;
  if (text.length > SEARCH_MAX) return fail(`q no puede superar ${SEARCH_MAX} caracteres`);
  return `%${escapeLike(fold(text))}%`;
}

// ---------- categorías visibles ----------

export interface VisibleCategoryInfo {
  ref: CategoryRef;
  /** Raíz → padre. */
  ancestors: CategoryRef[];
}

/** id → categoría visible con sus ancestros (el árbol ya trae solo categorías visibles). */
export function indexVisibleTree(
  tree: readonly PublicCategoryView[],
): Map<string, VisibleCategoryInfo> {
  const out = new Map<string, VisibleCategoryInfo>();
  const walk = (list: readonly PublicCategoryView[], ancestors: CategoryRef[]): void => {
    for (const node of list) {
      const ref = { id: node.id, slug: node.slug, name: node.name };
      out.set(node.id, { ref, ancestors });
      walk(node.children, [...ancestors, ref]);
    }
  };
  walk(tree, []);
  return out;
}

/** Ids de la categoría visible con ese slug y de todas sus descendientes visibles; `null` si no es visible. */
export function subtreeIdsBySlug(
  tree: readonly PublicCategoryView[],
  slug: string,
): string[] | null {
  const collect = (node: PublicCategoryView, out: string[]): string[] => {
    out.push(node.id);
    for (const child of node.children) collect(child, out);
    return out;
  };
  const find = (list: readonly PublicCategoryView[]): PublicCategoryView | null => {
    for (const node of list) {
      if (node.slug === slug) return node;
      const inner = find(node.children);
      if (inner) return inner;
    }
    return null;
  };
  const node = find(tree);
  return node ? collect(node, []) : null;
}

// ---------- vistas ----------

const mediaByProduct = (media: readonly MediaRow[]): Map<string, MediaRow[]> => {
  const map = new Map<string, MediaRow[]>();
  for (const m of [...media].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const list = map.get(m.productId);
    if (list) list.push(m);
    else map.set(m.productId, [m]);
  }
  return map;
};

export function toPublicView(
  row: ProductRow,
  category: CategoryRef,
  media: readonly MediaRow[],
): PublicProductView {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    basePrice: row.basePrice,
    category,
    media: media.map((m) => ({ url: m.url, altText: m.altText })),
  };
}

export function toPublicDetail(
  row: ProductRow,
  info: VisibleCategoryInfo,
  media: readonly MediaRow[],
  modifierGroups: PublicProductDetailView['modifierGroups'],
): PublicProductDetailView {
  return {
    ...toPublicView(row, info.ref, media),
    categoryAncestors: info.ancestors,
    modifierGroups,
  };
}

/** Une filas y media en una sola pasada (sin N+1); omite los productos cuya categoría no está en `visible`. */
export function buildPublicViews(
  rows: readonly ProductRow[],
  media: readonly MediaRow[],
  visible: ReadonlyMap<string, VisibleCategoryInfo>,
): PublicProductView[] {
  const byProduct = mediaByProduct(media);
  const out: PublicProductView[] = [];
  for (const row of rows) {
    const info = visible.get(row.categoryId);
    if (info) out.push(toPublicView(row, info.ref, byProduct.get(row.id) ?? []));
  }
  return out;
}

export function toAdminView(
  row: ProductRow,
  media: readonly MediaRow[],
  category: AdminProductCategoryView,
): AdminProductView {
  return {
    id: row.id,
    sku: row.sku,
    slug: row.slug,
    name: row.name,
    description: row.description,
    basePrice: row.basePrice,
    categoryId: row.categoryId,
    category,
    active: row.active,
    publiclyVisible: row.active && category.effectivelyVisible,
    media: [...media]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((m) => ({ id: m.id, url: m.url, altText: m.altText, sortOrder: m.sortOrder })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const groupMedia = mediaByProduct;

// ---------- actualización ----------

export interface UpdateProductInput {
  name?: string;
  slug?: string;
  sku?: string | null;
  description?: string | null;
  basePrice?: string;
  categoryId?: string;
  active?: boolean;
  media?: readonly { url: unknown; altText?: unknown }[];
}

export interface NormalizedUpdate {
  name?: string;
  slug?: string;
  sku?: string | null;
  description?: string | null;
  basePrice?: string;
  categoryId?: string;
  active?: boolean;
  media?: MediaInput[];
}

/** Normaliza lo enviado; un cuerpo sin ningún campo es 400. */
export function normalizeUpdate(
  input: UpdateProductInput,
  allowedHosts: readonly string[] = [],
): NormalizedUpdate {
  const out: NormalizedUpdate = {};
  if (input.name !== undefined) out.name = normalizeName(input.name);
  if (input.slug !== undefined) out.slug = normalizeSlug(input.slug);
  if (input.sku !== undefined) out.sku = normalizeSku(input.sku);
  if (input.description !== undefined) out.description = normalizeDescription(input.description);
  if (input.basePrice !== undefined) out.basePrice = normalizePrice(input.basePrice);
  if (input.categoryId !== undefined) out.categoryId = input.categoryId;
  if (input.active !== undefined) out.active = input.active;
  if (input.media !== undefined) out.media = normalizeMedia(input.media, allowedHosts);
  if (Object.keys(out).length === 0) return fail('Debe enviar al menos un campo a modificar');
  return out;
}

export interface ProductChanges {
  name?: string;
  slug?: string;
  sku?: string | null;
  description?: string | null;
  basePrice?: string;
  categoryId?: string;
  active?: boolean;
}

export interface ProductDiff {
  /** Columnas a escribir en `products` (sin `updatedAt`). */
  changes: ProductChanges;
  /** Lista de imágenes de reemplazo; `undefined` = no cambia. */
  media?: MediaInput[];
  /** Hay cambios distintos de `active` (justifica `product.updated`). */
  hasFieldChanges: boolean;
  oldValues: AuditValues;
  newValues: AuditValues;
}

const sameMedia = (current: readonly MediaRow[], next: readonly MediaInput[]): boolean => {
  const ordered = [...current].sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    ordered.length === next.length &&
    ordered.every((m, i) => m.url === next[i]?.url && m.altText === (next[i]?.altText ?? null))
  );
};

/** Solo lo que cambia de verdad; `null` si nada cambia. Sin PII ni texto largo: la descripción solo entra por nombre de campo. */
export function diffProduct(
  current: ProductRow,
  currentMedia: readonly MediaRow[],
  patch: NormalizedUpdate,
): ProductDiff | null {
  const changes: ProductChanges = {};
  const oldValues: AuditValues = {};
  const newValues: AuditValues = {};
  const changedFields: string[] = [];

  const scalar = ['name', 'slug', 'sku', 'basePrice', 'categoryId'] as const;
  for (const key of scalar) {
    const next = patch[key];
    if (next !== undefined && next !== current[key]) {
      (changes as Record<string, unknown>)[key] = next;
      oldValues[key] = current[key];
      newValues[key] = next;
      changedFields.push(key);
    }
  }
  if (patch.description !== undefined && patch.description !== current.description) {
    changes.description = patch.description;
    changedFields.push('description');
  }
  let media: MediaInput[] | undefined;
  if (patch.media !== undefined && !sameMedia(currentMedia, patch.media)) {
    media = patch.media;
    oldValues['mediaCount'] = currentMedia.length;
    newValues['mediaCount'] = patch.media.length;
    changedFields.push('media');
  }
  if (changedFields.length > 0) newValues['changedFields'] = changedFields;

  const hasFieldChanges = changedFields.length > 0;
  if (patch.active !== undefined && patch.active !== current.active) changes.active = patch.active;
  if (!hasFieldChanges && changes.active === undefined) return null;
  return { changes, ...(media ? { media } : {}), hasFieldChanges, oldValues, newValues };
}
