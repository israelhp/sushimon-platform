import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type { AdminBanner, CreateBannerRequest } from '@/lib/data-access/models';
import { fromLocal } from '@/lib/time';
import * as banners from '@/services/banners';
import * as media from '@/services/media';
import { createHarness, type TestHarness } from '../testing';

/**
 * F16 — Adaptador mock de banners con la MISMA semántica del contrato (spec 017, casos B1–B22). «Ahora» de la demo = miércoles
 * 11 nov 2026, 14:25 en Guatemala. NO prueba la API real: solo que el mock reproduce lo que el contrato describe.
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

const at = (date: string, time: string, seconds = 0) =>
  new Date(fromLocal(date, time).getTime() + seconds * 1000).toISOString();

const ASSET = 'media-seed-banner-favoritos';

const valid: CreateBannerRequest = {
  code: 'nuevo-banner',
  imageAssetId: ASSET,
  translations: { es: { title: 'Nuevo', imageAlt: 'Imagen nueva' } },
  cta: { type: 'MENU' },
  branchScope: 'ALL',
  active: true,
};

const admin = () => {
  const h = createHarness();
  h.asStaff('admin');
  return h;
};

/** El manager de la sucursal 1 con permisos de banners (por defecto solo `admin` los tiene: P18). */
function scopedManager(): TestHarness {
  const h = createHarness();
  h.store.roles
    .find((r) => r.code === 'manager')
    ?.permissions.push('banners.read', 'banners.create', 'banners.update');
  h.asStaff('manager', 'u2');
  return h;
}

const codes = (list: { items: { id: string }[] }) => list.items.map((i) => i.id);
const publicIds = async (
  h: TestHarness,
  branchId: string | null = null,
  locale: 'es' | 'en' = 'es',
) => codes(await banners.listStoreBanners(h.client, branchId, locale));

