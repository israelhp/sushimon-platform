import {
  assetid,
  bnid,
  catid,
  prodid,
  promoid,
  text,
} from '../../test/support/fake-banners-repo.js';
import {
  A,
  B,
  bannersHarness,
  INACTIVE_BRANCH,
  local,
  MISSING_BRANCH,
  NOW,
} from '../../test/support/banners-harness.js';
import { boundedCacheControl } from '../common/http/bounded-cache.js';

const failure = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => {
      const x = e as { getStatus?: () => number; getResponse?: () => unknown };
      return {
        status: x.getStatus?.(),
        code: ((x.getResponse?.() ?? {}) as { code?: string }).code,
      };
    },
  );

const SEC = 1000;
const at = (ms: number) => new Date(NOW.getTime() + ms);

const find = (
  h: ReturnType<typeof bannersHarness>,
  over: { branchId?: string; locale?: 'es' | 'en' } = {},
) => h.reader.findActiveBanners({ branchId: over.branchId ?? null, locale: over.locale ?? 'es' });

const ids = (r: { items: { id: string }[] }) => r.items.map((i) => i.id);

describe('lector público de banners: vigencia [startsAt, endsAt) (B1-B5)', () => {
  it('F17: branchValidated no relee la sucursal (una consulta menos); sin él la valida', async () => {
    const h = bannersHarness();
    h.repo.seed({});
    await h.reader.findActiveBanners({ branchId: A, locale: 'es', branchValidated: true });
    expect(h.repo.count('findBranchStatus')).toBe(0);
    await h.reader.findActiveBanners({ branchId: A, locale: 'es' });
    expect(h.repo.count('findBranchStatus')).toBe(1);
  });

  it('B1: starts = ahora y ends = ahora + 1 s => publicado; a ends exacto ya NO (fin exclusivo)', async () => {
    const h = bannersHarness();
    const b = h.repo.seed({ startsAt: at(0), endsAt: at(1 * SEC) });
    const r = await find(h);
    expect(ids(r)).toEqual([b.id]);
    expect(r.nextChangeAt).toBe(at(1 * SEC).toISOString());
    h.clock.current = at(1 * SEC);
    expect(ids(await find(h))).toEqual([]);
    h.clock.current = at(1 * SEC - 1);
    expect(ids(await find(h))).toEqual([b.id]);
  });

  it('B2: starts = ahora + 1 s => no publicado; nextChangeAt = starts; luego publicado', async () => {
    const h = bannersHarness();
    const b = h.repo.seed({ startsAt: at(1 * SEC) });
    const r = await find(h);
    expect(r.items).toEqual([]);
    expect(r.nextChangeAt).toBe(at(1 * SEC).toISOString());
    h.clock.current = at(1 * SEC);
    expect(ids(await find(h))).toEqual([b.id]);
  });

  it('B3: sin fin => publicado sin fin; nextChangeAt null si nada más cambia', async () => {
    const h = bannersHarness();
    const b = h.repo.seed({ startsAt: null, endsAt: null });
    const r = await find(h);
    expect(ids(r)).toEqual([b.id]);
    expect(r.nextChangeAt).toBeNull();
  });

  it('B3: nextChangeAt sale de otro banner aunque el publicado no tenga fin', async () => {
    const h = bannersHarness();
    h.repo.seed();
    h.repo.seed({ startsAt: at(60 * SEC) });
    expect((await find(h)).nextChangeAt).toBe(at(60 * SEC).toISOString());
  });

  it('B5: inactivo con fechas correctas => nunca publicado', async () => {
    const h = bannersHarness();
    h.repo.seed({ active: false, startsAt: at(-SEC), endsAt: at(60 * SEC) });
    const r = await find(h);
    expect(r.items).toEqual([]);
    expect(r.nextChangeAt).toBeNull();
  });

  it('un banner vencido no sale ni acota nextChangeAt; uno más allá de 14 días tampoco', async () => {
    const h = bannersHarness();
    h.repo.seed({ endsAt: at(-SEC) });
    h.repo.seed({ startsAt: at(15 * 24 * 3600 * SEC) });
    const r = await find(h);
    expect(r.items).toEqual([]);
    expect(r.nextChangeAt).toBeNull();
  });

  it('reloj determinista: la hora del servidor genera generatedAt', async () => {
    const h = bannersHarness();
    expect((await find(h)).generatedAt).toBe(NOW.toISOString());
  });
});

