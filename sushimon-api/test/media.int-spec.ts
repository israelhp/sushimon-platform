import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'vitest';
import { AuditService } from '../src/audit/audit.service.js';
import { AuthorizationService } from '../src/auth/authorization.service.js';
import { AdminCategoriesService } from '../src/categories/admin-categories.service.js';
import { CategoriesQueryService } from '../src/categories/categories-query.service.js';
import { CategoriesRepository } from '../src/categories/categories.repository.js';
import { validateEnv, type Env } from '../src/config/env.js';
import { PrismaService } from '../src/database/prisma.service.js';
import type { IdentityService } from '../src/identity/identity.service.js';
import { AdminMediaService } from '../src/media/admin-media.service.js';
import { MediaCleanupService } from '../src/media/media-cleanup.service.js';
import { MOCK_BUCKET, MOCK_PUBLIC_BASE_URL, type MediaConfig } from '../src/media/media-config.js';
import { MediaQueryService } from '../src/media/media-query.service.js';
import { MediaUrlService } from '../src/media/media-url.service.js';
import { MediaRepository } from '../src/media/media.repository.js';
import { MockMediaStorageAdapter } from '../src/media/mock-media-storage.adapter.js';
import { AdminProductsService } from '../src/products/admin-products.service.js';
import { ProductMediaService } from '../src/products/product-media.service.js';
import { ProductsRepository } from '../src/products/products.repository.js';
import { cleanupTestData, TEST_URL, withClient } from './support/db.js';
import { pngBytes, sha256Hex } from './support/media-harness.js';
import { globalStaff } from './support/staff-context.js';

const url = TEST_URL;

/**
 * Se omite (con aviso) si no hay DATABASE_URL_TEST o si la migración 0015 aún no está aplicada (`app.media_assets`
 * ausente). La 0015 requiere aprobación humana y NO se aplica desde aquí. Usa SOLO el almacenamiento simulado en
 * memoria: jamás Cloudflare R2 ni red. Hasta que se ejecute contra PostgreSQL real, el SQL de F14 (UNIQUE parcial de
 * checksum, FK RESTRICT, trigger de tope de 8, UNIQUE diferible al reordenar, conteo de usos) NO está probado.
 */
const ready = url
  ? await withClient(url, async (c) => {
      const res = await c.query<{ m: string | null; c: string | null }>(
        `SELECT to_regclass('app.media_assets') AS m, to_regclass('app.categories') AS c`,
      );
      return res.rows[0]?.m != null && res.rows[0]?.c != null;
    }).catch(() => false)
  : false;
if (url && !ready) {
  console.warn(
    '[media.int-spec] OMITIDA: app.media_assets no existe en DATABASE_URL_TEST (migración 0015 sin aplicar). El SQL de F14 NO se probó contra PostgreSQL real.',
  );
}

