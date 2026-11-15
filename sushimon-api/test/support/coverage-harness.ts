import { Logger } from '@nestjs/common';
import { AuditService } from '../../src/audit/audit.service.js';
import { AuthorizationService } from '../../src/auth/authorization.service.js';
import type { BranchesQueryService } from '../../src/branches/branches-query.service.js';
import type { CourierCoveragePort } from '../../src/delivery-coverage/courier-coverage.port.js';
import type { DeliveryCoverageRepository } from '../../src/delivery-coverage/delivery-coverage.repository.js';
import { DeliveryCoverageService } from '../../src/delivery-coverage/delivery-coverage.service.js';
import { DeliverySettingsService } from '../../src/delivery-coverage/delivery-settings.service.js';
import { DeliveryZonesService } from '../../src/delivery-coverage/delivery-zones.service.js';
import { OwnDeliveryCoverageService } from '../../src/delivery-coverage/own-delivery-coverage.service.js';
import { UnavailableIntegrationAdapter } from '../../src/delivery-coverage/unavailable-integration.adapter.js';
import type { IdentityService } from '../../src/identity/identity.service.js';
import { FakeCoverageRepo } from './fake-coverage-repo.js';

export const A = '11111111-1111-4111-8111-111111111111';
export const B = '22222222-2222-4222-8222-222222222222';
export const INACTIVE = '33333333-3333-4333-8333-333333333333';
export const MISSING = '44444444-4444-4444-8444-444444444444';

/** Servicios reales de F09 sobre el repositorio en memoria y un `BranchesQueryService` mínimo. */
export function coverageHarness(
  courier: CourierCoveragePort = new UnavailableIntegrationAdapter(),
  timeoutMs = 3000,
) {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const repo = new FakeCoverageRepo().addBranch(A).addBranch(B).addBranch(INACTIVE, false);
  const branches = {
    getStatus: (id: string) => Promise.resolve(repo.branches.get(id) ?? null),
  } as unknown as BranchesQueryService;
  const authorization = new AuthorizationService({} as IdentityService);
  const audit = new AuditService();
  const asRepo = repo as unknown as DeliveryCoverageRepository;
  const own = new OwnDeliveryCoverageService(asRepo);
  return {
    repo,
    own,
    zones: new DeliveryZonesService(asRepo, branches, authorization, audit),
    settings: new DeliverySettingsService(asRepo, branches, authorization, audit, courier),
    coverage: new DeliveryCoverageService(asRepo, own, courier, timeoutMs),
  };
}
