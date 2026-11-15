/**
 * Tope técnico de favoritos por cliente (F06 D10). Constante de código, no variable de entorno: cambiarlo requiere ADR.
 * Acota `favoriteProductIds` (~8 KB), el lote al catálogo y el abuso de escritura.
 */
export const MAX_FAVORITES_PER_CUSTOMER = 200;

/** Tamaño de página por defecto y máximo de `GET /v1/me/favorites` (`pageSize=0` = solo ids). */
export const DEFAULT_FAVORITES_PAGE_SIZE = 20;
export const MAX_FAVORITES_PAGE_SIZE = 50;
export const MAX_FAVORITES_PAGE = 10_000;

/** Plazo técnico de la consulta por lote al catálogo (F06 D6). Sin variable de entorno. */
export const CATALOG_TIMEOUT_MS = 3_000;

/** Prefijo común de la ruta (`/v1/me/favorites`). */
export const FAVORITES_ROUTE = 'me/favorites';

/** Cache-Control de los éxitos: datos personales, nunca en CDN ni caché compartida (F06 D12). */
export const FAVORITES_CACHE_CONTROL = 'private, no-store';