describe('público: GET /v1/store/banners', () => {
  it('sin sucursal y a las 14:25: solo los de todas las sucursales vigentes (el Happy Hour espera a su promoción)', async () => {
    const h = createHarness();
    const list = await banners.listStoreBanners(h.client, null, 'es');
    expect(codes(list)).toEqual(['banner-favoritos', 'banner-calientito', 'banner-equipo']);
    expect(list).toMatchObject({
      branchId: null,
      locale: 'es',
      generatedAt: '2026-11-11T20:25:00.000Z',
      // Happy Hour de hoy a las 15:00 (21:00Z): el menor cambio por tiempo.
      nextChangeAt: at('2026-11-11', '15:00'),
    });
  });

  it('B1: [startsAt, endsAt) — publicado desde startsAt y NO a endsAt exacto (fin exclusivo)', async () => {
    const h = admin();
    const now = h.clock.now();
    await banners.createAdminBanner(h.client, {
      ...valid,
      startsAt: now.toISOString(),
      endsAt: new Date(now.getTime() + 1000).toISOString(),
    });
    expect(await publicIds(h)).toContain('banner-1');
    h.clock.advance(999);
    expect(await publicIds(h)).toContain('banner-1');
    h.clock.advance(1);
    expect(await publicIds(h)).not.toContain('banner-1');
  });

  it('B2: empieza en 1 s → no se publica, está programado y nextChangeAt = startsAt', async () => {
    const h = admin();
    const startsAt = new Date(h.clock.now().getTime() + 1000).toISOString();
    const created = await banners.createAdminBanner(h.client, { ...valid, startsAt });
    expect(created.lifecycle).toBe('SCHEDULED');
    expect(created.visibleNow).toBe(false);
    const list = await banners.listStoreBanners(h.client, null, 'es');
    expect(codes(list)).not.toContain(created.id);
    expect(list.nextChangeAt).toBe(startsAt);
    h.clock.advance(1000);
    expect(await publicIds(h)).toContain(created.id);
  });

  it('B3: sin fin se publica indefinidamente; B5: inactivo nunca', async () => {
    const h = admin();
    const open = await banners.createAdminBanner(h.client, { ...valid, code: 'sin-fin' });
    const off = await banners.createAdminBanner(h.client, {
      ...valid,
      code: 'apagado',
      active: false,
    });
    expect(open.endsAt).toBeNull();
    h.clock.advance(400 * 86_400_000);
    const ids = await publicIds(h);
    expect(ids).toContain(open.id);
    expect(ids).not.toContain(off.id);
    expect(off.lifecycle).toBe('INACTIVE');
  });

  it('B6/B7: sin sucursal solo ALL; con sucursal ALL + SELECTED que la incluye; inexistente o inactiva = 404', async () => {
    const h = createHarness();
    expect(await publicIds(h)).not.toContain('banner-fin-de-mes');
    expect(await publicIds(h, 'sucursal-1')).toContain('banner-fin-de-mes');
    expect(await publicIds(h, 'sucursal-2')).toContain('banner-fin-de-mes');
    expect(await publicIds(h, 'sucursal-3')).not.toContain('banner-fin-de-mes');
    expect(await publicIds(h, 'sucursal-3')).toContain('banner-favoritos');
    for (const id of ['zzz', 'sucursal-4']) {
      expect(await failure(banners.listStoreBanners(h.client, id, 'es'))).toMatchObject({
        status: 404,
        code: 'BRANCH_NOT_FOUND',
      });
    }
  });

  it('B8: con promoción vinculada solo se publica mientras la promoción esté vigente (activa, vigencia y horario)', async () => {
    const h = createHarness();
    // Happy Hour (lun–jue 15:00–18:00): fuera de tramo a las 14:25.
    expect(await publicIds(h)).not.toContain('banner-happy-hour');
    h.clock.set(at('2026-11-11', '15:00'));
    expect(await publicIds(h)).toContain('banner-happy-hour');
    h.clock.set(at('2026-11-11', '17:59', 59));
    expect(await publicIds(h)).toContain('banner-happy-hour');
    h.clock.set(at('2026-11-11', '18:00'));
    expect(await publicIds(h)).not.toContain('banner-happy-hour');
    // Viernes dentro del horario de la tarde: la promoción no rige ese día.
    h.clock.set(at('2026-11-13', '16:00'));
    expect(await publicIds(h)).not.toContain('banner-happy-hour');
    // Desactivada: oculto aunque esté en su tramo.
    h.clock.set(at('2026-11-12', '16:00'));
    expect(await publicIds(h)).toContain('banner-happy-hour');
    h.store.promotions.find((p) => p.id === 'happy-hour')!.active = false;
    expect(await publicIds(h)).not.toContain('banner-happy-hour');
  });

  it('B8: la promoción vencida o futura oculta el banner (admin: PROMOTION_NOT_LIVE)', async () => {
    const h = admin();
    const sem = h.store.banners.find((b) => b.id === 'banner-semana-cliente')!;
    // Quitar el fin del banner para aislar el efecto de su promoción (vencida el 1 nov).
    sem.endsAt = null;
    sem.startsAt = null;
    expect(await publicIds(h)).not.toContain('banner-semana-cliente');
    const detail = await banners.getAdminBanner(h.client, 'banner-semana-cliente');
    expect(detail).toMatchObject({
      lifecycle: 'PUBLISHED',
      visibleNow: false,
      hiddenReason: 'PROMOTION_NOT_LIVE',
      promotion: { id: 'semana-cliente', lifecycle: 'EXPIRED' },
    });
  });

  it('B9: la promoción SELECTED que no incluye la sucursal oculta el banner ALL; sin sucursal, solo si la promoción es ALL', async () => {
    const h = createHarness();
    const b = h.store.banners.find((x) => x.id === 'banner-favoritos')!;
    b.promotionId = 'fin-de-mes'; // promoción de las sucursales 1 y 2
    expect(await publicIds(h, 'sucursal-1')).toContain('banner-favoritos');
    expect(await publicIds(h, 'sucursal-3')).not.toContain('banner-favoritos');
    expect(await publicIds(h)).not.toContain('banner-favoritos');
  });

  it('B10: nextChangeAt es el menor entre las fechas del banner y el cambio de la promoción vinculada', async () => {
    const h = createHarness();
    h.clock.set(at('2026-11-11', '15:30'));
    // Happy Hour en curso: cambia a las 18:00; Navidad empieza el 20.
    expect((await banners.listStoreBanners(h.client, null)).nextChangeAt).toBe(
      at('2026-11-11', '18:00'),
    );
    h.store.banners.find((b) => b.id === 'banner-equipo')!.endsAt = at('2026-11-11', '16:00');
    expect((await banners.listStoreBanners(h.client, null)).nextChangeAt).toBe(
      at('2026-11-11', '16:00'),
    );
    // Pasado el horizonte de 14 días no hay cambio previsible.
    const empty = createHarness('banners-empty');
    expect((await banners.listStoreBanners(empty.client, null)).nextChangeAt).toBeNull();
  });

  it('B11: un cupón vinculado nunca revela código, descuento ni promoción (ni ids)', async () => {
    const h = createHarness();
    const b = h.store.banners.find((x) => x.id === 'banner-bienvenida')!;
    b.active = true; // promoción «bienvenida»: cupón BIENVENIDO10, vigente
    const list = await banners.listStoreBanners(h.client, null);
    const item = list.items.find((i) => i.id === 'banner-bienvenida')!;
    expect(item).toBeDefined();
    expect(Object.keys(item).sort()).toEqual(
      ['cta', 'ctaLabel', 'fallbackFields', 'id', 'image', 'imageAlt', 'subtitle', 'title'].sort(),
    );
    const text = JSON.stringify(list);
    expect(text).not.toMatch(/BIENVENIDO10|promotionId|"code"|"kind"|"value"|productIds|"version"/);
  });

  it('B12: respaldo POR CAMPO a español y fallbackFields', async () => {
    const h = createHarness();
    // Sin traducción al inglés: todo en español y los cuatro campos en respaldo.
    const en = (await banners.listStoreBanners(h.client, 'sucursal-1', 'en')).items.find(
      (i) => i.id === 'banner-fin-de-mes',
    )!;
    expect(en).toMatchObject({
      title: 'Fin de mes: bebidas',
      subtitle: 'En las sucursales 1 y 2.',
    });
    expect(en.fallbackFields).toEqual(['title', 'subtitle', 'ctaLabel', 'imageAlt']);
    // Con inglés solo en el título: el resto en español.
    const b = h.store.banners.find((x) => x.id === 'banner-fin-de-mes')!;
    b.translations.en = { title: 'Month end', subtitle: null, ctaLabel: null, imageAlt: null };
    const partial = (await banners.listStoreBanners(h.client, 'sucursal-1', 'en')).items.find(
      (i) => i.id === 'banner-fin-de-mes',
    )!;
    expect(partial.title).toBe('Month end');
    expect(partial.fallbackFields).toEqual(['subtitle', 'ctaLabel', 'imageAlt']);
    // Subtítulo en blanco en inglés cuenta como ausente.
    b.translations.en = {
      title: 'Month end',
      subtitle: '   ',
      ctaLabel: 'Menu',
      imageAlt: 'Cold drinks',
    };
    const blank = (await banners.listStoreBanners(h.client, 'sucursal-1', 'en')).items.find(
      (i) => i.id === 'banner-fin-de-mes',
    )!;
    expect(blank).toMatchObject({ subtitle: 'En las sucursales 1 y 2.', ctaLabel: 'Menu' });
    expect(blank.fallbackFields).toEqual(['subtitle']);
    // En español nunca hay respaldo.
    const es = (await banners.listStoreBanners(h.client, 'sucursal-1', 'es')).items.find(
      (i) => i.id === 'banner-fin-de-mes',
    )!;
    expect(es.fallbackFields).toEqual([]);
  });

  it('B13: sin traducción en español válida (dato corrupto) no se publica', async () => {
    const h = createHarness();
    h.store.banners.find((b) => b.id === 'banner-favoritos')!.translations.es.title = null;
    expect(await publicIds(h)).not.toContain('banner-favoritos');
  });

  it('B14: imagen PENDING o de otro tipo no se publica (sin 5xx)', async () => {
    const h = createHarness();
    h.store.mediaAssets.find((a) => a.id === 'media-seed-banner-favoritos')!.status = 'PENDING';
    h.store.mediaAssets.find((a) => a.id === 'media-seed-banner-equipo')!.kind = 'PRODUCT_IMAGE';
    const ids = await publicIds(h);
    expect(ids).toEqual(['banner-calientito']);
  });

  it('B15: destino de categoría o producto inactivo oculta el banner (admin: CTA_TARGET_INACTIVE)', async () => {
    const h = admin();
    h.store.menuCategories.find((c) => c.id === 'cat-rolls')!.active = false;
    h.store.products.find((p) => p.id === 'calientito-roll')!.active = false;
    expect(await publicIds(h)).toEqual(['banner-equipo']);
    expect(await banners.getAdminBanner(h.client, 'banner-favoritos')).toMatchObject({
      visibleNow: false,
      hiddenReason: 'CTA_TARGET_INACTIVE',
      cta: { targetActive: false },
    });
  });

  it('precedencia de hiddenReason: PROMOTION_NOT_LIVE → CTA_TARGET_INACTIVE → IMAGE_UNAVAILABLE', async () => {
    const h = admin();
    const b = h.store.banners.find((x) => x.id === 'banner-happy-hour')!; // promoción no vigente a las 14:25
    b.cta = { type: 'CATEGORY', categoryId: 'cat-rolls', productId: null, page: null };
    h.store.menuCategories.find((c) => c.id === 'cat-rolls')!.active = false;
    h.store.mediaAssets.find((a) => a.id === b.imageAssetId)!.status = 'PENDING';
    const reason = async () => (await banners.getAdminBanner(h.client, b.id)).hiddenReason;
    expect(await reason()).toBe('PROMOTION_NOT_LIVE');
    b.promotionId = null;
    expect(await reason()).toBe('CTA_TARGET_INACTIVE');
    h.store.menuCategories.find((c) => c.id === 'cat-rolls')!.active = true;
    expect(await reason()).toBe('IMAGE_UNAVAILABLE');
  });

  it('B16/B17: máximo 10, por sortOrder, createdAt e id (independiente del orden de inserción)', async () => {
    const h = admin();
    for (let i = 0; i < 8; i++) {
      await banners.createAdminBanner(h.client, { ...valid, code: `extra-${i}`, sortOrder: 50 });
      h.clock.advance(1000);
    }
    const list = await banners.listStoreBanners(h.client, null);
    expect(list.items).toHaveLength(10);
    expect(codes(list).slice(0, 3)).toEqual([
      'banner-favoritos',
      'banner-calientito',
      'banner-equipo',
    ]);
    // Mismo sortOrder: el más antiguo primero (createdAt, id), aunque se inserten en otro orden.
    expect(codes(list).slice(3)).toEqual([
      'banner-1',
      'banner-2',
      'banner-3',
      'banner-4',
      'banner-5',
      'banner-6',
      'banner-7',
    ]);
    h.store.banners.reverse();
    expect(codes(await banners.listStoreBanners(h.client, null))).toEqual(codes(list));
  });

  it('B18: lista vacía = 200 con items []; locale inválido = 400; BANNERS_BUSY determinista', async () => {
    const empty = createHarness('banners-empty');
    expect(await banners.listStoreBanners(empty.client, null)).toMatchObject({ items: [] });
    const h = createHarness();
    expect(await failure(banners.listStoreBanners(h.client, null, 'fr' as never))).toMatchObject({
      status: 400,
    });
    h.store.bannersBusy = 1;
    expect(await failure(banners.listStoreBanners(h.client, null))).toMatchObject({
      status: 503,
      code: 'BANNERS_BUSY',
    });
    expect((await banners.listStoreBanners(h.client, null)).items.length).toBeGreaterThan(0);
  });

  it('escenarios: promotion-expired y banner-promotion-expired ocultan los banners de promociones; banners-empty no tiene', async () => {
    for (const scenario of ['promotion-expired', 'banner-promotion-expired'] as const) {
      const h = createHarness(scenario);
      expect(await publicIds(h, 'sucursal-1')).toEqual([
        'banner-favoritos',
        'banner-calientito',
        'banner-equipo',
      ]);
    }
    const none = createHarness('banners-empty');
    none.asStaff('admin');
    expect((await banners.listAdminBanners(none.client)).total).toBe(0);
  });
});

