import { Logger } from '@nestjs/common';
import {
  assetid,
  bnid,
  catid,
  prodid,
  text,
  uniqueCodeError,
} from '../../test/support/fake-banners-repo.js';
import {
  A,
  B,
  bannersHarness,
  C,
  INACTIVE_BRANCH,
  local,
  MISSING_BRANCH,
  NOW,
} from '../../test/support/banners-harness.js';
import { globalStaff, scopedStaff } from '../../test/support/staff-context.js';
import type { CreateBannerRequest } from './dto/banner-requests.dto.js';

const ALL = ['banners.read', 'banners.create', 'banners.update'];
const admin = () => globalStaff(ALL);
const scoped = (...branches: string[]) => scopedStaff(ALL, branches);

const info = (e: unknown) => {
  const x = e as { getStatus?: () => number; getResponse?: () => unknown };
  const body = (x.getResponse?.() ?? {}) as {
    code?: string;
    violations?: { path: string; code: string }[];
  };
  return { status: x.getStatus?.(), code: body.code, violations: body.violations };
};
const failure = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => info(e),
  );

const validCreate = (over: Partial<CreateBannerRequest> = {}): CreateBannerRequest => ({
  code: 'Verano-2026',
  imageAssetId: assetid(1),
  translations: { es: { title: 'Verano', imageAlt: 'Roll de salmón' } },
  cta: { type: 'MENU' },
  branchScope: 'ALL',
  ...over,
});

const SEC = 1000;
const at = (ms: number) => new Date(NOW.getTime() + ms);

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

