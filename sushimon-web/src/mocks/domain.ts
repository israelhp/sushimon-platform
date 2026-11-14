import { ApiError, codeForStatus } from '@/lib/data-access/errors';
import type {
  Branch,
  DeliveryTierId,
  Order,
  OrderAddress,
  OrderLine,
  OrderStatusEvent,
  Product,
  Promotion,
} from '@/lib/data-access/models';
import { isWithinHours } from '@/lib/schedule';
import { localDate, localDayOfWeek, localMinutes, hmToMinutes } from '@/lib/time';
import type { BranchSeed } from './fixtures/branches';
import type { PromotionSeed } from './fixtures/promotions';
import type { MockStore, ProductRecord } from './store';

/**
 * Reglas de negocio puras que el adaptador mock aplica "como lo haría el servidor".
 * Todos los errores son ApiError con el mismo código que derivaría el adaptador http del status.
 */
export function fail(status: number, message: string): never {
  throw new ApiError(status, codeForStatus(status), message);
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export const digits = (s: string) => s.replace(/\D/g, '');

/** Teléfono de Guatemala: 8 dígitos (o 502 + 8). */
export function isValidPhone(phone: string): boolean {
  const d = digits(phone);
  return (d.length === 11 && d.startsWith('502') ? d.slice(3) : d).length === 8;
}

export function phoneKey(phone: string): string {
  const d = digits(phone);
  return d.length === 11 && d.startsWith('502') ? d.slice(3) : d;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

/** Normaliza "490217" o "mon-490217" a "MON-490217". */
export function normalizeOrderNumber(value: string): string {
  const v = value.trim().toUpperCase().replace(/\s+/g, '');
  return /^\d+$/.test(v) ? `MON-${v}` : v;
}

// ── Sucursales y cobertura ────────────────────────────────────────────────────────────────

export function branchView(seed: BranchSeed, now: Date): Branch {
  // Se omiten los campos de identidad F07 (`code`, coordenadas, `active`, `createdAt`): esta es la vista OPERATIVA
  // simulada (F08/F09); la identidad y el estado administrativo se leen de `/v1/branches` y `/v1/admin/branches`.
  const {
    legacyBackofficeId: _legacy,
    code,
    latitude,
    longitude,
    active,
    createdAt,
    ...rest
  } = seed;
  void [_legacy, code, latitude, longitude, active, createdAt];
  return {
    ...rest,
    openNow: seed.status === 'active' && seed.isOpen && isWithinHours(seed.hours, now),
  };
}

const TIER_RANK: DeliveryTierId[] = ['near', 'mid', 'extended', 'far'];

export function tierFor(
  branch: BranchSeed,
  municipality: string,
  zone: string,
): DeliveryTierId | null {
  if (branch.status !== 'active') return null;
  const z = zone.trim() ? String(Number(zone)) : '';
  const rules = branch.coverage.filter((r) => r.municipality === municipality);
  const exact = rules.find((r) => r.zone !== null && r.zone === z);
  if (exact) return exact.tier;
  const whole = rules.find((r) => r.zone === null);
  return whole ? whole.tier : null;
}

/** Sucursal activa con el mejor nivel (más cercano) para la dirección. */
export function bestBranchFor(
  branches: BranchSeed[],
  municipality: string,
  zone: string,
): { branch: BranchSeed; tier: DeliveryTierId } | null {
  let best: { branch: BranchSeed; tier: DeliveryTierId } | null = null;
  for (const branch of branches) {
    const tier = tierFor(branch, municipality, zone);
    if (!tier) continue;
    if (!best || TIER_RANK.indexOf(tier) < TIER_RANK.indexOf(best.tier)) best = { branch, tier };
  }
  return best;
}

export function requiresZone(address: Pick<OrderAddress, 'department' | 'municipality'>): boolean {
  return address.department === 'Guatemala' && address.municipality === 'Guatemala';
}

/** Validación de dirección (misma regla que el checkout del prototipo). Lanza 400. */
export function assertAddress(store: MockStore, address: Partial<OrderAddress> | undefined) {
  if (!address) fail(400, 'Falta la dirección de entrega');
  const { department = '', municipality = '', zone = '', line = '' } = address;
  if (!department || !municipality) fail(400, 'Departamento y municipio son obligatorios');
  if (requiresZone({ department, municipality }) && !zone.trim()) fail(400, 'Indica la zona');
  if (line.trim().length < 5) fail(400, 'La dirección es muy corta');
  if (requiresZone({ department, municipality }) && zone.trim()) {
    const n = Number(zone);
    if (!Number.isInteger(n) || n < 1 || n > 25 || store.config.nonexistentZones.includes(n))
      fail(400, 'Zona inválida');
  }
  return {
    department,
    municipality,
    zone: requiresZone({ department, municipality }) ? String(Number(zone)) : '',
    line: line.trim(),
    references: (address.references ?? '').trim(),
  } satisfies OrderAddress;
}

export function feeFor(store: MockStore, tier: DeliveryTierId) {
  const t = store.config.deliveryTiers.find((x) => x.id === tier);
  if (!t) fail(500, `Nivel sin tarifa: ${tier}`);
  return t;
}

// ── Catálogo ──────────────────────────────────────────────────────────────────────────────

export function availableAt(product: ProductRecord, branchId: string | undefined): boolean {
  if (!branchId) return product.availability.some((a) => a.available);
  return product.availability.find((a) => a.branchId === branchId)?.available ?? false;
}

export function productView(product: ProductRecord, branchId?: string): Product {
  return { ...product, available: availableAt(product, branchId) };
}

export function promotionView(seed: PromotionSeed, now: Date): Promotion {
  const today = localDate(now);
  let status: Promotion['status'];
  if (!seed.active) status = 'inactive';
  else if (today > seed.validTo) status = 'expired';
  else if (today < seed.validFrom) status = 'scheduled';
  else status = 'current';
  return { ...seed, status };
}

/** ¿La promoción aplica en este instante (día y hora)? Útil para la UI de Happy Hour. */
export function isPromotionLiveAt(promo: Promotion, now: Date): boolean {
  if (promo.status !== 'current') return false;
  const isoDay = ((localDayOfWeek(now) + 6) % 7) + 1;
  const m = localMinutes(now);
  return (
    promo.daysOfWeek.includes(isoDay) &&
    m >= hmToMinutes(promo.startTime) &&
    m < hmToMinutes(promo.endTime)
  );
}

// ── Pedidos ───────────────────────────────────────────────────────────────────────────────

export function event(
  at: Date | string,
  kind: OrderStatusEvent['kind'],
  status: string,
  extra: { reason?: string | null; detail?: string | null } = {},
): OrderStatusEvent {
  return {
    at: typeof at === 'string' ? at : at.toISOString(),
    kind,
    status,
    reason: extra.reason ?? null,
    detail: extra.detail ?? null,
  };
}

export function totals(lines: OrderLine[], deliveryFee: number) {
  const subtotal = round2(lines.reduce((sum, l) => sum + l.subtotal, 0));
  return { subtotal, deliveryFee, discount: 0, total: round2(subtotal + deliveryFee) };
}

export function findOrder(store: MockStore, id: string): Order {
  const order = store.orders.find((o) => o.id === normalizeOrderNumber(id));
  if (!order) fail(404, 'Pedido no encontrado');
  return order;
}

/** Pedido con tarjeta aún sin pagar (no llega a la cocina/backoffice). */
export function isAwaitingPayment(order: Order): boolean {
  return (
    order.payment.method === 'card' &&
    (order.payment.status === 'pending' || order.payment.status === 'declined')
  );
}

export function touch(order: Order, now: Date) {
  order.updatedAt = now.toISOString();
}
