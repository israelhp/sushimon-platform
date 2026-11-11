import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.js';
import { HealthController } from './health/health.controller.js';

/**
 * Raíz del monolito modular. Los módulos de dominio (catalog, orders, delivery, payments, …)
 * se agregan aquí a medida que se implementan sus vertical slices.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })],
  controllers: [HealthController],
})
export class AppModule {}
