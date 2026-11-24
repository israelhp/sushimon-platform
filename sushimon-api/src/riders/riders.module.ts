import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module.js';
import { DbGate, splitGateBudget } from '../common/concurrency/db-gate.js';
import { privateNoStoreMiddleware } from '../common/http/cache-control.js';
import type { Env } from '../config/env.js';
import { AdminRidersController } from './admin-riders.controller.js';
import { RiderActiveDeliveriesAdapter } from './ports/rider-active-deliveries.adapter.js';
import { RIDER_ACTIVE_DELIVERIES_PORT } from './ports/rider-active-deliveries.port.js';
import { RiderEligibilityService } from './rider-eligibility.service.js';
import { RidersCommandsService } from './riders-commands.service.js';
import { RIDERS_DB_GATE, ridersBusy } from './riders-errors.js';
import { RidersQueriesService } from './riders-queries.service.js';
import { RidersRepository } from './riders.repository.js';

/**
 * F27: motoristas propios (`/v1/admin/riders`), `RiderEligibilityService` (exportado para F28) y el puerto
 * `RiderActiveDeliveriesPort`, enlazado desde F28 al adaptador REAL que lee `app.deliveries` (`known = true`).
 * `AuthorizationService`/`StaffGuard` vienen de módulos globales. No escribe entregas, pagos ni PedidosYa (solo las LEE a través del puerto).
 */
@Module({
  imports: [AuditModule],
  controllers: [AdminRidersController],
  providers: [
    RidersRepository,
    RidersQueriesService,
    RidersCommandsService,
    RiderEligibilityService,
    // F28: adaptador REAL (`known = true`, lee `app.deliveries`). `NoActiveDeliveriesAdapter` queda solo para dobles de pruebas.
    { provide: RIDER_ACTIVE_DELIVERIES_PORT, useClass: RiderActiveDeliveriesAdapter },
    {
      // Cupo PROPIO (`splitGateBudget(...).riders`, ~1/8 del pool; antes reutilizaba el de pedidos), cola de 8 y espera de 1,5 s =>
      // 503 `RIDERS_BUSY`.
      provide: RIDERS_DB_GATE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): DbGate =>
        new DbGate(
          splitGateBudget(config.get('DB_POOL_MAX', { infer: true })).riders,
          8,
          1_500,
          ridersBusy,
        ),
    },
  ],
  exports: [RiderEligibilityService, RIDER_ACTIVE_DELIVERIES_PORT],
})
export class RidersModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // PII (nombre, teléfono, placa): `private, no-store` en TODA respuesta (también 400/401/403/404/429/503). `AppModule` excluye
    // estas rutas del `no-store` genérico de `/v1/admin` para que este valor (más estricto) no se rebaje.
    consumer.apply(privateNoStoreMiddleware).forRoutes('admin/riders', 'admin/riders/*path');
  }
}
