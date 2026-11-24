import { displayNumberOf } from '../orders/order-mapper.js';
import type {
  AdminDeliveryDto,
  AdminDeliveryHistoryEntryDto,
  AdminDeliverySummaryDto,
} from './dto/deliveries-responses.dto.js';
import { isOccupying, type DeliveryActionState } from './delivery-policy.js';
import type { DeliveryDetailRecord, DeliveryHistoryRow, DeliveryRow } from './deliveries.types.js';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/**
 * Proyección de una entrega a su resumen (listado y resultado de comandos). Del motorista SOLO `id`, nombre, vehículo y
 * teléfono enmascarado (spec §8): nunca placa, teléfono completo ni sucursal. Sin contacto ni dirección del cliente.
 */
export function toSummary(
  row: DeliveryRow,
  availableActions: DeliveryActionState[],
): AdminDeliverySummaryDto {
  return {
    id: row.id,
    orderId: row.orderId,
    displayNumber: displayNumberOf(row.orderNumber),
    branchId: row.branchId,
    branchName: row.branchName,
    status: row.status,
    orderStatus: row.orderStatus,
    municipalityName: row.municipalityName,
    zone: row.zone,
    rider:
      row.riderId !== null && row.riderName !== null
        ? {
            id: row.riderId,
            fullName: row.riderName,
            vehicleType: row.riderVehicleType,
            phoneMasked: row.riderPhoneMasked ?? '',
          }
        : null,
    riderOccupied: row.riderId !== null && isOccupying(row.status),
    awaitingReturn: row.status === 'delivered',
    version: row.version,
    assignedAt: iso(row.assignedAt),
    pickedUpAt: iso(row.pickedUpAt),
    deliveredAt: iso(row.deliveredAt),
    returnedAt: iso(row.returnedAt),
    cancelledAt: iso(row.cancelledAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    availableActions: availableActions.map((a) => ({ ...a })),
  };
}

const toHistory = (h: DeliveryHistoryRow): AdminDeliveryHistoryEntryDto => ({
  event: h.event,
  oldStatus: h.oldStatus,
  status: h.status,
  riderId: h.riderId,
  riderName: h.riderName,
  reason: h.reason,
  actorName: h.actorName,
  at: h.at.toISOString(),
});

/** Detalle: resumen + pedido + contacto/dirección (ya filtrados en SQL) + historial. */
export function toDetail(
  record: DeliveryDetailRecord,
  availableActions: DeliveryActionState[],
): AdminDeliveryDto {
  const { row } = record;
  return {
    ...toSummary(row, availableActions),
    order: {
      id: row.orderId,
      displayNumber: displayNumberOf(row.orderNumber),
      status: row.orderStatus,
      deliveryProvider: row.deliveryProvider,
    },
    contactVisible: record.contactVisible,
    customer: record.customer ? { ...record.customer } : null,
    address: record.address ? { ...record.address } : null,
    history: record.history.map(toHistory),
    historyTruncated: record.historyTruncated,
  };
}
