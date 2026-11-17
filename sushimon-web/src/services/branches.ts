import type { DataClient } from '@/lib/data-access/types';
import type {
  AdminBranch,
  AdminBranchPage,
  CreateBranchRequest,
  PublicBranch,
  UpdateBranchRequest,
  UpdateBranchStatusRequest,
} from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';
import type { components } from '@sushimon/contracts';

/**
 * F07 — Gestión de sucursales (contrato `/v1/branches` y `/v1/admin/branches`). Identidad y estado ADMINISTRATIVO
 * (`active`); NO incluye horario, cobertura ni "abierta ahora" (F08/F09). Sin DELETE: se desactiva con `active=false`.
 */

/** Sucursales activas (público, solo campos públicos). */
export async function listPublicBranches(client: DataClient): Promise<PublicBranch[]> {
  const res = await client.get<components['schemas']['PublicBranchListResponse']>(
    paths.branches(),
    {
      public: true,
    },
  );
  return res.items;
}

/** Detalle público: 404 si no existe o está inactiva. */
export const getPublicBranch = (client: DataClient, id: string) =>
  client.get<PublicBranch>(paths.branch(id), { public: true });

export interface AdminBranchFilters {
  /** Nombre o código (contiene); máx. 100 caracteres. */
  q?: string;
  /** undefined = todas. */
  active?: boolean;
  sort?: 'name' | 'code' | 'createdAt';
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export const listAdminBranches = (client: DataClient, filters: AdminBranchFilters = {}) =>
  client.get<AdminBranchPage>(paths.adminBranches(), {
    query: {
      q: filters.q?.trim() || undefined,
      active: filters.active,
      sort: filters.sort,
      order: filters.order,
      page: filters.page,
      pageSize: filters.pageSize,
    },
  });

export const getAdminBranch = (client: DataClient, id: string) =>
  client.get<AdminBranch>(paths.adminBranch(id));

/** Alta global (403 sin alcance global; 409 si el código ya existe). */
export const createAdminBranch = (client: DataClient, input: CreateBranchRequest) =>
  client.post<AdminBranch>(paths.adminBranches(), input);

/** Nombre, teléfono, dirección y coordenadas. `code` y `active` NO se aceptan (400). */
export const updateAdminBranch = (client: DataClient, id: string, input: UpdateBranchRequest) =>
  client.patch<AdminBranch>(paths.adminBranch(id), input);

/** Activa/desactiva (estado administrativo). Desactivar exige `reason`. */
export const setAdminBranchStatus = (
  client: DataClient,
  id: string,
  input: UpdateBranchStatusRequest,
) => client.patch<AdminBranch>(paths.adminBranchStatus(id), input);
