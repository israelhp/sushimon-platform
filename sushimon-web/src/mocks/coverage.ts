import type {
  AdminDeliveryZone,
  BranchDeliverySettings,
  DeliveryCoverageCheckResponse,
  PedidosYaCoverage,
  ProviderIntegrationStatus,
} from '@/lib/data-access/models';
import { coverageZoneOf, zoneKeyOf } from '@/lib/delivery-zone';
import { DEFAULT_DELIVERY_SETTINGS } from './fixtures/delivery';
import { municipalityByName } from './fixtures/geography';
import type { MockStore } from './store';

/**
 * Motor de cobertura del mock: reproduce `DeliveryCoverageService` de la API (spec 008 D8/D16/D18/D19/D20).
 *  - OWN: flag apagado => `UNAVAILABLE` + `PROVIDER_DISABLED` sin mirar zonas; si no, zona ESPECÍFICA > cobertura
 *    GENERAL del municipio > nada (`NO_ZONE_COVERAGE`). Una zona inactiva se ignora como si no existiera.
 *  - PEDIDOSYA: sin integración verificable SIEMPRE `UNKNOWN` + `BLOCKED_EXTERNAL`/`INTEGRATION_NOT_CONFIGURED`. Solo el
 *    selector de demostración (`store.pedidosyaCoverage`) puede devolver `AVAILABLE`/`UNAVAILABLE`, y entonces se marca
 *    `integrationStatus = MOCK` (y la elegibilidad `simulated`): jamás se presenta como disponibilidad real.
 *  - `eligibility` se deriva aquí, como en el servidor; el cliente no la recalcula.
 */
export const pedidosyaIntegration = (store: Pick<MockStore, 'pedidosyaCoverage'>) =>
  (store.pedidosyaCoverage === 'unknown'
    ? 'BLOCKED_EXTERNAL'
    : 'MOCK') satisfies ProviderIntegrationStatus;

export function settingsOf(store: MockStore, branchId: string) {
  const row = store.deliverySettings[branchId];
  return { ...(row ?? DEFAULT_DELIVERY_SETTINGS), row: row ?? null };
}

export function settingsView(store: MockStore, branchId: string): BranchDeliverySettings {
  const { ownDeliveryZonesEnabled, pedidosyaEnabled, row } = settingsOf(store, branchId);
  return {
    branchId,
    ownDeliveryZonesEnabled,
    pedidosyaEnabled,
    pedidosyaIntegrationStatus: pedidosyaIntegration(store),
    isDefault: row === null,
    updatedAt: row?.updatedAt ?? null,
  };
}

/** Zonas ACTIVAS de (sucursal, municipio): como mucho una por clave (unicidad D7). */
function candidates(store: MockStore, branchId: string, municipalityId: string) {
  return store.deliveryZones.filter(
    (z) => z.branchId === branchId && z.municipalityId === municipalityId && z.active,
  );
}

export function pickOwnZone(
  rows: readonly AdminDeliveryZone[],
  zoneKey: string,
): { zone: AdminDeliveryZone; matchedBy: 'ZONE' | 'MUNICIPALITY' } | null {
  if (zoneKey !== '') {
    const specific = rows.find((z) => zoneKeyOf(z.zoneLabel) === zoneKey);
    if (specific) return { zone: specific, matchedBy: 'ZONE' };
  }
  const general = rows.find((z) => z.zoneLabel === null);
  return general ? { zone: general, matchedBy: 'MUNICIPALITY' } : null;
}

export function evaluateOwn(
  store: MockStore,
  branchId: string,
  municipalityId: string,
  zoneLabel: string | null,
): DeliveryCoverageCheckResponse['providers']['OWN'] {
  const { ownDeliveryZonesEnabled: enabled } = settingsOf(store, branchId);
  const none = { deliveryZoneId: null, baseFee: null, currency: 'GTQ', matchedBy: null } as const;
  if (!enabled) {
    return { enabled, coverageStatus: 'UNAVAILABLE', ...none, reason: 'PROVIDER_DISABLED' };
  }
  const match = pickOwnZone(
    candidates(store, branchId, municipalityId),
    zoneKeyOf(zoneLabel) ?? '',
  );
  if (!match)
    return { enabled, coverageStatus: 'UNAVAILABLE', ...none, reason: 'NO_ZONE_COVERAGE' };
  return {
    enabled,
    coverageStatus: 'AVAILABLE',
    deliveryZoneId: match.zone.id,
    baseFee: match.zone.baseFee,
    currency: 'GTQ',
    matchedBy: match.matchedBy,
  };
}

