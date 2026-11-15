import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module.js';
import { BranchesModule } from '../branches/branches.module.js';
import { isMockAllowedNodeEnv, type Env } from '../config/env.js';
import {
  AdminDeliverySettingsController,
  AdminDeliveryZonesController,
} from './admin-delivery-zones.controller.js';
import { COVERAGE_TIMEOUT_MS } from './coverage-config.js';
import { COURIER_COVERAGE_PORT, type CourierCoveragePort } from './courier-coverage.port.js';
import { DeliveryCoverageRepository } from './delivery-coverage.repository.js';
import { DELIVERY_COVERAGE_PORT, DeliveryCoverageService } from './delivery-coverage.service.js';
import { DeliverySettingsService } from './delivery-settings.service.js';
import { DeliveryZonesService } from './delivery-zones.service.js';
import { MockPedidosYaCoverageAdapter } from './mock-pedidosya-coverage.adapter.js';
import { OwnDeliveryCoverageService } from './own-delivery-coverage.service.js';
import { PublicDeliveryCoverageController } from './public-delivery-coverage.controller.js';
import { UnavailableIntegrationAdapter } from './unavailable-integration.adapter.js';

/** Selección del adaptador SOLO por configuración validada. El mock jamás se instancia en producción. */
export function selectCourierAdapter(config: ConfigService<Env, true>): CourierCoveragePort {
  const kind = config.get('PEDIDOSYA_COVERAGE_ADAPTER', { infer: true });
  if (kind !== 'mock') return new UnavailableIntegrationAdapter();
  // Defensa en profundidad: `validateEnv` ya impide arrancar así (solo NODE_ENV explícito development|test).
  if (!isMockAllowedNodeEnv(process.env['NODE_ENV'])) {
    throw new Error(
      'El adaptador simulado de PedidosYa solo se permite con NODE_ENV=development o test',
    );
  }
  new Logger('DeliveryCoverageModule').warn(
    'Cobertura de PedidosYa SIMULADA (adaptador mock): los resultados no son reales ni autorizan operaciones',
  );
  return new MockPedidosYaCoverageAdapter(
    config.get('PEDIDOSYA_MOCK_SCENARIO', { infer: true }) ?? 'unknown',
  );
}

/**
 * F09: zonas propias, settings logísticos, cobertura por proveedor. Exporta `DELIVERY_COVERAGE_PORT`
 * (`DeliveryCoverageService`) y `OwnDeliveryCoverageService` para F19/F20. No depende de `branch-schedule`.
 */
@Module({
  imports: [AuditModule, BranchesModule],
  controllers: [
    AdminDeliveryZonesController,
    AdminDeliverySettingsController,
    PublicDeliveryCoverageController,
  ],
  providers: [
    DeliveryCoverageRepository,
    DeliveryZonesService,
    DeliverySettingsService,
    OwnDeliveryCoverageService,
    DeliveryCoverageService,
    { provide: DELIVERY_COVERAGE_PORT, useExisting: DeliveryCoverageService },
    {
      provide: COURIER_COVERAGE_PORT,
      inject: [ConfigService],
      useFactory: selectCourierAdapter,
    },
    {
      provide: COVERAGE_TIMEOUT_MS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): number =>
        config.get('PEDIDOSYA_COVERAGE_TIMEOUT_MS', { infer: true }),
    },
  ],
  exports: [DELIVERY_COVERAGE_PORT, DeliveryCoverageService, OwnDeliveryCoverageService],
})
export class DeliveryCoverageModule {}
