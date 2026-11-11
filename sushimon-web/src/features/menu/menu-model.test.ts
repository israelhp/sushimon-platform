import { describe, expect, it } from 'vitest';
import type { Category, Product } from '@/lib/data-access/models';
import {
  ALL_CATEGORY,
  menuHref,
  menuSections,
  resolveCategory,
  visibleSections,
} from './menu-model';

const category = (id: string, sortOrder: number, extra: Partial<Category> = {}): Category => ({
  id,
  name: id,
  sortOrder,
  visible: true,
  kind: 'products',
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

const CATEGORIES = [
  category('rolls', 3),
  category('entradas', 1),
  category('happy', 9, { kind: 'happy_hour' }),
  category('ocultas', 2, { visible: false }),
  category('postres', 4),
];
const PRODUCTS = [
  product('a', 'rolls'),
  product('b', 'entradas'),
  product('c', 'ocultas'),
  product('d', 'rolls'),
];

describe('menuSections', () => {
  it('ordena por sortOrder y descarta Happy Hour, ocultas y categorías sin productos', () => {
    const sections = menuSections(CATEGORIES, PRODUCTS);
    expect(sections.map((s) => s.category.id)).toEqual(['entradas', 'rolls']);
    expect(sections[1]?.products.map((p) => p.id)).toEqual(['a', 'd']);
  });

  it('sin productos no hay secciones', () => {
    expect(menuSections(CATEGORIES, [])).toEqual([]);
  });
});

describe('resolveCategory / visibleSections', () => {
  const sections = menuSections(CATEGORIES, PRODUCTS);

  it('acepta una categoría conocida y trata lo demás como "Todo"', () => {
    expect(resolveCategory('rolls', sections)).toBe('rolls');
    expect(resolveCategory('postres', sections)).toBe(ALL_CATEGORY);
    expect(resolveCategory('nada', sections)).toBe(ALL_CATEGORY);
    expect(resolveCategory(null, sections)).toBe(ALL_CATEGORY);
  });

  it('filtra las secciones visibles', () => {
    expect(visibleSections(sections, ALL_CATEGORY)).toHaveLength(2);
    expect(visibleSections(sections, 'entradas').map((s) => s.category.id)).toEqual(['entradas']);
  });
});

describe('menuHref', () => {
  it('"Todo" no lleva parámetro', () => {
    expect(menuHref(ALL_CATEGORY)).toBe('/menu');
    expect(menuHref('rolls')).toBe('/menu?cat=rolls');
  });
});
