import type {
  AdminBranchProductPage,
  AdminBranchProductRow,
  AdminBranchProductState,
  AdminProductBranches,
  StoreBranchMenu,
} from '@/lib/data-access/models';
import { isEffectivelyVisible } from '@/lib/category-tree';
import { checkOverrideBody, effectivePrice, isOffered } from '@/lib/branch-pricing-rules';
import { PRODUCT_PAGE_MAX, PRODUCT_PAGE_SIZE_MAX, PRODUCT_SEARCH_MAX } from '@/lib/product-rules';
import { badRequest, branchRowOf, failCode } from '../domain';
import type { BranchProductRecord, MockStore, ProductRecord } from '../store';
import { isProductVisible } from './products';
import { now, requireStaff, type Handler, type Req, type StaffActor } from './shared';

/**
 * F13 — Precio y disponibilidad por sucursal (spec 014, ADR-0019). El mock EMULA al servidor:
 * - Overlay público `GET /v1/store/menu?branchId=`: todos los productos VISIBLES (F11/F10) con el precio EFECTIVO y `available` de
 *   ESA sucursal; sin precio base ni indicio de override. 400 sin `branchId`; 404 `BRANCH_NOT_FOUND` si no existe o está inactiva.
 * - Admin: `catalog.read` (matrices), `catalog.update` (precio) y `catalog.manage_availability` (disponibilidad), todos con
 *   alcance POR SUCURSAL: fuera de alcance = inexistente = 404 `BRANCH_NOT_FOUND` (el manager de A no ve ni modifica B). Un manager
 *   (sin `catalog.update`) recibe 403 al fijar precio.
 * - Orden en escrituras: permiso (401/403) → forma (400) → alcance (404) → producto (404) → regla (422 `BRANCH_PRICE_INVALID` solo con
 *   `"0.00"`; toda otra forma inválida es 400, D9).
 * - Ausencia de fila = disponible al precio base; la fila se ELIMINA al volver al estado por defecto (D2). Sin cambio ⇒ 200 sin
 *   escribir. 503 `BRANCH_PRODUCTS_BUSY` determinista (`store.branchProductsBusy`), solo en una escritura real.
 * NO simula auditoría, cabeceras de caché (`max-age=15`), throttling ni la forma UUID (los ids del mock son legibles).
 */

const bySlugThenId = (a: ProductRecord, b: ProductRecord) =>
  a.slug.localeCompare(b.slug) || a.id.localeCompare(b.id);
const byNameThenId = (a: ProductRecord, b: ProductRecord) =>
  a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }) || a.id.localeCompare(b.id);
