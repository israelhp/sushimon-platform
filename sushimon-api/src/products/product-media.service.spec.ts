import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { Env } from '../config/env.js';
import type { IdentityService } from '../identity/identity.service.js';
import type { StaffContext } from '../identity/identity.types.js';
import { MediaUrlService } from '../media/media-url.service.js';
import { mediaConfig } from '../../test/support/media-harness.js';
import { CAT, pid, productRow, productsHarness } from '../../test/support/products-harness.js';
import { globalStaff, scopedStaff } from '../../test/support/staff-context.js';
import { AdminProductsService } from './admin-products.service.js';
import { ProductMediaService } from './product-media.service.js';
import type { ProductsRepository } from './products.repository.js';

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

const BASE = 'https://cdn.ejemplo.com';
const P = pid(1);
const A1 = '10000000-0000-4000-8000-000000000001';
const A2 = '10000000-0000-4000-8000-000000000002';
const A3 = '10000000-0000-4000-8000-000000000003';
const PENDING = '10000000-0000-4000-8000-0000000000ff';
const staff = (): StaffContext => ({
  ...globalStaff(['catalog.read', 'catalog.create', 'catalog.update']),
  staffId: 'staff-1',
});
const code = (e: unknown) => (e as { response?: { code?: string } }).response?.code;
const status = (e: unknown) => (e as { getStatus?: () => number }).getStatus?.();
const failure = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );

interface Audit {
  action: string;
  entityId: string;
  newValues?: Record<string, unknown>;
}

function setup(allowedHosts: string[] = []) {
  const h = productsHarness();
  h.repo.seed(productRow(P));
  const assets = [
    { id: A1, status: 'READY', objectKey: 'products/2026/a1.png' },
    { id: A2, status: 'READY', objectKey: 'products/2026/a2.webp' },
    { id: A3, status: 'READY', objectKey: 'products/2026/a3.jpg' },
    { id: PENDING, status: 'PENDING', objectKey: 'products/2026/pend.png' },
    // F16: imagen de banner READY; nunca debe poder usarse en un producto.
    { id: BANNER, status: 'READY', kind: 'BANNER_IMAGE', objectKey: 'banners/2026/b1.webp' },
  ];
  h.repo.assetSource = () => assets;
  const audit: Audit[] = [];
  const auditService = {
    record: vi.fn((_tx: unknown, e: Audit) => {
      audit.push(e);
      return Promise.resolve();
    }),
  };
  const urls = new MediaUrlService(mediaConfig({ mode: 'R2', publicBaseUrl: BASE }));
  const authorization = new AuthorizationService({} as IdentityService);
  const media = new ProductMediaService(
    h.repo as unknown as ProductsRepository,
    auditService as never,
    authorization,
    urls,
  );
  const products = new AdminProductsService(
    h.repo as unknown as ProductsRepository,
    auditService as never,
    authorization,
    h.categoriesQuery,
    { get: () => allowedHosts } as unknown as ConfigService<Env, true>,
    urls,
  );
  return { media, products, audit, urls, ...h };
}

const BANNER = pid(66);

describe('F16: un asset BANNER_IMAGE no se usa en productos (regresión M1)', () => {
  it('attach por assetId => 422 PRODUCT_MEDIA_INVALID sin efecto ni auditoría', async () => {
    const s = setup();
    const e = (await failure(s.media.attach(staff(), P, { assetId: BANNER }))) as {
      response: { violations: { path: string }[] };
    };
    expect(status(e)).toBe(422);
    expect(code(e)).toBe('PRODUCT_MEDIA_INVALID');
    expect(e.response.violations[0]?.path).toBe('assetId');
    expect(s.repo.media.get(P) ?? []).toEqual([]);
    expect(s.audit).toEqual([]);
  });

  it('PATCH media con la URL pública banners/... => 422 y el producto no cambia', async () => {
    const s = setup();
    const e = await failure(
      s.products.update(staff(), P, { media: [{ url: `${BASE}/banners/2026/b1.webp` }] }),
    );
    expect(status(e)).toBe(422);
    expect(code(e)).toBe('PRODUCT_MEDIA_INVALID');
    expect(s.repo.media.get(P)).toEqual([]);
  });
});

