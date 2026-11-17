import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BannersReadModule } from '../banners/banners-read.module.js';
import { BranchProductsModule } from '../branch-products/branch-products.module.js';
import { BranchScheduleModule } from '../branch-schedule/branch-schedule.module.js';
import { CLOCK, SystemClock } from '../branch-schedule/clock.js';
import { BranchesModule } from '../branches/branches.module.js';
import { CategoriesModule } from '../categories/categories.module.js';
import type { Env } from '../config/env.js';
import { ProductsModule } from '../products/products.module.js';
import { PromotionsModule } from '../promotions/promotions.module.js';
import { STORE_DB_GATE, StoreDbGate } from './concurrency.js';
import { StoreBootstrapService } from './store-bootstrap.service.js';
import { StoreCatalogRepository } from './store-catalog.repository.js';
import { StoreCatalogService } from './store-catalog.service.js';
import { StoreProductController } from './store-product.controller.js';
import { StoreProductService } from './store-product.service.js';
import { StoreController } from './store.controller.js';

/**
 * F17: agregados públicos de la tienda (bootstrap, menú, búsqueda, ficha). Capa de COMPOSICIÓN: solo importa los lectores
 * exportados de los demás módulos y NINGÚN módulo la importa (sin ciclos). No importa `MediaModule`: las imágenes de
 * producto se guardan como URL completa (F11/F14) y las de banners ya las resuelve `PublicBannersReader`. Solo `app.module`
 * la compone. La única SQL propia es `StoreCatalogRepository` (tarjetas), porque exige UNA consulta compuesta.
 */
@Module({
  imports: [
    CategoriesModule,
    ProductsModule,
    BranchProductsModule,
    PromotionsModule,
    BannersReadModule,
    BranchScheduleModule,
    BranchesModule,
  ],
  controllers: [StoreController, StoreProductController],
  providers: [
    StoreCatalogRepository,
    StoreCatalogService,
    StoreBootstrapService,
    StoreProductService,
    { provide: CLOCK, useClass: SystemClock },
    {
      // Singleton del módulo: cupo propio < DB_POOL_MAX (queda una conexión para el resto), cola de 8 y espera de 1,5 s.
      provide: STORE_DB_GATE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): StoreDbGate =>
        new StoreDbGate(Math.max(1, config.get('DB_POOL_MAX', { infer: true }) - 1), 8, 1_500),
    },
  ],
})
export class StoreModule {}