export function evaluatePedidosYa(store: MockStore, branchId: string): PedidosYaCoverage {
  const { pedidosyaEnabled: enabled } = settingsOf(store, branchId);
  const integrationStatus = pedidosyaIntegration(store);
  const base = { enabled, integrationStatus, quoteStatus: 'NOT_AVAILABLE' } as const;
  if (!enabled) return { ...base, coverageStatus: 'UNKNOWN', reason: 'PROVIDER_DISABLED' };
  if (store.pedidosyaCoverage === 'available') return { ...base, coverageStatus: 'AVAILABLE' };
  if (store.pedidosyaCoverage === 'unavailable') return { ...base, coverageStatus: 'UNAVAILABLE' };
  return { ...base, coverageStatus: 'UNKNOWN', reason: 'INTEGRATION_NOT_CONFIGURED' };
}

/** Elegibilidad derivada (D20). */
export function deriveEligibility(
  pedidosya: PedidosYaCoverage,
  own: DeliveryCoverageCheckResponse['providers']['OWN'],
): DeliveryCoverageCheckResponse['eligibility'] {
  const confirmedProviders: ('PEDIDOSYA' | 'OWN')[] = [];
  const pendingProviders: ('PEDIDOSYA' | 'OWN')[] = [];
  if (pedidosya.enabled && pedidosya.coverageStatus === 'AVAILABLE') {
    confirmedProviders.push('PEDIDOSYA');
  }
  if (own.enabled && own.coverageStatus === 'AVAILABLE') confirmedProviders.push('OWN');
  if (pedidosya.enabled && pedidosya.coverageStatus === 'UNKNOWN')
    pendingProviders.push('PEDIDOSYA');
  return {
    status: confirmedProviders.length ? 'CONFIRMED' : pendingProviders.length ? 'PENDING' : 'NONE',
    confirmedProviders,
    pendingProviders,
    simulated: pedidosya.enabled && pedidosya.integrationStatus === 'MOCK',
  };
}

export function checkCoverage(
  store: MockStore,
  input: { branchId: string; municipalityId: string; zone: string | null },
  at: Date,
): DeliveryCoverageCheckResponse {
  const own = evaluateOwn(store, input.branchId, input.municipalityId, input.zone);
  const pedidosya = evaluatePedidosYa(store, input.branchId);
  return {
    branchId: input.branchId,
    municipalityId: input.municipalityId,
    zone: input.zone,
    checkedAt: at.toISOString(),
    providers: { PEDIDOSYA: pedidosya, OWN: own },
    eligibility: deriveEligibility(pedidosya, own),
  };
}

const cents = (amount: string) => {
  const [whole = '0', frac = ''] = amount.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
};
export const compareMoney = (a: string, b: string) => cents(a) - cents(b);

/**
 * Entrega PROPIA para crear un pedido de demostración (`POST /v1/orders`, mock): la tarifa sale de la zona (`baseFee`) y
 * se congela en el pedido. Con `branchId` se evalúa esa sucursal; sin él, la más barata con cobertura propia confirmada.
 * Un pedido real lo recalculará F19/F20 con `DeliveryCoverageService` en el servidor.
 */
export function resolveOwnDelivery(
  store: MockStore,
  address: { department: string; municipality: string; zone: string },
  branchId: string | null,
): { branchId: string; fee: number } | null {
  const municipality = municipalityByName(address.department, address.municipality);
  if (!municipality) return null;
  const zone = coverageZoneOf(address.zone);
  const ids = branchId ? [branchId] : store.branches.filter((b) => b.active).map((b) => b.id);
  let best: { branchId: string; fee: string } | null = null;
  for (const id of ids) {
    const branch = store.branches.find((b) => b.id === id);
    if (!branch?.active) continue;
    const own = evaluateOwn(store, id, municipality.id, zone);
    if (own.coverageStatus !== 'AVAILABLE' || own.baseFee === null) continue;
    if (!best || compareMoney(own.baseFee, best.fee) < 0) best = { branchId: id, fee: own.baseFee };
  }
  return best ? { branchId: best.branchId, fee: Number(best.fee) } : null;
}
