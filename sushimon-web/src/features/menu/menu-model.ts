import type { Category, Product } from '@/lib/data-access/models';

/** Valor de `?cat=` que representa "Todo" (sin parámetro). */
export const ALL_CATEGORY = 'all';

export interface MenuSection {
  category: Category;
  products: Product[];
}

/**
 * Categorías con productos, en el orden del catálogo (`sortOrder`). Excluye el acceso a Happy Hour
 * (`kind: 'happy_hour'`) y las ocultas; una categoría sin productos no se muestra.
 */
export function menuSections(
  categories: readonly Category[],
  products: readonly Product[],
): MenuSection[] {
  return [...categories]
    .filter((c) => c.kind === 'products' && c.visible)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((category) => ({
      category,
      products: products.filter((p) => p.categoryId === category.id),
    }))
    .filter((s) => s.products.length > 0);
}

/** Categoría activa según `?cat=`: un id desconocido (o ausente) equivale a "Todo". */
export function resolveCategory(param: string | null, sections: readonly MenuSection[]): string {
  return sections.find((s) => s.category.id === param)?.category.id ?? ALL_CATEGORY;
}

export function visibleSections(
  sections: readonly MenuSection[],
  active: string,
): readonly MenuSection[] {
  return active === ALL_CATEGORY ? sections : sections.filter((s) => s.category.id === active);
}

/** `/menu` o `/menu?cat=<id>`. */
export function menuHref(category: string): string {
  return category === ALL_CATEGORY ? '/menu' : `/menu?cat=${encodeURIComponent(category)}`;
}