describe('ProductMediaService.attach', () => {
  it('adjunta un READY: media_url pública estable, asset_id, sortOrder = tamaño actual y auditoría', async () => {
    const s = setup();
    const first = await s.media.attach(staff(), P, {
      assetId: A1,
      altText: '  Roll   california ',
    });
    expect(first).toMatchObject({
      url: `${BASE}/products/2026/a1.png`,
      altText: 'Roll california',
      sortOrder: 0,
      assetId: A1,
    });
    const second = await s.media.attach(staff(), P, { assetId: A2 });
    expect(second).toMatchObject({ sortOrder: 1, assetId: A2, altText: null });
    expect(s.audit.map((a) => a.action)).toEqual([
      'product.media_attached',
      'product.media_attached',
    ]);
    expect(s.audit[0]).toMatchObject({
      entityId: P,
      newValues: { productId: P, assetId: A1, mediaId: first.id },
    });
    expect(JSON.stringify(s.audit)).not.toContain(BASE); // la auditoría no guarda URL
  });

  it('orden de comprobaciones: producto 404 -> asset 404 -> PENDING 422 -> duplicado 409 -> tope 8 422 -> altText 422', async () => {
    const s = setup();
    expect(code(await failure(s.media.attach(staff(), pid(77), { assetId: A1 })))).toBe(
      'PRODUCT_NOT_FOUND',
    );
    expect(code(await failure(s.media.attach(staff(), P, { assetId: pid(88) })))).toBe(
      'MEDIA_NOT_FOUND',
    );
    const pending = await failure(s.media.attach(staff(), P, { assetId: PENDING }));
    expect(status(pending)).toBe(422);
    expect(code(pending)).toBe('MEDIA_ASSET_NOT_READY');
    await s.media.attach(staff(), P, { assetId: A1 });
    const dup = await failure(s.media.attach(staff(), P, { assetId: A1 }));
    expect(status(dup)).toBe(409);
    expect(code(dup)).toBe('MEDIA_ALREADY_ATTACHED');
    const tooLong = await failure(
      s.media.attach(staff(), P, { assetId: A2, altText: 'x'.repeat(201) }),
    );
    expect(status(tooLong)).toBe(422);
    expect(code(tooLong)).toBe('PRODUCT_MEDIA_INVALID');
    expect(s.repo.media.get(P)).toHaveLength(1); // los fallos no dejaron nada
  });

  it('tope de 8 imágenes (código de F11) con assets distintos; el 9.º => 422 PRODUCT_MEDIA_INVALID', async () => {
    const s = setup();
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `20000000-0000-4000-8000-00000000000${i}`,
      status: 'READY',
      objectKey: `products/2026/m${i}.png`,
    }));
    s.repo.assetSource = () => [
      ...many,
      { id: A1, status: 'READY', objectKey: 'products/2026/a1.png' },
    ];
    for (const a of many) await s.media.attach(staff(), P, { assetId: a.id });
    const e = await failure(s.media.attach(staff(), P, { assetId: A1 }));
    expect(status(e)).toBe(422);
    expect(code(e)).toBe('PRODUCT_MEDIA_INVALID');
  });

  it('un mismo asset puede estar en varios productos', async () => {
    const s = setup();
    s.repo.seed(productRow(pid(2)));
    await s.media.attach(staff(), P, { assetId: A1 });
    await expect(s.media.attach(staff(), pid(2), { assetId: A1 })).resolves.toMatchObject({
      sortOrder: 0,
    });
  });

  it('bloquea la fila del producto dentro de la transacción antes de leer media', async () => {
    const s = setup();
    await s.media.attach(staff(), P, { assetId: A1 });
    const calls = s.repo.calls;
    expect(calls.indexOf('lock')).toBeGreaterThan(calls.indexOf('transaction'));
    expect(calls.indexOf('lock')).toBeLessThan(calls.indexOf('findMediaInTx'));
    expect(calls.indexOf('lock')).toBeLessThan(calls.indexOf('insertMedia'));
  });

  it('sin alcance global => 403 sin leer nada; sin base pública (adaptador no disponible) => 503', async () => {
    const s = setup();
    const e = await failure(
      s.media.attach(scopedStaff(['catalog.update'], ['b']), P, { assetId: A1 }),
    );
    expect(status(e)).toBe(403);
    expect(s.repo.calls).toEqual([]);
    const off = new ProductMediaService(
      s.repo as unknown as ProductsRepository,
      { record: vi.fn() },
      new AuthorizationService({} as IdentityService),
      new MediaUrlService(mediaConfig({ mode: 'UNAVAILABLE', publicBaseUrl: null, bucket: null })),
    );
    const down = await failure(off.attach(staff(), P, { assetId: A1 }));
    expect(code(down)).toBe('MEDIA_STORAGE_UNAVAILABLE');
    expect(s.repo.media.get(P)).toHaveLength(0);
  });

  it('timeout (P2028) => 503 PRODUCTS_BUSY; trigger de tope (23514) => 422 PRODUCT_MEDIA_INVALID', async () => {
    const s = setup();
    s.repo.failNextWriteWith = Object.assign(new Error('x'), { code: 'P2028' });
    expect(code(await failure(s.media.attach(staff(), P, { assetId: A1 })))).toBe('PRODUCTS_BUSY');
    s.repo.failNextWriteWith = Object.assign(new Error('product_media_max_items'), {
      code: 'P2004',
    });
    expect(code(await failure(s.media.attach(staff(), P, { assetId: A1 })))).toBe(
      'PRODUCT_MEDIA_INVALID',
    );
  });

  it('el asset se borró entre la lectura y el INSERT (FK) => 404 MEDIA_NOT_FOUND', async () => {
    const s = setup();
    s.repo.failNextWriteWith = Object.assign(
      new Error('Foreign key constraint violated: product_media_asset_id_fkey'),
      { code: 'P2003' },
    );
    expect(code(await failure(s.media.attach(staff(), P, { assetId: A1 })))).toBe(
      'MEDIA_NOT_FOUND',
    );
  });
});

