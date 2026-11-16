import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import { hexToBase64 } from '@/lib/media-optimize';
import * as media from '@/services/media';
import * as products from '@/services/products';
import { createHarness, type TestHarness } from '../testing';

async function failure(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError)
      return { status: e.status, code: e.businessCode, details: e.details };
    throw e;
  }
  throw new Error('se esperaba un error');
}

const admin = () => {
  const h = createHarness();
  h.asStaff('admin');
  return h;
};

const hex = (n: number) => n.toString(16).padStart(64, '0');
const intentBody = (
  n: number,
  extra: Partial<Parameters<typeof media.createMediaUploadIntent>[1]> = {},
) => ({
  kind: 'PRODUCT_IMAGE' as const,
  mimeType: 'image/webp',
  sizeBytes: 1000 + n,
  checksumSha256: hex(n),
  ...extra,
});

/** intent → «PUT» simulado → complete; devuelve el asset READY. */
async function upload(h: TestHarness, n: number) {
  const intent = await media.createMediaUploadIntent(h.client, intentBody(n));
  await media.putSimulatedMediaObject(h.client, intent.assetId, {
    sizeBytes: 1000 + n,
    contentType: 'image/webp',
    checksumSha256: hex(n),
  });
  return media.completeMediaUpload(h.client, intent.assetId);
}

describe('F14 mock · semillas', () => {
  it('3 assets READY simulados (host .invalid); el primero vinculado a dumplings', async () => {
    const h = admin();
    const page = await media.listMedia(h.client);
    expect(page).toMatchObject({ page: 1, pageSize: 20, total: 3 });
    for (const a of page.items) {
      expect(a).toMatchObject({ status: 'READY', storageMode: 'MOCK', kind: 'PRODUCT_IMAGE' });
      expect(new URL(a.url as string).hostname.endsWith('.invalid')).toBe(true);
    }
    expect(page.items.find((a) => a.id === 'media-seed-1')?.usageCount).toBe(1);
    const dumplings = await products.getAdminProduct(h.client, 'dumplings');
    expect(dumplings.media).toHaveLength(1);
    expect(dumplings.media[0]).toMatchObject({ assetId: 'media-seed-1', sortOrder: 0 });
    // Libres: candidatos a borrar.
    const free = await media.listMedia(h.client, { unreferenced: true });
    expect(free.items.map((a) => a.id).sort()).toEqual(['media-seed-2', 'media-seed-3']);
    expect((await media.listMedia(h.client, { unreferenced: false })).total).toBe(1);
  });

  it('el escenario empty no siembra medios', async () => {
    const h = createHarness('empty');
    h.asStaff('admin');
    expect((await media.listMedia(h.client)).total).toBe(0);
  });
});

