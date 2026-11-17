import type {
  PublicProductDetail,
  PublicProductMedia,
  StoreBannerList,
  StoreBootstrap,
  StoreBootstrapSection,
  StoreBranchMenu,
  StoreBranchMenuItem,
  StoreProductPromo,
  StorePromotionList,
  StoreSearchPage,
} from '@/lib/data-access/models';
import { flattenTree, isEffectivelyVisible, descendantIds } from '@/lib/category-tree';
import {
  decimalToCents,
  indicativePromoPrice,
  nextChangeAt,
  promotionTimes,
} from '@/lib/promotion-rules';
import { PRODUCT_SLUG_MAX, PRODUCT_SLUG_PATTERN, priceToCents } from '@/lib/product-rules';
import {
  STORE_BOOTSTRAP_BANNERS_MAX,
  STORE_BOOTSTRAP_CATEGORIES_MAX,
  STORE_BOOTSTRAP_PROMOTIONS_MAX,
  STORE_MENU_PAGE_MAX,
  STORE_MENU_PAGE_SIZE_DEFAULT,
  STORE_MENU_PAGE_SIZE_MAX,
  STORE_PRODUCT_PROMOTIONS_MAX,
  STORE_SEARCH_MAX,
  STORE_SEARCH_MIN,
  STORE_SEARCH_PAGE_MAX,
  STORE_SEARCH_PAGE_SIZE_DEFAULT,
  STORE_SEARCH_PAGE_SIZE_MAX,
  earliestInstant,
  foldText,
  normalizeSearchText,
  searchGroup,
  summarize,
} from '@/lib/store-rules';
import { publicTree } from '@/lib/category-tree';
import { availableAt, badRequest, effectivePriceAt, failCode } from '../domain';
import type { PromotionRecord } from '../fixtures/promotions';
import type { MockStore, ProductRecord } from '../store';
import { failBusy as failBannersBusy, publicBannerList } from './banners';
import { publicView as publicBranchView } from './branches';
import { getStoreProduct as baseGetStoreProduct, isProductVisible } from './products';
import { publicPromotionList } from './promotions';
import { publicAvailability } from './schedule';
import { now, type Handler, type Req } from './shared';

/**
 * F17 — Agregados públicos de la tienda (spec 018, ADR-0023). El mock EMULA al servidor con las MISMAS semánticas del contrato:
 * - `GET /v1/store/menu`: tarjetas paginadas (`page` ≤ 200, `pageSize` ≤ 100, por defecto 100), `branchId` OPCIONAL (sin él: precio base y
 *   `available=null`; inexistente o inactiva => 404 `BRANCH_NOT_FOUND`), filtros `categorySlug` (con descendientes visibles; desconocida
 *   => lista vacía) y `available` (`true` exige sucursal => 400), `sort=menu|name|price` + `order`, `total`, `generatedAt`, `nextChangeAt`.
 * - `GET /v1/store/search`: `q` de 2 a 80 caracteres tras recortar (control fuera, comodines literales; si no => 400), nombre/descripción/
 *   nombre de categoría sin acentos ni mayúsculas, orden ESTABLE por grupo (prefijo del nombre, contiene en el nombre, descripción o
 *   categoría) y luego `name`, `id`; `page` ≤ 20, `pageSize` ≤ 50 (por defecto 20); sin resultados = 200 vacío.
 * - `GET /v1/store/bootstrap`: sucursal, disponibilidad, categorías raíz (≤ 30), destacados (`[]`: P23 sin criterio), promociones vigentes
 *   (≤ 5, sin `items`, sin código), banners (≤ 10), `productCount`, `degraded` (secciones no críticas independientes) y `nextChangeAt`
 *   combinado (el menor entre promociones, banners y `availability.nextTransitionAt`).
 * - `GET /v1/store/products/:slug?branchId`: añade `offer`, `promotions` (≤ 3, mayor ahorro primero), `generatedAt` y `nextChangeAt`.
 * - 503 `STORE_BUSY` determinista (`store.storeBusy`: nº de lecturas que fallan). Sin datos privados (sin SKU, código, favoritos).
 * NO simula `Cache-Control`/CDN, el límite de tasa (429), la forma UUID de los ids ni el rendimiento SQL. Cuando el contrato es ambiguo
 * se anota aquí: `available=false` se trata como «sin filtro»; con `branchId` y producto inexistente gana `PRODUCT_NOT_FOUND`.
 */

