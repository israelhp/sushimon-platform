import { FOOD_ART_KINDS, type FoodArtKind } from '@/components/art/FoodArt';
import type { Category, Product } from '@/lib/data-access/models';

/** Nombre del producto según el idioma (el contrato trae `name` en español y `nameEn` opcional). */
export function productName(product: Pick<Product, 'name' | 'nameEn'>, locale: string): string {
  return locale === 'en' ? (product.nameEn ?? product.name) : product.name;
}

export function productDescription(
  product: Pick<Product, 'description' | 'descriptionEn'>,
  locale: string,
): string {
  return locale === 'en' ? (product.descriptionEn ?? product.description) : product.description;
}

export function categoryName(category: Pick<Category, 'name' | 'nameEn'>, locale: string): string {
  return locale === 'en' ? (category.nameEn ?? category.name) : category.name;
}

const TILES = ['tile-coral', 'tile-blue', 'tile-sky', 'tile-cream'] as const;

/**
 * Fondo de ilustración (`tile tile-*`) de un producto: rota por su posición en el catálogo completo,
 * como el prototipo, para que el mismo producto tenga siempre el mismo color.
 */
export function tileClass(catalog: readonly Pick<Product, 'id'>[], productId: string): string {
  const index = Math.max(
    0,
    catalog.findIndex((p) => p.id === productId),
  );
  return `tile ${TILES[index % TILES.length]}`;
}

/** `Product.illustration` (texto del contrato) → tipo de ilustración conocido (por defecto `roll`). */
export function foodArtKind(illustration: string): FoodArtKind {
  return (FOOD_ART_KINDS as string[]).includes(illustration)
    ? (illustration as FoodArtKind)
    : 'roll';
}