describe('admin: lectura (GET /v1/admin/banners[/{id}])', () => {
  it('lista paginada en el orden de la tienda con estados derivados', async () => {
    const h = admin();
    const page = await banners.listAdminBanners(h.client);
    expect(page.total).toBe(8);
    expect(page.items.map((b) => [b.code, b.lifecycle, b.visibleNow])).toEqual([
      ['favoritos', 'PUBLISHED', true],
      ['happy-hour', 'PUBLISHED', false],
      ['calientito', 'PUBLISHED', true],
      ['equipo', 'PUBLISHED', true],
      ['fin-de-mes', 'PUBLISHED', true],
      ['navidad-en-rolls', 'SCHEDULED', false],
      ['semana-del-cliente', 'EXPIRED', false],
      ['bienvenida', 'INACTIVE', false],
    ]);
    expect(page.items[1]).toMatchObject({ hiddenReason: 'PROMOTION_NOT_LIVE', editable: true });
    expect(page.items[0]).toMatchObject({
      hasEnglish: true,
      version: 1,
      title: 'Los favoritos de los MONcheros',
    });
    expect((await banners.listAdminBanners(h.client, { pageSize: 3, page: 3 })).items).toHaveLength(
      2,
    );
  });

  it('filtros por estado derivado, sucursal y búsqueda (título en cualquier idioma o código, sin acentos)', async () => {
    const h = admin();
    const by = async (f: banners.AdminBannerFilters) =>
      (await banners.listAdminBanners(h.client, f)).items.map((b) => b.code);
    expect(await by({ lifecycle: 'SCHEDULED' })).toEqual(['navidad-en-rolls']);
    expect(await by({ lifecycle: 'EXPIRED' })).toEqual(['semana-del-cliente']);
    expect(await by({ lifecycle: 'INACTIVE' })).toEqual(['bienvenida']);
    expect(await by({ branchId: 'sucursal-3' })).not.toContain('fin-de-mes');
    expect(await by({ branchId: 'sucursal-2' })).toContain('fin-de-mes');
    expect(await by({ q: 'TE MERECES' })).toEqual(['calientito']);
    expect(await by({ q: 'christmas' })).toEqual(['navidad-en-rolls']);
    expect(await by({ q: 'fin-de' })).toEqual(['fin-de-mes']);
    expect(await by({ sort: 'priority', order: 'desc', pageSize: 2 })).toEqual([
      'bienvenida',
      'semana-del-cliente',
    ]);
    expect(await failure(banners.listAdminBanners(h.client, { branchId: 'zzz' }))).toMatchObject({
      status: 404,
      code: 'BRANCH_NOT_FOUND',
    });
    expect(await failure(banners.listAdminBanners(h.client, { pageSize: 101 }))).toMatchObject({
      status: 400,
    });
    expect(
      await failure(banners.listAdminBanners(h.client, { lifecycle: 'X' as never })),
    ).toMatchObject({ status: 400 });
  });

  it('detalle con ambas traducciones sin respaldo; 404 BANNER_NOT_FOUND', async () => {
    const h = admin();
    const d = await banners.getAdminBanner(h.client, 'banner-fin-de-mes');
    expect(d.translations.en).toBeNull();
    expect(d.translations.es.title).toBe('Fin de mes: bebidas');
    expect(d.branches.map((b) => b.id)).toEqual(['sucursal-1', 'sucursal-2']);
    expect(d.promotion).toEqual({
      id: 'fin-de-mes',
      name: 'Fin de mes: bebidas',
      lifecycle: 'RUNNING',
    });
    expect(await failure(banners.getAdminBanner(h.client, 'nada'))).toMatchObject({
      status: 404,
      code: 'BANNER_NOT_FOUND',
    });
  });

  it('401 sin sesión y 403 sin banners.read (cocina; el encargado por defecto)', async () => {
    const h = createHarness();
    expect((await failure(banners.listAdminBanners(h.client))).status).toBe(401);
    h.asStaff('kitchen');
    expect((await failure(banners.listAdminBanners(h.client))).status).toBe(403);
    h.asStaff('manager', 'u2');
    expect((await failure(banners.getAdminBanner(h.client, 'banner-favoritos'))).status).toBe(403);
  });
});