// ── Utilidades ─────────────────────────────────────────────────────────────────────────────

const iso = (ms: number | Date) => new Date(ms).toISOString();

const branchNotFound = (): never => failCode(404, 'BRANCH_NOT_FOUND', 'Sucursal no encontrada');

/** 503 `STORE_BUSY` determinista y reintentable. */
function failStoreBusy(store: MockStore): void {
  if ((store.storeBusy ?? 0) > 0) {
    store.storeBusy = (store.storeBusy ?? 0) - 1;
    failCode(503, 'STORE_BUSY', 'La tienda está ocupada; reintenta en unos segundos');
  }
}

/** Sucursal ACTIVA de `branchId` (404 si no existe o está inactiva). */
function activeBranch(store: MockStore, branchId: string) {
  const branch = store.branches.find((b) => b.id === branchId && b.active);
  return branch ?? branchNotFound();
}

/** `branchId` opcional de la consulta: vacío => 400; desconocido o inactivo => 404. */
function branchParam(req: Req, problems: string[]) {
  const raw = req.query.get('branchId');
  if (raw === null) return null;
  if (raw.length === 0) {
    problems.push('branchId: vacío');
    return null;
  }
  return raw;
}

function boolParam(req: Req, name: string, problems: string[]): boolean {
  const raw = req.query.get(name);
  if (raw === null) return false;
  if (raw !== 'true' && raw !== 'false') problems.push(`${name}: debe ser true o false`);
  return raw === 'true';
}

/** Entero estricto (solo dígitos) dentro de un rango; si no, agrega el problema y devuelve el valor por defecto. */
function intParam(
  req: Req,
  name: string,
  fallback: number,
  min: number,
  max: number,
  problems: string[],
): number {
  const raw = req.query.get(name);
  if (raw === null) return fallback;
  const value = /^\d{1,9}$/.test(raw) ? Number(raw) : NaN;
  if (!(value >= min && value <= max)) {
    problems.push(`${name}: entre ${min} y ${max}`);
    return fallback;
  }
  return value;
}

function categorySlugParam(req: Req, problems: string[]): string | null {
  const raw = req.query.get('categorySlug');
  if (raw === null) return null;
  if (raw.length > PRODUCT_SLUG_MAX || !PRODUCT_SLUG_PATTERN.test(raw)) {
    problems.push('categorySlug: minúsculas, números y guiones, máx. 80');
    return null;
  }
  return raw;
}

/** Ids de categorías que cubre `categorySlug` (ella y sus descendientes); `null` = sin filtro; vacío = desconocida/no visible. */
function categoryScope(store: MockStore, slug: string | null): ReadonlySet<string> | null {
  if (slug === null) return null;
  const category = store.menuCategories.find((c) => c.slug === slug);
  if (!category || !isEffectivelyVisible(store.menuCategories, category.id)) return new Set();
  return new Set([category.id, ...descendantIds(store.menuCategories, category.id)]);
}

const byNameThenId = (a: ProductRecord, b: ProductRecord) =>
  a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }) || a.id.localeCompare(b.id);

// ── Promoción indicativa (F15) ─────────────────────────────────────────────────────────────

/** Promociones AUTOMÁTICAS (sin código) activas que aplican a la sucursal: las únicas que pueden salir como `promo`. */
function automaticPromotions(store: MockStore, branchId: string): PromotionRecord[] {
  return store.promotions.filter(
    (p) =>
      p.active && p.code === null && (p.branchScope === 'ALL' || p.branchIds.includes(branchId)),
  );
}

interface PromoCandidate {
  promotion: PromotionRecord;
  saving: number;
  view: StoreProductPromo;
}

