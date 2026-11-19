import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { TestContext } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import { AuthorizationService } from '../src/auth/authorization.service.js';
import type { Principal } from '../src/auth/auth.types.js';
import { BranchOffersService } from '../src/branch-products/branch-offers.service.js';
import { BranchProductsRepository } from '../src/branch-products/branch-products.repository.js';
import type { BranchAvailabilityPort } from '../src/branch-schedule/branch-availability.port.js';
import { SystemClock } from '../src/branch-schedule/clock.js';
import { BranchesQueryService } from '../src/branches/branches-query.service.js';
import { BranchesRepository } from '../src/branches/branches.repository.js';
import { AdminCategoriesService } from '../src/categories/admin-categories.service.js';
import { CategoriesQueryService } from '../src/categories/categories-query.service.js';
import { CategoriesRepository } from '../src/categories/categories.repository.js';
import { checkoutBusy } from '../src/checkout/checkout-errors.js';
import { CheckoutQuoteService } from '../src/checkout/checkout-quote.service.js';
import type { CheckoutQuoteRequestDto } from '../src/checkout/dto/checkout-quote-request.dto.js';
import { QuoteTokenVerifier } from '../src/checkout/quote-token.verifier.js';
import { DbGate } from '../src/common/concurrency/db-gate.js';
import { validateEnv, type Env } from '../src/config/env.js';
import { CustomerAddressesService } from '../src/customers/addresses/customer-addresses.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { DeliveryCoverageRepository } from '../src/delivery-coverage/delivery-coverage.repository.js';
import { DeliveryCoverageService } from '../src/delivery-coverage/delivery-coverage.service.js';
import { DeliveryZonesService } from '../src/delivery-coverage/delivery-zones.service.js';
import { OwnDeliveryCoverageService } from '../src/delivery-coverage/own-delivery-coverage.service.js';
import { UnavailableIntegrationAdapter } from '../src/delivery-coverage/unavailable-integration.adapter.js';
import { IdentityService } from '../src/identity/identity.service.js';
import { LocationsRepository } from '../src/locations/locations.repository.js';
import { LocationsService } from '../src/locations/locations.service.js';
import { ModifierSelectionService } from '../src/modifiers/modifier-selection.service.js';
import { ModifiersRepository } from '../src/modifiers/modifiers.repository.js';
import { hashGuestToken } from '../src/orders/order-access-token.js';
import { keyHashOf } from '../src/orders/order-idempotency.js';
import { NoopOrderEventsPublisher } from '../src/orders/order-events.publisher.js';
import { OrderQuoteGuard } from '../src/orders/order-quote-guard.js';
import { OrderSnapshotReader } from '../src/orders/order-snapshot.reader.js';
import { ordersBusy } from '../src/orders/orders-errors.js';
import { OrdersRepository } from '../src/orders/orders.repository.js';
import { OrdersService } from '../src/orders/orders.service.js';
import type { NewOrder } from '../src/orders/orders.types.js';
import type { OrderCreateRequestDto } from '../src/orders/dto/order-create-request.dto.js';
import { PromotionCandidatesService } from '../src/promotions/promotion-candidates.service.js';
import { PromotionEvaluator } from '../src/promotions/promotion-evaluator.js';
import { PromotionsRepository } from '../src/promotions/promotions.repository.js';
import {
  cleanupTestData,
  ensureAuthStub,
  TEST_URL,
  withClient,
  deletePaymentsOf,
} from './support/db.js';
import { globalStaff } from './support/staff-context.js';

const url = TEST_URL;
const TZ = 'America/Guatemala';
const SECRET = 'q'.repeat(40);

/**
 * F20 (creación de pedidos, idempotencia y acceso de invitado) contra PostgreSQL REAL. Se omite (con aviso) sin
 * DATABASE_URL_TEST o si faltan las tablas de F05/F09/F11-F15 o las de 0018. NO se ejecuta contra el Supabase
 * compartido: usar una BD desechable o el proyecto de pruebas. Escribe pedidos reales (con sus hijas) y los limpia al
 * final con la excepción controlada `app.allow_order_cleanup` (0018) y `app.allow_audit_cleanup` (0004), SOLO sobre los
 * pedidos de las sucursales que crea la propia prueba. Mientras no corra, el SQL de F20 (reclamo de la clave con
 * `createMany skipDuplicates`, FK diferida, secuencia, triggers) NO está verificado.
 */
