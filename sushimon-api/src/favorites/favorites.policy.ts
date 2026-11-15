import type { CatalogProductSummary } from './catalog-products.port.js';

export type FavoriteStatus = 'ACTIVE' | 'INACTIVE' | 'UNAVAILABLE' | 'REMOVED' | 'UNKNOWN';

export interface FavoriteProductView {
  id: string;
  name: string;
  nameEn: string | null;
  imageUrl: string | null;
  categoryId: string | null;
}

/** Estados en los que el producto es un favorito válido y se muestra su resumen (A4: UNAVAILABLE sí, INACTIVE no). */
const VISIBLE: ReadonlySet<string> = new Set(['ACTIVE', 'UNAVAILABLE']);
const KNOWN: ReadonlySet<string> = new Set(['ACTIVE', 'INACTIVE', 'UNAVAILABLE', 'REMOVED']);

/** ¿Se puede marcar como favorito un producto con este resumen? (ausente, `INACTIVE`, `REMOVED` o desconocido: no). */
export function isFavoritable(summary: CatalogProductSummary | undefined): boolean {
  return summary !== undefined && VISIBLE.has(summary.status);
}

/** Longitud máxima aceptada de una URL de imagen. */
export const MAX_IMAGE_URL_LENGTH = 2048;

/** Solo https absoluta y acotada: nunca `http:`, `javascript:`, `data:` ni rutas relativas aunque el catálogo las devolviera. */
function safeImageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_IMAGE_URL_LENGTH) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

const orNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/**
 * Estado y resumen de un favorito frente al catálogo. Lista blanca: cualquier campo extra del puerto (precios,
 * costos, notas) se descarta. Ausente del mapa = el producto ya no existe (`REMOVED`).
 */
export function resolveFavorite(summary: CatalogProductSummary | undefined): {
  status: FavoriteStatus;
  product: FavoriteProductView | null;
} {
  if (summary === undefined) return { status: 'REMOVED', product: null };
  const raw: string = summary.status;
  if (!KNOWN.has(raw)) return { status: 'UNKNOWN', product: null };
  if (!VISIBLE.has(raw)) return { status: raw as FavoriteStatus, product: null };
  return {
    status: raw as FavoriteStatus,
    product: {
      id: summary.id,
      name: summary.name,
      nameEn: orNull(summary.nameEn),
      imageUrl: safeImageUrl(summary.imageUrl),
      categoryId: orNull(summary.categoryId),
    },
  };
}
