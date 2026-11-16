import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { TestContext } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import { AuthorizationService } from '../src/auth/authorization.service.js';
import { AdminBannersService } from '../src/banners/admin-banners.service.js';
import { BannersReadRepository } from '../src/banners/banners-read.repository.js';
import { BannersTimeService } from '../src/banners/banners-time.service.js';
import { BannersRepository } from '../src/banners/banners.repository.js';
import type { CreateBannerRequest } from '../src/banners/dto/banner-requests.dto.js';
import { PublicBannersReader } from '../src/banners/public-banners.reader.js';
import { AdminCategoriesService } from '../src/categories/admin-categories.service.js';
import { CategoriesQueryService } from '../src/categories/categories-query.service.js';
import { CategoriesRepository } from '../src/categories/categories.repository.js';
import { validateEnv, type Env } from '../src/config/env.js';
import { PrismaService } from '../src/database/prisma.service.js';
import type { IdentityService } from '../src/identity/identity.service.js';
import { MediaRepository } from '../src/media/media.repository.js';
import { MediaUrlService } from '../src/media/media-url.service.js';
import { AdminProductsService } from '../src/products/admin-products.service.js';
import { ProductsRepository } from '../src/products/products.repository.js';
import { AdminPromotionsService } from '../src/promotions/admin-promotions.service.js';
import { PromotionTimeService } from '../src/promotions/promotion-time.service.js';
import { PromotionsRepository } from '../src/promotions/promotions.repository.js';
import { cleanupTestData, TEST_URL, withClient } from './support/db.js';
import { mediaConfig } from './support/media-harness.js';
import { MutableClock, TZ } from './support/promotions-harness.js';
import { globalStaff, scopedStaff } from './support/staff-context.js';

const url = TEST_URL;

/**
 * Se omite (con aviso) si no hay DATABASE_URL_TEST o si la migración 0017 aún no está aplicada (`app.banners` ausente o
 * `media_assets` sin `BANNER_IMAGE`). La 0017 requiere aprobación humana y NO se aplica desde aquí: hasta que se ejecute
 * esta prueba contra PostgreSQL real, el SQL de F16 (lector público con JOIN de traducciones/imagen/destino y agregado
 * JSON, filtros del listado con `folded`/`LIKE` y NULLS LAST, reordenado con `unnest` bajo `pg_advisory_xact_lock`,
 * `FOR NO KEY UPDATE`, FK RESTRICT hacia `media_assets`) NO está probado.
 */
const ready = url
  ? await withClient(url, async (c) => {
      const res = await c.query<{ b: string | null; m: string | null; k: boolean }>(
        `SELECT to_regclass('app.banners') AS b, to_regclass('app.promotions') AS m,
                COALESCE((SELECT pg_get_constraintdef(oid) LIKE '%BANNER_IMAGE%'
                            FROM pg_constraint
                           WHERE conrelid = 'app.media_assets'::regclass AND conname = 'media_assets_kind_chk'), false) AS k`,
      );
      const row = res.rows[0];
      return row?.b != null && row?.m != null && row?.k === true;
    }).catch(() => false)
  : false;
if (url && !ready) {
  console.warn(
    '[banners.int-spec] OMITIDA: app.banners no existe en DATABASE_URL_TEST o media_assets no admite BANNER_IMAGE (migración 0017 sin aplicar). El SQL de F16 NO se probó contra PostgreSQL real.',
  );
}

