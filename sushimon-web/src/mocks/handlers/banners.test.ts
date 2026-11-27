import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import * as banners from '@/services/banners';
import { createHarness, type TestHarness } from '../testing';

/**
 * F16 (simplificado, ADR-0033) — Adaptador mock de banners con la MISMA semántica del contrato (imagen + texto alternativo + activo,
 * máx. 5, orden de creación, `expectedVersion` en PATCH y DELETE). NO prueba la API real: solo que el mock reproduce lo que el
 * contrato describe.
 */

async function failure(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) {
      return {
        status: e.status,
        code: e.businessCode,
        violations: e.violations?.map((v) => `${v.path}:${v.code}`),
      };
    }
    throw e;
  }
  throw new Error('Se esperaba un error');
}

const ASSET = 'media-seed-banner-favoritos';
const valid = { imageAssetId: ASSET, imageAlt: 'Imagen nueva' };

const admin = (scenario?: Parameters<typeof createHarness>[0]) => {
  const h = createHarness(scenario);
  h.asStaff('admin');
  return h;
};

/** Un manager de una sola sucursal con permisos de banners (alcance acotado: la API exige alcance global). */
function scopedManager(): TestHarness {
  const h = createHarness();
  h.store.roles
    .find((r) => r.code === 'manager')
    ?.permissions.push('banners.read', 'banners.create', 'banners.update');
  h.asStaff('manager', 'u2');
  return h;
}

const ids = (list: { items: { id: string }[] }) => list.items.map((i) => i.id);

