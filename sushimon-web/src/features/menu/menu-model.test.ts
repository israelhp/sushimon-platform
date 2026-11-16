import { describe, expect, it } from 'vitest';
import type { Product, PublicCategory } from '@/lib/data-access/models';
import {
  ALL_CATEGORY,
  activeNode,
  activeSlugs,
  categoryDecor,
  chipRows,
  menuHref,
  menuSections,
  resolveCategory,
  visibleSections,
} from './menu-model';

const category = (
  slug: string,
  children: PublicCategory[] = [],
  extra: Partial<PublicCategory> = {},
): PublicCategory => ({
  id: `id-${slug}`,
  slug,
  name: slug,
  description: null,
  children,
  ...extra,
});
const product = (id: string, categoryId: string): Product => ({
  id,
  name: id,
  description: '',
  price: 10,
  categoryId,
  illustration: 'roll',
  featured: false,
  food: true,
  available: true,
  availability: [],
});

// entradas · rolls (rolls-frios, rolls-tempura > especial) · postres (sin productos)
const TREE: PublicCategory[] = [
  category('entradas'),
  category('rolls', [category('rolls-frios'), category('rolls-tempura', [category('especial')])]),
  category('postres'),
];
const PRODUCTS = [
  product('a', 'id-rolls'),
  product('b', 'id-entradas'),
  product('c', 'categoria-oculta'),
  product('d', 'id-rolls'),
  product('e', 'id-rolls-frios'),
  product('f', 'id-especial'),
];

describe('menuSections', () => {
  it('recorre el árbol en orden, une productos por id de categoría y descarta categorías sin productos', () => {
    const sections = menuSections(TREE, PRODUCTS);
    expect(sections.map((s) => s.category.slug)).toEqual([
      'entradas',
      'rolls',
      'rolls-frios',
      'especial',
    ]);
    expect(sections.find((s) => s.category.slug === 'rolls')?.products.map((p) => p.id)).toEqual([
      'a',
      'd',
    ]);
    // La ruta de ancestros acompaña a la sección.
    expect(sections.at(-1)?.path.map((c) => c.slug)).toEqual(['rolls', 'rolls-tempura']);
  });

  it('un producto cuya categoría no está en el árbol visible no aparece (categorías inactivas ocultas)', () => {
    const all = menuSections(TREE, PRODUCTS).flatMap((s) => s.products.map((p) => p.id));
    expect(all).not.toContain('c');
  });

  it('sin productos o sin árbol no hay secciones', () => {
    expect(menuSections(TREE, [])).toEqual([]);
    expect(menuSections([], PRODUCTS)).toEqual([]);
  });
});

describe('resolveCategory / activeNode / visibleSections', () => {
  const sections = menuSections(TREE, PRODUCTS);

  it('acepta cualquier nivel por slug (o id) y trata lo desconocido como "Todo"', () => {
    expect(resolveCategory(TREE, 'rolls')).toBe('rolls');
    expect(resolveCategory(TREE, 'rolls-frios')).toBe('rolls-frios');
    expect(resolveCategory(TREE, 'id-especial')).toBe('especial');
    expect(resolveCategory(TREE, 'nada')).toBe(ALL_CATEGORY);
    expect(resolveCategory(TREE, ALL_CATEGORY)).toBe(ALL_CATEGORY);
    expect(resolveCategory(TREE, null)).toBe(ALL_CATEGORY);
    expect(activeNode(TREE, 'especial')?.path.map((c) => c.slug)).toEqual([
      'rolls',
      'rolls-tempura',
    ]);
  });

  it('la categoría activa incluye su subárbol', () => {
    expect(visibleSections(sections, TREE, ALL_CATEGORY)).toHaveLength(4);
    expect(visibleSections(sections, TREE, 'entradas').map((s) => s.category.slug)).toEqual([
      'entradas',
    ]);
    expect(visibleSections(sections, TREE, 'rolls').map((s) => s.category.slug)).toEqual([
      'rolls',
      'rolls-frios',
      'especial',
    ]);
    expect(visibleSections(sections, TREE, 'rolls-frios').map((s) => s.category.slug)).toEqual([
      'rolls-frios',
    ]);
    // Existe en el árbol pero sin productos: vacío (la pantalla muestra el aviso de categoría vacía).
    expect(visibleSections(sections, TREE, 'postres')).toEqual([]);
  });
});

describe('chipRows / activeSlugs', () => {
  it('"Todo" solo muestra las raíces', () => {
    const rows = chipRows(TREE, ALL_CATEGORY);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.items.map((c) => c.slug)).toEqual(['entradas', 'rolls', 'postres']);
  });

  it('una raíz con hijas agrega una fila; una categoría de nivel 2 con hijas, otra', () => {
    expect(chipRows(TREE, 'entradas')).toHaveLength(1); // hoja
    const rolls = chipRows(TREE, 'rolls');
    expect(rolls.map((r) => r.parent?.slug ?? null)).toEqual([null, 'rolls']);
    const tempura = chipRows(TREE, 'rolls-tempura');
    expect(tempura.map((r) => r.parent?.slug ?? null)).toEqual([null, 'rolls', 'rolls-tempura']);
    expect(tempura[2]?.items.map((c) => c.slug)).toEqual(['especial']);
  });

  it('la ruta activa marca a los ancestros', () => {
    expect([...activeSlugs(TREE, 'especial')].sort()).toEqual([
      'especial',
      'rolls',
      'rolls-tempura',
    ]);
    expect(activeSlugs(TREE, ALL_CATEGORY).size).toBe(0);
  });
});

describe('categoryDecor', () => {
  it('una subcategoría hereda la ilustración de su raíz; sin dato usa roll', () => {
    const rolls = TREE[1] as PublicCategory;
    expect(categoryDecor(rolls.children[0] as PublicCategory, [rolls]).art).toBe('roll');
    expect(categoryDecor(category('entradas')).art).toBe('dumpling');
    expect(categoryDecor(category('otra-cosa')).art).toBe('roll');
    expect(categoryDecor(category('hija'), [category('postres')]).art).toBe('icecream');
  });
});

describe('menuHref', () => {
  it('"Todo" no lleva parámetro', () => {
    expect(menuHref(ALL_CATEGORY)).toBe('/menu');
    expect(menuHref('rolls')).toBe('/menu?cat=rolls');
  });
});