describe('create', () => {
  it('crea un banner válido: version 1, código normalizado, prioridad = último + 1, auditado en la misma transacción', async () => {
    const h = bannersHarness();
    h.repo.seed({ sortOrder: 4 });
    const out = await h.admin.create(admin(), validCreate());
    expect(out).toMatchObject({
      code: 'verano-2026',
      title: 'Verano',
      active: true,
      version: 1,
      sortOrder: 5,
      lifecycle: 'PUBLISHED',
      visibleNow: true,
      hiddenReason: null,
      branchScope: 'ALL',
      branches: [],
      promotion: null,
      hasEnglish: false,
      editable: true,
      startsAt: null,
      endsAt: null,
      image: { assetId: assetid(1), mimeType: 'image/webp', sizeBytes: 200_000 },
      cta: { type: 'MENU', categoryId: null, productId: null, page: null },
      translations: {
        es: { title: 'Verano', subtitle: null, ctaLabel: null, imageAlt: 'Roll de salmón' },
        en: null,
      },
    });
    expect(out.image.url).toBe(`https://media.mock.invalid/banners/2026/${assetid(1)}.webp`);
    expect(h.repo.audit).toHaveLength(1);
    expect(h.repo.audit[0]).toMatchObject({
      action: 'banner.created',
      entityType: 'banner',
      entityId: out.id,
      branchId: null,
      actorId: '99999999-9999-4999-8999-999999999999',
    });
    expect(h.repo.audit[0]?.['newValues']).toMatchObject({
      code: 'verano-2026',
      imageAssetId: assetid(1),
      ctaType: 'MENU',
      branchScope: 'ALL',
      sortOrder: 5,
      active: true,
      titleEs: 'Verano',
    });
  });

  it('el primer banner recibe prioridad 0; sortOrder explícito se respeta y puede repetirse', async () => {
    const h = bannersHarness();
    expect((await h.admin.create(admin(), validCreate({ code: 'uno-uno' }))).sortOrder).toBe(0);
    const a = await h.admin.create(admin(), validCreate({ code: 'dos-dos', sortOrder: 7 }));
    const b = await h.admin.create(admin(), validCreate({ code: 'tres-tres', sortOrder: 7 }));
    expect([a.sortOrder, b.sortOrder]).toEqual([7, 7]);
  });

  it('active=false se respeta; lifecycle INACTIVE y no visible', async () => {
    const h = bannersHarness();
    const out = await h.admin.create(admin(), validCreate({ active: false }));
    expect(out).toMatchObject({ active: false, lifecycle: 'INACTIVE', visibleNow: false });
  });

  it('textos: recorta, en blanco = ausente y en vacía se ignora', async () => {
    const h = bannersHarness();
    const out = await h.admin.create(
      admin(),
      validCreate({
        translations: {
          es: { title: '  Verano  ', subtitle: '   ', ctaLabel: ' Pedir ', imageAlt: 'Alt' },
          en: { title: '  ', subtitle: null },
        },
      }),
    );
    expect(out.translations).toEqual({
      es: { title: 'Verano', subtitle: null, ctaLabel: 'Pedir', imageAlt: 'Alt' },
      en: null,
    });
    expect(out.hasEnglish).toBe(false);
  });

  it('con inglés con título: hasEnglish', async () => {
    const h = bannersHarness();
    const out = await h.admin.create(
      admin(),
      validCreate({
        translations: {
          es: { title: 'Verano', imageAlt: 'Alt' },
          en: { title: 'Summer', imageAlt: 'Alt en' },
        },
      }),
    );
    expect(out.hasEnglish).toBe(true);
    expect(out.translations.en).toMatchObject({ title: 'Summer', imageAlt: 'Alt en' });
  });

  it.each([
    ['título en blanco', { es: { title: '   ', imageAlt: 'A' } }, 'translations.es.title'],
    ['título ausente', { es: { imageAlt: 'A' } }, 'translations.es.title'],
    ['alt ausente', { es: { title: 'T' } }, 'translations.es.imageAlt'],
    ['alt en blanco', { es: { title: 'T', imageAlt: ' ' } }, 'translations.es.imageAlt'],
  ])(
    'traducción es incompleta (%s) => 422 BANNER_TRANSLATION_INVALID',
    async (_n, translations, path) => {
      const h = bannersHarness();
      const r = await failure(h.admin.create(admin(), validCreate({ translations })));
      expect(r).toMatchObject({ status: 422, code: 'BANNER_TRANSLATION_INVALID' });
      expect(r?.violations?.map((v) => v.path)).toContain(path);
      expect(h.repo.banners.size).toBe(0);
      expect(h.repo.audit).toHaveLength(0);
    },
  );

  it('texto con NUL o control bidireccional => 400', async () => {
    const h = bannersHarness();
    for (const title of ['a\u0000b', 'a‮b'])
      expect(
        await failure(
          h.admin.create(admin(), validCreate({ translations: { es: { title, imageAlt: 'A' } } })),
        ),
      ).toMatchObject({ status: 400 });
  });

  it('código duplicado => 409 BANNER_CODE_TAKEN sin auditar; también si la BD lo detecta (P2002)', async () => {
    const h = bannersHarness();
    await h.admin.create(admin(), validCreate());
    expect(
      await failure(h.admin.create(admin(), validCreate({ code: 'VERANO-2026' }))),
    ).toMatchObject({
      status: 409,
      code: 'BANNER_CODE_TAKEN',
    });
    expect(h.repo.audit).toHaveLength(1);
    expect(h.repo.banners.size).toBe(1);
    h.repo.createBanner = () => Promise.reject(uniqueCodeError());
    expect(
      await failure(h.admin.create(admin(), validCreate({ code: 'otro-otro' }))),
    ).toMatchObject({
      status: 409,
      code: 'BANNER_CODE_TAKEN',
    });
  });

  it('un P2002 de OTRA restricción no se disfraza de código duplicado (500)', async () => {
    const h = bannersHarness();
    h.repo.createBanner = () =>
      Promise.reject(
        Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
          meta: { target: ['banner_branches_pkey'] },
        }),
      );
    const r = await failure(h.admin.create(admin(), validCreate()));
    expect(r?.status).toBeUndefined();
  });

  describe('periodo (B4)', () => {
    it.each([
      ['fin = inicio', '2026-12-01T00:00:00-06:00', '2026-12-01T00:00:00-06:00'],
      ['fin < inicio', '2026-12-02T00:00:00-06:00', '2026-12-01T00:00:00-06:00'],
    ])('%s => 422 BANNER_PERIOD_INVALID', async (_n, startsAt, endsAt) => {
      const h = bannersHarness();
      expect(
        await failure(h.admin.create(admin(), validCreate({ startsAt, endsAt }))),
      ).toMatchObject({
        status: 422,
        code: 'BANNER_PERIOD_INVALID',
      });
    });
    it('instante sin zona o inexistente => 400; extremos nulos permitidos', async () => {
      const h = bannersHarness();
      for (const startsAt of ['2026-12-01T00:00:00', '2026-02-31T00:00:00Z'])
        expect(await failure(h.admin.create(admin(), validCreate({ startsAt })))).toMatchObject({
          status: 400,
        });
      const ok = await h.admin.create(
        admin(),
        validCreate({ startsAt: null, endsAt: '2026-12-01T00:00:00-06:00' }),
      );
      expect(ok.startsAt).toBeNull();
      expect(ok.endsAt).toBe('2026-12-01T06:00:00.000Z');
    });
    it('programado y vencido se derivan con el reloj del servidor', async () => {
      const h = bannersHarness();
      const sched = await h.admin.create(
        admin(),
        validCreate({ code: 'prog-prog', startsAt: at(3600 * SEC).toISOString() }),
      );
      const exp = await h.admin.create(
        admin(),
        validCreate({ code: 'venc-venc', endsAt: at(-SEC).toISOString() }),
      );
      expect(sched).toMatchObject({ lifecycle: 'SCHEDULED', visibleNow: false });
      expect(exp).toMatchObject({ lifecycle: 'EXPIRED', visibleNow: false });
    });
  });

  describe('imagen (B20)', () => {
    it.each([
      ['inexistente', () => assetid(99), 'ASSET_UNKNOWN'],
      ['PENDING', () => assetid(2), 'ASSET_NOT_READY'],
      ['de otro tipo (PRODUCT_IMAGE)', () => assetid(3), 'ASSET_KIND_MISMATCH'],
    ])('%s => 422 BANNER_IMAGE_INVALID (%s)', async (_n, pick, reason) => {
      const h = bannersHarness();
      h.repo.seedAsset(2, { status: 'PENDING' });
      h.repo.seedAsset(3, { kind: 'PRODUCT_IMAGE', objectKey: 'products/2026/x.png' });
      const r = await failure(h.admin.create(admin(), validCreate({ imageAssetId: pick() })));
      expect(r).toMatchObject({
        status: 422,
        code: 'BANNER_IMAGE_INVALID',
        violations: [{ path: 'imageAssetId', code: reason }],
      });
      expect(h.repo.banners.size).toBe(0);
      expect(h.repo.audit).toHaveLength(0);
    });
  });

  describe('CTA estructurado (B21)', () => {
    it('CATEGORY y PRODUCT activos son válidos y muestran su destino', async () => {
      const h = bannersHarness();
      h.repo.seedCategory(1, { name: 'Rolls' });
      h.repo.seedProduct(1, { name: 'California' });
      const c = await h.admin.create(
        admin(),
        validCreate({ code: 'cat-cat', cta: { type: 'CATEGORY', categoryId: catid(1) } }),
      );
      const p = await h.admin.create(
        admin(),
        validCreate({ code: 'prod-prod', cta: { type: 'PRODUCT', productId: prodid(1) } }),
      );
      expect(c.cta).toMatchObject({ type: 'CATEGORY', targetLabel: 'Rolls', targetActive: true });
      expect(p.cta).toMatchObject({
        type: 'PRODUCT',
        targetLabel: 'California',
        targetActive: true,
      });
    });

    it('CATEGORY con productId => 422 BANNER_CTA_INVALID (FIELD_MISMATCH)', async () => {
      const h = bannersHarness();
      h.repo.seedCategory(1);
      expect(
        await failure(
          h.admin.create(
            admin(),
            validCreate({ cta: { type: 'CATEGORY', categoryId: catid(1), productId: prodid(1) } }),
          ),
        ),
      ).toMatchObject({
        status: 422,
        code: 'BANNER_CTA_INVALID',
        violations: [{ path: 'cta.productId', code: 'FIELD_MISMATCH' }],
      });
    });

    it.each([
      'javascript:alert(1)',
      'data:text/html;base64,AAAA',
      '//evil.example',
      '/menu?x=1',
      'https://x.com',
    ])('PAGE con %j (fuera de la lista blanca) => 422 TARGET_UNKNOWN', async (page) => {
      const h = bannersHarness();
      expect(
        await failure(h.admin.create(admin(), validCreate({ cta: { type: 'PAGE', page } }))),
      ).toMatchObject({
        status: 422,
        code: 'BANNER_CTA_INVALID',
        violations: [{ path: 'cta.page', code: 'TARGET_UNKNOWN' }],
      });
    });

    it('destino inexistente o inactivo => 422 (TARGET_UNKNOWN / TARGET_INACTIVE)', async () => {
      const h = bannersHarness();
      h.repo.seedCategory(2, { active: false });
      h.repo.seedProduct(2, { active: false });
      const cases = [
        [{ type: 'CATEGORY' as const, categoryId: catid(99) }, 'cta.categoryId', 'TARGET_UNKNOWN'],
        [{ type: 'CATEGORY' as const, categoryId: catid(2) }, 'cta.categoryId', 'TARGET_INACTIVE'],
        [{ type: 'PRODUCT' as const, productId: prodid(99) }, 'cta.productId', 'TARGET_UNKNOWN'],
        [{ type: 'PRODUCT' as const, productId: prodid(2) }, 'cta.productId', 'TARGET_INACTIVE'],
      ] as const;
      for (const [cta, path, code] of cases)
        expect(await failure(h.admin.create(admin(), validCreate({ cta })))).toMatchObject({
          status: 422,
          code: 'BANNER_CTA_INVALID',
          violations: [{ path, code }],
        });
    });
  });

  describe('alcance de sucursales (B22)', () => {
    it('ALL con branchIds o SELECTED vacío => 422 BANNER_SCOPE_INVALID', async () => {
      const h = bannersHarness();
      expect(
        await failure(h.admin.create(admin(), validCreate({ branchScope: 'ALL', branchIds: [A] }))),
      ).toMatchObject({ status: 422, code: 'BANNER_SCOPE_INVALID' });
      expect(
        await failure(h.admin.create(admin(), validCreate({ branchScope: 'SELECTED' }))),
      ).toMatchObject({ status: 422, code: 'BANNER_SCOPE_INVALID' });
    });

    it('sucursal inexistente => 404 BRANCH_NOT_FOUND (no se crea nada)', async () => {
      const h = bannersHarness();
      expect(
        await failure(
          h.admin.create(
            admin(),
            validCreate({ branchScope: 'SELECTED', branchIds: [A, MISSING_BRANCH] }),
          ),
        ),
      ).toMatchObject({ status: 404, code: 'BRANCH_NOT_FOUND' });
      expect(h.repo.banners.size).toBe(0);
    });

    it('banner SELECTED con sucursales: devuelve sucursales y banner por sucursal', async () => {
      const h = bannersHarness();
      const out = await h.admin.create(
        admin(),
        validCreate({ branchScope: 'SELECTED', branchIds: [B, A] }),
      );
      expect(out.branchScope).toBe('SELECTED');
      expect(out.branches.map((b) => b.id).sort()).toEqual([A, B].sort());
    });

    it('actor acotado: ALL => 403 BANNER_SCOPE_FORBIDDEN; SELECTED con sucursal ajena => 404; dentro de su alcance => 201 editable', async () => {
      const h = bannersHarness();
      expect(await failure(h.admin.create(scoped(A), validCreate()))).toMatchObject({
        status: 403,
        code: 'BANNER_SCOPE_FORBIDDEN',
      });
      expect(
        await failure(
          h.admin.create(scoped(A), validCreate({ branchScope: 'SELECTED', branchIds: [A, B] })),
        ),
      ).toMatchObject({ status: 404, code: 'BRANCH_NOT_FOUND' });
      const ok = await h.admin.create(
        scoped(A),
        validCreate({ branchScope: 'SELECTED', branchIds: [A] }),
      );
      expect(ok).toMatchObject({ editable: true });
      expect(ok.branches.map((b) => b.id)).toEqual([A]);
      expect(h.repo.banners.size).toBe(1);
    });
  });

  describe('promoción vinculada', () => {
    it('inexistente => 422 BANNER_PROMOTION_INVALID PROMOTION_UNKNOWN', async () => {
      const h = bannersHarness();
      expect(
        await failure(
          h.admin.create(
            admin(),
            validCreate({ promotionId: '00000000-0000-4000-8000-0000000fffff' }),
          ),
        ),
      ).toMatchObject({
        status: 422,
        code: 'BANNER_PROMOTION_INVALID',
        violations: [{ path: 'promotionId', code: 'PROMOTION_UNKNOWN' }],
      });
    });

    it('alcance menor que el del banner => 422 BRANCH_SCOPE_MISMATCH; alcance suficiente => 201', async () => {
      const h = bannersHarness();
      const onlyA = h.repo.seedPromotion(1, { branchIds: [A] });
      const everywhere = h.repo.seedPromotion(2);
      // banner ALL con promoción SELECTED
      expect(
        await failure(h.admin.create(admin(), validCreate({ promotionId: onlyA.id }))),
      ).toMatchObject({
        status: 422,
        code: 'BANNER_PROMOTION_INVALID',
        violations: [{ code: 'BRANCH_SCOPE_MISMATCH' }],
      });
      // banner SELECTED [A,B] con promoción SELECTED [A]
      expect(
        await failure(
          h.admin.create(
            admin(),
            validCreate({ branchScope: 'SELECTED', branchIds: [A, B], promotionId: onlyA.id }),
          ),
        ),
      ).toMatchObject({ code: 'BANNER_PROMOTION_INVALID' });
      // banner SELECTED [A] con promoción [A] y con promoción ALL
      const ok1 = await h.admin.create(
        admin(),
        validCreate({
          code: 'ok-uno',
          branchScope: 'SELECTED',
          branchIds: [A],
          promotionId: onlyA.id,
        }),
      );
      const ok2 = await h.admin.create(
        admin(),
        validCreate({
          code: 'ok-dos',
          branchScope: 'SELECTED',
          branchIds: [A],
          promotionId: everywhere.id,
        }),
      );
      expect(ok1.promotion).toMatchObject({ id: onlyA.id, lifecycle: 'RUNNING' });
      expect(ok2.promotion?.id).toBe(everywhere.id);
    });

    it('promoción inactiva o futura se puede vincular; el banner queda oculto (PROMOTION_NOT_LIVE) y la referencia no filtra el cupón', async () => {
      const h = bannersHarness();
      const future = h.repo.seedPromotion(1, { startsAt: at(3600 * SEC), endsAt: at(7200 * SEC) });
      const out = await h.admin.create(admin(), validCreate({ promotionId: future.id }));
      expect(out).toMatchObject({
        lifecycle: 'PUBLISHED',
        visibleNow: false,
        hiddenReason: 'PROMOTION_NOT_LIVE',
        promotion: { id: future.id, name: 'Promo 1', lifecycle: 'SCHEDULED' },
      });
      expect(Object.keys(out.promotion ?? {}).sort()).toEqual(['id', 'lifecycle', 'name']);
    });
  });

  it('tope de 100 banners no vencidos => 422 BANNER_LIMIT_REACHED; los vencidos no cuentan', async () => {
    const h = bannersHarness();
    for (let i = 0; i < 99; i += 1) h.repo.seed();
    h.repo.seed({ endsAt: at(-SEC) }); // vencido: no cuenta
    expect((await h.admin.create(admin(), validCreate({ code: 'cien-cien' }))).version).toBe(1);
    expect(
      await failure(h.admin.create(admin(), validCreate({ code: 'ciento-uno' }))),
    ).toMatchObject({
      status: 422,
      code: 'BANNER_LIMIT_REACHED',
    });
    // un banner ya vencido puede crearse aunque se haya alcanzado el tope
    expect(
      (
        await h.admin.create(
          admin(),
          validCreate({ code: 'vencido-ok', endsAt: at(-SEC).toISOString() }),
        )
      ).lifecycle,
    ).toBe('EXPIRED');
  });

  it('tope de 100 con altas concurrentes: con 99 solo una tiene éxito (candado de orden antes de contar)', async () => {
    const h = bannersHarness();
    for (let i = 0; i < 99; i += 1) h.repo.seed();
    const results = await Promise.all([
      failure(h.admin.create(admin(), validCreate({ code: 'carrera-uno' }))),
      failure(h.admin.create(admin(), validCreate({ code: 'carrera-dos' }))),
    ]);
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(results.filter((r) => r !== null)).toMatchObject([
      { status: 422, code: 'BANNER_LIMIT_REACHED' },
    ]);
    expect(h.repo.banners.size).toBe(100);
    expect(h.repo.calls.indexOf('lockOrder')).toBeLessThan(h.repo.calls.indexOf('nonExpiredStats'));
  });

  it('errores de BD de bloqueo (P2028/55P03/40P01/40001) => 503 BANNERS_BUSY', async () => {
    const h = bannersHarness();
    for (const code of ['P2028', '55P03', '40P01', '40001']) {
      h.repo.failTransactionWith = Object.assign(new Error('x'), { code });
      expect(await failure(h.admin.create(admin(), validCreate()))).toMatchObject({
        status: 503,
        code: 'BANNERS_BUSY',
      });
    }
  });

  it('FK de la imagen desaparecida por carrera (23503) => 422 BANNER_IMAGE_INVALID; FK desconocida => no se traduce', async () => {
    const h = bannersHarness();
    h.repo.createBanner = () =>
      Promise.reject(
        Object.assign(new Error('violates foreign key constraint "banners_image_asset_id_fkey"'), {
          code: 'P2003',
        }),
      );
    expect(await failure(h.admin.create(admin(), validCreate()))).toMatchObject({
      status: 422,
      code: 'BANNER_IMAGE_INVALID',
    });
    h.repo.createBanner = () =>
      Promise.reject(Object.assign(new Error('violates "otra_fkey"'), { code: 'P2003' }));
    expect((await failure(h.admin.create(admin(), validCreate())))?.status).toBeUndefined();
  });
});