describe('sucursales (B6, B7)', () => {
  it('B6: sin branchId solo los de todas las sucursales', async () => {
    const h = bannersHarness();
    const all = h.repo.seed();
    h.repo.seed({ branchIds: [A] });
    expect(ids(await find(h))).toEqual([all.id]);
  });

  it('B7: con branchId, los ALL y los SELECTED que la incluyen; no los de otra', async () => {
    const h = bannersHarness();
    const all = h.repo.seed();
    const inA = h.repo.seed({ branchIds: [A] });
    h.repo.seed({ branchIds: [B] });
    expect(ids(await find(h, { branchId: A }))).toEqual([all.id, inA.id]);
  });

  it('B7: sucursal inexistente o inactiva => 404 BRANCH_NOT_FOUND', async () => {
    const h = bannersHarness();
    expect(await failure(find(h, { branchId: MISSING_BRANCH }))).toEqual({
      status: 404,
      code: 'BRANCH_NOT_FOUND',
    });
    expect(await failure(find(h, { branchId: INACTIVE_BRANCH }))).toEqual({
      status: 404,
      code: 'BRANCH_NOT_FOUND',
    });
  });
});

describe('promoción vinculada (B8-B11)', () => {
  it('B8: vigente => sale; inactiva, futura, vencida => oculto', async () => {
    const h = bannersHarness();
    const live = h.repo.seedPromotion(1);
    const inactive = h.repo.seedPromotion(2, { active: false });
    const future = h.repo.seedPromotion(3, { startsAt: at(3600 * SEC), endsAt: at(7200 * SEC) });
    const expired = h.repo.seedPromotion(4, { startsAt: at(-7200 * SEC), endsAt: at(-3600 * SEC) });
    const b1 = h.repo.seed({ promotionId: live.id });
    for (const p of [inactive, future, expired]) h.repo.seed({ promotionId: p.id });
    expect(ids(await find(h))).toEqual([b1.id]);
  });

  it('B8: fuera de tramo semanal => oculto; dentro => sale (lunes 16:00 local)', async () => {
    const h = bannersHarness();
    const out = h.repo.seedPromotion(1, {
      schedule: [{ weekday: 1, startsAt: '18:00', endsAt: '20:00' }],
    });
    const inside = h.repo.seedPromotion(2, {
      schedule: [{ weekday: 1, startsAt: '15:00', endsAt: '17:00' }],
    });
    h.repo.seed({ promotionId: out.id });
    const ok = h.repo.seed({ promotionId: inside.id });
    expect(ids(await find(h))).toEqual([ok.id]);
  });

  it('B9: promoción SELECTED que no incluye la sucursal => oculto; sin branchId solo si es ALL', async () => {
    const h = bannersHarness();
    const onlyB = h.repo.seedPromotion(1, { branchIds: [B] });
    const onlyA = h.repo.seedPromotion(2, { branchIds: [A] });
    const everywhere = h.repo.seedPromotion(3);
    h.repo.seed({ promotionId: onlyB.id });
    const a = h.repo.seed({ promotionId: onlyA.id });
    const e = h.repo.seed({ promotionId: everywhere.id });
    expect(ids(await find(h, { branchId: A }))).toEqual([a.id, e.id]);
    expect(ids(await find(h))).toEqual([e.id]);
  });

  it('B10: nextChangeAt = el menor entre fechas del banner y el cambio de la promoción', async () => {
    const h = bannersHarness();
    const promo = h.repo.seedPromotion(1, { endsAt: at(10 * SEC) });
    h.repo.seed({ promotionId: promo.id, endsAt: at(60 * SEC) });
    expect((await find(h)).nextChangeAt).toBe(at(10 * SEC).toISOString());
    // si la fecha del banner es anterior, manda el banner
    h.repo.banners.clear();
    h.repo.seed({ promotionId: promo.id, endsAt: at(5 * SEC) });
    expect((await find(h)).nextChangeAt).toBe(at(5 * SEC).toISOString());
  });

  it('B10: la promoción futura acota nextChangeAt con su inicio aunque el banner no salga aún', async () => {
    const h = bannersHarness();
    const promo = h.repo.seedPromotion(1, { startsAt: at(20 * SEC), endsAt: at(3600 * SEC) });
    const b = h.repo.seed({ promotionId: promo.id });
    const r = await find(h);
    expect(r.items).toEqual([]);
    expect(r.nextChangeAt).toBe(at(20 * SEC).toISOString());
    h.clock.current = at(20 * SEC);
    expect(ids(await find(h))).toEqual([b.id]);
  });

  it('varios banners con la misma promoción: mismo resultado (la vigencia se calcula una vez)', async () => {
    const h = bannersHarness();
    const promo = h.repo.seedPromotion(1, { endsAt: at(10 * SEC) });
    const live = [h.repo.seed({ promotionId: promo.id }), h.repo.seed({ promotionId: promo.id })];
    const r = await find(h);
    expect(ids(r)).toEqual(live.map((b) => b.id));
    expect(r.nextChangeAt).toBe(at(10 * SEC).toISOString());
  });

  it('B10: caché acotada por nextChangeAt; el límite exacto se calcula con generatedAt', async () => {
    const h = bannersHarness();
    h.repo.seed({ endsAt: at(10 * SEC) });
    const r = await find(h);
    expect(boundedCacheControl(r)).toBe('public, max-age=5, s-maxage=10');
    h.repo.banners.clear();
    h.repo.seed({ endsAt: at(1_500) });
    expect(boundedCacheControl(await find(h))).toBe('public, max-age=1, s-maxage=1');
    h.repo.banners.clear();
    h.repo.seed({ endsAt: at(3600 * SEC) });
    expect(boundedCacheControl(await find(h))).toBe('public, max-age=5, s-maxage=30');
  });

  it('caché tras activar/desactivar: la lectura refleja el cambio de inmediato (sin estado propio)', async () => {
    const h = bannersHarness();
    const b = h.repo.seed();
    expect(ids(await find(h))).toEqual([b.id]);
    h.repo.banners.set(b.id, { ...b, active: false });
    expect(ids(await find(h))).toEqual([]);
    h.repo.banners.set(b.id, { ...b, active: true });
    expect(ids(await find(h))).toEqual([b.id]);
  });

  it('B11: nunca revela código, descuento, productos ni promotionId (ni en el JSON)', async () => {
    const h = bannersHarness();
    const promo = h.repo.seedPromotion(1, { name: 'Cupón SECRETO10' });
    h.repo.seed({ promotionId: promo.id });
    const r = await find(h);
    expect(r.items).toHaveLength(1);
    const json = JSON.stringify(r);
    for (const leak of [
      'promotionId',
      promoid(1),
      'SECRETO10',
      'code',
      'kind',
      'value',
      'productIds',
      'version',
    ])
      expect(json).not.toContain(leak);
    expect(Object.keys(r.items[0]!).sort()).toEqual(
      ['cta', 'ctaLabel', 'fallbackFields', 'id', 'image', 'imageAlt', 'subtitle', 'title'].sort(),
    );
  });
});

