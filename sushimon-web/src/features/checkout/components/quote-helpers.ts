import { configKey, type QuoteInputs } from '@/lib/checkout-quote';
import type { CheckoutQuote } from '@/lib/data-access/models';
import type { CartRowView } from '@/features/cart/use-cart-view';

/** Nombre (idioma activo) por configuración de producto: empareja las líneas cotizadas con las del carrito. */
export function rowNamesByConfig(rows: readonly CartRowView[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const { line, name } of rows) {
    const key = configKey(line.productId, line.selections);
    if (!names.has(key)) names.set(key, name);
    // Respaldo por producto (la respuesta que se pinta mientras se recalcula puede ser de otras entradas).
    if (!names.has(`p:${line.productId}`)) names.set(`p:${line.productId}`, name);
  }
  return names;
}

/**
 * Nombre a mostrar de la línea cotizada `index`: se empareja por la línea ENVIADA (`inputs.cart.lines[index]`), no por los extras
 * de la respuesta (una línea no comprable devuelve `modifiers: []`).
 */
export function quoteLineName(
  names: ReadonlyMap<string, string>,
  sent: QuoteInputs['cart']['lines'][number] | undefined,
  fallback: string,
): string {
  return (
    (sent && names.get(configKey(sent.productId, sent.selections))) ??
    names.get(`p:${fallback}`) ??
    fallback
  );
}

/** Índices de líneas con un bloqueo (para marcarlas en la lista). */
export function blockedLineIndexes(quote: CheckoutQuote): Set<number> {
  return new Set(
    quote.blockers.flatMap((b) =>
      b.scope === 'LINE' && b.lineIndex !== undefined ? [b.lineIndex] : [],
    ),
  );
}
