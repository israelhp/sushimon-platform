/** Tipos de dominio de banners (F16 simplificado, ADR-0033). Sin dependencias de Nest ni de Prisma. */

/** Tope global de banners (activos más inactivos); lo impone el servicio y, como respaldo, un trigger de BD. */
export const MAX_BANNERS = 5;

/** Banner persistido con su imagen y su texto alternativo (la API ignora cta_*, fechas, sucursales, promoción y `en`). */
export interface BannerRecord {
  id: string;
  active: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  /** Texto alternativo de la fila `es` (`''` si la fila no existiera: no ocurre con datos creados por la API). */
  imageAlt: string;
  image: { assetId: string; objectKey: string; mimeType: string; sizeBytes: number };
}

/** Estado editable de un banner (entrada de las validaciones, el diff y la auditoría). */
export interface BannerState {
  imageAssetId: string;
  imageAlt: string;
  active: boolean;
}

export interface NewBanner extends BannerState {
  id: string;
  /** Código interno generado por la API (columna UNIQUE conservada). */
  code: string;
}

export interface BannerScalars {
  imageAssetId?: string;
  imageAlt?: string;
  active?: boolean;
}

/** Fila mínima del asset para validar la imagen. */
export interface BannerAssetRow {
  id: string;
  kind: string;
  status: string;
}

/** Banner público tal como lo devuelve la lectura (antes de resolver la URL de la imagen). */
export interface StoreBannerRow {
  id: string;
  alt: string;
  objectKey: string;
  mimeType: string;
}

export interface StoreBannerView {
  id: string;
  image: { url: string; mimeType: string };
  alt: string;
}
