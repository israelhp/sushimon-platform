import type { AuditEventInput } from '../../audit/audit.service.js';
import type { OrderRecord } from '../orders.types.js';

/** Fila ligera de un pedido (tablero, listado y primera lectura de un comando). Sin teléfono, correo, dirección ni notas. */
export interface AdminOrderRow {
  id: string;
  orderNumber: bigint;
  status: string;
  branchId: string;
  branchName: string;
  fulfillmentType: string;
  deliveryProvider: string | null;
  customerName: string;
  /** Unidades (suma de cantidades), agregadas en la misma consulta. */
  itemCount: number;
  /** Cadena decimal exacta (`"185.00"`). */
  total: string;
  paymentMethodPreference: string | null;
  scheduledFor: Date | null;
  placedAt: Date;
  updatedAt: Date;
}

/** Fila de listado: añade el cursor keyset con microsegundos exactos. */
export interface AdminOrderListRow extends AdminOrderRow {
  /** `placed_at` en ISO UTC con microsegundos (el `Date` de JS trunca a ms y rompería el keyset). */
  placedAtKey: string;
}

export interface AdminHistoryRow {
  oldStatus: string | null;
  newStatus: string;
  changedAt: Date;
  reason: string | null;
  actorName: string | null;
}

export interface AdminOrderDetailRecord {
  row: AdminOrderRow;
  /** Snapshots de F20 con el teléfono COMPLETO (sin correo). */
  record: OrderRecord;
  /** Cronológico ascendente; como máximo 50. */
  history: AdminHistoryRow[];
  historyTruncated: boolean;
}

export interface BoardCounts {
  status: string;
  count: number;
  oldest: Date | null;
}

export interface ListFilter {
  /** Alcance ya resuelto: `null` = todas; lista = solo esas sucursales. */
  branchIds: string[] | null;
  status: string[] | null;
  fulfillmentType: 'PICKUP' | 'DELIVERY' | null;
  orderNumber: bigint | null;
  nameContains: string | null;
  from: Date;
  to: Date | null;
  cursor: { placedAtKey: string; id: string } | null;
  limit: number;
}

// ---------- transición ----------

export interface TransitionState {
  status: string;
  updatedAt: Date;
  lastEvent: {
    oldStatus: string | null;
    newStatus: string;
    changedBy: string | null;
    changedAt: Date;
  } | null;
}

/**
 * Operaciones de UNA transacción de transición. La implementación de producción vive en el repositorio (Prisma, mismo
 * cliente transaccional); las pruebas usan un doble atómico en memoria. F28 abre SU transacción y pasa este objeto.
 */
export interface TransitionTx {
  /** Lectura 1 (sin `FOR UPDATE`): fila ligera con sucursal y unidades. `null` = no existe. */
  readOrder(orderId: string): Promise<AdminOrderRow | null>;
  /**
   * COMPARE-AND-SET + historial en UNA sentencia: `UPDATE … WHERE id AND status = expected` con
   * `updated_at = clock_timestamp()` y la fila de `order_status_history` con ese MISMO valor como `changed_at`.
   * Devuelve `updated_at` o `null` si otra transacción ganó (0 filas: no se escribe historial).
   */
  casAndRecord(input: {
    orderId: string;
    expected: string;
    to: string;
    changedBy: string | null;
    reason: string | null;
  }): Promise<Date | null>;
  /** Relectura: estado actual y último evento del historial. */
  readState(orderId: string): Promise<TransitionState | null>;
  audit(event: AuditEventInput): Promise<void>;
}