describe('idioma (B12, B13)', () => {
  it('B12: locale=en sin traducción en => todo en español con fallbackFields', async () => {
    const h = bannersHarness();
    h.repo.seed({
      es: text({ title: 'Hola', subtitle: 'Sub', ctaLabel: 'Pedir', imageAlt: 'Alt' }),
      en: null,
    });
    const [item] = (await find(h, { locale: 'en' })).items;
    expect(item).toMatchObject({
      title: 'Hola',
      subtitle: 'Sub',
      ctaLabel: 'Pedir',
      imageAlt: 'Alt',
    });
    expect(item?.fallbackFields).toEqual(['title', 'subtitle', 'ctaLabel', 'imageAlt']);
  });

  it('B12: con en solo título => título en inglés y el resto en español', async () => {
    const h = bannersHarness();
    h.repo.seed({
      es: text({ title: 'Hola', subtitle: 'Sub', imageAlt: 'Alt' }),
      en: { title: 'Hello', subtitle: null, ctaLabel: null, imageAlt: null },
    });
    const [item] = (await find(h, { locale: 'en' })).items;
    expect(item).toMatchObject({
      title: 'Hello',
      subtitle: 'Sub',
      imageAlt: 'Alt',
      ctaLabel: null,
    });
    expect(item?.fallbackFields).toEqual(['subtitle', 'imageAlt']);
  });

  it('B12: subtítulo en inglés en blanco => subtítulo en español (campo en respaldo)', async () => {
    const h = bannersHarness();
    h.repo.seed({
      es: text({ subtitle: 'Sub' }),
      en: { title: 'Hello', subtitle: '   ', ctaLabel: null, imageAlt: 'Alt en' },
    });
    const [item] = (await find(h, { locale: 'en' })).items;
    expect(item).toMatchObject({ subtitle: 'Sub', title: 'Hello', imageAlt: 'Alt en' });
    expect(item?.fallbackFields).toEqual(['subtitle']);
  });

  it('locale=es nunca marca respaldo, aunque exista en', async () => {
    const h = bannersHarness();
    h.repo.seed({ en: text({ title: 'Hello', imageAlt: 'A' }) });
    const [item] = (await find(h, { locale: 'es' })).items;
    expect(item?.title).toBe('Banner 1');
    expect(item?.fallbackFields).toEqual([]);
  });

  it('B13: sin fila es válida (dato corrupto) => no se publica', async () => {
    const h = bannersHarness();
    h.repo.seed({ es: null, en: text() });
    h.repo.seed({ es: text({ title: null }) });
    h.repo.seed({ es: text({ imageAlt: null }) });
    const ok = h.repo.seed();
    expect(ids(await find(h, { locale: 'en' }))).toEqual([ok.id]);
  });
});

