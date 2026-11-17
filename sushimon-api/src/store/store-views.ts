import type { IndicativePromotion } from '../promotions/public-promotions.service.js';
import { summarize } from './store-policy.js';
import type { CardRow } from './store-catalog.types.js';

/** Tarjeta pública de un producto (contrato `StoreBranchMenuItem`). Lista blanca: nada administrativo ni el precio base. */
export interface StoreCardView {
  productId: string;
  slug: string;
  price: string;
  available: boolean | null;
  name: string;
  summary: string | null;
  image: { url: string; altText: string | null } | null;
  category: { id: string; slug: string; name: string };
  promo: IndicativePromotion | null;
}

export interface StoreCardsPageView {
  branchId: string | null;
  items: StoreCardView[];
  page: number;
  pageSize: number;
  total: number;
  generatedAt: string;
  nextChangeAt: string | null;
}

/** Arma la tarjeta; `null` si la categoría ya no es visible (carrera entre lecturas): el producto se omite. */
export function toCard(
  row: CardRow,
  categories: ReadonlyMap<string, { ref: { id: string; slug: string; name: string } }>,
  promo: IndicativePromotion | null,
): StoreCardView | null {
  const category = categories.get(row.categoryId);
  if (!category) return null;
  return {
    productId: row.id,
    slug: row.slug,
    price: row.price,
    available: row.available,
    name: row.name,
    summary: summarize(row.description),
    image: row.imageUrl === null ? null : { url: row.imageUrl, altText: row.imageAlt },
    category: { id: category.ref.id, slug: category.ref.slug, name: category.ref.name },
    promo,
  };
}
