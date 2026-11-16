import type { DataClient } from '@/lib/data-access/types';
import type {
  AdminBranchProductPage,
  AdminBranchProductState,
  AdminProductBranches,
  SetBranchProductPricingRequest,
  SetProductAvailabilityRequest,
  StoreBranchMenu,
} from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';

/**
 * F13 — Precio y disponibilidad por sucursal. Operaciones del contrato: getStoreBranchMenu, listAdminBranchProducts,
 * listAdminProductBranches, setAdminBranchProductPricing y setAdminProductAvailability. Los importes son CADENAS decimales
 * (`"85.00"`). Los errores de negocio llegan en `ApiError.businessCode` (`BRANCH_NOT_FOUND`, `PRODUCT_NOT_FOUND`,
 * `BRANCH_PRICE_INVALID`, `BRANCH_PRODUCTS_BUSY`); la UI ramifica por él, nunca por `message`. Permisos y alcance POR SUCURSAL
 * los decide la API: lectura `catalog.read`, precio `catalog.update`, disponibilidad `catalog.manage_availability`; fuera de
 * alcance = 404. Sin stock numérico: «agotado» = `available=false`.
 */

/** Público: overlay de TODOS los productos visibles en una sucursal ACTIVA (404 `BRANCH_NOT_FOUND` si no existe o está inactiva). */
export const getStoreBranchMenu = (client: DataClient, branchId: string) =>
  client.get<StoreBranchMenu>(paths.storeMenu(), { query: { branchId } });

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
