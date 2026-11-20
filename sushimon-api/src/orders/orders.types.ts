/** Tipos internos del módulo de pedidos (F20). Desacoplados de Prisma para poder usar dobles en pruebas. */

/** Lo único que el mapper exige de un `Prisma.Decimal` (o de un doble de prueba). */
export interface DecimalLike {
  toFixed(decimalPlaces: number): string;
}

/**
 * Pago del pedido tal como se LEE (F24): solo lo que alimenta el vocabulario PÚBLICO (estado, fecha y, en el recibo, importe
 * aplicado, efectivo entregado y cambio). Nunca el empleado, hashes ni historial. `payment` ausente o `null` = pedido histórico
 * sin fila de pago: se lee como efectivo `PENDING`.
 */
export interface OrderPaymentRecord {
  /** `pending` | `paid`. */
  status: string;
  amount: DecimalLike;
  tendered: DecimalLike | null;
  change: DecimalLike | null;
  receivedAt: Date | null;
}

/** Pedido tal como se LEE para responder (sin correo ni coordenadas: minimización de PII). */
export interface OrderRecord {
  id: string;
  orderNumber: bigint;
  customerId: string | null;
  branchId: string;
  customerName: string;
  customerPhone: string;
  fulfillmentType: string;
  deliveryProvider: string | null;
  notes: string | null;
  status: string;
  subtotal: DecimalLike;
  extrasTotal: DecimalLike;
  discountTotal: DecimalLike;
  deliveryFee: DecimalLike;
  total: DecimalLike;
  paymentMethodPreference: string | null;
  /** F24: pago real del pedido (opcional en dobles de prueba; `null`/ausente = sin fila de pago). */
  payment?: OrderPaymentRecord | null;
  placedAt: Date;
  updatedAt: Date;
  address: {
    municipalityName: string;
    zone: string | null;
    addressLine: string;
    referenceNote: string | null;
  } | null;
  items: {
    lineNo: number;
    productName: string;
    quantity: number;
    unitPrice: DecimalLike;
    extrasPerUnit: DecimalLike;
    lineDiscount: DecimalLike;
    notes: string | null;
    modifiers: { modifierName: string; unitExtraPrice: DecimalLike }[];
  }[];
  promotions: { promotionName: string; amount: DecimalLike }[];
}

export interface NewOrderModifier {
  modifierId: string;
  modifierName: string;
  unitExtraPrice: string;
}

export interface NewOrderLine {
  lineNo: number;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: string;
  extrasPerUnit: string;
  lineDiscount: string;
  modifiers: NewOrderModifier[];
}

export interface NewOrderAddress {
  municipalityName: string;
  zone: string | null;
  addressLine: string;
  referenceNote: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** Todo lo que la transacción escribe; los importes salen de la RECOTIZACIÓN, nunca del cliente. */
export interface NewOrder {
  orderId: string;
  customerId: string | null;
  branchId: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  fulfillmentType: 'PICKUP' | 'DELIVERY';
  deliveryProvider: 'OWN' | null;
  notes: string | null;
  subtotal: string;
  extrasTotal: string;
  discountTotal: string;
  deliveryFee: string;
  total: string;
  paymentMethodPreference: 'cash' | null;
  address: NewOrderAddress | null;
  lines: NewOrderLine[];
  promotions: { promotionId: string; promotionName: string; amount: string }[];
  /** Solo invitado: hash (sha256) y vigencia del token inicial. */
  guestToken: { hash: Buffer; expiresAt: Date } | null;
  itemCount: number;
}

export interface IdempotencyClaim {
  scope: string;
  keyHash: Buffer;
  requestHash: Buffer;
  expiresAt: Date;
}

export type CreateOutcome =
  | { kind: 'created'; orderId: string; orderNumber: bigint; placedAt: Date; updatedAt: Date }
  | { kind: 'replay'; orderId: string }
  | { kind: 'reused' };

export interface StoredIdempotency {
  requestHash: Uint8Array;
  orderId: string;
  /** La fila existe pero ya venció (TTL 24 h): no es una repetición; se purga antes de crear. */
  expired: boolean;
}
