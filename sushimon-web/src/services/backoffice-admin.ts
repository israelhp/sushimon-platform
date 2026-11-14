import type { DataClient } from '@/lib/data-access/types';
import type {
  Branch,
  ProductBranchAvailability,
  Category,
  Order,
  Product,
  Promotion,
  PromotionInput,
  ReportSummary,
} from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';

/** Catálogo, promociones y reportes del backoffice (las sucursales F07: `services/branches`). */

export type ProductInput = Pick<Product, 'name' | 'description' | 'price' | 'categoryId'> &
  Partial<
    Pick<
      Product,
      'nameEn' | 'descriptionEn' | 'illustration' | 'featured' | 'food' | 'availability'
    >
  >;

export const listBoProducts = (client: DataClient) => client.get<Product[]>(paths.boProducts());

export const createProduct = (client: DataClient, input: ProductInput) =>
  client.post<Product>(paths.boProducts(), input);

export const updateProduct = (client: DataClient, id: string, input: Partial<ProductInput>) =>
  client.patch<Product>(paths.boProduct(id), input);

/** Cambio de disponibilidad por sucursal (permiso de encargado). */
export const setProductAvailability = (
  client: DataClient,
  id: string,
  availability: ProductBranchAvailability[],
) => client.patch<Product>(paths.boProduct(id), { availability });

export type CategoryInput = Pick<Category, 'name'> &
  Partial<Pick<Category, 'nameEn' | 'sortOrder' | 'visible' | 'illustration' | 'jpLabel'>>;

export const listBoCategories = (client: DataClient) =>
  client.get<Category[]>(paths.boCategories());

export const createCategory = (client: DataClient, input: CategoryInput) =>
  client.post<Category>(paths.boCategories(), input);

export const updateCategory = (client: DataClient, id: string, input: Partial<CategoryInput>) =>
  client.patch<Category>(paths.boCategory(id), input);

export const listBoPromotions = (client: DataClient) =>
  client.get<Promotion[]>(paths.boPromotions());

export const createPromotion = (client: DataClient, input: PromotionInput) =>
  client.post<Promotion>(paths.boPromotions(), input);

export const updatePromotion = (client: DataClient, id: string, input: Partial<PromotionInput>) =>
  client.patch<Promotion>(paths.boPromotion(id), input);

/**
 * 🎭 Solo simulación (F09/F33): zona, radio y cobertura de una sucursal (el horario es F08, ya es contrato). La identidad y el estado
 * administrativo (F07) se cambian con `services/branches`. Nada de esto está en el contrato real todavía.
 */
export type BranchOperationsUpdate = Partial<
  Pick<Branch, 'zoneLabel' | 'radiusKm' | 'coverage' | 'coverageLabels'>
>;

export const updateBranchOperations = (
  client: DataClient,
  id: string,
  input: BranchOperationsUpdate,
) => client.patch<Branch>(paths.demoBranchOperation(id), input);

export interface ReportFilters {
  /** YYYY-MM-DD; por defecto hoy. Se recorta a los 60 días disponibles (`clipped`). */
  from?: string;
  to?: string;
  branchId?: string;
}

const reportQuery = (f: ReportFilters) => ({ from: f.from, to: f.to, branchId: f.branchId });

export const getReportSummary = (client: DataClient, filters: ReportFilters = {}) =>
  client.get<ReportSummary>(paths.reportSummary(), { query: reportQuery(filters) });

export const getReportHistory = (client: DataClient, filters: ReportFilters = {}) =>
  client.get<Order[]>(paths.reportHistory(), { query: reportQuery(filters) });
