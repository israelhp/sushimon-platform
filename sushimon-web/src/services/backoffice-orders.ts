import type { DataClient } from '@/lib/data-access/types';
import type {
  CourierQuote,
  DashboardSummary,
  DeliveryProvider,
  Order,
  OrderStatus,
  Rider,
  StaffUser,
} from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';

/** Operación del backoffice: sesión, panel, pedidos, despacho y entregas. */

export const getStaffMe = (client: DataClient) => client.get<StaffUser>(paths.staffMe());

export const getDashboard = (client: DataClient, branchId?: string) =>
  client.get<DashboardSummary>(paths.dashboard(), { query: { branchId } });

export interface BackofficeOrderFilters {
  branchId?: string;
  /** Uno o varios estados del contrato. */
  status?: OrderStatus | OrderStatus[];
  /** YYYY-MM-DD (por defecto, hoy en el servidor). */
  date?: string;
}

export const listBackofficeOrders = (client: DataClient, filters: BackofficeOrderFilters = {}) =>
  client.get<Order[]>(paths.boOrders(), {
    query: {
      branchId: filters.branchId,
      status: Array.isArray(filters.status) ? filters.status.join(',') : filters.status,
      date: filters.date,
    },
  });

export interface ChangeOrderStatusArgs {
  id: string;
  status: OrderStatus;
  reason?: string;
}

export const changeOrderStatus = (
  client: DataClient,
  { id, status, reason }: ChangeOrderStatusArgs,
) => client.patch<Order>(paths.boOrderStatus(id), reason ? { status, reason } : { status });

export interface DispatchArgs {
  id: string;
  provider: DeliveryProvider;
  riderId?: string;
}

export const dispatchOrder = (client: DataClient, { id, provider, riderId }: DispatchArgs) =>
  client.post<Order>(paths.boOrderDispatch(id), riderId ? { provider, riderId } : { provider });

/** Cotización PedidosYa SIMULADA (integración real pendiente de documentación). */
export const quoteCourier = (client: DataClient, orderId: string) =>
  client.post<CourierQuote>(paths.courierQuote(), { orderId });

/** Avanza un paso el estado logístico (solo simulación). */
export const advanceDelivery = (client: DataClient, orderId: string) =>
  client.patch<Order>(paths.deliveryAdvance(orderId));

export interface DeliveryFilters {
  from?: string;
  to?: string;
  branchId?: string;
  provider?: DeliveryProvider;
}

export const listDeliveries = (client: DataClient, filters: DeliveryFilters = {}) =>
  client.get<Order[]>(paths.deliveries(), {
    query: {
      from: filters.from,
      to: filters.to,
      branchId: filters.branchId,
      provider: filters.provider,
    },
  });

export const listRiders = (client: DataClient, branchId?: string) =>
  client.get<Rider[]>(paths.riders(), { query: { branchId } });

/** 🎭 Solo mock: genera un pedido entrante (simulate() del prototipo). */
export const simulateIncomingOrder = (client: DataClient, branchId?: string) =>
  client.post<Order>(paths.demoSimulateOrder(), branchId ? { branchId } : {});
