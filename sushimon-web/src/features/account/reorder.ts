import type { DraftOrder, Product } from '@/lib/data-access/models';

/**
 * "Repetir pedido": arma las líneas de carrito a partir de un pedido anterior con el catálogo
 * actual. Informa cuántos productos no se agregarán (inexistentes o no disponibles) y cuáles
 * cambiaron de precio, para el aviso del prototipo.
 */
/** Línea a reordenar: los pedidos anteriores no guardan extras (llegan con F20/F23), solo producto, cantidad y nota. */
export interface ReorderLine {
  productId: string;
  quantity: number;
  note: string;
}

export interface ReorderPlan {
  lines: ReorderLine[];
  /** Unidades de productos que no se agregarán. */
  skippedCount: number;
  skipped: { productId: string; name: string; quantity: number }[];
  priceChanges: { productId: string; name: string; before: number; now: number }[];
}

export function planReorder(order: Pick<DraftOrder, 'lines'>, products: Product[]): ReorderPlan {
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
