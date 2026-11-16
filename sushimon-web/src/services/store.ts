import type { DataClient } from '@/lib/data-access/types';
import type {
  Branch,
  Category,
  JobApplication,
  JobApplicationRequest,
  StoreConfig,
} from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';

/** Datos públicos de la tienda: configuración, sucursales, catálogo, empleo (las promociones F15: `services/promotions`). */

export const getStoreConfig = (client: DataClient) => client.get<StoreConfig>(paths.storeConfig());

/**
 * Vista OPERATIVA SIMULADA de las sucursales (horario, abierta ahora, cobertura: F08/F09, sin contrato todavía).
 * Para identidad y estado administrativo (F07) usa `services/branches`.
 */
export const listBranches = (client: DataClient) =>
  client.get<Branch[]>(paths.demoBranchOperations());

export const listCategories = (client: DataClient) => client.get<Category[]>(paths.categories());

export const submitJobApplication = (client: DataClient, input: JobApplicationRequest) =>
  client.post<JobApplication>(paths.jobApplications(), input);
