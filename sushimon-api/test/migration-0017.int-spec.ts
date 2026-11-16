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
 * Migración 0017 (F16 banners: app.banners, banner_translations, banner_branches; media_assets BANNER_IMAGE; permisos
 * banners.*) sobre una base DESECHABLE creada aquí (`sushimon_mig0017_test`), con 0001..0016 aplicadas en orden, una fila
 * PRODUCT_IMAGE previa y luego 0017 (prueba de que es segura sobre datos existentes). Mismo patrón y misma omisión
 * explícita que migration-0016.int-spec.ts: requiere PostgreSQL plano (`DATABASE_URL_TEST`); si `auth.users` es la de
 * Supabase real se omite y se avisa.
 */
const url = TEST_URL;
const SCRATCH = 'sushimon_mig0017_test';
const BEFORE = [
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
const M0017 = '0017_banners';
const migrationSql = (name: string) =>
  readFileSync(join(process.cwd(), 'prisma', 'migrations', name, 'migration.sql'), 'utf8');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const PRIVS = 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER';
const CHECK = { code: '23514' };
const UNIQUE = { code: '23505' };
const FK = { code: '23503' };
const TABLES = ['banners', 'banner_translations', 'banner_branches'];
const ZERO = '00000000-0000-0000-0000-000000000000';
const MIB = 1048576;

describe.skipIf(!url)('Migración 0017: banners (base desechable)', () => {
  let scratch = '';
  let plain = false;
  let seq = 0;
  let legacyAssetId = '';

  const q = <T extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ) => withClient(scratch, (c) => c.query<T>(sql, params));
  const count = async (table: string) =>
    (await q<{ n: number }>(`SELECT count(*)::int AS n FROM app.${table}`)).rows[0]?.n;

  /** Asset READY válido (BANNER_IMAGE por defecto); `o` sobrescribe columnas. */
  const asset = async (o: Record<string, unknown> = {}) => {
    const n = ++seq;
    const row = {
      kind: 'BANNER_IMAGE',
      object_key: `banners/2026/${n}.webp`,
      bucket: 'sushimon-media',
      mime_type: 'image/webp',
      size_bytes: 1024,
      checksum_sha256: sha(`b${n}`),
      status: 'READY',
      confirmed_at: new Date().toISOString(),
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

  /** Banner válido por defecto (CTA NONE); `o` sobrescribe columnas (null explícito = NULL). */
  const banner = async (o: Record<string, unknown> = {}) => {
    const row: Record<string, unknown> = {
      code: `banner-${++seq}`,
      image_asset_id: await asset(),
      ...o,
    };
    const cols = Object.keys(row);
    const r = await q<{ id: string }>(
      `INSERT INTO app.banners (${cols.join(',')})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
      Object.values(row),
    );
    return r.rows[0]?.id as string;
  };
  const tr = (
    bannerId: string,
    locale: string,
    o: Partial<Record<'title' | 'subtitle' | 'cta_label' | 'image_alt', string | null>> = {},
  ) => {
    const row = { title: 'Título', subtitle: null, cta_label: null, image_alt: 'Alt', ...o };
    return q(
      `INSERT INTO app.banner_translations (banner_id, locale, title, subtitle, cta_label, image_alt)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [bannerId, locale, row.title, row.subtitle, row.cta_label, row.image_alt],
    );
  };
  const branch = async () =>
    (
      await q<{ id: string }>(
        `INSERT INTO app.branches (code, name, address) VALUES ($1,'B','dir') RETURNING id`,
        [`suc-${++seq}`],
      )
    ).rows[0]?.id as string;
  const category = async () =>
    (
      await q<{ id: string }>(
        `INSERT INTO app.categories (slug, name) VALUES ($1,'Cat') RETURNING id`,
        [`cat-${++seq}`],
      )
    ).rows[0]?.id as string;
  const product = async () =>
    (
      await q<{ id: string }>(
        `INSERT INTO app.products (slug, name, base_price, category_id) VALUES ($1,'p',10,$2) RETURNING id`,
        [`p-${++seq}`, await category()],
      )
    ).rows[0]?.id as string;
  const promotion = async () =>
    (
      await q<{ id: string }>(
        `INSERT INTO app.promotions (name, kind, value, starts_at, ends_at)
         VALUES ($1,'PERCENT',10,'2026-01-01T00:00:00Z','2026-12-31T00:00:00Z') RETURNING id`,
        [`Promo ${++seq}`],
      )
    ).rows[0]?.id as string;

  beforeAll(async () => {
    plain = !(await withClient(url as string, hasRealSupabaseAuth));
    scratch = withDatabase(url as string, SCRATCH);
    if (!plain) {
      console.warn(
        '[migration-0017.int-spec] OMITIDA: DATABASE_URL_TEST apunta a un Supabase (auth.users real). Requiere PostgreSQL plano desechable; la migración 0017 NO se probó.',
      );
      return;
    }
    await withClient(url as string, async (c) => {
      await c.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
      await c.query(`CREATE DATABASE ${SCRATCH}`);
    });
    await withClient(scratch, async (c) => {
      await ensureAuthStub(c);
      for (const m of BEFORE) await c.query(migrationSql(m));
      // Dato previo a 0017 (única forma de kind posible entonces): debe sobrevivir intacto.
      const r = await c.query<{ id: string }>(
        `INSERT INTO app.media_assets (kind, object_key, bucket, mime_type, size_bytes, checksum_sha256, status, confirmed_at)
         VALUES ('PRODUCT_IMAGE','products/2026/legacy.webp','b','image/webp',4194304,$1,'READY',now()) RETURNING id`,
        [sha('legacy')],
      );
      legacyAssetId = r.rows[0]?.id as string;
      await c.query(migrationSql(M0017));
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
    await q('DELETE FROM app.promotions');
    await q('DELETE FROM app.products');
    await q('DELETE FROM app.categories');
    await q('DELETE FROM app.branches');
    await q(`DELETE FROM app.media_assets WHERE id <> $1`, [legacyAssetId]);
  });

  it('es idempotente: reaplicarla no falla ni duplica índices, restricciones ni permisos', async () => {
    const before = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = 'app.media_assets'::regclass`,
    );
    await withClient(scratch, (c) => c.query(migrationSql(M0017)));
    const idx = await q<{ tablename: string; n: number }>(
      `SELECT tablename, count(*)::int AS n FROM pg_indexes
        WHERE schemaname='app' AND tablename = ANY($1) GROUP BY tablename ORDER BY tablename`,
      [TABLES],
    );
    // banners: PK + code UNIQUE + active_order + image_asset; translations: PK; branches: PK + branch_idx.
    expect(Object.fromEntries(idx.rows.map((r) => [r.tablename, r.n]))).toEqual({
      banner_branches: 2,
      banner_translations: 1,
      banners: 4,
    });
    const after = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = 'app.media_assets'::regclass`,
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    expect((await q(`SELECT 1 FROM app.permissions WHERE code LIKE 'banners.%'`)).rowCount).toBe(3);
  });

  it('la guarda falla con claridad si una tabla existe con otra definición', async () => {
    await withClient(scratch, async (c) => {
      await c.query('BEGIN');
      try {
        await c.query(`ALTER TABLE app.banners DROP CONSTRAINT banners_period_chk`);
        await expect(c.query(migrationSql(M0017))).rejects.toThrow(/banners_period_chk/);
      } finally {
        await c.query('ROLLBACK');
      }
    });
  });

  it('defaults: cta_type NONE, active=true, sort_order=0, version=1, fechas NULL, created_at/updated_at', async () => {
    const id = await banner();
    const r = await q<Record<string, unknown>>(`SELECT * FROM app.banners WHERE id=$1`, [id]);
    expect(r.rows[0]).toMatchObject({
      cta_type: 'NONE',
      active: true,
      sort_order: 0,
      version: 1,
      starts_at: null,
      ends_at: null,
      promotion_id: null,
      cta_category_id: null,
      cta_product_id: null,
      cta_page: null,
    });
    expect(r.rows[0]?.['created_at']).toBeInstanceOf(Date);
    expect(r.rows[0]?.['updated_at']).toBeInstanceOf(Date);
  });

  it('CHECK de formato de code: mayúsculas, espacios, cortos, largos y guion inicial rechazados', async () => {
    for (const c of [
      'AB-Cde',
      'ab',
      'a'.repeat(65),
      '-abc',
      'ab c',
      ' abc',
      'ab_c',
      'ab.c',
      'ábc',
      '',
    ]) {
      await expect(banner({ code: c }), c).rejects.toMatchObject(CHECK);
    }
    await banner({ code: 'abc' });
    await banner({ code: 'a'.repeat(64) });
    await banner({ code: '1-favoritos-2' });
  });

  it('UNIQUE code: duplicado rechazado', async () => {
    await banner({ code: 'dup-banner' });
    await expect(banner({ code: 'dup-banner' })).rejects.toMatchObject(UNIQUE);
  });

  it('CHECK de cta_type y de la referencia única por tipo', async () => {
    const cat = await category();
    const prod = await product();
    await expect(banner({ cta_type: 'EXTERNAL' })).rejects.toMatchObject(CHECK);
    await expect(banner({ cta_type: 'menu' })).rejects.toMatchObject(CHECK);
    for (const t of ['NONE', 'MENU', 'PROMOTIONS']) await banner({ cta_type: t });
    // Tipo con referencia obligatoria, ausente.
    await expect(banner({ cta_type: 'CATEGORY' })).rejects.toMatchObject(CHECK);
    await expect(banner({ cta_type: 'PRODUCT' })).rejects.toMatchObject(CHECK);
    await expect(banner({ cta_type: 'PAGE' })).rejects.toMatchObject(CHECK);
    // Referencia presente con un tipo que no la usa o con la referencia de otro tipo.
    await expect(banner({ cta_type: 'NONE', cta_category_id: cat })).rejects.toMatchObject(CHECK);
    await expect(banner({ cta_type: 'MENU', cta_product_id: prod })).rejects.toMatchObject(CHECK);
    await expect(banner({ cta_type: 'PROMOTIONS', cta_page: 'CAREERS' })).rejects.toMatchObject(
      CHECK,
    );
    await expect(
      banner({ cta_type: 'CATEGORY', cta_category_id: cat, cta_product_id: prod }),
    ).rejects.toMatchObject(CHECK);
    await expect(banner({ cta_type: 'CATEGORY', cta_product_id: prod })).rejects.toMatchObject(
      CHECK,
    );
    await expect(
      banner({ cta_type: 'PAGE', cta_page: 'CAREERS', cta_category_id: cat }),
    ).rejects.toMatchObject(CHECK);
    // Válidos.
    await banner({ cta_type: 'CATEGORY', cta_category_id: cat });
    await banner({ cta_type: 'PRODUCT', cta_product_id: prod });
    await banner({ cta_type: 'PAGE', cta_page: 'CAREERS' });
  });

  it('CHECK de cta_page: solo la lista blanca CAREERS, TRACK_ORDER, INCIDENTS', async () => {
    for (const p of [
      'careers',
      'HOME',
      'https://evil.example',
      '/menu',
      'javascript:alert(1)',
      '',
    ]) {
      await expect(banner({ cta_type: 'PAGE', cta_page: p }), p).rejects.toMatchObject(CHECK);
    }
    for (const p of ['CAREERS', 'TRACK_ORDER', 'INCIDENTS']) {
      await banner({ cta_type: 'PAGE', cta_page: p });
    }
  });

  it('CHECK de periodo: ends_at <= starts_at rechazado; extremos NULL permitidos', async () => {
    const t = '2026-06-01T00:00:00Z';
    await expect(banner({ starts_at: t, ends_at: t })).rejects.toMatchObject(CHECK);
    await expect(banner({ starts_at: '2026-06-02T00:00:00Z', ends_at: t })).rejects.toMatchObject(
      CHECK,
    );
    await banner({ starts_at: t, ends_at: '2026-06-01T00:00:01Z' });
    await banner({ starts_at: t, ends_at: null });
    await banner({ starts_at: null, ends_at: t });
    await banner({ starts_at: null, ends_at: null });
  });

  it('CHECK de sort_order (0..9999, no único) y version (>= 1)', async () => {
    await expect(banner({ sort_order: -1 })).rejects.toMatchObject(CHECK);
    await expect(banner({ sort_order: 10000 })).rejects.toMatchObject(CHECK);
    await banner({ sort_order: 0 });
    await banner({ sort_order: 9999 });
    // No único: dos banners con la misma prioridad son válidos.
    await banner({ sort_order: 5 });
    await banner({ sort_order: 5 });
    await expect(banner({ version: 0 })).rejects.toMatchObject(CHECK);
    await banner({ version: 1 });
  });

  it('image_asset_id es obligatorio (NOT NULL) y su FK rechaza assets inexistentes', async () => {
    await expect(
      q(`INSERT INTO app.banners (code, image_asset_id) VALUES ('sin-imagen', NULL)`),
    ).rejects.toMatchObject({ code: '23502' });
    await expect(banner({ image_asset_id: ZERO })).rejects.toMatchObject(FK);
  });

  it('FK RESTRICT: no se borra un asset, promoción, categoría, producto ni sucursal en uso', async () => {
    const img = await asset();
    const promo = await promotion();
    const cat = await category();
    const prod = await product();
    const br = await branch();
    const b = await banner({ image_asset_id: img, promotion_id: promo });
    const bc = await banner({ cta_type: 'CATEGORY', cta_category_id: cat });
    const bp = await banner({ cta_type: 'PRODUCT', cta_product_id: prod });
    await q(`INSERT INTO app.banner_branches (banner_id, branch_id) VALUES ($1,$2)`, [b, br]);
    await expect(q(`DELETE FROM app.media_assets WHERE id=$1`, [img])).rejects.toMatchObject(FK);
    await expect(q(`DELETE FROM app.promotions WHERE id=$1`, [promo])).rejects.toMatchObject(FK);
    await expect(q(`DELETE FROM app.categories WHERE id=$1`, [cat])).rejects.toMatchObject(FK);
    await expect(q(`DELETE FROM app.products WHERE id=$1`, [prod])).rejects.toMatchObject(FK);
    await expect(q(`DELETE FROM app.branches WHERE id=$1`, [br])).rejects.toMatchObject(FK);
    // FK a destinos inexistentes.
    await expect(banner({ cta_type: 'CATEGORY', cta_category_id: ZERO })).rejects.toMatchObject(FK);
    await expect(banner({ cta_type: 'PRODUCT', cta_product_id: ZERO })).rejects.toMatchObject(FK);
    await expect(banner({ promotion_id: ZERO })).rejects.toMatchObject(FK);
    // Tras quitar el uso sí se puede borrar.
    await q(`DELETE FROM app.banner_branches WHERE banner_id=$1`, [b]);
    await q(`DELETE FROM app.banners WHERE id = ANY($1)`, [[b, bc, bp]]);
    await q(`DELETE FROM app.media_assets WHERE id=$1`, [img]);
    await q(`DELETE FROM app.promotions WHERE id=$1`, [promo]);
    await q(`DELETE FROM app.branches WHERE id=$1`, [br]);
  });

  it('traducciones: locale solo es|en; PK (banner, locale) impide duplicados', async () => {
    const b = await banner();
    for (const l of ['fr', 'ES', '', 'es-GT']) {
      await expect(tr(b, l), l).rejects.toMatchObject(CHECK);
    }
    await tr(b, 'es');
    await tr(b, 'en');
    await expect(tr(b, 'es')).rejects.toMatchObject(UNIQUE);
    await expect(tr(ZERO, 'es')).rejects.toMatchObject(FK);
  });

  it('traducciones: la fila es exige title e image_alt; en puede estar vacía', async () => {
    const b = await banner();
    await expect(tr(b, 'es', { title: null })).rejects.toMatchObject(CHECK);
    await expect(tr(b, 'es', { image_alt: null })).rejects.toMatchObject(CHECK);
    await expect(tr(b, 'es', { title: null, image_alt: null })).rejects.toMatchObject(CHECK);
    await tr(b, 'es');
    await tr(b, 'en', { title: null, image_alt: null });
  });

  it('traducciones: longitudes y texto en blanco rechazados (en blanco = NULL)', async () => {
    const b = await banner();
    for (const field of ['title', 'subtitle', 'cta_label', 'image_alt'] as const) {
      await expect(tr(b, 'en', { [field]: '' }), `${field} vacío`).rejects.toMatchObject(CHECK);
      await expect(tr(b, 'en', { [field]: '   ' }), `${field} blanco`).rejects.toMatchObject(CHECK);
    }
    const max = { title: 80, subtitle: 160, cta_label: 40, image_alt: 200 } as const;
    for (const [field, n] of Object.entries(max)) {
      await expect(tr(b, 'en', { [field]: 'x'.repeat(n + 1) }), field).rejects.toMatchObject(CHECK);
    }
    await tr(b, 'en', {
      title: 'x'.repeat(80),
      subtitle: 'x'.repeat(160),
      cta_label: 'x'.repeat(40),
      image_alt: 'x'.repeat(200),
    });
  });

  it('banner_branches: PK sin duplicados; FK a banner y a sucursal', async () => {
    const b = await banner();
    const br = await branch();
    await q(`INSERT INTO app.banner_branches (banner_id, branch_id) VALUES ($1,$2)`, [b, br]);
    await expect(
      q(`INSERT INTO app.banner_branches (banner_id, branch_id) VALUES ($1,$2)`, [b, br]),
    ).rejects.toMatchObject(UNIQUE);
    await expect(
      q(`INSERT INTO app.banner_branches (banner_id, branch_id) VALUES ($1,$2)`, [b, ZERO]),
    ).rejects.toMatchObject(FK);
    await expect(
      q(`INSERT INTO app.banner_branches (banner_id, branch_id) VALUES ($1,$2)`, [ZERO, br]),
    ).rejects.toMatchObject(FK);
  });

  it('FK CASCADE: borrar el banner borra sus traducciones y sucursales, no la imagen ni la sucursal', async () => {
    const img = await asset();
    const b = await banner({ image_asset_id: img });
    await tr(b, 'es');
    await tr(b, 'en');
    await q(`INSERT INTO app.banner_branches (banner_id, branch_id) VALUES ($1,$2)`, [
      b,
      await branch(),
    ]);
    await q(`DELETE FROM app.banners WHERE id=$1`, [b]);
    expect(await count('banner_translations')).toBe(0);
    expect(await count('banner_branches')).toBe(0);
    expect(await count('branches')).toBe(1);
    expect((await q(`SELECT 1 FROM app.media_assets WHERE id=$1`, [img])).rowCount).toBe(1);
  });

  describe('media_assets (F14) ampliado', () => {
    it('la fila PRODUCT_IMAGE previa a 0017 (4 MiB, products/) sigue intacta', async () => {
      const r = await q<{ kind: string; size_bytes: string; status: string }>(
        `SELECT kind, size_bytes, status FROM app.media_assets WHERE id=$1`,
        [legacyAssetId],
      );
      expect(r.rows[0]).toMatchObject({
        kind: 'PRODUCT_IMAGE',
        size_bytes: '4194304',
        status: 'READY',
      });
    });

    it('kind admite PRODUCT_IMAGE y BANNER_IMAGE; otros valores rechazados', async () => {
      await asset({ kind: 'PRODUCT_IMAGE', object_key: `products/2026/${++seq}.webp` });
      await asset();
      for (const k of ['AVATAR', 'banner_image', 'PRODUCT', '']) {
        await expect(asset({ kind: k }), k).rejects.toMatchObject(CHECK);
      }
      const defs = await q<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid = 'app.media_assets'::regclass AND conname = 'media_assets_kind_chk'`,
      );
      expect(defs.rowCount).toBe(1);
      expect(defs.rows[0]?.def).toContain('BANNER_IMAGE');
    });

    it('coherencia kind/prefijo de object_key: prefijos cruzados o ajenos rechazados', async () => {
      await expect(
        asset({ kind: 'BANNER_IMAGE', object_key: `products/2026/${++seq}.webp` }),
      ).rejects.toMatchObject(CHECK);
      await expect(
        asset({ kind: 'PRODUCT_IMAGE', object_key: `banners/2026/${++seq}.webp` }),
      ).rejects.toMatchObject(CHECK);
      await expect(
        asset({ kind: 'BANNER_IMAGE', object_key: `otro/2026/${++seq}.webp` }),
      ).rejects.toMatchObject(CHECK);
      await expect(
        asset({ kind: 'PRODUCT_IMAGE', object_key: `a/${++seq}.webp` }),
      ).rejects.toMatchObject(CHECK);
      await asset({ kind: 'BANNER_IMAGE', object_key: `banners/2026/${++seq}.webp` });
      await asset({ kind: 'PRODUCT_IMAGE', object_key: `products/2026/${++seq}.webp` });
    });

    it('tope de 1 MiB solo para BANNER_IMAGE; PRODUCT_IMAGE conserva el genérico de 5 MiB', async () => {
      await expect(asset({ size_bytes: MIB + 1 })).rejects.toMatchObject(CHECK);
      await asset({ size_bytes: MIB });
      await asset({ size_bytes: 1 });
      await asset({
        kind: 'PRODUCT_IMAGE',
        object_key: `products/2026/${++seq}.webp`,
        size_bytes: 5242880,
      });
      await expect(
        asset({
          kind: 'PRODUCT_IMAGE',
          object_key: `products/2026/${++seq}.webp`,
          size_bytes: 5242881,
        }),
      ).rejects.toMatchObject(CHECK);
      // El genérico sigue rigiendo también para banners.
      await expect(asset({ size_bytes: 0 })).rejects.toMatchObject(CHECK);
    });

    it('el dedup (kind, checksum) READY sigue funcionando y distingue tipos', async () => {
      const c = sha('dup');
      await asset({ checksum_sha256: c });
      await expect(asset({ checksum_sha256: c })).rejects.toMatchObject(UNIQUE);
      await asset({
        kind: 'PRODUCT_IMAGE',
        object_key: `products/2026/${++seq}.webp`,
        checksum_sha256: c,
      });
    });
  });

  it('permisos: 46 en el catálogo; banners.read|create|update solo para admin', async () => {
    expect((await q(`SELECT 1 FROM app.permissions`)).rowCount).toBe(46);
    const banners = await q<{ role: string; code: string }>(
      `SELECT r.code AS role, p.code FROM app.role_permissions rp
         JOIN app.roles r ON r.id = rp.role_id JOIN app.permissions p ON p.id = rp.permission_id
        WHERE p.code LIKE 'banners.%' ORDER BY r.code, p.code`,
    );
    expect(banners.rows).toEqual([
      { role: 'admin', code: 'banners.create' },
      { role: 'admin', code: 'banners.read' },
      { role: 'admin', code: 'banners.update' },
    ]);
    // Invariante de 0005: admin tiene TODO el catálogo.
    const missing = await q(
      `SELECT p.code FROM app.permissions p
        WHERE NOT EXISTS (SELECT 1 FROM app.role_permissions rp JOIN app.roles r ON r.id = rp.role_id
                           WHERE rp.permission_id = p.id AND r.code = 'admin')`,
    );
    expect(missing.rows).toEqual([]);
  });

  it('índices: orden de banners activos, banners por sucursal y por asset recorren índice (seqscan desactivado)', async () => {
    for (let i = 0; i < 20; i++) await banner({ sort_order: i });
    const br = await branch();
    const img = await asset();
    const b = await banner({ image_asset_id: img });
    await q(`INSERT INTO app.banner_branches (banner_id, branch_id) VALUES ($1,$2)`, [b, br]);
    for (const t of TABLES) await q(`ANALYZE app.${t}`);
    const explain = (sql: string, params: unknown[] = []) =>
      withClient(scratch, async (c) => {
        await c.query('SET enable_seqscan = off');
        const r = await c.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${sql}`, params);
        return r.rows.map((x) => x['QUERY PLAN']).join('\n');
      });
    const re = /Index (Only )?Scan|Bitmap Index Scan/;
    expect(
      await explain(`SELECT id FROM app.banners WHERE active ORDER BY sort_order, created_at, id`),
    ).toMatch(re);
    expect(
      await explain(`SELECT banner_id FROM app.banner_branches WHERE branch_id = $1`, [br]),
    ).toMatch(re);
    expect(await explain(`SELECT id FROM app.banners WHERE image_asset_id = $1`, [img])).toMatch(
      re,
    );
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
        '[migration-0017.int-spec] REVOKE a anon/authenticated no verificado: esos roles no existen.',
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