describe('admin: alta (POST /v1/admin/banners)', () => {
  it('crea con valores por defecto: version 1, activo, prioridad = último + 1 entre los no vencidos', async () => {
    const h = admin();
    const b = await banners.createAdminBanner(h.client, {
      ...valid,
      code: '  NUEVO-Banner ',
      translations: {
        es: { title: '  Nuevo  ', subtitle: '   ', imageAlt: 'Alt' },
        en: { title: '', subtitle: null },
      },
    });
    expect(b).toMatchObject({
      code: 'nuevo-banner',
      version: 1,
      active: true,
      // 0..5 y 7 no vencidos (el 6 venció): el último es 7 → 8.
      sortOrder: 8,
      title: 'Nuevo',
      lifecycle: 'PUBLISHED',
      editable: true,
      hasEnglish: false,
    });
    // En blanco = ausente; inglés vacío se ignora.
    expect(b.translations).toEqual({
      es: { title: 'Nuevo', subtitle: null, ctaLabel: null, imageAlt: 'Alt' },
      en: null,
    });
    expect((await banners.listAdminBanners(h.client)).total).toBe(9);
  });

  it('B4: endsAt <= startsAt = 422 BANNER_PERIOD_INVALID', async () => {
    const h = admin();
    const t = at('2026-12-01', '10:00');
    for (const endsAt of [t, at('2026-12-01', '09:59')]) {
      expect(
        await failure(banners.createAdminBanner(h.client, { ...valid, startsAt: t, endsAt })),
      ).toMatchObject({
        status: 422,
        code: 'BANNER_PERIOD_INVALID',
      });
    }
    expect(
      (
        await banners.createAdminBanner(h.client, {
          ...valid,
          startsAt: t,
          endsAt: at('2026-12-01', '10:00', 1),
        })
      ).version,
    ).toBe(1);
  });

  it('B20: imagen inexistente / PENDING / de producto = 422 BANNER_IMAGE_INVALID con violations', async () => {
    const h = admin();
    h.store.mediaAssets.find((a) => a.id === 'media-seed-banner-equipo')!.status = 'PENDING';
    const cases: [string, string][] = [
      ['no-existe', 'imageAssetId:ASSET_UNKNOWN'],
      ['media-seed-banner-equipo', 'imageAssetId:ASSET_NOT_READY'],
      ['media-seed-1', 'imageAssetId:ASSET_KIND_MISMATCH'],
    ];
    for (const [imageAssetId, violation] of cases) {
      expect(
        await failure(banners.createAdminBanner(h.client, { ...valid, imageAssetId })),
      ).toEqual({
        status: 422,
        code: 'BANNER_IMAGE_INVALID',
        violations: [violation],
      });
    }
  });

  it('B21: CTA coherente y de lista cerrada: CATEGORY con productId, PAGE fuera de la lista, destino inexistente o inactivo = 422; EXTERNAL = 400', async () => {
    const h = admin();
    const cta = async (c: unknown) =>
      failure(banners.createAdminBanner(h.client, { ...valid, cta: c as never }));
    expect(
      await cta({ type: 'CATEGORY', categoryId: 'cat-rolls', productId: 'calientito-roll' }),
    ).toMatchObject({
      status: 422,
      code: 'BANNER_CTA_INVALID',
    });
    expect(await cta({ type: 'CATEGORY' })).toMatchObject({
      status: 422,
      code: 'BANNER_CTA_INVALID',
    });
    expect(await cta({ type: 'PAGE', page: 'ADMIN' })).toMatchObject({
      status: 422,
      code: 'BANNER_CTA_INVALID',
    });
    expect(await cta({ type: 'MENU', page: 'CAREERS' })).toMatchObject({ status: 422 });
    expect(await cta({ type: 'PRODUCT', productId: 'nada' })).toMatchObject({
      status: 422,
      violations: ['cta.productId:TARGET_UNKNOWN'],
    });
    h.store.menuCategories.find((c) => c.id === 'cat-rolls')!.active = false;
    expect(await cta({ type: 'CATEGORY', categoryId: 'cat-rolls' })).toMatchObject({
      status: 422,
      violations: ['cta.categoryId:TARGET_INACTIVE'],
    });
    // `EXTERNAL` no existe en el enum => 400; no hay forma de guardar una ruta de texto libre.
    expect(await cta({ type: 'EXTERNAL', url: 'https://x.test' })).toMatchObject({ status: 400 });
    expect(await cta({ type: 'MENU', url: '/admin' })).toMatchObject({ status: 400 });
  });

  it('traducciones: es.title y es.imageAlt obligatorios, límites y caracteres de control = 422 BANNER_TRANSLATION_INVALID', async () => {
    const h = admin();
    const tr = async (es: object, en?: object) =>
      failure(
        banners.createAdminBanner(h.client, {
          ...valid,
          translations: { es, ...(en ? { en } : {}) } as never,
        }),
      );
    expect((await tr({ imageAlt: 'x' })).violations).toEqual(['translations.es.title:REQUIRED']);
    expect((await tr({ title: 'x', imageAlt: '   ' })).violations).toEqual([
      'translations.es.imageAlt:REQUIRED',
    ]);
    expect((await tr({ title: 'x'.repeat(81), imageAlt: 'x' })).violations).toEqual([
      'translations.es.title:TOO_LONG',
    ]);
    expect((await tr({ title: 'x', imageAlt: 'x'.repeat(201) })).violations).toEqual([
      'translations.es.imageAlt:TOO_LONG',
    ]);
    expect((await tr({ title: 'x', subtitle: 'y'.repeat(161), imageAlt: 'x' })).violations).toEqual(
      ['translations.es.subtitle:TOO_LONG'],
    );
    expect((await tr({ title: 'x', ctaLabel: 'y'.repeat(41), imageAlt: 'x' })).violations).toEqual([
      'translations.es.ctaLabel:TOO_LONG',
    ]);
    expect((await tr({ title: 'x‮', imageAlt: 'x' })).violations).toEqual([
      'translations.es.title:INVALID_CHARS',
    ]);
    expect((await tr({ title: 'x', imageAlt: 'x' }, { title: 'e'.repeat(81) })).violations).toEqual(
      ['translations.en.title:TOO_LONG'],
    );
    // Sin `translations.es` es forma (400).
    expect(
      await failure(banners.createAdminBanner(h.client, { ...valid, translations: {} as never })),
    ).toMatchObject({ status: 400 });
  });

  it('alcance de sucursales: SELECTED vacío o ALL con sucursales = 422 BANNER_SCOPE_INVALID; sucursal inexistente = 404', async () => {
    const h = admin();
    expect(
      await failure(banners.createAdminBanner(h.client, { ...valid, branchScope: 'SELECTED' })),
    ).toMatchObject({ status: 422, code: 'BANNER_SCOPE_INVALID' });
    expect(
      await failure(banners.createAdminBanner(h.client, { ...valid, branchIds: ['sucursal-1'] })),
    ).toMatchObject({ status: 422, code: 'BANNER_SCOPE_INVALID' });
    expect(
      await failure(
        banners.createAdminBanner(h.client, {
          ...valid,
          branchScope: 'SELECTED',
          branchIds: ['zzz'],
        }),
      ),
    ).toMatchObject({ status: 404, code: 'BRANCH_NOT_FOUND' });
  });

  it('promoción vinculada: inexistente o que no cubre el alcance = 422 BANNER_PROMOTION_INVALID; una inactiva o futura sí se puede vincular', async () => {
    const h = admin();
    expect(
      await failure(banners.createAdminBanner(h.client, { ...valid, promotionId: 'nada' })),
    ).toEqual({
      status: 422,
      code: 'BANNER_PROMOTION_INVALID',
      violations: ['promotionId:PROMOTION_UNKNOWN'],
    });
    // Banner ALL con promoción SELECTED, o SELECTED con sucursales que la promoción no cubre.
    expect(
      (await failure(banners.createAdminBanner(h.client, { ...valid, promotionId: 'fin-de-mes' })))
        .violations,
    ).toEqual(['promotionId:BRANCH_SCOPE_MISMATCH']);
    expect(
      (
        await failure(
          banners.createAdminBanner(h.client, {
            ...valid,
            branchScope: 'SELECTED',
            branchIds: ['sucursal-3'],
            promotionId: 'fin-de-mes',
          }),
        )
      ).violations,
    ).toEqual(['promotionId:BRANCH_SCOPE_MISMATCH']);
    const ok = await banners.createAdminBanner(h.client, {
      ...valid,
      branchScope: 'SELECTED',
      branchIds: ['sucursal-1'],
      promotionId: 'fin-de-mes',
    });
    expect(ok.promotion?.id).toBe('fin-de-mes');
    const future = await banners.createAdminBanner(h.client, {
      ...valid,
      code: 'futura',
      promotionId: 'navidad-rolls',
    });
    expect(future).toMatchObject({ visibleNow: false, hiddenReason: 'PROMOTION_NOT_LIVE' });
    // El cupón se puede vincular, pero el resumen nunca lleva su código.
    const coupon = await banners.createAdminBanner(h.client, {
      ...valid,
      code: 'cupon',
      promotionId: 'bienvenida',
    });
    expect(JSON.stringify(coupon)).not.toMatch(/BIENVENIDO10/);
  });

  it('409 BANNER_CODE_TAKEN; formas (400): código fuera de formato, claves desconocidas, prioridad fuera de rango', async () => {
    const h = admin();
    expect(
      await failure(banners.createAdminBanner(h.client, { ...valid, code: 'FAVORITOS' })),
    ).toMatchObject({ status: 409, code: 'BANNER_CODE_TAKEN', violations: ['code:CODE_TAKEN'] });
    for (const code of ['ab', '-abc', 'a b c', 'x'.repeat(66)]) {
      expect((await failure(banners.createAdminBanner(h.client, { ...valid, code }))).status).toBe(
        400,
      );
    }
    expect(
      (await failure(banners.createAdminBanner(h.client, { ...valid, extra: 1 } as never))).status,
    ).toBe(400);
    expect(
      (await failure(banners.createAdminBanner(h.client, { ...valid, sortOrder: 10_000 }))).status,
    ).toBe(400);
    expect(
      (
        await failure(
          banners.createAdminBanner(h.client, { ...valid, startsAt: '2026-12-01T10:00' }),
        )
      ).status,
    ).toBe(400);
  });

  it('tope de 100 banners no vencidos = 422 BANNER_LIMIT_REACHED (los vencidos no cuentan)', async () => {
    const h = admin();
    // 7 no vencidos + 1 vencido sembrados: se completan hasta 100.
    for (let i = 0; i < 93; i++) {
      h.store.banners.push({
        ...structuredClone(h.store.banners[0]!),
        id: `b-${i}`,
        code: `relleno-${i}`,
      });
    }
    expect(await failure(banners.createAdminBanner(h.client, valid))).toMatchObject({
      status: 422,
      code: 'BANNER_LIMIT_REACHED',
    });
    // Uno vencido y la alta pasa.
    h.store.banners.find((b) => b.id === 'b-0')!.endsAt = at('2026-11-01', '00:00');
    expect((await banners.createAdminBanner(h.client, valid)).code).toBe('nuevo-banner');
    // Un banner ya vencido se crea aunque haya 100 no vencidos.
    expect(
      (
        await banners.createAdminBanner(h.client, {
          ...valid,
          code: 'vencido',
          startsAt: at('2026-10-01', '00:00'),
          endsAt: at('2026-10-02', '00:00'),
        })
      ).lifecycle,
    ).toBe('EXPIRED');
  });

  it('503 BANNERS_BUSY determinista y luego funciona', async () => {
    const h = admin();
    h.store.bannersBusy = 1;
    expect(await failure(banners.createAdminBanner(h.client, valid))).toMatchObject({
      status: 503,
      code: 'BANNERS_BUSY',
    });
    expect((await banners.createAdminBanner(h.client, valid)).version).toBe(1);
  });
});

