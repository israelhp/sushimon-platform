import { Inject, Injectable, Logger } from '@nestjs/common';
import { dbErrorCodes } from '../common/db/db-error-codes.js';
import { ProductsQueryService } from '../products/products-query.service.js';
import {
  CatalogUnavailableError,
  type CatalogProductSummary,
  type CatalogProductsPort,
} from './catalog-products.port.js';

/**
 * Adaptador REAL del puerto de catálogo de favoritos (F11, spec D9). Delega en `ProductsQueryService` (una consulta por
 * lote). Solo devuelve productos VISIBLES (activos y con categoría efectivamente visible), todos con `status='ACTIVE'`;
 * uno no visible queda ausente del mapa (favoritos lo muestra como `REMOVED`). Cualquier fallo de BD/timeout =>
 * `CatalogUnavailableError` (503 `CATALOG_UNAVAILABLE` en PUT; `UNKNOWN` en GET), sin filtrar la causa.
 * `nameEn` es `null` (no hay textos por idioma) e `imageUrl` es la primera imagen o `null`.
 */
@Injectable()
export class ProductsCatalogAdapter implements CatalogProductsPort {
  private readonly logger = new Logger(ProductsCatalogAdapter.name);

  constructor(@Inject(ProductsQueryService) private readonly products: ProductsQueryService) {}

  async findPublicSummaries(
    productIds: readonly string[],
  ): Promise<ReadonlyMap<string, CatalogProductSummary>> {
    try {
      const visible = await this.products.findVisibleSummariesByIds(productIds);
      return new Map(
        [...visible].map(([id, p]) => [
          id,
          {
            id,
            name: p.name,
            nameEn: null,
            imageUrl: p.imageUrl,
            categoryId: p.categoryId,
            status: 'ACTIVE' as const,
          },
        ]),
      );
    } catch (error) {
      // Solo nombre y código del error: nunca el mensaje (puede traer host/SQL) ni ids.
      const name = error instanceof Error ? error.name : typeof error;
      this.logger.warn(
        `Catálogo de productos no disponible (error=${name}, code=${dbErrorCodes(error)[0] ?? 'n/a'})`,
      );
      throw new CatalogUnavailableError('Catálogo de productos no disponible');
    }
  }
}
