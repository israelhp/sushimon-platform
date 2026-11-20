import { maskPhone, operationalStateOf } from './rider-policy.js';
import type { RiderBusyResult } from './ports/rider-active-deliveries.port.js';
import type { RiderRecord } from './riders.types.js';
import type { AdminRiderDto, AdminRiderSummaryDto } from './dto/riders-responses.dto.js';

/** Proyección de un motorista a su DTO de listado (sin teléfono completo ni placa). */
export function toSummary(rider: RiderRecord, busyInfo: RiderBusyResult): AdminRiderSummaryDto {
  const busy = busyInfo.known && busyInfo.busyIds.has(rider.id);
  return {
    id: rider.id,
    branchId: rider.branchId,
    branchName: rider.branchName,
    fullName: rider.fullName,
    phoneMasked: maskPhone(rider.phone),
    vehicleType: rider.vehicleType as AdminRiderSummaryDto['vehicleType'],
    active: rider.active,
    availability: rider.availability as AdminRiderSummaryDto['availability'],
    busy,
    busyKnown: busyInfo.known,
    operationalState: operationalStateOf(rider.active, rider.availability, busy),
    version: rider.version,
    createdAt: rider.createdAt.toISOString(),
    updatedAt: rider.updatedAt.toISOString(),
  };
}

/** Detalle completo (PII: teléfono y placa, solo para quien tiene `riders.read`). */
export function toDetail(rider: RiderRecord, busyInfo: RiderBusyResult): AdminRiderDto {
  return { ...toSummary(rider, busyInfo), phone: rider.phone, licensePlate: rider.licensePlate };
}
