import type { AuditEventInput } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { DeliveryEvent } from './delivery-policy.js';

/** Último evento del historial de la entrega (solo en lecturas de comando: repeticiones idempotentes y `appliedByMe`). */
export interface DeliveryLastEvent {
  event: string;
  oldStatus: string | null;
  status: string;
  riderId: string | null;
  changedBy: string | null;
  changedAt: Date;
}

/**
 * Entrega tal como se LEE (con pedido, sucursal, municipio/zona y motorista por JOIN). El teléfono del motorista llega YA
 * enmascarado desde SQL (el valor completo nunca sale de la BD en este módulo) y NO hay `riderBranchId` (F27 obligación 2).
 */
export interface DeliveryRow {
  id: string;
  orderId: string;
  branchId: string;
  branchName: string;
  status: string;
  version: number;
  riderId: string | null;
  assignedAt: Date | null;
  pickedUpAt: Date | null;
  deliveredAt: Date | null;
  returnedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  orderStatus: string;
  orderNumber: bigint;
  fulfillmentType: string;
  deliveryProvider: string | null;
  municipalityName: string | null;
  zone: string | null;
  riderName: string | null;
  riderVehicleType: string | null;
  riderPhoneMasked: string | null;
  /** Solo lo rellenan las lecturas/escrituras de comando (`undefined` en el listado y el detalle). */
  lastEvent?: DeliveryLastEvent | null;
}

export interface DeliveryListRow extends DeliveryRow {
  /** `created_at` en ISO UTC con microsegundos (el `Date` de JS trunca a ms y rompería el keyset). */
  createdAtKey: string;
}

export interface DeliveryHistoryRow {
  event: string;
  oldStatus: string | null;
  status: string;
  riderId: string | null;
  riderName: string | null;
  /** `null` salvo con `deliveries.update` en la sucursal de la entrega (decidido EN SQL; S1). */
  reason: string | null;
  /** `null` salvo con `deliveries.update` en la sucursal de la entrega (decidido EN SQL; S8). */
  actorName: string | null;
  at: Date;
}

export interface DeliveryDetailRecord {
  row: DeliveryRow;
  /** `true` solo si la entrega está `pending|assigned|picked_up` y el actor tiene `orders.read` en la sucursal (decidido EN SQL). */
  contactVisible: boolean;
  customer: { name: string; phone: string } | null;
  address: {
    municipalityName: string;
    zone: string | null;
    addressLine: string;
    referenceNote: string | null;
  } | null;
  /** Cronológico ascendente; como máximo 50. */
  history: DeliveryHistoryRow[];
  historyTruncated: boolean;
}

export interface DeliveryListFilter {
  /** Alcance de `deliveries.read`: `null` = todas las sucursales; lista = SOLO esas (vacía no devuelve nada). */
  branchIds: string[] | null;
  statuses: string[];
  riderId: string | null;
  from: Date;
  to: Date | null;
  cursor: { createdAtKey: string; id: string } | null;
  limit: number;
}

/** Pedido leído para crear/reabrir, con la entrega existente (si la hay). */
export interface OrderForDelivery {
  orderId: string;
  branchId: string;
  status: string;
  fulfillmentType: string;
  deliveryProvider: string | null;
  updatedAt: Date;
  existing: { id: string; status: string; version: number } | null;
}

export interface RiderLock {
  id: string;
  /** Solo para decidir la visibilidad (`riders.read` en SU sucursal); NUNCA se devuelve al cliente. */
  branchId: string;
}

export type DeliveryChange =
  | { kind: 'assign'; riderId: string }
  | { kind: 'unassign' }
  | { kind: 'pick_up' }
  | { kind: 'deliver' }
  | { kind: 'return' }
  | { kind: 'cancel' }
  | { kind: 'reopen' };

export interface ChangeInput {
  id: string;
  expectedVersion: number;
  /** CAS adicional sobre el estado de origen (estados válidos). */
  fromStatuses: readonly string[];
  change: DeliveryChange;
  /** Estado/evento que se registran en el historial. */
  event: DeliveryEvent;
  oldStatus: string;
  /** Motorista del EVENTO (incluye el liberado al desasignar/cancelar). */
  historyRiderId: string | null;
  reason: string | null;
  changedBy: string;
}

/** Cliente transaccional de las operaciones de entregas (una transacción, orden de bloqueos motorista → entrega → pedido). */
export interface DeliveriesTx {
  readonly client: Prisma.TransactionClient;
  /** Lectura con alcance EN SQL (`deliveries.read`); `lock` = `FOR UPDATE OF d`. `null` = no existe o fuera de alcance. */
  readDelivery(
    id: string,
    branchIds: string[] | null,
    opts?: { lock?: boolean; lastEvent?: boolean },
  ): Promise<DeliveryRow | null>;
  /**
   * `SELECT … FOR UPDATE` de la fila del motorista (primer bloqueo) CON el alcance de `riders.read` en el propio SQL (S2).
   * `null` = no existe, fuera de alcance o alcance vacío (en ese caso NO toca la BD): no se bloquea nada.
   */
  lockRider(riderId: string, branchIds: string[] | null): Promise<RiderLock | null>;
  /**
   * Relectura BLOQUEADA en DOS sentencias de orden explícito (S9): `FOR UPDATE OF d` (con último evento) y luego `FOR SHARE` del
   * pedido, cuyo estado vigente sustituye al de la primera lectura.
   */
  readDeliveryLocked(id: string): Promise<DeliveryRow | null>;
  /** Pedido (alcance de `deliveries.read` EN SQL) con la entrega existente. Sin bloqueo. */
  readOrderForCreate(orderId: string, branchIds: string[] | null): Promise<OrderForDelivery | null>;
  /** `INSERT … ON CONFLICT (order_id) DO NOTHING` + historial `created` en UNA sentencia. `null` = ya existía (carrera). */
  insert(orderId: string, branchId: string, changedBy: string): Promise<DeliveryRow | null>;
  /** CAS por `version` y estado + fila de historial en UNA sentencia. `null` = 0 filas. */
  change(input: ChangeInput): Promise<DeliveryRow | null>;
  audit(event: AuditEventInput): Promise<void>;
}
