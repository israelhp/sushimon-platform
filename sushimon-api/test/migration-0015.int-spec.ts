import { createHash } from 'node:crypto';
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
 * Migración 0015 (F14 medios en Cloudflare R2: app.media_assets + product_media.asset_id) sobre una base DESECHABLE
 * creada aquí (`sushimon_mig0015_test`), con 0001..0015 aplicadas en orden. Mismo patrón y misma omisión explícita que
 * migration-0014.int-spec.ts: requiere PostgreSQL plano (`DATABASE_URL_TEST`); si `auth.users` es la de Supabase real
 * se omite y se avisa.
 */
const url = TEST_URL;
const SCRATCH = 'sushimon_mig0015_test';
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
];
const migrationSql = (name: string) =>
  readFileSync(join(process.cwd(), 'prisma', 'migrations', name, 'migration.sql'), 'utf8');
const PRIVS = 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER';
const CHECK = { code: '23514' };
const UNIQUE = { code: '23505' };
const FK = { code: '23503' };
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

type Overrides = Partial<{
  kind: string;
  object_key: string;
  bucket: string;
  mime_type: string;
  size_bytes: number | string;
  checksum_sha256: string;
  status: string;
  created_by_staff_id: string | null;
  confirmed_at: string | null;
  expires_at: string | null;
}>;

