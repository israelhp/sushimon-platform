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
 * Migración 0013 (F12 modificadores) sobre una base DESECHABLE creada aquí (`sushimon_mig0013_test`), con
 * 0001..0013 aplicadas en orden. Mismo patrón y misma omisión explícita que migration-0012.int-spec.ts:
 * requiere PostgreSQL plano (`DATABASE_URL_TEST`); si `auth.users` es la de Supabase real se omite y se avisa.
 */
const url = TEST_URL;
const SCRATCH = 'sushimon_mig0013_test';
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
];
const migrationSql = (name: string) =>
  readFileSync(join(process.cwd(), 'prisma', 'migrations', name, 'migration.sql'), 'utf8');
const PRIVS = 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER';
const CHECK = { code: '23514' };
const UNIQUE = { code: '23505' };
const FK = { code: '23503' };
const NIL = '00000000-0000-0000-0000-000000000000';

describe.skipIf(!url)('Migración 0013: modificadores de producto (base desechable)', () => {
  let scratch = '';
  let plain = false;
  let cat = '';
  let seq = 0;

  const q = <T extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ) => withClient(scratch, (c) => c.query<T>(sql, params));
  const group = async (name: string, min = 0, max = 1) =>
    (
      await q<{ id: string }>(
        `INSERT INTO app.modifier_groups (name, min_select, max_select) VALUES ($1,$2,$3) RETURNING id`,
        [name, min, max],
      )
    ).rows[0]?.id as string;
  const modifier = async (groupId: string, name: string, price: number | string = 0, sort = 0) =>
    (
      await q<{ id: string }>(
        `INSERT INTO app.modifiers (group_id, name, extra_price, sort_order) VALUES ($1,$2,$3,$4) RETURNING id`,
        [groupId, name, price, sort],
      )
    ).rows[0]?.id as string;
  const product = async () =>
    (
      await q<{ id: string }>(
        `INSERT INTO app.products (slug, name, base_price, category_id) VALUES ($1,'p',10,$2) RETURNING id`,
        [`p-${++seq}`, cat],
      )
    ).rows[0]?.id as string;
  const link = (productId: string, groupId: string, sort = 0) =>
    q(
      `INSERT INTO app.product_modifier_groups (product_id, group_id, sort_order) VALUES ($1,$2,$3)`,
      [productId, groupId, sort],
    );
  const count = async (table: string) =>
    (await q<{ n: number }>(`SELECT count(*)::int AS n FROM app.${table}`)).rows[0]?.n;

  beforeAll(async () => {
    plain = !(await withClient(url as string, hasRealSupabaseAuth));
    scratch = withDatabase(url as string, SCRATCH);
    if (!plain) {
      console.warn(
        '[migration-0013.int-spec] OMITIDA: DATABASE_URL_TEST apunta a un Supabase (auth.users real). Requiere PostgreSQL plano desechable; la migración 0013 NO se probó.',
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
    await q('DELETE FROM app.product_modifier_groups');
    await q('DELETE FROM app.modifiers');
    await q('DELETE FROM app.modifier_groups');
    await q('DELETE FROM app.products');
    await q('DELETE FROM app.categories');
    cat = (
      await q<{ id: string }>(
        `INSERT INTO app.categories (slug, name) VALUES ('cat','Cat') RETURNING id`,
      )
    ).rows[0]?.id as string;
  });

  it('es idempotente: reaplicarla no falla ni duplica triggers', async () => {
    await withClient(scratch, (c) => c.query(migrationSql('0013_product_modifiers')));
    for (const t of ['modifiers', 'product_modifier_groups']) {
      const r = await q<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = $1::regclass AND NOT tgisinternal`,
        [`app.${t}`],
      );
      expect(r.rows[0]?.n, t).toBe(1);
    }
  });

  it('modifier_groups: defaults y CHECK de nombre', async () => {
    const id = await group('Salsas');
    const r = await q<Record<string, unknown>>(
      `SELECT min_select, max_select, active, created_at IS NOT NULL AS c, updated_at IS NOT NULL AS u
         FROM app.modifier_groups WHERE id = $1`,
      [id],
    );
    expect(r.rows[0]).toEqual({ min_select: 0, max_select: 1, active: true, c: true, u: true });
    await expect(group('   ')).rejects.toMatchObject(CHECK);
    await expect(group('')).rejects.toMatchObject(CHECK);
    await expect(group('x'.repeat(81))).rejects.toMatchObject(CHECK);
    await group('x'.repeat(80));
  });

  it('modifier_groups: min/max (min<=max, max>=1, max<=20, min>=0)', async () => {
    const bad: Array<[number, number]> = [
      [-1, 1],
      [0, 0],
      [2, 1],
      [0, 21],
      [21, 21],
    ];
    for (const [i, [mn, mx]] of bad.entries()) {
      await expect(group(`bad-${i}`, mn, mx), `${mn}/${mx}`).rejects.toMatchObject(CHECK);
    }
    await group('ok-1', 0, 1);
    await group('ok-2', 2, 2);
    await group('ok-3', 0, 20);
    await group('ok-4', 20, 20);
  });

  it('modifier_groups: nombre único sin distinguir mayúsculas ni espacios de borde', async () => {
    await group('Salsas');
    await expect(group('salsas')).rejects.toMatchObject(UNIQUE);
    await expect(group('  SALSAS  ')).rejects.toMatchObject(UNIQUE);
    await group('Salsas extra');
  });

  it('modifiers: CHECK de nombre, precio y sort_order; FK de grupo', async () => {
    const g = await group('G');
    await expect(modifier(g, '  ')).rejects.toMatchObject(CHECK);
    await expect(modifier(g, 'x'.repeat(81))).rejects.toMatchObject(CHECK);
    await modifier(g, 'x'.repeat(80), 0, 0);
    await expect(modifier(g, 'neg', '-0.01', 1)).rejects.toMatchObject(CHECK);
    await expect(modifier(g, 'big', '10000', 1)).rejects.toMatchObject(CHECK);
    await expect(modifier(g, 'big2', '9999.995', 1)).rejects.toThrow();
    await expect(modifier(g, 'so', 0, -1)).rejects.toMatchObject(CHECK);
    await modifier(g, 'max', '9999.99', 1);
    await modifier(g, 'zero', '0', 2);
    const r = await q<{ extra_price: string }>(
      `SELECT extra_price::text FROM app.modifiers WHERE name = 'max'`,
    );
    expect(r.rows[0]?.extra_price).toBe('9999.99');
    await expect(modifier(NIL, 'orphan')).rejects.toMatchObject(FK);
  });

  it('modifiers: defaults (precio 0, active true, sort_order 0)', async () => {
    const g = await group('G');
    const id = (
      await q<{ id: string }>(
        `INSERT INTO app.modifiers (group_id, name) VALUES ($1,'d') RETURNING id`,
        [g],
      )
    ).rows[0]?.id;
    const r = await q<{ extra_price: string; active: boolean; sort_order: number }>(
      `SELECT extra_price::text, active, sort_order FROM app.modifiers WHERE id = $1`,
      [id],
    );
    expect(r.rows[0]).toEqual({ extra_price: '0.00', active: true, sort_order: 0 });
  });

  it('modifiers: nombre único por grupo (case-insensitive) pero repetible entre grupos', async () => {
    const g1 = await group('G1');
    const g2 = await group('G2');
    await modifier(g1, 'Soya', 0, 0);
    await expect(modifier(g1, 'SOYA', 0, 1)).rejects.toMatchObject(UNIQUE);
    await expect(modifier(g1, ' soya ', 0, 1)).rejects.toMatchObject(UNIQUE);
    await modifier(g2, 'Soya', 0, 0);
  });

  it('modifiers.sort_order: UNIQUE aplazable (choque en COMMIT; intercambio en transacción permitido)', async () => {
    const g = await group('G');
    await modifier(g, 'a', 0, 0);
    await modifier(g, 'b', 0, 1);
    await expect(modifier(g, 'c', 0, 1)).rejects.toMatchObject(UNIQUE);
    await withClient(scratch, async (c) => {
      await c.query('BEGIN');
      await c.query(`UPDATE app.modifiers SET sort_order = 1 WHERE name = 'a'`);
      await c.query(`UPDATE app.modifiers SET sort_order = 0 WHERE name = 'b'`);
      await c.query('COMMIT');
    });
    const r = await q<{ name: string }>(
      `SELECT name FROM app.modifiers WHERE group_id = $1 ORDER BY sort_order`,
      [g],
    );
    expect(r.rows.map((x) => x.name)).toEqual(['b', 'a']);
  });

  it('tope de 30 opciones por grupo (trigger); reasignar a grupo lleno se rechaza', async () => {
    const g = await group('G');
    const other = await group('O');
    for (let i = 0; i < 30; i++) await modifier(g, `m${i}`, 0, i);
    await expect(modifier(g, 'extra', 0, 30)).rejects.toMatchObject({
      code: '23514',
      message: 'modifier_group_max_options',
    });
    await modifier(other, 'solo', 0, 0); // otro grupo no se ve afectado
    await expect(
      q(`UPDATE app.modifiers SET group_id = $1, sort_order = 99 WHERE group_id = $2`, [g, other]),
    ).rejects.toMatchObject({ message: 'modifier_group_max_options' });
    // Actualizar una opción de un grupo lleno sin cambiar de grupo sigue permitido (no se cuenta a sí misma).
    await q(`UPDATE app.modifiers SET extra_price = 1 WHERE group_id = $1 AND name = 'm0'`, [g]);
    await q(`UPDATE app.modifiers SET group_id = group_id WHERE group_id = $1 AND name = 'm1'`, [
      g,
    ]);
  });

  it('concurrencia: dos inserciones simultáneas con 29 opciones no superan 30', async () => {
    const g = await group('G');
    for (let i = 0; i < 29; i++) await modifier(g, `m${i}`, 0, i);
    const c1 = new pg.Client({ connectionString: scratch });
    const c2 = new pg.Client({ connectionString: scratch });
    await c1.connect();
    await c2.connect();
    try {
      await c1.query('BEGIN');
      await c2.query('BEGIN');
      await c1.query(`INSERT INTO app.modifiers (group_id, name, sort_order) VALUES ($1,'a',29)`, [
        g,
      ]);
      const second = c2
        .query(`INSERT INTO app.modifiers (group_id, name, sort_order) VALUES ($1,'b',30)`, [g])
        .then(
          () => ({ ok: true as const }),
          (e: { message?: string }) => ({ ok: false as const, message: e.message }),
        );
      await new Promise((r) => setTimeout(r, 300)); // c2 espera el bloqueo de fila del grupo
      await c1.query('COMMIT');
      expect(await second).toMatchObject({ ok: false, message: 'modifier_group_max_options' });
      await c2.query('ROLLBACK');
    } finally {
      await c1.end();
      await c2.end();
    }
    const n = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM app.modifiers WHERE group_id = $1`,
      [g],
    );
    expect(n.rows[0]?.n).toBe(30);
  });

  it('product_modifier_groups: PK, FK, sort_order >= 0 y UNIQUE (producto, orden) aplazable', async () => {
    const p = await product();
    const g1 = await group('G1');
    const g2 = await group('G2');
    await link(p, g1, 0);
    await expect(link(p, g1, 1)).rejects.toMatchObject(UNIQUE); // PK
    await expect(link(p, g2, 0)).rejects.toMatchObject(UNIQUE); // orden repetido
    await expect(link(p, g2, -1)).rejects.toMatchObject(CHECK);
    await expect(link(p, NIL, 5)).rejects.toMatchObject(FK);
    await expect(link(NIL, g2, 5)).rejects.toMatchObject(FK);
    await link(p, g2, 1);
    await withClient(scratch, async (c) => {
      await c.query('BEGIN');
      await c.query(`UPDATE app.product_modifier_groups SET sort_order = 1 WHERE group_id = $1`, [
        g1,
      ]);
      await c.query(`UPDATE app.product_modifier_groups SET sort_order = 0 WHERE group_id = $1`, [
        g2,
      ]);
      await c.query('COMMIT');
    });
    const r = await q<{ group_id: string }>(
      `SELECT group_id FROM app.product_modifier_groups WHERE product_id = $1 ORDER BY sort_order`,
      [p],
    );
    expect(r.rows.map((x) => x.group_id)).toEqual([g2, g1]);
  });

  it('tope de 10 grupos por producto (trigger); reasignar a producto lleno se rechaza', async () => {
    const p = await product();
    const other = await product();
    for (let i = 0; i < 10; i++) await link(p, await group(`g${i}`), i);
    await expect(link(p, await group('g-extra'), 10)).rejects.toMatchObject({
      code: '23514',
      message: 'product_max_modifier_groups',
    });
    await link(other, await group('g-other'), 0);
    await expect(
      q(
        `UPDATE app.product_modifier_groups SET product_id = $1, sort_order = 50 WHERE product_id = $2`,
        [p, other],
      ),
    ).rejects.toMatchObject({ message: 'product_max_modifier_groups' });
    // Un mismo grupo puede vincularse a muchos productos.
    const shared = await group('shared');
    await link(await product(), shared, 0);
    await link(await product(), shared, 0);
  });

  it('concurrencia: dos vínculos simultáneos con 9 grupos no superan 10', async () => {
    const p = await product();
    for (let i = 0; i < 9; i++) await link(p, await group(`g${i}`), i);
    const ga = await group('ga');
    const gb = await group('gb');
    const c1 = new pg.Client({ connectionString: scratch });
    const c2 = new pg.Client({ connectionString: scratch });
    await c1.connect();
    await c2.connect();
    try {
      await c1.query('BEGIN');
      await c2.query('BEGIN');
      await c1.query(
        `INSERT INTO app.product_modifier_groups (product_id, group_id, sort_order) VALUES ($1,$2,9)`,
        [p, ga],
      );
      const second = c2
        .query(
          `INSERT INTO app.product_modifier_groups (product_id, group_id, sort_order) VALUES ($1,$2,10)`,
          [p, gb],
        )
        .then(
          () => ({ ok: true as const }),
          (e: { message?: string }) => ({ ok: false as const, message: e.message }),
        );
      await new Promise((r) => setTimeout(r, 300));
      await c1.query('COMMIT');
      expect(await second).toMatchObject({ ok: false, message: 'product_max_modifier_groups' });
      await c2.query('ROLLBACK');
    } finally {
      await c1.end();
      await c2.end();
    }
    const n = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM app.product_modifier_groups WHERE product_id = $1`,
      [p],
    );
    expect(n.rows[0]?.n).toBe(10);
  });

  it('ON DELETE RESTRICT: un grupo con opciones o con productos no se borra; sin ellos sí', async () => {
    const g = await group('G');
    const m = await modifier(g, 'm');
    await expect(q(`DELETE FROM app.modifier_groups WHERE id = $1`, [g])).rejects.toMatchObject(FK);
    await q(`DELETE FROM app.modifiers WHERE id = $1`, [m]);
    const p = await product();
    await link(p, g, 0);
    await expect(q(`DELETE FROM app.modifier_groups WHERE id = $1`, [g])).rejects.toMatchObject(FK);
    await q(`DELETE FROM app.product_modifier_groups WHERE product_id = $1`, [p]);
    await q(`DELETE FROM app.modifier_groups WHERE id = $1`, [g]);
  });

  it('ON DELETE CASCADE: borrar el producto borra sus vínculos y conserva grupos y opciones', async () => {
    const p = await product();
    const g = await group('G');
    await modifier(g, 'm');
    await link(p, g, 0);
    await q(`DELETE FROM app.products WHERE id = $1`, [p]);
    expect(await count('product_modifier_groups')).toBe(0);
    expect(await count('modifier_groups')).toBe(1);
    expect(await count('modifiers')).toBe(1);
  });

  it('no existe order_item_modifiers (pertenece a F20)', async () => {
    const r = await q<{ oid: string | null }>(
      `SELECT to_regclass('app.order_item_modifiers') AS oid`,
    );
    expect(r.rows[0]?.oid).toBeNull();
  });

  it('índices: listados por (group_id, sort_order) y (product_id, sort_order) recorren índice sin Sort; FK group_id indexado', async () => {
    const g = await group('G');
    for (let i = 0; i < 30; i++) await modifier(g, `m${i}`, 0, i);
    const p = await product();
    for (let i = 0; i < 5; i++) await link(p, await group(`pg${i}`), i);
    await q('ANALYZE app.modifiers');
    await q('ANALYZE app.product_modifier_groups');
    const explain = (sql: string, params: unknown[]) =>
      withClient(scratch, async (c) => {
        await c.query('SET enable_seqscan = off');
        await c.query('SET enable_bitmapscan = off');
        const r = await c.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${sql}`, params);
        return r.rows.map((x) => x['QUERY PLAN']).join('\n');
      });
    // Aserción robusta: recorrido por índice y ningún Sort (no se exige el nombre del índice).
    const a = await explain(
      `SELECT id FROM app.modifiers WHERE group_id = $1 ORDER BY sort_order`,
      [g],
    );
    expect(a).toMatch(/Index (Only )?Scan/);
    expect(a).not.toMatch(/\bSort\b/);
    const b = await explain(
      `SELECT group_id FROM app.product_modifier_groups WHERE product_id = $1 ORDER BY sort_order`,
      [p],
    );
    expect(b).toMatch(/Index (Only )?Scan/);
    expect(b).not.toMatch(/\bSort\b/);
    const c = await explain(
      `SELECT product_id FROM app.product_modifier_groups WHERE group_id = $1`,
      [g],
    );
    expect(c).toMatch(/Index (Only )?Scan/);
  });

  it('RLS habilitado y sin privilegios para PUBLIC ni anon/authenticated (omitida si los roles no existen)', async () => {
    const tables = ['modifier_groups', 'modifiers', 'product_modifier_groups'];
    for (const t of tables) {
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
    for (const fn of ['modifiers_enforce_limit', 'product_modifier_groups_enforce_limit']) {
      const acl = await q<{ n: number }>(
        `SELECT (SELECT count(*) FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0)::int AS n
           FROM pg_proc p WHERE p.oid = $1::regprocedure`,
        [`app.${fn}()`],
      );
      expect(acl.rows[0]?.n, fn).toBe(0);
    }
    const roles = await q<{ rolname: string }>(
      `SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') ORDER BY rolname`,
    );
    if (roles.rowCount === 0) {
      console.warn(
        '[migration-0013.int-spec] REVOKE a anon/authenticated no verificado: esos roles no existen.',
      );
      return;
    }
    for (const { rolname } of roles.rows) {
      for (const t of tables) {
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
