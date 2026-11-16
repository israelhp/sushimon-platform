import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import {
  ensureAuthStub,
  hasRealSupabaseAuth,
  TEST_URL,
  withClient,
  withDatabase,
} from './support/db.js';

/**
 * Migración 0014 (F13 precio/disponibilidad por sucursal) sobre una base DESECHABLE creada aquí
 * (`sushimon_mig0014_test`), con 0001..0014 aplicadas en orden. Mismo patrón y misma omisión explícita que
 * migration-0013.int-spec.ts: requiere PostgreSQL plano (`DATABASE_URL_TEST`); si `auth.users` es la de Supabase
 * real se omite y se avisa.
 */
const url = TEST_URL;
const SCRATCH = 'sushimon_mig0014_test';
const MIGRATIONS = [
  '0001_create_app_schema',
  '0002_identity_staff',
  '0003_branches_management',
  '0004_audit_events_append_only',
  '0005_staff_rbac',
  '0006_branch_hours_closures',
  '0007_delivery_geography_coverage',
  '0008_customer_addresses',
  '0009_customer_favorites',
  '0010_revoke_client_roles',
  '0011_categories',
  '0012_products',
  '0013_product_modifiers',
  '0014_branch_products',
];
const migrationSql = (name: string) =>
  readFileSync(join(process.cwd(), 'prisma', 'migrations', name, 'migration.sql'), 'utf8');
const PRIVS = 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER';
const CHECK = { code: '23514' };
const UNIQUE = { code: '23505' };
const FK = { code: '23503' };
const NIL = '00000000-0000-0000-0000-000000000000';