describe('F14 mock · intent', () => {
  it('201 con PENDING, vigencia de 300 s, cabeceras firmadas exactas y URL simulada .invalid', async () => {
    const h = admin();
    const intent = await media.createMediaUploadIntent(h.client, intentBody(1));
    expect(intent).toMatchObject({ deduplicated: false, storageMode: 'MOCK' });
    expect(intent.asset).toMatchObject({ status: 'PENDING', url: null, usageCount: 0 });
    expect(new URL(intent.uploadUrl as string).hostname.endsWith('.invalid')).toBe(true);
    expect(intent.headers).toEqual({
      'Content-Type': 'image/webp',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'x-amz-checksum-sha256': hexToBase64(hex(1)),
    });
    const ttl = new Date(intent.expiresAt as string).getTime() - h.clock.now().getTime();
    expect(ttl).toBe(300_000);
  });

  it('orden de comprobaciones: forma 400 → MIME 422 → tamaño 422', async () => {
    const h = admin();
    expect(
      await failure(media.createMediaUploadIntent(h.client, intentBody(1, { sizeBytes: 0 }))),
    ).toMatchObject({ status: 400 });
    expect(
      await failure(
        media.createMediaUploadIntent(h.client, intentBody(1, { checksumSha256: 'xx' })),
      ),
    ).toMatchObject({ status: 400 });
    expect(
      await failure(
        media.createMediaUploadIntent(h.client, { ...intentBody(1), extra: 1 } as never),
      ),
    ).toMatchObject({ status: 400 });
    expect(
      await failure(
        media.createMediaUploadIntent(h.client, intentBody(1, { mimeType: 'image/gif' })),
      ),
    ).toEqual({ status: 422, code: 'MEDIA_TYPE_NOT_ALLOWED', details: undefined });
    expect(
      await failure(
        media.createMediaUploadIntent(h.client, intentBody(1, { sizeBytes: 5 * 1024 * 1024 + 1 })),
      ),
    ).toMatchObject({ status: 422, code: 'MEDIA_TOO_LARGE' });
    // Un MIME falso con tamaño enorme falla primero por MIME.
    expect(
      await failure(
        media.createMediaUploadIntent(
          h.client,
          intentBody(1, { mimeType: 'text/html', sizeBytes: 99_999_999 }),
        ),
      ),
    ).toMatchObject({ code: 'MEDIA_TYPE_NOT_ALLOWED' });
  });

  it('dedup por checksum: 200 deduplicated, sin URL de subida, con el asset existente', async () => {
    const h = admin();
    const seed = (await media.getMedia(h.client, 'media-seed-2')).checksumSha256;
    const intent = await media.createMediaUploadIntent(
      h.client,
      intentBody(1, { checksumSha256: seed }),
    );
    expect(intent).toMatchObject({
      assetId: 'media-seed-2',
      deduplicated: true,
      uploadUrl: null,
      headers: null,
      expiresAt: null,
    });
    expect(intent.asset.status).toBe('READY');
    // El mock no crea otra fila.
    expect(h.store.mediaAssets.filter((a) => a.kind === 'PRODUCT_IMAGE')).toHaveLength(3);
  });

  it('tope de 50 PENDING por empleado; las caducadas se purgan al crear', async () => {
    const h = admin();
    for (let i = 1; i <= 50; i++) await media.createMediaUploadIntent(h.client, intentBody(i));
    expect(await failure(media.createMediaUploadIntent(h.client, intentBody(51)))).toMatchObject({
      status: 422,
      code: 'MEDIA_PENDING_LIMIT_REACHED',
    });
    h.clock.advance(301_000);
    const next = await media.createMediaUploadIntent(h.client, intentBody(52));
    expect(next.deduplicated).toBe(false);
    expect(h.store.mediaAssets.filter((a) => a.status === 'PENDING')).toHaveLength(1);
  });

  it('MEDIA_STORAGE_UNAVAILABLE (503) determinista y MEDIA_BUSY reintentable', async () => {
    const h = admin();
    h.store.mediaStorageUnavailable = true;
    expect(await failure(media.createMediaUploadIntent(h.client, intentBody(1)))).toMatchObject({
      status: 503,
      code: 'MEDIA_STORAGE_UNAVAILABLE',
    });
    h.store.mediaStorageUnavailable = false;
    h.store.mediaBusy = 1;
    expect(await failure(media.createMediaUploadIntent(h.client, intentBody(1)))).toMatchObject({
      status: 503,
      code: 'MEDIA_BUSY',
    });
    expect((await media.createMediaUploadIntent(h.client, intentBody(1))).deduplicated).toBe(false);
  });
});