describe.skipIf(!url)('Migración 0015: media_assets (base desechable)', () => {
  let scratch = '';
  let plain = false;
  let seq = 0;

  const q = <T extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ) => withClient(scratch, (c) => c.query<T>(sql, params));

  /** PENDING válido por defecto; `o` sobrescribe columnas (null explícito = NULL). */
  const asset = async (o: Overrides = {}) => {
    const n = ++seq;
    const row = {
      kind: 'PRODUCT_IMAGE',
      object_key: `products/2026/${n}.webp`,
      bucket: 'sushimon-media',
      mime_type: 'image/webp',
      size_bytes: 1024,
      checksum_sha256: sha(`c${n}`),
      status: 'PENDING',
      created_by_staff_id: null as string | null,
      confirmed_at: null as string | null,
      expires_at: '2099-01-01T00:00:00Z' as string | null,
      ...o,
    };
    const cols = Object.keys(row);
    const r = await q<{ id: string }>(
      `INSERT INTO app.media_assets (${cols.join(',')})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
      Object.values(row),
    );
    return r.rows[0]?.id as string;
  };
  const ready = (o: Overrides = {}) =>
    asset({ status: 'READY', confirmed_at: '2026-01-01T00:00:00Z', expires_at: null, ...o });
  const staff = async () =>
    (
      await q<{ id: string }>(
        `INSERT INTO app.staff_users (full_name, email) VALUES ('s',$1) RETURNING id`,
        [`s${++seq}@x.test`],
      )
    ).rows[0]?.id as string;
  const mediaRow = async (assetId: string | null) => {
    const cat = (
      await q<{ id: string }>(
        `INSERT INTO app.categories (slug, name) VALUES ($1,'Cat') RETURNING id`,
        [`cat-${++seq}`],
      )
    ).rows[0]?.id;
    const p = (
      await q<{ id: string }>(
        `INSERT INTO app.products (slug, name, base_price, category_id) VALUES ($1,'p',10,$2) RETURNING id`,
        [`p-${++seq}`, cat],
      )
    ).rows[0]?.id;
    return q(
      `INSERT INTO app.product_media (product_id, media_url, sort_order, asset_id)
       VALUES ($1,'https://cdn.example.com/x.webp',0,$2)`,
      [p, assetId],
    );
  };

  beforeAll(async () => {
    plain = !(await withClient(url as string, hasRealSupabaseAuth));
    scratch = withDatabase(url as string, SCRATCH);
    if (!plain) {
      console.warn(
        '[migration-0015.int-spec] OMITIDA: DATABASE_URL_TEST apunta a un Supabase (auth.users real). Requiere PostgreSQL plano desechable; la migración 0015 NO se probó.',
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
    await q('DELETE FROM app.product_media');
    await q('DELETE FROM app.products');
    await q('DELETE FROM app.categories');
    await q('DELETE FROM app.media_assets');
    await q('DELETE FROM app.staff_users');
  });

  it('es idempotente: reaplicarla no falla ni duplica índices ni restricciones', async () => {
    await withClient(scratch, (c) => c.query(migrationSql('0015_media_assets')));
    const idx = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname='app' AND tablename='media_assets'`,
    );
    expect(idx.rows[0]?.n).toBe(5); // PK + object_key + dedup READY + purga PENDING + listado
    const fk = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_constraint WHERE conname='product_media_asset_id_fkey'`,
    );
    expect(fk.rows[0]?.n).toBe(1);
  });

  it('defaults y filas válidas: PENDING con expires_at y READY con confirmed_at', async () => {
    await asset();
    await ready();
    const r = await q<{ status: string; created_at: boolean }>(
      `SELECT status, created_at IS NOT NULL AS created_at FROM app.media_assets ORDER BY status`,
    );
    expect(r.rows.map((x) => x.status)).toEqual(['PENDING', 'READY']);
    expect(r.rows.every((x) => x.created_at)).toBe(true);
    // status por defecto = PENDING
    await q(
      `INSERT INTO app.media_assets (kind, object_key, bucket, mime_type, size_bytes, checksum_sha256, expires_at)
       VALUES ('PRODUCT_IMAGE','a/default.png','b','image/png',1,$1,now())`,
      [sha('default')],
    );
    const d = await q<{ status: string }>(
      `SELECT status FROM app.media_assets WHERE object_key='a/default.png'`,
    );
    expect(d.rows[0]?.status).toBe('PENDING');
  });

  it('CHECK de object_key: inseguras rechazadas; seguras aceptadas', async () => {
    for (const k of [
      '../x',
      '/x',
      'a//b',
      'a/../b',
      'Products/x.webp',
      'a b',
      '-x',
      '.x',
      `a${'b'.repeat(200)}`,
    ]) {
      await expect(asset({ object_key: k }), k).rejects.toMatchObject(CHECK);
    }
    await asset({ object_key: 'a'.repeat(200) });
    await asset({ object_key: 'products/2026/ab-c_d.e.webp' });
  });

  it('CHECK de kind, mime, bucket, size y checksum', async () => {
    await expect(asset({ kind: 'AVATAR' })).rejects.toMatchObject(CHECK);
    for (const m of ['image/gif', 'image/svg+xml', 'application/pdf', 'IMAGE/PNG']) {
      await expect(asset({ mime_type: m }), m).rejects.toMatchObject(CHECK);
    }
    for (const m of ['image/jpeg', 'image/png', 'image/webp', 'image/avif']) {
      await asset({ mime_type: m });
    }
    await expect(asset({ bucket: '' })).rejects.toMatchObject(CHECK);
    await expect(asset({ bucket: 'b'.repeat(64) })).rejects.toMatchObject(CHECK);
    await asset({ bucket: 'b'.repeat(63) });
    for (const s of [0, -1, 5242881]) {
      await expect(asset({ size_bytes: s }), String(s)).rejects.toMatchObject(CHECK);
    }
    await asset({ size_bytes: 1 });
    await asset({ size_bytes: 5242880 });
    for (const c of ['', 'abc', 'A'.repeat(64), 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]) {
      await expect(asset({ checksum_sha256: c }), c).rejects.toMatchObject(CHECK);
    }
  });

  it('CHECK de status y coherencia con fechas', async () => {
    await expect(asset({ status: 'DELETED' })).rejects.toMatchObject(CHECK);
    await expect(asset({ expires_at: null })).rejects.toMatchObject(CHECK); // PENDING sin expires_at
    await expect(
      asset({ status: 'READY', confirmed_at: null, expires_at: null }),
    ).rejects.toMatchObject(CHECK); // READY sin confirmed_at
    // Un READY puede conservar expires_at; un PENDING puede tener confirmed_at (no se prohíbe).
    await ready({ expires_at: '2099-01-01T00:00:00Z' });
    // Pasar a READY sin confirmed_at falla; con él, funciona.
    const id = await asset();
    await expect(
      q(`UPDATE app.media_assets SET status='READY' WHERE id=$1`, [id]),
    ).rejects.toMatchObject(CHECK);
    await q(`UPDATE app.media_assets SET status='READY', confirmed_at=now() WHERE id=$1`, [id]);
  });

  it('UNIQUE object_key', async () => {
    await asset({ object_key: 'dup/key.png' });
    await expect(asset({ object_key: 'dup/key.png' })).rejects.toMatchObject(UNIQUE);
  });

  it('UNIQUE parcial de checksum: solo entre READY; PENDING repetidos permitidos', async () => {
    const c = sha('same');
    await asset({ checksum_sha256: c });
    await asset({ checksum_sha256: c }); // dos PENDING iguales
    await ready({ checksum_sha256: c }); // un READY junto a PENDING
    await expect(ready({ checksum_sha256: c })).rejects.toMatchObject(UNIQUE); // segundo READY
    await ready({ checksum_sha256: sha('other') }); // otro checksum
    // Confirmar un PENDING cuyo checksum ya es READY choca (el servicio reutiliza el existente).
    const pending = await asset({ checksum_sha256: c });
    await expect(
      q(`UPDATE app.media_assets SET status='READY', confirmed_at=now() WHERE id=$1`, [pending]),
    ).rejects.toMatchObject(UNIQUE);
  });

  it('created_by_staff_id: FK válida, inexistente rechazado, ON DELETE SET NULL conserva el asset', async () => {
    const s = await staff();
    const id = await asset({ created_by_staff_id: s });
    await expect(
      asset({ created_by_staff_id: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toMatchObject(FK);
    await q(`DELETE FROM app.staff_users WHERE id=$1`, [s]);
    const r = await q<{ created_by_staff_id: string | null }>(
      `SELECT created_by_staff_id FROM app.media_assets WHERE id=$1`,
      [id],
    );
    expect(r.rowCount).toBe(1);
    expect(r.rows[0]?.created_by_staff_id).toBeNull();
  });

  it('product_media.asset_id: NULL permitido, inexistente rechazado, un asset en varias filas', async () => {
    await mediaRow(null);
    await expect(mediaRow('00000000-0000-0000-0000-000000000000')).rejects.toMatchObject(FK);
    const a = await ready();
    await mediaRow(a);
    await mediaRow(a);
    const r = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM app.product_media WHERE asset_id=$1`,
      [a],
    );
    expect(r.rows[0]?.n).toBe(2);
  });

  it('FK RESTRICT: un asset en uso no se borra; sin uso sí; media_url sigue NOT NULL', async () => {
    const a = await ready();
    await mediaRow(a);
    await expect(q(`DELETE FROM app.media_assets WHERE id=$1`, [a])).rejects.toMatchObject(FK);
    await q(`DELETE FROM app.product_media WHERE asset_id=$1`, [a]);
    await q(`DELETE FROM app.media_assets WHERE id=$1`, [a]);
    const nn = await q<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema='app' AND table_name='product_media' AND column_name='media_url'`,
    );
    expect(nn.rows[0]?.is_nullable).toBe('NO');
  });

  it('índices: purga de PENDING, listado y product_media.asset_id recorren índice (seqscan desactivado)', async () => {
    for (let i = 0; i < 20; i++) await asset();
    const a = await ready();
    await mediaRow(a);
    await q('ANALYZE app.media_assets');
    await q('ANALYZE app.product_media');
    const explain = (sql: string, params: unknown[] = []) =>
      withClient(scratch, async (c) => {
        await c.query('SET enable_seqscan = off');
        const r = await c.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${sql}`, params);
        return r.rows.map((x) => x['QUERY PLAN']).join('\n');
      });
    // Aserción robusta: recorrido por índice; no se exige el nombre.
    const purge = await explain(
      `SELECT id FROM app.media_assets WHERE status = 'PENDING' AND expires_at < now()`,
    );
    expect(purge).toMatch(/Index (Only )?Scan|Bitmap Index Scan/);
    const list = await explain(
      `SELECT id FROM app.media_assets ORDER BY created_at DESC, id LIMIT 20`,
    );
    expect(list).toMatch(/Index (Only )?Scan/);
    const usage = await explain(`SELECT id FROM app.product_media WHERE asset_id = $1`, [a]);
    expect(usage).toMatch(/Index (Only )?Scan|Bitmap Index Scan/);
    // El FK asset_id tiene índice propio (columna líder).
    const idx = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_index i
        WHERE i.indrelid = 'app.product_media'::regclass
          AND i.indkey[0] = (SELECT attnum FROM pg_attribute
                              WHERE attrelid = 'app.product_media'::regclass AND attname = 'asset_id')`,
    );
    expect(idx.rows[0]?.n).toBeGreaterThanOrEqual(1);
  });

  it('RLS habilitado y sin privilegios para PUBLIC ni anon/authenticated (omitida si los roles no existen)', async () => {
    const rls = await q<{ relrowsecurity: boolean }>(
      `SELECT relrowsecurity FROM pg_class WHERE oid = 'app.media_assets'::regclass`,
    );
    expect(rls.rows[0]?.relrowsecurity).toBe(true);
    const pub = await q<{ n: number }>(
      `SELECT (SELECT count(*) FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a WHERE a.grantee = 0)::int AS n
         FROM pg_class c WHERE c.oid = 'app.media_assets'::regclass`,
    );
    expect(pub.rows[0]?.n).toBe(0);
    const roles = await q<{ rolname: string }>(
      `SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated') ORDER BY rolname`,
    );
    if (roles.rowCount === 0) {
      console.warn(
        '[migration-0015.int-spec] REVOKE a anon/authenticated no verificado: esos roles no existen.',
      );
      return;
    }
    for (const { rolname } of roles.rows) {
      const r = await q<{ ok: boolean }>(`SELECT has_table_privilege($1, $2, $3) AS ok`, [
        rolname,
        'app.media_assets',
        PRIVS,
      ]);
      expect(r.rows[0]?.ok, rolname).toBe(false);
    }
  });
});
