import type { FoodArtKind } from '@/components/art/FoodArt';
import { flattenPublic, type PublicNode } from '@/lib/category-tree';
import type { Product, PublicCategory } from '@/lib/data-access/models';
import { CATEGORY_DECOR } from '@/lib/product-decor';

/** Valor de `?cat=` que representa "Todo" (sin parámetro). Reservado: ninguna categoría se resuelve por ese slug. */
export const ALL_CATEGORY = 'all';

/**
 * Sección del menú: una categoría VISIBLE del árbol público (F10) con SUS productos propios (F11: `Product.categoryId` es el
 * id de la categoría real; un producto cuya categoría no esté en el árbol visible no genera sección). Una categoría sin
 * productos propios tampoco.
 */
export interface MenuSection {
  category: PublicCategory;
  /** Ancestros (de la raíz hacia la categoría); vacío en una raíz. */
  path: readonly PublicCategory[];
  products: Product[];
}

const ownsProduct = (category: PublicCategory, product: Product) =>
  product.categoryId === category.id;

/** Secciones en el orden del árbol (depth-first): solo categorías visibles con productos. */
export function menuSections(
  tree: readonly PublicCategory[],
  products: readonly Product[],
): MenuSection[] {
  return flattenPublic(tree)
    .map(({ category, path }) => ({
      category,
      path,
      products: products.filter((p) => ownsProduct(category, p)),
    }))
    .filter((s) => s.products.length > 0);
}

/** Nodo del árbol activo según `?cat=` (slug o id); desconocido, ausente o `all` => null ("Todo"). */
export function activeNode(
  tree: readonly PublicCategory[],
  param: string | null,
): PublicNode | null {
  if (!param || param === ALL_CATEGORY) return null;
  return (
    flattenPublic(tree).find((n) => n.category.slug === param || n.category.id === param) ?? null
  );
}

/** Slug de la categoría activa (`all` si ninguna). */
export function resolveCategory(tree: readonly PublicCategory[], param: string | null): string {
  return activeNode(tree, param)?.category.slug ?? ALL_CATEGORY;
}

/** Secciones de la categoría activa Y de todo su subárbol ("Todo" = todas). */
export function visibleSections(
  sections: readonly MenuSection[],
  tree: readonly PublicCategory[],
  active: string,
): readonly MenuSection[] {
  const node = activeNode(tree, active);
  if (!node) return sections;
  const ids = new Set([
    node.category.id,
    ...flattenPublic(node.category.children).map((n) => n.category.id),
  ]);
  return sections.filter((s) => ids.has(s.category.id));
}

/**
 * Filas de navegación: la 1.ª son las raíces; por cada nivel de la ruta activa (y por la propia activa) una fila con sus
 * hijas visibles. Una fila sin categorías no se emite.
 */
export function chipRows(
  tree: readonly PublicCategory[],
  active: string,
): { parent: PublicCategory | null; items: readonly PublicCategory[] }[] {
  const rows: { parent: PublicCategory | null; items: readonly PublicCategory[] }[] = [
    { parent: null, items: tree },
  ];
  const node = activeNode(tree, active);
  if (node) {
    for (const parent of [...node.path, node.category]) {
      if (parent.children.length > 0) rows.push({ parent, items: parent.children });
    }
  }
  return rows;
}

/** Slugs de la ruta activa (para marcar `aria-current` en cada nivel). */
export function activeSlugs(tree: readonly PublicCategory[], active: string): ReadonlySet<string> {
  const node = activeNode(tree, active);
  return new Set(node ? [...node.path, node.category].map((c) => c.slug) : []);
}

/** `/menu` o `/menu?cat=<slug>`. */
export function menuHref(category: string): string {
  return category === ALL_CATEGORY ? '/menu' : `/menu?cat=${encodeURIComponent(category)}`;
}

/**
 * Decoración PRESENTACIONAL por slug (ilustración y rótulo japonés del prototipo; ver `lib/product-decor`). Una subcategoría
 * hereda la de su raíz; sin dato se usa `roll`.
 */
export function categoryDecor(
  category: PublicCategory,
  path: readonly PublicCategory[] = [],
): { art: FoodArtKind; jp?: string } {
  for (const c of [category, ...[...path].reverse()]) {
    const found = CATEGORY_DECOR[c.slug];
    if (found) return found;
  }
  return { art: 'roll' };
}