describe('imagen y destino (B14, B15)', () => {
  it('B14: imagen PENDING o de otro tipo => no se publica, sin error', async () => {
    const h = bannersHarness();
    h.repo.seedAsset(2, { status: 'PENDING' });
    h.repo.seedAsset(3, { kind: 'PRODUCT_IMAGE', objectKey: 'products/2026/x.png' });
    h.repo.seed({ imageAssetId: assetid(2) });
    h.repo.seed({ imageAssetId: assetid(3) });
    const ok = h.repo.seed({ imageAssetId: assetid(1) });
    expect(ids(await find(h))).toEqual([ok.id]);
  });

  it('B14: sin base pública (almacenamiento no disponible) => lista vacía y sin 5xx', async () => {
    const h = bannersHarness({ publicBaseUrl: null });
    h.repo.seed();
    const r = await find(h);
    expect(r.items).toEqual([]);
  });

  it('la imagen es la URL pública permanente (nunca firmada)', async () => {
    const h = bannersHarness();
    h.repo.seed();
    const [item] = (await find(h)).items;
    expect(item?.image.url).toBe(`https://media.mock.invalid/banners/2026/${assetid(1)}.webp`);
    expect(item?.image.mimeType).toBe('image/webp');
    expect(item?.image.url).not.toMatch(/[?&](X-Amz|Signature|token)/i);
  });

  it('B15: CTA a categoría o producto desactivado => oculto; activo => sale con sus datos', async () => {
    const h = bannersHarness();
    h.repo.seedCategory(1, { slug: 'rolls' });
    h.repo.seedCategory(2, { active: false });
    h.repo.seedProduct(1);
    h.repo.seedProduct(2, { active: false });
    const c = h.repo.seed({
      cta: { type: 'CATEGORY', categoryId: catid(1), productId: null, page: null },
    });
    const p = h.repo.seed({
      cta: { type: 'PRODUCT', categoryId: null, productId: prodid(1), page: null },
    });
    h.repo.seed({ cta: { type: 'CATEGORY', categoryId: catid(2), productId: null, page: null } });
    h.repo.seed({ cta: { type: 'PRODUCT', categoryId: null, productId: prodid(2), page: null } });
    const r = await find(h);
    expect(ids(r)).toEqual([c.id, p.id]);
    expect(r.items[0]?.cta).toEqual({
      type: 'CATEGORY',
      categorySlug: 'rolls',
      productId: null,
      page: null,
    });
    expect(r.items[1]?.cta).toEqual({
      type: 'PRODUCT',
      categorySlug: null,
      productId: prodid(1),
      page: null,
    });
  });

  it('CTA PAGE, MENU, PROMOTIONS y NONE devuelven solo tipo y página', async () => {
    const h = bannersHarness();
    h.repo.seed({ cta: { type: 'PAGE', categoryId: null, productId: null, page: 'CAREERS' } });
    h.repo.seed({ cta: { type: 'MENU', categoryId: null, productId: null, page: null } });
    const r = await find(h);
    expect(r.items.map((i) => i.cta)).toEqual([
      { type: 'PAGE', categorySlug: null, productId: null, page: 'CAREERS' },
      { type: 'MENU', categorySlug: null, productId: null, page: null },
    ]);
  });
});

