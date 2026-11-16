import type { DataClient } from '@/lib/data-access/types';
import type {
  AdminMediaAsset,
  AdminMediaAssetDetail,
  AdminMediaAssetPage,
  AdminMediaUploadIntent,
  AdminProductMedia,
  AdminProductMediaList,
  CreateMediaUploadIntentRequest,
  MediaKind,
  MediaStatus,
} from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';

/**
 * F14 — Imágenes y medios (R2). Operaciones del contrato: createAdminMediaUpload, completeAdminMediaUpload, listAdminMedia,
 * getAdminMedia, deleteAdminMedia, attachAdminProductMedia, updateAdminProductMedia, reorderAdminProductMedia y
 * detachAdminProductMedia. Los BYTES no pasan por la API: el navegador hace un PUT directo a `uploadUrl` (ver
 * `lib/media-uploader.ts`). Los errores de negocio llegan en `ApiError.businessCode` (`MEDIA_*`, `PRODUCT_MEDIA_*`); la UI
 * ramifica por él, nunca por `message`. Permisos y alcance los decide la API: lectura `catalog.read`; escrituras `catalog.update`
 * con alcance GLOBAL. `uploadUrl` es un secreto de corta vida: no se guarda, no se registra ni se cachea.
 */

/** 200 (`deduplicated=true`: ya existe un asset READY igual, sin URL de subida) o 201 (intent creado; asset PENDING). */
export const createMediaUploadIntent = (
  client: DataClient,
  input: CreateMediaUploadIntentRequest,
) => client.post<AdminMediaUploadIntent>(paths.adminMediaUploadIntents(), input);

/** Confirma el objeto subido (idempotente: un asset READY responde 200). 410 `MEDIA_UPLOAD_EXPIRED` => pedir un intent nuevo. */
export const completeMediaUpload = (client: DataClient, assetId: string) =>
  client.post<AdminMediaAsset>(paths.adminMediaComplete(), { assetId });

export interface MediaFilters {
  /** Tipo de medio; por defecto `PRODUCT_IMAGE` (la biblioteca de productos). */
  kind?: MediaKind;
  status?: MediaStatus;
  /** true = solo sin uso; false = solo usados; undefined = todos. */
  unreferenced?: boolean;
  page?: number;
  pageSize?: number;
}

/** Biblioteca de medios (`kind` = `PRODUCT_IMAGE` por defecto; F16 añade `BANNER_IMAGE`), orden `createdAt desc, id`. */
export const listMedia = (client: DataClient, filters: MediaFilters = {}) =>
  client.get<AdminMediaAssetPage>(paths.adminMediaList(), {
    query: {
      kind: filters.kind ?? 'PRODUCT_IMAGE',
      status: filters.status,
      unreferenced: filters.unreferenced,
      page: filters.page,
      pageSize: filters.pageSize,
    },
  });

export const getMedia = (client: DataClient, id: string) =>
  client.get<AdminMediaAssetDetail>(paths.adminMedia(id));

/** 204. 409 `MEDIA_IN_USE` si algún producto lo usa; 404 al repetir; 503 `MEDIA_STORAGE_UNAVAILABLE`. */
export const deleteMedia = (client: DataClient, id: string) =>
  client.delete<void>(paths.adminMedia(id));

/** 201. Añade el asset READY al final. 409 `MEDIA_ALREADY_ATTACHED`; 422 `MEDIA_ASSET_NOT_READY` | `PRODUCT_MEDIA_INVALID`. */
export const attachProductMedia = (
  client: DataClient,
  productId: string,
  input: { assetId: string; altText?: string | null },
) => client.post<AdminProductMedia>(paths.adminProductMediaList(productId), input);

/** Texto alternativo (`null` o vacío lo borra; ≤ 200). */
export const updateProductMedia = (
  client: DataClient,
  productId: string,
  mediaId: string,
  altText: string | null,
) => client.patch<AdminProductMedia>(paths.adminProductMediaItem(productId, mediaId), { altText });

/** `orderedIds` = ids de `product_media` (no de assets), exactamente todos. 422 `MEDIA_REORDER_MISMATCH`. */
export const reorderProductMedia = (client: DataClient, productId: string, orderedIds: string[]) =>
  client.put<AdminProductMediaList>(paths.adminProductMediaOrder(productId), { orderedIds });

/** Desvincula (204). NO borra el asset de la biblioteca. */
export const detachProductMedia = (client: DataClient, productId: string, mediaId: string) =>
  client.delete<void>(paths.adminProductMediaItem(productId, mediaId));

// ── SIMULADO (solo mock) ─────────────────────────────────────────────────────────────────────

export interface SimulatedMediaObject {
  sizeBytes: number;
  contentType: string;
  checksumSha256: string;
}

/** El «almacén» simulado recibe el objeto (lo que en http haría el PUT directo a R2). Solo existe en el mock. */
export const putSimulatedMediaObject = (
  client: DataClient,
  assetId: string,
  object: SimulatedMediaObject,
) => client.put<void>(paths.demoMediaObject(assetId), object);
