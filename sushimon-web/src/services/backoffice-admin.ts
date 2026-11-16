import type { DataClient } from '@/lib/data-access/types';
import type {
  Category,
  Order,
  Promotion,
  PromotionInput,
  ReportSummary,
} from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';

/** Catálogo, promociones y reportes del backoffice (las sucursales F07: `services/branches`). */

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