const ready = url
  ? await withClient(url, async (c) => {
      const res = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM unnest(ARRAY['app.products','app.branch_products','app.modifiers','app.promotions','app.delivery_zones','app.customer_addresses','app.municipalities','app.orders','app.order_items','app.order_idempotency_keys','app.order_access_tokens']) t
          WHERE to_regclass(t) IS NOT NULL`,
      );
      return (res.rows[0]?.n ?? 0) === 11;
    }).catch(() => false)
  : false;
if (url && !ready) {
  console.warn(
    '[orders.int-spec] OMITIDA: faltan tablas de F05/F09/F11-F15 o de la migración 0018 en DATABASE_URL_TEST. El SQL de F20 NO se probó contra PostgreSQL real.',
  );
}

describe.skipIf(!url || !ready)('Pedidos contra PostgreSQL real (F20)', () => {
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
  let zones: DeliveryZonesService;
  let quotes: CheckoutQuoteService;
  let repo: OrdersRepository;
  let orders: OrdersService;
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
    if (!ready) ctx.skip('faltan tablas de F05/F09/F11-F15 o 0018');
  };
  const code = (e: unknown) => (e as { response?: { code?: string } }).response?.code;
  const failure = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: unknown) => e,
    );
  const q = <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) =>
    withClient(url as string, (c) => c.query<T>(sql, params)).then((r) => r.rows);
  /** Teléfonos de Guatemala únicos por prueba (el tope de pendientes es por teléfono). */
  let phoneSeq = 0;
  const phone = () =>
    `5${String(Math.floor(Math.random() * 900) + 100)}${String(1000 + (phoneSeq += 1)).padStart(4, '0')}`;
  const key = () => randomUUID();

  const newBranch = async () => {
    const b = await prisma.branch.create({
      data: {
        code: `or-${run}-${randomUUID().slice(0, 6)}`,
        name: `Suc ${run}`,
        address: 'Zona 1',
      },
    });
    branchIds.add(b.id);
    return b.id;
  };
  const newCategory = async () => {
    const c = await categories.create(staff, {
      name: `Cat ${run} ${randomUUID().slice(0, 4)}`,
      parentId: null,
      active: true,
    });
    categoryIds.add(c.id);
    return c;
  };
  const newProduct = async (categoryId: string, basePrice: string) => {
    const p = await prisma.product.create({
      data: {
        categoryId,
        slug: `or-${run}-${randomUUID().slice(0, 6)}`,
        name: `Prod ${run} ${randomUUID().slice(0, 4)}`,
        basePrice,
      },
      select: { id: true, name: true },
    });
    productIds.add(p.id);
    return p;
  };
  const newGroup = async (productId: string, options: [string, string][]) => {
    const g = await prisma.modifierGroup.create({
      data: { name: `G ${run} ${randomUUID().slice(0, 4)}`, minSelect: 0, maxSelect: 2 },
    });
    groupIds.add(g.id);
    const ids: string[] = [];
    for (const [i, [name, extraPrice]] of options.entries()) {
      const m = await prisma.modifier.create({
        data: { groupId: g.id, name: `${name} ${run}`, extraPrice, sortOrder: i },
      });
      ids.push(m.id);
    }
    await prisma.productModifierGroup.create({ data: { productId, groupId: g.id, sortOrder: 0 } });
    return { groupId: g.id, optionIds: ids };
  };
  const newCustomer = async (): Promise<Principal> => {
    const p: Principal = {
      authUserId: randomUUID(),
      email: `${randomUUID().slice(0, 8)}@sushimon.test`,
      provider: 'google',
      googleOAuth: true,
      aal: 'aal1',
      displayName: 'Cliente F20',
      avatarUrl: null,
    };
    authUserIds.add(p.authUserId);
    await withClient(url as string, (c) =>
      c.query('INSERT INTO auth.users (id) VALUES ($1)', [p.authUserId]),
    );
    return p;
  };
  const line = (productId: string, quantity = 1, selections: unknown[] = []) => ({
    productId,
    quantity,
    selections,
  });
  const pickup = (
    branchId: string,
    lines: unknown[],
    couponCode?: string,
  ): CheckoutQuoteRequestDto =>
    ({
      cart: { branchId, lines },
      fulfillment: { type: 'PICKUP' },
      ...(couponCode ? { couponCode } : {}),
    }) as CheckoutQuoteRequestDto;
  /** Cotiza como el cliente y arma el cuerpo de `POST /v1/orders`. */
  const orderBody = async (
    base: CheckoutQuoteRequestDto,
    who?: Principal,
    over: Partial<OrderCreateRequestDto> = {},
  ): Promise<OrderCreateRequestDto> => {
    const quote = await quotes.quote(who, base);
    return {
      cart: base.cart,
      fulfillment: base.fulfillment,
      ...(base.couponCode ? { couponCode: base.couponCode } : {}),
      quoteToken: quote.quote.token as string,
      contact: { fullName: 'Ana Pérez', phone: phone() },
      ...over,
    };
  };
  const sql = {
    count: async (table: string, orderId: string) =>
      (
        await q<{ n: number }>(`SELECT count(*)::int AS n FROM app.${table} WHERE order_id = $1`, [
          orderId,
        ])
      )[0]?.n,
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
        validateEnv({ DATABASE_URL: url, DB_POOL_MAX: '12', NODE_ENV: 'test' }),
      ),
    );
    const authorization = new AuthorizationService({} as IdentityService);
    const audit = new AuditService();
    const catRepo = new CategoriesRepository(prisma);
    const catQuery = new CategoriesQueryService(catRepo);
    const bpRepo = new BranchProductsRepository(prisma);
    categories = new AdminCategoriesService(catRepo, audit, authorization);
    const branches = new BranchesQueryService(new BranchesRepository(prisma), authorization);
    const coverageRepo = new DeliveryCoverageRepository(prisma);
    zones = new DeliveryZonesService(coverageRepo, branches, authorization, audit);
    const identity = new IdentityService(prisma, audit);
    const addresses = new CustomerAddressesService(prisma, identity, audit);
    const offers = new BranchOffersService(bpRepo, catQuery);
    const modifiers = new ModifierSelectionService(new ModifiersRepository(prisma));
    const candidates = new PromotionCandidatesService(new PromotionsRepository(prisma));
    const evaluator = new PromotionEvaluator(TZ);
    const clock = new SystemClock();
    const locations = new LocationsService(new LocationsRepository(prisma));
    const openPort: BranchAvailabilityPort = {
      canAcceptOrderNow: () =>
        Promise.resolve({ accepted: true, reason: 'OPEN', nextOpensAt: null }),
    } as unknown as BranchAvailabilityPort;
    const own = new OwnDeliveryCoverageService(coverageRepo);
    const coverage = new DeliveryCoverageService(
      coverageRepo,
      own,
      new UnavailableIntegrationAdapter(),
      3000,
    );
    quotes = new CheckoutQuoteService(
      offers,
      modifiers,
      candidates,
      evaluator,
      openPort,
      coverage,
      addresses,
      locations,
      clock,
      new DbGate(4, 16, 5_000, checkoutBusy),
      SECRET,
    );
    const verifier = new QuoteTokenVerifier(SECRET);
    repo = new OrdersRepository(prisma, audit);
    orders = new OrdersService(
      identity,
      repo,
      new OrderSnapshotReader(prisma),
      new OrderQuoteGuard(verifier, quotes, clock),
      verifier,
      clock,
      new DbGate(10, 40, 10_000, ordersBusy),
      new NoopOrderEventsPublisher(),
    );
    city = (
      await prisma.municipality.findFirstOrThrow({
        where: { name: 'Guatemala', department: { name: 'Guatemala' } },
      })
    ).id;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (!prisma) return;
    if (ready && url) {
      // Los pedidos de la prueba primero (FK RESTRICT hacia sucursales, productos, extras y promociones).
      await withClient(url, async (c) => {
        const ids = (
          await c.query<{ id: string }>(
            'SELECT id FROM app.orders WHERE branch_id = ANY($1::uuid[])',
            [[...branchIds]],
          )
        ).rows.map((r) => r.id);
        await c.query('BEGIN');
        try {
          await c.query("SET LOCAL app.allow_order_cleanup = 'on'");
          await c.query("SET LOCAL app.allow_audit_cleanup = 'on'");
          await c.query('DELETE FROM app.order_idempotency_keys WHERE order_id = ANY($1::uuid[])', [
            ids,
          ]);
          for (const t of [
            'order_access_tokens',
            'order_status_history',
            'order_promotions',
            'order_addresses',
          ]) {
            await c.query(`DELETE FROM app.${t} WHERE order_id = ANY($1::uuid[])`, [ids]);
          }
          await c.query(
            'DELETE FROM app.order_item_modifiers WHERE order_item_id IN (SELECT id FROM app.order_items WHERE order_id = ANY($1::uuid[]))',
            [ids],
          );
          await c.query('DELETE FROM app.order_items WHERE order_id = ANY($1::uuid[])', [ids]);
          await deletePaymentsOf(c, ids); // F24 (0019): FK RESTRICT hacia orders
          await c.query('DELETE FROM app.orders WHERE id = ANY($1::uuid[])', [ids]);
          await c.query(
            "DELETE FROM app.audit_events WHERE entity_type = 'order' AND entity_id = ANY($1::uuid[])",
            [ids],
          );
          await c.query('COMMIT');
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        }
      });
      if (promotionIds.size > 0) {
        await prisma.promotion.deleteMany({ where: { id: { in: [...promotionIds] } } });
      }
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

  it('filas 1, 21, 22, 35: PICKUP persiste pedido, línea, historial NULL->pending, token (solo hash) y auditoría sin PII', async (ctx) => {
    skipUnlessReady(ctx);
    const branch = await newBranch();
    const product = await newProduct((await newCategory()).id, '50.00');
    const res = await orders.create(
      undefined,
      key(),
      await orderBody(pickup(branch, [line(product.id, 2)])),
    );
    expect(res.replayed).toBe(false);
    const id = res.body.order.id;
    const [row] = await q<{
      status: string;
      total: string;
      order_number: string;
      customer_id: string | null;
      delivery_provider: string | null;
    }>(
      'SELECT status, total::text, order_number::text, customer_id, delivery_provider FROM app.orders WHERE id = $1',
      [id],
    );
    expect(row).toMatchObject({
      status: 'pending',
      total: '100.00',
      customer_id: null,
      delivery_provider: null,
    });
    expect(Number(row?.order_number)).toBeGreaterThanOrEqual(1001);
    expect(await sql.count('order_items', id)).toBe(1);
    expect(await sql.count('order_addresses', id)).toBe(0);
    const history = await q<{ old_status: string | null; new_status: string }>(
      'SELECT old_status, new_status FROM app.order_status_history WHERE order_id = $1',
      [id],
    );
    expect(history).toEqual([{ old_status: null, new_status: 'pending' }]);
    const tokens = await q<{ token_hash: Buffer }>(
      'SELECT token_hash FROM app.order_access_tokens WHERE order_id = $1',
      [id],
    );
    const guestToken = res.body.access?.guestToken as string;
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.token_hash.equals(hashGuestToken(guestToken))).toBe(true);
    expect(tokens[0]?.token_hash.toString('utf8')).not.toContain(guestToken);
    const audits = await q<{ actor_id: string | null; new_values: unknown }>(
      "SELECT actor_id, new_values FROM app.audit_events WHERE entity_type = 'order' AND entity_id = $1 AND action = 'order.created'",
      [id],
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actor_id).toBeNull();
    expect(JSON.stringify(audits[0]?.new_values)).not.toMatch(/Ana|\+502|5\d{7}/);
    // Historial append-only e hijas inmutables.
    await expect(
      q('UPDATE app.order_status_history SET new_status = $2 WHERE order_id = $1', [
        id,
        'accepted',
      ]),
    ).rejects.toThrow();
    await expect(q('DELETE FROM app.order_items WHERE order_id = $1', [id])).rejects.toThrow();
    await expect(
      q('UPDATE app.order_items SET quantity = 9 WHERE order_id = $1', [id]),
    ).rejects.toThrow();
  });

  it('filas 2, 9, 10, 11, 21: OWN con zona, extras, promoción y snapshots inmutables ante cambios del catálogo', async (ctx) => {
    skipUnlessReady(ctx);
    const branch = await newBranch();
    const product = await newProduct((await newCategory()).id, '100.00');
    const group = await newGroup(product.id, [
      ['Aguacate', '5.00'],
      ['Queso', '2.50'],
    ]);
    await prisma.branchDeliverySettings.upsert({
      where: { branchId: branch },
      create: { branchId: branch, ownDeliveryZonesEnabled: true },
      update: { ownDeliveryZonesEnabled: true },
    });
    await zones.create(staff, {
      branchId: branch,
      municipalityId: city,
      zoneLabel: 'Zona 10',
      baseFee: '15',
    });
    const now = Date.now();
    const promo = await prisma.promotion.create({
      data: {
        name: `Auto ${run}`,
        kind: 'PERCENT',
        value: '10.00',
        startsAt: new Date(now - 3_600_000),
        endsAt: new Date(now + 3_600_000),
        branches: { create: [{ branchId: branch }] },
      },
    });
    promotionIds.add(promo.id);
    const base = {
      cart: {
        branchId: branch,
        lines: [
          line(product.id, 2, [
            { groupId: group.groupId, optionId: group.optionIds[0], quantity: 1 },
            { groupId: group.groupId, optionId: group.optionIds[1], quantity: 1 },
          ]),
        ],
      },
      fulfillment: {
        type: 'DELIVERY',
        municipalityId: city,
        zone: 'Zona 10',
        deliveryProvider: 'OWN',
      },
    } as CheckoutQuoteRequestDto;
    const res = await orders.create(
      undefined,
      key(),
      await orderBody(base, undefined, {
        deliveryAddress: { addressLine: '6a avenida 12-34', referenceNote: 'Portón' },
      }),
    );
    const id = res.body.order.id;
    // (100 + 7.50) x 2 = 215.00; descuento 10% sobre 200.00 = 20.00; + tarifa 15.00 = 210.00.
    expect(res.body.order).toMatchObject({
      subtotal: '215.00',
      extrasTotal: '15.00',
      discountTotal: '20.00',
      deliveryFee: '15.00',
      total: '210.00',
      deliveryProvider: 'OWN',
      address: { municipalityName: 'Guatemala', zone: 'Zona 10', addressLine: '6a avenida 12-34' },
    });
    // Coherencia líneas <-> totales (la verifica la aplicación; aquí, contra lo persistido).
    const [sums] = await q<{ lines: string; disc: string; promos: string }>(
      `SELECT (SELECT sum((unit_price + extras_per_unit) * quantity) FROM app.order_items WHERE order_id = $1)::text AS lines,
              (SELECT sum(line_discount) FROM app.order_items WHERE order_id = $1)::text AS disc,
              (SELECT sum(amount) FROM app.order_promotions WHERE order_id = $1)::text AS promos`,
      [id],
    );
    expect(sums).toMatchObject({ lines: '215.00', disc: '20.00', promos: '20.00' });
    expect(await sql.count('order_addresses', id)).toBe(1);
    const mods = await q<{ modifier_name: string; unit_extra_price: string }>(
      'SELECT modifier_name, unit_extra_price::text FROM app.order_item_modifiers WHERE order_item_id IN (SELECT id FROM app.order_items WHERE order_id = $1) ORDER BY modifier_name',
      [id],
    );
    expect(mods.map((m) => m.modifier_name)).toEqual([`Aguacate ${run}`, `Queso ${run}`]);
    // Cambiar catálogo y extras después NO altera el pedido.
    await prisma.product.update({
      where: { id: product.id },
      data: { name: 'Otro nombre', basePrice: '999.00' },
    });
    await prisma.modifier.update({
      where: { id: group.optionIds[0] as string },
      data: { name: 'Renombrado', extraPrice: '50.00' },
    });
    const reread = await orders.get(undefined, id, res.body.access?.guestToken);
    expect(reread.lines[0]).toMatchObject({
      productName: product.name,
      unitPrice: '100.00',
      extrasPerUnit: '7.50',
    });
    expect(reread.lines[0]?.modifiers.map((m) => m.name)).toContain(`Aguacate ${run}`);
    expect(reread.promotions).toEqual([{ name: `Auto ${run}`, amount: '20.00' }]);
  });

  it('filas 20, 25: 20 creaciones concurrentes => números únicos y crecientes; 10 solicitudes con la MISMA clave => UN pedido', async (ctx) => {
    skipUnlessReady(ctx);
    const branch = await newBranch();
    const product = await newProduct((await newCategory()).id, '10.00');
    const base = pickup(branch, [line(product.id)]);
    const bodies = await Promise.all(Array.from({ length: 20 }, () => orderBody(base)));
    const created = await Promise.all(bodies.map((b) => orders.create(undefined, key(), b)));
    const numbers = created.map((c) => c.body.order.orderNumber);
    expect(new Set(numbers).size).toBe(20);
    expect(Math.min(...numbers)).toBeGreaterThanOrEqual(1001);

    const same = await orderBody(base);
    const k = key();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => orders.create(undefined, k, same)),
    );
    expect(new Set(results.map((r) => r.body.order.id)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    const keys = await q<{ n: number }>(
      'SELECT count(*)::int AS n FROM app.order_idempotency_keys WHERE order_id = $1',
      [results[0]?.body.order.id],
    );
    expect(keys[0]?.n).toBe(1);
    const total = await q<{ n: number }>(
      'SELECT count(*)::int AS n FROM app.orders WHERE id = $1',
      [results[0]?.body.order.id],
    );
    expect(total[0]?.n).toBe(1);
  });

  it('filas 24, 26, 27, 29: repetición (sin recotizar), otro cuerpo => 409, token adicional sin revocar el vigente, estado en la BD', async (ctx) => {
    skipUnlessReady(ctx);
    const branch = await newBranch();
    const p1 = await newProduct((await newCategory()).id, '10.00');
    const body = await orderBody(pickup(branch, [line(p1.id, 2)]));
    const k = key();
    const first = await orders.create(undefined, k, body);
    // Todo el estado vive en la BD: la segunda llamada solo depende de la fila de la clave (no de memoria del proceso).
    const second = await orders.create(undefined, k, body);
    expect(second.replayed).toBe(true);
    expect(second.body.order.id).toBe(first.body.order.id);
    const oldToken = first.body.access?.guestToken as string;
    const newToken = second.body.access?.guestToken as string;
    expect(newToken).not.toBe(oldToken);
    // El token original NO se revoca (conocer clave + cuerpo equivale a poseer el pedido); ambos funcionan.
    for (const token of [oldToken, newToken]) {
      await expect(orders.get(undefined, first.body.order.id, token)).resolves.toMatchObject({
        id: first.body.order.id,
      });
    }
    const revoked = await q<{ n: number }>(
      'SELECT count(*)::int AS n FROM app.order_access_tokens WHERE order_id = $1 AND revoked_at IS NOT NULL',
      [first.body.order.id],
    );
    expect(revoked[0]?.n).toBe(0);

    const other = { ...(await orderBody(pickup(branch, [line(p1.id, 3)]))), contact: body.contact };
    expect(code(await failure(orders.create(undefined, k, other)))).toBe('IDEMPOTENCY_KEY_REUSED');

    // Claves de actores distintos no se cruzan.
    const a = await newCustomer();
    const b = await newCustomer();
    const mine = await orders.create(
      a,
      k,
      await orderBody(pickup(branch, [line(p1.id)]), a, {
        contact: { fullName: 'Cliente A', phone: phone() },
      }),
    );
    const theirs = await orders.create(
      b,
      k,
      await orderBody(pickup(branch, [line(p1.id)]), b, {
        contact: { fullName: 'Cliente B', phone: phone() },
      }),
    );
    expect(new Set([first.body.order.id, mine.body.order.id, theirs.body.order.id]).size).toBe(3);
    expect(mine.body.access).toBeNull();
  });

  it('fila 28: lock_timeout con la clave retenida => IDEMPOTENCY_IN_PROGRESS; clave vencida se purga y permite crear', async (ctx) => {
    skipUnlessReady(ctx);
    const branch = await newBranch();
    const product = await newProduct((await newCategory()).id, '10.00');
    const body = await orderBody(pickup(branch, [line(product.id)]));
    const k = key();
    const holder = new pg.Client({ connectionString: url });
    await holder.connect();
    try {
      // Otra transacción retiene (sin confirmar) la clave del invitado: la nuestra espera y vence a los 2 s (LOCK_TIMEOUT).
      await holder.query('BEGIN');
      await holder.query('SET CONSTRAINTS ALL DEFERRED');
      await holder.query(
        `INSERT INTO app.order_idempotency_keys (scope, key_hash, request_hash, order_id, expires_at)
         VALUES ('guest', $1, $2, gen_random_uuid(), now() + interval '1 hour')`,
        [keyHashOf(k), Buffer.alloc(32, 7)],
      );
      const e = await failure(orders.create(undefined, k, body));
      expect(code(e)).toBe('IDEMPOTENCY_IN_PROGRESS');
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      await holder.end();
    }
    // Sin la retención, la misma clave crea el pedido; vencida 24 h, se purga y crea otro.
    const first = await orders.create(undefined, k, body);
    expect(first.replayed).toBe(false);
    await q(
      `UPDATE app.order_idempotency_keys SET created_at = now() - interval '25 hours', expires_at = now() - interval '1 hour' WHERE order_id = $1`,
      [first.body.order.id],
    );
    const again = await orders.create(
      undefined,
      k,
      await orderBody(pickup(branch, [line(product.id)])),
    );
    expect(again.replayed).toBe(false);
    expect(again.body.order.id).not.toBe(first.body.order.id);
  });

  it('fila 23: un fallo parcial (línea con producto inexistente) revierte TODO: sin pedido, hijas, token, clave ni auditoría', async (ctx) => {
    skipUnlessReady(ctx);
    const branch = await newBranch();
    const orderId = randomUUID();
    const bad: NewOrder = {
      orderId,
      customerId: null,
      branchId: branch,
      customerName: 'Ana',
      customerPhone: '+50255550000',
      customerEmail: null,
      fulfillmentType: 'PICKUP',
      deliveryProvider: null,
      notes: null,
      subtotal: '10.00',
      extrasTotal: '0.00',
      discountTotal: '0.00',
      deliveryFee: '0.00',
      total: '10.00',
      paymentMethodPreference: null,
      address: null,
      lines: [
        {
          lineNo: 1,
          productId: randomUUID(), // no existe: viola la FK a products al insertar order_items
          productName: 'X',
          quantity: 1,
          unitPrice: '10.00',
          extrasPerUnit: '0.00',
          lineDiscount: '0.00',
          modifiers: [],
        },
      ],
      promotions: [],
      guestToken: { hash: Buffer.alloc(32, 9), expiresAt: new Date(Date.now() + 1000 * 3600) },
      itemCount: 1,
    };
    const k = keyHashOf(key());
    await expect(
      repo.createOrder(
        {
          scope: 'guest',
          keyHash: k,
          requestHash: Buffer.alloc(32, 1),
          expiresAt: new Date(Date.now() + 3_600_000),
        },
        bad,
      ),
    ).rejects.toThrow();
    for (const t of [
      'orders',
      'order_items',
      'order_status_history',
      'order_access_tokens',
      'order_idempotency_keys',
    ]) {
      const col = t === 'orders' ? 'id' : 'order_id';
      expect(
        (
          await q<{ n: number }>(`SELECT count(*)::int AS n FROM app.${t} WHERE ${col} = $1`, [
            orderId,
          ])
        )[0]?.n,
      ).toBe(0);
    }
    expect(
      (
        await q<{ n: number }>(
          'SELECT count(*)::int AS n FROM app.audit_events WHERE entity_id = $1',
          [orderId],
        )
      )[0]?.n,
    ).toBe(0);
    // La clave quedó libre: el mismo hash de clave se puede reclamar de nuevo.
    expect(
      (
        await q<{ n: number }>(
          'SELECT count(*)::int AS n FROM app.order_idempotency_keys WHERE key_hash = $1',
          [k],
        )
      )[0]?.n,
    ).toBe(0);
  });

  it('fila 18: los CHECK de la BD rechazan totales incoherentes (aunque el cliente de la API mintiera)', async (ctx) => {
    skipUnlessReady(ctx);
    const branch = await newBranch();
    const product = await newProduct((await newCategory()).id, '10.00');
    const mk = (over: Partial<NewOrder>): NewOrder => ({
      orderId: randomUUID(),
      customerId: null,
      branchId: branch,
      customerName: 'Ana',
      customerPhone: '+50255550001',
      customerEmail: null,
      fulfillmentType: 'PICKUP',
      deliveryProvider: null,
      notes: null,
      subtotal: '10.00',
      extrasTotal: '0.00',
      discountTotal: '0.00',
      deliveryFee: '0.00',
      total: '10.00',
      paymentMethodPreference: null,
      address: null,
      lines: [
        {
          lineNo: 1,
          productId: product.id,
          productName: 'X',
          quantity: 1,
          unitPrice: '10.00',
          extrasPerUnit: '0.00',
          lineDiscount: '0.00',
          modifiers: [],
        },
      ],
      promotions: [],
      guestToken: null,
      itemCount: 1,
      ...over,
    });
    const claim = () => ({
      scope: 'guest',
      keyHash: keyHashOf(key()),
      requestHash: Buffer.alloc(32, 1),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await expect(repo.createOrder(claim(), mk({ total: '9.99' }))).rejects.toThrow();
    await expect(repo.createOrder(claim(), mk({ customerPhone: '12345' }))).rejects.toThrow();
    await expect(
      repo.createOrder(claim(), mk({ fulfillmentType: 'DELIVERY', deliveryProvider: 'OWN' })),
    ).rejects.toThrow(); // DELIVERY sin dirección
    await expect(
      repo.createOrder(claim(), mk({ deliveryFee: '5.00', total: '15.00' })),
    ).rejects.toThrow(); // PICKUP con tarifa
    await expect(repo.createOrder(claim(), mk({}))).resolves.toMatchObject({ kind: 'created' });
  });

  it('fila 30: GET con dueño por JWT, ajeno, invitado con token vigente/otro pedido/vencido/revocado sobre SQL real', async (ctx) => {
    skipUnlessReady(ctx);
    const branch = await newBranch();
    const product = await newProduct((await newCategory()).id, '10.00');
    const owner = await newCustomer();
    const stranger = await newCustomer();
    const mine = await orders.create(
      owner,
      key(),
      await orderBody(pickup(branch, [line(product.id)]), owner, {
        contact: { fullName: 'Dueño', phone: phone() },
      }),
    );
    await orders.create(
      stranger,
      key(),
      await orderBody(pickup(branch, [line(product.id)]), stranger, {
        contact: { fullName: 'Otro', phone: phone() },
      }),
    );
    const guest = await orders.create(
      undefined,
      key(),
      await orderBody(pickup(branch, [line(product.id)])),
    );
    const other = await orders.create(
      undefined,
      key(),
      await orderBody(pickup(branch, [line(product.id)])),
    );
    const mineId = mine.body.order.id;
    const gId = guest.body.order.id;
    const gToken = guest.body.access?.guestToken as string;
    await expect(orders.get(owner, mineId, undefined)).resolves.toMatchObject({ id: mineId });
    await expect(orders.get(undefined, gId, gToken)).resolves.toMatchObject({ id: gId });
    const denied = [
      await failure(orders.get(stranger, mineId, undefined)),
      await failure(orders.get(owner, gId, undefined)), // pedido de invitado con JWT
      await failure(orders.get(undefined, gId, other.body.access?.guestToken)), // token de otro pedido
      await failure(orders.get(undefined, randomUUID(), gToken)),
    ];
    for (const e of denied) expect((e as { status?: number }).status).toBe(404);
    await q(
      `UPDATE app.order_access_tokens SET created_at = now() - interval '15 days', expires_at = now() - interval '1 day' WHERE token_hash = $1`,
      [hashGuestToken(gToken)],
    );
    expect(
      ((await failure(orders.get(undefined, gId, gToken))) as { status?: number }).status,
    ).toBe(404);
  });

  it('fila 32 (S2): el tope de pending (3) aplica al CLIENTE autenticado por customer_id; el invitado NO se bloquea por teléfono', async (ctx) => {
    skipUnlessReady(ctx);
    const branch = await newBranch();
    const product = await newProduct((await newCategory()).id, '10.00');
    const who = await newCustomer();
    for (let i = 0; i < 3; i += 1) {
      await orders.create(
        who,
        key(),
        await orderBody(pickup(branch, [line(product.id)]), who, {
          contact: { fullName: 'Ana Pérez', phone: phone() },
        }),
      );
    }
    const e = await failure(
      orders.create(
        who,
        key(),
        await orderBody(pickup(branch, [line(product.id)]), who, {
          contact: { fullName: 'Ana Pérez', phone: phone() },
        }),
      ),
    );
    expect(code(e)).toBe('PENDING_ORDERS_LIMIT');
    // Invitado con el MISMO teléfono 5 veces: nunca limitado (sin denegación dirigida).
    const p = phone();
    for (let i = 0; i < 5; i += 1) {
      await orders.create(
        undefined,
        key(),
        await orderBody(pickup(branch, [line(product.id)]), undefined, {
          contact: { fullName: 'Ana Pérez', phone: p },
        }),
      );
    }
  });

  it('S3: los roles anon/authenticated (si existen) no tienen NINGÚN privilegio sobre las tablas de pedidos (RLS + REVOKE); el GUC de limpieza no es un control', async (ctx) => {
    skipUnlessReady(ctx);
    const roles = await q<{ rolname: string }>(
      "SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated')",
    );
    const tables = [
      'orders',
      'order_addresses',
      'order_items',
      'order_item_modifiers',
      'order_promotions',
      'order_status_history',
      'order_access_tokens',
      'order_idempotency_keys',
    ];
    for (const { rolname } of roles) {
      for (const t of tables) {
        const [row] = await q<{ ok: boolean }>(
          `SELECT (has_table_privilege($1, $2, 'SELECT') OR has_table_privilege($1, $2, 'INSERT')
                OR has_table_privilege($1, $2, 'UPDATE') OR has_table_privilege($1, $2, 'DELETE')
                OR has_table_privilege($1, $2, 'TRUNCATE')) AS ok`,
          [rolname, `app.${t}`],
        );
        expect(row?.ok, `${rolname} sobre app.${t}`).toBe(false);
      }
    }
    // PENDIENTE (verificación operativa, no automatizable aquí): el rol de CONEXIÓN de la API (DATABASE_URL) es el dueño o
    // un rol con privilegios amplios; que no tenga TRUNCATE/DELETE donde no lo necesita se comprueba al desplegar.
  });

  it('fila 36: la transacción de creación usa un número FIJO de sentencias (sin N+1) con 1 o 30 líneas', async (ctx) => {
    skipUnlessReady(ctx);
    const branch = await newBranch();
    const product = await newProduct((await newCategory()).id, '10.00');
    const group = await newGroup(product.id, [
      ['Extra', '1.00'],
      ['Otro', '2.00'],
    ]);
    const sel = [{ groupId: group.groupId, optionId: group.optionIds[0], quantity: 1 }];
    const measure = async (lines: unknown[]) => {
      const body = await orderBody(pickup(branch, lines));
      queries.n = 0;
      // Incluye la recotización y las lecturas: el total solo es comparable porque NO crece con las líneas.
      const res = await orders.create(undefined, key(), body);
      return { total: queries.n, id: res.body.order.id };
    };
    const one = await measure([line(product.id, 1, sel)]);
    const many = await measure(Array.from({ length: 30 }, () => line(product.id, 1, sel)));
    // ±1: la purga perezosa (1/50) puede añadir una sentencia a una de las dos mediciones.
    expect(Math.abs(many.total - one.total)).toBeLessThanOrEqual(1);
    expect(await sql.count('order_items', many.id)).toBe(30);
    expect(one.total).toBeLessThanOrEqual(45);
  });

  it('fila 33: F20 no escribe pagos, entregas ni notificaciones (si esas tablas existen, no cambian)', async (ctx) => {
    skipUnlessReady(ctx);
    const present = await q<{ t: string }>(
      `SELECT t FROM unnest(ARRAY['app.payments','app.deliveries','app.notifications']) t WHERE to_regclass(t) IS NOT NULL`,
    );
    const counts = async () =>
      Promise.all(
        present.map(
          async ({ t }) => (await q<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`))[0]?.n,
        ),
      );
    const before = await counts();
    const branch = await newBranch();
    const product = await newProduct((await newCategory()).id, '10.00');
    await orders.create(undefined, key(), await orderBody(pickup(branch, [line(product.id)])));
    expect(await counts()).toEqual(before);
  });
});
