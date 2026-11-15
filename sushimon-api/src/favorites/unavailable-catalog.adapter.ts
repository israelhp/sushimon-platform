import { Injectable } from '@nestjs/common';
import {
  CatalogUnavailableError,
  type CatalogProductSummary,
  type CatalogProductsPort,
} from './catalog-products.port.js';

/**
 * Adaptador por defecto mientras no exista el catálogo real (F11): SIEMPRE "no disponible", sin red ni datos
 * inventados. Con él, `PUT` responde 503 `CATALOG_UNAVAILABLE` y `GET` degrada a `UNKNOWN`.
 */
@Injectable()
export class UnavailableCatalogAdapter implements CatalogProductsPort {
  findPublicSummaries(): Promise<ReadonlyMap<string, CatalogProductSummary>> {
    return Promise.reject(new CatalogUnavailableError('Catálogo no implementado (F11 pendiente)'));
  }
}
