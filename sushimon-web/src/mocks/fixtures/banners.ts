import { sha256Hex } from '../sha256';

/**
 * Banners del mock (F16 simplificado, ADR-0033): reproducen `app.banners` = imagen (asset `BANNER_IMAGE` de la biblioteca de medios
 * SIMULADA) + texto alternativo (un solo idioma) + `active` + `version`. Sin títulos, CTA, vigencia, sucursales, prioridad ni
 * promoción: el orden es el de creación (`createdAt`, desempate `id`). Máximo 5 en total (activos + inactivos); la semilla trae 4
 * (3 activos y 1 inactivo) para poder crear uno más y llegar al tope. El `code` es interno (la API lo genera; NO sale del contrato).
 * Las imágenes viven en el host reservado `*.invalid`: nunca se piden por red (sin bytes la tienda muestra el fondo de marca).
 */
export interface BannerRecord {
  id: string;
  /** Identificador interno (no forma parte del contrato). */
  code: string;
  imageAssetId: string;
  imageAlt: string;
  active: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Asset semilla de imagen de banner (la biblioteca SIMULADA lo materializa como `MediaAssetRecord`). */
export interface BannerAssetSeed {
  id: string;
  checksumSha256: string;
  objectKey: string;
  sizeBytes: number;
}

const assetOf = (code: string): string => `media-seed-banner-${code}`;

const seed = (
  n: number,
  id: string,
  code: string,
  imageAlt: string,
  active = true,
): BannerRecord => {
  const at = `2026-10-${String(20 + n).padStart(2, '0')}T18:00:00.000Z`;
  return {
    id,
    code,
    imageAssetId: assetOf(code),
    imageAlt,
    active,
    version: 1,
    createdAt: at,
    updatedAt: at,
  };
};

/** En orden de creación. */
export const BANNER_SEEDS: BannerRecord[] = [
  seed(0, 'banner-favoritos', 'favoritos', 'Selección de rolls favoritos de Sushi Mon'),
  seed(1, 'banner-happy-hour', 'happy-hour', 'Mesa con rolls y bebidas durante el Happy Hour'),
  seed(2, 'banner-calientito', 'calientito', 'Calientito Roll recién salido de la cocina'),
  // Inactivo: no sale en la tienda.
  seed(3, 'banner-navidad', 'navidad', 'Rolls con decoración navideña', false),
];

const SEED_AT = '2026-11-01T12:00:00.000Z';

/** Un asset WebP READY por banner semilla (sin bytes; tamaño plausible bajo 1 MiB). */
export const BANNER_ASSET_SEEDS: readonly BannerAssetSeed[] = BANNER_SEEDS.map((b, i) => ({
  id: b.imageAssetId,
  checksumSha256: sha256Hex(`sushimon-mock-banner-${b.code}`),
  objectKey: `banners/2026/${b.imageAssetId}.webp`,
  sizeBytes: 180_000 + i * 17_311,
}));

export const BANNER_ASSET_SEED_AT = SEED_AT;
