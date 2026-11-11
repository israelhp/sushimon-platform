import type {
  Address,
  Category,
  Customer,
  JobApplication,
  Order,
  Product,
  StaffUser,
  StoreConfig,
} from '@/lib/data-access/models';
import type { DemoSessionState } from '@/lib/demo-session';
import type { BranchSeed } from './fixtures/branches';
import type { PromotionSeed } from './fixtures/promotions';
import type { RiderSeed } from './fixtures/staff';
import type { Clock } from './clock';
import type { MockScenario } from './scenarios';

/**
 * Estado en memoria del adaptador mock (simula la base de datos del servidor).
 * Solo guarda pedidos "vivos" (los de hoy + los del cliente demo + los creados en la sesión);
 * el historial de días anteriores lo genera `factories/history.ts` de forma determinista.
 * NUNCA contiene PAN completo, CVV ni PIN: de una tarjeta solo marca, últimos 4 y referencia.
 */
export const MOCK_STORE_VERSION = 1;

export type ProductRecord = Omit<Product, 'available'>;

export interface CustomerAccount {
  profile: Customer;
  addresses: Address[];
  favorites: string[];
}

export interface MockStore {
  version: number;
  scenario: MockScenario;
  /** Fecha local (YYYY-MM-DD) del "hoy" con que se sembró (para el historial generado). */
  seededFor: string;
  config: Omit<StoreConfig, 'serverTime'>;
  branches: BranchSeed[];
  categories: Category[];
  products: ProductRecord[];
  promotions: PromotionSeed[];
  orders: Order[];
  staff: StaffUser[];
  riders: RiderSeed[];
  accounts: Record<string, CustomerAccount>;
  jobApplications: JobApplication[];
  /** Pedidos que esta sesión puede ver como invitado (creados aquí o consultados con teléfono). */
  verifiedOrderIds: string[];
  /** Diferencia costo courier − envío cobrado por pedido (para cotizar PedidosYa simulado). */
  courierSurcharges: Record<string, number>;
  /** Historial generado deshabilitado (escenario `empty`). */
  historyEnabled: boolean;
  sequences: {
    order: number;
    incident: number;
    address: number;
    product: number;
    category: number;
    promotion: number;
    user: number;
    job: number;
    quote: number;
    payment: number;
    courier: number;
  };
}

/** Contexto por solicitud del adaptador mock. */
export interface MockContext {
  /** Sesión de demostración (en http la decidiría el servidor con la cookie/token). */
  session: DemoSessionState;
  clock: Clock;
}

const STORAGE_PREFIX = 'sushimon-mock-store-v1';

export function storageKey(scenario: MockScenario): string {
  return `${STORAGE_PREFIX}:${scenario}`;
}

/** Lee el store persistido de la pestaña (SSR-safe). null si no hay o es de otra versión. */
export function loadPersistedStore(scenario: MockScenario): MockStore | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(scenario));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MockStore;
    return parsed.version === MOCK_STORE_VERSION && parsed.scenario === scenario ? parsed : null;
  } catch {
    return null;
  }
}

export function persistStore(store: MockStore): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(storageKey(store.scenario), JSON.stringify(store));
  } catch {
    // Cuota llena o almacenamiento bloqueado: la demo sigue en memoria.
  }
}

export function clearPersistedStore(scenario: MockScenario): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(storageKey(scenario));
  } catch {
    // sin almacenamiento
  }
}
