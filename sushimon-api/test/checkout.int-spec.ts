import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { TestContext } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import { AuthorizationService } from '../src/auth/authorization.service.js';
import type { Principal } from '../src/auth/auth.types.js';
import { AdminBranchProductsService } from '../src/branch-products/admin-branch-products.service.js';
import { BranchOffersService } from '../src/branch-products/branch-offers.service.js';
import { BranchProductsRepository } from '../src/branch-products/branch-products.repository.js';
import { BranchAvailabilityService } from '../src/branch-schedule/branch-availability.service.js';
import type { BranchAvailabilityPort } from '../src/branch-schedule/branch-availability.port.js';
import { BranchScheduleRepository } from '../src/branch-schedule/branch-schedule.repository.js';
import { SystemClock } from '../src/branch-schedule/clock.js';
import { BranchesQueryService } from '../src/branches/branches-query.service.js';
import { BranchesRepository } from '../src/branches/branches.repository.js';
import { AdminCategoriesService } from '../src/categories/admin-categories.service.js';
import { CategoriesQueryService } from '../src/categories/categories-query.service.js';
import { CategoriesRepository } from '../src/categories/categories.repository.js';
import { checkoutBusy } from '../src/checkout/checkout-errors.js';
import { CheckoutQuoteService } from '../src/checkout/checkout-quote.service.js';
import type { CheckoutQuoteRequestDto } from '../src/checkout/dto/checkout-quote-request.dto.js';
import { DbGate } from '../src/common/concurrency/db-gate.js';
import { validateEnv, type Env } from '../src/config/env.js';
import { CustomerAddressesService } from '../src/customers/addresses/customer-addresses.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { DeliveryCoverageRepository } from '../src/delivery-coverage/delivery-coverage.repository.js';
import { DeliveryCoverageService } from '../src/delivery-coverage/delivery-coverage.service.js';
import { DeliveryZonesService } from '../src/delivery-coverage/delivery-zones.service.js';
import { MockPedidosYaCoverageAdapter } from '../src/delivery-coverage/mock-pedidosya-coverage.adapter.js';
import { OwnDeliveryCoverageService } from '../src/delivery-coverage/own-delivery-coverage.service.js';
import { UnavailableIntegrationAdapter } from '../src/delivery-coverage/unavailable-integration.adapter.js';
import { IdentityService } from '../src/identity/identity.service.js';
import { LocationsRepository } from '../src/locations/locations.repository.js';
import { LocationsService } from '../src/locations/locations.service.js';
import { ModifierSelectionService } from '../src/modifiers/modifier-selection.service.js';
import { ModifiersRepository } from '../src/modifiers/modifiers.repository.js';
import { PromotionCandidatesService } from '../src/promotions/promotion-candidates.service.js';
import { PromotionEvaluator } from '../src/promotions/promotion-evaluator.js';
import { PromotionsRepository } from '../src/promotions/promotions.repository.js';
import { cleanupTestData, ensureAuthStub, TEST_URL, withClient } from './support/db.js';
import { globalStaff } from './support/staff-context.js';

const url = TEST_URL;
const TZ = 'America/Guatemala';

/**
 * F19 (cotización de checkout) contra PostgreSQL REAL, mismo patrón que `store.int-spec.ts`. Se omite (con aviso) sin
 * DATABASE_URL_TEST o si faltan tablas de F09/F11/F12/F13/F15 (migraciones 0007/0012/0013/0014/0016). F19 NO tiene
 * migración y NO escribe: todo lo que se siembra son datos de la propia prueba (sucursales, productos, categorías,
 * zonas, grupos, promociones y un cliente de prueba) que se limpian al final. NO se ejecuta contra el Supabase
 * compartido: usar una BD desechable o el proyecto de pruebas. Mientras no corra, el SQL nuevo (`findOffersMany`,
 * `findMunicipality`, `inspect` sobre PostgreSQL real) NO está probado.
 */
