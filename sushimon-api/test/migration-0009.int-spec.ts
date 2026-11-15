import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type pg from 'pg';
import {
  ensureAuthStub,
  hasRealSupabaseAuth,
  TEST_URL,
  withClient,
  withDatabase,
} from './support/db.js';

/**
 * Migración 0009 (favoritos de clientes, F06) sobre una base DESECHABLE creada aquí (`sushimon_mig0009_test`),
 * con 0001..0009 aplicadas en orden. Mismo patrón y misma omisión explícita que migration-0005/0006/0007.int-spec.ts:
 * requiere PostgreSQL plano (`DATABASE_URL_TEST`); si `auth.users` es la de Supabase real se omite y se avisa.
 */
const url = TEST_URL;
const SCRATCH = 'sushimon_mig0009_test';
const MIGRATIONS = [
  '0001_create_app_schema',
  '0002_identity_staff',
  '0003_branches_management',
  '0004_audit_events_append_only',
  '0005_staff_rbac',
  '0006_branch_hours_closures',
  '0007_delivery_geography_coverage',
  '0009_customer_favorites',
];
const migrationSql = (name: string) =>
  readFileSync(join(process.cwd(), 'prisma', 'migrations', name, 'migration.sql'), 'utf8');

const FAV = `INSERT INTO app.customer_favorites (customer_id, product_id) VALUES ($1,$2)`;
const ADD = `INSERT INTO app.customer_favorites (customer_id, product_id) VALUES ($1,$2)
  ON CONFLICT (customer_id, product_id) DO NOTHING`;
const NIL = '00000000-0000-0000-0000-000000000000';
const LIMIT = 200;

