import { assetid, bnid } from '../../test/support/fake-banners-repo.js';
import { scopedStaff } from '../../test/support/staff-context.js';
import {
  applyTextPatch,
  assertPeriod,
  assertScopeShape,
  assertTranslations,
  covers,
  diffDraft,
  lifecycleOf,
  normalizeCode,
  normalizeReason,
  normalizeText,
  promotionCoversBanner,
  rawCtaOf,
  textFromInput,
  textPatchOf,
  touches,
  validateCta,
} from './banner-policy.js';
import type { BannerDraft } from './banners.types.js';

const info = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (e) {
    const x = e as { getStatus?: () => number; getResponse?: () => unknown };
    const body = (x.getResponse?.() ?? {}) as {
      code?: string;
      violations?: { path: string; code: string }[];
    };
    return { status: x.getStatus?.(), code: body.code, violations: body.violations };
  }
};

describe('normalizeCode', () => {
  it('recorta y pasa a minúsculas', () => {
    expect(normalizeCode('  Verano-2026 ')).toBe('verano-2026');
  });
  it.each(['ab', '-abc', 'con espacio', 'ñandú', 'a'.repeat(65), 'a_b_c'])(
    'rechaza %j con 400',
    (code) => {
      expect(info(() => normalizeCode(code))).toMatchObject({ status: 400 });
    },
  );
});

describe('normalizeText', () => {
  it('NFC, controles a espacio, espacios colapsados y recorte', () => {
    expect(normalizeText('title', '  Rolls \t del\n mes ')).toBe('Rolls del mes');
    expect(normalizeText('title', 'é')).toBe('é');
  });
  it('en blanco o null => ausente', () => {
    expect(normalizeText('subtitle', '   ')).toBeNull();
    expect(normalizeText('subtitle', null)).toBeNull();
    expect(normalizeText('subtitle', undefined)).toBeNull();
  });
  it('rechaza NUL y controles bidireccionales con 400', () => {
    expect(info(() => normalizeText('title', 'a\u0000b'))).toMatchObject({ status: 400 });
    expect(info(() => normalizeText('title', 'a‮b'))).toMatchObject({ status: 400 });
    expect(info(() => normalizeText('imageAlt', 'a⁦b'))).toMatchObject({ status: 400 });
  });
  it('respeta el tope por campo (título 80, subtítulo 160, etiqueta 40, alt 200)', () => {
    expect(normalizeText('title', 'a'.repeat(80))).toHaveLength(80);
    expect(info(() => normalizeText('title', 'a'.repeat(81)))).toMatchObject({ status: 400 });
    expect(info(() => normalizeText('subtitle', 'a'.repeat(161)))).toMatchObject({ status: 400 });
    expect(info(() => normalizeText('ctaLabel', 'a'.repeat(41)))).toMatchObject({ status: 400 });
    expect(info(() => normalizeText('imageAlt', 'a'.repeat(201)))).toMatchObject({ status: 400 });
  });
});

describe('invisibles de ancho cero y motivo (B1, B2)', () => {
  it.each(['\u200B', '\u200C', '\u200D', '\u2060', '\u00AD', '\uFEFF'])(
    'un texto solo con %j cuenta como ausente; mezclado se eliminan',
    (ch) => {
      expect(normalizeText('title', ` ${ch}${ch} `)).toBeNull();
      expect(normalizeText('title', `Ho${ch}la`)).toBe('Hola');
    },
  );
  it('título o alt solo con invisibles => 422 BANNER_TRANSLATION_INVALID (ausente)', () => {
    const es = textFromInput('es', { title: '\u200B\u2060', imageAlt: '\uFEFF' });
    expect(info(() => assertTranslations(es))).toMatchObject({
      status: 422,
      code: 'BANNER_TRANSLATION_INVALID',
      violations: [{ path: 'translations.es.title' }, { path: 'translations.es.imageAlt' }],
    });
  });
  it('reason: una línea, recortado; NUL/bidi => 400; en blanco o solo invisibles => null; > 200 => 400', () => {
    expect(normalizeReason(undefined)).toBeNull();
    expect(normalizeReason('  fin \n de   campaña ')).toBe('fin de campaña');
    expect(normalizeReason(' \u200B ')).toBeNull();
    expect(info(() => normalizeReason('a\u0000b'))).toMatchObject({ status: 400 });
    expect(info(() => normalizeReason('a\u202Eb'))).toMatchObject({ status: 400 });
    expect(info(() => normalizeReason('a'.repeat(201)))).toMatchObject({ status: 400 });
  });
});