describe('update (PATCH parcial)', () => {
  const seeded = () => {
    const h = bannersHarness();
    h.repo.seedCategory(1, { name: 'Rolls' });
    const b = h.repo.seed({
      code: 'base-base',
      sortOrder: 3,
      startsAt: at(-3600 * SEC),
      endsAt: at(3600 * SEC),
      cta: { type: 'CATEGORY', categoryId: catid(1), productId: null, page: null },
      branchIds: [A, B],
      es: text({ title: 'Título es', subtitle: 'Sub es', ctaLabel: 'Pedir', imageAlt: 'Alt es' }),
      en: text({ title: 'Title en', subtitle: null, imageAlt: 'Alt en' }),
    });
    return { h, b };
  };

  it('no pisa lo omitido: cambiar el subtítulo en es conserva el resto (textos, CTA, sucursales, fechas, prioridad)', async () => {
    const { h, b } = seeded();
    const before = structuredClone(h.repo.banners.get(b.id)!);
    const out = await h.admin.update(admin(), b.id, {
      expectedVersion: 1,
      translations: { es: { subtitle: 'Nuevo sub' } },
    });
    expect(out.version).toBe(2);
    expect(out.translations.es).toEqual({
      title: 'Título es',
      subtitle: 'Nuevo sub',
      ctaLabel: 'Pedir',
      imageAlt: 'Alt es',
    });
    expect(out.translations.en).toMatchObject({ title: 'Title en', imageAlt: 'Alt en' });
    const after = h.repo.banners.get(b.id)!;
    expect(after.cta).toEqual(before.cta);
    expect(after.branchIds).toEqual(before.branchIds);
    expect(after.startsAt).toEqual(before.startsAt);
    expect(after.endsAt).toEqual(before.endsAt);
    expect(after.sortOrder).toBe(3);
    expect(after.imageAssetId).toBe(before.imageAssetId);
    expect(after.code).toBe('base-base');
  });

  it('sin cambios reales => 200, sin escribir, sin subir version y sin auditar', async () => {
    const { h, b } = seeded();
    const out = await h.admin.update(admin(), b.id, {
      expectedVersion: 1,
      sortOrder: 3,
      translations: { es: { title: 'Título es' } },
      branchScope: 'SELECTED',
      branchIds: [B, A],
      cta: { type: 'CATEGORY', categoryId: catid(1) },
    });
    expect(out.version).toBe(1);
    expect(h.repo.count('saveBanner')).toBe(0);
    expect(h.repo.audit).toHaveLength(0);
  });

  it('expectedVersion obsoleto => 409 BANNER_VERSION_CONFLICT sin guardar ni auditar', async () => {
    const { h, b } = seeded();
    await h.admin.update(admin(), b.id, { expectedVersion: 1, sortOrder: 4 });
    expect(
      await failure(h.admin.update(admin(), b.id, { expectedVersion: 1, sortOrder: 5 })),
    ).toMatchObject({
      status: 409,
      code: 'BANNER_VERSION_CONFLICT',
    });
    expect(h.repo.banners.get(b.id)?.sortOrder).toBe(4);
    expect(h.repo.audit).toHaveLength(1);
  });

  it('translations.en = null elimina el inglés; null en un campo opcional lo borra', async () => {
    const { h, b } = seeded();
    const out = await h.admin.update(admin(), b.id, {
      expectedVersion: 1,
      translations: { en: null, es: { subtitle: null } },
    });
    expect(out.translations.en).toBeNull();
    expect(out.hasEnglish).toBe(false);
    expect(out.translations.es.subtitle).toBeNull();
    expect(out.translations.es.title).toBe('Título es');
  });

  it('es.title / es.imageAlt no pueden quedar vacíos => 422 sin guardar', async () => {
    const { h, b } = seeded();
    for (const es of [{ title: null }, { title: '  ' }, { imageAlt: null }]) {
      expect(
        await failure(h.admin.update(admin(), b.id, { expectedVersion: 1, translations: { es } })),
      ).toMatchObject({ status: 422, code: 'BANNER_TRANSLATION_INVALID' });
    }
    expect(h.repo.banners.get(b.id)?.version).toBe(1);
  });

  it('añadir inglés desde cero; un parche de inglés que lo deja vacío lo elimina', async () => {
    const h = bannersHarness();
    const b = h.repo.seed();
    const a = await h.admin.update(admin(), b.id, {
      expectedVersion: 1,
      translations: { en: { title: 'Hi', imageAlt: 'Alt' } },
    });
    expect(a.translations.en).toMatchObject({ title: 'Hi' });
    const c = await h.admin.update(admin(), b.id, {
      expectedVersion: 2,
      translations: { en: { title: null, imageAlt: null } },
    });
    expect(c.translations.en).toBeNull();
  });

  it('reemplaza la imagen sin tocar el asset anterior; audita old/new', async () => {
    const { h, b } = seeded();
    h.repo.seedAsset(5);
    const out = await h.admin.update(admin(), b.id, {
      expectedVersion: 1,
      imageAssetId: assetid(5),
    });
    expect(out.image.assetId).toBe(assetid(5));
    expect(h.repo.assets.has(assetid(1))).toBe(true); // el asset anterior sigue existiendo
    expect(h.repo.audit[0]).toMatchObject({
      action: 'banner.updated',
      oldValues: { imageAssetId: assetid(1) },
      newValues: { imageAssetId: assetid(5) },
    });
  });

  it('imagen inválida en PATCH (PENDING, otro tipo, inexistente) => 422 con motivo', async () => {
    const { h, b } = seeded();
    h.repo.seedAsset(6, { status: 'PENDING' });
    h.repo.seedAsset(7, { kind: 'PRODUCT_IMAGE', objectKey: 'products/2026/y.png' });
    for (const [id, code] of [
      [assetid(6), 'ASSET_NOT_READY'],
      [assetid(7), 'ASSET_KIND_MISMATCH'],
      [assetid(98), 'ASSET_UNKNOWN'],
    ] as const)
      expect(
        await failure(h.admin.update(admin(), b.id, { expectedVersion: 1, imageAssetId: id })),
      ).toMatchObject({ status: 422, code: 'BANNER_IMAGE_INVALID', violations: [{ code }] });
  });

  it('audita CTA, fechas, sucursales y prioridad con old/new solo de lo cambiado (sin PII)', async () => {
    const { h, b } = seeded();
    await h.admin.update(admin(), b.id, {
      expectedVersion: 1,
      cta: { type: 'PAGE', page: 'CAREERS' },
      startsAt: null,
      endsAt: '2027-01-01T00:00:00Z',
      branchScope: 'SELECTED',
      branchIds: [C],
      sortOrder: 9,
    });
    const event = h.repo.audit[0] as {
      oldValues: Record<string, unknown>;
      newValues: Record<string, unknown>;
    };
    expect(event.oldValues).toMatchObject({
      ctaType: 'CATEGORY',
      ctaCategoryId: catid(1),
      ctaPage: null,
      startsAt: at(-3600 * SEC).toISOString(),
      branchIds: [A, B].sort(),
      sortOrder: 3,
    });
    expect(event.newValues).toMatchObject({
      ctaType: 'PAGE',
      ctaPage: 'CAREERS',
      startsAt: null,
      endsAt: '2027-01-01T00:00:00.000Z',
      branchIds: [C],
      sortOrder: 9,
    });
    expect(event.oldValues).not.toHaveProperty('imageAssetId');
    expect(JSON.stringify(event)).not.toMatch(/https?:\/\/|banners\/20|password|email|phone/i);
  });

  it('periodo resultante inválido => 422 (fin anterior al inicio existente)', async () => {
    const { h, b } = seeded();
    expect(
      await failure(
        h.admin.update(admin(), b.id, {
          expectedVersion: 1,
          endsAt: at(-7200 * SEC).toISOString(),
        }),
      ),
    ).toMatchObject({ status: 422, code: 'BANNER_PERIOD_INVALID' });
  });

  it('CTA inactivo/inexistente en PATCH => 422; un CTA ya inactivo no impide editar otros campos', async () => {
    const { h, b } = seeded();
    h.repo.seedCategory(2, { active: false });
    expect(
      await failure(
        h.admin.update(admin(), b.id, {
          expectedVersion: 1,
          cta: { type: 'CATEGORY', categoryId: catid(2) },
        }),
      ),
    ).toMatchObject({ status: 422, code: 'BANNER_CTA_INVALID' });
    h.repo.categories.get(catid(1))!.active = false;
    const out = await h.admin.update(admin(), b.id, { expectedVersion: 1, sortOrder: 8 });
    expect(out).toMatchObject({
      version: 2,
      hiddenReason: 'CTA_TARGET_INACTIVE',
      visibleNow: false,
    });
  });

  it('desvincular promoción (null) y vincular; el alcance se revalida si cambian las sucursales', async () => {
    const h = bannersHarness();
    const onlyA = h.repo.seedPromotion(1, { branchIds: [A] });
    const b = h.repo.seed({ branchIds: [A], promotionId: onlyA.id });
    // ampliar el banner a B rompe la cobertura de la promoción
    expect(
      await failure(h.admin.update(admin(), b.id, { expectedVersion: 1, branchIds: [A, B] })),
    ).toMatchObject({ status: 422, code: 'BANNER_PROMOTION_INVALID' });
    const out = await h.admin.update(admin(), b.id, {
      expectedVersion: 1,
      promotionId: null,
      branchIds: [A, B],
    });
    expect(out.promotion).toBeNull();
    expect(out.branches.map((x) => x.id).sort()).toEqual([A, B].sort());
  });

  it('SELECTED -> ALL descarta las sucursales; ALL -> SELECTED sin ids => 422; ALL con ids => 422', async () => {
    const { h, b } = seeded();
    const toAll = await h.admin.update(admin(), b.id, { expectedVersion: 1, branchScope: 'ALL' });
    expect(toAll).toMatchObject({ branchScope: 'ALL', branches: [], version: 2 });
    expect(
      await failure(h.admin.update(admin(), b.id, { expectedVersion: 2, branchScope: 'SELECTED' })),
    ).toMatchObject({ status: 422, code: 'BANNER_SCOPE_INVALID' });
    expect(
      await failure(
        h.admin.update(admin(), b.id, { expectedVersion: 2, branchScope: 'ALL', branchIds: [A] }),
      ),
    ).toMatchObject({ status: 422, code: 'BANNER_SCOPE_INVALID' });
  });

  it('reabrir banners vencidos en paralelo con 99 no vencidos: solo uno; el candado de orden va ANTES que el de fila', async () => {
    const h = bannersHarness();
    const a = h.repo.seed({ endsAt: at(-SEC) });
    const b = h.repo.seed({ endsAt: at(-SEC) });
    for (let i = 0; i < 99; i += 1) h.repo.seed();
    const results = await Promise.all([
      failure(h.admin.update(admin(), a.id, { expectedVersion: 1, endsAt: null })),
      failure(h.admin.update(admin(), b.id, { expectedVersion: 1, endsAt: null })),
    ]);
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(h.repo.calls.indexOf('lockOrder')).toBeLessThan(h.repo.calls.indexOf('lockBanner'));
  });

  it('un banner vencido que vuelve a ser no vencido no puede rebasar el tope de 100', async () => {
    const h = bannersHarness();
    const old = h.repo.seed({ endsAt: at(-SEC) });
    for (let i = 0; i < 100; i += 1) h.repo.seed();
    expect(
      await failure(h.admin.update(admin(), old.id, { expectedVersion: 1, endsAt: null })),
    ).toMatchObject({ status: 422, code: 'BANNER_LIMIT_REACHED' });
  });

  describe('alcance e IDOR (B22)', () => {
    it('banner ajeno (no toca el alcance) => 404 BANNER_NOT_FOUND; inexistente => 404', async () => {
      const h = bannersHarness();
      const other = h.repo.seed({ branchIds: [B] });
      expect(
        await failure(h.admin.update(scoped(A), other.id, { expectedVersion: 1, sortOrder: 1 })),
      ).toMatchObject({
        status: 404,
        code: 'BANNER_NOT_FOUND',
      });
      expect(
        await failure(h.admin.update(scoped(A), bnid(99), { expectedVersion: 1, sortOrder: 1 })),
      ).toMatchObject({
        status: 404,
        code: 'BANNER_NOT_FOUND',
      });
      expect(h.repo.count('lockBanner')).toBe(0); // sin candado: el actor sin alcance no puede degradar la fila
    });

    it('ALL y SELECTED parcial (lo toca pero no lo cubre) => 403 BANNER_SCOPE_FORBIDDEN sin candado', async () => {
      const h = bannersHarness();
      const all = h.repo.seed();
      const partial = h.repo.seed({ branchIds: [A, B] });
      for (const id of [all.id, partial.id])
        expect(
          await failure(h.admin.update(scoped(A), id, { expectedVersion: 1, sortOrder: 1 })),
        ).toMatchObject({
          status: 403,
          code: 'BANNER_SCOPE_FORBIDDEN',
        });
      expect(
        await failure(h.admin.updateStatus(scoped(A), partial.id, { active: false })),
      ).toMatchObject({
        status: 403,
      });
      expect(h.repo.count('lockBanner')).toBe(0);
    });

    it('actor acotado edita un banner cubierto; no puede ampliarlo a una sucursal ajena (404) ni a ALL (403)', async () => {
      const h = bannersHarness();
      const b = h.repo.seed({ branchIds: [A] });
      const ok = await h.admin.update(scoped(A, B), b.id, {
        expectedVersion: 1,
        branchIds: [A, B],
      });
      expect(ok.version).toBe(2);
      expect(
        await failure(
          h.admin.update(scoped(A, B), b.id, { expectedVersion: 2, branchIds: [A, C] }),
        ),
      ).toMatchObject({
        status: 404,
        code: 'BRANCH_NOT_FOUND',
      });
      expect(
        await failure(
          h.admin.update(scoped(A, B), b.id, { expectedVersion: 2, branchScope: 'ALL' }),
        ),
      ).toMatchObject({
        status: 403,
        code: 'BANNER_SCOPE_FORBIDDEN',
      });
    });

    it('sucursal inexistente en el PATCH => 404 BRANCH_NOT_FOUND; inactiva existente se acepta (como F15)', async () => {
      const h = bannersHarness();
      const b = h.repo.seed({ branchIds: [A] });
      expect(
        await failure(
          h.admin.update(admin(), b.id, { expectedVersion: 1, branchIds: [A, MISSING_BRANCH] }),
        ),
      ).toMatchObject({ status: 404, code: 'BRANCH_NOT_FOUND' });
      expect(
        (await h.admin.update(admin(), b.id, { expectedVersion: 1, branchIds: [INACTIVE_BRANCH] }))
          .version,
      ).toBe(2);
    });

    it('re-verifica el alcance TRAS el candado: si el banner cambió de alcance entre la lectura y el bloqueo => 403/404 (lección F15)', async () => {
      const h = bannersHarness();
      const b = h.repo.seed({ branchIds: [A] });
      h.repo.afterLock = () => {
        const cur = h.repo.banners.get(b.id)!;
        h.repo.banners.set(b.id, { ...cur, branchIds: [A, B] }); // otro editor lo amplió a B
        h.repo.afterLock = null;
      };
      expect(
        await failure(h.admin.update(scoped(A), b.id, { expectedVersion: 1, sortOrder: 2 })),
      ).toMatchObject({
        status: 403,
        code: 'BANNER_SCOPE_FORBIDDEN',
      });
      expect(h.repo.banners.get(b.id)?.version).toBe(1);
      h.repo.afterLock = () => {
        const cur = h.repo.banners.get(b.id)!;
        h.repo.banners.set(b.id, { ...cur, branchIds: [C] });
        h.repo.afterLock = null;
      };
      expect(
        await failure(h.admin.updateStatus(scoped(A, B), b.id, { active: false })),
      ).toMatchObject({
        status: 404,
        code: 'BANNER_NOT_FOUND',
      });
    });
  });

  it('una edición concurrente entre la lectura y el candado => 409 (versión re-comprobada tras bloquear)', async () => {
    const { h, b } = seeded();
    h.repo.afterLock = () => {
      const cur = h.repo.banners.get(b.id)!;
      h.repo.banners.set(b.id, { ...cur, version: 2 });
      h.repo.afterLock = null;
    };
    expect(
      await failure(h.admin.update(admin(), b.id, { expectedVersion: 1, sortOrder: 1 })),
    ).toMatchObject({
      status: 409,
      code: 'BANNER_VERSION_CONFLICT',
    });
  });
});

