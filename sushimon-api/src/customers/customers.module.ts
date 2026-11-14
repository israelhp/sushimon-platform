import { Module } from '@nestjs/common';
import { CustomerProfileController } from './customer-profile.controller.js';
import { CustomerProfileService } from './customer-profile.service.js';

/**
 * Perfil comercial del cliente (F04). Usa IdentityService (global desde AuthModule) para la identidad y la
 * creación idempotente del perfil; no duplica el guard JWT ni el controlador de `GET /v1/me` (F01).
 */
@Module({
  controllers: [CustomerProfileController],
  providers: [CustomerProfileService],
  exports: [CustomerProfileService],
})
export class CustomersModule {}
