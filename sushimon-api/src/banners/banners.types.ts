import type { ScheduleSlot } from '../promotions/promotions.types.js';

/** Tipos de dominio de banners (F16). Sin dependencias de Nest ni de Prisma. */

export type BannerLocale = 'es' | 'en';
export const BANNER_LOCALES: readonly BannerLocale[] = ['es', 'en'];

export type BannerCtaType = 'NONE' | 'MENU' | 'PROMOTIONS' | 'CATEGORY' | 'PRODUCT' | 'PAGE';
export const BANNER_CTA_TYPES: readonly BannerCtaType[] = [
  'NONE',
  'MENU',
  'PROMOTIONS',
  'CATEGORY',
  'PRODUCT',
  'PAGE',
];

/** Lista blanca CERRADA de páginas (spec D3). Añadir una = migración + contrato. */
export type BannerPage = 'CAREERS' | 'TRACK_ORDER' | 'INCIDENTS';
export const BANNER_PAGES: readonly BannerPage[] = ['CAREERS', 'TRACK_ORDER', 'INCIDENTS'];

export type BannerScope = 'ALL' | 'SELECTED';
export type BannerLifecycle = 'INACTIVE' | 'SCHEDULED' | 'PUBLISHED' | 'EXPIRED';
export type BannerHiddenReason = 'PROMOTION_NOT_LIVE' | 'CTA_TARGET_INACTIVE' | 'IMAGE_UNAVAILABLE';
export type BannerTextField = 'title' | 'subtitle' | 'ctaLabel' | 'imageAlt';
export const BANNER_TEXT_FIELDS: readonly BannerTextField[] = [
  'title',
  'subtitle',
  'ctaLabel',
  'imageAlt',
];

/** Máximo de banners en la tienda y de banners no vencidos (spec D4). */
export const MAX_STORE_BANNERS = 10;
export const MAX_NON_EXPIRED_BANNERS = 100;

/** Textos de un idioma; `null` = ausente (una cadena en blanco se guarda como ausente). */
export interface BannerText {
  title: string | null;
  subtitle: string | null;
  ctaLabel: string | null;
  imageAlt: string | null;
}

export interface BannerCta {
  type: BannerCtaType;
  categoryId: string | null;
  productId: string | null;
  page: BannerPage | null;
}

/** Promoción vinculada, con lo necesario para decidir su vigencia (función pura de F15). */
export interface LinkedPromotion {
  id: string;
  name: string;
  active: boolean;
  startsAt: Date;
  endsAt: Date;
  /** Vacío = todas las sucursales. */
  branchIds: string[];
  schedule: ScheduleSlot[];
}

/** Banner persistido con sus hijas ya resueltas (vacío = «todas» en sucursales). */
export interface BannerRecord {
  id: string;
  code: string;
  active: boolean;
  sortOrder: number;
  version: number;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  image: { assetId: string; objectKey: string; mimeType: string; sizeBytes: number };
  cta: BannerCta & { targetLabel: string | null; targetActive: boolean | null };
  promotion: LinkedPromotion | null;
  /** Vacío = todas las sucursales. */
  branches: { id: string; name: string }[];
  translations: { es: BannerText | null; en: BannerText | null };
}

/** Estado final de una creación o edición: entrada de las validaciones y de la escritura. */
export interface BannerDraft {
  code: string;
  imageAssetId: string;
  translations: { es: BannerText; en: BannerText | null };
  cta: BannerCta;
  branchScope: BannerScope;
  branchIds: string[];
  promotionId: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  sortOrder: number;
  active: boolean;
}

export interface BannerScalars {
  imageAssetId?: string;
  cta?: BannerCta;
  promotionId?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  sortOrder?: number;
  active?: boolean;
}

export interface BannerLists {
  branchIds?: string[];
  /** `null` = eliminar la traducción de ese idioma (solo `en`). */
  translations?: { es?: BannerText; en?: BannerText | null };
}

export interface NewBanner extends Omit<BannerDraft, 'translations'> {
  translations: { es: BannerText; en: BannerText | null };
}

export type BannerSort = 'priority' | 'startsAt' | 'endsAt' | 'createdAt';

export interface BannerPageFilter {
  /** `null` = alcance global; si no, las sucursales visibles para el actor. */
  scopeBranchIds: readonly string[] | null;
  branchId?: string;
  lifecycle?: BannerLifecycle;
  pattern: string | null;
  sort: BannerSort;
  order: 'asc' | 'desc';
  now: Date;
  page: number;
  pageSize: number;
}

/** Fila mínima del asset para validar la imagen. */
export interface BannerAssetRow {
  id: string;
  kind: string;
  status: string;
}

/** Fila de orden (no vencidos). */
export interface BannerOrderRow {
  id: string;
  sortOrder: number;
  version: number;
}

/** Candidato público ya filtrado por SQL (activo, no vencido, sucursal, imagen READY BANNER_IMAGE, `es` válida). */
export interface StoreCandidate {
  id: string;
  sortOrder: number;
  createdAt: Date;
  startsAt: Date | null;
  endsAt: Date | null;
  ctaType: BannerCtaType;
  categorySlug: string | null;
  productId: string | null;
  page: BannerPage | null;
  /** `null` si el tipo no tiene destino de catálogo. */
  targetActive: boolean | null;
  promotionId: string | null;
  imageObjectKey: string;
  imageMimeType: string;
  translations: { es: BannerText | null; en: BannerText | null };
}

export interface StoreBannerView {
  id: string;
  title: string;
  subtitle: string | null;
  ctaLabel: string | null;
  imageAlt: string;
  image: { url: string; mimeType: string };
  cta: {
    type: BannerCtaType;
    categorySlug: string | null;
    productId: string | null;
    page: BannerPage | null;
  };
  fallbackFields: BannerTextField[];
}

/** Resultado del lector público reutilizable (F17 lo consumirá). */
export interface ActiveBanners {
  items: StoreBannerView[];
  /** ISO 8601 o `null`. */
  nextChangeAt: string | null;
  generatedAt: string;
}

export interface FindActiveBannersInput {
  branchId?: string | null;
  locale: BannerLocale;
}
