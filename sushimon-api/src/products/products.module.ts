import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { CategoriesModule } from '../categories/categories.module.js';
import { MediaModule } from '../media/media.module.js';
import { ModifiersModule } from '../modifiers/modifiers.module.js';
import { AdminProductMediaController } from './admin-product-media.controller.js';
import { AdminProductsController } from './admin-products.controller.js';
import { AdminProductsService } from './admin-products.service.js';
import { ProductMediaService } from './product-media.service.js';
import { ProductsQueryService } from './products-query.service.js';
import { ProductsRepository } from './products.repository.js';
import { PublicProductsController } from './public-products.controller.js';

/**
 * F11. `ProductsQueryService` se exporta para favoritos (F06: adaptador del puerto de catálogo), F13 y F17. No importa
 * favoritos (la dependencia es `favorites → products`).
 */
@Module({
  imports: [AuditModule, CategoriesModule, MediaModule, ModifiersModule],
  controllers: [PublicProductsController, AdminProductsController, AdminProductMediaController],
  providers: [ProductsRepository, ProductsQueryService, AdminProductsService, ProductMediaService],
  exports: [ProductsQueryService],
})
export class ProductsModule {}
