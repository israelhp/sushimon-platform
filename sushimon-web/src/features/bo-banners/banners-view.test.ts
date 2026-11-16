import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/data-access/errors';
import type { AdminBanner } from '@/lib/data-access/models';
import {
  EMPTY_FILTERS,
  bannerServerError,
  bannerToForm,
  emptyBannerForm,
  fieldOfViolationPath,
  filtersToQuery,
  hasActiveFilters,
  previewBanner,
  toCreateRequest,
  toUpdateRequest,
  validateBannerForm,
  type BannerFormValues,
} from './banners-view';

const image = { assetId: 'a1', url: null, mimeType: 'image/webp', sizeBytes: 1000 };

function filled(): BannerFormValues {
  const v = emptyBannerForm(true);
  return {
    ...v,
    code: ' Mi-Banner ',
    image,
    es: { title: ' Título ', subtitle: '', ctaLabel: 'Ver', imageAlt: 'Alt' },
  };
}

const current: AdminBanner = {
  id: 'b1',
  code: 'mi-banner',
  title: 'Título',
  image: { assetId: 'a1', url: null, mimeType: 'image/webp', sizeBytes: 1000 },
  cta: {
    type: 'MENU',
    categoryId: null,
    productId: null,
    page: null,
    targetLabel: null,
    targetActive: null,
  },
  branchScope: 'ALL',
  branches: [],
  promotion: null,
  startsAt: null,
  endsAt: null,
  active: true,
  sortOrder: 2,
  lifecycle: 'PUBLISHED',
  visibleNow: true,
  hiddenReason: null,
  hasEnglish: true,
  editable: true,
  version: 4,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  translations: {
    es: { title: 'Título', subtitle: null, ctaLabel: 'Ver', imageAlt: 'Alt' },
    en: { title: 'Title', subtitle: null, ctaLabel: null, imageAlt: null },
  },
};

const errorCode = (status: number, businessCode?: string, path?: string) =>
  new ApiError(
    status,
    'x',
    'msg',
    undefined,
    undefined,
    businessCode,
    path ? [{ path, code: 'C', message: 'm' }] : undefined,
  );

describe('filtros', () => {
  it('detecta filtros activos y arma la consulta en el orden de la tienda', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, lifecycle: 'EXPIRED' })).toBe(true);
    expect(
      filtersToQuery({ q: ' hola ', branchId: 'sucursal-1', lifecycle: 'PUBLISHED' }, 2, 10),
    ).toEqual({
      q: 'hola',
      branchId: 'sucursal-1',
      lifecycle: 'PUBLISHED',
      sort: 'priority',
      order: 'asc',
      page: 2,
      pageSize: 10,
    });
    expect(filtersToQuery(EMPTY_FILTERS, 1, 10)).toMatchObject({
      q: undefined,
      branchId: undefined,
      lifecycle: undefined,
    });
  });
});

describe('validación del formulario', () => {
  const fields = (v: BannerFormValues, editing = false) =>
    validateBannerForm(v, editing).map((e) => e.field);

  it('válido: no hay errores; el código se valida solo al crear', () => {
    expect(fields(filled())).toEqual([]);
    expect(fields({ ...filled(), code: '' }, true)).toEqual([]);
    expect(fields({ ...filled(), code: 'AB' })).toEqual(['code']);
  });

  it('exige imagen, título y alt en español', () => {
    expect(fields({ ...emptyBannerForm(true), code: 'abc' })).toEqual([
      'image',
      'esTitle',
      'esImageAlt',
    ]);
  });

  it('límites de longitud y caracteres no permitidos en ambos idiomas', () => {
    const v = filled();
    expect(fields({ ...v, es: { ...v.es, title: 'x'.repeat(81) } })).toEqual(['esTitle']);
    expect(fields({ ...v, en: { ...v.en, subtitle: 'y'.repeat(161) } })).toEqual(['enSubtitle']);
    expect(fields({ ...v, en: { ...v.en, ctaLabel: 'z'.repeat(41) } })).toEqual(['enCtaLabel']);
    expect(fields({ ...v, en: { ...v.en, imageAlt: 'a‮b' } })).toEqual(['enImageAlt']);
  });

  it('CTA estructurado: cada tipo exige su destino; sin enlaces libres', () => {
    expect(fields({ ...filled(), ctaType: 'CATEGORY' })).toEqual(['cta']);
    expect(fields({ ...filled(), ctaType: 'PRODUCT' })).toEqual(['cta']);
    expect(fields({ ...filled(), ctaType: 'PAGE', page: '' })).toEqual(['cta']);
    expect(fields({ ...filled(), ctaType: 'PAGE', page: 'CAREERS' })).toEqual([]);
    expect(fields({ ...filled(), ctaType: 'PAGE', page: '/admin' as never })).toEqual(['cta']);
  });

  it('fechas: fin posterior al inicio (zona America/Guatemala); ambos opcionales', () => {
    const v = filled();
    expect(fields({ ...v, startsAt: '2026-12-01T10:00', endsAt: '2026-12-01T10:00' })).toEqual([
      'endsAt',
    ]);
    expect(fields({ ...v, startsAt: '2026-12-01T10:00', endsAt: '2026-12-01T10:01' })).toEqual([]);
    expect(fields({ ...v, endsAt: '2026-12-01T10:00' })).toEqual([]);
  });

  it('sucursales y prioridad', () => {
    expect(fields({ ...filled(), branchScope: 'SELECTED', branchIds: [] })).toEqual(['branches']);
    expect(fields({ ...filled(), sortOrder: '10000' })).toEqual(['sortOrder']);
    expect(fields({ ...filled(), sortOrder: '-1' })).toEqual(['sortOrder']);
    expect(fields({ ...filled(), sortOrder: '9999' })).toEqual([]);
  });
});

