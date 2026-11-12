import type { StaffRole } from '@/lib/data-access/models';
import type { DemoSessionState } from '@/lib/demo-session';
import { createFixedClock, type FixedClock } from './clock';
import { DEMO_CUSTOMER } from './fixtures/orders';
import { DEMO_STAFF_BY_ROLE, STAFF_SEEDS } from './fixtures/staff';
import { createMockDataClient } from './index';
import type { MockScenario } from './scenarios';
import { createSeedStore } from './seed';
import type { MockStore } from './store';

/**
 * Utilidades para pruebas: cliente mock con store, reloj fijo y sesión controlables.
 * (No es un archivo de prueba; lo importan los `*.test.ts`.)
 */
export interface TestHarness {
  client: ReturnType<typeof createMockDataClient>;
  store: MockStore;
  clock: FixedClock;
  session: DemoSessionState;
  asStaff: (role: StaffRole | null, userId?: string) => void;
  asCustomer: (email?: string | null) => void;
}

export function staffSession(role: StaffRole, userId?: string) {
  const user = STAFF_SEEDS.find((u) => u.id === (userId ?? DEMO_STAFF_BY_ROLE[role]));
  if (!user) throw new Error('usuario de prueba');
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    branchId: user.branchId,
  };
}

export function createHarness(
  scenario: MockScenario = 'default',
  initial: Partial<DemoSessionState> = {},
): TestHarness {
  const store = createSeedStore(scenario);
  const clock = createFixedClock();
  const session: DemoSessionState = { customer: null, staff: null, ...initial };
  const client = createMockDataClient({
    scenario,
    store,
    clock,
    session: () => session,
    latencyMs: 0,
    persist: false,
  });
  return {
    client,
    store,
    clock,
    session,
    asStaff: (role, userId) => {
      session.staff = role ? staffSession(role, userId) : null;
    },
    asCustomer: (email = DEMO_CUSTOMER.email) => {
      session.customer = email ? { email, name: 'Prueba', provider: 'google-demo' } : null;
    },
  };
}
