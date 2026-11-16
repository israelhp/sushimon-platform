import { simulatedPublicUrl } from '@/lib/media-simulated';
import { sha256Hex } from '../sha256';

/**
 * F14 — Semillas SIMULADAS de la biblioteca de medios. No hay bytes: las URLs usan el host reservado `*.invalid` (nunca
 * resuelve, no se pide por red) y los checksums son SHA-256 de textos fijos. El primero está vinculado a «dumplings» (para
 * MEDIA_IN_USE); los otros dos están libres (reutilizar / eliminar).
 */
export interface MediaAssetSeed {
  id: string;
  mimeType: 'image/webp';
  sizeBytes: number;
  checksumSha256: string;
  objectKey: string;
  createdAt: string;
  confirmedAt: string;
  /** Producto al que está vinculado (null = libre). */
  attachedTo: string | null;
  altText: string | null;
}

const SEED_AT = '2026-11-01T12:00:00.000Z';

const seed = (n: number, size: number, attachedTo: string | null, altText: string | null) => {
  const id = `media-seed-${n}`;
  return {
    id,
    mimeType: 'image/webp' as const,
    sizeBytes: size,
    checksumSha256: sha256Hex(`sushimon-mock-media-${n}`),
    objectKey: `products/2026/${id}.webp`,
    createdAt: SEED_AT,
    confirmedAt: SEED_AT,
    attachedTo,
    altText,
  } satisfies MediaAssetSeed;
};

export const MEDIA_ASSET_SEEDS: readonly MediaAssetSeed[] = [
  seed(1, 84_213, 'dumplings', 'Dumplings (imagen de ejemplo)'),
  seed(2, 61_540, null, null),
  seed(3, 120_907, null, null),
];

export const seedAssetUrl = (s: MediaAssetSeed): string => simulatedPublicUrl(s.id, 'webp', 2026);
