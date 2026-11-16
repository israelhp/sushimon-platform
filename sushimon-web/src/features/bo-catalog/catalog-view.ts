import type { BoProductArtKind } from '@/components/icons/bo';

/**
 * Lógica pura del catálogo del backoffice: arte por categoría (el de productos F11 vive en `products-view` y el de promociones F15 en `promotions-view`). Sin React ni red: se prueba aparte.
 * Los textos viajan como códigos de error; la traducción vive en los mensajes (`backoffice.*`).
 */

// ── Arte y mosaico por categoría (CAT_ART / CAT_TILE del prototipo, mapeados a las categorías canónicas) ──

export type BoTile = 'tile-beige' | 'tile-coral' | 'tile-blue' | 'tile-navy';

const CATEGORY_LOOK: Record<string, { art: BoProductArtKind; tile: BoTile }> = {
  entradas: { art: 'dumpling', tile: 'tile-beige' },
  monchis: { art: 'soup', tile: 'tile-coral' },
  rolls: { art: 'roll', tile: 'tile-coral' },
  espirituosas: { art: 'drink', tile: 'tile-navy' },
  relax: { art: 'drink', tile: 'tile-blue' },
  postres: { art: 'dessert', tile: 'tile-coral' },
};

/** Arte y mosaico del primer slug conocido de la cadena (categoría y luego sus ancestros); sin dato, `roll`. */
export function categoryLook(slugs: readonly string[]): { art: BoProductArtKind; tile: BoTile } {
  for (const slug of slugs) {
    const found = CATEGORY_LOOK[slug];
    if (found) return found;
  }
  return { art: 'roll', tile: 'tile-beige' };
}

// ── Promociones (F15) ───────────────────────────────────────────────────────────────────────

/** Lunes a domingo, ISO (1 = lunes), en el orden de los botones. La lógica del formulario vive en `promotions-view`. */
export const ISO_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** Tono de la franja `.sg` por posición (coral, azul marino, ámbar). */
export const PROMO_TONES = ['sg-coral', 'sg-navy', 'sg-amber'] as const;