/** Candidatas VIGENTES ahora que aplican al producto, de mayor ahorro a menor (desempate: vence antes, `id` menor). */
function promoCandidates(
  store: MockStore,
  product: ProductRecord,
  branchId: string,
  at: Date,
): PromoCandidate[] {
  const regular = effectivePriceAt(store, product, branchId);
  const regularCents = decimalToCents(regular) ?? 0;
  return automaticPromotions(store, branchId)
    .filter((p) => promotionTimes(p, at).live)
    .filter((p) => p.productScope === 'ALL' || p.productIds.includes(product.id))
    .flatMap((p): PromoCandidate[] => {
      const promoPrice = indicativePromoPrice(regular, p);
      if (promoPrice === null) return [];
      return [
        {
          promotion: p,
          saving: regularCents - (priceToCents(promoPrice) ?? regularCents),
          view: {
            promotionId: p.id,
            name: p.name,
            isHappyHour: p.schedule.length > 0,
            dineInOnly: p.dineInOnly,
            regularPrice: regular,
            promoPrice,
          },
        },
      ];
    })
    .sort(
      (a, b) =>
        b.saving - a.saving ||
        Date.parse(a.promotion.endsAt) - Date.parse(b.promotion.endsAt) ||
        a.promotion.id.localeCompare(b.promotion.id),
    );
}

/** Próximo cambio por tiempo de las promociones que tocan estos productos (14 días); `null` si no hay. */
function promoNextChange(
  store: MockStore,
  products: readonly ProductRecord[],
  branchId: string | null,
  at: Date,
): string | null {
  if (branchId === null) return null;
  const ids = new Set(products.map((p) => p.id));
  const relevant = automaticPromotions(store, branchId).filter(
    (p) => p.productScope === 'ALL' || p.productIds.some((id) => ids.has(id)),
  );
  const next = nextChangeAt(relevant, at);
  return next ? iso(next) : null;
}

// ── Tarjeta ────────────────────────────────────────────────────────────────────────────────

function cardOf(
  store: MockStore,
  product: ProductRecord,
  branchId: string | null,
  at: Date,
): StoreBranchMenuItem {
  const category = store.menuCategories.find((c) => c.id === product.categoryId);
  const first = [...product.media].sort((a, b) => a.sortOrder - b.sortOrder)[0];
  const image: PublicProductMedia | null = first
    ? { url: first.url, altText: first.altText }
    : null;
  return {
    productId: product.id,
    slug: product.slug,
    // Sin sucursal: precio base y `available=null`. Con ella: el efectivo, NUNCA el de otra sucursal.
    price: branchId ? effectivePriceAt(store, product, branchId) : product.basePrice,
    available: branchId ? availableAt(store, product, branchId) : null,
    name: product.name,
    summary: summarize(product.description),
    image,
    category: {
      id: product.categoryId,
      slug: category?.slug ?? '',
      name: category?.name ?? '',
    },
    promo: branchId ? (promoCandidates(store, product, branchId, at)[0]?.view ?? null) : null,
  };
}

const visibleProducts = (store: MockStore) =>
  store.products.filter((p) => isProductVisible(store, p));

const slice = <T>(items: readonly T[], page: number, pageSize: number): T[] =>
  items.slice((page - 1) * pageSize, page * pageSize);

// ── Menú ───────────────────────────────────────────────────────────────────────────────────

