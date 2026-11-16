import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../src/audit/audit.service.js';
import { AuthorizationService } from '../src/auth/authorization.service.js';
import { AdminCategoriesService } from '../src/categories/admin-categories.service.js';
import { CategoriesQueryService } from '../src/categories/categories-query.service.js';
import { CategoriesRepository } from '../src/categories/categories.repository.js';
import { validateEnv, type Env } from '../src/config/env.js';
import { PrismaService } from '../src/database/prisma.service.js';
import type { IdentityService } from '../src/identity/identity.service.js';
import { globalStaff } from './support/staff-context.js';
import { TEST_URL, withClient } from './support/db.js';

const url = TEST_URL;

/** Se omite si no hay DATABASE_URL_TEST o si la migración 0011 aún no está aplicada (`app.categories` ausente). */
const hasCategories = url
  ? await withClient(url, async (c) => {
      const res = await c.query<{ oid: string | null }>(
        `SELECT to_regclass('app.categories') AS oid`,
      );
      return res.rows[0]?.oid != null;
    }).catch(() => false)
  : false;

describe.skipIf(!url || !hasCategories)('Categorías contra PostgreSQL real', () => {
  const run = randomUUID().slice(0, 8);
  const staff = globalStaff(['catalog.read', 'catalog.create', 'catalog.update'], {
    staffId: randomUUID(),
  });
  let prisma: PrismaService;
  let commands: AdminCategoriesService;
  let queries: CategoriesQueryService;
  const created: string[] = [];

  const make = async (name: string, parentId: string | null = null) => {
    const view = await commands.create(staff, { name: `${name} ${run}`, parentId });
    created.push(view.id);
    return view;
  };

  beforeAll(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    prisma = new PrismaService(
      new ConfigService<Env, true>(validateEnv({ DATABASE_URL: url, NODE_ENV: 'test' })),
    );
    const repo = new CategoriesRepository(prisma);
    commands = new AdminCategoriesService(
      repo,
      new AuditService(),
      new AuthorizationService({} as IdentityService),
    );
    queries = new CategoriesQueryService(repo);
  });
  afterAll(async () => {
    // FK RESTRICT: se borran primero las hojas, repetidamente (máx. 3 niveles).
    for (let i = 0; i < 4; i += 1) {
      await prisma.category.deleteMany({
        where: { id: { in: created }, children: { none: {} } },
      });
    }
    await prisma.$disconnect();
  });

  it('crea árbol de 3 niveles, rechaza el 4.º y autogenera/desambigua slugs', async () => {
    const a = await make('Rolls');
    const b = await make('Frios', a.id);
    const c = await make('Veganos', b.id);
    expect([a.depth, b.depth, c.depth]).toEqual([1, 2, 3]);
    await expect(make('Nivel4', c.id)).rejects.toMatchObject({
      response: { code: 'CATEGORY_DEPTH_EXCEEDED' },
    });
    const twin = await commands.create(staff, { name: `Rolls ${run}` });
    created.push(twin.id);
    expect(twin.slug).toBe(`${a.slug}-2`);
    await expect(commands.create(staff, { name: 'X', slug: a.slug })).rejects.toMatchObject({
      status: 409,
      response: { code: 'CATEGORY_SLUG_TAKEN' },
    });
  });

  it('mover: ciclo rechazado por la API y por el trigger de BD (defensa en profundidad)', async () => {
    const a = await make('Ciclo A');
    const b = await make('Ciclo B', a.id);
    await expect(commands.update(staff, a.id, { parentId: b.id })).rejects.toMatchObject({
      response: { code: 'CATEGORY_CYCLE' },
    });
    await expect(
      prisma.category.update({ where: { id: a.id }, data: { parentId: b.id } }),
    ).rejects.toThrow();
  });

  it('dos reparentados simultáneos (A bajo B y B bajo A): exactamente uno gana, sin ciclo', async () => {
    const a = await make('Carrera A');
    const b = await make('Carrera B');
    const results = await Promise.allSettled([
      commands.update(staff, a.id, { parentId: b.id }),
      commands.update(staff, b.id, { parentId: a.id }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ response: { code: 'CATEGORY_CYCLE' } });
  });

  it('reorder: 0..n-1, idempotente y con auditoría única', async () => {
    const p = await make('Orden');
    const x = await make('X', p.id);
    const y = await make('Y', p.id);
    const swapped = await commands.reorder(staff, { parentId: p.id, orderedIds: [y.id, x.id] });
    expect(swapped.items.map((i) => [i.id, i.sortOrder])).toEqual([
      [y.id, 0],
      [x.id, 1],
    ]);
    await commands.reorder(staff, { parentId: p.id, orderedIds: [y.id, x.id] });
    const events = await prisma.auditEvent.findMany({
      where: { entityType: 'category', entityId: p.id, action: 'category.reordered' },
    });
    expect(events).toHaveLength(1);
    await expect(
      commands.reorder(staff, { parentId: p.id, orderedIds: [y.id] }),
    ).rejects.toMatchObject({ response: { code: 'CATEGORY_REORDER_MISMATCH' } });
  });

  it('visibilidad: desactivar un padre oculta el subárbol sin tocar a los hijos', async () => {
    const p = await make('Visible');
    const child = await make('Hija', p.id);
    expect((await queries.getVisibleIds()).includes(child.id)).toBe(true);
    await commands.update(staff, p.id, { active: false });
    expect((await queries.getVisibleIds()).includes(child.id)).toBe(false);
    const row = await prisma.category.findUniqueOrThrow({ where: { id: child.id } });
    expect(row.active).toBe(true);
    expect(await queries.findVisibleBySlug(child.slug)).toBeNull();
  });
});
