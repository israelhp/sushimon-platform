import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppThrottlerGuard } from './common/throttle/app-throttler.guard.js';
import { requestIdMiddleware } from './common/request-id/request-id.middleware.js';
import { validateEnv, type Env } from './config/env.js';
import { AuthModule } from './auth/auth.module.js';
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
      ],
    }),
    DatabaseModule,
    AuthModule,
  ],
  controllers: [HealthController],
  providers: [HealthTokenGuard, { provide: APP_GUARD, useClass: AppThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestIdMiddleware).forRoutes('*path');
  }
}