/** GET /v1/store/menu?branchId&categorySlug&available&sort&order&page&pageSize — público. */
export const getStoreBranchMenu: Handler = (req): StoreBranchMenu => {
  const problems: string[] = [];
  const branchRaw = branchParam(req, problems);
  const categorySlug = categorySlugParam(req, problems);
  const available = boolParam(req, 'available', problems);
  const sort = req.query.get('sort') ?? 'menu';
  if (sort !== 'menu' && sort !== 'name' && sort !== 'price')
    problems.push('sort: menu, name o price');
  const order = req.query.get('order') ?? 'asc';
  if (order !== 'asc' && order !== 'desc') problems.push('order: asc o desc');
  const page = intParam(req, 'page', 1, 1, STORE_MENU_PAGE_MAX, problems);
  const pageSize = intParam(
    req,
    'pageSize',
    STORE_MENU_PAGE_SIZE_DEFAULT,
    1,
    STORE_MENU_PAGE_SIZE_MAX,
    problems,
  );
  if (available && branchRaw === null) problems.push('available=true exige branchId');
  if (problems.length > 0) badRequest(problems);
  const { store } = req;
  const branch = branchRaw === null ? null : activeBranch(store, branchRaw);
  failStoreBusy(store);
  const at = now(req);
  const branchId = branch?.id ?? null;

  const scope = categoryScope(store, categorySlug);
  const treeOrder = new Map(flattenTree(store.menuCategories).map((row, i) => [row.node.id, i]));
  const sign = sort !== 'menu' && order === 'desc' ? -1 : 1;
  const cents = (p: ProductRecord) =>
    priceToCents(branchId ? effectivePriceAt(store, p, branchId) : p.basePrice) ?? 0;
  const matches = visibleProducts(store)
    .filter((p) => scope === null || scope.has(p.categoryId))
    .filter((p) => !available || (branchId !== null && availableAt(store, p, branchId)))
    .sort((a, b) => {
      let main = 0;
      if (sort === 'menu') {
        main = (treeOrder.get(a.categoryId) ?? 0) - (treeOrder.get(b.categoryId) ?? 0);
        main = main || a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
      } else if (sort === 'name') {
        main = a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
      } else main = cents(a) - cents(b);
      return main * sign || a.id.localeCompare(b.id);
    });
  const pageItems = slice(matches, page, pageSize);
  return {
    branchId,
    items: pageItems.map((p) => cardOf(store, p, branchId, at)),
    page,
    pageSize,
    total: matches.length,
    generatedAt: iso(at),
    nextChangeAt: promoNextChange(store, pageItems, branchId, at),
  };
};

// ── Búsqueda ───────────────────────────────────────────────────────────────────────────────

/** GET /v1/store/search?q&branchId&categorySlug&available&page&pageSize — público. */
export const searchStoreProducts: Handler = (req): StoreSearchPage => {
  const problems: string[] = [];
  const rawQ = req.query.get('q');
  const q = rawQ === null ? '' : normalizeSearchText(rawQ);
  if (q.length < STORE_SEARCH_MIN || q.length > STORE_SEARCH_MAX) {
    problems.push(`q: de ${STORE_SEARCH_MIN} a ${STORE_SEARCH_MAX} caracteres`);
  }
  const branchRaw = branchParam(req, problems);
  const categorySlug = categorySlugParam(req, problems);
  const available = boolParam(req, 'available', problems);
  const page = intParam(req, 'page', 1, 1, STORE_SEARCH_PAGE_MAX, problems);
  const pageSize = intParam(
    req,
    'pageSize',
    STORE_SEARCH_PAGE_SIZE_DEFAULT,
    1,
    STORE_SEARCH_PAGE_SIZE_MAX,
    problems,
  );
  if (available && branchRaw === null) problems.push('available=true exige branchId');
  if (problems.length > 0) badRequest(problems);
  const { store } = req;
  const branch = branchRaw === null ? null : activeBranch(store, branchRaw);
  failStoreBusy(store);
  const at = now(req);
  const branchId = branch?.id ?? null;

  const needle = foldText(q);
  const scope = categoryScope(store, categorySlug);
  const categoryName = (p: ProductRecord) =>
    store.menuCategories.find((c) => c.id === p.categoryId)?.name ?? '';
  const matches = visibleProducts(store)
    .filter((p) => scope === null || scope.has(p.categoryId))
    .filter((p) => !available || (branchId !== null && availableAt(store, p, branchId)))
    .flatMap((p) => {
      const group = searchGroup(p, categoryName(p), needle);
      return group === null ? [] : [{ p, group }];
    })
    .sort((a, b) => a.group - b.group || byNameThenId(a.p, b.p));
  const pageItems = slice(matches, page, pageSize).map((m) => m.p);
  return {
    branchId,
    items: pageItems.map((p) => cardOf(store, p, branchId, at)),
    page,
    pageSize,
    total: matches.length,
    generatedAt: iso(at),
    nextChangeAt: promoNextChange(store, pageItems, branchId, at),
  };
};

// ── Ficha ──────────────────────────────────────────────────────────────────────────────────

