import { NotFoundException } from '@nestjs/common';
import type { Principal } from '../../src/auth/auth.types.js';
import { BranchOffersService } from '../../src/branch-products/branch-offers.service.js';
import type { BranchProductsRepository } from '../../src/branch-products/branch-products.repository.js';
import type { BranchAvailabilityPort } from '../../src/branch-schedule/branch-availability.port.js';
import { CheckoutQuoteService } from '../../src/checkout/checkout-quote.service.js';
import { checkoutBusy } from '../../src/checkout/checkout-errors.js';
import type { CheckoutQuoteRequestDto } from '../../src/checkout/dto/checkout-quote-request.dto.js';
import { DbGate } from '../../src/common/concurrency/db-gate.js';
import type { CustomerAddressesService } from '../../src/customers/addresses/customer-addresses.service.js';
import type { CustomerAddressDto } from '../../src/customers/addresses/dto/customer-address.dto.js';
import type { DeliveryCoverageResult } from '../../src/delivery-coverage/coverage.types.js';
import type { LocationsService } from '../../src/locations/locations.service.js';
import { ModifierSelectionService } from '../../src/modifiers/modifier-selection.service.js';
import type { ModifiersRepository } from '../../src/modifiers/modifiers.repository.js';
import { FakeModifiersRepo, groupRow, mid, optionRow } from './fake-modifiers-repo.js';
import {
  A,
  B,
  C,
  HIDDEN,
  INACTIVE,
  local,
  MISSING_PRODUCT,
  NOW,
  P1,
  P2,
  P3,
  promotionsHarness,
} from './promotions-harness.js';

export {
  A,
  B,
  C,
  HIDDEN,
  INACTIVE,
  local,
  MISSING_PRODUCT,
  NOW,
  P1,
  P2,
  P3,
  groupRow,
  mid,
  optionRow,
};

export const MUNI_GUATEMALA = '00000000-0000-4000-8000-00000000c001'; // ciudad de Guatemala
export const MUNI_MIXCO = '00000000-0000-4000-8000-00000000c002';
export const MUNI_MISSING = '00000000-0000-4000-8000-00000000c0ff';
export const ADDR_OWN = '00000000-0000-4000-8000-00000000d001';
export const ADDR_OTHER = '00000000-0000-4000-8000-00000000d002';
export const ADDR_MISSING = '00000000-0000-4000-8000-00000000d0ff';
export const ZONA_ID = '00000000-0000-4000-8000-00000000e001';

export const principal = (authUserId = 'user-1'): Principal => ({
  authUserId,
  email: 'cliente@example.com',
  provider: 'google',
  googleOAuth: true,
  aal: 'aal1',
  displayName: null,
  avatarUrl: null,
});

/** Resultado de F09 con los dos proveedores; por defecto OWN apagado y PedidosYa `UNKNOWN` (`BLOCKED_EXTERNAL`). */
export function coverageResult(
  over: {
    own?: Partial<DeliveryCoverageResult['providers']['OWN']>;
    pedidosya?: Partial<DeliveryCoverageResult['providers']['PEDIDOSYA']>;
  } = {},
): DeliveryCoverageResult {
  return {
    branchId: A,
    municipalityId: MUNI_GUATEMALA,
    zone: 'Zona 10',
    checkedAt: NOW.toISOString(),
    providers: {
      PEDIDOSYA: {
        enabled: true,
        coverageStatus: 'UNKNOWN',
        integrationStatus: 'BLOCKED_EXTERNAL',
        quoteStatus: 'NOT_AVAILABLE',
        reason: 'INTEGRATION_NOT_CONFIGURED',
        ...over.pedidosya,
      },
      OWN: {
        enabled: false,
        coverageStatus: 'UNAVAILABLE',
        deliveryZoneId: null,
        baseFee: null,
        currency: 'GTQ',
        matchedBy: null,
        reason: 'PROVIDER_DISABLED',
        ...over.own,
      },
    },
    eligibility: { status: 'NONE', confirmedProviders: [], pendingProviders: [], simulated: false },
  };
}

/** OWN encendido con zona activa y tarifa. */
export const ownZone = (baseFee = '15.00') =>
  ({
    enabled: true,
    coverageStatus: 'AVAILABLE',
    deliveryZoneId: ZONA_ID,
    baseFee,
    matchedBy: 'ZONE',
    reason: undefined,
  }) as const;

/**
 * Cotizador REAL (F19) sobre el mundo en memoria de F13/F15 (`promotionsHarness`), extras de F12 en memoria y dobles
 * mínimos para horario (F08), cobertura (F09), direcciones (F05) y municipios. Cuenta consultas para el presupuesto.
 */
