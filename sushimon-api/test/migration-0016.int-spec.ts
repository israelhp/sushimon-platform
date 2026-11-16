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
 * Migración 0016 (F15 promociones: app.promotions, promotion_branches, promotion_products, promotion_weekdays) sobre una
 * base DESECHABLE creada aquí (`sushimon_mig0016_test`), con 0001..0016 aplicadas en orden. Mismo patrón y misma omisión
 * explícita que migration-0015.int-spec.ts: requiere PostgreSQL plano (`DATABASE_URL_TEST`); si `auth.users` es la de
 * Supabase real se omite y se avisa.
 */
const url = TEST_URL;
const SCRATCH = 'sushimon_mig0016_test';
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
  '0015_media_assets',
  '0016_promotions',
];
const migrationSql = (name: string) =>
  readFileSync(join(process.cwd(), 'prisma', 'migrations', name, 'migration.sql'), 'utf8');
const PRIVS = 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER';
const CHECK = { code: '23514' };
const UNIQUE = { code: '23505' };
const FK = { code: '23503' };
const EXCLUDE = { code: '23P01' };
const TABLES = ['promotions', 'promotion_branches', 'promotion_products', 'promotion_weekdays'];

type Overrides = Partial<{
  code: string | null;
  name: string;
  description: string | null;
  kind: string;
  value: number | string;
  starts_at: string;
  ends_at: string;
  version: number;
}>;

