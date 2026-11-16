import { describe, expect, it } from 'vitest';
import type { AdminCategory, PublicCategory } from '@/lib/data-access/models';
import {
  MAX_CATEGORY_DEPTH,
  childrenOf,
  compareSiblings,
  depthOf,
  descendantIds,
  findPublic,
  flattenPublic,
  flattenTree,
  isEffectivelyVisible,
  moveWithin,
  normalizeCategoryName,
  parentOptions,
  publicTree,
  slugifyCategoryName,
  subtreeHeight,
  uniqueSlug,
  validateMove,
  type TreeNode,
} from './category-tree';

const n = (
  id: string,
  parentId: string | null,
  sortOrder = 0,
  active = true,
  name = id,
): TreeNode => ({ id, parentId, sortOrder, active, name });

// a > (b > (d), c) ; e (raíz inactiva) > f
const NODES = [
  n('a', null, 0),
  n('b', 'a', 0),
  n('c', 'a', 1),
  n('d', 'b', 0),
  n('e', null, 1, false),
  n('f', 'e', 0),
];

describe('normalización y slug', () => {
  it('normaliza el nombre: NFC, control, espacios', () => {
    expect(normalizeCategoryName('  Café\t  \u0007 Mon  ')).toBe('Café Mon');
  });

  it('genera slug sin acentos, kebab, ≤ 80 y sin guiones colgantes', () => {
    expect(slugifyCategoryName('Ñoquis & Pasta ¡Hoy!')).toBe('noquis-pasta-hoy');
    expect(slugifyCategoryName('  ---  ')).toBe('');
    const long = slugifyCategoryName(`${'a'.repeat(79)} bbb`);
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith('-')).toBe(false);
  });

  it('desambigua con -2, -3… respetando el máximo', () => {
    expect(uniqueSlug('rolls', new Set())).toBe('rolls');
    expect(uniqueSlug('rolls', new Set(['rolls']))).toBe('rolls-2');
    expect(uniqueSlug('rolls', new Set(['rolls', 'rolls-2']))).toBe('rolls-3');
    const base = 'a'.repeat(80);
    expect(uniqueSlug(base, new Set([base])).length).toBeLessThanOrEqual(80);
  });
});

describe('orden estable y recorridos', () => {
  it('hermanos por sortOrder, nombre e id', () => {
    const list = [
      n('z', null, 1, true, 'B'),
      n('y', null, 0, true, 'B'),
      n('x', null, 0, true, 'A'),
      n('w', null, 0, true, 'A'),
    ];
    expect(list.sort(compareSiblings).map((x) => x.id)).toEqual(['w', 'x', 'y', 'z']);
  });

  it('flattenTree: depth-first con nivel y visibilidad efectiva', () => {
    expect(flattenTree(NODES).map((r) => [r.node.id, r.depth, r.effectivelyVisible])).toEqual([
      ['a', 1, true],
      ['b', 2, true],
      ['d', 3, true],
      ['c', 2, true],
      ['e', 1, false],
      ['f', 2, false],
    ]);
  });

  it('ancestros, profundidad, descendientes y altura', () => {
    expect(depthOf(NODES, 'd')).toBe(3);
    expect([...descendantIds(NODES, 'a')].sort()).toEqual(['b', 'c', 'd']);
    expect(subtreeHeight(NODES, 'a')).toBe(3);
    expect(subtreeHeight(NODES, 'c')).toBe(1);
    expect(childrenOf(NODES, 'a').map((x) => x.id)).toEqual(['b', 'c']);
  });

  it('es seguro ante datos corruptos con ciclos (no itera sin fin)', () => {
    const cyclic = [n('p', 'q'), n('q', 'p')];
    expect(depthOf(cyclic, 'p')).toBeLessThanOrEqual(2);
    expect(flattenTree(cyclic)).toEqual([]);
    expect(subtreeHeight(cyclic, 'p')).toBeGreaterThan(0);
  });

  it('visibilidad efectiva: activa con todos los ancestros activos', () => {
    expect(isEffectivelyVisible(NODES, 'd')).toBe(true);
    expect(isEffectivelyVisible(NODES, 'f')).toBe(false);
    expect(isEffectivelyVisible(NODES, 'e')).toBe(false);
    expect(isEffectivelyVisible(NODES, 'nada')).toBe(false);
  });
});