describe('ProductMediaService.updateAlt', () => {
  it('cambia el alt (auditado), sin cambio => 200 sin escribir ni auditar, vacío/null lo borra', async () => {
    const s = setup();
    const m = await s.media.attach(staff(), P, { assetId: A1, altText: 'uno' });
    s.audit.length = 0;
    expect((await s.media.updateAlt(staff(), P, m.id, { altText: 'dos' })).altText).toBe('dos');
    expect(s.audit.map((a) => a.action)).toEqual(['product.media_updated']);
    expect(s.audit[0]?.newValues).toEqual({
      productId: P,
      mediaId: m.id,
      changedFields: ['altText'],
    });
    s.audit.length = 0;
    const writes = s.repo.count('updateMediaAlt');
    await s.media.updateAlt(staff(), P, m.id, { altText: ' dos ' });
    expect(s.repo.count('updateMediaAlt')).toBe(writes);
    expect(s.audit).toEqual([]);
    expect((await s.media.updateAlt(staff(), P, m.id, { altText: '   ' })).altText).toBeNull();
    expect((await s.media.updateAlt(staff(), P, m.id, { altText: null })).altText).toBeNull();
  });

  it('404 PRODUCT_NOT_FOUND / PRODUCT_MEDIA_NOT_FOUND (de otro producto); > 200 => 422', async () => {
    const s = setup();
    s.repo.seed(productRow(pid(2)));
    const other = await s.media.attach(staff(), pid(2), { assetId: A2 });
    const mine = await s.media.attach(staff(), P, { assetId: A1 });
    expect(
      code(await failure(s.media.updateAlt(staff(), pid(99), mine.id, { altText: 'x' }))),
    ).toBe('PRODUCT_NOT_FOUND');
    const foreign = await failure(s.media.updateAlt(staff(), P, other.id, { altText: 'x' }));
    expect(status(foreign)).toBe(404);
    expect(code(foreign)).toBe('PRODUCT_MEDIA_NOT_FOUND');
    expect(
      code(await failure(s.media.updateAlt(staff(), P, mine.id, { altText: 'x'.repeat(201) }))),
    ).toBe('PRODUCT_MEDIA_INVALID');
  });
});

