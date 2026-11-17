import type { DataClient } from '@/lib/data-access/types';
import type {
  AdminBranchProductPage,
  AdminBranchProductState,
  AdminProductBranches,
  SetBranchProductPricingRequest,
  SetProductAvailabilityRequest,
  StoreBranchMenu,
  StoreBranchMenuItem,
} from '@/lib/data-access/models';
import { STORE_MENU_PAGE_SIZE_MAX, storeMenuQuery, type StoreMenuParams } from '@/lib/store-rules';
import { paths } from '@/lib/data-access/paths';

/**
 * F13 — Precio y disponibilidad por sucursal. Operaciones del contrato: getStoreBranchMenu, listAdminBranchProducts,
 * listAdminProductBranches, setAdminBranchProductPricing y setAdminProductAvailability. Los importes son CADENAS decimales
 * (`"85.00"`). Los errores de negocio llegan en `ApiError.businessCode` (`BRANCH_NOT_FOUND`, `PRODUCT_NOT_FOUND`,
 * `BRANCH_PRICE_INVALID`, `BRANCH_PRODUCTS_BUSY`); la UI ramifica por él, nunca por `message`. Permisos y alcance POR SUCURSAL
 * los decide la API: lectura `catalog.read`, precio `catalog.update`, disponibilidad `catalog.manage_availability`; fuera de
 * alcance = 404. Sin stock numérico: «agotado» = `available=false`.
 */

/**
 * Público (F17, ampliado): UNA página de tarjetas del menú (precio efectivo, disponibilidad e info promocional). `branchId` es
 * opcional (sin él: precio base y `available=null`); inexistente o inactiva => 404 `BRANCH_NOT_FOUND`; `available=true` sin sucursal
 * => 400; 429 `RATE_LIMITED`; 503 `STORE_BUSY`. La query es CANÓNICA (orden fijo, sin valores por defecto: la URL es la clave de CDN).
 */
export const getStoreBranchMenu = (
  client: DataClient,
  params: StoreMenuParams = {},
  signal?: AbortSignal,
) =>
  client.get<StoreBranchMenu>(paths.storeMenu(), {
    query: storeMenuQuery(params),
    signal,
    public: true,
  });

/** Tope de páginas al reunir el menú completo (≤ 200 por contrato; el negocio maneja decenas). */
export const STORE_MENU_MAX_PAGES = 20;

/**
 * Menú COMPLETO de una sucursal: sigue `total` página a página (de 100 en 100, en orden) hasta reunirlo, ante una página vacía o
 * al tope. Devuelve las tarjetas y el `generatedAt`/`nextChangeAt` de la PRIMERA página (el refetch se programa con ellos).
 */
export async function listAllStoreMenu(
  client: DataClient,
  params: Omit<StoreMenuParams, 'page' | 'pageSize'> = {},
  signal?: AbortSignal,
): Promise<{
  branchId: string | null;
  items: StoreBranchMenuItem[];
  total: number;
  generatedAt: string | undefined;
  nextChangeAt: string | null | undefined;
}> {
  const items: StoreBranchMenuItem[] = [];
  let first: StoreBranchMenu | null = null;
  for (let page = 1; page <= STORE_MENU_MAX_PAGES; page++) {
    const result = await getStoreBranchMenu(
      client,
      { ...params, page, pageSize: STORE_MENU_PAGE_SIZE_MAX },
      signal,
    );
    first ??= result;
    items.push(...result.items);
    if (result.items.length === 0 || items.length >= (result.total ?? 0)) break;
  }
  return {
    branchId: first?.branchId ?? null,
    items,
    total: first?.total ?? items.length,
    generatedAt: first?.generatedAt,
    nextChangeAt: first?.nextChangeAt,
  };
}

export interface BranchProductFilters {
  /** Nombre, slug o SKU (≤ 80). */
  q?: string;
  categoryId?: string;
  /** undefined = todos. */
  available?: boolean;
  /** true = solo con precio especial; false = solo sin él. */
  hasOverride?: boolean;
  page?: number;
  pageSize?: number;
}

/** Matriz de una sucursal: todos los productos (activos e inactivos) con precio base, override, efectivo y disponibilidad. */
export const listAdminBranchProducts = (
  client: DataClient,
  branchId: string,
  filters: BranchProductFilters = {},
) =>
  client.get<AdminBranchProductPage>(paths.adminBranchProducts(branchId), {
    query: {
      q: filters.q?.trim() || undefined,
      categoryId: filters.categoryId,
      available: filters.available,
      hasOverride: filters.hasOverride,
      page: filters.page,
      pageSize: filters.pageSize,
    },
  });

/** Matriz de un producto: una fila por sucursal dentro del alcance de `catalog.read` del empleado. */
export const listAdminProductBranches = (client: DataClient, productId: string) =>
  client.get<AdminProductBranches>(paths.adminProductBranches(productId));

/** Fija (`"85.00"`) o quita (`null`) el precio de sucursal. Requiere `catalog.update` en esa sucursal. 422 `BRANCH_PRICE_INVALID` con `"0.00"`. */
export const setAdminBranchProductPricing = (
  client: DataClient,
  branchId: string,
  productId: string,
  priceOverride: SetBranchProductPricingRequest['priceOverride'],
) =>
  client.put<AdminBranchProductState>(paths.adminBranchProductPricing(branchId, productId), {
    priceOverride,
  } satisfies SetBranchProductPricingRequest);

/** Marca agotado/disponible un producto en una sucursal. Requiere `catalog.manage_availability` en esa sucursal. */
export const setAdminProductAvailability = (
  client: DataClient,
  productId: string,
  input: SetProductAvailabilityRequest,
) => client.patch<AdminBranchProductState>(paths.adminProductAvailability(productId), input);
