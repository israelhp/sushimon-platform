import { Module, RequestMethod, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module.js';
import { BranchProductsModule } from '../branch-products/branch-products.module.js';
import { BranchScheduleModule } from '../branch-schedule/branch-schedule.module.js';
import { CLOCK, SystemClock } from '../branch-schedule/clock.js';
import { checkoutBodyLimitMiddleware } from '../checkout/checkout-body-limit.middleware.js';
import { CheckoutModule } from '../checkout/checkout.module.js';
import { DbGate, splitGateBudget } from '../common/concurrency/db-gate.js';
import type { Env } from '../config/env.js';
import { privateNoStoreMiddleware } from '../common/http/cache-control.js';
import { ModifiersModule } from '../modifiers/modifiers.module.js';
import { ProductsModule } from '../products/products.module.js';
import { AdminOrdersCommandsService } from './admin/admin-orders-commands.service.js';
import { AdminOrdersQueryService } from './admin/admin-orders-query.service.js';
import { AdminOrdersController } from './admin/admin-orders.controller.js';
import { AdminOrdersRepository } from './admin/admin-orders.repository.js';
import { OrderTransitionsService } from './admin/order-transitions.service.js';
import { MyOrdersController } from './history/my-orders.controller.js';
import { MyOrdersRepository } from './history/my-orders.repository.js';
import { MyOrdersService } from './history/my-orders.service.js';
import { OrderDocumentsController } from './order-documents.controller.js';
import { OrderDocumentsService } from './order-documents.service.js';
import { reorderBodyLimitMiddleware } from './reorder/reorder-body-limit.middleware.js';
import { OrderSourceRepository } from './order-source.repository.js';
import { DeliveriesFulfillmentAdapter } from './ports/deliveries-fulfillment.adapter.js';
import { ORDER_FULFILLMENT_PORT } from './ports/order-fulfillment.port.js';
import { ORDER_PAYMENT_READ_PORT } from './ports/order-payment-read.port.js';
import { AdminPaymentsController } from './payments/admin-payments.controller.js';
import { CashPaymentsService } from './payments/cash-payments.service.js';
import { PaymentsReadAdapter } from './payments/payments-read.adapter.js';
import { PaymentsRepository } from './payments/payments.repository.js';
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
 * ciclos). `IdentityService` y `PrismaService` vienen de módulos globales. F24 añade los pagos en efectivo (sin tarjetas, transferencias ni reembolsos). Sin entregas ni notificaciones reales.
 */
@Module({
  imports: [
    CheckoutModule,
    AuditModule,
    // F23 (solo lectura): lectores de catálogo para la vista previa de «Volver a pedir».
    BranchProductsModule,
    BranchScheduleModule,
    ModifiersModule,
    ProductsModule,
  ],
  controllers: [
    OrdersController,
    AdminOrdersController,
    // F24: pagos en efectivo del backoffice (`/v1/admin/orders/{id}/payment…`).
    AdminPaymentsController,
    // F23: historial del cliente (`/v1/me/orders`), recibo y vista previa (`/v1/orders/{id}/…`).
    MyOrdersController,
    OrderDocumentsController,
  ],
  exports: [OrderTransitionsService, AdminOrdersRepository, CashPaymentsService],
  providers: [
    OrdersService,
    OrdersRepository,
    OrderSnapshotReader,
    OrderQuoteGuard,
    // F23: historial, recibo y «Volver a pedir» (solo lectura sobre el MISMO `ORDERS_DB_GATE`).
    MyOrdersService,
    MyOrdersRepository,
    OrderDocumentsService,
    OrderSourceRepository,
    // F22: gestión de pedidos del backoffice. Un solo servicio de transiciones (F28 lo reutiliza con su transacción).
    AdminOrdersRepository,
    AdminOrdersQueryService,
    AdminOrdersCommandsService,
    OrderTransitionsService,
    // F28: adaptador REAL (lee `app.deliveries`; `NoDeliveryFulfillment` queda solo para dobles de pruebas).
    { provide: ORDER_FULFILLMENT_PORT, useClass: DeliveriesFulfillmentAdapter },
    // F24: pagos en efectivo (registro, lecturas y lectura REAL de `payment_review` para F22). Un solo servicio de registro:
    // F28 (cobro del motorista) lo reutilizará con SU transacción.
    PaymentsRepository,
    CashPaymentsService,
    { provide: ORDER_PAYMENT_READ_PORT, useClass: PaymentsReadAdapter },
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
    // F23: tope propio (2 KB) del cuerpo de la vista previa, antes de guards y BD.
    consumer
      .apply(reorderBodyLimitMiddleware)
      .forRoutes({ path: 'orders/:id/reorder-preview', method: RequestMethod.POST });
    // F24: el pago es dinero: `private, no-store` en TODA respuesta (también 401/403/404/429/503). `AppModule` excluye estas rutas
    // del `no-store` genérico de `/v1/admin` para que este valor (más estricto) no se rebaje.
    consumer
      .apply(privateNoStoreMiddleware)
      .forRoutes('admin/orders/:id/payment', 'admin/orders/:id/payment/*path');
  }
}
