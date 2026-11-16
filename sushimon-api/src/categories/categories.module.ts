import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AdminCategoriesController } from './admin-categories.controller.js';
import { AdminCategoriesService } from './admin-categories.service.js';
import { CategoriesQueryService } from './categories-query.service.js';
import { CategoriesRepository } from './categories.repository.js';
import { PublicCategoriesController } from './public-categories.controller.js';

/** F10. `CategoriesQueryService` se exporta para F11 (productos) y F17 (agregado de tienda). */
@Module({
  imports: [AuditModule],
  controllers: [PublicCategoriesController, AdminCategoriesController],
  providers: [CategoriesRepository, CategoriesQueryService, AdminCategoriesService],
  exports: [CategoriesQueryService],
})
export class CategoriesModule {}
