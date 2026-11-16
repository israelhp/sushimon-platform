import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import { AuthorizationService } from '../src/auth/authorization.service.js';
import { AdminCategoriesService } from '../src/categories/admin-categories.service.js';
import { CategoriesQueryService } from '../src/categories/categories-query.service.js';
import { CategoriesRepository } from '../src/categories/categories.repository.js';
import { validateEnv, type Env } from '../src/config/env.js';
import { PrismaService } from '../src/database/prisma.service.js';
import type { IdentityService } from '../src/identity/identity.service.js';
import { AdminModifiersService } from '../src/modifiers/admin-modifiers.service.js';
import { ModifierSelectionService } from '../src/modifiers/modifier-selection.service.js';
import { ModifiersQueryService } from '../src/modifiers/modifiers-query.service.js';
import { ModifiersRepository } from '../src/modifiers/modifiers.repository.js';
import { AdminProductsService } from '../src/products/admin-products.service.js';
import { ProductsRepository } from '../src/products/products.repository.js';
import { cleanupTestData, TEST_URL, withClient } from './support/db.js';
import { globalStaff } from './support/staff-context.js';

const url = TEST_URL;

/**
 * Se omite (con aviso) si no hay DATABASE_URL_TEST o si la migración 0013 aún no está aplicada
 * (`app.modifier_groups` ausente). La 0013 requiere aprobación humana y NO se aplica desde aquí: hasta entonces el SQL de
 * F12 (conteos agregados, FOR NO KEY UPDATE, reorden con UNIQUE DEFERRABLE, DELETE+INSERT de asociaciones, índices
 * únicos por expresión, triggers de tope) NO está probado contra PostgreSQL real.
 */
const ready = url
  ? await withClient(url, async (c) => {
      const res = await c.query<{ g: string | null; p: string | null }>(
        `SELECT to_regclass('app.modifier_groups') AS g, to_regclass('app.products') AS p`,
      );
      return res.rows[0]?.g != null && res.rows[0]?.p != null;
    }).catch(() => false)
  : false;
if (url && !ready) {
  console.warn(
    '[modifiers.int-spec] OMITIDA: app.modifier_groups no existe en DATABASE_URL_TEST (migración 0013 sin aplicar). El SQL de F12 NO se probó contra PostgreSQL real.',
  );
}

