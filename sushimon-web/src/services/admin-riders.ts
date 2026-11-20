import type { DataClient } from '@/lib/data-access/types';
import type {
  AdminRider,
  AdminRiderPage,
  CreateRiderRequest,
  RiderAvailabilityFilter,
  UpdateRiderAvailabilityRequest,
  UpdateRiderRequest,
  UpdateRiderStatusRequest,
} from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';

/**
 * F27 (spec 028, ADR-0031) — Motoristas PROPIOS del backoffice (contrato `admin-riders`: `riders.read|create|update` + aal2,
 * alcance por sucursal EN EL SERVIDOR). El teléfono completo y la placa solo viajan en el detalle; el listado trae el teléfono
 * enmascarado. Nunca se pasan teléfonos por la URL (no hay búsqueda por teléfono) ni se guardan en el navegador.
 */
export interface AdminRiderFilters {
  /** Nombre (contiene, sin acentos ni mayúsculas); máx. 80. NO busca teléfono ni placa. */
  q?: string;
  branchId?: string;
  /** undefined = todos. */
  active?: boolean;
  availability?: RiderAvailabilityFilter;
  sort?: 'fullName' | 'createdAt' | 'updatedAt';
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export const listAdminRiders = (
  client: DataClient,
  filters: AdminRiderFilters = {},
  signal?: AbortSignal,
) =>
  client.get<AdminRiderPage>(paths.adminRiders(), {
    signal,
    query: {
      q: filters.q?.trim() || undefined,
      branchId: filters.branchId,
      active: filters.active,
      availability: filters.availability,
      sort: filters.sort,
      order: filters.order,
      page: filters.page,
      pageSize: filters.pageSize,
    },
  });

export const getAdminRider = (client: DataClient, id: string, signal?: AbortSignal) =>
  client.get<AdminRider>(paths.adminRider(id), { signal });

/** Alta: nace activo, NO disponible y con `version` 1. 409 `RIDER_PHONE_TAKEN`, 422 `BRANCH_NOT_AVAILABLE`. */
export const createAdminRider = (client: DataClient, input: CreateRiderRequest) =>
  client.post<AdminRider>(paths.adminRiders(), input);

/** Edita datos o traslada (`branchId`). `expectedVersion` obligatorio; 409 `RIDER_VERSION_CONFLICT` con `current`. */
export const updateAdminRider = (client: DataClient, id: string, input: UpdateRiderRequest) =>
  client.patch<AdminRider>(paths.adminRider(id), input);

/** Activa/desactiva (idempotente, sin `expectedVersion`). Desactivar lo deja NO disponible. */
export const setAdminRiderStatus = (
  client: DataClient,
  id: string,
  input: UpdateRiderStatusRequest,
) => client.patch<AdminRider>(paths.adminRiderStatus(id), input);

/** Disponibilidad manual (idempotente). `BUSY` no existe aquí: lo deriva el servidor. */
export const setAdminRiderAvailability = (
  client: DataClient,
  id: string,
  input: UpdateRiderAvailabilityRequest,
) => client.patch<AdminRider>(paths.adminRiderAvailability(id), input);
