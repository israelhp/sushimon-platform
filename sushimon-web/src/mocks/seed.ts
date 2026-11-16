import type { Order, OrderLine, OrderStatusEvent, Payment } from '@/lib/data-access/models';
import { addDaysISO, fromLocal, localDate } from '@/lib/time';
import { DEMO_BASE_TIME } from './clock';
import { BRANCH_SEEDS } from './fixtures/branches';
import {
  BACKOFFICE_ORDER_SEEDS,
  DEMO_ACCOUNT,
  STORE_ORDER_SEEDS,
  type OrderSeed,
} from './fixtures/orders';
import {
  BRANCH_HOURS_SEEDS,
  CLOSURE_SEEDS,
  branchClosedScenarioClosures,
} from './fixtures/schedule';
import { DELIVERY_SETTINGS_SEEDS, DELIVERY_ZONE_SEEDS, seedDeliveryFee } from './fixtures/delivery';
import { HIDDEN_DEMO_SEEDS, PRODUCT_SEEDS } from './fixtures/products';
import { MEDIA_ASSET_SEEDS, seedAssetUrl } from './fixtures/media';
import { MODIFIER_GROUP_SEEDS, PRODUCT_MODIFIER_GROUP_SEEDS } from './fixtures/modifiers';
import { PROMOTION_SEEDS } from './fixtures/promotions';
import { ROLE_SEEDS } from './fixtures/rbac';
import { RIDER_SEEDS, STAFF_SEEDS } from './fixtures/staff';
import { MENU_CATEGORY_SEEDS } from './fixtures/categories';
import { CATEGORY_SEEDS, STORE_CONFIG_SEED } from './fixtures/store';
import { centsToPrice } from '@/lib/product-rules';
import { event, totals } from './domain';
import { rngFor } from './factories/random';
import type { MockScenario } from './scenarios';
import {
  MOCK_STORE_VERSION,
  type BranchProductRecord,
  type MediaAssetRecord,
  type MockStore,
  type ProductRecord,
} from './store';

/**
 * Siembra determinista del MockStore para un escenario. La fecha base es la del reloj de la demo
 * (`DEMO_BASE_TIME`); los pedidos sembrados se ubican relativo a ella.
 *
 * Escenarios de dominio aplicados aquí:
 * - empty: sin categorías, productos, promociones, pedidos, historial ni datos de cuenta.
 * - promotion-expired: todas las promociones vencieron ayer.
 * - branch-closed: las sucursales activas están "cerradas" (no se pide "ahora"; sí programado).
 * - product-unavailable: Calientito Roll y Platanito Roll no disponibles en ninguna sucursal.
 * - order-pending: el pago del pedido demo MON-490217 queda "en verificación" (review).
 * (payment-rejected y rider-unavailable se aplican en los handlers.)
 */
export const UNAVAILABLE_IN_SCENARIO = ['calientito-roll', 'platanito-roll'];

/** F13: agotados por sucursal (p10 sin stock en s3, p16 sin stock en s2). Sin fila = disponible. */
const UNAVAILABLE_AT: Record<string, string[]> = {
  'joselito-roll': ['sucursal-3'],
  gaseosas: ['sucursal-2'],
};

/** F13: precio de sucursal distinto del base (producto → sucursal → precio efectivo). */
const PRICE_OVERRIDE_AT: Record<string, Record<string, string>> = {
  'dynamita-roll': { 'sucursal-2': '86.00' },
  'cerveza-nacional': { 'sucursal-3': '35.00' },
};

const STATUS_OFFSETS: Record<string, number> = {
  accepted: 2,
  preparing: 5,
  ready: 16,
  on_the_way: 24,
  delivered: 42,
};
const FLOW = ['accepted', 'preparing', 'ready', 'on_the_way', 'delivered'] as const;

const PRODUCT_SEED_AT = '2026-11-01T12:00:00.000Z';

function buildProducts(scenario: MockScenario): ProductRecord[] {
  if (scenario === 'empty') return [];
  const categoryBySlug = new Map(MENU_CATEGORY_SEEDS.map((c) => [c.slug, c.id]));
  return [...PRODUCT_SEEDS.map((p) => ({ ...p, active: true })), ...HIDDEN_DEMO_SEEDS].map(
    ({ price, categoryId, active, ...p }) => ({
      ...p,
      slug: p.id,
      sku: null,
      description: p.description,
      basePrice: centsToPrice(Math.round(price * 100)),
      categoryId: categoryBySlug.get(categoryId) ?? categoryId,
      active,
      media: [],
      createdAt: PRODUCT_SEED_AT,
      updatedAt: PRODUCT_SEED_AT,
    }),
  );
}