describe('formulario → petición', () => {
  it('alta: normaliza el código, recorta textos, en blanco = ausente, inglés vacío no se envía', () => {
    const req = toCreateRequest({
      ...filled(),
      startsAt: '2026-12-01T10:00',
      sortOrder: '3',
      promotionId: 'p1',
    });
    expect(req).toEqual({
      code: 'mi-banner',
      imageAssetId: 'a1',
      translations: { es: { title: 'Título', subtitle: null, ctaLabel: 'Ver', imageAlt: 'Alt' } },
      cta: { type: 'MENU' },
      branchScope: 'ALL',
      promotionId: 'p1',
      // 10:00 en Guatemala = 16:00 UTC.
      startsAt: '2026-12-01T16:00:00.000Z',
      sortOrder: 3,
      active: true,
    });
  });

  it('alta con inglés, CTA de categoría y sucursales seleccionadas', () => {
    const req = toCreateRequest({
      ...filled(),
      en: { title: 'Title', subtitle: '', ctaLabel: '', imageAlt: '' },
      ctaType: 'CATEGORY',
      categoryId: 'cat-rolls',
      branchScope: 'SELECTED',
      branchIds: ['sucursal-1'],
    });
    expect(req.translations.en).toEqual({
      title: 'Title',
      subtitle: null,
      ctaLabel: null,
      imageAlt: null,
    });
    expect(req.cta).toEqual({ type: 'CATEGORY', categoryId: 'cat-rolls' });
    expect(req.branchIds).toEqual(['sucursal-1']);
  });

  it('edición sin cambios = null (no se envía)', () => {
    expect(toUpdateRequest(bannerToForm(current), current)).toBeNull();
  });

  it('edición: solo lo que cambió + expectedVersion; nunca code ni active', () => {
    const v = bannerToForm(current);
    const patch = toUpdateRequest(
      {
        ...v,
        code: 'otro-codigo',
        active: false,
        es: { ...v.es, title: 'Nuevo', ctaLabel: '' },
        en: { ...v.en, title: 'Title', imageAlt: 'Alt en' },
        image: { ...image, assetId: 'a2' },
        sortOrder: '5',
      },
      current,
    );
    expect(patch).toEqual({
      expectedVersion: 4,
      imageAssetId: 'a2',
      translations: { es: { title: 'Nuevo', ctaLabel: null }, en: { imageAlt: 'Alt en' } },
      sortOrder: 5,
    });
    expect(patch).not.toHaveProperty('code');
    expect(patch).not.toHaveProperty('active');
  });

  it('quitar todo el inglés envía en:null; bloques de CTA, sucursales, promoción y fechas', () => {
    const v = bannerToForm(current);
    const patch = toUpdateRequest(
      {
        ...v,
        en: { title: '', subtitle: '', ctaLabel: '', imageAlt: '' },
        ctaType: 'PAGE',
        page: 'INCIDENTS',
        branchScope: 'SELECTED',
        branchIds: ['sucursal-2'],
        promotionId: 'promo-1',
        endsAt: '2026-12-01T10:00',
      },
      current,
    );
    expect(patch).toEqual({
      expectedVersion: 4,
      translations: { en: null },
      cta: { type: 'PAGE', page: 'INCIDENTS' },
      branchScope: 'SELECTED',
      branchIds: ['sucursal-2'],
      promotionId: 'promo-1',
      endsAt: '2026-12-01T16:00:00.000Z',
    });
    // Borrar un extremo envía null.
    const dated = {
      ...current,
      endsAt: '2026-12-01T16:00:00.000Z',
      promotion: { id: 'p', name: 'P', lifecycle: 'RUNNING' as const },
    };
    expect(toUpdateRequest({ ...bannerToForm(dated), endsAt: '', promotionId: '' }, dated)).toEqual(
      {
        expectedVersion: 4,
        promotionId: null,
        endsAt: null,
      },
    );
  });
});

