import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Principal } from '../auth/auth.types.js';
import { codedException } from '../common/errors/coded-exception.js';
import { IdentityService } from '../identity/identity.service.js';
import {
  CATALOG_PRODUCTS_PORT,
  type CatalogProductSummary,
  type CatalogProductsPort,
} from './catalog-products.port.js';
import { CATALOG_TIMEOUT_MS, MAX_FAVORITES_PER_CUSTOMER } from './favorites.constants.js';
import { isFavoritable, resolveFavorite, type FavoriteProductView } from './favorites.policy.js';
import { FavoritesRepository } from './favorites.repository.js';

export interface FavoriteItemView {
  productId: string;
  addedAt: Date;
  status: 'ACTIVE' | 'INACTIVE' | 'UNAVAILABLE' | 'REMOVED' | 'UNKNOWN';
  product: FavoriteProductView | null;
}

export interface CustomerFavoritesView {
  items: FavoriteItemView[];
  page: number;
  pageSize: number;
  total: number;
  favoriteProductIds: string[];
  limit: number;
  catalogStatus: 'AVAILABLE' | 'UNAVAILABLE';
}

/** Marca interna: el catálogo no pudo responder (error, excepción o plazo vencido). Nunca sale por HTTP. */
class CatalogDown extends Error {}

/**
 * Favoritos del cliente autenticado (F06). El propietario es SIEMPRE el cliente del JWT (`ensureCustomer`, regla de
 * F04); ningún método recibe un `customerId` externo. El catálogo se consulta en lote y fuera de la transacción.
 * Logs técnicos mínimos: sin ids de cliente ni de producto.
 */
@Injectable()
export class FavoritesService {
  private readonly logger = new Logger(FavoritesService.name);

  constructor(
    @Inject(FavoritesRepository) private readonly repo: FavoritesRepository,
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(CATALOG_PRODUCTS_PORT) private readonly catalog: CatalogProductsPort,
  ) {}

  /** Ids completos (barato) + página de items. `pageSize=0`: sin items y sin consultar el catálogo. */
  async list(
    principal: Principal,
    query: { page: number; pageSize: number },
  ): Promise<CustomerFavoritesView> {
    const customer = await this.identity.ensureCustomer(principal);
    const [rows, total] = await Promise.all([
      this.repo.list(customer.id, MAX_FAVORITES_PER_CUSTOMER),
      this.repo.count(customer.id),
    ]);
    const favoriteProductIds = rows.map((r) => r.productId);
    const base = {
      page: query.page,
      pageSize: query.pageSize,
      total,
      favoriteProductIds,
      limit: MAX_FAVORITES_PER_CUSTOMER,
    };

    const start = (query.page - 1) * query.pageSize;
    const slice = query.pageSize === 0 ? [] : rows.slice(start, start + query.pageSize);
    if (slice.length === 0) return { ...base, items: [], catalogStatus: 'AVAILABLE' };

    let summaries: ReadonlyMap<string, CatalogProductSummary> | null = null;
    try {
      summaries = await this.lookup(slice.map((r) => r.productId));
    } catch {
      this.logger.warn('Catálogo no disponible al listar favoritos; se degrada a UNKNOWN');
    }
    if (summaries === null) {
      return {
        ...base,
        catalogStatus: 'UNAVAILABLE',
        items: slice.map((r) => ({
          productId: r.productId,
          addedAt: r.createdAt,
          status: 'UNKNOWN' as const,
          product: null,
        })),
      };
    }
    const found = summaries;
    return {
      ...base,
      catalogStatus: 'AVAILABLE',
      items: slice.map((r) => ({
        productId: r.productId,
        addedAt: r.createdAt,
        ...resolveFavorite(found.get(r.productId)),
      })),
    };
  }

  /**
   * Marca favorito (idempotente). Orden: cliente → catálogo (fuera de la transacción) → transacción con tope exacto.
   * 503 sin escribir si el catálogo no responde; 404 si no existe o no está publicado; 422 al tope con producto nuevo.
   */
  async add(principal: Principal, productId: string): Promise<void> {
    const customer = await this.identity.ensureCustomer(principal);

    let summaries: ReadonlyMap<string, CatalogProductSummary>;
    try {
      summaries = await this.lookup([productId]);
    } catch {
      this.logger.warn('Catálogo no disponible al marcar favorito; no se escribió nada');
      throw codedException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'CATALOG_UNAVAILABLE',
        'El catálogo no está disponible por ahora',
      );
    }
    if (!isFavoritable(summaries.get(productId))) {
      throw codedException(HttpStatus.NOT_FOUND, 'PRODUCT_NOT_FOUND', 'Producto no encontrado');
    }

    const outcome = await this.repo.add(customer.id, productId, MAX_FAVORITES_PER_CUSTOMER);
    if (outcome === 'LIMIT') {
      this.logger.warn('Tope de favoritos alcanzado');
      throw codedException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'FAVORITES_LIMIT_REACHED',
        `Alcanzaste el máximo de ${MAX_FAVORITES_PER_CUSTOMER} favoritos`,
      );
    }
  }

  /** Quita un favorito PROPIO (idempotente: 204 exista o no). No consulta el catálogo. */
  async remove(principal: Principal, productId: string): Promise<void> {
    const customer = await this.identity.ensureCustomer(principal);
    await this.repo.remove(customer.id, productId);
  }

  /** Una llamada por lote al catálogo con plazo técnico; todo fallo (también el timeout) es `CatalogDown`. */
  private async lookup(
    productIds: readonly string[],
  ): Promise<ReadonlyMap<string, CatalogProductSummary>> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new CatalogDown('timeout')), CATALOG_TIMEOUT_MS);
    });
    try {
      return await Promise.race([this.catalog.findPublicSummaries(productIds), timeout]);
    } catch {
      throw new CatalogDown('catalog');
    } finally {
      clearTimeout(timer);
    }
  }
}