/** F14: la biblioteca sembrada y el vínculo del primer asset con su producto (sin bytes: ver `fixtures/media.ts`). */
function applySeedMedia(
  scenario: MockScenario,
  products: ProductRecord[],
): Pick<MockStore, 'mediaAssets' | 'mediaObjects'> {
  if (scenario === 'empty') return { mediaAssets: [], mediaObjects: {} };
  const mediaAssets: MediaAssetRecord[] = MEDIA_ASSET_SEEDS.map((s) => ({
    id: s.id,
    kind: 'PRODUCT_IMAGE',
    status: 'READY',
    mimeType: s.mimeType,
    sizeBytes: s.sizeBytes,
    checksumSha256: s.checksumSha256,
    objectKey: s.objectKey,
    createdAt: s.createdAt,
    confirmedAt: s.confirmedAt,
    expiresAt: null,
    createdById: null,
  }));
  for (const s of MEDIA_ASSET_SEEDS) {
    const product = products.find((p) => p.id === s.attachedTo);
    if (!product) continue;
    product.media.push({
      id: `media-seed-pm-${s.id.slice(-1)}`,
      url: seedAssetUrl(s),
      altText: s.altText,
      sortOrder: product.media.length,
      assetId: s.id,
    });
  }
  return { mediaAssets, mediaObjects: {} };
}

/** F13: excepciones de sucursal (solo filas no por defecto) a partir de los agotados y precios especiales sembrados. */
function buildBranchProducts(
  scenario: MockScenario,
  products: ProductRecord[],
): BranchProductRecord[] {
  const rows: BranchProductRecord[] = [];
  for (const p of products) {
    for (const b of BRANCH_SEEDS.filter((x) => x.status === 'active')) {
      const available =
        !(UNAVAILABLE_AT[p.id] ?? []).includes(b.id) &&
        !(scenario === 'product-unavailable' && UNAVAILABLE_IN_SCENARIO.includes(p.id));
      const priceOverride = PRICE_OVERRIDE_AT[p.id]?.[b.id] ?? null;
      if (!available || priceOverride !== null) {
        rows.push({
          branchId: b.id,
          productId: p.id,
          priceOverride,
          available,
          updatedAt: PRODUCT_SEED_AT,
        });
      }
    }
  }
  return rows;
}

/** F12: grupos, opciones y asociaciones sembradas (escenario `empty`: sin ninguno). */
function buildModifiers(
  scenario: MockScenario,
): Pick<MockStore, 'modifierGroups' | 'modifiers' | 'productModifierGroups'> {
  if (scenario === 'empty') return { modifierGroups: [], modifiers: [], productModifierGroups: {} };
  return {
    modifierGroups: MODIFIER_GROUP_SEEDS.map((g) => ({
      id: g.id,
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      active: g.active,
      createdAt: PRODUCT_SEED_AT,
      updatedAt: PRODUCT_SEED_AT,
    })),
    modifiers: MODIFIER_GROUP_SEEDS.flatMap((g) =>
      g.options.map((o, sortOrder) => ({
        id: o.id,
        groupId: g.id,
        name: o.name,
        extraPrice: o.extraPrice,
        active: o.active,
        sortOrder,
        createdAt: PRODUCT_SEED_AT,
        updatedAt: PRODUCT_SEED_AT,
      })),
    ),
    productModifierGroups: Object.fromEntries(
      Object.entries(PRODUCT_MODIFIER_GROUP_SEEDS).map(([id, groups]) => [id, [...groups]]),
    ),
  };
}

