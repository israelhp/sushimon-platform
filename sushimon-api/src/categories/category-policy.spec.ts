import { BadRequestException } from '@nestjs/common';
import type { CategoryNode, CategoryRow } from './categories.types.js';
import {
  assertLimit,
  assertParentAllowed,
  assertReorderExact,
  assertSlugFree,
  buildAdminViews,
  buildVisibleTree,
  childrenIndex,
  compareSiblings,
  depthOf,
  diffCategory,
  filterAdminViews,
  indexById,
  nextSortOrder,
  normalizeDescription,
  normalizeName,
  normalizeSlug,
  normalizeUpdate,
  slugify,
  subtreeHeight,
  uniqueSlug,
  visibleIds,
} from './category-policy.js';

const node = (
  id: string,
  parentId: string | null,
  over: Partial<CategoryRow> = {},
): CategoryRow => ({
  id,
  parentId,
  slug: id,
  name: id.toUpperCase(),
  description: null,
  sortOrder: 0,
  active: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

/** a > b > c (3 niveles), a > d, e (raíz). */
const rows = (): CategoryRow[] => [
  node('a', null, { sortOrder: 0 }),
  node('b', 'a', { sortOrder: 0 }),
  node('c', 'b', { sortOrder: 0 }),
  node('d', 'a', { sortOrder: 1 }),
  node('e', null, { sortOrder: 1 }),
];

const codeOf = (fn: () => void): unknown => {
  try {
    fn();
  } catch (error) {
    return (error as { getResponse(): { code?: string } }).getResponse().code;
  }
  return undefined;
};

describe('normalización', () => {
  it('name: NFC, recorte, colapso de espacios y sin caracteres de control', () => {
    expect(normalizeName('  Rolls \t  fríos\n ')).toBe('Rolls fríos');
    expect(normalizeName('Café')).toBe('Café');
  });
  it('name vacío o > 80 => 400', () => {
    expect(() => normalizeName('   ')).toThrow(BadRequestException);
    expect(() => normalizeName('x'.repeat(81))).toThrow(BadRequestException);
    expect(normalizeName('x'.repeat(80))).toHaveLength(80);
  });
  it('description: null/vacía = null; > 500 => 400; conserva saltos de línea', () => {
    expect(normalizeDescription(null)).toBeNull();
    expect(normalizeDescription('   ')).toBeNull();
    expect(normalizeDescription(' a\nb ')).toBe('a\nb');
    expect(() => normalizeDescription('x'.repeat(501))).toThrow(BadRequestException);
  });
  it('slug explícito: minúsculas y patrón kebab; inválido => 400', () => {
    expect(normalizeSlug(' Rolls-Frios ')).toBe('rolls-frios');
    for (const bad of ['', 'a--b', '-a', 'a_b', 'ñandú', 'x'.repeat(81)]) {
      expect(() => normalizeSlug(bad)).toThrow(BadRequestException);
    }
  });
});

describe('slug autogenerado', () => {
  it('minúsculas, sin acentos, kebab', () => {
    expect(slugify('Rolls Fríos & Más!')).toBe('rolls-frios-mas');
    expect(slugify('  Ñandú  ')).toBe('nandu');
  });
  it('recorta a 80 sin guion final', () => {
    const slug = slugify(`${'a'.repeat(79)} b`);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith('-')).toBe(false);
  });
  it('sin caracteres útiles => categoria', () => {
    expect(slugify('!!!')).toBe('categoria');
  });
  it('desambigua con -2, -3… y respeta el máximo de 80', () => {
    expect(uniqueSlug('rolls', new Set())).toBe('rolls');
    expect(uniqueSlug('rolls', new Set(['rolls']))).toBe('rolls-2');
    expect(uniqueSlug('rolls', new Set(['rolls', 'rolls-2']))).toBe('rolls-3');
    const long = 'a'.repeat(80);
    const result = uniqueSlug(long, new Set([long]));
    expect(result).toBe(`${'a'.repeat(78)}-2`);
    expect(result.length).toBe(80);
  });
  it('assertSlugFree: duplicado => 409 CATEGORY_SLUG_TAKEN; el propio no cuenta', () => {
    expect(codeOf(() => assertSlugFree('a', rows()))).toBe('CATEGORY_SLUG_TAKEN');
    expect(() => assertSlugFree('a', rows(), 'a')).not.toThrow();
    expect(() => assertSlugFree('zzz', rows())).not.toThrow();
  });
});

describe('orden y árbol', () => {
  it('compareSiblings: sort_order, luego name, luego id (estable con empates)', () => {
    const list: CategoryNode[] = [
      node('3', null, { sortOrder: 1, name: 'B' }),
      node('2', null, { sortOrder: 0, name: 'b' }),
      node('1', null, { sortOrder: 0, name: 'B' }),
      node('0', null, { sortOrder: 0, name: 'a' }),
    ];
    expect([...list].sort(compareSiblings).map((n) => n.id)).toEqual(['0', '1', '2', '3']);
    expect(
      [...list]
        .reverse()
        .sort(compareSiblings)
        .map((n) => n.id),
    ).toEqual(['0', '1', '2', '3']);
  });
  it('nextSortOrder: max + 1 entre hermanos; 0 si no hay; excluye la propia', () => {
    expect(nextSortOrder(rows(), 'a')).toBe(2);
    expect(nextSortOrder(rows(), 'c')).toBe(0);
    expect(nextSortOrder(rows(), 'a', 'd')).toBe(1);
  });
  it('depthOf y subtreeHeight', () => {
    const r = rows();
    const byId = indexById(r);
    expect(depthOf('a', byId)).toBe(1);
    expect(depthOf('c', byId)).toBe(3);
    expect(subtreeHeight('a', childrenIndex(r))).toBe(3);
    expect(subtreeHeight('d', childrenIndex(r))).toBe(1);
  });
});

describe('assertParentAllowed', () => {
  const run =
    (parentId: string, movingId?: string, data = rows()) =>
    () =>
      assertParentAllowed(parentId, indexById(data), childrenIndex(data), movingId);

  it('alta: padre inexistente => PARENT_INVALID; inactivo => PARENT_INVALID', () => {
    expect(codeOf(run('zzz'))).toBe('CATEGORY_PARENT_INVALID');
    const data = rows().map((r) => (r.id === 'd' ? { ...r, active: false } : r));
    expect(codeOf(run('d', undefined, data))).toBe('CATEGORY_PARENT_INVALID');
  });
  it('alta bajo un nivel 3 => DEPTH_EXCEEDED; bajo nivel 2 => ok', () => {
    expect(codeOf(run('c'))).toBe('CATEGORY_DEPTH_EXCEEDED');
    expect(run('b')).not.toThrow();
  });
  it('mover a sí misma o a un descendiente => CATEGORY_CYCLE', () => {
    expect(codeOf(run('a', 'a'))).toBe('CATEGORY_CYCLE');
    expect(codeOf(run('c', 'a'))).toBe('CATEGORY_CYCLE');
    expect(codeOf(run('b', 'a'))).toBe('CATEGORY_CYCLE');
  });
  it('mover un subárbol que superaría 3 niveles => DEPTH_EXCEEDED (a bajo e: a-b-c quedaría en 4)', () => {
    expect(codeOf(run('e', 'a'))).toBe('CATEGORY_DEPTH_EXCEEDED');
  });
  it('mover una hoja o un subárbol de altura 1 donde cabe => ok', () => {
    expect(run('e', 'd')).not.toThrow();
    expect(codeOf(run('c', 'd'))).toBe('CATEGORY_DEPTH_EXCEEDED'); // d (nivel 2) bajo c (nivel 3) = 4
  });
  it('mover c (hoja) bajo d (nivel 2) => ok (nivel 3)', () => {
    expect(run('d', 'c')).not.toThrow();
  });
});

describe('limite y reorder', () => {
  it('tope 500', () => {
    expect(() => assertLimit(499)).not.toThrow();
    expect(codeOf(() => assertLimit(500))).toBe('CATEGORY_LIMIT_REACHED');
  });
  it('reorder exacto', () => {
    expect(() => assertReorderExact(['a', 'b'], ['b', 'a'])).not.toThrow();
    expect(() => assertReorderExact([], [])).not.toThrow();
  });
  it('reorder: faltante, ajeno, duplicado o sobrante => REORDER_MISMATCH', () => {
    for (const given of [['a'], ['a', 'b', 'x'], ['a', 'a'], ['a', 'x'], ['a', 'b', 'b']]) {
      expect(codeOf(() => assertReorderExact(['a', 'b'], given))).toBe('CATEGORY_REORDER_MISMATCH');
    }
  });
});

describe('vistas', () => {
  it('árbol público: solo visibles; un hijo activo bajo padre inactivo no aparece', () => {
    const data = rows().map((r) => (r.id === 'b' ? { ...r, active: false } : r));
    const tree = buildVisibleTree(data);
    expect(tree.map((t) => t.id)).toEqual(['a', 'e']);
    expect(tree[0]?.children.map((c) => c.id)).toEqual(['d']);
    expect(JSON.stringify(tree)).not.toContain('"c"'); // c (activa) oculta con su padre b
  });
  it('árbol público: solo expone id, slug, name, description, children', () => {
    const [first] = buildVisibleTree(rows());
    expect(Object.keys(first as object).sort()).toEqual([
      'children',
      'description',
      'id',
      'name',
      'slug',
    ]);
  });
  it('visibleIds con y sin raíz', () => {
    expect(visibleIds(rows())).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(visibleIds(rows(), 'b')).toEqual(['b', 'c']);
    const data = rows().map((r) => (r.id === 'a' ? { ...r, active: false } : r));
    expect(visibleIds(data, 'b')).toEqual([]);
    expect(visibleIds(rows(), 'zzz')).toEqual([]);
  });
  it('admin: depth-first con depth y effectivelyVisible (padre inactivo, hijo activo)', () => {
    const data = rows().map((r) => (r.id === 'b' ? { ...r, active: false } : r));
    const views = buildAdminViews(data);
    expect(views.map((v) => [v.id, v.depth, v.effectivelyVisible])).toEqual([
      ['a', 1, true],
      ['b', 2, false],
      ['c', 3, false],
      ['d', 2, true],
      ['e', 1, true],
    ]);
    expect(views.find((v) => v.id === 'c')?.active).toBe(true);
  });
  it('admin: filtros active, parentId (hijos directos) y q (sin acentos ni mayúsculas, nombre o slug)', () => {
    const data = rows().map((r) =>
      r.id === 'd' ? { ...r, active: false, name: 'Bebidas fríás', slug: 'bebidas' } : r,
    );
    const views = buildAdminViews(data);
    expect(filterAdminViews(views, { active: false }).map((v) => v.id)).toEqual(['d']);
    expect(filterAdminViews(views, { parentId: 'a' }).map((v) => v.id)).toEqual(['b', 'd']);
    expect(filterAdminViews(views, { parentId: 'zzz' })).toEqual([]);
    expect(filterAdminViews(views, { q: 'FRIAS' }).map((v) => v.id)).toEqual(['d']);
    expect(filterAdminViews(views, { q: 'bebid' }).map((v) => v.id)).toEqual(['d']);
  });
});

describe('actualización', () => {
  it('cuerpo vacío => 400', () => {
    expect(() => normalizeUpdate({})).toThrow(BadRequestException);
  });
  it('normaliza lo enviado', () => {
    expect(normalizeUpdate({ name: '  X  y ', description: '  ', parentId: null })).toEqual({
      name: 'X y',
      description: null,
      parentId: null,
    });
  });
  it('diff: solo lo que cambia; sin cambios => null', () => {
    const current = node('b', 'a', { name: 'B', description: null });
    expect(diffCategory(current, { name: 'B', parentId: 'a', active: true })).toBeNull();
    const diff = diffCategory(current, { name: 'Nuevo', slug: 'b', active: false });
    expect(diff).toEqual({
      changes: { name: 'Nuevo', active: false },
      oldValues: { name: 'B' },
      newValues: { name: 'Nuevo' },
    });
  });
});