describe('updateStatus', () => {
  it('desactiva y activa: version + 1 y auditoría con oldActive/newActive/reason', async () => {
    const h = bannersHarness();
    const b = h.repo.seed();
    const off = await h.admin.updateStatus(admin(), b.id, {
      active: false,
      reason: '  fin de campaña ',
    });
    expect(off).toMatchObject({ active: false, lifecycle: 'INACTIVE', version: 2 });
    expect(h.repo.audit[0]).toMatchObject({
      action: 'banner.status_changed',
      reason: 'fin de campaña',
      oldValues: { oldActive: true },
      newValues: { newActive: false },
    });
    const on = await h.admin.updateStatus(admin(), b.id, { active: true });
    expect(on).toMatchObject({ active: true, lifecycle: 'PUBLISHED', version: 3 });
    expect(h.repo.audit).toHaveLength(2);
  });

  it('reason con NUL o bidi => 400 sin tocar nada; se guarda normalizado en una línea', async () => {
    const h = bannersHarness();
    const b = h.repo.seed();
    for (const reason of ['a\u0000b', 'a\u202Eb'])
      expect(
        await failure(h.admin.updateStatus(admin(), b.id, { active: false, reason })),
      ).toMatchObject({
        status: 400,
      });
    expect(h.repo.count('transaction')).toBe(0);
    await h.admin.updateStatus(admin(), b.id, { active: false, reason: ' fin \n de  campaña ' });
    expect(h.repo.audit[0]).toMatchObject({ reason: 'fin de campaña' });
  });

  it('idempotente: mismo estado => 200 sin escribir, sin version y sin auditar', async () => {
    const h = bannersHarness();
    const b = h.repo.seed();
    const out = await h.admin.updateStatus(admin(), b.id, { active: true });
    expect(out.version).toBe(1);
    expect(h.repo.count('saveBanner')).toBe(0);
    expect(h.repo.audit).toHaveLength(0);
  });

  it('desactivar no borra el banner ni su imagen', async () => {
    const h = bannersHarness();
    const b = h.repo.seed();
    await h.admin.updateStatus(admin(), b.id, { active: false });
    expect(h.repo.banners.has(b.id)).toBe(true);
    expect(h.repo.assets.has(assetid(1))).toBe(true);
  });

  it('banner inexistente => 404', async () => {
    const h = bannersHarness();
    expect(await failure(h.admin.updateStatus(admin(), bnid(99), { active: false }))).toMatchObject(
      {
        status: 404,
        code: 'BANNER_NOT_FOUND',
      },
    );
  });
});

