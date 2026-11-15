import { Module } from '@nestjs/common';
import { CATALOG_PRODUCTS_PORT } from './catalog-products.port.js';
import {
  CUSTOMER_FAVORITES_READER,
  PrismaCustomerFavoritesReader,
} from './customer-favorites.reader.js';
import { FavoritesController } from './favorites.controller.js';
import { FavoritesRepository } from './favorites.repository.js';
import { FavoritesService } from './favorites.service.js';
import { UnavailableCatalogAdapter } from './unavailable-catalog.adapter.js';

/**
 * F06: favoritos de clientes. Usa `IdentityService` (global desde AuthModule) y `PrismaService` (global); no depende
 * de `CustomersModule`. El catálogo real no existe (F11): el puerto se enlaza a `UnavailableCatalogAdapter` y F11
 * reemplaza SOLO este proveedor. Exporta el lector de ids para F17 (`GET /v1/me/storefront`).
 */
@Module({
  controllers: [FavoritesController],
  providers: [
    FavoritesRepository,
    FavoritesService,
    PrismaCustomerFavoritesReader,
    { provide: CUSTOMER_FAVORITES_READER, useExisting: PrismaCustomerFavoritesReader },
    { provide: CATALOG_PRODUCTS_PORT, useClass: UnavailableCatalogAdapter },
  ],
  exports: [CUSTOMER_FAVORITES_READER],
})
export class FavoritesModule {}