describe.skipIf(!url)('Migración 0014: branch_products (base desechable)', () => {
  let scratch = '';
  let plain = false;
  let cat = '';
  let seq = 0;

  const q = <T extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ) => withClient(scratch, (c) => c.query<T>(sql, params));
  const branch = async () =>
    (
      await q<{ id: string }>(
        `INSERT INTO app.branches (code, name, address) VALUES ($1,'b','dir') RETURNING id`,
        [`b${++seq}`],
      )
    ).rows[0]?.id as string;
  const product = async () =>
    (
      await q<{ id: string }>(
        `INSERT INTO app.products (slug, name, base_price, category_id) VALUES ($1,'p',10,$2) RETURNING id`,
        [`p-${++seq}`, cat],
      )
    ).rows[0]?.id as string;
  const bp = (b: string, p: string, price: number | string | null = null, available = true) =>
    q(
      `INSERT INTO app.branch_products (branch_id, product_id, price_override, available) VALUES ($1,$2,$3,$4)`,
      [b, p, price, available],
    );

  beforeAll(async () => {
    plain = !(await withClient(url as string, hasRealSupabaseAuth));
    scratch = withDatabase(url as string, SCRATCH);
    if (!plain) {
      console.warn(
        '[migration-0014.int-spec] OMITIDA: DATABASE_URL_TEST apunta a un Supabase (auth.users real). Requiere PostgreSQL plano desechable; la migración 0014 NO se probó.',
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
  beforeEach(async (ctx) => {
    if (!plain) {
      ctx.skip();
      return;
    }
    await q('DELETE FROM app.branch_products');
    await q('DELETE FROM app.products');
    await q('DELETE FROM app.categories');
    await q('DELETE FROM app.branches');
    cat = (
      await q<{ id: string }>(
        `INSERT INTO app.categories (slug, name) VALUES ('cat','Cat') RETURNING id`,
      )
    ).rows[0]?.id as string;
  });

  it('es idempotente: reaplicarla no falla ni duplica índices', async () => {
    await withClient(scratch, (c) => c.query(migrationSql('0014_branch_products')));
    const r = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname = 'app' AND tablename = 'branch_products'`,
    );
    expect(r.rows[0]?.n).toBe(2); // PK + índice por producto
  });

  it('defaults: available true, price_override NULL, created_at/updated_at', async () => {
    const b = await branch();
    const p = await product();
    await q(`INSERT INTO app.branch_products (branch_id, product_id) VALUES ($1,$2)`, [b, p]);
    const r = await q<Record<string, unknown>>(
      `SELECT price_override, available, created_at IS NOT NULL AS c, updated_at IS NOT NULL AS u
         FROM app.branch_products`,
    );
    expect(r.rows[0]).toEqual({ price_override: null, available: true, c: true, u: true });
  });

  it('CHECK de price_override: NULL y (0, 999999.99] válidos; 0, negativo y > tope rechazados', async () => {
    const b = await branch();
    for (const v of [null, '0.01', '25.50', '999999.99']) await bp(b, await product(), v);
    for (const v of ['0', '0.00', '-0.01', '-5', '1000000']) {
      await expect(bp(b, await product(), v), v).rejects.toMatchObject(CHECK);
    }
    // 999999.995 se redondea a 1000000.00 (numeric(12,2)) y también viola el tope.
    await expect(bp(b, await product(), '999999.995')).rejects.toThrow();
    const r = await q<{ price_override: string }>(
      `SELECT price_override::text FROM app.branch_products WHERE price_override > 999999`,
    );
    expect(r.rows[0]?.price_override).toBe('999999.99');
  });

  it('PK compuesta: duplicado (sucursal, producto) rechazado; mismo producto en otra sucursal permitido', async () => {
    const b1 = await branch();
    const b2 = await branch();
    const p = await product();
    await bp(b1, p, '5');
    await expect(bp(b1, p, '6')).rejects.toMatchObject(UNIQUE);
    await bp(b2, p, '6');
    await bp(b1, await product(), null, false);
  });

  it('FK: sucursal o producto inexistente se rechaza', async () => {
    const b = await branch();
    const p = await product();
    await expect(bp(NIL, p)).rejects.toMatchObject(FK);
    await expect(bp(b, NIL)).rejects.toMatchObject(FK);
  });

  it('ON DELETE RESTRICT desde branches y products; sin filas dependientes sí se borra', async () => {
    const b = await branch();
    const p = await product();
    await bp(b, p, '5');
    await expect(q(`DELETE FROM app.branches WHERE id = $1`, [b])).rejects.toMatchObject(FK);
    await expect(q(`DELETE FROM app.products WHERE id = $1`, [p])).rejects.toMatchObject(FK);
    await q(`DELETE FROM app.branch_products WHERE branch_id = $1 AND product_id = $2`, [b, p]);
    await q(`DELETE FROM app.products WHERE id = $1`, [p]);
    await q(`DELETE FROM app.branches WHERE id = $1`, [b]);
  });

  it('índices: consultas por sucursal y por producto recorren índice (seqscan desactivado)', async () => {
    const b = await branch();
    const p = await product();
    await bp(b, p, '5');
    for (let i = 0; i < 20; i++) await bp(b, await product(), null, false);
    await q('ANALYZE app.branch_products');
    const explain = (sql: string, params: unknown[]) =>
      withClient(scratch, async (c) => {
        await c.query('SET enable_seqscan = off');
        const r = await c.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${sql}`, params);
        return r.rows.map((x) => x['QUERY PLAN']).join('\n');
      });
    // Aserción robusta: recorrido por índice (PK o índice por producto); no se exige el nombre del índice.
    const byBranch = await explain(
      `SELECT product_id FROM app.branch_products WHERE branch_id = $1`,
      [b],
    );
    expect(byBranch).toMatch(/Index (Only )?Scan|Bitmap Index Scan/);
    const byProduct = await explain(
      `SELECT branch_id FROM app.branch_products WHERE product_id = $1`,
      [p],
    );
    expect(byProduct).toMatch(/Index (Only )?Scan|Bitmap Index Scan/);
    // El FK product_id tiene índice propio (la PK no lo tiene como columna líder).
    const idx = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_index i
        WHERE i.indrelid = 'app.branch_products'::regclass AND NOT i.indisprimary
          AND i.indkey[0] = (SELECT attnum FROM pg_attribute
                              WHERE attrelid = 'app.branch_products'::regclass AND attname = 'product_id')`,
    );
    expect(idx.rows[0]?.n).toBeGreaterThanOrEqual(1);
  });

  it('RLS habilitado y sin privilegios para PUBLIC ni anon/authenticated (omitida si los roles no existen)', async () => {
    const rls = await q<{ relrowsecurity: boolean }>(
      `SELECT relrowsecurity FROM pg_class WHERE oid = 'app.branch_products'::regclass`,
    );
    expect(rls.rows[0]?.relrowsecurity).toBe(true);
    const pub = await q<{ n: number }>(
      `SELECT (SELECT count(*) FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a WHERE a.grantee = 0)::int AS n
         FROM pg_class c WHERE c.oid = 'app.branch_products'::regclass`,
    );
    expect(pub.rows[0]?.n).toBe(0);
    const roles = await q<{ rolname: string }>(
      `SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') ORDER BY rolname`,
    );
    if (roles.rowCount === 0) {
      console.warn(
        '[migration-0014.int-spec] REVOKE a anon/authenticated no verificado: esos roles no existen.',
      );
      return;
    }
    for (const { rolname } of roles.rows) {
      const r = await q<{ ok: boolean }>(`SELECT has_table_privilege($1, $2, $3) AS ok`, [
        rolname,
        'app.branch_products',
        PRIVS,
      ]);
      expect(r.rows[0]?.ok, rolname).toBe(false);
    }
  });
});
