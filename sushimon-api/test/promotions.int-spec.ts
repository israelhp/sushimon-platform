import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { TestContext } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import { AuthorizationService } from '../src/auth/authorization.service.js';
import { BranchOffersService } from '../src/branch-products/branch-offers.service.js';
import { BranchProductsRepository } from '../src/branch-products/branch-products.repository.js';
import { AdminCategoriesService } from '../src/categories/admin-categories.service.js';
import { CategoriesQueryService } from '../src/categories/categories-query.service.js';
import { CategoriesRepository } from '../src/categories/categories.repository.js';
import { validateEnv, type Env } from '../src/config/env.js';
import { PrismaService } from '../src/database/prisma.service.js';
import type { IdentityService } from '../src/identity/identity.service.js';
import { AdminProductsService } from '../src/products/admin-products.service.js';
import { ProductsRepository } from '../src/products/products.repository.js';
import { AdminPromotionsService } from '../src/promotions/admin-promotions.service.js';
import type { CreatePromotionRequest } from '../src/promotions/dto/promotion-requests.dto.js';
import { PromotionCandidatesService } from '../src/promotions/promotion-candidates.service.js';
import { PromotionEvaluator } from '../src/promotions/promotion-evaluator.js';
import { PromotionTimeService } from '../src/promotions/promotion-time.service.js';
import { PromotionsRepository } from '../src/promotions/promotions.repository.js';
import { PublicPromotionsService } from '../src/promotions/public-promotions.service.js';
import { cleanupTestData, TEST_URL, withClient } from './support/db.js';
import { MutableClock, TZ } from './support/promotions-harness.js';
import { globalStaff, scopedStaff } from './support/staff-context.js';

const url = TEST_URL;

/**
 * Se omite (con aviso) si no hay DATABASE_URL_TEST o si la migración 0016 aún no está aplicada (`app.promotions`
 * ausente). La 0016 requiere aprobación humana y NO se aplica desde aquí: hasta que se ejecute esta prueba contra
 * PostgreSQL real, el SQL de F15 (EXCLUDE de tramos, `time` con 24:00, UNIQUE de `code` con varios NULL, agregados JSON de
 * candidatas, filtros del listado con `folded`/`LIKE`, FK RESTRICT, CHECK de valor y periodo) NO está probado.
 */
const ready = url
  ? await withClient(url, async (c) => {
      const res = await c.query<{ p: string | null; b: string | null }>(
        `SELECT to_regclass('app.promotions') AS p, to_regclass('app.branch_products') AS b`,
      );
      return res.rows[0]?.p != null && res.rows[0]?.b != null;
    }).catch(() => false)
  : false;
if (url && !ready) {
  console.warn(
    '[promotions.int-spec] OMITIDA: app.promotions no existe en DATABASE_URL_TEST (migración 0016 sin aplicar). El SQL de F15 NO se probó contra PostgreSQL real.',
  );
}

