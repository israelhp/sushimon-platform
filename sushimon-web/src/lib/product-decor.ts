import type { FoodArtKind } from '@/components/art/FoodArt';

/**
 * Decoración PRESENTACIONAL por slug de categoría (ilustración y rótulo japonés del prototipo). Los contratos de categorías
 * y productos no la traen (sin imágenes hasta F14): una subcategoría hereda la de su raíz; sin dato se usa `roll`.
 */
export const CATEGORY_DECOR: Readonly<Record<string, { art: FoodArtKind; jp?: string }>> = {
  entradas: { art: 'dumpling', jp: '前菜' },
  monchis: { art: 'burger', jp: 'おつまみ' },
  rolls: { art: 'roll', jp: '巻き寿司' },
  espirituosas: { art: 'sake', jp: 'お酒' },
  relax: { art: 'shake', jp: 'ソフトドリンク' },
  postres: { art: 'icecream', jp: 'デザート' },
};

/** Ilustración del primer slug conocido de la cadena (categoría, luego sus ancestros del más cercano a la raíz). */
export function artForCategorySlugs(slugs: readonly string[]): FoodArtKind {
  for (const slug of slugs) {
    const found = CATEGORY_DECOR[slug];
    if (found) return found.art;
  }
  return 'roll';
}

const DRINK_ARTS: ReadonlySet<FoodArtKind> = new Set(['sake', 'shake', 'tea', 'water', 'can']);

/** Heurística SIMULADA de «comida» (vs. bebida) cuando no hay dato del catálogo: solo afecta a un texto de la ficha. */
export const isFoodArt = (art: FoodArtKind): boolean => !DRINK_ARTS.has(art);