describe('traducciones', () => {
  it('es obligatoria con título y alt; en blanco no cuenta', () => {
    const es = textFromInput('es', { title: '   ', imageAlt: 'alt' });
    expect(info(() => assertTranslations(es))).toMatchObject({
      status: 422,
      code: 'BANNER_TRANSLATION_INVALID',
      violations: [{ path: 'translations.es.title', code: 'REQUIRED' }],
    });
    expect(info(() => assertTranslations(textFromInput('es', { title: 'T' })))).toMatchObject({
      violations: [{ path: 'translations.es.imageAlt' }],
    });
    expect(
      info(() => assertTranslations(textFromInput('es', { title: 'T', imageAlt: 'A' }))),
    ).toBeNull();
  });
  it('parche: omitir no reemplaza; null borra el campo', () => {
    const before = { title: 'T', subtitle: 'S', ctaLabel: 'C', imageAlt: 'A' };
    expect(applyTextPatch(before, textPatchOf('es', { subtitle: 'Nuevo' }))).toEqual({
      ...before,
      subtitle: 'Nuevo',
    });
    expect(applyTextPatch(before, textPatchOf('es', { subtitle: null, ctaLabel: ' ' }))).toEqual({
      ...before,
      subtitle: null,
      ctaLabel: null,
    });
    expect(applyTextPatch(null, textPatchOf('en', { title: 'Hi' }))).toEqual({
      title: 'Hi',
      subtitle: null,
      ctaLabel: null,
      imageAlt: null,
    });
  });
});

describe('validateCta (destino estructurado, sin rutas ni URL de texto libre)', () => {
  const ok = (input: Parameters<typeof rawCtaOf>[0]) => validateCta(rawCtaOf(input));
  it('tipos sin referencia', () => {
    for (const type of ['NONE', 'MENU', 'PROMOTIONS'] as const)
      expect(ok({ type })).toEqual({ type, categoryId: null, productId: null, page: null });
  });
  it('CATEGORY, PRODUCT y PAGE con su referencia', () => {
    expect(ok({ type: 'CATEGORY', categoryId: bnid(1) }).categoryId).toBe(bnid(1));
    expect(ok({ type: 'PRODUCT', productId: bnid(2) }).productId).toBe(bnid(2));
    expect(ok({ type: 'PAGE', page: 'CAREERS' }).page).toBe('CAREERS');
  });
  it.each([
    ['CATEGORY sin categoryId', { type: 'CATEGORY' as const }, 'cta.categoryId'],
    [
      'CATEGORY con productId',
      { type: 'CATEGORY' as const, categoryId: bnid(1), productId: bnid(2) },
      'cta.productId',
    ],
    ['PRODUCT sin productId', { type: 'PRODUCT' as const }, 'cta.productId'],
    ['PAGE sin page', { type: 'PAGE' as const }, 'cta.page'],
    ['MENU con categoryId', { type: 'MENU' as const, categoryId: bnid(1) }, 'cta.categoryId'],
    ['NONE con page', { type: 'NONE' as const, page: 'CAREERS' }, 'cta.page'],
  ])('%s => 422 BANNER_CTA_INVALID FIELD_MISMATCH', (_n, input, path) => {
    expect(info(() => ok(input))).toMatchObject({
      status: 422,
      code: 'BANNER_CTA_INVALID',
      violations: [{ path, code: 'FIELD_MISMATCH' }],
    });
  });
  it.each([
    'javascript:alert(1)',
    'data:text/html,x',
    '//evil.com',
    '/menu',
    'https://x.com',
    'careers',
  ])('página fuera de la lista blanca %j => 422 TARGET_UNKNOWN', (page) => {
    expect(info(() => ok({ type: 'PAGE', page }))).toMatchObject({
      status: 422,
      code: 'BANNER_CTA_INVALID',
      violations: [{ path: 'cta.page', code: 'TARGET_UNKNOWN' }],
    });
  });
});

describe('periodo y alcance', () => {
  it('fin > inicio; extremos nulos permitidos; fin <= inicio => 422', () => {
    const a = new Date('2026-01-01T00:00:00Z');
    const b = new Date('2026-01-02T00:00:00Z');
    expect(info(() => assertPeriod(a, b))).toBeNull();
    expect(info(() => assertPeriod(null, b))).toBeNull();
    expect(info(() => assertPeriod(a, null))).toBeNull();
    expect(info(() => assertPeriod(null, null))).toBeNull();
    expect(info(() => assertPeriod(a, a))).toMatchObject({
      status: 422,
      code: 'BANNER_PERIOD_INVALID',
    });
    expect(info(() => assertPeriod(b, a))).toMatchObject({ code: 'BANNER_PERIOD_INVALID' });
  });
  it('ALL sin ids y SELECTED con ids => si no, 422 BANNER_SCOPE_INVALID', () => {
    expect(info(() => assertScopeShape('ALL', []))).toBeNull();
    expect(info(() => assertScopeShape('SELECTED', [bnid(1)]))).toBeNull();
    expect(info(() => assertScopeShape('ALL', [bnid(1)]))).toMatchObject({
      status: 422,
      code: 'BANNER_SCOPE_INVALID',
    });
    expect(info(() => assertScopeShape('SELECTED', []))).toMatchObject({
      code: 'BANNER_SCOPE_INVALID',
    });
  });
  it('touches/covers por alcance', () => {
    const scoped = scopedStaff(['banners.read'], ['a', 'b']).grants['banners.read']!;
    const global = { allBranches: true, branchIds: [] };
    expect(touches(global, [])).toBe(true);
    expect(touches(scoped, [])).toBe(true); // ALL toca a un actor acotado
    expect(touches(scoped, ['x'])).toBe(false);
    expect(touches(scoped, ['x', 'a'])).toBe(true);
    expect(covers(global, [])).toBe(true);
    expect(covers(scoped, [])).toBe(false); // ALL exige global
    expect(covers(scoped, ['a', 'b'])).toBe(true);
    expect(covers(scoped, ['a', 'x'])).toBe(false);
  });
  it('promotionCoversBanner: ALL exige promoción ALL; SELECTED, subconjunto', () => {
    expect(promotionCoversBanner([], 'ALL', [])).toBe(true);
    expect(promotionCoversBanner([bnid(1)], 'ALL', [])).toBe(false);
    expect(promotionCoversBanner([], 'SELECTED', ['a'])).toBe(true);
    expect(promotionCoversBanner(['a', 'b'], 'SELECTED', ['a'])).toBe(true);
    expect(promotionCoversBanner(['a'], 'SELECTED', ['a', 'b'])).toBe(false);
  });
});