describe.skipIf(!url || !ready)('Banners (F16) contra PostgreSQL real', () => {
  const run = randomUUID().slice(0, 8);
  const staffId = randomUUID();
  const PERMS = ['banners.read', 'banners.create', 'banners.update'];
  const staff = globalStaff(PERMS, { staffId });
  // Sembrar categorías/productos exige permisos de catálogo, distintos de los de banners (lección de F15).
  const catalogStaff = globalStaff(['catalog.read', 'catalog.create', 'catalog.update'], {
    staffId,
  });
  const NOW = new Date('2026-11-16T22:00:00Z'); // lunes 16:00 en Guatemala
  const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
  let prisma: PrismaService;
  let admin: AdminBannersService;
  let reader: PublicBannersReader;
  let promotions: AdminPromotionsService;
  let categories: AdminCategoriesService;
  let products: AdminProductsService;
  let media: MediaRepository;
  let clock: MutableClock;
  const bannerIds = new Set<string>();
  const assetIds = new Set<string>();
  const promotionIds = new Set<string>();
  const productIds = new Set<string>();
  const categoryIds = new Set<string>();
  const branchIds = new Set<string>();
  let branchA = '';
  let branchB = '';
  let categoryId = '';
  let productId = '';
  let seq = 0;

  const code = (e: unknown) => (e as { response?: { code?: string } }).response?.code;
  const failure = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: unknown) => e,
    );
  const skipUnlessReady = (ctx: TestContext) => {
    if (!ready) ctx.skip('app.banners no existe en DATABASE_URL_TEST (0017 sin aplicar)');
  };
  const raw = <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    withClient(url as string, async (c) => (await c.query<T>(sql, params)).rows);
  const hex64 = () => (randomUUID() + randomUUID()).replaceAll('-', '').slice(0, 64);

  /** Asset READY de banner (fila directa: la subida real es de F14 y necesita R2). */
  const newAsset = async (over: { kind?: string; status?: string } = {}) => {
    const id = randomUUID();
    const kind = over.kind ?? 'BANNER_IMAGE';
    const status = over.status ?? 'READY';
    const prefix = kind === 'BANNER_IMAGE' ? 'banners' : 'products';
    await raw(
      `INSERT INTO app.media_assets (id, kind, object_key, bucket, mime_type, size_bytes, checksum_sha256, status,
                                    confirmed_at, expires_at)
       VALUES ($1, $2, $3, 'bucket-test', 'image/webp', 200000, $4, $5,
               CASE WHEN $5 = 'READY' THEN now() END, CASE WHEN $5 = 'PENDING' THEN now() + interval '1 hour' END)`,
      [id, kind, `${prefix}/2026/${id}.webp`, hex64(), status],
    );
    assetIds.add(id);
    return id;
  };
  const newBranch = async (active = true) => {
    const b = await prisma.branch.create({
      data: {
        code: `bn-${run}-${randomUUID().slice(0, 6)}`,
        name: `Suc ${run}`,
        address: 'Zona 1',
        active,
      },
    });
    branchIds.add(b.id);
    return b.id;
  };
  const newCategory = async (name: string) => {
    const cat = await categories.create(catalogStaff, {
      name: `${name} ${run}`,
      parentId: null,
      active: true,
    });
    categoryIds.add(cat.id);
    return cat.id;
  };
  let image = '';
  const create = async (over: Partial<CreateBannerRequest> = {}) => {
    seq += 1;
    const out = await admin.create(staff, {
      code: `b${seq}-${run}`,
      imageAssetId: image,
      translations: { es: { title: `Banner ${seq} ${run}`, imageAlt: 'Alt' } },
      cta: { type: 'MENU' },
      branchScope: 'ALL',
      ...over,
    });
    bannerIds.add(out.id);
    return out;
  };
  const promotion = async (over: Record<string, unknown> = {}) => {
    const p = await promotions.create(staff, {
      name: `Promo ${run}`,
      kind: 'PERCENT',
      value: '15.00',
      startsAt: '2026-01-01T00:00:00-06:00',
      endsAt: '2027-01-01T00:00:00-06:00',
      branchScope: 'ALL',
      productScope: 'ALL',
      ...over,
    } as never);
    promotionIds.add(p.id);
    return p;
  };
  /**
   * La tienda devuelve como máximo 10 banners: antes de cada prueba de lectura se desactivan los banners que esta misma
   * prueba creó antes (SQL directo, sin tocar filas ajenas), para que los nuevos no queden fuera del tope.
   */
  const quiet = () =>
    raw('UPDATE app.banners SET active = false WHERE id = ANY($1::uuid[])', [[...bannerIds]]);
  const storeIds = async (over: { branchId?: string | null; locale?: 'es' | 'en' } = {}) =>
    (
      await reader.findActiveBanners({
        branchId: over.branchId ?? null,
        locale: over.locale ?? 'es',
      })
    ).items
      .map((i) => i.id)
      .filter((id) => bannerIds.has(id));

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
    const time = new BannersTimeService(clock, TZ);
    const urls = new MediaUrlService(mediaConfig());
    admin = new AdminBannersService(
      new BannersRepository(prisma),
      audit,
      authorization,
      time,
      urls,
    );
    reader = new PublicBannersReader(new BannersReadRepository(prisma), time, urls);
    promotions = new AdminPromotionsService(
      new PromotionsRepository(prisma),
      audit,
      authorization,
      new PromotionTimeService(clock, TZ),
    );
    media = new MediaRepository(prisma);
    // `audit_events.actor_id` tiene FK a staff_users: empleado de prueba (@sushimon.test, lo borra la limpieza).
    await withClient(url as string, (c) =>
      c.query(`INSERT INTO app.staff_users (id, full_name, email) VALUES ($1, $2, $3)`, [
        staffId,
        'Prueba banners',
        `banner-${run}@sushimon.test`,
      ]),
    );
    branchA = await newBranch();
    branchB = await newBranch();
    categoryId = await newCategory('Rolls');
    const view = await products.create(catalogStaff, {
      name: `Roll ${run}`,
      basePrice: '85.00',
      categoryId,
    });
    productIds.add(view.id);
    productId = view.id;
    image = await newAsset();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    if (ready && url) {
      await withClient(url, async (c) => {
        await c.query('BEGIN');
        try {
          await c.query("SET LOCAL app.allow_audit_cleanup = 'on'");
          const ids = [...bannerIds, ...promotionIds, ...assetIds];
          await c.query('DELETE FROM app.audit_events WHERE entity_id = ANY($1::uuid[])', [ids]);
          // Orden de la reordenación: el UUID nulo agrupa la auditoría del reordenado de esta prueba.
          await c.query(
            `DELETE FROM app.audit_events WHERE action = 'banner.reordered' AND actor_id = $1`,
            [staffId],
          );
          // Hijas en cascada; banners ANTES que sus destinos (FK RESTRICT hacia assets, promociones, categorías y productos).
          await c.query('DELETE FROM app.banners WHERE id = ANY($1::uuid[])', [[...bannerIds]]);
          await c.query('DELETE FROM app.promotions WHERE id = ANY($1::uuid[])', [
            [...promotionIds],
          ]);
          await c.query('DELETE FROM app.media_assets WHERE id = ANY($1::uuid[])', [[...assetIds]]);
          await c.query('COMMIT');
        } catch (error) {
          await c.query('ROLLBACK');
          throw error;
        }
      });
      await cleanupTestData(url, { authUserIds: [], branchIds, productIds, categoryIds });
    }
  });

  it('crea y lee: código normalizado, traducciones es/en, sucursales, version 1 y auditoría en la misma transacción', async (ctx) => {
    skipUnlessReady(ctx);
    const out = await create({
      code: `Verano-${run}`,
      branchScope: 'SELECTED',
      branchIds: [branchA, branchB],
      translations: {
        es: { title: 'Verano', subtitle: 'Sub', imageAlt: 'Alt' },
        en: { title: 'Summer', imageAlt: 'Alt en' },
      },
      cta: { type: 'CATEGORY', categoryId },
    });
    expect(out).toMatchObject({
      code: `verano-${run}`,
      version: 1,
      branchScope: 'SELECTED',
      hasEnglish: true,
      cta: { type: 'CATEGORY', categoryId, targetActive: true },
    });
    expect(out.branches.map((b) => b.id).sort()).toEqual([branchA, branchB].sort());
    const tr = await raw<{ locale: string }>(
      'SELECT locale FROM app.banner_translations WHERE banner_id = $1 ORDER BY locale',
      [out.id],
    );
    expect(tr.map((t) => t.locale)).toEqual(['en', 'es']);
    const audited = await raw<{ action: string }>(
      'SELECT action FROM app.audit_events WHERE entity_id = $1',
      [out.id],
    );
    expect(audited.map((a) => a.action)).toEqual(['banner.created']);
    expect(code(await failure(create({ code: `VERANO-${run}` })))).toBe('BANNER_CODE_TAKEN');
    expect((await admin.get(staff, out.id)).translations.es.title).toBe('Verano');
  });

  it('imagen: inexistente, PENDING y de otro tipo => 422 con motivo (SQL real)', async (ctx) => {
    skipUnlessReady(ctx);
    const pending = await newAsset({ status: 'PENDING' });
    const product = await newAsset({ kind: 'PRODUCT_IMAGE' });
    for (const [id, reason] of [
      [randomUUID(), 'ASSET_UNKNOWN'],
      [pending, 'ASSET_NOT_READY'],
      [product, 'ASSET_KIND_MISMATCH'],
    ] as const) {
      const e = await failure(create({ imageAssetId: id }));
      expect(code(e)).toBe('BANNER_IMAGE_INVALID');
      expect(
        (e as { response?: { violations?: { code: string }[] } }).response?.violations?.[0]?.code,
      ).toBe(reason);
    }
  });

  it('PATCH parcial: reemplaza listas atómicamente, no pisa lo omitido, borra inglés, version+1 e idempotencia', async (ctx) => {
    skipUnlessReady(ctx);
    const b = await create({
      branchScope: 'SELECTED',
      branchIds: [branchA],
      translations: {
        es: { title: 'Uno', subtitle: 'Sub', imageAlt: 'Alt' },
        en: { title: 'One', imageAlt: 'Alt en' },
      },
    });
    const out = await admin.update(staff, b.id, {
      expectedVersion: 1,
      branchIds: [branchB],
      translations: { es: { title: 'Dos' }, en: null },
    });
    expect(out).toMatchObject({ version: 2, hasEnglish: false });
    expect(out.branches.map((x) => x.id)).toEqual([branchB]);
    expect(out.translations.es).toMatchObject({ title: 'Dos', subtitle: 'Sub', imageAlt: 'Alt' });
    expect(
      (await raw('SELECT 1 FROM app.banner_translations WHERE banner_id = $1', [b.id])).length,
    ).toBe(1);
    expect(
      (await admin.update(staff, b.id, { expectedVersion: 2, branchIds: [branchB] })).version,
    ).toBe(2);
    expect(
      code(await failure(admin.update(staff, b.id, { expectedVersion: 1, sortOrder: 3 }))),
    ).toBe('BANNER_VERSION_CONFLICT');
    const actions = await raw<{ action: string }>(
      'SELECT action FROM app.audit_events WHERE entity_id = $1 ORDER BY created_at',
      [b.id],
    );
    expect(actions.map((a) => a.action)).toEqual(['banner.created', 'banner.updated']);
  });

  it('PATCH concurrentes con la misma versión: uno gana y el otro recibe 409', async (ctx) => {
    skipUnlessReady(ctx);
    const b = await create();
    const results = await Promise.all([
      failure(admin.update(staff, b.id, { expectedVersion: 1, sortOrder: 11 })),
      failure(admin.update(staff, b.id, { expectedVersion: 1, sortOrder: 12 })),
    ]);
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(results.filter((r) => r !== null).map(code)).toEqual(['BANNER_VERSION_CONFLICT']);
    expect((await admin.get(staff, b.id)).version).toBe(2);
  });

  it('B1: actor sin alcance recibe 404/403 aunque la fila esté bloqueada (no toca el candado: sin 503 ni espera)', async (ctx) => {
    skipUnlessReady(ctx);
    const b = await create({ branchScope: 'SELECTED', branchIds: [branchB] });
    const onlyA = scopedStaff(PERMS, [branchA], { staffId });
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM app.banners WHERE id = $1 FOR UPDATE', [b.id]);
      const started = Date.now();
      const patch = await failure(admin.update(onlyA, b.id, { expectedVersion: 1, sortOrder: 4 }));
      const status = await failure(admin.updateStatus(onlyA, b.id, { active: false }));
      expect([code(patch), code(status)]).toEqual(['BANNER_NOT_FOUND', 'BANNER_NOT_FOUND']);
      expect(Date.now() - started).toBeLessThan(2_000); // lock_timeout es 3 s: no esperó
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });

  it('estado: idempotente y auditado; un banner desactivado no sale en la tienda', async (ctx) => {
    skipUnlessReady(ctx);
    await quiet();
    const b = await create();
    expect(await storeIds()).toContain(b.id);
    expect(
      (await admin.updateStatus(staff, b.id, { active: false, reason: 'prueba' })).version,
    ).toBe(2);
    expect((await admin.updateStatus(staff, b.id, { active: false })).version).toBe(2);
    expect(await storeIds()).not.toContain(b.id);
    expect((await admin.updateStatus(staff, b.id, { active: true })).version).toBe(3);
    expect(await storeIds()).toContain(b.id);
  });

  it('tienda (SQL real): vigencia [inicio, fin), sucursal, idioma con respaldo, imagen y nextChangeAt', async (ctx) => {
    skipUnlessReady(ctx);
    await quiet();
    clock.current = NOW;
    const everywhere = await create({ translations: { es: { title: 'Todos', imageAlt: 'A' } } });
    const onlyA = await create({ branchScope: 'SELECTED', branchIds: [branchA] });
    const scheduled = await create({ startsAt: at(60_000) });
    const expiring = await create({ endsAt: at(30_000) });
    expect(await storeIds()).toEqual(expect.arrayContaining([everywhere.id, expiring.id]));
    expect(await storeIds()).not.toContain(onlyA.id); // sin sucursal, solo los ALL
    expect(await storeIds()).not.toContain(scheduled.id);
    expect(await storeIds({ branchId: branchA })).toContain(onlyA.id);
    expect(await storeIds({ branchId: branchB })).not.toContain(onlyA.id);
    const res = await reader.findActiveBanners({ branchId: branchA, locale: 'en' });
    const item = res.items.find((i) => i.id === everywhere.id);
    expect(item).toMatchObject({ title: 'Todos', fallbackFields: ['title', 'imageAlt'] });
    expect(item?.image.url).toMatch(/^https:\/\/media\.mock\.invalid\/banners\//);
    expect(new Date(res.nextChangeAt as string).getTime()).toBeLessThanOrEqual(
      NOW.getTime() + 30_000,
    );
    // el reloj avanza: el vencido sale y el programado entra
    clock.current = new Date(NOW.getTime() + 60_000);
    const later = await storeIds();
    expect(later).toContain(scheduled.id);
    expect(later).not.toContain(expiring.id);
    clock.current = NOW;
    // imagen PENDING o de otro tipo: no se publica (defensa en profundidad del JOIN)
    const pending = await newAsset({ status: 'PENDING' });
    const product = await newAsset({ kind: 'PRODUCT_IMAGE' });
    const a = await create();
    await raw('UPDATE app.banners SET image_asset_id = $2 WHERE id = $1', [a.id, pending]);
    expect(await storeIds()).not.toContain(a.id);
    await raw('UPDATE app.banners SET image_asset_id = $2 WHERE id = $1', [a.id, product]);
    expect(await storeIds()).not.toContain(a.id);
  });

  it('tienda: destino de catálogo inactivo oculta el banner; fila `es` ausente no se publica', async (ctx) => {
    skipUnlessReady(ctx);
    await quiet();
    const cat = await newCategory('Temporal');
    const withCategory = await create({ cta: { type: 'CATEGORY', categoryId: cat } });
    const withProduct = await create({ cta: { type: 'PRODUCT', productId } });
    expect(await storeIds()).toEqual(expect.arrayContaining([withCategory.id, withProduct.id]));
    await raw('UPDATE app.categories SET active = false WHERE id = $1', [cat]);
    await raw('UPDATE app.products SET active = false WHERE id = $1', [productId]);
    expect(await storeIds()).not.toContain(withCategory.id);
    expect(await storeIds()).not.toContain(withProduct.id);
    expect((await admin.get(staff, withCategory.id)).hiddenReason).toBe('CTA_TARGET_INACTIVE');
    await raw('UPDATE app.products SET active = true WHERE id = $1', [productId]);
    const corrupt = await create();
    await raw(`DELETE FROM app.banner_translations WHERE banner_id = $1 AND locale = 'es'`, [
      corrupt.id,
    ]);
    expect(await storeIds()).not.toContain(corrupt.id);
  });

  it('tienda: banner con promoción solo mientras ésta rige y aplica a la sucursal; no revela el cupón', async (ctx) => {
    skipUnlessReady(ctx);
    await quiet();
    const live = await promotion({ code: `SEC${run.toUpperCase()}`, value: '90.00' });
    const onlyB = await promotion({ branchScope: 'SELECTED', branchIds: [branchB] });
    const inactive = await promotion();
    await promotions.updateStatus(staff, inactive.id, { active: false });
    const future = await promotion({
      startsAt: '2027-02-01T00:00:00-06:00',
      endsAt: '2027-03-01T00:00:00-06:00',
    });
    const ok = await create({ promotionId: live.id });
    const wrongBranch = await create({
      promotionId: onlyB.id,
      branchScope: 'SELECTED',
      branchIds: [branchB],
    });
    const stopped = await create({ promotionId: inactive.id });
    const notYet = await create({ promotionId: future.id });
    const ids = await storeIds({ branchId: branchA });
    expect(ids).toContain(ok.id);
    for (const hidden of [stopped.id, notYet.id, wrongBranch.id]) expect(ids).not.toContain(hidden);
    expect((await admin.get(staff, stopped.id)).hiddenReason).toBe('PROMOTION_NOT_LIVE');
    expect(
      JSON.stringify(await reader.findActiveBanners({ branchId: branchA, locale: 'es' })),
    ).not.toContain(`SEC${run.toUpperCase()}`);
    // alcance insuficiente al escribir
    const mismatch = await failure(create({ promotionId: onlyB.id }));
    expect(code(mismatch)).toBe('BANNER_PROMOTION_INVALID');
  });

  it('listado: filtros por estado derivado, búsqueda con comodines literales y acentos, orden, y alcance acotado', async (ctx) => {
    skipUnlessReady(ctx);
    const special = await create({
      translations: { es: { title: `Café 100% ${run}`, imageAlt: 'A' } },
    });
    const onlyB = await create({
      translations: { es: { title: `Solo B ${run}`, imageAlt: 'A' } },
      branchScope: 'SELECTED',
      branchIds: [branchB],
    });
    const expired = await create({
      endsAt: at(-1000),
      translations: { es: { title: `Viejo ${run}`, imageAlt: 'A' } },
    });
    const base = { page: 1, pageSize: 100 };
    const ids = async (q: Parameters<typeof admin.list>[1], who = staff) =>
      (await admin.list(who, q)).items.map((i) => i.id);
    expect(await ids({ ...base, q: `cafe 100% ${run}` })).toEqual([special.id]);
    expect(await ids({ ...base, q: `% ${run}` })).toEqual([special.id]);
    expect(await ids({ ...base, lifecycle: 'EXPIRED', q: run })).toEqual([expired.id]);
    expect(await ids({ ...base, q: run, sort: 'endsAt', order: 'desc' })).toContain(expired.id);
    const onlyA = scopedStaff(PERMS, [branchA], { staffId });
    expect(await ids({ ...base, q: run }, onlyA)).not.toContain(onlyB.id);
    expect(code(await failure(admin.list(onlyA, { ...base, branchId: branchB })))).toBe(
      'BRANCH_NOT_FOUND',
    );
    expect(
      (await admin.list(staff, { ...base, branchId: branchB })).items.map((i) => i.id),
    ).toContain(onlyB.id);
  });

  it('reordenado: conjunto exacto bajo candado de orden; version+1 solo en los cambiados; idempotente; concurrente = uno de los órdenes', async (ctx) => {
    skipUnlessReady(ctx);
    const rows = await raw<{ id: string }>(
      `SELECT id::text AS id FROM app.banners WHERE ends_at IS NULL OR ends_at > $1::timestamptz ORDER BY sort_order, created_at, id`,
      [NOW.toISOString()],
    );
    const current = rows.map((r) => r.id);
    if (current.some((id) => !bannerIds.has(id))) {
      ctx.skip('hay banners ajenos a la prueba en la base: no se reordena una base compartida');
      return;
    }
    const first = [...current].reverse();
    const out = await admin.reorder(staff, { orderedIds: first });
    expect(out.items.map((i) => i.id)).toEqual(first);
    expect(out.items.map((i) => i.sortOrder)).toEqual(first.map((_, i) => i));
    expect((await admin.reorder(staff, { orderedIds: first })).items).toEqual(out.items);
    expect(code(await failure(admin.reorder(staff, { orderedIds: first.slice(1) })))).toBe(
      'BANNER_REORDER_MISMATCH',
    );
    const second = [...current].sort(() => 0.5 - Math.random());
    const third = [...current];
    await Promise.all([
      admin.reorder(staff, { orderedIds: second }),
      admin.reorder(staff, { orderedIds: third }),
    ]);
    const final = (
      await raw<{ id: string }>(
        `SELECT id::text AS id FROM app.banners WHERE id = ANY($1::uuid[]) ORDER BY sort_order, created_at, id`,
        [current],
      )
    ).map((r) => r.id);
    expect([second, third]).toContainEqual(final); // nunca una mezcla
    expect(
      code(
        await failure(
          admin.reorder(scopedStaff(PERMS, [branchA], { staffId }), { orderedIds: current }),
        ),
      ),
    ).toBe('BANNER_SCOPE_FORBIDDEN');
  });

  it('tope de 100 banners no vencidos (SQL real de conteo)', async (ctx) => {
    skipUnlessReady(ctx);
    const have =
      (
        await raw<{ n: number }>(
          `SELECT count(*)::int AS n FROM app.banners WHERE ends_at IS NULL OR ends_at > $1::timestamptz`,
          [NOW.toISOString()],
        )
      )[0]?.n ?? 0;
    if (have > 0) {
      ctx.skip(
        'la base ya tiene banners no vencidos: no se llena hasta el tope en una base compartida',
      );
      return;
    }
    const filler = await raw<{ id: string }>(
      `INSERT INTO app.banners (code, image_asset_id, cta_type, sort_order)
       SELECT $1 || '-' || g, $2::uuid, 'NONE', g FROM generate_series(1, 100) g RETURNING id::text AS id`,
      [`fill${run}`, image],
    );
    for (const f of filler) bannerIds.add(f.id);
    expect(code(await failure(create()))).toBe('BANNER_LIMIT_REACHED');
    await raw('DELETE FROM app.banners WHERE id = ANY($1::uuid[])', [filler.map((f) => f.id)]);
  });

  it('tope de 100 con altas concurrentes: con 99 no vencidos solo una tiene éxito (candado de orden)', async (ctx) => {
    skipUnlessReady(ctx);
    const have =
      (
        await raw<{ n: number }>(
          `SELECT count(*)::int AS n FROM app.banners WHERE ends_at IS NULL OR ends_at > $1::timestamptz`,
          [NOW.toISOString()],
        )
      )[0]?.n ?? 0;
    if (have > 0) {
      ctx.skip(
        'la base ya tiene banners no vencidos: no se llena hasta el tope en una base compartida',
      );
      return;
    }
    const filler = await raw<{ id: string }>(
      `INSERT INTO app.banners (code, image_asset_id, cta_type, sort_order)
       SELECT $1 || '-' || g, $2::uuid, 'NONE', g FROM generate_series(1, 99) g RETURNING id::text AS id`,
      [`race${run}`, image],
    );
    for (const f of filler) bannerIds.add(f.id);
    try {
      const results = await Promise.all([
        failure(create({ code: `carrera-a-${run}` })),
        failure(create({ code: `carrera-b-${run}` })),
      ]);
      expect(results.filter((r) => r === null)).toHaveLength(1);
      expect(results.filter((r) => r !== null).map(code)).toEqual(['BANNER_LIMIT_REACHED']);
    } finally {
      await raw('DELETE FROM app.banners WHERE id = ANY($1::uuid[])', [filler.map((f) => f.id)]);
    }
  });

  it('F14: usageCount y bannerUsages cuentan banners; el asset en uso no se borra (FK RESTRICT => 23503)', async (ctx) => {
    skipUnlessReady(ctx);
    const asset = await newAsset();
    const b = await create({ imageAssetId: asset });
    const row = await media.findById(asset);
    expect(row?.usageCount).toBe(1);
    expect((await media.findBannerUsages(asset)).map((u) => u.bannerId)).toEqual([b.id]);
    const page = await media.findPage({
      unreferenced: false,
      kind: 'BANNER_IMAGE',
      page: 1,
      pageSize: 100,
    });
    expect(page.rows.map((r) => r.id)).toContain(asset);
    await expect(raw('DELETE FROM app.media_assets WHERE id = $1', [asset])).rejects.toMatchObject({
      code: '23503',
    });
    // reemplazar la imagen NO borra el asset anterior: queda sin uso
    const next = await newAsset();
    await admin.update(staff, b.id, { expectedVersion: 1, imageAssetId: next });
    expect((await media.findById(asset))?.usageCount).toBe(0);
    const unused = await media.findPage({
      unreferenced: true,
      kind: 'BANNER_IMAGE',
      page: 1,
      pageSize: 100,
    });
    expect(unused.rows.map((r) => r.id)).toContain(asset);
  });

  it('F14: tipo BANNER_IMAGE en SQL real: > 1 MiB y prefijo de clave cruzado los rechaza la BD', async (ctx) => {
    skipUnlessReady(ctx);
    const insert = (kind: string, key: string, size: number) =>
      raw(
        `INSERT INTO app.media_assets (kind, object_key, bucket, mime_type, size_bytes, checksum_sha256, status, confirmed_at)
         VALUES ($1, $2, 'bucket-test', 'image/webp', $3, $4, 'READY', now())`,
        [kind, key, size, hex64()],
      );
    await expect(
      insert('BANNER_IMAGE', `banners/2026/${randomUUID()}.webp`, 1_048_577),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      insert('BANNER_IMAGE', `products/2026/${randomUUID()}.webp`, 1000),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      insert('PRODUCT_IMAGE', `banners/2026/${randomUUID()}.webp`, 1000),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('FK RESTRICT: no se puede borrar una sucursal, categoría, producto, promoción ni asset referenciados', async (ctx) => {
    skipUnlessReady(ctx);
    const cat = await newCategory('Ref');
    const promo = await promotion();
    const asset = await newAsset();
    await create({
      imageAssetId: asset,
      branchScope: 'SELECTED',
      branchIds: [branchB],
      cta: { type: 'CATEGORY', categoryId: cat },
      promotionId: promo.id,
    });
    await create({ cta: { type: 'PRODUCT', productId } });
    const blocked: [string, string][] = [
      ['DELETE FROM app.branches WHERE id = $1', branchB],
      ['DELETE FROM app.categories WHERE id = $1', cat],
      ['DELETE FROM app.products WHERE id = $1', productId],
      ['DELETE FROM app.promotions WHERE id = $1', promo.id],
      ['DELETE FROM app.media_assets WHERE id = $1', asset],
    ];
    for (const [sql, id] of blocked)
      await expect(raw(sql, [id])).rejects.toMatchObject({ code: '23503' });
  });
});