describe.skipIf(!url)('Migración 0016: promociones (base desechable)', () => {
  let scratch = '';
  let plain = false;
  let seq = 0;

  const q = <T extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ) => withClient(scratch, (c) => c.query<T>(sql, params));

  /** Promoción válida por defecto (automática, PERCENT 10); `o` sobrescribe columnas (null explícito = NULL). */
  const promo = async (o: Overrides = {}) => {
    const row = {
      code: null as string | null,
      name: `Promo ${++seq}`,
      kind: 'PERCENT',
      value: 10,
      starts_at: '2026-01-01T00:00:00Z',
      ends_at: '2026-12-31T00:00:00Z',
      ...o,
    };
    const cols = Object.keys(row);
    const r = await q<{ id: string }>(
      `INSERT INTO app.promotions (${cols.join(',')})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
      Object.values(row),
    );
    return r.rows[0]?.id as string;
  };
  const slot = (p: string, weekday: number, s: string, e: string) =>
    q(
      `INSERT INTO app.promotion_weekdays (promotion_id, weekday, starts_at, ends_at) VALUES ($1,$2,$3,$4)`,
      [p, weekday, s, e],
    );
  const branch = async () =>
    (
      await q<{ id: string }>(
        `INSERT INTO app.branches (code, name, address) VALUES ($1,'B','dir') RETURNING id`,
        [`suc-${++seq}`],
      )
    ).rows[0]?.id as string;
  const product = async () => {
    const cat = (
      await q<{ id: string }>(
        `INSERT INTO app.categories (slug, name) VALUES ($1,'Cat') RETURNING id`,
        [`cat-${++seq}`],
      )
    ).rows[0]?.id;
    return (
      await q<{ id: string }>(
        `INSERT INTO app.products (slug, name, base_price, category_id) VALUES ($1,'p',10,$2) RETURNING id`,
        [`p-${++seq}`, cat],
      )
    ).rows[0]?.id as string;
  };

  beforeAll(async () => {
    plain = !(await withClient(url as string, hasRealSupabaseAuth));
    scratch = withDatabase(url as string, SCRATCH);
    if (!plain) {
      console.warn(
        '[migration-0016.int-spec] OMITIDA: DATABASE_URL_TEST apunta a un Supabase (auth.users real). Requiere PostgreSQL plano desechable; la migración 0016 NO se probó.',
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
    await q('DELETE FROM app.promotions'); // las hijas caen en cascada
    await q('DELETE FROM app.branch_products');
    await q('DELETE FROM app.products');
    await q('DELETE FROM app.categories');
    await q('DELETE FROM app.branches');
  });

  it('es idempotente: reaplicarla no falla ni duplica índices ni restricciones', async () => {
    await withClient(scratch, (c) => c.query(migrationSql('0016_promotions')));
    const idx = await q<{ tablename: string; n: number }>(
      `SELECT tablename, count(*)::int AS n FROM pg_indexes
        WHERE schemaname='app' AND tablename = ANY($1) GROUP BY tablename ORDER BY tablename`,
      [TABLES],
    );
    // promotions: PK + code UNIQUE + active_window; branches: PK + branch_idx; products: PK + product_idx;
    // weekdays: PK + EXCLUDE (índice gist).
    expect(Object.fromEntries(idx.rows.map((r) => [r.tablename, r.n]))).toEqual({
      promotion_branches: 2,
      promotion_products: 2,
      promotion_weekdays: 2,
      promotions: 3,
    });
  });

  it('la guarda falla con claridad si una tabla existe con otra definición', async () => {
    await withClient(scratch, async (c) => {
      await c.query('BEGIN');
      try {
        await c.query(`ALTER TABLE app.promotions DROP CONSTRAINT promotions_period`);
        await expect(c.query(migrationSql('0016_promotions'))).rejects.toThrow(/promotions_period/);
      } finally {
        await c.query('ROLLBACK');
      }
    });
  });

  it('defaults: dine_in_only=false, active=true, version=1, created_at/updated_at', async () => {
    const id = await promo();
    const r = await q<Record<string, unknown>>(`SELECT * FROM app.promotions WHERE id=$1`, [id]);
    expect(r.rows[0]).toMatchObject({ dine_in_only: false, active: true, version: 1, code: null });
    expect(r.rows[0]?.['created_at']).toBeInstanceOf(Date);
    expect(r.rows[0]?.['updated_at']).toBeInstanceOf(Date);
  });

  it('CHECK de kind y rangos de value (PERCENT 0/100/101, FIXED_AMOUNT 0/máximo/excedido)', async () => {
    await expect(promo({ kind: 'TWO_FOR_ONE' })).rejects.toMatchObject(CHECK);
    await expect(promo({ kind: 'percent' })).rejects.toMatchObject(CHECK);
    await expect(promo({ kind: 'PERCENT', value: 0 })).rejects.toMatchObject(CHECK);
    await expect(promo({ kind: 'PERCENT', value: '0.00' })).rejects.toMatchObject(CHECK);
    await expect(promo({ kind: 'PERCENT', value: 101 })).rejects.toMatchObject(CHECK);
    await expect(promo({ kind: 'PERCENT', value: '100.01' })).rejects.toMatchObject(CHECK);
    await expect(promo({ kind: 'PERCENT', value: -5 })).rejects.toMatchObject(CHECK);
    await promo({ kind: 'PERCENT', value: '0.01' });
    await promo({ kind: 'PERCENT', value: 100 });
    await expect(promo({ kind: 'FIXED_AMOUNT', value: 0 })).rejects.toMatchObject(CHECK);
    await expect(promo({ kind: 'FIXED_AMOUNT', value: -1 })).rejects.toMatchObject(CHECK);
    await expect(promo({ kind: 'FIXED_AMOUNT', value: '1000000.00' })).rejects.toMatchObject(CHECK);
    await promo({ kind: 'FIXED_AMOUNT', value: '0.01' });
    await promo({ kind: 'FIXED_AMOUNT', value: '999999.99' });
    await promo({ kind: 'FIXED_AMOUNT', value: 250 }); // > 100 es válido para monto fijo
  });

  it('CHECK de periodo: ends_at <= starts_at rechazado', async () => {
    await expect(
      promo({ starts_at: '2026-06-01T00:00:00Z', ends_at: '2026-06-01T00:00:00Z' }),
    ).rejects.toMatchObject(CHECK);
    await expect(
      promo({ starts_at: '2026-06-02T00:00:00Z', ends_at: '2026-06-01T00:00:00Z' }),
    ).rejects.toMatchObject(CHECK);
    await promo({ starts_at: '2026-06-01T00:00:00Z', ends_at: '2026-06-01T00:00:01Z' });
  });

  it('CHECK de name, description y version', async () => {
    await expect(promo({ name: '' })).rejects.toMatchObject(CHECK);
    await expect(promo({ name: '   ' })).rejects.toMatchObject(CHECK);
    await expect(promo({ name: 'x'.repeat(121) })).rejects.toMatchObject(CHECK);
    await promo({ name: 'x'.repeat(120) });
    await expect(promo({ description: 'x'.repeat(501) })).rejects.toMatchObject(CHECK);
    await promo({ description: 'x'.repeat(500) });
    await promo({ description: null });
    await expect(promo({ version: 0 })).rejects.toMatchObject(CHECK);
    await promo({ version: 1 });
  });

  it('CHECK de formato de code: minúsculas, espacios, cortos y largos rechazados', async () => {
    for (const c of [
      'verano10',
      'Verano10',
      'AB',
      'A'.repeat(33),
      '-ABC',
      '_ABC',
      'AB C',
      ' ABC',
      'AB.C',
      'ÁBC',
      '',
    ]) {
      await expect(promo({ code: c }), c).rejects.toMatchObject(CHECK);
    }
    await promo({ code: 'ABC' });
    await promo({ code: 'A'.repeat(32) });
    await promo({ code: 'VERANO-10_X' });
    await promo({ code: '1ABC' });
  });

  it('UNIQUE code: duplicado rechazado; varias filas con code NULL permitidas', async () => {
    await promo({ code: 'DUP10' });
    await expect(promo({ code: 'DUP10' })).rejects.toMatchObject(UNIQUE);
    await promo({ code: null });
    await promo({ code: null });
    await promo({ code: null });
    const n = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM app.promotions WHERE code IS NULL`,
    );
    expect(n.rows[0]?.n).toBe(3);
  });

  it('promotion_weekdays: weekday 1..7; 0, 8 y negativos rechazados', async () => {
    const p = await promo();
    for (const w of [0, 8, -1]) {
      await expect(slot(p, w, '10:00', '11:00'), String(w)).rejects.toMatchObject(CHECK);
    }
    for (let w = 1; w <= 7; w++) await slot(p, w, '10:00', '11:00');
  });

  it('promotion_weekdays: orden, 24:00 solo como fin y granularidad de minuto', async () => {
    const p = await promo();
    await expect(slot(p, 1, '18:00', '15:00')).rejects.toMatchObject(CHECK);
    await expect(slot(p, 1, '10:00', '10:00')).rejects.toMatchObject(CHECK);
    await expect(slot(p, 1, '24:00', '24:00')).rejects.toMatchObject(CHECK);
    await expect(slot(p, 1, '10:00:30', '11:00')).rejects.toMatchObject(CHECK);
    await expect(slot(p, 1, '10:00', '11:00:15')).rejects.toMatchObject(CHECK);
    await slot(p, 1, '22:00', '24:00'); // 24:00 como fin
    await slot(p, 2, '00:00', '02:00');
  });

  it('EXCLUDE: solapes del mismo día rechazados; contiguos, otro día u otra promoción permitidos', async () => {
    const p = await promo();
    const other = await promo();
    await slot(p, 1, '15:00', '18:00');
    await expect(slot(p, 1, '17:00', '19:00')).rejects.toMatchObject(EXCLUDE);
    await expect(slot(p, 1, '16:00', '17:00')).rejects.toMatchObject(EXCLUDE); // contenido
    await expect(slot(p, 1, '14:00', '15:01')).rejects.toMatchObject(EXCLUDE);
    await expect(slot(p, 1, '15:00', '18:00')).rejects.toThrow(); // misma PK (23505 o 23P01 según el orden de índices)
    await slot(p, 1, '18:00', '19:00'); // contiguo
    await slot(p, 1, '14:00', '15:00'); // contiguo por delante
    await slot(p, 2, '15:00', '18:00'); // otro día
    await slot(other, 1, '15:00', '18:00'); // otra promoción
    // También rige para UPDATE.
    await expect(
      q(
        `UPDATE app.promotion_weekdays SET ends_at='18:30' WHERE promotion_id=$1 AND weekday=1 AND starts_at='18:00'`,
        [p],
      ),
    ).resolves.toBeDefined();
    await expect(
      q(
        `UPDATE app.promotion_weekdays SET ends_at='19:30' WHERE promotion_id=$1 AND weekday=1 AND starts_at='14:00'`,
        [p],
      ),
    ).rejects.toMatchObject(EXCLUDE);
  });

  it('FK promotion_branches/products: valores inexistentes rechazados; duplicado de PK rechazado', async () => {
    const p = await promo();
    const zero = '00000000-0000-0000-0000-000000000000';
    await expect(
      q(`INSERT INTO app.promotion_branches (promotion_id, branch_id) VALUES ($1,$2)`, [p, zero]),
    ).rejects.toMatchObject(FK);
    await expect(
      q(`INSERT INTO app.promotion_branches (promotion_id, branch_id) VALUES ($1,$2)`, [
        zero,
        await branch(),
      ]),
    ).rejects.toMatchObject(FK);
    await expect(
      q(`INSERT INTO app.promotion_products (promotion_id, product_id) VALUES ($1,$2)`, [p, zero]),
    ).rejects.toMatchObject(FK);
    await expect(slot(zero, 1, '10:00', '11:00')).rejects.toMatchObject(FK);
    const b = await branch();
    await q(`INSERT INTO app.promotion_branches (promotion_id, branch_id) VALUES ($1,$2)`, [p, b]);
    await expect(
      q(`INSERT INTO app.promotion_branches (promotion_id, branch_id) VALUES ($1,$2)`, [p, b]),
    ).rejects.toMatchObject(UNIQUE);
  });

  it('FK RESTRICT: no se borra una sucursal ni un producto referenciados por una promoción', async () => {
    const p = await promo();
    const b = await branch();
    const pr = await product();
    await q(`INSERT INTO app.promotion_branches (promotion_id, branch_id) VALUES ($1,$2)`, [p, b]);
    await q(`INSERT INTO app.promotion_products (promotion_id, product_id) VALUES ($1,$2)`, [
      p,
      pr,
    ]);
    await expect(q(`DELETE FROM app.branches WHERE id=$1`, [b])).rejects.toMatchObject(FK);
    await expect(q(`DELETE FROM app.products WHERE id=$1`, [pr])).rejects.toMatchObject(FK);
    // Tras quitar el vínculo sí se puede.
    await q(`DELETE FROM app.promotion_branches WHERE promotion_id=$1`, [p]);
    await q(`DELETE FROM app.promotion_products WHERE promotion_id=$1`, [p]);
    await q(`DELETE FROM app.branches WHERE id=$1`, [b]);
    await q(`DELETE FROM app.products WHERE id=$1`, [pr]);
  });

  it('FK CASCADE: borrar la promoción borra sus sucursales, productos y tramos', async () => {
    const p = await promo();
    await q(`INSERT INTO app.promotion_branches (promotion_id, branch_id) VALUES ($1,$2)`, [
      p,
      await branch(),
    ]);
    await q(`INSERT INTO app.promotion_products (promotion_id, product_id) VALUES ($1,$2)`, [
      p,
      await product(),
    ]);
    await slot(p, 5, '22:00', '24:00');
    await q(`DELETE FROM app.promotions WHERE id=$1`, [p]);
    for (const t of ['promotion_branches', 'promotion_products', 'promotion_weekdays']) {
      const r = await q<{ n: number }>(`SELECT count(*)::int AS n FROM app.${t}`);
      expect(r.rows[0]?.n, t).toBe(0);
    }
    // Las sucursales y productos NO se borran.
    expect((await q<{ n: number }>(`SELECT count(*)::int AS n FROM app.branches`)).rows[0]?.n).toBe(
      1,
    );
    expect((await q<{ n: number }>(`SELECT count(*)::int AS n FROM app.products`)).rows[0]?.n).toBe(
      1,
    );
  });

  it('índices: ventana activa, sucursal y producto recorren índice (seqscan desactivado)', async () => {
    for (let i = 0; i < 20; i++) await promo();
    const p = await promo();
    const b = await branch();
    const pr = await product();
    await q(`INSERT INTO app.promotion_branches (promotion_id, branch_id) VALUES ($1,$2)`, [p, b]);
    await q(`INSERT INTO app.promotion_products (promotion_id, product_id) VALUES ($1,$2)`, [
      p,
      pr,
    ]);
    for (const t of TABLES) await q(`ANALYZE app.${t}`);
    const explain = (sql: string, params: unknown[] = []) =>
      withClient(scratch, async (c) => {
        await c.query('SET enable_seqscan = off');
        const r = await c.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${sql}`, params);
        return r.rows.map((x) => x['QUERY PLAN']).join('\n');
      });
    const re = /Index (Only )?Scan|Bitmap Index Scan/;
    expect(
      await explain(
        `SELECT id FROM app.promotions WHERE active AND ends_at > now() AND starts_at < now() + interval '14 days'`,
      ),
    ).toMatch(re);
    expect(
      await explain(`SELECT promotion_id FROM app.promotion_branches WHERE branch_id = $1`, [b]),
    ).toMatch(re);
    expect(
      await explain(`SELECT promotion_id FROM app.promotion_products WHERE product_id = $1`, [pr]),
    ).toMatch(re);
  });

  it('RLS habilitado y sin privilegios para PUBLIC ni anon/authenticated (omitida si los roles no existen)', async () => {
    for (const t of TABLES) {
      const rls = await q<{ relrowsecurity: boolean }>(
        `SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass`,
        [`app.${t}`],
      );
      expect(rls.rows[0]?.relrowsecurity, t).toBe(true);
      const pub = await q<{ n: number }>(
        `SELECT (SELECT count(*) FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a WHERE a.grantee = 0)::int AS n
           FROM pg_class c WHERE c.oid = $1::regclass`,
        [`app.${t}`],
      );
      expect(pub.rows[0]?.n, t).toBe(0);
      const pol = await q<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='app' AND tablename=$1`,
        [t],
      );
      expect(pol.rows[0]?.n, t).toBe(0);
    }
    const roles = await q<{ rolname: string }>(
      `SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') ORDER BY rolname`,
    );
    if (roles.rowCount === 0) {
      console.warn(
        '[migration-0016.int-spec] REVOKE a anon/authenticated no verificado: esos roles no existen.',
      );
      return;
    }
    for (const { rolname } of roles.rows) {
      for (const t of TABLES) {
        const r = await q<{ ok: boolean }>(`SELECT has_table_privilege($1, $2, $3) AS ok`, [
          rolname,
          `app.${t}`,
          PRIVS,
        ]);
        expect(r.rows[0]?.ok, `${rolname}.${t}`).toBe(false);
      }
    }
  });
});