export function buildSeedOrder(seed: OrderSeed, base: Date, scenario: MockScenario): Order {
  const created = new Date(base.getTime() - seed.minutesAgo * 60_000);
  const at = (minutes: number) => new Date(created.getTime() + minutes * 60_000);
  const age = seed.minutesAgo;
  const day = localDate(created);

  const lines: OrderLine[] = seed.lines.map((l) => {
    const product = PRODUCT_SEEDS.find((p) => p.id === l.productId);
    const unitPrice = l.unitPrice ?? product?.price;
    if (unitPrice === undefined) throw new Error(`Precio desconocido: ${l.productId}`);
    return {
      productId: l.productId,
      name: l.name ?? product?.name ?? l.productId,
      quantity: l.quantity,
      note: l.note ?? '',
      unitPrice,
      subtotal: unitPrice * l.quantity,
    };
  });

  const branch = BRANCH_SEEDS.find((b) => b.id === seed.branchId);
  if (!branch) throw new Error(`Sucursal desconocida: ${seed.branchId}`);
  let fee = 0;
  if (seed.fulfillment === 'delivery') {
    if (!seed.address) throw new Error(`${seed.id}: falta dirección`);
    // F09: la tarifa es el `baseFee` de la zona propia sembrada (instantánea del pedido), no un «nivel».
    const zoneFee = seedDeliveryFee(branch.id, seed.address);
    if (zoneFee === null) throw new Error(`${seed.id}: dirección fuera de cobertura`);
    fee = zoneFee;
  }
  const t = totals(lines, fee);

  // Historial: received + estados alcanzados (sin pasar del "ahora" de la siembra).
  const history: OrderStatusEvent[] = [event(created, 'order', 'received')];
  const cap = (m: number) => Math.min(m, Math.max(age - 1, 0));
  if (seed.status === 'rejected' || seed.status === 'cancelled') {
    history.push(event(at(cap(3)), 'order', seed.status, { reason: seed.rejectionReason ?? '' }));
  } else {
    const reached = FLOW.slice(0, FLOW.indexOf(seed.status as (typeof FLOW)[number]) + 1);
    for (const s of reached) {
      if (s === 'on_the_way' && seed.fulfillment === 'pickup') continue;
      if (s === 'on_the_way' || s === 'delivered') continue; // los agrega la logística abajo
      history.push(event(at(cap(STATUS_OFFSETS[s] ?? 0)), 'order', s));
    }
  }

  let delivery: Order['delivery'] = null;
  if (seed.delivery) {
    const d = seed.delivery;
    const requested = fromLocal(day, d.requestedAt);
    const delivered = d.deliveredAt ? fromLocal(day, d.deliveredAt) : null;
    delivery = {
      provider: d.provider,
      status: d.status,
      riderId: d.riderId ?? null,
      riderName: d.riderName,
      reference: d.reference,
      cost: d.provider === 'own' ? null : fee + (seed.courierSurcharge ?? 0),
      requestedAt: requested.toISOString(),
      etaAt: fromLocal(day, d.etaAt).toISOString(),
      deliveredAt: delivered?.toISOString() ?? null,
      simulated: true,
    };
    history.push(event(requested, 'delivery', 'searching', { detail: d.reference }));
    const assigned = new Date(requested.getTime() + 4 * 60_000);
    history.push(event(assigned, 'delivery', 'assigned', { detail: d.riderName }));
    if (seed.status === 'on_the_way' || seed.status === 'delivered') {
      history.push(event(at(cap(STATUS_OFFSETS.on_the_way ?? 24)), 'order', 'on_the_way'));
    }
  }
  if (seed.status === 'delivered') {
    const when = delivery?.deliveredAt ?? at(cap(STATUS_OFFSETS.delivered ?? 42)).toISOString();
    history.push(event(when, 'order', 'delivered'));
  }
  history.sort((a, b) => a.at.localeCompare(b.at));

  const rng = rngFor(`payment|${seed.id}`);
  const isCard = seed.payment.method === 'card';
  const paymentStatus: Payment['status'] = isCard
    ? scenario === 'order-pending' && seed.id === 'MON-490217'
      ? 'review'
      : 'approved'
    : seed.status === 'delivered'
      ? 'approved'
      : 'pending';
  const payment: Payment = {
    method: seed.payment.method,
    status: paymentStatus,
    amount: t.total,
    reference: isCard
      ? (seed.payment.reference ?? `NNT-DEMO-${10000 + Math.floor(rng() * 89999)}`)
      : null,
    cardBrand: isCard ? 'Visa' : null,
    cardLast4: isCard ? '4242' : null,
    simulated: true,
    processedAt: isCard
      ? at(1).toISOString()
      : seed.status === 'delivered'
        ? (history[history.length - 1]?.at ?? null)
        : null,
  };
  if (isCard) history.splice(1, 0, event(at(1), 'payment', paymentStatus));

  return {
    id: seed.id,
    createdAt: created.toISOString(),
    updatedAt: history[history.length - 1]?.at ?? created.toISOString(),
    branchId: seed.branchId,
    fulfillment: seed.fulfillment,
    schedule: { kind: 'now' },
    customer: seed.customer,
    address: seed.address,
    lines,
    ...t,
    currency: 'GTQ',
    note: seed.note,
    deliveryTier: null,
    status: seed.status,
    rejectionReason: seed.rejectionReason ?? null,
    payment,
    delivery,
    history,
    incidents: (seed.incidents ?? []).map((i) => ({
      ...i,
      orderId: seed.id,
      createdAt: i.createdAt || at(80).toISOString(),
    })),
  };
}