describe('vista previa', () => {
  it('es el banner de la tienda con el mismo respaldo por campo a español', () => {
    const v = { ...filled(), en: { title: 'Title', subtitle: '', ctaLabel: '', imageAlt: '' } };
    expect(previewBanner(v, 'es')?.fallbackFields).toEqual([]);
    const en = previewBanner(v, 'en')!;
    expect(en.title).toBe('Title');
    expect(en.fallbackFields).toEqual(['ctaLabel', 'imageAlt']);
    expect(previewBanner({ ...v, image: null }, 'es')).toBeNull();
    expect(previewBanner({ ...v, es: { ...v.es, title: '' } }, 'es')).toBeNull();
  });
});

describe('errores del servidor por code', () => {
  it('mapea cada código a su campo y a la recarga', () => {
    const e = bannerServerError;
    expect(e(errorCode(409, 'BANNER_CODE_TAKEN'))).toMatchObject({
      kind: 'codeTaken',
      field: 'code',
    });
    expect(e(errorCode(409, 'BANNER_VERSION_CONFLICT'))).toMatchObject({
      kind: 'versionConflict',
      reload: true,
    });
    expect(e(errorCode(422, 'BANNER_IMAGE_INVALID'))).toMatchObject({ field: 'image' });
    expect(e(errorCode(422, 'BANNER_CTA_INVALID'))).toMatchObject({ field: 'cta' });
    expect(e(errorCode(422, 'BANNER_PERIOD_INVALID'))).toMatchObject({ field: 'endsAt' });
    expect(e(errorCode(422, 'BANNER_SCOPE_INVALID'))).toMatchObject({ field: 'branches' });
    expect(e(errorCode(422, 'BANNER_PROMOTION_INVALID'))).toMatchObject({ field: 'promotion' });
    expect(e(errorCode(422, 'BANNER_REORDER_MISMATCH'))).toMatchObject({
      kind: 'reorderMismatch',
      reload: true,
    });
    expect(e(errorCode(422, 'BANNER_LIMIT_REACHED'))).toMatchObject({ kind: 'limitReached' });
    expect(e(errorCode(403, 'BANNER_SCOPE_FORBIDDEN'))).toMatchObject({ kind: 'scopeForbidden' });
    expect(e(errorCode(404, 'BANNER_NOT_FOUND'))).toMatchObject({ kind: 'notFound', reload: true });
    expect(e(errorCode(404, 'BRANCH_NOT_FOUND'))).toMatchObject({
      field: 'branches',
      reload: true,
    });
    expect(e(errorCode(503, 'BANNERS_BUSY'))).toMatchObject({ kind: 'busy', reload: false });
    expect(e(errorCode(400))).toMatchObject({ kind: 'invalid' });
    expect(e(errorCode(401))).toMatchObject({ kind: 'unauthorized' });
    expect(e(errorCode(403))).toMatchObject({ kind: 'forbidden' });
    expect(e(new Error('boom'))).toMatchObject({ kind: 'other', message: 'boom' });
  });

  it('un 422 de traducciones apunta al campo de la violación', () => {
    expect(fieldOfViolationPath('translations.en.ctaLabel')).toBe('enCtaLabel');
    expect(fieldOfViolationPath('translations.es.imageAlt')).toBe('esImageAlt');
    expect(fieldOfViolationPath('otra.cosa')).toBeUndefined();
    expect(
      bannerServerError(errorCode(422, 'BANNER_TRANSLATION_INVALID', 'translations.es.imageAlt')),
    ).toMatchObject({ field: 'esImageAlt' });
    // Se ramifica por code, no por el texto del mensaje.
    expect(
      bannerServerError(
        new ApiError(409, 'x', 'BANNER_CODE_TAKEN', undefined, undefined, undefined),
      ),
    ).toMatchObject({ kind: 'other' });
  });
});
