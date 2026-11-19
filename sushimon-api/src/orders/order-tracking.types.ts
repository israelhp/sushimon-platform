import type { OrderPaymentRecord } from './orders.types.js';

/** Tipos del seguimiento de pedidos (F21, spec 022). Desacoplados de Prisma para poder usar dobles en pruebas. */

/** Un evento de `order_status_history` tal como se LEE: sin `id`, `old_status`, `changed_by` ni `reason` (privacidad). */
export interface OrderTrackingHistoryEntry {
  newStatus: string;
  changedAt: Date;
}

/**
 * Lo mínimo que se lee de un pedido para el seguimiento: SIN contacto, dirección, notas, importes ni líneas.
 * `history` llega en orden CRONOLÓGICO ascendente (`changed_at, id`) y contiene como máximo los 51 eventos más RECIENTES
 * (el más antiguo de los 51 solo sirve para detectar el truncamiento y no se expone).
 */
export interface OrderTrackingRecord {
  id: string;
  orderNumber: bigint;
  branchId: string;
  fulfillmentType: string;
  deliveryProvider: string | null;
  status: string;
  placedAt: Date;
  updatedAt: Date;
  /** F24: pago del pedido (LEFT JOIN en la lectura del pedido); `null`/ausente = sin fila de pago (se lee `PENDING`). */
  payment?: Pick<OrderPaymentRecord, 'status' | 'receivedAt'> | null;
  history: OrderTrackingHistoryEntry[];
}
