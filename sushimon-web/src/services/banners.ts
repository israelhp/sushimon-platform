import type { DataClient } from '@/lib/data-access/types';
import type {
  AdminBanner,
  AdminBannerList,
  CreateBannerRequest,
  StoreBannerList,
  UpdateBannerRequest,
} from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';

/**
 * F16 (simplificado, ADR-0033) — Banners del Inicio: imagen + texto alternativo + activo. Operaciones del contrato:
 * listStoreBanners, listAdminBanners, createAdminBanner, getAdminBanner, updateAdminBanner y deleteAdminBanner. La tienda NUNCA decide
 * qué banner se publica: muestra lo que devuelve el servidor (los activos, en orden de creación). Los errores de negocio llegan en
 * `ApiError.businessCode` (`BANNER_*`, `BANNERS_BUSY`) y `violations`; la UI ramifica por ellos, nunca por `message`. La API decide
 * permisos y alcance (`banners.read|create|update` con alcance global, aal2).
 */

/** Público (sin sesión, sin parámetros): banners activos, máx. 5, en orden de creación. */
export const listStoreBanners = (client: DataClient) =>
  client.get<StoreBannerList>(paths.storeBanners(), { public: true });

/** Todos (activos e inactivos; de 0 a 5) en orden de creación. Sin filtros ni paginación. */
export const listAdminBanners = (client: DataClient) =>
  client.get<AdminBannerList>(paths.adminBanners());

export const getAdminBanner = (client: DataClient, id: string) =>
  client.get<AdminBanner>(paths.adminBanner(id));

/** `active` es opcional (por defecto `true`); el tipo generado lo marca obligatorio por su `default`. */
export type CreateBannerInput = Omit<CreateBannerRequest, 'active'> & { active?: boolean };

/** 409 `BANNER_LIMIT_REACHED` (ya hay 5); 422 `BANNER_IMAGE_INVALID` | `BANNER_ALT_INVALID`; 503 `BANNERS_BUSY`. */
export const createAdminBanner = (client: DataClient, input: CreateBannerInput) =>
  client.post<AdminBanner>(paths.adminBanners(), input);

/** Parcial con `expectedVersion` OBLIGATORIO: 409 `BANNER_VERSION_CONFLICT` sin guardar. Admite imagen, texto alternativo y `active`. */
export const updateAdminBanner = (client: DataClient, id: string, input: UpdateBannerRequest) =>
  client.patch<AdminBanner>(paths.adminBanner(id), input);

/** Borrado físico (204) con `expectedVersion` en la query: 409 `BANNER_VERSION_CONFLICT`; repetirlo => 404 `BANNER_NOT_FOUND`. */
export const deleteAdminBanner = (client: DataClient, id: string, expectedVersion: number) =>
  client.delete<void>(paths.adminBanner(id), { query: { expectedVersion } });