/** GET /v1/store/products/:slug?branchId — la ficha de F11/F12 y, con `branchId`, `offer` + `promotions`. */
export const getStoreProduct: Handler = (req): PublicProductDetail => {
  const base = baseGetStoreProduct(req) as PublicProductDetail;
  const problems: string[] = [];
  const branchRaw = branchParam(req, problems);
  if (problems.length > 0) badRequest(problems);
  if (branchRaw === null) return base;
  const { store } = req;
  const branch = activeBranch(store, branchRaw);
  failStoreBusy(store);
  const at = now(req);
  const product = store.products.find((p) => p.id === base.id) as ProductRecord;
  const candidates = promoCandidates(store, product, branch.id, at);
  return {
    ...base,
    offer: {
      branchId: branch.id,
      price: effectivePriceAt(store, product, branch.id),
      available: availableAt(store, product, branch.id),
    },
    promotions: candidates.slice(0, STORE_PRODUCT_PROMOTIONS_MAX).map((c) => c.view),
    generatedAt: iso(at),
    nextChangeAt: promoNextChange(store, [product], branch.id, at),
  };
};

// ── Bootstrap ──────────────────────────────────────────────────────────────────────────────

/**
 * Ejecuta una sección NO crítica: si está marcada como fallida (`store.storeDegraded`) o lanza, devuelve `fallback` y la anota en
 * `degraded` (la respuesta sigue siendo 200).
 */
function section<T>(
  store: MockStore,
  name: StoreBootstrapSection,
  degraded: StoreBootstrapSection[],
  fallback: T,
  read: () => T,
): T {
  try {
    if (store.storeDegraded?.includes(name)) throw new Error(`sección ${name} no disponible`);
    return read();
  } catch {
    degraded.push(name);
    return fallback;
  }
}

/** GET /v1/store/bootstrap?branchId&locale — agregado del Inicio. */
export const getStoreBootstrap: Handler = (req): StoreBootstrap => {
  const problems: string[] = [];
  const branchRaw = branchParam(req, problems);
  const localeRaw = req.query.get('locale') ?? 'es';
  if (localeRaw !== 'es' && localeRaw !== 'en') problems.push('locale: es o en');
  if (problems.length > 0) badRequest(problems);
  const locale = localeRaw as 'es' | 'en';
  const { store } = req;
  const branch = branchRaw === null ? null : activeBranch(store, branchRaw);
  failStoreBusy(store);
  const at = now(req);
  const degraded: StoreBootstrapSection[] = [];

  // Críticas: categorías y contador (un fallo sería 503; en el mock no fallan salvo `storeBusy`).
  const roots = publicTree(store.menuCategories)
    .slice(0, STORE_BOOTSTRAP_CATEGORIES_MAX)
    .map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      description: c.description,
      hasChildren: c.children.length > 0,
    }));
  const productCount = visibleProducts(store).length;

  const availability = branch
    ? section(store, 'availability', degraded, null, () => publicAvailability(store, branch, at))
    : null;
  // P23: sin criterio de destacados la API devuelve `[]` (sin columna ni ids inventados).
  const featured = section<StoreBranchMenuItem[]>(store, 'featured', degraded, [], () => []);
  let promotionList = null as StorePromotionList | null;
  const promotions = branch
    ? section(store, 'promotions', degraded, [], () => {
        promotionList = publicPromotionList(store, branch, 'live', at, 'noItems');
        return promotionList.items.slice(0, STORE_BOOTSTRAP_PROMOTIONS_MAX);
      })
    : [];
  let bannerList = null as StoreBannerList | null;
  const banners = section(store, 'banners', degraded, [], () => {
    failBannersBusy(store);
    bannerList = publicBannerList(store, branch?.id ?? null, locale, at);
    return bannerList.items.slice(0, STORE_BOOTSTRAP_BANNERS_MAX);
  });

  return {
    generatedAt: iso(at),
    nextChangeAt: earliestInstant([
      promotionList?.nextChangeAt,
      bannerList?.nextChangeAt,
      availability?.nextTransitionAt,
    ]),
    locale,
    branchId: branch?.id ?? null,
    branch: branch ? publicBranchView(branch) : null,
    availability,
    categories: roots,
    featured,
    promotions,
    banners,
    productCount,
    degraded,
  };
};