describe('F14 mock · complete', () => {
  it('flujo feliz: READY con URL pública y es idempotente', async () => {
    const h = admin();
    const asset = await upload(h, 1);
    expect(asset).toMatchObject({ status: 'READY', expiresAt: null });
    expect(asset.url).toMatch(
      /^https:\/\/media-simulado\.invalid\/products\/\d{4}\/media-asset-4\.webp$/,
    );
    expect(await media.completeMediaUpload(h.client, asset.id)).toEqual(asset);
  });

  it('404, objeto ausente (422, sigue PENDING), caducado (410) y sin almacenamiento (503)', async () => {
    const h = admin();
    expect(await failure(media.completeMediaUpload(h.client, 'nada'))).toMatchObject({
      status: 404,
      code: 'MEDIA_NOT_FOUND',
    });
    const intent = await media.createMediaUploadIntent(h.client, intentBody(1));
    expect(await failure(media.completeMediaUpload(h.client, intent.assetId))).toMatchObject({
      status: 422,
      code: 'MEDIA_OBJECT_MISSING',
    });
    expect(h.store.mediaAssets.find((a) => a.id === intent.assetId)?.status).toBe('PENDING');
    h.store.mediaStorageUnavailable = true;
    expect(await failure(media.completeMediaUpload(h.client, intent.assetId))).toMatchObject({
      status: 503,
      code: 'MEDIA_STORAGE_UNAVAILABLE',
    });
    h.store.mediaStorageUnavailable = false;
    h.clock.advance(301_000);
    expect(await failure(media.completeMediaUpload(h.client, intent.assetId))).toMatchObject({
      status: 410,
      code: 'MEDIA_UPLOAD_EXPIRED',
    });
  });

  it('un READY ya confirmado responde 200 aun sin almacenamiento y tras caducar', async () => {
    const h = admin();
    const asset = await upload(h, 1);
    h.store.mediaStorageUnavailable = true;
    expect(await media.completeMediaUpload(h.client, asset.id)).toMatchObject({ status: 'READY' });
  });

  it.each([
    ['tamaño', { sizeBytes: 1 }],
    ['tipo', { contentType: 'image/png' }],
    ['checksum', { checksumSha256: hex(999) }],
  ])(
    'objeto con %s distinto => 422 MEDIA_CONTENT_MISMATCH y se borran objeto y fila',
    async (_n, change) => {
      const h = admin();
      const intent = await media.createMediaUploadIntent(h.client, intentBody(1));
      await media.putSimulatedMediaObject(h.client, intent.assetId, {
        sizeBytes: 1001,
        contentType: 'image/webp',
        checksumSha256: hex(1),
        ...change,
      });
      expect(await failure(media.completeMediaUpload(h.client, intent.assetId))).toMatchObject({
        status: 422,
        code: 'MEDIA_CONTENT_MISMATCH',
      });
      expect(h.store.mediaAssets.some((a) => a.id === intent.assetId)).toBe(false);
      expect(h.store.mediaObjects[intent.assetId]).toBeUndefined();
    },
  );

  it('carrera de dedup: gana el asset ya confirmado y se descarta el propio', async () => {
    const h = admin();
    const a = await media.createMediaUploadIntent(h.client, intentBody(1));
    const b = await media.createMediaUploadIntent(h.client, intentBody(1)); // mismo contenido, aún PENDING
    for (const id of [a.assetId, b.assetId]) {
      await media.putSimulatedMediaObject(h.client, id, {
        sizeBytes: 1001,
        contentType: 'image/webp',
        checksumSha256: hex(1),
      });
    }
    const first = await media.completeMediaUpload(h.client, a.assetId);
    const second = await media.completeMediaUpload(h.client, b.assetId);
    expect(second.id).toBe(first.id);
    expect(h.store.mediaAssets.some((x) => x.id === b.assetId)).toBe(false);
  });

  it('PUT simulado: 404 sin intent pendiente, 403 si caducó, 400 con cuerpo inválido', async () => {
    const h = admin();
    const obj = { sizeBytes: 1, contentType: 'image/webp', checksumSha256: hex(1) };
    expect(await failure(media.putSimulatedMediaObject(h.client, 'nada', obj))).toMatchObject({
      status: 404,
    });
    expect(
      await failure(media.putSimulatedMediaObject(h.client, 'media-seed-1', obj)),
    ).toMatchObject({ status: 404 });
    const intent = await media.createMediaUploadIntent(h.client, intentBody(1));
    expect(
      await failure(
        media.putSimulatedMediaObject(h.client, intent.assetId, { sizeBytes: 'x' } as never),
      ),
    ).toMatchObject({ status: 400 });
    h.clock.advance(301_000);
    expect(
      await failure(media.putSimulatedMediaObject(h.client, intent.assetId, obj)),
    ).toMatchObject({ status: 403 });
  });
});

describe('F14 mock · biblioteca y borrado', () => {
  it('lista paginada, detalle con usos, filtros inválidos 400 y 404', async () => {
    const h = admin();
    await upload(h, 1);
    const p1 = await media.listMedia(h.client, { pageSize: 2 });
    expect(p1).toMatchObject({ total: 4, pageSize: 2 });
    expect(p1.items).toHaveLength(2);
    // Más reciente primero.
    expect(p1.items[0]!.id).toBe('media-asset-4');
    expect((await media.listMedia(h.client, { status: 'PENDING' })).total).toBe(0);
    const detail = await media.getMedia(h.client, 'media-seed-1');
    expect(detail.usages).toEqual([
      { productId: 'dumplings', productName: 'Dumplings', productMediaId: 'media-seed-pm-1' },
    ]);
    expect(await failure(media.listMedia(h.client, { pageSize: 101 }))).toMatchObject({
      status: 400,
    });
    expect(await failure(media.listMedia(h.client, { page: 201 }))).toMatchObject({ status: 400 });
    expect(await failure(media.getMedia(h.client, 'x'))).toMatchObject({
      status: 404,
      code: 'MEDIA_NOT_FOUND',
    });
  });

  it('DELETE: 409 MEDIA_IN_USE, 204 si libre, 404 al repetir, 503 sin almacenamiento sin tocar la fila', async () => {
    const h = admin();
    expect(await failure(media.deleteMedia(h.client, 'media-seed-1'))).toMatchObject({
      status: 409,
      code: 'MEDIA_IN_USE',
    });
    h.store.mediaStorageUnavailable = true;
    expect(await failure(media.deleteMedia(h.client, 'media-seed-2'))).toMatchObject({
      status: 503,
      code: 'MEDIA_STORAGE_UNAVAILABLE',
    });
    expect(h.store.mediaAssets.some((a) => a.id === 'media-seed-2')).toBe(true);
    h.store.mediaStorageUnavailable = false;
    expect(await media.deleteMedia(h.client, 'media-seed-2')).toBeUndefined();
    expect(await failure(media.deleteMedia(h.client, 'media-seed-2'))).toMatchObject({
      status: 404,
    });
  });
});

