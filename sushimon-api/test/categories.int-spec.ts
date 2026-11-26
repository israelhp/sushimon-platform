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
  /** Filas propias que referencian categorías (se borran ANTES que las categorías: FK RESTRICT). */
  const productIds: string[] = [];
  const bannerIds: string[] = [];
  const assetIds: string[] = [];

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
    await withClient(url as string, async (c) => {
      await c.query('DELETE FROM app.banners WHERE id = ANY($1::uuid[])', [bannerIds]);
      await c.query('DELETE FROM app.media_assets WHERE id = ANY($1::uuid[])', [assetIds]);
    });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
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

  describe('DELETE (ADR-0034)', () => {
    const remaining = (id: string) => prisma.category.findUnique({ where: { id } });
    const deletedAudit = (id: string) =>
      prisma.auditEvent.findMany({
        where: { entityType: 'category', entityId: id, action: 'category.deleted' },
      });

    it('categoría libre: se elimina físicamente, audita category.deleted y el slug queda libre', async () => {
      const root = await make('Borrar raíz');
      const sib = await make('Hermana');
      await commands.remove(staff, root.id);
      expect(await remaining(root.id)).toBeNull();
      const events = await deletedAudit(root.id);
      expect(events).toHaveLength(1);
      expect(events[0]?.oldValues).toMatchObject({
        id: root.id,
        slug: root.slug,
        name: root.name,
        parentId: null,
        active: true,
      });
      // los hermanos conservan su sortOrder (sin renumerar)
      expect((await remaining(sib.id))?.sortOrder).toBe(sib.sortOrder);
      await expect(commands.remove(staff, root.id)).rejects.toMatchObject({ status: 404 });
      const again = await commands.create(staff, { name: 'Otra', slug: root.slug });
      created.push(again.id);
    });

    it('con hijas => 409 CATEGORY_IN_USE y no toca a las hijas; sin hijas se puede borrar', async () => {
      const parent = await make('Padre borrar');
      const child = await make('Hija borrar', parent.id);
      await expect(commands.remove(staff, parent.id)).rejects.toMatchObject({
        status: 409,
        response: {
          code: 'CATEGORY_IN_USE',
          extra: { usage: { children: 1, products: 0, banners: 0 } },
        },
      });
      expect(await remaining(parent.id)).not.toBeNull();
      expect((await remaining(child.id))?.parentId).toBe(parent.id);
      expect(await deletedAudit(parent.id)).toHaveLength(0);
      await commands.remove(staff, child.id);
      await commands.remove(staff, parent.id);
      expect(await remaining(parent.id)).toBeNull();
    });

    it('con productos (activos o inactivos) => 409 y el producto queda intacto', async () => {
      const cat = await make('Con productos');
      for (const active of [true, false]) {
        const product = await prisma.product.create({
          data: {
            categoryId: cat.id,
            slug: `del-${run}-${active ? 'on' : 'off'}`,
            name: `Producto ${run} ${active ? 'on' : 'off'}`,
            basePrice: '10.00',
            active,
          },
        });
        productIds.push(product.id);
      }
      await expect(commands.remove(staff, cat.id)).rejects.toMatchObject({
        status: 409,
        response: { code: 'CATEGORY_IN_USE', extra: { usage: { children: 0, products: 2 } } },
      });
      const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
      expect(products.every((p) => p.categoryId === cat.id)).toBe(true);
      expect(await remaining(cat.id)).not.toBeNull();
    });

    it('con banner residual (cta_category_id) => 409 con banners=1 (si hay cupo de banners)', async () => {
      const cat = await make('Con banner');
      const assetId = randomUUID();
      const bannerId = randomUUID();
      const placed = await withClient(url as string, async (c) => {
        // Cupo propio: el tope de 5 banners es de BD (migración 0023); sin cupo no se fuerza nada.
        const total = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM app.banners');
        if ((total.rows[0]?.n ?? 5) >= 5) return false;
        await c.query(
          `INSERT INTO app.media_assets (id, kind, object_key, bucket, mime_type, size_bytes, checksum_sha256, status, confirmed_at)
           VALUES ($1, 'BANNER_IMAGE', $2, 'bucket-test', 'image/webp', 200000, $3, 'READY', now())`,
          [assetId, `banners/2026/${assetId}.webp`, 'a'.repeat(64)],
        );
        assetIds.push(assetId);
        await c.query(
          `INSERT INTO app.banners (id, code, image_asset_id, cta_type, cta_category_id)
           VALUES ($1, $2, $3, 'CATEGORY', $4)`,
          [bannerId, `del-${run}`, assetId, cat.id],
        );
        bannerIds.push(bannerId);
        return true;
      });
      if (!placed) return;
      await expect(commands.remove(staff, cat.id)).rejects.toMatchObject({
        status: 409,
        response: {
          code: 'CATEGORY_IN_USE',
          extra: { usage: { children: 0, products: 0, banners: 1 } },
        },
      });
      expect(await remaining(cat.id)).not.toBeNull();
    });

    it('borrado y reparentado concurrentes: o gana el borrado (404/409 al otro) o la FK lo impide, sin huérfanos', async () => {
      const parent = await make('Carrera padre');
      const child = await make('Carrera hija');
      const results = await Promise.allSettled([
        commands.remove(staff, parent.id),
        commands.update(staff, child.id, { parentId: parent.id }),
      ]);
      const row = await remaining(child.id);
      const parentGone = (await remaining(parent.id)) === null;
      // Nunca una hija apuntando a un padre borrado.
      expect(parentGone && row?.parentId === parent.id).toBe(false);
      expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    });
  });
});
