/** Tipos compartidos del módulo de medios (F14). Sin dependencias de Nest ni de Prisma. */

export type MediaKind = 'PRODUCT_IMAGE' | 'BANNER_IMAGE';
export type MediaStatus = 'PENDING' | 'READY';
/** Modo del adaptador activo. `UNAVAILABLE` no se expone en el contrato (las operaciones responden 503). */
export type StorageKind = 'R2' | 'MOCK' | 'UNAVAILABLE';
/** Lo que expone el contrato (`MediaStorageMode`). */
export type MediaStorageMode = 'R2' | 'MOCK';

export interface MediaAssetRow {
  id: string;
  kind: MediaKind;
  objectKey: string;
  bucket: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  status: MediaStatus;
  createdByStaffId: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
  expiresAt: Date | null;
  usageCount: number;
}

export interface NewPendingAsset {
  kind: MediaKind;
  objectKey: string;
  bucket: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  createdByStaffId: string;
  expiresAt: Date;
}

export interface MediaPageFilter {
  kind?: MediaKind;
  status?: MediaStatus;
  /** `true` = solo sin usos; `false` = solo usados; `undefined` = todos. */
  unreferenced?: boolean;
  page: number;
  pageSize: number;
}

export interface MediaUsageRow {
  productId: string;
  productName: string;
  productMediaId: string;
}

/** Banner (F16) que usa el asset como imagen. */
export interface MediaBannerUsageRow {
  bannerId: string;
  bannerAlt: string;
}

export interface AdminMediaAssetView {
  id: string;
  kind: MediaKind;
  status: MediaStatus;
  url: string | null;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  createdAt: string;
  confirmedAt: string | null;
  expiresAt: string | null;
  usageCount: number;
  storageMode: MediaStorageMode;
}

export interface AdminMediaAssetDetailView extends AdminMediaAssetView {
  usages: MediaUsageRow[];
  /** F16: banners que usan el asset (vacío si ninguno). */
  bannerUsages: MediaBannerUsageRow[];
}

export interface AdminMediaAssetPageView {
  items: AdminMediaAssetView[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AdminMediaUploadIntentView {
  assetId: string;
  deduplicated: boolean;
  uploadUrl: string | null;
  headers: Record<string, string> | null;
  expiresAt: string | null;
  storageMode: MediaStorageMode;
  asset: AdminMediaAssetView;
}
