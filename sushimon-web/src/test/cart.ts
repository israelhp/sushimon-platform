import type { AddToCartInput, CartSelection } from '@/lib/cart-rules';
import { amountToCents } from '@/lib/cart-rules';
import { createSeedStore } from '@/mocks/seed';

const products = new Map(createSeedStore().products.map((p) => [p.id, p]));

/**
 * Entrada del carrito para las pruebas con el catálogo del mock (id = slug). El precio es el BASE: la revalidación contra la
 * sucursal lo actualiza (y avisa) si hay un precio propio.
 */
export function cartInput(
  productId: string,
  quantity = 1,
  note = '',
  options: {
    branchId?: string;
    selections?: readonly CartSelection[];
    options?: AddToCartInput['display']['options'];
    unitCents?: number;
  } = {},
): AddToCartInput {
  const product = products.get(productId);
  return {
    productId,
    slug: product?.slug ?? productId,
    branchId: options.branchId ?? 'sucursal-1',
    quantity,
    note,
    selections: options.selections ?? [],
    display: {
      name: product?.name ?? productId,
      imageUrl: null,
      unitCents: options.unitCents ?? (product ? (amountToCents(product.basePrice) ?? 0) : 0),
      options: options.options ?? [],
    },
  };
}
