import type { DataClient } from '@/lib/data-access/types';
import type {
  AdminOrderBoard,
  AdminOrderCommandRequest,
  AdminOrderDetail,
  AdminOrderPage,
  AdminOrderReasonRequest,
  AdminOrderTransitionResult,
  OrderLifecycleStatus,
} from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';

/**
 * F22 (spec 023): pedidos del backoffice. Un único camino para `http` y `mock`: el mock responde estas mismas rutas con la forma
 * real. NUNCA llama a `/v1/backoffice/orders*` ni a `/v1/demo/*`. La web no calcula permisos ni transiciones: el servidor decide
 * (`availableActions`, 403/404/409/422).
 */

export type AdminOrderCommand =
  'accept' | 'reject' | 'start-preparing' | 'mark-ready' | 'complete' | 'cancel';

/** Comandos que exigen motivo interno (3–280 caracteres). */
export const REASON_COMMANDS: readonly AdminOrderCommand[] = ['reject', 'cancel'];

export interface AdminOrderListFilters {
  /** `undefined` = todas las sucursales autorizadas. */
  branchId?: string;
  status?: readonly OrderLifecycleStatus[];
  fulfillmentType?: 'PICKUP' | 'DELIVERY';
  /** Número (`1042`, `MON-001042`) o nombre del cliente (2–40). */
  q?: string;
  /** Instantes ISO 8601 con zona (la web los calcula en America/Guatemala). */
  from?: string;
  to?: string;
  limit?: number;
}

export const listAdminOrders = (
  client: DataClient,
  filters: AdminOrderListFilters = {},
  cursor?: string | null,
  signal?: AbortSignal,
) =>
  client.get<AdminOrderPage>(paths.adminOrders(), {
    signal,
    query: {
      branchId: filters.branchId,
      status: filters.status?.length ? filters.status.join(',') : undefined,
      fulfillmentType: filters.fulfillmentType,
      q: filters.q,
      from: filters.from,
      to: filters.to,
      limit: filters.limit,
      cursor: cursor ?? undefined,
    },
  });

export const getAdminOrderBoard = (client: DataClient, branchId?: string, signal?: AbortSignal) =>
  client.get<AdminOrderBoard>(paths.adminOrderBoard(), { signal, query: { branchId } });

export const getAdminOrder = (client: DataClient, id: string, signal?: AbortSignal) =>
  client.get<AdminOrderDetail>(paths.adminOrder(id), { signal });

export interface AdminOrderCommandArgs {
  id: string;
  command: AdminOrderCommand;
  /** Estado que la persona vio al decidir (compare-and-set en el servidor). */
  expectedStatus: OrderLifecycleStatus;
  /** Solo `reject` y `cancel`; se envía recortado. */
  reason?: string;
}

const COMMAND_PATH: Record<AdminOrderCommand, (id: string) => string> = {
  accept: paths.adminOrderAccept,
  reject: paths.adminOrderReject,
  'start-preparing': paths.adminOrderStartPreparing,
  'mark-ready': paths.adminOrderMarkReady,
  complete: paths.adminOrderComplete,
  cancel: paths.adminOrderCancel,
};

export function runAdminOrderCommand(client: DataClient, args: AdminOrderCommandArgs) {
  const body: AdminOrderCommandRequest | AdminOrderReasonRequest = REASON_COMMANDS.includes(
    args.command,
  )
    ? { expectedStatus: args.expectedStatus, reason: (args.reason ?? '').trim() }
    : { expectedStatus: args.expectedStatus };
  return client.post<AdminOrderTransitionResult>(COMMAND_PATH[args.command](args.id), body);
}
