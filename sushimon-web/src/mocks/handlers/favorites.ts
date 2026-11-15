import type {
  CustomerFavorites,
  FavoriteItem,
  FavoriteProductStatus,
  FavoriteProductSummary,
} from '@/lib/data-access/models';
import { badRequest, failCode } from '../domain';
import type { FavoriteRecord, MockStore, ProductRecord } from '../store';
import { now, requireCustomer, type Handler, type Req } from './shared';

/**
 * F06 — Favoritos del cliente (spec 010). El mock EMULA al servidor:
 *  - propietario = la cuenta de la sesión (aislamiento por correo: el store guarda un registro por cuenta);
 *  - `GET` devuelve `favoriteProductIds` COMPLETOS + una página de `items` (`pageSize=0` ⇒ sin items y sin consultar el
 *    catálogo); 400 con página/tamaño fuera de rango o parámetros desconocidos;
 *  - `PUT` idempotente (204 también si ya era favorito, sin cambiar `addedAt`): catálogo no disponible ⇒ 503
 *    `CATALOG_UNAVAILABLE` (sin escribir); producto inexistente/no publicado ⇒ 404 `PRODUCT_NOT_FOUND`; tope de
 *    200 con producto nuevo ⇒ 422 `FAVORITES_LIMIT_REACHED`, y 503 `FAVORITES_BUSY` (reintentable, simulado con
 *    `store.favoritesBusy`). El catálogo se evalúa ANTES que el tope;
 *  - `DELETE` idempotente (204 exista o no) y NO consulta el catálogo.
 * Desviación documentada (D19): en MOCK_ONLY el id de producto es el slug del fixture, no un UUID; se valida por
 * existencia en el catálogo mock (no por formato). NO simula throttling (429), `Cache-Control` ni la fila `addedAt`
 * con precisión de BD. El resumen no lleva precio ni disponibilidad por sucursal (lo resuelve el catálogo).
 */

/** Tope técnico por cliente (igual que `MAX_FAVORITES_PER_CUSTOMER` de la API). */
export const MAX_FAVORITES = 200;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_PAGE = 10_000;

/** Estado del producto frente al catálogo mock: sin categoría visible = despublicado; sin sucursal que lo ofrezca = no pedible. */
function statusOf(store: MockStore, productId: string): FavoriteProductStatus {
  const product = store.products.find((p) => p.id === productId);
  if (!product) return 'REMOVED';
  const visible = store.categories.some((c) => c.id === product.categoryId && c.visible);
  if (!visible) return 'INACTIVE';
  return product.availability.some((a) => a.available) ? 'ACTIVE' : 'UNAVAILABLE';
}

/** Resumen público MÍNIMO (lista blanca): sin precio, disponibilidad, descripción ni banderas internas. */
function summaryOf(product: ProductRecord): FavoriteProductSummary {
  return {
    id: product.id,
    name: product.name,
    nameEn: product.nameEn ?? null,
    imageUrl: null,
    categoryId: product.categoryId,
  };
}

/** `created_at DESC, product_id ASC` (determinista). */
const byRecency = (a: FavoriteRecord, b: FavoriteRecord) =>
  b.addedAt.localeCompare(a.addedAt) || a.productId.localeCompare(b.productId);

/** Entero estricto (solo dígitos) o `null`: `''`, `1.5` o `1e2` no son válidos (como la API). */
const strictInt = (raw: string | null, fallback: number): number | null =>
  raw === null ? fallback : /^\d{1,9}$/.test(raw) ? Number(raw) : null;

function pagination(req: Req): { page: number; pageSize: number } {
  const problems: string[] = [];
  for (const key of new Set(req.query.keys())) {
    if (key !== 'page' && key !== 'pageSize') problems.push(`property ${key} should not exist`);
  }
  const page = strictInt(req.query.get('page'), 1);
  const pageSize = strictInt(req.query.get('pageSize'), DEFAULT_PAGE_SIZE);
  if (page === null || page < 1 || page > MAX_PAGE) problems.push('page: entre 1 y 10000');
  if (pageSize === null || pageSize > MAX_PAGE_SIZE) problems.push('pageSize: entre 0 y 50');
  if (problems.length) badRequest(problems);
  return { page: page as number, pageSize: pageSize as number };
}

/** GET /v1/me/favorites?page&pageSize */
export const listMyFavorites: Handler = (req): CustomerFavorites => {
  const account = requireCustomer(req);
  const { page, pageSize } = pagination(req);
  const sorted = [...account.favorites].sort(byRecency);
  const base = {
    page,
    pageSize,
    total: sorted.length,
    favoriteProductIds: sorted.map((f) => f.productId),
    limit: MAX_FAVORITES,
  };
  const start = (page - 1) * pageSize;
  const slice = pageSize === 0 ? [] : sorted.slice(start, start + pageSize);
  if (slice.length === 0) return { ...base, items: [], catalogStatus: 'AVAILABLE' };

  if (req.store.favoritesCatalog === 'unavailable') {
    // Catálogo caído: los ids/total/fechas siguen siendo reales; nunca se inventan datos de producto.
    return {
      ...base,
      catalogStatus: 'UNAVAILABLE',
      items: slice.map((f): FavoriteItem => ({
        productId: f.productId,
        addedAt: f.addedAt,
        status: 'UNKNOWN',
        product: null,
      })),
    };
  }
  return {
    ...base,
    catalogStatus: 'AVAILABLE',
    items: slice.map((f): FavoriteItem => {
      const status = statusOf(req.store, f.productId);
      const product = req.store.products.find((p) => p.id === f.productId);
      const visible = status === 'ACTIVE' || status === 'UNAVAILABLE';
      return {
        productId: f.productId,
        addedAt: f.addedAt,
        status,
        product: visible && product ? summaryOf(product) : null,
      };
    }),
  };
};

/** PUT /v1/me/favorites/:productId → 204 */
export const addMyFavorite: Handler = (req) => {
  const account = requireCustomer(req);
  const productId = req.params.productId ?? '';
  if (req.store.favoritesCatalog === 'unavailable') {
    failCode(503, 'CATALOG_UNAVAILABLE', 'El catálogo no está disponible por ahora');
  }
  const status = statusOf(req.store, productId);
  if (status !== 'ACTIVE' && status !== 'UNAVAILABLE') {
    failCode(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');
  }
  // Candado/tiempo de la transacción agotados (tras validar el catálogo): reintentable, no se guardó nada.
  if ((req.store.favoritesBusy ?? 0) > 0) {
    req.store.favoritesBusy = (req.store.favoritesBusy ?? 0) - 1;
    failCode(
      503,
      'FAVORITES_BUSY',
      'Estamos procesando muchos cambios; reintenta en unos segundos',
    );
  }
  if (account.favorites.some((f) => f.productId === productId)) return undefined;
  if (account.favorites.length >= MAX_FAVORITES) {
    failCode(422, 'FAVORITES_LIMIT_REACHED', `Alcanzaste el máximo de ${MAX_FAVORITES} favoritos`);
  }
  account.favorites.push({ productId, addedAt: now(req).toISOString() });
  return undefined;
};

/** DELETE /v1/me/favorites/:productId → 204 (exista o no; no usa el catálogo) */
export const removeMyFavorite: Handler = (req) => {
  const account = requireCustomer(req);
  account.favorites = account.favorites.filter((f) => f.productId !== req.params.productId);
  return undefined;
};
