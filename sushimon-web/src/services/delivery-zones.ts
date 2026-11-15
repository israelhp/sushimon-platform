import type { DataClient } from '@/lib/data-access/types';
import type {
  AdminDeliveryZone,
  AdminDeliveryZonePage,
  BranchDeliverySettings,
  CreateDeliveryZoneRequest,
  UpdateBranchDeliverySettingsRequest,
  UpdateDeliveryZoneRequest,
  UpdateDeliveryZoneStatusRequest,
} from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';

/**
 * F09 — Zonas propias de entrega y configuración logística por sucursal (admin). Operaciones: listAdminDeliveryZones,
 * createAdminDeliveryZone, getAdminDeliveryZone, updateAdminDeliveryZone, updateAdminDeliveryZoneStatus,
 * getAdminBranchDeliverySettings y updateAdminBranchDeliverySettings. `baseFee` es un string decimal (`"15.00"`),
 * nunca `number`. Sin borrado físico: solo activar/desactivar. La API decide permisos y alcance (403/404).
 */
export interface DeliveryZoneFilters {
  branchId?: string;
  departmentId?: string;
  municipalityId?: string;
  /** undefined = todas. */
  active?: boolean;
  /** Etiqueta (contiene, sin distinguir mayúsculas ni acentos); máx. 60. */
  q?: string;
  sort?: 'municipality' | 'baseFee' | 'createdAt';
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export const listAdminDeliveryZones = (client: DataClient, filters: DeliveryZoneFilters = {}) =>
  client.get<AdminDeliveryZonePage>(paths.adminDeliveryZones(), {
    query: {
      branchId: filters.branchId,
      departmentId: filters.departmentId,
      municipalityId: filters.municipalityId,
      active: filters.active,
      q: filters.q?.trim() || undefined,
      sort: filters.sort,
      order: filters.order,
      page: filters.page,
      pageSize: filters.pageSize,
    },
  });

export const getAdminDeliveryZone = (client: DataClient, id: string) =>
  client.get<AdminDeliveryZone>(paths.adminDeliveryZone(id));

/** 409 `DELIVERY_ZONE_DUPLICATE` si ya existe (activa o inactiva); 422 `MUNICIPALITY_NOT_FOUND`. */
export const createAdminDeliveryZone = (client: DataClient, input: CreateDeliveryZoneRequest) =>
  client.post<AdminDeliveryZone>(paths.adminDeliveryZones(), input);

/** `expectedVersion` obligatorio: 409 `DELIVERY_ZONE_VERSION_CONFLICT` si cambió. Solo `zoneLabel` y `baseFee`. */
export const updateAdminDeliveryZone = (
  client: DataClient,
  id: string,
  input: UpdateDeliveryZoneRequest,
) => client.patch<AdminDeliveryZone>(paths.adminDeliveryZone(id), input);

/** Asignación explícita e idempotente (último gana). */
export const updateAdminDeliveryZoneStatus = (
  client: DataClient,
  id: string,
  input: UpdateDeliveryZoneStatusRequest,
) => client.patch<AdminDeliveryZone>(paths.adminDeliveryZoneStatus(id), input);

/** Sin fila = valores por defecto (`isDefault=true`). `pedidosyaEnabled` es administrativo, no integración. */
export const getAdminBranchDeliverySettings = (client: DataClient, branchId: string) =>
  client.get<BranchDeliverySettings>(paths.adminBranchDeliverySettings(branchId));

export const updateAdminBranchDeliverySettings = (
  client: DataClient,
  branchId: string,
  input: UpdateBranchDeliverySettingsRequest,
) => client.patch<BranchDeliverySettings>(paths.adminBranchDeliverySettings(branchId), input);

/**
 * 🎭 Solo simulación (mock): escenario de la respuesta de PedidosYa para la cobertura. `unknown` (defecto) = integración
 * bloqueada. NO existe en la API real: la UI solo lo ofrece con `client.kind === 'mock'`.
 */
export type PedidosyaCoverageScenario = 'unknown' | 'available' | 'unavailable';

export const getPedidosyaCoverageScenario = (client: DataClient) =>
  client.get<{ scenario: PedidosyaCoverageScenario }>(paths.demoPedidosyaCoverage());

export const setPedidosyaCoverageScenario = (
  client: DataClient,
  scenario: PedidosyaCoverageScenario,
) =>
  client.put<{ scenario: PedidosyaCoverageScenario }>(paths.demoPedidosyaCoverage(), { scenario });
