import { Logger } from '@nestjs/common';
import { mediaHarness, pngBytes, sha256Hex } from '../../test/support/media-harness.js';
import { globalStaff } from '../../test/support/staff-context.js';
import type { StaffContext } from '../identity/identity.types.js';

/** F16: `BANNER_IMAGE` en la biblioteca de medios (clave banners/, 1 MiB, usos por banners, borrado). */

const staff = (): StaffContext => ({
  ...globalStaff(['catalog.read', 'catalog.update']),
  staffId: 'staff-1',
});
const code = (e: unknown) => (e as { response?: { code?: string } }).response?.code;
const status = (e: unknown) => (e as { getStatus?: () => number }).getStatus?.();
const failure = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

const bytes = pngBytes(5);
const intent = (
  over: Partial<{
    kind: 'PRODUCT_IMAGE' | 'BANNER_IMAGE';
    sizeBytes: number;
    checksumSha256: string;
  }> = {},
) => ({
  kind: 'BANNER_IMAGE' as 'PRODUCT_IMAGE' | 'BANNER_IMAGE',
  mimeType: 'image/png',
  sizeBytes: bytes.length,
  checksumSha256: sha256Hex(bytes),
  ...over,
});

describe('createUpload con BANNER_IMAGE', () => {
  it('la clave de objeto cuelga de banners/<año>/ y el tipo queda guardado', async () => {
    const h = mediaHarness();
    const res = await h.service.createUpload(staff(), intent());
    const row = h.repo.assets.get(res.assetId);
    expect(row).toMatchObject({ kind: 'BANNER_IMAGE' });
    expect(row?.objectKey).toMatch(/^banners\/\d{4}\/[0-9a-f-]{36}\.png$/);
    expect(res.asset.kind).toBe('BANNER_IMAGE');
    expect(res.uploadUrl).toContain('/banners/');
  });

  it('PRODUCT_IMAGE conserva products/', async () => {
    const h = mediaHarness();
    const res = await h.service.createUpload(staff(), intent({ kind: 'PRODUCT_IMAGE' }));
    expect(h.repo.assets.get(res.assetId)?.objectKey).toMatch(/^products\/\d{4}\//);
  });

  it('tope de 1 MiB solo para banners: 1 MiB exacto pasa; un byte más => 422 MEDIA_TOO_LARGE; un producto admite hasta el global', async () => {
    const h = mediaHarness();
    expect(
      (await h.service.createUpload(staff(), intent({ sizeBytes: 1_048_576 }))).deduplicated,
    ).toBe(false);
    const over = await failure(
      h.service.createUpload(
        staff(),
        intent({ sizeBytes: 1_048_577, checksumSha256: sha256Hex(pngBytes(9)) }),
      ),
    );
    expect(status(over)).toBe(422);
    expect(code(over)).toBe('MEDIA_TOO_LARGE');
    const product = await h.service.createUpload(
      staff(),
      intent({
        kind: 'PRODUCT_IMAGE',
        sizeBytes: 3_000_000,
        checksumSha256: sha256Hex(pngBytes(11)),
      }),
    );
    expect(product.asset.sizeBytes).toBe(3_000_000);
  });

  it('la deduplicación es por (tipo, checksum): el mismo archivo como producto y como banner son assets distintos', async () => {
    const h = mediaHarness();
    const a = await h.service.createUpload(staff(), intent());
    h.mock.simulateUpload(h.repo.assets.get(a.assetId)!.objectKey, bytes, 'image/png');
    await h.service.complete(staff(), a.assetId);
    const again = await h.service.createUpload(staff(), intent());
    expect(again).toMatchObject({ deduplicated: true, assetId: a.assetId });
    const asProduct = await h.service.createUpload(staff(), intent({ kind: 'PRODUCT_IMAGE' }));
    expect(asProduct.deduplicated).toBe(false);
    expect(asProduct.assetId).not.toBe(a.assetId);
  });

  it('subir sigue exigiendo catalog.update GLOBAL (P18): un actor acotado => 403', async () => {
    const h = mediaHarness();
    const scopedOnly: StaffContext = {
      ...globalStaff([]),
      grants: { 'catalog.update': { allBranches: false, branchIds: ['b'] } },
    };
    expect(status(await failure(h.service.createUpload(scopedOnly, intent())))).toBe(403);
  });
});

describe('complete con BANNER_IMAGE', () => {
  it('confirma un banner dentro del tope; un objeto mayor de 1 MiB que el declarado se rechaza (defensa en profundidad)', async () => {
    const h = mediaHarness();
    const ok = await h.service.createUpload(staff(), intent());
    h.mock.simulateUpload(h.repo.assets.get(ok.assetId)!.objectKey, bytes, 'image/png');
    expect((await h.service.complete(staff(), ok.assetId)).status).toBe('READY');

    // fila declarada por encima del tope del tipo (p. ej. dato anterior al CHECK): `complete` falla cerrado.
    const big = pngBytes(7, 1_048_577);
    h.repo.seed({
      id: 'big-banner',
      kind: 'BANNER_IMAGE',
      status: 'PENDING',
      objectKey: 'banners/2026/big.png',
      sizeBytes: big.length,
      checksumSha256: sha256Hex(big),
      expiresAt: new Date(Date.now() + 60_000),
    });
    h.mock.simulateUpload('banners/2026/big.png', big, 'image/png');
    const e = await failure(h.service.complete(staff(), 'big-banner'));
    expect(code(e)).toBe('MEDIA_CONTENT_MISMATCH');
    expect(h.mock.objects.has('banners/2026/big.png')).toBe(false);
  });
});

describe('uso por banners (usageCount, bannerUsages, borrado)', () => {
  it('usageCount cuenta banners; el detalle lista bannerUsages y usages por separado', async () => {
    const h = mediaHarness();
    h.repo.seed({ id: 'b1', kind: 'BANNER_IMAGE', objectKey: 'banners/2026/b1.png' });
    h.repo.bannerUsageOf = (id) =>
      id === 'b1' ? [{ bannerId: 'x', bannerAlt: 'Promoción de verano' }] : [];
    const detail = await h.queries.get('b1');
    expect(detail).toMatchObject({
      usageCount: 1,
      usages: [],
      bannerUsages: [{ bannerId: 'x', bannerAlt: 'Promoción de verano' }],
    });
    const list = await h.queries.list({ page: 1, pageSize: 20, unreferenced: false });
    expect(list.items.map((i) => i.id)).toEqual(['b1']);
    expect((await h.queries.list({ page: 1, pageSize: 20, unreferenced: true })).items).toEqual([]);
  });

  it('suma productos y banners en usageCount', async () => {
    const h = mediaHarness();
    h.repo.seed({ id: 'mix' });
    h.repo.usageOf = () => [{ productId: 'p', productName: 'P', productMediaId: 'm' }];
    h.repo.bannerUsageOf = () => [{ bannerId: 'b', bannerAlt: 'abc' }];
    expect((await h.queries.get('mix')).usageCount).toBe(2);
  });

  it('borrar un asset usado SOLO por un banner => 409 MEDIA_IN_USE sin borrar fila ni objeto', async () => {
    const h = mediaHarness();
    h.repo.seed({ id: 'used-by-banner', kind: 'BANNER_IMAGE', objectKey: 'banners/2026/u.png' });
    h.repo.bannerUsageOf = () => [{ bannerId: 'b', bannerAlt: 'abc' }];
    h.mock.simulateUpload('banners/2026/u.png', bytes, 'image/png');
    const e = await failure(h.service.remove(staff(), 'used-by-banner'));
    expect(status(e)).toBe(409);
    expect(code(e)).toBe('MEDIA_IN_USE');
    expect((e as { response?: { message?: string } }).response?.message).toMatch(
      /productos o banners/,
    );
    expect(h.repo.assets.has('used-by-banner')).toBe(true);
    expect(h.mock.objects.size).toBe(1);
  });

  it('sin uso (imagen reemplazada o banner desactivado) el asset se puede borrar', async () => {
    const h = mediaHarness();
    h.repo.seed({ id: 'free', kind: 'BANNER_IMAGE', objectKey: 'banners/2026/f.png' });
    h.mock.simulateUpload('banners/2026/f.png', bytes, 'image/png');
    await h.service.remove(staff(), 'free');
    expect(h.repo.assets.has('free')).toBe(false);
  });

  it('removeUnusedAsset (F16, tras borrar un banner): sin exigir catalog.update, borra fila y objeto', async () => {
    const h = mediaHarness();
    h.repo.seed({ id: 'freed', kind: 'BANNER_IMAGE', objectKey: 'banners/2026/z.png' });
    h.mock.simulateUpload('banners/2026/z.png', bytes, 'image/png');
    const onlyBanners = { ...globalStaff(['banners.update']), staffId: 'staff-1' };
    await h.service.removeUnusedAsset(onlyBanners, 'freed');
    expect(h.repo.assets.has('freed')).toBe(false);
    expect(h.mock.objects.size).toBe(0);
  });

  it('removeUnusedAsset conserva el asset si otro banner o producto lo usa (409 MEDIA_IN_USE)', async () => {
    const h = mediaHarness();
    h.repo.seed({ id: 'shared', kind: 'BANNER_IMAGE', objectKey: 'banners/2026/s.png' });
    h.repo.bannerUsageOf = () => [{ bannerId: 'b', bannerAlt: 'otro' }];
    h.mock.simulateUpload('banners/2026/s.png', bytes, 'image/png');
    const e = await failure(h.service.removeUnusedAsset(staff(), 'shared'));
    expect(code(e)).toBe('MEDIA_IN_USE');
    expect(h.repo.assets.has('shared')).toBe(true);
    expect(h.mock.objects.size).toBe(1);
  });

  it('removeUnusedAsset nunca borra un asset de producto sin uso (404, no escala catalog.update)', async () => {
    const h = mediaHarness();
    h.repo.seed({ id: 'prod', kind: 'PRODUCT_IMAGE', objectKey: 'products/2026/p.png' });
    h.mock.simulateUpload('products/2026/p.png', bytes, 'image/png');
    const e = await failure(h.service.removeUnusedAsset(globalStaff(['banners.update']), 'prod'));
    expect(code(e)).toBe('MEDIA_NOT_FOUND');
    expect(h.repo.assets.has('prod')).toBe(true);
    expect(h.mock.objects.size).toBe(1);
  });
});
