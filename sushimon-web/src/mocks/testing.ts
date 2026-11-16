import type { StaffRole } from '@/lib/data-access/models';
import type { DemoSessionState } from '@/lib/demo-session';
import type { Grants } from '@/lib/permissions';
import { roleSeedByCode } from './fixtures/rbac';
import { createFixedClock, type FixedClock } from './clock';
import { DEMO_CUSTOMER } from './fixtures/orders';
import { DEMO_STAFF_BY_ROLE, demoStaffFromSeed } from './fixtures/staff';
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

/** Permisos de un rol con alcance GLOBAL (para probar funciones puras de la UI sin store). */
export function grantsForRole(role: StaffRole): Grants {
  return Object.fromEntries(
    roleSeedByCode(role).permissions.map((code) => [code, { allBranches: true, branchIds: [] }]),
  );
}

export function staffSession(role: StaffRole, userId?: string) {
  return demoStaffFromSeed(userId ?? DEMO_STAFF_BY_ROLE[role]);
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

/** F13: marca un producto como agotado en TODAS las sucursales activas (excepción por sucursal, como lo guardaría el servidor). */
export function markSoldOutEverywhere(store: MockStore, productId: string): void {
  for (const b of store.branches.filter((x) => x.status === 'active')) {
    store.branchProducts = store.branchProducts.filter(
      (r) => !(r.branchId === b.id && r.productId === productId),
    );
    store.branchProducts.push({
      branchId: b.id,
      productId,
      priceOverride: null,
      available: false,
      updatedAt: '2026-11-01T12:00:00.000Z',
    });
  }
}
