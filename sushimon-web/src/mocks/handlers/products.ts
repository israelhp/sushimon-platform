import type {
  AdminProduct,
  AdminProductMedia,
  AdminProductPage,
  PublicProduct,
  PublicProductCategoryRef,
  PublicProductDetail,
  PublicProductPage,
  SimulatedProductExtras,
} from '@/lib/data-access/models';
import { ancestorsOf, descendantIds, isEffectivelyVisible } from '@/lib/category-tree';
import { SIMULATED_MEDIA_HOST } from '@/lib/media-rules';
import { artForCategorySlugs, isFoodArt } from '@/lib/product-decor';
import {
  PRODUCT_ALT_MAX,
  PRODUCT_DESCRIPTION_MAX,
  PRODUCT_MEDIA_MAX,
  PRODUCT_NAME_MAX,
  PRODUCT_PAGE_MAX,
  PRODUCT_PAGE_SIZE_MAX,
  PRODUCT_SEARCH_MAX,
  PRODUCT_SLUG_MAX,
  PRODUCT_SLUG_PATTERN,
  hasDisallowedControlChars,
  isValidMediaUrl,
  isValidSku,
  normalizeProductName,
  normalizeSku,
  priceToCents,
  slugifyProductName,
  uniqueSlug,
} from '@/lib/product-rules';
import { badRequest, fail, failCode } from '../domain';
import type { CategoryRecord } from '../fixtures/categories';
import type { MockStore, ProductRecord } from '../store';
import { assetPublicUrl } from './media';
import { offerableGroupsOf } from './modifiers';
import { now, requireStaff, type Handler, type Req } from './shared';

/**
 * F11 — Productos y fichas (spec 012). El mock EMULA al servidor: lectura pública solo de productos ACTIVOS cuya categoría es
 * efectivamente visible (F10), con `q` (SOLO nombre y descripción, sin acentos ni mayúsculas, comodines literales; el SKU ni se busca ni se
 * devuelve; en admin `q` también busca slug y SKU), `categorySlug` con descendientes visibles, paginación `page`/`pageSize ≤ 100` y orden `name, id`; ficha con
 * `categoryAncestors` (404 `PRODUCT_NOT_FOUND` si no existe, está inactivo o su categoría está oculta); administración con
 * permisos `catalog.read|create|update` y 403 en escrituras sin alcance GLOBAL; 400 de forma (propiedades desconocidas, cuerpo
 * vacío en PATCH, precio/nombre/slug/SKU inválidos), 404, 409 `PRODUCT_SLUG_TAKEN` | `PRODUCT_SKU_TAKEN`, 422
 * `PRODUCT_CATEGORY_INVALID` | `PRODUCT_MEDIA_INVALID` y 503 `PRODUCTS_BUSY` (determinista, `store.productsBusy`). `media`
 * reemplaza la lista. NO simula auditoría, cabeceras de caché, throttling ni la forma UUID (los ids del mock son legibles).
 * Sin DELETE: solo se desactiva.
 *
 * Al final del archivo, lo SIMULADO que F11 no provee (ilustración, destacado, textos en inglés): solo `/v1/demo/*`.
 */

// ── Visibilidad ────────────────────────────────────────────────────────────────────────────

/** Visible = producto activo Y categoría efectivamente visible (ella y todos sus ancestros activos). */
export const isProductVisible = (store: MockStore, p: ProductRecord): boolean =>
  p.active && isEffectivelyVisible(store.menuCategories, p.categoryId);

const categoryOf = (store: MockStore, id: string): CategoryRecord | undefined =>
  store.menuCategories.find((c) => c.id === id);

const refOf = (c: Pick<CategoryRecord, 'id' | 'slug' | 'name'>): PublicProductCategoryRef => ({
  id: c.id,
  slug: c.slug,
  name: c.name,
});

const bySort = (a: AdminProductMedia, b: AdminProductMedia) => a.sortOrder - b.sortOrder;

function publicView(store: MockStore, p: ProductRecord): PublicProduct {
  const category = categoryOf(store, p.categoryId);
  if (!category) fail(500, 'Producto con categoría inexistente');
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    basePrice: p.basePrice,
    category: refOf(category),
    media: [...p.media].sort(bySort).map((m) => ({ url: m.url, altText: m.altText })),
  };
}

