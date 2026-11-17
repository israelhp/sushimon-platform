import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import { AuthorizationService } from '../src/auth/authorization.service.js';
import { AdminBranchProductsService } from '../src/branch-products/admin-branch-products.service.js';
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
import { cleanupTestData, TEST_URL, withClient } from './support/db.js';
import { globalStaff } from './support/staff-context.js';

const url = TEST_URL;

/**
 * Se omite (con aviso) si no hay DATABASE_URL_TEST o si la migración 0014 aún no está aplicada
 * (`app.branch_products` ausente). La 0014 requiere aprobación humana y NO se aplica desde aquí: hasta entonces el SQL de
 * F13 (upsert por columna, DELETE condicional, LEFT JOIN por sucursal, ANY(uuid[]), CHECK/FK) NO está probado contra
 * PostgreSQL real.
 */
const ready = url
  ? await withClient(url, async (c) => {
      const res = await c.query<{ b: string | null; p: string | null }>(
        `SELECT to_regclass('app.branch_products') AS b, to_regclass('app.products') AS p`,
      );
      return res.rows[0]?.b != null && res.rows[0]?.p != null;
    }).catch(() => false)
  : false;
if (url && !ready) {
  console.warn(
    '[branch-products.int-spec] OMITIDA: app.branch_products no existe en DATABASE_URL_TEST (migración 0014 sin aplicar). El SQL de F13 NO se probó contra PostgreSQL real.',
  );
}