describe('reorder (B19)', () => {
  const three = () => {
    const h = bannersHarness();
    const a = h.repo.seed({ sortOrder: 0 });
    const b = h.repo.seed({ sortOrder: 1 });
    const c = h.repo.seed({ sortOrder: 2 });
    return { h, a, b, c };
  };

  it('asigna 0..n-1, sube version solo en los que cambian y audita una vez', async () => {
    const { h, a, b, c } = three();
    const out = await h.admin.reorder(admin(), { orderedIds: [c.id, a.id, b.id] });
    expect(out.items).toEqual([
      { id: c.id, sortOrder: 0, version: 2 },
      { id: a.id, sortOrder: 1, version: 2 },
      { id: b.id, sortOrder: 2, version: 2 },
    ]);
    // intercambio de dos: el tercero no cambia y conserva su version
    const swap = await h.admin.reorder(admin(), { orderedIds: [a.id, c.id, b.id] });
    expect(swap.items).toEqual([
      { id: a.id, sortOrder: 0, version: 3 },
      { id: c.id, sortOrder: 1, version: 3 },
      { id: b.id, sortOrder: 2, version: 2 },
    ]);
    expect(h.repo.audit).toHaveLength(2);
    expect(h.repo.audit[0]).toMatchObject({
      action: 'banner.reordered',
      oldValues: { orderedIds: [a.id, b.id, c.id] },
      newValues: { orderedIds: [c.id, a.id, b.id] },
    });
  });

  it('idempotente: repetir el mismo orden => 200 sin escribir ni auditar', async () => {
    const { h, a, b, c } = three();
    const out = await h.admin.reorder(admin(), { orderedIds: [a.id, b.id, c.id] });
    expect(out.items.map((i) => i.version)).toEqual([1, 1, 1]);
    expect(h.repo.count('applySortOrders')).toBe(0);
    expect(h.repo.audit).toHaveLength(0);
    await h.admin.reorder(admin(), { orderedIds: [b.id, a.id, c.id] });
    const again = await h.admin.reorder(admin(), { orderedIds: [b.id, a.id, c.id] });
    expect(again.items.map((i) => i.version)).toEqual([2, 2, 1]);
    expect(h.repo.audit).toHaveLength(1);
  });

  it('renumera las prioridades empatadas aunque el orden relativo ya coincida', async () => {
    const h = bannersHarness();
    const a = h.repo.seed({ sortOrder: 5 });
    const b = h.repo.seed({ sortOrder: 5 });
    const out = await h.admin.reorder(admin(), { orderedIds: [a.id, b.id] });
    expect(out.items.map((i) => i.sortOrder)).toEqual([0, 1]);
  });

  it('conjunto distinto (falta, sobra, ajeno o vencido incluido) => 422 BANNER_REORDER_MISMATCH sin escribir', async () => {
    const { h, a, b, c } = three();
    const expired = h.repo.seed({ endsAt: at(-SEC) });
    const cases = [
      [a.id, b.id],
      [a.id, b.id, c.id, bnid(99)],
      [a.id, b.id, bnid(99)],
      [a.id, b.id, c.id, expired.id],
      [a.id, a.id, b.id],
    ];
    for (const orderedIds of cases)
      expect(await failure(h.admin.reorder(admin(), { orderedIds }))).toMatchObject({
        status: 422,
        code: 'BANNER_REORDER_MISMATCH',
      });
    expect(h.repo.count('applySortOrders')).toBe(0);
    expect(h.repo.audit).toHaveLength(0);
  });

  it('los inactivos y los programados participan; los vencidos conservan su prioridad', async () => {
    const h = bannersHarness();
    const inactive = h.repo.seed({ sortOrder: 0, active: false });
    const scheduled = h.repo.seed({ sortOrder: 1, startsAt: at(3600 * SEC) });
    const expired = h.repo.seed({ sortOrder: 7, endsAt: at(-SEC) });
    const out = await h.admin.reorder(admin(), { orderedIds: [scheduled.id, inactive.id] });
    expect(out.items.map((i) => i.id)).toEqual([scheduled.id, inactive.id]);
    expect(h.repo.banners.get(expired.id)).toMatchObject({ sortOrder: 7, version: 1 });
  });

  it('alcance acotado => 403 BANNER_SCOPE_FORBIDDEN antes de tocar nada', async () => {
    const { h, a } = three();
    expect(await failure(h.admin.reorder(scoped(A), { orderedIds: [a.id] }))).toMatchObject({
      status: 403,
      code: 'BANNER_SCOPE_FORBIDDEN',
    });
    expect(h.repo.count('transaction')).toBe(0);
    expect(h.repo.count('lockOrder')).toBe(0);
  });

  it('toma el candado de orden primero; dos reordenados concurrentes se serializan (gana uno, nunca una mezcla)', async () => {
    const { h, a, b, c } = three();
    const first = [c.id, b.id, a.id];
    const second = [b.id, c.id, a.id];
    // El primero ya confirmó cuando el segundo obtiene el candado: el segundo relee y aplica SU orden completo.
    await h.admin.reorder(admin(), { orderedIds: first });
    await h.admin.reorder(admin(), { orderedIds: second });
    const final = [...h.repo.banners.values()]
      .sort((x, y) => x.sortOrder - y.sortOrder)
      .map((x) => x.id);
    expect(final).toEqual(second);
    expect(h.repo.calls.indexOf('lockOrder')).toBeLessThan(h.repo.calls.indexOf('findNonExpired'));
  });

  it('un banner creado entre la lectura de la lista y el reordenado => 422 (conjunto exacto)', async () => {
    const { h, a, b, c } = three();
    h.repo.afterOrderLock = () => {
      h.repo.seed();
      h.repo.afterOrderLock = null;
    };
    expect(
      await failure(h.admin.reorder(admin(), { orderedIds: [a.id, b.id, c.id] })),
    ).toMatchObject({
      code: 'BANNER_REORDER_MISMATCH',
    });
  });

  it('un editor con expectedVersion previo recibe 409 tras un reordenado que cambió su banner', async () => {
    const { h, a, b } = three();
    await h.admin.reorder(admin(), { orderedIds: [b.id, a.id, [...h.repo.banners.keys()][2]!] });
    expect(
      await failure(h.admin.update(admin(), a.id, { expectedVersion: 1, sortOrder: 9 })),
    ).toMatchObject({
      status: 409,
      code: 'BANNER_VERSION_CONFLICT',
    });
  });
});

