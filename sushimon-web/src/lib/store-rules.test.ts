import { describe, expect, it } from 'vitest';
import {
  STORE_SUMMARY_MAX,
  canonicalSearchText,
  earliestInstant,
  foldText,
  isSearchable,
  nextSearchPage,
  normalizeSearchText,
  searchGroup,
  storeMenuQuery,
  storeSearchQuery,
  summarize,
} from './store-rules';

describe('store-rules · texto de búsqueda', () => {
  it('recorta y quita caracteres de control; la forma canónica va en minúsculas', () => {
    expect(normalizeSearchText('  Roll\u0000\u0007 ')).toBe('Roll');
    expect(canonicalSearchText('  SalMón ')).toBe('salmón');
  });
  it('es buscable solo con 2 a 80 caracteres TRAS recortar', () => {
    expect(isSearchable('a')).toBe(false);
    expect(isSearchable(' a ')).toBe(false);
    expect(isSearchable('ab')).toBe(true);
    expect(isSearchable('x'.repeat(80))).toBe(true);
    expect(isSearchable('x'.repeat(81))).toBe(false);
    expect(isSearchable('\u0001\u0002 ')).toBe(false);
  });
  it('pliega acentos y mayúsculas; los comodines son texto literal', () => {
    expect(foldText('Salmón')).toBe('salmon');
    expect(foldText('100%_')).toBe('100%_');
  });
  it('agrupa por relevancia: prefijo del nombre, contiene en el nombre, descripción o categoría', () => {
    const p = { name: 'Roll Salmón', description: 'con aguacate' };
    expect(searchGroup(p, 'Rolls', 'roll')).toBe(0);
    expect(searchGroup(p, 'Rolls', 'salmon')).toBe(1);
    expect(searchGroup(p, 'Rolls', 'aguacate')).toBe(2);
    expect(searchGroup({ name: 'X', description: null }, 'Postres', 'postre')).toBe(2);
    expect(searchGroup(p, 'Rolls', 'zzz')).toBeNull();
  });
});

describe('store-rules · resumen', () => {
  it('null sin descripción; texto corto intacto', () => {
    expect(summarize(null)).toBeNull();
    expect(summarize('   ')).toBeNull();
    expect(summarize('Roll   de\nsalmón')).toBe('Roll de salmón');
  });
  it('recorta a ≤ 160 sin partir palabras', () => {
    const text = Array.from({ length: 60 }, () => 'palabra').join(' ');
    const out = summarize(text) ?? '';
    expect(out.length).toBeLessThanOrEqual(STORE_SUMMARY_MAX);
    expect(out.endsWith('palabra')).toBe(true);
    expect(text.startsWith(out)).toBe(true);
  });
});

describe('store-rules · URL canónica', () => {
  it('menú: orden fijo de claves y sin valores por defecto (clave de CDN estable)', () => {
    const a = storeMenuQuery({ branchId: 'b', sort: 'menu', order: 'asc', page: 1, pageSize: 100 });
    expect(Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined))).toEqual({
      branchId: 'b',
    });
    const b = storeMenuQuery({
      pageSize: 20,
      page: 2,
      order: 'desc',
      sort: 'price',
      available: true,
      categorySlug: 'rolls',
      branchId: 'b',
    });
    expect(Object.keys(b)).toEqual([
      'branchId',
      'categorySlug',
      'available',
      'sort',
      'order',
      'page',
      'pageSize',
    ]);
    expect(b).toMatchObject({ sort: 'price', order: 'desc', page: 2, pageSize: 20 });
  });
  it('menú: `order` se ignora con sort=menu y `available=false` se omite', () => {
    const q = storeMenuQuery({ sort: 'menu', order: 'desc', available: false });
    expect(q.order).toBeUndefined();
    expect(q.available).toBeUndefined();
  });
  it('búsqueda: q recortada y en minúsculas; page=1 y pageSize=20 se omiten', () => {
    expect(storeSearchQuery({ q: '  SALMÓN ', page: 1, pageSize: 20 })).toMatchObject({
      q: 'salmón',
      page: undefined,
      pageSize: undefined,
    });
    expect(storeSearchQuery({ q: 'ab', page: 3, pageSize: 10 })).toMatchObject({
      page: 3,
      pageSize: 10,
    });
  });
  it('«Ver más»: siguiente página hasta el total y nunca pasa de 20 páginas', () => {
    expect(nextSearchPage({ page: 1, pageSize: 20, total: 45 })).toBe(2);
    expect(nextSearchPage({ page: 3, pageSize: 20, total: 45 })).toBeUndefined();
    expect(nextSearchPage({ page: 20, pageSize: 50, total: 5000 })).toBeUndefined();
  });
});

describe('store-rules · tiempo', () => {
  it('earliestInstant elige el menor no nulo', () => {
    expect(
      earliestInstant([null, '2026-11-11T21:00:00.000Z', undefined, '2026-11-11T20:30:00.000Z']),
    ).toBe('2026-11-11T20:30:00.000Z');
    expect(earliestInstant([null, undefined])).toBeNull();
  });
});
