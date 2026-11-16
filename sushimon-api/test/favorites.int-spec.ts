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
 * Esta prueba NO aplica migraciones (la 0009 requiere aprobación humana y NO se aplica a Supabase desde aquí): se
 * OMITE, con aviso, si `app.customer_favorites` no existe en `DATABASE_URL_TEST`. Ver también
 * `migration-0009.int-spec.ts` (estructura sobre una base desechable de PostgreSQL plano).
 */
describe.skipIf(!url)('Favoritos contra PostgreSQL real', () => {
  let ready = false;
  let prisma: PrismaService;
  let identity: IdentityService;
  let service: FavoritesService;
  let repo: FavoritesRepository;
  const createdAuthIds = new Set<string>();

  const skipUnlessReady = (ctx: TestContext) => {
    if (!ready)
      ctx.skip(
        'app.customer_favorites no existe en DATABASE_URL_TEST (migración 0009 sin aplicar)',
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

  const seedRows = (customerId: string, n: number) =>
    withClient(url as string, (c) =>
      c.query(
        'INSERT INTO app.customer_favorites (customer_id, product_id) SELECT $1, gen_random_uuid() FROM generate_series(1, $2::int)',
        [customerId, n],
      ),
    );

  const settle = (calls: Promise<unknown>[]) => Promise.allSettled(calls);
  const code = (r: PromiseSettledResult<unknown>) =>
    r.status === 'rejected'
      ? ((r.reason as { getResponse?: () => { code?: string } }).getResponse?.().code ?? 'OTHER')
      : 'OK';

  beforeAll(async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    ready = await withClient(url as string, async (c) => {
      const res = await c.query<{ t: string | null }>(
        "SELECT to_regclass('app.customer_favorites') AS t",
      );
      return res.rows[0]?.t != null;
    });
    if (!ready) {
      console.warn(
        '[favorites.int-spec] OMITIDA: app.customer_favorites no existe en DATABASE_URL_TEST. La migración 0009 no está aplicada; la concurrencia y el SQL de F06 NO se probaron contra PostgreSQL real.',
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
      await cleanupTestData(url as string, { authUserIds: createdAuthIds, branchIds: [] });
    }
  });

  it('alta feliz, repetida (sin duplicar ni cambiar created_at) y borrado idempotente', async (ctx) => {
    skipUnlessReady(ctx);
    const { p, customer } = await newCustomer();
    const id = randomUUID();
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
    const id = randomUUID();
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
    const results = await settle(Array.from({ length: N }, () => service.add(p, randomUUID())));
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
    const results = await settle(Array.from({ length: 240 }, () => service.add(p, randomUUID())));
    const outcomes = results.map(code);
    const ok = outcomes.filter((c) => c === 'OK').length;
    const rows = await rowsOf(customer.id);
    expect(rows.length).toBe(ok);
    expect(rows.length).toBeLessThanOrEqual(MAX_FAVORITES_PER_CUSTOMER);
    expect(new Set(rows).size).toBe(rows.length);
    // Si hubo errores de infraestructura (plazos con el pool remoto), se completa hasta el tope en oleadas pequeñas.
    for (let guard = 0; guard < 40; guard++) {
      const missing = MAX_FAVORITES_PER_CUSTOMER - (await rowsOf(customer.id)).length;
      if (missing <= 0) break;
      await settle(
        Array.from({ length: Math.min(missing, 5) }, () => service.add(p, randomUUID())),
      );
    }
    expect((await rowsOf(customer.id)).length).toBe(MAX_FAVORITES_PER_CUSTOMER);
    await expect(service.add(p, randomUUID())).rejects.toMatchObject({ status: 422 });
    // Ya favorito estando al tope: idempotente.
    const [existing] = await rowsOf(customer.id);
    await expect(service.add(p, existing as string)).resolves.toBeUndefined();
  }, 180_000);

  it('cascada: borrar el cliente borra sus favoritos', async (ctx) => {
    skipUnlessReady(ctx);
    const { p, customer } = await newCustomer();
    await service.add(p, randomUUID());
    await service.add(p, randomUUID());
    await withClient(url as string, (c) =>
      c.query('DELETE FROM app.customers WHERE id = $1', [customer.id]),
    );
    expect(await rowsOf(customer.id)).toEqual([]);
  });

  it('aislamiento: cada cliente ve y borra solo lo suyo; el mismo producto puede ser de ambos', async (ctx) => {
    skipUnlessReady(ctx);
    const a = await newCustomer();
    const b = await newCustomer();
    const shared = randomUUID();
    const onlyA = randomUUID();
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
    const ids = [randomUUID(), randomUUID(), randomUUID()];
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
});