function adminView(store: MockStore, p: ProductRecord): AdminProduct {
  const category = categoryOf(store, p.categoryId);
  if (!category) fail(500, 'Producto con categoría inexistente');
  const effectivelyVisible = isEffectivelyVisible(store.menuCategories, category.id);
  return {
    id: p.id,
    sku: p.sku,
    slug: p.slug,
    name: p.name,
    description: p.description,
    basePrice: p.basePrice,
    categoryId: p.categoryId,
    category: {
      id: category.id,
      slug: category.slug,
      name: category.name,
      active: category.active,
      effectivelyVisible,
    },
    active: p.active,
    publiclyVisible: p.active && effectivelyVisible,
    media: [...p.media].sort(bySort).map((m) => ({ ...m })),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

// ── Consultas ──────────────────────────────────────────────────────────────────────────────

const foldText = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Entero estricto (solo dígitos) o `null`. */
const strictInt = (raw: string | null, fallback: number): number | null =>
  raw === null ? fallback : /^\d{1,9}$/.test(raw) ? Number(raw) : null;

function pagination(req: Req, problems: string[]): { page: number; pageSize: number } {
  const page = strictInt(req.query.get('page'), 1);
  const pageSize = strictInt(req.query.get('pageSize'), 20);
  if (page === null || page < 1 || page > PRODUCT_PAGE_MAX)
    problems.push(`page: entre 1 y ${PRODUCT_PAGE_MAX}`);
  if (pageSize === null || pageSize < 1 || pageSize > PRODUCT_PAGE_SIZE_MAX) {
    problems.push(`pageSize: entre 1 y ${PRODUCT_PAGE_SIZE_MAX}`);
  }
  return { page: page ?? 1, pageSize: pageSize ?? 20 };
}

function searchText(req: Req, problems: string[]): string {
  const q = req.query.get('q');
  if (q !== null && q.length > PRODUCT_SEARCH_MAX) {
    problems.push(`q: máximo ${PRODUCT_SEARCH_MAX} caracteres`);
  }
  return q ? foldText(q.trim()) : '';
}

/** Orden estable `name, id`. */
const byNameThenId = (a: ProductRecord, b: ProductRecord) =>
  a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }) || a.id.localeCompare(b.id);

