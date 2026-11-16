import { Injectable } from '@nestjs/common';
import {
  CatalogUnavailableError,
  type CatalogProductSummary,
  type CatalogProductsPort,
} from './catalog-products.port.js';

/**
 * Doble de prueba: SIEMPRE "no disponible", sin red ni datos inventados. Ya NO está enlazado en `FavoritesModule`
 * (F11 aportó `ProductsCatalogAdapter`); se conserva para probar la degradación (`PUT` 503 `CATALOG_UNAVAILABLE`,
 * `GET` => `UNKNOWN`).
 */
@Injectable()
export class UnavailableCatalogAdapter implements CatalogProductsPort {
  findPublicSummaries(): Promise<ReadonlyMap<string, CatalogProductSummary>> {
    return Promise.reject(new CatalogUnavailableError('Catálogo no implementado (F11 pendiente)'));
  }
}