describe.skipIf(!url)('Migración 0009: customer_favorites (base desechable)', () => {
  let scratch = '';
  let plain = false;

  beforeAll(async () => {
    plain = !(await withClient(url as string, hasRealSupabaseAuth));
    scratch = withDatabase(url as string, SCRATCH);
    if (!plain) {
      console.warn(
        '[migration-0009.int-spec] OMITIDA: DATABASE_URL_TEST apunta a un Supabase (auth.users real). Requiere PostgreSQL plano desechable; la migración 0009 NO se probó.',
      );
      return;
    }
    await withClient(url as string, async (c) => {
      await c.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
      await c.query(`CREATE DATABASE ${SCRATCH}`);
    });
    await withClient(scratch, async (c) => {
      await ensureAuthStub(c);
      for (const m of MIGRATIONS) await c.query(migrationSql(m));
    });
  });
  afterAll(async () => {
    if (!plain) return;
    await withClient(url as string, async (c) => {
      await c.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
    });
  });

  const newCustomer = (label: string) =>
    withClient(scratch, async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO app.customers (full_name) VALUES ($1) RETURNING id`,
        [label],
      );
      return r.rows[0]?.id as string;
    });

  /** Ejecuta en una conexión propia; devuelve el nombre de la restricción violada (o null si pasó). */
  const attempt = (sql: string, params: unknown[] = []) =>
    withClient(scratch, async (c) => {
      try {
        await c.query(sql, params);
        return null;
      } catch (e) {
        const err = e as pg.DatabaseError;
        return err.constraint ?? err.code ?? String(err);
      }
    });

  const count = (customerId: string) =>
    withClient(scratch, async (c) => {
      const r = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM app.customer_favorites WHERE customer_id = $1`,
        [customerId],
      );
      return r.rows[0]?.n as number;
    });

  it('inserta con created_at por defecto y rechaza el par duplicado con la PK esperada', async (ctx) => {
    if (!plain) ctx.skip();
    const cust = await newCustomer('Fav PK');
    const p = randomUUID();
    expect(await attempt(FAV, [cust, p])).toBeNull();
    const r = await withClient(scratch, (c) =>
      c.query<{ ok: boolean }>(
        `SELECT created_at IS NOT NULL AND created_at <= now() AS ok FROM app.customer_favorites WHERE customer_id = $1`,
        [cust],
      ),
    );
    expect(r.rows[0]).toEqual({ ok: true });
    expect(await attempt(FAV, [cust, p])).toBe('customer_favorites_pkey');
    // mismo producto para otro cliente: permitido
    const other = await newCustomer('Fav PK 2');
    expect(await attempt(FAV, [other, p])).toBeNull();
  });

  it('ON CONFLICT DO NOTHING es idempotente y no cambia created_at', async (ctx) => {
    if (!plain) ctx.skip();
    const cust = await newCustomer('Fav idem');
    const p = randomUUID();
    expect(await attempt(ADD, [cust, p])).toBeNull();
    const at = () =>
      withClient(scratch, async (c) => {
        const r = await c.query<{ t: string }>(
          `SELECT created_at::text AS t FROM app.customer_favorites WHERE customer_id = $1 AND product_id = $2`,
          [cust, p],
        );
        return r.rows[0]?.t;
      });
    const before = await at();
    const res = await withClient(scratch, (c) => c.query(ADD, [cust, p]));
    expect(res.rowCount).toBe(0);
    expect(await at()).toBe(before);
    expect(await count(cust)).toBe(1);
  });

  it('FK a customers: cliente inexistente rechazado; borrar el cliente borra sus favoritos (CASCADE)', async (ctx) => {
    if (!plain) ctx.skip();
    expect(await attempt(FAV, [NIL, randomUUID()])).toBe('customer_favorites_customer_id_fkey');
    const cust = await newCustomer('Fav cascade');
    const keep = await newCustomer('Fav keep');
    await withClient(scratch, async (c) => {
      await c.query(FAV, [cust, randomUUID()]);
      await c.query(FAV, [cust, randomUUID()]);
      await c.query(FAV, [keep, randomUUID()]);
    });
    expect(await attempt('DELETE FROM app.customers WHERE id = $1', [cust])).toBeNull();
    expect(await count(cust)).toBe(0);
    expect(await count(keep)).toBe(1);
  });

  it('no existe FK a products (diferida a F11): cualquier uuid se acepta a nivel de BD', async (ctx) => {
    if (!plain) ctx.skip();
    const fks = await withClient(scratch, (c) =>
      c.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint WHERE conrelid = 'app.customer_favorites'::regclass AND contype = 'f'`,
      ),
    );
    expect(fks.rows.map((r) => r.conname)).toEqual(['customer_favorites_customer_id_fkey']);
  });

  it('el índice de listado existe y el listado ordenado lo usa (sin Seq Scan, enable_seqscan=off)', async (ctx) => {
    if (!plain) ctx.skip();
    const cust = await newCustomer('Fav plan');
    const plan = await withClient(scratch, async (c) => {
      await c.query(
        `INSERT INTO app.customer_favorites (customer_id, product_id, created_at)
         SELECT $1, gen_random_uuid(), now() - (g || ' minutes')::interval FROM generate_series(1, 150) g`,
        [cust],
      );
      await c.query('ANALYZE app.customer_favorites');
      await c.query('SET enable_seqscan = off');
      const r = await c.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT product_id FROM app.customer_favorites WHERE customer_id = $1
         ORDER BY created_at DESC, product_id ASC LIMIT 20 OFFSET 20`,
        [cust],
      );
      return r.rows.map((x) => x['QUERY PLAN']).join('\n');
    });
    expect(plan).toContain('customer_favorites_customer_created_idx');
    expect(plan).not.toContain('Seq Scan');
    expect(plan).not.toMatch(/\bSort\b/);
  });

  it('carrera del tope (D10): N > 200 altas concurrentes de productos distintos => exactamente 200 filas', async (ctx) => {
    if (!plain) ctx.skip();
    const cust = await newCustomer('Fav race');
    const N = LIMIT + 40;
    /** Réplica SQL de la transacción de D10: bloquea al cliente, cuenta, inserta solo si count < tope. */
    const add = (product: string) =>
      withClient(scratch, async (c) => {
        await c.query('BEGIN');
        try {
          await c.query(`SELECT 1 FROM app.customers WHERE id = $1 FOR NO KEY UPDATE`, [cust]);
          const n = (
            await c.query<{ n: number }>(
              `SELECT count(*)::int AS n FROM app.customer_favorites WHERE customer_id = $1`,
              [cust],
            )
          ).rows[0]?.n as number;
          let outcome = 'LIMIT';
          if (n < LIMIT) {
            await c.query(ADD, [cust, product]);
            outcome = 'OK';
          }
          await c.query('COMMIT');
          return outcome;
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        }
      });
    const results = await Promise.all(Array.from({ length: N }, () => add(randomUUID())));
    expect(results.filter((r) => r === 'OK')).toHaveLength(LIMIT);
    expect(results.filter((r) => r === 'LIMIT')).toHaveLength(N - LIMIT);
    expect(await count(cust)).toBe(LIMIT);
  });

  it('dos altas simultáneas del MISMO producto => una sola fila y ninguna falla', async (ctx) => {
    if (!plain) ctx.skip();
    const cust = await newCustomer('Fav same');
    const p = randomUUID();
    const results = await Promise.all([attempt(ADD, [cust, p]), attempt(ADD, [cust, p])]);
    expect(results).toEqual([null, null]);
    expect(await count(cust)).toBe(1);
  });

  it('RLS habilitado en customer_favorites', async (ctx) => {
    if (!plain) ctx.skip();
    const rls = await withClient(scratch, (c) =>
      c.query<{ relname: string; relrowsecurity: boolean }>(
        `SELECT relname, relrowsecurity FROM pg_class
         WHERE relnamespace = 'app'::regnamespace AND relname = 'customer_favorites'`,
      ),
    );
    expect(rls.rows).toEqual([{ relname: 'customer_favorites', relrowsecurity: true }]);
  });

  it('anon/authenticated no tienen ningún privilegio sobre la tabla (omitida si esos roles no existen)', async (ctx) => {
    if (!plain) ctx.skip();
    const roles = await withClient(scratch, (c) =>
      c.query<{ rolname: string }>(
        `SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') ORDER BY rolname`,
      ),
    );
    if (roles.rowCount === 0) {
      console.warn(
        '[migration-0009.int-spec] REVOKE no verificado: los roles anon/authenticated no existen en este PostgreSQL plano.',
      );
      ctx.skip();
    }
    for (const { rolname } of roles.rows) {
      const res = await withClient(scratch, (c) =>
        c.query<{ ok: boolean }>(
          `SELECT has_table_privilege($1, 'app.customer_favorites', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS ok`,
          [rolname],
        ),
      );
      expect(res.rows[0]?.ok).toBe(false);
    }
  });
});
