import type {
  AdminDeliveryEvent,
  AdminDeliveryHistoryEntry,
  AdminDeliveryStatus,
} from '@/lib/data-access/models';

/**
 * F28 (SIMULADO) — Entregas PROPIAS de la demostración con la forma persistida de `app.deliveries` (el listado y el detalle los
 * derivan en el handler). El `orderId` es el id del pedido BORRADOR (`MON-3xxxxx`) del store: la entrega no duplica datos del
 * pedido. Sin PII (el contacto sale del pedido, solo si `contactVisible`). Ningún dato real; no confirma nada real.
 */
export interface AdminDeliveryRecord {
  id: string;
  orderId: string;
  branchId: string;
  status: AdminDeliveryStatus;
  riderId: string | null;
  version: number;
  assignedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  returnedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  history: AdminDeliveryHistoryEntry[];
}

const entry = (
  event: AdminDeliveryEvent,
  oldStatus: AdminDeliveryStatus | null,
  status: AdminDeliveryStatus,
  at: string,
  extra: { riderId?: string; riderName?: string } = {},
): AdminDeliveryHistoryEntry => ({
  event,
  oldStatus,
  status,
  riderId: extra.riderId ?? null,
  riderName: extra.riderName ?? null,
  reason: null,
  actorName: 'Marco Antonio Gómez',
  at,
});

/**
 * Dos entregas sembradas sobre pedidos `OWN` de sucursales que NO usa el flujo principal de las pruebas (la 1): una `pending` (sin
 * motorista) en la sucursal 3 y una `assigned` en la 2 con el pedido aún en preparación (recoger queda deshabilitado
 * `ORDER_NOT_READY`).
 */
export const ADMIN_DELIVERY_SEEDS: readonly AdminDeliveryRecord[] = [
  {
    id: 'delivery-1',
    orderId: 'MON-307052',
    branchId: 'sucursal-3',
    status: 'pending',
    riderId: null,
    version: 1,
    assignedAt: null,
    pickedUpAt: null,
    deliveredAt: null,
    returnedAt: null,
    cancelledAt: null,
    createdAt: '2026-11-11T20:10:00.000Z',
    updatedAt: '2026-11-11T20:10:00.000Z',
    history: [entry('created', null, 'pending', '2026-11-11T20:10:00.000Z')],
  },
  {
    id: 'delivery-2',
    orderId: 'MON-307054',
    branchId: 'sucursal-2',
    status: 'assigned',
    riderId: 'rider-4',
    version: 2,
    assignedAt: '2026-11-11T20:05:00.000Z',
    pickedUpAt: null,
    deliveredAt: null,
    returnedAt: null,
    cancelledAt: null,
    createdAt: '2026-11-11T20:00:00.000Z',
    updatedAt: '2026-11-11T20:05:00.000Z',
    history: [
      entry('created', null, 'pending', '2026-11-11T20:00:00.000Z'),
      entry('rider_assigned', 'pending', 'assigned', '2026-11-11T20:05:00.000Z', {
        riderId: 'rider-4',
        riderName: 'Marvin Tzoc',
      }),
    ],
  },
];
