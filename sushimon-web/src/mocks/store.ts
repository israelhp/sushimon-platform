import type {
  AdminDeliveryZone,
  StoredAddress,
  Category,
  Customer,
  JobApplication,
  Order,
  Product,
  StaffRole,
  StoreConfig,
} from '@/lib/data-access/models';
import type { DemoSessionState } from '@/lib/demo-session';
import type { BranchSeed } from './fixtures/branches';
import type { BranchHoursDay } from '@/lib/data-access/models';
import type { CategoryRecord } from './fixtures/categories';
import type { ClosureRecord } from './fixtures/schedule';
import type { DeliverySettingsRecord } from './fixtures/delivery';
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
export const MOCK_STORE_VERSION = 7;

export type ProductRecord = Omit<Product, 'available'>;

/** F06: favorito del cliente (`customer_favorites`). Sin precios ni datos del producto: solo el id y cuándo se marcó. */
export interface FavoriteRecord {
  productId: string;
  addedAt: string;
}

export interface CustomerAccount {
  profile: Customer;
  addresses: StoredAddress[];
  /** Favoritos de ESTA cuenta (el store está aislado por correo: una cuenta nunca ve los de otra). */
  favorites: FavoriteRecord[];
}

/** Empleado (`staff_users` + `staff_assignments`) del mock. Nunca guarda `authUserId`: solo si está vinculado. */
export interface StaffRecord {
  id: string;
  fullName: string;
  email: string;
  active: boolean;
  /** false = PENDING_LINK. */
  linked: boolean;
  linkedAt: string | null;
  createdAt: string;
  createdById: string | null;
  assignments: { roleId: string; branchId: string | null }[];
}

export interface RoleRecord {
  id: string;
  code: StaffRole;
  name: string;
  isSystem: boolean;
  permissions: string[];
}

export interface MockStore {
  version: number;
  scenario: MockScenario;
  /** Fecha local (YYYY-MM-DD) del "hoy" con que se sembró (para el historial generado). */
  seededFor: string;
  config: Omit<StoreConfig, 'serverTime'>;
  branches: BranchSeed[];
  /** F08: horario semanal por sucursal (7 días ISO 1–7). Ausente = sin horario configurado. */
  branchHours: Record<string, BranchHoursDay[]>;
  /** F08: cierres extraordinarios (instantes UTC). */
  closures: ClosureRecord[];
  /**
   * F08: simulación DETERMINISTA de `BRANCH_SCHEDULE_BUSY` (lock timeout): nº de escrituras de horario/cierres de esa
   * sucursal que fallarán con 409 antes de que una funcione. Opcional: stores anteriores no lo traen.
   */
  scheduleBusy?: Record<string, number>;
  /** F09: zonas propias (sin borrado físico; `active` + `version`). */
  deliveryZones: AdminDeliveryZone[];
  /** F09: configuración por sucursal. AUSENTE = valores por defecto (`isDefault=true`), como en la API. */
  deliverySettings: Record<string, DeliverySettingsRecord>;
  /**
   * F09: respuesta SIMULADA del adaptador de PedidosYa. `unknown` (defecto) = integración bloqueada
   * (`UNKNOWN` + `BLOCKED_EXTERNAL`). `available`/`unavailable` solo existen en el mock y se rotulan `MOCK`/`simulated`.
   */
  pedidosyaCoverage: 'unknown' | 'available' | 'unavailable';
  /**
   * F06: ¿el catálogo puede validar/resumir productos? Hasta F11 la API real responde SIEMPRE `unavailable` (503
   * `CATALOG_UNAVAILABLE` al marcar; `UNKNOWN` al listar). El mock arranca `available` para poder mostrar la UI completa.
   */
  favoritesCatalog: 'available' | 'unavailable';
  /**
   * F06: simulación DETERMINISTA de `FAVORITES_BUSY` (candado o tiempo de la transacción agotados): nº de altas (PUT)
   * que fallarán con 503 antes de que una funcione. Opcional: ausente = 0.
   */
  favoritesBusy?: number;
  /**
   * F02: simula que el reinicio de MFA no está disponible (falta la clave de servicio del servidor ⇒ 503
   * `MFA_RESET_UNAVAILABLE`). Opcional: ausente/false = disponible. Solo existe en el mock.
   */
  mfaResetUnavailable?: boolean;
  categories: Category[];
  /** F10: categorías del menú (jerarquía). Los productos mock se unen a ellas por `slug` hasta F11. */
  menuCategories: CategoryRecord[];
  products: ProductRecord[];
  promotions: PromotionSeed[];
  orders: Order[];
  staff: StaffRecord[];
  roles: RoleRecord[];
  riders: RiderSeed[];
  accounts: Record<string, CustomerAccount>;
  jobApplications: JobApplication[];
  /** Pedidos que esta sesión puede ver como invitado (creados aquí o consultados con teléfono). */
  verifiedOrderIds: string[];
  /**
   * Intentos fallidos de `POST /v1/orders/lookup` por número de pedido normalizado (existan o no,
   * para no revelar existencia), con la hora del último fallo para levantar el bloqueo tras la
   * ventana. Opcional: los stores persistidos antes de este campo no lo traen.
   */
  lookupFailures?: Record<string, { count: number; lastAt: number }>;
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
    menuCategory: number;
    promotion: number;
    user: number;
    job: number;
    quote: number;
    payment: number;
    courier: number;
    branch: number;
    closure: number;
    zone: number;
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

const PERSIST_DEBOUNCE_MS = 300;
/** Último store pendiente de escribir por escenario (la serialización completa es cara: se agrupa). */
const pendingPersist = new Map<MockScenario, MockStore>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let flushListenersAttached = false;

function writeNow(store: MockStore): void {
  try {
    window.sessionStorage.setItem(storageKey(store.scenario), JSON.stringify(store));
  } catch {
    // Cuota llena o almacenamiento bloqueado: la demo sigue en memoria.
  }
}

/** Escribe de inmediato lo pendiente (pruebas, `pagehide`, `visibilitychange`, reinicio de la demo). */
export function flushPersist(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (typeof window === 'undefined') {
    pendingPersist.clear();
    return;
  }
  for (const store of pendingPersist.values()) writeNow(store);
  pendingPersist.clear();
}

function attachFlushListeners(): void {
  if (flushListenersAttached || typeof window.addEventListener !== 'function') return;
  flushListenersAttached = true;
  window.addEventListener('pagehide', flushPersist);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushPersist();
    });
  }
}

/**
 * Persiste el store de la pestaña en sessionStorage con debounce (~300 ms): cada escritura del mock
 * serializaba todo el store. Se vuelca al ocultar/cerrar la página; las pruebas usan `flushPersist()`.
 */
export function persistStore(store: MockStore): void {
  if (typeof window === 'undefined') return;
  pendingPersist.set(store.scenario, store);
  attachFlushListeners();
  if (persistTimer === null) persistTimer = setTimeout(flushPersist, PERSIST_DEBOUNCE_MS);
}

export function clearPersistedStore(scenario: MockScenario): void {
  if (typeof window === 'undefined') return;
  pendingPersist.delete(scenario);
  try {
    window.sessionStorage.removeItem(storageKey(scenario));
  } catch {
    // sin almacenamiento
  }
}
