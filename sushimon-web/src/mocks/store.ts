import type {
  AdminDeliveryZone,
  StoredAddress,
  Category,
  Customer,
  JobApplication,
  Order,
  AdminProductMedia,
  ModifierExtraPrice,
  ProductPrice,
  StaffRole,
  StoreConfig,
} from '@/lib/data-access/models';
import type { DemoSessionState } from '@/lib/demo-session';
import type { BranchSeed } from './fixtures/branches';
import type { BranchHoursDay } from '@/lib/data-access/models';
import type { CategoryRecord } from './fixtures/categories';
import type { ClosureRecord } from './fixtures/schedule';
import type { DeliverySettingsRecord } from './fixtures/delivery';
import type { PromotionRecord } from './fixtures/promotions';
import type { RiderSeed } from './fixtures/staff';
import type { Clock } from './clock';
import type { MockScenario } from './scenarios';

/**
 * Estado en memoria del adaptador mock (simula la base de datos del servidor).
 * Solo guarda pedidos "vivos" (los de hoy + los del cliente demo + los creados en la sesión);
 * el historial de días anteriores lo genera `factories/history.ts` de forma determinista.
 * NUNCA contiene PAN completo, CVV ni PIN: de una tarjeta solo marca, últimos 4 y referencia.
 */
export const MOCK_STORE_VERSION = 12;

/**
 * Producto del mock. Los campos F11 (`id`…`updatedAt`) reproducen `app.products` + `app.product_media`; el bloque «SIMULADO»
 * es lo que F11 NO provee (F12/F13/F15, textos por idioma) y solo sale por `/v1/demo/catalog/*`. El `id` del mock es
 * legible (no UUID) y coincide con el slug sembrado: carritos, pedidos y favoritos de la demo lo referencian.
 */
export interface ProductRecord {
  id: string;
  slug: string;
  sku: string | null;
  name: string;
  description: string | null;
  basePrice: ProductPrice;
  /** Id de una categoría del menú (`menuCategories`, F10). */
  categoryId: string;
  active: boolean;
  media: AdminProductMedia[];
  createdAt: string;
  updatedAt: string;
  // ── SIMULADO (F12/F13/F15 y textos por idioma) ──
  nameEn?: string;
  descriptionEn?: string;
  illustration: string;
  featured: boolean;
  food: boolean;
}

/**
 * F14: asset de la biblioteca (`app.media_assets`). La URL pública NO se guarda: se deriva de `objectKey` (host simulado
 * `*.invalid`). `READY` = confirmado; `PENDING` caduca en `expiresAt`. Sin `original_name` (no se guarda).
 */
export interface MediaAssetRecord {
  id: string;
  kind: 'PRODUCT_IMAGE';
  status: 'PENDING' | 'READY';
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  objectKey: string;
  createdAt: string;
  confirmedAt: string | null;
  expiresAt: string | null;
  /** Empleado que lo creó (para el tope de PENDING). */
  createdById: string | null;
}

/** F14: objeto que el almacén SIMULADO recibió con el PUT (lo que `HeadObject` vería en R2). Sin bytes. */
export interface SimulatedMediaObjectRecord {
  sizeBytes: number;
  contentType: string;
  checksumSha256: string;
}

/**
 * F13: excepción por sucursal (`app.branch_products`). AUSENCIA de fila = disponible al precio base; la fila existe solo si hay
 * override o `available=false` y se ELIMINA al volver al estado por defecto (ADR-0019 D2).
 */
export interface BranchProductRecord {
  branchId: string;
  productId: string;
  priceOverride: ProductPrice | null;
  available: boolean;
  updatedAt: string;
}

/** F12: grupo de modificadores (`app.modifier_groups`). Sin borrado físico: solo `active=false`. */
export interface ModifierGroupRecord {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** F12: opción de un grupo (`app.modifiers`). `extraPrice` es una cadena decimal (`"5.00"`). */
export interface ModifierRecord {
  id: string;
  groupId: string;
  name: string;
  extraPrice: ModifierExtraPrice;
  active: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

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
   * F11: simulación DETERMINISTA de `PRODUCTS_BUSY` (la transacción de escritura agotó su tiempo): nº de altas/ediciones de
   * producto que fallarán con 503 antes de que una funcione. Opcional: ausente = 0.
   */
  productsBusy?: number;
  /**
   * F13: simulación DETERMINISTA de `BRANCH_PRODUCTS_BUSY` (la transacción de escritura agotó su tiempo): nº de escrituras de
   * precio/disponibilidad por sucursal que fallarán con 503 antes de que una funcione. Opcional: ausente = 0.
   */
  branchProductsBusy?: number;
  /**
   * F14: simula que el almacenamiento de imágenes NO está configurado (adaptador `unavailable` de la API ⇒ 503
   * `MEDIA_STORAGE_UNAVAILABLE` en intents, complete y borrado). Opcional: ausente/false = disponible. Solo existe en el mock.
   */
  mediaStorageUnavailable?: boolean;
  /** F14: simulación DETERMINISTA de `MEDIA_BUSY`: nº de escrituras de medios que fallarán con 503 antes de que una funcione. */
  mediaBusy?: number;
  /**
   * F12: simulación DETERMINISTA de `MODIFIERS_BUSY` (bloqueo no disponible o transacción agotada): nº de escrituras de
   * modificadores (grupos, opciones, reordenar, asociar a producto) que fallarán con 503 antes de que una funcione.
   */
  modifiersBusy?: number;
  /** F15: simulación DETERMINISTA de `PROMOTIONS_BUSY`: nº de escrituras de promociones que fallarán con 503 antes de que una funcione. */
  promotionsBusy?: number;
  /**
   * F02: simula que el reinicio de MFA no está disponible (falta la clave de servicio del servidor ⇒ 503
   * `MFA_RESET_UNAVAILABLE`). Opcional: ausente/false = disponible. Solo existe en el mock.
   */
  mfaResetUnavailable?: boolean;
  categories: Category[];
  /** F10: categorías del menú (jerarquía). Los productos mock se unen a ellas por `slug` hasta F11. */
  menuCategories: CategoryRecord[];
  products: ProductRecord[];
  /** F14: biblioteca de medios y objetos recibidos por el almacén simulado (assetId → objeto). */
  mediaAssets: MediaAssetRecord[];
  mediaObjects: Record<string, SimulatedMediaObjectRecord>;
  /** F13: excepciones de precio/disponibilidad por sucursal (solo filas no por defecto). */
  branchProducts: BranchProductRecord[];
  /** F12: grupos y opciones de modificadores (globales, compartibles entre productos). */
  modifierGroups: ModifierGroupRecord[];
  modifiers: ModifierRecord[];
  /** F12: id de producto → ids de grupos asociados, en orden de asociación (máx. 10). */
  productModifierGroups: Record<string, string[]>;
  /** F15: promociones y cupones (alcance explícito, `version` para concurrencia optimista). */
  promotions: PromotionRecord[];
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
    media: number;
    mediaAsset: number;
    modifierGroup: number;
    modifier: number;
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