describe('F14 mock · vínculo con productos', () => {
  it('adjunta (201, al final, URL del asset), duplicado 409, PENDING 422 y tope de 8', async () => {
    const h = admin();
    const m = await media.attachProductMedia(h.client, 'gaseosas', {
      assetId: 'media-seed-2',
      altText: ' Gaseosa ',
    });
    expect(m).toMatchObject({ assetId: 'media-seed-2', sortOrder: 0, altText: 'Gaseosa' });
    expect(m.url).toContain('media-seed-2.webp');
    expect(
      await failure(media.attachProductMedia(h.client, 'gaseosas', { assetId: 'media-seed-2' })),
    ).toMatchObject({ status: 409, code: 'MEDIA_ALREADY_ATTACHED' });
    const pending = await media.createMediaUploadIntent(h.client, intentBody(1));
    expect(
      await failure(media.attachProductMedia(h.client, 'gaseosas', { assetId: pending.assetId })),
    ).toMatchObject({ status: 422, code: 'MEDIA_ASSET_NOT_READY' });
    expect(
      await failure(media.attachProductMedia(h.client, 'nada', { assetId: 'media-seed-2' })),
    ).toMatchObject({
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
    });
    expect(
      await failure(media.attachProductMedia(h.client, 'gaseosas', { assetId: 'x' })),
    ).toMatchObject({
      status: 404,
      code: 'MEDIA_NOT_FOUND',
    });
    expect(
      await failure(
        media.attachProductMedia(h.client, 'gaseosas', {
          assetId: 'media-seed-3',
          altText: 'a'.repeat(201),
        }),
      ),
    ).toMatchObject({ status: 422, code: 'PRODUCT_MEDIA_INVALID' });
    // Límite de 8 (el producto ya tiene 1).
    for (let n = 10; n < 17; n++) {
      await media.attachProductMedia(h.client, 'gaseosas', { assetId: (await upload(h, n)).id });
    }
    expect((await products.getAdminProduct(h.client, 'gaseosas')).media).toHaveLength(8);
    expect(
      await failure(media.attachProductMedia(h.client, 'gaseosas', { assetId: 'media-seed-3' })),
    ).toMatchObject({ status: 422, code: 'PRODUCT_MEDIA_INVALID' });
  });

  it('reordena EXACTO: lista distinta 422, idempotente, 400 con >8 o forma inválida', async () => {
    const h = admin();
    const a = await media.attachProductMedia(h.client, 'gaseosas', { assetId: 'media-seed-2' });
    const b = await media.attachProductMedia(h.client, 'gaseosas', { assetId: 'media-seed-3' });
    const out = await media.reorderProductMedia(h.client, 'gaseosas', [b.id, a.id]);
    expect(out.items.map((m) => [m.id, m.sortOrder])).toEqual([
      [b.id, 0],
      [a.id, 1],
    ]);
    expect(await media.reorderProductMedia(h.client, 'gaseosas', [b.id, a.id])).toEqual(out);
    for (const bad of [[a.id], [a.id, a.id], [a.id, b.id, 'x'], [a.id, 'x']]) {
      expect(await failure(media.reorderProductMedia(h.client, 'gaseosas', bad))).toMatchObject({
        status: 422,
        code: 'MEDIA_REORDER_MISMATCH',
      });
    }
    expect(
      await failure(media.reorderProductMedia(h.client, 'gaseosas', Array(9).fill(a.id))),
    ).toMatchObject({ status: 400 });
    expect(await failure(media.reorderProductMedia(h.client, 'nada', []))).toMatchObject({
      status: 404,
    });
    // La ficha pública respeta el orden.
    const pub = await products.getStoreProduct(h.client, 'gaseosas');
    expect(pub.media.map((m) => m.url)).toEqual(out.items.map((m) => m.url));
  });

  it('alt: guarda, vacío lo borra, >200 es 422, 404 si no es del producto', async () => {
    const h = admin();
    const a = await media.attachProductMedia(h.client, 'gaseosas', { assetId: 'media-seed-2' });
    expect(await media.updateProductMedia(h.client, 'gaseosas', a.id, ' nuevo ')).toMatchObject({
      altText: 'nuevo',
    });
    expect(await media.updateProductMedia(h.client, 'gaseosas', a.id, '')).toMatchObject({
      altText: null,
    });
    expect(
      await failure(media.updateProductMedia(h.client, 'gaseosas', a.id, 'a'.repeat(201))),
    ).toMatchObject({
      status: 422,
      code: 'PRODUCT_MEDIA_INVALID',
    });
    expect(await failure(media.updateProductMedia(h.client, 'dumplings', a.id, 'x'))).toMatchObject(
      {
        status: 404,
        code: 'PRODUCT_MEDIA_NOT_FOUND',
      },
    );
  });

  it('desvincula (204), renumera y NO borra el asset', async () => {
    const h = admin();
    const a = await media.attachProductMedia(h.client, 'gaseosas', { assetId: 'media-seed-2' });
    const b = await media.attachProductMedia(h.client, 'gaseosas', { assetId: 'media-seed-3' });
    expect(await media.detachProductMedia(h.client, 'gaseosas', a.id)).toBeUndefined();
    const product = await products.getAdminProduct(h.client, 'gaseosas');
    expect(product.media.map((m) => [m.id, m.sortOrder])).toEqual([[b.id, 0]]);
    expect((await media.getMedia(h.client, 'media-seed-2')).usageCount).toBe(0);
    expect(await failure(media.detachProductMedia(h.client, 'gaseosas', a.id))).toMatchObject({
      status: 404,
      code: 'PRODUCT_MEDIA_NOT_FOUND',
    });
  });

  it('PRODUCTS_BUSY (503) determinista en las escrituras de producto', async () => {
    const h = admin();
    h.store.productsBusy = 1;
    expect(
      await failure(media.attachProductMedia(h.client, 'gaseosas', { assetId: 'media-seed-2' })),
    ).toMatchObject({ status: 503, code: 'PRODUCTS_BUSY' });
    expect(
      await media.attachProductMedia(h.client, 'gaseosas', { assetId: 'media-seed-2' }),
    ).toMatchObject({
      assetId: 'media-seed-2',
    });
  });

  it('PATCH media de F11 enlaza el asset por URL y rechaza URLs del host de medios sin asset READY', async () => {
    const h = admin();
    const url = (await media.getMedia(h.client, 'media-seed-3')).url as string;
    const updated = await products.updateAdminProduct(h.client, 'gaseosas', {
      media: [
        { url, altText: null },
        { url: 'https://externo.example.com/a.jpg', altText: null },
      ],
    });
    expect(updated.media.map((m) => m.assetId)).toEqual(['media-seed-3', null]);
    expect(
      await failure(
        products.updateAdminProduct(h.client, 'gaseosas', {
          media: [
            { url: 'https://media-simulado.invalid/products/2026/inventada.webp', altText: null },
          ],
        }),
      ),
    ).toMatchObject({ status: 422, code: 'PRODUCT_MEDIA_INVALID' });
  });
});

