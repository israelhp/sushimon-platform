import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
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
 * Migración 0023 (F16 banners simplificados: CHECK de la fila 'es' solo con image_alt y tope de 5 banners por trigger)
 * sobre una base DESECHABLE creada aquí (`sushimon_mig0023_test`): se aplican 0001..0023 en orden. Mismo patrón y misma
 * omisión explícita que migration-0017/0022.int-spec.ts: requiere PostgreSQL plano (`DATABASE_URL_TEST`); si `auth.users`
 * es la de Supabase real se omite y se avisa. Al ser una base propia y nueva no depende de banners de pruebas previas;
 * cada caso parte de una tabla `app.banners` vacía.
 * El caso de concurrencia (dos sesiones) solo es significativo en PostgreSQL real (CI).
 */
const url = TEST_URL;
const SCRATCH = 'sushimon_mig0023_test';
const M0023 = '0023_banners_simplify';
const migrationsDir = join(process.cwd(), 'prisma', 'migrations');
const ALL = readdirSync(migrationsDir)
  .filter((d) => /^\d{4}_/.test(d) && d <= M0023)
  .sort();
const migrationSql = (name: string) =>
  readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf8');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const CHECK = { code: '23514' };
const FK = { code: '23503' };
const MAX = { code: '23514', constraint: 'banners_max_count', message: 'banners_max_count' };

