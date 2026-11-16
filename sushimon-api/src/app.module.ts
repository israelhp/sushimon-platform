import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import {
  ACTOR_THROTTLER,
  actorTracker,
  AppThrottlerGuard,
  skipUnlessActorLimited,
} from './common/throttle/app-throttler.guard.js';
import { noStoreMiddleware } from './common/http/cache-control.js';
import { rejectProtoKeysMiddleware } from './common/http/reject-proto-keys.middleware.js';
import { requestIdMiddleware } from './common/request-id/request-id.middleware.js';
import { validateEnv, type Env } from './config/env.js';
import { AuthModule } from './auth/auth.module.js';
import { BranchScheduleModule } from './branch-schedule/branch-schedule.module.js';
import { DeliveryCoverageModule } from './delivery-coverage/delivery-coverage.module.js';
import { LocationsModule } from './locations/locations.module.js';
import { CategoriesModule } from './categories/categories.module.js';
import { ProductsModule } from './products/products.module.js';
import { ModifiersModule } from './modifiers/modifiers.module.js';
import { BranchProductsModule } from './branch-products/branch-products.module.js';
import { BranchesModule } from './branches/branches.module.js';
import { StaffModule } from './staff/staff.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { FavoritesModule } from './favorites/favorites.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { HealthTokenGuard } from './health/health-token.guard.js';

/**
 * Raíz del monolito modular. Los módulos de dominio (catalog, orders, delivery, payments, …)
 * se agregan aquí a medida que se implementan sus vertical slices.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Rate limit en memoria por instancia: suficiente como freno básico. En serverless cada instancia
    // tiene su contador; si hace falta un límite global exacto se añade un storage compartido (ADR futuro).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => [
        {
          ttl: config.get('RATE_LIMIT_TTL_MS', { infer: true }),
          limit: config.get('RATE_LIMIT_MAX', { infer: true }),
        },
        // Límite POR ACTOR autenticado (solo rutas que lo declaran con `@Throttle({ actor: … })`; ver `ACTOR_THROTTLER`).
        {
          name: ACTOR_THROTTLER,
          ttl: config.get('RATE_LIMIT_TTL_MS', { infer: true }),
          limit: config.get('RATE_LIMIT_MAX', { infer: true }),
          getTracker: actorTracker,
          skipIf: skipUnlessActorLimited,
        },
      ],
    }),
    DatabaseModule,
    AuthModule,
    BranchesModule,
    CategoriesModule,
    ProductsModule,
    ModifiersModule,
    BranchProductsModule,
    BranchScheduleModule,
    LocationsModule,
    DeliveryCoverageModule,
    StaffModule,
    CustomersModule,
    FavoritesModule,
  ],
  controllers: [HealthController],
  providers: [HealthTokenGuard, { provide: APP_GUARD, useClass: AppThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestIdMiddleware, rejectProtoKeysMiddleware).forRoutes('*path');
    // Todo el backoffice: nunca se almacena en caché (incluidos 401/403).
    consumer.apply(noStoreMiddleware).forRoutes('admin/*path');
    // Perfil propio del cliente (F01 + F04): datos personales, nunca en caché compartida.
    consumer.apply(noStoreMiddleware).forRoutes('me', 'me/*path');
    // Contexto de identidad/autorización (roles, permisos, sucursales): nunca en caché (incluidos 401).
    consumer.apply(noStoreMiddleware).forRoutes('auth/context');
  }
}