describe('validateMove: ciclos y profundidad', () => {
  it('ella misma o un descendiente => CATEGORY_CYCLE', () => {
    expect(validateMove(NODES, 'a', 'a')).toBe('CATEGORY_CYCLE');
    expect(validateMove(NODES, 'a', 'b')).toBe('CATEGORY_CYCLE');
    expect(validateMove(NODES, 'a', 'd')).toBe('CATEGORY_CYCLE');
    expect(validateMove(NODES, 'b', 'd')).toBe('CATEGORY_CYCLE');
  });

  it('padre inexistente o inactivo => CATEGORY_PARENT_INVALID', () => {
    expect(validateMove(NODES, 'c', 'nada')).toBe('CATEGORY_PARENT_INVALID');
    expect(validateMove(NODES, 'c', 'e')).toBe('CATEGORY_PARENT_INVALID');
    // Activa pero oculta por un ancestro inactivo: tampoco recibe hijos (spec 011 D3).
    expect(validateMove(NODES, 'c', 'f')).toBe('CATEGORY_PARENT_INVALID');
  });

  it('subárbol resultante > 3 niveles => CATEGORY_DEPTH_EXCEEDED', () => {
    expect(MAX_CATEGORY_DEPTH).toBe(3);
    // b (altura 2) bajo c (nivel 2) => 4 niveles
    expect(validateMove(NODES, 'b', 'c')).toBe('CATEGORY_DEPTH_EXCEEDED');
    // c (hoja) bajo d (nivel 3) => 4 niveles
    expect(validateMove(NODES, 'c', 'd')).toBe('CATEGORY_DEPTH_EXCEEDED');
  });

  it('movimientos válidos', () => {
    expect(validateMove(NODES, 'd', null)).toBeNull();
    expect(validateMove(NODES, 'c', 'b')).toBeNull(); // c queda en nivel 3
    expect(validateMove(NODES, 'b', 'a')).toBeNull(); // ya es su padre
  });
});

describe('árbol público y utilidades de UI', () => {
  const records = NODES.map((x) => ({ ...x, slug: x.id, description: null }));

  it('publicTree: solo visibles, anidado y ordenado', () => {
    const tree = publicTree(records);
    expect(tree.map((c) => c.slug)).toEqual(['a']);
    expect(tree[0]?.children.map((c) => c.slug)).toEqual(['b', 'c']);
    expect(tree[0]?.children[0]?.children.map((c) => c.slug)).toEqual(['d']);
    expect(Object.keys(tree[0] as PublicCategory).sort()).toEqual([
      'children',
      'description',
      'id',
      'name',
      'slug',
    ]);
  });

  it('un hijo activo bajo un padre inactivo no se publica', () => {
    const tree = publicTree(records.map((r) => (r.id === 'b' ? { ...r, active: false } : r)));
    expect(JSON.stringify(tree)).not.toContain('"d"');
    expect(tree[0]?.children.map((c) => c.slug)).toEqual(['c']);
  });

  it('flattenPublic / findPublic con ruta de ancestros', () => {
    const tree = publicTree(records);
    expect(flattenPublic(tree).map((x) => x.category.slug)).toEqual(['a', 'b', 'd', 'c']);
    expect(findPublic(tree, 'd')?.path.map((c) => c.slug)).toEqual(['a', 'b']);
    expect(findPublic(tree, 'nada')).toBeNull();
    expect(findPublic(tree, null)).toBeNull();
  });

  it('moveWithin respeta los extremos', () => {
    expect(moveWithin(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveWithin(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moveWithin(['a', 'b', 'c'], 'a', -1)).toBeNull();
    expect(moveWithin(['a', 'b', 'c'], 'c', 1)).toBeNull();
    expect(moveWithin(['a'], 'z', 1)).toBeNull();
  });

  it('parentOptions excluye la propia, sus descendientes, inactivas y las que superan la profundidad', () => {
    const list: AdminCategory[] = flattenTree(NODES).map(({ node, depth, effectivelyVisible }) => ({
      ...node,
      slug: node.id,
      description: null,
      depth,
      effectivelyVisible,
      createdAt: '',
      updatedAt: '',
    }));
    // Alta: todas las activas con depth+1 <= 3 (d está en nivel 3: no admite hijos).
    expect(parentOptions(list, null).map((c) => c.id)).toEqual(['a', 'b', 'c']);
    // Editar b (altura 2): destinos con depth + 2 <= 3 => solo raíces activas distintas de sí; a es su padre actual.
    expect(parentOptions(list, 'b').map((c) => c.id)).toEqual(['a']);
    // Editar a: no puede ir bajo sí misma ni sus descendientes.
    expect(parentOptions(list, 'a').map((c) => c.id)).toEqual([]);
  });
});
