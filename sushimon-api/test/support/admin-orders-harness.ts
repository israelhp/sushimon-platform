import { AuthorizationService } from '../../src/auth/authorization.service.js';
import { DbGate } from '../../src/common/concurrency/db-gate.js';
import type { IdentityService } from '../../src/identity/identity.service.js';
import { AdminOrdersCommandsService } from '../../src/orders/admin/admin-orders-commands.service.js';
import { AdminOrdersQueryService } from '../../src/orders/admin/admin-orders-query.service.js';
import { OrderTransitionsService } from '../../src/orders/admin/order-transitions.service.js';
import { ordersBusy } from '../../src/orders/orders-errors.js';
import type { OrderFulfillmentPort } from '../../src/orders/ports/order-fulfillment.port.js';
import { CashPaymentsService } from '../../src/orders/payments/cash-payments.service.js';
import { PaymentsReadAdapter } from '../../src/orders/payments/payments-read.adapter.js';
import type { Clock } from '../../src/branch-schedule/clock.js';
import { FakeAdminOrdersRepo } from './fake-admin-orders-repo.js';
import { FakePaymentsRepo } from './fake-payments-repo.js';
import { BRANCH_A, BRANCH_B } from './staff-fixtures.js';

export { BRANCH_A, BRANCH_B };
export const NOW = new Date('2026-11-18T18:30:00.000Z');

export class FakeFulfillment implements OrderFulfillmentPort {
  calls: unknown[] = [];
  result: { activeDelivery: boolean; pendingActions: 'delivery_cancellation'[] } = {
    activeDelivery: false,
    pendingActions: [],
  };
  fail = false;
  inspect(order: unknown) {
    this.calls.push(order);
    if (this.fail) return Promise.reject(new Error('puerto caído'));
    return Promise.resolve(this.result);
  }
}

/** Servicios REALES de F22 sobre el repositorio en memoria y puertos de doble. */
export function adminOrdersHarness(opts: { gate?: DbGate } = {}) {
  const repo = new FakeAdminOrdersRepo();
  const authorization = new AuthorizationService({} as IdentityService);
  const clock: Clock = { now: () => new Date(NOW.getTime()) };
  const gate = opts.gate ?? new DbGate(10, 40, 5_000, ordersBusy);
  const transitions = new OrderTransitionsService();
  const fulfillment = new FakeFulfillment();
  // F24: lectura REAL del pago (puerto de F22) y servicio de registro sobre el MISMO estado en memoria.
  const paymentsRepo = new FakePaymentsRepo(repo);
  const payments = new PaymentsReadAdapter(paymentsRepo.asRepository());
  const cashPayments = new CashPaymentsService(
    paymentsRepo.asRepository(),
    authorization,
    clock,
    gate,
  );
  const commands = new AdminOrdersCommandsService(
    repo.asRepository(),
    transitions,
    authorization,
    gate,
    fulfillment,
    payments,
  );
  const queries = new AdminOrdersQueryService(repo.asRepository(), authorization, clock, gate);
  return {
    repo,
    paymentsRepo,
    cashPayments,
    authorization,
    clock,
    gate,
    transitions,
    fulfillment,
    payments,
    commands,
    queries,
  };
}
