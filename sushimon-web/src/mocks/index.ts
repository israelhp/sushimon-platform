import { createMockClient } from '@/lib/data-access/mock-client';
import type { DataClient } from '@/lib/data-access/types';
import { EMPTY_DEMO_SESSION, readDemoSession, type DemoSessionState } from '@/lib/demo-session';
import { createBrowserClock, type Clock } from './clock';
import { mockRoutes } from './handlers';
import type { MockScenario } from './scenarios';
import { createSeedStore } from './seed';
import { loadPersistedStore, persistStore, type MockContext, type MockStore } from './store';

export { mockRoutes } from './handlers';
export { createSeedStore } from './seed';
export { createFixedClock, createBrowserClock, DEMO_BASE_TIME } from './clock';
export type { MockStore, MockContext } from './store';
export { clearPersistedStore } from './store';
export { DEMO_GOOGLE_ACCOUNTS, TEST_CARDS, DEMO_CUSTOMER } from './fixtures/orders';
export { DEMO_STAFF_BY_ROLE, REJECTION_REASONS } from './fixtures/staff';

export interface MockDataClientOptions {
  scenario: MockScenario;
  /** Latencia simulada (ms). Por defecto 150 en el navegador y 0 fuera de él (pruebas/SSR). */
  latencyMs?: number;
  /** Store a usar (pruebas). Por defecto: el de la pestaña (sessionStorage) o uno sembrado. */
  store?: MockStore;
  /** Reloj (pruebas: createFixedClock()). Por defecto: reloj del navegador desde la fecha base. */
  clock?: Clock;
  /** Sesión de demostración (pruebas). Por defecto: la de sessionStorage en cada solicitud. */
  session?: () => DemoSessionState;
  /** Persistir en sessionStorage tras cada escritura. Por defecto: true en el navegador. */
  persist?: boolean;
}

const isBrowser = () => typeof window !== 'undefined';

/** Una instancia por pestaña y escenario: tienda y backoffice comparten el mismo store. */
const tabStores = new Map<MockScenario, MockStore>();

function tabStore(scenario: MockScenario): MockStore {
  let store = tabStores.get(scenario);
  if (!store) {
    store = loadPersistedStore(scenario) ?? createSeedStore(scenario);
    tabStores.set(scenario, store);
  }
  return store;
}

/**
 * Adaptador mock listo para usar (sin red). En el navegador comparte un store por pestaña
 * persistido en sessionStorage, para que un pedido creado en la tienda aparezca en el backoffice.
 */
export function createMockDataClient(options: MockDataClientOptions): DataClient {
  const { scenario } = options;
  const browser = isBrowser();
  const store = options.store ?? (browser ? tabStore(scenario) : createSeedStore(scenario));
  const clock = options.clock ?? createBrowserClock();
  const session = options.session ?? (browser ? readDemoSession : () => EMPTY_DEMO_SESSION);
  const persist = options.persist ?? browser;
  return createMockClient<MockStore, MockContext>({
    routes: mockRoutes,
    store,
    scenario,
    latencyMs: options.latencyMs ?? (browser ? 150 : 0),
    onWrite: persist ? persistStore : undefined,
    context: () => ({ session: session(), clock }),
  });
}

/** Reinicia la demo de la pestaña (vuelve a sembrar el store del escenario). */
export function resetMockStore(scenario: MockScenario): MockStore {
  const store = createSeedStore(scenario);
  tabStores.set(scenario, store);
  persistStore(store);
  return store;
}