describe('caracteres invisibles y motivo del estado', () => {
  it('título o alt solo de invisibles = obligatorio; invisibles dentro de un texto = 422 INVALID_CHARS; un opcional solo de invisibles queda ausente', async () => {
    const h = admin();
    const tr = (es: object) =>
      failure(banners.createAdminBanner(h.client, { ...valid, translations: { es } as never }));
    expect((await tr({ title: '\u200b\u2060', imageAlt: 'x' })).violations).toEqual([
      'translations.es.title:REQUIRED',
    ]);
    expect((await tr({ title: 'x', imageAlt: '\ufeff' })).violations).toEqual([
      'translations.es.imageAlt:REQUIRED',
    ]);
    expect((await tr({ title: 'a\u200bb', imageAlt: 'x' })).violations).toEqual([
      'translations.es.title:INVALID_CHARS',
    ]);
    expect((await tr({ title: 'x', imageAlt: 'a\u00adb' })).violations).toEqual([
      'translations.es.imageAlt:INVALID_CHARS',
    ]);
    const ok = await banners.createAdminBanner(h.client, {
      ...valid,
      translations: { es: { title: 'x', subtitle: '\u200b', imageAlt: 'y' } },
    });
    expect(ok.translations.es.subtitle).toBeNull();
  });

  it('`reason` con NUL, bidi o invisibles = 400; limpio pasa', async () => {
    const h = admin();
    for (const reason of ['a\u0000b', 'a\u202eb', 'a\u200bb']) {
      expect(
        (
          await failure(
            banners.updateAdminBannerStatus(h.client, 'banner-favoritos', {
              active: false,
              reason,
            }),
          )
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await banners.updateAdminBannerStatus(h.client, 'banner-favoritos', {
          active: false,
          reason: 'inventario',
        })
      ).active,
    ).toBe(false);
  });
});

describe('admin: edición (PATCH) y estado', () => {
  it('parcial: lo omitido NO se reemplaza; sube version; B19 expectedVersion obsoleto = 409 sin guardar', async () => {
    const h = admin();
    const before = await banners.getAdminBanner(h.client, 'banner-favoritos');
    const after = await banners.updateAdminBanner(h.client, 'banner-favoritos', {
      expectedVersion: 1,
      translations: { es: { title: 'Nuevo título' } },
    });
    expect(after.version).toBe(2);
    expect(after.translations.es).toEqual({ ...before.translations.es, title: 'Nuevo título' });
    expect(after.translations.en).toEqual(before.translations.en);
    expect(after).toMatchObject({
      cta: before.cta,
      branchScope: 'ALL',
      sortOrder: before.sortOrder,
      image: before.image,
    });
    expect(
      await failure(
        banners.updateAdminBanner(h.client, 'banner-favoritos', {
          expectedVersion: 1,
          translations: { es: { title: 'Otro' } },
        }),
      ),
    ).toMatchObject({ status: 409, code: 'BANNER_VERSION_CONFLICT' });
    expect((await banners.getAdminBanner(h.client, 'banner-favoritos')).translations.es.title).toBe(
      'Nuevo título',
    );
  });

  it('sin cambios reales = 200 sin subir version ni escribir', async () => {
    const h = admin();
    const same = await banners.updateAdminBanner(h.client, 'banner-favoritos', {
      expectedVersion: 1,
      translations: { es: { title: 'Los favoritos de los MONcheros' } },
      sortOrder: 0,
      startsAt: null,
    });
    expect(same.version).toBe(1);
    expect(same.updatedAt).toBe('2026-10-20T18:00:00.000Z');
  });

  it('textos por idioma y campo: null borra un opcional; en:null elimina el inglés; es.title no puede quedar vacío', async () => {
    const h = admin();
    const a = await banners.updateAdminBanner(h.client, 'banner-favoritos', {
      expectedVersion: 1,
      translations: { es: { subtitle: null }, en: { ctaLabel: null } },
    });
    expect(a.translations.es.subtitle).toBeNull();
    expect(a.translations.en?.ctaLabel).toBeNull();
    expect(a.translations.en?.title).toBe("MONcheros' favorites");
    const b = await banners.updateAdminBanner(h.client, 'banner-favoritos', {
      expectedVersion: 2,
      translations: { en: null },
    });
    expect(b.translations.en).toBeNull();
    expect(b.hasEnglish).toBe(false);
    expect(
      await failure(
        banners.updateAdminBanner(h.client, 'banner-favoritos', {
          expectedVersion: 3,
          translations: { es: { title: '  ' } },
        }),
      ),
    ).toMatchObject({
      status: 422,
      code: 'BANNER_TRANSLATION_INVALID',
      violations: ['translations.es.title:REQUIRED'],
    });
    expect(
      await failure(
        banners.updateAdminBanner(h.client, 'banner-favoritos', {
          expectedVersion: 3,
          translations: { es: { imageAlt: null } },
        }),
      ),
    ).toMatchObject({ status: 422, code: 'BANNER_TRANSLATION_INVALID' });
  });

  it('bloques completos: cta, sucursales (reemplaza todas), promoción (null desvincula), fechas (null = sin extremo) e imagen', async () => {
    const h = admin();
    let b: AdminBanner = await banners.updateAdminBanner(h.client, 'banner-favoritos', {
      expectedVersion: 1,
      cta: { type: 'PAGE', page: 'INCIDENTS' },
      imageAssetId: 'media-seed-banner-equipo',
    });
    expect(b.cta).toMatchObject({ type: 'PAGE', page: 'INCIDENTS', categoryId: null });
    expect(b.image.assetId).toBe('media-seed-banner-equipo');
    b = await banners.updateAdminBanner(h.client, b.id, {
      expectedVersion: b.version,
      branchScope: 'SELECTED',
      branchIds: ['sucursal-2', 'sucursal-3'],
    });
    expect(b.branches.map((x) => x.id)).toEqual(['sucursal-2', 'sucursal-3']);
    b = await banners.updateAdminBanner(h.client, b.id, {
      expectedVersion: b.version,
      branchScope: 'ALL',
    });
    expect(b.branches).toEqual([]);
    b = await banners.updateAdminBanner(h.client, 'banner-fin-de-mes', {
      expectedVersion: 1,
      promotionId: null,
      startsAt: at('2026-11-05', '00:00'),
      endsAt: at('2026-12-05', '00:00'),
    });
    expect(b.promotion).toBeNull();
    b = await banners.updateAdminBanner(h.client, b.id, {
      expectedVersion: b.version,
      endsAt: null,
    });
    expect(b.endsAt).toBeNull();
    // Reglas del alta sobre el estado RESULTANTE: periodo inválido con solo `endsAt`.
    expect(
      await failure(
        banners.updateAdminBanner(h.client, b.id, {
          expectedVersion: b.version,
          endsAt: at('2026-11-01', '00:00'),
        }),
      ),
    ).toMatchObject({ status: 422, code: 'BANNER_PERIOD_INVALID' });
    // Una promoción de otras sucursales no cubre un banner de todas.
    expect(
      await failure(
        banners.updateAdminBanner(h.client, 'banner-favoritos', {
          expectedVersion: (await banners.getAdminBanner(h.client, 'banner-favoritos')).version,
          promotionId: 'fin-de-mes',
        }),
      ),
    ).toMatchObject({ status: 422, code: 'BANNER_PROMOTION_INVALID' });
  });

  it('code y active no se aceptan en el PATCH (400); expectedVersion es obligatorio; PATCH vacío = 400; inexistente = 404', async () => {
    const h = admin();
    for (const body of [
      { expectedVersion: 1, code: 'otro' },
      { expectedVersion: 1, active: false },
      { sortOrder: 3 },
      { expectedVersion: 1 },
    ]) {
      expect(
        (await failure(banners.updateAdminBanner(h.client, 'banner-favoritos', body as never)))
          .status,
      ).toBe(400);
    }
    expect(
      (
        await failure(
          banners.updateAdminBanner(h.client, 'nada', { expectedVersion: 1, sortOrder: 1 }),
        )
      ).code,
    ).toBe('BANNER_NOT_FOUND');
  });

  it('estado idempotente y sin expectedVersion: un cambio real sube version; repetirlo no', async () => {
    const h = admin();
    const off = await banners.updateAdminBannerStatus(h.client, 'banner-favoritos', {
      active: false,
      reason: 'prueba',
    });
    expect(off).toMatchObject({ active: false, lifecycle: 'INACTIVE', version: 2 });
    const again = await banners.updateAdminBannerStatus(h.client, 'banner-favoritos', {
      active: false,
    });
    expect(again.version).toBe(2);
    expect(await publicIds(h)).not.toContain('banner-favoritos');
    const on = await banners.updateAdminBannerStatus(h.client, 'banner-favoritos', {
      active: true,
    });
    expect(on).toMatchObject({ active: true, version: 3, lifecycle: 'PUBLISHED' });
    expect(
      (
        await failure(
          banners.updateAdminBannerStatus(h.client, 'banner-favoritos', { active: 'si' as never }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await failure(
          banners.updateAdminBannerStatus(h.client, 'banner-favoritos', {
            active: true,
            code: 'x',
          } as never),
        )
      ).status,
    ).toBe(400);
  });
});

describe('admin: reordenado atómico (PUT /v1/admin/banners/order)', () => {
  const nonExpired = [
    'banner-favoritos',
    'banner-happy-hour',
    'banner-calientito',
    'banner-equipo',
    'banner-fin-de-mes',
    'banner-navidad',
    'banner-bienvenida',
  ];

  it('asigna 0..n-1, sube version SOLO de los que cambian y el público lo refleja', async () => {
    const h = admin();
    const next = [...nonExpired];
    [next[0], next[2]] = [next[2]!, next[0]!];
    const result = await banners.reorderAdminBanners(h.client, next);
    expect(result.items.map((i) => [i.id, i.sortOrder, i.version])).toEqual([
      ['banner-calientito', 0, 2],
      ['banner-happy-hour', 1, 1],
      ['banner-favoritos', 2, 2],
      ['banner-equipo', 3, 1],
      ['banner-fin-de-mes', 4, 1],
      ['banner-navidad', 5, 1],
      ['banner-bienvenida', 6, 2],
    ]);
    expect(await publicIds(h)).toEqual(['banner-calientito', 'banner-favoritos', 'banner-equipo']);
    // Los vencidos conservan su sortOrder.
    expect(h.store.banners.find((b) => b.id === 'banner-semana-cliente')!.sortOrder).toBe(6);
  });

  it('idempotente: repetir el mismo orden no escribe ni sube versiones', async () => {
    const h = admin();
    await banners.reorderAdminBanners(h.client, [...nonExpired].reverse());
    const snapshot = JSON.stringify(h.store.banners);
    await banners.reorderAdminBanners(h.client, [...nonExpired].reverse());
    expect(JSON.stringify(h.store.banners)).toBe(snapshot);
  });

  it('422 BANNER_REORDER_MISMATCH sin escribir: faltante, ajeno, repetido o con un vencido', async () => {
    const h = admin();
    const snapshot = JSON.stringify(h.store.banners);
    const bad = [
      nonExpired.slice(1),
      [...nonExpired, 'no-existe'],
      [...nonExpired.slice(1), nonExpired[1]!],
      [...nonExpired, 'banner-semana-cliente'],
    ];
    for (const ids of bad) {
      expect(await failure(banners.reorderAdminBanners(h.client, ids))).toMatchObject({
        status: 422,
        code: 'BANNER_REORDER_MISMATCH',
      });
    }
    expect(JSON.stringify(h.store.banners)).toBe(snapshot);
    expect((await failure(banners.reorderAdminBanners(h.client, 'x' as never))).status).toBe(400);
  });

  it('B19: tras reordenar, un editor con la versión anterior recibe 409', async () => {
    const h = admin();
    await banners.reorderAdminBanners(h.client, [...nonExpired].reverse());
    expect(
      await failure(
        banners.updateAdminBanner(h.client, 'banner-favoritos', {
          expectedVersion: 1,
          sortOrder: 3,
        }),
      ),
    ).toMatchObject({ status: 409, code: 'BANNER_VERSION_CONFLICT' });
  });

  it('un error de lock (BANNERS_BUSY) no deja el orden a medias', async () => {
    const h = admin();
    h.store.bannersBusy = 1;
    const snapshot = JSON.stringify(h.store.banners);
    expect(
      await failure(banners.reorderAdminBanners(h.client, [...nonExpired].reverse())),
    ).toMatchObject({ status: 503, code: 'BANNERS_BUSY' });
    expect(JSON.stringify(h.store.banners)).toBe(snapshot);
  });
});

describe('B22: alcance acotado (encargado de la sucursal 1 con banners.*)', () => {
  it('lectura: solo los que aplican a su sucursal (incluidos los ALL), branches recortado y editable=false si no cubre todas', async () => {
    const h = scopedManager();
    const page = await banners.listAdminBanners(h.client);
    expect(page.items.map((b) => b.code)).toContain('fin-de-mes');
    const fin = page.items.find((b) => b.code === 'fin-de-mes')!;
    expect(fin.branches.map((b) => b.id)).toEqual(['sucursal-1']);
    expect(fin.editable).toBe(false);
    expect(page.items.find((b) => b.code === 'favoritos')!.editable).toBe(false);
    // Un banner de otra sucursal no se ve ni se puede pedir (404, sin distinguir).
    const admin_ = createHarness();
    admin_.asStaff('admin');
    const other = await banners.createAdminBanner(admin_.client, {
      ...valid,
      branchScope: 'SELECTED',
      branchIds: ['sucursal-3'],
    });
    h.store.banners.push(admin_.store.banners.find((b) => b.id === other.id)!);
    expect(page.items.map((b) => b.id)).not.toContain(other.id);
    expect(await failure(banners.getAdminBanner(h.client, other.id))).toMatchObject({
      status: 404,
      code: 'BANNER_NOT_FOUND',
    });
    expect(
      await failure(banners.listAdminBanners(h.client, { branchId: 'sucursal-3' })),
    ).toMatchObject({ status: 404, code: 'BRANCH_NOT_FOUND' });
  });

  it('escritura: ALL = 403 BANNER_SCOPE_FORBIDDEN; SELECTED con sucursal ajena = 404; su sucursal sí; parcial = 403; reordenar = 403', async () => {
    const h = scopedManager();
    expect(await failure(banners.createAdminBanner(h.client, valid))).toMatchObject({
      status: 403,
      code: 'BANNER_SCOPE_FORBIDDEN',
    });
    expect(
      await failure(
        banners.createAdminBanner(h.client, {
          ...valid,
          branchScope: 'SELECTED',
          branchIds: ['sucursal-1', 'sucursal-2'],
        }),
      ),
    ).toMatchObject({ status: 404, code: 'BRANCH_NOT_FOUND' });
    const mine = await banners.createAdminBanner(h.client, {
      ...valid,
      branchScope: 'SELECTED',
      branchIds: ['sucursal-1'],
    });
    expect(mine.editable).toBe(true);
    // Cubre solo una de las dos sucursales de «fin de mes»: lo toca pero no lo cubre entero.
    expect(
      await failure(
        banners.updateAdminBanner(h.client, 'banner-fin-de-mes', {
          expectedVersion: 1,
          sortOrder: 9,
        }),
      ),
    ).toMatchObject({ status: 403, code: 'BANNER_SCOPE_FORBIDDEN' });
    expect(
      await failure(
        banners.updateAdminBannerStatus(h.client, 'banner-fin-de-mes', { active: false }),
      ),
    ).toMatchObject({ status: 403, code: 'BANNER_SCOPE_FORBIDDEN' });
    expect(
      await failure(
        banners.updateAdminBanner(h.client, mine.id, { expectedVersion: 1, branchScope: 'ALL' }),
      ),
    ).toMatchObject({ status: 403, code: 'BANNER_SCOPE_FORBIDDEN' });
    expect(await failure(banners.reorderAdminBanners(h.client, []))).toMatchObject({
      status: 403,
      code: 'BANNER_SCOPE_FORBIDDEN',
    });
  });
});

describe('integración con medios (F14): BANNER_IMAGE', () => {
  it('adjuntar un asset BANNER_IMAGE a un producto = 422 con ASSET_KIND_MISMATCH (y al revés, BANNER_IMAGE_INVALID)', async () => {
    const h = admin();
    expect(
      await failure(
        media.attachProductMedia(h.client, 'dumplings', { assetId: 'media-seed-banner-favoritos' }),
      ),
    ).toEqual({
      status: 422,
      code: 'PRODUCT_MEDIA_INVALID',
      violations: ['assetId:ASSET_KIND_MISMATCH'],
    });
    expect(
      (
        await failure(
          banners.createAdminBanner(h.client, { ...valid, imageAssetId: 'media-seed-2' }),
        )
      ).violations,
    ).toEqual(['imageAssetId:ASSET_KIND_MISMATCH']);
  });

  const hex = (n: number) => n.toString(16).padStart(64, '0');
  const intent = (
    n: number,
    extra: Partial<Parameters<typeof media.createMediaUploadIntent>[1]> = {},
  ) => ({
    kind: 'BANNER_IMAGE' as const,
    mimeType: 'image/webp',
    sizeBytes: 1000 + n,
    checksumSha256: hex(n),
    ...extra,
  });

  it('el intent usa el prefijo banners/, admite hasta 1 MiB y rechaza más con MEDIA_TOO_LARGE', async () => {
    const h = admin();
    const ok = await media.createMediaUploadIntent(h.client, intent(1, { sizeBytes: 1024 * 1024 }));
    expect(ok.asset.kind).toBe('BANNER_IMAGE');
    expect(h.store.mediaAssets.find((a) => a.id === ok.assetId)?.objectKey).toMatch(
      /^banners\/2026\/.+\.webp$/,
    );
    expect(
      await failure(
        media.createMediaUploadIntent(h.client, intent(2, { sizeBytes: 1024 * 1024 + 1 })),
      ),
    ).toMatchObject({ status: 422, code: 'MEDIA_TOO_LARGE' });
    // Un producto sigue admitiendo hasta 5 MiB.
    expect(
      (
        await media.createMediaUploadIntent(
          h.client,
          intent(3, { kind: 'PRODUCT_IMAGE', sizeBytes: 5 * 1024 * 1024 }),
        )
      ).asset.kind,
    ).toBe('PRODUCT_IMAGE');
    expect(
      await failure(
        media.createMediaUploadIntent(h.client, intent(4, { kind: 'AVATAR' as never })),
      ),
    ).toMatchObject({ status: 400 });
  });

  it('dedup por (kind, checksum): la misma imagen puede existir como producto y como banner', async () => {
    const h = admin();
    const seed = h.store.mediaAssets.find((a) => a.id === 'media-seed-banner-favoritos')!;
    const dup = await media.createMediaUploadIntent(
      h.client,
      intent(0, { checksumSha256: seed.checksumSha256 }),
    );
    expect(dup).toMatchObject({ deduplicated: true, assetId: seed.id });
    const asProduct = await media.createMediaUploadIntent(
      h.client,
      intent(0, { kind: 'PRODUCT_IMAGE', checksumSha256: seed.checksumSha256 }),
    );
    expect(asProduct.deduplicated).toBe(false);
  });

  it('la biblioteca filtra por kind; usageCount y bannerUsages cuentan banners; un asset en uso no se borra (409 MEDIA_IN_USE)', async () => {
    const h = admin();
    const lib = await media.listMedia(h.client, { kind: 'BANNER_IMAGE', status: 'READY' });
    expect(lib.total).toBe(8);
    expect((await media.listMedia(h.client)).total).toBe(3);
    const detail = await media.getMedia(h.client, 'media-seed-banner-favoritos');
    expect(detail.usageCount).toBe(1);
    expect(detail.bannerUsages).toEqual([
      { bannerId: 'banner-favoritos', bannerCode: 'favoritos' },
    ]);
    expect(await failure(media.deleteMedia(h.client, 'media-seed-banner-favoritos'))).toMatchObject(
      { status: 409, code: 'MEDIA_IN_USE' },
    );
    expect(
      (await media.listMedia(h.client, { kind: 'BANNER_IMAGE', unreferenced: true })).total,
    ).toBe(0);
    // Reemplazar la imagen NO borra el asset anterior: queda sin referencias.
    await banners.updateAdminBanner(h.client, 'banner-favoritos', {
      expectedVersion: 1,
      imageAssetId: 'media-seed-banner-equipo',
    });
    expect((await media.getMedia(h.client, 'media-seed-banner-favoritos')).usageCount).toBe(0);
    await media.deleteMedia(h.client, 'media-seed-banner-favoritos');
  });
});