describe('ProductMediaService.reorder', () => {
  async function three() {
    const s = setup();
    const a = await s.media.attach(staff(), P, { assetId: A1 });
    const b = await s.media.attach(staff(), P, { assetId: A2 });
    const c = await s.media.attach(staff(), P, { assetId: A3 });
    s.audit.length = 0;
    return { s, a, b, c };
  }

  it('reasigna 0..n-1 con el orden pedido y audita', async () => {
    const { s, a, b, c } = await three();
    const out = await s.media.reorder(staff(), P, [c.id, a.id, b.id]);
    expect(out.items.map((i) => [i.id, i.sortOrder])).toEqual([
      [c.id, 0],
      [a.id, 1],
      [b.id, 2],
    ]);
    expect(s.audit).toEqual([
      expect.objectContaining({
        action: 'product.media_reordered',
        newValues: { productId: P, count: 3 },
      }),
    ]);
  });

  it('idempotente: el mismo orden => 200 sin escribir ni auditar', async () => {
    const { s, a, b, c } = await three();
    const writes = s.repo.count('setMediaOrder');
    const out = await s.media.reorder(staff(), P, [a.id, b.id, c.id]);
    expect(out.items.map((i) => i.id)).toEqual([a.id, b.id, c.id]);
    expect(s.repo.count('setMediaOrder')).toBe(writes);
    expect(s.audit).toEqual([]);
  });

  it.each([
    ['faltante', (ids: string[]) => ids.slice(0, 2)],
    ['sobrante ajeno', (ids: string[]) => [...ids, pid(500)]],
    ['duplicado', (ids: string[]) => [ids[0], ids[0], ids[1]] as string[]],
    ['ajeno en lugar de uno', (ids: string[]) => [ids[0], ids[1], pid(500)] as string[]],
    ['vacío', () => []],
  ])('%s => 422 MEDIA_REORDER_MISMATCH sin escribir', async (_n, mutate) => {
    const { s, a, b, c } = await three();
    const e = await failure(s.media.reorder(staff(), P, mutate([a.id, b.id, c.id])));
    expect(status(e)).toBe(422);
    expect(code(e)).toBe('MEDIA_REORDER_MISMATCH');
    expect(s.repo.count('setMediaOrder')).toBe(0);
    expect(s.audit).toEqual([]);
  });

  it('producto inexistente => 404; producto sin imágenes y [] => 200 vacío', async () => {
    const s = setup();
    expect(code(await failure(s.media.reorder(staff(), pid(99), [])))).toBe('PRODUCT_NOT_FOUND');
    expect((await s.media.reorder(staff(), P, [])).items).toEqual([]);
  });
});

describe('ProductMediaService.detach', () => {
  it('desvincula, renumera 0..n-1, audita y NO toca el asset', async () => {
    const s = setup();
    const a = await s.media.attach(staff(), P, { assetId: A1 });
    const b = await s.media.attach(staff(), P, { assetId: A2 });
    const c = await s.media.attach(staff(), P, { assetId: A3 });
    s.audit.length = 0;
    await s.media.detach(staff(), P, a.id);
    expect(s.repo.media.get(P)?.map((m) => [m.id, m.sortOrder])).toEqual([
      [b.id, 0],
      [c.id, 1],
    ]);
    expect(s.audit).toEqual([
      expect.objectContaining({
        action: 'product.media_detached',
        newValues: { productId: P, assetId: A1, mediaId: a.id },
      }),
    ]);
    expect([...s.repo.assetSource()].map((x) => x.id)).toContain(A1);
  });

  it('quitar la última no renumera; 404 si no es de ese producto o no existe', async () => {
    const s = setup();
    const a = await s.media.attach(staff(), P, { assetId: A1 });
    const b = await s.media.attach(staff(), P, { assetId: A2 });
    await s.media.detach(staff(), P, b.id);
    expect(s.repo.count('setMediaOrder')).toBe(0);
    expect(code(await failure(s.media.detach(staff(), P, b.id)))).toBe('PRODUCT_MEDIA_NOT_FOUND');
    expect(code(await failure(s.media.detach(staff(), pid(99), a.id)))).toBe('PRODUCT_NOT_FOUND');
  });

  it('403 sin alcance global', async () => {
    const s = setup();
    expect(
      status(await failure(s.media.detach(scopedStaff(['catalog.update'], ['b']), P, 'x'))),
    ).toBe(403);
  });
});

