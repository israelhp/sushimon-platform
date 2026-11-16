import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module.js';
import { CATALOG_PRODUCTS_PORT } from './catalog-products.port.js';
import {
  CUSTOMER_FAVORITES_READER,
  PrismaCustomerFavoritesReader,
} from './customer-favorites.reader.js';
import { FavoritesController } from './favorites.controller.js';
import { FavoritesRepository } from './favorites.repository.js';
import { FavoritesService } from './favorites.service.js';
import { ProductsCatalogAdapter } from './products-catalog.adapter.js';

/**
 * F06: favoritos de clientes. Usa `IdentityService` (global desde AuthModule) y `PrismaService` (global); no depende
 * de `CustomersModule`. El puerto de catálogo se enlaza al adaptador REAL de F11 (`ProductsCatalogAdapter`, vía
 * `ProductsModule`); `UnavailableCatalogAdapter` ya no se usa en el módulo (queda como doble de prueba). Exporta el lector de ids para F17 (`GET /v1/me/storefront`).
 */
@Module({
  imports: [ProductsModule],
  controllers: [FavoritesController],
  providers: [
    FavoritesRepository,
    FavoritesService,
    PrismaCustomerFavoritesReader,
    { provide: CUSTOMER_FAVORITES_READER, useExisting: PrismaCustomerFavoritesReader },
    { provide: CATALOG_PRODUCTS_PORT, useClass: ProductsCatalogAdapter },
  ],
  exports: [CUSTOMER_FAVORITES_READER],
})
export class FavoritesModule {}
