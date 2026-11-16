import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { CategoriesModule } from '../categories/categories.module.js';
import { AdminBranchProductsController } from './admin-branch-products.controller.js';
import { AdminBranchProductsService } from './admin-branch-products.service.js';
import { BranchMenuQueryService } from './branch-menu-query.service.js';
import { BranchOffersService } from './branch-offers.service.js';
import { BranchProductsRepository } from './branch-products.repository.js';
import { PublicBranchMenuController } from './public-branch-menu.controller.js';

/**
 * F13. `BranchOffersService` se exporta para F17 (agregados) y F19 (cotización). No importa `ProductsModule` ni
 * `ModifiersModule` (F11/F12 intactos): usa SQL propio y `CategoriesQueryService` (F10) para la visibilidad.
 */
@Module({
  imports: [AuditModule, CategoriesModule],
  controllers: [PublicBranchMenuController, AdminBranchProductsController],
  providers: [
    BranchProductsRepository,
    AdminBranchProductsService,
    BranchMenuQueryService,
    BranchOffersService,
  ],
  exports: [BranchOffersService],
})
export class BranchProductsModule {}