const ready = url
  ? await withClient(url, async (c) => {
      const res = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM unnest(ARRAY['app.products','app.branch_products','app.modifiers','app.promotions','app.delivery_zones','app.customer_addresses','app.municipalities']) t
          WHERE to_regclass(t) IS NOT NULL`,
      );
      return (res.rows[0]?.n ?? 0) === 7;
    }).catch(() => false)
  : false;
if (url && !ready) {
  console.warn(
    '[checkout.int-spec] OMITIDA: faltan tablas de F05/F09/F11-F15 en DATABASE_URL_TEST. El SQL de F19 NO se probó contra PostgreSQL real.',
  );
}

describe.skipIf(!url || !ready)('Cotización de checkout contra PostgreSQL real', () => {
  const run = randomUUID().slice(0, 8);
  const staff = globalStaff(
    [
      'catalog.read',
      'catalog.create',
      'catalog.update',
      'catalog.manage_availability',
      'branches.read',
      'branches.manage_delivery_zones',
    ],
    { staffId: randomUUID() },
  );
  let prisma: PrismaService;
  let categories: AdminCategoriesService;
  let branchAdmin: AdminBranchProductsService;
  let zones: DeliveryZonesService;
  let addresses: CustomerAddressesService;
  let identity: IdentityService;
  let offers: BranchOffersService;
  let modifiers: ModifierSelectionService;
  let open: CheckoutQuoteService;
  let real: CheckoutQuoteService;
  let withMock: CheckoutQuoteService;
  let mixco = '';
  let city = '';
  const branchIds = new Set<string>();
  const productIds = new Set<string>();
  const categoryIds = new Set<string>();
  const promotionIds = new Set<string>();
  const groupIds = new Set<string>();
  const authUserIds = new Set<string>();
  const queries = { n: 0 };
  let originalQuery: typeof pg.Client.prototype.query;

  const skipUnlessReady = (ctx: TestContext) => {
    if (!ready) ctx.skip('faltan tablas de F05/F09/F11-F15');
  };
  const code = (e: unknown) => (e as { response?: { code?: string } }).response?.code;
  const failure = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: unknown) => e,
    );
  const measure = async <T>(fn: () => Promise<T>) => {
    queries.n = 0;
    const result = await fn();
    return { result, n: queries.n };
  };

  /**
   * ADR-0036: toda cotización es a domicilio. Por defecto una sucursal activa nace con OWN encendido y la zona propia
   * `Zona 10` de la ciudad con tarifa 0.00 (el `body()` por defecto cotiza ahí); `ownZone = false` la deja sin cobertura.
   */
  const newBranch = async (active = true, ownZone = active) => {
    const b = await prisma.branch.create({
      data: {
        code: `ck-${run}-${randomUUID().slice(0, 6)}`,
        name: `Suc ${run}`,
        address: 'Zona 1',
        active,
      },
    });
    branchIds.add(b.id);
    if (ownZone) {
      await prisma.branchDeliverySettings.upsert({
        where: { branchId: b.id },
        create: { branchId: b.id, ownDeliveryZonesEnabled: true },
        update: { ownDeliveryZonesEnabled: true },
      });
      await zones.create(staff, {
        branchId: b.id,
        municipalityId: city,
        zoneLabel: 'Zona 10',
        baseFee: '0',
      });
    }
    return b.id;
  };
  const newCategory = async (name: string, active = true) => {
    const c = await categories.create(staff, { name: `${name} ${run}`, parentId: null, active });
    categoryIds.add(c.id);
    return c;
  };
  const newProduct = async (categoryId: string, basePrice: string, active = true) => {
    const p = await prisma.product.create({
      data: {
        categoryId,
        slug: `ck-${run}-${randomUUID().slice(0, 6)}`,
        name: `Prod ${run} ${randomUUID().slice(0, 4)}`,
        basePrice,
        active,
      },
      select: { id: true },
    });
    productIds.add(p.id);
    return p.id;
  };
  /** Grupo con opciones `[nombre, precio, activa]` ligado al producto. */
  const newGroup = async (
    productId: string,
    over: { min: number; max: number },
    options: [string, string, boolean][],
  ) => {
    const g = await prisma.modifierGroup.create({
      data: {
        name: `G ${run} ${randomUUID().slice(0, 4)}`,
        minSelect: over.min,
        maxSelect: over.max,
      },
    });
    groupIds.add(g.id);
    const ids: string[] = [];
    for (const [i, [name, extraPrice, active]] of options.entries()) {
      const m = await prisma.modifier.create({
        data: { groupId: g.id, name: `${name} ${run}`, extraPrice, active, sortOrder: i },
      });
      ids.push(m.id);
    }
    await prisma.productModifierGroup.create({ data: { productId, groupId: g.id, sortOrder: 0 } });
    return { groupId: g.id, optionIds: ids };
  };
  const body = (over: Partial<CheckoutQuoteRequestDto> & { branchId: string; lines?: unknown[] }) =>
    ({
      cart: { branchId: over.branchId, lines: over.lines },
      fulfillment: over.fulfillment ?? { type: 'DELIVERY', municipalityId: city, zone: 'Zona 10' },
      ...(over.couponCode ? { couponCode: over.couponCode } : {}),
    }) as CheckoutQuoteRequestDto;
  const line = (productId: string, quantity = 1, selections: unknown[] = []) => ({
    productId,
    quantity,
    selections,
  });
  const newCustomer = async (): Promise<Principal> => {
    const p: Principal = {
      authUserId: randomUUID(),
      email: `${randomUUID().slice(0, 8)}@sushimon.test`,
      provider: 'google',
      googleOAuth: true,
      aal: 'aal1',
      displayName: 'Cliente F19',
      avatarUrl: null,
    };
    authUserIds.add(p.authUserId);
    await withClient(url as string, (c) =>
      c.query('INSERT INTO auth.users (id) VALUES ($1)', [p.authUserId]),
    );
    return p;
  };

  beforeAll(async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    originalQuery = pg.Client.prototype.query;
    vi.spyOn(pg.Client.prototype, 'query').mockImplementation(function (
      this: pg.Client,
      ...args: unknown[]
    ) {
      queries.n += 1;
      return (originalQuery as (...a: unknown[]) => unknown).apply(this, args);
    });
    await withClient(url as string, ensureAuthStub);
    prisma = new PrismaService(
      new ConfigService<Env, true>(
        validateEnv({ DATABASE_URL: url, DB_POOL_MAX: '8', NODE_ENV: 'test' }),
      ),
    );
    const authorization = new AuthorizationService({} as IdentityService);
    const audit = new AuditService();
    const catRepo = new CategoriesRepository(prisma);
    const catQuery = new CategoriesQueryService(catRepo);
    const bpRepo = new BranchProductsRepository(prisma);
    categories = new AdminCategoriesService(catRepo, audit, authorization);
    branchAdmin = new AdminBranchProductsService(bpRepo, audit, authorization, catQuery);
    const branches = new BranchesQueryService(new BranchesRepository(prisma), authorization);
    const coverageRepo = new DeliveryCoverageRepository(prisma);
    zones = new DeliveryZonesService(coverageRepo, branches, authorization, audit);
    identity = new IdentityService(prisma, audit);
    addresses = new CustomerAddressesService(prisma, identity, audit);
    offers = new BranchOffersService(bpRepo, catQuery);
    modifiers = new ModifierSelectionService(new ModifiersRepository(prisma));
    const candidates = new PromotionCandidatesService(new PromotionsRepository(prisma));
    const evaluator = new PromotionEvaluator(TZ);
    const clock = new SystemClock();
    const locations = new LocationsService(new LocationsRepository(prisma));
    const openPort: BranchAvailabilityPort = {
      canAcceptOrderNow: () =>
        Promise.resolve({ accepted: true, reason: 'OPEN', nextOpensAt: null }),
    } as unknown as BranchAvailabilityPort;
    const realPort = new BranchAvailabilityService(new BranchScheduleRepository(prisma), clock, TZ);
    const own = new OwnDeliveryCoverageService(coverageRepo);
    const blocked = new DeliveryCoverageService(
      coverageRepo,
      own,
      new UnavailableIntegrationAdapter(),
      3000,
    );
    const mocked = new DeliveryCoverageService(
      coverageRepo,
      own,
      new MockPedidosYaCoverageAdapter('available'),
      3000,
    );
    const build = (port: BranchAvailabilityPort, coverage: DeliveryCoverageService) =>
      new CheckoutQuoteService(
        offers,
        modifiers,
        candidates,
        evaluator,
        port,
        coverage,
        addresses,
        locations,
        clock,
        new DbGate(2, 8, 1_500, checkoutBusy),
        'q'.repeat(40),
      );
    open = build(openPort, blocked);
    real = build(realPort, blocked);
    withMock = build(openPort, mocked);
    mixco = (await prisma.municipality.findFirstOrThrow({ where: { name: 'Mixco' } })).id;
    city = (
      await prisma.municipality.findFirstOrThrow({
        where: { name: 'Guatemala', department: { name: 'Guatemala' } },
      })
    ).id;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (!prisma) return;
    if (promotionIds.size > 0) {
      await prisma.promotion.deleteMany({ where: { id: { in: [...promotionIds] } } });
    }
    await prisma.$disconnect();
    if (ready && url) {
      await withClient(url, async (c) => {
        await c.query(
          'DELETE FROM app.product_modifier_groups WHERE product_id = ANY($1::uuid[])',
          [[...productIds]],
        );
        await c.query('DELETE FROM app.modifiers WHERE group_id = ANY($1::uuid[])', [
          [...groupIds],
        ]);
        await c.query('DELETE FROM app.modifier_groups WHERE id = ANY($1::uuid[])', [
          [...groupIds],
        ]);
      });
      await cleanupTestData(url, { authUserIds, branchIds, productIds, categoryIds });
    }
  });

  it('fila 4: precio efectivo por sucursal (override vs base) y agotado por sucursal, con SQL real', async (ctx) => {
    skipUnlessReady(ctx);
    const [a, b] = [await newBranch(), await newBranch()];
    const cat = await newCategory('Precios');
    const p = await newProduct(cat.id, '50.00');
    await branchAdmin.setPricing(staff, a, p, { priceOverride: '45.50' });
    await branchAdmin.setAvailability(staff, p, { branchId: b, available: false });
    const qa = await open.quote(undefined, body({ branchId: a, lines: [line(p, 2)] }));
    expect(qa.lines[0]).toMatchObject({ status: 'OK', unitPrice: '45.50', lineTotal: '91.00' });
    expect(qa.total).toBe('91.00');
    const qb = await open.quote(undefined, body({ branchId: b, lines: [line(p, 1)] }));
    expect(qb.lines[0]?.status).toBe('UNAVAILABLE');
    expect(qb.total).toBeNull();
    expect(JSON.stringify(qa)).not.toContain('50.00');
  });

  it('fila 28: inspect devuelve OK/HIDDEN/SOLD_OUT/UNKNOWN en UNA pasada (2 consultas)', async (ctx) => {
    skipUnlessReady(ctx);
    const branch = await newBranch();
    const visible = await newCategory('Visible');
    const off = await newCategory('Apagada', false);
    const ok = await newProduct(visible.id, '10.00');
    const inactive = await newProduct(visible.id, '10.00', false);
    const hidden = await newProduct(off.id, '10.00');
    const soldOut = await newProduct(visible.id, '10.00');
    await branchAdmin.setAvailability(staff, soldOut, { branchId: branch, available: false });
    const missing = randomUUID();
    const { result: map, n } = await measure(() =>
      offers.inspect(branch, [ok, inactive, hidden, soldOut, missing, ok]),
    );
    expect(n).toBeLessThanOrEqual(2);
    expect(map.get(ok)).toEqual({ state: 'OK', price: '10.00' });
    expect(map.get(inactive)?.state).toBe('HIDDEN');
    expect(map.get(hidden)?.state).toBe('HIDDEN');
    expect(map.get(soldOut)?.state).toBe('SOLD_OUT');
    expect(map.get(missing)).toEqual({ state: 'UNKNOWN', price: null });
    // Coherente con assertOrderable (misma consulta y misma visibilidad).
    for (const id of [ok, inactive, hidden, soldOut]) {
      const state = map.get(id)?.state;
      expect(state === 'OK').toBe((await failure(offers.assertOrderable(branch, [id]))) === null);
    }
  });

  it('fila 28: extras por lote con ANY(uuid[]) (una consulta) y mismas reglas que validate()', async (ctx) => {
    skipUnlessReady(ctx);
    const cat = await newCategory('Extras');
    const [p1, p2, p3] = [
      await newProduct(cat.id, '40.00'),
      await newProduct(cat.id, '30.00'),
      await newProduct(cat.id, '20.00'),
    ];
    const g1 = await newGroup(p1, { min: 1, max: 2 }, [
      ['Soya', '1.50', true],
      ['Picante', '0.10', true],
      ['Vieja', '9.00', false],
    ]);
    const g2 = await newGroup(p2, { min: 0, max: 1 }, [['Queso', '2.00', true]]);
    const batch = [
      {
        productId: p1,
        selections: [
          {
            groupId: g1.groupId,
            modifierIds: [g1.optionIds[0] as string, g1.optionIds[1] as string],
          },
        ],
      },
      { productId: p1, selections: [] },
      {
        productId: p1,
        selections: [{ groupId: g1.groupId, modifierIds: [g1.optionIds[2] as string] }],
      },
      {
        productId: p2,
        selections: [{ groupId: g2.groupId, modifierIds: [g2.optionIds[0] as string] }],
      },
      { productId: p3, selections: [] },
      {
        productId: p3,
        selections: [{ groupId: g1.groupId, modifierIds: [g1.optionIds[0] as string] }],
      },
      { productId: randomUUID(), selections: [] },
    ];
    const { result, n } = await measure(() => modifiers.validateMany(batch));
    expect(n).toBe(1);
    expect(result[0]).toMatchObject({ status: 'OK', extraTotal: '1.60' });
    expect(result[1]).toMatchObject({ status: 'INVALID' });
    expect(result[2]).toMatchObject({ status: 'INVALID' });
    expect(result[3]).toMatchObject({ status: 'OK', extraTotal: '2.00' });
    expect(result[4]).toMatchObject({ status: 'OK', extraTotal: '0.00' });
    expect(result[5]).toMatchObject({ status: 'INVALID' });
    expect(result[6]).toEqual({ status: 'NOT_FOUND' });
    for (const [i, item] of batch.slice(0, 6).entries()) {
      const single = await modifiers.validate(item.productId, item.selections).then(
        (r) => r.extraTotal,
        () => null,
      );
      const many = result[i];
      expect(many?.status === 'OK' ? many.extraTotal : null).toBe(single);
    }
    // Y la cotización completa: extras por unidad × cantidad.
    const branch = await newBranch();
    const q = await open.quote(
      undefined,
      body({
        branchId: branch,
        lines: [line(p1, 3, [{ groupId: g1.groupId, optionId: g1.optionIds[0], quantity: 1 }])],
      }),
    );
    expect(q.lines[0]).toMatchObject({
      status: 'OK',
      extrasPerUnit: '1.50',
      lineSubtotal: '124.50',
    });
    const bad = await open.quote(
      undefined,
      body({
        branchId: branch,
        lines: [line(p1, 1, [{ groupId: g1.groupId, optionId: g1.optionIds[2], quantity: 1 }])],
      }),
    );
    expect(bad.lines[0]?.status).toBe('OPTION_UNAVAILABLE');
  });

  it('fila 9: OWN con flag apagado (defecto), encendido sin zona, general vs específica, zona inactiva y tarifa exacta', async (ctx) => {
    skipUnlessReady(ctx);
    const branch = await newBranch(true, false);
    const cat = await newCategory('Zonas');
    const p = await newProduct(cat.id, '100.00');
    const delivery = (zone: string | null) =>
      body({
        branchId: branch,
        lines: [line(p)],
        fulfillment: {
          type: 'DELIVERY',
          municipalityId: mixco,
          ...(zone ? { zone } : {}),
        } as never,
      });

    const off = await open.quote(undefined, delivery(null));
    expect(off.blockers).toEqual([{ code: 'DELIVERY_UNVERIFIED', scope: 'FULFILLMENT' }]);
    expect(off.fulfillment.delivery?.options.find((o) => o.provider === 'OWN')).toMatchObject({
      enabled: false,
      selectable: false,
      unavailableReason: 'PROVIDER_DISABLED',
    });
    expect(off.total).toBeNull();

    await prisma.branchDeliverySettings.upsert({
      where: { branchId: branch },
      create: { branchId: branch, ownDeliveryZonesEnabled: true },
      update: { ownDeliveryZonesEnabled: true },
    });
    const noZone = await open.quote(undefined, delivery(null));
    expect(noZone.fulfillment.delivery?.options.find((o) => o.provider === 'OWN')).toMatchObject({
      coverageStatus: 'UNAVAILABLE',
      unavailableReason: 'NO_ZONE_COVERAGE',
    });
    expect(noZone.canProceed).toBe(false);

    const general = await zones.create(staff, {
      branchId: branch,
      municipalityId: mixco,
      zoneLabel: null,
      baseFee: '12.5',
    });
    const specific = await zones.create(staff, {
      branchId: branch,
      municipalityId: mixco,
      zoneLabel: 'Zona 4',
      baseFee: '20',
    });
    const g = await open.quote(undefined, delivery(null));
    expect(g).toMatchObject({ deliveryFee: '12.50', total: '112.50', canProceed: true });
    expect(g.fulfillment.delivery?.selectedProvider).toBe('OWN');
    const s = await open.quote(undefined, delivery('Zona 4'));
    expect(s).toMatchObject({ deliveryFee: '20.00', total: '120.00' });
    const other = await open.quote(undefined, delivery('Zona 7'));
    expect(other.deliveryFee).toBe('12.50'); // sin zona específica cae a la cobertura general

    await prisma.deliveryZone.update({ where: { id: specific.id }, data: { active: false } });
    const inactive = await open.quote(undefined, delivery('Zona 4'));
    expect(inactive.deliveryFee).toBe('12.50'); // la inactiva no existe para la cobertura
    await prisma.deliveryZone.update({ where: { id: general.id }, data: { active: false } });
    const none = await open.quote(undefined, delivery('Zona 4'));
    expect(none.total).toBeNull();
  });

  it('fila 8 y 10: ciudad de Guatemala sin zona => ADDRESS_INCOMPLETE; PedidosYa simulado nunca habilita', async (ctx) => {
    skipUnlessReady(ctx);
    const branch = await newBranch(true, false);
    const cat = await newCategory('Ciudad');
    const p = await newProduct(cat.id, '10.00');
    await prisma.branchDeliverySettings.upsert({
      where: { branchId: branch },
      create: { branchId: branch, ownDeliveryZonesEnabled: false },
      update: { ownDeliveryZonesEnabled: false },
    });
    const incomplete = await open.quote(
      undefined,
      body({
        branchId: branch,
        lines: [line(p)],
        fulfillment: { type: 'DELIVERY', municipalityId: city } as never,
      }),
    );
    expect(incomplete.blockers).toEqual([{ code: 'ADDRESS_INCOMPLETE', scope: 'FULFILLMENT' }]);
    const mocked = await withMock.quote(
      undefined,
      body({
        branchId: branch,
        lines: [line(p)],
        fulfillment: { type: 'DELIVERY', municipalityId: city, zone: 'Zona 10' } as never,
      }),
    );
    const py = mocked.fulfillment.delivery?.options.find((o) => o.provider === 'PEDIDOSYA');
    expect(py).toMatchObject({
      coverageStatus: 'AVAILABLE',
      simulated: true,
      selectable: false,
      customerFee: null,
    });
    expect(mocked.canProceed).toBe(false);
    expect(mocked.total).toBeNull();
    expect(
      code(
        await failure(
          open.quote(
            undefined,
            body({
              branchId: branch,
              lines: [line(p)],
              fulfillment: { type: 'DELIVERY', municipalityId: randomUUID() } as never,
            }),
          ),
        ),
      ),
    ).toBe('MUNICIPALITY_NOT_FOUND');
  });

  it('fila 7: dirección guardada propia, ajena o inexistente (mismo 404), con el SQL real de F05', async (ctx) => {
    skipUnlessReady(ctx);
    const branch = await newBranch(true, false);
    const cat = await newCategory('Direcciones');
    const p = await newProduct(cat.id, '10.00');
    await prisma.branchDeliverySettings.upsert({
      where: { branchId: branch },
      create: { branchId: branch, ownDeliveryZonesEnabled: true },
      update: { ownDeliveryZonesEnabled: true },
    });
    await zones.create(staff, {
      branchId: branch,
      municipalityId: mixco,
      zoneLabel: null,
      baseFee: '18',
    });
    const [owner, intruder] = [await newCustomer(), await newCustomer()];
    const mine = await addresses.create(owner, {
      label: 'Casa',
      municipalityId: mixco,
      zone: null,
      addressLine: 'Calle 1 #2-3',
      referenceNote: null,
    });
    const delivery = (id: string) =>
      body({
        branchId: branch,
        lines: [line(p)],
        fulfillment: { type: 'DELIVERY', customerAddressId: id } as never,
      });
    const ok = await open.quote(owner, delivery(mine.id));
    expect(ok).toMatchObject({ deliveryFee: '18.00', total: '28.00', canProceed: true });
    const foreign = await failure(open.quote(intruder, delivery(mine.id)));
    const missing = await failure(open.quote(owner, delivery(randomUUID())));
    expect((foreign as { getStatus(): number }).getStatus()).toBe(404);
    expect((foreign as { getResponse(): unknown }).getResponse()).toEqual(
      (missing as { getResponse(): unknown }).getResponse(),
    );
    expect((await failure(open.quote(undefined, delivery(mine.id)))) as Error).toMatchObject({
      status: 401,
    });
  });

  it('fila 5: sucursal inexistente/inactiva => 422; sin horario configurado => BRANCH_CLOSED con el motor real de F08', async (ctx) => {
    skipUnlessReady(ctx);
    const cat = await newCategory('Horario');
    const p = await newProduct(cat.id, '10.00');
    expect(
      code(
        await failure(real.quote(undefined, body({ branchId: randomUUID(), lines: [line(p)] }))),
      ),
    ).toBe('BRANCH_NOT_AVAILABLE');
    expect(
      code(
        await failure(
          real.quote(undefined, body({ branchId: await newBranch(false), lines: [line(p)] })),
        ),
      ),
    ).toBe('BRANCH_NOT_AVAILABLE');
    const q = await real.quote(undefined, body({ branchId: await newBranch(), lines: [line(p)] }));
    expect(q.branch.isAcceptingOrders).toBe(false);
    expect(q.blockers).toEqual([{ code: 'BRANCH_CLOSED', scope: 'BRANCH' }]);
    expect(q.total).toBe('10.00');
  });

  it('filas 13 y 14: promoción por sucursal y cupón con SQL real; cupón desconocido == cupón de otra sucursal', async (ctx) => {
    skipUnlessReady(ctx);
    const [a, b] = [await newBranch(), await newBranch()];
    const cat = await newCategory('Promos');
    const p = await newProduct(cat.id, '100.00');
    const now = Date.now();
    const promo = await prisma.promotion.create({
      data: {
        name: `Auto ${run}`,
        kind: 'PERCENT',
        value: '10.00',
        startsAt: new Date(now - 3_600_000),
        endsAt: new Date(now + 3_600_000),
        branches: { create: [{ branchId: a }] },
      },
    });
    const coupon = await prisma.promotion.create({
      data: {
        code: `CK${run}`.toUpperCase(),
        name: `Cupón ${run}`,
        kind: 'FIXED_AMOUNT',
        value: '30.00',
        startsAt: new Date(now - 3_600_000),
        endsAt: new Date(now + 3_600_000),
        branches: { create: [{ branchId: b }] },
      },
    });
    promotionIds.add(promo.id);
    promotionIds.add(coupon.id);
    const qa = await open.quote(undefined, body({ branchId: a, lines: [line(p)] }));
    expect(qa).toMatchObject({ discountTotal: '10.00', total: '90.00', coupon: null });
    const qb = await open.quote(
      undefined,
      body({ branchId: b, lines: [line(p)], couponCode: coupon.code as string }),
    );
    expect(qb).toMatchObject({
      discountTotal: '30.00',
      total: '70.00',
      coupon: { status: 'APPLIED' },
    });
    const wrongBranch = await open.quote(
      undefined,
      body({ branchId: a, lines: [line(p)], couponCode: coupon.code as string }),
    );
    const unknown = await open.quote(
      undefined,
      body({ branchId: a, lines: [line(p)], couponCode: 'NOEXISTE' }),
    );
    expect(wrongBranch.coupon).toEqual({ status: 'NOT_APPLIED' });
    const stable = (q: typeof unknown) => JSON.stringify({ ...q, quote: null });
    expect(stable(wrongBranch)).toBe(stable(unknown));
  });

  it('fila 22: 30 líneas con extras, promoción y dirección no superan el presupuesto de consultas', async (ctx) => {
    skipUnlessReady(ctx);
    const branch = await newBranch(true, false);
    const cat = await newCategory('Presupuesto');
    const products = await Promise.all(
      Array.from({ length: 6 }, () => newProduct(cat.id, '25.00')),
    );
    const g = await newGroup(products[0] as string, { min: 0, max: 2 }, [
      ['A', '1.00', true],
      ['B', '2.00', true],
    ]);
    await prisma.branchDeliverySettings.upsert({
      where: { branchId: branch },
      create: { branchId: branch, ownDeliveryZonesEnabled: true },
      update: { ownDeliveryZonesEnabled: true },
    });
    await zones.create(staff, {
      branchId: branch,
      municipalityId: mixco,
      zoneLabel: null,
      baseFee: '15',
    });
    const owner = await newCustomer();
    const mine = await addresses.create(owner, {
      label: 'Casa',
      municipalityId: mixco,
      zone: null,
      addressLine: 'Calle 9',
      referenceNote: null,
    });
    const lines = Array.from({ length: 30 }, (_, i) =>
      line(
        products[i % 6] as string,
        1 + (i % 3),
        i % 6 === 0 ? [{ groupId: g.groupId, optionId: g.optionIds[0], quantity: 1 }] : [],
      ),
    );
    const input = body({
      branchId: branch,
      lines,
      couponCode: 'X',
      fulfillment: { type: 'DELIVERY', customerAddressId: mine.id } as never,
    });
    const { result, n } = await measure(() => open.quote(owner, input));
    expect(result.lines).toHaveLength(30);
    expect(result.canProceed).toBe(true);
    // presupuesto de la spec: horario(stub) 0 + ofertas 2 + extras 1 + candidatas 1 + dirección 2 + cobertura 2 = 8 (<= ~10)
    expect(n).toBeLessThanOrEqual(10);
  });
});
