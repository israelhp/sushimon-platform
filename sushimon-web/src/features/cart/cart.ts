/**
 * Lógica pura del carrito (sin React). Mismas reglas que el prototipo de la tienda:
 * líneas `{ productId, quantity (1–99), note }`; agregar el mismo producto con la misma nota suma
 * cantidad; los totales mostrados se calculan con precios del catálogo, pero el total definitivo
 * lo calcula el servidor al crear el pedido.
 */
export const CART_STORAGE_KEY = 'monsushi-cart-v1';
export const MAX_QUANTITY = 99;
export const MAX_NOTE_LENGTH = 140;

export interface CartLine {
  productId: string;
  quantity: number;
  note: string;
}

const clampQty = (n: number) => Math.min(MAX_QUANTITY, Math.max(0, Math.floor(n)));

export function addLine(lines: CartLine[], productId: string, quantity = 1, note = ''): CartLine[] {
  const cleanNote = note.trim().slice(0, MAX_NOTE_LENGTH);
  const qty = clampQty(quantity);
  if (qty <= 0) return lines;
  const i = lines.findIndex((l) => l.productId === productId && l.note === cleanNote);
  if (i < 0) return [...lines, { productId, quantity: qty, note: cleanNote }];
  return lines.map((l, j) =>
    j === i ? { ...l, quantity: Math.min(MAX_QUANTITY, l.quantity + qty) } : l,
  );
}

/** Cambia la cantidad de la línea `index` en `delta`; si llega a 0, la elimina. */
export function changeQuantity(lines: CartLine[], index: number, delta: number): CartLine[] {
  const line = lines[index];
  if (!line) return lines;
  const next = clampQty(line.quantity + delta);
  return next <= 0
    ? lines.filter((_, j) => j !== index)
    : lines.map((l, j) => (j === index ? { ...l, quantity: next } : l));
}

export function setQuantity(lines: CartLine[], index: number, quantity: number): CartLine[] {
  const line = lines[index];
  return line ? changeQuantity(lines, index, quantity - line.quantity) : lines;
}

export function setNote(lines: CartLine[], index: number, note: string): CartLine[] {
  return lines.map((l, j) => (j === index ? { ...l, note: note.slice(0, MAX_NOTE_LENGTH) } : l));
}

export function removeLine(lines: CartLine[], index: number): CartLine[] {
  return lines.filter((_, j) => j !== index);
}

/** Quita una unidad de la última línea del producto (botón "−" en el menú). */
export function removeOne(lines: CartLine[], productId: string): CartLine[] {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]?.productId === productId) return changeQuantity(lines, i, -1);
  }
  return lines;
}

export function quantityOf(lines: CartLine[], productId: string): number {
  return lines.reduce((n, l) => (l.productId === productId ? n + l.quantity : n), 0);
}

export function itemCount(lines: CartLine[]): number {
  return lines.reduce((n, l) => n + l.quantity, 0);
}

/** Subtotal estimado con un mapa de precios (los productos desconocidos no suman). */
export function estimateSubtotal(lines: CartLine[], prices: Record<string, number>): number {
  return (
    Math.round(lines.reduce((s, l) => s + (prices[l.productId] ?? 0) * l.quantity, 0) * 100) / 100
  );
}

/** Sanea lo leído de localStorage (descarta basura). */
export function parseCart(raw: string | null): CartLine[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (x): x is { productId: string; quantity: unknown; note?: unknown } =>
          !!x &&
          typeof x === 'object' &&
          typeof (x as { productId?: unknown }).productId === 'string',
      )
      .map((x) => ({
        productId: x.productId,
        quantity: clampQty(Number(x.quantity)),
        note: String(x.note ?? '').slice(0, MAX_NOTE_LENGTH),
      }))
      .filter((x) => x.quantity > 0);
  } catch {
    return [];
  }
}
