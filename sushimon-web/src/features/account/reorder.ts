import type { Order, Product } from '@/lib/data-access/models';
import type { CartLine } from '../cart/cart';

/**
 * "Repetir pedido": arma las líneas de carrito a partir de un pedido anterior con el catálogo
 * actual. Informa cuántos productos no se agregarán (inexistentes o no disponibles) y cuáles
 * cambiaron de precio, para el aviso del prototipo.
 */
export interface ReorderPlan {
  lines: CartLine[];
  /** Unidades de productos que no se agregarán. */
  skippedCount: number;
  skipped: { productId: string; name: string; quantity: number }[];
  priceChanges: { productId: string; name: string; before: number; now: number }[];
}

export function planReorder(order: Pick<Order, 'lines'>, products: Product[]): ReorderPlan {
  const byId = new Map(products.map((p) => [p.id, p]));
  const plan: ReorderPlan = { lines: [], skippedCount: 0, skipped: [], priceChanges: [] };
  for (const line of order.lines) {
    const product = byId.get(line.productId);
    if (!product || !product.available) {
      plan.skipped.push({ productId: line.productId, name: line.name, quantity: line.quantity });
      plan.skippedCount += line.quantity;
      continue;
    }
    plan.lines.push({ productId: line.productId, quantity: line.quantity, note: line.note });
    if (product.price !== line.unitPrice) {
      plan.priceChanges.push({
        productId: line.productId,
        name: product.name,
        before: line.unitPrice,
        now: product.price,
      });
    }
  }
  return plan;
}

/** Fusiona con el carrito actual (modo "agregar"); en modo "reemplazar" usar `plan.lines`. */
export function mergeIntoCart(current: CartLine[], incoming: CartLine[]): CartLine[] {
  const out = current.map((l) => ({ ...l }));
  for (const l of incoming) {
    const existing = out.find((x) => x.productId === l.productId && x.note === l.note);
    if (existing) existing.quantity = Math.min(99, existing.quantity + l.quantity);
    else out.push({ ...l });
  }
  return out;
}
