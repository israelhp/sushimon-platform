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
 * Migración 0011 (F10 categorías con jerarquía) sobre una base DESECHABLE creada aquí (`sushimon_mig0011_test`),
 * con 0001..0011 aplicadas en orden. Mismo patrón y misma omisión explícita que migration-0009/0010.int-spec.ts:
 * requiere PostgreSQL plano (`DATABASE_URL_TEST`) con varias conexiones; si `auth.users` es la de Supabase real se
 * omite y se avisa.
 */
const url = TEST_URL;
const SCRATCH = 'sushimon_mig0011_test';
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
];
const migrationSql = (name: string) =>
  readFileSync(join(process.cwd(), 'prisma', 'migrations', name, 'migration.sql'), 'utf8');
const PRIVS = 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER';
const LOCK = 1100110;

describe.skipIf(!url)('Migración 0011: categorías con jerarquía (base desechable)', () => {
  let scratch = '';
  let plain = false;

  const q = <T extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ) => withClient(scratch, (c) => c.query<T>(sql, params));
  const insert = async (slug: string, parentId: string | null = null, extra = '') => {
    const res = await q<{ id: string }>(
      `INSERT INTO app.categories (slug, name, parent_id${extra ? ', ' + extra.split('=')[0] : ''})
       VALUES ($1, $2, $3${extra ? ', ' + extra.split('=')[1] : ''}) RETURNING id`,
      [slug, slug, parentId],
    );
    return res.rows[0]?.id as string;
  };
  // RESTRICT es inmediato: primero se desvinculan los padres y luego se borra todo.
  const reset = async () => {
    await q('UPDATE app.categories SET parent_id = NULL');
    await q('DELETE FROM app.categories');
  };

  beforeAll(async () => {
    plain = !(await withClient(url as string, hasRealSupabaseAuth));
    scratch = withDatabase(url as string, SCRATCH);
    if (!plain) {
      console.warn(
        '[migration-0011.int-spec] OMITIDA: DATABASE_URL_TEST apunta a un Supabase (auth.users real). Requiere PostgreSQL plano desechable; la migración 0011 NO se probó.',
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
    if (!plain) ctx.skip();
    else await reset();
  });

  it('es idempotente: aplicarla de nuevo no falla ni duplica el trigger', async () => {
    await withClient(scratch, (c) => c.query(migrationSql('0011_categories')));
    const t = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = 'app.categories'::regclass AND NOT tgisinternal`,
    );
    expect(t.rows[0]?.n).toBe(1);
  });

  it('slug: formato, longitud y unicidad', async () => {
    await insert('rolls-clasicos');
    for (const bad of ['Rolls', 'a_b', '-a', 'a-', 'a--b', '', 'a b', 'ñandú']) {
      await expect(insert(bad), bad).rejects.toMatchObject({ code: '23514' });
    }
    await expect(insert('a'.repeat(81))).rejects.toMatchObject({ code: '23514' });
    await insert('a'.repeat(80));
    await expect(insert('rolls-clasicos')).rejects.toMatchObject({ code: '23505' });
  });

  it('name, description y sort_order: CHECK', async () => {
    await expect(
      q(`INSERT INTO app.categories (slug, name) VALUES ('n1', '   ')`),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      q(`INSERT INTO app.categories (slug, name) VALUES ('n2', $1)`, ['x'.repeat(81)]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      q(`INSERT INTO app.categories (slug, name, description) VALUES ('n3', 'ok', $1)`, [
        'x'.repeat(501),
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await q(`INSERT INTO app.categories (slug, name, description) VALUES ('n4', 'ok', $1)`, [
      'x'.repeat(500),
    ]);
    await expect(
      q(`INSERT INTO app.categories (slug, name, sort_order) VALUES ('n5', 'ok', -1)`),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('defaults: sort_order 0, active true, created_at/updated_at presentes', async () => {
    const id = await insert('def');
    const r = await q<{ sort_order: number; active: boolean; c: boolean; u: boolean }>(
      `SELECT sort_order, active, created_at IS NOT NULL AS c, updated_at IS NOT NULL AS u FROM app.categories WHERE id = $1`,
      [id],
    );
    expect(r.rows[0]).toEqual({ sort_order: 0, active: true, c: true, u: true });
  });

  it('una categoría no puede ser su propio padre (CHECK)', async () => {
    const a = await insert('a');
    await expect(
      q(`UPDATE app.categories SET parent_id = id WHERE id = $1`, [a]),
    ).rejects.toMatchObject({
      code: '23514',
    });
  });

  it('ciclo directo (A->B, B->A) e indirecto (A->B->C, C->A) rechazados', async () => {
    const a = await insert('a');
    const b = await insert('b', a);
    await expect(
      q(`UPDATE app.categories SET parent_id = $1 WHERE id = $2`, [b, a]),
    ).rejects.toMatchObject({
      code: '23514',
      message: 'categories_parent_cycle',
    });
    // Árbol a -> b -> c: mover a bajo c cierra un ciclo de 3 nodos.
    const c = await insert('c', b);
    await expect(
      q(`UPDATE app.categories SET parent_id = $1 WHERE id = $2`, [c, a]),
    ).rejects.toMatchObject({
      code: '23514',
      message: 'categories_parent_cycle',
    });
  });

  it('profundidad: 3 niveles permitidos, el 4.º se rechaza (alta y reparentado de subárbol)', async () => {
    const a = await insert('l1');
    const b = await insert('l2', a);
    const c = await insert('l3', b);
    await expect(insert('l4', c)).rejects.toMatchObject({
      code: '23514',
      message: 'categories_max_depth',
    });
    // Reparentado: raíz x con hijo y (altura 2) bajo b (nivel 2) daría 4 niveles; bajo a (nivel 1) da 3.
    const x = await insert('x');
    await insert('y', x);
    await expect(
      q(`UPDATE app.categories SET parent_id = $1 WHERE id = $2`, [b, x]),
    ).rejects.toMatchObject({
      code: '23514',
      message: 'categories_max_depth',
    });
    await q(`UPDATE app.categories SET parent_id = $1 WHERE id = $2`, [a, x]);
    // Mover a raíz siempre se permite.
    await q(`UPDATE app.categories SET parent_id = NULL WHERE id = $1`, [x]);
  });

  it('ON DELETE RESTRICT: no se borra un padre con hijos; sí una hoja', async () => {
    const a = await insert('p');
    const b = await insert('h', a);
    await expect(q(`DELETE FROM app.categories WHERE id = $1`, [a])).rejects.toMatchObject({
      code: '23503',
    });
    await q(`DELETE FROM app.categories WHERE id = $1`, [b]);
    await q(`DELETE FROM app.categories WHERE id = $1`, [a]);
  });

  it('padre inexistente: violación de FK', async () => {
    await expect(insert('huerfana', '00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({
      code: '23503',
    });
  });

  it('listado de hermanos: el índice (parent_id, sort_order, name, id) sirve el orden sin Sort', async () => {
    const root = await insert('r');
    for (let i = 0; i < 30; i++) await insert(`h${i}`, root);
    await q('ANALYZE app.categories');
    const plan = await withClient(scratch, async (c) => {
      await c.query('SET enable_seqscan = off');
      return c.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT id FROM app.categories WHERE parent_id = $1 ORDER BY sort_order, name, id`,
        [root],
      );
    });
    const text = plan.rows.map((r) => r['QUERY PLAN']).join('\n');
    expect(text).toContain('categories_parent_sort_idx');
    expect(text).not.toMatch(/\bSort\b/);
  });

  it('RLS habilitado y sin privilegios para PUBLIC ni anon/authenticated (omitida si los roles no existen)', async () => {
    const rls = await q<{ relrowsecurity: boolean }>(
      `SELECT relrowsecurity FROM pg_class WHERE oid = 'app.categories'::regclass`,
    );
    expect(rls.rows[0]?.relrowsecurity).toBe(true);
    const pub = await q<{ n: number }>(
      `SELECT (SELECT count(*) FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a WHERE a.grantee = 0)::int AS n
         FROM pg_class c WHERE c.oid = 'app.categories'::regclass`,
    );
    expect(pub.rows[0]?.n).toBe(0);
    const roles = await q<{ rolname: string }>(
      `SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') ORDER BY rolname`,
    );
    if (roles.rowCount === 0) {
      console.warn(
        '[migration-0011.int-spec] REVOKE a anon/authenticated no verificado: esos roles no existen.',
      );
      return;
    }
    for (const { rolname } of roles.rows) {
      const r = await q<{ ok: boolean }>(
        `SELECT has_table_privilege($1, 'app.categories', $2) AS ok`,
        [rolname, PRIVS],
      );
      expect(r.rows[0]?.ok, rolname).toBe(false);
    }
  });

  it('concurrencia: reparentados opuestos simultáneos (A bajo B, B bajo A) no forman ciclo', async () => {
    const a = await insert('ca');
    const b = await insert('cb');
    const c1 = new pg.Client({ connectionString: scratch });
    const c2 = new pg.Client({ connectionString: scratch });
    await c1.connect();
    await c2.connect();
    try {
      await c1.query('BEGIN');
      await c2.query('BEGIN');
      await c1.query(`UPDATE app.categories SET parent_id = $1 WHERE id = $2`, [b, a]); // toma el bloqueo
      // c2 queda bloqueada en el trigger hasta que c1 termine; se lanza sin esperar.
      const second = c2
        .query(`UPDATE app.categories SET parent_id = $1 WHERE id = $2`, [a, b])
        .then(
          () => ({ ok: true as const }),
          (e: { code?: string; message?: string }) => ({
            ok: false as const,
            code: e.code,
            message: e.message,
          }),
        );
      // Confirma que c2 está esperando el advisory lock (no ha terminado) antes de liberar c1.
      let waiting = false;
      for (let i = 0; i < 50 && !waiting; i++) {
        const w = await q<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objid = $1`,
          [LOCK],
        );
        waiting = (w.rows[0]?.n ?? 0) > 0;
        if (!waiting) await new Promise((r) => setTimeout(r, 50));
      }
      expect(waiting).toBe(true);
      await c1.query('COMMIT');
      const result = await second;
      expect(result).toMatchObject({
        ok: false,
        code: '23514',
        message: 'categories_parent_cycle',
      });
      await c2.query('ROLLBACK');
    } finally {
      await c1.end();
      await c2.end();
    }
    const parents = await q<{ slug: string; parent_id: string | null }>(
      `SELECT slug, parent_id FROM app.categories WHERE slug IN ('ca','cb') ORDER BY slug`,
    );
    expect(parents.rows.filter((r) => r.parent_id !== null)).toHaveLength(1);
  });
});
