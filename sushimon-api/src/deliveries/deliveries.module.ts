import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module.js';
import { CLOCK, SystemClock } from '../branch-schedule/clock.js';
import { DbGate, splitGateBudget } from '../common/concurrency/db-gate.js';
import { privateNoStoreMiddleware } from '../common/http/cache-control.js';
import type { Env } from '../config/env.js';
import { OrdersModule } from '../orders/orders.module.js';
import { RidersModule } from '../riders/riders.module.js';
import { AdminDeliveriesController } from './admin-deliveries.controller.js';
import { DeliveriesCommandsService } from './deliveries-commands.service.js';
import { DeliveriesQueriesService } from './deliveries-queries.service.js';
import { DeliveriesRepository } from './deliveries.repository.js';
import { DELIVERIES_DB_GATE, deliveriesBusy } from './delivery-errors.js';

/**
 * F28: entregas propias (`/v1/admin/deliveries`, spec 029, ADR-0032). Importa `RidersModule` (elegibilidad y puerto de ocupación,
 * F27) y `OrdersModule` (`OrderTransitionsService` y `AdminOrdersRepository.transitionTx`, F22); NINGUNO de los dos importa este
 * módulo (sin ciclos: sus adaptadores reales leen `app.deliveries` por SQL con su propio `PrismaService`). `AuthorizationService`,
 * `StaffGuard` y `PrismaService` vienen de módulos globales. Sin PedidosYa, cobro del motorista, GPS ni notificaciones.
 */
@Module({
  imports: [AuditModule, RidersModule, OrdersModule],
  controllers: [AdminDeliveriesController],
  providers: [
    DeliveriesRepository,
    DeliveriesQueriesService,
    DeliveriesCommandsService,
    { provide: CLOCK, useClass: SystemClock },
    {
      // Cupo PROPIO (`splitGateBudget(...).deliveries`, ~1/8 del pool), cola de 8 y espera de 1,5 s => 503 `DELIVERIES_BUSY`.
      provide: DELIVERIES_DB_GATE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): DbGate =>
        new DbGate(
          splitGateBudget(config.get('DB_POOL_MAX', { infer: true })).deliveries,
          8,
          1_500,
          deliveriesBusy,
        ),
    },
  ],
})
export class DeliveriesModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // PII (nombre, teléfono y dirección del cliente en el detalle): `private, no-store` en TODA respuesta (también 400/401/403/404/
    // 429/503). `AppModule` excluye estas rutas del `no-store` genérico de `/v1/admin` para que este valor (más estricto) no se rebaje.
    consumer
      .apply(privateNoStoreMiddleware)
      .forRoutes('admin/deliveries', 'admin/deliveries/*path');
  }
}