describe.skipIf(!url)('Migración 0023: banners simplificados (base desechable)', () => {
  let scratch = '';
  let plain = false;
  let seq = 0;

  const q = <T extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ) => withClient(scratch, (c) => c.query<T>(sql, params));
  const total = async () =>
    (await q<{ n: number }>(`SELECT count(*)::int AS n FROM app.banners`)).rows[0]?.n;
  const insertAsset = async (c: pg.Client) => {
    const n = ++seq;
    const r = await c.query<{ id: string }>(
      `INSERT INTO app.media_assets (kind, object_key, bucket, mime_type, size_bytes, checksum_sha256, status, confirmed_at)
       VALUES ('BANNER_IMAGE', $1, 'sushimon-media', 'image/webp', 1024, $2, 'READY', now()) RETURNING id`,
      [`banners/2026/${n}.webp`, sha(`m23-${n}`)],
    );
    return r.rows[0]?.id as string;
  };
  const insertBanner = async (c: pg.Client) => {
    const assetId = await insertAsset(c);
    const r = await c.query<{ id: string }>(
      `INSERT INTO app.banners (code, image_asset_id) VALUES ($1, $2) RETURNING id`,
      [`banner-${++seq}`, assetId],
    );
    return { id: r.rows[0]?.id as string, assetId };
  };
  const banner = () => withClient(scratch, insertBanner);
  const tr = (id: string, locale: string, title: string | null, alt: string | null) =>
    q(
      `INSERT INTO app.banner_translations (banner_id, locale, title, image_alt) VALUES ($1,$2,$3,$4)`,
      [id, locale, title, alt],
    );
  const fill = async (n: number) => {
    for (let i = 0; i < n; i++) await banner();
  };

  beforeAll(async () => {
    plain = !(await withClient(url as string, hasRealSupabaseAuth));
    scratch = withDatabase(url as string, SCRATCH);
    if (!plain) {
      console.warn(
        '[migration-0023.int-spec] OMITIDA: DATABASE_URL_TEST apunta a un Supabase (auth.users real). Requiere PostgreSQL plano desechable; la migración 0023 NO se probó.',
      );
      return;
    }
    await withClient(url as string, async (c) => {
      await c.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
      await c.query(`CREATE DATABASE ${SCRATCH}`);
    });
    await withClient(scratch, async (c) => {
      await ensureAuthStub(c);
      for (const m of ALL) await c.query(migrationSql(m));
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
    await q('DELETE FROM app.banners'); // traducciones y sucursales caen en cascada
    await q('DELETE FROM app.media_assets');
  });

  it('es idempotente: reaplicarla no duplica el trigger ni cambia la restricción', async () => {
    await withClient(scratch, (c) => c.query(migrationSql(M0023)));
    await withClient(scratch, (c) => c.query(migrationSql(M0023)));
    const trg = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_trigger
        WHERE tgrelid = 'app.banners'::regclass AND tgname = 'banners_max_count_trg' AND NOT tgisinternal`,
    );
    expect(trg.rows[0]?.n).toBe(1);
    const def = await q<{ d: string }>(
      `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
        WHERE conrelid = 'app.banner_translations'::regclass AND conname = 'banner_translations_es_required_chk'`,
    );
    expect(def.rows).toHaveLength(1);
    expect(def.rows[0]?.d).toContain('image_alt');
    expect(def.rows[0]?.d).not.toContain('title');
  });

  it("fila 'es' sin title pasa; sin image_alt (NULL, en blanco o larga) falla", async () => {
    const { id } = await banner();
    await tr(id, 'es', null, 'Promo de sushi');
    expect(
      (await q(`SELECT 1 FROM app.banner_translations WHERE banner_id=$1`, [id])).rowCount,
    ).toBe(1);
    const other = await banner();
    await expect(tr(other.id, 'es', 'Título', null)).rejects.toMatchObject(CHECK);
    await expect(tr(other.id, 'es', null, null)).rejects.toMatchObject(CHECK);
    await expect(tr(other.id, 'es', null, '   ')).rejects.toMatchObject(CHECK);
    await expect(tr(other.id, 'es', null, 'a'.repeat(201))).rejects.toMatchObject(CHECK);
  });

  it("la fila 'en' no exige nada (sin cambios)", async () => {
    const { id } = await banner();
    await tr(id, 'en', null, null);
  });

  it('el 6.º INSERT falla con 23514 / banners_max_count; el 5.º pasa', async () => {
    await fill(4);
    await banner();
    await expect(banner()).rejects.toMatchObject(MAX);
    expect(await total()).toBe(5);
  });

  it('el tope no bloquea UPDATE, DELETE ni lecturas y se libera al borrar', async () => {
    await fill(5);
    await q(`UPDATE app.banners SET active = false, updated_at = now()`);
    expect((await q(`SELECT 1 FROM app.banners WHERE NOT active`)).rowCount).toBe(5);
    const one = (await q<{ id: string }>(`SELECT id FROM app.banners LIMIT 1`)).rows[0]
      ?.id as string;
    await q(`DELETE FROM app.banners WHERE id = $1`, [one]);
    await banner(); // vuelve a haber cupo
    await expect(banner()).rejects.toMatchObject(MAX);
  });

  it('con más de 5 filas históricas: UPDATE y DELETE funcionan y solo se impiden INSERT nuevos', async () => {
    await fill(5);
    await withClient(scratch, async (c) => {
      await c.query(`ALTER TABLE app.banners DISABLE TRIGGER banners_max_count_trg`);
      try {
        await insertBanner(c);
        await insertBanner(c);
      } finally {
        await c.query(`ALTER TABLE app.banners ENABLE TRIGGER banners_max_count_trg`);
      }
    });
    expect(await total()).toBe(7);
    await q(`UPDATE app.banners SET active = false`);
    await expect(banner()).rejects.toMatchObject(MAX);
    await q(`DELETE FROM app.banners WHERE id IN (SELECT id FROM app.banners LIMIT 2)`);
    await expect(banner()).rejects.toMatchObject(MAX); // quedan 5: sin cupo
    await q(`DELETE FROM app.banners WHERE id IN (SELECT id FROM app.banners LIMIT 1)`);
    await banner(); // quedan 4: hay cupo
  });

  it('borrar un banner conserva el asset y borra sus hijas; borrar el asset en uso falla (23503)', async () => {
    const { id, assetId } = await banner();
    await tr(id, 'es', null, 'Alt');
    await expect(q(`DELETE FROM app.media_assets WHERE id = $1`, [assetId])).rejects.toMatchObject(
      FK,
    );
    await q(`DELETE FROM app.banners WHERE id = $1`, [id]);
    expect(
      (await q(`SELECT 1 FROM app.banner_translations WHERE banner_id = $1`, [id])).rowCount,
    ).toBe(0);
    expect((await q(`SELECT 1 FROM app.media_assets WHERE id = $1`, [assetId])).rowCount).toBe(1);
    await q(`DELETE FROM app.media_assets WHERE id = $1`, [assetId]); // ahora sí
  });

  it('INSERT concurrentes (dos sesiones) con 4 banners: exactamente uno entra (solo PostgreSQL real)', async () => {
    await fill(4);
    const run = () =>
      withClient(scratch, async (c) => {
        await c.query('BEGIN');
        try {
          await insertBanner(c);
          await new Promise((r) => setTimeout(r, 300)); // retiene el bloqueo para forzar la carrera
          await c.query('COMMIT');
        } catch (e) {
          await c.query('ROLLBACK').catch(() => undefined);
          throw e;
        }
      });
    const res = await Promise.allSettled([run(), run()]);
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const bad = res.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(bad.reason).toMatchObject(MAX);
    expect(await total()).toBe(5);
  });
});