describe('F14 mock · autorización', () => {
  it('401 sin sesión; 403 sin catalog.update; lectura con catalog.read', async () => {
    const h = createHarness();
    expect(await failure(media.listMedia(h.client))).toMatchObject({ status: 401 });
    expect(await failure(media.createMediaUploadIntent(h.client, intentBody(1)))).toMatchObject({
      status: 401,
    });
    h.asStaff('manager');
    expect((await media.listMedia(h.client)).total).toBe(3);
    expect(await failure(media.createMediaUploadIntent(h.client, intentBody(1)))).toMatchObject({
      status: 403,
    });
    expect(await failure(media.deleteMedia(h.client, 'media-seed-2'))).toMatchObject({
      status: 403,
    });
    expect(
      await failure(media.attachProductMedia(h.client, 'gaseosas', { assetId: 'media-seed-2' })),
    ).toMatchObject({ status: 403 });
    h.asStaff('kitchen');
    expect(await failure(media.listMedia(h.client))).toMatchObject({ status: 403 });
  });

  it('alcance NO global con catalog.update => 403 al escribir', async () => {
    const h = createHarness();
    h.asStaff('manager');
    // Se le concede catalog.update, pero solo en su sucursal.
    const role = h.store.roles.find((r) => r.code === 'manager')!;
    role.permissions.push('catalog.update');
    expect(await failure(media.createMediaUploadIntent(h.client, intentBody(1)))).toMatchObject({
      status: 403,
    });
    expect((await media.listMedia(h.client)).total).toBe(3);
  });
});
