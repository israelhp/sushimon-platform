import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import { AuthorizationService } from '../src/auth/authorization.service.js';
import { AdminBannersService } from '../src/banners/admin-banners.service.js';
import { BannersReadRepository } from '../src/banners/banners-read.repository.js';
import { BannersRepository } from '../src/banners/banners.repository.js';
import type { CreateBannerRequest } from '../src/banners/dto/banner-requests.dto.js';
import { PublicBannersReader } from '../src/banners/public-banners.reader.js';
import { validateEnv, type Env } from '../src/config/env.js';
import { PrismaService } from '../src/database/prisma.service.js';
import type { IdentityService } from '../src/identity/identity.service.js';
import { AdminMediaService } from '../src/media/admin-media.service.js';
import { MediaCleanupService } from '../src/media/media-cleanup.service.js';
import { MediaQueryService } from '../src/media/media-query.service.js';
import { MediaUrlService } from '../src/media/media-url.service.js';
import { MediaRepository } from '../src/media/media.repository.js';
import { MockMediaStorageAdapter } from '../src/media/mock-media-storage.adapter.js';
import { TEST_URL, withClient } from './support/db.js';
import { mediaConfig } from './support/media-harness.js';
import { globalStaff } from './support/staff-context.js';

const url = TEST_URL;

/**
 * F16 simplificado (ADR-0033) contra PostgreSQL REAL. Se omite (con aviso) si no hay DATABASE_URL_TEST o si la migración
 * 0023 aún no está aplicada (sin el trigger `banners_max_count_trg` o con el CHECK de la fila `es` que exige `title`):
 * la 0023 requiere aprobación humana y NO se aplica desde aquí. Hasta que se ejecute, el SQL del lector público, el
 * borrado físico en cascada, el trigger de tope y la liberación de la imagen NO están probados.
 *
 * BD COMPARTIDA: el tope de 5 cuenta TODAS las filas de `app.banners`, también las ajenas. Cada prueba calcula su cupo
 * (`needSlots`): borra lo suyo (SQL directo), cuenta las filas ajenas y se omite con aviso si no caben las que necesita.
 * Nunca toca filas ajenas y limpia solo lo que creó.
 */
const ready = url
  ? await withClient(url, async (c) => {
      const res = await c.query<{ b: string | null; t: boolean; k: boolean; c: boolean }>(
        `SELECT to_regclass('app.banners') AS b,
                EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'banners_max_count_trg' AND NOT tgisinternal) AS t,
                COALESCE((SELECT pg_get_constraintdef(oid) LIKE '%BANNER_IMAGE%'
                            FROM pg_constraint
                           WHERE conrelid = 'app.media_assets'::regclass AND conname = 'media_assets_kind_chk'), false) AS k,
                COALESCE((SELECT pg_get_constraintdef(oid) NOT LIKE '%title%'
                            FROM pg_constraint
                           WHERE conrelid = 'app.banner_translations'::regclass
                             AND conname = 'banner_translations_es_required_chk'), false) AS c`,
      );
      const row = res.rows[0];
      return row?.b != null && row.t && row.k && row.c;
    }).catch(() => false)
  : false;
if (url && !ready) {
  console.warn(
    '[banners.int-spec] OMITIDA: app.banners/BANNER_IMAGE ausentes o la migración 0023 (trigger de tope y CHECK de la fila es) sin aplicar en DATABASE_URL_TEST. El SQL de F16 simplificado NO se probó contra PostgreSQL real.',
  );
}