describe('público: GET /v1/store/banners', () => {
  it('solo los activos, en orden de creación, con la forma {id, image, alt} y sin datos internos', async () => {
    const h = createHarness();
    const list = await banners.listStoreBanners(h.client);
    expect(ids(list)).toEqual(['banner-favoritos', 'banner-happy-hour', 'banner-calientito']);
    expect(Object.keys(list)).toEqual(['items']);
    const first = list.items[0]!;
    expect(Object.keys(first).sort()).toEqual(['alt', 'id', 'image']);
    expect(first.alt).toBe('Selección de rolls favoritos de Sushi Mon');
    expect(Object.keys(first.image).sort()).toEqual(['mimeType', 'url']);
    expect(first.image.url).toMatch(/^https:\/\/.+\/banners\/2026\//);
    expect(JSON.stringify(list)).not.toMatch(/code|version|assetId|objectKey/);
  });

  it('no requiere sesión y escenario banners-empty devuelve una lista vacía', async () => {
    const h = createHarness('banners-empty');
    expect(await banners.listStoreBanners(h.client)).toEqual({ items: [] });
  });

  it('desactivar un banner lo quita del público; reactivarlo lo devuelve en su sitio (el orden es el de creación)', async () => {
    const h = admin();
    await banners.updateAdminBanner(h.client, 'banner-favoritos', {
      expectedVersion: 1,
      active: false,
    });
    expect(ids(await banners.listStoreBanners(h.client))).toEqual([
      'banner-happy-hour',
      'banner-calientito',
    ]);
    await banners.updateAdminBanner(h.client, 'banner-favoritos', {
      expectedVersion: 2,
      active: true,
    });
    expect(ids(await banners.listStoreBanners(h.client))[0]).toBe('banner-favoritos');
  });

  it('una imagen que dejó de estar READY no se publica', async () => {
    const h = createHarness();
    h.store.mediaAssets.find((a) => a.id === ASSET)!.status = 'PENDING';
    expect(ids(await banners.listStoreBanners(h.client))).not.toContain('banner-favoritos');
  });

  it('503 BANNERS_BUSY determinista (store.bannersBusy) y luego funciona', async () => {
    const h = createHarness();
    h.store.bannersBusy = 1;
    expect(await failure(banners.listStoreBanners(h.client))).toMatchObject({
      status: 503,
      code: 'BANNERS_BUSY',
    });
    expect((await banners.listStoreBanners(h.client)).items.length).toBe(3);
  });
});

describe('administración: lectura', () => {
  it('lista TODOS (activos e inactivos) en orden de creación con limit=5', async () => {
    const h = admin();
    const list = await banners.listAdminBanners(h.client);
    expect(ids(list)).toEqual([
      'banner-favoritos',
      'banner-happy-hour',
      'banner-calientito',
      'banner-navidad',
    ]);
    expect(list.limit).toBe(5);
    expect(list.items[3]).toMatchObject({
      active: false,
      version: 1,
      imageAlt: 'Rolls con decoración navideña',
    });
    expect(list.items[0]!.image).toMatchObject({
      assetId: ASSET,
      mimeType: 'image/webp',
    });
    expect(list.items[0]!.image.url).toMatch(/^https:/);
  });

  it('detalle y 404 BANNER_NOT_FOUND', async () => {
    const h = admin();
    expect((await banners.getAdminBanner(h.client, 'banner-navidad')).active).toBe(false);
    expect(await failure(banners.getAdminBanner(h.client, 'no-existe'))).toMatchObject({
      status: 404,
      code: 'BANNER_NOT_FOUND',
    });
  });

  it('401 sin sesión; 403 sin banners.read (cocina) y con alcance acotado', async () => {
    const h = createHarness();
    expect((await failure(banners.listAdminBanners(h.client))).status).toBe(401);
    h.asStaff('kitchen');
    expect((await failure(banners.listAdminBanners(h.client))).status).toBe(403);
    const m = scopedManager();
    expect((await failure(banners.listAdminBanners(m.client))).status).toBe(403);
    expect((await failure(banners.createAdminBanner(m.client, valid))).status).toBe(403);
    expect(
      (
        await failure(
          banners.updateAdminBanner(m.client, 'banner-favoritos', { expectedVersion: 1 }),
        )
      ).status,
    ).toBe(403);
    expect((await failure(banners.deleteAdminBanner(m.client, 'banner-favoritos', 1))).status).toBe(
      403,
    );
  });
});

describe('administración: alta y tope de 5', () => {
  it('crea un banner (version 1, activo por defecto, al final del orden) y el público lo muestra', async () => {
    const h = admin();
    const created = await banners.createAdminBanner(h.client, valid);
    expect(created).toMatchObject({ imageAlt: 'Imagen nueva', active: true, version: 1 });
    expect(Object.keys(created).sort()).toEqual([
      'active',
      'createdAt',
      'id',
      'image',
      'imageAlt',
      'updatedAt',
      'version',
    ]);
    const list = await banners.listAdminBanners(h.client);
    expect(ids(list).at(-1)).toBe(created.id);
    expect(ids(await banners.listStoreBanners(h.client)).at(-1)).toBe(created.id);
  });

  it('el 5.º entra y el 6.º es 409 BANNER_LIMIT_REACHED sin escribir; borrar uno libera un lugar', async () => {
    const h = admin();
    await banners.createAdminBanner(h.client, { ...valid, active: false });
    expect((await banners.listAdminBanners(h.client)).items).toHaveLength(5);
    expect(await failure(banners.createAdminBanner(h.client, valid))).toMatchObject({
      status: 409,
      code: 'BANNER_LIMIT_REACHED',
    });
    expect((await banners.listAdminBanners(h.client)).items).toHaveLength(5);
    await banners.deleteAdminBanner(h.client, 'banner-navidad', 1);
    await banners.createAdminBanner(h.client, valid);
    expect((await banners.listAdminBanners(h.client)).items).toHaveLength(5);
  });

  it('400 de forma: campos desconocidos (los de la versión anterior), faltantes, tipos y longitud 1..120', async () => {
    const h = admin();
    for (const body of [
      { ...valid, title: 'x' },
      { ...valid, code: 'x' },
      { ...valid, locale: 'es' },
      { imageAssetId: ASSET },
      { imageAlt: 'x' },
      { ...valid, imageAlt: '' },
      { ...valid, imageAlt: 'a'.repeat(121) },
      { ...valid, imageAlt: 7 },
      { ...valid, active: 'si' },
    ]) {
      expect(
        (await failure(banners.createAdminBanner(h.client, body as never))).status,
        JSON.stringify(body),
      ).toBe(400);
    }
    expect(
      (await banners.createAdminBanner(h.client, { ...valid, imageAlt: 'a'.repeat(120) })).id,
    ).toBeTruthy();
  });

  it('422 BANNER_ALT_INVALID: texto en blanco o con caracteres de control; se guarda recortado', async () => {
    const h = admin();
    for (const imageAlt of ['   ', 'a\u0007b', '​​']) {
      expect(
        await failure(banners.createAdminBanner(h.client, { ...valid, imageAlt })),
      ).toMatchObject({ status: 422, code: 'BANNER_ALT_INVALID' });
    }
    const ok = await banners.createAdminBanner(h.client, {
      ...valid,
      imageAlt: '  Con espacios  ',
    });
    expect(ok.imageAlt).toBe('Con espacios');
  });

  it('422 BANNER_IMAGE_INVALID: inexistente, PENDING o de producto, con violations', async () => {
    const h = admin();
    h.store.mediaAssets.find((a) => a.id === 'media-seed-banner-navidad')!.status = 'PENDING';
    expect(
      await failure(banners.createAdminBanner(h.client, { ...valid, imageAssetId: 'nada' })),
    ).toEqual({
      status: 422,
      code: 'BANNER_IMAGE_INVALID',
      violations: ['imageAssetId:ASSET_UNKNOWN'],
    });
    expect(
      await failure(
        banners.createAdminBanner(h.client, {
          ...valid,
          imageAssetId: 'media-seed-banner-navidad',
        }),
      ),
    ).toMatchObject({ violations: ['imageAssetId:ASSET_NOT_READY'] });
    const product = h.store.mediaAssets.find((a) => a.kind === 'PRODUCT_IMAGE')!;
    expect(
      await failure(banners.createAdminBanner(h.client, { ...valid, imageAssetId: product.id })),
    ).toMatchObject({ violations: ['imageAssetId:ASSET_KIND_MISMATCH'] });
  });

  it('503 BANNERS_BUSY en la escritura: no escribe y luego funciona', async () => {
    const h = admin();
    h.store.bannersBusy = 1;
    expect((await failure(banners.createAdminBanner(h.client, valid))).code).toBe('BANNERS_BUSY');
    expect((await banners.listAdminBanners(h.client)).items).toHaveLength(4);
  });
});

describe('administración: edición (PATCH con expectedVersion)', () => {
  it('cambia imagen, texto alternativo y activo; sube la versión en 1', async () => {
    const h = admin();
    const updated = await banners.updateAdminBanner(h.client, 'banner-favoritos', {
      expectedVersion: 1,
      imageAssetId: 'media-seed-banner-calientito',
      imageAlt: 'Otro texto',
      active: false,
    });
    expect(updated).toMatchObject({
      version: 2,
      imageAlt: 'Otro texto',
      active: false,
      image: { assetId: 'media-seed-banner-calientito' },
    });
  });

  it('parcial: lo omitido no se toca; sin cambios reales = 200 sin subir la versión', async () => {
    const h = admin();
    const same = await banners.updateAdminBanner(h.client, 'banner-favoritos', {
      expectedVersion: 1,
      imageAlt: 'Selección de rolls favoritos de Sushi Mon',
    });
    expect(same.version).toBe(1);
    const only = await banners.updateAdminBanner(h.client, 'banner-favoritos', {
      expectedVersion: 1,
      active: false,
    });
    expect(only).toMatchObject({
      version: 2,
      imageAlt: 'Selección de rolls favoritos de Sushi Mon',
    });
  });

  it('409 BANNER_VERSION_CONFLICT sin guardar; 404; 400 sin expectedVersion o con campos del modelo anterior', async () => {
    const h = admin();
    await banners.updateAdminBanner(h.client, 'banner-favoritos', {
      expectedVersion: 1,
      active: false,
    });
    expect(
      await failure(
        banners.updateAdminBanner(h.client, 'banner-favoritos', {
          expectedVersion: 1,
          imageAlt: 'Tarde',
        }),
      ),
    ).toMatchObject({ status: 409, code: 'BANNER_VERSION_CONFLICT' });
    expect((await banners.getAdminBanner(h.client, 'banner-favoritos')).imageAlt).not.toBe('Tarde');
    expect(
      (await failure(banners.updateAdminBanner(h.client, 'nada', { expectedVersion: 1 }))).code,
    ).toBe('BANNER_NOT_FOUND');
    for (const body of [{}, { expectedVersion: 0 }, { expectedVersion: 2, sortOrder: 1 }]) {
      expect(
        (await failure(banners.updateAdminBanner(h.client, 'banner-favoritos', body as never)))
          .status,
      ).toBe(400);
    }
  });

  it('422 por texto alternativo o imagen inválidos; el banner queda intacto', async () => {
    const h = admin();
    expect(
      await failure(
        banners.updateAdminBanner(h.client, 'banner-favoritos', {
          expectedVersion: 1,
          imageAlt: '  ',
        }),
      ),
    ).toMatchObject({ status: 422, code: 'BANNER_ALT_INVALID' });
    expect(
      await failure(
        banners.updateAdminBanner(h.client, 'banner-favoritos', {
          expectedVersion: 1,
          imageAssetId: 'nada',
        }),
      ),
    ).toMatchObject({ status: 422, code: 'BANNER_IMAGE_INVALID' });
    expect((await banners.getAdminBanner(h.client, 'banner-favoritos')).version).toBe(1);
  });
});

describe('administración: eliminar (DELETE con expectedVersion en la query)', () => {
  it('borrado físico: sale de la lista admin y del público y libera su imagen si nadie más la usa', async () => {
    const h = admin();
    await banners.deleteAdminBanner(h.client, 'banner-favoritos', 1);
    expect(ids(await banners.listAdminBanners(h.client))).not.toContain('banner-favoritos');
    expect(ids(await banners.listStoreBanners(h.client))).not.toContain('banner-favoritos');
    expect(h.store.mediaAssets.some((a) => a.id === ASSET)).toBe(false);
  });

  it('si otro banner usa la misma imagen, el asset se conserva', async () => {
    const h = admin();
    await banners.createAdminBanner(h.client, valid);
    await banners.deleteAdminBanner(h.client, 'banner-favoritos', 1);
    expect(h.store.mediaAssets.some((a) => a.id === ASSET)).toBe(true);
  });

  it('almacenamiento no disponible: el banner se elimina igual (204) y el asset queda libre', async () => {
    const h = admin();
    h.store.mediaStorageUnavailable = true;
    await banners.deleteAdminBanner(h.client, 'banner-favoritos', 1);
    expect(h.store.banners.some((b) => b.id === 'banner-favoritos')).toBe(false);
    expect(h.store.mediaAssets.some((a) => a.id === ASSET)).toBe(true);
  });

  it('409 BANNER_VERSION_CONFLICT sin borrar; 404 al repetir; 400 sin expectedVersion válido', async () => {
    const h = admin();
    expect(await failure(banners.deleteAdminBanner(h.client, 'banner-favoritos', 3))).toMatchObject(
      { status: 409, code: 'BANNER_VERSION_CONFLICT' },
    );
    expect(h.store.banners.some((b) => b.id === 'banner-favoritos')).toBe(true);
    expect((await failure(h.client.delete('/v1/admin/banners/banner-favoritos', {}))).status).toBe(
      400,
    );
    await banners.deleteAdminBanner(h.client, 'banner-favoritos', 1);
    expect(await failure(banners.deleteAdminBanner(h.client, 'banner-favoritos', 1))).toMatchObject(
      { status: 404, code: 'BANNER_NOT_FOUND' },
    );
  });

  it('un asset en uso por un banner no se puede borrar de la biblioteca (409 MEDIA_IN_USE) y la usa lista bannerAlt', async () => {
    const h = admin();
    const detail = await h.client.get<{ bannerUsages: { bannerId: string; bannerAlt: string }[] }>(
      `/v1/admin/media/${ASSET}`,
    );
    expect(detail.bannerUsages).toEqual([
      { bannerId: 'banner-favoritos', bannerAlt: 'Selección de rolls favoritos de Sushi Mon' },
    ]);
    expect((await failure(h.client.delete(`/v1/admin/media/${ASSET}`, {}))).code).toBe(
      'MEDIA_IN_USE',
    );
  });
});