describe.skipIf(!url || !ready)(
  'Medios (F14) contra PostgreSQL real, con almacenamiento simulado',
  () => {
    const run = randomUUID().slice(0, 8);
    const staffId = randomUUID();
    const staff = globalStaff(['catalog.read', 'catalog.create', 'catalog.update'], { staffId });
    const config: MediaConfig = {
      mode: 'MOCK',
      maxBytes: 5_242_880,
      uploadTtlSeconds: 300,
      bucket: MOCK_BUCKET,
      publicBaseUrl: MOCK_PUBLIC_BASE_URL,
    };
    let prisma: PrismaService;
    let storage: MockMediaStorageAdapter;
    let media: AdminMediaService;
    let queries: MediaQueryService;
    let cleanup: MediaCleanupService;
    let productMedia: ProductMediaService;
    let products: AdminProductsService;
    let categories: AdminCategoriesService;
    const assetIds = new Set<string>();
    const productIds = new Set<string>();
    const categoryIds = new Set<string>();
    let seed = 1;

    const code = (e: unknown) => (e as { response?: { code?: string } }).response?.code;
    const failure = (p: Promise<unknown>) =>
      p.then(
        () => null,
        (e: unknown) => e,
      );
    const skipUnlessReady = (ctx: TestContext) => {
      if (!ready)
        ctx.skip('app.media_assets no existe en DATABASE_URL_TEST (migración 0015 sin aplicar)');
    };

    /** intent + PUT simulado + complete. */
    async function readyAsset(bytes = pngBytes(seed++ + Number.parseInt(run.slice(0, 4), 16))) {
      const intent = await media.createUpload(staff, {
        kind: 'PRODUCT_IMAGE',
        mimeType: 'image/png',
        sizeBytes: bytes.length,
        checksumSha256: sha256Hex(bytes),
      });
      assetIds.add(intent.assetId);
      const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: intent.assetId } });
      storage.simulateUpload(row.objectKey, bytes, 'image/png');
      return media.complete(staff, intent.assetId);
    }
    async function product(name: string) {
      const cat =
        [...categoryIds][0] ??
        (await categories.create(staff, { name: `Medios ${run}`, parentId: null, active: true }))
          .id;
      categoryIds.add(cat);
      const view = await products.create(staff, {
        name: `${name} ${run}`,
        basePrice: '10.00',
        categoryId: cat,
      });
      productIds.add(view.id);
      return view;
    }

    beforeAll(async () => {
      vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      prisma = new PrismaService(
        new ConfigService<Env, true>(
          validateEnv({ DATABASE_URL: url, DB_POOL_MAX: '8', NODE_ENV: 'test' }),
        ),
      );
      storage = new MockMediaStorageAdapter();
      const authorization = new AuthorizationService({} as IdentityService);
      const audit = new AuditService();
      const repo = new MediaRepository(prisma);
      const urls = new MediaUrlService(config);
      queries = new MediaQueryService(repo, urls, config);
      cleanup = new MediaCleanupService(repo, storage);
      media = new AdminMediaService(repo, storage, queries, cleanup, audit, authorization, config);
      const catRepo = new CategoriesRepository(prisma);
      categories = new AdminCategoriesService(catRepo, audit, authorization);
      const productsRepo = new ProductsRepository(prisma);
      products = new AdminProductsService(
        productsRepo,
        audit,
        authorization,
        new CategoriesQueryService(catRepo),
        { get: () => [] } as unknown as ConfigService<Env, true>,
        urls,
      );
      productMedia = new ProductMediaService(productsRepo, audit, authorization, urls);
      // `created_by_staff_id` y `actor_id` tienen FK a staff_users: empleado de prueba (@sushimon.test, lo borra la limpieza).
      await withClient(url as string, (c) =>
        c.query(`INSERT INTO app.staff_users (id, full_name, email) VALUES ($1, $2, $3)`, [
          staffId,
          'Prueba medios',
          `media-${run}@sushimon.test`,
        ]),
      );
    });
    afterAll(async () => {
      await prisma.$disconnect();
      if (ready && url) {
        await withClient(url, async (c) => {
          await c.query('BEGIN');
          try {
            await c.query("SET LOCAL app.allow_audit_cleanup = 'on'");
            const ids = [...assetIds];
            await c.query('DELETE FROM app.audit_events WHERE entity_id = ANY($1::uuid[])', [ids]);
            // product_media cae en cascada con el producto; los assets van DESPUÉS (FK RESTRICT).
            await c.query('DELETE FROM app.audit_events WHERE entity_id = ANY($1::uuid[])', [
              [...productIds],
            ]);
            await c.query('DELETE FROM app.products WHERE id = ANY($1::uuid[])', [[...productIds]]);
            await c.query('DELETE FROM app.media_assets WHERE id = ANY($1::uuid[])', [ids]);
            await c.query('COMMIT');
          } catch (error) {
            await c.query('ROLLBACK');
            throw error;
          }
        });
        await cleanupTestData(url, { authUserIds: [], branchIds: [], categoryIds });
      }
    });

    it('intent -> PUT simulado -> complete: PENDING con clave y bucket reales, READY con url, sin tocar R2', async (ctx) => {
      skipUnlessReady(ctx);
      const bytes = pngBytes(101);
      const intent = await media.createUpload(staff, {
        kind: 'PRODUCT_IMAGE',
        mimeType: 'image/png',
        sizeBytes: bytes.length,
        checksumSha256: sha256Hex(bytes),
      });
      assetIds.add(intent.assetId);
      const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: intent.assetId } });
      expect(row).toMatchObject({ status: 'PENDING', bucket: MOCK_BUCKET, mimeType: 'image/png' });
      expect(row.expiresAt).not.toBeNull();
      expect(row.objectKey).toMatch(/^products\/\d{4}\/[0-9a-f-]{36}\.png$/);
      storage.simulateUpload(row.objectKey, bytes, 'image/png');
      const done = await media.complete(staff, intent.assetId);
      expect(done).toMatchObject({ status: 'READY', expiresAt: null, usageCount: 0 });
      expect(done.url).toBe(`${MOCK_PUBLIC_BASE_URL}/${row.objectKey}`);
      const after = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: intent.assetId } });
      expect(after).toMatchObject({ status: 'READY', expiresAt: null });
      expect(after.confirmedAt).not.toBeNull();
      // idempotente y dedup contra el UNIQUE parcial real
      expect((await media.complete(staff, intent.assetId)).id).toBe(intent.assetId);
      const dup = await media.createUpload(staff, {
        kind: 'PRODUCT_IMAGE',
        mimeType: 'image/png',
        sizeBytes: bytes.length,
        checksumSha256: sha256Hex(bytes),
      });
      expect(dup).toMatchObject({ deduplicated: true, assetId: intent.assetId, uploadUrl: null });
    });

    it('carrera por checksum: dos PENDING con el mismo contenido; el segundo complete recibe 23505 real y reutiliza al ganador', async (ctx) => {
      skipUnlessReady(ctx);
      const bytes = pngBytes(102);
      const send = () =>
        media.createUpload(staff, {
          kind: 'PRODUCT_IMAGE',
          mimeType: 'image/png',
          sizeBytes: bytes.length,
          checksumSha256: sha256Hex(bytes),
        });
      const a = await send();
      const b = await send(); // ambos PENDING: aún no hay READY que deduplicar
      expect(b.deduplicated).toBe(false);
      for (const i of [a, b]) {
        assetIds.add(i.assetId);
        const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: i.assetId } });
        storage.simulateUpload(row.objectKey, bytes, 'image/png');
      }
      const first = await media.complete(staff, a.assetId);
      const second = await media.complete(staff, b.assetId);
      expect(second.id).toBe(first.id);
      expect(await prisma.mediaAsset.findUnique({ where: { id: b.assetId } })).toBeNull();
    });

    it('adjuntar, tope de 8 (trigger real), reordenar con UNIQUE diferible, desvincular y renumerar', async (ctx) => {
      skipUnlessReady(ctx);
      const p = await product('Con fotos');
      const attached = [];
      for (let i = 0; i < 8; i++) {
        const asset = await readyAsset();
        attached.push(await productMedia.attach(staff, p.id, { assetId: asset.id }));
      }
      expect(attached.map((m) => m.sortOrder)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      const ninth = await readyAsset();
      expect(code(await failure(productMedia.attach(staff, p.id, { assetId: ninth.id })))).toBe(
        'PRODUCT_MEDIA_INVALID',
      );
      expect(
        code(
          await failure(
            productMedia.attach(staff, p.id, { assetId: attached[0]?.assetId as string }),
          ),
        ),
      ).toBe('MEDIA_ALREADY_ATTACHED');
      const reversed = [...attached].reverse().map((m) => m.id);
      const out = await productMedia.reorder(staff, p.id, reversed);
      expect(out.items.map((m) => m.id)).toEqual(reversed);
      expect(out.items.map((m) => m.sortOrder)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      const removed = reversed[3] as string;
      await productMedia.detach(staff, p.id, removed);
      const left = await prisma.productMedia.findMany({
        where: { productId: p.id },
        orderBy: { sortOrder: 'asc' },
      });
      expect(left.map((m) => m.sortOrder)).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect(left.some((m) => m.id === removed)).toBe(false);
      // desvincular NO borra el asset
      expect(
        await prisma.mediaAsset.count({
          where: { id: attached[reversed.indexOf(removed)]?.assetId as string },
        }),
      ).toBe(1);
    });

    it('borrar: 409 MEDIA_IN_USE con FK RESTRICT real; libre => 204 y la fila desaparece', async (ctx) => {
      skipUnlessReady(ctx);
      const p1 = await product('Compartido A');
      const p2 = await product('Compartido B');
      const asset = await readyAsset();
      const m1 = await productMedia.attach(staff, p1.id, { assetId: asset.id });
      await productMedia.attach(staff, p2.id, { assetId: asset.id }); // un asset en varios productos
      expect(code(await failure(media.remove(staff, asset.id)))).toBe('MEDIA_IN_USE');
      const detail = await queries.get(asset.id);
      expect(detail.usageCount).toBe(2);
      expect(detail.usages.map((u) => u.productId).sort()).toEqual([p1.id, p2.id].sort());
      await productMedia.detach(staff, p1.id, m1.id);
      expect(code(await failure(media.remove(staff, asset.id)))).toBe('MEDIA_IN_USE');
      const only = await prisma.productMedia.findFirstOrThrow({ where: { productId: p2.id } });
      await productMedia.detach(staff, p2.id, only.id);
      await media.remove(staff, asset.id);
      expect(await prisma.mediaAsset.findUnique({ where: { id: asset.id } })).toBeNull();
      expect(code(await failure(media.remove(staff, asset.id)))).toBe('MEDIA_NOT_FOUND');
    });

    it('PATCH media del producto enlaza por asset_id las URL de assets READY y rechaza las de R2 sin asset', async (ctx) => {
      skipUnlessReady(ctx);
      const p = await product('Patch media');
      const asset = await readyAsset();
      const out = await products.update(staff, p.id, {
        media: [{ url: asset.url, altText: 'x' }],
      });
      expect(out.media[0]).toMatchObject({ assetId: asset.id, url: asset.url });
      const bad = await failure(
        products.update(staff, p.id, {
          media: [{ url: `${MOCK_PUBLIC_BASE_URL}/products/2026/inventada.png` }],
        }),
      );
      expect(code(bad)).toBe('PRODUCT_MEDIA_INVALID');
      // reemplazar con [] libera el asset para borrarlo
      await products.update(staff, p.id, { media: [] });
      expect((await queries.get(asset.id)).usageCount).toBe(0);
    });

    it('biblioteca: filtros kind/status/unreferenced y paginación con conteo de usos agregado', async (ctx) => {
      skipUnlessReady(ctx);
      const p = await product('Lista');
      const used = await readyAsset();
      const free = await readyAsset();
      await productMedia.attach(staff, p.id, { assetId: used.id });
      const unref = await queries.list({
        unreferenced: true,
        status: 'READY',
        kind: 'PRODUCT_IMAGE',
        page: 1,
        pageSize: 100,
      });
      expect(unref.items.some((i) => i.id === free.id)).toBe(true);
      expect(unref.items.some((i) => i.id === used.id)).toBe(false);
      const usedPage = await queries.list({ unreferenced: false, page: 1, pageSize: 100 });
      expect(usedPage.items.find((i) => i.id === used.id)?.usageCount).toBe(1);
      const small = await queries.list({ page: 1, pageSize: 1 });
      expect(small.items).toHaveLength(1);
      expect(small.total).toBeGreaterThanOrEqual(2);
    });

    it('purga perezosa: borra solo PENDING caducados (objeto y fila)', async (ctx) => {
      skipUnlessReady(ctx);
      const bytes = pngBytes(103);
      const intent = await media.createUpload(staff, {
        kind: 'PRODUCT_IMAGE',
        mimeType: 'image/png',
        sizeBytes: bytes.length,
        checksumSha256: sha256Hex(bytes),
      });
      assetIds.add(intent.assetId);
      const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: intent.assetId } });
      storage.simulateUpload(row.objectKey, bytes, 'image/png');
      await prisma.mediaAsset.update({
        where: { id: intent.assetId },
        data: { expiresAt: new Date(Date.now() - 10 * 60_000) },
      });
      expect(code(await failure(media.complete(staff, intent.assetId)))).toBe(
        'MEDIA_UPLOAD_EXPIRED',
      );
      expect(await cleanup.purgeExpired()).toBeGreaterThanOrEqual(1);
      expect(await prisma.mediaAsset.findUnique({ where: { id: intent.assetId } })).toBeNull();
      expect(storage.objects.has(row.objectKey)).toBe(false);
    });
  },
);