const foldText = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const branchNotFound = (): never => failCode(404, 'BRANCH_NOT_FOUND', 'Sucursal no encontrada');
const productNotFound = (): never => failCode(404, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');

/** ¿El actor alcanza la sucursal con el permiso con que se autenticó? */
const canAccess = (actor: StaffActor, branchId: string): boolean =>
  actor.scope.allBranches || actor.scope.branchIds.includes(branchId);

/** Sucursal existente Y dentro del alcance (sin distinguir inexistente de ajena: 404). */
function scopedBranch(store: MockStore, actor: StaffActor, branchId: string) {
  const branch = store.branches.find((b) => b.id === branchId);
  if (!branch || !canAccess(actor, branch.id)) branchNotFound();
  return branch as NonNullable<typeof branch>;
}

function stateOf(store: MockStore, product: ProductRecord, branchId: string) {
  const row = branchRowOf(store, branchId, product.id);
  const priceOverride = row?.priceOverride ?? null;
  const available = row?.available ?? true;
  const visible = isProductVisible(store, product);
  const state: AdminBranchProductState = {
    branchId,
    productId: product.id,
    basePrice: product.basePrice,
    priceOverride,
    effectivePrice: effectivePrice(product.basePrice, priceOverride),
    available,
    offered: isOffered(visible, available),
    updatedAt: row?.updatedAt ?? null,
  };
  return { state, visible };
}

// ── Público ────────────────────────────────────────────────────────────────────────────────

/** GET /v1/store/menu?branchId= — overlay de una sucursal ACTIVA. */
export const getStoreBranchMenu: Handler = (req): StoreBranchMenu => {
  const branchId = req.query.get('branchId');
  if (!branchId) badRequest(['branchId: obligatorio']);
  const { store } = req;
  const branch = store.branches.find((b) => b.id === branchId);
  if (!branch || !branch.active) branchNotFound();
  const items = store.products
    .filter((p) => isProductVisible(store, p))
    .sort(bySlugThenId)
    .map((p) => {
      const row = branchRowOf(store, branchId as string, p.id);
      return {
        productId: p.id,
        slug: p.slug,
        price: effectivePrice(p.basePrice, row?.priceOverride ?? null),
        available: row?.available ?? true,
      };
    });
  return { branchId: branchId as string, items };
};

// ── Administración: lecturas ───────────────────────────────────────────────────────────────

const strictInt = (raw: string | null, fallback: number): number | null =>
  raw === null ? fallback : /^\d{1,9}$/.test(raw) ? Number(raw) : null;

function boolParam(req: Req, name: string, problems: string[]): boolean | null {
  const raw = req.query.get(name);
  if (raw === null) return null;
  if (raw !== 'true' && raw !== 'false') problems.push(`${name}: debe ser true o false`);
  return raw === 'true';
}

/** GET /v1/admin/branches/:id/products?q&categoryId&available&hasOverride&page&pageSize */
export const listAdminBranchProducts: Handler = (req): AdminBranchProductPage => {
  const actor = requireStaff(req, 'catalog.read');
  const problems: string[] = [];
  const page = strictInt(req.query.get('page'), 1);
  const pageSize = strictInt(req.query.get('pageSize'), 20);
  if (page === null || page < 1 || page > PRODUCT_PAGE_MAX) {
    problems.push(`page: entre 1 y ${PRODUCT_PAGE_MAX}`);
  }
  if (pageSize === null || pageSize < 1 || pageSize > PRODUCT_PAGE_SIZE_MAX) {
    problems.push(`pageSize: entre 1 y ${PRODUCT_PAGE_SIZE_MAX}`);
  }
  const q = req.query.get('q');
  if (q !== null && q.length > PRODUCT_SEARCH_MAX) {
    problems.push(`q: máximo ${PRODUCT_SEARCH_MAX} caracteres`);
  }
  const available = boolParam(req, 'available', problems);
  const hasOverride = boolParam(req, 'hasOverride', problems);
  if (problems.length > 0) badRequest(problems);
  const { store } = req;
  const branch = scopedBranch(store, actor, req.params.id ?? '');
  const needle = q ? foldText(q.trim()) : '';
  const categoryId = req.query.get('categoryId');

  const rows = store.products
    .filter((p) => categoryId === null || p.categoryId === categoryId)
    .filter(
      (p) =>
        !needle ||
        foldText(p.name).includes(needle) ||
        p.slug.includes(needle) ||
        foldText(p.sku ?? '').includes(needle),
    )
    .sort(byNameThenId)
    .map((p) => ({ p, ...stateOf(store, p, branch.id) }))
    .filter((r) => available === null || r.state.available === available)
    .filter((r) => hasOverride === null || (r.state.priceOverride !== null) === hasOverride);

  const size = pageSize ?? 20;
  const current = page ?? 1;
  const items: AdminBranchProductRow[] = rows
    .slice((current - 1) * size, current * size)
    .map(({ p, state, visible }) => {
      const category = store.menuCategories.find((c) => c.id === p.categoryId);
      if (!category) throw new Error('Producto con categoría inexistente');
      return {
        ...state,
        sku: p.sku,
        slug: p.slug,
        name: p.name,
        category: {
          id: category.id,
          slug: category.slug,
          name: category.name,
          active: category.active,
          effectivelyVisible: isEffectivelyVisible(store.menuCategories, category.id),
        },
        active: p.active,
        publiclyVisible: visible,
      };
    });
  return { branchId: branch.id, items, page: current, pageSize: size, total: rows.length };
};

/** GET /v1/admin/products/:id/branches — una fila por sucursal dentro del alcance de `catalog.read`. */
export const listAdminProductBranches: Handler = (req): AdminProductBranches => {
  const actor = requireStaff(req, 'catalog.read');
  const { store } = req;
  const product = store.products.find((p) => p.id === req.params.id);
  if (!product) productNotFound();
  const found = product as ProductRecord;
  const visible = isProductVisible(store, found);
  const items = store.branches
    .filter((b) => canAccess(actor, b.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'es') || a.id.localeCompare(b.id))
    .map((b) => ({
      ...stateOf(store, found, b.id).state,
      branchCode: b.code,
      branchName: b.name,
      branchActive: b.active,
    }));
  return {
    productId: found.id,
    basePrice: found.basePrice,
    active: found.active,
    publiclyVisible: visible,
    items,
  };
};

// ── Administración: escrituras ─────────────────────────────────────────────────────────────

function exactBody(req: Req, keys: readonly string[]): Record<string, unknown> {
  const raw = req.body;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    badRequest(['Cuerpo de la solicitud inválido']);
  }
  const body = raw as Record<string, unknown>;
  const problems: string[] = [];
  for (const k of Object.keys(body)) {
    if (!keys.includes(k)) problems.push(`${k}: campo no permitido`);
  }
  for (const k of keys) if (!(k in body)) problems.push(`${k}: obligatorio`);
  if (problems.length > 0) badRequest(problems);
  return body;
}

