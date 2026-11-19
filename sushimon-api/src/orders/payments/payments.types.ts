import type { AuditEventInput } from '../../audit/audit.service.js';

/** Contexto de cobro derivado del pedido (nunca de la entrada). F28 añadirá `RIDER` de forma aditiva. */
export type CollectionContext = 'BRANCH' | 'OWN_DELIVERY';

/** Pago tal como se LEE (una fila por pedido). Los hashes e `receivedByStaffId` son INTERNOS: nunca salen en un DTO. */
export interface PaymentRow {
  id: string;
  /** `pending` | `paid` (CHECK). */
  status: string;
  /** Cadena decimal exacta (`"185.00"`) = `orders.total`. */
  amount: string;
  tendered: string | null;
  change: string | null;
  receivedAt: Date | null;
  collectionContext: string | null;
  receivedByStaffId: string | null;
  /** Nombre mínimo del empleado (`LEFT JOIN staff_users`); `null` si ya no existe. */
  collectorName: string | null;
  confirmKeyHash: Uint8Array | null;
  confirmRequestHash: Uint8Array | null;
}

/** Pedido + su pago (`null` = pedido histórico sin fila de pago). */
export interface PaymentOrderView {
  orderId: string;
  orderNumber: bigint;
  orderStatus: string;
  branchId: string;
  fulfillmentType: string;
  deliveryProvider: string | null;
  /** `orders.total` como cadena decimal exacta. */
  total: string;
  payment: PaymentRow | null;
}

export interface PaymentEventRow {
  id: string;
  /** `created` | `cash_received` (CHECK). */
  type: string;
  at: Date;
  actorName: string | null;
  amount: string;
  tendered: string | null;
  change: string | null;
}

export interface PaymentHistoryRecord {
  orderId: string;
  orderNumber: bigint;
  events: PaymentEventRow[];
}

export interface MarkPaidInput {
  paymentId: string;
  /** Pedido del pago: se bloquea `FOR SHARE` en la misma sentencia (carrera cobro vs cancelar/rechazar). */
  orderId: string;
  /** Efectivo entregado como cadena decimal exacta (`"200.00"`). */
  tendered: string;
  staffId: string;
  context: CollectionContext;
  keyHash: Buffer;
  requestHash: Buffer;
}

/**
 * Operaciones de UNA transacción de registro. La implementación de producción vive en `PaymentsRepository`; las pruebas usan
 * un doble atómico en memoria. F28 abrirá SU transacción con este mismo contrato (mismo servicio de registro).
 */
export interface PaymentsTx {
  /** Lectura 1 con el alcance EN SQL (`null` = global; lista = solo esas sucursales). `null` = no existe o fuera de alcance. */
  read(orderId: string, branchIds: string[] | null): Promise<PaymentOrderView | null>;
  /**
   * COMPARE-AND-SET: `UPDATE payments … WHERE id AND status = 'pending'` sobre el pedido leído `FOR SHARE` (`status NOT IN ('rejected','cancelled')`) +
   * evento `cash_received` (mismo instante `clock_timestamp()`) en UNA sentencia. `null` = otra transacción ganó (0 filas).
   * NO toca `orders`.
   */
  markPaid(input: MarkPaidInput): Promise<{ receivedAt: Date; change: string } | null>;
  audit(event: AuditEventInput): Promise<void>;
}
