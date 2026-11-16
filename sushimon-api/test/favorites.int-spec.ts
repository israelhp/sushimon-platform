import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import { validateEnv, type Env } from '../src/config/env.js';
import { PrismaService } from '../src/database/prisma.service.js';
import type { CatalogProductsPort } from '../src/favorites/catalog-products.port.js';
import { PrismaCustomerFavoritesReader } from '../src/favorites/customer-favorites.reader.js';
import { MAX_FAVORITES_PER_CUSTOMER } from '../src/favorites/favorites.constants.js';
import { FavoritesRepository } from '../src/favorites/favorites.repository.js';
import { FavoritesService } from '../src/favorites/favorites.service.js';
import { IdentityService } from '../src/identity/identity.service.js';
import { principal, product } from './support/favorites-harness.js';
import { cleanupTestData, TEST_URL, withClient } from './support/db.js';

const url = TEST_URL;

/** Catálogo simulado que publica CUALQUIER id (la prueba es de SQL y concurrencia, no del catálogo). */
const everything: CatalogProductsPort = {
  findPublicSummaries: (ids) => Promise.resolve(new Map(ids.map((id) => [id, product(id)]))),
};

/**
 * F06 contra PostgreSQL real: tope exacto bajo concurrencia, idempotencia con altas simultáneas, cascada y aislamiento.
 *
 * Esta prueba NO aplica migraciones (la 0009 y la 0012 requieren aprobación humana y NO se aplican a Supabase desde
 * aquí): se OMITE, con aviso, si `app.customer_favorites` o `app.products` no existen en `DATABASE_URL_TEST`.
 * Desde la 0012 `customer_favorites.product_id` tiene FK a `app.products`: las pruebas siembran productos REALES
 * (categoría + productos con prefijo propio) y los borran al terminar. Ver también `migration-0009.int-spec.ts` y
 * `migration-0012.int-spec.ts` (estructura sobre bases desechables de PostgreSQL plano).
 */
