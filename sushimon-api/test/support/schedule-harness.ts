import { Logger } from '@nestjs/common';
import { AuditService } from '../../src/audit/audit.service.js';
import { AuthorizationService } from '../../src/auth/authorization.service.js';
import { BranchAvailabilityService } from '../../src/branch-schedule/branch-availability.service.js';
import { BranchClosuresService } from '../../src/branch-schedule/branch-closures.service.js';
import { BranchHoursService } from '../../src/branch-schedule/branch-hours.service.js';
import type { BranchScheduleRepository } from '../../src/branch-schedule/branch-schedule.repository.js';
import type { Clock } from '../../src/branch-schedule/clock.js';
import type { BranchesQueryService } from '../../src/branches/branches-query.service.js';
import type { IdentityService } from '../../src/identity/identity.service.js';
import { FakeScheduleRepo } from './fake-schedule-repo.js';

export const A = '11111111-1111-4111-8111-111111111111';
export const B = '22222222-2222-4222-8222-222222222222';
export const MISSING = '44444444-4444-4444-8444-444444444444';

/** Reloj fijo y movible: ninguna prueba depende de la hora real. */
export function fixedClock(iso: string): Clock & { set(iso: string): void } {
  let now = new Date(iso);
  return { now: () => new Date(now), set: (v: string) => void (now = new Date(v)) };
}

/** Servicios reales de F08 sobre el repositorio en memoria y un `BranchesQueryService` mínimo. */
export function scheduleHarness(now = '2026-11-16T18:00:00.000Z', timeZone = 'America/Guatemala') {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  const repo = new FakeScheduleRepo().addBranch(A).addBranch(B);
  const clock = fixedClock(now);
  const branches = {
    getStatus: (id: string) => Promise.resolve(repo.branches.get(id) ?? null),
  } as unknown as BranchesQueryService;
  const authorization = new AuthorizationService({} as IdentityService);
  const audit = new AuditService();
  const asRepo = repo as unknown as BranchScheduleRepository;
  return {
    repo,
    clock,
    availability: new BranchAvailabilityService(asRepo, clock, timeZone),
    hours: new BranchHoursService(asRepo, branches, authorization, audit, clock, timeZone),
    closures: new BranchClosuresService(asRepo, branches, authorization, audit, clock),
  };
}
