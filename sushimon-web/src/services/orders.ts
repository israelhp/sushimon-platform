import type { DataClient } from '@/lib/data-access/types';
import type {
  CardPaymentRequest,
  CreateIncidentRequest,
  CreateOrderRequest,
  Incident,
  Order,
  OrderLookupRequest,
  PaymentResult,
} from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';

/** Pedidos de la tienda: crear, seguir, consultar como invitado, pagar e incidencias. */

/** El cliente envía solo productos/cantidades/notas; precios y totales los calcula el servidor. */
export const createOrder = (client: DataClient, input: CreateOrderRequest) =>
  client.post<Order>(paths.orders(), input);

export const getOrder = (client: DataClient, id: string) => client.get<Order>(paths.order(id));

export const lookupOrder = (client: DataClient, input: OrderLookupRequest) =>
  client.post<Order>(paths.orderLookup(), input);

/**
 * Pago con tarjeta — pasarela NeoNet SIMULADA (solo tarjetas de prueba). La integración real
 * tokenizará la tarjeta en el navegador (pendiente de documentación y credenciales).
 */
export const payWithCard = (client: DataClient, input: CardPaymentRequest) =>
  client.post<PaymentResult>(paths.cardPayment(), input);

export const createIncident = (client: DataClient, input: CreateIncidentRequest) =>
  client.post<Incident>(paths.incidents(), input);

/** 🎭 Solo mock: "Ver siguiente estado (simulación)". En http no existe (404). */
export const advanceOrderDemo = (client: DataClient, id: string) =>
  client.post<Order>(paths.demoAdvanceOrder(id));
