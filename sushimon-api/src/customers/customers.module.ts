import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { CustomerAddressesController } from './addresses/customer-addresses.controller.js';
import { CustomerAddressesService } from './addresses/customer-addresses.service.js';
import { CustomerProfileController } from './customer-profile.controller.js';
import { CustomerProfileService } from './customer-profile.service.js';

/**
 * Perfil comercial del cliente (F04) y sus direcciones guardadas (F05). Usa IdentityService (global desde
 * AuthModule) para la identidad y la creación idempotente del perfil; no duplica el guard JWT ni el controlador
 * de `GET /v1/me` (F01).
 */
@Module({
  imports: [AuditModule],
  controllers: [CustomerProfileController, CustomerAddressesController],
  providers: [CustomerProfileService, CustomerAddressesService],
  exports: [CustomerProfileService, CustomerAddressesService],
})
export class CustomersModule {}
