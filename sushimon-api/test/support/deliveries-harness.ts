import { AuthorizationService } from '../../src/auth/authorization.service.js';
import type { Clock } from '../../src/branch-schedule/clock.js';
import { DbGate } from '../../src/common/concurrency/db-gate.js';
import { DeliveriesCommandsService } from '../../src/deliveries/deliveries-commands.service.js';
import { DeliveriesQueriesService } from '../../src/deliveries/deliveries-queries.service.js';
import { deliveriesBusy } from '../../src/deliveries/delivery-errors.js';
import type { IdentityService } from '../../src/identity/identity.service.js';
import { OrderTransitionsService } from '../../src/orders/admin/order-transitions.service.js';
import { RiderEligibilityService } from '../../src/riders/rider-eligibility.service.js';
import { FakeDeliveriesRepo } from './fake-deliveries-repo.js';
import { FakeRidersRepo } from './fake-riders-repo.js';

export const NOW = new Date('2026-11-18T19:30:00.000Z');

/** Servicios REALES de entregas (F28) sobre repositorios en memoria y el puerto de ocupación derivado de las entregas. */
export function deliveriesHarness(opts: { gate?: DbGate } = {}) {
  const riders = new FakeRidersRepo();
  const repo = new FakeDeliveriesRepo(riders);
  const port = repo.port();
  const authorization = new AuthorizationService({} as IdentityService);
  const clock: Clock = { now: () => new Date(NOW.getTime()) };
  const gate = opts.gate ?? new DbGate(10, 40, 5_000, deliveriesBusy);
  const eligibility = new RiderEligibilityService(riders.asRepository(), port);
  const commands = new DeliveriesCommandsService(
    repo.asRepository(),
    authorization,
    new OrderTransitionsService(),
    repo.ordersRepository(),
    eligibility,
    gate,
  );
  const queries = new DeliveriesQueriesService(repo.asRepository(), authorization, clock, gate);
  const branchA = repo.addBranch('Centro');
  const branchB = repo.addBranch('Zona 10');
  riders.branches.set(branchA, { name: 'Centro', active: true });
  riders.branches.set(branchB, { name: 'Zona 10', active: true });
  riders.ownDelivery.set(branchA, true);
  riders.ownDelivery.set(branchB, true);
  return { riders, repo, port, commands, queries, authorization, branchA, branchB, gate };
}