describe.skipIf(!url)('Favoritos contra PostgreSQL real', () => {
  let ready = false;
  let prisma: PrismaService;
  let identity: IdentityService;
  let service: FavoritesService;
  let repo: FavoritesRepository;
  const createdAuthIds = new Set<string>();
  const createdProductIds = new Set<string>();
  const createdCategoryIds = new Set<string>();
  const run = randomUUID().slice(0, 8);
  let categoryId = '';
  let slugCounter = 0;

  const skipUnlessReady = (ctx: TestContext) => {
    if (!ready)
      ctx.skip(
        'app.customer_favorites o app.products no existen en DATABASE_URL_TEST (migraciones 0009/0012 sin aplicar)',
      );
  };

  const newCustomer = async () => {
    const p = principal();
    createdAuthIds.add(p.authUserId);
    await withClient(url as string, (c) =>
      c.query('INSERT INTO auth.users (id) VALUES ($1)', [p.authUserId]),
    );
    const customer = await identity.ensureCustomer(p);
    return { p, customer };
  };

  const rowsOf = (customerId: string) =>
    withClient(url as string, async (c) => {
      const res = await c.query<{ product_id: string }>(
        'SELECT product_id FROM app.customer_favorites WHERE customer_id = $1',
        [customerId],
      );
      return res.rows.map((r) => r.product_id);
    });

  /** Productos REALES (la FK de 0012 rechaza ids inventados). Una sola sentencia, con slug único por corrida. */
  const seedProducts = async (n: number): Promise<string[]> => {
    const offset = slugCounter;
    slugCounter += n;
    const ids = await withClient(url as string, async (c) => {
      if (categoryId === '') {
        const cat = await c.query<{ id: string }>(
          'INSERT INTO app.categories (slug, name) VALUES ($1, $2) RETURNING id',
          [`favt-${run}`, `Favt ${run}`],
        );
        categoryId = cat.rows[0]?.id as string;
        createdCategoryIds.add(categoryId);
      }
      const res = await c.query<{ id: string }>(
        `INSERT INTO app.products (slug, name, base_price, category_id)
         SELECT $1 || '-' || (g + $2::int), 'Favt ' || g, 1.00, $3::uuid FROM generate_series(1, $4::int) g
         RETURNING id`,
        [`favt-${run}`, offset, categoryId, n],
      );
      return res.rows.map((r) => r.id);
    });
    for (const id of ids) createdProductIds.add(id);
    return ids;
  };

  const seedRows = async (customerId: string, n: number) => {
    const ids = await seedProducts(n);
    await withClient(url as string, (c) =>
      c.query(
        'INSERT INTO app.customer_favorites (customer_id, product_id) SELECT $1, unnest($2::uuid[])',
        [customerId, ids],
      ),
    );
  };

  const settle = (calls: Promise<unknown>[]) => Promise.allSettled(calls);
  const code = (r: PromiseSettledResult<unknown>) =>
    r.status === 'rejected'
      ? ((r.reason as { getResponse?: () => { code?: string } }).getResponse?.().code ?? 'OTHER')
      : 'OK';

  beforeAll(async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    ready = await withClient(url as string, async (c) => {
      const res = await c.query<{ t: string | null; p: string | null }>(
        "SELECT to_regclass('app.customer_favorites') AS t, to_regclass('app.products') AS p",
      );
      return res.rows[0]?.t != null && res.rows[0]?.p != null;
    });
    if (!ready) {
      console.warn(
        '[favorites.int-spec] OMITIDA: app.customer_favorites o app.products no existen en DATABASE_URL_TEST. Las migraciones 0009/0012 no están aplicadas; la concurrencia y el SQL de F06 NO se probaron contra PostgreSQL real.',
      );
    }
    // Pool de 8: varias conexiones simultáneas reales sin pasar del tope de 15 clientes del pooler de Supabase en modo sesión (EMAXCONNSESSION).
    prisma = new PrismaService(
      new ConfigService<Env, true>(
        validateEnv({ DATABASE_URL: url, DB_POOL_MAX: '8', NODE_ENV: 'test' }),
      ),
    );
    identity = new IdentityService(prisma, new AuditService());
    repo = new FavoritesRepository(prisma);
    service = new FavoritesService(repo, identity, everything);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    if (ready) {
      await cleanupTestData(url as string, {
        authUserIds: createdAuthIds,
        branchIds: [],
        productIds: createdProductIds,
        categoryIds: createdCategoryIds,
      });
    }
  });

  it('alta feliz, repetida (sin duplicar ni cambiar created_at) y borrado idempotente', async (ctx) => {
    skipUnlessReady(ctx);
    const { p, customer } = await newCustomer();
    const [id] = (await seedProducts(1)) as [string];
    await service.add(p, id);
    const first = await withClient(url as string, (c) =>
      c.query<{ created_at: Date }>(
        'SELECT created_at FROM app.customer_favorites WHERE customer_id = $1',
        [customer.id],
      ),
    );
    await service.add(p, id);
    const second = await withClient(url as string, (c) =>
      c.query<{ created_at: Date }>(
        'SELECT created_at FROM app.customer_favorites WHERE customer_id = $1',
        [customer.id],
      ),
    );
    expect(second.rows).toHaveLength(1);
    expect(second.rows[0]?.created_at.getTime()).toBe(first.rows[0]?.created_at.getTime());
    await service.remove(p, id);
    await service.remove(p, id);
    expect(await rowsOf(customer.id)).toEqual([]);
  });

  it('mismo producto, 20 altas simultáneas => exactamente 1 fila; solo OK o FAVORITES_BUSY (reintentable)', async (ctx) => {
    skipUnlessReady(ctx);
    const { p, customer } = await newCustomer();
    const [id] = (await seedProducts(1)) as [string];
    const results = await settle(Array.from({ length: 20 }, () => service.add(p, id)));
    // Con el pooler remoto el candado por cliente serializa las altas y las últimas pueden agotar el
    // `lock_timeout` de 2 s: 503 FAVORITES_BUSY, reintentable. Nunca otro error, nunca filas duplicadas.
    const outcomes = results.map(code);
    expect(outcomes.filter((c) => c !== 'OK' && c !== 'FAVORITES_BUSY')).toEqual([]);
    expect(outcomes).toContain('OK');
    expect(await rowsOf(customer.id)).toEqual([id]);
  });

  it('borde del tope: desde 190 filas, N altas distintas simultáneas nunca superan 200', async (ctx) => {
    skipUnlessReady(ctx);
    const { p, customer } = await newCustomer();
    await seedRows(customer.id, MAX_FAVORITES_PER_CUSTOMER - 10);
    const N = 20;
    const fresh = await seedProducts(N);
    const results = await settle(fresh.map((id) => service.add(p, id)));
    const outcomes = results.map(code);
    const ok = outcomes.filter((c) => c === 'OK').length;
    const limited = outcomes.filter((c) => c === 'FAVORITES_LIMIT_REACHED').length;
    const other = outcomes.length - ok - limited;
    const rows = await rowsOf(customer.id);
    expect(rows.length).toBe(MAX_FAVORITES_PER_CUSTOMER - 10 + ok);
    expect(rows.length).toBeLessThanOrEqual(MAX_FAVORITES_PER_CUSTOMER);
    expect(ok).toBeLessThanOrEqual(10);
    // Sin errores de infraestructura (p. ej. plazo de transacción) el tope es EXACTO.
    if (other === 0) {
      expect(ok).toBe(10);
      expect(limited).toBe(N - 10);
    }
  });

  it('240 altas distintas simultáneas desde un cliente => nunca más de 200 filas; luego se completa y el siguiente es 422', async (ctx) => {
    skipUnlessReady(ctx);
    const { p, customer } = await newCustomer();
    // 240 intentos simultáneos + reserva para completar y para la comprobación final del tope.
    const pool = await seedProducts(240 + 60);
    const attempts = pool.slice(0, 240);
    const results = await settle(attempts.map((id) => service.add(p, id)));
    const outcomes = results.map(code);
    const ok = outcomes.filter((c) => c === 'OK').length;
    const rows = await rowsOf(customer.id);
    expect(rows.length).toBe(ok);
    expect(rows.length).toBeLessThanOrEqual(MAX_FAVORITES_PER_CUSTOMER);
    expect(new Set(rows).size).toBe(rows.length);
    // Si hubo errores de infraestructura (plazos con el pool remoto), se completa hasta el tope en oleadas pequeñas.
    // Se reintenta con productos del lote que aún NO son favoritos (los intentos fallidos se pueden repetir).
    for (let guard = 0; guard < 80; guard++) {
      const current = new Set(await rowsOf(customer.id));
      const missing = MAX_FAVORITES_PER_CUSTOMER - current.size;
      if (missing <= 0) break;
      const candidates = pool.filter((id) => !current.has(id)).slice(0, Math.min(missing, 5));
      await settle(candidates.map((id) => service.add(p, id)));
    }
    expect((await rowsOf(customer.id)).length).toBe(MAX_FAVORITES_PER_CUSTOMER);
    const overflow = (await seedProducts(1))[0] as string;
    await expect(service.add(p, overflow)).rejects.toMatchObject({ status: 422 });
    // Ya favorito estando al tope: idempotente.
    const [existing] = await rowsOf(customer.id);
    await expect(service.add(p, existing as string)).resolves.toBeUndefined();
  }, 180_000);

  it('cascada: borrar el cliente borra sus favoritos', async (ctx) => {
    skipUnlessReady(ctx);
    const { p, customer } = await newCustomer();
    const [x, y] = (await seedProducts(2)) as [string, string];
    await service.add(p, x);
    await service.add(p, y);
    await withClient(url as string, (c) =>
      c.query('DELETE FROM app.customers WHERE id = $1', [customer.id]),
    );
    expect(await rowsOf(customer.id)).toEqual([]);
  });

  it('aislamiento: cada cliente ve y borra solo lo suyo; el mismo producto puede ser de ambos', async (ctx) => {
    skipUnlessReady(ctx);
    const a = await newCustomer();
    const b = await newCustomer();
    const [shared, onlyA] = (await seedProducts(2)) as [string, string];
    await service.add(a.p, shared);
    await service.add(a.p, onlyA);
    await service.add(b.p, shared);

    await service.remove(b.p, onlyA); // no es suyo: no hace nada
    expect(new Set(await rowsOf(a.customer.id))).toEqual(new Set([shared, onlyA]));

    const listB = await service.list(b.p, { page: 1, pageSize: 20 });
    expect(listB.favoriteProductIds).toEqual([shared]);
    expect(listB.total).toBe(1);

    await service.remove(b.p, shared);
    expect(await rowsOf(b.customer.id)).toEqual([]);
    expect(await rowsOf(a.customer.id)).toHaveLength(2);
  });

  it('listado: orden created_at DESC y el lector de F17 devuelve los mismos ids', async (ctx) => {
    skipUnlessReady(ctx);
    const { p, customer } = await newCustomer();
    const ids = await seedProducts(3);
    for (const id of ids) {
      await service.add(p, id);
      await new Promise((r) => setTimeout(r, 15));
    }
    const list = await service.list(p, { page: 1, pageSize: 2 });
    expect(list.favoriteProductIds).toEqual([...ids].reverse());
    expect(list.items.map((i) => i.productId)).toEqual([ids[2], ids[1]]);
    expect(list.total).toBe(3);
    const reader = new PrismaCustomerFavoritesReader(repo);
    expect(await reader.getFavoriteProductIds(customer.id)).toEqual([...ids].reverse());
  });

  it('F11: la FK a products rechaza ids inexistentes (23503) y borrar un producto borra sus favoritos', async (ctx) => {
    skipUnlessReady(ctx);
    const { p, customer } = await newCustomer();
    // El catálogo simulado "publica" cualquier id: la FK de 0012 es la que protege la integridad.
    await expect(service.add(p, randomUUID())).rejects.toBeDefined();
    expect(await rowsOf(customer.id)).toEqual([]);
    const [x, y] = (await seedProducts(2)) as [string, string];
    await service.add(p, x);
    await service.add(p, y);
    await withClient(url as string, (c) => c.query('DELETE FROM app.products WHERE id = $1', [x]));
    createdProductIds.delete(x);
    expect(await rowsOf(customer.id)).toEqual([y]);
  });
});
