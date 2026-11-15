import { isApiError } from '@/lib/data-access/errors';

/**
 * Clasificación de los errores de favoritos por `code` de negocio / estado HTTP. NUNCA por `message` (spec 009 D16).
 * `unauthorized` = la sesión terminó (401): se limpia la caché del cliente y se invita a iniciar sesión.
 */
export type FavoriteErrorKind =
  | 'limit'
  | 'catalog'
  | 'busy'
  | 'notFound'
  | 'rateLimited'
  | 'unauthorized'
  | 'offline'
  | 'generic';

export function favoriteErrorKind(error: unknown): FavoriteErrorKind {
  if (!isApiError(error)) return 'generic';
  switch (error.businessCode) {
    case 'FAVORITES_LIMIT_REACHED':
      return 'limit';
    case 'CATALOG_UNAVAILABLE':
      return 'catalog';
    case 'FAVORITES_BUSY':
      return 'busy';
    case 'PRODUCT_NOT_FOUND':
      return 'notFound';
    case 'RATE_LIMITED':
      return 'rateLimited';
  }
  if (error.status === 401) return 'unauthorized';
  if (error.status === 429) return 'rateLimited';
  if (error.status === 0) return 'offline';
  return 'generic';
}
