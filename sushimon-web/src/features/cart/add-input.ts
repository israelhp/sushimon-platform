import type { PublicModifierGroup } from '@/lib/data-access/models';
import {
  amountToCents,
  type AddToCartInput,
  type CartOptionDisplay,
  type LiveCard,
} from '@/lib/cart-rules';
import type { ModifierSelection } from '@/lib/modifier-rules';
import { safeMediaUrl } from '@/lib/product-rules';
import type { CatalogProduct } from '../catalog/catalog-product';

/** URL de la imagen principal apta para guardar (https, ≤ 500) o `null`. Misma regla al agregar y al revalidar. */
export function productImageUrl(product: Pick<CatalogProduct, 'media'>): string | null {
  for (const media of product.media ?? []) {
    const url = safeMediaUrl(media.url);
    if (url && url.length <= 500) return url;
  }
  return null;
}

/** Tarjeta del menú (UI) → lo que el carrito necesita para evaluar una línea. */
export function productToLiveCard(product: CatalogProduct): LiveCard {
  // Un importe no canónico NO descarta la tarjeta: `priceCents = null` deja la revalidación en error (no se afirma nada).
  const priceCents = amountToCents(product.effectivePrice);
  return {
    productId: product.id,
    slug: product.slug,
    name: product.name,
    imageUrl: productImageUrl(product),
    priceCents,
    available: product.available,
  };
}

/**
 * Arma la entrada del carrito desde la ficha: datos de CONFIANZA (producto, sucursal, cantidad, selecciones con cantidad 1) y de
 * presentación (nombres y extras de los GRUPOS del servidor, nunca los que escribe el cliente). `null` si falta algo.
 */
export function buildAddInput(args: {
  product: CatalogProduct;
  branchId: string;
  quantity: number;
  note?: string;
  groups?: readonly PublicModifierGroup[];
  selections?: readonly ModifierSelection[];
}): AddToCartInput | null {
  const { product, branchId, quantity, note = '', groups = [], selections = [] } = args;
  const unitCents = amountToCents(product.effectivePrice);
  if (unitCents === null) return null;
  const chosen: { groupId: string; optionId: string; quantity: number }[] = [];
  const options: CartOptionDisplay[] = [];
  for (const selection of selections) {
    const group = groups.find((g) => g.id === selection.groupId);
    if (!group) return null;
    for (const optionId of selection.modifierIds) {
      const option = group.options.find((o) => o.id === optionId);
      const extraCents = option ? amountToCents(option.extraPrice) : null;
      if (!option || extraCents === null) return null;
      chosen.push({ groupId: group.id, optionId, quantity: 1 });
      options.push({
        groupId: group.id,
        optionId,
        groupName: group.name,
        optionName: option.name,
        extraCents,
      });
    }
  }
  return {
    productId: product.id,
    slug: product.slug,
    branchId,
    quantity,
    note,
    selections: chosen,
    display: { name: product.name, imageUrl: productImageUrl(product), unitCents, options },
  };
}
