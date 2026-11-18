import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BranchProductsModule } from '../branch-products/branch-products.module.js';
import { BranchScheduleModule } from '../branch-schedule/branch-schedule.module.js';
import { CLOCK, SystemClock } from '../branch-schedule/clock.js';
import { DbGate, splitGateBudget } from '../common/concurrency/db-gate.js';
import type { Env } from '../config/env.js';
import { CustomersModule } from '../customers/customers.module.js';
import { DeliveryCoverageModule } from '../delivery-coverage/delivery-coverage.module.js';
import { LocationsModule } from '../locations/locations.module.js';
import { ModifiersModule } from '../modifiers/modifiers.module.js';
import { PromotionsModule } from '../promotions/promotions.module.js';
import { checkoutBodyLimitMiddleware } from './checkout-body-limit.middleware.js';
import { CHECKOUT_DB_GATE, CHECKOUT_QUOTE_SECRET_TOKEN, checkoutBusy } from './checkout-errors.js';
import { CheckoutQuoteService } from './checkout-quote.service.js';
import { CheckoutController } from './checkout.controller.js';

/**
 * F19: cotización de checkout. Capa de COMPOSICIÓN: importa solo los lectores exportados de `branch-products`, `modifiers`,
 * `promotions`, `branch-schedule`, `delivery-coverage`, `customers` y `locations`; NINGÚN módulo la importa todavía (F20
 * importará `CheckoutQuoteService`) y no importa `store` (sin ciclos). No escribe en la BD ni tiene migración.
 */
@Module({
  imports: [
    BranchProductsModule,
    ModifiersModule,
    PromotionsModule,
    BranchScheduleModule,
    DeliveryCoverageModule,
    CustomersModule,
    LocationsModule,
  ],
  controllers: [CheckoutController],
  providers: [
    CheckoutQuoteService,
    { provide: CLOCK, useClass: SystemClock },
    {
      // Singleton del módulo: cupo por CONEXIONES reales (ver `splitGateBudget`), cola de 8 y espera de 1,5 s =>
      // 503 `CHECKOUT_BUSY`. Cada cotización lanza ~6-7 consultas en paralelo, por eso el cupo es ~1/3 del pool.
      provide: CHECKOUT_DB_GATE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): DbGate =>
        new DbGate(
          splitGateBudget(config.get('DB_POOL_MAX', { infer: true })).checkout,
          8,
          1_500,
          checkoutBusy,
        ),
    },
    {
      provide: CHECKOUT_QUOTE_SECRET_TOKEN,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): string | undefined =>
        config.get('CHECKOUT_QUOTE_SECRET', { infer: true }),
    },
  ],
  exports: [CheckoutQuoteService],
})
export class CheckoutModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Topes del cuerpo (64 KB, líneas y selecciones). `private, no-store` lo fija `configureApp` ANTES del parser JSON.
    consumer.apply(checkoutBodyLimitMiddleware).forRoutes('checkout/*path');
  }
}