describe('list / get', () => {
  it('lista paginada: una consulta de página + una de registros (sin N+1), orden de prioridad', async () => {
    const h = bannersHarness();
    const x = h.repo.seed({ sortOrder: 2 });
    const y = h.repo.seed({ sortOrder: 1 });
    h.repo.seed({ sortOrder: 3 });
    const out = await h.admin.list(admin(), { page: 1, pageSize: 2 });
    expect(out.items.map((i) => i.id)).toEqual([y.id, x.id]);
    expect(out).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    expect(h.repo.count('findPage')).toBe(1);
    expect(h.repo.count('findRecords')).toBe(1);
    expect(out.items[0]).not.toHaveProperty('translations'); // el resumen no lleva traducciones
  });

  it('filtros: lifecycle, branchId y búsqueda por título o código (sin acentos; comodines literales)', async () => {
    const h = bannersHarness();
    const live = h.repo.seed({
      code: 'happy-hour',
      es: text({ title: 'Jalapeño 50%' }),
      branchIds: [A],
    });
    h.repo.seed({ active: false, es: text({ title: 'Otro' }) });
    h.repo.seed({ startsAt: at(3600 * SEC), es: text({ title: 'Futuro' }) });
    h.repo.seed({ endsAt: at(-SEC), es: text({ title: 'Pasado' }) });
    for (const [lifecycle, count] of [
      ['PUBLISHED', 1],
      ['INACTIVE', 1],
      ['SCHEDULED', 1],
      ['EXPIRED', 1],
    ] as const)
      expect(
        (await h.admin.list(admin(), { lifecycle, page: 1, pageSize: 20 })).items,
      ).toHaveLength(count);
    expect(
      (await h.admin.list(admin(), { q: 'JALAPENO', page: 1, pageSize: 20 })).items.map(
        (i) => i.id,
      ),
    ).toEqual([live.id]);
    expect(
      (await h.admin.list(admin(), { q: 'happy', page: 1, pageSize: 20 })).items.map((i) => i.id),
    ).toEqual([live.id]);
    // % es literal: no actúa de comodín
    expect(
      (await h.admin.list(admin(), { q: '50%', page: 1, pageSize: 20 })).items.map((i) => i.id),
    ).toEqual([live.id]);
    expect(
      (await h.admin.list(admin(), { q: '%', page: 1, pageSize: 20 })).items.map((i) => i.id),
    ).toEqual([live.id]);
    expect((await h.admin.list(admin(), { q: '_____', page: 1, pageSize: 20 })).items).toEqual([]);
    expect((await h.admin.list(admin(), { branchId: A, page: 1, pageSize: 20 })).total).toBe(4); // 3 ALL + el de A
  });

  it('filtro branchId inexistente o fuera de alcance => 404 BRANCH_NOT_FOUND', async () => {
    const h = bannersHarness();
    expect(
      await failure(h.admin.list(admin(), { branchId: MISSING_BRANCH, page: 1, pageSize: 20 })),
    ).toMatchObject({
      status: 404,
      code: 'BRANCH_NOT_FOUND',
    });
    expect(
      await failure(h.admin.list(scoped(A), { branchId: B, page: 1, pageSize: 20 })),
    ).toMatchObject({
      status: 404,
      code: 'BRANCH_NOT_FOUND',
    });
  });

  it('alcance acotado: solo los que aplican a su alcance (incluidos ALL), sucursales recortadas y editable=false si no cubre todas', async () => {
    const h = bannersHarness();
    const all = h.repo.seed();
    const inA = h.repo.seed({ branchIds: [A] });
    const mixed = h.repo.seed({ branchIds: [A, B] });
    h.repo.seed({ branchIds: [B] });
    const out = await h.admin.list(scoped(A), { page: 1, pageSize: 20 });
    expect(out.items.map((i) => i.id)).toEqual([all.id, inA.id, mixed.id]);
    const byId = new Map(out.items.map((i) => [i.id, i]));
    expect(byId.get(all.id)).toMatchObject({ editable: false, branches: [] });
    expect(byId.get(inA.id)).toMatchObject({ editable: true });
    expect(byId.get(mixed.id)).toMatchObject({ editable: false });
    expect(byId.get(mixed.id)?.branches.map((b) => b.id)).toEqual([A]); // B recortada
  });

  it('visibleNow / hiddenReason: promoción no vigente, destino inactivo, imagen sin URL pública', async () => {
    const h = bannersHarness();
    h.repo.seedCategory(1, { active: false });
    const stopped = h.repo.seedPromotion(1, { active: false });
    const promo = h.repo.seed({ promotionId: stopped.id });
    const cta = h.repo.seed({
      cta: { type: 'CATEGORY', categoryId: catid(1), productId: null, page: null },
    });
    const ok = h.repo.seed();
    const out = await h.admin.list(admin(), { page: 1, pageSize: 20 });
    const reason = (id: string) => out.items.find((i) => i.id === id)?.hiddenReason;
    expect(reason(promo.id)).toBe('PROMOTION_NOT_LIVE');
    expect(reason(cta.id)).toBe('CTA_TARGET_INACTIVE');
    expect(reason(ok.id)).toBeNull();
    expect(out.items.find((i) => i.id === ok.id)?.visibleNow).toBe(true);

    const noMedia = bannersHarness({ publicBaseUrl: null });
    const b = noMedia.repo.seed();
    const view = await noMedia.admin.get(admin(), b.id);
    expect(view).toMatchObject({ hiddenReason: 'IMAGE_UNAVAILABLE', visibleNow: false });
    expect(view.image.url).toBeNull();
  });

  it('un banner inactivo o vencido no tiene hiddenReason (solo los PUBLISHED lo tienen)', async () => {
    const h = bannersHarness();
    const off = h.repo.seed({
      active: false,
      promotionId: h.repo.seedPromotion(1, { active: false }).id,
    });
    expect((await h.admin.get(admin(), off.id)).hiddenReason).toBeNull();
  });

  it('get: detalle con ambas traducciones sin respaldo; ajeno/inexistente => 404', async () => {
    const h = bannersHarness();
    const b = h.repo.seed({ en: null, branchIds: [B] });
    const view = await h.admin.get(admin(), b.id);
    expect(view.translations.en).toBeNull();
    expect(await failure(h.admin.get(scoped(A), b.id))).toMatchObject({
      status: 404,
      code: 'BANNER_NOT_FOUND',
    });
    expect(await failure(h.admin.get(admin(), bnid(99)))).toMatchObject({
      status: 404,
      code: 'BANNER_NOT_FOUND',
    });
  });

  it('el reloj del servidor decide el estado (cambia al avanzar el tiempo)', async () => {
    const h = bannersHarness();
    const b = h.repo.seed({ startsAt: local('2026-11-16T17:00:00') });
    expect((await h.admin.get(admin(), b.id)).lifecycle).toBe('SCHEDULED');
    h.clock.current = local('2026-11-16T17:00:00');
    expect((await h.admin.get(admin(), b.id)).lifecycle).toBe('PUBLISHED');
  });
});