describe('PATCH media de F11: enlace automático con assets (D11)', () => {
  const url = (key: string) => `${BASE}/${key}`;

  it('una URL igual a la pública de un asset READY se enlaza por asset_id y conserva su url; las externas quedan sin asset', async () => {
    const s = setup();
    const out = await s.products.update(staff(), P, {
      media: [
        { url: url('products/2026/a1.png'), altText: 'a' },
        { url: 'https://otro.ejemplo.org/x.png' },
      ],
    });
    expect(out.media.map((m) => [m.url, m.assetId])).toEqual([
      [url('products/2026/a1.png'), A1],
      ['https://otro.ejemplo.org/x.png', null],
    ]);
    expect(s.repo.count('findReadyAssetsByKeys')).toBe(1); // una sola consulta
  });

  it('una URL bajo el host de R2 sin asset READY (inexistente, PENDING, con query o sin clave) => 422 PRODUCT_MEDIA_INVALID con path', async () => {
    const s = setup();
    for (const bad of [
      url('products/2026/no-existe.png'),
      url('products/2026/pend.png'),
      `${url('products/2026/a1.png')}?v=1`,
      BASE,
    ]) {
      const e = (await failure(s.products.update(staff(), P, { media: [{ url: bad }] }))) as {
        response: { violations: { path: string }[] };
      };
      expect(status(e)).toBe(422);
      expect(code(e)).toBe('PRODUCT_MEDIA_INVALID');
      expect(e.response.violations[0]?.path).toBe('media[0].url');
    }
    expect(s.repo.media.get(P)).toEqual([]);
  });

  it('el índice del path apunta a la URL de R2 inválida', async () => {
    const s = setup();
    const e = (await failure(
      s.products.update(staff(), P, {
        media: [{ url: 'https://otro.ejemplo.org/x.png' }, { url: url('products/2026/nada.png') }],
      }),
    )) as { response: { violations: { path: string }[] } };
    expect(e.response.violations[0]?.path).toBe('media[1].url');
  });

  it('también al crear: una URL de R2 sin asset READY no se cuela por POST', async () => {
    const s = setup();
    const e = await failure(
      s.products.create(staff(), {
        name: 'Roll',
        basePrice: '10.00',
        categoryId: CAT.frios,
        media: [{ url: url('products/2026/falso.png') }],
      }),
    );
    expect(code(e)).toBe('PRODUCT_MEDIA_INVALID');
    const ok = await s.products.create(staff(), {
      name: 'Roll',
      basePrice: '10.00',
      categoryId: CAT.frios,
      media: [{ url: url('products/2026/a2.webp') }],
    });
    expect(ok.media[0]?.assetId).toBe(A2);
  });

  it('PRODUCT_MEDIA_ALLOWED_HOSTS no vacía: el host de R2 se añade a la lista efectiva; otro host no listado se rechaza', async () => {
    const s = setup(['cdn.permitido.com']);
    await expect(
      s.products.update(staff(), P, { media: [{ url: url('products/2026/a1.png') }] }),
    ).resolves.toBeDefined();
    const e = await failure(
      s.products.update(staff(), P, { media: [{ url: 'https://otro.ejemplo.org/x.png' }] }),
    );
    expect(code(e)).toBe('PRODUCT_MEDIA_INVALID');
  });

  it('sin base de R2 configurada se comporta exactamente como F11 (URL externas sin asset)', async () => {
    const s = setup();
    const noMedia = new AdminProductsService(
      s.repo as unknown as ProductsRepository,
      { record: vi.fn() },
      new AuthorizationService({} as IdentityService),
      s.categoriesQuery,
      { get: () => [] } as unknown as ConfigService<Env, true>,
      new MediaUrlService(mediaConfig({ mode: 'UNAVAILABLE', publicBaseUrl: null, bucket: null })),
    );
    const out = await noMedia.update(staff(), P, { media: [{ url: url('products/2026/x.png') }] });
    expect(out.media[0]?.assetId).toBeNull();
    expect(s.repo.count('findReadyAssetsByKeys')).toBe(0);
  });

  it('lista vacía o solo URL externas no consulta assets', async () => {
    const s = setup();
    await s.products.update(staff(), P, { media: [{ url: 'https://otro.ejemplo.org/x.png' }] });
    await s.products.update(staff(), P, { media: [] });
    expect(s.repo.count('findReadyAssetsByKeys')).toBe(0);
  });
});
