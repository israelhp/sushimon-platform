import type { AdminCategory } from '@/lib/data-access/models';

/**
 * F10 — Categorías del menú (jerarquía de hasta 3 niveles) para el mock. Mismo modelo que `app.categories`: sin
 * `depth` ni `effectivelyVisible` (los calcula el handler como el servidor).
 *
 * Los slugs de las raíces coinciden con los ids de las categorías del catálogo simulado de productos (`entradas`,
 * `monchis`, `rolls`…): hasta F11 los productos mock referencian su categoría por ese texto y el menú los une por `slug`.
 * Hay subcategorías (sin productos mock todavía), una raíz INACTIVA con un hijo activo (ejemplo de visibilidad efectiva) y
 * nombres/descripciones sin traducción: son del restaurante.
 */
export type CategoryRecord = Omit<AdminCategory, 'depth' | 'effectivelyVisible'>;

const AT = '2026-11-01T12:00:00.000Z';

const seed = (
  id: string,
  parentId: string | null,
  slug: string,
  name: string,
  sortOrder: number,
  active = true,
  description: string | null = null,
): CategoryRecord => ({
  id,
  parentId,
  slug,
  name,
  description,
  sortOrder,
  active,
  createdAt: AT,
  updatedAt: AT,
});

export const MENU_CATEGORY_SEEDS: readonly CategoryRecord[] = [
  seed('cat-entradas', null, 'entradas', 'Entradas', 0),
  seed('cat-monchis', null, 'monchis', 'Monchis', 1),
  seed('cat-rolls', null, 'rolls', 'Sushi Rolls', 2, true, 'Rolls clásicos y de la casa'),
  seed('cat-rolls-frios', 'cat-rolls', 'rolls-frios', 'Rolls fríos', 0),
  seed('cat-rolls-tempura', 'cat-rolls', 'rolls-tempura', 'Rolls tempura', 1),
  seed('cat-espirituosas', null, 'espirituosas', 'Bebidas espirituosas', 3),
  seed('cat-relax', null, 'relax', 'Bebidas relax', 4),
  seed('cat-postres', null, 'postres', 'Postres', 5),
  seed(
    'cat-temporada',
    null,
    'temporada',
    'Temporada',
    6,
    false,
    'Oculta hasta la próxima campaña',
  ),
  seed('cat-temporada-edicion', 'cat-temporada', 'edicion-limitada', 'Edición limitada', 0),
];
