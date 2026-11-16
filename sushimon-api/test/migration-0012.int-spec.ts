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
 * Migración 0012 (F11 productos y multimedia) sobre una base DESECHABLE creada aquí (`sushimon_mig0012_test`),
 * con 0001..0012 aplicadas en orden. Mismo patrón y misma omisión explícita que migration-0011.int-spec.ts:
 * requiere PostgreSQL plano (`DATABASE_URL_TEST`); si `auth.users` es la de Supabase real se omite y se avisa.
 */
const url = TEST_URL;
const SCRATCH = 'sushimon_mig0012_test';
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
];
const migrationSql = (name: string) =>
  readFileSync(join(process.cwd(), 'prisma', 'migrations', name, 'migration.sql'), 'utf8');
const PRIVS = 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER';
const CHECK = { code: '23514' };
const LEGACY_PRODUCT = '00000000-0000-0000-0000-0000000000f1';
const CUSTOMER = '00000000-0000-0000-0000-0000000000c2';

describe.skipIf(!url)('Migración 0012: productos y multimedia (base desechable)', () => {
  let scratch = '';
  let plain = false;
  let cat = '';

  const q = <T extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ) => withClient(scratch, (c) => c.query<T>(sql, params));
  const product = async (
    slug: string,
    over: { sku?: string | null; name?: string; price?: number | string; category?: string } = {},
  ) => {
    const r = await q<{ id: string }>(
      `INSERT INTO app.products (slug, name, sku, base_price, category_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [slug, over.name ?? slug, over.sku ?? null, over.price ?? 10, over.category ?? cat],
    );
    return r.rows[0]?.id as string;
  };
  const media = (productId: string, urlValue: string, sort = 0) =>
    q(`INSERT INTO app.product_media (product_id, media_url, sort_order) VALUES ($1, $2, $3)`, [
      productId,
      urlValue,
      sort,
    ]);

  beforeAll(async () => {
    plain = !(await withClient(url as string, hasRealSupabaseAuth));
    scratch = withDatabase(url as string, SCRATCH);
    if (!plain) {
      console.warn(
        '[migration-0012.int-spec] OMITIDA: DATABASE_URL_TEST apunta a un Supabase (auth.users real). Requiere PostgreSQL plano desechable; la migración 0012 NO se probó.',
      );
      return;
    }
    await withClient(url as string, async (c) => {
      await c.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
      await c.query(`CREATE DATABASE ${SCRATCH}`);
    });
    await withClient(scratch, async (c) => {
      await ensureAuthStub(c);
      for (const m of MIGRATIONS.slice(0, -1)) await c.query(migrationSql(m));
      // Favorito huérfano previo a 0012: la FK debe quedar NOT VALID sin borrar nada.
      await c.query(`INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-0000000000c1')`);
      await c.query(
        `INSERT INTO app.customers (id, auth_user_id, full_name, email)
         VALUES ($1, '00000000-0000-0000-0000-0000000000c1', 'Fav', 'f@x.test')`,
        [CUSTOMER],
      );
      await c.query(
        `INSERT INTO app.customer_favorites (customer_id, product_id) VALUES ($1, $2)`,
        [CUSTOMER, LEGACY_PRODUCT],
      );
      await c.query(migrationSql('0012_products'));
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
    await q('DELETE FROM app.product_media');
    await q('DELETE FROM app.customer_favorites WHERE product_id <> $1', [LEGACY_PRODUCT]);
    await q('DELETE FROM app.products');
    await q('DELETE FROM app.categories');
    cat = (
      await q<{ id: string }>(
        `INSERT INTO app.categories (slug, name) VALUES ('cat', 'Cat') RETURNING id`,
      )
    ).rows[0]?.id as string;
  });

  it('es idempotente: reaplicarla no falla ni duplica triggers/constraints', async () => {
    await withClient(scratch, (c) => c.query(migrationSql('0012_products')));
    const t = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = 'app.product_media'::regclass AND NOT tgisinternal`,
    );
    expect(t.rows[0]?.n).toBe(1);
    const f = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'customer_favorites_product_id_fkey'`,
    );
    expect(f.rows[0]?.n).toBe(1);
  });

  it('slug: formato, longitud y unicidad', async () => {
    await product('rolls-clasicos');
    for (const bad of ['Rolls', 'a_b', '-a', 'a-', 'a--b', '', 'a b', 'ñandú']) {
      await expect(product(bad), bad).rejects.toMatchObject(CHECK);
    }
    await expect(product('a'.repeat(81))).rejects.toMatchObject(CHECK);
    await product('a'.repeat(80));
    await expect(product('rolls-clasicos')).rejects.toMatchObject({ code: '23505' });
  });

  it('sku: formato, longitud, unicidad y NULL múltiple', async () => {
    await product('s1', { sku: 'ROLL-001.a_b' });
    for (const [i, bad] of ['-x', '.x', 'a b', 'ñ', ''].entries()) {
      await expect(product(`b-${i}`, { sku: bad }), bad).rejects.toMatchObject(CHECK);
    }
    await expect(product('s2', { sku: 'a'.repeat(41) })).rejects.toMatchObject(CHECK);
    await product('s3', { sku: 'a'.repeat(40) });
    await expect(product('s4', { sku: 'ROLL-001.a_b' })).rejects.toMatchObject({ code: '23505' });
    await product('n1');
    await product('n2'); // varios SKU NULL permitidos
  });

  it('name y description: CHECK', async () => {
    await expect(product('n1', { name: '   ' })).rejects.toMatchObject(CHECK);
    await expect(product('n2', { name: 'x'.repeat(121) })).rejects.toMatchObject(CHECK);
    await product('n3', { name: 'x'.repeat(120) });
    const withDesc = (slug: string, d: string) =>
      q(
        `INSERT INTO app.products (slug, name, base_price, category_id, description) VALUES ($1,'ok',1,$2,$3)`,
        [slug, cat, d],
      );
    await expect(withDesc('d1', 'x'.repeat(2001))).rejects.toMatchObject(CHECK);
    await withDesc('d2', 'x'.repeat(2000));
  });

  it('base_price: 0, negativo, 1e9 y > 999999.99 rechazados; 0.01 y 999999.99 aceptados', async () => {
    for (const [i, bad] of [0, -1, '-0.01', 1000000, '1000000000', '999999.995'].entries()) {
      await expect(product(`p-${i}`, { price: bad }), String(bad)).rejects.toThrow();
    }
    await product('p-min', { price: '0.01' });
    await product('p-max', { price: '999999.99' });
    const r = await q<{ base_price: string }>(
      `SELECT base_price::text FROM app.products WHERE slug = 'p-min'`,
    );
    expect(r.rows[0]?.base_price).toBe('0.01');
  });

  it('defaults: active true, created_at/updated_at presentes', async () => {
    const id = await product('def');
    const r = await q<{ active: boolean; c: boolean; u: boolean }>(
      `SELECT active, created_at IS NOT NULL AS c, updated_at IS NOT NULL AS u FROM app.products WHERE id = $1`,
      [id],
    );
    expect(r.rows[0]).toEqual({ active: true, c: true, u: true });
  });

  it('category_id: inexistente -> FK; ON DELETE RESTRICT con productos', async () => {
    await expect(
      product('x', { category: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toMatchObject({ code: '23503' });
    const p = await product('con-cat');
    await expect(q(`DELETE FROM app.categories WHERE id = $1`, [cat])).rejects.toMatchObject({
      code: '23503',
    });
    await q(`DELETE FROM app.products WHERE id = $1`, [p]);
    await q(`DELETE FROM app.categories WHERE id = $1`, [cat]);
  });

  it('media_url: solo https sin espacios/control, <= 2048; alt_text <= 200; sort_order >= 0', async () => {
    const p = await product('m1');
    await media(p, 'https://cdn.sushimon.test/a.jpg?x=1', 0);
    const bad = [
      'http://cdn.test/a.jpg',
      'javascript:alert(1)',
      'ftp://x/a',
      '//cdn.test/a.jpg',
      'https://cdn.test/a b.jpg',
      'https://cdn.test/a\tb',
      'https://cdn.test/a\nb',
      'https://',
      '',
      ' https://cdn.test/a.jpg',
    ];
    for (const [i, u] of bad.entries()) {
      await expect(media(p, u, i + 10), JSON.stringify(u)).rejects.toMatchObject(CHECK);
    }
    await expect(media(p, 'https://x.test/' + 'a'.repeat(2034), 2)).rejects.toMatchObject(CHECK); // 2049
    await media(p, 'https://x.test/' + 'a'.repeat(2033), 3); // 2048
    await expect(
      q(
        `INSERT INTO app.product_media (product_id, media_url, alt_text, sort_order) VALUES ($1,'https://x.test/a',$2,5)`,
        [p, 'x'.repeat(201)],
      ),
    ).rejects.toMatchObject(CHECK);
    await expect(media(p, 'https://x.test/n', -1)).rejects.toMatchObject(CHECK);
  });

  it('sort_order: UNIQUE aplazable (choque en COMMIT; intercambio dentro de una transacción permitido)', async () => {
    const p = await product('m2');
    await media(p, 'https://x.test/1', 0);
    await media(p, 'https://x.test/2', 1);
    await expect(media(p, 'https://x.test/3', 1)).rejects.toMatchObject({ code: '23505' });
    await withClient(scratch, async (c) => {
      await c.query('BEGIN');
      await c.query(
        `UPDATE app.product_media SET sort_order = 1 WHERE media_url = 'https://x.test/1'`,
      );
      await c.query(
        `UPDATE app.product_media SET sort_order = 0 WHERE media_url = 'https://x.test/2'`,
      );
      await c.query('COMMIT');
    });
    const r = await q<{ media_url: string }>(
      `SELECT media_url FROM app.product_media WHERE product_id = $1 ORDER BY sort_order`,
      [p],
    );
    expect(r.rows.map((x) => x.media_url)).toEqual(['https://x.test/2', 'https://x.test/1']);
  });

  it('tope de 8 imágenes por producto (trigger); reemplazo en transacción permitido', async () => {
    const p = await product('m3');
    const other = await product('m4');
    for (let i = 0; i < 8; i++) await media(p, `https://x.test/${i}`, i);
    await expect(media(p, 'https://x.test/9', 8)).rejects.toMatchObject({
      code: '23514',
      message: 'product_media_max_items',
    });
    await media(other, 'https://x.test/o', 0);
    await withClient(scratch, async (c) => {
      await c.query('BEGIN');
      await c.query('DELETE FROM app.product_media WHERE product_id = $1', [p]);
      for (let i = 0; i < 8; i++) {
        await c.query(
          `INSERT INTO app.product_media (product_id, media_url, sort_order) VALUES ($1,$2,$3)`,
          [p, `https://x.test/n${i}`, i],
        );
      }
      await c.query('COMMIT');
    });
    // Reasignar una imagen a un producto lleno también se rechaza.
    await expect(
      q(`UPDATE app.product_media SET product_id = $1, sort_order = 20 WHERE product_id = $2`, [
        p,
        other,
      ]),
    ).rejects.toMatchObject({ message: 'product_media_max_items' });
  });

  it('concurrencia: dos inserciones simultáneas con 7 existentes no superan 8', async () => {
    const p = await product('m5');
    for (let i = 0; i < 7; i++) await media(p, `https://x.test/${i}`, i);
    const c1 = new pg.Client({ connectionString: scratch });
    const c2 = new pg.Client({ connectionString: scratch });
    await c1.connect();
    await c2.connect();
    try {
      await c1.query('BEGIN');
      await c2.query('BEGIN');
      await c1.query(
        `INSERT INTO app.product_media (product_id, media_url, sort_order) VALUES ($1,'https://x.test/a',7)`,
        [p],
      );
      const second = c2
        .query(
          `INSERT INTO app.product_media (product_id, media_url, sort_order) VALUES ($1,'https://x.test/b',8)`,
          [p],
        )
        .then(
          () => ({ ok: true as const }),
          (e: { message?: string }) => ({ ok: false as const, message: e.message }),
        );
      await new Promise((r) => setTimeout(r, 300)); // c2 espera el bloqueo de fila del producto
      await c1.query('COMMIT');
      expect(await second).toMatchObject({ ok: false, message: 'product_media_max_items' });
      await c2.query('ROLLBACK');
    } finally {
      await c1.end();
      await c2.end();
    }
    const n = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM app.product_media WHERE product_id = $1`,
      [p],
    );
    expect(n.rows[0]?.n).toBe(8);
  });

  it('ON DELETE CASCADE: borrar el producto borra su media', async () => {
    const p = await product('m6');
    await media(p, 'https://x.test/1', 0);
    await q(`DELETE FROM app.products WHERE id = $1`, [p]);
    const n = await q<{ n: number }>(`SELECT count(*)::int AS n FROM app.product_media`);
    expect(n.rows[0]?.n).toBe(0);
    await expect(media(p, 'https://x.test/1')).rejects.toMatchObject({ code: '23503' });
  });

  it('favoritos: FK NOT VALID por huérfano previo (conservado), rechaza nuevos huérfanos y cascada', async () => {
    const fk = await q<{ convalidated: boolean }>(
      `SELECT convalidated FROM pg_constraint WHERE conname = 'customer_favorites_product_id_fkey'`,
    );
    expect(fk.rows[0]?.convalidated).toBe(false);
    const legacy = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM app.customer_favorites WHERE product_id = $1`,
      [LEGACY_PRODUCT],
    );
    expect(legacy.rows[0]?.n).toBe(1); // dato conservado
    await expect(
      q(
        `INSERT INTO app.customer_favorites (customer_id, product_id) VALUES ($1, gen_random_uuid())`,
        [CUSTOMER],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    const p = await product('fav');
    await q(`INSERT INTO app.customer_favorites (customer_id, product_id) VALUES ($1, $2)`, [
      CUSTOMER,
      p,
    ]);
    await q(`DELETE FROM app.products WHERE id = $1`, [p]);
    const n = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM app.customer_favorites WHERE product_id = $1`,
      [p],
    );
    expect(n.rows[0]?.n).toBe(0);
  });

  it('favoritos: sin huérfanos la FK se valida sola (base aparte)', async () => {
    const name = `${SCRATCH}_v`;
    await withClient(url as string, async (c) => {
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.query(`CREATE DATABASE ${name}`);
    });
    try {
      await withClient(withDatabase(url as string, name), async (c) => {
        await ensureAuthStub(c);
        for (const m of MIGRATIONS) await c.query(migrationSql(m));
        const r = await c.query<{ convalidated: boolean }>(
          `SELECT convalidated FROM pg_constraint WHERE conname = 'customer_favorites_product_id_fkey'`,
        );
        expect(r.rows[0]?.convalidated).toBe(true);
      });
    } finally {
      await withClient(url as string, async (c) => {
        await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      });
    }
  });

  it('índices de listado: (category_id, active, name, id) y (active, name, id) sirven el orden sin Sort', async () => {
    for (let i = 0; i < 40; i++) await product(`l${i}`);
    await q('ANALYZE app.products');
    const explain = (sql: string, params: unknown[]) =>
      withClient(scratch, async (c) => {
        await c.query('SET enable_seqscan = off');
        const r = await c.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${sql}`, params);
        return r.rows.map((x) => x['QUERY PLAN']).join('\n');
      });
    const a = await explain(
      `SELECT id FROM app.products WHERE category_id = $1 AND active ORDER BY name, id`,
      [cat],
    );
    expect(a).toContain('products_category_active_name_idx');
    expect(a).not.toMatch(/\bSort\b/);
    const b = await explain(`SELECT id FROM app.products WHERE active ORDER BY name, id`, []);
    expect(b).toContain('products_active_name_idx');
    expect(b).not.toMatch(/\bSort\b/);
  });

  it('RLS habilitado y sin privilegios para PUBLIC ni anon/authenticated (omitida si los roles no existen)', async () => {
    for (const t of ['products', 'product_media']) {
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
    }
    const roles = await q<{ rolname: string }>(
      `SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') ORDER BY rolname`,
    );
    if (roles.rowCount === 0) {
      console.warn(
        '[migration-0012.int-spec] REVOKE a anon/authenticated no verificado: esos roles no existen.',
      );
      return;
    }
    for (const { rolname } of roles.rows) {
      for (const t of ['products', 'product_media']) {
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
