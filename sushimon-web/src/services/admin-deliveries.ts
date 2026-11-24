import type {
  AdminDelivery,
  AdminDeliveryCommandResult,
  AdminDeliveryPage,
  AdminDeliveryStatus,
} from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';
import type { DataClient } from '@/lib/data-access/types';

/**
 * F28 (spec 029, ADR-0032) — Entregas PROPIAS del backoffice (contrato `admin-deliveries`: `deliveries.read|assign|update` + aal2,
 * alcance por sucursal EN EL SERVIDOR). La web nunca decide transiciones ni permisos: envía `expectedVersion` (la `version` que la
 * persona vio) y el servidor responde 409 `DELIVERY_STATE_CONFLICT` con `current` si cambió. El listado no trae PII del cliente; el
 * contacto y la dirección solo viajan en el detalle y solo si `contactVisible`. Nada de esto se guarda en el navegador ni en la URL.
 */
export interface AdminDeliveryFilters {
  branchId?: string;
  /** undefined = los ABIERTOS (`pending,assigned,picked_up,delivered`, sin ventana de fechas). */
  status?: readonly AdminDeliveryStatus[];
  riderId?: string;
  /** Instantes ISO 8601 con zona; solo acotan `returned|cancelled`. */
  from?: string;
  to?: string;
  limit?: number;
}

export const listAdminDeliveries = (
  client: DataClient,
  filters: AdminDeliveryFilters = {},
  cursor?: string | null,
  signal?: AbortSignal,
) =>
  client.get<AdminDeliveryPage>(paths.adminDeliveries(), {
    signal,
    query: {
      branchId: filters.branchId,
      status: filters.status && filters.status.length > 0 ? filters.status.join(',') : undefined,
      riderId: filters.riderId,
      from: filters.from,
      to: filters.to,
      cursor: cursor ?? undefined,
      limit: filters.limit,
    },
  });

export const getAdminDelivery = (client: DataClient, id: string, signal?: AbortSignal) =>
  client.get<AdminDelivery>(paths.adminDelivery(id), { signal });

/**
 * Crea (201) o reabre una entrega cancelada (201); idempotente por pedido (200 con `transition.replayed=true` si ya está abierta).
 * No cambia el pedido. Sin `Idempotency-Key`: la unicidad por pedido es la garantía.
 */
export const createAdminDelivery = (client: DataClient, orderId: string) =>
  client.post<AdminDeliveryCommandResult>(paths.adminDeliveries(), { orderId });

/** Asigna o REASIGNA (solo antes de la recogida). Exige `deliveries.assign` y `riders.assign`. 422 `RIDER_NOT_ELIGIBLE`. */
export const assignOwnRiderToAdminDelivery = (
  client: DataClient,
  id: string,
  input: { riderId: string; expectedVersion: number },
) => client.post<AdminDeliveryCommandResult>(paths.adminDeliveryAssignOwnRider(id), input);

export const unassignRiderFromAdminDelivery = (
  client: DataClient,
  id: string,
  input: { expectedVersion: number; reason?: string },
) => client.post<AdminDeliveryCommandResult>(paths.adminDeliveryUnassignRider(id), input);

/** Recogida: la entrega pasa a `picked_up` y el pedido a `on_the_way` en la misma transacción (servidor). */
export const markAdminDeliveryPickedUp = (
  client: DataClient,
  id: string,
  input: { expectedVersion: number },
) => client.post<AdminDeliveryCommandResult>(paths.adminDeliveryMarkPickedUp(id), input);

export const markAdminDeliveryDelivered = (
  client: DataClient,
  id: string,
  input: { expectedVersion: number },
) => client.post<AdminDeliveryCommandResult>(paths.adminDeliveryMarkDelivered(id), input);

/** Retorno a la sucursal (evento SEPARADO de la entrega; libera al motorista; no toca el pedido). */
export const returnAdminDeliveryToBranch = (
  client: DataClient,
  id: string,
  input: { expectedVersion: number },
) => client.post<AdminDeliveryCommandResult>(paths.adminDeliveryReturnToBranch(id), input);

/** Cancela la entrega (`pending|assigned`); motivo OBLIGATORIO (interno, sin datos personales). No cambia el pedido. */
export const cancelAdminDelivery = (
  client: DataClient,
  id: string,
  input: { expectedVersion: number; reason: string },
) => client.post<AdminDeliveryCommandResult>(paths.adminDeliveryCancel(id), input);