describe.skipIf(!url || !ready)('Banners simplificados (F16, 0023) contra PostgreSQL real', () => {
  const run = randomUUID().slice(0, 8);
  const staffId = randomUUID();
  const PERMS = ['banners.read', 'banners.create', 'banners.update'];
  const staff = globalStaff(PERMS, { staffId });
  let prisma: PrismaService;
  let admin: AdminBannersService;
  let adminWithRealMedia: AdminBannersService;
  let reader: PublicBannersReader;
  let media: MediaRepository;
  let storage: MockMediaStorageAdapter;
  const released: string[] = [];
  /** Banners de esta ejecución vivos ahora / todos los que existieron (para limpiar auditoría). */
  const bannerIds = new Set<string>();
  const everBannerIds = new Set<string>();
  const assetIds = new Set<string>();
  let image = '';
  let seq = 0;

  const code = (e: unknown) => (e as { response?: { code?: string } }).response?.code;
  const failure = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: unknown) => e,
    );
  const raw = <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    withClient(url as string, async (c) => (await c.query<T>(sql, params)).rows);
  const hex64 = () => (randomUUID() + randomUUID()).replaceAll('-', '').slice(0, 64);
  const track = (id: string) => {
    bannerIds.add(id);
    everBannerIds.add(id);
  };

  /** Borra los banners propios (SQL directo; hijas en cascada) y comprueba que caben `n` más bajo el tope de 5. */
  const needSlots = async (ctx: TestContext, n: number) => {
    if (bannerIds.size > 0) {
      await raw('DELETE FROM app.banners WHERE id = ANY($1::uuid[])', [[...bannerIds]]);
      bannerIds.clear();
    }
    const others =
      (await raw<{ n: number }>('SELECT count(*)::int AS n FROM app.banners'))[0]?.n ?? 0;
    if (others + n > 5)
      ctx.skip(`BD compartida con ${others} banners ajenos: no caben ${n} más bajo el tope de 5`);
  };

  /** Asset de banner (fila directa: la subida real es de F14 y necesita R2). */
  const newAsset = async (over: { kind?: string; status?: string } = {}) => {
    const id = randomUUID();
    const kind = over.kind ?? 'BANNER_IMAGE';
    const status = over.status ?? 'READY';
    const prefix = kind === 'BANNER_IMAGE' ? 'banners' : 'products';
    await raw(
      `INSERT INTO app.media_assets (id, kind, object_key, bucket, mime_type, size_bytes, checksum_sha256, status,
                                    confirmed_at, expires_at)
       VALUES ($1, $2, $3, 'bucket-test', 'image/webp', 200000, $4, $5,
               CASE WHEN $5 = 'READY' THEN now() END, CASE WHEN $5 = 'PENDING' THEN now() + interval '1 hour' END)`,
      [id, kind, `${prefix}/2026/${id}.webp`, hex64(), status],
    );
    assetIds.add(id);
    return id;
  };
  const create = async (over: Partial<CreateBannerRequest> = {}) => {
    seq += 1;
    const out = await admin.create(staff, {
      imageAssetId: image,
      imageAlt: `Banner ${seq} ${run}`,
      ...over,
    });
    track(out.id);
    return out;
  };
  const storeIds = async () =>
    (await reader.findActiveBanners()).map((b) => b.id).filter((id) => bannerIds.has(id));

  beforeAll(async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    prisma = new PrismaService(
      new ConfigService<Env, true>(
        validateEnv({ DATABASE_URL: url, DB_POOL_MAX: '8', NODE_ENV: 'test' }),
      ),
    );
    const authorization = new AuthorizationService({} as IdentityService);
    const audit = new AuditService();
    const config = mediaConfig();
    const urls = new MediaUrlService(config);
    const repo = new BannersRepository(prisma);
    // Liberación de imagen simulada (registra las llamadas) para las pruebas que no miden el borrado del asset.
    admin = new AdminBannersService(repo, audit, authorization, urls, {
      removeUnusedAsset: (_s, assetId) => {
        released.push(assetId);
        return Promise.resolve();
      },
    });
    // Servicio REAL de medios (F14) sobre la BD y el almacenamiento simulado.
    storage = new MockMediaStorageAdapter();
    media = new MediaRepository(prisma);
    const mediaService = new AdminMediaService(
      media,
      storage,
      new MediaQueryService(media, urls, config),
      new MediaCleanupService(media, storage),
      audit,
      authorization,
      config,
    );
    adminWithRealMedia = new AdminBannersService(repo, audit, authorization, urls, mediaService);
    reader = new PublicBannersReader(new BannersReadRepository(prisma), urls);
    // `audit_events.actor_id` tiene FK a staff_users: empleado de prueba (@sushimon.test).
    await raw(`INSERT INTO app.staff_users (id, full_name, email) VALUES ($1, $2, $3)`, [
      staffId,
      'Prueba banners',
      `banner-${run}@sushimon.test`,
    ]);
    image = await newAsset();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    if (ready && url) {
      await withClient(url, async (c) => {
        await c.query('BEGIN');
        try {
          await c.query("SET LOCAL app.allow_audit_cleanup = 'on'");
          const ids = [...everBannerIds, ...assetIds];
          await c.query('DELETE FROM app.audit_events WHERE entity_id = ANY($1::uuid[])', [ids]);
          // Banners ANTES que sus assets (FK RESTRICT); hijas en cascada.
          await c.query('DELETE FROM app.banners WHERE id = ANY($1::uuid[])', [[...everBannerIds]]);
          await c.query('DELETE FROM app.media_assets WHERE id = ANY($1::uuid[])', [[...assetIds]]);
          await c.query('DELETE FROM app.staff_users WHERE id = $1', [staffId]);
          await c.query('COMMIT');
        } catch (error) {
          await c.query('ROLLBACK');
          throw error;
        }
      });
    }
  });

  it('crea y lee: código interno generado, solo traducción es sin title, valores neutros y auditoría en la misma transacción', async (ctx) => {
    await needSlots(ctx, 1);
    const out = await create({ imageAlt: '  Roll   de salmón ' });
    expect(out).toMatchObject({ imageAlt: 'Roll de salmón', active: true, version: 1 });
    expect(Object.keys(out).sort()).toEqual(
      ['active', 'createdAt', 'id', 'image', 'imageAlt', 'updatedAt', 'version'].sort(),
    );
    const [row] = await raw<Record<string, unknown>>(`SELECT * FROM app.banners WHERE id = $1`, [
      out.id,
    ]);
    expect(row).toMatchObject({
      code: `banner-${out.id.replaceAll('-', '').slice(0, 8)}`,
      cta_type: 'NONE',
      starts_at: null,
      ends_at: null,
      promotion_id: null,
      sort_order: 0,
      version: 1,
    });
    const tr = await raw<{ locale: string; title: string | null; cta_label: string | null }>(
      'SELECT locale, title, cta_label FROM app.banner_translations WHERE banner_id = $1',
      [out.id],
    );
    expect(tr).toEqual([{ locale: 'es', title: null, cta_label: null }]);
    expect(
      await raw('SELECT 1 FROM app.banner_branches WHERE banner_id = $1', [out.id]),
    ).toHaveLength(0);
    const audited = await raw<{ action: string }>(
      'SELECT action FROM app.audit_events WHERE entity_id = $1',
      [out.id],
    );
    expect(audited.map((a) => a.action)).toEqual(['banner.created']);
    expect((await admin.get(staff, out.id)).imageAlt).toBe('Roll de salmón');
    expect((await admin.list(staff)).items.map((i) => i.id)).toContain(out.id);
  });

  it('imagen inexistente, PENDING y de otro tipo => 422 con motivo; alt en blanco => 422 BANNER_ALT_INVALID (SQL real)', async (ctx) => {
    await needSlots(ctx, 1);
    const pending = await newAsset({ status: 'PENDING' });
    const product = await newAsset({ kind: 'PRODUCT_IMAGE' });
    for (const [id, reason] of [
      [randomUUID(), 'ASSET_UNKNOWN'],
      [pending, 'ASSET_NOT_READY'],
      [product, 'ASSET_KIND_MISMATCH'],
    ] as const) {
      const e = await failure(create({ imageAssetId: id }));
      expect(code(e)).toBe('BANNER_IMAGE_INVALID');
      expect(
        (e as { response?: { violations?: { code: string }[] } }).response?.violations?.[0]?.code,
      ).toBe(reason);
    }
    expect(code(await failure(create({ imageAlt: '   ' })))).toBe('BANNER_ALT_INVALID');
    expect(bannerIds.size).toBe(0);
  });

  it('PATCH parcial: version+1, idempotente sin cambios, no pisa lo omitido y audita sin texto', async (ctx) => {
    await needSlots(ctx, 1);
    const other = await newAsset();
    const b = await create({ imageAlt: `Original ${run}` });
    const same = await admin.update(staff, b.id, {
      expectedVersion: 1,
      imageAlt: `Original ${run}`,
    });
    expect(same.version).toBe(1);
    const edited = await admin.update(staff, b.id, {
      expectedVersion: 1,
      imageAssetId: other,
      active: false,
    });
    expect(edited).toMatchObject({ version: 2, active: false, imageAlt: `Original ${run}` });
    expect(edited.image.assetId).toBe(other);
    const renamed = await admin.update(staff, b.id, { expectedVersion: 2, imageAlt: 'Nuevo alt' });
    expect(renamed).toMatchObject({ version: 3, imageAlt: 'Nuevo alt', active: false });
    const audited = await raw<{ action: string; new_values: unknown }>(
      `SELECT action, new_values FROM app.audit_events WHERE entity_id = $1 ORDER BY occurred_at, action`,
      [b.id],
    );
    expect(audited.map((a) => a.action).sort()).toEqual([
      'banner.created',
      'banner.updated',
      'banner.updated',
    ]);
    expect(JSON.stringify(audited)).not.toContain('Nuevo alt');
    expect(
      code(await failure(admin.update(staff, b.id, { expectedVersion: 1, active: true }))),
    ).toBe('BANNER_VERSION_CONFLICT');
    expect(code(await failure(admin.update(staff, randomUUID(), { expectedVersion: 1 })))).toBe(
      'BANNER_NOT_FOUND',
    );
  });

  it('PATCH concurrentes con la misma versión: uno gana y el otro recibe 409', async (ctx) => {
    await needSlots(ctx, 1);
    const b = await create();
    const results = await Promise.allSettled([
      admin.update(staff, b.id, { expectedVersion: 1, active: false }),
      admin.update(staff, b.id, { expectedVersion: 1, imageAlt: `Otro ${run}` }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const loser = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(code(loser.reason)).toBe('BANNER_VERSION_CONFLICT');
    expect((await admin.get(staff, b.id)).version).toBe(2);
  });

  it('DELETE: borrado físico en cascada, auditado, con versión; el asset NO lo borra la BD (la API lo libera después)', async (ctx) => {
    await needSlots(ctx, 1);
    const b = await create();
    expect(code(await failure(admin.remove(staff, b.id, 9)))).toBe('BANNER_VERSION_CONFLICT');
    const before = released.length;
    await admin.remove(staff, b.id, 1);
    bannerIds.delete(b.id);
    expect(await raw('SELECT 1 FROM app.banners WHERE id = $1', [b.id])).toHaveLength(0);
    expect(
      await raw('SELECT 1 FROM app.banner_translations WHERE banner_id = $1', [b.id]),
    ).toHaveLength(0);
    const audited = await raw<{ action: string }>(
      'SELECT action FROM app.audit_events WHERE entity_id = $1 ORDER BY action',
      [b.id],
    );
    expect(audited.map((a) => a.action)).toEqual(['banner.created', 'banner.deleted']);
    expect(released.slice(before)).toEqual([image]);
    // el asset sigue existiendo (solo lo borra F14 al liberarlo)
    expect(await raw('SELECT 1 FROM app.media_assets WHERE id = $1', [image])).toHaveLength(1);
    expect(code(await failure(admin.remove(staff, b.id, 1)))).toBe('BANNER_NOT_FOUND');
    expect(code(await failure(admin.get(staff, b.id)))).toBe('BANNER_NOT_FOUND');
  });

  it('DELETE concurrentes con la misma versión: uno borra y el otro recibe 404 (la fila ya no existe)', async (ctx) => {
    await needSlots(ctx, 1);
    const b = await create();
    const results = await Promise.allSettled([
      admin.remove(staff, b.id, 1),
      admin.remove(staff, b.id, 1),
    ]);
    bannerIds.delete(b.id);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const loser = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(['BANNER_NOT_FOUND', 'BANNER_VERSION_CONFLICT']).toContain(code(loser.reason));
  });

  it('DELETE libera el asset (servicio REAL de F14): si otro banner lo usa se conserva; el último lo borra con su objeto', async (ctx) => {
    await needSlots(ctx, 2);
    const shared = await newAsset();
    const [{ object_key: key } = { object_key: '' }] = await raw<{ object_key: string }>(
      'SELECT object_key FROM app.media_assets WHERE id = $1',
      [shared],
    );
    storage.objects.set(key, { bytes: new Uint8Array([1]), contentType: 'image/webp' });
    const a = await create({ imageAssetId: shared });
    const b = await create({ imageAssetId: shared });
    // 1) compartido: borrar uno responde igual y conserva el asset (otro banner lo usa)
    await adminWithRealMedia.remove(staff, a.id, 1);
    bannerIds.delete(a.id);
    expect(await raw('SELECT 1 FROM app.media_assets WHERE id = $1', [shared])).toHaveLength(1);
    expect(storage.objects.has(key)).toBe(true);
    // 2) el último banner que lo usa: se borran la fila y el objeto (banner primero: la FK RESTRICT lo exige)
    await adminWithRealMedia.remove(staff, b.id, 1);
    bannerIds.delete(b.id);
    expect(await raw('SELECT 1 FROM app.media_assets WHERE id = $1', [shared])).toHaveLength(0);
    expect(storage.objects.has(key)).toBe(false);
    const audited = await raw<{ action: string }>(
      'SELECT action FROM app.audit_events WHERE entity_id = $1',
      [shared],
    );
    expect(audited.map((x) => x.action)).toContain('media.deleted');
  });

  it('FK RESTRICT: con el banner vivo el asset no se borra (23503); tras borrar el banner sí', async (ctx) => {
    await needSlots(ctx, 1);
    const asset = await newAsset();
    const b = await create({ imageAssetId: asset });
    expect((await media.findById(asset))?.usageCount).toBe(1);
    const usages = await media.findBannerUsages(asset);
    expect(usages).toEqual([{ bannerId: b.id, bannerAlt: b.imageAlt }]);
    await expect(raw('DELETE FROM app.media_assets WHERE id = $1', [asset])).rejects.toMatchObject({
      code: '23503',
    });
    await raw('DELETE FROM app.banners WHERE id = $1', [b.id]);
    bannerIds.delete(b.id);
    expect((await media.findById(asset))?.usageCount).toBe(0);
    await raw('DELETE FROM app.media_assets WHERE id = $1', [asset]);
    assetIds.delete(asset);
  });

  it('tope de 5 (SQL real): el 6.º => 409 BANNER_LIMIT_REACHED; el trigger lo respalda con 23514 banners_max_count', async (ctx) => {
    await needSlots(ctx, 5);
    for (let n = 0; n < 5; n += 1) await create();
    expect(code(await failure(create()))).toBe('BANNER_LIMIT_REACHED');
    expect(await raw('SELECT 1 FROM app.banners')).toHaveLength(5);
    // saltándose la API: el trigger de BD rechaza el INSERT
    await expect(
      raw(`INSERT INTO app.banners (code, image_asset_id) VALUES ($1, $2)`, [`raw-${run}`, image]),
    ).rejects.toMatchObject({ code: '23514', constraint: 'banners_max_count' });
    // borrar uno libera cupo
    const [first] = [...bannerIds];
    await admin.remove(staff, first as string, 1);
    bannerIds.delete(first as string);
    await create();
    expect(await raw('SELECT 1 FROM app.banners')).toHaveLength(5);
  });

  it('tope de 5 con altas concurrentes: con 4 banners solo una de dos creaciones simultáneas tiene éxito', async (ctx) => {
    await needSlots(ctx, 5);
    for (let n = 0; n < 4; n += 1) await create();
    const results = await Promise.allSettled([
      admin.create(staff, { imageAssetId: image, imageAlt: `Carrera A ${run}` }),
      admin.create(staff, { imageAssetId: image, imageAlt: `Carrera B ${run}` }),
    ]);
    for (const r of results) if (r.status === 'fulfilled') track(r.value.id);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const loser = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(code(loser.reason)).toBe('BANNER_LIMIT_REACHED');
    expect(await raw('SELECT 1 FROM app.banners')).toHaveLength(5);
  });

  it('tienda (SQL real): solo activos, en orden de creación, máx. 5; IGNORA vigencia, sucursales, promoción y CTA de filas antiguas', async (ctx) => {
    await needSlots(ctx, 5);
    const [branch] = await raw<{ id: string }>(`SELECT id FROM app.branches LIMIT 1`);
    const legacy = async (
      createdAt: string,
      cols: Record<string, string | boolean | null>,
      withEn = false,
    ) => {
      const id = randomUUID();
      const keys = Object.keys(cols);
      await raw(
        `INSERT INTO app.banners (id, code, image_asset_id, created_at, ${keys.join(', ')})
         VALUES ($1, $2, $3, $4, ${keys.map((_, i) => `$${i + 5}`).join(', ')})`,
        [id, `legacy-${run}-${id.slice(0, 6)}`, image, createdAt, ...Object.values(cols)],
      );
      await raw(
        `INSERT INTO app.banner_translations (banner_id, locale, title, subtitle, image_alt) VALUES ($1, 'es', 'Título viejo', 'Sub', $2)`,
        [id, `Alt ${id.slice(0, 6)}`],
      );
      if (withEn)
        await raw(
          `INSERT INTO app.banner_translations (banner_id, locale, title, image_alt) VALUES ($1, 'en', 'Old title', 'Alt en')`,
          [id],
        );
      track(id);
      return id;
    };
    const expired = await legacy('2026-01-01T00:00:00Z', {
      ends_at: '2026-02-01T00:00:00Z',
      cta_type: 'MENU',
      active: true,
    });
    const scheduled = await legacy('2026-01-02T00:00:00Z', {
      starts_at: '2099-01-01T00:00:00Z',
      active: true,
    });
    const scoped = await legacy('2026-01-03T00:00:00Z', { active: true }, true);
    if (branch)
      await raw(`INSERT INTO app.banner_branches (banner_id, branch_id) VALUES ($1, $2)`, [
        scoped,
        branch.id,
      ]);
    const inactive = await legacy('2026-01-04T00:00:00Z', { active: false });
    const newest = await create({ imageAlt: 'Más nuevo' });
    expect(await storeIds()).toEqual([expired, scheduled, scoped, newest.id]);
    expect(await storeIds()).not.toContain(inactive);
    const items = await reader.findActiveBanners();
    expect(items.length).toBeLessThanOrEqual(5);
    const mine = items.filter((i) => bannerIds.has(i.id));
    expect(mine.map((i) => Object.keys(i).sort())).toEqual(mine.map(() => ['alt', 'id', 'image']));
    const json = JSON.stringify(items);
    expect(json).not.toMatch(/Título viejo|Old title|assetId|objectKey/);
    // desactivar por PATCH lo saca; activar lo devuelve
    await admin.update(staff, newest.id, { expectedVersion: 1, active: false });
    expect(await storeIds()).not.toContain(newest.id);
    await admin.update(staff, newest.id, { expectedVersion: 2, active: true });
    expect(await storeIds()).toContain(newest.id);
    // el listado administrativo muestra TODOS, inactivos incluidos, con alt y sin campos retirados
    const list = await admin.list(staff);
    expect(list.limit).toBe(5);
    expect(list.items.filter((i) => bannerIds.has(i.id)).map((i) => i.id)).toEqual([
      expired,
      scheduled,
      scoped,
      inactive,
      newest.id,
    ]);
  });

  it('F14: tipo BANNER_IMAGE en SQL real: > 1 MiB y prefijo de clave cruzado los rechaza la BD', async () => {
    const insert = (kind: string, key: string, size: number) =>
      raw(
        `INSERT INTO app.media_assets (kind, object_key, bucket, mime_type, size_bytes, checksum_sha256, status, confirmed_at)
         VALUES ($1, $2, 'bucket-test', 'image/webp', $3, $4, 'READY', now())`,
        [kind, key, size, hex64()],
      );
    await expect(
      insert('BANNER_IMAGE', `banners/2026/${randomUUID()}.webp`, 1_048_577),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      insert('BANNER_IMAGE', `products/2026/${randomUUID()}.webp`, 1000),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      insert('PRODUCT_IMAGE', `banners/2026/${randomUUID()}.webp`, 1000),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
