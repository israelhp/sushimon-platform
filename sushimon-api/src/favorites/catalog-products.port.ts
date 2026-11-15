/** Token de inyección del puerto de catálogo (F11 aportará el adaptador real). */
export const CATALOG_PRODUCTS_PORT = Symbol('CATALOG_PRODUCTS_PORT');

/** Estado de publicación de un producto según el catálogo. Cualquier otro valor se trata como `UNKNOWN`. */
export type CatalogProductStatus = 'ACTIVE' | 'INACTIVE' | 'UNAVAILABLE' | 'REMOVED';

/** Resumen público MÍNIMO de un producto: sin precios, disponibilidad por sucursal ni datos internos. */
export interface CatalogProductSummary {
  id: string;
  name: string;
  nameEn: string | null;
  imageUrl: string | null;
  categoryId: string | null;
  status: CatalogProductStatus;
}

/** El catálogo no puede responder (no implementado, caído o con error). El detalle nunca sale por HTTP. */
export class CatalogUnavailableError extends Error {
  constructor(message = 'Catálogo no disponible') {
    super(message);
    this.name = 'CatalogUnavailableError';
  }
}

/**
 * Consulta del catálogo EN LOTE (una llamada por solicitud, sin N+1). Un id ausente del mapa = el producto no
 * existe. Si no puede responder, lanza `CatalogUnavailableError`.
 */
export interface CatalogProductsPort {
  findPublicSummaries(
    productIds: readonly string[],
  ): Promise<ReadonlyMap<string, CatalogProductSummary>>;
}
