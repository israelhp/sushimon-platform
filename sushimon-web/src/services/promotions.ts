import type { DataClient } from '@/lib/data-access/types';
import type {
  AdminPromotion,
  AdminPromotionPage,
  CreatePromotionRequest,
  PromotionKind,
  StorePromotionList,
  UpdatePromotionRequest,
  UpdatePromotionStatusRequest,
} from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';

/**
 * F15 — Promociones, cupones y Happy Hour. Operaciones del contrato: listStorePromotions, listAdminPromotions, getAdminPromotion,
 * createAdminPromotion, updateAdminPromotion y updateAdminPromotionStatus. Importes = CADENAS decimales (`"15.00"`); instantes
 * ISO 8601 con zona; horario semanal en hora local de `America/Guatemala` (día ISO 1–7). Los errores de negocio llegan en
 * `ApiError.businessCode` (`PROMOTION_*`, `BRANCH_NOT_FOUND`, `PROMOTIONS_BUSY`) y `violations`; la UI ramifica por ellos, nunca por
 * `message`. La API decide permisos y alcance (`promotions.read|create|update`, aal2); sin borrado físico.
 */

export type StorePromotionState = 'live' | 'upcoming';

/** Público (sin sesión): vigentes o próximas de una sucursal ACTIVA (404 `BRANCH_NOT_FOUND` si no existe o está inactiva). Nunca trae el código de un cupón. */
export const listStorePromotions = (
  client: DataClient,
  branchId: string,
  state: StorePromotionState = 'live',
) => client.get<StorePromotionList>(paths.storePromotions(), { query: { branchId, state } });

export type AdminPromotionStatusFilter =
  'active' | 'inactive' | 'scheduled' | 'running' | 'expired';

export interface AdminPromotionFilters {
  branchId?: string;
  status?: AdminPromotionStatusFilter;
  kind?: PromotionKind;
  /** Instantes ISO 8601 con zona; `to > from`. */
  from?: string;
  to?: string;
  /** Nombre o código (≤ 80). */
  q?: string;
  sort?: 'startsAt' | 'endsAt' | 'name' | 'createdAt';
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export const listAdminPromotions = (client: DataClient, filters: AdminPromotionFilters = {}) =>
  client.get<AdminPromotionPage>(paths.adminPromotions(), {
    query: {
      branchId: filters.branchId,
      status: filters.status,
      kind: filters.kind,
      from: filters.from,
      to: filters.to,
      q: filters.q?.trim() || undefined,
      sort: filters.sort,
      order: filters.order,
      page: filters.page,
      pageSize: filters.pageSize,
    },
  });

export const getAdminPromotion = (client: DataClient, id: string) =>
  client.get<AdminPromotion>(paths.adminPromotion(id));

/** `dineInOnly` y `active` son opcionales (por defecto `false` y `true`); el tipo generado los marca obligatorios por su `default`. */
export type CreatePromotionInput = Omit<CreatePromotionRequest, 'dineInOnly' | 'active'> & {
  dineInOnly?: boolean;
  active?: boolean;
};

/** 403 `PROMOTION_SCOPE_FORBIDDEN`; 404 `BRANCH_NOT_FOUND`; 409 `PROMOTION_CODE_TAKEN`; 422 `PROMOTION_{VALUE,PERIOD,SCHEDULE,SCOPE}_INVALID`; 503 `PROMOTIONS_BUSY`. */
export const createAdminPromotion = (client: DataClient, input: CreatePromotionInput) =>
  client.post<AdminPromotion>(paths.adminPromotions(), input);

/** Parcial con `expectedVersion` OBLIGATORIO: 409 `PROMOTION_VERSION_CONFLICT` sin guardar. `active` NO se acepta aquí (usa el estado). */
export const updateAdminPromotion = (
  client: DataClient,
  id: string,
  input: UpdatePromotionRequest,
) => client.patch<AdminPromotion>(paths.adminPromotion(id), input);

/** Idempotente y sin `expectedVersion` (el último valor gana). */
export const updateAdminPromotionStatus = (
  client: DataClient,
  id: string,
  input: UpdatePromotionStatusRequest,
) => client.patch<AdminPromotion>(paths.adminPromotionStatus(id), input);