export function createSeedStore(scenario: MockScenario = 'default'): MockStore {
  const base = new Date(DEMO_BASE_TIME);
  const today = localDate(base);
  const empty = scenario === 'empty';
  const products = buildProducts(scenario);

  const branches = structuredClone(BRANCH_SEEDS);
  // F08: `branch-closed` = cierre extraordinario en curso en cada sucursal activa (lo decide el motor, no un booleano).
  const closures = [
    ...structuredClone(CLOSURE_SEEDS),
    ...(scenario === 'branch-closed'
      ? branchClosedScenarioClosures(branches.filter((b) => b.active).map((b) => b.id))
      : []),
  ];
  const promotions = empty
    ? []
    : structuredClone(PROMOTION_SEEDS).map((p) =>
        scenario === 'promotion-expired'
          ? { ...p, validTo: addDaysISO(today, -1), validFrom: addDaysISO(today, -40) }
          : p,
      );
  const orders = empty
    ? []
    : [...STORE_ORDER_SEEDS, ...BACKOFFICE_ORDER_SEEDS].map((s) =>
        buildSeedOrder(s, base, scenario),
      );
  const courierSurcharges = Object.fromEntries(
    BACKOFFICE_ORDER_SEEDS.filter((s) => s.courierSurcharge).map((s) => [
      s.id,
      s.courierSurcharge ?? 0,
    ]),
  );

  const daysAgo = (n: number) => new Date(base.getTime() - n * 86_400_000).toISOString();
  const demoAccount = {
    profile: { ...DEMO_ACCOUNT.profile, defaultAddressId: empty ? null : 'demo-casa' },
    addresses: empty
      ? []
      : DEMO_ACCOUNT.addresses.map(({ daysAgo: n, ...a }) => ({ ...a, createdAt: daysAgo(n) })),
    // Más reciente primero (como `created_at DESC`): el primero se marcó hace 1 día, el siguiente hace 2, etc.
    favorites: empty
      ? []
      : DEMO_ACCOUNT.favorites.map((productId, i) => ({ productId, addedAt: daysAgo(i + 1) })),
  };

  return {
    version: MOCK_STORE_VERSION,
    scenario,
    seededFor: today,
    config: structuredClone(STORE_CONFIG_SEED),
    branches,
    branchHours: structuredClone(BRANCH_HOURS_SEEDS),
    closures,
    // Sucursal-5 (inactiva): la primera escritura de horario/cierres responde BRANCH_SCHEDULE_BUSY (reintentable).
    scheduleBusy: { 'sucursal-5': 1 },
    deliveryZones: structuredClone(DELIVERY_ZONE_SEEDS),
    deliverySettings: structuredClone(DELIVERY_SETTINGS_SEEDS),
    pedidosyaCoverage: 'unknown',
    favoritesCatalog: 'available',
    categories: empty ? [] : structuredClone(CATEGORY_SEEDS),
    menuCategories: empty ? [] : structuredClone([...MENU_CATEGORY_SEEDS]),
    products,
    branchProducts: buildBranchProducts(scenario, products),
    ...applySeedMedia(scenario, products),
    ...buildModifiers(scenario),
    promotions,
    orders,
    roles: ROLE_SEEDS.map((r) => ({ ...r, permissions: [...r.permissions] })),
    staff: STAFF_SEEDS.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      active: u.active,
      linked: u.linked,
      linkedAt: null,
      createdAt: u.createdAt,
      createdById: u.createdById,
      assignments: u.assignments.map((a) => ({
        roleId: ROLE_SEEDS.find((r) => r.code === a.role)?.id ?? '',
        branchId: a.branchId,
      })),
    })),
    riders: structuredClone(RIDER_SEEDS),
    accounts: { [DEMO_ACCOUNT.profile.email]: demoAccount },
    jobApplications: [],
    verifiedOrderIds: [],
    courierSurcharges,
    historyEnabled: !empty,
    sequences: {
      order: 7059,
      incident: 1043,
      address: 1,
      product: 1,
      media: 1,
      mediaAsset: 4,
      modifierGroup: 1,
      modifier: 1,
      category: 1,
      menuCategory: 1,
      promotion: 1,
      user: 12,
      job: 1,
      quote: 1,
      payment: 1,
      courier: 32000,
      branch: 5,
      closure: 3,
      zone: DELIVERY_ZONE_SEEDS.length,
    },
  };
}
