import type { DataClient } from '@/lib/data-access/types';
import type {
  Branch,
  BranchAvailability,
  Category,
  Order,
  Product,
  Promotion,
  PromotionInput,
  ReportSummary,
  StaffUser,
  StaffUserInput,
} from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';

/** Catálogo, promociones, sucursales, usuarios y reportes del backoffice. */

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
  availability: BranchAvailability[],
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

export type BranchUpdate = Partial<
  Pick<
    Branch,
    | 'name'
    | 'isOpen'
    | 'status'
    | 'zoneLabel'
    | 'address'
    | 'phone'
    | 'hoursLabel'
    | 'hours'
    | 'radiusKm'
    | 'coverage'
    | 'coverageLabels'
  >
>;

export const listBoBranches = (client: DataClient) => client.get<Branch[]>(paths.boBranches());

export const updateBranch = (client: DataClient, id: string, input: BranchUpdate) =>
  client.patch<Branch>(paths.boBranch(id), input);

export const listUsers = (client: DataClient) => client.get<StaffUser[]>(paths.users());

export const createUser = (client: DataClient, input: StaffUserInput) =>
  client.post<StaffUser>(paths.users(), input);

export const updateUser = (client: DataClient, id: string, input: Partial<StaffUserInput>) =>
  client.patch<StaffUser>(paths.user(id), input);

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
