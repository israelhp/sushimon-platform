import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { CategoriesModule } from '../categories/categories.module.js';
import { AdminBranchProductsController } from './admin-branch-products.controller.js';
import { AdminBranchProductsService } from './admin-branch-products.service.js';
import { BranchOffersService } from './branch-offers.service.js';
import { BranchProductsRepository } from './branch-products.repository.js';

/**
 * F13. `BranchOffersService` se exporta para F17 (agregados) y F19 (cotización). El menú público (`GET /v1/store/menu`)
 * pasó en F17 a `StoreModule` (una consulta compuesta con precio y disponibilidad de ESTA sucursal). No importa `ProductsModule` ni
 * `ModifiersModule` (F11/F12 intactos): usa SQL propio y `CategoriesQueryService` (F10) para la visibilidad.
 */
@Module({
  imports: [AuditModule, CategoriesModule],
  controllers: [AdminBranchProductsController],
  providers: [BranchProductsRepository, AdminBranchProductsService, BranchOffersService],
  exports: [BranchOffersService],
})
export class BranchProductsModule {}
