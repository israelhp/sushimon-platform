import type { DataClient } from '@/lib/data-access/types';
import type {
  AdminBanner,
  AdminBannerOrder,
  AdminBannerPage,
  AdminBannerSummary,
  BannerLifecycle,
  BannerLocale,
  CreateBannerRequest,
  StoreBannerList,
  UpdateBannerRequest,
  UpdateBannerStatusRequest,
} from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';
import { BANNER_PAGE_SIZE_MAX } from '@/lib/banner-rules';

/**
 * F16 — Banners del Inicio. Operaciones del contrato: listStoreBanners, listAdminBanners, createAdminBanner, getAdminBanner,
 * updateAdminBanner, updateAdminBannerStatus y reorderAdminBanners. La tienda NUNCA decide qué banner se publica: muestra lo que
 * devuelve el servidor (vigencia, sucursal, promoción vinculada y traducciones ya resueltas). Los errores de negocio llegan en
 * `ApiError.businessCode` (`BANNER_*`, `BRANCH_NOT_FOUND`, `BANNERS_BUSY`) y `violations`; la UI ramifica por ellos, nunca por
 * `message`. La API decide permisos y alcance (`banners.read|create|update`, aal2); sin borrado físico.
 */

/** Público (sin sesión). Sin `branchId` solo salen los banners de todas las sucursales; 404 `BRANCH_NOT_FOUND` si la sucursal no existe o está inactiva. */
export const listStoreBanners = (
  client: DataClient,
  branchId: string | null,
  locale: BannerLocale = 'es',
) =>
  client.get<StoreBannerList>(paths.storeBanners(), {
    query: { branchId: branchId ?? undefined, locale },
  });

export interface AdminBannerFilters {
  branchId?: string;
  lifecycle?: BannerLifecycle;
  /** Título (cualquier idioma) o código (≤ 80). */
  q?: string;
  sort?: 'priority' | 'startsAt' | 'endsAt' | 'createdAt';
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export const listAdminBanners = (client: DataClient, filters: AdminBannerFilters = {}) =>
  client.get<AdminBannerPage>(paths.adminBanners(), {
    query: {
      branchId: filters.branchId,
      lifecycle: filters.lifecycle,
      q: filters.q?.trim() || undefined,
      sort: filters.sort,
      order: filters.order,
      page: filters.page,
      pageSize: filters.pageSize,
    },
  });

/** Todos los banners en orden de prioridad (recorre las páginas): base del reordenado, que exige el conjunto EXACTO de no vencidos. */
export async function listAllAdminBanners(client: DataClient): Promise<AdminBannerSummary[]> {
  const items: AdminBannerSummary[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const result = await listAdminBanners(client, {
      sort: 'priority',
      order: 'asc',
      page,
      pageSize: BANNER_PAGE_SIZE_MAX,
    });
    items.push(...result.items);
    if (items.length >= result.total || result.items.length === 0) break;
  }
  return items;
}

export const getAdminBanner = (client: DataClient, id: string) =>
  client.get<AdminBanner>(paths.adminBanner(id));

/** `active` es opcional (por defecto `true`); el tipo generado lo marca obligatorio por su `default`. */
export type CreateBannerInput = Omit<CreateBannerRequest, 'active'> & { active?: boolean };

/** 403 `BANNER_SCOPE_FORBIDDEN`; 404 `BRANCH_NOT_FOUND`; 409 `BANNER_CODE_TAKEN`; 422 `BANNER_{IMAGE,TRANSLATION,CTA,PERIOD,SCOPE,PROMOTION}_INVALID` | `BANNER_LIMIT_REACHED`; 503 `BANNERS_BUSY`. */
export const createAdminBanner = (client: DataClient, input: CreateBannerInput) =>
  client.post<AdminBanner>(paths.adminBanners(), input);

/** Parcial con `expectedVersion` OBLIGATORIO: 409 `BANNER_VERSION_CONFLICT` sin guardar. `code` y `active` NO se aceptan aquí. */
export const updateAdminBanner = (client: DataClient, id: string, input: UpdateBannerRequest) =>
  client.patch<AdminBanner>(paths.adminBanner(id), input);

/** Idempotente y sin `expectedVersion` (el último valor gana). */
export const updateAdminBannerStatus = (
  client: DataClient,
  id: string,
  input: UpdateBannerStatusRequest,
) => client.patch<AdminBanner>(paths.adminBannerStatus(id), input);

/** `orderedIds` = EXACTAMENTE los banners no vencidos (422 `BANNER_REORDER_MISMATCH`); exige alcance global (403). */
export const reorderAdminBanners = (client: DataClient, orderedIds: string[]) =>
  client.put<AdminBannerOrder>(paths.adminBannersOrder(), { orderedIds });