describe('lifecycleOf (INACTIVE > EXPIRED > SCHEDULED > PUBLISHED)', () => {
  const now = Date.parse('2026-11-16T22:00:00Z');
  const at = (ms: number) => new Date(now + ms);
  it.each([
    ['inactivo aunque esté vencido', { active: false, startsAt: null, endsAt: at(-1) }, 'INACTIVE'],
    [
      'fin exclusivo: ends_at = ahora está vencido',
      { active: true, startsAt: null, endsAt: at(0) },
      'EXPIRED',
    ],
    ['inicio futuro', { active: true, startsAt: at(1), endsAt: null }, 'SCHEDULED'],
    ['inicio = ahora', { active: true, startsAt: at(0), endsAt: null }, 'PUBLISHED'],
    ['sin fechas', { active: true, startsAt: null, endsAt: null }, 'PUBLISHED'],
    ['fin 1 ms después', { active: true, startsAt: null, endsAt: at(1) }, 'PUBLISHED'],
  ])('%s', (_n, b, expected) => {
    expect(lifecycleOf(b, now)).toBe(expected);
  });
});

describe('diffDraft', () => {
  const base = (): BannerDraft => ({
    code: 'a-b-c',
    imageAssetId: assetid(1),
    translations: { es: { title: 'T', subtitle: null, ctaLabel: null, imageAlt: 'A' }, en: null },
    cta: { type: 'MENU', categoryId: null, productId: null, page: null },
    branchScope: 'ALL',
    branchIds: [],
    promotionId: null,
    startsAt: null,
    endsAt: null,
    sortOrder: 0,
    active: true,
  });
  it('sin cambios => null', () => {
    expect(diffDraft(base(), base())).toBeNull();
  });
  it('registra solo lo cambiado: imagen, CTA, fechas, sucursales, prioridad y claves de texto', () => {
    const after: BannerDraft = {
      ...base(),
      imageAssetId: assetid(2),
      cta: { type: 'PAGE', categoryId: null, productId: null, page: 'CAREERS' },
      startsAt: new Date('2026-12-01T00:00:00Z'),
      branchScope: 'SELECTED',
      branchIds: ['b', 'a'],
      sortOrder: 5,
      translations: {
        es: { title: 'T2', subtitle: null, ctaLabel: null, imageAlt: 'A' },
        en: { title: 'Hi', subtitle: null, ctaLabel: null, imageAlt: null },
      },
    };
    const diff = diffDraft(base(), after)!;
    expect(diff.oldValues).toMatchObject({
      imageAssetId: assetid(1),
      ctaType: 'MENU',
      ctaPage: null,
      startsAt: null,
      branchScope: 'ALL',
      branchIds: [],
      sortOrder: 0,
    });
    expect(diff.newValues).toMatchObject({
      imageAssetId: assetid(2),
      ctaType: 'PAGE',
      ctaPage: 'CAREERS',
      startsAt: '2026-12-01T00:00:00.000Z',
      branchScope: 'SELECTED',
      branchIds: ['a', 'b'],
      sortOrder: 5,
      changedTextFields: ['es.title', 'en.title'],
    });
    expect(diff.translations).toBeDefined();
    expect(diff.oldValues).not.toHaveProperty('endsAt');
    expect(diff.newValues).not.toHaveProperty('promotionId');
  });
  it('el orden de las sucursales no cuenta', () => {
    const a = { ...base(), branchScope: 'SELECTED' as const, branchIds: ['x', 'y'] };
    const b = { ...a, branchIds: ['y', 'x'] };
    expect(diffDraft(a, b)).toBeNull();
  });
});
