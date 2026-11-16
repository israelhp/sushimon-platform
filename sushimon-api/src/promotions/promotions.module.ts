import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module.js';
import { BranchProductsModule } from '../branch-products/branch-products.module.js';
import { BUSINESS_TIMEZONE, CLOCK, SystemClock } from '../branch-schedule/clock.js';
import { CategoriesModule } from '../categories/categories.module.js';
import type { Env } from '../config/env.js';
import { AdminPromotionsController } from './admin-promotions.controller.js';
import { AdminPromotionsService } from './admin-promotions.service.js';
import { PromotionCandidatesService } from './promotion-candidates.service.js';
import { PromotionEvaluator } from './promotion-evaluator.js';
import { PromotionTimeService } from './promotion-time.service.js';
import { PromotionsRepository } from './promotions.repository.js';
import { PublicPromotionsController } from './public-promotions.controller.js';
import { PublicPromotionsService } from './public-promotions.service.js';

/**
 * F15. Exporta `PromotionEvaluator` (puro) y `PromotionCandidatesService` para F19 (cotización); F15 no calcula
 * totales ni crea pedidos. No modifica `ProductsModule`, `ModifiersModule` ni `BranchProductsModule`.
 */
@Module({
  imports: [AuditModule, BranchProductsModule, CategoriesModule],
  controllers: [PublicPromotionsController, AdminPromotionsController],
  providers: [
    PromotionsRepository,
    PromotionTimeService,
    AdminPromotionsService,
    PublicPromotionsService,
    PromotionCandidatesService,
    PromotionEvaluator,
    { provide: CLOCK, useClass: SystemClock },
    {
      provide: BUSINESS_TIMEZONE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): string =>
        config.get('BUSINESS_TIMEZONE', { infer: true }),
    },
  ],
  exports: [PromotionEvaluator, PromotionCandidatesService],
})
export class PromotionsModule {}