describe.skipIf(!url || !ready)('Modificadores contra PostgreSQL real', () => {
  const run = randomUUID().slice(0, 8);
  const staff = globalStaff(['catalog.read', 'catalog.create', 'catalog.update'], {
    staffId: randomUUID(),
  });
  let prisma: PrismaService;
  let admin: AdminModifiersService;
  let queries: ModifiersQueryService;
  let selection: ModifierSelectionService;
  let products: AdminProductsService;
  let categories: AdminCategoriesService;
  const productIds = new Set<string>();
  const categoryIds = new Set<string>();
  const groupIds = new Set<string>();

  const code = (e: unknown) => (e as { response?: { code?: string } }).response?.code;
  const failure = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: unknown) => e,
    );
  const skipUnlessReady = (ctx: TestContext) => {
    if (!ready) ctx.skip('app.modifier_groups no existe en DATABASE_URL_TEST (0013 sin aplicar)');
  };
  const group = async (
    name: string,
    over: Parameters<AdminModifiersService['createGroup']>[1] = { name },
  ) => {
    const view = await admin.createGroup(staff, { ...over, name: `${name} ${run}` });
    groupIds.add(view.id);
    return view;
  };
  const product = async (name: string) => {
    const cat = await categories.create(staff, {
      name: `Cat ${name} ${run}`,
      parentId: null,
      active: true,
    });
    categoryIds.add(cat.id);
    const view = await products.create(staff, {
      name: `${name} ${run}`,
      basePrice: '10.00',
      categoryId: cat.id,
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
    const repo = new ModifiersRepository(prisma);
    queries = new ModifiersQueryService(repo);
    admin = new AdminModifiersService(repo, queries, audit, authorization);
    selection = new ModifierSelectionService(repo);
    const catRepo = new CategoriesRepository(prisma);
    categories = new AdminCategoriesService(catRepo, audit, authorization);
    products = new AdminProductsService(
      new ProductsRepository(prisma),
      audit,
      authorization,
      new CategoriesQueryService(catRepo),
      { get: () => [] } as unknown as ConfigService<Env, true>,
    );
  });
  afterAll(async () => {
    await prisma.$disconnect();
    if (ready && url) {
      // Borra primero productos/categorías (la asociación cae en cascada) y luego los grupos propios.
      await cleanupTestData(url, { authUserIds: [], branchIds: [], productIds, categoryIds });
      await withClient(url, async (c) => {
        const ids = [...groupIds];
        await c.query('DELETE FROM app.modifiers WHERE group_id = ANY($1::uuid[])', [ids]);
        await c.query('DELETE FROM app.modifier_groups WHERE id = ANY($1::uuid[])', [ids]);
      });
    }
  });

  it('crea grupo con opciones; precio exacto; conteos agregados en la lista; nombre único sin mayúsculas (índice real)', async (ctx) => {
    skipUnlessReady(ctx);
    const g = await group('Salsas', {
      name: 'x',
      minSelect: 1,
      maxSelect: 2,
      options: [
        { name: 'Soya', extraPrice: '0.10' },
        { name: 'Picante', extraPrice: '0.20' },
      ],
    });
    expect(g).toMatchObject({
      required: true,
      optionCount: 2,
      activeOptionCount: 2,
      productCount: 0,
    });
    expect(g.options.map((o) => [o.name, o.extraPrice, o.sortOrder])).toEqual([
      ['Soya', '0.10', 0],
      ['Picante', '0.20', 1],
    ]);
    const dup = await failure(admin.createGroup(staff, { name: `SALSAS ${run}` }));
    expect(code(dup)).toBe('MODIFIER_GROUP_NAME_TAKEN');
    const dupOpt = await failure(admin.createOption(staff, g.id, { name: 'soya' }));
    expect(code(dupOpt)).toBe('MODIFIER_NAME_TAKEN');
    const page = await queries.listGroups({ q: `salsas ${run}`, page: 1, pageSize: 20 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ optionCount: 2, activeOptionCount: 2 });
  });

  it('altas y renombres concurrentes del mismo nombre (otra capitalización/espacios): un éxito y un 409, nunca 500', async (ctx) => {
    skipUnlessReady(ctx);
    const settle = (ps: Promise<unknown>[]) =>
      Promise.allSettled(ps).then((rs) =>
        rs.map((r) => (r.status === 'fulfilled' ? 'ok' : (code(r.reason) ?? 'ERROR'))),
      );
    // grupos
    const names = [`Concurrente ${run}`, `  CONCURRENTE   ${run} `];
    const created = await settle(names.map((name) => admin.createGroup(staff, { name })));
    expect(created.sort()).toEqual(['MODIFIER_GROUP_NAME_TAKEN', 'ok']);
    const okGroup = (await queries.listGroups({ q: `concurrente ${run}`, page: 1, pageSize: 5 }))
      .items[0];
    if (okGroup) groupIds.add(okGroup.id);
    // renombres de grupos distintos al mismo nombre
    const a = await group('RenA', { name: 'x' });
    const b = await group('RenB', { name: 'x' });
    const target = `Destino ${run}`;
    const renamed = await settle([
      admin.updateGroup(staff, a.id, { name: target }),
      admin.updateGroup(staff, b.id, { name: `  DESTINO ${run}` }),
    ]);
    expect(renamed.sort()).toEqual(['MODIFIER_GROUP_NAME_TAKEN', 'ok']);
    // opciones del mismo grupo
    const g = await group('OptConc', { name: 'x' });
    const opts = await settle([
      admin.createOption(staff, g.id, { name: 'Salsa' }),
      admin.createOption(staff, g.id, { name: ' SALSA ' }),
    ]);
    expect(opts.sort()).toEqual(['MODIFIER_NAME_TAKEN', 'ok']);
    const g2 = await group('OptRen', { name: 'x', options: [{ name: 'uno' }, { name: 'dos' }] });
    const [o1, o2] = g2.options as [(typeof g2.options)[number], (typeof g2.options)[number]];
    const ren = await settle([
      admin.updateOption(staff, o1.id, { name: 'Igual' }),
      admin.updateOption(staff, o2.id, { name: ' IGUAL' }),
    ]);
    expect(ren.sort()).toEqual(['MODIFIER_NAME_TAKEN', 'ok']);
  });

  it('reordena con UNIQUE DEFERRABLE (0..n-1) y es idempotente', async (ctx) => {
    skipUnlessReady(ctx);
    const g = await group('Orden', {
      name: 'x',
      options: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
    });
    const [a, b, c] = g.options.map((o) => o.id) as [string, string, string];
    const r = await admin.reorderOptions(staff, g.id, [c, a, b]);
    expect(r.items.map((i) => [i.id, i.sortOrder])).toEqual([
      [c, 0],
      [a, 1],
      [b, 2],
    ]);
    expect(code(await failure(admin.reorderOptions(staff, g.id, [a, b])))).toBe(
      'MODIFIER_REORDER_MISMATCH',
    );
  });

  it('D3: desactivar una opción que deja el grupo activo insatisfecho => 422', async (ctx) => {
    skipUnlessReady(ctx);
    const g = await group('Min', {
      name: 'x',
      minSelect: 2,
      maxSelect: 2,
      options: [{ name: 'a' }, { name: 'b' }],
    });
    const e = await failure(admin.updateOption(staff, g.options[0]!.id, { active: false }));
    expect(code(e)).toBe('MODIFIER_GROUP_UNSATISFIABLE');
  });

  it('crea opciones concurrentes en el mismo grupo: serializadas por el bloqueo del grupo', async (ctx) => {
    skipUnlessReady(ctx);
    const g = await group('Conc', { name: 'x' });
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => admin.createOption(staff, g.id, { name: `o${i}` })),
    );
    expect(new Set(results.map((r) => r.sortOrder)).size).toBe(5);
    expect((await queries.getGroup(g.id)).options).toHaveLength(5);
  });

  it('tope de 30 opciones (servicio) y asociación a productos: orden, reemplazo, ficha y validador', async (ctx) => {
    skipUnlessReady(ctx);
    const full = await group('Tope', {
      name: 'x',
      options: Array.from({ length: 30 }, (_, i) => ({ name: `o${i}` })),
    });
    expect(code(await failure(admin.createOption(staff, full.id, { name: 'extra' })))).toBe(
      'MODIFIER_LIMIT_REACHED',
    );

    const p = await product('Roll');
    const g1 = await group('G1', {
      name: 'x',
      minSelect: 1,
      options: [{ name: 'Soya', extraPrice: '0.10' }],
    });
    const g2 = await group('G2', { name: 'x', options: [{ name: 'Queso', extraPrice: '0.20' }] });
    const inactive = await group('G3', { name: 'x', active: false });
    const set = await admin.replaceProductGroups(staff, p.id, [g2.id, g1.id]);
    expect(set.groups.map((g) => g.id)).toEqual([g2.id, g1.id]);
    expect(set.groups[0]?.productCount).toBe(1);
    expect(code(await failure(admin.replaceProductGroups(staff, p.id, [g1.id, inactive.id])))).toBe(
      'MODIFIER_GROUP_INVALID',
    );
    expect((await queries.getProductModifiers(p.id)).groups).toHaveLength(2);

    const pub = await queries.findPublicGroupsForProduct(p.id);
    expect(pub.map((g) => g.id)).toEqual([g2.id, g1.id]);

    const ok = await selection.validate(p.id, [
      { groupId: g1.id, modifierIds: [g1.options[0]!.id] },
      { groupId: g2.id, modifierIds: [g2.options[0]!.id] },
    ]);
    expect(ok.extraTotal).toBe('0.30');
    const bad = (await failure(selection.validate(p.id, []))) as {
      response: { code: string; violations: { code: string }[] };
    };
    expect(bad.response.code).toBe('MODIFIER_SELECTION_INVALID');
    expect(bad.response.violations.map((v) => v.code)).toEqual(['MODIFIER_REQUIRED']);

    const cleared = await admin.replaceProductGroups(staff, p.id, []);
    expect(cleared.groups).toEqual([]);
  });

  it('producto inexistente => 404 PRODUCT_NOT_FOUND', async (ctx) => {
    skipUnlessReady(ctx);
    const missing = randomUUID();
    expect(code(await failure(queries.getProductModifiers(missing)))).toBe('PRODUCT_NOT_FOUND');
    expect(code(await failure(selection.validate(missing, [])))).toBe('PRODUCT_NOT_FOUND');
  });
});