function slicePage<T>(items: readonly T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

/** GET /v1/store/products?categorySlug&q&page&pageSize — público. */
export const listStoreProducts: Handler = (req): PublicProductPage => {
  const problems: string[] = [];
  const { page, pageSize } = pagination(req, problems);
  const needle = searchText(req, problems);
  const categorySlug = req.query.get('categorySlug');
  if (
    categorySlug !== null &&
    (categorySlug.length > PRODUCT_SLUG_MAX || !PRODUCT_SLUG_PATTERN.test(categorySlug))
  ) {
    problems.push('categorySlug: minúsculas, números y guiones, máx. 80');
  }
  if (problems.length > 0) badRequest(problems);
  const { store } = req;

  let scope: ReadonlySet<string> | null = null;
  if (categorySlug !== null) {
    const category = store.menuCategories.find((c) => c.slug === categorySlug);
    if (!category || !isEffectivelyVisible(store.menuCategories, category.id)) {
      return { items: [], page, pageSize, total: 0 };
    }
    scope = new Set([category.id, ...descendantIds(store.menuCategories, category.id)]);
  }
  const matches = store.products
    .filter((p) => isProductVisible(store, p))
    .filter((p) => scope === null || scope.has(p.categoryId))
    .filter(
      (p) =>
        !needle ||
        foldText(p.name).includes(needle) ||
        foldText(p.description ?? '').includes(needle),
    )
    .sort(byNameThenId);
  return {
    items: slicePage(matches, page, pageSize).map((p) => publicView(store, p)),
    page,
    pageSize,
    total: matches.length,
  };
};

/** GET /v1/store/products/:slug — público. */
export const getStoreProduct: Handler = (req): PublicProductDetail => {
  const slug = req.params.slug ?? '';
  if (slug.length > PRODUCT_SLUG_MAX || !PRODUCT_SLUG_PATTERN.test(slug)) {
    badRequest(['slug: forma inválida']);
  }
  const { store } = req;
  const product = store.products.find((p) => p.slug === slug);
  if (!product || !isProductVisible(store, product)) {
    failCode(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');
  }
  const ancestors = ancestorsOf(store.menuCategories, product.categoryId).reverse();
  return {
    ...publicView(store, product),
    categoryAncestors: ancestors.map(refOf),
    // F12: solo grupos ofrecibles y opciones activas (la lista pública no los incluye).
    modifierGroups: offerableGroupsOf(store, product.id),
  };
};

// ── Autorización ───────────────────────────────────────────────────────────────────────────

/** Lectura: `catalog.read` con cualquier alcance (los productos son globales). */
const reader = (req: Req) => requireStaff(req, 'catalog.read');

/** Escritura: permiso + alcance GLOBAL (403 si solo tiene sucursales). */
function writer(req: Req, permission: 'catalog.create' | 'catalog.update') {
  const actor = requireStaff(req, permission);
  if (!actor.scope.allBranches) {
    fail(403, 'Los productos son globales: se requiere alcance sobre todas las sucursales');
  }
  return actor;
}

/** GET /v1/admin/products?q&categoryId&active&sort&order&page&pageSize */
export const listAdminProducts: Handler = (req): AdminProductPage => {
  reader(req);
  const problems: string[] = [];
  const { page, pageSize } = pagination(req, problems);
  const needle = searchText(req, problems);
  const activeRaw = req.query.get('active');
  if (activeRaw !== null && activeRaw !== 'true' && activeRaw !== 'false') {
    problems.push('active: debe ser true o false');
  }
  const sort = req.query.get('sort') ?? 'name';
  if (sort !== 'name' && sort !== 'basePrice' && sort !== 'createdAt') {
    problems.push('sort: name, basePrice o createdAt');
  }
  const order = req.query.get('order') ?? 'asc';
  if (order !== 'asc' && order !== 'desc') problems.push('order: asc o desc');
  if (problems.length > 0) badRequest(problems);
  const categoryId = req.query.get('categoryId');
  const { store } = req;

  const sign = order === 'desc' ? -1 : 1;
  const compare = (a: ProductRecord, b: ProductRecord): number => {
    let main = 0;
    if (sort === 'name') main = a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
    else if (sort === 'basePrice') {
      main = (priceToCents(a.basePrice) ?? 0) - (priceToCents(b.basePrice) ?? 0);
    } else main = a.createdAt.localeCompare(b.createdAt);
    // `id` desempata siempre ascendente.
    return main * sign || a.id.localeCompare(b.id);
  };
  const matches = store.products
    .filter((p) => activeRaw === null || p.active === (activeRaw === 'true'))
    .filter((p) => categoryId === null || p.categoryId === categoryId)
    .filter(
      (p) =>
        !needle ||
        foldText(p.name).includes(needle) ||
        p.slug.includes(needle) ||
        foldText(p.description ?? '').includes(needle) ||
        foldText(p.sku ?? '').includes(needle),
    )
    .sort(compare);
  return {
    items: slicePage(matches, page, pageSize).map((p) => adminView(store, p)),
    page,
    pageSize,
    total: matches.length,
  };
};

/** GET /v1/admin/products/:id */
export const getAdminProduct: Handler = (req): AdminProduct => {
  reader(req);
  const product = req.store.products.find((p) => p.id === req.params.id);
  if (!product) failCode(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');
  return adminView(req.store, product);
};

// ── Validación de forma (400) ──────────────────────────────────────────────────────────────

const rawBody = (req: Req): Record<string, unknown> => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    badRequest(['Cuerpo de la solicitud inválido']);
  }
  return req.body as Record<string, unknown>;
};

const has = (raw: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(raw, key);

interface MediaShape {
  url: string;
  altText: string | null;
}

interface Shape {
  name?: string;
  slug?: string;
  sku?: string | null;
  description?: string | null;
  basePrice?: string;
  categoryId?: string;
  active?: boolean;
  media?: MediaShape[];
}

const ALLOWED = [
  'name',
  'slug',
  'sku',
  'description',
  'basePrice',
  'categoryId',
  'active',
  'media',
] as const;

function isMediaItem(item: unknown): item is { url: string; altText?: string | null } {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const o = item as Record<string, unknown>;
  return (
    Object.keys(o).every((k) => k === 'url' || k === 'altText') &&
    typeof o.url === 'string' &&
    (o.altText === undefined || o.altText === null || typeof o.altText === 'string')
  );
}

function parseShape(raw: Record<string, unknown>): Shape {
  const problems: string[] = [];
  for (const key of Object.keys(raw)) {
    if (!(ALLOWED as readonly string[]).includes(key)) problems.push(`${key}: campo no permitido`);
  }
  const out: Shape = {};
  if (has(raw, 'name')) {
    if (typeof raw.name !== 'string') problems.push('name: debe ser texto');
    else {
      const name = normalizeProductName(raw.name);
      if (name.length < 1 || name.length > PRODUCT_NAME_MAX) {
        problems.push(`name: entre 1 y ${PRODUCT_NAME_MAX} caracteres`);
      } else out.name = name;
    }
  }
  if (has(raw, 'slug')) {
    if (
      typeof raw.slug !== 'string' ||
      raw.slug.length > PRODUCT_SLUG_MAX ||
      !PRODUCT_SLUG_PATTERN.test(raw.slug)
    ) {
      problems.push('slug: minúsculas, números y guiones (p. ej. "roll-acevichado"), máx. 80');
    } else out.slug = raw.slug;
  }
  if (has(raw, 'sku')) {
    const sku = raw.sku;
    if (sku !== null && (typeof sku !== 'string' || !isValidSku(sku))) {
      problems.push('sku: 1 a 40 caracteres A-Z, 0-9, punto, guion o guion bajo');
    } else out.sku = sku === null ? null : normalizeSku(sku);
  }
  if (has(raw, 'description')) {
    const d = raw.description;
    if (d !== null && typeof d !== 'string') problems.push('description: debe ser texto o null');
    else if (
      typeof d === 'string' &&
      (d.length > PRODUCT_DESCRIPTION_MAX || hasDisallowedControlChars(d))
    ) {
      problems.push(`description: máximo ${PRODUCT_DESCRIPTION_MAX} caracteres, sin control`);
    } else out.description = typeof d === 'string' ? d.trim() || null : null;
  }
  if (has(raw, 'basePrice')) {
    if (typeof raw.basePrice !== 'string' || priceToCents(raw.basePrice) === null) {
      problems.push('basePrice: cadena decimal con 2 decimales, mayor a 0 y hasta 999999.99');
    } else out.basePrice = raw.basePrice;
  }
  if (has(raw, 'categoryId')) {
    if (typeof raw.categoryId !== 'string' || raw.categoryId.length === 0) {
      problems.push('categoryId: debe ser un identificador');
    } else out.categoryId = raw.categoryId;
  }
  if (has(raw, 'active')) {
    if (typeof raw.active !== 'boolean') problems.push('active: debe ser booleano');
    else out.active = raw.active;
  }
  if (has(raw, 'media')) {
    const list = raw.media;
    if (!Array.isArray(list)) problems.push('media: debe ser una lista');
    else {
      const media: MediaShape[] = [];
      list.forEach((item, i) => {
        if (!isMediaItem(item))
          problems.push(`media[${i}]: solo url (texto) y altText (texto o null)`);
        else media.push({ url: item.url, altText: item.altText ?? null });
      });
      out.media = media;
    }
  }
  if (problems.length > 0) badRequest(problems);
  return out;
}

const slugTaken = () =>
  failCode(409, 'PRODUCT_SLUG_TAKEN', 'Ya existe un producto con ese slug', [
    { path: 'slug', code: 'SLUG_TAKEN', message: 'El slug ya está en uso' },
  ]);

const skuTaken = () =>
  failCode(409, 'PRODUCT_SKU_TAKEN', 'Ya existe un producto con ese SKU', [
    { path: 'sku', code: 'SKU_TAKEN', message: 'El SKU ya está en uso' },
  ]);

/** F14: asset READY cuya URL pública coincide (enlace automático por `PATCH media`, D11). */
const readyAssetFor = (store: MockStore, url: string) =>
  store.mediaAssets.find((a) => a.status === 'READY' && assetPublicUrl(a) === url);

/** 422 `PRODUCT_MEDIA_INVALID`: más de 8, URL que no es https absoluta ≤ 2048 o `altText` > 200. */
function assertMedia(store: MockStore, media: readonly MediaShape[]): void {
  if (media.length > PRODUCT_MEDIA_MAX) {
    failCode(422, 'PRODUCT_MEDIA_INVALID', `Máximo ${PRODUCT_MEDIA_MAX} imágenes por producto`);
  }
  media.forEach((m, i) => {
    if (!isValidMediaUrl(m.url)) {
      failCode(422, 'PRODUCT_MEDIA_INVALID', 'Cada imagen debe ser una URL https válida', [
        { path: `media[${i}].url`, code: 'URL_INVALID', message: 'URL https inválida' },
      ]);
    }
    // F14 (D11): una URL bajo el host de medios sin asset READY es inválida (no se aceptan URLs de R2 «sueltas»).
    if (new URL(m.url).hostname === SIMULATED_MEDIA_HOST && !readyAssetFor(store, m.url)) {
      failCode(422, 'PRODUCT_MEDIA_INVALID', 'La imagen no corresponde a un archivo confirmado', [
        { path: `media[${i}].url`, code: 'ASSET_NOT_FOUND', message: 'Imagen sin confirmar' },
      ]);
    }
    if (m.altText !== null && m.altText.length > PRODUCT_ALT_MAX) {
      failCode(
        422,
        'PRODUCT_MEDIA_INVALID',
        `El texto alternativo admite hasta ${PRODUCT_ALT_MAX} caracteres`,
        [{ path: `media[${i}].altText`, code: 'ALT_TOO_LONG', message: 'Texto alternativo largo' }],
      );
    }
  });
}

/** 422 `PRODUCT_CATEGORY_INVALID`: la categoría debe existir y estar ACTIVA (no se exige visibilidad efectiva). */
function assertCategory(store: MockStore, categoryId: string): void {
  const category = categoryOf(store, categoryId);
  if (!category || !category.active) {
    failCode(422, 'PRODUCT_CATEGORY_INVALID', 'La categoría no existe o está inactiva');
  }
}

function toMedia(store: MockStore, media: readonly MediaShape[]): AdminProductMedia[] {
  return media.map((m, index) => ({
    id: `media-${store.sequences.media++}`,
    url: m.url,
    altText: m.altText,
    sortOrder: index,
    assetId: readyAssetFor(store, m.url)?.id ?? null,
  }));
}

/** Simulación determinista de `PRODUCTS_BUSY` (la transacción de escritura agotó su tiempo; no se guardó nada). */
function maybeBusy(store: MockStore): void {
  if ((store.productsBusy ?? 0) > 0) {
    store.productsBusy = (store.productsBusy ?? 0) - 1;
    failCode(503, 'PRODUCTS_BUSY', 'Hay otra edición en curso; reintenta en unos segundos');
  }
}

// ── Escritura ──────────────────────────────────────────────────────────────────────────────

/** POST /v1/admin/products */
export const createAdminProduct: Handler = (req): AdminProduct => {
  writer(req, 'catalog.create');
  const input = parseShape(rawBody(req));
  const missing = (['name', 'basePrice', 'categoryId'] as const).filter(
    (k) => input[k] === undefined,
  );
  if (missing.length > 0) badRequest(missing.map((k) => `${k}: obligatorio`));
  const { store } = req;
  assertCategory(store, input.categoryId as string);
  assertMedia(store, input.media ?? []);
  const taken = new Set(store.products.map((p) => p.slug));
  let slug: string;
  if (input.slug !== undefined) {
    if (taken.has(input.slug)) slugTaken();
    slug = input.slug;
  } else {
    slug = uniqueSlug(
      slugifyProductName(input.name as string) || `producto-${store.sequences.product}`,
      taken,
    );
  }
  const sku = input.sku ?? null;
  if (sku !== null && store.products.some((p) => p.sku === sku)) skuTaken();
  maybeBusy(store);

  const category = categoryOf(store, input.categoryId as string);
  const slugs = [
    ...(category ? [category.slug] : []),
    ...ancestorsOf(store.menuCategories, input.categoryId as string).map((c) => c.slug),
  ];
  const art = artForCategorySlugs(slugs);
  const stamp = now(req).toISOString();
  const record: ProductRecord = {
    id: `prod-${slug}-${store.sequences.product}`,
    slug,
    sku,
    name: input.name as string,
    description: input.description ?? null,
    basePrice: input.basePrice as string,
    categoryId: input.categoryId as string,
    active: input.active ?? true,
    media: toMedia(store, input.media ?? []),
    createdAt: stamp,
    updatedAt: stamp,
    // SIMULADO: valores por defecto de lo que F11 no modela.
    illustration: art,
    featured: false,
    food: isFoodArt(art),
  };
  store.sequences.product++;
  store.products.push(record);
  return adminView(store, record);
};

const sameMedia = (current: readonly AdminProductMedia[], next: readonly MediaShape[]): boolean => {
  const sorted = [...current].sort(bySort);
  return (
    sorted.length === next.length &&
    sorted.every((m, i) => m.url === next[i]?.url && m.altText === next[i]?.altText)
  );
};

/** PATCH /v1/admin/products/:id — parcial; activar/desactivar y reemplazar imágenes; sin cambios => 200 sin tocar. */
export const updateAdminProduct: Handler = (req): AdminProduct => {
  writer(req, 'catalog.update');
  const raw = rawBody(req);
  if (Object.keys(raw).length === 0) badRequest(['Envía al menos un campo']);
  const input = parseShape(raw);
  const { store } = req;
  const current = store.products.find((p) => p.id === req.params.id);
  if (!current) failCode(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');

  if (input.categoryId !== undefined && input.categoryId !== current.categoryId) {
    assertCategory(store, input.categoryId);
  }
  if (input.media !== undefined) assertMedia(store, input.media);
  if (
    input.slug !== undefined &&
    input.slug !== current.slug &&
    store.products.some((p) => p.id !== current.id && p.slug === input.slug)
  ) {
    slugTaken();
  }
  if (
    input.sku !== undefined &&
    input.sku !== null &&
    input.sku !== current.sku &&
    store.products.some((p) => p.id !== current.id && p.sku === input.sku)
  ) {
    skuTaken();
  }

  const patch: Partial<ProductRecord> = {};
  if (input.name !== undefined && input.name !== current.name) patch.name = input.name;
  if (input.slug !== undefined && input.slug !== current.slug) patch.slug = input.slug;
  if (input.sku !== undefined && input.sku !== current.sku) patch.sku = input.sku;
  if (input.description !== undefined && input.description !== current.description) {
    patch.description = input.description;
  }
  if (input.basePrice !== undefined && input.basePrice !== current.basePrice) {
    patch.basePrice = input.basePrice;
  }
  if (input.categoryId !== undefined && input.categoryId !== current.categoryId) {
    patch.categoryId = input.categoryId;
  }
  if (input.active !== undefined && input.active !== current.active) patch.active = input.active;
  const mediaChanged = input.media !== undefined && !sameMedia(current.media, input.media);
  if (Object.keys(patch).length > 0 || mediaChanged) {
    maybeBusy(store);
    Object.assign(current, patch, { updatedAt: now(req).toISOString() });
    if (mediaChanged && input.media) current.media = toMedia(store, input.media);
  }
  return adminView(store, current);
};

// ── SIMULADO: lo que F11 no provee (solo /v1/demo/*; nunca existe en la API real) ─────────────

function extrasOf(p: ProductRecord): SimulatedProductExtras {
  return {
    productId: p.id,
    nameEn: p.nameEn,
    descriptionEn: p.descriptionEn,
    illustration: p.illustration,
    featured: p.featured,
    food: p.food,
  };
}

/** GET /v1/demo/catalog/product-extras — ilustración, destacado y textos en inglés (la disponibilidad ya es F13, contrato). */
export const listProductExtras: Handler = (req): { items: SimulatedProductExtras[] } => ({
  items: req.store.products.map((p) => extrasOf(p)),
});
