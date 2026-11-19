import { Module, RequestMethod, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module.js';
import { CLOCK, SystemClock } from '../branch-schedule/clock.js';
import { checkoutBodyLimitMiddleware } from '../checkout/checkout-body-limit.middleware.js';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { DbGate, splitGateBudget } from '../common/concurrency/db-gate.js';
import type { Env } from '../config/env.js';
import { AdminOrdersCommandsService } from './admin/admin-orders-commands.service.js';
import { AdminOrdersQueryService } from './admin/admin-orders-query.service.js';
import { AdminOrdersController } from './admin/admin-orders.controller.js';
import { AdminOrdersRepository } from './admin/admin-orders.repository.js';
import { OrderTransitionsService } from './admin/order-transitions.service.js';
import { NoDeliveryFulfillment, ORDER_FULFILLMENT_PORT } from './ports/order-fulfillment.port.js';
import {
  ORDER_PAYMENT_READ_PORT,
  ProvisionalPaymentRule,
} from './ports/order-payment-read.port.js';
import { OrderQuoteGuard } from './order-quote-guard.js';
import { OrderSnapshotReader } from './order-snapshot.reader.js';
import { NoopOrderEventsPublisher, ORDER_EVENTS_PUBLISHER } from './order-events.publisher.js';
import { ORDERS_DB_GATE, ordersBusy } from './orders-errors.js';
import { OrdersController } from './orders.controller.js';
import { OrdersRepository } from './orders.repository.js';
import { OrdersService } from './orders.service.js';

/**
 * RIESGO ACEPTADO (F22, spec 023 §13 R11): el backoffice (lecturas y comandos de `/v1/admin/orders`), la creación de pedidos
 * (F20) y el seguimiento (F21) comparten UN solo `ORDERS_DB_GATE` (no hay gate propio del backoffice). Producción requiere
 * `DB_POOL_MAX >= 9` (ver `splitGateBudget`); con el defecto el cupo de pedidos es 1. El guard de personal lee los `grants`
 * (1 sentencia por solicitud) FUERA del gate.
 *
 * F20: creación y lectura de pedidos; F22: gestión de pedidos del backoffice (`/v1/admin/orders`). Importa `CheckoutModule` (cotizador y verificador del token); NUNCA al revés (sin
 * ciclos). `IdentityService` y `PrismaService` vienen de módulos globales. Sin pagos, entregas ni notificaciones reales.
 */
@Module({
  imports: [CheckoutModule, AuditModule],
  controllers: [OrdersController, AdminOrdersController],
  exports: [OrderTransitionsService, AdminOrdersRepository],
  providers: [
    OrdersService,
    OrdersRepository,
    OrderSnapshotReader,
    OrderQuoteGuard,
    // F22: gestión de pedidos del backoffice. Un solo servicio de transiciones (F28 lo reutiliza con su transacción).
    AdminOrdersRepository,
    AdminOrdersQueryService,
    AdminOrdersCommandsService,
    OrderTransitionsService,
    { provide: ORDER_FULFILLMENT_PORT, useClass: NoDeliveryFulfillment },
    { provide: ORDER_PAYMENT_READ_PORT, useClass: ProvisionalPaymentRule },
    { provide: CLOCK, useClass: SystemClock },
    { provide: ORDER_EVENTS_PUBLISHER, useClass: NoopOrderEventsPublisher },
    {
      // Singleton: cupo por CONEXIONES reales (ver `splitGateBudget`), cola de 8 y espera de 1,5 s => 503 `ORDERS_BUSY`.
      provide: ORDERS_DB_GATE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): DbGate =>
        new DbGate(
          splitGateBudget(config.get('DB_POOL_MAX', { infer: true })).orders,
          8,
          1_500,
          ordersBusy,
        ),
    },
  ],
})
export class OrdersModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Mismos topes del cuerpo que la cotización (64 KB, líneas y selecciones) ANTES de los pipes (spec 021 §3.3).
    consumer
      .apply(checkoutBodyLimitMiddleware)
      .forRoutes({ path: 'orders', method: RequestMethod.POST });
  }
}
