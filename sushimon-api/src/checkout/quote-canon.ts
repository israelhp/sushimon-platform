import type { CheckoutQuoteRequestDto } from './dto/checkout-quote-request.dto.js';
import type { CheckoutQuoteLineDto } from './dto/checkout-quote-responses.dto.js';

/**
 * Entradas CANÓNICAS de las huellas de la cotización (F19) que F20 reutiliza para que la huella del token (`inputHash`)
 * y la de la recotización coincidan: mismas entradas equivalentes => misma huella. Funciones puras.
 */

/** Entrada canónica (ordenada y normalizada) para la huella del token: dos entradas equivalentes dan la misma huella. */
export function canonicalInput(
  body: Pick<CheckoutQuoteRequestDto, 'cart' | 'fulfillment'>,
  coupon: string | null,
  zoneLabel: string | null,
): unknown {
  const { cart, fulfillment } = body;
  const lines = cart.lines
    .map((l) => ({
      p: l.productId.toLowerCase(),
      q: l.quantity,
      s: l.selections.map((x) => [x.groupId.toLowerCase(), x.optionId.toLowerCase()]).sort(),
    }))
    .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  return {
    b: cart.branchId.toLowerCase(),
    t: fulfillment.type,
    p: fulfillment.deliveryProvider ?? null,
    a: fulfillment.customerAddressId?.toLowerCase() ?? null,
    m: fulfillment.municipalityId?.toLowerCase() ?? null,
    z: zoneLabel === null ? null : zoneLabel.toLowerCase(),
    c: coupon,
    l: lines,
  };
}

/**
 * Líneas EFECTIVAS de la cotización (lo que el servidor decidió cobrar), en orden de índice: producto, cantidad, precio,
 * extras (por opción), descuento y promoción. Cambia si cambia cualquier importe de una línea aunque el total no cambie.
 */
export function canonicalLines(lines: readonly CheckoutQuoteLineDto[]): unknown {
  return [...lines]
    .sort((a, b) => a.index - b.index)
    .map((l) => [
      l.productId.toLowerCase(),
      l.quantity,
      l.unitPrice,
      l.extrasPerUnit,
      l.discount,
      l.promotionId,
      l.modifiers.map((m) => [m.groupId.toLowerCase(), m.optionId.toLowerCase(), m.extraPrice]),
    ]);
}
