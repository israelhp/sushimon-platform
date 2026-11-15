import type { CustomerFavorites } from '@/lib/data-access/models';

/**
 * Transformaciones PURAS de la caché de favoritos (sin React): la actualización optimista y su rollback solo tocan el
 * producto afectado, así que dos mutaciones de productos distintos en vuelo no se pisan entre sí.
 */

const withIds = (data: CustomerFavorites, ids: string[]): CustomerFavorites => ({
  ...data,
  favoriteProductIds: ids,
  total: Math.max(0, data.total + (ids.length - data.favoriteProductIds.length)),
});

/** Alta (al inicio, más reciente primero) o baja del producto. Idempotente. */
export function applyToggle(
  data: CustomerFavorites,
  productId: string,
  favorite: boolean,
): CustomerFavorites {
  const rest = data.favoriteProductIds.filter((id) => id !== productId);
  return withIds(data, favorite ? [productId, ...rest] : rest);
}

/**
 * Deshace SOLO el producto afectado: si antes era favorito lo devuelve a su posición previa (acotada); si no lo era, lo quita.
 * Los demás productos conservan su estado actual (incluidos los cambios optimistas de otras mutaciones en vuelo).
 */
export function rollbackToggle(
  data: CustomerFavorites,
  productId: string,
  was: { favorite: boolean; index: number },
): CustomerFavorites {
  const rest = data.favoriteProductIds.filter((id) => id !== productId);
  if (!was.favorite) return withIds(data, rest);
  const at = Math.min(Math.max(was.index, 0), rest.length);
  return withIds(data, [...rest.slice(0, at), productId, ...rest.slice(at)]);
}

/** Quita el producto de una página de Mis favoritos (baja optimista). */
export function removeFromPage(data: CustomerFavorites, productId: string): CustomerFavorites {
  if (!data.items.some((item) => item.productId === productId)) return data;
  return {
    ...data,
    items: data.items.filter((item) => item.productId !== productId),
    favoriteProductIds: data.favoriteProductIds.filter((id) => id !== productId),
    total: Math.max(0, data.total - 1),
  };
}