describe.skipIf(!url || !ready)('Promociones (F15) contra PostgreSQL real', () => {
  const run = randomUUID().slice(0, 8);
  const staffId = randomUUID();
  const PERMS = ['promotions.read', 'promotions.create', 'promotions.update'];
  const staff = globalStaff(PERMS, { staffId });
  const NOW = new Date('2026-11-16T22:00:00Z'); // lunes 16:00 en Guatemala
  let prisma: PrismaService;
  let admin: AdminPromotionsService;
  let store: PublicPromotionsService;
  let candidates: PromotionCandidatesService;
  let categories: AdminCategoriesService;
  let products: AdminProductsService;
  let clock: MutableClock;
  const evaluator = new PromotionEvaluator(TZ);
  const promotionIds = new Set<string>();
  const productIds = new Set<string>();
  const categoryIds = new Set<string>();
  const branchIds = new Set<string>();
  let branchA = '';
  let branchB = '';
  let p1 = '';
  let p2 = '';

  const code = (e: unknown) => (e as { response?: { code?: string } }).response?.code;
  const failure = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: unknown) => e,
    );
  const skipUnlessReady = (ctx: TestContext) => {
    if (!ready) ctx.skip('app.promotions no existe en DATABASE_URL_TEST (0016 sin aplicar)');
  };
  const raw = <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    withClient(url as string, async (c) => (await c.query<T>(sql, params)).rows);
  const create = async (over: Partial<CreatePromotionRequest> = {}) => {
    const out = await admin.create(staff, {
      name: `Promo ${run}`,
      kind: 'PERCENT',
      value: '15.00',
      startsAt: '2026-01-01T00:00:00-06:00',
      endsAt: '2027-01-01T00:00:00-06:00',
      branchScope: 'ALL',
      productScope: 'ALL',
      ...over,
    });
    promotionIds.add(out.id);
    return out;
  };
  const newBranch = async (active = true) => {
    const b = await prisma.branch.create({
      data: {
        code: `pr-${run}-${randomUUID().slice(0, 6)}`,
        name: `Suc ${run}`,
        address: 'Zona 1',
        active,
      },
    });
    branchIds.add(b.id);
    return b.id;
  };
  const newProduct = async (name: string, basePrice = '50.00') => {
    const cat = await categories.create(staff, {
      name: `Cat ${name} ${run}`,
      parentId: null,
      active: true,
    });
    categoryIds.add(cat.id);
    const view = await products.create(staff, {
      name: `${name} ${run}`,
      basePrice,
      categoryId: cat.id,
    });
    productIds.add(view.id);
    return view.id;
  };

  beforeAll(async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    prisma = new PrismaService(
      new ConfigService<Env, true>(
        validateEnv({ DATABASE_URL: url, DB_POOL_MAX: '8', NODE_ENV: 'test' }),
      ),
    );
    const authorization = new AuthorizationService({} as IdentityService);
    const audit = new AuditService();
    const catRepo = new CategoriesRepository(prisma);
    const catQuery = new CategoriesQueryService(catRepo);
    categories = new AdminCategoriesService(catRepo, audit, authorization);
    products = new AdminProductsService(
      new ProductsRepository(prisma),
      audit,
      authorization,
      catQuery,
      { get: () => [] } as unknown as ConfigService<Env, true>,
    );
    clock = new MutableClock(NOW);
    const time = new PromotionTimeService(clock, TZ);
    const repo = new PromotionsRepository(prisma);
    admin = new AdminPromotionsService(repo, audit, authorization, time);
    const offers = new BranchOffersService(new BranchProductsRepository(prisma), catQuery);
    store = new PublicPromotionsService(repo, time, offers, catQuery);
    candidates = new PromotionCandidatesService(repo);
    // `audit_events.actor_id` tiene FK a staff_users: empleado de prueba (@sushimon.test, lo borra la limpieza).
    await withClient(url as string, (c) =>
      c.query(`INSERT INTO app.staff_users (id, full_name, email) VALUES ($1, $2, $3)`, [
        staffId,
        'Prueba promociones',
        `promo-${run}@sushimon.test`,
      ]),
    );
    branchA = await newBranch();
    branchB = await newBranch();
    p1 = await newProduct('Roll', '85.00');
    p2 = await newProduct('Edamame', '30.00');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    if (ready && url) {
      await withClient(url, async (c) => {
        await c.query('BEGIN');
        try {
          await c.query("SET LOCAL app.allow_audit_cleanup = 'on'");
          const ids = [...promotionIds];
          await c.query('DELETE FROM app.audit_events WHERE entity_id = ANY($1::uuid[])', [ids]);
          // Hijas en cascada; las promociones van ANTES que sucursales y productos (FK RESTRICT).
          await c.query('DELETE FROM app.promotions WHERE id = ANY($1::uuid[])', [ids]);
          await c.query('COMMIT');
        } catch (error) {
          await c.query('ROLLBACK');
          throw error;
        }
      });
      await cleanupTestData(url, { authUserIds: [], branchIds, productIds, categoryIds });
    }
  });

  it('crea y lee: tramos con 24:00, sucursales y productos; version 1 y auditoría en la misma transacción', async (ctx) => {
    skipUnlessReady(ctx);
    const out = await create({
      name: `Happy ${run}`,
      branchScope: 'SELECTED',
      branchIds: [branchA],
      productScope: 'SELECTED',
      productIds: [p1, p2],
      schedule: [
        { weekday: 5, startsAt: '22:00', endsAt: '24:00' },
        { weekday: 6, startsAt: '00:00', endsAt: '02:00' },
        { weekday: 1, startsAt: '15:00', endsAt: '18:00' },
      ],
    });
    expect(out).toMatchObject({
      version: 1,
      branchScope: 'SELECTED',
      productScope: 'SELECTED',
      productCount: 2,
    });
    expect(out.schedule).toEqual([
      { weekday: 1, startsAt: '15:00', endsAt: '18:00' },
      { weekday: 5, startsAt: '22:00', endsAt: '24:00' },
      { weekday: 6, startsAt: '00:00', endsAt: '02:00' },
    ]);
    const stored = await raw<{ ends_at: string }>(
      `SELECT ends_at::text FROM app.promotion_weekdays WHERE promotion_id = $1 AND weekday = 5`,
      [out.id],
    );
    expect(stored[0]?.ends_at).toBe('24:00:00');
    const audited = await raw<{ action: string }>(
      `SELECT action FROM app.audit_events WHERE entity_id = $1`,
      [out.id],
    );
    expect(audited.map((a) => a.action)).toEqual(['promotion.created']);
    expect((await admin.get(staff, out.id)).schedule).toEqual(out.schedule);
  });

  it('código: normalizado, único sin distinguir mayúsculas (409) y varias automáticas con code NULL', async (ctx) => {
    skipUnlessReady(ctx);
    const c1 = await create({ code: ` vera${run} ` });
    expect(c1.code).toBe(`VERA${run.toUpperCase()}`);
    const dup = await failure(
      admin.create(staff, {
        name: 'dup',
        kind: 'PERCENT',
        value: '5.00',
        startsAt: '2026-01-01T00:00:00-06:00',
        endsAt: '2027-01-01T00:00:00-06:00',
        branchScope: 'ALL',
        productScope: 'ALL',
        code: `VERA${run}`,
      }),
    );
    expect(code(dup)).toBe('PROMOTION_CODE_TAKEN');
    await create();
    await create();
  });

  it('PATCH: reemplazo atómico de listas, version+1, idempotencia y 409 de versión', async (ctx) => {
    skipUnlessReady(ctx);
    const p = await create({
      branchScope: 'SELECTED',
      branchIds: [branchA],
      productScope: 'SELECTED',
      productIds: [p1],
      schedule: [{ weekday: 1, startsAt: '10:00', endsAt: '11:00' }],
    });
    const out = await admin.update(staff, p.id, {
      expectedVersion: 1,
      branchScope: 'SELECTED',
      branchIds: [branchB],
      productIds: [p2],
      schedule: [{ weekday: 2, startsAt: '12:00', endsAt: '13:00' }],
    });
    expect(out).toMatchObject({ version: 2, branches: [{ id: branchB }], products: [{ id: p2 }] });
    expect(out.schedule).toEqual([{ weekday: 2, startsAt: '12:00', endsAt: '13:00' }]);
    const same = await admin.update(staff, p.id, { expectedVersion: 2, productIds: [p2] });
    expect(same.version).toBe(2);
    expect(code(await failure(admin.update(staff, p.id, { expectedVersion: 1, name: 'x' })))).toBe(
      'PROMOTION_VERSION_CONFLICT',
    );
    const actions = await raw<{ action: string }>(
      `SELECT action FROM app.audit_events WHERE entity_id = $1 ORDER BY created_at`,
      [p.id],
    );
    expect(actions.map((a) => a.action)).toEqual(['promotion.created', 'promotion.updated']);
  });

  it('PATCH concurrentes con la misma versión: uno gana y el otro recibe 409', async (ctx) => {
    skipUnlessReady(ctx);
    const p = await create();
    const results = await Promise.all([
      failure(admin.update(staff, p.id, { expectedVersion: 1, name: `A ${run}` })),
      failure(admin.update(staff, p.id, { expectedVersion: 1, name: `B ${run}` })),
    ]);
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(results.map(code).filter(Boolean)).toEqual(['PROMOTION_VERSION_CONFLICT']);
    expect((await admin.get(staff, p.id)).version).toBe(2);
  });

  it('B1: actor sin alcance recibe 404 aunque la fila esté bloqueada (no toca el candado: sin 503 ni espera)', async (ctx) => {
    skipUnlessReady(ctx);
    const p = await create({ branchScope: 'SELECTED', branchIds: [branchB] });
    const onlyA = scopedStaff(PERMS, [branchA], { staffId });
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM app.promotions WHERE id = $1 FOR UPDATE', [p.id]);
      const started = Date.now();
      const patch = await failure(admin.update(onlyA, p.id, { expectedVersion: 1, name: 'x' }));
      const status = await failure(admin.updateStatus(onlyA, p.id, { active: false }));
      expect([code(patch), code(status)]).toEqual(['PROMOTION_NOT_FOUND', 'PROMOTION_NOT_FOUND']);
      expect(Date.now() - started).toBeLessThan(2_000); // lock_timeout es 3 s: no esperó
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });

  it('estado: idempotente y auditado; desactivada deja de ser candidata', async (ctx) => {
    skipUnlessReady(ctx);
    const p = await create();
    expect(
      (await admin.updateStatus(staff, p.id, { active: false, reason: 'prueba' })).version,
    ).toBe(2);
    expect((await admin.updateStatus(staff, p.id, { active: false })).version).toBe(2);
    expect((await candidates.load(branchA, NOW)).promotions.map((c) => c.id)).not.toContain(p.id);
  });

  it('EXCLUDE y CHECK de la BD respaldan a la API (inserción directa)', async (ctx) => {
    skipUnlessReady(ctx);
    const p = await create();
    const insert = (w: number, s: string, e: string) =>
      withClient(url as string, (c) =>
        c.query(
          `INSERT INTO app.promotion_weekdays (promotion_id, weekday, starts_at, ends_at) VALUES ($1, $2, $3::time, $4::time)`,
          [p.id, w, s, e],
        ),
      );
    await insert(1, '15:00', '18:00');
    await expect(insert(1, '17:00', '19:00')).rejects.toMatchObject({ code: '23P01' });
    await insert(1, '18:00', '19:00'); // contiguo permitido
    await expect(insert(1, '20:00', '19:00')).rejects.toMatchObject({ code: '23514' });
    await expect(insert(8, '10:00', '11:00')).rejects.toMatchObject({ code: '23514' });
  });

  it('listado: filtros, búsqueda con comodines literales y acentos, y alcance acotado', async (ctx) => {
    skipUnlessReady(ctx);
    await create({ name: `Café 100% ${run}` });
    await create({ name: `Solo B ${run}`, branchScope: 'SELECTED', branchIds: [branchB] });
    const base = { page: 1, pageSize: 50 };
    const names = async (q: Parameters<typeof admin.list>[1], who = staff) =>
      (await admin.list(who, q)).items.map((i) => i.name);
    expect(await names({ ...base, q: `cafe 100% ${run}` })).toEqual([`Café 100% ${run}`]);
    expect(await names({ ...base, q: `% ${run}` })).toEqual([`Café 100% ${run}`]); // comodín literal
    const onlyA = scopedStaff(PERMS, [branchA], { staffId });
    const seen = await names({ ...base, q: run }, onlyA);
    expect(seen).not.toContain(`Solo B ${run}`);
    expect(code(await failure(admin.list(onlyA, { ...base, branchId: branchB })))).toBe(
      'BRANCH_NOT_FOUND',
    );
    expect(
      (await admin.list(staff, { ...base, status: 'running', kind: 'PERCENT' })).total,
    ).toBeGreaterThan(0);
  });

  it('tienda: Happy Hour vigente con precio de sucursal; sin code ni descuento del cupón; sucursal inactiva 404', async (ctx) => {
    skipUnlessReady(ctx);
    const b = await newBranch();
    await prisma.branchProduct.create({
      data: { branchId: b, productId: p1, priceOverride: '70.00' },
    });
    const hh = await create({
      name: `HH ${run}`,
      value: '20.00',
      branchScope: 'SELECTED',
      branchIds: [b],
      productScope: 'SELECTED',
      productIds: [p1],
      schedule: [{ weekday: 1, startsAt: '15:00', endsAt: '18:00' }],
    });
    const coupon = await create({
      name: `Cup ${run}`,
      code: `SEC${run.toUpperCase()}`,
      value: '90.00',
      branchScope: 'SELECTED',
      branchIds: [b],
    });
    const out = await store.list(b, 'live');
    const item = out.items.find((i) => i.id === hh.id);
    expect(item).toMatchObject({ isHappyHour: true, requiresCode: false });
    expect(item?.items).toEqual([{ productId: p1, regularPrice: '70.00', promoPrice: '56.00' }]);
    const c = out.items.find((i) => i.id === coupon.id);
    expect(c).toMatchObject({ requiresCode: true });
    expect(JSON.stringify(out)).not.toContain(`SEC${run.toUpperCase()}`);
    expect(out.nextChangeAt).toBe(new Date('2026-11-16T18:00:00-06:00').toISOString());
    const inactive = await newBranch(false);
    expect(code(await failure(store.list(inactive, 'live')))).toBe('BRANCH_NOT_FOUND');
  });

  it('candidatas + evaluador sobre datos reales: cupón válido, vencido y desconocido', async (ctx) => {
    skipUnlessReady(ctx);
    const b = await newBranch();
    const good = await create({
      code: `OK${run.toUpperCase()}`,
      value: '25.00',
      branchScope: 'SELECTED',
      branchIds: [b],
    });
    await create({
      code: `OLD${run.toUpperCase()}`,
      endsAt: '2026-06-01T00:00:00-06:00',
      startsAt: '2026-01-01T00:00:00-06:00',
      branchScope: 'SELECTED',
      branchIds: [b],
    });
    const evalWith = async (coupon: string) =>
      evaluator.evaluate({
        at: NOW,
        branchId: b,
        mode: 'pickup',
        couponCode: coupon,
        lines: [{ productId: p1, unitPrice: '85.00', quantity: 1 }],
        promotions: (await candidates.load(b, NOW, coupon)).promotions,
      });
    const ok = await evalWith(`ok${run}`);
    expect(ok.coupon).toEqual({ status: 'APPLIED' });
    expect(ok.lines[0]).toMatchObject({
      promotionId: good.id,
      discountAmount: '21.25',
      finalPrice: '63.75',
    });
    expect((await evalWith(`old${run}`)).coupon).toEqual((await evalWith('NOEXISTE')).coupon);
  });

  it('FK RESTRICT: no se puede borrar una sucursal ni un producto referenciados', async (ctx) => {
    skipUnlessReady(ctx);
    const b = await newBranch();
    await create({
      branchScope: 'SELECTED',
      branchIds: [b],
      productScope: 'SELECTED',
      productIds: [p2],
    });
    await expect(raw('DELETE FROM app.branches WHERE id = $1', [b])).rejects.toMatchObject({
      code: '23503',
    });
    await expect(raw('DELETE FROM app.products WHERE id = $1', [p2])).rejects.toMatchObject({
      code: '23503',
    });
  });
});