describe.skipIf(!url || !ready)(
  'Precio y disponibilidad por sucursal contra PostgreSQL real',
  () => {
    const run = randomUUID().slice(0, 8);
    const staff = globalStaff(
      ['catalog.read', 'catalog.create', 'catalog.update', 'catalog.manage_availability'],
      { staffId: randomUUID() },
    );
    let prisma: PrismaService;
    let admin: AdminBranchProductsService;
    let offers: BranchOffersService;
    let products: AdminProductsService;
    let categories: AdminCategoriesService;
    const productIds = new Set<string>();
    const categoryIds = new Set<string>();
    const branchIds = new Set<string>();

    const code = (e: unknown) => (e as { response?: { code?: string } }).response?.code;
    const failure = (p: Promise<unknown>) =>
      p.then(
        () => null,
        (e: unknown) => e,
      );
    const skipUnlessReady = (ctx: TestContext) => {
      if (!ready) ctx.skip('app.branch_products no existe en DATABASE_URL_TEST (0014 sin aplicar)');
    };
    const rows = (branchId: string, productId: string) =>
      withClient(
        url!,
        async (c) =>
          (
            await c.query<{ price_override: string | null; available: boolean }>(
              'SELECT price_override::text, available FROM app.branch_products WHERE branch_id = $1 AND product_id = $2',
              [branchId, productId],
            )
          ).rows,
      );
    const newBranch = async (active = true) => {
      const b = await prisma.branch.create({
        data: {
          code: `bp-${run}-${randomUUID().slice(0, 6)}`,
          name: `Suc ${run}`,
          address: 'Zona 1',
          active,
        },
      });
      branchIds.add(b.id);
      return b.id;
    };
    const newProduct = async (name: string, basePrice = '50.00', active = true) => {
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
        active,
      });
      productIds.add(view.id);
      return view;
    };

    beforeAll(() => {
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
      const repo = new BranchProductsRepository(prisma);
      admin = new AdminBranchProductsService(repo, audit, authorization, catQuery);
      offers = new BranchOffersService(repo, catQuery);
      categories = new AdminCategoriesService(catRepo, audit, authorization);
      products = new AdminProductsService(
        new ProductsRepository(prisma),
        audit,
        authorization,
        catQuery,
        { get: () => [] } as unknown as ConfigService<Env, true>,
      );
    });
    afterAll(async () => {
      await prisma.$disconnect();
      if (ready && url) {
        await cleanupTestData(url, { authUserIds: [], branchIds, productIds, categoryIds });
      }
    });

    it('precio de sucursal: upsert, precio efectivo por sucursal y borrado de la fila al volver al defecto', async (ctx) => {
      skipUnlessReady(ctx);
      const [a, b] = [await newBranch(), await newBranch()];
      const p = await newProduct('Roll');
      const set = await admin.setPricing(staff, a, p.id, { priceOverride: '45.50' });
      expect(set).toMatchObject({
        priceOverride: '45.50',
        effectivePrice: '45.50',
        basePrice: '50.00',
      });
      expect(await rows(a, p.id)).toEqual([{ price_override: '45.50', available: true }]);
      expect(await rows(b, p.id)).toEqual([]);
      expect((await offers.resolve(a, [p.id])).get(p.id)?.price).toBe('45.50');
      expect((await offers.resolve(b, [p.id])).get(p.id)?.price).toBe('50.00');
      await admin.setPricing(staff, a, p.id, { priceOverride: null });
      expect(await rows(a, p.id)).toEqual([]);
    });

    it('disponibilidad y precio se mezclan por columna; la fila solo se borra con ambos en el defecto', async (ctx) => {
      skipUnlessReady(ctx);
      const a = await newBranch();
      const p = await newProduct('Mezcla');
      await admin.setAvailability(staff, p.id, { branchId: a, available: false });
      await admin.setPricing(staff, a, p.id, { priceOverride: '40.00' });
      expect(await rows(a, p.id)).toEqual([{ price_override: '40.00', available: false }]);
      await admin.setPricing(staff, a, p.id, { priceOverride: null });
      expect(await rows(a, p.id)).toEqual([{ price_override: null, available: false }]);
      await admin.setAvailability(staff, p.id, { branchId: a, available: true });
      expect(await rows(a, p.id)).toEqual([]);
    });

    it('PUT y PATCH concurrentes sobre la misma fila nueva no se pisan ni dan 500', async (ctx) => {
      skipUnlessReady(ctx);
      const a = await newBranch();
      const p = await newProduct('Concurrente');
      const results = await Promise.allSettled([
        admin.setPricing(staff, a, p.id, { priceOverride: '33.00' }),
        admin.setAvailability(staff, p.id, { branchId: a, available: false }),
      ]);
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
      expect(await rows(a, p.id)).toEqual([{ price_override: '33.00', available: false }]);
    });

    it('CHECK de la BD respalda la regla: override 0 o > 999999.99 es rechazado; FK RESTRICT', async (ctx) => {
      skipUnlessReady(ctx);
      const a = await newBranch();
      const p = await newProduct('Check');
      await withClient(url!, async (c) => {
        await expect(
          c.query(
            'INSERT INTO app.branch_products (branch_id, product_id, price_override) VALUES ($1, $2, 0)',
            [a, p.id],
          ),
        ).rejects.toMatchObject({ code: '23514' });
        await expect(
          c.query(
            'INSERT INTO app.branch_products (branch_id, product_id, price_override) VALUES ($1, $2, 1000000.00)',
            [a, p.id],
          ),
        ).rejects.toMatchObject({ code: '23514' });
      });
      await admin.setAvailability(staff, p.id, { branchId: a, available: false });
      await withClient(url!, async (c) => {
        await expect(c.query('DELETE FROM app.branches WHERE id = $1', [a])).rejects.toMatchObject({
          code: '23503',
        });
        await expect(
          c.query('DELETE FROM app.products WHERE id = $1', [p.id]),
        ).rejects.toMatchObject({ code: '23503' });
      });
    });

    it('errores de dominio: sucursal/producto inexistentes y "0.00"', async (ctx) => {
      skipUnlessReady(ctx);
      const a = await newBranch();
      const p = await newProduct('Errores');
      expect(
        code(await failure(admin.setPricing(staff, randomUUID(), p.id, { priceOverride: '1.00' }))),
      ).toBe('BRANCH_NOT_FOUND');
      expect(
        code(await failure(admin.setPricing(staff, a, randomUUID(), { priceOverride: '1.00' }))),
      ).toBe('PRODUCT_NOT_FOUND');
      expect(code(await failure(admin.setPricing(staff, a, p.id, { priceOverride: '0.00' })))).toBe(
        'BRANCH_PRICE_INVALID',
      );
      expect(await rows(a, p.id)).toEqual([]);
    });

    it('matriz por sucursal y por producto: filtros, conteos y alcance', async (ctx) => {
      skipUnlessReady(ctx);
      const [a, b] = [await newBranch(), await newBranch()];
      const p = await newProduct('Matriz');
      await admin.setPricing(staff, a, p.id, { priceOverride: '41.00' });
      const page = await admin.listForBranch(staff, a, {
        q: `matriz ${run}`,
        hasOverride: true,
        page: 1,
        pageSize: 20,
      });
      expect(page.total).toBe(1);
      expect(page.items[0]).toMatchObject({
        productId: p.id,
        priceOverride: '41.00',
        offered: true,
      });
      const none = await admin.listForBranch(staff, b, {
        q: `matriz ${run}`,
        hasOverride: true,
        page: 1,
        pageSize: 20,
      });
      expect(none.total).toBe(0);
      const wildcard = await admin.listForBranch(staff, a, { q: '%', page: 1, pageSize: 20 });
      expect(wildcard.items.every((i) => /%/.test(`${i.name}${i.slug}${i.sku ?? ''}`))).toBe(true);
      const perProduct = await admin.listForProduct(staff, p.id);
      expect(perProduct.items.find((i) => i.branchId === a)).toMatchObject({
        priceOverride: '41.00',
      });
      expect(perProduct.items.find((i) => i.branchId === b)).toMatchObject({
        priceOverride: null,
        updatedAt: null,
      });
    });

    it('BranchOffersService: resolve en una consulta y assertOrderable con violaciones', async (ctx) => {
      skipUnlessReady(ctx);
      const a = await newBranch();
      const ok = await newProduct('Ordenable', '20.00');
      const out = await newProduct('Agotado', '30.00');
      const off = await newProduct('Inactivo', '40.00', false);
      await admin.setAvailability(staff, out.id, { branchId: a, available: false });
      const map = await offers.resolve(a, [ok.id, out.id, out.id, randomUUID()]);
      expect(map.size).toBe(2);
      expect(map.get(ok.id)).toEqual({ price: '20.00', basePrice: '20.00', available: true });
      await expect(offers.assertOrderable(a, [ok.id])).resolves.toBeUndefined();
      const e = await failure(offers.assertOrderable(a, [out.id, off.id]));
      expect(code(e)).toBe('PRODUCT_NOT_AVAILABLE');
      const violations = (e as { response: { violations: { code: string }[] } }).response
        .violations;
      expect(violations.map((v) => v.code)).toEqual(['PRODUCT_SOLD_OUT', 'PRODUCT_HIDDEN']);
      expect(code(await failure(offers.assertOrderable(randomUUID(), [ok.id])))).toBe(
        'BRANCH_NOT_AVAILABLE',
      );
    });
  },
);
