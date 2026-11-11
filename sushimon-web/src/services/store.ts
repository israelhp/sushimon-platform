import type { DataClient } from '@/lib/data-access/types';
import type {
  Branch,
  Category,
  DeliveryQuote,
  JobApplication,
  JobApplicationRequest,
  Product,
  Promotion,
  StoreConfig,
} from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';

/** Datos públicos de la tienda: configuración, sucursales, envío, catálogo, promociones, empleo. */

export const getStoreConfig = (client: DataClient) => client.get<StoreConfig>(paths.storeConfig());

export const listBranches = (client: DataClient) => client.get<Branch[]>(paths.branches());

export interface DeliveryQuoteArgs {
  department: string;
  municipality: string;
  zone?: string;
  branchId?: string;
}

export const quoteDelivery = (client: DataClient, args: DeliveryQuoteArgs) =>
  client.get<DeliveryQuote>(paths.deliveryQuote(), {
    query: {
      department: args.department,
      municipality: args.municipality,
      zone: args.zone,
      branchId: args.branchId,
    },
  });

export const listCategories = (client: DataClient) => client.get<Category[]>(paths.categories());

export interface ProductFilters {
  branchId?: string;
  categoryId?: string;
}

export const listProducts = (client: DataClient, filters: ProductFilters = {}) =>
  client.get<Product[]>(paths.products(), {
    query: { branchId: filters.branchId, categoryId: filters.categoryId },
  });

export const listPromotions = (client: DataClient) => client.get<Promotion[]>(paths.promotions());

export const submitJobApplication = (client: DataClient, input: JobApplicationRequest) =>
  client.post<JobApplication>(paths.jobApplications(), input);