export function checkoutHarness(opts: { secret?: string | undefined; gate?: DbGate } = {}) {
  const base = promotionsHarness();
  const { world, clock, candidates, evaluator } = base;
  // Productos extra para casos: agotado y con precio por sucursal.
  const visibleCalls = { n: 0 };
  const categories = {
    getVisibleIds: () => {
      visibleCalls.n += 1;
      return Promise.resolve(['00000000-0000-4000-8000-0000000000a2']);
    },
  } as unknown as ConstructorParameters<typeof BranchOffersService>[1];
  const offers = new BranchOffersService(world as unknown as BranchProductsRepository, categories);

  const modifiersRepo = new FakeModifiersRepo();
  for (const id of [...world.products.keys(), MISSING_PRODUCT]) {
    if (id !== MISSING_PRODUCT) modifiersRepo.seedProduct(id, []);
  }
  const modifiers = new ModifierSelectionService(modifiersRepo as unknown as ModifiersRepository);

  const state = {
    accepted: true,
    reason: 'OPEN' as 'OPEN' | 'OUTSIDE_BUSINESS_HOURS' | 'INACTIVE',
    nextOpensAt: null as Date | null,
  };
  const availability = {
    canAcceptOrderNow: vi.fn((branchId: string) => {
      const b = world.branches.get(branchId);
      if (!b) return Promise.reject(new NotFoundException('Sucursal no encontrada'));
      if (!b.active) {
        return Promise.resolve({ accepted: false, reason: 'INACTIVE' as const, nextOpensAt: null });
      }
      return Promise.resolve({ ...state });
    }),
  };

  const cover = { result: coverageResult(), fail: null as unknown };
  const coverage = {
    check: vi.fn(() =>
      cover.fail ? Promise.reject(cover.fail as Error) : Promise.resolve(cover.result),
    ),
  };

  const ownerOf = new Map<string, string>([
    [ADDR_OWN, 'user-1'],
    [ADDR_OTHER, 'user-2'],
  ]);
  const addressRow = (zone: string | null, municipality = MUNI_GUATEMALA, name = 'Guatemala') =>
    ({
      id: ADDR_OWN,
      label: 'Casa',
      department: { id: 'dep', name: 'Guatemala' },
      municipality: { id: municipality, name },
      zone,
      addressLine: 'Calle 1',
      referenceNote: null,
      latitude: null,
      longitude: null,
      isDefault: true,
      createdAt: NOW.toISOString(),
    }) as CustomerAddressDto;
  const addressesState = { dto: addressRow('Zona 10') };
  const addresses = {
    get: vi.fn((p: Principal, id: string) => {
      if (ownerOf.get(id) !== p.authUserId)
        return Promise.reject(new NotFoundException('Dirección no encontrada'));
      return Promise.resolve({ ...addressesState.dto, id });
    }),
  };

  const municipalities = new Map([
    [MUNI_GUATEMALA, { id: MUNI_GUATEMALA, name: 'Guatemala', departmentName: 'Guatemala' }],
    [MUNI_MIXCO, { id: MUNI_MIXCO, name: 'Mixco', departmentName: 'Guatemala' }],
  ]);
  const locations = {
    findMunicipality: vi.fn((id: string) => Promise.resolve(municipalities.get(id) ?? null)),
  };

  const gate = opts.gate ?? new DbGate(2, 8, 1_500, checkoutBusy);
  const service = new CheckoutQuoteService(
    offers,
    modifiers,
    candidates,
    evaluator,
    availability as unknown as BranchAvailabilityPort,
    coverage,
    addresses as unknown as CustomerAddressesService,
    locations as unknown as LocationsService,
    clock,
    gate,
    opts.secret,
  );

  const body = (over: Partial<CheckoutQuoteRequestDto> = {}): CheckoutQuoteRequestDto => ({
    cart: { branchId: A, lines: [{ productId: P1, quantity: 2, selections: [] }] },
    fulfillment: { type: 'PICKUP' },
    ...over,
  });

  return {
    ...base,
    offers,
    modifiers,
    modifiersRepo,
    availability,
    state,
    cover,
    coverage,
    addresses,
    ownerOf,
    addressesState,
    addressRow,
    locations,
    visibleCalls,
    gate,
    service,
    body,
    /** Consultas lógicas de la última cotización (sin contar dobles de cobertura/direcciones). */
    queryCount: () =>
      world.count('resolveMany') +
      visibleCalls.n +
      modifiersRepo.calls.length +
      base.repo.calls.filter((c) => c === 'findCandidates').length +
      availability.canAcceptOrderNow.mock.calls.length,
  };
}
