import type { DataClient } from '@/lib/data-access/types';
import type {
  AdminProduct,
  AdminProductPage,
  CreateProductRequest,
  PublicProduct,
  PublicProductDetail,
  PublicProductPage,
  SimulatedProductExtras,
  UpdateProductRequest,
} from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';
import { PRODUCT_PAGE_MAX, PRODUCT_PAGE_SIZE_MAX } from '@/lib/product-rules';

/**
 * F11 — Productos y fichas. Operaciones del contrato: listStoreProducts, getStoreProduct, listAdminProducts,
 * createAdminProduct, getAdminProduct, updateAdminProduct y deleteAdminProduct (ADR-0035: borrado físico solo si no está en uso;
 * la alternativa reversible es `active=false`).
 * Los importes son CADENAS decimales (`"85.00"`): se formatean a GTQ solo al mostrar. Los errores de negocio llegan en
 * `ApiError.businessCode` (`PRODUCT_*`, `PRODUCTS_BUSY`); la UI ramifica por él, nunca por `message`.
 * La API decide permisos y alcance (401/403): lectura `catalog.read`; escrituras con alcance global.
 */

export interface StoreProductFilters {
  /** Slug de una categoría visible (incluye descendientes visibles). */
  categorySlug?: string;
  /** Nombre, descripción o SKU (contiene; sin distinguir mayúsculas ni acentos); máx. 80. */
  q?: string;
  page?: number;
  pageSize?: number;
}

/** Público: productos activos con categoría efectivamente visible, orden `name, id`. Sin SKU. */
export const listStoreProducts = (client: DataClient, filters: StoreProductFilters = {}) =>
  client.get<PublicProductPage>(paths.storeProducts(), {
    public: true,
    query: {
      categorySlug: filters.categorySlug,
      q: filters.q?.trim() || undefined,
      page: filters.page,
      pageSize: filters.pageSize,
    },
  });

/**
 * Ficha pública (F17, ampliada): 404 `PRODUCT_NOT_FOUND` si no existe, está inactivo o su categoría no es visible. Con `branchId`
 * (OPCIONAL) la respuesta añade `offer`, `promotions`, `generatedAt` y `nextChangeAt`; inexistente o inactiva => 404 `BRANCH_NOT_FOUND`.
 */
export const getStoreProduct = (
  client: DataClient,
  slug: string,
  branchId?: string | null,
  signal?: AbortSignal,
) =>
  client.get<PublicProductDetail>(paths.storeProduct(slug), {
    query: { branchId: branchId ?? undefined },
    signal,
    public: true,
  });

/** Tope de páginas al cargar el catálogo completo (10 × 100 = 1 000 productos; el negocio maneja decenas). */
export const CATALOG_MAX_PAGES = 10;

/**
 * Carga TODO el catálogo público en páginas de 100 (el menú, el carrito y el checkout necesitan buscar por id). Se detiene
 * al reunir `total` productos, ante una página vacía o al llegar al tope de páginas.
 */
export async function listAllStoreProducts(
  client: DataClient,
  filters: Omit<StoreProductFilters, 'page' | 'pageSize'> = {},
): Promise<PublicProduct[]> {
  const items: PublicProduct[] = [];
  for (let page = 1; page <= Math.min(CATALOG_MAX_PAGES, PRODUCT_PAGE_MAX); page++) {
    const result = await listStoreProducts(client, {
      ...filters,
      page,
      pageSize: PRODUCT_PAGE_SIZE_MAX,
    });
    items.push(...result.items);
    if (result.items.length === 0 || items.length >= result.total) break;
  }
  return items;
}

export interface AdminProductFilters {
  q?: string;
  /** Solo esa categoría exacta (sin descendientes). */
  categoryId?: string;
  /** undefined = todos. */
  active?: boolean;
  sort?: 'name' | 'basePrice' | 'createdAt';
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

/** Backoffice: activos e inactivos, con `publiclyVisible` y la categoría con su estado. Requiere `catalog.read`. */
export const listAdminProducts = (client: DataClient, filters: AdminProductFilters = {}) =>
  client.get<AdminProductPage>(paths.adminProducts(), {
    query: {
      q: filters.q?.trim() || undefined,
      categoryId: filters.categoryId,
      active: filters.active,
      sort: filters.sort,
      order: filters.order,
      page: filters.page,
      pageSize: filters.pageSize,
    },
  });

export const getAdminProduct = (client: DataClient, id: string) =>
  client.get<AdminProduct>(paths.adminProduct(id));

/** `active` es opcional (por defecto `true`); el tipo generado lo marca obligatorio por su `default`. */
export type CreateProductInput = Omit<CreateProductRequest, 'active'> & { active?: boolean };

/**
 * 409 `PRODUCT_SLUG_TAKEN` | `PRODUCT_SKU_TAKEN`; 422 `PRODUCT_CATEGORY_INVALID` | `PRODUCT_MEDIA_INVALID`;
 * 503 `PRODUCTS_BUSY` (reintentable); 400, 401, 403.
 */
export const createAdminProduct = (client: DataClient, input: CreateProductInput) =>
  client.post<AdminProduct>(paths.adminProducts(), input);

/**
 * PATCH parcial (activar/desactivar incluido). `media` REEMPLAZA la lista; omitirla no la toca. Mismos errores que el alta
 * más 404 `PRODUCT_NOT_FOUND`.
 */
export const updateAdminProduct = (client: DataClient, id: string, input: UpdateProductRequest) =>
  client.patch<AdminProduct>(paths.adminProduct(id), input);

/**
 * Borrado físico (204, ADR-0035). 409 `PRODUCT_IN_USE` (el cuerpo trae `usage` con conteos de pedidos, promociones y banners);
 * 404 `PRODUCT_NOT_FOUND` (repetirlo también); 403 sin `catalog.update` global; 503 `PRODUCTS_BUSY` (reintentable).
 */
export const deleteAdminProduct = (client: DataClient, id: string) =>
  client.delete<void>(paths.adminProduct(id));

// ── SIMULADO (solo mock): lo que F11 no provee ────────────────────────────────────────────────

/** Ilustración, destacado y textos en inglés (F15/otros pendientes). Solo existe en el mock; la disponibilidad ya es contrato (F13). */
export const listSimulatedProductExtras = (client: DataClient) =>
  client.get<{ items: SimulatedProductExtras[] }>(paths.demoProductExtras());
