/**
 * Validación de la consulta de invitado (solo formato; si el pedido existe lo decide el servidor y NUNCA se
 * revela por separado: un número inexistente y un teléfono que no coincide dan el mismo aviso).
 */
export interface LookupErrors {
  orderNumber: 'errId' | null;
  phone: 'errPhone' | null;
}

/** Dígitos de un teléfono. */
export const phoneDigits = (value: string) => value.replace(/\D/g, '');

export function validateLookup(orderNumber: string, phone: string): LookupErrors {
  return {
    orderNumber: orderNumber.trim() ? null : 'errId',
    phone: phoneDigits(phone).length >= 8 ? null : 'errPhone',
  };
}

export const hasLookupErrors = (errors: LookupErrors) =>
  errors.orderNumber !== null || errors.phone !== null;

/** Destino tras una consulta correcta: el reclamo (`?next=incidencia`) o el seguimiento. */
export function lookupDestination(orderId: string, next: string | null | undefined): string {
  return next === 'incidencia'
    ? `/incidencias?pedido=${encodeURIComponent(orderId)}`
    : `/pedidos/${encodeURIComponent(orderId)}`;
}
