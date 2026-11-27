import { Logger } from '@nestjs/common';
import { bannersHarness } from '../../test/support/banners-harness.js';
import { assetid } from '../../test/support/fake-banners-repo.js';

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

describe('PublicBannersReader', () => {
  it('sin banners => lista vacía (válido)', async () => {
    const h = bannersHarness();
    expect(await h.reader.findActiveBanners()).toEqual([]);
  });

  it('solo activos, en orden de creación, con la forma {id, image:{url,mimeType}, alt}', async () => {
    const h = bannersHarness();
    const first = h.repo.seed({ imageAlt: 'Primero' });
    h.repo.seed({ imageAlt: 'Inactivo', active: false });
    const third = h.repo.seed({ imageAlt: 'Tercero' });
    const items = await h.reader.findActiveBanners();
    expect(items).toEqual([
      {
        id: first.id,
        image: {
          url: `https://media.mock.invalid/banners/2026/obj-1.webp`,
          mimeType: 'image/webp',
        },
        alt: 'Primero',
      },
      {
        id: third.id,
        image: { url: expect.any(String) as string, mimeType: 'image/webp' },
        alt: 'Tercero',
      },
    ]);
  });

  it('el orden sigue a createdAt aunque se insertaran desordenados; el id desempata', async () => {
    const h = bannersHarness();
    const late = h.repo.seed({ createdAt: new Date('2026-05-01T00:00:00Z'), imageAlt: 'tarde' });
    const early = h.repo.seed({
      createdAt: new Date('2026-01-01T00:00:00Z'),
      imageAlt: 'temprano',
    });
    const tieA = h.repo.seed({ createdAt: new Date('2026-03-01T00:00:00Z'), imageAlt: 'a' });
    const tieB = h.repo.seed({ createdAt: new Date('2026-03-01T00:00:00Z'), imageAlt: 'b' });
    const ids = (await h.reader.findActiveBanners()).map((b) => b.id);
    expect(ids).toEqual([early.id, tieA.id, tieB.id, late.id]);
  });

  it('máximo 5 aunque la BD tenga filas históricas de más', async () => {
    const h = bannersHarness();
    for (let n = 0; n < 8; n += 1) h.repo.seed();
    expect(await h.reader.findActiveBanners()).toHaveLength(5);
  });

  it('imagen que no es READY/BANNER_IMAGE no se muestra', async () => {
    const h = bannersHarness();
    h.repo.seedAsset(2, { status: 'PENDING' });
    h.repo.seedAsset(3, { kind: 'PRODUCT_IMAGE' });
    h.repo.seed({ imageAssetId: assetid(2) });
    h.repo.seed({ imageAssetId: assetid(3) });
    const ok = h.repo.seed({ imageAlt: 'bien' });
    expect((await h.reader.findActiveBanners()).map((b) => b.id)).toEqual([ok.id]);
  });

  it('sin base pública de imágenes los banners se ocultan (nunca 5xx)', async () => {
    const h = bannersHarness({ publicBaseUrl: null });
    h.repo.seed();
    expect(await h.reader.findActiveBanners()).toEqual([]);
  });

  it('NO expone assetId, objectKey, código, versión ni fechas', async () => {
    const h = bannersHarness();
    h.repo.seed();
    const json = JSON.stringify(await h.reader.findActiveBanners());
    expect(json).not.toContain(assetid(1));
    expect(json).not.toMatch(/assetId|objectKey|"code"|version|createdAt|banner-/);
    expect(Object.keys((await h.reader.findActiveBanners())[0] ?? {}).sort()).toEqual([
      'alt',
      'id',
      'image',
    ]);
  });

  it('un fallo de BD se traduce (timeout => 503 BANNERS_BUSY) y no filtra detalles', async () => {
    const h = bannersHarness();
    h.repo.failReadWith = Object.assign(new Error('secreto'), { code: '55P03' });
    const e = (await h.reader.findActiveBanners().catch((x: unknown) => x)) as {
      getStatus: () => number;
      getResponse: () => { code: string };
    };
    expect(e.getStatus()).toBe(503);
    expect(e.getResponse().code).toBe('BANNERS_BUSY');
  });

  it('una sola consulta por lectura', async () => {
    const h = bannersHarness();
    h.repo.seed();
    h.repo.calls.length = 0;
    await h.reader.findActiveBanners();
    expect(h.repo.calls).toEqual(['findActive']);
  });
});