/** Simulación determinista de `BRANCH_PRODUCTS_BUSY` (no se guardó nada; reintentable). */
function maybeBusy(store: MockStore): void {
  if ((store.branchProductsBusy ?? 0) > 0) {
    store.branchProductsBusy = (store.branchProductsBusy ?? 0) - 1;
    failCode(503, 'BRANCH_PRODUCTS_BUSY', 'Hay otra edición en curso; reintenta en unos segundos');
  }
}

/**
 * `INSERT … ON CONFLICT DO UPDATE` de SOLO la columna escrita + `DELETE` de la fila si queda por defecto (D2/D8). Sin cambio ⇒
 * no escribe ni consume el fallo `BUSY`.
 */
function writeRow(
  req: Req,
  product: ProductRecord,
  branchId: string,
  patch: Partial<Pick<BranchProductRecord, 'priceOverride' | 'available'>>,
): AdminBranchProductState {
  const { store } = req;
  const current = branchRowOf(store, branchId, product.id);
  const nextPrice =
    patch.priceOverride !== undefined ? patch.priceOverride : (current?.priceOverride ?? null);
  const nextAvailable =
    patch.available !== undefined ? patch.available : (current?.available ?? true);
  const changed =
    nextPrice !== (current?.priceOverride ?? null) ||
    nextAvailable !== (current?.available ?? true);
  if (changed) {
    maybeBusy(store);
    const stamp = now(req).toISOString();
    const isDefault = nextPrice === null && nextAvailable;
    store.branchProducts = store.branchProducts.filter(
      (r) => !(r.branchId === branchId && r.productId === product.id),
    );
    if (!isDefault) {
      store.branchProducts.push({
        branchId,
        productId: product.id,
        priceOverride: nextPrice,
        available: nextAvailable,
        updatedAt: stamp,
      });
    }
  }
  return stateOf(store, product, branchId).state;
}

/** PUT /v1/admin/branches/:id/products/:productId/pricing — `{ priceOverride: "85.00" | null }`. */
export const setAdminBranchProductPricing: Handler = (req): AdminBranchProductState => {
  const actor = requireStaff(req, 'catalog.update');
  const body = exactBody(req, ['priceOverride']);
  const check = checkOverrideBody(body.priceOverride);
  if (check === 'shape') {
    badRequest(['priceOverride: cadena decimal con 2 decimales (hasta 999999.99) o null']);
  }
  const { store } = req;
  const branch = scopedBranch(store, actor, req.params.id ?? '');
  const product = store.products.find((p) => p.id === req.params.productId);
  if (!product) productNotFound();
  if (check === 'zero') {
    failCode(422, 'BRANCH_PRICE_INVALID', 'El precio de sucursal debe ser mayor a 0', [
      { path: 'priceOverride', code: 'PRICE_NOT_POSITIVE', message: 'Debe ser mayor a 0' },
    ]);
  }
  return writeRow(req, product as ProductRecord, branch.id, {
    priceOverride: body.priceOverride as string | null,
  });
};

/** PATCH /v1/admin/products/:id/availability — `{ branchId, available }`. */
export const setAdminProductAvailability: Handler = (req): AdminBranchProductState => {
  const actor = requireStaff(req, 'catalog.manage_availability');
  const body = exactBody(req, ['branchId', 'available']);
  const problems: string[] = [];
  if (typeof body.branchId !== 'string' || body.branchId.length === 0) {
    problems.push('branchId: debe ser un identificador');
  }
  if (typeof body.available !== 'boolean') problems.push('available: debe ser booleano');
  if (problems.length > 0) badRequest(problems);
  const { store } = req;
  const branch = scopedBranch(store, actor, body.branchId as string);
  const product = store.products.find((p) => p.id === req.params.id);
  if (!product) productNotFound();
  return writeRow(req, product as ProductRecord, branch.id, {
    available: body.available as boolean,
  });
};