describe('orden y tope (B16-B18)', () => {
  it('B16: 11 elegibles => 10, por sort_order, created_at e id', async () => {
    const h = bannersHarness();
    const made = Array.from({ length: 11 }, (_, i) => h.repo.seed({ sortOrder: 10 - i }));
    const r = await find(h);
    expect(r.items).toHaveLength(10);
    expect(ids(r)).toEqual(
      made
        .slice(1)
        .reverse()
        .map((b) => b.id),
    );
  });

  it('B17: mismo sort_order => created_at y luego id, independiente del orden de inserción', async () => {
    const h = bannersHarness();
    const same = new Date('2026-02-01T00:00:00Z');
    const later = h.repo.seed({ sortOrder: 1, createdAt: new Date('2026-03-01T00:00:00Z') });
    const idHigh = h.repo.seed({ sortOrder: 1, createdAt: same });
    const idLow = h.repo.seed({ sortOrder: 1, createdAt: same });
    const first = h.repo.seed({ sortOrder: 0 });
    // fuerza el desempate por id: el de id menor primero
    const [lo, hi] = [idHigh, idLow].sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(ids(await find(h))).toEqual([first.id, lo!.id, hi!.id, later.id]);
    // reinsertar en otro orden no cambia el resultado
    const copy = [...h.repo.banners.values()].reverse();
    h.repo.banners.clear();
    for (const b of copy) h.repo.banners.set(b.id, b);
    expect(ids(await find(h))).toEqual([first.id, lo!.id, hi!.id, later.id]);
  });

  it('B18: lista vacía => items [] y nextChangeAt null', async () => {
    const h = bannersHarness();
    const r = await find(h);
    expect(r).toEqual({ items: [], nextChangeAt: null, generatedAt: NOW.toISOString() });
  });

  it('el id de un banner en la lista coincide con el del repositorio (id estable)', async () => {
    const h = bannersHarness();
    const b = h.repo.seed();
    expect(b.id).toBe(bnid(1));
    expect(ids(await find(h))).toEqual([bnid(1)]);
    expect(local('2026-11-16T16:00:00').getTime()).toBe(NOW.getTime());
  });
});

describe('errores de BD', () => {
  it('timeout/bloqueo de lectura => 503 BANNERS_BUSY (mensaje fijo)', async () => {
    const h = bannersHarness();
    h.repo.failReadWith = Object.assign(new Error('Transaction API error'), { code: 'P2028' });
    expect(await failure(find(h))).toEqual({ status: 503, code: 'BANNERS_BUSY' });
  });
  it('otro error se propaga tal cual (500 genérico en HTTP)', async () => {
    const h = bannersHarness();
    h.repo.failReadWith = new Error('boom');
    await expect(find(h)).rejects.toThrow('boom');
  });
});
